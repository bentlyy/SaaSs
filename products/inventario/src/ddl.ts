/**
 * DDL del inventario. Cinco tablas de negocio y una de auditoría de la migración.
 *
 * Cada `organization_id` lleva su índice: sin él, el filtro por organización
 * —que es obligatorio en todas las consultas— se convierte en un barrido de
 * tabla completa, y con dos mil artículos por empresa eso se nota.
 *
 * El DDL se ejecuta en cada arranque con `IF NOT EXISTS`, así que agregar una
 * tabla es aditivo sobre una base ya creada. Para cambiar algo que ya existe
 * (una columna, un tipo) hay que usar `migrations`, que corren una sola vez.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_categories_org ON categories(organization_id, name);

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'unidad',
  price_cents INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  archived_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_items_org ON items(organization_id);
CREATE INDEX IF NOT EXISTS idx_items_org_name ON items(organization_id, name);
CREATE INDEX IF NOT EXISTS idx_items_org_active ON items(organization_id, archived_at, name);
-- Parcial: un articulo puede no tener codigo de barras, pero dos no pueden
-- compartir el mismo. El escaner usa este indice para saber a que articulo
-- corresponde lo que se leyo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_org_barcode ON items(organization_id, barcode) WHERE barcode IS NOT NULL AND barcode <> '';

CREATE TABLE IF NOT EXISTS movements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_movements_org ON movements(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_item ON movements(item_id, created_at);

CREATE TABLE IF NOT EXISTS scan_incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  barcode TEXT NOT NULL,
  note TEXT,
  actor_user_id TEXT,
  actor_name TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_incidents_org ON scan_incidents(organization_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  default_unit TEXT NOT NULL DEFAULT 'unidad',
  default_min_quantity INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT '$',
  allow_negative_stock INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Una fila por organizacion: el indice unico es lo que garantiza que dos
-- personas guardando la configuracion a la vez no leave dos filas compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_settings_org ON settings(organization_id);
`;
