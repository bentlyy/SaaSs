import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { mountAmgAuth, type AmgResolvedConfig } from '../src/middleware.js';

/**
 * El contrato entre el guard y el resto del producto.
 *
 * Lo que mas importa aca es la diferencia entre una pagina y una API: una
 * pagina sin sesion se redirige al login del Core, pero una API tiene que
 * contestar 401 con JSON. Si una API redirigiera, el `fetch` del navegador
 * seguiria el 302 y se comeria la pagina de login del Core como si fuera la
 * respuesta, y el producto veria un error de parseo en lugar de "sin sesion".
 */

const SECRET = 'secreto-de-prueba-del-contrato-del-guard';

const config: AmgResolvedConfig = {
  coreUrl: 'https://core.test',
  productUrl: 'https://app.test',
  productSlug: 'app',
  audience: 'app',
  issuer: 'https://core.test',
  sessionCookie: 'app_session',
  callbackPath: '/auth/callback',
  clientId: 'app',
  clientSecret: SECRET,
  localSessionSecret: SECRET,
  introspectionUrl: 'https://core.test/api/sso/introspect',
  introspect: false,
  maxSessionSeconds: 900,
  loginTimeoutSeconds: 300,
};

const token = (over: Record<string, unknown> = {}) =>
  jwt.sign(
    {
      sub: 'usr_1',
      aud: 'app',
      iss: 'https://core.test',
      org_id: 'org_1',
      org_slug: 'alpha',
      role: 'member',
      email: 'persona@alpha.test',
      name: 'Persona',
      product: 'app',
      sid: 'ses_1',
      scope: 'product:access',
      ...over,
    },
    SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );

function app() {
  const a = express();
  a.use(cookieParser());
  a.use(mountAmgAuth(config, { productName: 'App' }));
  a.get('/api/datos', (_req, res) => {
    res.json({ ok: true });
  });
  a.get('/panel', (_req, res) => {
    res.type('html').send('<h1>panel</h1>');
  });
  return a;
}

describe('sin sesion', () => {
  it('una API responde 401 JSON con el loginUrl', async () => {
    const res = await request(app()).get('/api/datos');
    expect(res.status).toBe(401);
    expect(res.type).toContain('json');
    expect(res.body.error).toBe('sin-sesion');
    expect(res.body.loginUrl).toContain('/api/sso/authorize');
  });

  it('una API con POST responde 401 JSON y no redirige', async () => {
    const res = await request(app()).post('/api/datos').send({});
    expect(res.status).toBe(401);
    expect(res.type).toContain('json');
  });

  it('una pagina responde 302 al login del Core', async () => {
    const res = await request(app()).get('/panel');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });
});

describe('con sesion', () => {
  it('deja pasar a la API y expone req.amg', async () => {
    const res = await request(app()).get('/api/datos').set('Cookie', `app_session=${token()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('deja pasar a la pagina', async () => {
    const res = await request(app()).get('/panel').set('Cookie', `app_session=${token()}`);
    expect(res.status).toBe(200);
  });
});

describe('sesion invalida', () => {
  it('un token de otro producto da 401 JSON en una API, no un redirect', async () => {
    const falso = jwt.sign({ sub: 'usr_1', aud: 'otro', iss: 'https://core.test', org_id: 'org_1', role: 'member' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: '15m',
    });
    const res = await request(app()).get('/api/datos').set('Cookie', `app_session=${falso}`);
    expect(res.status).toBe(401);
    expect(res.type).toContain('json');
  });

  it('un token manipurado da 401 y borra la cookie', async () => {
    const partes = token().split('.');
    partes[2] = 'x'.repeat(partes[2].length);
    const res = await request(app()).get('/api/datos').set('Cookie', `app_session=${partes.join('.')}`);
    expect(res.status).toBe(401);
    expect(String(res.headers['set-cookie'])).toContain('app_session=');
  });
});

describe('rutas publicas', () => {
  it('deja pasar /health y /auth/* sin sesion', async () => {
    const a = express();
    a.use(mountAmgAuth(config));
    a.get('/health', (_req, res) => res.json({ ok: true }));
    a.get('/auth/callback', (_req, res) => res.status(400).send('sin codigo'));
    expect((await request(a).get('/health')).status).toBe(200);
    expect((await request(a).get('/auth/callback')).status).toBe(400);
  });
});
