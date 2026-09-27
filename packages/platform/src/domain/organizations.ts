import { eq, sql } from 'drizzle-orm';
import { AppError } from '@saas-mini/core';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';
import { slugify, slugSuffix } from './slug.js';

export type Organization = typeof schema.organizations.$inferSelect;

export const organizationStatus = schema.organizationStatus;

export function findOrganizationById(id: string): Organization | undefined {
  return getCoreDb().db.select().from(schema.organizations).where(eq(schema.organizations.id, id)).get();
}

export function findOrganizationBySlug(slug: string): Organization | undefined {
  return getCoreDb().db.select().from(schema.organizations).where(eq(schema.organizations.slug, slug)).get();
}

export function slugTaken(slug: string): boolean {
  return !!findOrganizationBySlug(slug);
}

/**
 * Slug legible y unico. Se reintenta con sufijo aleatorio en vez de fallar:
 * que dos empresas se llamen "Mi Empresa" es normal, no un error del usuario.
 */
export function uniqueSlug(name: string): string {
  const base = slugify(name);
  if (!slugTaken(base)) return base;
  for (let i = 0; i < 8; i += 1) {
    const candidate = `${base}-${slugSuffix()}`.slice(0, 40);
    if (!slugTaken(candidate)) return candidate;
  }
  throw new AppError(503, 'No pudimos reservar el nombre de la organización, inténtalo de nuevo');
}

export function createOrganization(input: { name: string; slug?: string; status?: (typeof schema.organizationStatus)[number] }): Organization {
  const now = new Date().toISOString();
  return getCoreDb()
    .db.insert(schema.organizations)
    .values({
      name: input.name,
      slug: input.slug ?? uniqueSlug(input.name),
      status: input.status ?? 'active',
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
}

export function updateOrganization(id: string, patch: { name?: string; slug?: string }): Organization {
  const values: Record<string, string> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.slug !== undefined) values.slug = patch.slug;
  const updated = getCoreDb()
    .db.update(schema.organizations)
    .set(values)
    .where(eq(schema.organizations.id, id))
    .returning()
    .get();
  if (!updated) throw new AppError(404, 'Organización no encontrada');
  return updated;
}

export function setOrganizationStatus(id: string, status: (typeof schema.organizationStatus)[number]): void {
  getCoreDb()
    .db.update(schema.organizations)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(schema.organizations.id, id))
    .run();
}

export function listOrganizations(): Organization[] {
  return getCoreDb().db.select().from(schema.organizations).orderBy(schema.organizations.created_at).all();
}

export function countOrganizations(): number {
  const row = getCoreDb().db.select({ n: sql<number>`count(*)` }).from(schema.organizations).get();
  return row?.n ?? 0;
}
