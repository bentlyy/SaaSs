import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { AmgConfig } from './config.js';

export type Role = 'owner' | 'admin' | 'member';

export interface AmgIdentity {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  role: Role;
  email: string;
  name: string;
  product: string;
  sessionId: string;
  issuedAt?: number;
  expiresAt?: number;
}

export type VerifyResult =
  | { ok: true; identity: AmgIdentity }
  | { ok: false; reason: 'expirado' | 'audiencia' | 'invalido' | 'otro-producto' | 'sin-rol' | 'sin-organizacion' };

/**
 * Verifica un access token del Core contra el secreto DE ESTE producto.
 *
 * Lo importante no es la firma: es el `aud`. Un token de inventario firmado con
 * el secreto de inventario no sirve en cotizaciones, porque (a) cotizaciones
 * verifica con OTRO secreto y (b) aunque se copiara el secreto, el `aud` no
 * matchea. Por eso no hay un secreto global compartido entre productos.
 */
export function verifyIdentity(token: string, config: Pick<AmgConfig, 'clientSecret' | 'clientId' | 'coreUrl'>): VerifyResult {
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, config.clientSecret, {
      issuer: config.coreUrl,
      // Sin esto, jwt NO compara la audiencia: el token aceptaría cualquier
      // audiencia firmada con la misma clave.
      audience: config.clientId,
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'TokenExpiredError') return { ok: false, reason: 'expirado' };
    if (name === 'JsonWebTokenError' && (e as Error).message.includes('audience')) {
      return { ok: false, reason: 'audiencia' };
    }
    return { ok: false, reason: 'invalido' };
  }

  if (typeof decoded === 'string') return { ok: false, reason: 'invalido' };
  const claims = decoded as Record<string, unknown>;
  if (claims.product !== config.clientId) return { ok: false, reason: 'otro-producto' };
  if (typeof claims.sub !== 'string' || !claims.sub) return { ok: false, reason: 'invalido' };
  if (typeof claims.org_id !== 'string' || !claims.org_id) return { ok: false, reason: 'sin-organizacion' };
  if (claims.role !== 'owner' && claims.role !== 'admin' && claims.role !== 'member') {
    return { ok: false, reason: 'sin-rol' };
  }
  if (claims.scope !== 'product:access') return { ok: false, reason: 'invalido' };

  return {
    ok: true,
    identity: {
      userId: claims.sub,
      organizationId: claims.org_id as string,
      organizationSlug: (claims.org_slug as string) ?? '',
      role: claims.role as Role,
      email: (claims.email as string) ?? '',
      name: (claims.name as string) ?? '',
      product: claims.product as string,
      sessionId: (claims.sid as string) ?? '',
      issuedAt: typeof claims.iat === 'number' ? claims.iat : undefined,
      expiresAt: typeof claims.exp === 'number' ? claims.exp : undefined,
    },
  };
}

export interface IntrospectionResponse {
  active: boolean;
  reason?: string;
  user_id?: string;
  organization_id?: string;
  organization_slug?: string;
  role?: Role;
  product?: string;
  session_id?: string;
  email?: string;
  name?: string;
  expires_at?: number;
}

/**
 * Pregunta al Core si el token sigue vivo.
 *
 * La verificación local (verifyIdentity) alcanza para autenticar: es rápida y no
 * depende de la red. Esto sirve para lo que la verificación local NO puede
 * saber: que la sesión central siga abierta, que la suscripción no se haya
 * caído, que el usuario no haya sido suspendido. Con `active:false` el producto
 * cierra la sesión del usuario.
 */
export async function introspect(
  token: string,
  config: AmgConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; active: boolean; identity?: AmgIdentity } | { ok: false; reason: 'core-caido' }> {
  try {
    const res = await fetchImpl(`${config.coreUrl}/api/sso/introspect`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        token,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      }),
    });
    if (!res.ok) return { ok: false, reason: 'core-caido' };
    const body = (await res.json()) as IntrospectionResponse;
    if (!body.active) return { ok: true, active: false };
    return {
      ok: true,
      active: true,
      identity: {
        userId: body.user_id ?? '',
        organizationId: body.organization_id ?? '',
        organizationSlug: body.organization_slug ?? '',
        role: (body.role ?? 'member') as Role,
        email: body.email ?? '',
        name: body.name ?? '',
        product: body.product ?? config.clientId,
        sessionId: body.session_id ?? '',
        expiresAt: body.expires_at,
      },
    };
  } catch {
    return { ok: false, reason: 'core-caido' };
  }
}

/**
 * Canjea un código SSO por un token de acceso.
 *
 * Es el otro lado de /api/sso/authorize: el producto recibe el `code` en su
 * callback y lo cambia por la identidad del usuario. El código vale una sola vez
 * y dura 60 segundos.
 */
export async function exchangeCode(
  code: string,
  config: AmgConfig,
  redirectUri: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; identity: AmgIdentity; accessToken: string } | { ok: false; reason: string; status?: number }> {
  try {
    const res = await fetchImpl(`${config.coreUrl}/api/sso/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: redirectUri,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, reason: String(body.error ?? 'El Core rechazó el código'), status: res.status };
    }
    const verified = verifyIdentity(String(body.access_token ?? ''), config);
    if (!verified.ok) {
      // El Core devolvió algo que no podemos validar: es un error de
      // configuración (secretos desalineados), no del usuario.
      return { ok: false, reason: `Token del Core inválido (${verified.reason}). Revisá AMG_SSO_CLIENT_SECRET.`, status: 500 };
    }
    return { ok: true, identity: verified.identity, accessToken: String(body.access_token) };
  } catch {
    return { ok: false, reason: 'No pudimos contactar al Core. Inténtalo en un momento.' };
  }
}
