import { randomUUID } from 'node:crypto';
import { AppError } from '@saas-mini/core';
import type { BillingProvider, CheckoutRequest, CheckoutResult, PaymentConfirmation } from './types.js';

/**
 * TRANSFERENCIA EN LA MANO
 * ========================
 *
 * Es el proveedor que de verdad opera hoy, asi que es el que mas importa que
 * sea honesto. El usuario recibe instrucciones, transfiere, y un operador
 * confirma. Este adapter NO verifica nada por si mismo: `confirmPayment` exige
 * que le pasen la referencia pendiente y falla si no existe, porque "el operador
 * dijo que transfirio" es exactamente el agujero que el sistema debe hacer
 * ruidoso, no silencioso.
 *
 * El `providerReference` se genera aqui y se persiste en `payments` ANTES de que
 * el usuario pague. Es lo que permite que, tres dias despues, el operador
 * confirme contra un registro real y no contra un recuerdo suyo.
 */
export class TransferProvider implements BillingProvider {
  readonly name = 'transfer' as const;

  constructor(private readonly datosBancarios: string) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    if (request.amount <= 0) {
      // Un producto gratis no pasa por una pasarela: se activa directo. Dejar
      // que llegara aqui crearia un pago de $0 que nadie puede confirmar.
      throw new AppError(400, 'El producto no tiene precio: no hay nada que cobrar');
    }

    // La referencia va en el comprobante, no en un campo que el usuario pueda
    // cambiar despues. Va en el texto de las instrucciones.
    const providerReference = `tr-${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    return {
      provider: this.name,
      providerReference,
      instructions: [
        `Transfiere ${request.amount.toLocaleString('es-CL')} ${request.currency} para contratar ${request.product.name}.`,
        this.datosBancarios,
        '',
        `Referencia (obligatoria, es como lo rastreamos): ${providerReference}`,
        '',
        'Guarda esta referencia y anótala en el comprobante: es con ella que un',
        'operador de AMG confirma la transferencia y recién entonces se habilita el',
        'acceso. No es automático.',
      ].join('\n'),
    };
  }

  async confirmPayment(reference: string): Promise<PaymentConfirmation> {
    // A proposito NO consulta una API externa ni "verifica" nada: no hay con que
    // verificar. La confirmacion es un acto humano sobre un pago que ya consta
    // en la base. Lo que si hace es negarse a inventar el pago si la referencia
    // viene vacia, para que una confirmacion no cree una suscripcion fantasma.
    //
    // Tampoco devuelve `amount`: el monto oficial es el del pago pendiente que
    // se guardo al crear el checkout. Si esta confirmacion devolviera un numero,
    // seria una cifra que nadie midio.
    if (!reference) throw new AppError(400, 'Falta la referencia del pago');
    return {
      provider: this.name,
      providerReference: reference,
      paidAt: new Date().toISOString(),
    };
  }
}
