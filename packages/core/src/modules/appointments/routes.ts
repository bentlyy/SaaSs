import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';
import { getOwned as getCustomer } from '../customers/routes.js';
import { getOwned as getService } from '../services/routes.js';
import { getOwned as getStaff } from '../staff/routes.js';
import { getOwned as getResource } from '../resources/routes.js';

export const appointmentsRouter = Router();
appointmentsRouter.use(authRequired);

const isoDateTime = z.string().refine((v) => !isNaN(Date.parse(v)), 'Fecha/hora inválida');

const appointmentSchema = z.object({
  customerId: z.string().min(1),
  staffId: z.string().min(1).nullable().optional(),
  resourceId: z.string().min(1).nullable().optional(),
  startAt: isoDateTime,
  durationMin: z.number().int().min(5).max(600),
  serviceIds: z.array(z.string()).max(20).optional().default([]),
  notes: z.string().max(2000).or(z.literal('')).optional(),
  status: z.enum(schema.appointmentStatus).optional(),
});

/**
 * Citas en un rango de fechas. `from`/`to` deben ser fechas ISO (YYYY-MM-DD).
 */
appointmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = requiredDate(req.query.from, 'from');
    const to = requiredDate(req.query.to, 'to');
    const { db } = getDb();
    const tenantId = req.session.tenantId;

    const rows = db.select().from(schema.appointments)
      .where(and(
        eq(schema.appointments.tenant_id, tenantId),
        gte(schema.appointments.start_at, `${from}T00:00:00.000Z`),
        lte(schema.appointments.start_at, `${to}T23:59:59.999Z`),
      ))
      .orderBy(asc(schema.appointments.start_at))
      .all();

    return res.json({ appointments: attachServices(db, tenantId, rows) });
  }),
);

appointmentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = appointmentSchema.parse(req.body);
    validateServices(getDb().db, req.session.tenantId, input);
    ensureNoConflict(getDb().db, req.session.tenantId, input, undefined);

    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const endAt = new Date(new Date(input.startAt).getTime() + input.durationMin * 60_000).toISOString();

    const insert = sqlite.transaction(() => {
      const appt = db.insert(schema.appointments).values({
        tenant_id: tenantId,
        customer_id: input.customerId,
        staff_id: input.staffId ?? null,
        resource_id: input.resourceId ?? null,
        start_at: new Date(input.startAt).toISOString(),
        end_at: endAt,
        notes: input.notes ?? '',
        status: input.status ?? 'pending',
      }).returning().get();

      for (const sid of input.serviceIds) {
        const svc = getService(db, tenantId, sid);
        db.insert(schema.appointmentServices).values({
          tenant_id: tenantId,
          appointment_id: appt.id,
          service_id: svc.id,
          price_at: svc.price,
        }).run();
      }
      return appt;
    });

    const appt = insert();
    return res.status(201).json({ appointment: appt });
  }),
);

appointmentsRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = appointmentSchema.parse(req.body);
    const { db, sqlite } = getDb();
    const tenantId = req.session.tenantId;
    const existing = getOwned(db, tenantId, req.params.id);
    validateServices(db, tenantId, input);
    ensureNoConflict(db, tenantId, input, existing.id);

    const endAt = new Date(new Date(input.startAt).getTime() + input.durationMin * 60_000).toISOString();

    const update = sqlite.transaction(() => {
      db.update(schema.appointments)
        .set({
          customer_id: input.customerId,
          staff_id: input.staffId ?? null,
          resource_id: input.resourceId ?? null,
          start_at: new Date(input.startAt).toISOString(),
          end_at: endAt,
          notes: input.notes ?? '',
          status: input.status ?? existing.status,
        })
        .where(eq(schema.appointments.id, existing.id))
        .run();

      db.delete(schema.appointmentServices).where(eq(schema.appointmentServices.appointment_id, existing.id)).run();
      for (const sid of input.serviceIds) {
        const svc = getService(db, tenantId, sid);
        db.insert(schema.appointmentServices).values({
          tenant_id: tenantId,
          appointment_id: existing.id,
          service_id: svc.id,
          price_at: svc.price,
        }).run();
      }
      return db.select().from(schema.appointments).where(eq(schema.appointments.id, existing.id)).get();
    });

    return res.json({ appointment: update() });
  }),
);

appointmentsRouter.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const input = z.object({ status: z.enum(schema.appointmentStatus) }).parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.appointments)
      .set({ status: input.status })
      .where(eq(schema.appointments.id, existing.id))
      .returning()
      .get();
    return res.json({ appointment: row });
  }),
);

appointmentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.appointments)
      .where(and(eq(schema.appointments.id, existing.id), eq(schema.appointments.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

// ── helpers ──
function requiredDate(value: unknown, name: string): string {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new AppError(400, `Parámetro ${name} debe ser YYYY-MM-DD`);
  return s;
}

function validateServices(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  input: z.infer<typeof appointmentSchema>,
) {
  getCustomer(db, tenantId, input.customerId);
  if (input.staffId) getStaff(db, tenantId, input.staffId);
  if (input.resourceId) getResource(db, tenantId, input.resourceId);
  const svcs = db.select().from(schema.services)
    .where(and(inArray(schema.services.id, input.serviceIds), eq(schema.services.tenant_id, tenantId)))
    .all();
  if (svcs.length !== input.serviceIds.length) throw new AppError(400, 'Algún servicio es inválido');
}

/**
 * Detecta solapamientos con otras citas activas del mismo empleado o recurso.
 */
function ensureNoConflict(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  input: z.infer<typeof appointmentSchema>,
  excludeId: string | undefined,
) {
  if (!input.staffId && !input.resourceId) return;
  const start = new Date(input.startAt).getTime();
  const end = start + input.durationMin * 60_000;
  // ventana amplia para la consulta (query barata + filtro exacto en memoria)
  const padStart = new Date(start - 24 * 60 * 60_000).toISOString();
  const padEnd = new Date(end + 24 * 60 * 60_000).toISOString();

  const active: (typeof schema.appointments.$inferSelect)['status'][] = ['pending', 'confirmed'];

  if (input.staffId) {
    const candidates = db.select().from(schema.appointments)
      .where(and(
        eq(schema.appointments.tenant_id, tenantId),
        eq(schema.appointments.staff_id, input.staffId),
        inArray(schema.appointments.status, active),
        gte(schema.appointments.start_at, padStart),
        lte(schema.appointments.start_at, padEnd),
      ))
      .all()
      .filter((a) => a.id !== excludeId);

    const clash = candidates.some((a) => overlaps(a, start, end));
    if (clash) throw new AppError(409, 'Conflicto: ese empleado ya tiene una cita en ese horario');
  }

  if (input.resourceId) {
    const candidates = db.select().from(schema.appointments)
      .where(and(
        eq(schema.appointments.tenant_id, tenantId),
        eq(schema.appointments.resource_id, input.resourceId),
        inArray(schema.appointments.status, active),
        gte(schema.appointments.start_at, padStart),
        lte(schema.appointments.start_at, padEnd),
      ))
      .all()
      .filter((a) => a.id !== excludeId);

    const clash = candidates.some((a) => overlaps(a, start, end));
    if (clash) throw new AppError(409, 'Conflicto: ese recurso ya está reservado en ese horario');
  }
}

function overlaps(a: { start_at: string; end_at: string }, start: number, end: number) {
  const aStart = Date.parse(a.start_at);
  const aEnd = Date.parse(a.end_at);
  return aStart < end && aEnd > start; // intersección real
}

export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.appointments)
    .where(and(eq(schema.appointments.id, id), eq(schema.appointments.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Cita no encontrada');
  return row;
}

export function attachServices(
  db: ReturnType<typeof getDb>['db'],
  tenantId: string,
  rows: (typeof schema.appointments.$inferSelect)[],
) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return rows.map((r) => ({ ...r, services: [] }));

  const items = db.select().from(schema.appointmentServices)
    .where(and(eq(schema.appointmentServices.tenant_id, tenantId), inArray(schema.appointmentServices.appointment_id, ids)))
    .all();

  const svcIds = [...new Set(items.map((i) => i.service_id))];
  const services = svcIds.length
    ? db.select().from(schema.services).where(inArray(schema.services.id, svcIds)).all()
    : [];

  const byId = new Map(services.map((s) => [s.id, s]));
  const byAppt = new Map<string, (typeof schema.services.$inferSelect & { price_at: number })[]>();
  for (const i of items) {
    const list = byAppt.get(i.appointment_id) ?? [];
    const svc = byId.get(i.service_id);
    if (svc) list.push({ ...svc, price_at: i.price_at });
    byAppt.set(i.appointment_id, list);
  }

  return rows.map((r) => ({ ...r, services: byAppt.get(r.id) ?? [] }));
}