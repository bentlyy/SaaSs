import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, like, or } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired, requireRole } from '../../middleware/auth.js';

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

customersRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const tenantId = req.session.tenantId;
    const now = new Date().toISOString();

    const visits = db.select({ id: schema.appointments.id, start_at: schema.appointments.start_at, status: schema.appointments.status, notes: schema.appointments.notes })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.tenant_id, tenantId), eq(schema.appointments.customer_id, existing.id), eq(schema.appointments.status, 'done')))
      .orderBy(desc(schema.appointments.start_at))
      .all();
    const nextVisit = db.select({ id: schema.appointments.id, start_at: schema.appointments.start_at, status: schema.appointments.status })
      .from(schema.appointments)
      .where(and(eq(schema.appointments.tenant_id, tenantId), eq(schema.appointments.customer_id, existing.id),
        gte(schema.appointments.start_at, now), or(eq(schema.appointments.status, 'pending'), eq(schema.appointments.status, 'confirmed'))))
      .orderBy(asc(schema.appointments.start_at))
      .get();
    const pendingFollowups = db.select({ id: schema.followups.id, title: schema.followups.title, due_date: schema.followups.due_date })
      .from(schema.followups)
      .where(and(eq(schema.followups.tenant_id, tenantId), eq(schema.followups.customer_id, existing.id), eq(schema.followups.status, 'pending')))
      .orderBy(asc(schema.followups.due_date))
      .limit(20)
      .all();

    return res.json({
      customer: {
        ...existing,
        visits: visits.length,
        lastVisit: visits[0]?.start_at ?? null,
        nextVisit: nextVisit?.start_at ?? null,
        followupsPending: pendingFollowups,
      },
    });
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
  requireRole('owner', 'admin'),
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