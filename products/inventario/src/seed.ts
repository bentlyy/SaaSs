import { eq, sql } from 'drizzle-orm';
import { createId, nowIso, type ProductContext } from '@amg/product-runtime';
import { items } from './schema.js';

/**
 * Datos de ejemplo para desarrollo.
 *
 * Solo entra si la organización no tiene nada. Y la organización nunca se
 * inventa: viene del token (una sesión real del Core), así que un seed no
 * puede fabricar datos de una empresa que no existe. Por eso el seed corre
 * desde `POST /api/seed`, no al arrancar: si no, tendría que inventarse un
 * organization_id.
 */

const DEMO: Array<{ name: string; sku: string; quantity: number; minQuantity: number; unit: string; priceCents: number }> = [
  { name: 'Aceite hidráulico 5W-30 1L', sku: 'ACE-530', quantity: 52, minQuantity: 10, unit: 'pieza', priceCents: 18500 },
  { name: 'Filtro de aire universal', sku: 'FIL-AIR', quantity: 30, minQuantity: 6, unit: 'pieza', priceCents: 12000 },
  { name: 'Filtro de aceite', sku: 'FIL-OIL', quantity: 36, minQuantity: 6, unit: 'pieza', priceCents: 9800 },
  { name: 'Bujía NGK', sku: 'BUJ-NGK', quantity: 8, minQuantity: 20, unit: 'pieza', priceCents: 7900 },
  { name: 'Guante de nitrilo (caja 100)', sku: 'GUA-NIT', quantity: 14, minQuantity: 5, unit: 'caja', priceCents: 15900 },
  { name: 'Refrigerante R134a', sku: 'REF-134', quantity: 3, minQuantity: 4, unit: 'botella', priceCents: 22500 },
];

export function seedDemo(ctx: ProductContext, organizationId: string): number {
  const { db } = ctx.handle;
  const existentes = db
    .select({ n: sql<number>`count(*)` })
    .from(items)
    .where(eq(items.organizationId, organizationId))
    .get();

  if ((existentes?.n ?? 0) > 0) return 0;

  const ahora = nowIso();
  for (const d of DEMO) {
    db.insert(items)
      .values({
        id: createId('itm'),
        organizationId,
        name: d.name,
        sku: d.sku,
        quantity: d.quantity,
        minQuantity: d.minQuantity,
        unit: d.unit,
        priceCents: d.priceCents,
        active: true,
        createdAt: ahora,
      })
      .run();
  }
  return DEMO.length;
}
