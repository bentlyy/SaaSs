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
async function patch(path: string, body: unknown) {
  return fetch(base + path, { method: 'PATCH', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
async function get(path: string) {
  return fetch(base + path, { headers: { cookie } });
}
async function del(path: string) {
  return fetch(base + path, { method: 'DELETE', headers: { cookie } });
}

async function register(slug = 'docs-demo') {
  const r = await post('/api/auth/register', {
    businessName: 'Cotiza Test', slug, ownerName: 'Dueño', email: `own@${slug}.com`, password: 'secreto123',
  });
  expect(r.status).toBe(201);
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  const { db } = getDb();
  const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).get()!;
  const customer = db.insert(schema.customers).values({
    tenant_id: tenant.id, name: 'Laura Méndez', phone: '+52 55 5555 2001', email: 'laura@example.com',
  }).returning().get();
  return { tenant, customer };
}

beforeAll(async () => {
  const app = createApp({ name: 'Cotizaciones', product: 'cotizaciones' });
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

const quote = (customerId: string, overrides: Record<string, unknown> = {}) => ({
  customerId,
  lines: [
    { description: 'Diagnóstico general', qty: 1, price: 500 },
    { description: 'Cambio de aceite', qty: 2, price: 350.5 },
  ],
  ...overrides,
});

describe('documents (cotizaciones/recibos)', () => {
  it('register guarda el producto de la app (cotizaciones)', async () => {
    const { tenant } = await register('docs-prod');
    expect(tenant.product).toBe('cotizaciones');
  });

  it('crea una cotización, calcula subtotal/impuesto/total en pesos', async () => {
    const { customer } = await register('docs-calc');
    const res = await post('/api/documents', quote(customer.id, { taxPercent: 16 }));
    expect(res.status).toBe(201);
    const { document: doc } = await res.json();

    // 500 + 2×350.5 = 1201.00 · 16% = 192.16 · total = 1393.16
    expect(doc.type).toBe('cotizacion');
    expect(doc.number.startsWith('C-')).toBe(true);
    expect(doc.title).toBe('Cotización');
    expect(doc.subtotal).toBe(1201);
    expect(doc.tax).toBeCloseTo(192.16, 2);
    expect(doc.total).toBeCloseTo(1393.16, 2);
    expect(doc.lines).toHaveLength(2);
    expect(doc.customer.name).toBe('Laura Méndez');
    expect(doc.customer.email).toBe('laura@example.com');
  });

  it('crea recibos con numeración propia', async () => {
    const { customer } = await register('docs-receipt');
    const res = await post('/api/documents', { ...quote(customer.id), type: 'recibo', taxPercent: 0 });
    expect(res.status).toBe(201);
    const { document: doc } = await res.json();
    expect(doc.type).toBe('recibo');
    expect(doc.number.startsWith('R-')).toBe(true);
    expect(doc.title).toBe('Recibo');
    expect(doc.total).toBe(1201);
  });

  it('crea facturas con numeración y título propios', async () => {
    const { customer } = await register('docs-invoice');
    const res = await post('/api/documents', { ...quote(customer.id), type: 'factura', taxPercent: 16 });
    expect(res.status).toBe(201);
    const { document: doc } = await res.json();
    expect(doc.type).toBe('factura');
    expect(doc.number.startsWith('F-')).toBe(true);
    expect(doc.title).toBe('Factura');
    expect(doc.subtotal).toBe(1201);
    expect(doc.tax).toBeCloseTo(192.16, 2);
  });

  it('crea notas de venta con numeración y título propios', async () => {
    const { customer } = await register('docs-sale');
    const res = await post('/api/documents', { ...quote(customer.id), type: 'nota_venta', taxPercent: 0 });
    expect(res.status).toBe(201);
    const { document: doc } = await res.json();
    expect(doc.type).toBe('nota_venta');
    expect(doc.number.startsWith('NV-')).toBe(true);
    expect(doc.title).toBe('Nota de venta');
    expect(doc.total).toBe(1201);
  });

  it('permite un título personalizado', async () => {
    const { customer } = await register('docs-title');
    const res = await post('/api/documents', { ...quote(customer.id), title: 'Servicio programado' });
    const { document: doc } = await res.json();
    expect(doc.title).toBe('Servicio programado');
  });

  it('lista los documentos del tenant de más reciente a más antiguo', async () => {
    const { customer } = await register('docs-list');
    await post('/api/documents', quote(customer.id, { title: 'Primero' }));
    await post('/api/documents', { ...quote(customer.id), type: 'recibo', title: 'Segundo' });
    await post('/api/documents', { ...quote(customer.id), title: 'Tercero' });

    const list = await (await get('/api/documents')).json();
    expect(list.documents).toHaveLength(3);
    expect(list.documents[0].title).toBe('Tercero');
  });

  it('actualiza el estado (enviado → aceptado)', async () => {
    const { customer } = await register('docs-status');
    const { document: doc } = await (await post('/api/documents', quote(customer.id))).json();
    expect(doc.status).toBe('draft');

    const sent = await patch(`/api/documents/${doc.id}/status`, { status: 'sent' });
    expect((await sent.json()).document.status).toBe('sent');

    const accepted = await patch(`/api/documents/${doc.id}/status`, { status: 'accepted' });
    expect((await accepted.json()).document.status).toBe('accepted');
  });

  it('rechaza un customer inexistente y líneas vacías', async () => {
    const { customer } = await register('docs-err');
    const badCustomer = await post('/api/documents', quote('id_inexistente'));
    expect(badCustomer.status).toBe(404);

    const noLines = await post('/api/documents', { ...quote(customer.id), lines: [] });
    expect(noLines.status).toBe(400);
  });

  it('elimina un documento', async () => {
    const { tenant, customer } = await register('docs-del');
    const { document: doc } = await (await post('/api/documents', quote(customer.id))).json();
    const res = await del(`/api/documents/${doc.id}`);
    expect(res.status).toBe(200);

    const list = await (await get('/api/documents')).json();
    expect(list.documents).toHaveLength(0);

    const { db } = getDb();
    const rows = db.select().from(schema.documents)
      .where(eq(schema.documents.tenant_id, tenant.id)).all();
    expect(rows).toHaveLength(0);
  });

  it('genera el PDF descargable con Aceptar/configuración del negocio', async () => {
    const { customer } = await register('docs-pdf');
    const { document: doc } = await (await post('/api/documents', quote(customer.id))).json();

    const pdf = await get(`/api/documents/${doc.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    const buf = Buffer.from(await pdf.arrayBuffer());
    expect(buf.length).toBeGreaterThan(500);
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
});