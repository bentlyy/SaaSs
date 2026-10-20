import Database from 'better-sqlite3';
import { hasTable, tableColumns, type Migration } from '@amg/product-runtime';

/**
 * Migraciones de cotizaciones.
 *
 * La version 2 agrega los datos que faltaban para emitir una cotizacion
 * completa: telefono del cliente, descuento comercial e identidad de la empresa
 * para el PDF. Todas son columnas nuevas con valor por defecto, asi que una base
 * con cotizaciones cargadas no pierde ninguna fila.
 *
 * Como el runtime corre las migraciones ANTES del DDL, una base nueva no tiene
 * `quotes`: en ese caso no hay nada que alterar y el DDL que viene despues crea
 * todo con la forma actual.
 */
export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'datos del cliente, descuento e identidad comercial',
    up(sqlite: Database.Database) {
      if (hasTable(sqlite, 'quotes')) {
        const columnas = tableColumns(sqlite, 'quotes');
        if (!columnas.includes('customer_phone')) {
          sqlite.exec(`ALTER TABLE quotes ADD COLUMN customer_phone TEXT;`);
        }
        if (!columnas.includes('discount_cents')) {
          sqlite.exec(`ALTER TABLE quotes ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0;`);
        }
      }

      if (hasTable(sqlite, 'settings')) {
        const columnas = tableColumns(sqlite, 'settings');
        const nuevas: Array<[string, string]> = [
          ['business_name', 'TEXT'],
          ['business_tax_id', 'TEXT'],
          ['business_address', 'TEXT'],
          ['business_phone', 'TEXT'],
          ['business_email', 'TEXT'],
        ];
        for (const [columna, tipo] of nuevas) {
          if (!columnas.includes(columna)) {
            sqlite.exec(`ALTER TABLE settings ADD COLUMN ${columna} ${tipo};`);
          }
        }
      }
    },
  },
];
