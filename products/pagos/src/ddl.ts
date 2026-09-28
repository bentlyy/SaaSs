/**
 * DDL de pagos: la cartera por cobrar, sus abonos y las preferencias.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * El indice UNICO de `charges` es `(organization_id, number)` y no `number` solo.
 * El folio es por empresa: si fuera global, la empresa B no podria tener un cargo
 * 1 si la empresa A ya lo tiene, y en la practica las dos empiezan en 1.
 *
 * El otro indice de `charges` es `(organization_id, status, due_date)`, que es la
 * consulta del reporte de antiguedad y del tablero: "que me deben y desde cuando
 * esta vencido".
 *
 * La FK de `charge_payments` a `charges` es ON DELETE CASCADE, y el borrado en
 * cascada lo resuelve el DDL, no el codigo de la API: un cargo borrado de verdad
 * se lleva sus abonos, porque un abono sin cargo no significa nada y consultarlo
 * seria consultar basura. La API NO tiene un 409 aqui como en `activos`: alli el
 * historial era la prueba de que un equipo se perdio, y acá el abono es un hecho
 * de caja que se puede dar de baja con el cargo.
 *
 * `amount_cents` es INTEGER y lleva `CHECK (> 0)`, en las dos tablas. El
 * `CHECK` no es desconfianza del validador: es la ultima linea de defensa para
 * lo que se escriba por `sqlite3` en consola o por un script de una correccion, y
 * un abono de cero o negativo romperia la invariante del saldo desde adentro de la
 * base, que es el unico lugar del que no se puede recuperar con un 409.
 *
 * `amount_cents` es INTEGER, no REAL: es lo que hace que la cartera sume sin
 * arrastrar errores de coma flotante.
 *
 * NO hay tabla `payments` en este archivo, y es deliberado: esa tabla existe en el
 * Core y es la suscripcion que el cliente le paga a AMG, no la cartera que la
 * empresa le cobra a sus clientes. La cabecera de `schema.ts` explica la confusion
 * completa. Los abonos se llaman `charge_payments` para que no se puedan
 * confundir.
 *
 * NO hay `legacy_tenant_map`: este producto no tiene fuente legacy de la que leer.
 *
 * Los nombres de indice son EXACTAMENTE los que aparecen en `schema.ts`.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS charges (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  -- Copia del nombre al momento de emitir: el cliente vive en otra base.
  customer_name TEXT NOT NULL,
  -- Referencia suelta al producto \`clientes\`: es otra base de datos.
  customer_id TEXT,
  customer_email TEXT,
  concept TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status TEXT NOT NULL DEFAULT 'pending',
  issued_date TEXT,
  due_date TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- El folio es por organizacion. Unico porque dos cargos con el mismo folio en la
-- misma empresa no se pueden distinguir al leerlas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_charges_org_number ON charges(organization_id, number);
-- La cartera: "que me deben y desde cuando esta vencido".
CREATE INDEX IF NOT EXISTS idx_pagos_charges_org_status_due ON charges(organization_id, status, due_date);

CREATE TABLE IF NOT EXISTS charge_payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  charge_id TEXT NOT NULL REFERENCES charges(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  method TEXT NOT NULL DEFAULT 'other',
  reference TEXT,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
-- El dinero que entro, por mes y por empresa: la consulta del tablero.
CREATE INDEX IF NOT EXISTS idx_pagos_charge_payments_org_received ON charge_payments(organization_id, received_at);
-- Cuanto se ha cobrado de un cargo: la consulta de la ficha y del saldo.
CREATE INDEX IF NOT EXISTS idx_pagos_charge_payments_charge ON charge_payments(charge_id);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pagos_settings_org ON settings(organization_id);
`;
