import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { attachServices } from '../appointments/routes.js';

/**
 * Adjunta cliente y servicios a una cita (para construir mensajes de recordatorio).
 */
export function attachReminderMeta(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  appointment: typeof schema.appointments.$inferSelect,
) {
  const customer = db.select().from(schema.customers)
    .where(and(eq(schema.customers.id, appointment.customer_id), eq(schema.customers.tenant_id, tenantId)))
    .get();
  if (!customer) return null;
  const [withServices] = attachServices(db, tenantId, [appointment]);
  return { appointment: withServices, customer };
}