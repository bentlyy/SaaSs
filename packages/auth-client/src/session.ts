import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AmgIdentity, Role } from './identity.js';

export interface LocalSession {
  userId: string;
  organizationId: string;
  role: Role;
  product: string;
  sessionId: string;
  /** Access token del Core. El producto lo revalida, no lo confía. */
  accessToken: string;
  expiresAt: number;
}

/**
 * Versión "compacta" de la sesión, para productos que prefieran guardar un
 * valor chico en cookie en vez del access token entero.
 *
 * Va firmado con el mismo secreto de SSO del producto, así que es
 * verificable localmente sin llamar al Core. NO es un token de autorización:
 * para eso está `verifyIdentity` sobre el token del Core. Solo evita reescribir
 * los datos en cada request.
 */
export function encodeIdentityCookie(identity: AmgIdentity, secret: string): string {
  const payload: LocalSession = {
    userId: identity.userId,
    organizationId: identity.organizationId,
    role: identity.role,
    product: identity.product,
    sessionId: identity.sessionId,
    accessToken: '',
    expiresAt: identity.expiresAt ?? 0,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function decodeIdentityCookie(value: string, secret: string, product: string): LocalSession | null {
  const [body, mac] = value.split('.');
  if (!body || !mac) return null;
  const expected = sign(body, secret);
  if (!safeEqual(mac, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LocalSession;
    if (parsed.product !== product) return null;
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt > 0 && parsed.expiresAt * 1000 < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
