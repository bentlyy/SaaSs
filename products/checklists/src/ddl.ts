/**
 * DDL de checklists e inspecciones.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * Las dos reglas de este producto se ven aca, en el DDL, y no solo en el codigo:
 *
 *   - `runs.template_id` es ON DELETE SET NULL. Si se borra la plantilla, la
 *     corrida se queda sin plantilla pero CON su snapshot (`template_name` y
 *     `template_items_json`, ambos NOT NULL). El historial de una inspeccion ya
 *     firmada sobrevive al papel con que se firmo.
 *
 *   - `template_items` y `run_items` son ON DELETE CASCADE: los puntos no existen
 *     sin la lista a la que pertenecen, y consultarlos sin ella es consultar
 *     basura.
 *
 * Los CHECK repiten lo que ya valida zod en la API, y a proposito: son la segunda
 * linea de defensa. Un `status` escrito por una migracion, por un script de
 * mantenimiento o por un `sqlite3` a mano no pasa por zod, y una columna que solo
 * "deberia" tener tres valores es una columna que a los tres meses tiene cinco.
 *
 * El UNIQUE de `position` NO va como restriccion de tabla sino como indice con
 * nombre, para que Drizzle y el DDL declaren exactamente el mismo indice. Puesto
 * dos veces (restriccion y `CREATE INDEX`) habria dos indices para las mismas
 * columnas, y el segundo no lo usaria nadie.
 *
 * Los nombres de indice son EXACTAMENTE los que aparecen en `schema.ts`.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checklists_templates_org_active_name ON templates(organization_id, active, name);

CREATE TABLE IF NOT EXISTS template_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_template_items_template_position ON template_items(template_id, position);
CREATE INDEX IF NOT EXISTS idx_checklists_template_items_org_template ON template_items(organization_id, template_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  template_items_json TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'done', 'canceled')),
  notes TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_checklists_runs_org_status_started ON runs(organization_id, status, started_at);
CREATE INDEX IF NOT EXISTS idx_checklists_runs_org_template ON runs(organization_id, template_id);

CREATE TABLE IF NOT EXISTS run_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  result TEXT CHECK (result IS NULL OR result IN ('ok', 'fail', 'na')),
  note TEXT,
  answered_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_run_items_run_position ON run_items(run_id, position);
CREATE INDEX IF NOT EXISTS idx_checklists_run_items_org_run ON run_items(organization_id, run_id);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_settings_org ON settings(organization_id);
`;
