import { Router } from 'express';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';
import { attachServices } from '../appointments/routes.js';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const todayStart = localDayStart(new Date());

    const appointmentsCount = db.select({ n: sql<number>`count(*)` }).from(schema.appointments)
      .where(and(
        eq(schema.appointments.tenant_id, tenantId),
        gte(schema.appointments.start_at, todayStart),
        lt(schema.appointments.start_at, addDays(todayStart, 1)),
        eq(schema.appointments.status, 'confirmed'),
      )).get()?.n ?? 0;

    const customersCount = db.select({ n: sql<number>`count(*)` }).from(schema.customers)
      .where(eq(schema.customers.tenant_id, tenantId)).get()?.n ?? 0;

    const lowStock = db.select({ n: sql<number>`count(*)` }).from(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.tenant_id, tenantId),
        sql`${schema.inventoryItems.quantity} <= ${schema.inventoryItems.minQty}`)).get()?.n ?? 0;

    const upcoming = db.select().from(schema.appointments)
      .where(and(
        eq(schema.appointments.tenant_id, tenantId),
        gte(schema.appointments.start_at, new Date().toISOString()),
        eq(schema.appointments.status, 'confirmed'),
      ))
      .orderBy(schema.appointments.start_at)
      .limit(5)
      .all();

    return res.json({
      summary: { appointmentsToday: appointmentsCount, customers: customersCount, lowStockItems: lowStock },
      upcoming: attachServices(db, tenantId, upcoming),
    });
  }),
);

function localDayStart(d: Date): string {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.toISOString();
}
function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 24 * 60 * 60_000).toISOString();
}