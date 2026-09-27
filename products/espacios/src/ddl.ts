/**
 * DDL de espacios. Seis tablas de negocio y una de auditoría de la migración.
 *
 * Cada `organization_id` lleva su índice: sin él, el filtro por organización
 * —obligatorio en todas las consultas— se vuelve un barrido de tabla completa.
 *
 * El índice compuesto de `bookings` está en ese orden a propósito. La consulta que
 * este producto hace todo el tiempo es "¿qué hay reservado en este espacio entre
 * estas dos horas?", y el índice la resuelve sola; con el orden inverso no la
 * ayuda en nada.
 *
 * El DDL corre en cada arranque con `IF NOT EXISTS`, así que agregar una tabla es
 * aditivo sobre una base ya creada. Para cambiar algo que ya existe (una columna,
 * un tipo) hay que usar `migrations`, que corren una sola vez.
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
CREATE INDEX IF NOT EXISTS idx_espacios_customers_org ON customers(organization_id, archived_at, name);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'sala',
  capacity INTEGER NOT NULL DEFAULT 1,
  price_per_hour_cents INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#0891b2',
  active INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_espacios_spaces_org ON spaces(organization_id, active, name);

CREATE TABLE IF NOT EXISTS addons (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 0,
  price_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_espacios_addons_org ON addons(organization_id, active, name);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE RESTRICT,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Disponibilidad: reservas de un espacio en una franja de horario. Es la consulta
-- que decide si se puede reservar, así que el índice está en (espacio, inicio).
CREATE INDEX IF NOT EXISTS idx_espacios_bookings_org ON bookings(organization_id, start_at);
CREATE INDEX IF NOT EXISTS idx_espacios_bookings_space_time ON bookings(space_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_espacios_bookings_customer ON bookings(customer_id, start_at);
CREATE INDEX IF NOT EXISTS idx_espacios_bookings_status ON bookings(organization_id, status, start_at);

CREATE TABLE IF NOT EXISTS booking_addons (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  addon_id TEXT NOT NULL REFERENCES addons(id) ON DELETE RESTRICT,
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_espacios_booking_addons_org ON booking_addons(organization_id, booking_id);
CREATE INDEX IF NOT EXISTS idx_espacios_booking_addons_booking ON booking_addons(booking_id);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  opening_minutes INTEGER NOT NULL DEFAULT 480,
  closing_minutes INTEGER NOT NULL DEFAULT 1320,
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  min_advance_minutes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Una fila por organización: el índice único es lo que evita que dos personas
-- guardando la configuración a la vez dejen dos filas compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_espacios_settings_org ON settings(organization_id);

CREATE TABLE IF NOT EXISTS legacy_tenant_map (
  legacy_tenant_id TEXT PRIMARY KEY,
  legacy_slug TEXT NOT NULL,
  legacy_name TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL
);
`;
