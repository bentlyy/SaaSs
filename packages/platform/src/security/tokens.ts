import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { platformConfig } from '../config.js';

/** Hex de 32 bytes. Es lo unico que se compara contra la base para autorizar. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Huella de un token de sesion o de un codigo de un solo uso.
 *
 * Con HMAC y no con SHA plano a proposito: si alguien lee core.sqlite todavia
 * no le sirve para fabricar una cookie ni un enlace de recuperacion, porque le
 * falta el pepper que vive en el entorno (AMG_SESSION_SECRET).
 */
export function tokenFingerprint(token: string): string {
  return createHmac('sha256', platformConfig.sessionSecret).update(token).digest('hex');
}

export function deriveClientSecret(clientId: string): string {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(platformConfig.ssoRootSecret, 'utf8'), Buffer.from(clientId, 'utf8'), Buffer.from('amg-sso-client', 'utf8'), 32),
  ).toString('base64url');
}

/** Comparacion en tiempo constante: sin esto, el tiempo de respuesta filtra el token. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
