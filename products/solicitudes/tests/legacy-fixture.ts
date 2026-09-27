import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

/**
 * Una base legacy de ordenes de taller de mentira, con las rarezas del legacy REAL.
 *
 * Acá estan las rarezas que aparecieron al mirar `products/talleres/data/app.db`
 * de verdad, porque un fixture liso y bonito probaria un migrador que despues se
 * rompe con la primera fila real:
 *
 *   - TODAS las ordenes tienen vehiculo (marca, modelo, patente, anio,
 *     kilometraje) y este producto no tiene vehiculos. El fixture las trae todas
 *     con datos, para que el informe los cuente y no se pierdan en silencio.
 *   - `work_order_parts` apunta a `inventory_items`, que NO son de este producto:
 *     los absorbio `inventario`. Ademas hay una linea cuyo `item_id` no existe en
 *     `inventory_items`, que es el caso donde la linea entra igual con un nombre
 *     de reemplazo y queda reportado.
 *   - El legacy NO guarda el total de la orden: hay que calcularlo.
 *   - Una orden sin `staff_id`: se migra igual y se cuenta como sin tecnico.
 *   - Una orden que apunta a un `staff_id` que no existe: el migrador tiene que
 *     frenar, no dejar la referencia colgando en silencio.
 *   - Un estado de orden que el destino no conoce.
 *   - Una autora que no esta en el Core.
 *   - `customers.birthdate`, que viene de la peluqueria y no tiene destino aca.
 *   - El MISMO nombre de cliente en dos tenants: son dos organizaciones, y
 *     decidir que son la misma persona es del negocio, no del migrador.
 *   - Una tabla `inventory_items` que puede no estar, porque una empresa de
 *     servicios puede no llevar catalogo de repuestos.
 */
export const LEGACY_DDL = `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, product TEXT,
  currency TEXT, timezone TEXT, reminder_hours INTEGER, email_enabled INTEGER,
  address TEXT, phone TEXT, whatsapp_webhook TEXT, whatsapp_token TEXT, created_at TEXT
);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT, active INTEGER, created_at TEXT);
CREATE TABLE staff (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  color TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  birthdate TEXT, notes TEXT, tags TEXT, created_at TEXT NOT NULL
);
CREATE TABLE services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, duration_min INTEGER NOT NULL,
  price INTEGER NOT NULL, description TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, number INTEGER NOT NULL,
  customer_id TEXT NOT NULL, staff_id TEXT, vehicle_make TEXT NOT NULL,
  vehicle_model TEXT NOT NULL, vehicle_plate TEXT NOT NULL, vehicle_year INTEGER,
  vehicle_odo INTEGER, status TEXT NOT NULL, estimated_delivery TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE work_order_services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, service_id TEXT NOT NULL, price_at INTEGER NOT NULL
);
CREATE TABLE work_order_parts (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL,
  qty INTEGER NOT NULL, unit_price_at INTEGER NOT NULL
);
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sku TEXT,
  quantity INTEGER NOT NULL, min_qty INTEGER NOT NULL, unit TEXT NOT NULL, price INTEGER NOT NULL,
  active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, delta INTEGER NOT NULL,
  reason TEXT NOT NULL, user_id TEXT, created_at TEXT NOT NULL
);
`;

export interface OpcionesFixture {
  /** Orden que apunta a un `staff_id` que no existe en `staff`. */
  ordenConTecnicoInexistente?: boolean;
  /** Estado de orden que el destino no conoce. */
  estadosRaros?: boolean;
  /** Que una de las autoras no exista en el Core. */
  autoresDesconocidos?: boolean;
  /** Quitar la tabla `inventory_items`, como si el legacy no la tuviera. */
  sinTablaInventario?: boolean;
  /** Quitar `inventory_movements` también. */
  sinTablaMovimientos?: boolean;
}

export function crearLegacy(path: string, opciones: OpcionesFixture = {}): void {
  const {
    ordenConTecnicoInexistente = false,
    estadosRaros = false,
    autoresDesconocidos = false,
    sinTablaInventario = false,
    sinTablaMovimientos = false,
  } = opciones;

  // Se borra antes de crear: varios tests piden la base con variantes distintas
  // sobre el mismo archivo, y sin esto el segundo `CREATE TABLE` revienta con
  // "table tenants already exists".
  rmSync(path, { force: true });

  const db = new Database(path);
  db.exec(LEGACY_DDL);
  if (sinTablaInventario) db.exec('DROP TABLE inventory_items');
  if (sinTablaMovimientos) db.exec('DROP TABLE inventory_movements');

  const tenant = db.prepare(
    `INSERT INTO tenants (id, slug, name, product, currency, timezone, reminder_hours, email_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  tenant.run('ten_taller', 'demo-talleres', 'Talleres El Mecanico', 'talleres', '$', 'America/Mexico_City', 24, 0, '2026-01-01T00:00:00.000Z');
  tenant.run('ten_tec', 'demo-tecnicos', 'Service Tec', 'talleres', '$', 'America/Mexico_City', 24, 0, '2026-01-01T00:00:00.000Z');

  if (autoresDesconocidos) {
    db.prepare('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'usr_legacy_1', 'Ana Legacy', 'ana@legacy.test', 'owner', '2026-01-01T00:00:00.000Z',
    );
  }

  const pro = db.prepare(
    `INSERT INTO staff (id, tenant_id, name, phone, email, color, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  pro.run('tec_1', 'ten_taller', 'Jorge', '+52 55 3333 1100', null, '#ea580c', 1, '2026-01-01T00:00:00.000Z');
  // Sin color: la columna del destino no admite nulos, tiene que entrar con default.
  pro.run('tec_2', 'ten_taller', 'Karla', '+52 55 3333 1101', null, null, 1, '2026-01-01T00:00:00.000Z');
  pro.run('tec_3', 'ten_taller', 'Ramon', null, null, '#2563eb', 1, '2026-01-01T00:00:00.000Z');
  pro.run('tec_9', 'ten_tec', 'Tecnico Externo', null, null, '#7c3aed', 1, '2026-01-01T00:00:00.000Z');

  const trabajo = db.prepare(
    `INSERT INTO services (id, tenant_id, name, duration_min, price, description, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Precios de 25000 a 180000, como en el legacy real: ya vienen en centavos.
  trabajo.run('srv_aceite', 'ten_taller', 'Cambio de aceite', 60, 25000, 'Aceite 5W-30 + filtro', 1, '2026-01-01T00:00:00.000Z');
  trabajo.run('srv_afinacion', 'ten_taller', 'Afinacion mayor', 180, 180000, 'Bujias, filtros y ajuste', 1, '2026-01-01T00:00:00.000Z');
  trabajo.run('srv_tec', 'ten_tec', 'Visita tecnica', 90, 45000, null, 1, '2026-01-01T00:00:00.000Z');

  const cliente = db.prepare(
    `INSERT INTO customers (id, tenant_id, name, phone, email, birthdate, notes, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  cliente.run('cli_1', 'ten_taller', 'Ana Torres', '+52 55 3333 1001', 'ana@example.com', '1990-04-12', null, null, '2026-01-01T00:00:00.000Z');
  cliente.run('cli_2', 'ten_taller', 'Luis Rojas', '+52 55 3333 1002', null, null, 'revierte ruido', 'vip', '2026-01-01T00:00:00.000Z');
  // Mismo nombre en otro tenant: es otra organización, y unificarlas es del negocio.
  cliente.run('cli_3', 'ten_tec', 'Ana Torres', '+52 55 4444 1001', 'ana@example.com', null, null, null, '2026-01-01T00:00:00.000Z');

  const orden = db.prepare(
    `INSERT INTO work_orders
       (id, tenant_id, number, customer_id, staff_id, vehicle_make, vehicle_model, vehicle_plate,
        vehicle_year, vehicle_odo, status, estimated_delivery, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Todas con vehiculo: el producto no tiene destino para eso y el informe lo cuenta.
  orden.run('ord_1', 'ten_taller', 1, 'cli_1', 'tec_1', 'Nissan', 'Versa', 'a123bc', 2018, 84500, 'in_progress', '2026-09-24', 'Cambio de frenos completo', '2026-09-22T15:51:46.016Z', '2026-09-22T15:51:46.016Z');
  // Sin tecnico: se migra igual y se cuenta como sin tecnico.
  orden.run('ord_2', 'ten_taller', 2, 'cli_2', null, 'Honda', 'Civic', 'x9yz99', 2020, 121000, 'received', '2026-09-24', 'Cliente refiere ruido al frenar', '2026-09-21T15:51:46.016Z', '2026-09-21T15:51:46.016Z');
  orden.run('ord_3', 'ten_taller', 3, 'cli_1', 'tec_2', 'Ford', 'Ranger', 'm3n4o5', 2019, 65400, 'done', '2026-09-20', null, '2026-09-20T15:51:46.016Z', '2026-09-23T10:00:00.000Z');
  orden.run('ord_4', 'ten_taller', 4, 'cli_2', 'tec_1', 'Toyota', 'Hilux', 'p6q7r8', 2021, 43200, estadosRaros ? 'hold' : 'estimated', null, 'Cotizar repuesto importado', '2026-09-19T15:51:46.016Z', '2026-09-19T15:51:46.016Z');
  orden.run('ord_5', 'ten_taller', 5, 'cli_1', 'tec_3', 'Kia', 'Rio', 's9t8u7', 2017, 98700, 'cancelled', null, 'Cliente lo cancelo', '2026-09-18T15:51:46.016Z', '2026-09-18T18:00:00.000Z');
  // Sin vehiculo del todo: el legacy declara esas columnas NOT NULL, asi que la
  // forma de "no tener vehiculo" que el esquema permite es la cadena vacia. El
  // migrador tiene que contar SOLO las ordenes que de verdad traen un vehiculo, y
  // esta fila prueba que una cadena vacia no se cuenta como si fuera uno.
  orden.run('ord_tec', 'ten_tec', 1, 'cli_3', 'tec_9', '', '', '', null, null, 'received', null, 'Sin vehiculo: es una visita', '2026-09-22T15:51:46.016Z', '2026-09-22T15:51:46.016Z');

  if (ordenConTecnicoInexistente) {
    // Apunta a un tecnico que no esta en `staff`: la referencia quedaria colgando.
    orden.run('ord_huerfana', 'ten_taller', 6, 'cli_1', 'tec_fantasma', 'Mazda', '3', 'z1z2z3', 2015, 222200, 'received', null, null, '2026-09-23T15:51:46.016Z', '2026-09-23T15:51:46.016Z');
  }

  // El legacy NO guarda el total: 25000 + 60000 = 85000 de trabajo pactado.
  const lineaTrabajo = db.prepare(
    `INSERT INTO work_order_services (id, tenant_id, order_id, service_id, price_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  lineaTrabajo.run('lin_1', 'ten_taller', 'ord_1', 'srv_aceite', 25000);
  lineaTrabajo.run('lin_2', 'ten_taller', 'ord_1', 'srv_afinacion', 60000);
  lineaTrabajo.run('lin_3', 'ten_taller', 'ord_3', 'srv_afinacion', 180000);
  lineaTrabajo.run('lin_4', 'ten_tec', 'ord_tec', 'srv_tec', 45000);

  if (!sinTablaInventario) {
    const item = db.prepare(
      `INSERT INTO inventory_items (id, tenant_id, name, sku, quantity, min_qty, unit, price, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    item.run('itm_1', 'ten_taller', 'Pastilla de freno', 'FR-001', 24, 4, 'unidad', 18500, 1, '2026-01-01T00:00:00.000Z');
    item.run('itm_2', 'ten_taller', 'Aceite 5W-30', 'AC-002', 60, 10, 'litro', 9800, 1, '2026-01-01T00:00:00.000Z');
    item.run('itm_9', 'ten_tec', 'Filtro de aire', 'FA-009', 12, 2, 'unidad', 4200, 1, '2026-01-01T00:00:00.000Z');

    if (!sinTablaMovimientos) {
      const mov = db.prepare(
        `INSERT INTO inventory_movements (id, tenant_id, item_id, delta, reason, user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      mov.run('mov_1', 'ten_taller', 'itm_1', -4, 'consumo', null, '2026-09-22T16:00:00.000Z');
    }

    // Repuestos de la orden 1: 4 x 18500 = 74000. Con el trabajo, el total es
    // 85000 + 74000 = 159000. El legacy no lo guardaba: hay que calcularlo.
    const lineaParte = db.prepare(
      `INSERT INTO work_order_parts (id, tenant_id, order_id, item_id, qty, unit_price_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    lineaParte.run('par_1', 'ten_taller', 'ord_1', 'itm_1', 4, 18500);
    lineaParte.run('par_2', 'ten_taller', 'ord_1', 'itm_2', 1, 9800);
    // Apunta a un item que no existe en inventory_items: la linea entra igual con
    // un nombre de reemplazo, y queda reportada.
    lineaParte.run('par_3', 'ten_taller', 'ord_2', 'itm_fantasma', 2, 3500);
  }

  db.close();
}
