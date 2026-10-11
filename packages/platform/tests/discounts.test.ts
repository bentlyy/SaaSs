import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@saas-mini/core';
import { confirmCheckout, startCheckout } from '../src/billing/checkout.js';
import { registrarProveedor } from '../src/billing/index.js';
import type {
  BillingProvider,
  CheckoutRequest,
  CheckoutResult,
  PaymentConfirmation,
} from '../src/billing/types.js';
import {
  backUrls,
  parseMercadoPagoNotification,
  verifyMercadoPagoSignature,
} from '../src/billing/mercadopago.js';
import { register } from '../src/auth/service.js';
import { getCoreDb } from '../src/db/init.js';
import { schema } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  createDiscount,
  countRedemptions,
  findDiscountByCode,
  quoteDiscount,
  reserveRedemption,
  setDiscountStatus,
} from '../src/domain/discounts.js';
import { listPayments, productAccess } from '../src/domain/subscriptions.js';
import { seedCatalog } from '../src/seed.js';

const PASSWORD = 'UnaClaveLarga1';
const SLUG = 'inventario';
const OTRO_SLUG = 'taller';
const RETURN_URL = 'https://amgdeveloper.cl/mi-cuenta';

let contador = 0;

class PasarelaFalsa implements BillingProvider {
  readonly name = 'transfer' as const;
  creados = 0;
  async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
    this.creados += 1;
    return { provider: this.name, providerReference: 'ref-falsa', checkoutUrl: 'https://pago.example/falsa' };
  }
  async confirmPayment(_ref: string): Promise<PaymentConfirmation> {
    throw new AppError(500, 'La pasarela no decide acceso, solo confirma');
  }
}

class Confirmadora implements BillingProvider {
  readonly name = 'transfer' as const;
  constructor(private readonly monto: number) {}
  async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
    return { provider: this.name, providerReference: 'ref-confirmacion', checkoutUrl: 'https://pago.example/x' };
  }
  async confirmPayment(reference: string): Promise<PaymentConfirmation> {
    return { provider: this.name, providerReference: reference, amount: this.monto, currency: 'CLP', paidAt: new Date().toISOString() };
  }
}

class PasarelaQueFalla implements BillingProvider {
  readonly name = 'transfer' as const;
  async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
    throw new AppError(502, 'La pasarela se cayó');
  }
  async confirmPayment(_ref: string): Promise<PaymentConfirmation> {
    throw new AppError(502, 'La pasarela se cayó');
  }
}

beforeEach(() => {
  const { db } = getCoreDb();
  db.delete(schema.discountRedemptions).run();
  db.delete(schema.discounts).run();
  db.delete(schema.payments).run();
  db.delete(schema.subscriptions).run();
  db.delete(schema.products).run();
  db.delete(schema.memberships).run();
  db.delete(schema.organizations).run();
  seedCatalog();
});

async function org() {
  contador += 1;
  const r = await register({
    name: 'Ana Pérez',
    email: `ana${contador}@ejemplo.cl`,
    password: PASSWORD,
    organizationName: `Clínica ${contador}`,
    organizationSlug: `clinica-${contador}`,
  });
  return r.organization;
}

function producto(slug = SLUG) {
  const p = getCoreDb().db.select().from(schema.products).where(eq(schema.products.slug, slug)).get();
  if (!p) throw new Error(`el catálogo no tiene ${slug}`);
  return p;
}

function redenciones(organizationId: string, status?: string) {
  const rows = getCoreDb().db.select().from(schema.discountRedemptions)
    .where(eq(schema.discountRedemptions.organization_id, organizationId)).all();
  return status ? rows.filter((r) => r.status === status) : rows;
}

function usar(p: BillingProvider): void {
  registrarProveedor('transfer', () => p);
}

describe('cotización de cupones', () => {
  it('un porcentaje rebaja el precio sin quemar el cupo', async () => {
    const o = await org();
    const p = createDiscount({ code: 'amigo50', kind: 'percent', value: 50, productSlug: SLUG, maxRedemptions: 10 });

    const cotizacion = quoteDiscount({ code: 'amigo50', product: producto(), organizationId: o.id, amount: 9000 });

    expect(cotizacion.code).toBe('AMIGO50');
    expect(cotizacion.amountBefore).toBe(9000);
    expect(cotizacion.discountAmount).toBe(4500);
    expect(cotizacion.amountAfter).toBe(4500);
    expect(cotizacion.free).toBe(false);
    expect(cotizacion.trialDays).toBe(0);
    expect(countRedemptions(p.id)).toBe(0);
  });

  it('un cupón de prueba gratis rompe a cero (free)', async () => {
    const o = await org();
    createDiscount({ code: 'TRIAL7', kind: 'trial', value: 7 });

    const c = quoteDiscount({ code: 'trial7', product: producto(), organizationId: o.id, amount: 9000 });

    expect(c.free).toBe(true);
    expect(c.amountAfter).toBe(0);
    expect(c.trialDays).toBe(7);
  });

  it('un código que no existe da 404', async () => {
    const o = await org();
    expect(() => quoteDiscount({ code: 'NADA', product: producto(), organizationId: o.id, amount: 9000 }))
      .toThrow(/no existe/);
  });

  it('un cupón deshabilitado da 409', async () => {
    const o = await org();
    createDiscount({ code: 'OFF', kind: 'percent', value: 10 });
    setDiscountStatus('off', 'disabled');
    expect(() => quoteDiscount({ code: 'OFF', product: producto(), organizationId: o.id, amount: 9000 }))
      .toThrow(/no está disponible/);
  });

  it('un cupón vencido da 409', async () => {
    const o = await org();
    createDiscount({ code: 'VENCIO', kind: 'percent', value: 10, endsAt: '2020-01-01T00:00:00Z' });
    expect(() => quoteDiscount({ code: 'VENCIO', product: producto(), organizationId: o.id, amount: 9000 }))
      .toThrow(/no está vigente/);
  });

  it('un cupón de otro producto da 409', async () => {
    const o = await org();
    createDiscount({ code: 'SOLOPARA', kind: 'percent', value: 10, productSlug: OTRO_SLUG });
    expect(() => quoteDiscount({ code: 'SOLOPARA', product: producto(SLUG), organizationId: o.id, amount: 9000 }))
      .toThrow(/SOLOPARA|sirve solo para/);
  });

  it('un cupón con el tope total agotado da 409', async () => {
    const o = await org();
    createDiscount({ code: 'AGOTADO', kind: 'percent', value: 10, maxRedemptions: 0 });
    expect(() => quoteDiscount({ code: 'AGOTADO', product: producto(), organizationId: o.id, amount: 9000 }))
      .toThrow(/límite de usos/);
  });
});

describe('reserva y consumo del cupo en el checkout', () => {
  it('deja el pago pendiente con el monto rebajado congelado y la redención reservada', async () => {
    usar(new PasarelaFalsa());
    const o = await org();
    createDiscount({ code: 'amigo50', kind: 'percent', value: 50, productSlug: SLUG });

    const sesion = await startCheckout({
      organizationId: o.id,
      productId: producto().id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
      discountCode: 'amigo50',
    });

    expect(sesion.payment.status).toBe('pending');
    expect(sesion.payment.amount).toBe(4500);
    expect(sesion.payment.original_amount).toBe(9000);
    expect(sesion.payment.discount_amount).toBe(4500);
    expect(sesion.payment.discount_code).toBe('AMIGO50');
    expect(sesion.discount?.code).toBe('AMIGO50');

    const red = redenciones(o.id, 'reserved');
    expect(red).toHaveLength(1);
    expect(red[0].payment_id).toBe(sesion.payment.id);
    expect(red[0].amount_before).toBe(9000);
    expect(red[0].amount_after).toBe(4500);
  });

  it('un código inválido no crea suscripción ni pago', async () => {
    usar(new PasarelaFalsa());
    const o = await org();

    await expect(
      startCheckout({
        organizationId: o.id,
        productId: producto().id,
        provider: 'transfer',
        returnUrl: RETURN_URL,
        discountCode: 'INEXISTENTE',
      }),
    ).rejects.toThrow(/no existe/);

    expect(getCoreDb().db.select().from(schema.subscriptions).all()).toHaveLength(0);
    expect(getCoreDb().db.select().from(schema.payments).all()).toHaveLength(0);
    expect(colgado(o.id)).toBe(0);
  });

  it('si la pasarela falla, el cupo reservado se libera y no queda nada colgado', async () => {
    usar(new PasarelaQueFalla());
    const o = await org();
    const d = createDiscount({ code: 'amigo50', kind: 'percent', value: 50, productSlug: SLUG });

    await expect(
      startCheckout({
        organizationId: o.id,
        productId: producto().id,
        provider: 'transfer',
        returnUrl: RETURN_URL,
        discountCode: 'amigo50',
      }),
    ).rejects.toThrow(/se cayó/);

    expect(countRedemptions(d.id)).toBe(0);
    // La suscripción pendiente se cancela (no se borra): queda la huella, sin cobro.
    const subs = getCoreDb().db.select().from(schema.subscriptions).all();
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe('cancelled');
    expect(getCoreDb().db.select().from(schema.payments).all()).toHaveLength(0);
  });

  it('la reserva cuenta para el tope por organización', async () => {
    const o = await org();
    const d = createDiscount({ code: 'UNAVEZ', kind: 'percent', value: 10, perOrgLimit: 1 });

    reserveRedemption({ discount: d, organizationId: o.id, amountBefore: 9000, amountAfter: 8100 });
    expect(() =>
      reserveRedemption({ discount: d, organizationId: o.id, amountBefore: 9000, amountAfter: 8100 }),
    ).toThrow(/máximo de veces/);
    expect(colgado(o.id)).toBe(1);
  });

  it('confirmar el pago marca la redención como usada', async () => {
    usar(new Confirmadora(4500));
    const o = await org();
    createDiscount({ code: 'amigo50', kind: 'percent', value: 50, productSlug: SLUG });

    const sesion = await startCheckout({
      organizationId: o.id,
      productId: producto().id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
      discountCode: 'amigo50',
    });
    await confirmCheckout({ provider: 'transfer', providerReference: sesion.payment.provider_reference! });

    const red = redenciones(o.id, 'used');
    expect(red).toHaveLength(1);
    expect(red[0].used_at).toBeTruthy();
    expect(productAccess(o.id, SLUG).allowed).toBe(true);
  });
});

describe('camino promo: no hay nada que cobrar', () => {
  it('un cupón de prueba gratis abre el producto sin llamar a la pasarela', async () => {
    const pasarela = new PasarelaFalsa();
    usar(pasarela);
    const o = await org();
    createDiscount({ code: 'TRIAL7', kind: 'trial', value: 7, productSlug: SLUG });

    const sesion = await startCheckout({
      organizationId: o.id,
      productId: producto().id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
      discountCode: 'TRIAL7',
    });

    expect(sesion.activado).toBe(true);
    expect(sesion.subscription.status).toBe('active');
    expect(pasarela.creados).toBe(0);
    expect(sesion.payment.status).toBe('paid');
    expect(sesion.payment.amount).toBe(0);
    expect(sesion.payment.provider).toBe('manual');
    expect(productAccess(o.id, SLUG).allowed).toBe(true);

    const limite = new Date(sesion.subscription.current_period_end!).getTime();
    const sieteDias = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(limite).toBeGreaterThan(sieteDias - 60_000);
    expect(limite).toBeLessThan(sieteDias + 60_000);

    const red = redenciones(o.id, 'used');
    expect(red).toHaveLength(1);
  });

  it('un 100% off también activa sin pasarela', async () => {
    const pasarela = new PasarelaFalsa();
    usar(pasarela);
    const o = await org();
    createDiscount({ code: 'TOTAL', kind: 'percent', value: 100, productSlug: SLUG });

    const sesion = await startCheckout({
      organizationId: o.id,
      productId: producto().id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
      discountCode: 'TOTAL',
    });

    expect(sesion.activado).toBe(true);
    expect(pasarela.creados).toBe(0);
    expect(productAccess(o.id, SLUG).allowed).toBe(true);
  });

  it('un cupón trial consumido cuenta para el tope total', async () => {
    usar(new PasarelaFalsa());
    const o1 = await org();
    const d = createDiscount({ code: 'TRIAL7', kind: 'trial', value: 7, productSlug: SLUG, maxRedemptions: 1 });

    await startCheckout({
      organizationId: o1.id,
      productId: producto().id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
      discountCode: 'TRIAL7',
    });

    const o2 = await org();
    expect(() => quoteDiscount({ code: 'TRIAL7', product: producto(), organizationId: o2.id, amount: 9000 }))
      .toThrow(/límite de usos/);
    expect(countRedemptions(d.id, o1.id)).toBe(1);
  });
});

describe('firma del webhook de MercadoPago', () => {
  const id = '123456789';
  const requestId = 'req-abc';
  const ts = '1700000000';
  const secreto = 's3cret0';

  function firma(): string {
    const manifest = `id:${id};request-id:${requestId};ts:${ts};`;
    return `ts=${ts},v1=${createHmac('sha256', secreto).update(manifest).digest('hex')}`;
  }

  it('acepta una firma válida', () => {
    expect(verifyMercadoPagoSignature({ dataId: id.toUpperCase(), requestId, signature: firma(), secret: secreto })).toBe(true);
  });

  it('rechaza una firma alterada', () => {
    const falsa = firma().replace('v1=', `v1=${'0'.repeat(64)}`);
    expect(verifyMercadoPagoSignature({ dataId: id, requestId, signature: falsa, secret: secreto })).toBe(false);
  });

  it('rechaza si falta el encabezado o el secreto', () => {
    expect(verifyMercadoPagoSignature({ dataId: id, requestId, signature: undefined, secret: secreto })).toBe(false);
    expect(verifyMercadoPagoSignature({ dataId: id, requestId, signature: firma(), secret: '' })).toBe(false);
  });

  it('parsea la notificación de pago', () => {
    const notif = parseMercadoPagoNotification(JSON.stringify({ type: 'payment', data: { id: '42' } }));
    expect(notif.data?.id).toBe('42');
    expect(() => parseMercadoPagoNotification('no-json')).toThrow(/ilegible/);
  });
});

describe('backUrls', () => {
  it('agrega pago=ok|error|pendiente a la base', () => {
    const urls = backUrls('https://amgdeveloper.cl/mi-cuenta');
    expect(urls.success).toContain('pago=ok');
    expect(urls.failure).toContain('pago=error');
    expect(urls.pending).toContain('pago=pendiente');
    expect(urls.success).toContain('https://amgdeveloper.cl/mi-cuenta');
  });
});

/** Número de redemptions + payments de la org (para afirmar "nada quedó"). */
function colgado(organizationId: string): number {
  return redenciones(organizationId).length + listPayments(organizationId).length;
}