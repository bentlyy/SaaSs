import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';

const SLUG = 'demo-talleres';
const EMAIL = 'demo@talleres.com';
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
      name: 'Talleres El Mecánico',
      product: 'talleres',
      currency: '$',
      timezone: tz,
      reminderHours: 12,
      address: 'Calz. de la Viga 112, CDMX',
      phone: '+52 55 4444 5566',
    }).returning().get();

    db.insert(schema.users).values({
      tenant_id: tenant.id,
      email: EMAIL,
      password_hash: hash,
      name: 'Daniel Fernández',
      role: 'owner',
    }).run();

    // Mecánicos
    const staffIds: string[] = [];
    for (const [name, color] of [
      ['Jorge (mecánico jefe)', '#ea580c'],
      ['Ramón (mecánico)', '#2563eb'],
      ['Karla (técnica)', '#7c3aed'],
    ] as Array<[string, string]>) {
      const s = db.insert(schema.staffMembers).values({
        tenant_id: tenant.id, name, phone: '+52 55 3333 1100', color,
      }).returning().get();
      staffIds.push(s.id);
    }

    // Labores (servicios) — precio en centavos
    const labores: Array<[string, number, number, string]> = [
      ['Cambio de aceite', 60, 25000, 'Aceite 5W-30 + filtro'],
      ['Afinación mayor', 180, 180000, 'Bujías, filtros y ajuste'],
      ['Cambio de balatas', 120, 60000, 'Balatas delanteras o traseras'],
      ['Diagnóstico general', 45, 10000, 'Escaneo y revisión'],
      ['Alineación y balanceo', 90, 45000, 'Dirección y balanceo de ruedas'],
      ['Cambio de clutch', 240, 250000, 'Kit completo de clutch'],
    ];
    const laboreIds: string[] = [];
    for (const [name, dur, price, desc] of labores) {
      const s = db.insert(schema.services).values({
        tenant_id: tenant.id, name, durationMin: dur, price, description: desc,
      }).returning().get();
      laboreIds.push(s.id);
    }

    // Clientes (dueños)
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

    // Piezas (inventario) — precio en centavos
    const piezas: Array<[string, string, number, number, string, number]> = [
      ['Aceite 5W-30 1L', 'ACE-530', 40, 10, 'pieza', 18500],
      ['Filtro de aire', 'FIL-AIR', 15, 5, 'pieza', 12000],
      ['Filtro de aceite', 'FIL-OIL', 18, 6, 'pieza', 9800],
      ['Juego de balatas', 'BAL-4', 8, 3, 'juego', 48000],
      ['Bujías (juego de 4)', 'BUJ-4', 12, 6, 'juego', 15000],
      ['Kit de clutch', 'CLU-KIT', 5, 1, 'kit', 220000],
      ['Batería 12V', 'BAT-12V', 7, 2, 'pieza', 185000],
      ['Lámpara halógena', 'LAM-H', 10, 4, 'pieza', 9500],
    ];
    const itemIds: string[] = [];
    for (const [name, sku, qty, min, unit, price] of piezas) {
      const it = db.insert(schema.inventoryItems).values({
        tenant_id: tenant.id, name, sku, quantity: qty, minQty: min, unit, price,
      }).returning().get();
      itemIds.push(it.id);
    }

    // Órdenes de trabajo (semilla directa en BD)
    const dayIso = (days: number) => {
      const dt = new Date(); dt.setDate(dt.getDate() + days);
      return dt.toISOString().slice(0, 10);
    };

    const orden = (
      number: number,
      cIdx: number,
      sIdx: number | null,
      status: (typeof schema.workOrderStatus)[number],
      vehicle: { make: string; model: string; plate: string; year: number; odo: number },
      laboresIdx: number[],
      piezasIdx: Array<[number, number]>,
      estimDelivery: string | null,
      notes = '',
    ) => {
      const start = new Date();
      const created = new Date(start.getTime() - (number % 4) * 24 * 60 * 60_000).toISOString();
      const ord = db.insert(schema.workOrders).values({
        tenant_id: tenant.id,
        number,
        customer_id: custIds[cIdx],
        staff_id: sIdx != null ? staffIds[sIdx] : null,
        vehicle_make: vehicle.make,
        vehicle_model: vehicle.model,
        vehicle_plate: vehicle.plate.toLowerCase(),
        vehicle_year: vehicle.year,
        vehicle_odo: vehicle.odo,
        status,
        estimated_delivery: estimDelivery,
        notes,
        created_at: created,
        updated_at: created,
      }).returning().get();

      for (const l of laboresIdx) {
        db.insert(schema.workOrderServices).values({
          tenant_id: tenant.id, order_id: ord.id, service_id: laboreIds[l], price_at: labores[l][2],
        }).run();
      }
      for (const [pIdx, qty] of piezasIdx) {
        db.insert(schema.workOrderParts).values({
          tenant_id: tenant.id, order_id: ord.id, item_id: itemIds[pIdx], qty, unit_price_at: piezas[pIdx][5],
        }).run();
      }
    };

    // hoy
    orden(1, 0, 0, 'in_progress',
      { make: 'Nissan', model: 'Versa', plate: 'A123BC', year: 2018, odo: 84500 },
      [0, 2], [[0, 4], [2, 1], [3, 1]],
      dayIso(1), 'Cambio de frenos completo');

    orden(2, 1, 1, 'received',
      { make: 'Honda', model: 'Civic', plate: 'X9YZ99', year: 2020, odo: 121000 },
      [3], [],
      dayIso(1), 'Cliente refiere ruido al frenar');

    orden(3, 2, 2, 'in_progress',
      { make: 'Volkswagen', model: 'Jetta', plate: 'KL1198', year: 2015, odo: 158200 },
      [1], [[4, 1], [1, 1], [0, 4]],
      dayIso(2), 'Afinación mayor con bujías');

    orden(4, 3, 0, 'done',
      { make: 'Chevrolet', model: 'Aveo', plate: 'MN4521', year: 2017, odo: 99000 },
      [0], [[0, 4], [2, 1]],
      null, 'Entrega realizada');

    orden(5, 4, null, 'estimated',
      { make: 'Mazda', model: 'Mazda 3', plate: 'ZQ7788', year: 2019, odo: 73000 },
      [5], [[5, 1]],
      dayIso(3), 'Cotización de clutch aprobada');

    orden(6, 0, 1, 'cancelled',
      { make: 'Renault', model: 'Clio', plate: 'RP3344', year: 2013, odo: 200000 },
      [0], [],
      null, 'Cliente no entregó el auto');

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3002}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});