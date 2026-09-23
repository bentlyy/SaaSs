import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';
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
async function patch(path: string, body: unknown) {
  return fetch(base + path, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
async function del(path: string) {
  return fetch(base + path, { method: 'DELETE', headers: { cookie } });
}

async function register(slug = 'tall-demo') {
  const r = await post('/api/auth/register', {
    businessName: 'Taller Test', slug, ownerName: 'Dueño', email: `own@${slug}.com`, password: 'secreto123',
  });
  expect(r.status).toBe(201);
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const { db } = getDb();
  const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).get()!;
  const customer = db.insert(schema.customers).values({ tenant_id: tenant.id, name: 'Ana Reyes' }).returning().get();
  const staff = db.insert(schema.staffMembers).values({ tenant_id: tenant.id, name: 'Mec. Luis' }).returning().get();
  const service = db.insert(schema.services).values({
    tenant_id: tenant.id, name: 'Cambio de frenos', durationMin: 90, price: 4000,
  }).returning().get();
  const item = db.insert(schema.inventoryItems).values({
    tenant_id: tenant.id, name: 'Juego balatas', quantity: 10, minQty: 2, unit: 'juego', price: 6000,
  }).returning().get();
  return { tenant, customer, staff, service, item };
}

function orderBody(customerId: string, opts: Record<string, unknown> = {}) {
  return {
    customerId,
    vehicle: { make: 'Nissan', model: 'Versa', plate: 'A123BCD', year: 2018, odo: 84500 },
    ...opts,
  };
}

beforeAll(async () => {
  const app = createApp({ name: 'Talleres', product: 'talleres', routers: { workorders: true } });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' ? addr!.port : addr}`;
});

beforeEach(async () => {
  const { sqlite } = getDb();
  sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
               DELETE FROM documents; DELETE FROM inventory_movements; DELETE FROM work_order_parts;
               DELETE FROM work_order_services; DELETE FROM work_orders; DELETE FROM inventory_items;
               DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
               DELETE FROM resources; DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
  cookie = '';
});

afterAll(() => server.close());

describe('órdenes de trabajo', () => {
  it('register guarda el producto de la app (talleres)', async () => {
    const { tenant } = await register('tall-prod');
    expect(tenant.product).toBe('talleres');
  });

  it('crea una orden y descuenta piezas del inventario', async () => {
    const { customer, staff, service, item } = await register('tall-create');
    const res = await post('/api/workorders', orderBody(customer.id, {
      staffId: staff.id,
      serviceIds: [service.id],
      parts: [{ itemId: item.id, qty: 2 }],
      estimatedDelivery: '2026-10-01',
      notes: 'Revisar también el clutch',
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.order.number).toBe(1);
    expect(body.order.vehicle.plate).toBe('a123bcd');
    expect(body.order.services).toHaveLength(1);
    expect(body.order.services[0].price_at).toBe(4000);
    expect(body.order.parts[0].qty).toBe(2);
    expect(body.order.parts[0].unit_price_at).toBe(6000);
    expect(body.order.totals.labor).toBe(4000);
    expect(body.order.totals.parts).toBe(12000);
    expect(body.order.totals.total).toBe(16000);

    const { db } = getDb();
    const itemNow = db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id)).get()!;
    expect(itemNow.quantity).toBe(8);
    const moves = db.select().from(schema.inventoryMovements).all();
    expect(moves).toHaveLength(1);
    expect(moves[0].delta).toBe(-2);
    expect(moves[0].reason).toContain('Orden #1');
  });

  it('rechaza la orden si no hay stock suficiente (400) y no crea la orden', async () => {
    const { customer, item } = await register('tall-nostock');
    const res = await post('/api/workorders', orderBody(customer.id, {
      parts: [{ itemId: item.id, qty: 99 }],
    }));
    expect(res.status).toBe(400);
    const err = await res.json();
    expect(String(err.error ?? '')).toContain('Stock insuficiente');

    const { db } = getDb();
    expect(db.select().from(schema.workOrders).all()).toHaveLength(0);
    expect(db.select().from(schema.inventoryMovements).all()).toHaveLength(0);
  });

  it('rechaza cliente/labor/pieza inexistentes', async () => {
    const { customer, item } = await register('tall-badref');
    expect((await post('/api/workorders', orderBody('cus_missing'))).status).toBe(404);
    expect((await post('/api/workorders', orderBody(customer.id, { serviceIds: ['svc_missing'] }))).status).toBe(400);
    expect((await post('/api/workorders', orderBody(customer.id, { parts: [{ itemId: 'itm_missing', qty: 1 }] }))).status).toBe(404);
  });

  it('editar una orden devuelve piezas retiradas y descuenta las nuevas', async () => {
    const { customer, item } = await register('tall-edit');
    const created = await (await post('/api/workorders', orderBody(customer.id, {
      parts: [{ itemId: item.id, qty: 3 }],
    }))).json();

    const res = await put(`/api/workorders/${created.order.id}`, orderBody(customer.id, {
      vehicle: { make: 'Honda', model: 'Civic', plate: 'X9YZ99' },
      parts: [{ itemId: item.id, qty: 1 }],
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.vehicle.model).toBe('Civic');
    expect(body.order.parts[0].qty).toBe(1);
    expect(body.order.totals.total).toBe(6000);

    const { db } = getDb();
    const itemNow = db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id)).get()!;
    expect(itemNow.quantity).toBe(9); // 10 - 3 (alta) + 2 (liberado al reducir de 3 a 1 pieza)
    const moves = db.select().from(schema.inventoryMovements)
      .orderBy(schema.inventoryMovements.created_at).all();
    expect(moves).toHaveLength(2);
    expect(moves[0].delta).toBe(-3); // consumo al crear
    expect(moves[1].delta).toBe(2); // devolución al reducir cantidad
  });

  it('cancelar una orden libera las piezas al inventario', async () => {
    const { customer, item } = await register('tall-cancel');
    const created = await (await post('/api/workorders', orderBody(customer.id, {
      parts: [{ itemId: item.id, qty: 4 }],
    }))).json();

    const res = await patch(`/api/workorders/${created.order.id}/status`, { status: 'cancelled' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.order.status).toBe('cancelled');

    const { db } = getDb();
    const itemNow = db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, item.id)).get()!;
    expect(itemNow.quantity).toBe(10);
    const moves = db.select().from(schema.inventoryMovements).all();
    expect(moves).toHaveLength(2);
    expect(moves.map((m) => m.delta)).toEqual([-4, 4]);
  });

  it('filtra por estado y busca por placa', async () => {
    const { customer, item } = await register('tall-filter');
    const a = await (await post('/api/workorders', orderBody(customer.id, {
      vehicle: { make: 'Ford', model: 'Fiesta', plate: 'FOX111' },
      parts: [{ itemId: item.id, qty: 1 }],
    }))).json();
    const b = await (await post('/api/workorders', orderBody(customer.id, {
      vehicle: { make: 'Fiat', model: 'Punto', plate: 'ZZZ999' },
      parts: [{ itemId: item.id, qty: 1 }],
    }))).json();

    const done = await patch(`/api/workorders/${a.order.id}/status`, { status: 'done' });
    expect(done.status).toBe(200);

    const open = await (await fetch(base + '/api/workorders?status=received', { headers: { cookie } })).json();
    expect(open.orders).toHaveLength(1);
    expect(open.orders[0].id).toBe(b.order.id);

    const byPlate = await (await fetch(base + '/api/workorders?q=ox111', { headers: { cookie } })).json();
    expect(byPlate.orders).toHaveLength(1);
    expect(byPlate.orders[0].vehicle.plate).toBe('fox111');
  });

  it('404 al editar/borrar una orden inexistente', async () => {
    const { customer } = await register('tall-missing');
    expect((await put('/api/workorders/wo_missing', orderBody(customer.id))).status).toBe(404);
    expect((await del('/api/workorders/wo_missing')).status).toBe(404);
  });
});