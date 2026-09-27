import jwt from 'jsonwebtoken';
import request, { type Test as SupertestTest } from 'supertest';
import type { Express } from 'express';
import { createProductApp, type ProductDefinition } from './app.js';
import type { ProductDb } from './db.js';
import type { Identity } from './auth.js';

/**
 * Arranque de una aplicacion para tests, con identidad AMG de verdad.
 *
 * No se falsea `req.amg` a mano: se firma un JWT con el secreto del producto y
 * se manda en la cookie, exactamente como lo haria el Core. Asi el test
 * ejercita la verificacion real (firma, `aud`, `iss`) y no una version
 * recortada que podria quedar mas permisiva que la de produccion.
 */

export const TEST_CLIENT_SECRET = 'secreto-de-prueba-para-los-tests-no-usar-en-produccion';
export const TEST_ORG_A = 'org_alpha_000000000000';
export const TEST_ORG_B = 'org_beta_000000000000000';
export const TEST_CORE_URL = 'https://core.test';

export interface AsOptions {
  orgId?: string;
  role?: Identity['role'];
  userId?: string;
  email?: string;
  name?: string;
  /** Para probar que un token de otro producto no abre este. */
  product?: string;
}

type Agent = ReturnType<typeof request>;

export interface TestProduct {
  app: Express;
  /** Para inspeccionar el esquema real de la base del producto. */
  sqlite: ProductDb['sqlite'];
  /** Cliente sin sesion: lo protegido tiene que dar 401. */
  anon: () => Client;
  /** Cliente como un miembro de una organizacion. */
  as: (options?: AsOptions) => Client;
  token: (options?: AsOptions) => string;
  cookie: (options?: AsOptions) => string;
  /** Tablas que el producto declaro. */
  tables: () => string[];
  close: () => void;
}

/** Cliente de pruebas: cada peticion sale con la cookie de su sesion. */
export interface Client {
  get(path: string): SupertestTest;
  post(path: string, body?: unknown): SupertestTest;
  put(path: string, body?: unknown): SupertestTest;
  patch(path: string, body?: unknown): SupertestTest;
  delete(path: string): SupertestTest;
}

export function startTestProduct(def: ProductDefinition, env: NodeJS.ProcessEnv = {}): TestProduct {
  const base: NodeJS.ProcessEnv = {
    NODE_ENV: 'test',
    DB_PATH: ':memory:',
    APP_URL: `https://${def.slug}.test`,
    CORE_URL: TEST_CORE_URL,
    AMG_SSO_CLIENT_ID: def.slug,
    AMG_SSO_CLIENT_SECRET: TEST_CLIENT_SECRET,
    ...env,
  };

  const { app, db } = createProductApp(def, base);

  const token = (options: AsOptions = {}): string =>
    jwt.sign(
      {
        sub: options.userId ?? 'usr_test_0000000000000000',
        aud: options.product ?? def.slug,
        iss: TEST_CORE_URL,
        org_id: options.orgId ?? TEST_ORG_A,
        org_slug: (options.orgId ?? TEST_ORG_A) === TEST_ORG_A ? 'alpha' : 'beta',
        role: options.role ?? 'member',
        email: options.email ?? 'persona@alpha.test',
        name: options.name ?? 'Persona de Prueba',
        product: options.product ?? def.slug,
        sid: 'ses_test_000000000000000000',
        scope: 'product:access',
      },
      TEST_CLIENT_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' },
    );

  const cookie = (options: AsOptions = {}): string => `app_session=${token(options)}`;

  /**
   * Cliente con la cookie ya puesta en cada peticion.
   *
   * Se devuelve un cliente y no un agent porque el agent de supertest no tiene
   * `.set()`: la cookie tiene que ir en la peticion concreta, y armarla aca es
   * lo que evita que un test se olvide de mandarla.
   */
  const client = (options?: AsOptions): Client => {
    const withCookie = (req: SupertestTest): SupertestTest =>
      options ? (req.set('Cookie', cookie(options)) as SupertestTest) : req;
    return {
      get: (path) => withCookie(request(app).get(path)),
      post: (path, body) => withCookie(request(app).post(path).send(body ?? {})),
      put: (path, body) => withCookie(request(app).put(path).send(body ?? {})),
      patch: (path, body) => withCookie(request(app).patch(path).send(body ?? {})),
      delete: (path) => withCookie(request(app).delete(path)),
    };
  };

  return {
    app,
    sqlite: db.sqlite,
    token,
    cookie,
    anon: () => client(),
    as: client,
    tables: () =>
      (db.sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>)
        .map((r) => r.name)
        .filter((n) => !n.startsWith('sqlite_')),
    close: () => db.close(),
  };
}
