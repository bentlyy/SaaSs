import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { Router } from 'express';
import { z } from 'zod';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { crudRouter } from '../src/crud.js';
import { orgId } from '../src/auth.js';
import type { ProductDefinition } from '../src/app.js';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '../src/testing.js';

/**
 * Tests del runtime, no de un producto.
 *
 * Lo que se prueba aca es lo que todos los productos dan por sentado: que sin
 * sesion no se entra, que la organizacion sale de la sesion, y que Org A no
 * puede leer ni borrar lo de Org B. Si esto se rompe, se rompe en los nueve.
 */

const cosas = sqliteTable('cosas', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  nombre: text('nombre').notNull(),
  cantidad: integer('cantidad').notNull().default(0),
  estado: text('estado').notNull().default('pendiente'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at'),
});

const DDL = `
CREATE TABLE IF NOT EXISTS cosas (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  nombre TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  created_at TEXT NOT NULL,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cosas_org ON cosas(organization_id);
`;

const ESTADOS = ['pendiente', 'pagado', 'anulado'] as const;

const def: ProductDefinition = {
  slug: 'prueba',
  name: 'Producto de Prueba',
  schema: { cosas },
  ddl: DDL,
  routes: (ctx) => [
    Router().use(
      '/api/cosas',
      crudRouter(ctx.handle, {
        table: cosas,
        fields: { nombre: {}, cantidad: {}, estado: {} },
        idPrefix: 'cosa',
        search: [cosas.nombre],
        filters: { estado: { column: cosas.estado, schema: z.enum(ESTADOS) } },
      }),
    ),
  ],
};

let tp: TestProduct;

beforeAll(() => {
  tp = startTestProduct(def);
});

afterAll(() => tp.close());

describe('salud y meta', () => {
  it('responde /health sin sesion', async () => {
    const res = await tp.anon().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, product: 'prueba' });
  });

  it('responde /api/meta sin sesion', async () => {
    const res = await tp.anon().get('/api/meta');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ product: 'prueba', identity: 'amg-central' });
  });
});

describe('no hay login propio', () => {
  it('no expone /api/auth/login, /register ni /logout', async () => {
    // El guard corre antes que el router, asi que estos caminos nunca llegan a
    // un 404: dan 401. Lo que no puede pasar es que devuelvan sesion.
    for (const ruta of ['/api/auth/login', '/api/auth/register', '/api/auth/logout']) {
      const res = await tp.as().post(ruta).send({ email: 'x@y.z', password: '12345678' });
      expect(res.status, ruta).toBe(401);
      expect(res.headers['set-cookie'], `${ruta} no debe abrir sesion`).toBeUndefined();
    }
  });

  it('no tiene tabla de usuarios ni de contrasenas', () => {
    // El DDL del producto es la unica fuente de tablas: si no las declara, no
    // existen. Este es el test que hace verdadera la regla "cada producto se
    // queda solo con lo que necesita".
    const tablas = tp.tables();
    expect(tablas).toContain('cosas');
    for (const prohibida of ['users', 'tenants', 'password_hash']) {
      expect(tablas).not.toContain(prohibida);
    }
  });
});

describe('sesion', () => {
  it('rechaza sin sesion (401)', async () => {
    const res = await tp.anon().get('/api/cosas');
    expect(res.status).toBe(401);
  });

  it('rechaza un token de otro producto (401)', async () => {
    const res = await tp.as({ product: 'otro-producto' }).get('/api/cosas');
    expect(res.status).toBe(401);
  });

  it('rechaza un token firmado con otro secreto (401)', async () => {
    const req = tp.anon();
    // mismo payload, firma invalida
    const falso = tp.token({ orgId: TEST_ORG_A }).split('.');
    falso[2] = 'x'.repeat(falso[2].length);
    const res = await req.get('/api/cosas').set('Cookie', `app_session=${falso.join('.')}`);
    expect(res.status).toBe(401);
  });

  it('acepta con sesion valida y dice quien sos', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('prueba');
  });
});

describe('aislamiento entre organizaciones', () => {
  it('rechaza organization_id en el cuerpo y no crea nada', async () => {
    // Antes este caso pasaba con 201: la clave ajena se descartaba en silencio y
    // la fila quedaba en la org de la sesion. Rechazar el 400 es mas fuerte --no
    // se escribe nada-- y ademas deja la maniobra a la vista en vez de
    // convertirla en un alta silenciosa.
    const res = await tp
      .as({ orgId: TEST_ORG_A })
      .post('/api/cosas')
      .send({ nombre: 'Cosa de Alpha', cantidad: 3, organization_id: TEST_ORG_B });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('organization_id');

    // Ni en la propia ni en la ajena: la escalada sigue siendo imposible.
    expect((await tp.as({ orgId: TEST_ORG_A }).get('/api/cosas')).body.items).toHaveLength(0);
    expect((await tp.as({ orgId: TEST_ORG_B }).get('/api/cosas')).body.items).toHaveLength(0);
  });

  it('crea en la organizacion de la sesion', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).post('/api/cosas').send({ nombre: 'Cosa de Alpha', cantidad: 3 });
    expect(res.status).toBe(201);
    const enBeta = await tp.as({ orgId: TEST_ORG_B }).get('/api/cosas');
    expect(enBeta.body.items).toHaveLength(0);
  });

  it('Org B no lista, no ve, no edita y no borra lo de Org A', async () => {
    const creada = await tp.as({ orgId: TEST_ORG_A }).post('/api/cosas').send({ nombre: 'Privada', cantidad: 1 });
    const id = creada.body.id;

    expect((await tp.as({ orgId: TEST_ORG_B }).get('/api/cosas')).body.items).toHaveLength(0);
    expect((await tp.as({ orgId: TEST_ORG_B }).get(`/api/cosas/${id}`)).status).toBe(404);
    expect((await tp.as({ orgId: TEST_ORG_B }).patch(`/api/cosas/${id}`).send({ nombre: 'Secuestrada' })).status).toBe(404);
    expect((await tp.as({ orgId: TEST_ORG_B }).delete(`/api/cosas/${id}`)).status).toBe(404);

    // Y sigue intacta para su dueña
    const intacta = await tp.as({ orgId: TEST_ORG_A }).get(`/api/cosas/${id}`);
    expect(intacta.status).toBe(200);
    expect(intacta.body.nombre).toBe('Privada');
  });

  it('la busqueda no se sale de la propia organizacion', async () => {
    await tp.as({ orgId: TEST_ORG_B }).post('/api/cosas').send({ nombre: 'Unica de Beta', cantidad: 7 });

    const enAlpha = await tp.as({ orgId: TEST_ORG_A }).get('/api/cosas?q=Beta');
    expect(enAlpha.body.items).toHaveLength(0);

    const enBeta = await tp.as({ orgId: TEST_ORG_B }).get('/api/cosas?q=Beta');
    expect(enBeta.body.items).toHaveLength(1);
  });

  it('orgId() tira si no hay identidad', () => {
    expect(() => orgId({} as any)).toThrow();
  });
});

describe('campos desconocidos en el cuerpo', () => {
  it('un campo mal escrito se rechaza y dice cual es', async () => {
    // Sin esto, un `emial` mal tecleado se descartaba en silencio y el alta salia
    // con el correo vacio: el usuario creia que lo habia guardado.
    const res = await tp
      .as({ orgId: TEST_ORG_A })
      .post('/api/cosas')
      .send({ nombre: 'Con correo', emial: 'casi@diez.cl' });
    expect(res.status).toBe(400);
    const mensaje = JSON.stringify(res.body);
    expect(mensaje).toContain('emial');
    expect(mensaje).toContain('Campo desconocido');
  });

  it('el rechazo no deja la fila a medias', async () => {
    await tp.as({ orgId: TEST_ORG_A }).post('/api/cosas').send({ nombre: 'A medias', cantidad: 2, sobra: true });
    const lista = await tp.as({ orgId: TEST_ORG_A }).get('/api/cosas?limit=100');
    expect(lista.body.items.some((i: any) => i.nombre === 'A medias')).toBe(false);
  });

  it('tambien en PATCH, sin pisar lo que ya estaba', async () => {
    const creada = await tp.as({ orgId: TEST_ORG_A }).post('/api/cosas').send({ nombre: 'Original', cantidad: 1 });
    const id = creada.body.id;

    const mal = await tp.as({ orgId: TEST_ORG_A }).patch(`/api/cosas/${id}`).send({ nombrez: 'Cambio' });
    expect(mal.status).toBe(400);

    const sigue = await tp.as({ orgId: TEST_ORG_A }).get(`/api/cosas/${id}`);
    expect(sigue.body.nombre).toBe('Original');
  });

  it('un campo de solo lectura tampoco se acepta para escribir', async () => {
    const creada = await tp.as({ orgId: TEST_ORG_A }).post('/api/cosas').send({ nombre: 'Normal', cantidad: 1 });
    const falso = await tp
      .as({ orgId: TEST_ORG_A })
      .patch(`/api/cosas/${creada.body.id}`)
      .send({ created_at: '1999-01-01T00:00:00.000Z' });
    expect(falso.status).toBe(400);
  });
});

describe('filtros declarados del listado', () => {
  it('filtra de verdad en vez de ignorar el query', async () => {
    const org = TEST_ORG_A;
    await tp.as({ orgId: org }).post('/api/cosas').send({ nombre: 'F-A', estado: 'pendiente' });
    await tp.as({ orgId: org }).post('/api/cosas').send({ nombre: 'F-B', estado: 'pagado' });
    await tp.as({ orgId: org }).post('/api/cosas').send({ nombre: 'F-C', estado: 'pagado' });

    const pagadas = await tp.as({ orgId: org }).get('/api/cosas?estado=pagado');
    expect(pagadas.status).toBe(200);
    expect(pagadas.body.items.map((i: any) => i.nombre).sort()).toEqual(['F-B', 'F-C']);
    expect(pagadas.body.total).toBe(2);

    // Sin filtro salen todas: el filtro no se queda pegado.
    const todas = await tp.as({ orgId: org }).get('/api/cosas');
    expect(todas.body.total).toBeGreaterThan(2);
  });

  it('un valor que no existe es 400, no una lista sin filtrar', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/cosas?estado=inventado');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/estado/i);
  });

  it('un filtro sin valor devuelve todo, no una lista vacia', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/cosas?estado=');
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('un filtro no declarado no filtra nada ni se cuela en la consulta', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/cosas?organization_id=otra-cosa');
    expect(res.status).toBe(200);
    expect(res.body.items.every((i: any) => i.organizationId === TEST_ORG_A)).toBe(true);
  });
});
