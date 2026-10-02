/**
 * DDL de cotizaciones. Dos tablas de negocio y dos de apoyo: las preferencias y
 * el mapa de la migracion.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * El indice UNICO de `quotes` es `(organization_id, number)` y no `number` solo.
 * El folio es por empresa: si fuera global, la empresa B no podria tener una
 * cotizacion 1 si la empresa A ya la tiene, y en la practica las dos empiezan
 * en 1.
 *
 * Los importes son INTEGER y se guardan en CENTAVOS. No hay columna de tipo
 * REAL para dinero: `REAL` es para `qty`, que es una cantidad y no un importe.
 *
 * `quote_lines.quote_id` va con `ON DELETE CASCADE`: una linea sin cotizacion no
 * significa nada.
 *
 * `quotes.customer_id` NO lleva llave foranea, a proposito: los clientes viven
 * en la base de `crm`, que es OTRA base. SQLite no valida FK entre bases,
 * asi que declararla daria la sensacion de integridad sin ella. El nombre del
 * cliente viaja congelado en `customer_name` para que la cotizacion se pueda
 * leer sin abrir el otro producto.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS quotes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  -- Folio de la empresa. Unico por organizacion, NO global.
  number INTEGER NOT NULL,
  -- Snapshot del nombre del cliente: la cotizacion se lee sin abrir \`clientes\`.
  customer_name TEXT NOT NULL,
  -- Referencia suelta al producto \`clientes\`: es otra base de datos.
  customer_id TEXT,
  customer_email TEXT,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  issue_date TEXT,
  valid_until TEXT,
  -- Puntos basicos: 1600 = 16%. Entero, nunca float.
  tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  -- Los tres importes se MATERIALIZAN al escribir: una cotizacion aceptada tiene
  -- que seguir valiendo lo que valio el dia que se acepto.
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  tax_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sent_at TEXT,
  accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_quotes_org ON quotes(organization_id, created_at);
-- El folio es por organizacion. Unico porque dos cotizaciones con el mismo folio
-- en la misma empresa no se pueden distinguir al leerlas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cotizaciones_quotes_org_number ON quotes(organization_id, number);
-- La pantalla: "que cotizo este mes y en que estado esta".
CREATE INDEX IF NOT EXISTS idx_cotizaciones_quotes_estado ON quotes(organization_id, status, issue_date);

CREATE TABLE IF NOT EXISTS quote_lines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  description TEXT NOT NULL,
  -- Cantidad, no importe: por eso es REAL y no INTEGER.
  qty REAL NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL DEFAULT 0,
  line_total_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cotizaciones_lines_org ON quote_lines(organization_id, quote_id);
-- Como se lee una cotizacion: sus lineas, en orden.
CREATE INDEX IF NOT EXISTS idx_cotizaciones_lines_quote ON quote_lines(quote_id, position);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  default_tax_rate_bp INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Una fila por organizacion: el indice unico es lo que evita que dos personas
-- guardando la configuracion a la vez dejen dos filas compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_cotizaciones_settings_org ON settings(organization_id);
`;
