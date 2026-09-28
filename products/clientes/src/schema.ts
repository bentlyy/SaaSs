import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de clientes: la ficha de la persona o la empresa, y lo que se le sigue.
 *
 * Que este producto sea ESTO y no otra cosa importa, porque el legacy de `crm`
 * traia las 17 tablas de siempre y casi ninguna es de aca:
 *
 *   - La cita es de `citas`. Las 10 del crm ya estan ahi, con su profesional y su
 *     hora. Copiarlas aca seria tener la misma agenda en dos productos, y la
 *     segunda copia siempre termina desactualizada.
 *   - La propuesta con lineas, impuestos y total es de `cotizaciones`.
 *   - El repuesto es de `inventario`. Aca no se lleva ni un solo stock.
 *
 * Lo que queda aca es lo que el legacy guardaba y nadie mas guardo: QUIEN es el
 * cliente, QUE hay que hacer con el (seguimientos) y QUE se le hizo (contacto).
 * Eso es una ficha, no una agenda ni un documento.
 *
 * `kind` distingue persona de empresa porque la pantalla cambia segun eso (una
 * empresa tiene documento de identidad, una persona tiene fecha de cumpleaños) y
 * para no meter ese dato en la misma caja. El legacy no lo tenia, asi que se
 * explica en el migrador por que queda todo como `persona`.
 *
 * TODA tabla lleva `organization_id` NOT NULL con su indice, y todas las
 * consultas filtran por el. No hay `tenant_id`: la identidad la trae el Core.
 *
 * La convencion de dinero de AMG (centavos enteros) NO aparece en este archivo
 * porque este producto no tiene un solo importe: el precio de un trabajo es de
 * `citas` y el de una propuesta es de `cotizaciones`. Aca no hay nada que
 * convertir, y por eso la migracion no llama a `detectarFactor`: no habria nada
 * que deducir.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/**
 * La ficha del cliente.
 *
 * `name` es NOT NULL y es lo unico que no puede faltar: sin un nombre no hay a
 * quien llamar, y un cliente sin nombre no se puede ni borrar ni archivar. Todo
 * lo demas es opcional de verdad, porque el cliente que solo tiene un telefono
 * es un cliente real.
 *
 * `tax_id` es el RUT, el RUC o el NIT, segun el pais. Es texto y no numero
 * porque los tres formatos llevan letras y guiones, y porque castearlos a
 * numero pierde el cero inicial, que en un RUC es parte del identificador.
 *
 * `birthday` es una FECHA (`AAAA-MM-DD`), no un instante: el dia del cumpleaños
 * no cambia con la zona horaria, y guardarlo como instante correria un dia a
 * quien lo cumple en un huso al oeste de UTC.
 *
 * `tags` es texto libre separado por comas, como en el legacy. No es una tabla
 * de etiquetas: nadie busca "todos los vip menos estos dos" con la frecuencia
 * que justificaria normalizarlo.
 */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    /** Razon social. Solo tiene sentido cuando `kind` es `empresa`. */
    company: text('company'),
    kind: text('kind').notNull().default('persona'),
    email: text('email'),
    phone: text('phone'),
    /** RUT / RUC / NIT. Texto, porque los tres llevan letras. */
    taxId: text('tax_id'),
    address: text('address'),
    city: text('city'),
    notes: text('notes'),
    tags: text('tags'),
    /** `AAAA-MM-DD`. Viene de `customers.birthdate` del legacy. */
    birthday: text('birthday'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  // La consulta que hace la pantalla todo el tiempo: "los clientes de esta
  // empresa, sin los archivados, ordenados por nombre". El indice viene en ese
  // orden exacto para que SQLite no tenga que ordenar.
  (t) => [index('idx_clientes_customers_org').on(t.organizationId, t.archivedAt, t.name)],
);

/**
 * Lo que hay que hacer con el cliente: "llamar para renovar el paquete".
 *
 * Es una TAREA con fecha, no un recordatorio ni una cita: no tiene hora, no
 * manda ningun aviso y no se solapa con nada. Por eso vive aca y no en `citas`.
 *
 * `customer_id` es NOT NULL y va con ON DELETE CASCADE. Un seguimiento sin
 * cliente es un "@pendiente" suelto, que no se puede trabajar: nadie sabe de
 * quien es. Y si el cliente se borra, sus seguimientos se van con el, porque
 * dejarlos huerfanos seria consultar basura y el CASCADE del DDL lo resuelve sin
 * que ningun codigo tenga que acordarse.
 *
 * `due_date` es una FECHA y no un instante, por lo mismo que `customers.birthday`:
 * "el lunes hay que llamarlo" es un dia, no un momento, y guardarlo con hora
 * inventa precision que nadie tiene.
 *
 * `status` tiene tres valores y ninguno mas: `pending`, `done` y `canceled`.
 * Son los del legacy (que escribia `cancelled` con dos eles) y el producto usa
 * una sola ele. El migrador traduce; el texto del legacy no viaja al destino.
 *
 * `completed_at` no lo traia el legacy. Queda NULL en las migradas en vez de
 * inventar una fecha, y lo pone la API cuando alguien marca el seguimiento como
 * hecho: ese momento si lo sabemos, es ahora.
 */
export const followups = sqliteTable(
  'followups',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    dueDate: text('due_date'),
    status: text('status').notNull().default('pending'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    // La consulta del tablero: "que pendientes tengo, y cuales ya vencido".
    // El indice va en ese orden porque la pantalla filtra por los dos a la vez.
    index('idx_clientes_followups_org').on(t.organizationId, t.status, t.dueDate),
    // La ficha del cliente: sus seguimientos, sin escanear los de la empresa.
    index('idx_clientes_followups_customer').on(t.customerId),
  ],
);

/**
 * Que se le hizo: una llamada, un correo, una visita, una nota.
 *
 * Es un HISTORIAL, no una agenda: no se agenda nada y no se puede modificar la
 * hora de lo que ya paso. Por eso solo tiene `happened_at` y `created_at`, y no
 * `updated_at`: escribir una fila de historial dos veces por un error de la
 * pantalla es un problema; editarla en silencio es peor, porque el registro
 * deja de decir que paso.
 *
 * `kind` son cuatro valores cerrados y no un texto libre: son los cuatro canales
 * que una ficha de cliente distingue de verdad, y dejarlos abiertos convertiria
 * la columna en otra vez "el cliente es una persona con nombre".
 *
 * `customer_id` con ON DELETE CASCADE, igual que los seguimientos: si el cliente
 * se va, su historial tambien. Un historial de contacto sin cliente es ruido.
 */
export const interactions = sqliteTable(
  'interactions',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    customerId: text('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('nota'),
    summary: text('summary').notNull(),
    /** Instante ISO UTC de cuando ocurrio el contacto. */
    happenedAt: text('happened_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // "Que se ha hecho con mi gente este mes", que es la pregunta del tablero.
    index('idx_clientes_interactions_org').on(t.organizationId, t.happenedAt),
    // El historial de la ficha, del mas nuevo al mas viejo.
    index('idx_clientes_interactions_customer').on(t.customerId, t.happenedAt),
  ],
);

/**
 * Preferencias de la organizacion.
 *
 * Una fila por organizacion, con indice UNIQUE: es lo que evita que dos personas
 * guardando la configuracion a la vez dejen dos filas compitiendo. Sin ese
 * indice, `leerPreferencias` devolveria una de las dos al azar.
 *
 * La moneda y la zona horaria vienen del tenant legacy, que era donde vivian
 * los ajustes antes de que existiera esta tabla.
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
  (t) => [uniqueIndex('idx_clientes_settings_org').on(t.organizationId)],
);

/**
 * Mapa tenant legacy -> organizacion del Core.
 *
 * Se declara al final porque es la tabla de la que salen todas las
 * `organization_id`. Es lo que hace que la migracion sea re-ejecutable: la
 * segunda corrida lee el mapa y no vuelve a buscar ni a crear la organizacion.
 *
 * El indice UNIQUE de `organization_id` es tambien la garantia de que un tenant
 * legacy no se mapea a dos organizaciones distintas, que es exactamente el
 * duplicate que este producto tiene que evitar cuando varias organizaciones del
 * CoreCompeten por el mismo slug del legacy.
 */
export const legacyTenantMap = sqliteTable(
  'legacy_tenant_map',
  {
    legacyTenantId: text('legacy_tenant_id').primaryKey(),
    legacySlug: text('legacy_slug').notNull(),
    legacyName: text('legacy_name').notNull(),
    organizationId: text('organization_id').notNull(),
    migratedAt: text('migrated_at')
      .notNull()
      .default(sql`(datetime('now'))`),
  },
  (t) => [uniqueIndex('idx_clientes_map_org').on(t.organizationId)],
);

export const clientesSchema = {
  customers,
  followups,
  interactions,
  settings,
  legacyTenantMap,
};
