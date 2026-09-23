import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';
import { createId } from '@saas-mini/core';

const SLUG = 'demo-pelu';
const EMAIL = 'demo@pelu.com';
const PASSWORD = 'demo1234';

async function main() {
  const { db, sqlite } = getDb();

  const existing = db.select().from(schema.tenants).where(eq(schema.tenants.slug, SLUG)).get();
  if (existing) {
    logger.info('El tenant demo ya existe. Usa:');
    logger.info(`  slug: ${SLUG}`);
    logger.info(`  email: ${EMAIL}`);
    logger.info(`  contraseña: ${PASSWORD}`);
    return;
  }

  const hash = await bcrypt.hash(PASSWORD, 10);
  const tz = 'America/Mexico_City';

  const runSeed = sqlite.transaction(() => {
    const tenant = db.insert(schema.tenants).values({
      slug: SLUG,
      name: 'Estética Glow',
      product: 'peluqueria',
      currency: '$',
      timezone: tz,
      reminderHours: 12,
      address: 'Av. Reforma 123',
      phone: '+52 55 1234 5678',
    }).returning().get();

    db.insert(schema.users).values({
      tenant_id: tenant.id,
      email: EMAIL,
      password_hash: hash,
      name: 'María Owner',
      role: 'owner',
    }).run();

    const yuki = db.insert(schema.staffMembers).values({
      tenant_id: tenant.id, name: 'Yuki Sandoval', phone: '+52 55 1111 2222', color: '#4f46e5',
    }).returning().get();
    const carlos = db.insert(schema.staffMembers).values({
      tenant_id: tenant.id, name: 'Carlos Méndez', phone: '+52 55 3333 4444', color: '#059669',
    }).returning().get();

    const servicioIds: Record<string, string> = {};
    for (const [name, duration, price, color] of [
      ['Corte de cabello', 30, 120, undefined],
      ['Corte + barba', 45, 180, undefined],
      ['Color completo', 90, 450, undefined],
      ['Manicure', 40, 150, undefined],
      ['Tinte + tratamiento', 120, 600, undefined],
    ] as const) {
      const s = db.insert(schema.services).values({
        tenant_id: tenant.id, name, durationMin: duration, price,
      }).returning().get();
      servicioIds[name] = s.id;
    }

    for (const sid of [servicioIds['Corte de cabello'], servicioIds['Corte + barba']]) {
      db.insert(schema.staffServices).values({ tenant_id: tenant.id, staff_id: yuki.id, service_id: sid }).run();
    }
    for (const sid of [servicioIds['Color completo'], servicioIds['Tinte + tratamiento']]) {
      db.insert(schema.staffServices).values({ tenant_id: tenant.id, staff_id: carlos.id, service_id: sid }).run();
    }

    const clientes: Array<[string, string, string]> = [
      ['Ana Torres', '+52 55 2222 1001', 'ana@example.com'],
      ['Luis Ramírez', '+52 55 2222 1002', 'luis@example.com'],
      ['Sofía Herrera', '+52 55 2222 1003', 'sofia@example.com'],
      ['Pedro Ortiz', '+52 55 2222 1004', ''],
      ['Carmen Díaz', '+52 55 2222 1005', 'carmen@example.com'],
    ];
    const custIds: string[] = [];
    for (const [name, phone, email] of clientes) {
      const c = db.insert(schema.customers).values({
        tenant_id: tenant.id, name, phone, email,
      }).returning().get();
      custIds.push(c.id);
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const iso = (dayOffset: number, hour: number, minute: number) =>
      new Date(startOfToday.getTime() + dayOffset * 24 * 60 * 60_000 + (hour * 60 + minute) * 60_000).toISOString();

    const mk = (cIdx: number, staff: { id: string }, startStr: string, mins: number, svcName: string, status: (typeof schema.appointmentStatus)[number]) => {
      const start = new Date(startStr);
      const end = new Date(start.getTime() + mins * 60_000);
      const appt = db.insert(schema.appointments).values({
        tenant_id: tenant.id,
        customer_id: custIds[cIdx],
        staff_id: staff.id,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status,
      }).returning().get();
      db.insert(schema.appointmentServices).values({
        tenant_id: tenant.id,
        appointment_id: appt.id,
        service_id: servicioIds[svcName],
        price_at: 12000,
      }).run();
    };

    // hoy: confirmadas + una cancelada
    mk(0, yuki, iso(0, 9, 0), 30, 'Corte de cabello', 'confirmed');
    mk(1, yuki, iso(0, 10, 0), 45, 'Corte + barba', 'confirmed');
    mk(2, carlos, iso(0, 11, 0), 120, 'Tinte + tratamiento', 'confirmed');
    mk(3, yuki, iso(0, 12, 0), 30, 'Corte de cabello', 'cancelled');
    // próximos días
    mk(4, yuki, iso(1, 9, 0), 30, 'Corte de cabello', 'pending');
    mk(0, carlos, iso(1, 10, 0), 90, 'Color completo', 'pending');
    mk(1, yuki, iso(2, 9, 30), 45, 'Corte + barba', 'pending');
    mk(2, carlos, iso(3, 9, 0), 40, 'Manicure', 'pending');

    // inventario
    const inventario: Array<[string, number, number, string]> = [
      ['Shampoo 1L', 8, 3, 'botella'],
      ['Tinte negro', 2, 4, 'unidad'],
      ['Cera para barba', 15, 5, 'unidad'],
      ['Guantes látex', 40, 20, 'par'],
    ];
    for (const [name, qty, min, unit] of inventario) {
      db.insert(schema.inventoryItems).values({
        tenant_id: tenant.id, name, quantity: qty, minQty: min, unit,
      }).run();
    }

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3000}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});