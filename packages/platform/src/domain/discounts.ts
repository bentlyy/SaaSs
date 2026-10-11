import { and, desc, eq, ne } from 'drizzle-orm';
import { AppError } from '@saas-mini/core';
import { getCoreDb } from '../db/index.js';
import { schema } from '../db/schema.js';
import type { Product } from './products.js';

export type Discount = typeof schema.discounts.$inferSelect;
export type DiscountRedemption = typeof schema.discountRedemptions.$inferSelect;
export type DiscountKind = (typeof schema.discountKinds)[number];

export const DISCOUNT_KINDS = schema.discountKinds;

/**
 * DESCUENTOS
 * ==========
 *
 * Un descuento NO decide quién entra: solo rebaja el monto que se congela en
 * `payments`. El producto se abre con el pago confirmado, igual que sin cupón.
 * Esa regla es la que hace que un cupón mal configurado, en el peor caso, cobre
 * de menos; nunca *fingirá* un pago.
 *
 * La única excepción es el 100% off / prueba gratis: no hay nada que cobrar, así
 * que no pasa por la pasarela. Se activa por el camino `promo`, que deja una
 * redención `used` como rastro. Un "descuento" que activara sin registrar el
 * canje sería un producto regalado sin memoria de por qué.
 *
 * Los topes se controlan por REDENCIÓN, no por resta de contadores: un contador
 * se desincroniza en cuanto una fila se borra, un canje liberado o un pago se
 * cae. Se cuentan las filas y listo.
 */

export function normalizeCode(code: string | undefined | null): string {
  return (code ?? '').trim().toUpperCase().replace(/\s+/g, '');
}

export interface DiscountQuote {
  discount: Discount;
  code: string;
  kind: DiscountKind;
  amountBefore: number;
  discountAmount: number;
  amountAfter: number;
  /** Días de acceso gratis cuando `kind === 'trial'`. */
  trialDays: number;
  /** true cuando no queda nada por cobrar (prueba gratis o 100% off). */
  free: boolean;
}

/** Cálculo puro, sin DB: fácil de probar y sin sorpresas. */
export function applyDiscount(
  discount: Pick<Discount, 'kind' | 'value'>,
  amountBefore: number,
): { discountAmount: number; amountAfter: number; trialDays: number } {
  switch (discount.kind) {
    case 'percent': {
      const pct = Math.min(100, Math.max(0, discount.value));
      const rebaja = Math.floor((amountBefore * pct) / 100);
      return { discountAmount: rebaja, amountAfter: amountBefore - rebaja, trialDays: 0 };
    }
    case 'fixed': {
      const rebaja = Math.min(discount.value, amountBefore);
      return { discountAmount: rebaja, amountAfter: amountBefore - rebaja, trialDays: 0 };
    }
    case 'trial': {
      return { discountAmount: amountBefore, amountAfter: 0, trialDays: Math.max(0, discount.value) };
    }
  }
}

export function findDiscountByCode(code: string): Discount | undefined {
  const normalized = normalizeCode(code);
  if (!normalized) return undefined;
  return getCoreDb().db.select().from(schema.discounts).where(eq(schema.discounts.code, normalized)).get();
}

function withinWindow(discount: Discount, now: Date): boolean {
  if (discount.starts_at && new Date(discount.starts_at).getTime() > now.getTime()) return false;
  if (discount.ends_at && new Date(discount.ends_at).getTime() < now.getTime()) return false;
  return true;
}

/** Cuenta canjes que retienen cupo: todo excepto los liberados. */
export function countRedemptions(discountId: string, organizationId?: string): number {
  const { db } = getCoreDb();
  const rows = db
    .select({ id: schema.discountRedemptions.id })
    .from(schema.discountRedemptions)
    .where(
      organizationId
        ? and(
            eq(schema.discountRedemptions.discount_id, discountId),
            eq(schema.discountRedemptions.organization_id, organizationId),
            ne(schema.discountRedemptions.status, 'released'),
          )
        : and(
            eq(schema.discountRedemptions.discount_id, discountId),
            ne(schema.discountRedemptions.status, 'released'),
          ),
    )
    .all();
  return rows.length;
}

/**
 * Valida un cupón contra una compra concreta y devuelve el precio con rebaja.
 * NO escribe nada: el endpoint de "validar" es solo una cotización. La reserva
 * real ocurre en `reserveRedemption`, al crear el cobro.
 */
export function quoteDiscount(input: {
  code: string;
  product: Product;
  organizationId: string;
  amount: number;
}): DiscountQuote {
  const code = normalizeCode(input.code);
  const discount = findDiscountByCode(code);
  if (!discount) throw new AppError(404, 'Ese código de descuento no existe.');

  if (discount.status !== 'active') throw new AppError(409, 'Ese código de descuento ya no está disponible.');

  const now = new Date();
  if (!withinWindow(discount, now)) {
    throw new AppError(409, 'Ese código de descuento no está vigente.');
  }

  if (discount.product_slug && discount.product_slug !== input.product.slug) {
    throw new AppError(409, `Ese código sirve solo para ${discount.product_slug}, no para ${input.product.slug}.`);
  }

  if (discount.kind === 'fixed' && discount.currency !== input.product.currency) {
    throw new AppError(409, `Ese cupón está en ${discount.currency} y el producto en ${input.product.currency}.`);
  }

  if (discount.kind === 'trial' && discount.value <= 0) {
    throw new AppError(409, 'Ese cupón de prueba gratis no tiene días configurados.');
  }
  if (discount.kind === 'percent' && (discount.value < 1 || discount.value > 100)) {
    throw new AppError(409, 'Ese cupón tiene un porcentaje inválido.');
  }
  if (discount.kind === 'fixed' && discount.value <= 0) {
    throw new AppError(409, 'Ese cupón no tiene un monto válido.');
  }

  if (discount.max_redemptions !== null && countRedemptions(discount.id) >= discount.max_redemptions) {
    throw new AppError(409, 'Ese código de descuento ya alcanzó su límite de usos.');
  }
  if (discount.per_org_limit !== null && countRedemptions(discount.id, input.organizationId) >= discount.per_org_limit) {
    throw new AppError(409, 'Ya usaste este código de descuento el máximo de veces permitido.');
  }

  const { discountAmount, amountAfter, trialDays } = applyDiscount(discount, input.amount);
  return {
    discount,
    code,
    kind: discount.kind,
    amountBefore: input.amount,
    discountAmount,
    amountAfter,
    trialDays,
    free: amountAfter === 0,
  };
}

/**
 * Retiene un cupo del cupón y devuelve la redención. Revalida los topes DENTRO
 * de la transacción para que dos compras simultáneas no se lleven el mismo
 * último cupo.
 */
export function reserveRedemption(input: {
  discount: Discount;
  organizationId: string;
  amountBefore: number;
  amountAfter: number;
}): DiscountRedemption {
  const { db, sqlite } = getCoreDb();

  const ejecutar = sqlite.transaction(() => {
    if (input.discount.max_redemptions !== null) {
      const total = countRedemptions(input.discount.id);
      if (total >= input.discount.max_redemptions) {
        throw new AppError(409, 'Ese código de descuento ya alcanzó su límite de usos.');
      }
    }
    if (input.discount.per_org_limit !== null) {
      const porOrg = countRedemptions(input.discount.id, input.organizationId);
      if (porOrg >= input.discount.per_org_limit) {
        throw new AppError(409, 'Ya usaste este código de descuento el máximo de veces permitido.');
      }
    }
    return db
      .insert(schema.discountRedemptions)
      .values({
        discount_id: input.discount.id,
        organization_id: input.organizationId,
        payment_id: null,
        code: input.discount.code,
        kind: input.discount.kind,
        amount_before: input.amountBefore,
        amount_after: input.amountAfter,
        status: 'reserved',
        created_at: new Date().toISOString(),
        used_at: null,
      })
      .returning()
      .get();
  });

  return ejecutar();
}

export function setRedemptionPayment(redemptionId: string, paymentId: string): void {
  getCoreDb()
    .db.update(schema.discountRedemptions)
    .set({ payment_id: paymentId })
    .where(eq(schema.discountRedemptions.id, redemptionId))
    .run();
}

/** El pago se confirmó: el canje pasa a `used`. Idempotente. */
export function markRedemptionUsedByPayment(paymentId: string): void {
  getCoreDb()
    .db.update(schema.discountRedemptions)
    .set({ status: 'used', used_at: new Date().toISOString() })
    .where(
      and(
        eq(schema.discountRedemptions.payment_id, paymentId),
        eq(schema.discountRedemptions.status, 'reserved'),
      ),
    )
    .run();
}

/** El cobro se cayó: devuelve el cupo. Idempotente. */
export function releaseRedemptionByPayment(paymentId: string): void {
  getCoreDb()
    .db.update(schema.discountRedemptions)
    .set({ status: 'released' })
    .where(
      and(
        eq(schema.discountRedemptions.payment_id, paymentId),
        eq(schema.discountRedemptions.status, 'reserved'),
      ),
    )
    .run();
}

/** Devuelve el cupo cuando el cobro falló antes de tener pago. */
export function releaseRedemption(redemptionId: string): void {
  getCoreDb()
    .db.update(schema.discountRedemptions)
    .set({ status: 'released' })
    .where(
      and(
        eq(schema.discountRedemptions.id, redemptionId),
        eq(schema.discountRedemptions.status, 'reserved'),
      ),
    )
    .run();
}

// ── administración (ops) ─────────────────────────────────────────────────────

export interface CreateDiscountInput {
  code: string;
  kind: DiscountKind;
  value: number;
  currency?: string;
  productSlug?: string | null;
  maxRedemptions?: number | null;
  perOrgLimit?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

export function createDiscount(input: CreateDiscountInput): Discount {
  const code = normalizeCode(input.code);
  if (!code) throw new AppError(400, 'El código no puede estar vacío');
  if (!DISCOUNT_KINDS.includes(input.kind)) throw new AppError(400, 'Tipo de descuento inválido');
  if (!Number.isInteger(input.value) || input.value <= 0) {
    throw new AppError(400, 'El valor del descuento debe ser un entero positivo');
  }
  if (input.kind === 'percent' && input.value > 100) {
    throw new AppError(400, 'Un porcentaje no puede superar 100');
  }
  if (findDiscountByCode(code)) throw new AppError(409, `El código ${code} ya existe`);

  const now = new Date().toISOString();
  return getCoreDb()
    .db.insert(schema.discounts)
    .values({
      code,
      kind: input.kind,
      value: input.value,
      currency: input.currency ?? 'CLP',
      product_slug: input.productSlug ?? null,
      max_redemptions: input.maxRedemptions ?? null,
      per_org_limit: input.perOrgLimit ?? null,
      starts_at: input.startsAt ?? null,
      ends_at: input.endsAt ?? null,
      status: 'active',
      note: input.note ?? null,
      created_by: input.createdBy ?? null,
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
}

export function listDiscounts(): Discount[] {
  return getCoreDb().db.select().from(schema.discounts).orderBy(desc(schema.discounts.created_at)).all();
}

export function setDiscountStatus(code: string, status: (typeof schema.discountStatus)[number]): Discount {
  const existing = findDiscountByCode(code);
  if (!existing) throw new AppError(404, `No existe el cupón ${normalizeCode(code)}`);
  return getCoreDb()
    .db.update(schema.discounts)
    .set({ status, updated_at: new Date().toISOString() })
    .where(eq(schema.discounts.id, existing.id))
    .returning()
    .get();
}
