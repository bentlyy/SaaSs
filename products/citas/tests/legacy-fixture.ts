import Database from 'better-sqlite3';

/**
 * Una base legacy de citas de mentira, con las rarezas del legacy REAL.
 *
 * El legacy de verdad tiene 16 tablas y varias que este producto no toca. Acá
 * están solo las que el migrador lee, y sobre todo están las rarezas que
 * aparecieron al mirar los datos de verdad, porque un fixture liso y bonito
 * probaría un migrador que después se rompe con la primera fila real:
 *
 *   - `resource_id`: una cita que trae recurso NO es una cita, es una reserva de
 *     espacio. El migrador tiene que frenar, no guardarla en el producto
 *     equivocado.
 *   - Precios contradictorios: un tenant donde el mismo servicio aparece a dos
 *     precios distintos, y otro donde el precio de la cita es siempre el del
 *     catálogo. El primero no se puede convertir y se reporta; el segundo sí.
 *   - `staff_services` vacía en un tenant: el legacy nunca la llenó, y sin ella
 *     no se puede agendar nada.
 *   - Dos intentos de email para la misma cita: la bitácora de recordatorios
 *     guarda intentos, no avisos únicos.
 *   - Un estado de cita que el destino no conoce.
 *   - Una autora que no está en el Core.
 */
export const LEGACY_DDL = `
CREATE TABLE tenants (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, product TEXT,
  currency TEXT, timezone TEXT, reminder_hours INTEGER, email_enabled INTEGER,
  address TEXT, phone TEXT, whatsapp_webhook TEXT, whatsapp_token TEXT, created_at TEXT
);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, role TEXT, active INTEGER, created_at TEXT);
CREATE TABLE services (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, duration_min INTEGER NOT NULL,
  price INTEGER NOT NULL, description TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE staff (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT,
  color TEXT, active INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE staff_services (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, staff_id TEXT NOT NULL, service_id TEXT NOT NULL);
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
CREATE TABLE reminder_logs (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, appointment_id TEXT NOT NULL,
  channel TEXT NOT NULL, status TEXT NOT NULL, error TEXT, sent_at TEXT
);
`;

export interface OpcionesFixture {
  /** Precio de las líneas de cita, para probar el caso que se contradice. */
  preciosCoherentes?: boolean;
  /** Poner una cita con resource_id, que es de espacios y no de citas. */
  citaConRecurso?: boolean;
  /** Llenar `staff_services` como lo haría el legacy. */
  conAsignaciones?: boolean;
  /** Estados raros de cita. */
  estadosRaros?: boolean;
  /** Que una de las autoras no exista en el Core. */
  autoresDesconocidos?: boolean;
  /** Que el tenant traiga preferencias. */
  conPreferencias?: boolean;
}

export function crearLegacy(path: string, opciones: OpcionesFixture = {}): void {
  const {
    preciosCoherentes = true,
    citaConRecurso = false,
    conAsignaciones = true,
    estadosRaros = false,
    autoresDesconocidos = false,
    conPreferencias = true,
  } = opciones;

  const db = new Database(path);
  db.exec(LEGACY_DDL);

  const tenant = db.prepare(
    `INSERT INTO tenants (id, slug, name, product, currency, timezone, reminder_hours, email_enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  tenant.run('ten_pelu', 'demo-pelu', 'Estética Glow', 'peluqueria', '$', 'America/Mexico_City', 12, 0, '2026-01-01T00:00:00.000Z');
  tenant.run('ten_crm', 'demo-crm', 'Clientes Vip Studio', 'crm', '$', 'America/Mexico_City', 24, 0, '2026-01-01T00:00:00.000Z');

  if (autoresDesconocidos) {
    db.prepare('INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'usr_legacy_1', 'Ana Legacy', 'ana@legacy.test', 'owner', '2026-01-01T00:00:00.000Z',
    );
  }

  if (conPreferencias) {
    // El legacy no tenía tabla `settings`: los ajustes vivían en el tenant. Por
    // eso el migrador los lee de acá.
    db.prepare('UPDATE tenants SET reminder_hours = 12, email_enabled = 1 WHERE id = ?').run('ten_pelu');
    db.prepare('UPDATE tenants SET reminder_hours = 24, email_enabled = 0 WHERE id = ?').run('ten_crm');
  }

  const servicio = db.prepare(
    `INSERT INTO services (id, tenant_id, name, duration_min, price, description, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  servicio.run('srv_pelu_corte', 'ten_pelu', 'Corte de cabello', 30, 120, null, 1, '2026-01-01T00:00:00.000Z');
  servicio.run('srv_pelu_barba', 'ten_pelu', 'Corte + barba', 45, 180, null, 1, '2026-01-01T00:00:00.000Z');
  servicio.run('srv_crm_color', 'ten_crm', 'Color y mechas', 120, 980, null, 1, '2026-01-01T00:00:00.000Z');
  // Servicio inactivo: el legacy lo guardaba así y hay que traerlo inactivo.
  servicio.run('srv_crm_retirado', 'ten_crm', 'Retirado', 30, 500, null, 0, '2026-01-01T00:00:00.000Z');

  const pro = db.prepare(
    `INSERT INTO staff (id, tenant_id, name, phone, email, color, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  pro.run('per_pelu_1', 'ten_pelu', 'Yuki Sandoval', null, null, '#4f46e5', 1, '2026-01-01T00:00:00.000Z');
  pro.run('per_pelu_2', 'ten_pelu', 'Carlos Méndez', null, null, '#059669', 1, '2026-01-01T00:00:00.000Z');
  pro.run('per_crm_1', 'ten_crm', 'Lorena Paz', null, null, '#7c3aed', 1, '2026-01-01T00:00:00.000Z');

  if (conAsignaciones) {
    const asig = db.prepare('INSERT INTO staff_services (id, tenant_id, staff_id, service_id) VALUES (?, ?, ?, ?)');
    asig.run('asg_1', 'ten_pelu', 'per_pelu_1', 'srv_pelu_corte');
    asig.run('asg_2', 'ten_pelu', 'per_pelu_1', 'srv_pelu_barba');
    // crm queda sin asignaciones a propósito.
  }

  const cliente = db.prepare(
    `INSERT INTO customers (id, tenant_id, name, phone, email, notes, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  cliente.run('cli_pelu_1', 'ten_pelu', 'Ana Torres', '+52 55 2222 1001', 'ana@example.com', null, null, '2026-01-01T00:00:00.000Z');
  // Sin email: el recordatorio por email no tiene a quién dirigirse.
  cliente.run('cli_pelu_2', 'ten_pelu', 'Pedro Ortiz', '+52 55 2222 1004', null, null, null, '2026-01-01T00:00:00.000Z');
  cliente.run('cli_crm_1', 'ten_crm', 'María Sosa', '+52 55 5555 4001', 'maria@example.com', null, 'vip', '2026-01-01T00:00:00.000Z');
  // Mismo nombre y email que cli_crm_1, pero en otro tenant: es otra
  // organización, y decidir que son la misma persona es del negocio.
  cliente.run('cli_crm_2', 'ten_crm', 'María Sosa', '+52 55 5555 4099', 'maria@example.com', null, null, '2026-01-01T00:00:00.000Z');

  const cita = db.prepare(
    `INSERT INTO appointments (id, tenant_id, customer_id, staff_id, resource_id, start_at, end_at, notes, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  cita.run('cit_1', 'ten_pelu', 'cli_pelu_1', 'per_pelu_1', null, '2026-09-23T12:00:00.000Z', '2026-09-23T12:30:00.000Z', null, 'confirmed', '2026-09-23T05:00:00.000Z');
  cita.run('cit_2', 'ten_pelu', 'cli_pelu_2', 'per_pelu_1', null, '2026-09-23T13:00:00.000Z', '2026-09-23T13:45:00.000Z', 'la clienta pidió wash', estadosRaros ? 'rescheduled' : 'pending', '2026-09-23T05:00:00.000Z');
  cita.run('cit_3', 'ten_crm', 'cli_crm_1', 'per_crm_1', null, '2026-09-24T15:00:00.000Z', '2026-09-24T17:00:00.000Z', null, 'confirmed', '2026-09-23T05:00:00.000Z');

  if (citaConRecurso) {
    cita.run('cit_espacio', 'ten_pelu', 'cli_pelu_1', null, 'cancha_1', '2026-09-25T10:00:00.000Z', '2026-09-25T11:00:00.000Z', null, 'confirmed', '2026-09-23T05:00:00.000Z');
  }

  const linea = db.prepare(
    `INSERT INTO appointment_services (id, tenant_id, appointment_id, service_id, price_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  if (preciosCoherentes) {
    // El precio de la cita es el del catálogo: la fuente es consistente y el
    // factor se deduce como 1 (o sea, sin convertir).
    linea.run('lin_1', 'ten_pelu', 'cit_1', 'srv_pelu_corte', 120);
    linea.run('lin_2', 'ten_pelu', 'cit_2', 'srv_pelu_barba', 180);
    linea.run('lin_3', 'ten_crm', 'cit_3', 'srv_crm_color', 980);
  } else {
    // El mismo servicio a dos precios, y otro con un precio que no corresponde a
    // nada: el catálogo y las citas no cuentan la misma historia.
    linea.run('lin_1', 'ten_pelu', 'cit_1', 'srv_pelu_corte', 120);
    linea.run('lin_2', 'ten_pelu', 'cit_2', 'srv_pelu_barba', 12000);
    linea.run('lin_3', 'ten_crm', 'cit_3', 'srv_crm_color', 980);
  }

  // Dos intentos de email para la MISMA cita, y uno de whatsapp. Los tres
  // fallaron: el legacy no tenía SMTP ni webhook configurados.
  const recordatorio = db.prepare(
    `INSERT INTO reminder_logs (id, tenant_id, appointment_id, channel, status, error, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  recordatorio.run('rec_1', 'ten_pelu', 'cit_1', 'email', 'failed', 'SMTP no configurado', '2026-09-23T17:07:30.456Z');
  recordatorio.run('rec_2', 'ten_pelu', 'cit_1', 'email', 'failed', 'SMTP no configurado', '2026-09-23T17:37:12.558Z');
  recordatorio.run('rec_3', 'ten_pelu', 'cit_1', 'whatsapp', 'failed', 'WhatsApp webhook no configurado', '2026-09-23T17:37:12.599Z');

  db.close();
}
