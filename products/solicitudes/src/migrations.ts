import Database from 'better-sqlite3';
import { hasTable, tableColumns, type Migration } from '@amg/product-runtime';

/**
 * Migraciones de solicitudes.
 *
 * El runtime corre las migraciones ANTES del DDL y una sola vez por version
 * (registro en `amg_migrations`). Por eso cada paso mira primero si la base es
 * vieja o nueva con `hasTable`, y si no hay tablas, no hace nada: la base nueva
 * la construye el DDL tal cual.
 *
 * La version 2 agrega el area o cliente del solicitante y alinea los estados al
 * flujo de la mesa de ayuda: recibida, asignada, en proceso, completada y
 * cancelada. Los estados viejos se reescriben en `requests` y en
 * `status_history`, para que el historial no quede contando estados que ya no
 * existen.
 */
export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'area o cliente y estados de la mesa de ayuda',
    up(sqlite: Database.Database) {
      // Base nueva: el DDL que corre despues crea todo con la forma actual.
      if (!hasTable(sqlite, 'requests')) return;

      // SQLite no admite `ADD COLUMN IF NOT EXISTS`: la columna se agrega solo
      // si falta.
      if (!tableColumns(sqlite, 'requests').includes('requester_area')) {
        sqlite.exec(`ALTER TABLE requests ADD COLUMN requester_area TEXT;`);
      }

      // Los estados viejos pasan a los nuevos. `resolved` y `closed` eran el
      // cierre efectivo, asi que los dos son `completed`.
      sqlite.exec(`
        UPDATE requests SET status = 'received'  WHERE status = 'open';
        UPDATE requests SET status = 'completed' WHERE status IN ('resolved', 'closed');

        UPDATE status_history SET old_status = 'received'  WHERE old_status = 'open';
        UPDATE status_history SET old_status = 'completed' WHERE old_status IN ('resolved', 'closed');
        UPDATE status_history SET new_status = 'received'  WHERE new_status = 'open';
        UPDATE status_history SET new_status = 'completed' WHERE new_status IN ('resolved', 'closed');
      `);

      // Una solicitud que queda completada tiene que mostrar cuando se cerro.
      // Las que venian de `resolved` no traian `closed_at` (no era terminal),
      // asi que se rellena con lo ultimo que se sabe de ellas.
      sqlite.exec(`
        UPDATE requests
        SET closed_at = COALESCE(closed_at, updated_at, created_at)
        WHERE status = 'completed' AND closed_at IS NULL;
      `);
    },
  },
];
