import { AppError } from '@amg/core';
import { obtenerProveedor } from './index.js';
import type { BillingProviderName, CheckoutResult } from './types.js';
import {
  activateSubscription,
  cancelSubscription,
  confirmPaymentAndActivate,
  createPayment,
  createSubscription,
  currentSubscription,
  findPaymentByProviderReference,
  findPendingPayment,
  findSubscriptionById,
  isSubscriptionLive,
  type Payment,
  type Subscription,
} from '../domain/subscriptions.js';
import { requireProductById, type Product } from '../domain/products.js';
import { periodLabel, periodPrice, type PeriodChoice } from './period.js';
import {
  markRedemptionUsedByPayment,
  quoteDiscount,
  releaseRedemption,
  reserveRedemption,
  setRedemptionPayment,
  type DiscountQuote,
  type DiscountRedemption,
} from '../domain/discounts.js';

const DIA_MS = 86_400_000;

/**
 * HASTA CUANDO CORRE LO PAGADO
 * ===========================
 *
 * `billing_period` es 'monthly' | 'yearly' | 'one_time', y el fin del periodo se
 * saca de la DURACION (30 o 365 dias), no del calendario. La diferencia para el
 * cliente es minima, pero la diferencia para el sistema no: `isLive()` compara
 * contra `current_period_end`, asi que cualquier fecha futura cuenta como "paga".
 * Si este calculo fallara y dejara la fecha en null, la suscripcion no venceria
 * NUNCA. Es la forma mas cara de equivocarse: el cliente deja de pagar y nadie
 * se entera, porque el producto sigue respondiendo.
 *
 * Por eso `one_time` devuelve una fecha concreta y no `null`: `null` significa
 * "sin caducidad" y para un pago único eso es exactamente lo que no queremos.
 */
function finDelPeriodo(periodo: Product['billing_period'], desde = new Date(), diasOverride?: number): string {
  const dias = diasOverride ?? (periodo === 'yearly' ? 365 : periodo === 'monthly' ? 30 : 3650);
  return new Date(desde.getTime() + dias * DIA_MS).toISOString();
}

export interface StartCheckoutInput {
  organizationId: string;
  productId: string;
  provider: BillingProviderName;
  returnUrl: string;
  customerEmail?: string;
  /** Código de cupón que ingresó el cliente. Opcional: sin él, precio de lista. */
  discountCode?: string;
  /**
   * Periodo elegido (mes o año). Solo aplica a productos mensuales: en un
   * producto ya anual o de pago único se ignora y manda el del producto.
   */
  period?: PeriodChoice;
}

export interface CheckoutSession {
  subscription: Subscription;
  product: Product;
  payment: Payment;
  checkout: CheckoutResult;
  /** Cotización del cupón aplicado, para que la UI muestre el antes/después. */
  discount?: DiscountQuote;
  /** true cuando el producto ya quedó abierto sin pasar por la pasarela. */
  activado?: boolean;
}

/**
 * COBRO: PASO 1, LA INTENCION
 * ============================
 *
 * Crea (o reutiliza) la suscripcion PENDING, pide el checkout a la pasarela y
 * guarda el pago como pendiente con la referencia de la pasarela. NO activa nada:
 * en este punto todavia nadie pago.
 *
 * Lo que queda escrito ANTES de cobrar es lo que permite responder despues "este
 * pago no llego". Sin este registro, un pago que entra no tiene con que
 * emparejarse y la unica salida es el upto manual.
 */
export async function startCheckout(input: StartCheckoutInput): Promise<CheckoutSession> {
  const product = requireProductById(input.productId);
  if (product.status !== 'active') {
    throw new AppError(409, `${product.name} no está disponible para contratación`);
  }

  // El periodo contratado. Solo un producto mensual deja elegir el año; uno ya
  // anual o de pago único mantiene el suyo. De aquí salen TANTO el precio como
  // los días de acceso, así que el monto que se cobra y el periodo que se abre
  // no pueden desincronizarse.
  const periodo: Product['billing_period'] =
    product.billing_period === 'monthly' && input.period === 'yearly' ? 'yearly' : product.billing_period;
  const precioBase = periodo === 'yearly' ? periodPrice(product.price, 'yearly') : product.price;
  const etiquetaPeriodo = periodo === 'monthly' || periodo === 'yearly' ? periodLabel(periodo) : undefined;

  // Solo se bloquea la contratacion si la suscripcion esta VIGENTE, no solo
  // activa. Una suscripcion `active` con el periodo vencido no esta pagada: si
  // se tomara `status` como sinonimo de "pagada", el cliente que renovo hace
  // un mes no podria volver a contratar, y lo unico que veria es un 409 que no
  // explica la causa.
  const vigente = currentSubscription(input.organizationId, product.id);
  if (vigente && isSubscriptionLive(vigente)) {
    throw new AppError(409, `Ya tienes ${product.name} contratado. Puedes gestionarlo desde Mi cuenta.`);
  }

  // Un cobro en curso no se duplica. Un doble clic en "Contratar" es el caso
  // normal, no el raro: si se creara un segundo checkout, el cliente tendria dos
  // transferencias que hacer y AMG dos veces el mismo cobro. Se responde con un
  // 409 que trae la referencia viva, para que la UI la muestre y el cliente
  // termine el que ya empezo en vez de abrir otro.
  const pendiente = findPendingPayment(input.organizationId, product.id, input.provider);
  if (pendiente) {
    throw new AppError(
      409,
      `Ya tienes un cobro en curso para ${product.name} con la referencia ${pendiente.provider_reference}. `
        + 'Completa ese pago o contacta a soporte para cancelarlo.',
    );
  }

  // El cupón se cotiza ANTES de escribir nada: si el código no existe, no está
  // vigente o se agotó, el cliente recibe el 409 sin que quede una suscripción
  // pendiente ni una llamada a la pasarela de por medio.
  const quote = input.discountCode
    ? quoteDiscount({
        code: input.discountCode,
        product,
        organizationId: input.organizationId,
        amount: precioBase,
      })
    : undefined;

  // La pasarela se resuelve ANTES de crear la suscripción y de reservar el cupo.
  // Si el proveedor no existe (p. ej. webpay sin adapter da 501), no queremos
  // haber consumido el último uso de un cupón ni dejado una fila `pending`.
  const proveedor = quote?.free ? undefined : obtenerProveedor(input.provider);

  // El cupo del cupón se retiene ahora. `free` (prueba gratis / 100% off) también
  // lo retiene: aunque no pase por una pasarela, el canje ocurrió y tiene que
  // contar para el tope.
  const redemption: DiscountRedemption | undefined = quote
    ? reserveRedemption({
        discount: quote.discount,
        organizationId: input.organizationId,
        amountBefore: quote.amountBefore,
        amountAfter: quote.amountAfter,
      })
    : undefined;

  // ── camino promo: no hay nada que cobrar, no hay pasarela ──────────────────
  if (quote?.free) {
    return activatePromo({ input, product, quote, redemption, periodo });
  }

  const monto = quote ? quote.amountAfter : precioBase;

  const subscription = createSubscription({
    organizationId: input.organizationId,
    productId: product.id,
    provider: input.provider,
    billingPeriod: periodo,
  });

  let checkout: CheckoutResult;
  try {
    checkout = await proveedor!.createCheckout({
      subscription,
      product,
      amount: monto,
      currency: product.currency,
      periodLabel: etiquetaPeriodo,
      returnUrl: input.returnUrl,
      customerEmail: input.customerEmail,
    });
  } catch (error) {
    // Si la pasarela no sirvio checkout, la suscripcion pendiente no describe
    // ningun cobro posible. Se cancela para que el siguiente intento arranque
    // limpio en vez de toparse con un pendiente que no se puede pagar.
    cancelSubscription(subscription.id);
    if (redemption) releaseRedemption(redemption.id);
    throw error;
  }

  if (!checkout.providerReference) {
    // Una pasarela sin referencia es una pasarela que no se puede cobrar de
    // forma rastreable. Mejor fallar aca, con el cobro sin empezar, que abrir un
    // producto que nadie puede conciliar.
    cancelSubscription(subscription.id);
    if (redemption) releaseRedemption(redemption.id);
    throw new AppError(502, 'La pasarela no devolvió una referencia de pago');
  }

  // El pago PENDIENTE guarda el monto YA rebajado, congelado. Ese es el monto
  // oficial: si manana sube el precio, este pago sigue siendo el de hoy; y si la
  // pasarela intenta cobrar otra cosa, la comparacion del paso 2 lo caza.
  const payment = createPayment({
    organizationId: input.organizationId,
    subscriptionId: subscription.id,
    productId: product.id,
    amount: monto,
    originalAmount: quote ? quote.amountBefore : null,
    discountAmount: quote ? quote.discountAmount : 0,
    discountCode: quote ? quote.code : null,
    currency: product.currency,
    provider: input.provider,
    status: 'pending',
    providerReference: checkout.providerReference,
  });

  if (redemption) setRedemptionPayment(redemption.id, payment.id);

  return { subscription, product, payment, checkout, discount: quote };
}

/**
 * Camino `promo`: el pago es de $0, así que no hay pasarela ni webhook. Se abre
 * el producto directamente y se deja una redención `used`. Es el único lugar
 * donde algo se activa sin un pago confirmado, y por eso es explícito y auditable.
 */
function activatePromo(input: {
  input: StartCheckoutInput;
  product: Product;
  quote: DiscountQuote;
  redemption?: DiscountRedemption;
  periodo: Product['billing_period'];
}): CheckoutSession {
  const { product, quote, redemption, periodo } = input;
  const ahora = new Date();
  const subscription = createSubscription({
    organizationId: input.input.organizationId,
    productId: product.id,
    provider: 'manual',
    billingPeriod: periodo,
  });
  const periodEnd = finDelPeriodo(
    periodo,
    ahora,
    quote.trialDays > 0 ? quote.trialDays : undefined,
  );
  const active = activateSubscription(subscription.id, periodEnd);
  const payment = createPayment({
    organizationId: input.input.organizationId,
    subscriptionId: active.id,
    productId: product.id,
    amount: 0,
    originalAmount: quote.amountBefore,
    discountAmount: quote.discountAmount,
    discountCode: quote.code,
    currency: product.currency,
    provider: 'manual',
    status: 'paid',
    paidAt: ahora.toISOString(),
    providerReference: `promo-${redemption?.id ?? product.slug}`,
  });
  if (redemption) {
    setRedemptionPayment(redemption.id, payment.id);
    markRedemptionUsedByPayment(payment.id);
  }

  const detalle = quote.trialDays > 0
    ? `Prueba gratis de ${quote.trialDays} día(s) activada con el cupón ${quote.code}.`
    : `Cupón ${quote.code} aplicado: ${product.name} quedó activo.`;

  return {
    subscription: active,
    product,
    payment,
    checkout: { provider: 'manual', providerReference: payment.provider_reference ?? 'promo', instructions: detalle },
    discount: quote,
    activado: true,
  };
}

export interface ConfirmCheckoutInput {
  provider: BillingProviderName;
  providerReference: string;
  rawBody?: string;
  signature?: string;
}

export interface ConfirmCheckoutResult {
  subscription: Subscription;
  payment: Payment;
  /** true si el pago ya estaba confirmado: este fue un reintento. */
  yaConfirmado: boolean;
}

/**
 * COBRO: PASO 2, LA CONFIRMACION
 * ==============================
 *
 * Aqui se abre el producto, y solo aqui. El orden de las comprobaciones ES la
 * seguridad del sistema:
 *
 *   1. se busca el pago por la referencia de la pasarela. Si no existe, se
 *      corta: un webhook de un pago que no somos nosotros creo es ruido, y
 *      quizá un intento de abrir algo.
 *   2. se le pide a la pasarela que verifique. Si no puede, se corta.
 *   3. se compara lo verificado con lo congelado. Si no calza, se corta: cobrar
 *      $100 y activar un plan de $25.000 es un cobro indebido, no un error.
 *   4. solo entonces se marca el pago pagado y se activa la suscripcion.
 *
 * IDEMPOTENTE, porque las pasarelas reintentan webhooks y eso es lo normal. La
 * segunda vez no vuelve a abrir nada ni extiende el periodo: un reintento no le
 * regala un mes gratis al cliente, y la diferencia la paga AMG.
 */
export async function confirmCheckout(input: ConfirmCheckoutInput): Promise<ConfirmCheckoutResult> {
  const payment = findPaymentByProviderReference(input.provider, input.providerReference);
  if (!payment) {
    throw new AppError(404, 'No hay ningún pago pendiente con esa referencia');
  }

  // Ya estaba pagado: se devuelve tal cual y se sale. Se resuelve ANTES de volver
  // a preguntar a la pasarela, porque si la pasarela ya purgo el evento, un
  // reintento legitimo fallaria y dejaria al cliente pagando sin acceso.
  //
  // CON EXCEPCION: si el pago esta pagado pero la suscripcion sigue sin abrir,
  // no se responde "ya confirmado" sino que se repara. Ese estado no deberia
  // existir (por eso las dos escrituras van en una transaccion), pero si
  // aparece -- una fila vieja, una restauracion de backup, un proceso que
  // murio antes de este arreglo -- es el peor de todos: el cliente pago, el
  // sistema lo da por cobrado y nadie le abre el producto. Un reintento que
  // devolviera el mismo "ya confirmado" lo dejaria trapped para siempre.
  if (payment.status === 'paid') {
    if (!payment.subscription_id) throw new AppError(409, 'El pago no tiene suscripción asociada');
    const subscription = findSubscriptionById(payment.subscription_id);
    if (!subscription) throw new AppError(409, 'El pago no tiene suscripción asociada');
    if (!isSubscriptionLive(subscription)) {
      const reparado = confirmPaymentAndActivate({
        paymentId: payment.id,
        subscriptionId: subscription.id,
        paidAt: payment.paid_at ?? new Date().toISOString(),
        periodEnd: finDelPeriodo(subscription.billing_period),
      });
      // El cupón ya se consumió: si quedó reservado, pasa a usado.
      markRedemptionUsedByPayment(payment.id);
      return { subscription: reparado.subscription, payment: reparado.payment, yaConfirmado: false };
    }
    return { subscription, payment, yaConfirmado: true };
  }

  const proveedor = obtenerProveedor(input.provider);
  const confirmacion = await proveedor.confirmPayment(
    input.providerReference,
    input.rawBody ?? '',
    input.signature,
  );

  // La confirmacion tiene que ser DE ESTE pago. Sin esto, un adaptador que
  // conteste por una referencia distinta (un webhook reenrutado, un id mal
  // mapeado) abriria el producto con el monto de un cobro y la referencia de
  // otro. Se compara contra lo pedido y contra lo guardado: los dos.
  if (confirmacion.provider !== payment.provider) {
    throw new AppError(
      409,
      `La confirmación vino de ${confirmacion.provider} y este pago es de ${payment.provider}. No se activa el producto.`,
    );
  }
  if (confirmacion.providerReference !== payment.provider_reference) {
    throw new AppError(
      409,
      `La confirmación es de la referencia ${confirmacion.providerReference} y se pidió ${payment.provider_reference}. No se activa el producto.`,
    );
  }

  // Si la pasarela conoce el monto, tiene que concordar con el que se pidio.
  if (confirmacion.amount !== undefined && confirmacion.amount !== payment.amount) {
    throw new AppError(
      409,
      `El pago fue de ${confirmacion.amount} y se esperaba ${payment.amount}. No se activa el producto.`,
    );
  }
  if (confirmacion.currency && confirmacion.currency !== payment.currency) {
    throw new AppError(
      409,
      `El pago vino en ${confirmacion.currency} y se esperaba ${payment.currency}. No se activa el producto.`,
    );
  }

  if (!payment.subscription_id || !payment.product_id) {
    throw new AppError(409, 'El pago no tiene suscripción asociada: no se activa nada');
  }

  // El producto se resuelve ANTES de escribir. `requireProductById` lanza si el
  // producto ya no existe, y con el orden viejo ese error llegaba después de
  // marcar el pago como pagado.
  const product = requireProductById(payment.product_id);

  // El periodo que se abre es el que se CONGELÓ al crear la suscripción, no el
  // del catálogo: si el cliente pagó el año y aquí se leyera `product.price`,
  // se le abriría un mes por lo que pagó doce.
  const subscriptionRow = findSubscriptionById(payment.subscription_id);
  if (!subscriptionRow) throw new AppError(409, 'El pago no tiene suscripción asociada: no se activa nada');

  // Pago pagado y producto abierto, juntos o ninguno: ver confirmPaymentAndActivate.
  const { payment: pagado, subscription } = confirmPaymentAndActivate({
    paymentId: payment.id,
    subscriptionId: payment.subscription_id,
    paidAt: confirmacion.paidAt,
    periodEnd: finDelPeriodo(subscriptionRow.billing_period),
  });

  // El pago se confirmó: el cupón reservado pasa a usado.
  markRedemptionUsedByPayment(payment.id);

  return { subscription, payment: pagado, yaConfirmado: false };
}

/** El producto NO se abre con esto. Sirve para que el usuario sepa que paso. */
export function resumenSuscripcion(subscription: Subscription): {
  vigente: boolean;
  periodoTermina: string | null;
} {
  return {
    vigente: subscription.status === 'active',
    periodoTermina: subscription.current_period_end,
  };
}
