import { eq, sql } from 'drizzle-orm';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';

export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;

export const userStatus = schema.userStatus;

/**
 * Forma publica de un usuario. Es la unica que sale por HTTP.
 *
 * `password_hash` no esta en el tipo de retorno, asi que la regla se aplica en
 * el compilador: si alguien intenta mandarlo, no compila. No es que "se
 * limpie" en el JSON, es que no existe en la forma que se puede serializar.
 */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  status: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    email_verified_at: user.email_verified_at,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function findUserByEmail(email: string): User | undefined {
  return getCoreDb()
    .db.select()
    .from(schema.users)
    .where(eq(schema.users.email, normalizeEmail(email)))
    .get();
}

export function findUserById(id: string): User | undefined {
  return getCoreDb().db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

export function createUser(input: {
  name: string;
  email: string;
  passwordHash: string;
  status?: (typeof schema.userStatus)[number];
  emailVerifiedAt?: string | null;
}): User {
  const now = new Date().toISOString();
  return getCoreDb()
    .db.insert(schema.users)
    .values({
      name: input.name,
      email: normalizeEmail(input.email),
      password_hash: input.passwordHash,
      status: input.status ?? 'active',
      email_verified_at: input.emailVerifiedAt ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
}

export function updateUserProfile(id: string, patch: { name?: string; email?: string }): User | undefined {
  const values: Partial<NewUser> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.email !== undefined) values.email = normalizeEmail(patch.email);
  return getCoreDb().db.update(schema.users).set(values).where(eq(schema.users.id, id)).returning().get();
}

export function setUserPasswordHash(id: string, passwordHash: string): void {
  getCoreDb()
    .db.update(schema.users)
    .set({ password_hash: passwordHash, updated_at: new Date().toISOString() })
    .where(eq(schema.users.id, id))
    .run();
}

export function setUserStatus(id: string, status: (typeof schema.userStatus)[number]): void {
  getCoreDb()
    .db.update(schema.users)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(schema.users.id, id))
    .run();
}

export function markEmailVerified(id: string): void {
  const now = new Date().toISOString();
  getCoreDb()
    .db.update(schema.users)
    .set({ email_verified_at: now, status: 'active', updated_at: now })
    .where(eq(schema.users.id, id))
    .run();
}

/** Salidas de emergencia: revoca todas las sesiones del usuario (ver sessions.ts). */
export function countUsers(): number {
  const row = getCoreDb().db.select({ n: sql<number>`count(*)` }).from(schema.users).get();
  return row?.n ?? 0;
}

export function emailExists(email: string, exceptUserId?: string): boolean {
  const user = findUserByEmail(email);
  return !!user && user.id !== exceptUserId;
}
