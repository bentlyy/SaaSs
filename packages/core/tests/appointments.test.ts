import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';
import { createId } from '../src/db/id.js';
import { eq } from 'drizzle-orm';

let server: Server;
let base = '';
let cookie = '';

async function post(path: string, body: unknown) {
  return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
async function put(path: string, body: unknown) {
  return fetch(base + path, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}

/** Registra un usuario y devuelve ids de customer, service y staff ya creados */
async function seed(tenantSlug = 'appts-demo') {
  const reg = {
    businessName: 'Agenda Test', slug: tenantSlug, ownerName: 'Dueña', email: `due@${tenantSlug}.com`, password: 'secreto123',
  };
  const r = await post('/api/auth/register', reg);
  expect(r.status).toBe(201);
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];

  const { db } = getDb();
  const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, tenantSlug)).get()!;

  db.insert(schema.customers).values({ tenant_id: tenant.id, name: 'Ana Torres', phone: '551234' }).returning().get();
  db.insert(schema.customers).values({ tenant_id: tenant.id, name: 'Luis', phone: '551235' }).returning().get();
  const customers = db.select().from(schema.customers).where(eq(schema.customers.tenant_id, tenant.id)).all();
  const service = db.insert(schema.services).values({ tenant_id: tenant.id, name: 'Corte', durationMin: 30, price: 100 }).returning().get();
  const staff = db.insert(schema.staffMembers).values({ tenant_id: tenant.id, name: 'Sasha' }).returning().get();
  return { customer: customers[0], service, staff, tenant };
}

function startOfToday() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}

beforeAll(async () => {
  const app = createApp({ name: 'Appts', product: 'peluqueria' });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
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

describe('agenda (citas)', () => {
  it('crea una cita y la devuelve en el rango', async () => {
    const { customer, service, staff } = await seed();
    const start = startOfToday();
    start.setHours(10, 0, 0, 0);
    const res = await post('/api/appointments', {
      customerId: customer.id, staffId: staff.id, serviceIds: [service.id],
      startAt: start.toISOString(), durationMin: 30, status: 'confirmed',
    });
    expect(res.status).toBe(201);

    const from = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const list = await (await fetch(`${base}/api/appointments?from=${from}&to=${from}`, { headers: { cookie } })).json();
    expect(list.appointments).toHaveLength(1);
    expect(list.appointments[0].services[0].name).toBe('Corte');
  });

  it('bloquea solapamiento del mismo empleado (409)', async () => {
    const { customer, service, staff } = await seed();
    const start = startOfToday(); start.setHours(10, 0, 0, 0);
    const payload = { customerId: customer.id, staffId: staff.id, serviceIds: [service.id], startAt: start.toISOString(), durationMin: 60 };
    expect((await post('/api/appointments', payload)).status).toBe(201);
    // empieza a las 10:30 dentro del rango de la primera (10:00-11:00)
    start.setMinutes(30);
    const clash = await post('/api/appointments', { ...payload, startAt: start.toISOString() });
    expect(clash.status).toBe(409);
  });

  it('permite cita a otra hora sin conflicto', async () => {
    const { customer, service, staff } = await seed();
    const start = startOfToday(); start.setHours(10, 0, 0, 0);
    const first = await post('/api/appointments', { customerId: customer.id, staffId: staff.id, serviceIds: [service.id], startAt: start.toISOString(), durationMin: 60 });
    expect(first.status).toBe(201);
    // justo después, sin intersección
    start.setHours(11, 0, 0, 0);
    const second = await post('/api/appointments', { customerId: customer.id, staffId: staff.id, serviceIds: [service.id], startAt: start.toISOString(), durationMin: 60 });
    expect(second.status).toBe(201);
  });

  it('actualiza estado de la cita', async () => {
    const { customer, service, staff } = await seed();
    const start = startOfToday(); start.setHours(9, 0, 0, 0);
    const created = await (await post('/api/appointments', {
      customerId: customer.id, staffId: staff.id, serviceIds: [service.id], startAt: start.toISOString(), durationMin: 30,
    })).json();
    const res = await fetch(`${base}/api/appointments/${created.appointment.id}/status`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ status: 'noshow' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.appointment.status).toBe('noshow');
  });

  it('elimina cita', async () => {
    const { customer, service, staff } = await seed();
    const start = startOfToday(); start.setHours(9, 0, 0, 0);
    const created = await (await post('/api/appointments', {
      customerId: customer.id, staffId: staff.id, serviceIds: [service.id], startAt: start.toISOString(), durationMin: 30,
    })).json();
    const del = await fetch(`${base}/api/appointments/${created.appointment.id}`, { method: 'DELETE', headers: { cookie } });
    expect(del.status).toBe(200);
  });

  it('rechaza crear cita para un servicio inexistente', async () => {
    const { customer, staff } = await seed();
    const start = startOfToday(); start.setHours(9, 0, 0, 0);
    const res = await post('/api/appointments', {
      customerId: customer.id, staffId: staff.id, serviceIds: [createId('svc')], startAt: start.toISOString(), durationMin: 30,
    });
    expect(res.status).toBe(400);
  });

  it('validación: sin servicios falla', async () => {
    const { customer } = await seed();
    const start = startOfToday(); start.setHours(9, 0, 0, 0);
    const res = await post('/api/appointments', { customerId: customer.id, serviceIds: [], startAt: start.toISOString(), durationMin: 30 });
    expect(res.status).toBe(400);
  });
});