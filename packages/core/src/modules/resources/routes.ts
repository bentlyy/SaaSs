import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired, requireRole } from '../../middleware/auth.js';

export const resourcesRouter = Router();
resourcesRouter.use(authRequired);

const resourceSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(60).default('cancha'),
  capacity: z.number().int().min(1).max(10000).default(10),
  pricePerHour: z.number().int().min(0).max(100_000_000),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  active: z.boolean().optional().default(true),
});

// precio en unidades monetarias → se recibe como número decimal y se guarda en centavos
resourcesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const rows = db.select().from(schema.resources)
      .where(eq(schema.resources.tenant_id, req.session.tenantId))
      .orderBy(asc(schema.resources.name))
      .all();
    return res.json({ resources: rows.map((r) => ({ ...r, pricePerHour: r.pricePerHour / 100 })) });
  }),
);

resourcesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = resourceSchema.parse(req.body);
    const { db } = getDb();
    const row = db.insert(schema.resources).values({
      tenant_id: req.session.tenantId,
      name: input.name,
      type: input.type,
      capacity: input.capacity,
      pricePerHour: Math.round(input.pricePerHour * 100),
      color: input.color ?? pickColor(req.session.tenantId),
      active: input.active ?? true,
    }).returning().get();
    return res.status(201).json({ resource: { ...row, pricePerHour: row.pricePerHour / 100 } });
  }),
);

resourcesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = resourceSchema.parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.resources)
      .set({ ...input, pricePerHour: Math.round(input.pricePerHour * 100) })
      .where(eq(schema.resources.id, existing.id))
      .returning()
      .get();
    return res.json({ resource: { ...row, pricePerHour: row.pricePerHour / 100 } });
  }),
);

resourcesRouter.delete(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.resources)
      .where(and(eq(schema.resources.id, existing.id), eq(schema.resources.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

const colors = ['#0891b2', '#ea580c', '#16a34a', '#7c3aed', '#dc2626', '#ca8a04', '#2563eb', '#db2777'];
function pickColor(tenantId: string) {
  const { db } = getDb();
  const n = db.select({ id: schema.resources.id }).from(schema.resources)
    .where(eq(schema.resources.tenant_id, tenantId)).all().length;
  return colors[n % colors.length];
}

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.resources)
    .where(and(eq(schema.resources.id, id), eq(schema.resources.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Recurso no encontrado');
  return row;
}