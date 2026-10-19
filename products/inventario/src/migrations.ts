import Database from 'better-sqlite3';
import { hasTable, tableColumns, type Migration } from '@amg/product-runtime';

/**
 * Migraciones del inventario.
 *
 * El runtime corre las migraciones ANTES del DDL y una sola vez por version
 * (registro en `amg_migrations`). Por eso cada paso mira primero si la base es
 * vieja o nueva: si no hay `items`, la base la construye el DDL que corre
 * despues, ya con la forma actual, y la migracion no hace nada.
 *
 * La version 2 agrega el codigo de barras (leido por el escaner), la categoria
 * del articulo y la opcion de permitir stock negativo. Son columnas nuevas, no
 * un cambio de tipo: SQLite no tiene `ADD COLUMN IF NOT EXISTS`, asi que se
 * agregan solo si faltan.
 */
export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'codigo de barras, categorias y stock negativo',
    up(sqlite: Database.Database) {
      // Base nueva: el DDL que corre despues crea todo con la forma actual.
      if (!hasTable(sqlite, 'items')) return;

      // `categories` se crea por DDL mas tarde, pero la columna `category_id`
      // apunta a ella: se crea aca primero para que la referencia sea valida
      // en el momento del ALTER. El `IF NOT EXISTS` la hace convivir con el DDL.
      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_categories_org ON categories(organization_id, name);
      `);

      const columnas = tableColumns(sqlite, 'items');
      if (!columnas.includes('barcode')) {
        sqlite.exec(`ALTER TABLE items ADD COLUMN barcode TEXT;`);
      }
      if (!columnas.includes('category_id')) {
        sqlite.exec(`ALTER TABLE items ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL;`);
      }

      // Unico y parcial: un articulo viejo no tiene codigo de barras (NULL), y
      // eso no choca con ningun otro. Recien cuando hay codigo se exige que no
      // se repita dentro de la organizacion.
      sqlite.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_items_org_barcode
          ON items(organization_id, barcode)
          WHERE barcode IS NOT NULL AND barcode <> '';
      `);

      if (hasTable(sqlite, 'settings') && !tableColumns(sqlite, 'settings').includes('allow_negative_stock')) {
        sqlite.exec(`ALTER TABLE settings ADD COLUMN allow_negative_stock INTEGER NOT NULL DEFAULT 0;`);
      }
    },
  },
];
