import Database from 'better-sqlite3';
import { hasTable, type Migration } from '@amg/product-runtime';

/**
 * Migraciones de espacios.
 *
 * El runtime corre las migraciones ANTES del DDL y una sola vez por version
 * (registro en `amg_migrations`). Por eso cada paso mira primero si la base es
 * vieja o nueva con `hasTable`, y si no hay tablas, no hace nada: la base nueva
 * la construye el DDL tal cual.
 *
 * La version 2 agrega los horarios de disponibilidad por espacio y los
 * bloqueos puntuales. Ambas tablas son aditivas: las bases que ya tienen datos
 * solo ganan dos tablas nuevas, sin tocar una fila existente.
 */
export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'horarios de disponibilidad y bloqueos por espacio',
    up(sqlite: Database.Database) {
      // Base nueva: el DDL que corre despues crea todo con la forma actual.
      if (!hasTable(sqlite, 'spaces')) return;

      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS availability (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          weekday INTEGER NOT NULL,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_espacios_availability_org ON availability(organization_id, space_id, weekday);

        CREATE TABLE IF NOT EXISTS blocks (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          space_id TEXT NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
          start_at TEXT NOT NULL,
          end_at TEXT NOT NULL,
          reason TEXT,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_espacios_blocks_org ON blocks(organization_id, space_id, start_at);
      `);
    },
  },
];