import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openProductDb, type Migration } from '../src/db.js';
import { loadProductConfig } from '../src/config.js';

/**
 * La base del producto.
 *
 * Lo que importa probar aca es lo que un producto no puede verificar a ojo: que
 * una migracion corra UNA vez y no en cada arranque, que una migracion fallen
 * sin dejar la base a medias, y que el DDL del producto no dependa de un schema
 * compartido.
 */

const DDL = `CREATE TABLE IF NOT EXISTS cosas (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);`;

let dir: string;

/** `schemaVersion` sale del entorno del producto, que es la unica fuente. */
const configCon = (schemaVersion: number, dbPath = join(dir, 'prueba.sqlite')) =>
  loadProductConfig('prueba', 'Producto de Prueba', { DB_PATH: dbPath, DB_SCHEMA_VERSION: String(schemaVersion) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amg-runtime-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const abrire = (schemaVersion: number, migrations: Migration[] = []) =>
  openProductDb(configCon(schemaVersion), { ddl: DDL, schema: {}, migrations, quiet: true });

describe('migraciones', () => {
  it('crea el registro y aplica lo pendiente', () => {
    const db = abrire(1, [{ version: 1, name: 'primera', up: (s) => s.exec('CREATE TABLE a (id TEXT)') }]);
    const aplicadas = db.sqlite.prepare('SELECT version, name FROM amg_migrations ORDER BY version').all();
    expect(aplicadas).toEqual([{ version: 1, name: 'primera' }]);
    db.close();
  });

  it('NO repite una migracion al reabrir la base', () => {
    // Un `up` que no es idempotente: si el runtime lo corriera dos veces,
    // el segundo arranque reventaria. Es justo el caso que el registro evita.
    let corridas = 0;
    const migracion: Migration = {
      version: 1,
      up: (s) => {
        corridas += 1;
        s.exec('CREATE TABLE solo_una_vez (id TEXT PRIMARY KEY)');
      },
    };

    abrire(1, [migracion]).close();
    expect(corridas).toBe(1);

    abrire(1, [migracion]).close();
    expect(corridas).toBe(1);
  });

  it('respeta el orden de version, no el del array', () => {
    const orden: number[] = [];
    const db = abrire(3, [
      { version: 3, up: () => void orden.push(3) },
      { version: 1, up: () => void orden.push(1) },
      { version: 2, up: () => void orden.push(2) },
    ]);
    expect(orden).toEqual([1, 2, 3]);
    db.close();
  });

  it('no aplica migraciones por encima del schemaVersion del producto', () => {
    const db = abrire(1, [
      { version: 1, up: (s) => s.exec('CREATE TABLE v1 (id TEXT)') },
      { version: 2, up: (s) => s.exec('CREATE TABLE v2 (id TEXT)') },
    ]);
    const nombres = db.sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'v%' ORDER BY name`)
      .all();
    expect(nombres).toEqual([{ name: 'v1' }]);
    db.close();
  });

  it('una migracion que falla no se registra y corta el arranque', () => {
    const mala: Migration = {
      version: 1,
      name: 'rota',
      up: (s) => {
        s.exec('CREATE TABLE a_medias (id TEXT)');
        s.exec('esto no es sql');
      },
    };
    expect(() => abrire(1, [mala])).toThrow(/Migracion 1 \(rota\)/);

    // Y no quedo registrada: al reintentar, vuelve a correr y vuelve a fallar.
    const db = openProductDb(configCon(1), { ddl: DDL, schema: {}, quiet: true });
    const registradas = db.sqlite.prepare('SELECT COUNT(*) AS n FROM amg_migrations').get() as { n: number };
    expect(Number(registradas.n)).toBe(0);
    db.close();
  });
});

describe('la base del producto', () => {
  it('crea el archivo y la carpeta si no existen', () => {
    const destino = join(dir, 'a', 'b', 'prueba.sqlite');
    const db = openProductDb(configCon(1, destino), { ddl: DDL, schema: {}, quiet: true });
    expect(db.path).toBe(destino);
    expect(db.sqlite.name).toContain('prueba.sqlite');
    db.close();
  });

  it('prende las claves foraneas', () => {
    // Sin esto, `ON DELETE CASCADE` no borra nada y se acumulan huerfanas.
    const db = abrire(1);
    const fk = db.sqlite.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
    db.close();
  });

  it('crea solo las tablas que el producto declara', () => {
    const db = abrire(1);
    const tablas = (db.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>)
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_'))
      .sort();
    expect(tablas).toEqual(['amg_migrations', 'cosas']);
    db.close();
  });
});
