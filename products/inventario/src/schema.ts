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

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  defaultUnit: text('default_unit').notNull().default('unidad'),
  defaultMinQuantity: integer('default_min_quantity').notNull().default(0),
  currency: text('currency').notNull().default('$'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});
