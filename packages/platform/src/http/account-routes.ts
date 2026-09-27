import { Router } from 'express';
import { z } from 'zod';
import { AppError, asyncHandler } from '@saas-mini/core';
import { authRequired, requireRole } from './middleware.js';
import {
  getOrganizationProducts,
  listPayments,
  listSubscriptions,
  organizationProductCatalog,
  assertCanManageBilling,
  cancelSubscription,
} from '../domain/subscriptions.js';
import { billingProviders } from '../db/schema.js';
import { startCheckout } from '../billing/checkout.js';
import { platformConfig } from '../config.js';
import { safeReturnUrl } from '../sso/service.js';
import { listProducts, publicProduct, requireProductBySlug } from '../domain/products.js';
import { findOrganizationById, updateOrganization } from '../domain/organizations.js';
import { listMembers } from '../domain/memberships.js';
import { canManageOrganization } from '../domain/roles.js';
import { listAudit } from '../domain/audit.js';
import { findUserById, publicUser } from '../domain/users.js';
import { me } from '../auth/service.js';

/**
 * Rutas de "Mi cuenta" y "Mis aplicaciones".
 *
 * Todo lo que sale de acá está acotado a `req.amg.organizationId`. Ninguna ruta
 * acepta un organizationId del cuerpo o de la query para leer datos: la
 * organización SIEMPRE es la de la sesión. Es la regla que hace imposible que
 * una organización see a otra (ver docs/DATA_ISOLATION.md).
 */
export const accountRouter = Router();

accountRouter.use(authRequired);

accountRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    const catalog = organizationProductCatalog(session.organizationId);
    return res.json({
      ...me(session),
      products: catalog.map((entry) => ({
        ...publicProduct(entry.product),
        access: entry.state,
        contracted: entry.contracted,
      })),
      active: catalog.filter((entry) => entry.contracted).length,
      available: catalog.filter((entry) => !entry.contracted).length,
    });
  }),
);

accountRouter.get(
  '/applications',
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    const catalog = organizationProductCatalog(session.organizationId);
    return res.json({
      organization: session.organization,
      active: catalog.filter((e) => e.contracted).map((e) => ({ ...publicProduct(e.product), access: e.state })),
      available: catalog.filter((e) => !e.contracted).map((e) => ({ ...publicProduct(e.product), access: e.state })),
    });
  }),
);

accountRouter.get(
  '/subscriptions',
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    const products = new Map(listProducts({ includeInactive: true }).map((p) => [p.id, p]));
    const subscriptions = listSubscriptions(session.organizationId).map((row) => ({
      ...row,
      product: products.get(row.product_id) ? publicProduct(products.get(row.product_id)!) : null,
    }));
    return res.json({ subscriptions });
  }),
);

accountRouter.get(
  '/payments',
  requireRole('member'),
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    return res.json({ payments: listPayments(session.organizationId), currency: 'CLP' });
  }),
);

const orgSchema = z.object({ name: z.string().min(2, 'Mínimo 2 caracteres').max(80) });

accountRouter.patch(
  '/organization',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    const input = orgSchema.parse(req.body);
    return res.json({ organization: updateOrganization(session.organizationId, input) });
  }),
);

accountRouter.get(
  '/members',
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    return res.json({ members: listMembers(session.organizationId) });
  }),
);

/**
 * CONTRATAR UN PRODUCTO
 * =====================
 *
 * Este endpoint es el PASO 1 del cobro: deja constancia de la intención y
 * devuelve las instrucciones o el link de pago. NO activa el producto, y esa
 * es toda la gracia: antes esta ruta creaba una suscripción `pending` y
 * respondía "te confirmamos por correo", o sea que el pago dependedía de que
 * alguien lo anotara a mano en la base. Ahora hay una referencia que sí se puede
 * confirmar (y auditar) contra el movimiento bancario.
 *
 * El paso 2 NO está aquí y es deliberado: confirmar es la acción que abre el
 * producto, así que la hace la pasarela (webhook firmado) u ops por CLI. Si este
 * endpoint aceptara una confirmación con la sesión del cliente, un curl podría
 * electrizarse gratis. Ver src/cli/confirm-payment.ts.
 */
const contractSchema = z.object({
  productSlug: z.string().min(1),
  provider: z.enum(billingProviders).default('transfer'),
});

accountRouter.post(
  '/subscriptions',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    assertCanManageBilling(session.role);
    const { productSlug, provider } = contractSchema.parse(req.body);
    const product = requireProductBySlug(productSlug);

    // La vuelta pasa por el MISMO validador de lista blanca que el SSO, no por
    // una concatenación nueva. Si `returnUrl` no está en la lista, la pasarela
    // manda al usuario a un sitio ajeno después de pagar, y eso es un phishing
    // con unwitting de por medio.
    const returnUrl = safeReturnUrl(`${platformConfig.coreUrl}/mi-cuenta.html`);
    if (!returnUrl) {
      throw new AppError(500, `La URL de retorno (${platformConfig.coreUrl}) no está permitida. Revisa CORE_RETURN_URL_HOSTS.`);
    }

    const sesion = await startCheckout({
      organizationId: session.organizationId,
      productId: product.id,
      provider,
      returnUrl,
      customerEmail: findUserById(session.userId)?.email,
    });

    return res.status(201).json({
      ok: true,
      subscription: sesion.subscription,
      payment: sesion.payment,
      checkout: sesion.checkout,
      message: sesion.checkout.checkoutUrl
        ? `Te llevamos a pagar ${product.name}. El acceso se activa apenas se confirme el pago.`
        : sesion.checkout.instructions,
    });
  }),
);

accountRouter.post(
  '/subscriptions/:id/cancel',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    assertCanManageBilling(session.role);
    const owned = listSubscriptions(session.organizationId).find((row) => row.id === req.params.id);
    if (!owned) throw new AppError(404, 'Suscripción no encontrada');
    return res.json({ ok: true, subscription: cancelSubscription(owned.id) });
  }),
);

accountRouter.get(
  '/audit',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    if (!canManageOrganization(session.role)) throw new AppError(403, 'No tienes permiso');
    return res.json({ entries: listAudit({ organizationId: session.organizationId, limit: 50 }) });
  }),
);

accountRouter.get(
  '/organization/:id',
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    if (req.params.id !== session.organizationId) throw new AppError(403, 'No puedes ver otra organización');
    const organization = findOrganizationById(req.params.id);
    if (!organization) throw new AppError(404, 'Organización no encontrada');
    return res.json({ organization });
  }),
);

accountRouter.get(
  '/me/user',
  asyncHandler(async (req, res) => {
    const user = findUserById(req.amg!.userId);
    if (!user) throw new AppError(404, 'Usuario no encontrado');
    return res.json({ user: publicUser(user) });
  }),
);
