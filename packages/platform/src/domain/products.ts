import { asc, eq } from 'drizzle-orm';
import { AppError } from '@saas-mini/core';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';

export type Product = typeof schema.products.$inferSelect;

export const productStatus = schema.productStatus;
export const billingPeriods = schema.billingPeriods;

/** Forma pública del catálogo. Es lo que ven la web y los productos. */
export interface PublicProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  tagline: string | null;
  price: number;
  currency: string;
  billing_period: string;
  status: string;
  app_url: string | null;
}

export function publicProduct(product: Product): PublicProduct {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    tagline: product.tagline,
    price: product.price,
    currency: product.currency,
    billing_period: product.billing_period,
    status: product.status,
    app_url: product.app_url,
  };
}

export function listProducts(options: { includeInactive?: boolean } = {}): Product[] {
  const { db } = getCoreDb();
  const all = db.select().from(schema.products).orderBy(asc(schema.products.sort_order), asc(schema.products.name)).all();
  return options.includeInactive ? all : all.filter((p) => p.status === 'active');
}

export function findProductBySlug(slug: string): Product | undefined {
  return getCoreDb().db.select().from(schema.products).where(eq(schema.products.slug, slug)).get();
}

export function findProductById(id: string): Product | undefined {
  return getCoreDb().db.select().from(schema.products).where(eq(schema.products.id, id)).get();
}

export function requireProductBySlug(slug: string): Product {
  const product = findProductBySlug(slug);
  if (!product) throw new AppError(404, `No existe el producto "${slug}"`);
  return product;
}

export function requireProductById(id: string): Product {
  const product = findProductById(id);
  if (!product) throw new AppError(404, 'Producto no encontrado');
  return product;
}

export function upsertProduct(input: {
  slug: string;
  name: string;
  description?: string;
  price?: number;
  currency?: string;
  billingPeriod?: (typeof schema.billingPeriods)[number];
  status?: (typeof schema.productStatus)[number];
  appUrl?: string | null;
  tagline?: string | null;
  sortOrder?: number;
}): Product {
  const { db } = getCoreDb();
  const now = new Date().toISOString();
  const existing = findProductBySlug(input.slug);
  const values = {
    name: input.name,
    description: input.description ?? existing?.description ?? '',
    price: input.price ?? existing?.price ?? 0,
    currency: input.currency ?? existing?.currency ?? 'CLP',
    billing_period: input.billingPeriod ?? existing?.billing_period ?? ('monthly' as const),
    status: input.status ?? existing?.status ?? ('active' as const),
    app_url: input.appUrl === undefined ? existing?.app_url ?? null : input.appUrl,
    tagline: input.tagline === undefined ? existing?.tagline ?? null : input.tagline,
    sort_order: input.sortOrder ?? existing?.sort_order ?? 0,
    updated_at: now,
  };

  if (existing) {
    return db.update(schema.products).set(values).where(eq(schema.products.id, existing.id)).returning().get();
  }
  return db
    .insert(schema.products)
    .values({ slug: input.slug, created_at: now, ...values })
    .returning()
    .get();
}

export function setProductStatus(slug: string, status: (typeof schema.productStatus)[number]): Product {
  return getCoreDb()
    .db.update(schema.products)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(schema.products.slug, slug))
    .returning()
    .get();
}
