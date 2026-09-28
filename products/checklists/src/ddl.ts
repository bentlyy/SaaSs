/**
 * DDL de checklists e inspecciones.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * Las reglas de este producto se ven aca, en el DDL, y no solo en el codigo:
 *
 *   - `runs.template_id` es ON DELETE SET NULL. Si se borra la plantilla, la
 *     corrida se queda sin plantilla pero CON su snapshot (`template_name` y
 *     `template_items_json`, ambos NOT NULL). El historial de una inspeccion ya
 *     firmada sobrevive al papel con que se firmo.
 *
 *   - `sections` y `template_items` son ON DELETE CASCADE hacia abajo: una
 *     plantilla sin secciones no existe, y un item no existe sin su seccion.
 *     `run_items` tambien es CASCADE: los puntos no existen sin la corrida a la
 *     que pertenecen, y consultarlos sin ella es consultar basura. `run_items`
 *     ademas apunta al item de la plantilla del que salio (`item_id`) con ON
 *     DELETE SET NULL: la corrida lleva su copia y no se muere si el original se
 *     borra.
 *
 *   - `attachments` son ON DELETE CASCADE con su corrida: un adjunto sin la
 *     inspeccion no significa nada.
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
 * Las posiciones de los ITEMS son por seccion (`idx_..._section_position`), y las
 * posiciones de los PUNTOS DE CORRIDA son por corrida (`idx_..._run_position`).
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

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_sections_template_order ON sections(template_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_checklists_sections_org_template ON sections(organization_id, template_id);

CREATE TABLE IF NOT EXISTS template_items (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  type TEXT NOT NULL DEFAULT 'yes_no' CHECK (type IN ('yes_no', 'text', 'number', 'select')),
  options_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_template_items_section_position ON template_items(section_id, position);
CREATE INDEX IF NOT EXISTS idx_checklists_template_items_org_template ON template_items(organization_id, template_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  template_id TEXT REFERENCES templates(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL,
  template_items_json TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'done', 'canceled')),
  result TEXT CHECK (result IS NULL OR result IN ('approved', 'observed', 'rejected')),
  performed_by TEXT,
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
  item_id TEXT REFERENCES template_items(id) ON DELETE SET NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  type TEXT NOT NULL DEFAULT 'yes_no' CHECK (type IN ('yes_no', 'text', 'number', 'select')),
  options_json TEXT,
  value_text TEXT,
  result TEXT CHECK (result IS NULL OR result IN ('ok', 'fail', 'na')),
  note TEXT,
  answered_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_run_items_run_position ON run_items(run_id, position);
CREATE INDEX IF NOT EXISTS idx_checklists_run_items_org_run ON run_items(organization_id, run_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  -- Ruta relativa a la carpeta de datos del producto. El archivo vive en disco.
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_checklists_attachments_org ON attachments(organization_id, run_id);
CREATE INDEX IF NOT EXISTS idx_checklists_attachments_run ON attachments(run_id);

CREATE TABLE IF NOT EXISTS settings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT '$',
  timezone TEXT NOT NULL DEFAULT 'America/Santiago',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
-- Una fila por organizacion: el indice unico es lo que evita que dos personas
-- guardando la configuracion a la vez dejen dos filas compitiendo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checklists_settings_org ON settings(organization_id);
`;