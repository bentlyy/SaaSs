/**
 * DDL de activos: el patrimonio, su historial y las preferencias.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * La FK de `asset_movements` a `assets` es ON DELETE CASCADE, para que cuando un
 * activo se borra de verdad se borren sus movimientos sin que ningun codigo
 * tenga que acordarse. La API NO borra en cascada: un activo con historial
 * devuelve 409 y ofrece archivar, y el CASCADE queda para la baja definitiva.
 *
 * `cost_cents` es INTEGER, no REAL: es lo que hace que el patrimonio sume sin
 * arrastrar errores de coma flotante.
 *
 * Los nombres de indice son EXACTAMENTE los que aparecen en `schema.ts`.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  serial TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  location TEXT,
  assigned_to TEXT,
  purchase_date TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activos_assets_org_code ON assets(organization_id, code);
CREATE INDEX IF NOT EXISTS idx_activos_assets_org_status_category ON assets(organization_id, status, category);

CREATE TABLE IF NOT EXISTS asset_movements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  note TEXT,
  happened_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activos_movements_org_asset_time ON asset_movements(organization_id, asset_id, happened_at);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_activos_settings_org ON settings(organization_id);
`;
