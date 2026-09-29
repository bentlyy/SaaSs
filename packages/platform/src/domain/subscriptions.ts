import { and, desc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { AppError } from '@saas-mini/core';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';
import { findOrganizationById, type Organization } from './organizations.js';
import { findProductBySlug, requireProductById, type Product } from './products.js';
import { canManageBilling, type Role } from './roles.js';
import { findSsoClient } from '../sso/registry.js';
import { platformConfig } from '../config.js';
import type { ToolClaim } from '../sso/tokens.js';

export type Subscription = typeof schema.subscriptions.$inferSelect;
export type Payment = typeof schema.payments.$inferSelect;

export const subscriptionStatus = schema.subscriptionStatus;
export const paymentStatus = schema.paymentStatus;
export const billingProviders = schema.billingProviders;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Suscripción vigente: activa y dentro del periodo pagado.
 *
 * `current_period_end` en el futuro (o nulo = sin caducidad) es lo que separa
 * "pagué hasta marzo" de "se venció en marzo y nadie renovó". Sin esta
 * condición, `status='active'` soltaría el producto para siempre.
 */
export function isSubscriptionLive(row: Subscription): boolean {
  if (row.status !== 'active') return false;
  if (!row.current_period_end) return true;
  return new Date(row.current_period_end).getTime() > Date.now();
}

const isLive = isSubscriptionLive;

export interface AccessState {
  allowed: boolean;
  reason:
    | 'ok'
    | 'organizacion-inactiva'
    | 'producto-inexistente'
    | 'producto-inactivo'
    | 'sin-suscripcion'
    | 'suscripcion-vencida'
    | 'suscripcion-no-activa';
  subscription?: Subscription;
  product?: Product;
}

/**
 * ¿Tiene esta organización acceso a este producto?
 *
 * El Core es la única fuente de verdad: decide la suscripción, no hay lista
 * aparte. Ver docs/BILLING.md.
 */
export function productAccess(organizationId: string, productSlug: string): AccessState {
  const organization = findOrganizationById(organizationId);
  if (!organization || organization.status !== 'active') {
    return { allowed: false, reason: 'organizacion-inactiva' };
  }
  const product = findProductBySlug(productSlug);
  if (!product) return { allowed: false, reason: 'producto-inexistente' };
  if (product.status !== 'active') return { allowed: false, reason: 'producto-inactivo', product };

  const subscription = currentSubscription(organizationId, product.id);
  if (!subscription) return { allowed: false, reason: 'sin-suscripcion', product };

  if (subscription.status === 'active') {
    if (!subscription.current_period_end || new Date(subscription.current_period_end).getTime() > Date.now()) {
      return { allowed: true, reason: 'ok', subscription, product };
    }
    return { allowed: false, reason: 'suscripcion-vencida', subscription, product };
  }
  return { allowed: false, reason: 'suscripcion-no-activa', subscription, product };
}

/** La suscripción vigente (o la más reciente si ya no está vigente). */
export function currentSubscription(organizationId: string, productId: string): Subscription | undefined {
  const rows = getCoreDb()
    .db
    .select()
    .from(schema.subscriptions)
    .where(
      and(
        eq(schema.subscriptions.organization_id, organizationId),
        eq(schema.subscriptions.product_id, productId),
      ),
    )
    .orderBy(desc(schema.subscriptions.created_at))
    .all();
  return rows.find(isLive) ?? rows[0];
}

/** La pregunta que se hace en las rutas y en el SSO: ¿tiene este producto? */
export function hasActiveSubscription(organizationId: string, productSlug: string): boolean {
  return productAccess(organizationId, productSlug).allowed;
}

export function assertProductAccess(organizationId: string, productSlug: string): AccessState {
  const state = productAccess(organizationId, productSlug);
  if (!state.allowed) {
    throw new AppError(403, accessMessage(state.reason, productSlug), { reason: state.reason, product: productSlug });
  }
  return state;
}

export function accessMessage(reason: AccessState['reason'], productSlug: string): string {
  switch (reason) {
    case 'organizacion-inactiva':
      return 'Tu organización está suspendida. Escríbenos para reactivarla.';
    case 'producto-inexistente':
      return `No existe la aplicación "${productSlug}".`;
    case 'producto-inactivo':
      return `La aplicación "${productSlug}" ya no está disponible.`;
    case 'sin-suscripcion':
      return `Todavía no contrataste ${productSlug}. Actívala desde Mis aplicaciones.`;
    case 'suscripcion-vencida':
      return `Tu plan de ${productSlug} venció. Renueva para seguir usándolo.`;
    case 'suscripcion-no-activa':
      return `Tu plan de ${productSlug} no está activo.`;
    default:
      return 'Acceso concedido';
  }
}

export interface OrganizationProduct {
  product: Product;
  subscription: Subscription;
  state: AccessState;
}

/** Los productos que la organización tiene contratados, con su estado. */
export function getOrganizationProducts(organizationId: string): OrganizationProduct[] {
  const { db } = getCoreDb();
  const rows = db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.organization_id, organizationId))
    .orderBy(desc(schema.subscriptions.created_at))
    .all();
  const products = new Map(
    db
      .select()
      .from(schema.products)
      .all()
      .map((p) => [p.id, p]),
  );

  const seen = new Set<string>();
  const out: OrganizationProduct[] = [];
  for (const row of rows) {
    if (seen.has(row.product_id)) continue;
    const product = products.get(row.product_id);
    if (!product) continue;
    seen.add(row.product_id);
    out.push({
      product,
      subscription: row,
      state: productAccess(organizationId, product.slug),
    });
  }
  return out;
}

/** Catálogo completo con una bandera por producto: contracted / available. */
export function organizationProductCatalog(organizationId: string): Array<{
  product: Product;
  state: AccessState;
  contracted: boolean;
}> {
  const contracted = new Map(getOrganizationProducts(organizationId).map((entry) => [entry.product.slug, entry]));
  return listActiveProductsForCatalog().map((product) => {
    const entry = contracted.get(product.slug);
    return {
      product,
      state: entry?.state ?? productAccess(organizationId, product.slug),
      contracted: entry ? entry.state.allowed : false,
    };
  });
}

/**
 * Las herramientas que la organización puede abrir, en el orden del catálogo.
 *
 * Es lo que cada producto dibuja en su barra lateral. Filtra por
 * `state.allowed`, no solo por `contracted`: una suscripción suspendida o
 * vencida esconde la herramienta en vez de llevar a un error de acceso.
 */
export function organizationToolList(organizationId: string): ToolClaim[] {
  return organizationProductCatalog(organizationId)
    .filter((entry) => entry.state.allowed)
    .map((entry) => ({ slug: entry.product.slug, name: entry.product.name, url: toolUrl(entry.product) }));
}

/**
 * Dónde vive una herramienta.
 *
 * `app_url` es el subdominio de producción. En local los productos corren en
 * puertos distintos, y ese dato ya está escrito: es el `redirect_uri` que el
 * cliente SSO tiene registrado. Se toma de ahí y no de una tabla de puertos
 * aparte para que no puedan desincronizarse: si el callback local cambió, el
 * enlace de la barra lateral cambia con él.
 *
 * Si el producto no tiene callback local, se cae a `app_url`.
 */
function toolUrl(product: Product): string {
  // En desarrollo la URL local la da `CORE_LOCAL_APPS` (slug -> url), que es el
  // mismo dato que el producto tiene en su propio .env. Sin ella se usaría el
  // subdominio de producción y el salto entre herramientas se iría a internet.
  const local = platformConfig.localApps[product.slug];
  if (local) return local;
  const registered = findSsoClient(product.slug)?.redirectUris.find((uri) => /\/auth\/callback$/.test(uri));
  if (registered) return registered.replace(/\/auth\/callback$/, '');
  return product.app_url ?? '';
}

function listActiveProductsForCatalog(): Product[] {
  const { db } = getCoreDb();
  return db
    .select()
    .from(schema.products)
    .where(eq(schema.products.status, 'active'))
    .orderBy(schema.products.sort_order, schema.products.name)
    .all();
}

export function listSubscriptions(organizationId: string): Subscription[] {
  return getCoreDb()
    .db.select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.organization_id, organizationId))
    .orderBy(desc(schema.subscriptions.created_at))
    .all();
}

export interface CreateSubscriptionInput {
  organizationId: string;
  productId: string;
  status?: (typeof schema.subscriptionStatus)[number];
  provider?: (typeof schema.billingProviders)[number];
  providerSubscriptionId?: string;
  periodStart?: string;
  periodEnd?: string;
  activate?: boolean;
}

export function createSubscription(input: CreateSubscriptionInput): Subscription {
  const { db } = getCoreDb();
  const organization = findOrganizationById(input.organizationId);
  if (!organization) throw new AppError(404, 'Organización no encontrada');
  const product = requireProductById(input.productId);

  const existing = currentSubscription(input.organizationId, product.id);
  if (existing && isLive(existing)) return existing;

  const now = nowIso();
  return db
    .insert(schema.subscriptions)
    .values({
      organization_id: input.organizationId,
      product_id: product.id,
      status: input.status ?? 'pending',
      provider: input.provider ?? 'manual',
      provider_subscription_id: input.providerSubscriptionId ?? null,
      started_at: input.activate ? now : null,
      current_period_start: input.periodStart ?? (input.activate ? now : null),
      current_period_end: input.periodEnd ?? null,
      cancelled_at: null,
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
}

export function activateSubscription(id: string, periodEnd?: string): Subscription {
  const { db } = getCoreDb();
  const now = nowIso();
  const row = db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)).get();
  if (!row) throw new AppError(404, 'Suscripción no encontrada');
  return db
    .update(schema.subscriptions)
    .set({
      status: 'active',
      started_at: row.started_at ?? now,
      current_period_start: row.current_period_start ?? now,
      current_period_end: periodEnd ?? row.current_period_end,
      updated_at: now,
    })
    .where(eq(schema.subscriptions.id, id))
    .returning()
    .get();
}

export function cancelSubscription(id: string): Subscription {
  const { db } = getCoreDb();
  const now = nowIso();
  return db
    .update(schema.subscriptions)
    .set({ status: 'cancelled', cancelled_at: now, updated_at: now })
    .where(eq(schema.subscriptions.id, id))
    .returning()
    .get();
}

/** Da de alta lo pagado. Atajo usado por ops mientras no haya pasarela de pago. */
export function grantSubscription(input: {
  organizationId: string;
  productId: string;
  days?: number;
  provider?: (typeof schema.billingProviders)[number];
  providerSubscriptionId?: string;
  amount?: number;
}): { subscription: Subscription; payment?: Payment } {
  const days = input.days ?? 30;
  const now = Date.now();
  const periodEnd = new Date(now + days * 86_400_000).toISOString();

  const product = requireProductById(input.productId);
  const pending = createSubscription({
    organizationId: input.organizationId,
    productId: product.id,
    provider: input.provider,
    providerSubscriptionId: input.providerSubscriptionId,
  });
  const subscription = activateSubscription(pending.id, periodEnd);

  let payment: Payment | undefined;
  if (input.amount !== undefined) {
    payment = createPayment({
      organizationId: input.organizationId,
      subscriptionId: subscription.id,
      productId: product.id,
      amount: input.amount,
      currency: product.currency,
      provider: input.provider ?? 'manual',
      status: 'paid',
      paidAt: new Date(now).toISOString(),
      providerReference: input.providerSubscriptionId,
    });
  }
  return { subscription, payment };
}

/** Marca como vencidas las suscripciones cuyo periodo ya pasó. Idempotente. */
export function expireDueSubscriptions(): number {
  const now = nowIso();
  const result = getCoreDb()
    .db.update(schema.subscriptions)
    .set({ status: 'expired', updated_at: now })
    .where(
      and(
        eq(schema.subscriptions.status, 'active'),
        lte(schema.subscriptions.current_period_end, now),
        isNull(schema.subscriptions.cancelled_at),
      ),
    )
    .run();
  return result.changes;
}

export function listPayments(organizationId: string): Payment[] {
  return getCoreDb()
    .db.select()
    .from(schema.payments)
    .where(eq(schema.payments.organization_id, organizationId))
    .orderBy(desc(schema.payments.created_at))
    .all();
}

export function listPaymentsForSubscriptions(subscriptionIds: string[]): Payment[] {
  if (subscriptionIds.length === 0) return [];
  return getCoreDb()
    .db.select()
    .from(schema.payments)
    .where(inArray(schema.payments.subscription_id, subscriptionIds))
    .all();
}

export function createPayment(input: {
  organizationId: string;
  subscriptionId?: string | null;
  productId?: string | null;
  amount: number;
  currency?: string;
  status?: (typeof schema.paymentStatus)[number];
  provider?: (typeof schema.billingProviders)[number];
  providerReference?: string;
  paidAt?: string;
}): Payment {
  return getCoreDb()
    .db.insert(schema.payments)
    .values({
      organization_id: input.organizationId,
      subscription_id: input.subscriptionId ?? null,
      product_id: input.productId ?? null,
      amount: input.amount,
      currency: input.currency ?? 'CLP',
      status: input.status ?? 'pending',
      provider: input.provider ?? 'manual',
      provider_reference: input.providerReference ?? null,
      paid_at: input.paidAt ?? null,
      created_at: nowIso(),
    })
    .returning()
    .get();
}

export function findPaymentByProviderReference(
  provider: (typeof schema.billingProviders)[number],
  reference: string,
): Payment | undefined {
  return getCoreDb()
    .db.select()
    .from(schema.payments)
    .where(and(eq(schema.payments.provider, provider), eq(schema.payments.provider_reference, reference)))
    .get();
}

export function findSubscriptionById(id: string): Subscription | undefined {
  return getCoreDb().db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, id)).get();
}

/**
 * Un cobro a medias para esta organización y este producto.
 *
 * Existe para el doble clic de "Contratar". El caso NO es raro -- es el normal
 * en una conexion lenta o un doble toque -- y sin esta consulta cada intento
 * creaba su propio checkout: dos transferencias que hacer, dos veces el mismo
 * cobro del lado de AMG. Se busca solo el pago `pending`, que es el unico que
 * todavia se puede terminar; uno pagado o cancelado no bloquea nada.
 */
export function findPendingPayment(
  organizationId: string,
  productId: string,
  provider: Payment['provider'],
): Payment | undefined {
  const { db } = getCoreDb();
  return db
    .select()
    .from(schema.payments)
    .where(and(
      eq(schema.payments.organization_id, organizationId),
      eq(schema.payments.product_id, productId),
      eq(schema.payments.provider, provider),
      eq(schema.payments.status, 'pending'),
    ))
    .get();
}

/**
 * Pasa un pago a pagado. Idempotente a proposito: la pasarela reintenta el
 * webhook y dos confirmaciones no pueden cobrar dos veces ni fechar dos pagos.
 */
export function markPaymentPaid(id: string, paidAt: string): Payment {
  const { db } = getCoreDb();
  const row = db.select().from(schema.payments).where(eq(schema.payments.id, id)).get();
  if (!row) throw new AppError(404, 'Pago no encontrado');
  if (row.status === 'paid') return row;
  return db
    .update(schema.payments)
    .set({ status: 'paid', paid_at: paidAt })
    .where(eq(schema.payments.id, id))
    .returning()
    .get();
}

/**
 * COBRO EN UN SOLO PASO: PAGA Y ABRE, O NO PASA NADA
 * ====================================================
 *
 * Marcar el pago pagado y abrir el producto son DOS escrituras sobre la misma
 * realidad comercial, asi que van en una transaccion. Separadas dejan un
 * estado que no deberia existir: el cliente TRANSIERIO el dinero, el pago
 * consta como pagado y la suscripcion sigue pendiente. Ahi el sistema ya no
 * sabe que hacer, y lo peor es que el reintento del webhook no lo arregla,
 * porque un pago pagado se responde "ya confirmado" y nunca se vuelve a
 * intentar abrir el producto. El cliente pago y no entro: el caso de soporte
 * mas caro que existe, y enterarse por el cliente.
 *
 * La transaccion tambien hace idempotente el par completo: si el proceso muere
 * entre las dos escrituras, no queda ninguno de los dos estados parciales.
 */
export function confirmPaymentAndActivate(input: {
  paymentId: string;
  subscriptionId: string;
  paidAt: string;
  periodEnd: string;
}): { payment: Payment; subscription: Subscription } {
  const { db, sqlite } = getCoreDb();

  const ejecutar = sqlite.transaction(() => {
    const pago = db.select().from(schema.payments).where(eq(schema.payments.id, input.paymentId)).get();
    if (!pago) throw new AppError(404, 'Pago no encontrado');

    const pagoPagado = pago.status === 'paid'
      ? pago
      : db.update(schema.payments)
        .set({ status: 'paid', paid_at: input.paidAt })
        .where(eq(schema.payments.id, input.paymentId))
        .returning()
        .get();

    const sus = db.select().from(schema.subscriptions).where(eq(schema.subscriptions.id, input.subscriptionId)).get();
    if (!sus) throw new AppError(404, 'Suscripción no encontrada');

    // No se pisa un periodo que ya esta pagado y vigente: un reintento no le
    // regala un mes gratis al cliente, y la diferencia la paga AMG.
    const susActiva = isSubscriptionLive(sus)
      ? sus
      : db.update(schema.subscriptions)
        .set({
          status: 'active',
          started_at: sus.started_at ?? nowIso(),
          current_period_start: sus.current_period_start ?? nowIso(),
          current_period_end: input.periodEnd,
          updated_at: nowIso(),
        })
        .where(eq(schema.subscriptions.id, input.subscriptionId))
        .returning()
        .get();

    return { payment: pagoPagado, subscription: susActiva };
  });

  return ejecutar();
}

/** Autorización de billing: solo el owner opera el dinero de la organización. */
export function assertCanManageBilling(role: Role): void {
  if (!canManageBilling(role)) {
    throw new AppError(403, 'Solo el owner puede gestionar la facturación de la organización');
  }
}

export type { Organization };
