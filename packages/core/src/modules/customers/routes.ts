import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, like } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';

export const customersRouter = Router();
customersRouter.use(authRequired);

const customerSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(30).or(z.literal('')).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  birthdate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal('')).optional(),
  notes: z.string().max(2000).or(z.literal('')).optional(),
  tags: z.string().max(200).or(z.literal('')).optional(),
});

customersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const q = String(req.query.q ?? '').trim();
    const where = and(
      eq(schema.customers.tenant_id, req.session.tenantId),
      q ? like(schema.customers.name, `%${q}%`) : undefined,
    );
    const rows = db.select().from(schema.customers)
      .where(where)
      .orderBy(asc(schema.customers.name))
      .limit(500)
      .all();
    return res.json({ customers: rows });
  }),
);

customersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = customerSchema.parse(req.body);
    const { db } = getDb();
    const row = db.insert(schema.customers).values({
      tenant_id: req.session.tenantId,
      ...normalize(input),
    }).returning().get();
    return res.status(201).json({ customer: row });
  }),
);

customersRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = customerSchema.parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.customers)
      .set(normalize(input))
      .where(and(eq(schema.customers.id, existing.id), eq(schema.customers.tenant_id, req.session.tenantId)))
      .returning()
      .get();
    return res.json({ customer: row });
  }),
);

customersRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.customers)
      .where(and(eq(schema.customers.id, existing.id), eq(schema.customers.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

function normalize(input: z.infer<typeof customerSchema>) {
  return {
    name: input.name,
    phone: input.phone ?? '',
    email: (input.email ?? '').toLowerCase(),
    birthdate: input.birthdate ?? '',
    notes: input.notes ?? '',
    tags: input.tags ?? '',
  };
}

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.customers)
    .where(and(eq(schema.customers.id, id), eq(schema.customers.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Cliente no encontrado');
  return row;
}