import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired, requireRole } from '../../middleware/auth.js';

export const staffRouter = Router();
staffRouter.use(authRequired);

const staffSchema = z.object({
  name: z.string().min(1).max(120),
  phone: z.string().max(30).or(z.literal('')).optional(),
  email: z.string().email().or(z.literal('')).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  active: z.boolean().optional().default(true),
  skillIds: z.array(z.string()).optional(),
});

staffRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const rows = db.select().from(schema.staffMembers)
      .where(eq(schema.staffMembers.tenant_id, req.session.tenantId))
      .orderBy(asc(schema.staffMembers.name))
      .all();

    const skills = db.select().from(schema.staffServices)
      .where(eq(schema.staffServices.tenant_id, req.session.tenantId))
      .all();

    const byStaff = new Map<string, string[]>();
    for (const s of skills) {
      const arr = byStaff.get(s.staff_id) ?? [];
      arr.push(s.service_id);
      byStaff.set(s.staff_id, arr);
    }
    return res.json({ staff: rows.map((s) => ({ ...s, skillIds: byStaff.get(s.id) ?? [] })) });
  }),
);

staffRouter.post(
  '/',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const input = staffSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;

    const result = sqlite.transaction(() => {
      const row = db.insert(schema.staffMembers).values({
        tenant_id: tenantId,
        name: input.name,
        phone: input.phone ?? '',
        email: (input.email ?? '').toLowerCase(),
        color: input.color ?? pickColor(tenantId),
        active: input.active ?? true,
      }).returning().get();

      for (const sid of input.skillIds ?? []) {
        db.insert(schema.staffServices).values({ tenant_id: tenantId, staff_id: row.id, service_id: sid }).run();
      }
      return row;
    });

    return res.status(201).json({ staff: result() });
  }),
);

staffRouter.put(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const input = staffSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const existing = getOwned(db, tenantId, req.params.id);

    const result = sqlite.transaction(() => {
      db.update(schema.staffMembers)
        .set({
          name: input.name,
          phone: input.phone ?? existing.phone,
          email: (input.email ?? existing.email ?? '').toLowerCase(),
          color: input.color ?? existing.color,
          active: input.active ?? existing.active,
        })
        .where(eq(schema.staffMembers.id, existing.id))
        .run();

      if (input.skillIds !== undefined) {
        db.delete(schema.staffServices)
          .where(and(eq(schema.staffServices.staff_id, existing.id), eq(schema.staffServices.tenant_id, tenantId)))
          .run();
        for (const sid of input.skillIds) {
          db.insert(schema.staffServices).values({ tenant_id: tenantId, staff_id: existing.id, service_id: sid }).run();
        }
      }
      return db.select().from(schema.staffMembers).where(eq(schema.staffMembers.id, existing.id)).get();
    });

    return res.json({ staff: result() });
  }),
);

staffRouter.delete(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.staffMembers)
      .where(and(eq(schema.staffMembers.id, existing.id), eq(schema.staffMembers.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.staffMembers)
    .where(and(eq(schema.staffMembers.id, id), eq(schema.staffMembers.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Empleado no encontrado');
  return row;
}
export { getOwned };

const colors = ['#4f46e5', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be123c', '#65a30d'];
function pickColor(tenantId: string) {
  const { db } = getDb();
  const n = db.select({ c: sql`count(*)` }).from(schema.staffMembers)
    .where(eq(schema.staffMembers.tenant_id, tenantId)).get() as { c: number };
  return colors[n.c % colors.length];
}