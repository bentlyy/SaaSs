import { Router } from 'express';
import { asyncHandler } from '@saas-mini/core';
import { listProducts, publicProduct, requireProductBySlug } from '../domain/products.js';

/**
 * Catálogo público. No requiere sesión: la landing y la página de precios leen
 * de acá, y el precio es información de venta, no un secreto.
 */
export const productsRouter = Router();

productsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const products = listProducts().map(publicProduct);
    return res.json({
      products,
      prices: {
        monthly: products.filter((p) => p.billing_period === 'monthly').map((p) => p.price),
        currency: products[0]?.currency ?? 'CLP',
      },
    });
  }),
);

productsRouter.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const product = requireProductBySlug(req.params.slug);
    if (product.status !== 'active') {
      return res.status(404).json({ error: 'Ese producto no está disponible' });
    }
    return res.json({ product: publicProduct(product) });
  }),
);
