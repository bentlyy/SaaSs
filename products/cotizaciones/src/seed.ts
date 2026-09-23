import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';

const SLUG = 'demo-cotizaciones';
const EMAIL = 'demo@cotizaciones.com';
const PASSWORD = 'demo1234';

const toCents = (amount: number) => Math.round(amount * 100);

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
      name: 'Cotizaciones JM',
      product: 'cotizaciones',
      currency: '$',
      timezone: 'America/Mexico_City',
      reminderHours: 24,
      address: 'Av. Reforma 900, CDMX',
      phone: '+52 55 2222 3344',
    }).returning().get();

    const user = db.insert(schema.users).values({
      tenant_id: tenant.id,
      email: EMAIL,
      password_hash: hash,
      name: 'Jorge Méndez',
      role: 'owner',
    }).returning().get();

    // Clientes
    const clientes: Array<[string, string, string]> = [
      ['Laura Méndez', '+52 55 5555 2001', 'laura@example.com'],
      ['Oscar Ibáñez', '+52 55 5555 2002', 'oscar@example.com'],
      ['Renata Salgado', '+52 55 5555 2003', ''],
      ['Héctor Duarte', '+52 55 5555 2004', 'hector@example.com'],
      ['Patricia León', '+52 55 5555 2005', 'paty@example.com'],
    ];
    const custIds: string[] = [];
    for (const [name, phone, email] of clientes) {
      const c = db.insert(schema.customers).values({
        tenant_id: tenant.id, name, phone, email,
      }).returning().get();
      custIds.push(c.id);
    }

    // Documentos (precios en pesos, se guardan en centavos)
    const agoHours = (h: number) => new Date(Date.now() - h * 60 * 60_000).toISOString();
    const doc = (
      type: 'cotizacion' | 'recibo',
      customerIdx: number,
      title: string,
      lines: Array<[string, number, number]>, // desc, qty, precio pesos
      taxPercent: number,
      status: 'draft' | 'sent' | 'accepted' | 'rejected',
      hoursAgo: number,
    ) => {
      const subtotal = lines.reduce((acc, [, qty, price]) => acc + toCents(price) * qty, 0);
      const tax = Math.round(subtotal * (taxPercent / 100));
      const number = `${type === 'recibo' ? 'R' : 'C'}-${Math.floor(1000 - hoursAgo * 1.7).toString(36).toUpperCase()}`;
      const customer = db.select().from(schema.customers).where(eq(schema.customers.id, custIds[customerIdx])).get()!;
      return db.insert(schema.documents).values({
        tenant_id: tenant.id,
        type,
        number,
        customer_id: customer.id,
        customer_snapshot: JSON.stringify({ name: customer.name, phone: customer.phone, email: customer.email }),
        title,
        lines: JSON.stringify(lines.map(([description, qty, price]) => ({ description, qty, price }))),
        subtotal,
        tax,
        total: subtotal + tax,
        status,
        created_at: agoHours(hoursAgo),
      }).returning().get();
    };

    doc('cotizacion', 0, 'Diseño de identidad', [['Logo + tarjetas', 1, 4800], ['Manual de marca', 1, 6500]], 16, 'accepted', 96);
    doc('cotizacion', 1, 'Remodelación de oficina', [['Pintura interior', 120, 45], ['Piso laminado', 60, 520], ['Iluminación LED', 8, 380]], 16, 'sent', 72);
    doc('cotizacion', 2, 'Mantenimiento preventivo', [['Revisión general', 1, 600], ['Cambio de filtros', 4, 180], ['Limpieza profunda', 1, 350]], 0, 'sent', 48);
    doc('cotizacion', 3, 'Producción de video', [['Pre producción', 1, 3500], ['Filmación (día)', 1, 9000], ['Edición', 8, 750]], 16, 'draft', 24);
    doc('recibo', 4, 'Recibo', [['Membresía anual', 1, 2400]], 0, 'accepted', 8);
    doc('recibo', 0, 'Abono a cuenta', [['Segunda parcialidad', 1, 3000]], 0, 'accepted', 3);
    doc('cotizacion', 2, 'Evento corporativo', [['Renta de salón', 1, 12000], ['Catering por persona', 40, 320], ['Sonido e iluminación', 1, 3500]], 16, 'rejected', 120);

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3004}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
    logger.info(`  5 clientes · ${custIds.length} contactos · cotizaciones y recibos con PDF`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});