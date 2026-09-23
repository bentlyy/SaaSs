import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';

export const servicesRouter = Router();
servicesRouter.use(authRequired);

const serviceSchema = z.object({
  name: z.string().min(1).max(120),
  durationMin: z.number().int().min(5).max(600),
  price: z.number().int().min(0).max(100_000_000),
  description: z.string().max(1000).or(z.literal('')).optional(),
  active: z.boolean().optional().default(true),
});

servicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const reference = eq(schema.services.tenant_id, req.session.tenantId);
    const rows = db.select().from(schema.services)
      .where(and(reference))
      .orderBy(asc(schema.services.name))
      .all();
    return res.json({ services: rows });
  }),
);

servicesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = serviceSchema.parse(req.body);
    const { db } = getDb();
    const row = db.insert(schema.services).values({
      tenant_id: req.session.tenantId,
      ...input,
    }).returning().get();
    return res.status(201).json({ service: row });
  }),
);

servicesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = serviceSchema.parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.services)
      .set(input)
      .where(and(eq(schema.services.id, existing.id), eq(schema.services.tenant_id, req.session.tenantId)))
      .returning()
      .get();
    return res.json({ service: row });
  }),
);

servicesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.services)
      .where(and(eq(schema.services.id, existing.id), eq(schema.services.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.services)
    .where(and(eq(schema.services.id, id), eq(schema.services.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Servicio no encontrado');
  return row;
}