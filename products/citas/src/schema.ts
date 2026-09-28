import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * Citas: clientes, servicios, profesionales, agenda y avisos.
 *
 * Lo que entra y lo que no: este producto tiene su propia lista de clientes
 * porque una peluquería y una clínica guardan datos distintos de su gente, y no
 * hay una tabla de clientes en el Core a la que pegarse. Lo que NO entra es lo
 * que no es de la cita: el stock es del inventario, los espacios son de
 * espacios. Por eso acá no hay ni artículos ni cabinas.
 *
 * `organization_id` no es clave foránea a `organizations` porque esa base es del
 * Core y SQLite no cruza bases. Es una referencia blanda, y por eso todas las
 * consultas filtran por ella.
 */

/** La gente a la que se le agenda. Los datos de contacto, los de la cita. */
export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  notes: text('notes'),
  tags: text('tags'),
  /** Baja lógica: sale de las listas pero conserva el historial de citas. */
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

/**
 * Catálogo de servicios, con duración real.
 *
 * La duración no es decorativa: es lo que permite bloquear la agenda y detectar
 * el solapamiento. Un servicio sin duración no se puede agendar.
 *
 * `priceCents` en centavos, como en todo AMG. El legacy mezclaba unidades y
 * centavos (ver `detectarFactor`): acá llega ya convertido, o en 0 si no se
 * pudo convertir con confianza, y la migración lo reporta.
 */
export const services = sqliteTable('services', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  durationMin: integer('duration_min').notNull().default(30),
  priceCents: integer('price_cents').notNull().default(0),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

/**
 * Profesionales (o el recurso que atiende: peluquero,/barbería, médico).
 *
 * `color` es lo que la agenda usa para pintar la columna de cada uno. Es un
 * detalle de la interfaz, pero sin él la agenda es una lista de horas sin dueño
 * legible.
 */
export const staff = sqliteTable('staff', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  color: text('color'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

/**
 * Qué hace cada profesional.
 *
 * Tabla de cruce y no un array de ids en `staff`: la consulta que la agenda
 * necesita es "los servicios de este profesional", y con el cruce sale del
 * índice; desnormalizarlo obliga a filtrar en memoria.
 */
export const staffServices = sqliteTable('staff_services', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  staffId: text('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  serviceId: text('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
});

/**
 * Horarios de atención POR PROFESIONAL.
 *
 * Sin una fila acá, el profesional atiende en la jornada que pide la consulta de
 * disponibilidad. Con una fila, ese día de la semana atiende según el rango que
 * dice la fila. `weekday` es el día de la semana de JavaScript (0 = domingo) y
 * las horas van en minutos desde medianoche, igual que `from`/`until` en la
 * disponibilidad.
 */
export const availability = sqliteTable('availability', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  staffId: text('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  weekday: integer('weekday').notNull(),
  startTime: integer('start_time').notNull(),
  endTime: integer('end_time').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

/**
 * Bloqueos puntuales: vacaciones, reuniones, cierres.
 *
 * A diferencia de `availability`, que se repite a la semana, un bloqueo es UNA
 * franja concreta con fecha y hora, y durante ese rato el profesional no se
 * puede agendar aunque su semana diga lo contrario.
 */
export const blocks = sqliteTable('blocks', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  staffId: text('staff_id').notNull().references(() => staff.id, { onDelete: 'cascade' }),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  reason: text('reason'),
  createdAt: text('created_at').notNull(),
});

/** La cita. `startAt`/`endAt` en ISO UTC; el timezone es de la organización. */
export const appointments = sqliteTable('appointments', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  staffId: text('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  notes: text('notes'),
  status: text('status').notNull().default('confirmed'),
  /**
   * Lo que se cobró de verdad, en centavos.
   *
   * Es una foto histórica, no un precio vivo: si el cliente cambia el precio del
   * servicio mañana, la cita de ayer tiene que seguir valiendo lo que valió. Por
   * eso el importe se congela acá y no se calcula al vuelo desde `services`.
   */
  totalCents: integer('total_cents').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

/**
 * Qué servicios componen la cita y a qué precio se agregó cada uno.
 *
 * Una cita puede ser "corte + barba", así que no puede ser una sola referencia
 * a `services`. Y el precio de la línea es el de ese momento, no el actual.
 */
export const appointmentServices = sqliteTable('appointment_services', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  appointmentId: text('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
  /** Nombre del servicio al momento de agendar, por si después se borra. */
  serviceName: text('service_name'),
  priceCents: integer('price_cents').notNull().default(0),
});

/**
 * Avisos ya enviados.
 *
 * No es el que manda los avisos: es el registro de los que ya salieron, para
 * no reenviar y para poder responder "¿le llegó?". Por eso guarda a quién y
 * cuándo, y por eso una cita la puede tener ninguno (todavía no llegó la hora).
 */
export const reminders = sqliteTable('reminders', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  appointmentId: text('appointment_id').references(() => appointments.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull().default('email'),
  to: text('to'),
  status: text('status').notNull().default('sent'),
  sentAt: text('sent_at'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

/**
 * Preferencias de la agenda de UNA organización.
 *
 * El timezone va acá y no en el Core a propósito: es lo que define cómo se leen
 * las horas de ESTA agenda. Si mañana dos organizaciones quisieran zonas
 * horarias distintas, cada una guarda la suya en su propia base.
 */
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  timezone: text('timezone').notNull().default('America/Santiago'),
  currency: text('currency').notNull().default('$'),
  /** Horas de anticipación para avisar. El legacy lo traía por tenant. */
  reminderHours: integer('reminder_hours').notNull().default(12),
  emailEnabled: integer('email_enabled', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});
