import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de solicitudes (helpdesk).
 *
 * Este producto administra los pedidos que entran por un canal y se van
 * resolviendo hasta cerrarse: una mesa de ayuda, una bandeja de requerimientos,
 * un registro de incidentes. No es una orden de trabajo (eso era el legacy de
 * talleres) ni una agenda: es el FOLIO que junta "quien pidio", "que se pidio",
 * "para cuando" y "como se resolvio".
 *
 * El responsable y el solicitante son TEXTOS, a proposito. No hay tabla de
 * personas: este producto no sabe si quien pide es un cliente, un empleado o un
 * bot, y exigir una FK obligaria a que esa persona exista en algun catalogo.
 * El servicio resuelve el nombre de quien comenta desde la identidad del Core.
 *
 * `status_history` guarda cada cambio de estado con quien lo hizo. No es opcion
 * registrarlo por afuera: si el historial se llevara en la UI, una llamada a la
 * API que cambie el estado no dejaria rastro.
 *
 * Todas las tablas llevan `organization_id` y lo consultan todas las rutas. No
 * hay `tenant_id`: la identidad la trae el Core.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/** La solicitud. El centro de todo. */
export const requests = sqliteTable(
  'requests',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    /** El FOLIO, unico por organizacion, no global. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    /** Quien pidio, en texto libre: no se exige que exista en ningun catalogo. */
    requesterName: text('requester_name').notNull(),
    requesterEmail: text('requester_email'),
    /** A quien se le asigna, en texto libre: no es un usuario del Core. */
    responsibleName: text('responsible_name'),
    /** Prioridad con la que entra: baja, media, alta, urgente. */
    priority: text('priority').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    /** "Para cuando": fecha YYYY-MM-DD, no un instante. */
    dueAt: text('due_at'),
    /** La resolucion que se registro al cerrar. */
    resolution: text('resolution'),
    closedAt: text('closed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    index('idx_solicitudes_requests_org').on(t.organizationId),
    // El folio por organizacion. Unico porque dos solicitudes con el mismo
    // numero en la misma empresa no se pueden distinguir al leerlas.
    uniqueIndex('idx_solicitudes_requests_org_number').on(t.organizationId, t.number),
    // "Que hay abierto, por prioridad": los filtros de la lista.
    index('idx_solicitudes_requests_filtros').on(t.organizationId, t.status, t.priority),
    index('idx_solicitudes_requests_due').on(t.organizationId, t.dueAt),
  ],
);

/**
 * Un comentario del hilo de la solicitud.
 *
 * `author_name` y `author_user_id` salen de la identidad del Core al momento de
 * escribir: el hilo tiene que quedar legible aunque el usuario se borre. Es
 * historia, no se puede editar ni borrar: borrar un comentario reescribiria la
 * cronologia con la que se llego a una resolucion.
 */
export const comments = sqliteTable(
  'comments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    authorName: text('author_name').notNull(),
    /** Id del usuario en el Core; no se valida aca porque el autor ya no existe. */
    authorUserId: text('author_user_id'),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_solicitudes_comments_org').on(t.organizationId, t.requestId),
    index('idx_solicitudes_comments_request').on(t.requestId),
  ],
);

/**
 * Un archivo adjunto a la solicitud.
 *
 * El contenido vive en disco, en la carpeta `attachments/` al lado de la base.
 * Aca solo queda la referencia: `path` es relativo a la carpeta de datos y
 * nunca se lee como ruta absoluta.
 */
export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    /** Nombre con el que se presento el archivo, para la descarga. */
    filename: text('filename').notNull(),
    path: text('path').notNull(),
    mimeType: text('mime_type'),
    sizeBytes: integer('size_bytes').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_solicitudes_attachments_org').on(t.organizationId, t.requestId),
    index('idx_solicitudes_attachments_request').on(t.requestId),
  ],
);

/**
 * El historial de estados de la solicitud.
 *
 * `old_status` va null en la primera entrada: el registro de que la solicitud
 * nacio en su estado inicial. Cada cambio de estado nuevo es una fila de aca; no
 * existe "listar sin historial", porque el estado es justamente lo que no se
 * puede consultar si no se sabe como llego ahi.
 */
export const statusHistory = sqliteTable(
  'status_history',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    requestId: text('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    oldStatus: text('old_status'),
    newStatus: text('new_status').notNull(),
    /** Quien lo cambio, copia del nombre de la identidad del Core. */
    changedBy: text('changed_by').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_solicitudes_status_history_org').on(t.organizationId, t.requestId),
    index('idx_solicitudes_status_history_request').on(t.requestId),
  ],
);

/**
 * Preferencias de la organizacion.
 *
 * Moneda y zona horaria para presentar fechas y totales. No hay folio siguiente
 * guardado: el folio es el mayor que exista mas uno, igual que en el resto de
 * los productos con numeracion correlativa.
 */
export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    currency: text('currency').notNull().default('$'),
    timezone: text('timezone').notNull().default('America/Santiago'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [uniqueIndex('idx_solicitudes_settings_org').on(t.organizationId)],
);

export const solicitudesSchema = {
  requests,
  comments,
  attachments,
  statusHistory,
  settings,
};