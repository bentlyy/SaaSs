import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createPlatformApp } from '../src/app.js';
import { seedCatalog } from '../src/seed.js';
import { findSsoClient } from '../src/sso/registry.js';
import { grantSubscription } from '../src/domain/subscriptions.js';
import { findProductBySlug } from '../src/domain/products.js';
import { getCoreDb } from '../src/db/init.js';

let app: Express;
const PASSWORD = 'UnaClaveLarga1';
const COOKIE = 'amg_session';
const PRODUCTO = 'inventario';

/**
 * El slug del catálogo no es el subdominio: `inventario` vive en stock.*, etc.
 * Los tests toman la URL del producto real para no fallar por un hardcodeo.
 */
const APP_URL = (): string => {
  const producto = findProductBySlug(PRODUCTO);
  if (!producto?.app_url) throw new Error('el producto no tiene app_url');
  return producto.app_url;
};
const CALLBACK = (): string => `${APP_URL()}/auth/callback`;

beforeAll(() => {
  getCoreDb();
  seedCatalog();
  app = createPlatformApp();
});

/** Devuelve el header Set-Cookie COMPLETO, para poder revisar los atributos. */
function cookieCompleta(res: request.Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const found = (raw ?? []).find((c) => c.startsWith(`${COOKIE}=`));
  if (!found) throw new Error('la respuesta no devolvió la cookie de sesión');
  return found;
}

/** Solo el par nombre=valor, que es lo que se manda en Cookie:. */
function cookieDe(res: request.Response): string {
  return cookieCompleta(res).split(';')[0] as string;
}

async function crearDueño(email: string, slug: string, productos: string[] = []) {
  const registro = await request(app)
    .post('/api/auth/register')
    .send({ name: 'Dueño', email, password: PASSWORD, organizationName: `Org ${slug}`, organizationSlug: slug })
    .expect(201);
  for (const p of productos) {
    const producto = findProductBySlug(p);
    if (!producto) throw new Error(`sin producto ${p}`);
    grantSubscription({ organizationId: registro.body.organization.id, productId: producto.id, days: 30 });
  }
  return registro;
}

describe('health y meta', () => {
  it('/health responde ok sin detallar fallos', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body).not.toHaveProperty('db');
  });

  it('/api/meta expone lo público y nada secreto', async () => {
    const res = await request(app).get('/api/meta').expect(200);
    expect(res.body.name).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toMatch(/secret|password|token_hash/i);
  });

  it('una ruta inexistente da 404 en JSON', async () => {
    await request(app).get('/api/no-existe').expect(404);
  });
});

describe('registro e inicio de sesión por HTTP', () => {
  it('registra y abre sesión con cookie httpOnly', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Carla',
        email: 'carla@ejemplo.cl',
        password: PASSWORD,
        organizationName: 'Carla Spa',
        organizationSlug: 'carla-spa',
      })
      .expect(201);

    expect(res.body.user.email).toBe('carla@ejemplo.cl');
    expect(res.body.user.password_hash).toBeUndefined();
    expect(res.body.organization.slug).toBe('carla-spa');
    expect(res.body.role).toBe('owner');

    const cookie = cookieCompleta(res);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // Host-only: sin Domain, para que ningún subdominio la pueda leer o plantar.
    expect(cookie.toLowerCase()).not.toContain('domain=');
  });

  it('login con contraseña mala da 401 sin revelar si el correo existe', async () => {
    await crearDueño('mala@ejemplo.cl', 'mala');
    const res = await request(app).post('/api/auth/login').send({ email: 'mala@ejemplo.cl', password: 'ClaveIncorrecta1' }).expect(401);
    const otro = await request(app).post('/api/auth/login').send({ email: 'nadie@ejemplo.cl', password: 'ClaveIncorrecta1' }).expect(401);
    expect(res.body.error).toBe(otro.body.error);
    expect(res.body.message).toBe(otro.body.message);
  });

  it('no acepta JSON mal formado ni campos que no son strings', async () => {
    await request(app).post('/api/auth/register').send({ name: 123, email: 'x@y.cl', password: PASSWORD }).expect(400);
    await request(app).post('/api/auth/login').send({ email: 'x@y.cl', password: [] }).expect(400);
  });
});

describe('protección de rutas', () => {
  it('/api/auth/me sin cookie da 401', async () => {
    await request(app).get('/api/auth/me').expect(401);
  });

  it('/api/account/summary sin cookie da 401', async () => {
    await request(app).get('/api/account/summary').expect(401);
  });

  it('/api/products es público: el catálogo se puede ver sin sesión', async () => {
    const res = await request(app).get('/api/products').expect(200);
    expect(Array.isArray(res.body.products ?? res.body)).toBe(true);
  });

  it('con cookie, /api/auth/me devuelve la identidad', async () => {
    const alta = await crearDueño('me@ejemplo.cl', 'me-org', ['inventario']);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'me@ejemplo.cl', password: PASSWORD })
      .expect(200);

    const res = await request(app).get('/api/auth/me').set('Cookie', cookieDe(login)).expect(200);
    expect(res.body.user.email).toBe('me@ejemplo.cl');
    expect(res.body.organization.slug).toBe('me-org');
    expect(res.body.role).toBe('owner');
    expect(res.body.organizations).toHaveLength(1);
    void alta;
  });

  it('el resumen de cuenta lista los productos con su estado de acceso', async () => {
    const alta = await crearDueño('resumen@ejemplo.cl', 'resumen-org', ['inventario']);
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'resumen@ejemplo.cl', password: PASSWORD })
      .expect(200);

    const res = await request(app).get('/api/account/summary').set('Cookie', cookieDe(login)).expect(200);
    const productos = res.body.products as Array<{ slug: string; access: { allowed: boolean } }>;
    const inv = productos.find((p) => p.slug === 'inventario');
    expect(inv?.access.allowed).toBe(true);
    expect(productos.every((p) => p.access !== undefined)).toBe(true);
    void alta;
  });

  it('logout invalida la cookie en el servidor', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'resumen@ejemplo.cl', password: PASSWORD }).expect(200);
    const cookie = cookieDe(login);
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200);
    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(200);
    // La cookie sigue viaja en el navegador, pero el Core ya no la reconoce.
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('una cookie con firma inválida no abre sesión', async () => {
    await request(app).get('/api/auth/me').set('Cookie', `${COOKIE}=ses_falso.firmaInventada`).expect(401);
  });
});

describe('SSO por HTTP', () => {
  it('authorize sin sesión redirige al login del Core', async () => {
    const res = await request(app)
      .get('/api/sso/authorize')
      .query({ client_id: 'inventario', redirect_uri: CALLBACK() })
      .expect(302);
    expect(res.headers.location).toContain('/login?return_url=');
  });

  it('authorize con sesión y suscripción redirige al producto con un código', async () => {
    await crearDueño('sso-ok@ejemplo.cl', 'sso-ok', ['inventario']);
    const login = await request(app).post('/api/auth/login').send({ email: 'sso-ok@ejemplo.cl', password: PASSWORD }).expect(200);

    const res = await request(app)
      .get('/api/sso/authorize')
      .set('Cookie', cookieDe(login))
      .query({ client_id: 'inventario', redirect_uri: CALLBACK(), state: '/stock' })
      .expect(302);

    const location = new URL(res.headers.location as string);
    expect(location.origin).toBe(APP_URL());
    expect(location.searchParams.get('code')).toBeTruthy();
    expect(location.searchParams.get('state')).toBe('/stock');
  });

  it('authorize sin suscripción manda a /contratar', async () => {
    await crearDueño('sso-noplan@ejemplo.cl', 'sso-noplan');
    const login = await request(app).post('/api/auth/login').send({ email: 'sso-noplan@ejemplo.cl', password: PASSWORD }).expect(200);
    const res = await request(app)
      .get('/api/sso/authorize')
      .set('Cookie', cookieDe(login))
      .query({ client_id: 'inventario', redirect_uri: CALLBACK() })
      .expect(302);
    expect(res.headers.location).toContain('/contratar');
  });

  it('el canje por HTTP entrega el token y no acepta el secreto equivocado', async () => {
    const cliente = findSsoClient('inventario');
    expect(cliente).toBeTruthy();

    const login = await request(app).post('/api/auth/login').send({ email: 'sso-ok@ejemplo.cl', password: PASSWORD }).expect(200);
    const authorize = await request(app)
      .get('/api/sso/authorize')
      .set('Cookie', cookieDe(login))
      .query({ client_id: 'inventario', redirect_uri: CALLBACK() })
      .expect(302);
    const code = new URL(authorize.headers.location as string).searchParams.get('code') as string;

    await request(app)
      .post('/api/sso/token')
      .send({ code, client_id: 'inventario', client_secret: 'secreto-inventado', redirect_uri: CALLBACK() })
      .expect(401);

    const ok = await request(app)
      .post('/api/sso/token')
      .send({ code, client_id: 'inventario', client_secret: cliente!.secret, redirect_uri: CALLBACK() })
      .expect(200);
    expect(ok.body.token_type).toBe('Bearer');
    expect(ok.body.scope).toBe('product:access');
    expect(ok.body.organization_slug).toBe('sso-ok');
  });

  it('introspección responde activo y luego inactivo si se cancela', async () => {
    const cliente = findSsoClient('inventario');
    const alta = await crearDueño('introspect@ejemplo.cl', 'introspect', ['inventario']);
    const login = await request(app).post('/api/auth/login').send({ email: 'introspect@ejemplo.cl', password: PASSWORD }).expect(200);
    const authorize = await request(app)
      .get('/api/sso/authorize')
      .set('Cookie', cookieDe(login))
      .query({ client_id: 'inventario', redirect_uri: CALLBACK() })
      .expect(302);
    const code = new URL(authorize.headers.location as string).searchParams.get('code') as string;
    const token = await request(app)
      .post('/api/sso/token')
      .send({ code, client_id: 'inventario', client_secret: cliente!.secret, redirect_uri: CALLBACK() })
      .expect(200);

    const activo = await request(app)
      .post('/api/sso/introspect')
      .send({ token: token.body.access_token, client_id: 'inventario', client_secret: cliente!.secret })
      .expect(200);
    expect(activo.body.active).toBe(true);

    const { schema } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    getCoreDb()
      .db.update(schema.subscriptions)
      .set({ status: 'cancelled' })
      .where(eq(schema.subscriptions.organization_id, alta.body.organization.id))
      .run();

    const inactivo = await request(app)
      .post('/api/sso/introspect')
      .send({ token: token.body.access_token, client_id: 'inventario', client_secret: cliente!.secret })
      .expect(200);
    expect(inactivo.body.active).toBe(false);
  });

  it('/api/sso/clients/:id NO expone el secreto', async () => {
    const res = await request(app).get('/api/sso/clients/inventario').expect(200);
    expect(res.body.client_id).toBe('inventario');
    expect(res.body.secret).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toMatch(/secret/);
  });

  it('sin client_id responde 400', async () => {
    await request(app).get('/api/sso/authorize').expect(400);
  });
});

describe('contratar por HTTP: la intención no abre el producto', () => {
  it('devuelve las instrucciones del pago y deja la suscripción pendiente', async () => {
    const alta = await crearDueño('paga1@ejemplo.cl', 'paga-1');
    const cookie = cookieDe(
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'paga1@ejemplo.cl', password: PASSWORD })
        .expect(200),
    );

    const res = await request(app)
      .post('/api/account/subscriptions')
      .set('Cookie', cookie)
      .send({ productSlug: PRODUCTO, provider: 'transfer' })
      .expect(201);

    // Se creó la INTENCIÓN, no el acceso.
    expect(res.body.subscription.status).toBe('pending');
    expect(res.body.payment.status).toBe('pending');
    expect(res.body.payment.provider_reference).toBeTruthy();
    expect(res.body.checkout.provider).toBe('transfer');
    expect(res.body.checkout.instructions).toMatch(/Referencia/i);

    // Y el producto sigue cerrado: por mucho que se contrate, no se entra solo.
    const apps = await request(app)
      .get('/api/account/applications')
      .set('Cookie', cookie)
      .expect(200);
    expect(apps.body.active).toEqual([]);
    expect(apps.body.available.map((p: { slug: string }) => p.slug)).toContain(PRODUCTO);
  });

  it('NO existe un endpoint con la sesión del cliente que confirme el pago', async () => {
    const alta = await crearDueño('paga2@ejemplo.cl', 'paga-2');
    const cookie = cookieDe(
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'paga2@ejemplo.cl', password: PASSWORD })
        .expect(200),
    );

    await request(app)
      .post('/api/account/subscriptions')
      .set('Cookie', cookie)
      .send({ productSlug: PRODUCTO, provider: 'transfer' })
      .expect(201);

    // Estos son los caminos que un cliente intentaría para auto-activarse. Todos
    // tienen que fallar. Si alguno empieza a responder 200, es electrizarse
    // gratis con un curl.
    for (const ruta of [
      '/api/account/subscriptions/confirm',
      '/api/account/subscriptions/activate',
      '/api/account/subscriptions/paid',
      '/api/account/payments/confirm',
    ]) {
      const res = await request(app)
        .post(ruta)
        .set('Cookie', cookie)
        .send({ providerReference: 'cualquiera' });
      expect(res.status, `${ruta} respondió ${res.status} y debería ser 404`).toBe(404);
    }

    const apps = await request(app)
      .get('/api/account/applications')
      .set('Cookie', cookie)
      .expect(200);
    expect(apps.body.active).toEqual([]);
  });

  it('un proveedor sin pasarela da error y no deja suscripción activa', async () => {
    await crearDueño('paga3@ejemplo.cl', 'paga-3');
    const cookie = cookieDe(
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'paga3@ejemplo.cl', password: PASSWORD })
        .expect(200),
    );

    // 'webpay' es un valor VÁLIDO del enum: la petición no es inválida, el
    // sistema es el que no puede cobrar por esa vía y tiene que decirlo.
    const res = await request(app)
      .post('/api/account/subscriptions')
      .set('Cookie', cookie)
      .send({ productSlug: PRODUCTO, provider: 'webpay' });
    expect(res.status).toBe(501);

    const apps = await request(app)
      .get('/api/account/applications')
      .set('Cookie', cookie)
      .expect(200);
    expect(apps.body.active).toEqual([]);
  });
});
