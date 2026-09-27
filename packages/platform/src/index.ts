/**
 * @amg/platform — Core central de AMG.
 *
 * Es lo ÚNICO que guarda contraseñas y lo único que decide si una organización
 * puede entrar a un producto. Los mini-SaaS no tienen usuarios: validan la
 * identidad que el Core les entrega por SSO.
 *
 * Para entrar desde un producto, usá `@amg/auth-client`, no esto directo.
 */

// configuración y arranque
export { logger } from '@saas-mini/core';
export { platformConfig, type PlatformConfig } from './config.js';
export { createPlatformApp, startPlatform, type PlatformAppOptions } from './app.js';
export { getCoreDb, createCoreDb, closeCoreDb, type CoreDb } from './db/index.js';
export { createId } from './db/id.js';

// identidad
export {
  createUser,
  findUserById,
  findUserByEmail,
  publicUser,
  normalizeEmail,
  markEmailVerified,
  setUserStatus,
  type PublicUser,
} from './domain/users.js';
export {
  createOrganization,
  findOrganizationById,
  findOrganizationBySlug,
  updateOrganization,
  listOrganizations,
  uniqueSlug,
  type Organization,
} from './domain/organizations.js';
export {
  createMembership,
  findMembership,
  roleIn,
  listOrganizationsForUser,
  listMembers,
  setMembershipRole,
  removeMembership,
  countOwners,
  type Membership,
  type OrganizationWithRole,
  type OrganizationMember,
} from './domain/memberships.js';
export { atLeast, canManageBilling, canManageOrganization, isRole, ROLE_RANK, type Role } from './domain/roles.js';

// sesiones
export {
  createSession,
  verifySessionToken,
  revokeSession,
  revokeAllSessionsForUser,
  listActiveSessions,
  switchSessionOrganization,
  touchSession,
  pruneExpiredSessions,
  type Session,
  type SessionIdentity,
  type VerifiedSession,
} from './domain/sessions.js';

// autenticación
export {
  register,
  login,
  logout,
  logoutEverywhere,
  requestPasswordReset,
  resetPassword,
  changePassword,
  verifyEmail,
  updateProfile,
  me,
  switchOrganization,
  type AuthResult,
  type MePayload,
} from './auth/service.js';
export { hashPassword, verifyPassword, registerPasswordSchema, passwordSchema } from './auth/passwords.js';
export { sendMail } from './auth/mailer.js';

// catálogo, suscripciones y pagos
export {
  listProducts,
  findProductBySlug,
  findProductById,
  requireProductBySlug,
  upsertProduct,
  setProductStatus,
  publicProduct,
  type Product,
  type PublicProduct,
} from './domain/products.js';
export {
  hasActiveSubscription,
  getOrganizationProducts,
  organizationProductCatalog,
  productAccess,
  assertProductAccess,
  accessMessage,
  createSubscription,
  activateSubscription,
  cancelSubscription,
  grantSubscription,
  expireDueSubscriptions,
  listSubscriptions,
  listPayments,
  createPayment,
  assertCanManageBilling,
  type AccessState,
  type OrganizationProduct,
} from './domain/subscriptions.js';
export { recordAudit, listAudit } from './domain/audit.js';

// SSO
export { authorize, exchangeCode, introspectToken, safeReturnUrl, appendQuery, type TokenResponse } from './sso/service.js';
export { issueProductToken, verifyProductToken, type ProductTokenClaims } from './sso/tokens.js';
export {
  ensureSsoClient,
  findSsoClient,
  listSsoClients,
  rotateSsoClientSecret,
  isRedirectUriAllowed,
  type SsoClientInfo,
} from './sso/registry.js';

// middleware para el propio Core
export {
  authRequired,
  requireRole,
  setSessionCookie,
  clearSessionCookie,
  sessionFromRequest,
} from './http/middleware.js';

// catálogo
export { CATALOG, seedCatalog, ensurePlatformSeed, type CatalogProduct } from './seed.js';
export {
  startCheckout,
  confirmCheckout,
  resumenSuscripcion,
  type StartCheckoutInput,
  type CheckoutSession,
  type ConfirmCheckoutInput,
  type ConfirmCheckoutResult,
} from './billing/checkout.js';
export {
  registrarProveedor,
  obtenerProveedor,
  proveedoresRegistrados,
  TransferProvider,
  StripeProvider,
  type BillingProvider,
  type BillingProviderName,
  type CheckoutRequest,
  type CheckoutResult,
  type PaymentConfirmation,
} from './billing/index.js';
