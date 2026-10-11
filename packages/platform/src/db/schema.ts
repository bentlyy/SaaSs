import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createId } from './id.js';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => createId());

const ts = (name: string) => text(name).notNull().$defaultFn(() => new Date().toISOString());

const userCol = () => text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });
const orgCol = () => text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' });
const productCol = () => text('product_id').notNull().references(() => products.id, { onDelete: 'cascade' });

// ─────────────────────────────────────────────────────────────────────────────
// Identidad: usuario → organización → membresía.
// El password SOLO existe acá. Ningún mini-SaaS lo guarda.
// ─────────────────────────────────────────────────────────────────────────────

export const userStatus = ['active', 'suspended', 'pending'] as const;

export const users = sqliteTable('users', {
  id: id(),
  name: text('name').notNull(),
  /** Global y unico (lowercase). Un correo = un usuario en toda la plataforma. */
  email: text('email').notNull().unique(),
  /** Hash bcrypt. NUNCA sale por HTTP: ver publicUser() en domain/users.ts. */
  password_hash: text('password_hash').notNull(),
  status: text('status', { enum: userStatus }).notNull().default('active'),
  email_verified_at: text('email_verified_at'),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Organizaciones: el cliente que paga. Un usuario puede estar en varias.
// ─────────────────────────────────────────────────────────────────────────────

export const organizationStatus = ['active', 'suspended', 'cancelled'] as const;

export const organizations = sqliteTable('organizations', {
  id: id(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  status: text('status', { enum: organizationStatus }).notNull().default('active'),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

export const roles = ['owner', 'admin', 'member'] as const;

export const memberships = sqliteTable('memberships', {
  id: id(),
  user_id: userCol(),
  organization_id: orgCol(),
  role: text('role', { enum: roles }).notNull().default('member'),
  created_at: ts('created_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Catálogo de productos: lo que existe, lo que cuesta y si se puede contratar.
// ─────────────────────────────────────────────────────────────────────────────

export const billingPeriods = ['monthly', 'yearly', 'one_time'] as const;
export const productStatus = ['active', 'inactive'] as const;

export const products = sqliteTable('products', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  /** Precio en la unidad minima de `currency` (CLP sin decimales). */
  price: integer('price').notNull().default(0),
  currency: text('currency').notNull().default('CLP'),
  billing_period: text('billing_period', { enum: billingPeriods }).notNull().default('monthly'),
  status: text('status', { enum: productStatus }).notNull().default('active'),
  /** Subdominio del mini-SaaS. Es el destino del SSO de este producto. */
  app_url: text('app_url'),
  /** Etiqueta corta para la tarjeta de "Mis aplicaciones". */
  tagline: text('tagline'),
  sort_order: integer('sort_order').notNull().default(0),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Suscripciones: la fuente de verdad COMERCIAL del acceso. La identidad la dice
// sessions; el permiso para entrar a un producto, esta tabla.
// ─────────────────────────────────────────────────────────────────────────────

export const subscriptionStatus = ['pending', 'active', 'cancelled', 'expired', 'past_due'] as const;
export const billingProviders = ['manual', 'transfer', 'stripe', 'webpay', 'mercadopago'] as const;

export const subscriptions = sqliteTable('subscriptions', {
  id: id(),
  organization_id: orgCol(),
  product_id: productCol(),
  status: text('status', { enum: subscriptionStatus }).notNull().default('pending'),
  provider: text('provider', { enum: billingProviders }).notNull().default('manual'),
  /**
   * Periodo CONTRATADO (mensual o anual), no el del producto: es lo que decide
   * cuantos dias dura el acceso al confirmar el pago. Se congela al crear el
   * checkout para que la confirmacion no tenga que (ni pueda) re-deducirlo.
   */
  billing_period: text('billing_period', { enum: billingPeriods }).notNull().default('monthly'),
  provider_subscription_id: text('provider_subscription_id'),
  started_at: text('started_at'),
  current_period_start: text('current_period_start'),
  current_period_end: text('current_period_end'),
  cancelled_at: text('cancelled_at'),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

/**
 * Pagos de las SUSCRIPCIONES AMG. Nada que ver con el dinero que un mini-SaaS le
 * cobra a sus clientes: ese dinero no pasa por acá.
 */
export const paymentStatus = ['pending', 'paid', 'failed', 'refunded'] as const;

export const payments = sqliteTable('payments', {
  id: id(),
  organization_id: orgCol(),
  subscription_id: text('subscription_id').references(() => subscriptions.id, { onDelete: 'set null' }),
  product_id: text('product_id').references(() => products.id, { onDelete: 'set null' }),
  /** Lo que se cobró de verdad, ya con descuento aplicado. Es el monto oficial. */
  amount: integer('amount').notNull().default(0),
  /** Precio de catálogo ANTES del descuento. `null` = no hubo descuento. */
  original_amount: integer('original_amount'),
  /** Rebaja en la unidad mínima de `currency`. 0 cuando no hubo descuento. */
  discount_amount: integer('discount_amount').notNull().default(0),
  /** Código de cupón aplicado. Se guarda desnormalizado para poder auditar. */
  discount_code: text('discount_code'),
  currency: text('currency').notNull().default('CLP'),
  status: text('status', { enum: paymentStatus }).notNull().default('pending'),
  provider: text('provider', { enum: billingProviders }).notNull().default('manual'),
  provider_reference: text('provider_reference'),
  paid_at: text('paid_at'),
  created_at: ts('created_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Descuentos: cupones que el cliente ingresa al contratar. Tres clases —
// porcentaje, monto fijo y prueba gratis (días)— porque son las que se usan de
// verdad en promociones; un descuento sin tope ni vigencia es una fuga de
// dinero, así que ambos son parte del modelo y no un añadido posterior.
//
// El cupón NO decide el acceso: rebaja el monto que se congela en `payments`.
// El producto se abre con el pago confirmado como cualquier otro. La única
// excepción es la prueba gratis / 100% off, que no pasa por la pasarela y se
// activa por un camino `promo` explícito y auditable.
// ─────────────────────────────────────────────────────────────────────────────

export const discountKinds = ['percent', 'fixed', 'trial'] as const;
export const discountStatus = ['active', 'disabled'] as const;
export const discountRedemptionStatus = ['reserved', 'used', 'released'] as const;

export const discounts = sqliteTable('discounts', {
  id: id(),
  /** Código que escribe el cliente. Normalizado en MAYÚSCULAS y sin espacios. */
  code: text('code').notNull().unique(),
  kind: text('kind', { enum: discountKinds }).notNull(),
  /**
   * Interpretación según `kind`:
   *   percent → 1..100 (porcentaje a rebajar)
   *   fixed   → monto en la unidad mínima de `currency`
   *   trial   → días de acceso gratis (el monto cobrado pasa a 0)
   */
  value: integer('value').notNull(),
  currency: text('currency').notNull().default('CLP'),
  /** Restringe el cupón a un producto (slug). `null` = sirve para cualquiera. */
  product_slug: text('product_slug'),
  /** Tope TOTAL de canjes. `null` = sin tope. */
  max_redemptions: integer('max_redemptions'),
  /** Tope de canjes por organización. `null` = sin tope. */
  per_org_limit: integer('per_org_limit'),
  starts_at: text('starts_at'),
  ends_at: text('ends_at'),
  status: text('status', { enum: discountStatus }).notNull().default('active'),
  /** Nota interna de ops: para qué campaña salió este cupón. */
  note: text('note'),
  created_by: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

export const discountRedemptions = sqliteTable('discount_redemptions', {
  id: id(),
  discount_id: text('discount_id').notNull().references(() => discounts.id, { onDelete: 'cascade' }),
  organization_id: orgCol(),
  /** El pago al que quedó atado el canje. `null` mientras no exista pago. */
  payment_id: text('payment_id').references(() => payments.id, { onDelete: 'set null' }),
  code: text('code').notNull(),
  kind: text('kind', { enum: discountKinds }).notNull(),
  amount_before: integer('amount_before').notNull(),
  amount_after: integer('amount_after').notNull(),
  /** `reserved` retiene el cupo; `used` ya se cobró; `released` lo devolvió. */
  status: text('status', { enum: discountRedemptionStatus }).notNull().default('reserved'),
  created_at: ts('created_at'),
  used_at: text('used_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Sesiones centrales. Cookie opaca + registro en la base: por eso se puede
// revocar de verdad (un JWT solo se puede "revocar" cambiándole la clave).
// ─────────────────────────────────────────────────────────────────────────────

export const sessionStatus = ['active', 'revoked', 'expired'] as const;

export const sessions = sqliteTable('sessions', {
  id: id(),
  user_id: userCol(),
  /** Organización que el usuario está operando en esta sesión (puede cambiar). */
  active_organization_id: text('active_organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  /** HMAC-SHA256 del secreto de la cookie. El secreto en claro NUNCA se guarda. */
  token_hash: text('token_hash').notNull(),
  status: text('status', { enum: sessionStatus }).notNull().default('active'),
  ip: text('ip'),
  user_agent: text('user_agent'),
  created_at: ts('created_at'),
  last_seen_at: ts('last_seen_at'),
  expires_at: text('expires_at').notNull(),
  revoked_at: text('revoked_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Tokens de un solo uso: recuperar contrasena, verificar email, invitar a la
// organización. Misma forma que el código SSO: hash + vencimiento + usado.
// ─────────────────────────────────────────────────────────────────────────────

export const oneTimeStatus = ['pending', 'used', 'expired'] as const;

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: id(),
  user_id: userCol(),
  token_hash: text('token_hash').notNull().unique(),
  status: text('status', { enum: oneTimeStatus }).notNull().default('pending'),
  requested_ip: text('requested_ip'),
  created_at: ts('created_at'),
  expires_at: text('expires_at').notNull(),
  used_at: text('used_at'),
});

export const emailVerificationTokens = sqliteTable('email_verification_tokens', {
  id: id(),
  user_id: userCol(),
  email: text('email').notNull(),
  token_hash: text('token_hash').notNull().unique(),
  status: text('status', { enum: oneTimeStatus }).notNull().default('pending'),
  created_at: ts('created_at'),
  expires_at: text('expires_at').notNull(),
  used_at: text('used_at'),
});

export const organizationInvitations = sqliteTable('organization_invitations', {
  id: id(),
  organization_id: orgCol(),
  email: text('email').notNull(),
  role: text('role', { enum: roles }).notNull().default('member'),
  token_hash: text('token_hash').notNull().unique(),
  status: text('status', { enum: oneTimeStatus }).notNull().default('pending'),
  invited_by: text('invited_by').references(() => users.id, { onDelete: 'set null' }),
  created_at: ts('created_at'),
  expires_at: text('expires_at').notNull(),
  accepted_at: text('accepted_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// SSO. Un cliente = un producto. El secreto se deriva con HKDF de la raiz de la
// plataforma y vive en la base; el producto lo tiene en su .env. Por eso un
// token de inventario NO vale en cotizaciones: firma distinta y `aud` distinta.
// ─────────────────────────────────────────────────────────────────────────────

export const ssoClientStatus = ['active', 'disabled'] as const;

export const ssoClients = sqliteTable('sso_clients', {
  id: id(),
  /** Identificador del cliente OAuth. Por convencion = slug del producto. */
  client_id: text('client_id').notNull().unique(),
  name: text('name').notNull(),
  secret: text('secret').notNull(),
  /** Lista JSON de redirect_uri permitidas. Empty = se usa app_url del producto. */
  redirect_uris: text('redirect_uris').notNull().default('[]'),
  logout_redirect_uris: text('logout_redirect_uris').notNull().default('[]'),
  status: text('status', { enum: ssoClientStatus }).notNull().default('active'),
  created_at: ts('created_at'),
  updated_at: ts('updated_at'),
});

export const ssoCodeStatus = ['pending', 'used', 'expired', 'denied'] as const;

export const ssoCodes = sqliteTable('sso_codes', {
  id: id(),
  code_hash: text('code_hash').notNull().unique(),
  client_id: text('client_id').notNull(),
  user_id: userCol(),
  organization_id: orgCol(),
  role: text('role', { enum: roles }).notNull(),
  redirect_uri: text('redirect_uri').notNull(),
  return_url: text('return_url'),
  session_id: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  status: text('status', { enum: ssoCodeStatus }).notNull().default('pending'),
  created_at: ts('created_at'),
  expires_at: text('expires_at').notNull(),
  used_at: text('used_at'),
});

// ─────────────────────────────────────────────────────────────────────────────
// Auditoría: quién hizo qué. Sin datos de negocio, solo plataforma.
// ─────────────────────────────────────────────────────────────────────────────

export const auditLog = sqliteTable('audit_log', {
  id: id(),
  actor_user_id: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  organization_id: text('organization_id').references(() => organizations.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  target: text('target'),
  metadata: text('metadata'),
  ip: text('ip'),
  created_at: ts('created_at'),
});

export const nowSql = sql`strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

export const schema = {
  users,
  organizations,
  memberships,
  products,
  subscriptions,
  payments,
  discounts,
  discountRedemptions,
  sessions,
  passwordResetTokens,
  emailVerificationTokens,
  organizationInvitations,
  ssoClients,
  ssoCodes,
  auditLog,
  userStatus,
  organizationStatus,
  roles,
  billingPeriods,
  productStatus,
  subscriptionStatus,
  billingProviders,
  paymentStatus,
  discountKinds,
  discountStatus,
  discountRedemptionStatus,
  sessionStatus,
  oneTimeStatus,
  ssoClientStatus,
  ssoCodeStatus,
};
