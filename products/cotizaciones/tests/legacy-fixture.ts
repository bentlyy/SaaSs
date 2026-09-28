import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

/**
 * Dos bases legacy de documentos de mentira, con las rarezas del legacy REAL.
 *
 * Aca NO hay un fixture, hay DOS, y es a proposito. La migracion de este producto
 * no es "una base vieja -> un producto": es DOS bases viejas -> un producto, y las
 * dos guardan la misma tabla `documents`:
 *
 *   products/cotizaciones/data/app.db -> Cotizaciones JM
 *   products/documentos/data/app.db    -> DocuPro Studio
 *
 * Las dos usan el MISMO `tenants.id` en el fixture, que es la forma de probar el
 * caso dificil: una empresa que se partio en dos productos viejos. Las dos caen en
 * la misma organizacion del Core, y por eso sus folios chocar entre si. Con dos
 * `tenants.id` distintos el migrador nunca tendria que renumerar nada, y el
 * ejercicio de la renumeracion no se probaria nunca.
 *
 * Los folios y las rarezas salen de mirar las bases de verdad, porque un fixture
 * liso y bonito probaria un migrador que se rompe con la primera fila real:
 *
 *   - `documents.number` es TEXTO y el folio de este producto es un ENTERO unico
 *     por organizacion. En el legacy de verdad conviven 'C-N8' (-> 8), 'F-1BB'
 *     (-> 1), 'C-OD' (cero digitos), 'NV-1FW' (-> 1) y 'C-18K' (-> 18). Los dos
 *     documentos que se deducen a 1 son la colision real, no un caso inventado.
 *   - `documents.subtotal`, `tax` y `total` estan en CENTAVOS y son
 *     AUTORITATIVOS, y el `price` de cada linea esta en UNIDADES: en el legacy
 *     real el factor es 100 en las dos bases. La opcion `preciosEnCentavos` pone
 *     una fuente en la convencion del otro tipo de legacy, que es justo lo que
 *     obliga a deducir el factor FUENTE POR FUENTE.
 *   - `documents.type` (cotizacion, factura, recibo, nota_venta) NO es un estado.
 *     El legacy trae facturas y notas de venta, y este producto es de
 *     cotizaciones: copiar el `type` al estado produciria cotizaciones en estado
 *     "factura".
 *   - El legacy guarda una tabla `customers` que NO es de este producto (la
 *     absorbio `clientes`), y junto a ella once tablas mas de los otros productos.
 *     Se cuentan y se reportan; no se copian.
 *   - `customer_snapshot` y `lines` son JSON en columnas TEXT, y un JSON roto es
 *     una fila que el migrador tiene que poder leer igual y reportar.
 */

/** Id de tenant que comparten las dos bases: es lo que hace chocar los folios. */
export const TENANT_COMPARTIDO = 'ten_principal';

/**
 * Las tablas que este producto NO se lleva, con el mismo esquema que el legacy
 * real, para que el migrador las cuente de verdad y no de memoria.
 */
export const DDL = `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, product TEXT,
  currency TEXT, timezone TEXT, reminder_hours INTEGER, email_enabled INTEGER,
  address TEXT, phone TEXT, whatsapp_webhook TEXT, whatsapp_token TEXT, created_at TEXT
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT,
  name TEXT NOT NULL, role TEXT, active INTEGER, created_at TEXT
);
CREATE TABLE customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  birthdate TEXT, notes TEXT, tags TEXT, created_at TEXT NOT NULL
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'cotizacion',
  number TEXT NOT NULL,
  customer_id TEXT@FK_CLIENTES@,
  customer_snapshot TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Cotizacion',
  lines TEXT NOT NULL,
  subtotal INTEGER NOT NULL DEFAULT 0,
  tax INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL
);
CREATE TABLE appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT, service_id TEXT,
  staff_id TEXT, start_at TEXT NOT NULL, end_at TEXT, status TEXT, notes TEXT, created_at TEXT NOT NULL
);
CREATE TABLE appointment_services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
  service_id TEXT NOT NULL, price_at INTEGER NOT NULL
);
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, number INTEGER NOT NULL, customer_id TEXT NOT NULL,
  staff_id TEXT, vehicle_make TEXT, vehicle_plate TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE work_order_services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL,
  service_id TEXT NOT NULL, price_at INTEGER NOT NULL
);
CREATE TABLE work_order_parts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price_at INTEGER NOT NULL
);
CREATE TABLE resources (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER, active INTEGER, created_at TEXT NOT NULL);
CREATE TABLE staff (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT, color TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE staff_services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, service_id TEXT NOT NULL, price_at INTEGER NOT NULL);
CREATE TABLE services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, duration_min INTEGER NOT NULL, price INTEGER NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE followups (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT, channel TEXT, body TEXT, due_at TEXT, status TEXT, created_at TEXT NOT NULL);
CREATE TABLE reminder_logs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT, channel TEXT, sent_at TEXT, status TEXT, error TEXT);
CREATE TABLE inventory_items (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sku TEXT, quantity INTEGER NOT NULL, min_qty INTEGER NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE inventory_movements (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, delta INTEGER NOT NULL, reason TEXT NOT NULL, user_id TEXT, created_at TEXT NOT NULL);
`;

export interface OpcionesFixture {
  /** Etiqueta de la base, solo para el informe: 'cotizaciones' o 'documentos'. */
  etiqueta: string;
  /** Slug del tenant. Por defecto el mismo en las dos bases. */
  slug?: string;
  /**
   * Precios de linea YA en centavos, que es la convencion de los legacy de crm y
   * recordatorios. El migrador tiene que deducir el factor 1 en esta fuente y el
   * 100 en la otra, no un promedio de las dos.
   */
  preciosEnCentavos?: boolean;
  /** `documents.status` con un valor que el destino no conoce. */
  estadosRaros?: boolean;
  /** Un documento cuyo `number` no tiene ni un digito ('R-RE'). */
  folioSinDigitos?: boolean;
  /** Un documento con `customer_snapshot` que no es un JSON. */
  snapshotRoto?: boolean;
  /** Un documento con `lines` que no es un JSON. */
  lineasRotas?: boolean;
  /** Un autor del legacy que no esta en el Core. */
  autoresDesconocidos?: boolean;
  /** Quitar la tabla `customers`, que es de otro producto. */
  sinTablaClientes?: boolean;
  /** Sin documentos: la base existe pero no trae nada que migrar. */
  sinDocumentos?: boolean;
  /**
   * Un solo documento en la base.
   *
   * Es el caso en que NO se puede deducir el factor unidades -> centavos: hace
   * falta una segunda muestra que confirme la primera. Devolver 100 "porque
   * encaja" seria fabricar una conversion con apariencia de dato medido.
   */
  unSoloDocumento?: boolean;
}

interface Documento {
  id: string;
  tipo: string;
  folio: string;
  cliente: string;
  snapshot: unknown;
  titulo: string;
  lineas: unknown;
  subtotalUnidades: number;
  taxBp: number;
  estado: string;
  creado: string;
}

/**
 * Los documentos de una base.
 *
 * Los importes se calculan ACA, desde las lineas, para que el fixture no pueda
 * mentir por descuido: el `subtotal` se arma multiplicando las unidades por el
 * factor de la fuente y el impuesto sale de la tasa. Si el migrador copiara mal
 * una linea, la suma de las lineas migradas no daria con el total migrado, y el
 * test lo veria.
 */
function documentosDe(opciones: OpcionesFixture): Documento[] {
  const { etiqueta, preciosEnCentavos, estadosRaros, folioSinDigitos, snapshotRoto, lineasRotas } =
    opciones;

  // En el legacy real los precios de linea vienen en UNIDADES y los totales en
  // CENTAVOS: el factor es 100. Con `preciosEnCentavos` el factor es 1.
  const factor = preciosEnCentavos ? 1 : 100;
  const lineas = (...l: Array<[string, number, number]>) =>
    JSON.stringify(l.map(([description, qty, price]) => ({ description, qty, price })));
  const unidades = (...l: Array<[string, number, number]>) =>
    l.reduce((acc, [, qty, price]) => acc + qty * price, 0);

  if (etiqueta === 'cotizaciones') {
    return [
      {
        id: 'doc_cot_1',
        tipo: 'cotizacion',
        folio: 'C-7',
        cliente: 'cli_1',
        snapshot: { name: 'Laura Mendez', phone: '+52 55 5555 2001', email: 'laura@example.com' },
        titulo: 'Diseno de identidad',
        lineas: lineas(['Logo y tarjetas', 1, 4800], ['Manual de marca', 1, 6500]),
        subtotalUnidades: unidades(['Logo y tarjetas', 1, 4800], ['Manual de marca', 1, 6500]),
        taxBp: 1600,
        estado: 'accepted',
        creado: '2026-09-19T16:45:32.355Z',
      },
      {
        // Tipo `recibo` y NO tipo `cotizacion`: el `type` del legacy dice que papel
        // se emitio, no en que estado esta. Su estado es `accepted`, y eso es lo
        // que tiene que quedar en la cotizacion.
        id: 'doc_cot_2',
        tipo: 'recibo',
        folio: 'C-8',
        cliente: 'cli_1',
        snapshot: { name: 'Laura Mendez', phone: '+52 55 5555 2001', email: 'laura@example.com' },
        titulo: 'Abono a cuenta',
        lineas: lineas(['Membresia anual', 1, 2400]),
        subtotalUnidades: unidades(['Membresia anual', 1, 2400]),
        taxBp: 0,
        estado: 'accepted',
        creado: '2026-09-23T13:45:32.357Z',
      },
      {
        id: 'doc_cot_3',
        tipo: 'cotizacion',
        folio: 'C-9',
        cliente: 'cli_2',
        snapshot: { name: 'Renata Salgado', phone: '+52 55 5555 2003', email: '' },
        titulo: 'Mantenimiento preventivo',
        lineas: lineas(['Revision general', 1, 600], ['Cambio de filtros', 4, 180]),
        subtotalUnidades: unidades(['Revision general', 1, 600], ['Cambio de filtros', 4, 180]),
        taxBp: 0,
        // El legacy cobro este estado en una cotizacion real. No se tira la fila:
        // entra como `draft` y el informe lo dice.
        estado: estadosRaros ? 'hold' : 'sent',
        creado: '2026-09-21T16:45:32.356Z',
      },
    ];
  }

  const documentos: Documento[] = [
    {
      // El folio 'F-7' se deduce 7, que YA lo usa `doc_cot_1` de la otra fuente
      // en la MISMA organizacion. Es la colision real: el legacy repetia numeros
      // porque cada base numeraba por su cuenta.
      id: 'doc_doc_1',
      tipo: 'factura',
      folio: 'F-7',
      cliente: 'cli_3',
      snapshot: { name: 'Constructora Fenix', phone: '+52 55 4444 3001', email: 'finanzas@fenix.mx' },
      titulo: 'Factura',
      lineas: lineas(['Consultoria por hora', 4, 800], ['Constancia mensual', 1, 1200]),
      subtotalUnidades: unidades(['Consultoria por hora', 4, 800], ['Constancia mensual', 1, 1200]),
      taxBp: 1600,
      estado: 'sent',
      creado: '2026-09-19T22:53:12.393Z',
    },
    {
      id: 'doc_doc_2',
      tipo: 'cotizacion',
      folio: 'C-11',
      cliente: 'cli_4',
      snapshot: { name: 'Imprenta Rivera', phone: '+52 55 4444 3005', email: 'pedidos@rivera.mx' },
      titulo: 'Campana impresos',
      lineas: lineas(['Sesion fotografica', 1, 3500], ['Impresion carteles', 20, 320]),
      subtotalUnidades: unidades(['Sesion fotografica', 1, 3500], ['Impresion carteles', 20, 320]),
      taxBp: 1600,
      estado: 'sent',
      creado: '2026-09-22T16:53:12.394Z',
    },
    {
      // `NV-3FW` se deduce 3 y no choca con nada. Y el `type` es `nota_venta`: este
      // producto no la conoce, asi que lo que tiene que quedar en la fila es el
      // `status` (`accepted`), no el tipo.
      id: 'doc_doc_3',
      tipo: 'nota_venta',
      folio: 'NV-3FW',
      cliente: 'cli_5',
      snapshot: { name: 'Textiles del Centro', phone: '+52 55 4444 3003', email: 'compras@textiles.mx' },
      titulo: 'Nota de venta',
      lineas: lineas(['Vinil de corte por m2', 12, 260], ['Impresion carteles', 6, 320]),
      subtotalUnidades: unidades(['Vinil de corte por m2', 12, 260], ['Impresion carteles', 6, 320]),
      taxBp: 0,
      estado: 'accepted',
      creado: '2026-09-22T00:53:12.394Z',
    },
  ];

  if (folioSinDigitos) {
    // 'R-RE' no tiene ni un digito: el folio de este producto es un entero y 0 no
    // existe como folio, asi que el documento entra con el siguiente libre y el
    // informe lo dice. En el legacy REAL hay cuatro folios asi ('C-OD', 'C-PI',
    // 'C-QN', 'R-RM', 'R-RE').
    documentos.push({
      id: 'doc_doc_r',
      tipo: 'recibo',
      folio: 'R-RE',
      cliente: 'cli_5',
      snapshot: { name: 'Patricia Leon', phone: '+52 55 5555 2005', email: 'paty@example.com' },
      titulo: 'Recibo',
      lineas: lineas(['Membresia mensual', 1, 5000]),
      subtotalUnidades: unidades(['Membresia mensual', 1, 5000]),
      taxBp: 0,
      estado: 'accepted',
      creado: '2026-09-23T10:53:12.394Z',
    });
  }

  if (snapshotRoto) {
    // `customer_snapshot` es TEXT y el legacy escribia el JSON a mano: hay filas
    // donde no es un JSON. El nombre del cliente es NOT NULL en el destino (la
    // cotizacion tiene que poder leerse sola), asi que la fila entra con un
    // reemplazo explicito y queda reportada. Perder la linea es peor que perder el
    // nombre.
    documentos.push({
      id: 'doc_doc_sin_snapshot',
      tipo: 'cotizacion',
      folio: 'C-12',
      cliente: 'cli_3',
      snapshot: 'Ana Torres',
      titulo: 'Cotizacion sin snapshot legible',
      lineas: lineas(['Revision', 1, 1000]),
      subtotalUnidades: unidades(['Revision', 1, 1000]),
      taxBp: 0,
      estado: 'draft',
      creado: '2026-09-24T10:00:00.000Z',
    });
  }

  if (lineasRotas) {
    // `lines` que no es un JSON: la cotizacion entra con los totales que traia
    // el legacy (que son autoritativos) y sin lineas, y el informe lo dice.
    documentos.push({
      id: 'doc_doc_sin_lineas',
      tipo: 'cotizacion',
      folio: 'C-13',
      cliente: 'cli_4',
      snapshot: { name: 'Dra. Lucia Ramos', phone: '', email: '' },
      titulo: 'Cotizacion sin detalle legible',
      lineas: 'LINEA_UNA,1000',
      subtotalUnidades: 0,
      taxBp: 0,
      estado: 'draft',
      creado: '2026-09-24T11:00:00.000Z',
    });
  }

  return documentos;
}

export function crearLegacy(path: string, opciones: OpcionesFixture): void {
  const {
    etiqueta,
    slug = 'demo-cotizaciones',
    estadosRaros = false,
    autoresDesconocidos = false,
    sinTablaClientes = false,
    sinDocumentos = false,
    unSoloDocumento = false,
  } = opciones;

  // Se borra antes de crear: varios tests piden la base con variantes distintas
  // sobre el mismo archivo, y sin esto el segundo `CREATE TABLE` revienta con
  // "table tenants already exists".
  rmSync(path, { force: true });

  const db = new Database(path);
  // Sin la tabla `customers`, la columna `customer_id` se declara SIN llave
  // foranea: SQLite resuelve la tabla padre al PREPARAR la sentencia, asi que
  // una `REFERENCES customers(id)` apuntando a una tabla que no existe revienta
  // el `INSERT` con "no such table". La base real declara la llave, y el migrador
  // no la necesita para nada.
  db.exec(
    DDL.replace(
      '@FK_CLIENTES@',
      sinTablaClientes ? '' : ' REFERENCES customers(id) ON DELETE SET NULL',
    ),
  );
  if (sinTablaClientes) db.exec('DROP TABLE customers');

  const nombre = etiqueta === 'documentos' ? 'DocuPro Studio' : 'Cotizaciones JM';
  db.prepare(
    `INSERT INTO tenants (id, slug, name, product, currency, timezone, reminder_hours, email_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(TENANT_COMPARTIDO, slug, nombre, etiqueta, '$', 'America/Mexico_City', 24, 0, '2026-09-23T16:45:32.353Z');

  if (autoresDesconocidos) {
    // El legacy guardaba usuarios con `password_hash`. Aca la identidad es del
    // Core: el usuario NO se crea, se reporta, porque inventarle una contrasena
    // seria crear un segundo sistema de identidad.
    db.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, name, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('usr_legacy_1', TENANT_COMPARTIDO, 'ana@legacy.test', '$2a$10$hash', 'Ana Legacy', 'owner', 1, '2026-09-23T16:45:32.353Z');
  }

  if (!sinTablaClientes) {
    const cliente = db.prepare(
      'INSERT INTO customers (id, tenant_id, name, phone, email, birthdate, notes, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    cliente.run('cli_1', TENANT_COMPARTIDO, 'Laura Mendez', '+52 55 5555 2001', 'laura@example.com', '1990-04-12', null, null, '2026-09-23T16:45:32.353Z');
    cliente.run('cli_2', TENANT_COMPARTIDO, 'Renata Salgado', '+52 55 5555 2003', '', null, null, 'vip', '2026-09-23T16:45:32.353Z');
    cliente.run('cli_3', TENANT_COMPARTIDO, 'Constructora Fenix', '+52 55 4444 3001', 'finanzas@fenix.mx', null, null, null, '2026-09-23T16:53:12.389Z');
    cliente.run('cli_4', TENANT_COMPARTIDO, 'Imprenta Rivera', '+52 55 4444 3005', 'pedidos@rivera.mx', null, null, null, '2026-09-23T16:53:12.389Z');
    cliente.run('cli_5', TENANT_COMPARTIDO, 'Textiles del Centro', '+52 55 4444 3003', 'compras@textiles.mx', null, null, null, '2026-09-23T16:53:12.389Z');
  }

  // Tablas de los otros productos: existen en el legacy real y NO son de este
  // producto. El migrador tiene que contarlas y reportarlas, no copiarlas.
  db.prepare('INSERT INTO appointments (id, tenant_id, customer_id, start_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('cit_1', TENANT_COMPARTIDO, 'cli_1', '2026-09-25T15:00:00.000Z', 'confirmed', '2026-09-23T16:45:32.353Z');
  db.prepare('INSERT INTO work_orders (id, tenant_id, number, customer_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('ord_1', TENANT_COMPARTIDO, 1, 'cli_1', 'in_progress', '2026-09-23T16:45:32.353Z');
  db.prepare('INSERT INTO inventory_items (id, tenant_id, name, sku, quantity, min_qty, unit, price, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('itm_1', TENANT_COMPARTIDO, 'Vinil de corte', 'VI-001', 40, 5, 'metro', 260, 1, '2026-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO followups (id, tenant_id, customer_id, channel, body, due_at, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('seg_1', TENANT_COMPARTIDO, 'cli_1', 'whatsapp', 'Hola', '2026-09-25T15:00:00.000Z', 'pending', '2026-09-23T16:45:32.353Z');

  if (!sinDocumentos) {
    const factor = opciones.preciosEnCentavos ? 1 : 100;
    // Una base con un unico documento deja el factor sin forma de deducirse: no
    // hay con que contrastar la primera muestra contra una segunda.
    const documentos = unSoloDocumento ? documentosDe(opciones).slice(0, 1) : documentosDe(opciones);
    const insertar = db.prepare(
      `INSERT INTO documents
         (id, tenant_id, type, number, customer_id, customer_snapshot, title, lines,
          subtotal, tax, total, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const d of documentos) {
      const subtotal = Math.round(d.subtotalUnidades * factor);
      const tax = Math.round((subtotal * d.taxBp) / 10_000);
      insertar.run(
        d.id,
        TENANT_COMPARTIDO,
        d.tipo,
        d.folio,
        d.cliente,
        typeof d.snapshot === 'string' ? d.snapshot : JSON.stringify(d.snapshot),
        d.titulo,
        typeof d.lineas === 'string' ? d.lineas : d.lineas,
        subtotal,
        tax,
        subtotal + tax,
        d.estado,
        d.creado,
      );
    }
  }

  db.close();
}
