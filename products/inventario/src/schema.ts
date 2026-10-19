import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/**
 * El inventario, y solo el inventario.
 *
 * Antes cada producto repetia las 18 tablas del Core y usaba dos o tres. Acá
 * hay cinco: los artículos, sus categorías, sus movimientos, los códigos que se
 * escanearon y se decidió ignorar, y la configuración.
 *
 * `organization_id` no es una clave foránea a organizations porque esa base es
 * del Core y SQLite no cruza bases. Es una referencia blanda, y por eso todas
 * las consultas filtran por ella.
 */

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

export const items = sqliteTable('items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  sku: text('sku'),
  /**
   * Código de barras leído por el escáner.
   *
   * Es el mismo dato que `sku` pero con otro origen: `sku` lo escribe una
   * persona a mano, `barcode` lo lee la cámara. Se guardan juntos y separados
   * porque un artículo puede tener los dos, y la búsqueda del escáner mira los
   * dos. El índice único es parcial (`WHERE barcode IS NOT NULL`), así que
   * muchos artículos pueden no tener código de barras.
   */
  barcode: text('barcode'),
  /** Categoría a la que pertenece. Nulo = sin categoría. */
  categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
  /** Lo cambia un movimiento, nunca un PATCH directo (ver routes.ts). */
  quantity: integer('quantity').notNull().default(0),
  /** Umbral de reposición: si quantity <= minQuantity, está en stock bajo. */
  minQuantity: integer('min_quantity').notNull().default(0),
  unit: text('unit').notNull().default('unidad'),
  /** Costo unitario en centavos, como en el Core. La API lo expone en centavos. */
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
 * Códigos de barras que se escanearon y se decidió NO convertir en artículo.
 *
 * Sirve para que la pantalla de incidencias muestre qué se está leyendo y no se
 * puede cargar todavía (un código sin producto detrás, un formato raro). No
 * crea artículos ni mueve stock: es solo la nota de lo que pasó.
 */
export const scanIncidents = sqliteTable('scan_incidents', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  barcode: text('barcode').notNull(),
  note: text('note'),
  actorUserId: text('actor_user_id'),
  actorName: text('actor_name'),
  createdAt: text('created_at').notNull(),
});

export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  defaultUnit: text('default_unit').notNull().default('unidad'),
  defaultMinQuantity: integer('default_min_quantity').notNull().default(0),
  currency: text('currency').notNull().default('$'),
  /**
   * Si un movimiento de salida puede dejar el stock en negativo.
   *
   * Por defecto NO: el inventario legacy recortaba en cero y el número dejaba de
   * explicarse. Se permite solo si la organización lo pide a propósito, p.ej.
   * cuando el stock del sistema va por detrás del real y se regulariza después.
   */
  allowNegativeStock: integer('allow_negative_stock', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});
