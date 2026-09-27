import jwt, { type JwtPayload } from 'jsonwebtoken';
import { platformConfig } from '../config.js';
import type { Role } from '../domain/roles.js';

/**
 * Identidad que viaja del Core a un subdominio.
 *
 * Deliberadamente marcada con `product`: es la audiencia. Un token emitido para
 * `inventario` no abre `cotizaciones` ni aunque se copie el `.env` equivocado,
 * porque el producto valida `aud === su propio slug` y además firma con SU
 * secreto, que es distinto del de los demás.
 */
export interface ProductTokenClaims {
  /** subject = user_id del Core. */
  sub: string;
  aud: string;
  iss: string;
  /** organization_id: la organización que representa en ese producto. */
  org_id: string;
  org_slug: string;
  role: Role;
  email: string;
  name: string;
  /** slug del producto al que está dirigido. */
  product: string;
  /** Sesión central de origen: permite revocar todo desde el Core. */
  sid: string;
  scope: 'product:access';
  jti: string;
  iat: number;
  exp: number;
}

export interface IssueProductTokenInput {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  role: Role;
  email: string;
  name: string;
  product: string;
  sessionId: string;
  ttlSeconds?: number;
  jti: string;
}

/** Firma el token de acceso de UN producto, con el secreto de ese producto. */
export function issueProductToken(input: IssueProductTokenInput, clientSecret: string): string {
  const ttl = input.ttlSeconds ?? platformConfig.ssoTokenTtlSeconds;
  return jwt.sign(
    {
      org_id: input.organizationId,
      org_slug: input.organizationSlug,
      role: input.role,
      email: input.email,
      name: input.name,
      product: input.product,
      sid: input.sessionId,
      scope: 'product:access' as const,
    },
    clientSecret,
    {
      subject: input.userId,
      audience: input.product,
      issuer: platformConfig.coreUrl,
      expiresIn: ttl,
      jwtid: input.jti,
    },
  );
}

export type VerifyResult =
  | { ok: true; claims: ProductTokenClaims }
  | { ok: false; reason: 'invalido' | 'expirado' | 'audiencia' | 'producto' | 'alcance' };

/**
 * Verifica un token de producto. `expectedProduct` es obligatorio a propósito:
 * omitirlo es exactamente el error que hace que un token sirva en dos apps.
 */
export function verifyProductToken(
  token: string,
  clientSecret: string,
  expectedProduct: string,
): VerifyResult {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, clientSecret, {
      issuer: platformConfig.coreUrl,
      // Sin `audience` NO se valida la audiencia: jwt solo compara si se le pasa.
      audience: expectedProduct,
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'TokenExpiredError') return { ok: false, reason: 'expirado' };
    if (name === 'JsonWebTokenError') {
      return (e as Error).message.includes('audience') ? { ok: false, reason: 'audiencia' } : { ok: false, reason: 'invalido' };
    }
    return { ok: false, reason: 'invalido' };
  }

  if (typeof decoded === 'string') return { ok: false, reason: 'invalido' };
  const claims = decoded as unknown as ProductTokenClaims;
  if (claims.aud !== expectedProduct) return { ok: false, reason: 'audiencia' };
  if (claims.product !== expectedProduct) return { ok: false, reason: 'producto' };
  if (claims.scope !== 'product:access') return { ok: false, reason: 'alcance' };
  if (!claims.sub || !claims.org_id || !claims.sid) return { ok: false, reason: 'invalido' };
  return { ok: true, claims };
}
