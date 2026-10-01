import jwt, { type JwtPayload } from 'jsonwebtoken';
import type { AmgConfig } from './config.js';

export type Role = 'owner' | 'admin' | 'member';

/** Una herramienta de la plataforma, tal y como la ve la barra lateral. */
export interface ToolIdentity {
  slug: string;
  name: string;
  /** URL donde abrir la herramienta. Puede venir vacía si el Core no la supo. */
  url: string;
}

export interface AmgIdentity {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  /** Nombre de la organización, tal y como lo escribió el cliente. */
  organizationName: string;
  /** Herramientas a las que la organización tiene acceso. */
  tools: ToolIdentity[];
  role: Role;
  email: string;
  name: string;
  product: string;
  sessionId: string;
  issuedAt?: number;
  expiresAt?: number;
}

/**
 * Lee el claim `tools` del token.
 *
 * Un token emitido antes de que existiera este claim (o uno manipulado) no
 * rompe la sesión: la barra lateral degrada a la herramienta actual, que es lo
 * que hacía la app antes de que la navegación existiera.
 */
function readTools(value: unknown): ToolIdentity[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      slug: String(t.slug ?? ''),
      name: String(t.name ?? ''),
      url: String(t.url ?? ''),
    }))
    .filter((t) => t.slug !== '' && t.name !== '');
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
      organizationName: (claims.org_name as string) ?? '',
      tools: readTools(claims.tools),
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
  organization_name?: string;
  /** Herramientas de la organización, para la barra lateral del producto. */
  tools?: ToolIdentity[];
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
        organizationName: body.organization_name ?? '',
        tools: readTools(body.tools),
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
): Promise<
  | { ok: true; identity: AmgIdentity; accessToken: string }
  | { ok: false; reason: string; status?: number; retryAfterSeconds?: number }
> {
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
      return {
        ok: false,
        reason: String(body.error ?? 'El Core rechazó el código'),
        status: res.status,
        retryAfterSeconds: readRetryAfter(res),
      };
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

/**
 * Cuántos segundos faltan para que el límite de solicitudes se libere.
 *
 * `Retry-After` puede venir en segundos o como fecha HTTP. Si no viene, devolvemos
 * `undefined` y la página usa la espera por defecto, para que el usuario al menos
 * tenga una espera creíble en vez de un callejón sin salida.
 */
function readRetryAfter(res: { headers: { get(name: string): string | null } }): number | undefined {
  const header = res.headers.get('retry-after');
  if (!header) return undefined;
  const segundos = Number(header);
  if (Number.isFinite(segundos) && segundos >= 0) return Math.ceil(segundos);
  const fecha = Date.parse(header);
  if (Number.isNaN(fecha)) return undefined;
  return Math.max(0, Math.ceil((fecha - Date.now()) / 1000));
}
