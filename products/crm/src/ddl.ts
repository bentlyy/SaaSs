/**
 * DDL de clientes: ficha de cliente, seguimientos y contacto.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * Las FKs de `followups` y `interactions` a `customers` son ON DELETE CASCADE,
 * para que cuando se borra un cliente se borren sus seguimientos e historial sin
 * que el codigo tenga que acordarse.
 *
 * Los nombres de indice son EXACTAMENTE los que aparecen en `schema.ts`.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  company TEXT,
  kind TEXT NOT NULL DEFAULT 'persona',
  email TEXT,
  phone TEXT,
  tax_id TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  tags TEXT,
  birthday TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clientes_customers_org ON customers(organization_id, archived_at, name);

CREATE TABLE IF NOT EXISTS followups (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clientes_followups_org ON followups(organization_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_clientes_followups_customer ON followups(customer_id);

CREATE TABLE IF NOT EXISTS interactions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'nota',
  summary TEXT NOT NULL,
  happened_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_clientes_interactions_org ON interactions(organization_id, happened_at);
CREATE INDEX IF NOT EXISTS idx_clientes_interactions_customer ON interactions(customer_id, happened_at);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_settings_org ON settings(organization_id);
`;