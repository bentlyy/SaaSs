import { and, eq, isNull } from 'drizzle-orm';
import { getCoreDb, createId } from '../db/index.js';
import { schema } from '../db/schema.js';
import { randomToken, tokenFingerprint } from '../security/tokens.js';

type OneTimeStatus = (typeof schema.oneTimeStatus)[number];

/**
 * Tokens de un solo uso (recuperar contraseña, verificar email, invitar a la
 * organización). Misma forma en los tres casos:
 *
 *   - el token en claro se le manda al usuario y no se guarda;
 *   - en la base queda el HMAC;
 *   - expira;
 *   - el token queda marcado como usado, así que un correo reenviado no sirve dos veces.
 */
export interface OneTimeToken {
  id: string;
  token: string;
  expiresAt: string;
}

function createPasswordResetRow(userId: string, ttlMinutes: number, ip?: string): OneTimeToken {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMinutes * 60_000).toISOString();
  getCoreDb()
    .db.insert(schema.passwordResetTokens)
    .values({
      id: createId('tok'),
      user_id: userId,
      token_hash: tokenFingerprint(token),
      status: 'pending',
      requested_ip: ip ?? null,
      created_at: new Date(now).toISOString(),
      expires_at: expiresAt,
      used_at: null,
    })
    .run();
  return { id: '', token, expiresAt };
}

function createEmailVerificationRow(userId: string, email: string, ttlMinutes: number): OneTimeToken {
  const token = randomToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + ttlMinutes * 60_000).toISOString();
  getCoreDb()
    .db.insert(schema.emailVerificationTokens)
    .values({
      id: createId('tok'),
      user_id: userId,
      email,
      token_hash: tokenFingerprint(token),
      status: 'pending',
      created_at: new Date(now).toISOString(),
      expires_at: expiresAt,
      used_at: null,
    })
    .run();
  return { id: '', token, expiresAt };
}

// ── recuperación de contraseña ────────────────────────────────────────────────

export function createPasswordResetToken(userId: string, ttlMinutes: number, ip?: string): OneTimeToken {
  const { db } = getCoreDb();
  // Anula los pedidos previos vivos: si alguien pidió tres reset en un minuto,
  // solo vale el último.
  db.update(schema.passwordResetTokens)
    .set({ status: 'expired' })
    .where(and(eq(schema.passwordResetTokens.user_id, userId), isNull(schema.passwordResetTokens.used_at)))
    .run();
  return createPasswordResetRow(userId, ttlMinutes, ip);
}

export interface ConsumedToken {
  userId: string;
  status: 'ok' | 'invalido' | 'usado' | 'expirado';
}

export function consumePasswordResetToken(token: string): ConsumedToken {
  const { db } = getCoreDb();
  const row = db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.token_hash, tokenFingerprint(token)))
    .get();
  if (!row) return { userId: '', status: 'invalido' };
  if (row.status === 'used') return { userId: row.user_id, status: 'usado' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.update(schema.passwordResetTokens).set({ status: 'expired' }).where(eq(schema.passwordResetTokens.id, row.id)).run();
    return { userId: row.user_id, status: 'expirado' };
  }
  db.update(schema.passwordResetTokens)
    .set({ status: 'used', used_at: new Date().toISOString() })
    .where(eq(schema.passwordResetTokens.id, row.id))
    .run();
  return { userId: row.user_id, status: 'ok' };
}

export function isPasswordResetTokenValid(token: string): boolean {
  const { db } = getCoreDb();
  const row = db
    .select()
    .from(schema.passwordResetTokens)
    .where(eq(schema.passwordResetTokens.token_hash, tokenFingerprint(token)))
    .get();
  if (!row || row.status !== 'pending') return false;
  return new Date(row.expires_at).getTime() > Date.now();
}

// ── verificación de email ─────────────────────────────────────────────────────

export function createEmailVerificationToken(userId: string, email: string, ttlMinutes: number): OneTimeToken {
  return createEmailVerificationRow(userId, email, ttlMinutes);
}

export function consumeEmailVerificationToken(token: string): ConsumedToken {
  const { db } = getCoreDb();
  const row = db
    .select()
    .from(schema.emailVerificationTokens)
    .where(eq(schema.emailVerificationTokens.token_hash, tokenFingerprint(token)))
    .get();
  if (!row) return { userId: '', status: 'invalido' };
  if (row.status === 'used') return { userId: row.user_id, status: 'usado' };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.update(schema.emailVerificationTokens).set({ status: 'expired' }).where(eq(schema.emailVerificationTokens.id, row.id)).run();
    return { userId: row.user_id, status: 'expirado' };
  }
  db.update(schema.emailVerificationTokens)
    .set({ status: 'used', used_at: new Date().toISOString() })
    .where(eq(schema.emailVerificationTokens.id, row.id))
    .run();
  return { userId: row.user_id, status: 'ok' };
}

export type { OneTimeStatus };
