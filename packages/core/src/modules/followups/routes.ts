import { Router } from 'express';
import { z } from 'zod';
import { and, asc, count, eq, gte, inArray, lt, like, or, type SQL } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';

export const followupsRouter = Router();
followupsRouter.use(authRequired);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const followupSchema = z.object({
  customerId: z.string().min(1),
  title: z.string().min(1).max(160),
  body: z.string().max(2000).or(z.literal('')).optional(),
  dueDate: z.string().regex(DATE_RE).or(z.literal('')).optional(),
  status: z.enum(schema.followupStatus).optional(),
});

const patchSchema = followupSchema.partial().extend({ customerId: z.string().min(1).optional() });

/**
 * Lista seguimientos del negocio.
 * Filtros: ?customerId=, ?status=pending|done|cancelled, ?overdue=1 (pendientes con due_date < hoy) y ?q=
 */
followupsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const today = new Date().toISOString().slice(0, 10);
    const conditions: SQL[] = [eq(schema.followups.tenant_id, tenantId)];

    const customerId = String(req.query.customerId ?? '');
    if (customerId) conditions.push(eq(schema.followups.customer_id, customerId));
    const status = String(req.query.status ?? '');
    if ((schema.followupStatus as readonly string[]).includes(status)) {
      conditions.push(eq(schema.followups.status, status as (typeof schema.followupStatus)[number]));
    }
    const overdue = String(req.query.overdue ?? '') === '1';
    if (overdue) {
      conditions.push(eq(schema.followups.status, 'pending'));
      conditions.push(lt(schema.followups.due_date, today) as SQL);
    }
    const q = String(req.query.q ?? '').trim();
    if (q) conditions.push(like(schema.followups.title, `%${q}%`));

    const rows = db.select().from(schema.followups).where(and(...conditions)).limit(300).all();

    const custIds = [...new Set(rows.map((r) => r.customer_id))];
    const custs = custIds.length ? db.select().from(schema.customers).where(inArray(schema.customers.id, custIds)).all() : [];
    const custMap = new Map(custs.map((c) => [c.id, c]));

    const followups = rows
      .map((f) => {
        const c = custMap.get(f.customer_id);
        return {
          ...f,
          overdue: f.status === 'pending' && Boolean(f.due_date) && f.due_date! < today,
          customer: c ? { id: c.id, name: c.name, phone: c.phone, email: c.email, tags: c.tags } : null,
        };
      })
      .sort(sortFollowups);
    return res.json({ followups });
  }),
);

/**
 * Métricas del CRM del negocio: cartera, etiquetas, seguimientos y actividad.
 */
followupsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date(Date.now() - 24 * 3600_000).toISOString();
    const weekAhead = new Date(Date.now() + 7 * 86400_000).toISOString();
    const monthBack = new Date(Date.now() - 30 * 86400_000).toISOString();

    const custs = db.select().from(schema.customers).where(eq(schema.customers.tenant_id, tenantId)).all();
    const tags: Record<string, number> = {};
    for (const c of custs) {
      for (const t of (c.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
        tags[t] = (tags[t] ?? 0) + 1;
      }
    }

    const pendingRow = db.select({ n: count() }).from(schema.followups)
      .where(and(eq(schema.followups.tenant_id, tenantId), eq(schema.followups.status, 'pending'))).get()!;
    const doneRow = db.select({ n: count() }).from(schema.followups)
      .where(and(eq(schema.followups.tenant_id, tenantId), eq(schema.followups.status, 'done'))).get()!;
    const cancelledRow = db.select({ n: count() }).from(schema.followups)
      .where(and(eq(schema.followups.tenant_id, tenantId), eq(schema.followups.status, 'cancelled'))).get()!;
    const overdueRow = db.select({ n: count() }).from(schema.followups)
      .where(and(eq(schema.followups.tenant_id, tenantId), eq(schema.followups.status, 'pending'), lt(schema.followups.due_date, today))).get()!;

    const visits30Row = db.select({ n: count() }).from(schema.appointments)
      .where(and(eq(schema.appointments.tenant_id, tenantId), eq(schema.appointments.status, 'done'),
        gte(schema.appointments.start_at, monthBack))).get()!;
    const upcoming7Row = db.select({ n: count() }).from(schema.appointments)
      .where(and(eq(schema.appointments.tenant_id, tenantId),
        or(eq(schema.appointments.status, 'pending'), eq(schema.appointments.status, 'confirmed')),
        gte(schema.appointments.start_at, now), lt(schema.appointments.start_at, weekAhead))).get()!;
    const nextAppt = db.select({ start_at: schema.appointments.start_at }).from(schema.appointments)
      .where(and(eq(schema.appointments.tenant_id, tenantId),
        or(eq(schema.appointments.status, 'pending'), eq(schema.appointments.status, 'confirmed')),
        gte(schema.appointments.start_at, now)))
      .orderBy(asc(schema.appointments.start_at)).get();

    return res.json({
      customers: {
        total: custs.length,
        withEmail: custs.filter((c) => c.email).length,
        withPhone: custs.filter((c) => c.phone).length,
        withBoth: custs.filter((c) => c.email && c.phone).length,
      },
      tags: Object.entries(tags).map(([tag, n]) => ({ tag, count: n })).sort((a, b) => b.count - a.count),
      followups: {
        pending: pendingRow.n,
        done: doneRow.n,
        overdue: overdueRow.n,
        cancelled: cancelledRow.n,
        total: pendingRow.n + doneRow.n + cancelledRow.n,
      },
      visits: { done30: visits30Row.n, upcoming7: upcoming7Row.n, nextAt: nextAppt?.start_at ?? null },
    });
  }),
);

followupsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = followupSchema.parse(req.body);
    const { db } = getDb();
    const now = new Date().toISOString();
    const row = db.insert(schema.followups).values({
      tenant_id: req.session.tenantId,
      customer_id: input.customerId,
      title: input.title,
      body: input.body ?? '',
      due_date: input.dueDate ?? '',
      status: input.status ?? 'pending',
      created_at: now,
      updated_at: now,
    }).returning().get();
    return res.status(201).json({ followup: row });
  }),
);

followupsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = patchSchema.parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.followups)
      .set({ ...input, updated_at: new Date().toISOString() })
      .where(and(eq(schema.followups.id, existing.id), eq(schema.followups.tenant_id, req.session.tenantId)))
      .returning().get();
    return res.json({ followup: row });
  }),
);

followupsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.followups)
      .where(and(eq(schema.followups.id, existing.id), eq(schema.followups.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

function sortFollowups(a: { status: string; due_date: string | null; created_at: string }, b: { status: string; due_date: string | null; created_at: string }) {
  if (a.status !== b.status) return a.status === 'pending' ? -1 : 1;
  const da = a.due_date || '9999';
  const dbd = b.due_date || '9999';
  return da.localeCompare(dbd) || a.created_at.localeCompare(b.created_at);
}

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.followups)
    .where(and(eq(schema.followups.id, id), eq(schema.followups.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Seguimiento no encontrado');
  return row;
}