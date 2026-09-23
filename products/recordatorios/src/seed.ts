import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';

const SLUG = 'demo-recordatorios';
const EMAIL = 'demo@alertas.com';
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

  const runSeed = sqlite.transaction(() => {
    const tenant = db.insert(schema.tenants).values({
      slug: SLUG,
      name: 'Estudio Color & Forma',
      product: 'recordatorios',
      currency: '$',
      timezone: 'America/Mexico_City',
      reminderHours: 24,
      emailEnabled: true, // SMTP se configura en .env; sin él los intentos se marcan como fallidos
      address: 'Av. Central 400, Col. Centro',
      phone: '+52 55 5555 7788',
    }).returning().get();

    db.insert(schema.users).values({
      tenant_id: tenant.id, email: EMAIL, password_hash: hash, name: 'Carla Núñez', role: 'owner',
    }).returning().get();

    // Profesionales
    const staff: Array<[string, string]> = [
      ['Ana Vega', '#0e7490'],
      ['Luis Paz', '#d97706'],
    ];
    const staffIds: string[] = [];
    for (const [name, color] of staff) {
      const s = db.insert(schema.staffMembers).values({
        tenant_id: tenant.id, name, color,
      }).returning().get();
      staffIds.push(s.id);
    }

    // Servicios
    const servs: Array<[string, number, number]> = [
      ['Corte + secado', 45, 380],
      ['Color y mechas', 120, 980],
      ['Tratamiento keratina', 90, 750],
      ['Manicure', 45, 260],
      ['Pedicure', 45, 300],
    ];
    const serviceIds: string[] = [];
    for (const [name, durationMin, price] of servs) {
      const s = db.insert(schema.services).values({
        tenant_id: tenant.id, name, durationMin, price,
      }).returning().get();
      serviceIds.push(s.id);
    }

    // Clientes (con email y teléfono para ambos canales)
    const clientes: Array<[string, string, string]> = [
      ['María Sosa', '+52 55 5555 4001', 'maria.sosa@example.com'],
      ['José Renteria', '+52 55 5555 4002', 'jose.renteria@example.com'],
      ['Irene Campos', '+52 55 5555 4003', 'irene.campos@example.com'],
      ['Andrés Villa', '+52 55 5555 4004', 'andres.villa@example.com'],
      ['Sofía Mejía', '+52 55 5555 4005', 'sofia.mejia@example.com'],
    ];
    const custIds: string[] = [];
    for (const [name, phone, email] of clientes) {
      const c = db.insert(schema.customers).values({
        tenant_id: tenant.id, name, phone, email,
      }).returning().get();
      custIds.push(c.id);
    }

    // Citas confirmadas dentro de la ventana de 24 h (candidatas a recordatorio)
    const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);
    const appt = (
      custIdx: number, staffIdx: number, svcIdx: number,
      hoursAhead: number, notes: string, status: 'confirmed' | 'pending' | 'done' | 'cancelled' | 'noshow' = 'confirmed',
    ) => {
      const start = hoursFromNow(hoursAhead);
      const svc = db.select().from(schema.services).where(eq(schema.services.id, serviceIds[svcIdx])).get()!;
      const appt = db.insert(schema.appointments).values({
        tenant_id: tenant.id,
        customer_id: custIds[custIdx],
        staff_id: staffIds[staffIdx],
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + svc.durationMin * 60_000).toISOString(),
        notes,
        status,
      }).returning().get();
      db.insert(schema.appointmentServices).values({
        tenant_id: tenant.id, appointment_id: appt.id, service_id: svc.id, price_at: svc.price,
      }).run();
      return appt;
    };

    appt(0, 0, 1, 2, 'color y mechas');       // muy próxima → recordatorio
    appt(1, 1, 0, 6, 'corte + secado');
    appt(2, 0, 2, 20, 'tratamiento de keratina');
    appt(3, 1, 3, 28, 'manicure', 'pending'); // fuera de ventana / no confirmada
    appt(4, 0, 0, 50, 'estilo');              // fuera de la ventana de 24 h
    appt(0, 1, 4, 96, 'pedicure');

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3006}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
    logger.info(`  2 profesionales · 5 servicios · 5 clientes · 6 citas (3 en ventana de recordatorio)`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});