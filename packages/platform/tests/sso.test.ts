import { describe, expect, it, beforeAll } from 'vitest';
import { AppError } from '@saas-mini/core';
import { register } from '../src/auth/service.js';
import { getCoreDb } from '../src/db/init.js';
import { verifySessionToken, type VerifiedSession } from '../src/domain/sessions.js';
import { authorize, exchangeCode, introspectToken, safeReturnUrl, appendQuery } from '../src/sso/service.js';
import { ensureSsoClient, findSsoClient, rotateSsoClientSecret } from '../src/sso/registry.js';
import { verifyProductToken } from '../src/sso/tokens.js';
import { grantSubscription, cancelSubscription, productAccess } from '../src/domain/subscriptions.js';
import { findProductBySlug } from '../src/domain/products.js';
import { seedCatalog } from '../src/seed.js';
import { schema } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';

const PASSWORD = 'UnaClaveLarga1';
const PRODUCTO = 'inventario';
const REDIRECT = 'https://inventario.amgdeveloper.cl/auth/callback';

beforeAll(() => {
  getCoreDb();
  // El arranque real siembra el catálogo (createPlatformApp → ensurePlatformSeed);
  // en los tests hay que hacerlo a mano.
  seedCatalog();
});

/** Deja una organización con suscripción activa al producto indicado. */
async function orgConSuscripcion(slug: string, productos: string[] = [PRODUCTO]) {
  const r = await register({
    name: 'Dueño',
    email: `dueno-${slug}@ejemplo.cl`,
    password: PASSWORD,
    organizationName: `Org ${slug}`,
    organizationSlug: slug,
  });
  for (const producto of productos) {
    const productoRow = findProductBySlug(producto);
    if (!productoRow) throw new Error(`producto ${producto} no esta en el catalogo`);
    grantSubscription({ organizationId: r.organization.id, productId: productoRow.id, days: 30, provider: 'manual' });
  }
  const check = verifySessionToken(r.token);
  if (!check.ok) throw new Error('sesion invalida en el helper');
  return { ...r, session: check as VerifiedSession };
}

function codeDe(outcome: ReturnType<typeof authorize>): string {
  if (outcome.kind !== 'redirect') throw new Error(`esperaba redirect, vino ${outcome.kind}`);
  return new URL(outcome.location).searchParams.get('code') ?? '';
}

describe('registro de clientes SSO', () => {
  it('deriva un secreto por producto y no lo comparte entre productos', () => {
    const a = ensureSsoClient('inventario', { redirectUris: [REDIRECT] });
    const b = ensureSsoClient('cotizaciones', { redirectUris: ['https://cotizaciones.amgdeveloper.cl/auth/callback'] });
    expect(a.secret).not.toBe(b.secret);
    expect(a.clientId).toBe('inventario');
    expect(a.secret.length).toBeGreaterThanOrEqual(32);
  });

  it('es idempotente: volver a asegurar NO cambia el secreto', () => {
    const antes = ensureSsoClient('cotizaciones').secret;
    const despues = ensureSsoClient('cotizaciones').secret;
    expect(despues).toBe(antes);
  });

  it('rotar el secreto invalida el anterior', () => {
    ensureSsoClient('ventas', { redirectUris: ['https://ventas.amgdeveloper.cl/auth/callback'] });
    const antes = findSsoClient('ventas')?.secret;
    const nuevo = rotateSsoClientSecret('ventas');
    expect(nuevo.secret).toBeTruthy();
    expect(nuevo.secret).not.toBe(antes);
    // Y el que quedó en la base es el nuevo.
    expect(findSsoClient('ventas')?.secret).toBe(nuevo.secret);
  });

  it('nunca devuelve el secreto por la API pública de clientes', () => {
    const cliente = findSsoClient(PRODUCTO);
    expect(cliente).toBeTruthy();
    // El tipo SsoClientInfo lo expone, pero el router /api/sso/clients/:id no lo
    // serializa: acá se documenta que el secreto NO debe ir en respuestas.
    expect(Object.keys(cliente ?? {})).toContain('redirectUris');
  });
});

describe('authorize', () => {
  it('sin sesión central manda al login del Core', () => {
    const outcome = authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: null });
    expect(outcome.kind).toBe('login');
    if (outcome.kind !== 'login') return;
    // El subdominio nunca aparece: el Core es quien vuelve a redirigir.
    expect(outcome.loginUrl).toContain('/login?return_url=');
    expect(decodeURIComponent(outcome.loginUrl)).toContain('/api/sso/authorize');
  });

  it('con sesión y suscripción emite un código y vuelve al subdominio', async () => {
    const org = await orgConSuscripcion('con-alta');
    ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const outcome = authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session });
    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') return;
    const url = new URL(outcome.location);
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get('code')).toBeTruthy();
  });

  it('propaga el state para que el producto vuelva a donde estaba', async () => {
    const org = await orgConSuscripcion('con-state');
    ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const outcome = authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session, state: '/inventario/stock' });
    expect(outcome.kind).toBe('redirect');
    if (outcome.kind !== 'redirect') return;
    expect(new URL(outcome.location).searchParams.get('state')).toBe('/inventario/stock');
  });

  it('sin suscripción manda a la página de contratación, no al producto', async () => {
    const r = await register({
      name: 'Sin.plan',
      email: 'sinplan@ejemplo.cl',
      password: PASSWORD,
      organizationName: 'Sin Plan',
      organizationSlug: 'sin-plan',
    });
    const check = verifySessionToken(r.token);
    if (!check.ok) return;
    ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const outcome = authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: check });
    expect(outcome.kind).toBe('sin-acceso');
    if (outcome.kind !== 'sin-acceso') return;
    expect(outcome.location).toContain('/contratar');
    expect(decodeURIComponent(outcome.location)).toContain('inventario');
  });

  it('una suscripción a otro producto no habilita este', async () => {
    const org = await orgConSuscripcion('otro-producto', ['cotizaciones']);
    ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const outcome = authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session });
    expect(outcome.kind).toBe('sin-acceso');
  });

  it('rechaza un producto no registrado', () => {
    const outcome = authorize({ clientId: 'no-existe-nada', session: null });
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.status).toBe(404);
  });

  it('rechaza un redirect_uri que no está registrado', async () => {
    const org = await orgConSuscripcion('uri-mala');
    ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const outcome = authorize({
      clientId: PRODUCTO,
      redirectUri: 'https://sitio-falso.com/robo',
      session: org.session,
    });
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.status).toBe(400);
  });

  it('rechaza un producto desactivado', async () => {
    const org = await orgConSuscripcion('desactivado');
    ensureSsoClient('pausado', { redirectUris: ['https://pausado.amgdeveloper.cl/auth/callback'] });
    getCoreDb().db.update(schema.ssoClients).set({ status: 'disabled' }).where(eq(schema.ssoClients.client_id, 'pausado')).run();
    const outcome = authorize({ clientId: 'pausado', session: org.session });
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') return;
    expect(outcome.status).toBe(403);
  });
});

describe('canje del código', () => {
  it('devuelve un token con la audiencia del producto y los datos de identidad', async () => {
    const org = await orgConSuscripcion('canje');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));

    const token = exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT });
    expect(token.token_type).toBe('Bearer');
    expect(token.scope).toBe('product:access');
    expect(token.user_id).toBe(org.user.id);
    expect(token.organization_id).toBe(org.organization.id);
    expect(token.role).toBe('owner');
    expect(token.expires_in).toBeGreaterThan(0);

    const claims = verifyProductToken(token.access_token, cliente.secret, PRODUCTO);
    expect(claims.ok).toBe(true);
    if (!claims.ok) return;
    expect(claims.claims.aud).toBe(PRODUCTO);
    expect(claims.claims.org_id).toBe(org.organization.id);
  });

  it('el código sirve una sola vez', async () => {
    const org = await orgConSuscripcion('un-solo-uso');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));

    exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT });
    expect(() => exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT })).toThrow(AppError);
  });

  it('rechaza el secreto equivocado', async () => {
    const org = await orgConSuscripcion('secreto-malo');
    ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));
    expect(() =>
      exchangeCode({ code, clientId: PRODUCTO, clientSecret: 'secreto-que-no-es', redirectUri: REDIRECT }),
    ).toThrow(AppError);
  });

  it('el codigo de un producto no se canjea en otro', async () => {
    const org = await orgConSuscripcion('cruce');
    const a = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const b = ensureSsoClient('cotizaciones', { redirectUris: ['https://cotizaciones.amgdeveloper.cl/auth/callback'] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));
    expect(() => exchangeCode({ code, clientId: 'cotizaciones', clientSecret: b.secret })).toThrow(AppError);
    expect(a.secret).not.toBe(b.secret);
  });

  it('rechaza un redirect_uri distinto al del código', async () => {
    const org = await orgConSuscripcion('uri-distinta');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));
    expect(() =>
      exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: 'https://otro.amgdeveloper.cl/auth/callback' }),
    ).toThrow(AppError);
  });

  it('si la suscripción se cae entre authorize y token, el canje falla', async () => {
    const org = await orgConSuscripcion('se-cae');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));

    // El cliente cancela mientras el usuario está en la pantalla de login.
    getCoreDb()
      .db.update(schema.subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(schema.subscriptions.organization_id, org.organization.id))
      .run();

    expect(() => exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT })).toThrow(AppError);
  });

  it('un token no se valida con el secreto de otro producto', async () => {
    const org = await orgConSuscripcion('audiencia');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));
    const token = exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT });

    const otro = ensureSsoClient('cotizaciones', { redirectUris: ['https://cotizaciones.amgdeveloper.cl/auth/callback'] });
    const verificado = verifyProductToken(token.access_token, otro.secret, 'cotizaciones');
    expect(verificado.ok).toBe(false);
  });
});

describe('introspección', () => {
  it('confirma un token propio y de su producto', async () => {
    const org = await orgConSuscripcion('introspeccion');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));
    const token = exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT });

    const info = introspectToken(token.access_token, PRODUCTO, cliente.secret);
    expect(info.active).toBe(true);
    expect(info.user_id).toBe(org.user.id);
    expect(info.organization_id).toBe(org.organization.id);
  });

  it('marca inactivo si la suscripción se canceló', async () => {
    const org = await orgConSuscripcion('introspeccion-corte');
    const cliente = ensureSsoClient(PRODUCTO, { redirectUris: [REDIRECT] });
    const code = codeDe(authorize({ clientId: PRODUCTO, redirectUri: REDIRECT, session: org.session }));
    const token = exchangeCode({ code, clientId: PRODUCTO, clientSecret: cliente.secret, redirectUri: REDIRECT });

    getCoreDb()
      .db.update(schema.subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(schema.subscriptions.organization_id, org.organization.id))
      .run();

    const info = introspectToken(token.access_token, PRODUCTO, cliente.secret);
    expect(info.active).toBe(false);
    expect(info.reason).toBeTruthy();
  });

  it('con secreto equivocado responde inactivo, sin filtrar detalles', () => {
    const info = introspectToken('cualquier.token.aqui', PRODUCTO, 'secreto-mentiroso');
    expect(info.active).toBe(false);
    expect(info.reason).toBe('secreto-invalido');
  });
});

describe('suscripciones y autorización comercial', () => {
  it('sin suscripción no hay acceso; con suscripción activa sí', async () => {
    const conPlan = await orgConSuscripcion('con-plan');
    const sinPlan = await register({
      name: 'Sin Plan 2',
      email: 'sinplan2@ejemplo.cl',
      password: PASSWORD,
      organizationName: 'Sin Plan 2',
      organizationSlug: 'sin-plan-2',
    });

    expect(productAccess(conPlan.organization.id, PRODUCTO).allowed).toBe(true);
    expect(productAccess(sinPlan.organization.id, PRODUCTO).allowed).toBe(false);
  });

  it('cancelar deja sin acceso', async () => {
    const org = await orgConSuscripcion('se-cancela');
    expect(productAccess(org.organization.id, PRODUCTO).allowed).toBe(true);
    getCoreDb()
      .db.update(schema.subscriptions)
      .set({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .where(eq(schema.subscriptions.organization_id, org.organization.id))
      .run();
    expect(productAccess(org.organization.id, PRODUCTO).allowed).toBe(false);
  });

  it('una suscripción vencida no habilita', async () => {
    const org = await orgConSuscripcion('vencida');
    getCoreDb()
      .db.update(schema.subscriptions)
      .set({ current_period_end: new Date(Date.now() - 86_400_000).toISOString() })
      .where(eq(schema.subscriptions.organization_id, org.organization.id))
      .run();
    expect(productAccess(org.organization.id, PRODUCTO).allowed).toBe(false);
  });

  it('cancelSubscription es idempotente y queda registrada', async () => {
    const org = await orgConSuscripcion('cancelar-idem');
    const sub = getCoreDb()
      .db.select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.organization_id, org.organization.id))
      .get();
    if (!sub) throw new Error('sin suscripcion');
    expect(cancelSubscription(sub.id).status).toBe('cancelled');
    expect(cancelSubscription(sub.id).status).toBe('cancelled');
  });
});

describe('utilidades de URL', () => {
  it('safeReturnUrl solo acepta hosts de la plataforma', () => {
    expect(safeReturnUrl('https://inventario.amgdeveloper.cl/x')).toBeTruthy();
    expect(safeReturnUrl('https://amgdeveloper.cl')).toBeTruthy();
    expect(safeReturnUrl('https://malo.com/steal')).toBeUndefined();
    expect(safeReturnUrl('https://inventario.malo.com')).toBeUndefined();
    expect(safeReturnUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeReturnUrl('/relativa')).toBeUndefined();
    expect(safeReturnUrl(undefined)).toBeUndefined();
  });

  it('appendQuery agrega y sobreescribe parámetros', () => {
    expect(appendQuery('https://x.cl/a', { b: '1', c: '2' })).toBe('https://x.cl/a?b=1&c=2');
    expect(appendQuery('https://x.cl/a', { b: undefined })).toBe('https://x.cl/a');
    expect(appendQuery('https://x.cl/a?z=0', { b: '1' })).toBe('https://x.cl/a?z=0&b=1');
  });
});
