import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';
import { createId } from '@saas-mini/core';

const SLUG = 'demo-deportes';
const EMAIL = 'demo@deportes.com';
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
      name: 'Sport Center MX',
      product: 'deportes',
      currency: '$',
      timezone: tz,
      reminderHours: 12,
      address: 'Av. Olímpica 45, CDMX',
      phone: '+52 55 4321 8765',
    }).returning().get();

    db.insert(schema.users).values({
      tenant_id: tenant.id,
      email: EMAIL,
      password_hash: hash,
      name: 'Alejandro Dueño',
      role: 'owner',
    }).run();

    db.insert(schema.staffMembers).values({
      tenant_id: tenant.id, name: 'Roberto (recepcionista)', phone: '+52 55 1111 0001', color: '#0ea5e9',
    }).run();
    db.insert(schema.staffMembers).values({
      tenant_id: tenant.id, name: 'Lupita (coordinadora)', phone: '+52 55 1111 0002', color: '#8b5cf6',
    }).run();

    // Canchas / recursos
    const canchas: Array<[string, string, number, number, string]> = [
      ['Cancha Fútbol 7', 'futbol', 14, 350, '#16a34a'],
      ['Cancha Fútbol 11', 'futbol', 22, 600, '#15803d'],
      ['Cancha de Basquetbol', 'basquetbol', 10, 250, '#ea580c'],
      ['Cancha de Frontón', 'fronton', 4, 200, '#0891b2'],
      ['Sala de Yoga/Pilates', 'sala', 20, 150, '#7c3aed'],
    ];
    const resourceIds: string[] = [];
    for (const [name, type, capacity, price, color] of canchas) {
      const r = db.insert(schema.resources).values({
        tenant_id: tenant.id, name, type, capacity, pricePerHour: price * 100, color,
      }).returning().get();
      resourceIds.push(r.id);
    }

    // Servicios / paquetes
    const services: Array<[string, number, number, string]> = [
      ['Membresía mensual', 0, 800, 'Acceso libre a todas las canchas'],
      ['Clase grupal', 60, 200, 'Clase dirigida con instructor'],
      ['Renta de balones', 60, 50, 'Equipo para la sesión'],
      ['Torneo participante', 120, 300, 'Inscripción a torneo interno'],
    ];
    const serviceIds: Array<[string, string]> = [];
    for (const [name, dur, price, desc] of services) {
      const s = db.insert(schema.services).values({
        tenant_id: tenant.id, name, durationMin: dur, price, description: desc,
      }).returning().get();
      serviceIds.push([name, s.id]);
    }

    const clientes: Array<[string, string, string]> = [
      ['Pablo Salinas', '+52 55 2222 2001', 'pablo@example.com'],
      ['Mariana López', '+52 55 2222 2002', 'mariana@example.com'],
      ['Jorge Cantú', '+52 55 2222 2003', 'jorge@example.com'],
      ['Andrea Ríos', '+52 55 2222 2004', ''],
      ['Diego Navarro', '+52 55 2222 2005', 'diego@example.com'],
    ];
    const custIds: string[] = [];
    for (const [name, phone, email] of clientes) {
      const c = db.insert(schema.customers).values({
        tenant_id: tenant.id, name, phone, email,
      }).returning().get();
      custIds.push(c.id);
    }

    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const iso = (dayOffset: number, h: number, m: number) =>
      new Date(startOfToday.getTime() + dayOffset * 24 * 60 * 60_000 + (h * 60 + m) * 60_000).toISOString();

    const reservar = (
      cIdx: number, resourceId: string, startStr: string, mins: number, status: (typeof schema.appointmentStatus)[number], notes = '',
    ) => {
      const start = new Date(startStr);
      const end = new Date(start.getTime() + mins * 60_000);
      db.insert(schema.appointments).values({
        tenant_id: tenant.id,
        customer_id: custIds[cIdx],
        resource_id: resourceId,
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        status,
        notes,
      }).run();
    };

    // hoy (reservas en bloques de 1-2 horas)
    reservar(0, resourceIds[2], iso(0, Math.min(10, Math.max(8, hour - 1)), 0), 60, 'confirmed', 'Partido amistoso');
    reservar(1, resourceIds[0], iso(0, Math.min(12, Math.max(9, hour)), 0), 90, 'confirmed', 'Sesión de práctica');
    reservar(2, resourceIds[4], iso(0, Math.min(13, Math.max(10, hour + 1)), 30), 60, 'confirmed', 'Clase de yoga');
    reservar(3, resourceIds[3], iso(0, Math.min(16, Math.max(11, hour + 2)), 0), 60, 'cancelled');
    // próximos días
    reservar(4, resourceIds[0], iso(1, 9, 0), 120, 'pending');
    reservar(0, resourceIds[2], iso(1, 17, 0), 60, 'pending', 'Basquet 5 vs 5');
    reservar(1, resourceIds[1], iso(2, 8, 0), 120, 'pending');
    reservar(2, resourceIds[4], iso(2, 18, 30), 60, 'confirmed', 'Yoga para avanzados');
    reservar(3, resourceIds[0], iso(3, 11, 0), 60, 'pending');

    // inventario (balones y equipo)
    const inventario: Array<[string, number, number, string]> = [
      ['Balón de fútbol', 12, 5, 'pieza'],
      ['Balón de basquetbol', 8, 4, 'pieza'],
      ['Raqueta de frontón', 6, 3, 'pieza'],
      ['Colchonetas de yoga', 20, 8, 'pieza'],
    ];
    for (const [name, qty, min, unit] of inventario) {
      db.insert(schema.inventoryItems).values({
        tenant_id: tenant.id, name, quantity: qty, minQty: min, unit,
      }).run();
    }

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3001}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});