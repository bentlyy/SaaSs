import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '@amg/core';
import type { BillingProvider, CheckoutRequest, CheckoutResult, PaymentConfirmation } from './types.js';

const MP_API = 'https://api.mercadopago.com';

export interface MercadoPagoConfig {
  accessToken: string;
  /**
   * Secreto del webhook (Panel de MP → Webhooks). Opcional: si está, la firma se
   * exige y se valida; si está vacío, el webhook se acepta y la verdad se pide a
   * MP por re-consulta del pago con el token.
   */
  webhookSecret: string;
  /** URL pública del Core: con ella se arma el `notification_url`. */
  coreUrl: string;
  /** 'sandbox' devuelve el punto de pago de pruebas. */
  mode?: 'sandbox' | 'production';
}

export interface MercadoPagoNotification {
  type?: string;
  action?: string;
  /** `payment` en las notificaciones relevantes. */
  data?: { id?: string | number };
}

interface MpPayment {
  id: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string | null;
  external_reference?: string | null;
}

/**
 * MERCADO PAGO (Checkout Pro)
 * ===========================
 *
 * Cobra productos sueltos con un pago único: se crea una *preference*, el
 * usuario paga en el sitio de MP y MP notifica por webhook. La `preference` lleva
 * `external_reference` con NUESTRA referencia (`provider_reference`), que es lo
 * que permite, al volver el pago, emparejarlo con su suscripción.
 *
 * Dos reglas que no se negocian:
 *
 * 1. El monto va en la unidad mínima y CLP NO tiene decimales. Mandar pesos con
 *    decimales hace que MP cobre 100 veces menos y el error no se ve hasta la
 *    conciliación.
 *
 * 2. La confirmación se hace RE-CONSULTANDO el pago a MP con nuestro token, no
 *    creyéndole al cuerpo del webhook. Un webhook es una campanada ("hubo un
 *    pago"), no una prueba: el cuerpo puede venir de cualquiera. La prueba es la
 *    respuesta autenticada de la API de MP. La firma se verifica además al
 *    resolver la referencia (ver `referenceFromNotification`), para no gastar una
 *    llamada en notificaciones inventadas.
 */
export class MercadoPagoProvider implements BillingProvider {
  readonly name = 'mercadopago' as const;

  constructor(private readonly config: MercadoPagoConfig) {}

  private exigirConfig(): void {
    if (!this.config.accessToken) {
      throw new AppError(
        503,
        'MercadoPago no está configurado (MERCADOPAGO_ACCESS_TOKEN). Usa transfer mientras tanto.',
      );
    }
  }

  async createCheckout(request: CheckoutRequest): Promise<CheckoutResult> {
    this.exigirConfig();
    if (request.amount <= 0) {
      // Un producto gratis (o 100% off) no pasa por la pasarela: se activa en el
      // dominio. Dejar que llegara aquí crearía una preference de $0 que MP
      // rechaza, con una suscripción pendiente colgada que nadie puede pagar.
      throw new AppError(400, 'El producto no tiene precio: no hay nada que cobrar');
    }

    const providerReference = `mp-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const base = this.config.coreUrl.replace(/\/+$/, '');
    const back = backUrls(request.returnUrl);

    const body = {
      items: [
        {
          id: request.product.slug,
          title: `AMG · ${request.product.name}`,
          description: [request.product.tagline ?? request.product.description, request.periodLabel]
            .filter(Boolean)
            .join(' · '),
          quantity: 1,
          currency_id: request.currency,
          unit_price: request.amount,
        },
      ],
      external_reference: providerReference,
      notification_url: `${base}/api/billing/webhook/mercadopago`,
      back_urls: back,
      auto_return: 'approved',
      statement_descriptor: 'AMG',
      metadata: {
        organization_id: request.subscription.organization_id,
        subscription_id: request.subscription.id,
        product_slug: request.product.slug,
      },
    };

    const respuesta = await fetch(`${MP_API}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': providerReference,
      },
      body: JSON.stringify(body),
    });

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      throw new AppError(502, `MercadoPago rechazó el checkout (${respuesta.status}): ${detalle.slice(0, 200)}`);
    }

    const data = (await respuesta.json()) as { id?: string; init_point?: string; sandbox_init_point?: string };
    const checkoutUrl = this.config.mode === 'sandbox'
      ? data.sandbox_init_point ?? data.init_point
      : data.init_point ?? data.sandbox_init_point;

    if (!checkoutUrl) throw new AppError(502, 'MercadoPago no devolvió una URL de pago');

    return { provider: this.name, providerReference, checkoutUrl };
  }

  /**
   * Resuelve nuestra referencia a partir de la notificación.
   *
   * Si hay `MERCADOPAGO_WEBHOOK_SECRET`, la firma se exige y se verifica ANTES de
   * tocar la API: así una notificación inventada ni siquiera gasta una llamada.
   *
   * Si NO hay secreto configurado (la app de MP todavía no lo tiene, o no se
   * pudo sacar del panel), la notificación se acepta, pero la verdad se sigue
   * pidiendo a MP con nuestro token (`fetchPayment`) y `confirmCheckout` vuelve a
   * exigir que el pago esté `approved`, sea de esta cuenta y calce con un pago
   * pendiente nuestro. Es decir: sin firma no se confía en el cuerpo del webhook,
   * solo en la respuesta autenticada de MP. Es lo que hacía la integración previa
   * (Vitaria), con la re-consulta como única garantía.
   */
  async referenceFromNotification(
    rawBody: string,
    signature?: string,
    requestId?: string,
  ): Promise<string> {
    this.exigirConfig();
    const notif = parseMercadoPagoNotification(rawBody);
    const dataId = notif.data?.id;
    if (dataId === undefined || dataId === null || dataId === '') {
      throw new AppError(400, 'La notificación no trae el id del pago');
    }
    if (this.config.webhookSecret) {
      if (!verifyMercadoPagoSignature({ dataId: String(dataId), requestId, signature, secret: this.config.webhookSecret })) {
        throw new AppError(401, 'La firma del webhook de MercadoPago no es válida');
      }
    }

    const pago = await this.fetchPayment(String(dataId));
    const reference = pago.external_reference;
    if (!reference) throw new AppError(409, 'El pago de MercadoPago no trae referencia de AMG');
    return reference;
  }

  async confirmPayment(reference: string, rawBody: string): Promise<PaymentConfirmation> {
    this.exigirConfig();
    const notif = parseMercadoPagoNotification(rawBody);
    const dataId = notif.data?.id;
    if (dataId === undefined || dataId === null || dataId === '') {
      throw new AppError(400, 'La notificación no trae el id del pago');
    }

    // La verdad se pide a MP, no se lee del webhook.
    const pago = await this.fetchPayment(String(dataId));
    if (pago.external_reference !== reference) {
      throw new AppError(409, 'El pago de MercadoPago no corresponde a esta referencia');
    }
    if (pago.status !== 'approved') {
      throw new AppError(409, `El pago no está aprobado (estado: ${pago.status ?? 'desconocido'})`);
    }

    return {
      provider: this.name,
      providerReference: reference,
      amount: pago.transaction_amount,
      currency: pago.currency_id,
      paidAt: pago.date_approved ?? new Date().toISOString(),
    };
  }

  private async fetchPayment(id: string): Promise<MpPayment> {
    const respuesta = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });
    if (!respuesta.ok) {
      throw new AppError(502, `MercadoPago no pudo verificar el pago ${id} (${respuesta.status})`);
    }
    return (await respuesta.json()) as MpPayment;
  }
}

/** Separa `returnUrl` en las tres vueltas que MP permite, sin perder la base. */
export function backUrls(returnUrl: string): { success: string; failure: string; pending: string } {
  const con = (estado: string) => {
    const url = new URL(returnUrl);
    url.searchParams.set('pago', estado);
    return url.toString();
  };
  return { success: con('ok'), failure: con('error'), pending: con('pendiente') };
}

export function parseMercadoPagoNotification(rawBody: string): MercadoPagoNotification {
  try {
    return JSON.parse(rawBody) as MercadoPagoNotification;
  } catch {
    throw new AppError(400, 'Notificación de MercadoPago ilegible');
  }
}

/**
 * Firma de webhook de MP: `x-signature: ts=...,v1=...` y el manifiesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, HMAC-SHA256 con el secreto.
 * El `id` va en minúsculas y se compara en tiempo constante.
 */
export function verifyMercadoPagoSignature(input: {
  dataId: string;
  requestId?: string;
  signature?: string;
  secret: string;
}): boolean {
  if (!input.signature) return false;
  const partes = Object.fromEntries(
    input.signature.split(',').map((par) => {
      const [k, v] = par.split('=');
      return [k?.trim(), v?.trim()];
    }),
  ) as { ts?: string; v1?: string };
  if (!partes.ts || !partes.v1) return false;

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId ?? ''};ts:${partes.ts};`;
  const esperado = createHmac('sha256', input.secret).update(manifest).digest('hex');
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(partes.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
