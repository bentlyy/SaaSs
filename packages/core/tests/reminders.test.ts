import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';
import { processDueReminders } from '../src/modules/reminders/scheduler.js';

let server: Server;
let base = '';
let cookie = '';

async function post(path: string, body: unknown) {
  return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
}
async function get(path: string) {
  return fetch(base + path, { headers: { cookie } });
}

async function seedTenant(slug = 'rem-demo') {
  const { db } = getDb();
  const tenant = db.insert(schema.tenants).values({
    slug,
    name: 'Recordatorio Test',
    product: 'recordatorios',
    reminderHours: 24,
    emailEnabled: true,
    whatsappWebhook: 'http://127.0.0.1:9/whatsapp',
    whatsappToken: 'tok-test',
  }).returning().get();

  const customer = db.insert(schema.customers).values({
    tenant_id: tenant.id, name: 'Rosa', phone: '+5299999999', email: 'rosa@test.com',
  }).returning().get();

  const staff = db.insert(schema.staffMembers).values({ tenant_id: tenant.id, name: 'S' }).returning().get();

  return { tenant, customer, staff };
}

function scheduleAppointment(tenantId: string, customerId: string, staffId: string, hoursFromNow: number, status = 'confirmed') {
  const { db } = getDb();
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  return db.insert(schema.appointments).values({
    tenant_id: tenantId,
    customer_id: customerId,
    staff_id: staffId,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
    status,
  }).returning().get();
}

describe('recordatorios (scheduler)', () => {
  beforeEach(async () => {
    const { sqlite } = getDb();
    sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
                 DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
                 DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
  });

  it('registra intentos fallidos por email y whatsapp cuando los canales no están listos', async () => {
    const { tenant, customer, staff } = await seedTenant();
    scheduleAppointment(tenant.id, customer.id, staff.id, 12); // dentro de la ventana de 24h

    const sent = await processDueReminders();
    expect(sent).toBe(2); // email (SMTP no configurado) + whatsapp (rechaza conexión)

    const { db } = getDb();
    const logs = db.select().from(schema.reminderLogs).where(eq(schema.reminderLogs.tenant_id, tenant.id)).all();
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === 'failed')).toBe(true);
  });

  it('no duplica recordatorios en ejecuciones repetidas', async () => {
    const { tenant, customer, staff } = await seedTenant();
    scheduleAppointment(tenant.id, customer.id, staff.id, 12);

    await processDueReminders();
    await processDueReminders();

    const { db } = getDb();
    const logs = db.select().from(schema.reminderLogs).where(eq(schema.reminderLogs.tenant_id, tenant.id)).all();
    expect(logs).toHaveLength(2); // una vez por canal, no repetido
  });

  it('ignora citas fuera de la ventana de recordatorio', async () => {
    const { tenant, customer, staff } = await seedTenant();
    scheduleAppointment(tenant.id, customer.id, staff.id, 48); // fuera de 24h
    const sent = await processDueReminders();
    expect(sent).toBe(0);
  });
});

describe('recordatorios (API /api/reminders)', () => {
  beforeAll(async () => {
    const app = createApp({ name: 'Recordatorios', product: 'recordatorios', routers: { reminders: true } });
    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' ? addr!.port : addr}`;
  });

  afterAll(() => server.close());

  beforeEach(async () => {
    const { sqlite } = getDb();
    sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
                 DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
                 DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
    cookie = '';
    const r = await post('/api/auth/register', {
      businessName: 'Rem Test', slug: 'rem-api', ownerName: 'Dueño', email: 'own@rem-api.com', password: 'secreto123',
    });
    expect(r.status).toBe(201);
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0];
  });

  it('reporta el estado de los canales del negocio', async () => {
    const s = await (await get('/api/reminders/status')).json();
    expect(s.channels.email.enabled).toBe(false);
    expect(typeof s.reminderHours).toBe('number');
    expect(s.logs.total).toBe(0);
    expect(s.upcoming).toBe(0);
  });

  it('lista citas programadas para recordar y su marca por canal', async () => {
    const { db } = getDb();
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'rem-api')).get()!;
    const customer = db.insert(schema.customers).values({
      tenant_id: tenant.id, name: 'Rosa', phone: '+5299999999', email: 'rosa@test.com',
    }).returning().get();
    const staff = db.insert(schema.staffMembers).values({ tenant_id: tenant.id, name: 'S' }).returning().get();
    scheduleAppointment(tenant.id, customer.id, staff.id, 12);

    const list = await (await get('/api/reminders/scheduled')).json();
    expect(list.items).toHaveLength(1);
    expect(list.items[0].customer.name).toBe('Rosa');
    expect(list.items[0].sent.email).toBeNull();
  });

  it('ejecuta el procesamiento manual y registra intentos', async () => {
    const { db } = getDb();
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'rem-api')).get()!;
    const customer = db.insert(schema.customers).values({
      tenant_id: tenant.id, name: 'Rosa', phone: '+5299999999', email: 'rosa@test.com',
    }).returning().get();
    const staff = db.insert(schema.staffMembers).values({ tenant_id: tenant.id, name: 'S' }).returning().get();

    // activa canales para el tenant del API
    db.update(schema.tenants).set({ emailEnabled: true, whatsappWebhook: 'http://127.0.0.1:9/whatsapp', whatsappToken: 'tok' })
      .where(eq(schema.tenants.id, tenant.id)).run();
    scheduleAppointment(tenant.id, customer.id, staff.id, 12);

    const run = await (await post('/api/reminders/run', {})).json();
    expect(run.sent).toBe(2);

    const logs = await (await get('/api/reminders/logs')).json();
    expect(logs.logs).toHaveLength(2);
    expect(logs.logs[0].customer.name).toBe('Rosa');
  });

  it('envía un recordatorio de prueba y lo registra en el log', async () => {
    const { db } = getDb();
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, 'rem-api')).get()!;
    const customer = db.insert(schema.customers).values({
      tenant_id: tenant.id, name: 'Paty', phone: '+5299999999', email: 'paty@test.com',
    }).returning().get();
    const staff = db.insert(schema.staffMembers).values({ tenant_id: tenant.id, name: 'S' }).returning().get();
    db.update(schema.tenants).set({ emailEnabled: true }).where(eq(schema.tenants.id, tenant.id)).run();
    const appt = scheduleAppointment(tenant.id, customer.id, staff.id, 12);

    const test = await (await post('/api/reminders/test', { appointmentId: appt.id, channel: 'email' })).json();
    expect(test.ok).toBe(false); // SMTP no configurado
    expect(test.error).toContain('SMTP');

    const logs = await (await get('/api/reminders/logs?channel=email')).json();
    expect(logs.logs).toHaveLength(1);
    expect(logs.logs[0].status).toBe('failed');
  });

  it('rechaza probar envíos de citas de otro tenant', async () => {
    const { tenant, customer, staff } = await seedTenant('rem-other');
    const appt = scheduleAppointment(tenant.id, customer.id, staff.id, 12);
    const res = await post('/api/reminders/test', { appointmentId: appt.id, channel: 'email' });
    expect(res.status).toBe(404);
  });
});