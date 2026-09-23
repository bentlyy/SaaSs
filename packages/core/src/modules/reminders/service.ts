import { config } from '../../config.js';
import { getDb, schema } from '../../db/index.js';

type Tenant = typeof schema.tenants.$inferSelect;

export interface SendResult {
  ok: boolean;
  error?: string;
}

export class ReminderService {
  async sendEmail(tenant: Tenant, to: string | null, subject: string, text: string): Promise<SendResult> {
    if (!to) return { ok: false, error: 'destinatario sin email' };
    if (!tenant.emailEnabled) return { ok: false, error: 'email deshabilitado' };
    if (!config.smtpHost) return { ok: false, error: 'SMTP no configurado' };
    try {
      const nodemailer = (await import('nodemailer')).default;
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465,
        auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass } : undefined,
      });
      await transporter.sendMail({ from: config.mailFrom, to, subject, text });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async sendWhatsApp(tenant: Tenant, to: string | null, text: string): Promise<SendResult> {
    const webhook = tenant.whatsappWebhook;
    if (!to) return { ok: false, error: 'cliente sin teléfono' };
    if (!webhook || !tenant.whatsappToken) return { ok: false, error: 'WhatsApp webhook no configurado' };
    try {
      const resp = await fetch(webhook, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${tenant.whatsappToken}`,
        },
        body: JSON.stringify({ to, text }),
      });
      if (!resp.ok) return { ok: false, error: `Webhook respondió ${resp.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  log(tenantId: string, appointmentId: string, channel: 'email' | 'whatsapp', result: SendResult) {
    const { db } = getDb();
    db.insert(schema.reminderLogs).values({
      tenant_id: tenantId,
      appointment_id: appointmentId,
      channel,
      status: result.ok ? 'sent' : 'failed',
      error: result.ok ? null : result.error,
    }).run();
  }
}

export const reminderService = new ReminderService();