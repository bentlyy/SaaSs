import { logger } from '@saas-mini/core';
import { platformConfig } from '../config.js';

export interface MailResult {
  ok: boolean;
  error?: string;
}

/**
 * Envío de correo del Core.
 *
 * Si no hay SMTP configurado NO es un error: el enlace se escribe en el log.
 * Así el flujo de recuperación de contraseña se puede probar entero en local
 * sin montar un servidor de correo, y en producción con SMTP configurado el
 * comportamiento es el mismo.
 */
export async function sendMail(input: { to: string; subject: string; text: string }): Promise<MailResult> {
  if (!platformConfig.smtpHost) {
    logger.warn(`[mail:log] to=${input.to} subject="${input.subject}"`);
    logger.warn(`[mail:log] ${input.text}`);
    return { ok: true };
  }
  try {
    const nodemailer = (await import('nodemailer')).default;
    const transporter = nodemailer.createTransport({
      host: platformConfig.smtpHost,
      port: platformConfig.smtpPort,
      secure: platformConfig.smtpPort === 465,
      auth: platformConfig.smtpUser ? { user: platformConfig.smtpUser, pass: platformConfig.smtpPass } : undefined,
    });
    await transporter.sendMail({ from: platformConfig.mailFrom, to: input.to, subject: input.subject, text: input.text });
    return { ok: true };
  } catch (e) {
    logger.error('Fallo enviando correo', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}
