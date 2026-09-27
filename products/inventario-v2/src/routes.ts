import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AppError, asyncHandler, createId, crudRouter, nowIso, orgId, requireRole, type ProductContext } from '@amg/product-runtime';
import { items, movements, settings } from './schema.js';
import { seedDemo } from './seed.js';

/**
 * API del inventario.
 *
 * Dos invariantes, y las dos están en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesión)`. Viene de
 *      `orgId(req)`, que lee el token del Core, nunca del cuerpo ni de un
 *      query. Por eso un cliente no puede pedir los datos de otra empresa ni
 *      aunque adivine el id.
 *
 *   2. `quantity` no se puede escribir con un PATCH. La cantidad cambia
 *      solamente por un movimiento, que deja registro de quién y por qué. Si se
 *      pudiera editar el número directo, el stock dejaría de ser explicable.
 */

const texto = z.string().trim().min(1).max(150);
const cantidad = z.coerce.number().int().min(0).max(1_000_000);

/**
 * `z.coerce.boolean()` convierte el string "false" en `true`, porque cualquier
 * string es truthy. Como el formulario manda texto, "false" se guardaría como
 * activo. Esto sí lee los strings que la gente usa.
 */
const booleano = z.preprocess((v) => {
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'si';
  return v;
}, z.boolean());

const movementSchema = z.object({
  delta: z.coerce
    .number()
    .int()
    .min(-1_000_000)
    .max(1_000_000)
    .refine((v) => v !== 0, 'El delta no puede ser cero: usá un motivo, no un movimiento nulo'),
  reason: z.string().trim().min(1, 'El motivo es obligatorio: sin él el stock no se puede explicar').max(200),
});

const settingsSchema = z.object({
  defaultUnit: z.string().trim().min(1).max(30),
  defaultMinQuantity: z.coerce.number().int().min(0).max(1_000_000),
  currency: z.string().trim().min(1).max(5),
});

/** Lo que se usa cuando la organización todavía no guardó preferencias. */
export const defaultSettings = () => ({
  defaultUnit: 'unidad',
  defaultMinQuantity: 0,
  currency: '$',
});

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /**
   * `/low-stock` va antes del `crudRouter` porque el CRUD resuelve `/:id`: si
   * el CRUD se montara primero, "low-stock" se leería como un id.
   */
  router.get(
    '/api/items/low-stock',
    asyncHandler(async (req: Request, res) => {
      const rows = db
        .select()
        .from(items)
        .where(
          and(
            eq(items.organizationId, orgId(req)),
            lte(items.quantity, items.minQuantity),
            eq(items.active, true),
          ),
        )
        .orderBy(items.name)
        .all();
      res.json({ items: rows });
    }),
  );

  /**
   * Resumen para la portada. Una consulta con `count`, no un `SELECT *` para
   * contar en JavaScript.
   */
  router.get(
    '/api/resumen',
    asyncHandler(async (req: Request, res) => {
      const org = orgId(req);
      const [totales] = db
        .select({
          items: count(),
          unidades: sql<number>`coalesce(sum(${items.quantity}), 0)`,
          valorCents: sql<number>`coalesce(sum(${items.quantity} * ${items.priceCents}), 0)`,
        })
        .from(items)
        .where(and(eq(items.organizationId, org), eq(items.active, true)))
        .all();

      const [bajos] = db
        .select({ n: count() })
        .from(items)
        .where(and(eq(items.organizationId, org), lte(items.quantity, items.minQuantity), eq(items.active, true)))
        .all();

      const [movs] = db
        .select({ n: count() })
        .from(movements)
        .where(eq(movements.organizationId, org))
        .all();

      res.json({
        items: totales?.items ?? 0,
        unidades: totales?.unidades ?? 0,
        valorCents: totales?.valorCents ?? 0,
        stockBajo: bajos?.n ?? 0,
        movimientos: movs?.n ?? 0,
      });
    }),
  );

  // Historial de movimientos, con el nombre del artículo resuelto en una sola
  // consulta: primero los movimientos, después los artículos de esos ids.
  router.get(
    '/api/movements',
    asyncHandler(async (req: Request, res) => {
      const org = orgId(req);
      const where = [eq(movements.organizationId, org)];

      if (typeof req.query.itemId === 'string' && req.query.itemId) {
        where.push(eq(movements.itemId, req.query.itemId));
      }
      if (req.query.type === 'in') where.push(gt(movements.delta, 0));
      if (req.query.type === 'out') where.push(sql`${movements.delta} < 0`);

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const rows = db
        .select()
        .from(movements)
        .where(and(...where))
        .orderBy(desc(movements.createdAt), desc(movements.id))
        .limit(limit)
        .all();

      const ids = [...new Set(rows.map((r) => r.itemId))];
      const nombres = new Map<string, string>();
      if (ids.length > 0) {
        const arts = db
          .select({ id: items.id, name: items.name, unit: items.unit })
          .from(items)
          .where(and(inArray(items.id, ids), eq(items.organizationId, org)))
          .all();
        for (const a of arts) nombres.set(a.id, a.name);
      }

      res.json({
        movements: rows.map((r) => ({
          ...r,
          itemName: nombres.get(r.itemId) ?? null,
        })),
      });
    }),
  );

  /**
   * Un movimiento cambia el stock. Es la única puerta de entrada, y por eso
   * exige `admin` u `owner`: mover stock es una decisión de negocio.
   *
   * Va en una transacción: o se actualiza la cantidad y se guarda el
   * movimiento, o no se toca nada. Un stock movido sin rastro es peor que un
   * movimiento rechazado.
   */
  router.post(
    '/api/items/:id/movements',
    requireRole('admin'),
    asyncHandler(async (req: Request, res) => {
      const input = movementSchema.parse(req.body);
      const org = orgId(req);

      const item = db
        .select()
        .from(items)
        .where(and(eq(items.id, req.params.id), eq(items.organizationId, org)))
        .get();
      if (!item) throw new AppError(404, 'Artículo no encontrado');

      // El legacy recortaba en cero y seguía: un delta de -50 sobre 10 dejaba 0
      // y el movimiento decía -50, así que la historia no cuadraba con el
      // stock. Ahora se rechaza y se dice por qué.
      const siguiente = item.quantity + input.delta;
      if (siguiente < 0) {
        throw new AppError(
          400,
          `No hay stock suficiente: hay ${item.quantity} ${item.unit} y el movimiento pide ${Math.abs(input.delta)}`,
        );
      }

      const actor = req.amg;
      const registrar = ctx.db.sqlite.transaction(() => {
        db.update(items)
          .set({ quantity: siguiente, updatedAt: nowIso() })
          .where(eq(items.id, item.id))
          .run();
        return db
          .insert(movements)
          .values({
            id: createId('mov'),
            organizationId: org,
            itemId: item.id,
            delta: input.delta,
            reason: input.reason,
            actorUserId: actor?.userId ?? null,
            // Foto del nombre en el momento del movimiento. La referencia real
            // es `actorUserId` contra el Core; esto es para que el historial se
            // pueda leer aunque después se borre o renombre el usuario.
            actorName: actor?.name ?? null,
            createdAt: nowIso(),
          })
          .returning()
          .get();
      });

      res.status(201).json({ movement: registrar(), quantity: siguiente });
    }),
  );

  /**
   * Preferencias del inventario de la organización.
   *
   * `GET` no escribe: si no hay fila, devuelve los defaults. Escribir en un
   * `GET` surprisingaría a cualquiera que inspeccione la base, y haría que una
   * simple carga de pantalla creara filas.
   *
   * `PUT` es de `admin`: es la configuración de la empresa, no una nota personal.
   * La razón social y los contactos NO están acá: son de la organización del
   * Core, y editarlos en dos lados es garantizar que se desincronicen.
   */
  router.get(
    '/api/settings',
    asyncHandler(async (req: Request, res) => {
      const fila = db
        .select()
        .from(settings)
        .where(eq(settings.organizationId, orgId(req)))
        .get();
      res.json(fila ? { ...fila, configured: true } : { ...defaultSettings(), configured: false });
    }),
  );

  router.put(
    '/api/settings',
    requireRole('admin'),
    asyncHandler(async (req: Request, res) => {
      const org = orgId(req);
      const input = settingsSchema.parse(req.body ?? {});

      const guardar = ctx.db.sqlite.transaction(() => {
        const existente = db
          .select({ id: settings.id })
          .from(settings)
          .where(eq(settings.organizationId, org))
          .get();
        if (existente) {
          return db
            .update(settings)
            .set({ ...input, updatedAt: nowIso() })
            .where(eq(settings.id, existente.id))
            .returning()
            .get();
        }
        return db
          .insert(settings)
          .values({
            id: createId('set'),
            organizationId: org,
            ...input,
            createdAt: nowIso(),
          })
          .returning()
          .get();
      });

      res.json({ ...guardar(), configured: true });
    }),
  );

  // El CRUD base va último: sus rutas (`/:id`) son comodines.
  router.use(
    '/api/items',
    crudRouter(ctx.handle, {
      table: items,
      idPrefix: 'item',
      orderBy: items.name,
      orderDirection: 'asc',
      search: [items.name, items.sku],
      // La baja es lógica (`archived_at`), no un DELETE: los movimientos se
      // conservan y el historial sigue cuadrando. Borrar de verdad tiraría la
      // cascada y con ella la explicación de todas las salidas de stock.
      archive: true,
      // Misma política que el legacy: cualquier miembro carga y edita
      // artículos, pero dar de baja y mover stock es decisión de admin.
      writeRole: 'member',
      deleteRole: 'admin',
      fields: {
        name: { schema: texto },
        sku: { schema: z.string().trim().max(60).optional() },
        // La cantidad no se escribe por acá: solo por movimientos.
        quantity: { readonly: true },
        minQuantity: { schema: cantidad.default(0) },
        unit: { schema: z.string().trim().max(30).default('unidad') },
        priceCents: { schema: cantidad.default(0) },
        active: { schema: booleano.default(true) },
      },
    }),
  );

  /**
   * Datos de ejemplo, para la organización de la sesión. Solo en desarrollo:
   * en producción este camino ni existe, para que nadie siembre un catálogo
   * falso en una empresa real.
   */
  if (!ctx.config.isProd) {
    router.post(
      '/api/seed',
      requireRole('admin'),
      asyncHandler(async (req: Request, res) => {
        const creados = seedDemo(ctx, orgId(req));
        res.json({ creados, nota: creados === 0 ? 'La organización ya tenía artículos' : undefined });
      }),
    );
  }

  return [router];
}
