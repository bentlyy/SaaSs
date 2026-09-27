/**
 * DDL de solicitudes. Siete tablas de negocio y una de auditoria de la migracion.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * El indice UNICO de `orders` es `(organization_id, number)` y no `number` solo.
 * El folio es por empresa: si fuera global, la empresa B no podria tener una
 * orden 1 si la empresa A ya la tiene, y en la practica las dos empiezan en 1.
 *
 * `order_parts.item_id` NO lleva llave foranea, a proposito: los repuestos viven
 * en la base de `inventario`, que es OTRA base. SQLite no valida FK entre bases,
 * asi que declararla daria la sensacion de integridad sinla.
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
CREATE INDEX IF NOT EXISTS idx_solicitudes_customers_org ON customers(organization_id, archived_at, name);

CREATE TABLE IF NOT EXISTS services (
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
CREATE INDEX IF NOT EXISTS idx_solicitudes_services_org ON services(organization_id, active, name);

CREATE TABLE IF NOT EXISTS technicians (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  color TEXT NOT NULL DEFAULT '#4f46e5',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_technicians_org ON technicians(organization_id, active, name);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  technician_id TEXT REFERENCES technicians(id) ON DELETE SET NULL,
  asset TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  estimated_delivery TEXT,
  notes TEXT,
  total_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_orders_org ON orders(organization_id, created_at);
-- El folio es por organizacion. Unico porque dos ordenes con el mismo numero en
-- la misma empresa no se pueden distinguir al leerlas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_orders_org_number ON orders(organization_id, number);
-- El tablero: "que hay abierto" es la consulta que hace la pantalla todo el dia.
CREATE INDEX IF NOT EXISTS idx_solicitudes_orders_status ON orders(organization_id, status, created_at);

CREATE TABLE IF NOT EXISTS order_services (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_order_services_org ON order_services(organization_id, order_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_order_services_order ON order_services(order_id);

CREATE TABLE IF NOT EXISTS order_parts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Referencia suelta al producto \`inventario\`: es otra base de datos.
  item_id TEXT NOT NULL,
  -- Copia del nombre al momento de armar la linea, para que la orden se pueda
  -- leer aunque el repuesto se renombre o se de de baja.
  item_name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_order_parts_org ON order_parts(organization_id, order_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_order_parts_order ON order_parts(order_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_order_parts_item ON order_parts(item_id);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  next_number INTEGER NOT NULL DEFAULT 1,
  status_labels TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Una fila por organizacion: el indice unico es lo que evita que dos personas
-- guardando la configuracion a la vez dejen dos filas compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_settings_org ON settings(organization_id);

CREATE TABLE IF NOT EXISTS legacy_tenant_map (
  legacy_tenant_id TEXT PRIMARY KEY,
  legacy_slug TEXT NOT NULL,
  legacy_name TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  migrated_at TEXT NOT NULL
);
`;
