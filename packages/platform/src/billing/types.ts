import type { Product } from '../domain/products.js';
import type { Subscription } from '../domain/subscriptions.js';
import type { billingProviders } from '../db/schema.js';

export type BillingProviderName = (typeof billingProviders)[number];

/**
 * LA COSTURA QUE FALTAABA
 * =======================
 *
 * `billingProviders` era un enum: 'manual' | 'transfer' | 'stripe' | 'webpay'.
 * Un enum no es una pasarela, es una etiqueta. No tenia quien creara una sesion
 * de pago, ni quien verificara que el pago ocurrio, ni quien respondiera ante
 * un rechazo. La verdad de fondo era esta:
 *
 *   - 'manual' servia para que ops activara suscripciones a mano
 *     (grantSubscription), o sea que "pago" significaba "alguien lo escribio en
 *     la base".
 *   - 'stripe' no existia en ningun archivo, pero ya estaba permitido como
 *     valor, asi que un registro podia DECIR stripe sin que nadie cobrara nada.
 *
 * Eso es peor que no tener pasarela, porque el dato queda escrito y nadie lo
 * nota. Un `provider='stripe'` en la base es una promesa que el sistema no
 * cumple.
 *
 * Aqui se separa lo que NO depende de la pasarela (el dominio decide cuando se
 * activa y cuando se vence, y nunca activa sin un pago confirmado) de lo que SI
 * depende (crear el checkout, traducir un webhook, reintentar).
 *
 * REGLA: el dominio NUNCA le pregunta al proveedor si el producto se abre. Le
 * pide un pago, y abre solo cuando ese pago vuelve confirmado. Asi ningun
 * proveedor, ni uno mal escrito, puede abrir un producto por su cuenta.
 */

export interface CheckoutRequest {
  subscription: Subscription;
  product: Product;
  /** Monto exacto a cobrar, en la unidad menor de `product.currency`. */
  amount: number;
  currency: string;
  /** Destino tras pagar. La API lo valida contra una lista blanca. */
  returnUrl: string;
  /** Correo del pagador, para el recibo. Puede faltar si el alta fue sin cuenta. */
  customerEmail?: string;
}

export interface CheckoutResult {
  provider: BillingProviderName;
  /**
   * Identificador del intento en la pasarela. Es la llave con la que vuelve el
   * webhook, asi que OBLIGATORIO: sin esto el pago no se puede asociar a su
   * suscripcion y el usuario paga a cambio de nada.
   */
  providerReference: string;
  /**
   * A donde mandamos al usuario a pagar. Las pasarelas de redireccion lo
   * llenan; las de transferencia en la mano no, porque el usuario paga por su
   * cuenta y despues confirma.
   */
  checkoutUrl?: string;
  /**
   * Instrucciones para el usuario cuando NO hay checkoutUrl: donde transferir,
   * a nombre de quien, que referencia poner. Es el contrato de los proveedores
   * manuales, y la razon de que esta interfaz exista tambien para ellos.
   */
  instructions?: string;
}

export interface PaymentConfirmation {
  provider: BillingProviderName;
  providerReference: string;
  /**
   * Monto que la pasarela dice haber cobrado, cuando puede atestiguarlo (Stripe
   * lo manda en el evento; una transferencia en la mano, no).
   *
   * Es OPCIONAL a proposito: el monto oficial es el del pago pendiente que se
   * guardo al crear el checkout, porque ese no se puede mover despues. Cuando la
   * pasarela lo aporta, el dominio lo compara y si no calza NO activa. Por eso
   * no se exige: un proveedor que no conoce el monto no esta mintiendo, y un
   * `amount: 0` de relleno si lo estaria.
   */
  amount?: number;
  currency?: string;
  /** Cuando lo cobro la pasarela, en ISO. */
  paidAt: string;
}

export interface BillingProvider {
  readonly name: BillingProviderName;

  /**
   * Prepara el cobro y devuelve a donde va el usuario. NO debe activar nada:
   * esto todavia es una intencion de pago, no un pago.
   */
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;

  /**
   * Traduce la confirmacion de la pasarela a un hecho verificado. Si no puede
   * confirmar, tiene que fallar: es preferible no abrir el producto antes que
   * abrirlo por un webhook inventado.
   */
  confirmPayment(
    reference: string,
    rawBody: string,
    signature?: string,
  ): Promise<PaymentConfirmation>;
}
