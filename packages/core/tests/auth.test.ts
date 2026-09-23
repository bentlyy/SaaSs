import { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';
import { eq } from 'drizzle-orm';

let server: Server;
let base: string;
let cookie = '';

const annualRegister = {
  businessName: 'Pruebas Barbería',
  slug: 'pruebas-bb',
  ownerName: 'Prueba Owner',
  email: 'owner@prueba.com',
  password: 'secreto123',
};

beforeAll(async () => {
  const app = createApp({ name: 'Pruebas', product: 'peluqueria' });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' ? addr!.port : addr}`;
});

beforeEach(async () => {
  const { sqlite } = getDb();
  sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
               DELETE FROM documents; DELETE FROM inventory_movements; DELETE FROM inventory_items;
               DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
               DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
  cookie = '';
});

afterAll(() => server.close());

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, ...headers },
    body: JSON.stringify(body),
  });
}
async function get(path: string) {
  return fetch(base + path, { headers: { cookie } });
}

async function registerOnce() {
  const db = getDb().db;
  const exists = db.select().from(schema.tenants).where(eq(schema.tenants.slug, annualRegister.slug)).get();
  const res = await post('/api/auth/register', annualRegister);
  if (res.ok) {
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
    return res;
  }
  const { users, tenants } = schema;
  const tenant = exists ?? db.select().from(tenants).where(eq(tenants.slug, annualRegister.slug)).get();
  const user = tenant ? db.select().from(users).where(eq(users.tenant_id, tenant.id)).get() : null;
  cookie = 'token=' + 'ignored';
  return res;
}

describe('auth', () => {
  it('registra y crea cuenta (tenant + owner)', async () => {
    const res = await registerOnce();
    expect(res.status).toBe(201);
    const { db } = getDb();
    const tenant = db.select().from(schema.tenants).get();
    expect(tenant?.name).toBe('Pruebas Barbería');
  });

  it('rechaza slug duplicado', async () => {
    await registerOnce();
    const res = await post('/api/auth/register', { ...annualRegister, email: 'otro@prueba.com' });
    expect(res.status).toBe(409);
  });

  it('login correcto devuelve sesión', async () => {
    await registerOnce();
    const res = await post('/api/auth/login', { slug: annualRegister.slug, email: annualRegister.email, password: annualRegister.password });
    expect(res.status).toBe(200);
    cookie = (res.headers.get('set-cookie') ?? '').split(';')[0];
  });

  it('login con contraseña incorrecta -> 401', async () => {
    await registerOnce();
    const res = await post('/api/auth/login', { slug: annualRegister.slug, email: annualRegister.email, password: 'incorrecta' });
    expect(res.status).toBe(401);
  });

  it('me devuelve el negocio con sesión válida', async () => {
    await registerOnce();
    const res = await get('/api/auth/me');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant.name).toBe('Pruebas Barbería');
  });

  it('me rechaza sin sesión', async () => {
    const res = await get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});