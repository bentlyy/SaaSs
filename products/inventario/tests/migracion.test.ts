import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRACIONES } from '../src/migrations.js';

/**
 * La migración vista en su caso real: una base que YA existe con la forma
 * vieja, no una base nueva (esa la construye el DDL y la migración ni corre).
 *
 * Se llama al `up` directamente para no depender de la config del runtime: lo
 * que se prueba acá es que los `ALTER TABLE` dejen los datos viejos intactos y
 * la forma nueva lista.
 */
const dir = mkdtempSync(join(tmpdir(), 'amg-inventario-migracion-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const v2 = MIGRACIONES.find((m) => m.version === 2)!;

function baseVieja(path: string): Database.Database {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE items (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, sku TEXT,
      quantity INTEGER NOT NULL DEFAULT 0, min_quantity INTEGER NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'unidad', price_cents INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT, archived_at TEXT
    );
    CREATE TABLE movements (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      delta INTEGER NOT NULL, reason TEXT NOT NULL, actor_user_id TEXT, actor_name TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE settings (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, default_unit TEXT NOT NULL DEFAULT 'unidad',
      default_min_quantity INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT '$',
      created_at TEXT NOT NULL, updated_at TEXT
    );
    INSERT INTO items (id, organization_id, name, sku, quantity, created_at)
      VALUES ('itm_viejo', 'org_alpha', 'Artículo viejo', 'VIEJO-1', 7, '2025-01-01T00:00:00.000Z');
    INSERT INTO settings (id, organization_id, created_at)
      VALUES ('set_viejo', 'org_alpha', '2025-01-01T00:00:00.000Z');
  `);
  return sqlite;
}

const columnas = (sqlite: Database.Database, tabla: string) =>
  (sqlite.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('migración v2 sobre una base vieja', () => {
  it('agrega las columnas nuevas sin tocar los datos existentes', () => {
    const sqlite = baseVieja(join(dir, 'uno.sqlite'));
    v2.up(sqlite);

    expect(columnas(sqlite, 'items')).toContain('barcode');
    expect(columnas(sqlite, 'items')).toContain('category_id');
    expect(columnas(sqlite, 'settings')).toContain('allow_negative_stock');

    const item = sqlite.prepare(`SELECT name, quantity, barcode, category_id FROM items WHERE id='itm_viejo'`).get() as {
      name: string;
      quantity: number;
      barcode: string | null;
      category_id: string | null;
    };
    expect(item).toMatchObject({ name: 'Artículo viejo', quantity: 7, barcode: null, category_id: null });

    expect(
      sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_items_org_barcode'`).get(),
    ).toBeTruthy();
    expect(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='categories'`).get()).toBeTruthy();

    sqlite.close();
  });

  it('correrla de nuevo no rompe: es segura aunque el registro falle', () => {
    const sqlite = baseVieja(join(dir, 'dos.sqlite'));
    v2.up(sqlite);
    expect(() => v2.up(sqlite)).not.toThrow();
    sqlite.close();
  });
});
