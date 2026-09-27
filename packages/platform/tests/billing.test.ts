import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@saas-mini/core';
import { confirmCheckout, startCheckout } from '../src/billing/checkout.js';
import { obtenerProveedor, proveedoresRegistrados, registrarProveedor } from '../src/billing/index.js';
import type {
  BillingProvider,
  CheckoutRequest,
  CheckoutResult,
  PaymentConfirmation,
} from '../src/billing/types.js';
import { register } from '../src/auth/service.js';
import { getCoreDb } from '../src/db/init.js';
import { schema } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import {
  activateSubscription,
  currentSubscription,
  listPayments,
  productAccess,
} from '../src/domain/subscriptions.js';
import { seedCatalog } from '../src/seed.js';

const PASSWORD = 'UnaClaveLarga1';
const SLUG = 'inventario';
const RETURN_URL = 'https://amgdeveloper.cl/mi-cuenta';

let contador = 0;

/**
 * DOBLE DE PASARELA QUE NO SE DEJA ENGAÑAR
 * =======================================
 * No es un mock complaciente. Su `confirmPayment` LANZA: si el dominio le
 * preguntara "¿este pago ya se hizo?" en vez de esperar una confirmación, la
 * suite falla. Estos tests cazan justo eso: que el acceso a un producto dependa
 * de la confianza ciega en el proveedor en vez de un pago verificado.
 */
class PasarelaFalsa implements BillingProvider {
  readonly name = 'transfer' as const;
  /** Lo que la pasarela haría si le pidieran decidir el acceso. */
  consultedForAccess = false;

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    return {
      provider: this.name,
      providerReference: 'ref-falsa-1',
      checkoutUrl: 'https://pago.example/checkout/ref-falsa-1',
    };
  }

  async confirmPayment(reference: string): Promise<PaymentConfirmation> {
    this.consultedForAccess = true;
    throw new AppError(500, 'La pasarela no puede decidir el acceso: solo confirmar pagos');
  }
}

beforeEach(() => {
  const { db } = getCoreDb();
  db.delete(schema.payments).run();
  db.delete(schema.subscriptions).run();
  db.delete(schema.products).run();
  db.delete(schema.memberships).run();
  db.delete(schema.organizations).run();
  seedCatalog();
});

async function orgYProducto() {
  contador += 1;
  const r = await register({
    name: 'Ana Pérez',
    email: `ana${contador}@ejemplo.cl`,
    password: PASSWORD,
    organizationName: `Clínica ${contador}`,
    organizationSlug: `clinica-${contador}`,
  });
  const product = getCoreDb()
    .db.select()
    .from(schema.products)
    .where(eq(schema.products.slug, SLUG))
    .get();
  if (!product) throw new Error(`el catálogo no tiene ${SLUG}`);
  return { organization: r.organization, product };
}

function usar(pasarela: BillingProvider): void {
  registrarProveedor('transfer', () => pasarela);
}

describe('cobro paso 1: la intención NO abre el producto', () => {
  it('deja la suscripción pendiente y el acceso cerrado', async () => {
    usar(new PasarelaFalsa());
    const { organization, product } = await orgYProducto();

    const sesion = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });

    expect(sesion.subscription.status).toBe('pending');
    expect(sesion.subscription.started_at).toBeNull();
    expect(sesion.subscription.current_period_end).toBeNull();

    const acceso = productAccess(organization.id, SLUG);
    expect(acceso.allowed).toBe(false);
    expect(acceso.reason).toBe('suscripcion-no-activa');
  });

  it('congela el monto del catálogo en el pago pendiente', async () => {
    usar(new PasarelaFalsa());
    const { organization, product } = await orgYProducto();

    const sesion = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });

    expect(sesion.payment.status).toBe('pending');
    expect(sesion.payment.provider_reference).toBe('ref-falsa-1');
    expect(sesion.payment.amount).toBe(product.price);
    expect(sesion.payment.currency).toBe(product.currency);
    expect(sesion.payment.subscription_id).toBe(sesion.subscription.id);
    expect(sesion.payment.paid_at).toBeNull();
  });

  it('no cobra de nuevo un producto que ya está activo', async () => {
    usar(new PasarelaFalsa());
    const { organization, product } = await orgYProducto();

    await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });
    const sub = currentSubscription(organization.id, product.id)!;
    activateSubscription(sub.id, new Date(Date.now() + 86_400_000).toISOString());

    await expect(
      startCheckout({
        organizationId: organization.id,
        productId: product.id,
        provider: 'transfer',
        returnUrl: RETURN_URL,
      }),
    ).rejects.toThrow(/ya tienes/i);

    // Y no se creó un segundo cobro.
    expect(listPayments(organization.id)).toHaveLength(1);
  });
});

describe('cobro paso 2: la confirmación SÍ abre el producto', () => {
  it('activa la suscripción y da acceso hasta el fin del periodo', async () => {
    // Pasarela honesta: confirma sin inventing un monto.
    class TransferHonesta implements BillingProvider {
      readonly name = 'transfer' as const;
      async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
        return { provider: this.name, providerReference: 'ref-honesta-1', instructions: 'Transfiere a...' };
      }
      async confirmPayment(reference: string): Promise<PaymentConfirmation> {
        return { provider: this.name, providerReference: reference, paidAt: new Date().toISOString() };
      }
    }
    usar(new TransferHonesta());
    const { organization, product } = await orgYProducto();

    const sesion = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });

    const resultado = await confirmCheckout({
      provider: 'transfer',
      providerReference: sesion.payment.provider_reference!,
    });

    expect(resultado.yaConfirmado).toBe(false);
    expect(resultado.subscription.status).toBe('active');
    expect(resultado.subscription.started_at).toBeTruthy();
    expect(resultado.subscription.current_period_end).toBeTruthy();
    expect(new Date(resultado.subscription.current_period_end!).getTime()).toBeGreaterThan(Date.now());
    expect(resultado.payment.status).toBe('paid');

    expect(productAccess(organization.id, SLUG).allowed).toBe(true);
  });

  it('es idempotente: el reintento de webhook no regala otro periodo', async () => {
    class TransferHonesta implements BillingProvider {
      readonly name = 'transfer' as const;
      async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
        return { provider: this.name, providerReference: 'ref-idem' };
      }
      async confirmPayment(reference: string): Promise<PaymentConfirmation> {
        return { provider: this.name, providerReference: reference, paidAt: new Date().toISOString() };
      }
    }
    usar(new TransferHonesta());
    const { organization, product } = await orgYProducto();

    const sesion = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });
    const ref = sesion.payment.provider_reference!;

    const primero = await confirmCheckout({ provider: 'transfer', providerReference: ref });
    const segundo = await confirmCheckout({ provider: 'transfer', providerReference: ref });

    expect(segundo.yaConfirmado).toBe(true);
    expect(segundo.subscription.current_period_end).toBe(primero.subscription.current_period_end);
    expect(segundo.payment.created_at).toBe(primero.payment.created_at);
  });

  it('el reintento no vuelve a preguntar a la pasarela', async () => {
    const honesta = new (class implements BillingProvider {
      readonly name = 'transfer' as const;
      llamadas = 0;
      async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
        return { provider: this.name, providerReference: 'ref-1' };
      }
      async confirmPayment(reference: string): Promise<PaymentConfirmation> {
        this.llamadas += 1;
        return { provider: this.name, providerReference: reference, paidAt: new Date().toISOString() };
      }
    })();
    usar(honesta);
    const { organization, product } = await orgYProducto();

    const sesion = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });
    const ref = sesion.payment.provider_reference!;
    await confirmCheckout({ provider: 'transfer', providerReference: ref });
    await confirmCheckout({ provider: 'transfer', providerReference: ref });

    // La segunda vez se resuelve con lo que ya sabemos. Si se volviera a
    // preguntar y la pasarela ya hubiera purgado el evento, el cliente
    // estaría pagando sin acceso.
    expect(honesta.llamadas).toBe(1);
  });

  it('una referencia que no existe no abre nada', async () => {
    usar(new PasarelaFalsa());
    const { organization, product } = await orgYProducto();

    await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });

    await expect(
      confirmCheckout({ provider: 'transfer', providerReference: 'ref-inventada' }),
    ).rejects.toThrow(/no hay ningún pago pendiente/i);
    expect(productAccess(organization.id, SLUG).allowed).toBe(false);
  });

  it('cobrar una cantidad distinta a la acordada NO activa el producto', async () => {
    const { organization, product } = await orgYProducto();
    const acordado = product.price;

    class PasarelaImpostora implements BillingProvider {
      readonly name = 'transfer' as const;
      async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
        return { provider: this.name, providerReference: 'ref-trampa' };
      }
      async confirmPayment(): Promise<PaymentConfirmation> {
        return {
          provider: this.name,
          providerReference: 'ref-trampa',
          amount: acordado / 2,
          currency: acordado > 0 ? 'CLP' : 'CLP',
          paidAt: new Date().toISOString(),
        };
      }
    }
    usar(new PasarelaImpostora());

    const sesion = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });
    expect(sesion.payment.amount).toBe(acordado);

    await expect(
      confirmCheckout({ provider: 'transfer', providerReference: 'ref-trampa' }),
    ).rejects.toThrow(/no se activa el producto/i);
    expect(productAccess(organization.id, SLUG).allowed).toBe(false);
  });

  it('un pago en otra moneda NO activa el producto', async () => {
    const { organization, product } = await orgYProducto();

    class PasarelaExtranjera implements BillingProvider {
      readonly name = 'transfer' as const;
      async createCheckout(_r: CheckoutRequest): Promise<CheckoutResult> {
        return { provider: this.name, providerReference: 'ref-monda' };
      }
      async confirmPayment(): Promise<PaymentConfirmation> {
        return {
          provider: this.name,
          providerReference: 'ref-monda',
          currency: 'USD',
          paidAt: new Date().toISOString(),
        };
      }
    }
    usar(new PasarelaExtranjera());

    await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });

    await expect(
      confirmCheckout({ provider: 'transfer', providerReference: 'ref-monda' }),
    ).rejects.toThrow(/no se activa el producto/i);
    expect(productAccess(organization.id, SLUG).allowed).toBe(false);
  });

  it('un proveedor sin pasarela real falla en vez de fingir que cobró', async () => {
    const { organization, product } = await orgYProducto();

    // 'webpay' está permitido en el enum de la base pero no existe adapter. Antes
    // esto pasaba: se escribía provider='webpay', nadie cobraba y el producto
    // quedaba como "contratado". Ahora truena, y sin dejar basura.
    await expect(
      startCheckout({
        organizationId: organization.id,
        productId: product.id,
        provider: 'webpay',
        returnUrl: RETURN_URL,
      }),
    ).rejects.toThrow(/no hay pasarela registrada/i);

    expect(listPayments(organization.id)).toHaveLength(0);
    const sub = currentSubscription(organization.id, product.id);
    expect(sub?.status).not.toBe('active');
  });
});

describe('qué proveedores puede cobrar de verdad', () => {
  it('manual y webpay son etiquetas, no pasarelas', () => {
    // El enum de la base los promete; este test deja por escrito que todavía no
    // cobran. Cuando se implemente webpay, esta expectativa debe cambiar.
    const registrados = proveedoresRegistrados();
    expect(registrados).toContain('transfer');
    expect(registrados).not.toContain('manual');
    expect(registrados).not.toContain('webpay');
    expect(() => obtenerProveedor('manual')).toThrow(/no hay pasarela/i);
  });
});
