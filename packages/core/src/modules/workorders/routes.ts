import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, like } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';
import { getOwned as getCustomer } from '../customers/routes.js';
import { getOwned as getService } from '../services/routes.js';
import { getOwned as getStaff } from '../staff/routes.js';
import { getOwned as getItem } from '../inventory/routes.js';

export const workordersRouter = Router();
workordersRouter.use(authRequired);

const part = z.object({
  itemId: z.string().min(1),
  qty: z.number().int().min(1).max(10_000),
});

const vehicle = z.object({
  make: z.string().min(1).max(60),
  model: z.string().min(1).max(80),
  plate: z.string().min(1).max(20),
  year: z.number().int().min(1900).max(2200).optional(),
  odo: z.number().int().min(0).max(10_000_000).optional(),
});

const orderSchema = z.object({
  customerId: z.string().min(1),
  staffId: z.string().min(1).nullable().optional(),
  vehicle,
  serviceIds: z.array(z.string()).max(30).optional().default([]),
  parts: z.array(part).max(50).optional().default([]),
  estimatedDelivery: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha estimada inválida').nullable().optional(),
  notes: z.string().max(2000).or(z.literal('')).optional(),
  status: z.enum(schema.workOrderStatus).optional(),
});

workordersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const conditions = [eq(schema.workOrders.tenant_id, tenantId)];
    const statusParsed = z.enum(schema.workOrderStatus).safeParse(req.query.status);
    if (statusParsed.success) conditions.push(eq(schema.workOrders.status, statusParsed.data));
    if (req.query.q) {
      const q = `%${String(req.query.q).toLowerCase()}%`;
      conditions.push(like(schema.workOrders.vehicle_plate, q));
    }
    const rows = db.select().from(schema.workOrders)
      .where(and(...conditions))
      .orderBy(asc(schema.workOrders.updated_at))
      .all();
    return res.json({ orders: attachLines(db, tenantId, rows) });
  }),
);

workordersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const row = getOwned(db, tenantId, req.params.id);
    return res.json({ order: attachLines(db, tenantId, [row])[0] });
  }),
);

workordersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = orderSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const userId = req.session.userId;
    validateRefs(db, tenantId, input);

    const insert = sqlite.transaction(() => {
      const order = db.insert(schema.workOrders).values({
        tenant_id: tenantId,
        number: nextOrderNumber(db, tenantId),
        customer_id: input.customerId,
        staff_id: input.staffId ?? null,
        vehicle_make: input.vehicle.make,
        vehicle_model: input.vehicle.model,
        vehicle_plate: input.vehicle.plate.toLowerCase(),
        vehicle_year: input.vehicle.year ?? null,
        vehicle_odo: input.vehicle.odo ?? null,
        status: input.status ?? 'received',
        estimated_delivery: input.estimatedDelivery ?? null,
        notes: input.notes ?? '',
      }).returning().get();

      for (const sid of input.serviceIds) {
        const svc = getService(db, tenantId, sid);
        db.insert(schema.workOrderServices).values({
          tenant_id: tenantId, order_id: order.id, service_id: svc.id, price_at: svc.price,
        }).run();
      }
      for (const p of input.parts) {
        const item = getItem(db, tenantId, p.itemId);
        db.insert(schema.workOrderParts).values({
          tenant_id: tenantId, order_id: order.id, item_id: item.id,
          qty: p.qty, unit_price_at: item.price,
        }).run();
        consume(db, tenantId, userId, item, p.qty, `Orden #${order.number}: ${item.name}`);
      }
      return order;
    });

    const order = insert();
    return res.status(201).json({ order: attachLines(db, tenantId, [order])[0] });
  }),
);

workordersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = orderSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const userId = req.session.userId;
    const existing = getOwned(db, tenantId, req.params.id);
    validateRefs(db, tenantId, input);

    const update = sqlite.transaction(() => {
      // diferencia de piezas frente a inventario (restock / consumo)
      const oldParts = db.select().from(schema.workOrderParts)
        .where(eq(schema.workOrderParts.order_id, existing.id)).all();
      const diff = partsDiff(oldParts, input.parts);
      for (const p of diff) {
        const item = getItem(db, tenantId, p.itemId);
        if (p.delta > 0) {
          // más piezas comprometidas que antes → consumo adicional
          consume(db, tenantId, userId, item, p.delta, `Orden #${existing.number}: ${item.name}`);
        } else {
          // menos piezas comprometidas → liberar el excedente
          restock(db, tenantId, userId, item, -p.delta, `Devolución orden #${existing.number}`);
        }
      }

      db.update(schema.workOrders)
        .set({
          customer_id: input.customerId,
          staff_id: input.staffId ?? null,
          vehicle_make: input.vehicle.make,
          vehicle_model: input.vehicle.model,
          vehicle_plate: input.vehicle.plate.toLowerCase(),
          vehicle_year: input.vehicle.year ?? null,
          vehicle_odo: input.vehicle.odo ?? null,
          status: input.status ?? existing.status,
          estimated_delivery: input.estimatedDelivery ?? null,
          notes: input.notes ?? '',
          updated_at: new Date().toISOString(),
        })
        .where(eq(schema.workOrders.id, existing.id))
        .run();

      db.delete(schema.workOrderServices).where(eq(schema.workOrderServices.order_id, existing.id)).run();
      for (const sid of input.serviceIds) {
        const svc = getService(db, tenantId, sid);
        db.insert(schema.workOrderServices).values({
          tenant_id: tenantId, order_id: existing.id, service_id: svc.id, price_at: svc.price,
        }).run();
      }
      db.delete(schema.workOrderParts).where(eq(schema.workOrderParts.order_id, existing.id)).run();
      for (const p of input.parts) {
        const item = getItem(db, tenantId, p.itemId);
        db.insert(schema.workOrderParts).values({
          tenant_id: tenantId, order_id: existing.id, item_id: item.id,
          qty: p.qty, unit_price_at: item.price,
        }).run();
      }
      return db.select().from(schema.workOrders).where(eq(schema.workOrders.id, existing.id)).get()!;
    });

    const order = update();
    return res.json({ order: attachLines(db, tenantId, [order])[0] });
  }),
);

workordersRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const input = z.object({ status: z.enum(schema.workOrderStatus) }).parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const existing = getOwned(db, tenantId, req.params.id);

    const update = sqlite.transaction(() => {
      if (input.status === 'cancelled' && existing.status !== 'cancelled') {
        // cancelar libera las piezas asignadas al inventario
        const parts = db.select().from(schema.workOrderParts)
          .where(eq(schema.workOrderParts.order_id, existing.id)).all();
        for (const p of parts) {
          const item = getItem(db, tenantId, p.item_id);
          restock(db, tenantId, req.session.userId, item, p.qty, `Cancelación orden #${existing.number}`);
        }
      }
      return db.update(schema.workOrders)
        .set({ status: input.status, updated_at: new Date().toISOString() })
        .where(eq(schema.workOrders.id, existing.id))
        .returning().get();
    });

    const order = update();
    return res.json({ order: attachLines(db, tenantId, [order])[0] });
  }),
);

workordersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const existing = getOwned(db, tenantId, req.params.id);

    const remove = sqlite.transaction(() => {
      const parts = db.select().from(schema.workOrderParts)
        .where(eq(schema.workOrderParts.order_id, existing.id)).all();
      for (const p of parts) {
        const item = getItem(db, tenantId, p.item_id);
        restock(db, tenantId, req.session.userId, item, p.qty, `Orden #${existing.number} eliminada`);
      }
      db.delete(schema.workOrders)
        .where(and(eq(schema.workOrders.id, existing.id), eq(schema.workOrders.tenant_id, tenantId)))
        .run();
    });
    remove();
    return res.json({ ok: true });
  }),
);

// ── helpers ──
function nextOrderNumber(db: ReturnType<typeof getDb>['db'], tenantId: string) {
  const row = db.select({ n: schema.workOrders.number }).from(schema.workOrders)
    .where(eq(schema.workOrders.tenant_id, tenantId))
    .orderBy(desc(schema.workOrders.number))
    .get();
  return (row?.n ?? 0) + 1;
}

function validateRefs(db: ReturnType<typeof getDb>['db'], tenantId: string, input: z.infer<typeof orderSchema>) {
  getCustomer(db, tenantId, input.customerId);
  if (input.staffId) getStaff(db, tenantId, input.staffId);
  const svcs = db.select().from(schema.services)
    .where(and(inArray(schema.services.id, input.serviceIds), eq(schema.services.tenant_id, tenantId)))
    .all();
  if (svcs.length !== input.serviceIds.length) throw new AppError(400, 'Alguna labor es inválida');
}

function consume(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  userId: string | undefined,
  item: ReturnType<typeof getItem>,
  qty: number,
  reason: string,
) {
  const current = db.select({ q: schema.inventoryItems.quantity }).from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, item.id)).get();
  if ((current?.q ?? 0) < qty) {
    throw new AppError(400, `Stock insuficiente de "${item.name}" (disponible: ${current?.q ?? 0})`);
  }
  db.update(schema.inventoryItems)
    .set({ quantity: Math.max(0, (current?.q ?? 0) - qty) })
    .where(eq(schema.inventoryItems.id, item.id))
    .run();
  db.insert(schema.inventoryMovements).values({
    tenant_id: tenantId, item_id: item.id, delta: -qty, reason, user_id: userId,
  }).run();
}

function restock(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  userId: string | undefined,
  item: ReturnType<typeof getItem>,
  qty: number,
  reason: string,
) {
  const current = db.select({ q: schema.inventoryItems.quantity }).from(schema.inventoryItems)
    .where(eq(schema.inventoryItems.id, item.id)).get();
  db.update(schema.inventoryItems)
    .set({ quantity: (current?.q ?? 0) + qty })
    .where(eq(schema.inventoryItems.id, item.id))
    .run();
  db.insert(schema.inventoryMovements).values({
    tenant_id: tenantId, item_id: item.id, delta: qty, reason, user_id: userId,
  }).run();
}

function partsDiff(
  oldParts: (typeof schema.workOrderParts.$inferSelect)[],
  newParts: z.infer<typeof orderSchema>['parts'],
) {
  const byItem = new Map<string, number>();
  for (const p of oldParts) byItem.set(p.item_id, (byItem.get(p.item_id) ?? 0) - p.qty);
  for (const p of newParts) byItem.set(p.itemId, (byItem.get(p.itemId) ?? 0) + p.qty);
  const out: Array<{ itemId: string; delta: number }> = [];
  for (const [itemId, delta] of byItem) {
    if (delta !== 0) out.push({ itemId, delta });
  }
  return out;
}

export function attachLines(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  rows: (typeof schema.workOrders.$inferSelect)[],
) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return rows.map((r) => ({ ...r, vehicle: vehicleOf(r), services: [], parts: [], totals: totalsOf([], []) }));

  const svcLinks = db.select().from(schema.workOrderServices)
    .where(and(eq(schema.workOrderServices.tenant_id, tenantId), inArray(schema.workOrderServices.order_id, ids)))
    .all();
  const partLinks = db.select().from(schema.workOrderParts)
    .where(and(eq(schema.workOrderParts.tenant_id, tenantId), inArray(schema.workOrderParts.order_id, ids)))
    .all();

  const svcIds = [...new Set(svcLinks.map((l) => l.service_id))];
  const services = svcIds.length ? db.select().from(schema.services).where(inArray(schema.services.id, svcIds)).all() : [];
  const svcMap = new Map(services.map((s) => [s.id, s]));
  const svcByOrder = new Map<string, (typeof schema.services.$inferSelect & { price_at: number })[]>();
  for (const l of svcLinks) {
    const svc = svcMap.get(l.service_id);
    if (!svc) continue;
    const list = svcByOrder.get(l.order_id) ?? [];
    list.push({ ...svc, price_at: l.price_at });
    svcByOrder.set(l.order_id, list);
  }

  const itemIds = [...new Set(partLinks.map((l) => l.item_id))];
  const items = itemIds.length ? db.select().from(schema.inventoryItems).where(inArray(schema.inventoryItems.id, itemIds)).all() : [];
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const partByOrder = new Map<string, (typeof schema.inventoryItems.$inferSelect & { qty: number; unit_price_at: number })[]>();
  for (const l of partLinks) {
    const item = itemMap.get(l.item_id);
    if (!item) continue;
    const list = partByOrder.get(l.order_id) ?? [];
    list.push({ ...item, qty: l.qty, unit_price_at: l.unit_price_at });
    partByOrder.set(l.order_id, list);
  }

  return rows.map((r) => {
    const servicesArray = svcByOrder.get(r.id) ?? [];
    const partsArray = partByOrder.get(r.id) ?? [];
    return { ...r, vehicle: vehicleOf(r), services: servicesArray, parts: partsArray, totals: totalsOf(servicesArray, partsArray) };
  });
}

function vehicleOf(r: (typeof schema.workOrders.$inferSelect)) {
  return {
    make: r.vehicle_make,
    model: r.vehicle_model,
    plate: r.vehicle_plate,
    year: r.vehicle_year ?? undefined,
    odo: r.vehicle_odo ?? undefined,
  };
}

function totalsOf(
  services: Array<{ price_at: number }>,
  parts: Array<{ qty: number; unit_price_at: number }>,
) {
  const labor = services.reduce((sum, s) => sum + s.price_at, 0);
  const partsTotal = parts.reduce((sum, p) => sum + p.qty * p.unit_price_at, 0);
  const total = labor + partsTotal;
  return { labor, parts: partsTotal, total };
}

function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.workOrders)
    .where(and(eq(schema.workOrders.id, id), eq(schema.workOrders.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Orden no encontrada');
  return row;
}