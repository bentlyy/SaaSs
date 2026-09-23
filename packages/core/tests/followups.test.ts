import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, gte } from 'drizzle-orm';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';

let server: Server;
let base = '';
let cookie = '';

async function post(path: string, body: unknown) {
  return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
async function get(path: string) {
  return fetch(base + path, { headers: { cookie } });
}
async function put(path: string, body: unknown) {
  return fetch(base + path, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
async function del(path: string) {
  return fetch(base + path, { method: 'DELETE', headers: { cookie } });
}

async function currentTenant() {
  const { db } = getDb();
  const session = (await (await get('/api/auth/me')).json()) as { session: { tenantId: string } };
  return db.select().from(schema.tenants).where(eq(schema.tenants.id, session.session.tenantId)).get()!;
}

function addCustomer(tenantId: string, name = 'Rosa', extra: Record<string, unknown> = {}) {
  const { db } = getDb();
  return db.insert(schema.customers).values({
    tenant_id: tenantId, name, phone: '+5299999', email: 'rosa@test.com', tags: 'vip,frecuente', ...extra,
  }).returning().get();
}

function addFollowup(tenantId: string, customerId: string, title: string, dueDate: string, status = 'pending') {
  const { db } = getDb();
  const now = new Date().toISOString();
  return db.insert(schema.followups).values({
    tenant_id: tenantId, customer_id: customerId, title, due_date: dueDate, status, created_at: now, updated_at: now,
  }).returning().get();
}

function addAppointment(tenantId: string, customerId: string, hoursFromNow: number, status: string) {
  const { db } = getDb();
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  return db.insert(schema.appointments).values({
    tenant_id: tenantId,
    customer_id: customerId,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
    status,
  }).returning().get();
}

describe('followups (API /api/followups)', () => {
  beforeAll(async () => {
    const app = createApp({
      name: 'CRM', product: 'crm',
      routers: { customers: true, followups: true, appointments: true, services: true, staff: true },
    });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' ? addr!.port : addr}`;
  });

  afterAll(() => server.close());

  beforeEach(async () => {
    const { sqlite } = getDb();
    sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
                 DELETE FROM staff_services; DELETE FROM followups; DELETE FROM services; DELETE FROM staff;
                 DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
    cookie = '';
    const r = await post('/api/auth/register', {
      businessName: 'CRM Test', slug: 'crm-api', ownerName: 'Dueño', email: 'own@crm-api.com', password: 'secreto123',
    });
    expect(r.status).toBe(201);
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  });

  it('arranca vacío: lista y stats en ceros', async () => {
    const list = await (await get('/api/followups')).json();
    expect(list.followups).toEqual([]);
    const stats = await (await get('/api/followups/stats')).json();
    expect(stats.customers.total).toBe(0);
    expect(stats.followups.total).toBe(0);
    expect(stats.visits.upcoming7).toBe(0);
  });

  it('crea un seguimiento y lo devuelve con el cliente', async () => {
    const tenant = await currentTenant();
    const c = addCustomer(tenant.id);
    const res = await post('/api/followups', { customerId: c.id, title: 'Llamar para propuesta', dueDate: '2026-09-30' });
    expect(res.status).toBe(201);
    const { followup } = await res.json();
    expect(followup.status).toBe('pending');
    expect(followup.due_date).toBe('2026-09-30');

    const list = await (await get('/api/followups')).json();
    expect(list.followups).toHaveLength(1);
    expect(list.followups[0].customer.name).toBe('Rosa');
    expect(list.followups[0].overdue).toBe(false);
  });

  it('filtra por estado y marca vencidos', async () => {
    const tenant = await currentTenant();
    const c = addCustomer(tenant.id);
    addFollowup(tenant.id, c.id, 'Ayer', '2000-01-01', 'pending');
    addFollowup(tenant.id, c.id, 'Futuro', '2030-01-01', 'pending');
    addFollowup(tenant.id, c.id, 'Hecho', '2030-01-01', 'done');

    const overdue = await (await get('/api/followups?overdue=1')).json();
    expect(overdue.followups).toHaveLength(1);
    expect(overdue.followups[0].title).toBe('Ayer');
    expect(overdue.followups[0].overdue).toBe(true);

    const done = await (await get('/api/followups?status=done')).json();
    expect(done.followups).toHaveLength(1);
    expect(done.followups[0].title).toBe('Hecho');
  });

  it('actualiza título y estado', async () => {
    const tenant = await currentTenant();
    const c = addCustomer(tenant.id);
    const f = addFollowup(tenant.id, c.id, 'Original', '2026-12-01');
    const res = await put(`/api/followups/${f.id}`, { title: 'Actualizado', status: 'done' });
    expect(res.status).toBe(200);
    const { followup } = await res.json();
    expect(followup.title).toBe('Actualizado');
    expect(followup.status).toBe('done');
  });

  it('elimina un seguimiento', async () => {
    const tenant = await currentTenant();
    const c = addCustomer(tenant.id);
    const f = addFollowup(tenant.id, c.id, 'Borrar', '2026-12-01');
    const res = await del(`/api/followups/${f.id}`);
    expect(res.status).toBe(200);
    const list = await (await get('/api/followups')).json();
    expect(list.followups).toHaveLength(0);
  });

  it('no expone seguimientos de otro tenant', async () => {
    const tenant = await currentTenant();
    const c = addCustomer(tenant.id);
    const f = addFollowup(tenant.id, c.id, 'Privado', '2026-12-01');

    const reg2 = await post('/api/auth/register', {
      businessName: 'Otro', slug: 'crm-other', ownerName: 'Ximo', email: 'x@otro.com', password: 'secreto123',
    });
    cookie = (reg2.headers.get('set-cookie') ?? '').split(';')[0];
    const list = await (await get('/api/followups')).json();
    expect(list.followups).toHaveLength(0);

    const tryDel = await del(`/api/followups/${f.id}`);
    expect(tryDel.status).toBe(404);
  });

  it('stats agrega cartera, etiquetas, actividad y seguimientos', async () => {
    const tenant = await currentTenant();
    const c1 = addCustomer(tenant.id, 'Rosa', { tags: 'vip,frecuente' });
    addCustomer(tenant.id, 'Luis', { tags: 'vip', phone: '' });
    addCustomer(tenant.id, 'Ana', { email: '', phone: '', tags: '' });

    addAppointment(tenant.id, c1.id, -72, 'done');
    addAppointment(tenant.id, c1.id, 48, 'confirmed');
    addFollowup(tenant.id, c1.id, 'Vencer ayer', '2000-01-01', 'pending');
    addFollowup(tenant.id, c1.id, 'Listo', '2030-01-01', 'done');

    const stats = await (await get('/api/followups/stats')).json();
    expect(stats.customers).toEqual({ total: 3, withEmail: 2, withPhone: 1, withBoth: 1 });
    expect(stats.tags).toEqual(expect.arrayContaining([
      { tag: 'vip', count: 2 }, { tag: 'frecuente', count: 1 },
    ]));
    expect(stats.followups).toMatchObject({ pending: 1, overdue: 1, done: 1, total: 2 });
    expect(stats.visits).toMatchObject({ done30: 1, upcoming7: 1 });
  });

  it('GET /customers/:id resume visitas y seguimientos del cliente', async () => {
    const tenant = await currentTenant();
    const c = addCustomer(tenant.id);
    addAppointment(tenant.id, c.id, -48, 'done');
    addAppointment(tenant.id, c.id, -120, 'done');
    addAppointment(tenant.id, c.id, 24, 'confirmed');
    addFollowup(tenant.id, c.id, 'Pendiente 1', '2026-12-01');
    addFollowup(tenant.id, c.id, 'Pendiente 2', '2026-11-01');

    const res = await get(`/api/customers/${c.id}`);
    expect(res.status).toBe(200);
    const { customer } = await res.json();
    expect(customer.visits).toBe(2);
    expect(customer.lastVisit).not.toBeNull();
    expect(customer.nextVisit).not.toBeNull();
    expect(customer.followupsPending).toHaveLength(2);
  });
});