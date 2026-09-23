import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb, schema, logger } from '@saas-mini/core';

const SLUG = 'demo-inventario';
const EMAIL = 'demo@inventario.com';
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
      name: 'Bodega Central',
      product: 'inventario',
      currency: '$',
      timezone: 'America/Mexico_City',
      reminderHours: 24,
      address: 'Av. Industrias 420, CDMX',
      phone: '+52 55 4444 9988',
    }).returning().get();

    const user = db.insert(schema.users).values({
      tenant_id: tenant.id,
      email: EMAIL,
      password_hash: hash,
      name: 'Sofía Ramírez',
      role: 'owner',
    }).returning().get();

    // Artículos (precio en centavos; hay 2 por debajo del mínimo)
    const items: Array<[string, string, number, number, string, number]> = [
      ['Aceite hidráulico 5W-30 1L', 'ACE-530', 42, 10, 'pieza', 18500],
      ['Filtro de aire universal', 'FIL-AIR', 15, 6, 'pieza', 12000],
      ['Filtro de aceite', 'FIL-OIL', 18, 6, 'pieza', 9800],
      ['Juego de balatas delanteras', 'BAL-F', 4, 5, 'juego', 48000],
      ['Bujías NGK (juego 4)', 'BUJ-4', 12, 6, 'juego', 15000],
      ['Kit de clutch completo', 'CLU-KIT', 3, 4, 'kit', 220000],
      ['Batería 12V 60Ah', 'BAT-60', 8, 3, 'pieza', 185000],
      ['Lámpara halógena H4', 'LAM-H4', 10, 5, 'pieza', 9500],
      ['Cinta de aislar 20m', 'CIN-20', 30, 12, 'pieza', 4500],
      ['Silicona selladora 280ml', 'SIL-280', 14, 8, 'tubo', 6500],
      ['Cable automotriz 12 AWG', 'CAB-12', 25, 10, 'metro', 1200],
      ['Espuma limpiadora', 'ESP-1', 2, 5, 'pieza', 14500],
    ];
    const itemIds: string[] = [];
    for (const [name, sku, qty, min, unit, price] of items) {
      const it = db.insert(schema.inventoryItems).values({
        tenant_id: tenant.id, name, sku, quantity: qty, minQty: min, unit, price,
      }).returning().get();
      itemIds.push(it.id);
    }

    // Movimientos históricos trazables (desde hace ~10 días hasta hoy)
    const agoDays = (days: number) => new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
    const move = (itemIdx: number, delta: number, reason: string, days: number) => {
      const item = db.select().from(schema.inventoryItems).where(eq(schema.inventoryItems.id, itemIds[itemIdx])).get()!;
      db.update(schema.inventoryItems)
        .set({ quantity: item.quantity + delta })
        .where(eq(schema.inventoryItems.id, item.id))
        .run();
      db.insert(schema.inventoryMovements).values({
        tenant_id: tenant.id,
        item_id: item.id,
        delta,
        reason,
        user_id: user.id,
        created_at: agoDays(days),
      }).run();
    };

    move(0, 30, 'Recepción de proveedor', 10);
    move(0, -12, 'Salida a taller', 6);
    move(0, -8, 'Venta al mostrador', 2);
    move(1, 40, 'Compra inicial', 9);
    move(1, -25, 'Salida a taller', 3);
    move(2, 18, 'Compra inicial', 9);
    move(3, 6, 'Recepción de proveedor', 5);
    move(3, -8, 'Salida a taller', 1);
    move(4, 12, 'Compra inicial', 9);
    move(5, 2, 'Recepción de proveedor', 7);
    move(5, -4, 'Salida a taller', 2);
    move(6, 8, 'Compra inicial', 9);
    move(7, 10, 'Compra inicial', 9);
    move(8, 30, 'Compra inicial', 9);
    move(9, 14, 'Compra inicial', 9);
    move(10, 25, 'Compra inicial', 9);
    move(11, 3, 'Recepción de proveedor', 4);
    move(11, -4, 'Venta al mostrador', 1);

    logger.info(`Tenant demo creado correctamente -> http://localhost:${process.env.PORT ?? 3003}`);
    logger.info(`  slug: ${SLUG} · email: ${EMAIL} · contraseña: ${PASSWORD}`);
    logger.info(`  12 artículos · ${itemIds.length} referencias · historial de movimientos con trazabilidad`);
  });

  runSeed();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});