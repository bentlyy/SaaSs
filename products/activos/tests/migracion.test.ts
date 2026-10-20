import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { MIGRACIONES } from '../src/migrations.js';

/**
 * La migracion vista sobre una base que YA existe con la forma vieja: la que
 * tenia garantia sin fecha y movimientos sin responsable/ubicacion.
 *
 * Se llama al `up` directamente para no depender de la config del runtime. Lo
 * que se prueba es que los ALTER dejen los datos viejos intactos y la forma
 * nueva lista; una base nueva la construye el DDL y la migracion ni corre.
 */
const dir = mkdtempSync(join(tmpdir(), 'amg-activos-migracion-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const v2 = MIGRACIONES.find((m) => m.version === 2)!;

function baseVieja(path: string): Database.Database {
  const sqlite = new Database(path);
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE assets (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL, brand TEXT, model TEXT, serial TEXT,
      status TEXT NOT NULL DEFAULT 'active', location TEXT, assigned_to TEXT, purchase_date TEXT,
      cost_cents INTEGER NOT NULL DEFAULT 0, notes TEXT, archived_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE asset_movements (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL,
      asset_id TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, note TEXT, happened_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    INSERT INTO assets (id, organization_id, code, name, category, location, assigned_to, purchase_date, created_at)
      VALUES ('act_viejo', 'org_alpha', 'EQ-001', 'Taladro viejo', 'herramienta', 'Bodega', 'Ana', '2025-01-10', '2025-01-01T00:00:00.000Z');
    INSERT INTO asset_movements (id, organization_id, asset_id, kind, note, happened_at, created_at)
      VALUES ('actmov_viejo', 'org_alpha', 'act_viejo', 'checkout', 'Salio a obra', '2025-02-01T10:00:00.000Z', '2025-02-01T10:00:00.000Z');
  `);
  return sqlite;
}

const columnas = (sqlite: Database.Database, tabla: string) =>
  (sqlite.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>).map((c) => c.name);

describe('migracion v2 sobre una base vieja', () => {
  it('agrega garantia al activo y la foto del movimiento sin tocar las filas', () => {
    const sqlite = baseVieja(join(dir, 'uno.sqlite'));
    v2.up(sqlite);

    expect(columnas(sqlite, 'assets')).toContain('warranty_until');
    expect(columnas(sqlite, 'asset_movements')).toContain('assigned_to');
    expect(columnas(sqlite, 'asset_movements')).toContain('location');

    const activo = sqlite
      .prepare(`SELECT name, location, assigned_to, purchase_date, warranty_until FROM assets WHERE id='act_viejo'`)
      .get() as {
      name: string;
      location: string;
      assigned_to: string;
      purchase_date: string;
      warranty_until: string | null;
    };
    expect(activo).toMatchObject({
      name: 'Taladro viejo',
      location: 'Bodega',
      assigned_to: 'Ana',
      purchase_date: '2025-01-10',
      warranty_until: null,
    });

    const movimiento = sqlite
      .prepare(`SELECT kind, note, assigned_to, location FROM asset_movements WHERE id='actmov_viejo'`)
      .get() as { kind: string; note: string; assigned_to: string | null; location: string | null };
    expect(movimiento).toMatchObject({
      kind: 'checkout',
      note: 'Salio a obra',
      assigned_to: null,
      location: null,
    });

    sqlite.close();
  });

  it('correrla de nuevo no rompe', () => {
    const sqlite = baseVieja(join(dir, 'dos.sqlite'));
    v2.up(sqlite);
    expect(() => v2.up(sqlite)).not.toThrow();
    sqlite.close();
  });
});
