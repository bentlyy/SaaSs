import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { config } from '../../config.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired } from '../../middleware/auth.js';
import { getOwned as getAppointment } from '../appointments/routes.js';
import { attachReminderMeta } from './meta.js';
import { reminderService } from './service.js';
import { buildMessage, processDueReminders } from './scheduler.js';

export const remindersRouter = Router();
remindersRouter.use(authRequired);

/**
 * Estado de los canales de recordatorio del negocio + conteo de envíos.
 */
remindersRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, req.session.tenantId)).get();
    if (!tenant) throw new AppError(404, 'Negocio no encontrado');

    const logs = db.select({ status: schema.reminderLogs.status }).from(schema.reminderLogs)
      .where(eq(schema.reminderLogs.tenant_id, tenant.id))
      .all();
    const sent = logs.filter((l) => l.status === 'sent').length;
    const failed = logs.filter((l) => l.status === 'failed').length;

    const windowStart = new Date(Date.now() + tenant.reminderHours * 3600_000);
    const after = new Date(Date.now() - tenant.reminderHours * 3600_000);
    const upcoming = db.select({ id: schema.appointments.id }).from(schema.appointments).where(and(
      eq(schema.appointments.tenant_id, tenant.id),
      eq(schema.appointments.status, 'confirmed'),
      gte(schema.appointments.start_at, after.toISOString()),
      lt(schema.appointments.start_at, windowStart.toISOString()),
    )).all().length;

    const whatsappReady = Boolean(tenant.whatsappWebhook);
    const whatsappFull = Boolean(tenant.whatsappWebhook && tenant.whatsappToken);
    return res.json({
      channels: {
        email: { enabled: tenant.emailEnabled, configured: Boolean(config.smtpHost) },
        whatsapp: { enabled: whatsappReady, configured: whatsappFull },
      },
      reminderHours: tenant.reminderHours,
      logs: { sent, failed, total: sent + failed },
      upcoming,
    });
  }),
);

/**
 * Historial de envíos. Filtros: ?channel=email|whatsapp, ?status=sent|failed, ?limit=
 */
remindersRouter.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const conditions = [eq(schema.reminderLogs.tenant_id, tenantId)];

    const channel = String(req.query.channel ?? '');
    if (channel === 'email' || channel === 'whatsapp') conditions.push(eq(schema.reminderLogs.channel, channel));
    const status = String(req.query.status ?? '');
    if (status === 'sent' || status === 'failed') conditions.push(eq(schema.reminderLogs.status, status));

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const rows = db.select().from(schema.reminderLogs).where(and(...conditions))
      .orderBy(desc(schema.reminderLogs.sent_at), desc(schema.reminderLogs.id))
      .limit(limit)
      .all();

    const apptIds = [...new Set(rows.map((r) => r.appointment_id))];
    const appts = apptIds.length
      ? db.select().from(schema.appointments).where(inArray(schema.appointments.id, apptIds)).all()
      : [];
    const custIds = [...new Set(appts.map((a) => a.customer_id))];
    const custs = custIds.length
      ? db.select().from(schema.customers).where(inArray(schema.customers.id, custIds)).all()
      : [];
    const apptMap = new Map(appts.map((a) => [a.id, a]));
    const custMap = new Map(custs.map((c) => [c.id, c]));

    return res.json({
      logs: rows.map((r) => {
        const appt = apptMap.get(r.appointment_id);
        const cust = appt ? custMap.get(appt.customer_id) : null;
        return {
          ...r,
          appointment: appt ? { id: appt.id, start_at: appt.start_at, status: appt.status, notes: appt.notes } : null,
          customer: cust ? { id: cust.id, name: cust.name, phone: cust.phone, email: cust.email } : null,
        };
      }),
    });
  }),
);

/**
 * Citas confirmadas que caen en la ventana de recordatorio (próximos envíos),
 * con la marca de qué canales ya se intentaron.
 */
remindersRouter.get(
  '/scheduled',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
    if (!tenant) throw new AppError(404, 'Negocio no encontrado');

    const windowStart = new Date(Date.now() + tenant.reminderHours * 3600_000);
    const after = new Date(Date.now() - tenant.reminderHours * 3600_000);
    const appts = db.select().from(schema.appointments).where(and(
      eq(schema.appointments.tenant_id, tenantId),
      eq(schema.appointments.status, 'confirmed'),
      gte(schema.appointments.start_at, after.toISOString()),
      lt(schema.appointments.start_at, windowStart.toISOString()),
    )).orderBy(asc(schema.appointments.start_at)).all();

    const logs = appts.length
      ? db.select().from(schema.reminderLogs).where(inArray(schema.reminderLogs.appointment_id, appts.map((a) => a.id))).all()
      : [];
    const sentBy = new Map(logs.map((l) => [`${l.appointment_id}:${l.channel}`, l.status]));

    const items = appts.map((a) => {
      const meta = attachReminderMeta(db, tenantId, a);
      return {
        ...a,
        customer: meta?.customer ?? null,
        services: meta?.appointment.services ?? [],
        sent: {
          email: sentBy.get(`${a.id}:email`) ?? null,
          whatsapp: sentBy.get(`${a.id}:whatsapp`) ?? null,
        },
      };
    });
    return res.json({ items, reminderHours: tenant.reminderHours });
  }),
);

/**
 * Ejecuta el scheduler de recordatorios de inmediato (prueba manual).
 */
remindersRouter.post(
  '/run',
  asyncHandler(async (_req, res) => {
    const sent = await processDueReminders();
    return res.json({ sent });
  }),
);

/**
 * Envía un recordatorio de prueba a una cita en un canal concreto.
 * Útil para validar SMTP/webhook sin esperar al scheduler.
 */
const testSchema = z.object({
  appointmentId: z.string().min(1),
  channel: z.enum(['email', 'whatsapp']),
});

remindersRouter.post(
  '/test',
  asyncHandler(async (req, res) => {
    const input = testSchema.parse(req.body);
    const { db } = getDb();
    const tenantId = req.session.tenantId;
    const appt = getAppointment(db, tenantId, input.appointmentId);
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).get();
    if (!tenant) throw new AppError(404, 'Negocio no encontrado');
    const meta = attachReminderMeta(db, tenantId, appt);
    if (!meta) throw new AppError(404, 'Cliente de la cita no encontrado');

    const to = input.channel === 'email' ? meta.customer.email : meta.customer.phone;
    const text = buildMessage(tenant, meta);
    const result = input.channel === 'email'
      ? await reminderService.sendEmail(tenant, to, `Recordatorio · ${tenant.name}`, text)
      : await reminderService.sendWhatsApp(tenant, to, text);
    reminderService.log(tenant.id, appt.id, input.channel, result);
    return res.json({ ok: result.ok, error: result.error ?? null });
  }),
);