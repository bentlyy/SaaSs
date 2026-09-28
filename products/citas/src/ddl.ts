/**
 * DDL de citas. Siete tablas de negocio y una de auditoría de la migración.
 *
 * Cada `organization_id` lleva su índice: sin él, el filtro por organización
 * —obligatorio en todas las consultas— se vuelve un barrido de tabla completa.
 *
 * Los índices compuestos de `appointments` están en ese orden a propósito: la
 * consulta que la agenda hace todo el tiempo es "las citas de esta organización
 * entre estas dos fechas, ordenadas por hora", y el índice la resuelve sola.
 *
 * El DDL corre en cada arranque con `IF NOT EXISTS`, así que agregar una tabla es
 * aditivo sobre una base ya creada. Para cambiar algo que ya existe (una
 * columna, un tipo) hay que usar `migrations`, que corren una sola vez.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  tags TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_citas_customers_org ON customers(organization_id, archived_at, name);
CREATE INDEX IF NOT EXISTS idx_citas_customers_email ON customers(organization_id, email);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 30,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_citas_services_org ON services(organization_id, active, name);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_citas_staff_org ON staff(organization_id, active, name);

CREATE TABLE IF NOT EXISTS staff_services (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_citas_staff_services_org ON staff_services(organization_id, staff_id);
CREATE INDEX IF NOT EXISTS idx_citas_staff_services_serv ON staff_services(service_id);

-- Horarios de atencion por profesional. El dia es el de JavaScript (0 = domingo)
-- y las horas van en minutos desde medianoche, como from/until.
CREATE TABLE IF NOT EXISTS availability (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- La consulta que importa es "en que atiende ESTE profesional el dia X": el
-- indice (profesional, dia) la resuelve y agrupa los rangos del dia.
CREATE INDEX IF NOT EXISTS idx_citas_availability_org ON availability(organization_id, staff_id, weekday);

-- Bloqueos puntuales: vacaciones, reuniones, cierres.
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citas_blocks_org ON blocks(organization_id, staff_id, start_at);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed',
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- La agenda: citas de una organización en una franja, por profesional.
CREATE INDEX IF NOT EXISTS idx_citas_appts_org_start ON appointments(organization_id, start_at);
CREATE INDEX IF NOT EXISTS idx_citas_appts_org_staff ON appointments(organization_id, staff_id, start_at);
CREATE INDEX IF NOT EXISTS idx_citas_appts_customer ON appointments(customer_id, start_at);
CREATE INDEX IF NOT EXISTS idx_citas_appts_status ON appointments(organization_id, status, start_at);

CREATE TABLE IF NOT EXISTS appointment_services (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
  service_name TEXT,
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_citas_appt_serv_org ON appointment_services(organization_id, appointment_id);
CREATE INDEX IF NOT EXISTS idx_citas_appt_serv_service ON appointment_services(service_id);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  appointment_id TEXT REFERENCES appointments(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'email',
  "to" TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_citas_reminders_org ON reminders(organization_id, sent_at);
-- Índice NO único, y a propósito.
--
-- Esta tabla es un BITÁCORA de intentos, no un registro de avisos: el legacy
-- guardaba un intento fallido y el reintento como dos filas de la misma cita y el
-- mismo canal, y con índice único el segundo intento no entraría. Un índice
-- único acá no protegería contra el correo duplicado (eso lo decide quién
-- envía, mirando el último intento), solo perdería historial.
CREATE INDEX IF NOT EXISTS idx_citas_reminders_appt ON reminders(appointment_id, channel);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  currency TEXT NOT NULL DEFAULT '$',
  reminder_hours INTEGER NOT NULL DEFAULT 12,
  email_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Una fila por organización: el índice único es lo que evita que dos personas
-- guardando la configuración a la vez leave dos filas compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_citas_settings_org ON settings(organization_id);
`;
