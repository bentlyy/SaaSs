import Database from 'better-sqlite3';
import { hasTable, tableColumns, type Migration } from '@amg/product-runtime';

/**
 * Migraciones de activos.
 *
 * La version 2 agrega la fecha de vencimiento de la garantia al bien y la foto
 * de responsable/ubicacion a cada movimiento. Las tres son columnas nuevas que
 * aceptan NULL, asi que una base con activos e historial cargados no pierde
 * ninguna fila: los movimientos viejos quedan sin esos datos, que es
 * exactamente lo que se sabe de ellos.
 *
 * El runtime corre las migraciones ANTES del DDL. En una base nueva las tablas
 * todavia no existen, y el DDL que viene despues las crea ya con la forma
 * actual; por eso cada ALTER mira primero si la tabla esta.
 */
export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'garantia y detalle de movimientos',
    up(sqlite: Database.Database) {
      if (hasTable(sqlite, 'assets')) {
        const columnas = tableColumns(sqlite, 'assets');
        if (!columnas.includes('warranty_until')) {
          sqlite.exec(`ALTER TABLE assets ADD COLUMN warranty_until TEXT;`);
        }
      }

      if (hasTable(sqlite, 'asset_movements')) {
        const columnas = tableColumns(sqlite, 'asset_movements');
        if (!columnas.includes('assigned_to')) {
          sqlite.exec(`ALTER TABLE asset_movements ADD COLUMN assigned_to TEXT;`);
        }
        if (!columnas.includes('location')) {
          sqlite.exec(`ALTER TABLE asset_movements ADD COLUMN location TEXT;`);
        }
      }
    },
  },
];
