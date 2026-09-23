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
async function get(path: string) {
  return fetch(base + path, { headers: { cookie } });
}
async function del(path: string) {
  return fetch(base + path, { method: 'DELETE', headers: { cookie } });
}

async function register(slug = 'stock-demo') {
  const r = await post('/api/auth/register', {
    businessName: 'Bodega Test', slug, ownerName: 'Dueño', email: `own@${slug}.com`, password: 'secreto123',
  });
  expect(r.status).toBe(201);
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const { db } = getDb();
  const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).get()!;
  return { tenant };
}

function itemBody(name = 'Cinta de aislar', quantity = 20) {
  return { name, sku: 'CINTA-01', quantity, minQty: 5, unit: 'pieza', price: 18.5 };
}

beforeAll(async () => {
  const app = createApp({ name: 'Inventario', product: 'inventario' });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' ? addr!.port : addr}`;
});

beforeEach(async () => {
  const { sqlite } = getDb();
  sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
               DELETE FROM documents; DELETE FROM work_order_parts; DELETE FROM work_order_services;
               DELETE FROM work_orders; DELETE FROM inventory_movements; DELETE FROM inventory_items;
               DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
               DELETE FROM resources; DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
  cookie = '';
});

afterAll(() => server.close());

describe('inventario standalone', () => {
  it('register guarda el producto de la app (inventario)', async () => {
    const { tenant } = await register('stock-prod');
    expect(tenant.product).toBe('inventario');
  });

  it('crea, lista y serializa precios en pesos', async () => {
    await register('stock-crud');
    const res = await post('/api/inventory', itemBody());
    expect(res.status).toBe(201);
    const { item } = await res.json();
    expect(item.name).toBe('Cinta de aislar');
    expect(item.price).toBe(18.5);

    const list = await (await get('/api/inventory')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].id).toBe(item.id);
  });

  it('actualiza un artículo', async () => {
    await register('stock-ed');
    const { item } = await (await post('/api/inventory', itemBody('Cinta de aislar', 20))).json();
    const upd = await put(`/api/inventory/${item.id}`, { ...itemBody('Cinta de aislar negra', 35), price: 21 });
    expect(upd.status).toBe(200);
    const body = await upd.json();
    expect(body.item.name).toBe('Cinta de aislar negra');
    expect(body.item.quantity).toBe(35);
  });

  it('registra entrada/salida y calcula el nuevo stock', async () => {
    await register('stock-move');
    const { item } = await (await post('/api/inventory', itemBody('Herramienta X', 10))).json();
    const id = item.id;

    const inMove = await post(`/api/inventory/${id}/movements`, { delta: 5, reason: 'Recepción proveedor' });
    expect(inMove.status).toBe(201);
    let found = (await (await get('/api/inventory')).json()).items.find((i: { id: string }) => i.id === id);
    expect(found.quantity).toBe(15);

    const outMove = await post(`/api/inventory/${id}/movements`, { delta: -7, reason: 'Salida a taller' });
    expect(outMove.status).toBe(201);
    found = (await (await get('/api/inventory')).json()).items.find((i: { id: string }) => i.id === id);
    expect(found.quantity).toBe(8);

    expect((await inMove.json()).movement.delta).toBe(5);
    expect((await outMove.json()).movement.delta).toBe(-7);
  });

  it('historial global de movimientos con filtros y nombres adjuntos', async () => {
    const { tenant } = await register('stock-hist');
    const { item } = await (await post('/api/inventory', { ...itemBody('Cable CCA 12', 40), price: 37 })).json();

    await post(`/api/inventory/${item.id}/movements`, { delta: 10, reason: 'Compra' });
    await post(`/api/inventory/${item.id}/movements`, { delta: -3, reason: 'Venta al mostrador' });
    await post(`/api/inventory/${item.id}/movements`, { delta: -1, reason: 'Merma' });

    const all = await (await get('/api/inventory/movements')).json();
    expect(all.movements).toHaveLength(3);
    expect(all.movements[0].item.name).toBe('Cable CCA 12');
    expect(all.movements[0].item.unit).toBe('pieza');
    expect(all.movements[0].user.name).toBe('Dueño');

    const out = await (await get('/api/inventory/movements?type=out')).json();
    expect(out.movements).toHaveLength(2);
    expect(out.movements.every((m: { delta: number }) => m.delta < 0)).toBe(true);

    const one = await (await get(`/api/inventory/movements?itemId=${item.id}`)).json();
    expect(one.movements).toHaveLength(3);

    const filt = await (await get(`/api/inventory/movements?itemId=${item.id}&type=in`)).json();
    expect(filt.movements).toHaveLength(1);
    expect(filt.movements[0].delta).toBe(10);
  });

  it('lista bajo stock', async () => {
    await register('stock-low');
    await post('/api/inventory', { name: 'Bajo', quantity: 2, minQty: 5, unit: 'pieza', price: 1 });
    await post('/api/inventory', { name: 'Sobrado', quantity: 20, minQty: 5, unit: 'pieza', price: 1 });
    const low = await (await get('/api/inventory/low-stock')).json();
    expect(low.items).toHaveLength(1);
    expect(low.items[0].name).toBe('Bajo');
  });

  it('elimina un artículo y sus movimientos en cascada', async () => {
    const { tenant } = await register('stock-del');
    const { item } = await (await post('/api/inventory', itemBody('Resistencia', 12))).json();
    await post(`/api/inventory/${item.id}/movements`, { delta: 2, reason: 'Compra' });

    const res = await del(`/api/inventory/${item.id}`);
    expect(res.status).toBe(200);
    const list = await (await get('/api/inventory')).json();
    expect(list.items.length).toBe(0);

    const { db } = getDb();
    const movements = db.select().from(schema.inventoryMovements)
      .where(eq(schema.inventoryMovements.tenant_id, tenant.id)).all();
    expect(movements).toHaveLength(0);
  });
});