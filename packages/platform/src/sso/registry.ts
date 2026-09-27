import { eq } from 'drizzle-orm';
import { getCoreDb, createId } from '../db/index.js';
import { schema } from '../db/schema.js';
import { deriveClientSecret } from '../security/tokens.js';
import { findProductBySlug, type Product } from '../domain/products.js';

export type SsoClient = typeof schema.ssoClients.$inferSelect;

export interface SsoClientInfo {
  clientId: string;
  name: string;
  secret: string;
  redirectUris: string[];
  status: string;
  product?: Product;
}

function parseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function toClientInfo(row: SsoClient, product?: Product): SsoClientInfo {
  return {
    clientId: row.client_id,
    name: row.name,
    secret: row.secret,
    redirectUris: parseList(row.redirect_uris),
    status: row.status,
    product,
  };
}

export function findSsoClient(clientId: string): SsoClientInfo | undefined {
  const row = getCoreDb().db.select().from(schema.ssoClients).where(eq(schema.ssoClients.client_id, clientId)).get();
  if (!row) return undefined;
  return toClientInfo(row, findProductBySlug(clientId));
}

/**
 * Alta (o repair) del cliente SSO de un producto.
 *
 * El secreto se deriva con HKDF del root de la plataforma: no está en el repo,
 * no está en el .env del producto hasta que ops lo imprime, y es DISTINTO por
 * producto. Esa última parte es la que importa: si se filtra el secreto de
 * inventario, el atacante no puede firmar un token de cotizaciones.
 */
export function ensureSsoClient(productSlug: string, options: { name?: string; redirectUris?: string[] } = {}): SsoClientInfo {
  const { db } = getCoreDb();
  const product = findProductBySlug(productSlug);
  const now = new Date().toISOString();
  const name = options.name ?? product?.name ?? productSlug;
  const redirectUris = options.redirectUris ?? (product?.app_url ? [`${product.app_url}/auth/callback`] : []);

  const existing = db.select().from(schema.ssoClients).where(eq(schema.ssoClients.client_id, productSlug)).get();
  if (existing) {
    const updated = db
      .update(schema.ssoClients)
      .set({ name, redirect_uris: JSON.stringify(redirectUris), updated_at: now })
      .where(eq(schema.ssoClients.id, existing.id))
      .returning()
      .get();
    return toClientInfo(updated, product);
  }

  const created = db
    .insert(schema.ssoClients)
    .values({
      id: createId('cli'),
      client_id: productSlug,
      name,
      secret: deriveClientSecret(productSlug),
      redirect_uris: JSON.stringify(redirectUris),
      logout_redirect_uris: '[]',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
  return toClientInfo(created, product);
}

export function rotateSsoClientSecret(productSlug: string): SsoClientInfo {
  const { db } = getCoreDb();
  const existing = db.select().from(schema.ssoClients).where(eq(schema.ssoClients.client_id, productSlug)).get();
  if (!existing) return ensureSsoClient(productSlug);
  const updated = db
    .update(schema.ssoClients)
    .set({ secret: deriveClientSecret(`${productSlug}:${Date.now()}`), updated_at: new Date().toISOString() })
    .where(eq(schema.ssoClients.id, existing.id))
    .returning()
    .get();
  return toClientInfo(updated);
}

export function setSsoClientStatus(clientId: string, status: 'active' | 'disabled'): void {
  getCoreDb()
    .db.update(schema.ssoClients)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(schema.ssoClients.client_id, clientId))
    .run();
}

export function listSsoClients(): SsoClientInfo[] {
  return getCoreDb()
    .db.select()
    .from(schema.ssoClients)
    .all()
    .map((row) => toClientInfo(row, findProductBySlug(row.client_id)));
}

/**
 * ¿Este redirect_uri está permitido para este cliente?
 *
 * Comparación EXACTA de string, nunca prefijo ni comodín. Un `startsWith` acá es
 * un open redirect con ankle: `https://stock.amgdeveloper.cl.evil.com`.
 */
export function isRedirectUriAllowed(client: SsoClientInfo, redirectUri: string): boolean {
  if (!redirectUri) return false;
  return client.redirectUris.includes(redirectUri);
}

/** Resuelve el redirect_uri por defecto del producto, si lo tiene configurado. */
export function defaultRedirectUri(client: SsoClientInfo): string | undefined {
  return client.redirectUris[0];
}
