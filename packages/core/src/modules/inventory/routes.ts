import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, lt, lte } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';

export const inventoryRouter = Router();
inventoryRouter.use(authRequired);

const itemSchema = z.object({
  name: z.string().min(1).max(150),
  sku: z.string().max(60).or(z.literal('')).optional(),
  quantity: z.number().int().min(0),
  minQty: z.number().int().min(0).default(0),
  unit: z.string().max(30).default('unidad'),
  price: z.number().nonnegative().default(0), // unidades monetarias
  active: z.boolean().optional().default(true),
});

inventoryRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const rows = db.select().from(schema.inventoryItems)
      .where(eq(schema.inventoryItems.tenant_id, req.session.tenantId))
      .orderBy(asc(schema.inventoryItems.name))
      .all();
    return res.json({ items: rows.map((r) => ({ ...r, price: r.price / 100 })) });
  }),
);

inventoryRouter.get(
  '/low-stock',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const rows = db.select().from(schema.inventoryItems)
      .where(and(
        eq(schema.inventoryItems.tenant_id, req.session.tenantId),
        lte(schema.inventoryItems.quantity, schema.inventoryItems.minQty),
      ))
      .orderBy(asc(schema.inventoryItems.name))
      .all();
    return res.json({ items: rows.map((r) => ({ ...r, price: r.price / 100 })) });
  }),
);

inventoryRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body);
    const { db } = getDb();
    const row = db.insert(schema.inventoryItems).values({
      tenant_id: req.session.tenantId,
      name: input.name,
      sku: input.sku ?? '',
      quantity: input.quantity,
      minQty: input.minQty,
      unit: input.unit,
      price: Math.round(input.price * 100),
      active: input.active ?? true,
    }).returning().get();
    return res.status(201).json({ item: { ...row, price: row.price / 100 } });
  }),
);

inventoryRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = itemSchema.parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.inventoryItems)
      .set({ ...input, price: Math.round(input.price * 100) })
      .where(eq(schema.inventoryItems.id, existing.id))
      .returning()
      .get();
    return res.json({ item: { ...row, price: row.price / 100 } });
  }),
);

const movementSchema = z.object({
  delta: z.number().int().min(1).max(1_000_000),
  reason: z.string().min(1).max(200),
});

inventoryRouter.post(
  '/:id/movements',
  asyncHandler(async (req, res) => {
    const input = movementSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const existing = getOwned(db, tenantId, req.params.id);

    const move = sqlite.transaction(() => {
      const current = db.select({ q: schema.inventoryItems.quantity }).from(schema.inventoryItems)
        .where(eq(schema.inventoryItems.id, existing.id)).get();
      const qty = input.delta > 0
        ? current!.q + input.delta
        : Math.max(0, current!.q - Math.abs(input.delta));

      db.update(schema.inventoryItems)
        .set({ quantity: qty })
        .where(eq(schema.inventoryItems.id, existing.id))
        .run();

      return db.insert(schema.inventoryMovements).values({
        tenant_id: tenantId,
        item_id: existing.id,
        delta: input.delta,
        reason: input.reason,
        user_id: req.session.userId,
      }).returning().get();
    });

    const movement = move();
    return res.status(201).json({ movement });
  }),
);

inventoryRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.inventoryItems)
      .where(and(eq(schema.inventoryItems.id, existing.id), eq(schema.inventoryItems.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.inventoryItems)
    .where(and(eq(schema.inventoryItems.id, id), eq(schema.inventoryItems.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Artículo no encontrado');
  return row;
}