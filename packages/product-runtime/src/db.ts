import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { logger } from './logger.js';
import type { ProductConfig } from './config.js';

/**
 * El mapa de tablas que declara el producto: `{ items, movements }`.
 *
 * El tipo es `Record<string, unknown>` a proposito, y no "tipo de tabla": es lo
 * que espera drizzle, y como el runtime nunca inspecciona el schema (solo se lo
 * pasa a drizzle) no necesita saber nada de las columnas. Intentar tiparlo como
 * `AnySQLiteTable` no compila: una tabla con columnas no es asignable a la
 * versión genérica de sí misma.
 */
export type ProductSchema = Record<string, unknown>;

export interface ProductDb {
  sqlite: Database.Database;
  db: BetterSQLite3Database<any>;
  schema: ProductSchema;
  path: string;
  close: () => void;
}

export interface Migration {
  version: number;
  /** Solo para el log de arranque. */
  name?: string;
  up: (sqlite: Database.Database) => void;
}

export interface OpenOptions {
  /** Sentencias CREATE TABLE/INDEX de ESTE producto. Nada mas. */
  ddl: string;
  schema: ProductSchema;
  /** Migraciones en orden. Cada una corre una sola vez (ver `amg_migrations`). */
  migrations?: Migration[];
  /** Silencia el log de "base lista" (util en tests). */
  quiet?: boolean;
}

/**
 * Abre la base DEL PRODUCTO.
 *
 * Deliberadamente no acepta un schema compartido: cada producto define el suyo
 * con las tablas que necesita y nada mas. Antes, los nueve productos declaraban
 * las mismas 18 tablas y cada una usaba tres o cuatro; hoy el aislamiento es
 * tambien una cuestion de superficie: un producto que no declara `customers` no
 * puede ni consultarla.
 *
 * `foreign_keys = ON` porque sin eso SQLite ignora las referencias y `onDelete`
 * no ocurre: se acumulan filas huerfanas en vez de borrarse.
 */
export function openProductDb(config: ProductConfig, options: OpenOptions): ProductDb {
  const path = config.dbPath === ':memory:' ? ':memory:' : resolve(config.dbPath);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Si algo sale mal, el handle se cierra antes de propagar el error: si no,
  // el archivo queda tomado y despues ni se puede borrar ni reiniciar.
  try {
    runMigrations(sqlite, options.migrations ?? [], config.schemaVersion);
    sqlite.exec(options.ddl);
  } catch (err) {
    sqlite.close();
    throw err;
  }

  if (!options.quiet) {
    logger.info(`Base de ${config.slug} lista en ${path} (schema v${config.schemaVersion})`);
  }

  const db = drizzle(sqlite, { schema: options.schema });

  return {
    sqlite,
    db,
    schema: options.schema,
    path,
    close: () => sqlite.close(),
  };
}

/**
 * Corre las migraciones pendientes, una vez cada una.
 *
 * El registro va en `amg_migrations`, dentro de la misma base del producto. Se
 * podria confiar en que cada `up` sea idempotente, pero entonces un `ALTER TABLE`
 * sin `IF NOT EXISTS` (que SQLite no tiene) fallaria en el segundo arranque, y
 * un producto con datos reales no se puede probar reiniciandolo. Con el registro
 * cada migracion corre exactamente una vez y el DDL puede ser tan simple como la
 * verdad.
 *
 * Cada `up` corre en su transaccion: si falla, no queda registrada, y el
 * arranque se corta. Seguir con una base a medio migrar es peor que no
 * arrancar.
 */
function runMigrations(sqlite: Database.Database, migrations: Migration[], schemaVersion: number): void {
  sqlite.exec(`CREATE TABLE IF NOT EXISTS amg_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT,
    applied_at TEXT NOT NULL
  );`);

  const aplicadas = new Set(
    (sqlite.prepare(`SELECT version FROM amg_migrations`).all() as Array<{ version: number }>).map((r) => r.version),
  );
  const registrar = sqlite.prepare(`INSERT INTO amg_migrations (version, name, applied_at) VALUES (?, ?, ?)`);

  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (migration.version > schemaVersion) continue;
    if (aplicadas.has(migration.version)) continue;

    const correr = sqlite.transaction(() => {
      migration.up(sqlite);
      registrar.run(migration.version, migration.name ?? null, new Date().toISOString());
    });
    try {
      correr();
    } catch (err) {
      throw new Error(
        `Migracion ${migration.version}${migration.name ? ` (${migration.name})` : ''} de ${sqlite.name} fallo: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/** ¿Existe la tabla? Se usa para decidir si una base viene de la epoca anterior. */
export function hasTable(sqlite: Database.Database, table: string): boolean {
  const row = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(table);
  return Boolean(row);
}

export function tableColumns(sqlite: Database.Database, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

/**
 * Copia una tabla a otra y renombra columnas. Se usa para migrar de la epoca
 * `tenants` a la epoca `organizations` sin perder una fila.
 */
export function copyTable(
  sqlite: Database.Database,
  from: string,
  to: string,
  columns: Record<string, string>,
): void {
  const cols = tableColumns(sqlite, from);
  const pairs = Object.entries(columns).filter(([from_col]) => cols.includes(from_col));
  if (pairs.length === 0) return;
  const list = pairs.map(([f, t]) => `${f} AS ${t}`).join(', ');
  sqlite.exec(`INSERT OR IGNORE INTO ${to} (${pairs.map(([, t]) => t).join(', ')}) SELECT ${list} FROM ${from};`);
}
