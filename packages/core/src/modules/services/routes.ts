import { Router } from 'express';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired, requireRole } from '../../middleware/auth.js';
import { fromMinor, toMinor } from '../../money.js';

export const servicesRouter = Router();
servicesRouter.use(authRequired);

/**
 * El precio entra y sale en NUMERO HUMANO, como el de inventario.
 *
 * Este modulo era el unico que no convertia: la base guarda unidades menores y
 * la API devolvia los enteros crudos, asi que cada pantalla se "!arreglaba"
 * multiplicando por 100. Asi un servicio de $50 aparecia como $5.000 en la
 * lista de ordenes y el taller entero multiplicaba y dividia por 100 para
 * volver al mismo numero. Ahora la conversion esta aqui, una sola vez.
 */
const serviceSchema = z.object({
  name: z.string().min(1).max(120),
  durationMin: z.number().int().min(5).max(600),
  price: z.number().min(0).max(1_000_000),
  description: z.string().max(1000).or(z.literal('')).optional(),
  active: z.boolean().optional().default(true),
});

/** Fila de la base -> lo que ve el cliente. */
function decode(row: typeof schema.services.$inferSelect) {
  return { ...row, price: fromMinor(row.price, 'USD') };
}

servicesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const reference = eq(schema.services.tenant_id, req.session.tenantId);
    const rows = db.select().from(schema.services)
      .where(and(reference))
      .orderBy(asc(schema.services.name))
      .all();
    return res.json({ services: rows.map(decode) });
  }),
);

servicesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = serviceSchema.parse(req.body);
    const { db } = getDb();
    const row = db.insert(schema.services).values({
      tenant_id: req.session.tenantId,
      ...input,
      price: toMinor(input.price, 'USD'),
    }).returning().get();
    return res.status(201).json({ service: decode(row) });
  }),
);

servicesRouter.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = serviceSchema.parse(req.body);
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    const row = db.update(schema.services)
      .set({ ...input, price: toMinor(input.price, 'USD') })
      .where(and(eq(schema.services.id, existing.id), eq(schema.services.tenant_id, req.session.tenantId)))
      .returning()
      .get();
    return res.json({ service: decode(row) });
  }),
);

servicesRouter.delete(
  '/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const existing = getOwned(db, req.session.tenantId, req.params.id);
    db.delete(schema.services)
      .where(and(eq(schema.services.id, existing.id), eq(schema.services.tenant_id, req.session.tenantId)))
      .run();
    return res.json({ ok: true });
  }),
);

/**
 * Fila CRUDA de la base, para uso interno (snapshots de ordenes).
 *
 * Ojo: quien lo use para responder a un cliente tiene que convertir con
 * `fromMinor`. `attachLines` de ordenes lo hace explicitamente.
 */
export function getOwned(db: ReturnType<typeof getDb>['db'], tenantId: string, id: string) {
  const row = db.select().from(schema.services)
    .where(and(eq(schema.services.id, id), eq(schema.services.tenant_id, tenantId)))
    .get();
  if (!row) throw new AppError(404, 'Servicio no encontrado');
  return row;
}
