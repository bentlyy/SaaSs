import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createId } from './id.js';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());

const tenantCol = () => text('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' });
const ts = (name: string) => text(name).notNull().$defaultFn(() => new Date().toISOString());

export const tenants = sqliteTable('tenants', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  product: text('product').notNull().default('peluqueria'),
  currency: text('currency').notNull().default('$'),
  timezone: text('timezone').notNull().default('America/Mexico_City'),
  reminderHours: integer('reminder_hours').notNull().default(24),
  whatsappWebhook: text('whatsapp_webhook'),
  whatsappToken: text('whatsapp_token'),
  emailEnabled: integer('email_enabled', { mode: 'boolean' }).notNull().default(false),
  address: text('address'),
  phone: text('phone'),
  created_at: ts('created_at'),
});

export const users = sqliteTable('users', {
  id: id(),
  tenant_id: tenantCol(),
  email: text('email').notNull(),
  password_hash: text('password_hash').notNull(),
  name: text('name').notNull(),
  role: text('role', { enum: ['owner', 'admin', 'staff'] }).notNull().default('staff'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: ts('created_at'),
});

export const customers = sqliteTable('customers', {
  id: id(),
  tenant_id: tenantCol(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  birthdate: text('birthdate'),
  notes: text('notes'),
  tags: text('tags'),
  created_at: ts('created_at'),
});

export const services = sqliteTable('services', {
  id: id(),
  tenant_id: tenantCol(),
  name: text('name').notNull(),
  durationMin: integer('duration_min').notNull().default(30),
  price: integer('price').notNull().default(0),
  description: text('description'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: ts('created_at'),
});

export const staffMembers = sqliteTable('staff', {
  id: id(),
  tenant_id: tenantCol(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  color: text('color').notNull().default('#4f46e5'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: ts('created_at'),
});

export const staffServices = sqliteTable('staff_services', {
  id: id(),
  tenant_id: tenantCol(),
  staff_id: text('staff_id').notNull().references(() => staffMembers.id, { onDelete: 'cascade' }),
  service_id: text('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
});

export const resources = sqliteTable('resources', {
  id: id(),
  tenant_id: tenantCol(),
  name: text('name').notNull(),
  type: text('type').notNull().default('cancha'),
  capacity: integer('capacity').notNull().default(10),
  pricePerHour: integer('price_per_hour').notNull().default(0),
  color: text('color').notNull().default('#0891b2'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: ts('created_at'),
});

export const appointmentStatus = ['pending', 'confirmed', 'done', 'cancelled', 'noshow'] as const;

export const appointments = sqliteTable('appointments', {
  id: id(),
  tenant_id: tenantCol(),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  staff_id: text('staff_id').references(() => staffMembers.id, { onDelete: 'set null' }),
  resource_id: text('resource_id').references(() => resources.id, { onDelete: 'set null' }),
  start_at: text('start_at').notNull(),
  end_at: text('end_at').notNull(),
  notes: text('notes'),
  status: text('status', { enum: appointmentStatus }).notNull().default('pending'),
  created_at: ts('created_at'),
});

export const appointmentServices = sqliteTable('appointment_services', {
  id: id(),
  tenant_id: tenantCol(),
  appointment_id: text('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  service_id: text('service_id').notNull().references(() => services.id, { onDelete: 'restrict' }),
  price_at: integer('price_at').notNull(),
});

export const channels = ['email', 'whatsapp'] as const;

export const reminderLogs = sqliteTable('reminder_logs', {
  id: id(),
  tenant_id: tenantCol(),
  appointment_id: text('appointment_id').notNull().references(() => appointments.id, { onDelete: 'cascade' }),
  channel: text('channel', { enum: channels }).notNull(),
  status: text('status', { enum: ['sent', 'failed'] }).notNull(),
  error: text('error'),
  sent_at: ts('sent_at'),
});

export const documents = sqliteTable('documents', {
  id: id(),
  tenant_id: tenantCol(),
  type: text('type', { enum: ['cotizacion', 'recibo', 'factura', 'nota_venta'] }).notNull().default('cotizacion'),
  number: text('number').notNull(),
  customer_id: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customer_snapshot: text('customer_snapshot').notNull(),
  title: text('title').notNull().default('Cotización'),
  lines: text('lines').notNull(),
  subtotal: integer('subtotal').notNull().default(0),
  tax: integer('tax').notNull().default(0),
  total: integer('total').notNull().default(0),
  status: text('status', { enum: ['draft', 'sent', 'accepted', 'rejected'] }).notNull().default('draft'),
  created_at: ts('created_at'),
});

export const inventoryItems = sqliteTable('inventory_items', {
  id: id(),
  tenant_id: tenantCol(),
  name: text('name').notNull(),
  sku: text('sku'),
  quantity: integer('quantity').notNull().default(0),
  minQty: integer('min_qty').notNull().default(0),
  unit: text('unit').notNull().default('unidad'),
  price: integer('price').notNull().default(0),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  created_at: ts('created_at'),
});

export const inventoryMovements = sqliteTable('inventory_movements', {
  id: id(),
  tenant_id: tenantCol(),
  item_id: text('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  user_id: text('user_id'),
  created_at: ts('created_at'),
});

export const workOrderStatus = ['received', 'estimated', 'in_progress', 'done', 'cancelled'] as const;

export const workOrders = sqliteTable('work_orders', {
  id: id(),
  tenant_id: tenantCol(),
  number: integer('number').notNull(),
  customer_id: text('customer_id').notNull().references(() => customers.id, { onDelete: 'restrict' }),
  staff_id: text('staff_id').references(() => staffMembers.id, { onDelete: 'set null' }),
  vehicle_make: text('vehicle_make').notNull(),
  vehicle_model: text('vehicle_model').notNull(),
  vehicle_plate: text('vehicle_plate').notNull(),
  vehicle_year: integer('vehicle_year'),
  vehicle_odo: integer('vehicle_odo'),
  status: text('status', { enum: workOrderStatus }).notNull().default('received'),
  estimated_delivery: text('estimated_delivery'),
  notes: text('notes'),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

export const workOrderServices = sqliteTable('work_order_services', {
  id: id(),
  tenant_id: tenantCol(),
  order_id: text('order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  service_id: text('service_id').notNull().references(() => services.id, { onDelete: 'restrict' }),
  price_at: integer('price_at').notNull(),
});

export const workOrderParts = sqliteTable('work_order_parts', {
  id: id(),
  tenant_id: tenantCol(),
  order_id: text('order_id').notNull().references(() => workOrders.id, { onDelete: 'cascade' }),
  item_id: text('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'restrict' }),
  qty: integer('qty').notNull().default(1),
  unit_price_at: integer('unit_price_at').notNull(),
});

export const dbNow = sql`strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const schema = {
  tenants,
  users,
  customers,
  services,
  staffMembers,
  staffServices,
  resources,
  appointments,
  appointmentServices,
  reminderLogs,
  documents,
  inventoryItems,
  inventoryMovements,
  workOrders,
  workOrderServices,
  workOrderParts,
  appointmentStatus,
  workOrderStatus,
  channels,
};