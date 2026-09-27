import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';

/**
 * Una base legacy de reservas de espacio de mentira, con las rarezas del legacy REAL.
 *
 * El legacy de verdad tiene 16 tablas y varias que este producto no toca. Acá
 * están solo las que el migrador lee, y sobre todo están las rarezas que
 * aparecieron al mirar los datos de verdad, porque un fixture liso y bonito
 * probaría un migrador que después se rompe con la primera fila real:
 *
 *   - `resource_id` y `staff_id` van en la MISMA tabla `appointments`. El legacy
 *     mezcló reservas de espacio y citas en una tabla, y se distinguen por cuál
 *     de los dos apunta. Una reserva sin `resource_id` no se sabe a qué espacio
 *     pertenece, y una con los dos no se sabe qué es: el migrador tiene que
 *     frenar, no adivinar.
 *   - `appointment_services` VACÍA: no hay ni una línea con el precio pactado.
 *     Sin esa referencia no hay contra qué verificar la tarifa ni los extras, así
 *     que el dinero viaja tal cual y se reporta. Acá hay una base con líneas para
 *     probar el otro camino, el de `price_at` autoritativo.
 *   - `staff` con filas que ninguna reserva menciona: un producto de espacios no
 *     agenda personal, así que se reportan sin equivalente en vez de inventar
 *     una tabla donde meterlas.
 *   - `inventory_items` con filas: los absorbió `inventario`, que es su dueño.
 *   - Un estado de reserva que el destino no conoce.
 *   - Una autora que no está en el Core.
 *   - El MISMO nombre de cliente en dos tenants: son dos organizaciones, y
 *     decidir que son la misma persona es del negocio, no del migrador.
 */
export const LEGACY_DDL = `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, product TEXT,
  currency TEXT, timezone TEXT, reminder_hours INTEGER, email_enabled INTEGER,
  address TEXT, phone TEXT, whatsapp_webhook TEXT, whatsapp_token TEXT, created_at TEXT
);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT, active INTEGER, created_at TEXT);
CREATE TABLE resources (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT,
  capacity INTEGER NOT NULL, price_per_hour INTEGER NOT NULL, color TEXT,
  active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE staff (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT, color TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE customers (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  birthdate TEXT, notes TEXT, tags TEXT, created_at TEXT NOT NULL
);
CREATE TABLE appointments (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_id TEXT NOT NULL, staff_id TEXT,
  resource_id TEXT, start_at TEXT NOT NULL, end_at TEXT NOT NULL, notes TEXT,
  status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE appointment_services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, appointment_id TEXT NOT NULL, service_id TEXT NOT NULL, price_at INTEGER NOT NULL
);
CREATE TABLE services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, duration_min INTEGER NOT NULL,
  price INTEGER NOT NULL, description TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, sku TEXT, category TEXT,
  unit TEXT NOT NULL, stock REAL NOT NULL, cost INTEGER, min_stock REAL, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
`;

export interface OpcionesFixture {
  /** Reservas sin `resource_id`: no se sabe a qué espacio pertenecen. */
  reservaSinEspacio?: boolean;
  /** Reserva con `resource_id` y `staff_id`: no se sabe si es espacio o cita. */
  reservaConPersonalYEspacio?: boolean;
  /** Llenar `appointment_services`, como el legacy real NO lo hizo. */
  conLineasDePrecio?: boolean;
  /** Estados de reserva que el destino no conoce. */
  estadosRaros?: boolean;
  /** Que una de las autoras no exista en el Core. */
  autoresDesconocidos?: boolean;
  /** Espacio sin color: la columna no admite nulos, tiene que entrar con default. */
  espacioSinColor?: boolean;
  /** Quitar la tabla `inventory_items`, como si el legacy no la tuviera. */
  sinTablaInventario?: boolean;
}

export function crearLegacy(path: string, opciones: OpcionesFixture = {}): void {
  const {
    reservaSinEspacio = false,
    reservaConPersonalYEspacio = false,
    conLineasDePrecio = false,
    estadosRaros = false,
    autoresDesconocidos = false,
    espacioSinColor = false,
    sinTablaInventario = false,
  } = opciones;

  // Se borra antes de crear: varios tests piden la base con variantes distintas
  // sobre el mismo archivo, y sin esto el segundo `CREATE TABLE` revienta con
  // "table tenants already exists".
  rmSync(path, { force: true });

  const db = new Database(path);
  db.exec(LEGACY_DDL);
  if (sinTablaInventario) db.exec('DROP TABLE inventory_items');

  const tenant = db.prepare(
    `INSERT INTO tenants (id, slug, name, product, currency, timezone, reminder_hours, email_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  tenant.run('ten_deportes', 'demo-deportes', 'Sport Center MX', 'deportes', '$', 'America/Mexico_City', 12, 0, '2026-01-01T00:00:00.000Z');
  tenant.run('ten_vip', 'demo-vip', 'Complejo Vip', 'deportes', '$', 'America/Mexico_City', 24, 1, '2026-01-01T00:00:00.000Z');

  if (autoresDesconocidos) {
    db.prepare('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'usr_legacy_1', 'Ana Legacy', 'ana@legacy.test', 'owner', '2026-01-01T00:00:00.000Z',
    );
  }

  const recurso = db.prepare(
    `INSERT INTO resources (id, tenant_id, name, type, capacity, price_per_hour, color, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Tarifas de 15000 a 60000, como en el legacy real: ya vienen en centavos y
  // no hay línea que lo confirme, así que NO se multiplican por nada.
  recurso.run('rec_futbol7', 'ten_deportes', 'Cancha Futbol 7', 'cancha', 14, 30000, '#16a34a', 1, '2026-01-01T00:00:00.000Z');
  recurso.run('rec_futbol11', 'ten_deportes', 'Cancha Futbol 11', 'cancha', 22, 60000, '#15803d', 1, '2026-01-01T00:00:00.000Z');
  recurso.run('rec_yoga', 'ten_deportes', 'Sala de Yoga', 'sala', 20, 15000, espacioSinColor ? null : '#7c3aed', 1, '2026-01-01T00:00:00.000Z');
  // Espacio inactivo: el legacy lo guardaba así y hay que traerlo inactivo.
  recurso.run('rec_retirada', 'ten_deportes', 'Cancha en Reparacion', 'cancha', 11, 20000, '#ea580c', 0, '2026-01-01T00:00:00.000Z');
  recurso.run('rec_vip', 'ten_vip', 'Sala Vip', 'sala', 8, 45000, '#0891b2', 1, '2026-01-01T00:00:00.000Z');

  // Personal que ninguna reserva menciona: se reporta, no se inventa tabla.
  const pro = db.prepare(
    `INSERT INTO staff (id, tenant_id, name, phone, email, color, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  pro.run('per_1', 'ten_deportes', 'Recepcion', null, null, null, 1, '2026-01-01T00:00:00.000Z');
  pro.run('per_2', 'ten_deportes', 'Coordinadora', null, null, null, 1, '2026-01-01T00:00:00.000Z');

  const servicio = db.prepare(
    `INSERT INTO services (id, tenant_id, name, duration_min, price, description, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  servicio.run('srv_equipo', 'ten_deportes', 'Alquiler de equipo', 0, 500, 'Conos y balones', 1, '2026-01-01T00:00:00.000Z');
  servicio.run('srv_grupo', 'ten_deportes', 'Clase grupal', 60, 800, 'Entrenador incluido', 1, '2026-01-01T00:00:00.000Z');

  const cliente = db.prepare(
    `INSERT INTO customers (id, tenant_id, name, phone, email, notes, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  cliente.run('cli_1', 'ten_deportes', 'Luisa Herrera', '+52 55 3333 1001', 'luisa@example.com', null, null, '2026-01-01T00:00:00.000Z');
  cliente.run('cli_2', 'ten_deportes', 'Marco Ruiz', '+52 55 3333 1002', null, 'torneos de fin de semana', 'vip', '2026-01-01T00:00:00.000Z');
  // Mismo nombre en otro tenant: es otra organización, y unificarlas es del negocio.
  cliente.run('cli_3', 'ten_vip', 'Luisa Herrera', '+52 55 4444 1001', 'luisa@example.com', null, null, '2026-01-01T00:00:00.000Z');

  const reserva = db.prepare(
    `INSERT INTO appointments (id, tenant_id, customer_id, staff_id, resource_id, start_at, end_at, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // Dos horas a 30000 = 60000. El legacy NO guardaba el total.
  reserva.run('res_1', 'ten_deportes', 'cli_1', null, 'rec_futbol7', '2026-09-23T14:00:00.000Z', '2026-09-23T16:00:00.000Z', 'partido de la liga', 'confirmed', '2026-09-23T05:00:00.000Z');
  // Una hora y media a 15000 = 22500.
  reserva.run('res_2', 'ten_deportes', 'cli_2', null, 'rec_yoga', '2026-09-24T18:00:00.000Z', '2026-09-24T19:30:00.000Z', null, 'pending', '2026-09-23T05:00:00.000Z');
  // Estado que el destino no conoce: se migra como `pending` y se reporta.
  reserva.run('res_3', 'ten_deportes', 'cli_1', null, 'rec_futbol11', '2026-09-25T20:00:00.000Z', '2026-09-25T22:00:00.000Z', null, estadosRaros ? 'hold' : 'confirmed', '2026-09-23T05:00:00.000Z');
  // Cancelada: se migra, pero NO bloquea el espacio (ver `OCUPAN` en routes.ts).
  reserva.run('res_cancelada', 'ten_deportes', 'cli_2', null, 'rec_futbol7', '2026-09-23T18:00:00.000Z', '2026-09-23T19:00:00.000Z', null, 'cancelled', '2026-09-23T05:00:00.000Z');
  reserva.run('res_vip', 'ten_vip', 'cli_3', null, 'rec_vip', '2026-09-26T16:00:00.000Z', '2026-09-26T17:00:00.000Z', null, 'confirmed', '2026-09-23T05:00:00.000Z');

  if (reservaSinEspacio) {
    // No se sabe a qué espacio pertenece: el migrador tiene que frenar acá.
    reserva.run('res_huerfana', 'ten_deportes', 'cli_1', null, null, '2026-09-27T15:00:00.000Z', '2026-09-27T16:00:00.000Z', null, 'confirmed', '2026-09-23T05:00:00.000Z');
  }
  if (reservaConPersonalYEspacio) {
    // Tiene las dos cosas: no se sabe si es una reserva o una cita.
    reserva.run('res_ambigua', 'ten_deportes', 'cli_1', 'per_1', 'rec_futbol7', '2026-09-28T15:00:00.000Z', '2026-09-28T16:00:00.000Z', null, 'confirmed', '2026-09-23T05:00:00.000Z');
  }

  if (conLineasDePrecio) {
    // El legacy real no tenía líneas. Acá se prueba el camino con datos: el
    // `price_at` es lo que se pactó y se copia tal cual, sin multiplicar.
    const linea = db.prepare(
      `INSERT INTO appointment_services (id, tenant_id, appointment_id, service_id, price_at)
       VALUES (?, ?, ?, ?, ?)`,
    );
    linea.run('lin_1', 'ten_deportes', 'res_1', 'srv_equipo', 500);
    linea.run('lin_2', 'ten_deportes', 'res_2', 'srv_grupo', 800);
  }

  if (!sinTablaInventario) {
    const item = db.prepare(
      `INSERT INTO inventory_items (id, tenant_id, name, sku, category, unit, stock, cost, min_stock, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    item.run('itm_1', 'ten_deportes', 'Balon Futbol', 'BAL-001', 'Deportes', 'unidad', 24, 35000, 5, 1, '2026-01-01T00:00:00.000Z');
    item.run('itm_2', 'ten_deportes', 'Conos', 'CON-001', 'Deportes', 'unidad', 60, 5000, 10, 1, '2026-01-01T00:00:00.000Z');
  }

  db.close();
}
