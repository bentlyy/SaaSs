import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { closeCoreDb } from '@amg/platform';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ErrorMigracion, migrarLegacy, type FuenteLegacy, type ResultadoMigracion } from '../src/migrate-legacy.js';
import { crearLegacy, type OpcionesFixture } from './legacy-fixture.js';

/**
 * La migracion de cotizaciones.
 *
 * Lo que se prueba aca no es que "corra": es que NO invente. El legacy traia
 * `documents` en DOS bases distintas con dos convenciones de dinero, folios de
 * TEXTO que se repiten entre bases, tipos de papel que no son estados y cuatro
 * tablas de otros productos. Cada una de esas rarezas tiene una respuesta
 * definida aca, y si alguien la cambia sin cambiar estos tests, los datos de un
 * cliente quedan mal en silencio.
 *
 * Las dos bases comparten el `tenants.id`, asi que caen en la MISMA organizacion
 * del Core. Es el caso de una empresa partida en dos productos viejos, y es el
 * unico caso en que hay que renumerar.
 */

let dir: string;
let rutaCotizaciones: string;
let rutaDocumentos: string;
let destinoPath: string;
let salida: ResultadoMigracion | null = null;

/** Crea las dos bases legacy de mentira, por defecto sin ninguna rareza. */
function legacy(extraCotizaciones: Partial<OpcionesFixture> = {}, extraDocumentos: Partial<OpcionesFixture> = {}) {
  crearLegacy(rutaCotizaciones, { etiqueta: 'cotizaciones', ...extraCotizaciones });
  crearLegacy(rutaDocumentos, { etiqueta: 'documentos', ...extraDocumentos });
  return dosFuentes();
}

/** Las dos fuentes, que es como corre la migracion de verdad. */
function dosFuentes(opcionales = false): FuenteLegacy[] {
  return [
    { etiqueta: 'cotizaciones', ruta: rutaCotizaciones, ...(opcionales ? { opcional: true } : {}) },
    { etiqueta: 'documentos', ruta: rutaDocumentos, ...(opcionales ? { opcional: true } : {}) },
  ];
}

/** Corre la migracion y la deja abierta para poder leer el destino. */
function migrar(fuentes: FuenteLegacy[] = dosFuentes()) {
  salida = migrarLegacy({ destinoPath, fuentes });
  return salida;
}

/**
 * Lee una tabla del destino y CIERRA la conexion.
 *
 * En Windows un handle de SQLite abierto impide borrar el archivo, asi que abrir
 * sin cerrar hace fallar el `afterEach` con EBUSY y el error del test real queda
 * tapado por un error de limpieza.
 */
function leerDestino(sql: string, ...params: unknown[]): any[] {
  const db = new Database(destinoPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as any[];
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amg-cotizaciones-mig-'));
  rutaCotizaciones = join(dir, 'legacy-cotizaciones.db');
  rutaDocumentos = join(dir, 'legacy-documentos.db');
  destinoPath = join(dir, 'cotizaciones.sqlite');
  legacy();
});

afterEach(() => {
  salida?.cerrar();
  salida = null;
  closeCoreDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Si algo quedo tomado, el sistema lo limpia solo: es una carpeta temporal.
  }
});

describe('las dos fuentes', () => {
  it('las dos bases caen en la MISMA organizacion del Core', () => {
    const { informe } = migrar();
    // El `tenants.id` es el mismo en las dos bases: es la forma que tiene una
    // empresa que se partio en dos productos viejos. La segunda pasada la
    // encuentra y las dos cotizaciones quedan juntas.
    expect(informe.organizaciones).toHaveLength(2);
    const ids = informe.organizaciones.map((o) => o.organizationId);
    expect(new Set(ids).size).toBe(1);
    expect(informe.organizaciones[0].accion).toBe('creada en el Core');
    expect(informe.organizaciones[1].accion).toBe('ya migrada');
  });

  it('trae las cotizaciones de las dos fuentes conservando los ids legacy', () => {
    const { informe } = migrar();
    expect(leerDestino('SELECT * FROM quotes')).toHaveLength(6);
    // El id legacy es la idempotencia: se conserva tal cual.
    for (const id of ['doc_cot_1', 'doc_cot_2', 'doc_cot_3', 'doc_doc_1', 'doc_doc_2', 'doc_doc_3']) {
      expect(leerDestino('SELECT id FROM quotes WHERE id = ?', id)).toHaveLength(1);
    }
    expect(informe.leidas.documents).toBe(6);
  });

  it('trae las lineas de las dos fuentes', () => {
    migrar();
    // 2 + 1 + 2 de la fuente de cotizaciones, 2 + 2 + 2 de la de documentos.
    expect(leerDestino('SELECT * FROM quote_lines')).toHaveLength(11);
    // Cada linea apunta a una cotizacion de SU organizacion.
    const huerfanas = leerDestino(
      'SELECT COUNT(*) n FROM quote_lines l LEFT JOIN quotes q ON q.id = l.quote_id WHERE q.id IS NULL',
    );
    expect(huerfanas[0].n).toBe(0);
  });

  it('una fuente que no esta se salta avisando, y la otra se migra igual', () => {
    rmSync(rutaDocumentos, { force: true });
    const { informe, resumen } = migrar(dosFuentes(true));
    // Un checkout parcial sin una de las bases es normal: se salta AVISANDO, no
    // en silencio, porque si alguien esperaba datos de ahi tiene que enterarse.
    expect(resumen.fuentesSaltadas).toHaveLength(1);
    expect(resumen.fuentesSaltadas[0]).toContain('documentos');
    expect(leerDestino('SELECT * FROM quotes')).toHaveLength(3);
    expect(informe.leidas.documents).toBe(3);
  });

  it('una fuente pedida a mano que no esta frena la migracion', () => {
    rmSync(rutaDocumentos, { force: true });
    // Las fuentes por defecto son opcionales porque el archivo puede no estar;
    // una ruta que alguien escribio es una peticion explicita, y responder "no
    // estaba, lo saltee" a eso seria esconder un error de tipeo.
    expect(() => migrar(dosFuentes(false))).toThrow(ErrorMigracion);
  });

  it('sin ninguna base legacy no se abre el destino', () => {
    expect(() =>
      migrar([
        { etiqueta: 'fantasma', ruta: join(dir, 'no-existe.db'), opcional: true },
        { etiqueta: 'otra', ruta: join(dir, 'tampoco.db'), opcional: true },
      ]),
    ).toThrow(/No se encontro ninguna base legacy/);
    // Y sobre todo: no se creo una base vacia diciendo que termino.
    expect(() => leerDestino('SELECT 1')).toThrow();
  });

  it('una base que no es legacy se rechaza nombrando lo que le falta', () => {
    const faux = join(dir, 'faux.db');
    new Database(faux).close();
    expect(() => migrar([{ etiqueta: 'faux', ruta: faux }])).toThrow(/no parece una base legacy/);
  });
});

describe('los folios', () => {
  it('renumera el folio que choca y deja el original escrito en las notas', () => {
    const { resumen } = migrar();
    // 'F-7' se deduce 7, que ya usa 'C-7' de la OTRA fuente en la misma
    // organizacion. Es la colision real del legacy: cada base numeraba por su
    // cuenta.
    const choque = resumen.renumeraciones.find((r) => r.documento === 'doc_doc_1');
    expect(choque).toBeDefined();
    expect(choque!.folioLegacy).toBe('F-7');
    // El folio libre es el maximo + 1: 7, 8 y 9 ya estaban.
    expect(choque!.folioNuevo).toBe(10);
    expect(choque!.motivo).toContain('ya lo usa otro documento');

    const fila = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_1')[0];
    expect(fila.number).toBe(10);
    // El folio del legacy queda escrito: es el numero que el cliente tiene
    // impreso, y sin esto nadie podria encontrar el papel.
    expect(fila.notes).toContain('F-7');
  });

  it('un folio con letras alrededor conserva el numero y anota el original', () => {
    migrar();
    // 'NV-3FW' se deduce 3, que esta libre: entra con el 3, y el texto del legacy
    // queda en las notas porque es lo que el cliente reconocia.
    const fila = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_3')[0];
    expect(fila.number).toBe(3);
    expect(fila.notes).toContain('NV-3FW');
  });

  it('un folio sin digitos entra con el siguiente libre y se reporta', () => {
    legacy({}, { folioSinDigitos: true });
    const { resumen } = migrar();
    // 'R-RE' no tiene ni un digito y el folio de este producto es un entero: 0 no
    // existe como folio. En el legacy REAL hay cinco asi ('C-OD', 'C-PI', 'C-QN',
    // 'R-RM', 'R-RE').
    const sinDigitos = resumen.renumeraciones.find((r) => r.documento === 'doc_doc_r');
    expect(sinDigitos).toBeDefined();
    expect(sinDigitos!.motivo).toContain('no es un numero');

    const fila = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_r')[0];
    // Cuando le toca, la base de cotizaciones ya dejo 7, 8, 9 y la de documentos
    // llevo el 7 al 10 y el 'C-11' al 11: el siguiente libre es 12.
    expect(fila.number).toBe(12);
    expect(fila.notes).toContain('R-RE');
  });

  it('el folio es unico por organizacion y nunca se repite', () => {
    migrar();
    const numeros = leerDestino('SELECT number FROM quotes').map((f) => f.number);
    expect(new Set(numeros).size).toBe(numeros.length);
    expect(numeros.sort((a, b) => a - b)).toEqual([3, 7, 8, 9, 10, 11]);
  });

  it('el folio siguiente que propone la API es el maximo migrado mas uno', () => {
    migrar();
    const numeros = leerDestino('SELECT number FROM quotes').map((f) => f.number);
    // El maximo quedo en 11, no en 10: si la migracion hubiera usado el maximo
    // de una sola base, la primera cotizacion nueva de la otra habria chocado
    // contra el indice unico (organization_id, number).
    expect(Math.max(...numeros)).toBe(11);
  });
});

describe('los estados y los tipos', () => {
  it('el estado sale de `documents.status`, no de `documents.type`', () => {
    migrar();
    // La fuente de documentos trae `factura` y `nota_venta`, y este producto es
    // de cotizaciones. Copiar el `type` al estado produciria cotizaciones en
    // estado "factura", que no existe.
    const factura = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_1')[0];
    expect(factura.status).toBe('sent');
    const nota = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_3')[0];
    expect(nota.status).toBe('accepted');
  });

  it('reporta que papel era cada documento, sin copiarlo a la cotizacion', () => {
    const { resumen } = migrar();
    // El `type` no tiene destino, pero se cuenta: saber que la mitad de lo que
    // hay aca eran facturas es informacion del negocio.
    const tipos = Object.fromEntries(resumen.tiposLegacy.map((t) => [t.tipo, t.documentos]));
    expect(tipos.cotizacion).toBe(3);
    expect(tipos.recibo).toBe(1);
    expect(tipos.factura).toBe(1);
    expect(tipos.nota_venta).toBe(1);

    const comoCampo = resumen.camposSinDestino.find((c) => c.campo === 'documents.type');
    expect(comoCampo).toBeDefined();
    // 3 de cotizaciones + 3 de documentos: el conteo va agregado, y dice de
    // donde salio. Dos entradas iguales habrian exigido adivinar cualmandaba.
    expect(comoCampo!.documentos).toBe(6);
    expect(comoCampo!.fuentes).toEqual(['cotizaciones', 'documentos']);
    expect(comoCampo!.motivo).toContain('no en que estado');
  });

  it('un estado desconocido se migra como draft y se reporta', () => {
    legacy({ estadosRaros: true });
    const { resumen } = migrar();
    const fila = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_3')[0];
    // No se tira la fila: perder una cotizacion por un texto de estado es peor
    // que dejarla sin confirmar.
    expect(fila.status).toBe('draft');
    expect(resumen.estadosDesconocidos.join(' ')).toContain('hold');
  });

  it('preserva los estados que el destino si conoce', () => {
    migrar();
    const estados = leerDestino('SELECT DISTINCT status FROM quotes ORDER BY status').map((f) => f.status);
    // El 'draft' de la base de cotizaciones llega como 'sent'/'accepted' en la de
    // documentos: en la tabla base no hay ninguno en borrador.
    expect(estados).toEqual(['accepted', 'sent']);
  });
});

describe('el dinero', () => {
  it('deduce el factor 100 de cada fuente, sin multiplicar a ciegas', () => {
    const { resumen } = migrar();
    // En las dos bases reales el `price` de la linea viene en UNIDADES y el
    // `subtotal` en CENTAVOS: el factor es 100.
    expect(resumen.factores).toHaveLength(2);
    for (const f of resumen.factores) {
      expect(f.ambiguo, `la fuente ${f.etiqueta} quedo ambigua`).toBe(false);
      expect(f.factor).toBe(100);
      expect(f.documentos).toBe(3);
    }
  });

  it('convierte el precio de linea a centavos y el importe de linea cuadra', () => {
    migrar();
    // 'Catering por persona' 40 x 320 unidades = 12800 unidades = 1280000 centavos.
    const linea = leerDestino(
      'SELECT * FROM quote_lines WHERE quote_id = ? AND position = 2',
      'doc_cot_1',
    )[0];
    expect(linea.description).toBe('Manual de marca');
    expect(linea.unit_price_cents).toBe(650000);
    expect(linea.line_total_cents).toBe(650000);

    const conCantidad = leerDestino(
      'SELECT * FROM quote_lines WHERE quote_id = ? AND position = 2',
      'doc_doc_2',
    )[0];
    expect(conCantidad.unit_price_cents).toBe(32000);
    expect(conCantidad.line_total_cents).toBe(20 * 32000);
  });

  it('copia los totales del legacy tal cual, sin recalcularlos', () => {
    migrar();
    // El subtotal del legacy es AUTORITATIVO: es el numero que dice el papel que
    // se emitio. Si alguien lo recalculara, una cotizacion con un redondeo raro
    // del legacy cambiaria de monto.
    const c = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_1')[0];
    expect(c.subtotal_cents).toBe(1_130_000);
    expect(c.tax_cents).toBe(180_800);
    expect(c.total_cents).toBe(1_310_800);
  });

  it('deduce el factor POR FUENTE: 100 en una y 1 en la otra', () => {
    legacy({}, { preciosEnCentavos: true });
    const { resumen } = migrar();
    // Cada base legacy tiene su propia convencion, y es justo el caso que el
    // runtime documenta. Un factor promedio de las dos no significaria nada, y
    // aplicarle 100 a la que ya venia en centavos multiplicaria por 100 precios
    // que estaban bien.
    const porFuente = Object.fromEntries(resumen.factores.map((f) => [f.etiqueta, f.factor]));
    expect(porFuente.cotizaciones).toBe(100);
    expect(porFuente.documentos).toBe(1);

    // La fuente en centavos queda igual, y la de unidades sigue multiplicada.
    const enCentavos = leerDestino('SELECT * FROM quote_lines WHERE quote_id = ? AND position = 1', 'doc_doc_1')[0];
    expect(enCentavos.unit_price_cents).toBe(800);
    const enUnidades = leerDestino('SELECT * FROM quote_lines WHERE quote_id = ? AND position = 1', 'doc_cot_1')[0];
    expect(enUnidades.unit_price_cents).toBe(480_000);
  });

  it('una fuente con una sola muestra no se convierte: no hay con que contrastar', () => {
    // Con una sola muestra, `detectarFactor` no puede confirmar nada. Devolver
    // 100 "porque encaja" seria fabricar una conversion con apariencia de dato
    // medido.
    legacy();
    crearLegacy(rutaDocumentos, { etiqueta: 'documentos', unSoloDocumento: true });
    const { resumen, informe } = migrar();

    const factorDocumentos = resumen.factores.find((f) => f.etiqueta === 'documentos');
    expect(factorDocumentos).toBeDefined();
    expect(factorDocumentos!.documentos).toBe(1);
    expect(factorDocumentos!.ambiguo).toBe(true);
    // La otra fuente si tiene con que deducir, y eso no la ensucia: cada base se
    // deduce por separado.
    expect(resumen.factores.find((f) => f.etiqueta === 'cotizaciones')!.ambiguo).toBe(false);
    // El precio se copia tal cual, SIN multiplicar, y queda ANOTADO: el informe
    // dice que esa fuente quedo sin convertir, para que nadie lea el numero como
    // si estuviera en centavos.
    const linea = leerDestino('SELECT * FROM quote_lines WHERE quote_id = ? AND position = 1', 'doc_doc_1')[0];
    expect(linea.unit_price_cents).toBe(800);
    const laDiscrepancia = informe.discrepancias.find((d) => d.donde.includes('fuente documentos'));
    expect(laDiscrepancia).toBeDefined();
    expect(laDiscrepancia!.motivo).toContain('SIN convertir');
    // Y el total del documento se respeta TAL CUAL: es autoritativo y no depende
    // de la conversion. 4400 unidades x 100 = 440000, que es lo que el legacy
    // guardaba; si se hubiera vuelto a multiplicar por el factor ambiguo,
    // quedaria en 44.000.000.
    expect(leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_1')[0].subtotal_cents).toBe(440_000);
  });

  it('deduce la tasa de impuesto del par (subtotal, tax)', () => {
    migrar();
    // 180800 / 1130000 = 16% exacto.
    expect(leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_1')[0].tax_rate_bp).toBe(1600);
    // Y sin impuesto, la tasa es 0: no se supone una preferencia que nadie guardo.
    expect(leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_2')[0].tax_rate_bp).toBe(0);
  });

  it('la tasa mas usada es la que mas se aplico, no la ultima que aparecio', () => {
    const { resumen } = migrar();
    // 16% en 3 documentos y 0% en 3. Un contador mal hecho devolveria "la
    // ultima", que seria otra cosa.
    expect(resumen.tasaMasUsada).toEqual({ bp: 1600, documentos: 3 });
  });

  it('no pone la tasa mas usada como tasa por defecto', () => {
    migrar();
    // Suponer cual era la preferencia del negocio seria inventar. El legacy no
    // guardaba una tasa por defecto: solo se puede suponer mirando la pantalla
    // de ajustes, y eso es de una persona.
    const prefs = leerDestino('SELECT * FROM settings')[0];
    expect(prefs.default_tax_rate_bp).toBe(0);
  });

  it('reporta una tasa que no es un porcentaje entero', () => {
    const ruta = join(dir, 'raro.db');
    crearLegacy(ruta, { etiqueta: 'documentos' });
    const db = new Database(ruta);
    // 1000 de subtotal con 333 de impuesto: 33.3%, que no es un porcentaje
    // entero. Se copia la fraccion exacta y se dice, en vez de redondear hacia
    // un "33% probable".
    db.prepare('UPDATE documents SET subtotal = 1000, tax = 333, total = 1333 WHERE id = ?').run('doc_doc_2');
    db.close();

    const { resumen } = migrar([{ etiqueta: 'documentos', ruta }]);
    expect(resumen.tasasAtipicas.join(' ')).toContain('3330');
  });
});

describe('el cliente', () => {
  it('copia el nombre del snapshot para que la cotizacion se lea sola', () => {
    migrar();
    // El cliente es del producto `clientes`, que es otra base. Sin la foto del
    // nombre, una cotizacion migrada seria una fila que no se puede leer.
    const c = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_1')[0];
    expect(c.customer_name).toBe('Laura Mendez');
    expect(c.customer_email).toBe('laura@example.com');
    // El id queda como referencia suelta, SIN llave foranea: los clientes viven
    // en otra base y SQLite no valida referencias entre bases.
    expect(c.customer_id).toBe('cli_1');
  });

  it('deja el correo en NULL cuando el legacy no traia uno', () => {
    migrar();
    expect(leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_3')[0].customer_email).toBeNull();
  });

  it('un snapshot ilegible entra con un nombre de reemplazo y se reporta', () => {
    legacy({}, { snapshotRoto: true });
    const { resumen } = migrar();
    // `customer_name` es NOT NULL porque la cotizacion tiene que poder leerse
    // sola. Perder la linea entera seria peor que perder el nombre.
    const fila = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_sin_snapshot')[0];
    expect(fila.customer_name).toContain('Cliente sin nombre');
    expect(resumen.snapshotsSinLeer.join(' ')).toContain('doc_doc_sin_snapshot');
  });

  it('reporta el telefono del snapshot como dato sin destino', () => {
    const { resumen } = migrar();
    const tel = resumen.camposSinDestino.find((c) => c.campo === 'documents.customer_snapshot.phone');
    expect(tel).toBeDefined();
    // Los 6 documentos de las dos bases traian telefono en el snapshot.
    expect(tel!.documentos).toBe(6);
    expect(tel!.fuentes).toEqual(['cotizaciones', 'documentos']);
    expect(tel!.motivo).toContain('clientes');
  });

  it('no copia la tabla de clientes: es de otro producto', () => {
    const { resumen } = migrar();
    const clientes = resumen.sinEquivalente.find((s) => s.tabla === 'customers');
    expect(clientes).toBeDefined();
    // 5 en cada base, agregado: 10.
    expect(clientes!.filas).toBe(10);
    expect(clientes!.fuentes).toEqual(['cotizaciones', 'documentos']);
    // Y no existe en el destino: es de `clientes`.
    expect(leerDestino("SELECT name FROM sqlite_master WHERE name = 'customers'")).toHaveLength(0);
  });

  it('una base sin tabla de clientes migra igual', () => {
    legacy({}, { sinTablaClientes: true });
    const { resumen } = migrar();
    // El `tiene` evita que contar una tabla inexistente tire la migracion entera
    // por algo que no importa: la tabla no aparece en el conteo de ESE origen...
    const clientes = resumen.sinEquivalente.find((s) => s.tabla === 'customers');
    expect(clientes!.fuentes).toEqual(['cotizaciones']);
    // ...y las cotizaciones de las dos bases entran igual.
    expect(leerDestino('SELECT * FROM quotes')).toHaveLength(6);
  });
});

describe('lo que el legacy no tiene', () => {
  it('las fechas de vigencia y de gestion quedan en NULL, no inventadas', () => {
    migrar();
    const c = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_cot_1')[0];
    // El legacy guardaba UNA sola fecha. Ponerle la de creacion a `valid_until` o
    // a `accepted_at` seria inventar cuando se negocio cada cotizacion.
    expect(c.valid_until).toBeNull();
    expect(c.sent_at).toBeNull();
    expect(c.accepted_at).toBeNull();
    expect(c.issue_date).toBe('2026-09-19');
  });

  it('un detalle de lineas ilegible entra con los totales que traia y se reporta', () => {
    legacy({}, { lineasRotas: true });
    const { resumen, informe } = migrar();
    const fila = leerDestino('SELECT * FROM quotes WHERE id = ?', 'doc_doc_sin_lineas')[0];
    // Los totales son autoritativos y no dependen del detalle.
    expect(fila.total_cents).toBe(0);
    expect(leerDestino('SELECT * FROM quote_lines WHERE quote_id = ?', 'doc_doc_sin_lineas')).toHaveLength(0);
    expect(resumen.lineasSinLeer.join(' ')).toContain('doc_doc_sin_lineas');
    expect(informe.escritas.quotes).toBe(7);
  });

  it('cuenta y reporta las tablas de los otros productos, sin copiarlas', () => {
    const { resumen } = migrar();
    const porTabla = Object.fromEntries(resumen.sinEquivalente.map((s) => [s.tabla, s.filas]));
    // El fixture deja una fila de cada una en CADA base, y el conteo va
    // agregado: 2, no 1. Se cuentan y se dicen: un dato del legacy que no tiene
    // destino es una decision, y una decision que no se escribe es una que
    // alguien va a volver a tomar sin saber que paso.
    expect(porTabla.appointments).toBe(2);
    expect(porTabla.work_orders).toBe(2);
    expect(porTabla.inventory_items).toBe(2);
    expect(porTabla.followups).toBe(2);
    // Y el conteo dice de que bases salio, que es lo que hace falta para ir a
    // buscarlas si el numero no cuadra con el legacy.
    const citas = resumen.sinEquivalente.find((s) => s.tabla === 'appointments');
    expect(citas!.fuentes).toEqual(['cotizaciones', 'documentos']);

    // Y no existe ninguna en el destino.
    for (const t of ['appointments', 'work_orders', 'inventory_items', 'followups', 'users', 'tenants']) {
      expect(leerDestino('SELECT name FROM sqlite_master WHERE name = ?', t)).toHaveLength(0);
    }
  });

  it('no copia la tabla de usuarios ni la de tenants', () => {
    legacy({ autoresDesconocidos: true });
    const { informe } = migrar();
    expect(leerDestino("SELECT name FROM sqlite_master WHERE name = 'users'")).toHaveLength(0);
    expect(leerDestino("SELECT name FROM sqlite_master WHERE name = 'tenants'")).toHaveLength(0);
    // Y ningun autor se inventa.
    expect(informe.autoresSinCore.join(' ')).toContain('Ana Legacy');
  });
});

describe('idempotencia y el mapa legacy', () => {
  it('la segunda pasada no duplica nada', () => {
    migrar();
    const primera = {
      cotizaciones: leerDestino('SELECT * FROM quotes').length,
      lineas: leerDestino('SELECT * FROM quote_lines').length,
    };

    const segunda = migrar();
    expect(leerDestino('SELECT * FROM quotes')).toHaveLength(primera.cotizaciones);
    expect(leerDestino('SELECT * FROM quote_lines')).toHaveLength(primera.lineas);
    // El informe lo dice, para que "no escribi nada" no se lea como "no migro".
    expect(segunda.informe.omitidas).toBe(6);
    expect(segunda.informe.escritas.quotes).toBeUndefined();
  });

  it('la segunda pasada no vuelve a crear organizaciones', () => {
    migrar();
    const { informe } = migrar();
    for (const o of informe.organizaciones) {
      expect(o.accion).toBe('ya migrada');
    }
  });

  it('no renumera nada en la segunda pasada', () => {
    migrar();
    const segunda = migrar();
    // Las renumeraciones son de la primera pasada: los documentos que ya estaban
    // no se vuelven a numerar, y reportar uno en la segunda seria mentira.
    expect(segunda.resumen.renumeraciones).toHaveLength(0);
  });

  it('el mapa legacy -> organizacion queda escrito con una fila por tenant', () => {
    migrar();
    const mapa = leerDestino('SELECT * FROM legacy_tenant_map');
    // Un solo tenant en las dos bases: un mapa, no dos.
    expect(mapa).toHaveLength(1);
    expect(mapa[0].legacy_tenant_id).toBe('ten_principal');
    expect(mapa[0].organization_id).toBe(leerDestino('SELECT organization_id FROM quotes LIMIT 1')[0].organization_id);
  });

  it('las preferencias de cada organizacion quedan escritas una vez', () => {
    migrar();
    // Las dos bases comparten tenant, asi que hay UNA fila de preferencias, no
    // dos compitiendo por el indice unico.
    expect(leerDestino('SELECT * FROM settings')).toHaveLength(1);
    const prefs = leerDestino('SELECT * FROM settings')[0];
    expect(prefs.currency).toBe('$');
    // La zona viene del tenant legacy: es un dato guardado, no una preferencia
    // inventada.
    expect(prefs.timezone).toBe('America/Mexico_City');
  });

  it('todas las filas migradas quedan en la organizacion del mapa', () => {
    migrar();
    const org = leerDestino('SELECT organization_id FROM legacy_tenant_map')[0].organization_id;
    for (const tabla of ['quotes', 'quote_lines', 'settings']) {
      const otras = leerDestino(`SELECT COUNT(*) n FROM ${tabla} WHERE organization_id <> ?`, org);
      expect(otras[0].n, `${tabla} tiene filas de otra organizacion`).toBe(0);
    }
  });
});
