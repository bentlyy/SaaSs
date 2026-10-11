import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createPlatformApp } from '../src/app.js';
import { seedCatalog } from '../src/seed.js';
import { register } from '../src/auth/service.js';
import { startCheckout } from '../src/billing/checkout.js';
import { getCoreDb } from '../src/db/init.js';
import { schema } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { productAccess } from '../src/domain/subscriptions.js';

const PASSWORD = 'UnaClaveLarga1';
const SLUG = 'inventario';
const SECRETO = 'wh-secret-de-prueba';
const PAYMENT_ID = '987654321';
const REQUEST_ID = 'req-webhook-1';
const TS = '1700000000';

// El factory de billing/index.ts lee el entorno al momento de llamar, así que
// basta con dejarlo puesto antes de que la ruta resuelva el proveedor.
process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-access-token';
process.env.MERCADOPAGO_WEBHOOK_SECRET = SECRETO;

let app: Express;
let contador = 0;
/** `external_reference` que devolverá la "API" de MP en el GET del pago. */
let referenciaDelPago = '';

const fetchOriginal = globalThis.fetch;

function respuestaJson(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response;
}

/**
 * Doble de la API de MP: solo cubre los dos endpoints que toca el flujo
 * (crear preference y leer pago). Cualquier otra URL es un error de test.
 */
function montarFetchFalso(estado: string, monto: number): void {
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes('/checkout/preferences')) {
      return respuestaJson({ id: 'pref-1', init_point: 'https://mp.example/checkout' });
    }
    if (u.includes('/v1/payments/')) {
      return respuestaJson({
        id: PAYMENT_ID,
        status: estado,
        transaction_amount: monto,
        currency_id: 'CLP',
        date_approved: estado === 'approved' ? new Date().toISOString() : null,
        external_reference: referenciaDelPago,
      });
    }
    throw new Error(`fetch inesperado en el test: ${u}`);
  }) as typeof fetch;
}

function firma(dataId: string): string {
  const manifest = `id:${dataId};request-id:${REQUEST_ID};ts:${TS};`;
  return `ts=${TS},v1=${createHmac('sha256', SECRETO).update(manifest).digest('hex')}`;
}

beforeAll(() => {
  getCoreDb();
  app = createPlatformApp();
});

afterAll(() => {
  globalThis.fetch = fetchOriginal;
});

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
  referenciaDelPago = '';
});

async function org() {
  contador += 1;
  const r = await register({
    name: 'Ana Pérez',
    email: `wh${contador}@ejemplo.cl`,
    password: PASSWORD,
    organizationName: `Org ${contador}`,
    organizationSlug: `org-${contador}`,
  });
  return r.organization;
}

function producto(slug = SLUG) {
  const p = getCoreDb().db.select().from(schema.products).where(eq(schema.products.slug, slug)).get();
  if (!p) throw new Error(`el catálogo no tiene ${slug}`);
  return p;
}

/** Deja un pago pendiente de mercadopago y devuelve su referencia. */
async function pagoPendiente(organizationId: string): Promise<string> {
  const session = await startCheckout({
    organizationId,
    productId: producto().id,
    provider: 'mercadopago',
    returnUrl: 'https://amgdeveloper.cl/contratar?p=inventario',
  });
  referenciaDelPago = session.checkout.providerReference;
  return referenciaDelPago;
}

function enviarWebhook() {
  return request(app)
    .post('/api/billing/webhook/mercadopago')
    .set('x-signature', firma(PAYMENT_ID))
    .set('x-request-id', REQUEST_ID)
    .send({ type: 'payment', data: { id: PAYMENT_ID } });
}

describe('webhook de MercadoPago (ruta HTTP)', () => {
  it('con firma válida confirma el pago y abre el producto', async () => {
    const o = await org();
    montarFetchFalso('approved', producto().price);
    const referencia = await pagoPendiente(o.id);

    const res = await enviarWebhook().expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(productAccess(o.id, SLUG).allowed).toBe(true);
    expect(referencia).toMatch(/^mp-/);
  });

  it('con firma inválida descarta el webhook sin abrir nada (2xx, sin reintento)', async () => {
    const o = await org();
    montarFetchFalso('approved', producto().price);
    await pagoPendiente(o.id);

    const falsa = firma(PAYMENT_ID).replace('v1=', `v1=${'0'.repeat(64)}`);
    const res = await request(app)
      .post('/api/billing/webhook/mercadopago')
      .set('x-signature', falsa)
      .set('x-request-id', REQUEST_ID)
      .send({ type: 'payment', data: { id: PAYMENT_ID } })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
    expect(productAccess(o.id, SLUG).allowed).toBe(false);
  });

  it('sin secreto configurado valida por re-consulta (aunque no venga firma)', async () => {
    const guardado = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    try {
      const o = await org();
      montarFetchFalso('approved', producto().price);
      await pagoPendiente(o.id);

      await request(app)
        .post('/api/billing/webhook/mercadopago')
        .send({ type: 'payment', data: { id: PAYMENT_ID } })
        .expect(200);

      expect(productAccess(o.id, SLUG).allowed).toBe(true);
    } finally {
      process.env.MERCADOPAGO_WEBHOOK_SECRET = guardado;
    }
  });

  it('si el pago no está aprobado, no abre el producto', async () => {
    const o = await org();
    montarFetchFalso('pending', producto().price);
    await pagoPendiente(o.id);

    await enviarWebhook().expect(200);

    expect(productAccess(o.id, SLUG).allowed).toBe(false);
  });

  it('es idempotente: un segundo webhook no vuelve a extender el periodo', async () => {
    const o = await org();
    montarFetchFalso('approved', producto().price);
    await pagoPendiente(o.id);

    await enviarWebhook().expect(200);
    const { db } = getCoreDb();
    const antes = db.select().from(schema.subscriptions)
      .where(eq(schema.subscriptions.organization_id, o.id)).all()[0]?.current_period_end;

    await enviarWebhook().expect(200);
    const despues = db.select().from(schema.subscriptions)
      .where(eq(schema.subscriptions.organization_id, o.id)).all()[0]?.current_period_end;

    expect(despues).toBe(antes);
  });

  it('un monto que no calza con el pago congelado no activa', async () => {
    const o = await org();
    montarFetchFalso('approved', producto().price + 1);
    await pagoPendiente(o.id);

    await enviarWebhook().expect(200);

    expect(productAccess(o.id, SLUG).allowed).toBe(false);
  });
});
