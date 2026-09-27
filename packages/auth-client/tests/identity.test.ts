import { describe, expect, it, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { verifyIdentity, exchangeCode, introspect } from '../src/identity.js';
import { buildLoginUrl, isSafeReturnTo, redirectUriFor } from '../src/login.js';
import { encodeIdentityCookie, decodeIdentityCookie } from '../src/session.js';
import type { AmgConfig } from '../src/config.js';

const CORE = 'https://desarrollador.amgdeveloper.cl';
const ISSUER = CORE;

function config(clientId: string, secret: string): AmgConfig {
  return {
    coreUrl: CORE,
    productUrl: `https://${clientId}.amgdeveloper.cl`,
    clientId,
    clientSecret: secret,
  };
}

const SECRETO_INVENTARIO = 'secreto-inventario-para-pruebas-1234';
const SECRETO_COTIZACIONES = 'secreto-cotizaciones-para-pruebas-99';

function claims(over: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    aud: 'inventario',
    sub: 'usr_1',
    org_id: 'org_1',
    org_slug: 'mi-empresa',
    role: 'owner',
    email: 'ana@ejemplo.cl',
    name: 'Ana',
    product: 'inventario',
    scope: 'product:access',
    sid: 'ses_1',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    ...over,
  };
}

function firmar(over: Record<string, unknown> = {}, secret = SECRETO_INVENTARIO) {
  return jwt.sign(claims(over), secret, { algorithm: 'HS256', noTimestamp: true });
}

describe('verifyIdentity', () => {
  it('acepta un token bien firmado de SU producto', () => {
    const res = verifyIdentity(firmar(), config('inventario', SECRETO_INVENTARIO));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.identity.userId).toBe('usr_1');
    expect(res.identity.organizationId).toBe('org_1');
    expect(res.identity.role).toBe('owner');
    expect(res.identity.organizationSlug).toBe('mi-empresa');
  });

  it('rechaza el mismo token en otro producto (secreto distinto)', () => {
    const token = firmar();
    const res = verifyIdentity(token, config('cotizaciones', SECRETO_COTIZACIONES));
    expect(res.ok).toBe(false);
  });

  it('rechaza si el aud no corresponde, aunque la firma sea válida', () => {
    // Firmado con el secreto CORRECTO de inventario pero con aud de otro producto:
    // pasa la firma y falla la audiencia. Por eso la audiencia va explícita.
    const token = firmar({ aud: 'cotizaciones', product: 'cotizaciones' });
    const res = verifyIdentity(token, config('inventario', SECRETO_INVENTARIO));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(['audiencia', 'otro-producto']).toContain(res.reason);
  });

  it('rechaza un token expirado con un motivo claro', () => {
    const token = firmar({ exp: Math.floor(Date.now() / 1000) - 10 }, SECRETO_INVENTARIO);
    const res = verifyIdentity(token, config('inventario', SECRETO_INVENTARIO));
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe('expirado');
  });

  it('rechaza un token sin organización o sin rol válido', () => {
    expect(verifyIdentity(firmar({ org_id: '' }), config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
    expect(verifyIdentity(firmar({ role: 'superadmin' }), config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
    expect(verifyIdentity(firmar({ scope: 'admin:all' }), config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
  });

  it('no acepta un token firmado con el algoritmo "none"', () => {
    // ataque clásico de JWT: header alg:none para que no verifique firma.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
    const token = `${header}.${body}.`;
    expect(verifyIdentity(token, config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
  });

  it('no acepta basura', () => {
    expect(verifyIdentity('', config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
    expect(verifyIdentity('abc', config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
    expect(verifyIdentity('a.b.c', config('inventario', SECRETO_INVENTARIO)).ok).toBe(false);
  });
});

describe('buildLoginUrl', () => {
  it('apunta a /api/sso/authorize del Core con la callback del producto', () => {
    const url = new URL(buildLoginUrl({ coreUrl: CORE, clientId: 'inventario', productUrl: 'https://stock.amgdeveloper.cl', callbackPath: '/auth/callback' }));
    expect(url.origin + url.pathname).toBe(`${CORE}/api/sso/authorize`);
    expect(url.searchParams.get('client_id')).toBe('inventario');
    expect(url.searchParams.get('redirect_uri')).toBe('https://stock.amgdeveloper.cl/auth/callback');
  });

  it('no manda un return_to fuera del producto', () => {
    const base = { coreUrl: CORE, clientId: 'inventario', productUrl: 'https://stock.amgdeveloper.cl', callbackPath: '/auth/callback' };
    expect(isSafeReturnTo('/inventario/stock')).toBe(true);
    expect(isSafeReturnTo('//malo.com')).toBe(false);
    expect(isSafeReturnTo('https://malo.com')).toBe(false);
    expect(isSafeReturnTo('/\\malo.com')).toBe(false);

    const limpio = new URL(buildLoginUrl(base, 'https://malo.com/robo'));
    expect(limpio.searchParams.get('return_to')).toBeNull();
  });

  it('redirectUriFor une producto y callback sin doble barra', () => {
    expect(redirectUriFor({ productUrl: 'https://x.cl/', callbackPath: '/auth/callback' })).toBe('https://x.cl/auth/callback');
  });
});

describe('exchangeCode', () => {
  it('canjea un código y devuelve identidad verificada', async () => {
    const token = firmar();
    const res = await exchangeCode('el-codigo', config('inventario', SECRETO_INVENTARIO), 'https://stock.amgdeveloper.cl/auth/callback', async () =>
      new Response(JSON.stringify({ access_token: token }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.identity.userId).toBe('usr_1');
  });

  it('propaga el error del Core sin tragárselo', async () => {
    const res = await exchangeCode('malo', config('inventario', SECRETO_INVENTARIO), 'https://x/auth/callback', async () =>
      new Response(JSON.stringify({ error: 'El código ya fue usado' }), { status: 401, headers: { 'content-type': 'application/json' } }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.status).toBe(401);
    expect(res.reason).toContain('ya fue usado');
  });

  it('avisa que el problema es de configuración si el Core devuelve un token inválido', async () => {
    const otro = firmar({}, SECRETO_COTIZACIONES);
    const res = await exchangeCode('x', config('inventario', SECRETO_INVENTARIO), 'https://x/auth/callback', async () =>
      new Response(JSON.stringify({ access_token: otro }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('AMG_SSO_CLIENT_SECRET');
  });

  it('si el Core no responde, lo dice como problema del Core', async () => {
    const res = await exchangeCode('x', config('inventario', SECRETO_INVENTARIO), 'https://x/auth/callback', async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toContain('Core');
  });
});

describe('introspect', () => {
  it('informa que el Core caído sin lanzar', async () => {
    const res = await introspect('token', config('inventario', SECRETO_INVENTARIO), async () => {
      throw new Error('red caída');
    });
    expect(res.ok).toBe(false);
  });

  it('traduce la respuesta del Core', async () => {
    const res = await introspect('token', config('inventario', SECRETO_INVENTARIO), async () =>
      new Response(JSON.stringify({ active: true, user_id: 'usr_1', organization_id: 'org_1', role: 'admin' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.active).toBe(true);
    expect(res.identity?.role).toBe('admin');
  });
});

describe('cookie de identidad compacta', () => {
  it('firma y verifica con el secreto del producto', () => {
    const identidad = verifyIdentity(firmar(), config('inventario', SECRETO_INVENTARIO));
    if (!identidad.ok) throw new Error('token inválido en el test');
    const cookie = encodeIdentityCookie(identidad.identity, SECRETO_INVENTARIO);
    const leida = decodeIdentityCookie(cookie, SECRETO_INVENTARIO, 'inventario');
    expect(leida?.userId).toBe('usr_1');
    expect(leida?.role).toBe('owner');
  });

  it('con otro secreto NO se puede leer', () => {
    const identidad = verifyIdentity(firmar(), config('inventario', SECRETO_INVENTARIO));
    if (!identidad.ok) throw new Error('token inválido en el test');
    const cookie = encodeIdentityCookie(identidad.identity, SECRETO_INVENTARIO);
    expect(decodeIdentityCookie(cookie, SECRETO_COTIZACIONES, 'inventario')).toBeNull();
  });

  it('específica del producto: no sirve en otro', () => {
    const identidad = verifyIdentity(firmar(), config('inventario', SECRETO_INVENTARIO));
    if (!identidad.ok) throw new Error('token inválido en el test');
    const cookie = encodeIdentityCookie(identidad.identity, SECRETO_INVENTARIO);
    expect(decodeIdentityCookie(cookie, SECRETO_INVENTARIO, 'cotizaciones')).toBeNull();
  });

  it('rechaza un valor manipulado', () => {
    const identidad = verifyIdentity(firmar(), config('inventario', SECRETO_INVENTARIO));
    if (!identidad.ok) throw new Error('token inválido en el test');
    const cookie = encodeIdentityCookie(identidad.identity, SECRETO_INVENTARIO);
    const [body, mac] = cookie.split('.') as [string, string];
    const forjado = Buffer.from(
      JSON.stringify({ userId: 'usr_1', organizationId: 'org_ajeno', role: 'owner', product: 'inventario', sessionId: 'x', accessToken: '', expiresAt: 0 }),
    ).toString('base64url');
    expect(decodeIdentityCookie(`${forjado}.${mac}`, SECRETO_INVENTARIO, 'inventario')).toBeNull();
    expect(decodeIdentityCookie(`${body}.${mac}x`, SECRETO_INVENTARIO, 'inventario')).toBeNull();
    expect(decodeIdentityCookie('basura', SECRETO_INVENTARIO, 'inventario')).toBeNull();
  });
});

describe('fuerza bruta de secretos', () => {
  it('1000 secretos inventarios no adivinan el real', () => {
    const token = firmar();
    const cfg = config('inventario', SECRETO_INVENTARIO);
    let aciertos = 0;
    for (let i = 0; i < 1000; i += 1) {
      if (verifyIdentity(token, config('inventario', `falso-${randomBytes(16).toString('hex')}`)).ok) aciertos += 1;
    }
    expect(aciertos).toBe(0);
    expect(verifyIdentity(token, cfg).ok).toBe(true);
  });
});
