import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de solicitudes y ordenes.
 *
 * Este producto maneja el trabajo que entra por un mostrador y sale por otro:
 * alguien recibe un pedido, se le estima el precio, se ejecuta, se entregan los
 * repuestos y se entrega el trabajo. No es una agenda (eso es `citas`) ni un
 * catalogo de stock (eso es `inventario`): es el FOLIO que junta las dos cosas.
 *
 * Lo que el producto NO es, y por que importa: no tiene vehiculos. El legacy de
 * talleres traia marca, modelo, patente, anio y kilometraje en cada orden, y
 * `solicitudes` es para cualquier rubro. Esos datos no se copian a ningun lado;
 * el migrador los cuenta y los reporta, para que la decision de dejarlos fuera
 * quede escrita y no la vuelva a tomar alguien sin saber que paso.
 *
 * Lo que reemplaza al concepto de vehiculo es `asset`: un texto libre para decir
 * sobre que se esta trabajando (un vehiculo, una maquina, una instalacion). Es
 * UNA columna y no un bloque de datos del bien, para que este producto sirva
 * para oficios donde "el vehiculo" no existe y no haya que inventarlo.
 *
 * Todas las tablas llevan `organization_id` y lo consultan todas las rutas. No hay
 * `tenant_id`: la identidad la trae el Core.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/** Quien pide el trabajo. Sin esto no hay a quien entregarle ni a quien cobrarle. */
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
  (t) => [index('idx_solicitudes_customers_org').on(t.organizationId)],
);

/**
 * El catalogo de trabajos que se hacen: mano de obra, diagnosticos, visitas.
 *
 * `price_cents` es la TARIFA, no lo que se cobro en una orden concreta. La
 * diferencia importa en la migracion: la linea de la orden (`order_services`)
 * guarda el precio pactado, y esa es la que manda.
 */
export const services = sqliteTable(
  'services',
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
  (t) => [index('idx_solicitudes_services_org').on(t.organizationId)],
);

/**
 * Quien ejecuta el trabajo. No es el usuario del sistema: es la persona que
 * agarra la orden, y casi siempre es un empleado o un tercero.
 *
 * Por eso NO tiene `email` obligatorio ni es un `user_id` del Core. Es un dato de
 * contacto para poder avisarle, no una identidad con la que entrar. La
 * diferencia con el `staff` de `citas` es la misma que hay entre un empleado que
 * atiende un turno y una persona que ejecuta un trabajo: se registran distinto y
 * por separado.
 */
export const technicians = sqliteTable(
  'technicians',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    color: text('color').notNull().default('#4f46e5'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [index('idx_solicitudes_technicians_org').on(t.organizationId)],
);

/**
 * La orden. El centro de todo.
 *
 * `number` es el FOLIO y es unico por organizacion, no global: dos empresas
 * pueden tener cada una su orden numero 1 sin que sea un problema. Por eso el
 * indice es compuesto y no unico solo.
 *
 * `total_cents` es un valor MATERIALIZADO, no una formula que se calcule al
 * leer: el precio de un repuesto o de una hora de mano de obra puede cambiar
 * manana y una orden ya cerrada tiene que seguir valiendo lo que valio el dia
 * que se pacto.
 *
 * `estimated_delivery` es una FECHA, no un instante: la pregunta que responde es
 * "para cuando", y un taller promete un dia, no una hora. Se guarda como texto
 * `YYYY-MM-DD` a proposito, sin conversion a UTC: convertirla inventaria un dia
 * cuando la organizacion esta en un huso al oeste de UTC.
 */
export const orders = sqliteTable(
  'orders',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    number: integer('number').notNull(),
    customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
    technicianId: text('technician_id').references(() => technicians.id, { onDelete: 'set null' }),
    /**
     * Sobre que se trabaja, en texto libre: "Nissan Versa a123bc", "Lavadora de
     * la sede norte", "Instalacion electrica del local".
     *
     * Es UNA columna y no un bloque de datos del bien, a proposito: un producto
     * para cualquier rubro no puede exigir patente ni kilometraje. Va nulo en las
     * ordenes migradas, porque el legacy solo tenia vehiculos.
     */
    asset: text('asset'),
    status: text('status').notNull().default('received'),
    estimatedDelivery: text('estimated_delivery'),
    notes: text('notes'),
    totalCents: integer('total_cents').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    index('idx_solicitudes_orders_org').on(t.organizationId),
    // El folio por organizacion. Unico porque dos ordenes con el mismo numero en
    // la misma empresa no se pueden distinguir al leerlas.
    uniqueIndex('idx_solicitudes_orders_org_number').on(t.organizationId, t.number),
    // La consulta que hace la pantalla todo el tiempo: "que hay abierto".
    index('idx_solicitudes_orders_status').on(t.organizationId, t.status),
  ],
);

/**
 * Linea de mano de obra de una orden, con el precio congelado al momento.
 *
 * Viene de `work_order_services` del legacy. `price_cents` es lo pactado, nunca
 * el precio del catalogo: si el catalogo sube manana, la orden sigue valiendo lo
 * que valio.
 */
export const orderServices = sqliteTable(
  'order_services',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    priceCents: integer('price_cents').notNull().default(0),
  },
  (t) => [
    index('idx_solicitudes_order_services_org').on(t.organizationId),
    index('idx_solicitudes_order_services_order').on(t.orderId),
  ],
);

/**
 * Linea de repuestos de una orden.
 *
 * `item_id` NO tiene llave foranea a proposito, y es la decision mas importante de
 * este archivo: los repuestos viven en la base del producto `inventario`, que es
 * de OTRA base. Una FK apuntando a una tabla que no existe aca no se puede
 * declarar, y aunque se pudiera, SQLite no valida las FK entre bases.
 *
 * Por eso el id va suelto y se acompana de `item_name`, que es una COPIA del
 * nombre al momento de la migracion. No es redundancia: una linea de orden tiene
 * que poder leerse aunque el repuesto se de de baja o se renombre manana. Si el
 * nombre se buscara en vivo, cambiar el nombre de un repuesto reescribiria la
 * historia de ordenes viejas.
 */
export const orderParts = sqliteTable(
  'order_parts',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Id del repuesto en el producto `inventario`. Referencia suelta, sin FK. */
    itemId: text('item_id').notNull(),
    /** Copia del nombre del repuesto al momento de armar la linea. */
    itemName: text('item_name').notNull(),
    qty: integer('qty').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
  },
  (t) => [
    index('idx_solicitudes_order_parts_org').on(t.organizationId),
    index('idx_solicitudes_order_parts_order').on(t.orderId),
    // Para buscar "en que orden se uso este repuesto", que es la pregunta que
    // aparece cuando un repuesto desaparece del stock.
    index('idx_solicitudes_order_parts_item').on(t.itemId),
  ],
);

/**
 * Preferencias de la organizacion.
 *
 * La moneda y la zona horaria vienen del tenant legacy. `next_number` NO viene:
 * el legacy no lo tenia, asi que se arma con el folio maximo que se encuentre y
 * se reporta, en vez de arrancar en 1 y choquear con las ordenes migradas.
 */
export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    currency: text('currency').notNull().default('$'),
    timezone: text('timezone').notNull().default('America/Santiago'),
    /** Folio siguiente que se propone al crear una orden. */
    nextNumber: integer('next_number').notNull().default(1),
    /** Los estados en los que una orden cuenta como trabajo abierto. */
    statusLabels: text('status_labels'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [uniqueIndex('idx_solicitudes_settings_org').on(t.organizationId)],
);

/**
 * Mapa tenant legacy -> organizacion del Core.
 *
 * Se declara al final porque es la tabla de la que salen todas las
 * `organization_id`. Es lo que hace que la migracion sea re-ejecutable: la
 * segunda corrida lee el mapa y no vuelve a crear la organizacion.
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
  (t) => [uniqueIndex('idx_solicitudes_map_org').on(t.organizationId)],
);

export const solicitudesSchema = {
  customers,
  services,
  technicians,
  orders,
  orderServices,
  orderParts,
  settings,
  legacyTenantMap,
};
