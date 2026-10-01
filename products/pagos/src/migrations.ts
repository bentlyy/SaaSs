import Database from 'better-sqlite3';
import { hasTable, type Migration } from '@amg/product-runtime';

/**
 * Migraciones de pagos.
 *
 * La version 2 agrega `charge_refunds`: la tabla donde se registra la plata que
 * sale despues de haber entrado.
 *
 * Es aditiva y no toca una fila existente: hasta ahora no habia forma de devolver
 * un abono, asi que las bases que ya tienen cartera no pueden tener devoluciones
 * registradas. Los dos 409 de la API (borrar y cancelar un cargo con plata cobrada)
 * dicen que hay que devolver la plata antes, y sin esta tabla ese consejo no lo
 * podia cumplir nadie.
 */
export const MIGRACIONES: Migration[] = [
  {
    version: 2,
    name: 'devoluciones de abonos',
    up(sqlite: Database.Database) {
      // Base nueva: el DDL que corre despues crea todo con la forma actual.
      if (!hasTable(sqlite, 'charges')) return;

      sqlite.exec(`
        CREATE TABLE IF NOT EXISTS charge_refunds (
          id TEXT PRIMARY KEY,
          organization_id TEXT NOT NULL,
          charge_id TEXT NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
          amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
          reason TEXT NOT NULL,
          method TEXT NOT NULL DEFAULT 'other',
          reference TEXT,
          refunded_at TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pagos_charge_refunds_charge ON charge_refunds(charge_id);
        CREATE INDEX IF NOT EXISTS idx_pagos_charge_refunds_org_refunded ON charge_refunds(organization_id, refunded_at);
      `);
    },
  },
];