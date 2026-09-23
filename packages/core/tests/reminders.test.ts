import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../src/db/index.js';
import { processDueReminders } from '../src/modules/reminders/scheduler.js';

async function seedTenant() {
  const { db } = getDb();
  const tenant = db.insert(schema.tenants).values({
    slug: 'rem-demo',
    name: 'Recordatorio Test',
    product: 'peluqueria',
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

function scheduleAppointment(tenantId: string, customerId: string, staffId: string, hoursFromNow: number) {
  const { db } = getDb();
  const start = new Date(Date.now() + hoursFromNow * 3600_000);
  return db.insert(schema.appointments).values({
    tenant_id: tenantId,
    customer_id: customerId,
    staff_id: staffId,
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
    status: 'confirmed',
  }).returning().get();
}

beforeEach(async () => {
  const { sqlite } = getDb();
  sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
               DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
               DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
});

describe('recordatorios', () => {
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