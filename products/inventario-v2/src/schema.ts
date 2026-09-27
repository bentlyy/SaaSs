import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * El inventario, y solo el inventario.
 *
 * Antes cada producto repetia las 18 tablas del Core y usaba dos o tres. Acá
 * hay dos: los artículos y sus movimientos. Ni usuarios, ni clientes, ni
 * servicios: si un dia el inventario necesita un cliente, el cliente es una
 * tabla de ESTE producto con su `organization_id`, no una tabla compartida.
 *
 * `organization_id` no es una clave foránea a organizations porque esa base es
 * del Core y SQLite no cruza bases. Es una referencia blanda, y por eso todas
 * las consultas filtran por ella.
 */

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  sku: text('sku'),
  /** Lo cambia un movimiento, nunca un PATCH directo (ver routes.ts). */
  quantity: integer('quantity').notNull().default(0),
  /** Umbral de reposición: si quantity <= minQuantity, está en stock bajo. */
  minQuantity: integer('min_quantity').notNull().default(0),
  unit: text('unit').notNull().default('unidad'),
  /** En centavos, como en el Core. La API lo expone en centavos. */
  priceCents: integer('price_cents').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
  /** Baja lógica: el artículo sale de las listas pero conserva su historial. */
  archivedAt: text('archived_at'),
});

export const movements = sqliteTable('movements', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  /**
   * Quién hizo el movimiento: el usuario del Core (`req.amg`). Es una
   * referencia blanda, por lo mismo que organization_id.
   */
  actorUserId: text('actor_user_id'),
  /**
   * Nombre del actor en el momento del movimiento.
   *
   * No es una segunda fuente de verdad: la referencia es `actorUserId`, contra
   * el Core. Esto es la foto que dejó el movimiento, y sirve para dos cosas:
   * que el historial se lea sin llamar al Core en cada listado, y que siga
   * legible si el usuario después se renombra o se da de baja. La migración del
   * legacy lo llena con el nombre del autor local, que ya no existe en el Core.
   */
  actorName: text('actor_name'),
  createdAt: text('created_at').notNull(),
});

/**
 * De qué organización del Core vino cada `tenant_id` del legacy.
 *
 * Sin esta tabla, volver a correr la migración crearía organizaciones nuevas
 * duplicadas y las dos copias de los datos quedarían en organizaciones
 * distintas. Con ella, la migración es re-ejecutable y auditable: se puede
 * responder "de dónde salió esta organización" sin mirar los logs.
 */
export const legacyTenantMap = sqliteTable('legacy_tenant_map', {
  legacyTenantId: text('legacy_tenant_id').primaryKey(),
  legacySlug: text('legacy_slug'),
  legacyName: text('legacy_name'),
  organizationId: text('organization_id').notNull(),
  migratedAt: text('migrated_at').notNull(),
});

/**
 * Preferencias del inventario de UNA organización.
 *
 * Son de este producto, no del Core: la razón social, el RUT y los contactos
 * viven en la organización del Core y se editan allá. Acá va lo que solo tiene
 * sentido para inventario —la unidad con la que se carga por defecto, el stock
 * mínimo propuesto, el símbolo de moneda— y por eso es una tabla y no un
 * `settings` compartido: si mañana cotizaciones quiere una moneda distinta, la
 * guarda en su propia base sin discutir con esta.
 *
 * Una fila por organización, garantizado por el índice único. Si no hay fila, se
 * usan los defaults de `defaultSettings()`: leer la configuración no escribe.
 */
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  defaultUnit: text('default_unit').notNull().default('unidad'),
  defaultMinQuantity: integer('default_min_quantity').notNull().default(0),
  currency: text('currency').notNull().default('$'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});
