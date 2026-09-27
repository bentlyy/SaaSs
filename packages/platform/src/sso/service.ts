import { and, eq } from 'drizzle-orm';
import { AppError } from '@saas-mini/core';
import { platformConfig } from '../config.js';
import { getCoreDb, createId } from '../db/index.js';
import { schema } from '../db/schema.js';
import { randomToken, tokenFingerprint, safeEqual } from '../security/tokens.js';
import { productAccess, accessMessage } from '../domain/subscriptions.js';
import { recordAudit } from '../domain/audit.js';
import { findUserById } from '../domain/users.js';
import { findOrganizationById } from '../domain/organizations.js';
import { defaultRedirectUri, findSsoClient, isRedirectUriAllowed, type SsoClientInfo } from './registry.js';
import { issueProductToken, verifyProductToken, type ProductTokenClaims } from './tokens.js';
import type { Role } from '../domain/roles.js';
import type { VerifiedSession } from '../domain/sessions.js';

/**
 * SSO de AMG: el Core autentica, el subdominio valida la identidad.
 *
 * El subdominio NUNCA recibe la contraseña ni la cookie del Core. Recibe un
 * código de un solo uso, lo canjea por un token corto con SU audiencia y de ahí
 * en adelante trabaja con su propia sesión de aplicación.
 */

export interface AuthorizeParams {
  clientId: string;
  redirectUri?: string;
  returnUrl?: string;
  state?: string;
  session?: VerifiedSession | null;
}

export type AuthorizeOutcome =
  | { kind: 'redirect'; location: string; state?: string }
  | { kind: 'login'; loginUrl: string }
  | { kind: 'suspendido'; loginUrl: string }
  | { kind: 'sin-acceso'; location: string; state?: string; reason: string }
  | { kind: 'error'; message: string; status: number };

/**
 * Paso 1: el subdominio manda al usuario al Core.
 *
 * Si no hay sesión central, la respuesta es una redirección al login del Core
 * con `returnUrl` apuntando de vuelta a ESTA authorize. Así el usuario termina
 * donde quería, sin que el subdominio sepa nada de contraseñas.
 */
export function authorize(params: AuthorizeParams): AuthorizeOutcome {
  const client = findSsoClient(params.clientId);
  if (!client) return { kind: 'error', message: `La aplicación "${params.clientId}" no está registrada en la plataforma.`, status: 404 };
  if (client.status !== 'active') return { kind: 'error', message: `La aplicación "${params.clientId}" está desactivada.`, status: 403 };

  const redirectUri = params.redirectUri ?? defaultRedirectUri(client);
  if (!redirectUri || !isRedirectUriAllowed(client, redirectUri)) {
    return {
      kind: 'error',
      message: 'La dirección de retorno no está autorizada para esta aplicación.',
      status: 400,
    };
  }

  const returnUrl = safeReturnUrl(params.returnUrl);
  const session = params.session ?? null;

  if (!session) {
    return {
      kind: 'login',
      loginUrl: buildLoginUrl({ clientId: params.clientId, redirectUri, state: params.state, returnUrl }),
    };
  }

  if (session.user.status !== 'active' || session.organization.status !== 'active') {
    return {
      kind: 'suspendido',
      loginUrl: buildLoginUrl({ clientId: params.clientId, redirectUri, state: params.state, returnUrl }),
    };
  }

  const access = productAccess(session.organizationId, params.clientId);
  if (!access.allowed) {
    recordAudit({
      actorUserId: session.userId,
      organizationId: session.organizationId,
      action: 'sso.denegado',
      target: params.clientId,
      metadata: { reason: access.reason },
    });
    return {
      kind: 'sin-acceso',
      location: buildContractUrl(params.clientId, returnUrl ?? redirectUri, access.reason),
      state: params.state,
      reason: accessMessage(access.reason, params.clientId),
    };
  }

  const code = createSsoCode({
    clientId: params.clientId,
    userId: session.userId,
    organizationId: session.organizationId,
    role: session.role,
    redirectUri,
    returnUrl,
    sessionId: session.sessionId,
  });

  recordAudit({
    actorUserId: session.userId,
    organizationId: session.organizationId,
    action: 'sso.code_emitido',
    target: params.clientId,
    ip: session.session.ip,
  });

  const location = appendQuery(redirectUri, {
    code: code.token,
    ...(params.state ? { state: params.state } : {}),
  });
  return { kind: 'redirect', location, state: params.state };
}

function buildLoginUrl(input: {
  clientId: string;
  redirectUri: string;
  state?: string;
  returnUrl?: string;
}): string {
  // El return_url del login apunta de vuelta a ESTE authorize, no al subdominio.
  // Así el usuario entra, el Core lo revalida y lo manda al producto con un
  // código; el subdominio nunca ve una contraseña ni un token del Core.
  const authorize = appendQuery(`${platformConfig.coreUrl}/api/sso/authorize`, {
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    ...(input.state ? { state: input.state } : {}),
    ...(input.returnUrl ? { return_url: input.returnUrl } : {}),
  });
  return `${platformConfig.coreUrl}/login?return_url=${encodeURIComponent(authorize)}`;
}

function buildContractUrl(productSlug: string, returnTo: string, reason: string): string {
  return appendQuery(`${platformConfig.coreUrl}/contratar`, {
    producto: productSlug,
    return_url: returnTo,
    motivo: reason,
  });
}

/**
 * Paso 2: el subdominio canjea el código por un token de acceso.
 *
 * El código es de un solo uso (UPDATE condicional sobre `status='pending'`), así
 * que un atacante que se lo stealeara al usuario no lo puede reutilizar después.
 */
export interface TokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: 'product:access';
  user_id: string;
  organization_id: string;
  organization_slug: string;
  role: Role;
  email: string;
  name: string;
  product: string;
  session_id: string;
}

export function exchangeCode(input: { code: string; clientId: string; clientSecret: string; redirectUri?: string }): TokenResponse {
  const client = findSsoClient(input.clientId);
  if (!client) throw new AppError(404, 'Aplicación no registrada en la plataforma');

  // El secreto se compara en tiempo constante: si no, el tiempo de respuesta
  // deja adivinar el secreto de un producto byte a byte.
  if (!safeEqual(client.secret, input.clientSecret)) {
    recordAudit({ action: 'sso.token_rechazado', target: input.clientId, metadata: { motivo: 'secreto' } });
    throw new AppError(401, 'Credenciales de la aplicación inválidas');
  }
  if (client.status !== 'active') throw new AppError(403, 'La aplicación está desactivada');

  const consumed = consumeSsoCode(input.code);
  if (!consumed.ok) {
    throw new AppError(401, ssoCodeError(consumed.status), { reason: consumed.status });
  }
  const row = consumed.row;
  if (row.client_id !== input.clientId) throw new AppError(401, 'El código no pertenece a esta aplicación');
  if (input.redirectUri && row.redirect_uri !== input.redirectUri) {
    throw new AppError(400, 'El redirect_uri no coincide con el del código');
  }

  const user = findUserById(row.user_id);
  const organization = findOrganizationById(row.organization_id);
  if (!user || user.status !== 'active' || !organization || organization.status !== 'active') {
    throw new AppError(403, 'La cuenta ya no está activa');
  }

  // Se vuelve a comprobar el acceso en el canje, no solo en el authorize: entre
  // los dos pasos alguien pudo cancelar la suscripción desde el Core.
  const access = productAccess(organization.id, input.clientId);
  if (!access.allowed) throw new AppError(403, accessMessage(access.reason, input.clientId));

  const jti = createId('jti');
  const accessToken = issueProductToken(
    {
      userId: user.id,
      organizationId: organization.id,
      organizationSlug: organization.slug,
      role: row.role as Role,
      email: user.email,
      name: user.name,
      product: input.clientId,
      sessionId: row.session_id ?? '',
      jti,
    },
    client.secret,
  );

  recordAudit({
    actorUserId: user.id,
    organizationId: organization.id,
    action: 'sso.token_emitido',
    target: input.clientId,
    metadata: { jti },
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: platformConfig.ssoTokenTtlSeconds,
    scope: 'product:access',
    user_id: user.id,
    organization_id: organization.id,
    organization_slug: organization.slug,
    role: row.role as Role,
    email: user.email,
    name: user.name,
    product: input.clientId,
    session_id: row.session_id ?? '',
  };
}

export interface IntrospectionResult {
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
 * Paso 3 (opcional): el subdominio pregunta al Core si el token sigue vivo.
 *
 * El token se puede verificar SOLO con el secreto del producto (rápido, sin
 * red). Esto es para cuando el producto quiere la autoridad del Core: confirmar
 * que la sesión central sigue viva y que la suscripción no se cayó mientras
 * tanto. Con `active: false` el producto cierra la sesión del usuario.
 */
export function introspectToken(token: string, clientId: string, clientSecret: string): IntrospectionResult {
  const client = findSsoClient(clientId);
  if (!client) return { active: false, reason: 'aplicacion-desconocida' };
  if (!safeEqual(client.secret, clientSecret)) return { active: false, reason: 'secreto-invalido' };

  const verified = verifyProductToken(token, client.secret, clientId);
  if (!verified.ok) return { active: false, reason: verified.reason };
  const claims: ProductTokenClaims = verified.claims;

  const user = findUserById(claims.sub);
  if (!user || user.status !== 'active') return { active: false, reason: 'usuario-inactivo', user_id: claims.sub };

  const organization = findOrganizationById(claims.org_id);
  if (!organization || organization.status !== 'active') {
    return { active: false, reason: 'organizacion-inactiva', user_id: claims.sub };
  }

  const access = productAccess(organization.id, clientId);
  if (!access.allowed) return { active: false, reason: access.reason, user_id: claims.sub };

  return {
    active: true,
    user_id: claims.sub,
    organization_id: claims.org_id,
    organization_slug: claims.org_slug,
    role: claims.role,
    product: claims.product,
    session_id: claims.sid,
    email: claims.email,
    name: claims.name,
    expires_at: claims.exp,
  };
}

// ── códigos de un solo uso ────────────────────────────────────────────────────

export interface SsoCode {
  id: string;
  token: string;
  expiresAt: string;
}

function createSsoCode(input: {
  clientId: string;
  userId: string;
  organizationId: string;
  role: Role;
  redirectUri: string;
  returnUrl?: string;
  sessionId: string;
}): SsoCode {
  const { db } = getCoreDb();
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + platformConfig.ssoCodeTtlSeconds * 1000).toISOString();
  const id = createId('sso');
  db.insert(schema.ssoCodes)
    .values({
      id,
      code_hash: tokenFingerprint(token),
      client_id: input.clientId,
      user_id: input.userId,
      organization_id: input.organizationId,
      role: input.role,
      redirect_uri: input.redirectUri,
      return_url: input.returnUrl ?? null,
      session_id: input.sessionId,
      status: 'pending',
      created_at: new Date(now).toISOString(),
      expires_at: expiresAt,
      used_at: null,
    })
    .run();
  return { id, token, expiresAt };
}

type CodeRow = typeof schema.ssoCodes.$inferSelect;
type ConsumeResult = { ok: true; row: CodeRow } | { ok: false; status: 'invalido' | 'usado' | 'expirado' };

/**
 * Canjea el código marcando `status='used'` con un UPDATE condicional.
 * Si dos peticiones llegan con el mismo código, solo una cambia el estado; la
 * otra recibe changes=0 y se rechaza. Un código robado no sirve dos veces.
 */
function consumeSsoCode(token: string): ConsumeResult {
  const { db } = getCoreDb();
  const row = db.select().from(schema.ssoCodes).where(eq(schema.ssoCodes.code_hash, tokenFingerprint(token))).get();
  if (!row) return { ok: false, status: 'invalido' };
  if (row.status !== 'pending') return { ok: false, status: 'usado' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.update(schema.ssoCodes).set({ status: 'expired' }).where(eq(schema.ssoCodes.id, row.id)).run();
    return { ok: false, status: 'expirado' };
  }
  const result = db
    .update(schema.ssoCodes)
    .set({ status: 'used', used_at: new Date().toISOString() })
    .where(and(eq(schema.ssoCodes.id, row.id), eq(schema.ssoCodes.status, 'pending')))
    .run();
  if (result.changes === 0) return { ok: false, status: 'usado' };
  return { ok: true, row: { ...row, status: 'used' } };
}

function ssoCodeError(status: string): string {
  switch (status) {
    case 'usado':
      return 'El código ya fue usado. Vuelve a entrar al producto.';
    case 'expirado':
      return 'El código expiró. Vuelve a entrar al producto.';
    default:
      return 'Código de acceso inválido.';
  }
}

// ── utilidades ───────────────────────────────────────────────────────────────

export function appendQuery(base: string, params: Record<string, string | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Filtra el `return_url` para que no sirva de puerta trasera.
 *
 * Solo se devuelve si es http(s) y su host termina en uno de los dominios
 * permitidos. Cualquier otra cosa se descarta y se vuelve al destino por
 * defecto, en vez de devolver un 400: el usuario no tiene por qué enterarse de
 * que alguien intentó redirigirlo.
 */
export function safeReturnUrl(candidate: string | undefined | null): string | undefined {
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const host = url.hostname.toLowerCase();
    const allowed = platformConfig.returnUrlHosts.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
