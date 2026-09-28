import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de espacios.
 *
 * Un producto de reserva de espacios tiene UNA diferencia con el de citas, y
 * está en el medio de todo: el sujeto que se bloquea es el ESPACIO, no una
 * persona. Dos clientes pueden usar la misma franja en canchas distintas sin
 * interferirse; lo que no puede pasar es que dos reservas se pidan en la misma
 * cancha. Por eso acá no hay `staff_id` y en cambio `bookings.space_id` es NOT
 * NULL: una reserva sin espacio definido no es una reserva, es un error.
 *
 * Todas las tablas llevan `organization_id` y lo consultan todas las rutas. No
 * hay `tenant_id`: la identidad la trae el Core.
 *
 * Los nombres de índice son los mismos que aparecen en `ddl.ts`, a propósito. Si
 * difieren, el DDL crearía un índice y Drizzle otro con las mismas columnas: dos
 * índices para lo mismo, y el segundo no lo usa nadie.
 */

/** Quien reserva. Sin esto no hay a quién avisarle ni a quién cobrarle. */
export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    notes: text('notes'),
    tags: text('tags'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    archivedAt: text('archived_at'),
  },
  (t) => [index('idx_espacios_customers_org').on(t.organizationId)],
);

/**
 * El espacio reservable: una cancha, un salón, una cabina.
 *
 * `price_per_hour_cents` es la TARIFA, no el precio de una reserva concreta. La
 * diferencia importa en la migración: el legacy de deportes no guardaba ninguna
 * línea con el precio pactado, así que no hay contra qué verificar la tarifa, y
 * el valor se copia tal cual y se reporta.
 */
export const spaces = sqliteTable(
  'spaces',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    /** Etiqueta libre: "futbol", "sala", "cabina". El legacy usaba un catálogo corto. */
    type: text('type').notNull().default('sala'),
    capacity: integer('capacity').notNull().default(1),
    pricePerHourCents: integer('price_per_hour_cents').notNull().default(0),
    color: text('color').notNull().default('#0891b2'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
    archivedAt: text('archived_at'),
  },
  (t) => [index('idx_espacios_spaces_org').on(t.organizationId)],
);

/**
 * Extras que se pueden sumar a una reserva: alquiler de equipo, instructor,
 * limpieza. No reservan por sí mismos, así que no ocupan agenda.
 *
 * Viene de la tabla `services` del legacy de deportes: cuatro filas, ninguna
 * usada por una reserva.
 */
export const addons = sqliteTable(
  'addons',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    durationMin: integer('duration_min').notNull().default(0),
    priceCents: integer('price_cents').notNull().default(0),
    description: text('description'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_espacios_addons_org').on(t.organizationId)],
);

/**
 * Horarios de disponibilidad POR ESPACIO.
 *
 * Sin una fila acá, la jornada del espacio es la general de la organización
 * (`settings`). Con una fila, ese día de la semana se atiende según el rango que
 * dice la fila. `weekday` es el día de la semana de JavaScript (0 = domingo) y
 * las horas van en minutos desde medianoche, como las de `settings`.
 */
export const availability = sqliteTable(
  'availability',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    weekday: integer('weekday').notNull(),
    startTime: integer('start_time').notNull(),
    endTime: integer('end_time').notNull(),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_espacios_availability_org').on(t.organizationId)],
);

/**
 * Bloqueos puntuales: mantenciones, eventos, cierres.
 *
 * A diferencia de `availability`, que repite a la semana, un bloqueo es UNA
 * franja concreta con fecha y hora, y durante ese rato el espacio no se puede
 * reservar aunque el calendario semanal diga que sí.
 */
export const blocks = sqliteTable(
  'blocks',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'cascade' }),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    reason: text('reason'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_espacios_blocks_org').on(t.organizationId)],
);

/**
 * La reserva. Intervalo cerrado por la izquierda y abierto por la derecha:
 * `[inicio, fin)`. Por eso una reserva puede empezar exactamente cuando termina
 * otra en el mismo espacio, que es como funciona un turno de canchas.
 */
export const bookings = sqliteTable(
  'bookings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    spaceId: text('space_id')
      .notNull()
      .references(() => spaces.id, { onDelete: 'restrict' }),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    startAt: text('start_at').notNull(),
    endAt: text('end_at').notNull(),
    status: text('status').notNull().default('pending'),
    notes: text('notes'),
    /**
     * Total de la reserva en centavos, extras incluidos.
     *
     * Es un valor MATERIALIZADO, no una fórmula que se calcule al leer: la tarifa
     * por hora puede cambiar mañana y una reserva ya hecha tiene que seguir
     * valiendo lo que valió cuando se pactó.
     */
    totalCents: integer('total_cents').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    index('idx_espacios_bookings_org').on(t.organizationId),
    index('idx_espacios_bookings_space_time').on(t.spaceId, t.startAt),
  ],
);

/** Línea de extras de una reserva, con el precio congelado al momento. */
export const bookingAddons = sqliteTable(
  'booking_addons',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    addonId: text('addon_id')
      .notNull()
      .references(() => addons.id, { onDelete: 'restrict' }),
    priceCents: integer('price_cents').notNull().default(0),
  },
  (t) => [
    index('idx_espacios_booking_addons_org').on(t.organizationId),
    index('idx_espacios_booking_addons_booking').on(t.bookingId),
  ],
);

/**
 * Preferencias de la organización.
 *
 * La jornada se guarda en MINUTOS DESDE MEDIANOCHE y no como "09:00" porque es
 * como la piensa quien la configura, y "09:30" tiene que poder existir sin
 * depender del formato de un texto.
 */
export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    currency: text('currency').notNull().default('$'),
    timezone: text('timezone').notNull().default('America/Santiago'),
    openingMinutes: integer('opening_minutes').notNull().default(480),
    closingMinutes: integer('closing_minutes').notNull().default(1320),
    /** Multiplo de las franjas que se ofrecen al reservar. */
    slotMinutes: integer('slot_minutes').notNull().default(60),
    /** Anticipación mínima para reservar, en minutos. 0 = se puede reservar ya. */
    minAdvanceMinutes: integer('min_advance_minutes').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [uniqueIndex('idx_espacios_settings_org').on(t.organizationId)],
);

/**
 * Mapa tenant legacy -> organización del Core.
 *
 * Se declara al final porque es la tabla de la que salen todas las
 * `organization_id`. Es lo que hace que la migración sea re-ejecutable: la
 * segunda corrida lee el mapa y no vuelve a crear la organización.
 */
export const espaciosSchema = {
  customers,
  spaces,
  addons,
  availability,
  blocks,
  bookings,
  bookingAddons,
  settings,
};
