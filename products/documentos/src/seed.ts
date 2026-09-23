import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';

const SLUG = 'demo-docupro';
const EMAIL = 'demo@docupro.com';
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
      name: 'DocuPro Studio',
      product: 'documentos',
      currency: '$',
      timezone: 'America/Mexico_City',
      reminderHours: 24,
      address: 'Calle 12 #345, Col. Centro',
      phone: '+52 55 4444 5566',
    }).returning().get();

    const user = db.insert(schema.users).values({
      tenant_id: tenant.id,
      email: EMAIL,
      password_hash: hash,
      name: 'Ana Torres',
      role: 'owner',
    }).returning().get();

    // Clientes
    const clientes: Array<[string, string, string]> = [
      ['Constructora Fénix', '+52 55 4444 3001', 'finanzas@fenix.mx'],
      ['Restaurante La Parota', '+52 55 4444 3002', 'cocina@laparota.mx'],
      ['Textiles del Centro', '+52 55 4444 3003', 'compras@textiles.mx'],
      ['Dra. Lucía Ramos', '+52 55 4444 3004', ''],
      ['Imprenta Rivera', '+52 55 4444 3005', 'pedidos@rivera.mx'],
    ];
    const custIds: string[] = [];
    for (const [name, phone, email] of clientes) {
      const c = db.insert(schema.customers).values({
        tenant_id: tenant.id, name, phone, email,
      }).returning().get();
      custIds.push(c.id);
    }

    // Catálogo de conceptos (inventory como catálogo con precio en centavos)
    const conceptos: Array<[string, string, number]> = [
      ['Consultoría por hora', 'CON-01', 800],
      ['Diseño de empaque', 'DIS-01', 4500],
      ['Impresión carteles (mediano)', ' IMP-01', 320],
      ['Vinil de corte por m2', 'VIN-01', 260],
      ['Sesión fotográfica', 'FO-01', 3500],
      ['Retoque y colorización', 'FO-02', 950],
      ['Constancia mensual', 'CON-02', 1200],
      ['Papelería corporativa', 'DIS-02', 6800],
    ];
    const conceptIds: string[] = [];
    for (const [name, sku, price] of conceptos) {
      const c = db.insert(schema.inventoryItems).values({
        tenant_id: tenant.id,
        name,
        sku: sku.trim(),
        quantity: 0,
        minQty: 0,
        unit: 'servicio',
        price: toCents(price),
        active: true,
      }).returning().get();
      conceptIds.push(c.id);
    }

    // Documentos de todos los tipos
    const agoHours = (h: number) => new Date(Date.now() - h * 60 * 60_000).toISOString();
    const doc = (
      type: 'cotizacion' | 'recibo' | 'factura' | 'nota_venta',
      customerIdx: number,
      title: string,
      lines: Array<[string, number, number]>, // desc, qty, precio pesos
      taxPercent: number,
      status: 'draft' | 'sent' | 'accepted' | 'rejected',
      hoursAgo: number,
    ) => {
      const subtotal = lines.reduce((acc, [, qty, price]) => acc + toCents(price) * qty, 0);
      const tax = Math.round(subtotal * (taxPercent / 100));
      const prefix = { cotizacion: 'C', recibo: 'R', factura: 'F', nota_venta: 'NV' }[type];
      const number = `${prefix}-${Math.floor(2000 - hoursAgo * 3.3).toString(36).toUpperCase()}`;
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

    doc('factura', 0, 'Factura', [['Consultoría por hora', 4, 800], ['Constancia mensual', 1, 1200]], 16, 'sent', 90);
    doc('factura', 1, 'Factura', [['Papelería corporativa', 1, 6800], ['Diseño de empaque', 1, 4500]], 16, 'accepted', 60);
    doc('nota_venta', 2, 'Nota de venta', [['Vinil de corte por m2', 12, 260], ['Impresión carteles (mediano)', 6, 320]], 0, 'accepted', 40);
    doc('cotizacion', 4, 'Campaña impresos', [['Sesión fotográfica', 1, 3500], ['Impresión carteles (mediano)', 20, 320], ['Retoque y colorización', 6, 950]], 16, 'sent', 24);
    doc('recibo', 0, 'Recibo', [['Primer parcialidad', 1, 5000]], 0, 'accepted', 6);
    doc('factura', 3, 'Factura', [['Consultoría por hora', 2, 800], ['Constancia mensual', 1, 1200]], 16, 'draft', 2);
    doc('cotizacion', 1, 'Señalética restaurante', [['Vinil de corte por m2', 18, 260], ['Diseño de empaque', 1, 4500]], 16, 'rejected', 120);

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3005}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
    logger.info(`  5 clientes · ${conceptIds.length} conceptos · facturas/notas/cotizaciones/recibos en PDF`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});