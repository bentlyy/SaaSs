import { and, eq, sql } from 'drizzle-orm';
import { AppError } from '@saas-mini/core';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';
import { isRole, type Role } from './roles.js';

export type Membership = typeof schema.memberships.$inferSelect;
export type OrganizationWithRole = {
  id: string;
  name: string;
  slug: string;
  status: string;
  role: Role;
  created_at: string;
  updated_at: string;
};

export function findMembership(userId: string, organizationId: string): Membership | undefined {
  return getCoreDb()
    .db.select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.user_id, userId), eq(schema.memberships.organization_id, organizationId)))
    .get();
}

/**
 * Rol de un usuario en una organización, o `null` si no es miembro.
 * Esta es la ÚNICA fuente de autorización por rol: nada de un rol que venga
 * puesto en la sesión sin contrastar, siempre sale de la base.
 */
export function roleIn(userId: string, organizationId: string): Role | null {
  const row = getCoreDb()
    .db.select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.user_id, userId), eq(schema.memberships.organization_id, organizationId)))
    .get();
  return row && isRole(row.role) ? row.role : null;
}

export function createMembership(input: { userId: string; organizationId: string; role?: Role }): Membership {
  const role = input.role ?? 'member';
  if (!isRole(role)) throw new AppError(400, 'Rol desconocido');
  const existing = findMembership(input.userId, input.organizationId);
  if (existing) return existing;
  return getCoreDb()
    .db.insert(schema.memberships)
    .values({
      user_id: input.userId,
      organization_id: input.organizationId,
      role,
      created_at: new Date().toISOString(),
    })
    .returning()
    .get();
}

/** Organizaciones del usuario con su rol. Un usuario puede estar en varias. */
export function listOrganizationsForUser(userId: string): OrganizationWithRole[] {
  return getCoreDb()
    .db
    .select({
      id: schema.organizations.id,
      name: schema.organizations.name,
      slug: schema.organizations.slug,
      status: schema.organizations.status,
      created_at: schema.organizations.created_at,
      updated_at: schema.organizations.updated_at,
      role: schema.memberships.role,
    })
    .from(schema.memberships)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.organization_id))
    .where(eq(schema.memberships.user_id, userId))
    .orderBy(schema.memberships.created_at)
    .all()
    .map((row) => ({ ...row, role: row.role as Role }));
}

export function countOwners(organizationId: string): number {
  const row = getCoreDb()
    .db.select({ n: sql<number>`count(*)` })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.organization_id, organizationId), eq(schema.memberships.role, 'owner')))
    .get();
  return row?.n ?? 0;
}

/** Invariante: una organización siempre tiene al menos un owner. */
export function assertNotLastOwner(organizationId: string, userId: string): void {
  if (countOwners(organizationId) <= 1 && roleIn(userId, organizationId) === 'owner') {
    throw new AppError(409, 'La organización necesita al menos un owner. Transfiere el rol antes de salir.');
  }
}

export function setMembershipRole(userId: string, organizationId: string, role: Role): Membership {
  if (!isRole(role)) throw new AppError(400, 'Rol desconocido');
  const membership = findMembership(userId, organizationId);
  if (!membership) throw new AppError(404, 'Ese usuario no pertenece a la organización');
  if (membership.role === 'owner' && role !== 'owner') assertNotLastOwner(organizationId, userId);
  return getCoreDb()
    .db.update(schema.memberships)
    .set({ role })
    .where(eq(schema.memberships.id, membership.id))
    .returning()
    .get();
}

export function removeMembership(userId: string, organizationId: string): void {
  const membership = findMembership(userId, organizationId);
  if (!membership) return;
  if (membership.role === 'owner') assertNotLastOwner(organizationId, userId);
  getCoreDb().db.delete(schema.memberships).where(eq(schema.memberships.id, membership.id)).run();
}

export interface OrganizationMember {
  user_id: string;
  name: string;
  email: string;
  status: string;
  role: Role;
  joined_at: string;
}

export function listMembers(organizationId: string): OrganizationMember[] {
  return getCoreDb()
    .db
    .select({
      user_id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      role: schema.memberships.role,
      joined_at: schema.memberships.created_at,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.user_id))
    .where(eq(schema.memberships.organization_id, organizationId))
    .orderBy(schema.memberships.created_at)
    .all()
    .map((row) => ({ ...row, role: row.role as Role }));
}
