import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de checklists e inspecciones.
 *
 * Este producto son DOS cosas y no una:
 *
 *   1. La PLANTILLA: la lista de puntos que se revisa una y otra vez. Se escribe
 *      una vez, la reutiliza toda la empresa y la puede editar cualquiera.
 *   2. La EJECUCION (la `run`): alguien, en un lugar y en un momento concretos,
 *      llena esa lista de resultados.
 *
 * Por que estan en tablas separadas y no en una sola con un estado "es plantilla":
 * porque tienen vidas distintas. La plantilla sobrevive a todas sus ejecuciones y
 * se edita todo el tiempo; la ejecucion es un hecho que ya ocurrio y no se
 * vuelve a editar. Meter las dos en una tabla obliga a decidir, fila por fila, de
 * que lado esta cada cosa, y ese `CASE` es exactamente el tipo de columna que
 * despues nadie sabe filtrar.
 *
 * ── EL SNAPSHOT: POR QUE `runs` COPIA LA PLANTILLA ──────────────────────────
 *
 * `runs` NO lee sus items de `template_items`. Guarda una COPIA: el nombre
 * (`template_name`) y la lista de puntos en el momento de la corrida
 * (`template_items_json`), y ademas crea las filas propias en `run_items`.
 *
 * El motivo es que la plantilla sigue viva y se sigue editando. Si la corrida
 * leyera la plantilla, agregar un punto a la checklist de seguridad MIERDE la
 * historia: las inspecciones de marzo empezarian a mostrar un punto que todavia
 * no existia, y las de diciembre no mostrarian el punto que se agrego en
 * septiembre. Un informe de cumplimiento tiene que poder decir "en marzo se
 * revisaron estos 8 puntos" y que eso siga siendo verdad dentro de un ano, con la
 * plantilla de hoy siendo otra cosa. Por eso la corrida es una FOTOGRAFIA, y por
 * eso `template_items_json` es NOT NULL: si el snapshot fuera opcional, el primer
 * dia que alguien se olvide de guardarlo la corrida queda muda.
 *
 * `runs.template_id` existe solo para el enlace con la plantilla, y va con ON
 * DELETE SET NULL a proposito: si se borra la plantilla (se reemplaza por otra,
 * deja de usarse, se creo por error) el historial NO se borra con ella. Una
 * inspeccion ya firmada es un hecho; el papel con el que se firmo es un medio.
 *
 * `runs.template_name` tambien es NOT NULL y no se derivan de la plantilla: es
 * la foto del nombre, y sin el nombre la corrida queda sin saber QUE se reviso.
 *
 * ESTE PRODUCTO NO TIENE FUENTE LEGACY. Ninguno de los nueve productos viejos
 * traia un modulo de inspecciones, asi que no hay `legacy_tenant_map` que
 * declarar ni `migrate-legacy.ts` que inventar: una tabla de mapeo que nunca se
 * llena es ruido que invites a escribir un migrador sin datos de donde leer.
 *
 * NO hay tabla de personas. Quien llena una corrida es la identidad del Core, que
 * llega en el token; y quien figura como "ubicacion" es un texto libre ("bodega
 * 2", "faena norte"), no una ficha de cliente, de proveedor ni de recurso.
 *
 * TODA tabla lleva `organization_id` NOT NULL con su indice, y todas las
 * consultas filtran por el. No hay `tenant_id`: la identidad la trae el Core.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/**
 * Una plantilla: la lista de puntos que se revisa.
 *
 * `active` es lo que decide si la plantilla aparece en el formulario de "empezar
 * una corrida". Desactivar es el equivalente a archivar: la plantilla sigue
 * existiendo y las corridas viejas siguen Apuntando a ella, pero nadie la elige
 * para una corrida nueva. Por eso es un entero y no un `deleted_at`: desactivar
 * es reversible sin perder nada, y borrar es otra decision.
 *
 * El indice va en `(organization_id, active, name)` porque esa es la consulta
 * del listado con el filtro de activas, y el nombre ordena: las plantillas se
 * buscan por nombre, no por fecha de creacion.
 */
export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** 1 = se puede usar para una corrida nueva. 0 = archivada, no se usa mas. */
    active: integer('active').notNull().default(1),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_checklists_templates_org_active_name').on(t.organizationId, t.active, t.name)],
);

/**
 * Un punto de la plantilla.
 *
 * `position` arranca en 1 y es UNIQUE junto a `template_id`, y ese es el motivo
 * de que el UNIQUE exista: es la garantia real de que no haya dos puntos con el
 * mismo numero. El indice UNIQUE va primero en `(template_id, position)` porque
 * la plantilla sola ya identifica a una organizacion, y anadir `organization_id`
 * al UNIQUE no evitaria ningun choque real.
 *
 * `position` no se deja con huecos: cuando se borra un punto, los siguientes se
 * renumeran a 1..N dentro de una transaccion. Un "3" donde no hay 1 ni 2 no es
 * un detalle estetico: quien llena la corrida responde por posicion, y una lista
 * con huecos obliga a leer el numero suelto en vez de seguir el orden.
 *
 * `required` dice si el punto IMPORTA para poder cerrar la corrida. Un punto
 * opcional se puede dejar sin responder; uno obligatorio no. Por eso el
 * `required=1` es lo que `POST /api/runs/:id/completar` cuenta antes de cerrar.
 *
 * `organization_id` esta aunque la plantilla ya lo determine: es la regla del
 * producto, y sin el indice que lo arranca el filtro obligatorio seria un barrido
 * de tabla.
 */
export const templateItems = sqliteTable(
  'template_items',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    /** 1 = obligatorio para poder completar la corrida. 0 = opcional. */
    required: integer('required').notNull().default(1),
  },
  (t) => [
    uniqueIndex('idx_checklists_template_items_template_position').on(t.templateId, t.position),
    index('idx_checklists_template_items_org_template').on(t.organizationId, t.templateId),
  ],
);

/**
 * Una ejecucion de una plantilla: alguien llenando esa lista, en un lugar.
 *
 * `status` tiene TRES valores cerrados y no un texto libre, porque las tres
 * respuestas a "en que esta esta corrida" son distintas de verdad: `in_progress`
 * se esta llenando, `done` se cerro firmada y `canceled` se abandono a medias. Un
 * quinto valor libre permitiria escribir "terminada" o "cerrada" y la columna
 * dejaria de poder filtrarse, que es la unica razon por la que existe.
 *
 * `started_at` y `completed_at` son Instantes ISO, no fechas. Una inspeccion
 * importa la hora: "se hizo a las 9 de la manana y a las 11 ya no" es informacion
 * distinta de "se hizo hoy". `completed_at` es NULL mientras la corrida sigue
 * abierta, y se sella al completarla. Cancelar NO lo sella: cancelada no es lo
 * mismo que completada, y esa diferencia es justo la que se lee despues en una
 * auditoria.
 *
 * `template_items_json` es el snapshot de la plantilla, en JSON, como texto.
 * SQLite no tiene tipo JSON, y no se anade una tabla para el snapshot porque el
 * snapshot se escribe UNA vez y no se consulta por contenido: se lee entero,
 * junto a la corrida, para saber que se estaba revisando. Guardarlo descompuesto
 * en una tabla propia seria una tercera fuente de la verdad que hay que
 * mantener.
 *
 * El indice va en `(organization_id, status, started_at)` porque esa es la
 * consulta del listado con su filtro de estado ordenado por fecha, y del tablero.
 */
export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    /**
     * Enlace con la plantilla, o NULL si la plantilla se borro. El historial
     * sobrevive: por eso ON DELETE SET NULL y no CASCADE.
     */
    templateId: text('template_id').references(() => templates.id, { onDelete: 'set null' }),
    /** FOTO del nombre de la plantilla en el momento de la corrida. */
    templateName: text('template_name').notNull(),
    /** FOTO de los puntos: `[{ "position": 1, "label": "...", "required": 1 }]`. */
    templateItemsJson: text('template_items_json').notNull(),
    /** Donde se hizo: texto libre. "Bodega 2", "faena norte", "casa del cliente". */
    location: text('location'),
    status: text('status').notNull().default('in_progress'),
    notes: text('notes'),
    /** Instante ISO de cuando empezo. */
    startedAt: text('started_at').notNull(),
    /** Instante ISO de cuando se completo. NULL mientras siga abierta. */
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    index('idx_checklists_runs_org_status_started').on(t.organizationId, t.status, t.startedAt),
    // El filtro `?template_id=` del listado es otra consulta distinta, y sin este
    // indice seria un barrido de todas las corridas de la empresa.
    index('idx_checklists_runs_org_template').on(t.organizationId, t.templateId),
  ],
);

/**
 * Un punto DE ESTA corrida, con su respuesta.
 *
 * Viene del snapshot, no de la plantilla: si el punto se respondiera leyendo
 * `template_items`, cambiar la plantilla despues cambiaria lo ya ejecutado.
 *
 * `result` es NULL mientras no se contesta, y despues vale `ok`, `fail` o `na`.
 * Es NULL y no `pending` a proposito: "sin responder" no es un resultado, y por
 * eso la invariante de `completar` busca justamente los NULL con `required = 1`.
 * Los tres valores son cerrados porque son las tres respuestas a una pregunta de
 * inspeccion; un texto libre permitiria escribir "va bien" y la columna dejaria de
 * poder resumirse.
 *
 * `answered_at` se sella en el servidor cuando se registra la respuesta. Es lo
 * que distingue "el punto se respondio el jueves" de "la corrida se completo el
 * viernes": son datos distintos y el que sirve para auditar es el primero.
 *
 * `position` es UNIQUE con `run_id` por la misma razon que en la plantilla: dos
 * puntos con el mismo numero en la misma corrida no se distinguen al responderlos
 * ni al contarlos.
 */
export const runItems = sqliteTable(
  'run_items',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    /** Copia del `required` del snapshot, no del de la plantilla de hoy. */
    required: integer('required').notNull().default(1),
    result: text('result'),
    /** Que se vio en ese punto: la foto de la falla, no un estado. */
    note: text('note'),
    /** Instante ISO en que se registro la respuesta. NULL si sigue sin contestar. */
    answeredAt: text('answered_at'),
  },
  (t) => [
    uniqueIndex('idx_checklists_run_items_run_position').on(t.runId, t.position),
    index('idx_checklists_run_items_org_run').on(t.organizationId, t.runId),
  ],
);

/**
 * Preferencias de la organizacion.
 *
 * Una fila por organizacion, con indice UNIQUE: es lo que evita que dos personas
 * guardando la configuracion a la vez dejen dos filas compitiendo. Sin ese
 * indice, `leerPreferencias` devolveria una de las dos al azar.
 *
 * La moneda esta aunque este producto NO maneje dinero: en un checklist no hay
 * ningun importe que formatear, y no se va a inventar uno. La columna existe
 * porque `settings` es la forma comun de preferencias de la empresa y conviene
 * que las dos esten en el mismo lugar desde el dia uno; el panel la muestra al
 * lado de la zona horaria para que quede claro que es una preferencia y no un
 * dato del dominio. La zona horaria SI se usa: es la que decide a que hora se
 * muestra una corrida.
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
  (t) => [uniqueIndex('idx_checklists_settings_org').on(t.organizationId)],
);

export const checklistsSchema = {
  templates,
  templateItems,
  runs,
  runItems,
  settings,
};
