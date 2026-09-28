/**
 * DDL de solicitudes. Cinco tablas de negocio y una de auditoria de la migracion.
 *
 * Cada `organization_id` lleva su indice: sin el, el filtro por organizacion
 * (obligatorio en todas las consultas) se vuelve un barrido de tabla completa.
 *
 * El indice UNICO de `requests` es `(organization_id, number)` y no `number`
 * solo. El folio es por empresa: si fuera global, la empresa B no podria tener
 * una solicitud 1 si la empresa A ya la tiene, y en la practica las dos
 * empiezan en 1.
 *
 * Un pedido atraviesa estados, y cada cambio se guarda: sin ese historial, una
 * solicitud que se reabre no dejaria rastro de por que volvio. `status_history`
 * es el registro de auditoria del propio producto, no un log del sistema.
 *
 * Los adjuntos viven en disco (carpeta `attachments/` al lado de la base) y aca
 * se guarda solo la referencia: el archivo en la base la haria crecer sin
 * limite y no se podria servir con rango. `path` es relativo a la carpeta de
 * datos, nunca absoluto.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  requester_name TEXT NOT NULL,
  requester_email TEXT,
  responsible_name TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  due_at TEXT,
  resolution TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_requests_org ON requests(organization_id, created_at);
-- El folio es por organizacion. Unico porque dos solicitudes con el mismo numero
-- en la misma empresa no se pueden distinguir al leerlas.
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_requests_org_number ON requests(organization_id, number);
-- Los filtros de la lista: "que hay abierto, por prioridad".
CREATE INDEX IF NOT EXISTS idx_solicitudes_requests_filtros ON requests(organization_id, status, priority);
-- "Que se me vence" es una consulta diaria.
CREATE INDEX IF NOT EXISTS idx_solicitudes_requests_due ON requests(organization_id, due_at);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_user_id TEXT,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_comments_org ON comments(organization_id, request_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_comments_request ON comments(request_id);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  -- Ruta relativa a la carpeta de datos del producto. El archivo vive en disco.
  path TEXT NOT NULL,
  mime_type TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_attachments_org ON attachments(organization_id, request_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_attachments_request ON attachments(request_id);

CREATE TABLE IF NOT EXISTS status_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  old_status TEXT,
  new_status TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solicitudes_status_history_org ON status_history(organization_id, request_id);
CREATE INDEX IF NOT EXISTS idx_solicitudes_status_history_request ON status_history(request_id);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_solicitudes_settings_org ON settings(organization_id);
`;