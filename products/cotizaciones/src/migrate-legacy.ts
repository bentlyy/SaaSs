/**
 * Migracion de los documentos legacy (presupuestos, facturas, recibos y notas de
 * venta) a `cotizaciones.sqlite`.
 *
 * No es "una base vieja -> un producto". Son DOS bases viejas -> un producto,
 * y las dos guardan la misma tabla `documents`:
 *
 *   products/cotizaciones/data/app.db -> Cotizaciones JM   (7 documentos)
 *   products/documentos/data/app.db    -> DocuPro Studio   (8 documentos)
 *
 * El criterio es el de todos los productos: cada tenant legacy se vuelve una
 * organizacion del Core, y los ids legacy se conservan para que la pasada sea
 * re-ejecutable. Si las dos bases tienen el MISMO tenant (que es lo que pasa con
 * una empresa que se partio en dos productos viejos), las dos caen en la misma
 * organizacion, y por eso sus folios pueden chocar entre si.
 *
 * Lo que se encontro al mirar las bases, y como se resolvio cada cosa:
 *
 *   - `documents.subtotal`, `documents.tax` y `documents.total` estan en CENTAVOS
 *     y son AUTORITATIVOS: se copian tal cual, jamas se recalculan. Son el dato
 *     que el legacy guardo, y el que dice el papel que se emitio.
 *
 *   - El `price` de cada linea esta en UNIDADES, no en centavos. En `documentos`:
 *     lineas 4x800 + 1x1200 = 4400 unidades, y el subtotal es 440000: factor 100.
 *     Aplicar un `x100` a ciegas esta bien hoy y seria un error manana, porque
 *     el runtime documenta que OTRAS bases legacy traen el precio de linea ya en
 *     centavos. Por eso el factor se DEDUCE de los totales, fuente por fuente, con
 *     `detectarFactor`, que exige al menos DOS muestras coincidentes y un factor
 *     entero limpio. Si no puede deducirlo devuelve `{ factor: 1, ambiguo: true }`
 *     y aca NO se convierte: la linea entra con el precio del legacy y la
 *     discrepancia queda anotada en el informe. Un total que no cuadra por una
 *     multiplicacion inventada es peor que una linea sin convertir y visible.
 *
 *   - `documents.number` es TEXTO ('C-N8', 'F-1BB') y el folio de este producto es
 *     un entero unico por organizacion. Se toma la primera tanda de digitos del
 *     folio legacy ('F-1BB' -> 1, 'C-N8' -> 8). Si no hay digitos, o si el numero
 *     deduced ya lo usa otro documento de la MISMA organizacion, el documento entra
 *     con el folio siguiente libre y el folio original queda escrito en `notes`
 *     como foto historica. NO se inventa un folio nuevo sin dejar rastro: el
 *     informe lista cada renumeracion con su motivo.
 *
 *   - `documents.type` (cotizacion, factura, recibo, nota_venta) NO se usa como
 *     estado. Dice que papel se emitio, no en que estado esta: una factura
 *     rechazada sigue siendo una factura. El estado sale de `documents.status`, y
 *     el `type` se reporta como dato sin destino.
 *
 *   - `customer_snapshot` es un JSON con `{name, phone, email}`. Se parsea y se
 *     llenan `customer_name` y `customer_email`. El nombre es un SNAPSHOT y por
 *     eso es NOT NULL: la cotizacion tiene que poder leerse sin abrir el producto
 *     `clientes`, que es su dueno. Los clientes NO se copian aca y se reportan.
 *
 *   - `documents.created_at` es la unica fecha del legacy. Se usa como
 *     `created_at` y como `issue_date` (el dia en que se cotizo). `valid_until`,
 *     `sent_at` y `accepted_at` quedan en NULL: el legacy no los guardaba, y
 *     ponerles una fecha seria inventar cuando se negocio cada cotizacion.
 *
 *   - La tasa de impuesto no viene: se DEDUCE del par (subtotal, tax) como
 *     `tax * 10000 / subtotal`, y 0 cuando no hay impuesto. Las tasas que no son
 *     un porcentaje entero se reportan.
 *
 *   - Las tablas de los otros 17 productos legacy (appointments, inventory_*,
 *     work_orders*, resources, staff, services, reminder_logs, users, followups)
 *     NO tienen destino aca: se cuentan y se reportan. `tenants` es la fuente de
 *     la organizacion y `users` es identidad, que ahora es del Core: ninguna de
 *     las dos se copia, y ningun autor se inventa.
 *
 *   npm run migrate:legacy -w @amg/cotizaciones
 *   npm run migrate:legacy -w @amg/cotizaciones -- --legacy <ruta> --destino <ruta>
 *   npm run migrate:legacy -w @amg/cotizaciones -- --org id_tenant=slug-nuevo
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeCoreDb, getCoreDb } from '@amg/platform';
import {
  LegacyReader,
  anotarDiscrepancia,
  autoresSinCore,
  detectarFactor,
  loadProductConfig,
  mapearAutores,
  openProductDb,
  resolverOrganizacion,
  unidadesDeLineas,
  type InformeMigracion,
} from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { legacyTenantMap as mapaCotizaciones, quoteLines, quotes, settings } from './schema.js';

/**
 * El mensaje de error de esta migracion. Distinto del `ErrorMigracion` del
 * runtime para que el que venga de una base invalida se distinga del que venga de
 * una decision de este archivo.
 */
export class ErrorMigracion extends Error {}

interface LegacyDocument {
  id: string;
  tenant_id: string;
  type: string;
  number: string;
  customer_id: string | null;
  customer_snapshot: string;
  title: string;
  lines: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
  created_at: string;
}

interface LegacyLine {
  description?: unknown;
  qty?: unknown;
  price?: unknown;
}

/** Lo que el legacy guardaba del cliente, embebido en `customer_snapshot`. */
interface SnapshotLegacy {
  name?: string;
  phone?: string;
  email?: string;
}

export interface FuenteLegacy {
  /** Nombre corto para el informe: "cotizaciones", "documentos". */
  etiqueta: string;
  /** Base legacy de la que se leen los datos. */
  ruta: string;
  /**
   * Fuente que puede faltar sin que la migracion se caiga.
   *
   * Las dos bases son opcionales por defecto porque los productos legacy se
   * consolidan y sus volumenes se conservan un tiempo sin uso: un checkout
   * parcial sin `documentos` es normal. Se saltan AVISANDO, no en silencio: el
   * informe dice cuales se leyeron, y si alguien esperaba datos de la que falto,
   * lo ve.
   */
  opcional?: boolean;
}

export interface OpcionesMigracion {
  destinoPath: string;
  fuentes: FuenteLegacy[];
  /** `id_tenant=slug` para mapear a mano cuando el slug legacy no sirve. */
  overrides?: Map<string, string>;
}

/** Una tabla del legacy que este producto no se lleva. */
export interface SinEquivalente {
  tabla: string;
  filas: number;
  motivo: string;
  /** De que bases salio el conteo. Sin esto un total agregado no se puede atribuir. */
  fuentes: string[];
}

/**
 * Un documento que NO pudo conservar su folio.
 *
 * Se reporta uno por documento y no un total, porque cada uno tiene un motivo
 * distinto: o el folio del legacy no era un numero, o ya lo usaba otro documento
 * de la misma organizacion. Un "renumerados: 3" no dice nada; "el folio F-1BB ya
 * lo usaba otra cotizacion" si.
 */
export interface Renumeracion {
  legacy: string;
  organizationId: string;
  /** Id legacy del documento, para poder buscarlo en el legacy. */
  documento: string;
  folioLegacy: string;
  folioNuevo: number;
  motivo: string;
}

export interface ResumenCotizaciones {
  porOrganizacion: Array<{
    legacy: string;
    organizationId: string;
    accion: string;
    fuente: string;
    cotizaciones: number;
    lineas: number;
  }>;
  /** Lo que aporto cada fuente, para poder comparar contra cada base de origen. */
  porFuente: Array<{ etiqueta: string; cotizaciones: number; lineas: number; omitidas: number }>;
  /** Fuentes opcionales que no estaban en el disco y se saltaron. */
  fuentesSaltadas: string[];
  /** Factor unidades -> centavos deducido por fuente, y si se pudo deducir. */
  factores: Array<{ etiqueta: string; factor: number; ambiguo: boolean; documentos: number }>;
  renumeraciones: Renumeracion[];
  sinEquivalente: SinEquivalente[];
  /** Columnas del legacy que se pierden, contadas por documento. */
  camposSinDestino: Array<{ campo: string; documentos: number; motivo: string; fuentes: string[] }>;
  /** Que tipo de papel era cada documento: cotizacion, factura, recibo... */
  tiposLegacy: Array<{ tipo: string; documentos: number }>;
  /** Tasa de impuesto mas usada, como pista para los ajustes de la organizacion. */
  tasaMasUsada: { bp: number; documentos: number } | null;
  /** Tasas que no son un porcentaje entero, o que pasan de 100%. */
  tasasAtipicas: string[];
  /** Documentos cuyo `customer_snapshot` no se pudo leer. */
  snapshotsSinLeer: string[];
  /** Documentos cuyo `lines` no se pudo leer. */
  lineasSinLeer: string[];
  /** Estados que el destino no conoce. */
  estadosDesconocidos: string[];
  totalLegacy: Record<string, number>;
  totalDestino: Record<string, number>;
  /** Filas que ya estaban, por tabla del destino. */
  omitidasPorTabla: Record<string, number>;
}

export interface ResultadoMigracion {
  informe: InformeMigracion;
  resumen: ResumenCotizaciones;
  cerrar: () => void;
}

/**
 * Estados que el destino conoce.
 *
 * Lo que no este en la lista NO se tira: se migra como `draft` y se reporta. Un
 * estado que el destino no tiene puede ser un estado nuevo del legacy, y perder
 * una cotizacion por un texto es peor que dejarla sin confirmar.
 *
 * OJO: esta lista NO se arma con `documents.type`. El tipo del legacy dice que
 * papel se emitio (cotizacion, factura, recibo, nota de venta) y no en que estado
 * esta: usarlo como estado convertiria una factura en "cotizacion" o en
 * "factura", que este producto no entiende, y una factura rechazada en algo que
 * no existe.
 */
const ESTADOS = ['draft', 'sent', 'accepted', 'rejected', 'expired'];

/**
 * Tablas del legacy que este producto NO se lleva.
 *
 * Se cuentan y se dicen. Que un dato del legacy no tenga destino es una decision,
 * y una decision que no se escribe es una que alguien va a volver a tomar sin
 * saber que paso.
 *
 * Las tablas VACIAS no se mencionan: contarlas y salir con "0 filas sin destino"
 * suena a problema donde no hay nada. Se pregunta con `tiene` porque no todas las
 * bases legacy tienen todas las tablas, y contarlas en una que no existe tiraria
 * la migracion entera por algo que no importa.
 */
const SIN_DESTINO: Array<{ tabla: string; motivo: string; porTenant?: boolean }> = [
  {
    tabla: 'customers',
    motivo:
      'los absorbio el producto `clientes`, que es su dueno. Aca solo queda un snapshot del nombre',
  },
  { tabla: 'inventory_items', motivo: 'los absorbio el producto `inventario`, que es su dueno' },
  {
    tabla: 'inventory_movements',
    motivo: 'los absorbio el producto `inventario`, que es su dueno',
  },
  { tabla: 'appointments', motivo: 'son de `citas`', porTenant: true },
  { tabla: 'appointment_services', motivo: 'son de `citas`', porTenant: true },
  { tabla: 'work_orders', motivo: 'son de `solicitudes`', porTenant: true },
  { tabla: 'work_order_services', motivo: 'son de `solicitudes`', porTenant: true },
  { tabla: 'work_order_parts', motivo: 'son de `solicitudes`', porTenant: true },
  { tabla: 'resources', motivo: 'son de `espacios`', porTenant: true },
  { tabla: 'staff', motivo: 'son de `citas`, que es su dueno', porTenant: true },
  { tabla: 'staff_services', motivo: 'son de `citas`, que es su dueno', porTenant: true },
  { tabla: 'services', motivo: 'son de `citas`, que es su dueno', porTenant: true },
  { tabla: 'followups', motivo: 'son de `clientes`, que es su dueno', porTenant: true },
  { tabla: 'reminder_logs', motivo: 'son de `recordatorios`, que es su dueno', porTenant: true },
];

/** La primera tanda de digitos de un folio de texto: 'F-1BB' -> 1, 'C-N8' -> 8. */
const PRIMEROS_DIGITOS = /\d+/;

/**
 * El folio del legacy, ledo como numero.
 *
 * Devuelve 0 cuando el folio no tiene digitos ('R-RE'), que NO es un folio valido
 * para este producto: el folio es un entero y 0 no existe como folio. El que
 * decide que hacer con ese 0 es `elegirFolio`, que renumera y lo reporta.
 */
function folioNumerico(texto: string): number {
  const encontrado = PRIMEROS_DIGITOS.exec(texto ?? '');
  return encontrado ? Number.parseInt(encontrado[0], 10) : 0;
}

/** El folio libre mas bajo despues del mas alto que hay. Nunca repite. */
function folioLibre(tomados: Set<number>): number {
  let maximo = 0;
  for (const n of tomados) if (n > maximo) maximo = n;
  return maximo + 1;
}

/**
 * Que folio entra este documento, y por que.
 *
 * Hay tres salidas y las tres se dicen:
 *
 *   - el folio deduced esta libre: entra tal cual, y si el legacy escribia letras
 *     alrededor ('F-1BB') se anota igual en `notes`, porque el numero que un
 *     humano reconocia era ese.
 *   - el folio deduced ya lo usa otro documento de la MISMA organizacion: entra
 *     con el siguiente libre. El folio es unico por empresa, no global, asi que
 *     dos empresas pueden tener las dos la 1; dentro de una, no.
 *   - el folio legacy no tiene digitos: entra con el siguiente libre.
 *
 * NO se inventa un folio sin dejar rastro: en los dos ultimos casos el folio
 * original queda en `notes` y la renumeracion queda en el informe.
 */
function elegirFolio(folioLegacy: string, tomados: Set<number>) {
  const deseado = folioNumerico(folioLegacy);
  const hayDigitos = deseado > 0;

  if (hayDigitos && !tomados.has(deseado)) {
    return { numero: deseado, renumerado: false, motivo: null as string | null };
  }

  const numero = folioLibre(tomados);
  const motivo = hayDigitos
    ? `El folio "${folioLegacy.trim()}" ya lo usa otro documento de esta organizacion, asi que este documento entra con el folio ${numero}.`
    : `El folio "${folioLegacy.trim()}" del legacy no es un numero, asi que este documento entra con el folio ${numero}.`;
  return { numero, renumerado: true, motivo };
}

/**
 * El folio original, escrito en `notes` como foto historica.
 *
 * Va siempre que el folio del legacy NO sea exactamente el numero guardado: si
 * el legacy decia 'F-1BB' y el documento quedo con el 1, alguien tiene que poder
 * leer 'F-1BB' en la cotizacion, porque es el folio que el cliente tiene impreso.
 */
function notaDeFolio(folioLegacy: string, numero: number, motivo: string | null): string | null {
  const limpio = (folioLegacy ?? '').trim();
  if (!motivo && limpio === String(numero)) return null;
  return motivo ? `Folio del legacy: ${limpio}. ${motivo}` : `Folio del legacy: ${limpio}`;
}

/** El snapshot del cliente del legacy, o `null` si no se puede leer. */
function leerSnapshot(bruto: string): SnapshotLegacy | null {
  try {
    const valor: unknown = JSON.parse(bruto ?? '');
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
    return valor as SnapshotLegacy;
  } catch {
    return null;
  }
}

/** `created_at` del legacy (`2026-09-19T16:45:32.355Z`) como fecha `AAAA-MM-DD`. */
function fechaDe(texto: string | null | undefined): string | null {
  if (typeof texto !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : null;
}

/**
 * La tasa de impuesto deducida del legacy, en puntos basicos.
 *
 * El legacy guardaba el impuesto ya aplicado pero NO la tasa, asi que se deduce
 * de la pareja (subtotal, tax): `tax * 10000 / subtotal`. Sin impuesto (o sin
 * subtotal) la tasa es 0. No se corrige ni se redondea hacia un "16% probable":
 * si la pareja no da un porcentaje entero, se copia la fraccion exacta y se
 * reporta como tasa atipica.
 */
function tasaBp(subtotal: number, tax: number): number {
  if (!(subtotal > 0) || !(tax > 0)) return 0;
  return Math.round((tax * 10_000) / subtotal);
}

/** Las lineas del legacy, o `null` si el JSON no se puede leer. */
function leerLineas(bruto: string): LegacyLine[] | null {
  try {
    const valor: unknown = JSON.parse(bruto ?? '');
    return Array.isArray(valor) ? (valor as LegacyLine[]) : null;
  } catch {
    return null;
  }
}

export function migrarLegacy(opciones: OpcionesMigracion): ResultadoMigracion {
  const { destinoPath, fuentes, overrides = new Map() } = opciones;

  if (fuentes.length === 0) throw new ErrorMigracion('No se paso ninguna fuente legacy.');

  /**
   * Se comprueba que exista AL MENOS UNA fuente antes de abrir el destino.
   *
   * Al reves, correr la migracion sin datos creaba una base nueva vacia y
   * reportaba "terminada, 0 migrados", que es lo mas parecido a un exito que
   * puede ser. Aca no se abre nada: si no hay nada que migrar, se dice.
   */
  const fuentesSaltadas: string[] = [];
  const aLeer: Array<{ etiqueta: string; ruta: string }> = [];
  for (const f of fuentes) {
    const absoluta = resolve(f.ruta);
    if (!existsSync(absoluta)) {
      if (f.opcional) {
        fuentesSaltadas.push(`${f.etiqueta} (${absoluta})`);
        continue;
      }
      throw new ErrorMigracion(`No existe la base legacy en ${absoluta}`);
    }
    aLeer.push({ etiqueta: f.etiqueta, ruta: absoluta });
  }
  if (aLeer.length === 0) {
    throw new ErrorMigracion(
      `No se encontro ninguna base legacy que migrar:\n${fuentes
        .map((f) => `  - ${f.etiqueta}: ${resolve(f.ruta)}`)
        .join('\n')}`,
    );
  }

  /**
   * Todas las fuentes se abren y se validan ANTES de tocar el destino.
   *
   * Si la segunda resultara invalida y se descubriera despues de haber copiado la
   * primera, la transaccion cubre que el destino no quede a medias, pero la
   * organizacion de la primera ya quedo creada en el Core. Fallar temprano deja
   * el Core tan limpio como el destino.
   */
  const readers: LegacyReader[] = [];
  for (const fuente of aLeer) {
    const reader = new LegacyReader(fuente.ruta);
    try {
      // `documents` es la tabla que este producto es dueno, y `tenants` es de
      // donde sale la organizacion. Sin las dos, la base no es de este producto.
      reader.exigir(['documents', 'tenants']);
    } catch (e) {
      reader.cerrar();
      for (const abierto of readers) abierto.cerrar();
      throw e;
    }
    readers.push(reader);
  }

  const config = loadProductConfig('cotizaciones', 'Cotizaciones', {
    DB_PATH: destinoPath,
    DB_SCHEMA_VERSION: '1',
  });
  const destino = openProductDb(config, {
    ddl: DDL,
    schema: { quotes, quoteLines, settings, legacyTenantMap: mapaCotizaciones },
  });
  const db = destino.db;

  // El Core se abre aca: sin el no hay a que organizacion apuntar.
  getCoreDb();

  const informe: InformeMigracion = {
    organizaciones: [],
    escritas: {},
    omitidas: 0,
    autoresSinCore: [],
    discrepancias: [],
    leidas: {},
  };
  const resumen: ResumenCotizaciones = {
    porOrganizacion: [],
    porFuente: [],
    fuentesSaltadas,
    factores: [],
    renumeraciones: [],
    sinEquivalente: [],
    camposSinDestino: [],
    tiposLegacy: [],
    tasaMasUsada: null,
    tasasAtipicas: [],
    snapshotsSinLeer: [],
    lineasSinLeer: [],
    estadosDesconocidos: [],
    totalLegacy: {},
    totalDestino: {},
    omitidasPorTabla: {},
  };

  // ── Lo que el legacy tiene y aqui no tiene destino.
  //
  // Se acumulan por nombre y NO por fuente: las dos bases comparten la tabla
  // `documents` y el mismo tenant, asi que un `push` por base devolveria dos
  // entradas identicas y `Object.fromEntries` se quedaria con la segunda. El
  // conteo va agregado, pero cada entrada dice de que bases salio, que es lo
  // que hace falta para ir a buscarlas si el numero no cuadra.
  const tablasPerdidas = new Map<string, { filas: number; motivo: string; fuentes: string[] }>();
  const camposPerdidos = new Map<string, { documentos: number; motivo: string; fuentes: string[] }>();

  const acumularTabla = (tabla: string, filas: number, motivo: string, fuente: string) => {
    const previa = tablasPerdidas.get(tabla);
    if (previa) {
      previa.filas += filas;
      if (!previa.fuentes.includes(fuente)) previa.fuentes.push(fuente);
      return;
    }
    tablasPerdidas.set(tabla, { filas, motivo, fuentes: [fuente] });
  };

  const acumularCampo = (campo: string, documentos: number, motivo: string, fuente: string) => {
    const previa = camposPerdidos.get(campo);
    if (previa) {
      previa.documentos += documentos;
      if (!previa.fuentes.includes(fuente)) previa.fuentes.push(fuente);
      return;
    }
    camposPerdidos.set(campo, { documentos, motivo, fuentes: [fuente] });
  };

  const anotar = (tabla: string, n = 1) => {
    informe.escritas[tabla] = (informe.escritas[tabla] ?? 0) + n;
  };
  const leer = (tabla: string, n: number) => {
    informe.leidas[tabla] = (informe.leidas[tabla] ?? 0) + n;
    resumen.totalLegacy[tabla] = (resumen.totalLegacy[tabla] ?? 0) + n;
  };
  const anotarVeces = <T>(lista: T[], valor: T) => {
    if (!lista.includes(valor)) lista.push(valor);
  };

  /**
   * Cuantos documentos usaron cada tasa de impuesto.
   *
   * Se cuenta primero y se elige la MAS USADA al final, en vez de ir cambiando
   * el ganador documento a documento: un contador mal hecho termina esperando
   * "la tasa mas usada" y da la ULTIMA que aparecio, que no es lo mismo. Con el
   * mapa, el ganador es el de mayor conteo y, a empate, el mas bajo, que es el
   * criterio de `sort` sobre un Map.
   */
  const conteoTasas = new Map<number, number>();

  /**
   * ¿Ya esta esta fila? El id legacy se conserva, asi que eso es la idempotencia
   * entera: una segunda pasada no duplica nada.
   */
  const yaEsta = (tabla: any, id: string, nombre?: string): boolean => {
    const existe =
      db.select({ id: tabla.id }).from(tabla).where(eq(tabla.id, id)).get() !== undefined;
    // Se anotan por tabla, no en un total unico: si no, el informe de la
    // segunda pasada solo puede decir "ya habia 25" y no cuales.
    if (existe && nombre) {
      resumen.omitidasPorTabla[nombre] = (resumen.omitidasPorTabla[nombre] ?? 0) + 1;
    }
    return existe;
  };

  /**
   * Todo el copiado va en UNA transaccion del destino: o quedan las cotizaciones y
   * sus lineas, o no queda ninguna. Medio migrado es peor que no migrado, porque
   * parece que si.
   *
   * Lo que NO se puede deshacer es la organizacion creada en el Core, que se
   * escribe antes. Es a proposito: primero se anota en el Core y despues en el
   * mapa del destino, asi una corrida que se corta deja una organizacion huerfana
   * reutilizable -la proxima corrida la encuentra por slug- en vez de una fila
   * apuntando a una organizacion que no existe.
   */
  const correr = destino.sqlite.transaction(() => {
    for (const [indice, fuente] of aLeer.entries()) {
      const reader = readers[indice];
      const lineasPorFuente = { lineas: 0, cotizaciones: 0, omitidas: 0 };

      /**
       * Los documentos de TODA la fuente, tenant por tenant, se leen antes de
       * escribir nada, y de ellos sale el FACTOR DEL DINERO.
       *
       * `documents.subtotal` esta en centavos y es autoritativo; el `price` de
       * cada linea esta en UNIDADES. El factor se deduce de la pareja (unidades
       * de las lineas, subtotal en centavos) de CADA documento, y `detectarFactor`
       * solo lo acepta si hay al menos dos muestras que coincidan y el factor es
       * un entero limpio. Con una sola muestra no hay con que contrastar:
       * devolver 100 "porque encaja" seria fabricar una conversion con apariencia
       * de dato medido.
       *
       * Se deduce POR FUENTE y no sobre el total de las dos, porque cada base
       * legacy tiene su propia convencion: es justo el caso que el runtime
       * documenta (una base con precios en unidades y otra en centavos). Un
       * factor promedio de las dos no significaria nada. Y se lee ANTES de
       * escribir para que el factor sea el mismo para todos los tenants de la
       * fuente, en vez de depender de en que tenant se esta mirando.
       */
      const tenants = reader.tenants();
      const porTenant = new Map<string, LegacyDocument[]>();
      for (const tenant of tenants) {
        porTenant.set(
          tenant.id,
          reader.filas<LegacyDocument>(
            'SELECT * FROM documents WHERE tenant_id = ? ORDER BY created_at, number, id',
            tenant.id,
          ),
        );
      }
      const todosDeLaFuente = [...porTenant.values()].flat();
      const { factor, ambiguo } = detectarFactor(
        todosDeLaFuente.map((d) => ({ unidades: unidadesDeLineas(d.lines), centavos: d.subtotal })),
      );
      resumen.factores.push({
        etiqueta: fuente.etiqueta,
        factor,
        ambiguo,
        documentos: todosDeLaFuente.length,
      });

      for (const tenant of tenants) {
        /**
         * La organizacion se resuelve ANTES de escribir una sola fila, y el mapa
         * `legacy_tenant_map` se escribe en el mismo paso. Si las dos bases
         * legacy tienen el mismo tenant, la segunda pasada lo encuentra y las dos
         * caen en la misma organizacion: que es exactamente lo que quiere decir
         * "una empresa partida en dos productos".
         */
        const res = resolverOrganizacion(tenant, { mapa: mapaCotizaciones, db, overrides });
        informe.organizaciones.push(res);
        const org = res.organizationId;

        // Los autores del legacy se resuelven por email contra el Core. Ninguno se
        // crea: la identidad es del Core, y un usuario con contrasena inventada es
        // peor que un autor sin Core. Los que faltan se listan para que se creen a
        // mano.
        const autores = mapearAutores(reader.users());
        for (const nombre of autoresSinCore(autores.values())) {
          anotarVeces(informe.autoresSinCore, nombre);
        }

        const conteo = {
          legacy: `${tenant.name} (${tenant.slug}) <- ${fuente.etiqueta}`,
          organizationId: org,
          accion: res.accion,
          fuente: fuente.etiqueta,
          cotizaciones: 0,
          lineas: 0,
        };

        // ── Preferencias, desde la fila del tenant.
        // El legacy no tenia tabla `settings`: la moneda y la zona vivian en
        // `tenants`. La tasa por defecto NO se deduce: las cotizaciones migradas
        // traen la tasa que se les aplico, pero suponer cual era la preferida
        // seria inventar. Se deja en 0 y el informe dice cual se uso mas.
        if (!yaEsta(settings, `cfg_${tenant.id}`, 'settings')) {
          db.insert(settings)
            .values({
              id: `cfg_${tenant.id}`,
              organizationId: org,
              timezone: tenant.timezone || 'America/Santiago',
              currency: tenant.currency || '$',
              createdAt: new Date().toISOString(),
            })
            .run();
          anotar('settings');
        }

        // ── Los documentos de este tenant, ya leidos arriba (el factor se dedujo
        // con los de toda la fuente, no con los de un tenant solo).
        const documentos = porTenant.get(tenant.id) ?? [];
        leer('documents', documentos.length);

        if (ambiguo && documentos.length > 0) {
          /**
           * Sin factor confiable NO se convierte. Los totales se copian igual, tal
           * cual: son autoritativos y no dependen de la conversion. Lo que queda
           * sin convertir es el precio unitario de la linea, y eso se ANOTA, para
           * que el informe diga "estas lineas estan en unidades y hay que
           * revisarlas" en vez de dejar un total que cuadra con un detalle que no.
           */
          anotarDiscrepancia(informe.discrepancias, {
            donde: `documents.lines de ${tenant.name} (${tenant.slug}, fuente ${fuente.etiqueta})`,
            legacyTenantId: tenant.id,
            unidades: documentos.reduce((acc, d) => acc + unidadesDeLineas(d.lines), 0),
            centavos: documentos.reduce((acc, d) => acc + d.subtotal, 0),
            factor,
            motivo:
              'no se pudo deducir un factor unidades -> centavos con dos muestras que coincidan: ' +
              'las lineas se copiaron SIN convertir y los totales se copiaron tal cual',
          });
        }

        /**
         * Los folios que ya ocupa esta organizacion.
         *
         * Se leen del destino (no solo de lo insertado en esta corrida) porque el
         * indice UNIQUE es por organizacion y puede haber cotizaciones de una
         * corrida anterior o escritas a mano.
         */
        const tomados = new Set(
          db
            .select({ n: quotes.number })
            .from(quotes)
            .where(eq(quotes.organizationId, org))
            .all()
            .map((f) => f.n),
        );

        for (const d of documentos) {
          if (yaEsta(quotes, d.id, 'quotes')) {
            informe.omitidas += 1;
            lineasPorFuente.omitidas += 1;
            continue;
          }

          const { numero, renumerado, motivo } = elegirFolio(d.number, tomados);
          tomados.add(numero);
          if (renumerado) {
            resumen.renumeraciones.push({
              legacy: `${tenant.name} (${tenant.slug})`,
              organizationId: org,
              documento: d.id,
              folioLegacy: d.number,
              folioNuevo: numero,
              motivo: motivo!,
            });
          }

          const estado = ESTADOS.includes(d.status) ? d.status : 'draft';
          if (!ESTADOS.includes(d.status)) {
            anotarVeces(resumen.estadosDesconocidos, `${d.status} (documento ${d.number})`);
          }

          const snapshot = leerSnapshot(d.customer_snapshot);
          if (!snapshot) {
            anotarVeces(
              resumen.snapshotsSinLeer,
              `${d.number} (${d.id}): el customer_snapshot no es un JSON con {name, phone, email}`,
            );
          }
          // El nombre es NOT NULL porque la cotizacion tiene que poder leerse sola.
          // Sin nombre util entra con un reemplazo explicito y queda reportado:
          // perder la linea de una cotizacion es peor que perder el nombre.
          const nombreCliente = (snapshot?.name ?? '').trim() || `Cliente sin nombre (${d.id})`;

          // El tipo del legacy NO es un estado. Se cuenta para el informe.
          const tipo = (d.type || 'cotizacion').trim() || 'cotizacion';
          const tipoVisto = resumen.tiposLegacy.find((t) => t.tipo === tipo);
          if (tipoVisto) tipoVisto.documentos += 1;
          else resumen.tiposLegacy.push({ tipo, documentos: 1 });

          const bp = tasaBp(d.subtotal, d.tax);
          if (bp % 100 !== 0 || bp > 10_000) {
            anotarVeces(
              resumen.tasasAtipicas,
              `${d.number} (${tenant.slug}): ${bp} puntos basicos, que no es un porcentaje entero`,
            );
          }
          conteoTasas.set(bp, (conteoTasas.get(bp) ?? 0) + 1);

          const notas = notaDeFolio(d.number, numero, motivo);

          db.insert(quotes)
            .values({
              // El id legacy se conserva tal cual: es lo que hace la pasada
              // re-ejecutable.
              id: d.id,
              organizationId: org,
              number: numero,
              customerName: nombreCliente,
              // Referencia suelta al producto `clientes`. No hay FK porque es otra
              // base; y aunque el cliente no se haya migrado todavia, la
              // cotizacion sigue siendo legible por el snapshot del nombre.
              customerId: d.customer_id,
              customerEmail: (snapshot?.email ?? '').trim() || null,
              title: d.title,
              status: estado,
              issueDate: fechaDe(d.created_at),
              // El legacy no guardaba cuando dejaba de valer la oferta: queda en
              // NULL antes que inventar una.
              validUntil: null,
              taxRateBp: bp,
              // Los tres importes son AUTORITATIVOS: se copian tal cual, sin
              // recalcular y sin convertir. El legacy guardaba centavos, y el
              // papel que se emitio dice esa cantidad.
              subtotalCents: d.subtotal,
              taxCents: d.tax,
              totalCents: d.total,
              notes: notas,
              // El legacy no tenia fecha de envio ni de aceptacion: quedan en NULL
              // en vez de poner la de creacion y hacer creer que se negocio ese dia.
              sentAt: null,
              acceptedAt: null,
              createdAt: d.created_at,
              updatedAt: null,
            })
            .run();
          anotar('quotes');
          conteo.cotizaciones += 1;
          lineasPorFuente.cotizaciones += 1;

          // ── Las lineas, con el precio en centavos si el factor es confiable.
          const lineas = leerLineas(d.lines);
          if (!lineas) {
            anotarVeces(resumen.lineasSinLeer, `${d.number} (${d.id}): el campo lines no es un JSON con una lista`);
            continue;
          }
          for (const [i, l] of lineas.entries()) {
            const qty = Number(l?.qty ?? 1) || 0;
            const precioUnidades = Number(l?.price ?? 0) || 0;
            /**
             * `price` del legacy esta en UNIDADES. Con factor deducido se
             * convierte a centavos; sin factor (ambiguo) NO: la linea entra con
             * el numero del legacy tal cual y la discrepancia quedo anotada mas
             * arriba. Un precio de linea que se multiplico a ciegas por 100
             * desmentiria al total que el propio legacy guardo.
             */
            const unitPriceCents = ambiguo ? Math.round(precioUnidades) : Math.round(precioUnidades * factor);
            db.insert(quoteLines)
              .values({
                // El id deriva del documento y de la posicion: la segunda pasada
                // de la migracion no deja lineas huerfanas ni choca con otro
                // documento.
                id: `${d.id}_l${i + 1}`,
                organizationId: org,
                quoteId: d.id,
                position: i + 1,
                description: String(l?.description ?? `Linea ${i + 1}`),
                qty,
                unitPriceCents,
                // El importe de la linea se redondea UNA vez, a centavo entero. El
                // legacy no guardaba el importe de linea, asi que este es el
                // unico lugar donde se calcula: y se calcula con el precio YA
                // convertido, que es el que se va a ver.
                lineTotalCents: Math.round(unitPriceCents * qty),
                createdAt: d.created_at,
              })
              .run();
            anotar('quote_lines');
            conteo.lineas += 1;
            lineasPorFuente.lineas += 1;
          }
        }

        // ── Lo que este producto NO se lleva de esta base.
        //
        // OJO: `contar` lee la columna `n`, asi que el alias es `n` y no otro. Con
        // `COUNT(*) c` devuelve 0 en silencio y el informe miente diciendo que no
        // habia filas.
        for (const entrada of SIN_DESTINO) {
          if (!reader.tiene(entrada.tabla)) continue;
          const filas = entrada.porTenant
            ? reader.contar(`SELECT COUNT(*) n FROM ${entrada.tabla} WHERE tenant_id = ?`, tenant.id)
            : reader.contar(`SELECT COUNT(*) n FROM ${entrada.tabla}`);
          if (filas > 0) {
            acumularTabla(entrada.tabla, filas, entrada.motivo, fuente.etiqueta);
          }
        }

        // Los CAMPOS que se pierden van aparte de las TABLAS, porque se pierden
        // igual de real y el informe tiene que decirlo con el mismo peso.
        if (documentos.length > 0) {
          acumularCampo(
            'documents.type',
            documentos.length,
            'el tipo del legacy (cotizacion, factura, recibo, nota_venta) dice que papel se emitio, no en que estado esta la cotizacion. No se usa como estado ni se copia',
            fuente.etiqueta,
          );
          const conTelefono = documentos.filter((d) => (leerSnapshot(d.customer_snapshot)?.phone ?? '').trim()).length;
          if (conTelefono > 0) {
            acumularCampo(
              'documents.customer_snapshot.phone',
              conTelefono,
              'el telefono del snapshot no tiene destino: la ficha del cliente es del producto `clientes`, y aca solo queda el nombre y el correo',
              fuente.etiqueta,
            );
          }
        }

        resumen.porOrganizacion.push(conteo);
      }

      // El desglose por fuente es lo que permite revisar la migracion contra
      // cada base de origen, y no contra un total que no se sabe de donde sale.
      resumen.porFuente.push({
        etiqueta: fuente.etiqueta,
        cotizaciones: lineasPorFuente.cotizaciones,
        lineas: lineasPorFuente.lineas,
        omitidas: lineasPorFuente.omitidas,
      });
    }

    for (const [tabla, n] of Object.entries(informe.escritas)) {
      resumen.totalDestino[tabla] = n;
    }

    // Los conteos de lo que se pierde se arman al final, ya con TODAS las bases
    // leidas: durante el bucle todavia no se sabe si la siguiente fuente aporta
    // filas de la misma tabla.
    resumen.sinEquivalente = [...tablasPerdidas.entries()].map(([tabla, v]) => ({
      tabla,
      filas: v.filas,
      motivo: v.motivo,
      fuentes: v.fuentes,
    }));
    resumen.camposSinDestino = [...camposPerdidos.entries()].map(([campo, v]) => ({
      campo,
      documentos: v.documentos,
      motivo: v.motivo,
      fuentes: v.fuentes,
    }));
  });

  /**
   * Se EJECUTA la transaccion. Ojo: `sqlite.transaction(...)` solo la arma y la
   * devuelve; no la corre. Olvidar esta llamada deja la base vacia y el informe
   * dice "terminada" sin una sola fila escrita, que es el falso exito mas
   * peligroso que hay.
   */
  try {
    correr();
  } catch (e) {
    for (const r of readers) r.cerrar();
    destino.close();
    closeCoreDb();
    throw e instanceof ErrorMigracion
      ? e
      : new ErrorMigracion(
          `La migracion fallo y se revirtio. La base legacy no se toco.\n${
            e instanceof Error ? e.message : String(e)
          }`,
        );
  }

  // La tasa que mas se uso, ya con todos los documentos contados. La tasa 0
  // (documentos sin impuesto) NO entra: decir que la tasa mas usada es "0%" de un
  // documento que no tenia impuesto seria mezclar "no aplicaba" con "se cotizo al
  // 0%".
  const conTasa = [...conteoTasas.entries()]
    .filter(([bp]) => bp > 0)
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (conTasa.length > 0) {
    resumen.tasaMasUsada = { bp: conTasa[0][0], documentos: conTasa[0][1] };
  }

  // Si se leyo algo del legacy y no se escribio NI SE OMITIO nada, no fue una
  // migracion exitosa: fue una que no corrio. Se dice aca, con las dos manos.
  //
  // El caso "se leyó y no se escribió" si es normal: es la segunda pasada de una
  // base ya migrada, y ahi `omitidas` esta lleno. Por eso la condicion mira las dos
  // cosas juntas y no solo las escrituras.
  const leidas = Object.values(informe.leidas).reduce((a, b) => a + b, 0);
  const escritas = Object.values(informe.escritas).reduce((a, b) => a + b, 0);
  if (leidas > 0 && escritas === 0 && informe.omitidas === 0) {
    for (const r of readers) r.cerrar();
    destino.close();
    closeCoreDb();
    throw new ErrorMigracion(
      `Se leyeron ${leidas} filas del legacy y no se escribio ni se omito ninguna. ` +
        'Algo impidio que la migracion corriera.',
    );
  }

  return {
    informe,
    resumen,
    cerrar: () => {
      for (const r of readers) r.cerrar();
      destino.close();
      closeCoreDb();
    },
  };
}

// ──────────────────────────────────────────────────────────────────── CLI

/**
 * Fuentes por defecto: las dos bases legacy que este producto absorbe.
 *
 * Las dos tienen la tabla `documents` y las dos son OPCIONALES: los productos
 * legacy se consolidan y sus volumenes se conservan un tiempo sin uso, asi que un
 * checkout parcial sin una de ellas es normal. Si faltaran las dos, no hay nada
 * que migrar y la migracion lo dice en vez de crear una base vacia.
 */
export const FUENTES: FuenteLegacy[] = [
  { etiqueta: 'cotizaciones', ruta: '../../products/cotizaciones/data/app.db', opcional: true },
  { etiqueta: 'documentos', ruta: '../../products/documentos/data/app.db', opcional: true },
];

/**
 * Tabla del legacy -> tabla del destino.
 *
 * Sin este mapa el informe compararia "documents" contra lo que se escribio en
 * "quotes" y saldria cero, que parece una migracion vacia.
 */
const TABLAS: Record<string, string> = {
  documents: 'quotes',
  'documents.lines': 'quote_lines',
};

/**
 * El CLI solo corre si este archivo es el programa que se ejecuto.
 *
 * Sin este guard, IMPORTAR el modulo desde un test dispara la migracion entera
 * contra las bases legacy REALES y deja los datos en la base real del producto.
 * Es invisible: el test que importa pasa igual, y un rato despues aparece una base
 * con datos de clientes que nadie migro a proposito. Por eso la comparacion es
 * contra `process.argv[1]`, que dice que archivo se esta corriendo de verdad.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const bandera = (nombre: string): string | undefined => {
    const i = args.indexOf(`--${nombre}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const destinoPath = resolve(bandera('destino') ?? './data/cotizaciones.sqlite');

  /**
   * Una ruta pasada por linea de comandos deja de ser opcional.
   *
   * Las fuentes por defecto son opcionales porque el archivo puede no estar; una
   * ruta que alguien escribio a mano es una peticion explicita, y responder
   * "no estaba, lo saltee" a una peticion explicita seria esconder un error de
   * tipeo.
   */
  const fuentes: FuenteLegacy[] = FUENTES.map((f) => {
    const ruta = bandera(f.etiqueta);
    return ruta ? { etiqueta: f.etiqueta, ruta } : { ...f };
  });
  const extra = bandera('legacy');
  if (extra) fuentes[0] = { etiqueta: fuentes[0].etiqueta, ruta: extra };

  const overrides = new Map<string, string>();
  for (const par of (bandera('org') ?? '').split(',')) {
    const [tenantId, slug] = par.split('=');
    if (tenantId && slug) overrides.set(tenantId, slug);
  }

  try {
    const { informe, resumen, cerrar } = migrarLegacy({ destinoPath, fuentes, overrides });

    console.log('\nMigracion de cotizaciones terminada.\n');
    for (const o of informe.organizaciones) {
      console.log(`  ${o.legacyName} (${o.legacySlug}) -> ${o.organizationId}  (${o.accion})`);
    }

    if (resumen.fuentesSaltadas.length > 0) {
      console.log('\n  fuentes que NO se leyeron (no estaban en el disco):');
      for (const s of resumen.fuentesSaltadas) console.log(`    - ${s}`);
      console.log('  Si esperabas datos de ahi, la migracion esta incompleta.');
    }

    console.log('\n  por organizacion:');
    for (const c of resumen.porOrganizacion) {
      console.log(`    ${c.legacy}`);
      console.log(`      cotizaciones ${c.cotizaciones} | lineas ${c.lineas}`);
    }

    console.log('\n  por fuente:');
    for (const f of resumen.porFuente) {
      const detalle = f.omitidas > 0 ? ` (${f.cotizaciones} nuevas, ${f.omitidas} ya estaban)` : '';
      console.log(`    ${f.etiqueta}: ${f.cotizaciones} cotizaciones, ${f.lineas} lineas${detalle}`);
    }

    /**
     * Conteo tabla por tabla: cuantas filas traia el legacy y cuantas quedaron en
     * el destino.
     *
     * Se suman las omitidas a las escritas porque en una segunda pasada no se
     * escribe nada y todo estaba ya. Marcar eso como descuadre seria hacer sonar
     * una alarma en la corrida mas tranquila que existe.
     */
    console.log('\n  leidas del legacy -> presentes en el destino:');
    let descuadre = 0;
    for (const [legacy, destinoTabla] of Object.entries(TABLAS)) {
      const leidas = resumen.totalLegacy[legacy] ?? 0;
      if (leidas === 0) continue;
      const escritas = resumen.totalDestino[destinoTabla] ?? 0;
      const omitidas = resumen.omitidasPorTabla[destinoTabla] ?? 0;
      const total = escritas + omitidas;
      if (total !== leidas) descuadre += 1;
      const marca = total === leidas ? '' : '   <-- NO CUADRA';
      const detalle = omitidas > 0 ? ` (${escritas} nuevas, ${omitidas} ya estaban)` : '';
      console.log(`    ${legacy} -> ${destinoTabla}: ${leidas} -> ${total}${detalle}${marca}`);
    }
    if (descuadre > 0) {
      console.log(`\n  ${descuadre} tabla(s) no cuadran. No se de por buena esta migracion.`);
    }
    if (informe.omitidas > 0) console.log(`\n  ya estaban (omitidas): ${informe.omitidas}`);

    console.log('\n  el dinero:');
    for (const f of resumen.factores) {
      if (f.ambiguo) {
        console.log(
          `    ${f.etiqueta}: NO se pudo deducir el factor unidades -> centavos. ` +
            'Las lineas se copiaron sin convertir; los totales, tal cual.',
        );
      } else {
        console.log(
          `    ${f.etiqueta}: el precio de linea venia en unidades (factor ${f.factor} -> centavos), deducido de ${f.documentos} documento(s).`,
        );
      }
    }
    if (resumen.tasaMasUsada) {
      const { bp, documentos } = resumen.tasaMasUsada;
      console.log(
        `    tasa mas usada: ${bp / 100}% (${bp} puntos basicos) en ${documentos} documento(s). ` +
          'No se puso como tasa por defecto: esa preferencia se elige a mano en Ajustes.',
      );
    }
    for (const t of resumen.tasasAtipicas) console.log(`    tasa atipica: ${t}`);

    if (resumen.renumeraciones.length > 0) {
      console.log('\n  ATENCION: estos documentos NO pudieron conservar su folio:');
      for (const r of resumen.renumeraciones) {
        console.log(`    - ${r.documento}: "${r.folioLegacy}" -> ${r.folioNuevo}. ${r.motivo}`);
      }
      console.log('  El folio original quedo escrito en las notas de cada cotizacion.');
    }

    if (resumen.estadosDesconocidos.length > 0) {
      console.log('\n  Estados desconocidos, quedaron como `draft`:');
      for (const e of resumen.estadosDesconocidos) console.log(`    - ${e}`);
    }

    if (resumen.tiposLegacy.length > 0) {
      console.log('\n  que papel era cada documento (el `type` del legacy, que NO es el estado):');
      for (const t of resumen.tiposLegacy) console.log(`    - ${t.tipo}: ${t.documentos} documento(s)`);
    }

    if (resumen.snapshotsSinLeer.length > 0) {
      console.log('\n  Documentos cuyo snapshot de cliente no se pudo leer:');
      for (const s of resumen.snapshotsSinLeer) console.log(`    - ${s}`);
      console.log('  Entraron con un nombre de reemplazo, para que la cotizacion se pueda leer.');
    }

    if (resumen.lineasSinLeer.length > 0) {
      console.log('\n  Documentos cuyo detalle de lineas no se pudo leer:');
      for (const l of resumen.lineasSinLeer) console.log(`    - ${l}`);
      console.log('  Entraron sin lineas, con los totales que traia el legacy.');
    }

    if (resumen.camposSinDestino.length > 0) {
      console.log('\n  ATENCION: estos DATOS del legacy NO tienen destino en este producto:');
      for (const c of resumen.camposSinDestino) {
        console.log(`    - ${c.campo}: ${c.documentos} documento(s) de ${c.fuentes.join(' + ')}. ${c.motivo}.`);
      }
      console.log('  No se copiaron ni se tiraron: quedan solo en el legacy.');
    }

    if (resumen.sinEquivalente.length > 0) {
      console.log('\n  Estas TABLAS del legacy NO tienen destino en este producto:');
      for (const s of resumen.sinEquivalente) {
        console.log(`    - ${s.tabla}: ${s.filas} fila(s) de ${s.fuentes.join(' + ')}. ${s.motivo}.`);
      }
      console.log('  No se copiaron ni se tiraron: quedan solo en el legacy.');
    }

    if (informe.discrepancias.length > 0) {
      console.log('\n  Discrepancias de dinero:');
      for (const d of informe.discrepancias) {
        console.log(`    - ${d.donde}: ${d.unidades} unidad(es), ${d.centavos} centavos.`);
        console.log(`      ${d.motivo}.`);
      }
    }

    if (informe.autoresSinCore.length > 0) {
      console.log('\n  Los siguientes autores del legacy NO estan en el Core:');
      for (const a of informe.autoresSinCore) console.log(`    - ${a}`);
      console.log('  No se creo ningun usuario. Crealos en el Core si los necesitas.');
    }

    console.log(`\n  base destino: ${destinoPath}\n`);
    cerrar();
  } catch (e) {
    console.error('\nMIGRACION FALLIDA\n');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
