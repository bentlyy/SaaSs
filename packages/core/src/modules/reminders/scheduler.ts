import { and, eq, gte, inArray, lt } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { logger } from '../../logger.js';
import { reminderService } from './service.js';
import { attachReminderMeta } from './meta.js';

const CHECK_INTERVAL_MIN = 1;

/**
 * Recorre citas confirmadas que están a punto de empezar (dentro de
 * `reminder_hours` del negocio) y envía recordatorios por los canales
 * habilitados, evitando duplicados vía reminder_logs.
 */
export async function processDueReminders(now = new Date()): Promise<number> {
  const { db } = getDb();
  let sent = 0;

  const tenants = db.select().from(schema.tenants).all();
  for (const tenant of tenants) {
    const windowStart = new Date(now.getTime() + tenant.reminderHours * 60 * 60_000);
    const after = new Date(now.getTime() - tenant.reminderHours * 60 * 60_000);

    // citas confirmadas cuyo inicio está entre [now - window, now + window] para cubrir
    // atrasos de scheduler y ventanas recién configuradas
    const appts = db.select().from(schema.appointments)
      .where(and(
        eq(schema.appointments.tenant_id, tenant.id),
        eq(schema.appointments.status, 'confirmed'),
        gte(schema.appointments.start_at, after.toISOString()),
        lt(schema.appointments.start_at, windowStart.toISOString()),
      ))
      .all();

    const alreadySent = db.select().from(schema.reminderLogs)
      .where(inArray(schema.reminderLogs.appointment_id, appts.map((a) => a.id)))
      .all();
    const sentIds = new Set(alreadySent.map((l) => `${l.appointment_id}:${l.channel}`));

    for (const appt of appts) {
      const meta = attachReminderMeta(db, tenant.id, appt);
      if (!meta) continue;

      const attempts: Array<{ channel: 'email' | 'whatsapp'; to: string | null; enabled: boolean }> = [
        { channel: 'email', to: meta.customer?.email ?? null, enabled: tenant.emailEnabled },
        { channel: 'whatsapp', to: meta.customer?.phone ?? null, enabled: Boolean(tenant.whatsappWebhook) },
      ];

      for (const attempt of attempts) {
        const key = `${appt.id}:${attempt.channel}`;
        if (!attempt.enabled || sentIds.has(key) || !attempt.to) continue;
        const text = buildMessage(tenant, meta);
        const result =
          attempt.channel === 'email'
            ? await reminderService.sendEmail(tenant, attempt.to, `Recordatorio · ${tenant.name}`, text)
            : await reminderService.sendWhatsApp(tenant, attempt.to, text);
        reminderService.log(tenant.id, appt.id, attempt.channel, result);
        sentIds.add(key);
        sent++;
        logger.info(`Recordatorio ${attempt.channel} -> ${appt.id}: ${result.ok ? 'ok' : result.error}`);
      }
    }
  }
  return sent;
}

function buildMessage(tenant: typeof schema.tenants.$inferSelect, meta: NonNullable<ReturnType<typeof attachReminderMeta>>) {
  const when = new Date(meta.appointment.start_at);
  const fmt = new Intl.DateTimeFormat('es', {
    timeZone: tenant.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(when);
  const services = meta.appointment.services.map((s) => s.name).join(', ') || 'cita agendada';
  return [
    `Hola ${meta.customer?.name ?? ''}, te recordamos tu ${meta.appointment.notes || services}:`,
    `📅 ${fmt} en ${tenant.name}`,
    tenant.address ? `📍 ${tenant.address}` : '',
    tenant.phone ? `☎️ ${tenant.phone}` : '',
  ].filter(Boolean).join('\n');
}

let timer: NodeJS.Timeout | null = null;

export function startReminderScheduler(): void {
  if (timer) return;
  logger.info(`Scheduler de recordatorios activo (cada ${CHECK_INTERVAL_MIN} min)`);
  const tick = async () => {
    try {
      await processDueReminders();
    } catch (e) {
      logger.warn('Fallo en scheduler de recordatorios', e);
    }
  };
  timer = setInterval(tick, CHECK_INTERVAL_MIN * 60_000);
  tick();
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}