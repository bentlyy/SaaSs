import { schema } from '../db/schema.js';

export type Role = (typeof schema.roles)[number];

/**
 * Roles globales de la plataforma. Tres y a proposito: owner (paga y decide),
 * admin (opera la organización) y member (usa). Los permisos finos viven en el
 * producto, no acá: el Core no sabe qué puede hacer un recepcionista.
 */
export const ROLE_RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (schema.roles as readonly string[]).includes(value);
}

export function atLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Admin o owner: puede invitar gente, editar la organización y ver la facturación. */
export function canManageOrganization(role: Role): boolean {
  return atLeast(role, 'admin');
}

/** Solo owner: es quienRepresenta al cliente que paga. */
export function canManageBilling(role: Role): boolean {
  return role === 'owner';
}
