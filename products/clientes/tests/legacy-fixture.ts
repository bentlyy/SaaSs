import Database from 'better-sqlite3';

/**
 * Una base legacy de crm de mentira, con las rarezas del legacy REAL.
 *
 * El legacy de verdad tiene 17 tablas y este producto solo es dueño de dos. Acá
 * están las que el migrador lee, las que solo cuenta para el informe, y sobre
 * todo están las rarezas que aparecieron al mirar los datos de verdad, porque un
 * fixture liso y bonito probaría un migrador que después se rompe con la primera
 * fila real:
 *
 *   - `followups.status` con `cancelled` (dos eles), que el producto escribe como
 *     `canceled`. Si la forma vieja entra sin traducir, la columna tiene dos
 *     vocabularios y la mitad de los cancelados deja de encontrarse.
 *   - `customers.email` y `customers.phone` con texto VACÍO en vez de NULL. En
 *     JavaScript `''` es verdadero, así que sin normalizar la ficha diría "tiene
 *     teléfono" de alguien a quien no se le puede llamar.
 *   - Una `birthdate` que no es una fecha. El producto no la puede usar, y lo que
 *     no puede usar no se adivina: queda en NULL y se reporta.
 *   - Un estado de seguimiento que el destino no conoce.
 *   - Un seguimiento que apunta a un cliente que no existe.
 *   - Una autora que no está en el Core.
 *   - Tablas que NO son de este producto y tienen filas: citas, cotizaciones,
 *     inventario. El migrador no las copia y el informe las menciona.
 */
export const LEGACY_DDL = `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, product TEXT NOT NULL DEFAULT 'peluqueria',
  currency TEXT NOT NULL DEFAULT '$', timezone TEXT NOT NULL DEFAULT 'America/Mexico_City',
  reminder_hours INTEGER NOT NULL DEFAULT 24, whatsapp_webhook TEXT, whatsapp_token TEXT,
  email_enabled INTEGER NOT NULL DEFAULT 0, address TEXT, phone TEXT, created_at TEXT NOT NULL
);
CREATE TABLE users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, password_hash TEXT NOT NULL,
  name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'staff', active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  birthdate TEXT, notes TEXT, tags TEXT, created_at TEXT NOT NULL
);
CREATE TABLE followups (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
  due_date TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, duration_min INTEGER NOT NULL,
  price INTEGER NOT NULL, description TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE staff (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  color TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE staff_services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, service_id TEXT NOT NULL);
CREATE TABLE appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, staff_id TEXT, resource_id TEXT,
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, notes TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE appointment_services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, appointment_id TEXT NOT NULL, service_id TEXT NOT NULL, price_at INTEGER NOT NULL
);
CREATE TABLE documents (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, type TEXT, number TEXT, customer_id TEXT, customer_snapshot TEXT,
  title TEXT, lines TEXT, subtotal INTEGER, tax INTEGER, total INTEGER, status TEXT, created_at TEXT NOT NULL
);
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sku TEXT, quantity INTEGER, min_qty INTEGER,
  unit TEXT, price INTEGER, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, item_id TEXT NOT NULL, delta INTEGER, reason TEXT, user_id TEXT, created_at TEXT
);
CREATE TABLE reminder_logs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, appointment_id TEXT NOT NULL, channel TEXT NOT NULL,
  status TEXT NOT NULL, error TEXT, sent_at TEXT
);
CREATE TABLE resources (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT, capacity INTEGER,
  price_per_hour INTEGER, color TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE work_orders (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, number INTEGER NOT NULL, customer_id TEXT, staff_id TEXT,
  vehicle_make TEXT, vehicle_model TEXT, vehicle_plate TEXT, vehicle_year INTEGER, vehicle_odo INTEGER,
  status TEXT, estimated_delivery TEXT, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT
);
CREATE TABLE work_order_services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, service_id TEXT NOT NULL, price_at INTEGER NOT NULL);
CREATE TABLE work_order_parts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, order_id TEXT NOT NULL, item_id TEXT NOT NULL, qty INTEGER NOT NULL, unit_price_at INTEGER NOT NULL);
`;

export interface OpcionesFixture {
  /** Una `birthdate` que no es una fecha `AAAA-MM-DD`. */
  cumpleañosInvalido?: boolean;
  /** Un estado de seguimiento que el destino no conoce. */
  estadoRaro?: boolean;
  /** Un seguimiento que apunta a un cliente inexistente. */
  seguimientoRoto?: boolean;
  /** Que la autora del legacy no exista en el Core. */
  autoresDesconocidos?: boolean;
  /** Llenar las tablas que son de otros productos. */
  conTablasAjenas?: boolean;
  /** Poner el teléfono y el correo como texto vacío en vez de NULL. */
  contactosVacios?: boolean;
}

export function crearLegacy(path: string, opciones: OpcionesFixture = {}): void {
  const {
    cumpleañosInvalido = true,
    estadoRaro = true,
    seguimientoRoto = false,
    autoresDesconocidos = true,
    conTablasAjenas = true,
    contactosVacios = true,
  } = opciones;

  const db = new Database(path);
  db.exec(LEGACY_DDL);

  db.prepare(
    `INSERT INTO tenants (id, slug, name, product, currency, timezone, reminder_hours, email_enabled, address, phone, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'ten_crm',
    'demo-crm',
    'Clientes Vip Studio',
    'crm',
    '$',
    'America/Mexico_City',
    24,
    0,
    'Av. Reforma 902, Col. Juárez',
    '+52 55 5555 9090',
    '2026-01-01T00:00:00.000Z',
  );

  if (autoresDesconocidos) {
    db.prepare(
      'INSERT INTO users (id, tenant_id, email, password_hash, name, role, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      'usr_legacy_1',
      'ten_crm',
      'diana@legacy.test',
      'no-se-migra-esta-columna',
      'Diana Ríos',
      'owner',
      1,
      '2026-01-01T00:00:00.000Z',
    );
  }

  const cliente = db.prepare(
    `INSERT INTO customers (id, tenant_id, name, phone, email, birthdate, notes, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const sinContacto = contactosVacios ? '' : null;
  cliente.run('cli_1', 'ten_crm', 'María Sosa', '+52 55 5555 4001', 'maria@example.com', null, null, 'vip,recurrente', '2026-01-01T00:00:00.000Z');
  // Telefono y correo VACIOS, no NULL: es como los guardaba el legacy.
  cliente.run('cli_2', 'ten_crm', 'Irene Campos', sinContacto, sinContacto, null, null, 'nueva', '2026-01-01T00:00:00.000Z');
  // Cumpleaños de verdad: es una FECHA, y tiene que llegar como fecha.
  cliente.run('cli_3', 'ten_crm', 'Sofía Mejía', '+52 55 5555 4005', 'sofia@example.com', '1990-05-14', null, 'vip', '2026-01-01T00:00:00.000Z');
  // Cumpleaños que NO es una fecha. El producto no lo puede usar y no se inventa.
  cliente.run('cli_4', 'ten_crm', 'Carla Núñez', '+52 55 5555 4008', 'carla@example.com', cumpleañosInvalido ? '14/05/1991' : null, null, null, '2026-01-01T00:00:00.000Z');

  const seguimiento = db.prepare(
    `INSERT INTO followups (id, tenant_id, customer_id, title, body, due_date, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  seguimiento.run('seg_1', 'ten_crm', 'cli_1', 'Llamar para renovar paquete', 'Proponer plan 3 meses', '2026-09-21', 'pending', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  seguimiento.run('seg_2', 'ten_crm', 'cli_1', 'Confirmar cita de corte', null, '2026-09-18', 'done', '2026-09-01T10:00:00.000Z', '2026-09-02T10:00:00.000Z');
  // `cancelled` con DOS eles: la forma del legacy. El producto usa una.
  seguimiento.run('seg_3', 'ten_crm', 'cli_2', 'Descuento cumpleaños', 'Se reactivó en mayo', '2026-09-08', 'cancelled', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  // Estado que el destino no conoce.
  seguimiento.run('seg_4', 'ten_crm', 'cli_3', 'Encuesta de satisfacción', null, '2026-09-25', estadoRaro ? 'rescheduled' : 'pending', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');

  if (seguimientoRoto) {
    // El seguimiento sin cliente: un "@pendiente" suelto. El migrador tiene que
    // frenar en vez de escribir una fila apuntando a la nada.
    seguimiento.run('seg_roto', 'ten_crm', 'cli_inexistente', 'Llamar a quien sea', null, '2026-09-30', 'pending', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
  }

  if (conTablasAjenas) {
    // Estas filas son de otros productos. El migrador las cuenta y las reporta,
    // pero no las copia: una cita en dos productos es la misma agenda desactualizada.
    db.prepare(
      `INSERT INTO appointments (id, tenant_id, customer_id, staff_id, resource_id, start_at, end_at, notes, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('cit_1', 'ten_crm', 'cli_1', 'per_1', null, '2026-09-24T15:00:00.000Z', '2026-09-24T17:00:00.000Z', null, 'confirmed', '2026-09-01T10:00:00.000Z');

    db.prepare(
      'INSERT INTO services (id, tenant_id, name, duration_min, price, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('srv_1', 'ten_crm', 'Color y mechas', 120, 980, null, 1, '2026-09-01T10:00:00.000Z');

    db.prepare(
      'INSERT INTO staff (id, tenant_id, name, phone, email, color, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('per_1', 'ten_crm', 'Lorena Paz', null, null, '#7c3aed', 1, '2026-09-01T10:00:00.000Z');

    db.prepare(
      `INSERT INTO documents (id, tenant_id, type, number, customer_id, title, lines, total, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('doc_1', 'ten_crm', 'cotizacion', 'C-0001', 'cli_1', 'Color de temporada', '[]', 98000, 'sent', '2026-09-01T10:00:00.000Z');

    db.prepare(
      `INSERT INTO inventory_items (id, tenant_id, name, sku, quantity, min_qty, unit, price, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('inv_1', 'ten_crm', 'Shampoo profesional', 'shp-01', 4, 2, 'unidad', 12000, 1, '2026-09-01T10:00:00.000Z');
  }

  db.close();
}
