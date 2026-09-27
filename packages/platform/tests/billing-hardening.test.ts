import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '@saas-mini/core';
import { confirmCheckout, startCheckout } from '../src/billing/checkout.js';
import { registrarProveedor } from '../src/billing/index.js';
import type { BillingProvider, CheckoutRequest, CheckoutResult, PaymentConfirmation } from '../src/billing/types.js';
import { register } from '../src/auth/service.js';
import { getCoreDb } from '../src/db/init.js';
import { schema } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { currentSubscription, listPayments, markPaymentPaid, productAccess } from '../src/domain/subscriptions.js';
import { seedCatalog } from '../src/seed.js';

/**
 * REGRESIONES DEL COBRO
 * =====================
 *
 * Cada test de aquí nació de un hueco real que se encontró leyendo el flujo, no
 * de una hipótesis. Los cinco se parecían mucho a código correcto: leían bien,
 * pasaban la suite, y fallaban en el momento que un cliente hacía dos clics o
 * una pasarela devolvía una referencia rara.
 *
 * El patrón común: los tres primeros son ESTADO PARCIAL. Un cobro a medias es
 * peor que un cobro fallido, porque el sistema cree que ya sabe lo que pasó y
 * deja de preguntar. El sistema que no sabe, pregunta.
 */

const PASSWORD = 'UnaClaveLarga1';
const SLUG = 'inventario';
const RETURN_URL = 'https://amgdeveloper.cl/mi-cuenta';

let contador = 0;

/** Pasarela mínima y honesta: referencia propia, confirmación sin inventar montos. */
class Pasarela implements BillingProvider {
  readonly name = 'transfer' as const;
  /** Se puede romper a propósito para probar el fallo de la pasarela. */
  fallaAlAbrir = false;
  /** Referencia que devuelve al confirmar; sirve para simular cruces. */
  referenciaAlConfirmar: string | null = null;
  llamadasAlAbrir = 0;
  private contador = 0;

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    this.llamadasAlAbrir += 1;
    if (this.fallaAlAbrir) throw new AppError(503, 'La pasarela no está disponible');
    this.contador += 1;
    return {
      provider: this.name,
      providerReference: `tr-test-${this.contador}`,
      instructions: `Transfiere con la referencia tr-test-${this.contador}`,
    };
  }

  async confirmPayment(reference: string): Promise<PaymentConfirmation> {
    return {
      provider: this.name,
      providerReference: this.referenciaAlConfirmar ?? reference,
      paidAt: new Date().toISOString(),
    };
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
  const product = getCoreDb().db.select().from(schema.products).where(eq(schema.products.slug, SLUG)).get();
  if (!product) throw new Error(`el catálogo no tiene ${SLUG}`);
  return { organization: r.organization, product };
}

function usar(pasarela: BillingProvider): void {
  registrarProveedor('transfer', () => pasarela);
}

async function cobrar(pasarela: Pasarela) {
  usar(pasarela);
  const { organization, product } = await orgYProducto();
  const sesion = await startCheckout({
    organizationId: organization.id,
    productId: product.id,
    provider: 'transfer',
    returnUrl: RETURN_URL,
  });
  return { organization, product, sesion };
}

describe('hueco 1: una pasarela inexistente no deja suscripciones a medias', () => {
  it('no escribe nada cuando la pasarela no está registrada', async () => {
    const { organization, product } = await orgYProducto();

    await expect(startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'webpay', // registrado en el enum, no en el registro de pasarelas
      returnUrl: RETURN_URL,
    })).rejects.toThrow(AppError);

    // Lo que se comprueba es la BASE, no el error: un 501 correcto con una
    // suscripcion `pending` colgada es el bug, no la solución.
    const { db } = getCoreDb();
    expect(db.select().from(schema.subscriptions).all()).toHaveLength(0);
    expect(db.select().from(schema.payments).all()).toHaveLength(0);
  });

  it('reintentar tampoco acumula basura', async () => {
    const { organization, product } = await orgYProducto();
    const intentar = () => startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'webpay',
      returnUrl: RETURN_URL,
    });

    await expect(intentar()).rejects.toThrow();
    await expect(intentar()).rejects.toThrow();
    await expect(intentar()).rejects.toThrow();

    expect(getCoreDb().db.select().from(schema.subscriptions).all()).toHaveLength(0);
  });
});

describe('hueco 2: el doble clic no cobra dos veces', () => {
  it('el segundo intento se rechaza y nombra la referencia viva', async () => {
    const pasarela = new Pasarela();
    const { organization, product, sesion } = await cobrar(pasarela);

    await expect(startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    })).rejects.toThrow(/tr-test-1/);

    // Una sola pasarela llamada, un solo pago: la referencia sigue siendo la
    // primera, no una segunda que el cliente no conoce.
    expect(pasarela.llamadasAlAbrir).toBe(1);
    expect(listPayments(organization.id)).toHaveLength(1);
    expect(listPayments(organization.id)[0].provider_reference).toBe(sesion.payment.provider_reference);
  });

  it('el rechazo menciona la referencia, para que soporte y UI puedan actuar', async () => {
    const pasarela = new Pasarela();
    const { organization, product } = await cobrar(pasarela);

    const error = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    }).catch((e: unknown) => e as AppError);

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(409);
    expect(error.message).toContain('tr-test-1');
  });
});

describe('hueco 3: si la pasarela falla, no queda una suscripción que no se puede pagar', () => {
  it('cancela la suscripción pendiente y permite reintentar', async () => {
    const pasarela = new Pasarela();
    pasarela.fallaAlAbrir = true;
    usar(pasarela);
    const { organization, product } = await orgYProducto();
    const intentar = () => startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });

    await expect(intentar()).rejects.toThrow(/no está disponible/);

    // La fila existe pero cancelada: el siguiente intento no choca con un
    // pendiente imposible de pagar.
    const tras = currentSubscription(organization.id, product.id);
    expect(tras?.status).toBe('cancelled');
    expect(listPayments(organization.id)).toHaveLength(0);

    pasarela.fallaAlAbrir = false;
    const reintento = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });
    expect(reintento.subscription.status).toBe('pending');
    expect(listPayments(organization.id)).toHaveLength(1);
  });
});

describe('hueco 4: una suscripción vencida se puede volver a contratar', () => {
  it('una suscripción activa con el periodo vencido no bloquea el cobro', async () => {
    const pasarela = new Pasarela();
    const { organization, product, sesion } = await cobrar(pasarela);

    // Se simula el paso del tiempo: la suscripción queda activa pero con el
    // periodo vencido hace un mes. Es lo que deja `expireDueSubscriptions()`
    // cuando nadie corre el job.
    const { db } = getCoreDb();
    const vencido = new Date(Date.now() - 30 * 86_400_000).toISOString();
    db.update(schema.subscriptions)
      .set({ status: 'active', current_period_end: vencido })
      .where(eq(schema.subscriptions.id, sesion.subscription.id))
      .run();

    expect(currentSubscription(organization.id, product.id)?.status).toBe('active');

    // Con el chequeo viejo (solo `status`) esto daba 409 y el cliente no podia
    // volver a contratar nunca, sin que el mensaje explicara por qué.
    db.update(schema.payments).set({ status: 'failed' }).where(eq(schema.payments.id, sesion.payment.id)).run();

    const nuevo = await startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    });
    expect(nuevo.subscription.status).toBe('pending');
  });

  it('una suscripción vigente sí bloquea, con mensaje de "ya lo tienes"', async () => {
    const pasarela = new Pasarela();
    const { organization, product, sesion } = await cobrar(pasarela);

    await confirmCheckout({ provider: 'transfer', providerReference: sesion.payment.provider_reference });

    await expect(startCheckout({
      organizationId: organization.id,
      productId: product.id,
      provider: 'transfer',
      returnUrl: RETURN_URL,
    })).rejects.toThrow(/Ya tienes/);
  });
});

describe('hueco 5: la confirmación tiene que ser de este pago', () => {
  it('una referencia de confirmación distinta a la pedida no abre el producto', async () => {
    const pasarela = new Pasarela();
    const { organization, product, sesion } = await cobrar(pasarela);

    // La pasarela responde por OTRO pago. Si el dominio no compara la
    // referencia, cobraría el monto de un cobro con la referencia de otro.
    pasarela.referenciaAlConfirmar = 'tr-otro-cobro';

    await expect(confirmCheckout({
      provider: 'transfer',
      providerReference: sesion.payment.provider_reference,
    })).rejects.toThrow(/No se activa el producto/);

    expect(productAccess(organization.id, SLUG).allowed).toBe(false);
    const { db } = getCoreDb();
    expect(db.select().from(schema.payments).get()?.status).toBe('pending');
    expect(currentSubscription(organization.id, product.id)?.status).toBe('pending');
  });

  it('una confirmation de otra pasarela no abre el producto', async () => {
    const pasarela = new Pasarela();
    const { organization, sesion } = await cobrar(pasarela);

    class PasarelaImpostora extends Pasarela {
      override readonly name = 'transfer' as const;
      async confirmPayment(reference: string): Promise<PaymentConfirmation> {
        return { provider: 'stripe', providerReference: reference, paidAt: new Date().toISOString() };
      }
    }
    // Se registra con el mismo nombre de registro pero responde `stripe`: es el
    // caso de un adaptador mal mapeado, no de un atacante.
    registrarProveedor('transfer', () => new PasarelaImpostora());

    await expect(confirmCheckout({
      provider: 'transfer',
      providerReference: sesion.payment.provider_reference,
    })).rejects.toThrow(/No se activa el producto/);

    expect(getCoreDb().db.select().from(schema.payments).get()?.status).toBe('pending');
  });
});

describe('hueco 6: pagado sin producto abierto se repara, no se ignora', () => {
  it('una confirmación reintenta la apertura si la suscripción quedó pendiente', async () => {
    const pasarela = new Pasarela();
    const { organization, product, sesion } = await cobrar(pasarela);

    // Se reproduce el estado que dejaba el código viejo: pago marcado pagado y
    // suscripción sin abrir. El cliente pagó y el producto no está.
    markPaymentPaid(sesion.payment.id, new Date().toISOString());
    expect(currentSubscription(organization.id, product.id)?.status).toBe('pending');
    expect(productAccess(organization.id, SLUG).allowed).toBe(false);

    // El reintento del webhook, que antes respondía "ya confirmado" para siempre.
    const r = await confirmCheckout({
      provider: 'transfer',
      providerReference: sesion.payment.provider_reference,
    });

    expect(r.yaConfirmado).toBe(false);
    expect(r.subscription.status).toBe('active');
    expect(r.subscription.current_period_end).not.toBeNull();
    expect(productAccess(organization.id, SLUG).allowed).toBe(true);
  });

  it('un reintento con el producto ya abierto no extiende el periodo', async () => {
    const pasarela = new Pasarela();
    const { organization, product, sesion } = await cobrar(pasarela);

    const primero = await confirmCheckout({ provider: 'transfer', providerReference: sesion.payment.provider_reference });
    const segundo = await confirmCheckout({ provider: 'transfer', providerReference: sesion.payment.provider_reference });

    expect(segundo.yaConfirmado).toBe(true);
    expect(segundo.subscription.current_period_end).toBe(primero.subscription.current_period_end);
    expect(listPayments(organization.id)).toHaveLength(1);
  });
});
