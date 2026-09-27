import { AppError } from '@saas-mini/core';
import type { BillingProvider, CheckoutRequest, CheckoutResult, PaymentConfirmation } from './types.js';

/**
 * STRIPE: LA COSTURA, TODAVIA NO EL MONEY
 * =======================================
 *
 * Este archivo NO cobra nada todavia, y a proposito. Es lo contrario de un
 * simulacro: es el unico lugar donde se puede ver que falta la llave y que,
 * mientras falte, el sistema lo dice en vez de fingir.
 *
 * Dos decisiones:
 *
 * 1. No se mete el SDK de Stripe. No esta en package.json, y meterlo "para
 *    dejar el esqueleto" mete una dependencia que nadie exercise. La costura se
 *    demuestra con la interface y con los tests usando un doble.
 *
 * 2. La verificacion del webhook se hace sobre el CUERPO CRUDO, no sobre un
 *    JSON ya parseado. Es la diferencia entre "el evento es de Stripe" y "alguien
 *    me mando este JSON". Un `req.body` reparseado por un middleware de JSON ya
 *    no es el cuerpo firmado: la firma no calza y nadie sabe por que. Por eso la
 *    interface recibe `rawBody: string`.
 *
 * Cuando se implemente de verdad, lo que NO puede cambiar es la regla del
 * dominio: la pasarela confirma que un pago ocurrio, y el dominio decide si eso
 * abre el producto. Si alguna vez este metodo empieza a llamar a
 * `activateSubscription`, la costura esta mal puesta.
 */
export class StripeProvider implements BillingProvider {
  readonly name = 'stripe' as const;

  constructor(private readonly config: { secretKey: string; webhookSecret: string }) {}

  private exigirConfig(): void {
    if (!this.config.secretKey || !this.config.webhookSecret) {
      throw new AppError(
        503,
        'Stripe no esta configurado (STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET). ' +
          'Usa el proveedor manual o transfer mientras tanto.',
      );
    }
  }

  async createCheckout(_request: CheckoutRequest): Promise<CheckoutResult> {
    this.exigirConfig();
    // Al implementar: se crea la Checkout Session con `mode=payment`,
    // `client_reference_id = subscription.id` y el MONTO EN UNIDADES MENORES.
    // Ojo con esto, que es la trampa clasica: si se manda el monto en pesos,
    // Stripe cobra 100 veces menos y el error no se ve hasta la conciliacion.
    throw new AppError(501, 'Stripe todavia no implementa checkout (ver src/billing/stripe.ts)');
  }

  async confirmPayment(
    _reference: string,
    _rawBody: string,
    _signature?: string,
  ): Promise<PaymentConfirmation> {
    this.exigirConfig();
    // Al implementar, en este orden y sin saltarse ninguno:
    //   1. verificar la firma con el webhook secret sobre el cuerpo CRUDO;
    //   2. comprobar que el evento es del tipo que esperamos;
    //   3. recién entonces leer el monto y compararlo con el pago pendiente.
    // Si se hace al reves, un atacante puede mandar "pago confirmado" por su
    // cuenta y abrir productos.
    throw new AppError(501, 'Stripe todavia no implementa confirmacion de webhook');
  }
}
