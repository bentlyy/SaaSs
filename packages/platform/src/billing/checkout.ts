import { AppError } from '@saas-mini/core';
import { obtenerProveedor } from './index.js';
import type { BillingProviderName, CheckoutResult } from './types.js';
import {
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
function finDelPeriodo(periodo: Product['billing_period'], desde = new Date()): string {
  const dias = periodo === 'yearly' ? 365 : periodo === 'monthly' ? 30 : 3650;
  return new Date(desde.getTime() + dias * DIA_MS).toISOString();
}

export interface StartCheckoutInput {
  organizationId: string;
  productId: string;
  provider: BillingProviderName;
  returnUrl: string;
  customerEmail?: string;
}

export interface CheckoutSession {
  subscription: Subscription;
  product: Product;
  payment: Payment;
  checkout: CheckoutResult;
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

  // La pasarela se resuelve PRIMERO, antes de escribir nada. Al revés queda una
  // suscripcion `pending` por cada intento de contratar con una pasarela que no
  // existe (`webpay` sin implementar da 501), y cada reintento deja otra. Un
  // error de configuracion no puede dejar rastro de si mismo como si hubiera
  // cobrados.
  const proveedor = obtenerProveedor(input.provider);

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

  const subscription = createSubscription({
    organizationId: input.organizationId,
    productId: product.id,
    provider: input.provider,
  });

  let checkout: CheckoutResult;
  try {
    checkout = await proveedor.createCheckout({
      subscription,
      product,
      amount: product.price,
      currency: product.currency,
      returnUrl: input.returnUrl,
      customerEmail: input.customerEmail,
    });
  } catch (error) {
    // Si la pasarela no sirvio checkout, la suscripcion pendiente no describe
    // ningun cobro posible. Se cancela para que el siguiente intento arranque
    // limpio en vez de toparse con un pendiente que no se puede pagar.
    cancelSubscription(subscription.id);
    throw error;
  }

  if (!checkout.providerReference) {
    // Una pasarela sin referencia es una pasarela que no se puede cobrar de
    // forma rastreable. Mejor fallar aca, con el cobro sin empezar, que abrir un
    // producto que nadie puede conciliar.
    cancelSubscription(subscription.id);
    throw new AppError(502, 'La pasarela no devolvió una referencia de pago');
  }

  // El pago PENDIENTE guarda el monto del catalogo, congelado. Ese es el monto
  // oficial: si manana sube el precio, este pago sigue siendo el de hoy. Por eso
  // la comparacion del paso 2 es contra este numero y no contra el precio actual.
  const payment = createPayment({
    organizationId: input.organizationId,
    subscriptionId: subscription.id,
    productId: product.id,
    amount: product.price,
    currency: product.currency,
    provider: input.provider,
    status: 'pending',
    providerReference: checkout.providerReference,
  });

  return { subscription, product, payment, checkout };
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
      const product = payment.product_id ? requireProductById(payment.product_id) : undefined;
      const reparado = confirmPaymentAndActivate({
        paymentId: payment.id,
        subscriptionId: subscription.id,
        paidAt: payment.paid_at ?? new Date().toISOString(),
        periodEnd: finDelPeriodo(product?.billing_period ?? 'monthly'),
      });
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

  // Pago pagado y producto abierto, juntos o ninguno: ver confirmPaymentAndActivate.
  const { payment: pagado, subscription } = confirmPaymentAndActivate({
    paymentId: payment.id,
    subscriptionId: payment.subscription_id,
    paidAt: confirmacion.paidAt,
    periodEnd: finDelPeriodo(product.billing_period),
  });

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
