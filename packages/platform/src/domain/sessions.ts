import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { getCoreDb, createId } from '../db/index.js';
import { schema } from '../db/schema.js';
import { platformConfig } from '../config.js';
import { randomToken, tokenFingerprint, safeEqual } from '../security/tokens.js';
import type { Role } from './roles.js';
import { findUserById, type User } from './users.js';
import { findOrganizationById, type Organization } from './organizations.js';
import { roleIn } from './memberships.js';

export type Session = typeof schema.sessions.$inferSelect;

/**
 * Identidad efectiva de una sesión del Core.
 *
 * Es lo que viaja al subdominio por SSO. Notar que NO lleva contraseña ni
 * token de la sesión central: el subdominio recibe una identidad ya resuelta y
 * firma su propia sesión con eso.
 */
export interface SessionIdentity {
  userId: string;
  organizationId: string;
  role: Role;
  email: string;
  name: string;
  sessionId: string;
}

export interface VerifiedSession extends SessionIdentity {
  session: Session;
  user: User;
  organization: Organization;
  expiresAt: string;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Crea una sesión y devuelve el valor de la cookie.
 *
 * La cookie es `<id>.<secreto>`: el `id` sirve para encontrar la fila (índice) y
 * el `secreto` es lo que hay que acertar. En la base solo queda el HMAC del
 * secreto, así que leer core.sqlite no sirve para suplantar a nadie.
 */
export function createSession(input: {
  userId: string;
  organizationId: string;
  ip?: string;
  userAgent?: string;
  ttlDays?: number;
}): { token: string; session: Session } {
  const id = createId('ses');
  const secret = randomToken(32);
  const now = Date.now();
  const ttlDays = input.ttlDays ?? platformConfig.sessionDays;
  const { db } = getCoreDb();

  const row = db
    .insert(schema.sessions)
    .values({
      id,
      user_id: input.userId,
      active_organization_id: input.organizationId,
      token_hash: tokenFingerprint(secret),
      status: 'active',
      ip: input.ip ?? null,
      user_agent: input.userAgent?.slice(0, 300) ?? null,
      created_at: iso(now),
      last_seen_at: iso(now),
      expires_at: iso(now + ttlDays * 86_400_000),
      revoked_at: null,
    })
    .returning()
    .get();

  return { token: `${row.id}.${secret}`, session: row };
}

/** Divide la cookie sin_VALIDAR nada: el visto bueno es safeEqual sobre el HMAC. */
function splitToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

export type SessionCheck =
  | ({ ok: true } & VerifiedSession)
  | { ok: false; reason: 'malformado' | 'no-existe' | 'revocada' | 'expirada' | 'usuario' | 'organizacion' | 'sin-membresia' };

/**
 * Valida la cookie de sesión contra la base.
 *
 * OJO con el nombre "stateless": aquí NO lo es, y es la decisión. Un JWT de
 * sesión no se puede revocar (hay que esperar a que expire o rotar la clave de
 * todo el mundo). Con el registro en la base, "cerrar sesión en todos los
 * dispositivos" es un UPDATE, y una sesión de un producto cancelado se puede
 * matar al instante.
 */
export function verifySessionToken(token: string | undefined): SessionCheck {
  if (!token) return { ok: false, reason: 'malformado' };
  const parts = splitToken(token);
  if (!parts) return { ok: false, reason: 'malformado' };

  const { db } = getCoreDb();
  const row = db.select().from(schema.sessions).where(eq(schema.sessions.id, parts.id)).get();
  if (!row) return { ok: false, reason: 'no-existe' };
  if (!safeEqual(row.token_hash, tokenFingerprint(parts.secret))) return { ok: false, reason: 'no-existe' };
  if (row.status === 'revoked' || row.revoked_at) return { ok: false, reason: 'revocada' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.update(schema.sessions).set({ status: 'expired' }).where(eq(schema.sessions.id, row.id)).run();
    return { ok: false, reason: 'expirada' };
  }

  const user = findUserById(row.user_id);
  if (!user || user.status !== 'active') return { ok: false, reason: 'usuario' };

  const organization = row.active_organization_id ? findOrganizationById(row.active_organization_id) : undefined;
  if (!organization) return { ok: false, reason: 'organizacion' };
  if (organization.status !== 'active') return { ok: false, reason: 'organizacion' };

  // El rol se relee en CADA request a propósito: si a alguien le bajan el rol
  // o lo sacan de la organización, su sesión deja de servir al instante.
  const role = roleIn(user.id, organization.id);
  if (!role) return { ok: false, reason: 'sin-membresia' };

  return {
    ok: true,
    user,
    organization,
    session: row,
    expiresAt: row.expires_at,
    userId: user.id,
    organizationId: organization.id,
    role,
    email: user.email,
    name: user.name,
    sessionId: row.id,
  };
}

export function touchSession(id: string): void {
  getCoreDb()
    .db.update(schema.sessions)
    .set({ last_seen_at: new Date().toISOString() })
    .where(and(eq(schema.sessions.id, id), eq(schema.sessions.status, 'active')))
    .run();
}

export function revokeSession(id: string): boolean {
  const result = getCoreDb()
    .db.update(schema.sessions)
    .set({ status: 'revoked', revoked_at: new Date().toISOString() })
    .where(and(eq(schema.sessions.id, id), isNull(schema.sessions.revoked_at)))
    .run();
  return result.changes > 0;
}

export function revokeAllSessionsForUser(userId: string, exceptSessionId?: string): number {
  const now = new Date().toISOString();
  const conditions = [eq(schema.sessions.user_id, userId), isNull(schema.sessions.revoked_at)];
  if (exceptSessionId) conditions.push(sql`${schema.sessions.id} <> ${exceptSessionId}`);
  const result = getCoreDb()
    .db.update(schema.sessions)
    .set({ status: 'revoked', revoked_at: now })
    .where(and(...conditions))
    .run();
  return result.changes;
}

/** Cambia la organización que la sesión está operando, sin crear una nueva. */
export function switchSessionOrganization(sessionId: string, organizationId: string): void {
  getCoreDb()
    .db.update(schema.sessions)
    .set({ active_organization_id: organizationId })
    .where(eq(schema.sessions.id, sessionId))
    .run();
}

export interface ActiveSession {
  id: string;
  current: boolean;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export function listActiveSessions(userId: string, currentSessionId?: string): ActiveSession[] {
  return getCoreDb()
    .db
    .select({
      id: schema.sessions.id,
      ip: schema.sessions.ip,
      user_agent: schema.sessions.user_agent,
      created_at: schema.sessions.created_at,
      last_seen_at: schema.sessions.last_seen_at,
      expires_at: schema.sessions.expires_at,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.user_id, userId), eq(schema.sessions.status, 'active')))
    .orderBy(schema.sessions.last_seen_at)
    .all()
    .map((row) => ({ ...row, current: row.id === currentSessionId }));
}

/** Limpieza periodica: podar lo vencido para que la tabla no crezca para siempre. */
export function pruneExpiredSessions(): number {
  const result = getCoreDb()
    .db.update(schema.sessions)
    .set({ status: 'expired' })
    .where(and(lt(schema.sessions.expires_at, new Date().toISOString()), isNull(schema.sessions.revoked_at)))
    .run();
  return result.changes;
}
