import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';

const SLUG = 'demo-crm';
const EMAIL = 'demo@crmpro.com';
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
      name: 'Clientes Vip Studio',
      product: 'crm',
      currency: '$',
      timezone: 'America/Mexico_City',
      reminderHours: 24,
      emailEnabled: false,
      address: 'Av. Reforma 902, Col. Juárez',
      phone: '+52 55 5555 9090',
    }).returning().get();

    db.insert(schema.users).values({
      tenant_id: tenant.id, email: EMAIL, password_hash: hash, name: 'Diana Ríos', role: 'owner',
    }).returning().get();

    const servicios = [
      ['Corte + secado', 45, 380],
      ['Color y mechas', 120, 980],
      ['Tratamiento keratina', 90, 750],
      ['Manicure', 40, 260],
      ['Estilo (peinado)', 30, 220],
    ].map(([name, durationMin, price]) => {
      const s = db.insert(schema.services).values({
        tenant_id: tenant.id, name: String(name), durationMin: Number(durationMin), price: Number(price),
      }).returning().get();
      return s;
    });

    const staffIds = [['Lorena Paz', '#7c3aed'], ['Marco Ruíz', '#2563eb']]
      .map(([name, color]) => db.insert(schema.staffMembers).values({
        tenant_id: tenant.id, name: String(name), color: String(color),
      }).returning().get().id);

    const clientes = [
      ['María Sosa', '+52 55 5555 4001', 'maria.sosa@example.com', 'vip,recurrente'],
      ['José Renteria', '+52 55 5555 4002', 'jose.renteria@example.com', 'frecuente'],
      ['Irene Campos', '+52 55 5555 4003', '', 'nueva'],
      ['Andrés Villa', '', 'andres.villa@example.com', 'recurrente'],
      ['Sofía Mejía', '+52 55 5555 4005', 'sofia.mejia@example.com', 'vip'],
      ['Luis Ortega', '', 'luis.ortega@example.com', 'frecuente'],
      ['Ana Beltrán', '+52 55 5555 4007', '', 'nueva'],
      ['Carla Núñez', '+52 55 5555 4008', 'carla.nunez@example.com', 'vip,recurrente'],
    ];
    const custIds: string[] = [];
    for (const [name, phone, email, tags] of clientes) {
      const c = db.insert(schema.customers).values({
        tenant_id: tenant.id, name, phone, email, tags,
      }).returning().get();
      custIds.push(c.id);
    }

    const hoursFromNow = (h: number) => new Date(Date.now() + h * 3600_000);
    const dateOnly = (offsetDays: number) => {
      const d = new Date(Date.now() + offsetDays * 86400_000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const appt = (custIdx: number, svcIdx: number, staffIdx: number, hoursAhead: number, status: 'done' | 'pending' | 'confirmed' | 'cancelled' | 'noshow', notes = '') => {
      const start = hoursFromNow(hoursAhead);
      const svc = servicios[svcIdx];
      const a = db.insert(schema.appointments).values({
        tenant_id: tenant.id,
        customer_id: custIds[custIdx],
        staff_id: staffIds[staffIdx],
        start_at: start.toISOString(),
        end_at: new Date(start.getTime() + svc.durationMin * 60_000).toISOString(),
        notes,
        status,
      }).returning().get();
      db.insert(schema.appointmentServices).values({
        tenant_id: tenant.id, appointment_id: a.id, service_id: svc.id, price_at: svc.price,
      }).run();
      return a;
    };

    // Historial de visitas (clientes atendidos)
    appt(0, 1, 0, -24 * 12, 'done', 'retención: sugirieron paquete color');
    appt(1, 0, 1, -24 * 20, 'done');
    appt(2, 2, 0, -24 * 3, 'done', 'primera vez, quedó encantada');
    appt(4, 3, 1, -24 * 45, 'done');
    appt(0, 1, 0, -24 * 2, 'done', 'color + mechas');
    // Agenda futura (próximos 7 días → alertas de seguimiento)
    appt(3, 4, 1, 24 * 2, 'confirmed', 'aniversario');
    appt(5, 0, 0, 24 * 3, 'pending');
    appt(7, 2, 0, 24 * 5, 'confirmed');
    appt(2, 4, 1, 24 * 9, 'confirmed');
    // Fuera de la ventana inmediata
    appt(6, 1, 1, 24 * 20, 'confirmed');

    const fol = (custIdx: number, title: string, body: string, due: string, status: 'pending' | 'done' | 'cancelled') => {
      const now = new Date().toISOString();
      return db.insert(schema.followups).values({
        tenant_id: tenant.id, customer_id: custIds[custIdx], title, body, due_date: due, status,
        created_at: now, updated_at: now,
      }).returning().get();
    };

    // Seguimientos: 3 pendientes (2 vencidos) + 3 cerrados
    fol(0, 'Llamar para renovar paquete', 'Proponer plan 3 meses de color', dateOnly(-2), 'pending');
    fol(7, 'Enviar presupuesto de boda', 'Seguimiento de proto se casó la hermana', dateOnly(-1), 'pending');
    fol(2, 'Encuesta de satisfacción', 'Llamar a los 3 días de su keratina', dateOnly(2), 'pending');
    fol(4, 'Agenda recordatorio manicure', 'Preguntar si desea reponer', dateOnly(-10), 'done');
    fol(1, 'Confirmar cita de corte', 'Cliente prefiere WhatsApp', dateOnly(-5), 'done');
    fol(3, 'Descuento cumpleaños', 'Se reactivó tras el regalo de mayo', dateOnly(-15), 'cancelled');

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3007}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
    logger.info(`  8 clientes con etiquetas · 10 citas (6 visitas + 4 futuras) · 6 seguimientos (2 vencidos)`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});