import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { logger } from '@saas-mini/core';
import { platformConfig } from '../config.js';
import * as schema from './schema.js';

/**
 * DDL de core.sqlite.
 *
 * Aqui NO hay, y no debe haber, nada de negocio: ni clientes, ni inventario, ni
 * citas, ni órdenes, ni cotizaciones, ni activos, ni checklists, ni pagos de
 * clientes. Si alguna vez aparece una tabla así, es que se coló lógica de un
 * mini-SaaS en el Core y hay que sacarla (ver docs/DATA_ISOLATION.md).
 */
const DDL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  email_verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CLP',
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  status TEXT NOT NULL DEFAULT 'active',
  app_url TEXT,
  tagline TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_subscription_id TEXT,
  started_at TEXT,
  current_period_start TEXT,
  current_period_end TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_id TEXT REFERENCES subscriptions(id) ON DELETE SET NULL,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CLP',
  status TEXT NOT NULL DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_reference TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_ip TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending',
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE TABLE IF NOT EXISTS sso_clients (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  secret TEXT NOT NULL,
  redirect_uris TEXT NOT NULL DEFAULT '[]',
  logout_redirect_uris TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sso_codes (
  id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  return_url TEXT,
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target TEXT,
  metadata TEXT,
  ip TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_unique ON memberships(user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON subscriptions(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_product ON subscriptions(product_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_org ON payments(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sso_codes_hash ON sso_codes(code_hash);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_log(organization_id, created_at);
`;

/**
 * Agrega una columna si falta. `CREATE TABLE IF NOT EXISTS` no puede agregar
 * columnas a una tabla que ya existe, así que sobre una base vieja hay que
 * migrar ANTES del DDL o el arranque explota con "no such column".
 */
function ensureColumn(sqlite: Database.Database, table: string, column: string, ddl: string) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.length === 0) return;
  if (!cols.some((c) => c.name === column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

/**
 * Ensure de columnas para bases creadas en una version anterior de esta etapa.
 * Cada linea es idempotente: si la columna ya esta, no hace nada.
 */
const MIGRATIONS: Array<[string, string, string]> = [
  ['products', 'tagline', "TEXT DEFAULT ''"],
  ['products', 'app_url', 'TEXT'],
  ['products', 'sort_order', 'INTEGER NOT NULL DEFAULT 0'],
  ['sso_clients', 'logout_redirect_uris', "TEXT NOT NULL DEFAULT '[]'"],
];

export interface CoreDbHandle {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
}

let _db: CoreDbHandle | null = null;

export function createCoreDb(path = platformConfig.dbPath): CoreDbHandle {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  for (const [table, column, ddl] of MIGRATIONS) ensureColumn(sqlite, table, column, ddl);
  sqlite.exec(DDL);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

export function getCoreDb(): CoreDbHandle {
  if (!_db) {
    _db = createCoreDb();
    logger.info(`Base central lista en ${platformConfig.dbPath}`);
  }
  return _db;
}

/** Solo para tests: cierra y suelta el handle para abrir otra base. */
export function closeCoreDb(): void {
  if (_db) {
    _db.sqlite.close();
    _db = null;
  }
}

export type CoreDb = CoreDbHandle;
