import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, count, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { AppError, asyncHandler, createId, crudRouter, nowIso, orgId, requireRole, type ProductContext } from '@amg/product-runtime';
import { categories, items, movements, scanIncidents, settings } from './schema.js';
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

/** Un texto opcional que, vacío, se guarda como NULL y no como "". */
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === undefined || v === '' ? null : v));

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
  allowNegativeStock: booleano.default(false),
});

/**
 * Lo que cambia el escáner: un modo y las líneas ya leídas.
 *
 * No es un movimiento suelto por lectura: la cámara puede leer el mismo código
 * varias veces sin que la persona quiera, así que el frontend acumula lecturas
 * intencionales y manda una sola operación. En el backend, `in`/`out` suman o
 * restan `quantity`, y `adjust` deja el stock exactamente en `quantity` (que es
 * lo que se contó a mano).
 */
const scanCommitSchema = z.object({
  mode: z.enum(['in', 'out', 'adjust']),
  reason: z.string().trim().max(200).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().trim().min(1),
        quantity: z.coerce.number().int().min(0).max(1_000_000),
      }),
    )
    .min(1, 'No hay lecturas para confirmar')
    .max(200),
});

const incidentSchema = z.object({
  barcode: z.string().trim().min(1).max(120),
  note: z.string().trim().max(200).optional(),
});

const ETIQUETA_MODO = { in: 'Entrada', out: 'Salida', adjust: 'Ajuste' } as const;

/** Lo que se usa cuando la organización todavía no guardó preferencias. */
export const defaultSettings = () => ({
  defaultUnit: 'unidad',
  defaultMinQuantity: 0,
  currency: '$',
  allowNegativeStock: false,
});

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /** Si la organización permite que una salida deje el stock en negativo. */
  function permiteNegativo(org: string): boolean {
    const fila = db
      .select({ allow: settings.allowNegativeStock })
      .from(settings)
      .where(eq(settings.organizationId, org))
      .get();
    return fila?.allow ?? false;
  }

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
            isNull(items.archivedAt),
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
        .where(and(eq(items.organizationId, org), eq(items.active, true), isNull(items.archivedAt)))
        .all();

      const [bajos] = db
        .select({ n: count() })
        .from(items)
        .where(and(eq(items.organizationId, org), lte(items.quantity, items.minQuantity), eq(items.active, true), isNull(items.archivedAt)))
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
      // stock. Ahora se rechaza y se dice por qué, salvo que la organización
      // haya aceptado a propósito trabajar con stock negativo.
      const siguiente = item.quantity + input.delta;
      if (siguiente < 0 && !permiteNegativo(org)) {
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
   * El escáner. Dos consultas y una operación:
   *
   *   - `lookup`: a qué artículo corresponde un código leído. No modifica nada.
   *   - `commit`: aplica una tanda de lecturas como UN movimiento por artículo.
   *   - `incidents`: la nota de los códigos que se decidió ignorar.
   *
   * Una lectura sola nunca toca el stock: entre la lectura y el cambio hay un
   * `commit` explícito, que es donde recién se mueve la cantidad y se deja
   * registro. Es la invariante del producto aplicada al escáner.
   */
  router.get(
    '/api/scan/lookup',
    asyncHandler(async (req: Request, res) => {
      const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      if (!code) throw new AppError(400, 'Falta el código escaneado');

      const org = orgId(req);
      const item = db
        .select()
        .from(items)
        .where(
          and(
            eq(items.organizationId, org),
            or(eq(items.barcode, code), eq(items.sku, code)),
            eq(items.active, true),
            isNull(items.archivedAt),
          ),
        )
        .get();

      res.json({ code, found: Boolean(item), item: item ?? null });
    }),
  );

  router.post(
    '/api/scan/commit',
    requireRole('admin'),
    asyncHandler(async (req: Request, res) => {
      const input = scanCommitSchema.parse(req.body);
      const org = orgId(req);
      const negativo = permiteNegativo(org);
      const actor = req.amg;
      const etiqueta = ETIQUETA_MODO[input.mode];
      const reason = input.reason?.trim() ? `${etiqueta}: ${input.reason.trim()}` : `${etiqueta} por escáner`;

      const aplicar = ctx.db.sqlite.transaction(() => {
        const resultado: Array<{ itemId: string; name: string; quantity: number; delta: number; unit: string }> = [];

        for (const linea of input.lines) {
          const item = db
            .select()
            .from(items)
            .where(and(eq(items.id, linea.itemId), eq(items.organizationId, org)))
            .get();
          if (!item) throw new AppError(404, `Artículo no encontrado: ${linea.itemId}`);

          let delta: number;
          if (input.mode === 'in') {
            if (linea.quantity <= 0) throw new AppError(400, `La entrada de ${item.name} necesita una cantidad mayor a 0`);
            delta = linea.quantity;
          } else if (input.mode === 'out') {
            if (linea.quantity <= 0) throw new AppError(400, `La salida de ${item.name} necesita una cantidad mayor a 0`);
            delta = -linea.quantity;
          } else {
            delta = linea.quantity - item.quantity;
          }

          // Un ajuste que no cambia nada no genera movimiento: no hay delta que
          // registrar, y un movimiento de 0 sería ruido en el historial.
          if (delta === 0) {
            resultado.push({ itemId: item.id, name: item.name, quantity: item.quantity, delta: 0, unit: item.unit });
            continue;
          }

          const siguiente = item.quantity + delta;
          if (siguiente < 0 && !negativo) {
            throw new AppError(
              400,
              `No hay stock suficiente de ${item.name}: hay ${item.quantity} ${item.unit} y la salida pide ${Math.abs(delta)}`,
            );
          }

          db.update(items)
            .set({ quantity: siguiente, updatedAt: nowIso() })
            .where(eq(items.id, item.id))
            .run();
          db.insert(movements)
            .values({
              id: createId('mov'),
              organizationId: org,
              itemId: item.id,
              delta,
              reason,
              actorUserId: actor?.userId ?? null,
              actorName: actor?.name ?? null,
              createdAt: nowIso(),
            })
            .run();
          resultado.push({ itemId: item.id, name: item.name, quantity: siguiente, delta, unit: item.unit });
        }
        return resultado;
      });

      const lineas = aplicar();
      res.status(201).json({
        mode: input.mode,
        reason,
        lines: lineas,
        movimientos: lineas.filter((l) => l.delta !== 0).length,
      });
    }),
  );

  // Códigos leídos que no se convirtieron en artículo. Es una nota, no stock.
  router.get(
    '/api/scan-incidents',
    asyncHandler(async (req: Request, res) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
      const rows = db
        .select()
        .from(scanIncidents)
        .where(eq(scanIncidents.organizationId, orgId(req)))
        .orderBy(desc(scanIncidents.createdAt), desc(scanIncidents.id))
        .limit(limit)
        .all();
      res.json({ incidents: rows });
    }),
  );

  router.post(
    '/api/scan-incidents',
    requireRole('member'),
    asyncHandler(async (req: Request, res) => {
      const input = incidentSchema.parse(req.body);
      const actor = req.amg;
      const row = db
        .insert(scanIncidents)
        .values({
          id: createId('inc'),
          organizationId: orgId(req),
          barcode: input.barcode,
          note: input.note ?? null,
          actorUserId: actor?.userId ?? null,
          actorName: actor?.name ?? null,
          createdAt: nowIso(),
        })
        .returning()
        .get();
      res.status(201).json(row);
    }),
  );

  router.delete(
    '/api/scan-incidents/:id',
    requireRole('member'),
    asyncHandler(async (req: Request, res) => {
      const row = db
        .delete(scanIncidents)
        .where(and(eq(scanIncidents.id, req.params.id), eq(scanIncidents.organizationId, orgId(req))))
        .returning()
        .get();
      if (!row) throw new AppError(404, 'No encontrado');
      res.json({ ok: true, deleted: true });
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
      res.json({
        ...(fila ? { ...fila, configured: true } : { ...defaultSettings(), configured: false }),
        // La UI usa esto para esconder el botón de sembrar. Antes el botón salía
        // siempre y en el despliegue real no hay ruta `/api/seed` (solo existe
        // fuera de produccion), así que le daba a un admin a un 404 sin explicación.
        seedAvailable: !ctx.config.isProd,
      });
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

  // Categorías del almacén. CRUD genérico con aislamiento por organización; dar
  // de baja una categoría no borra sus artículos, los deja sin categoría (el
  // `ON DELETE SET NULL` de `items.category_id`).
  router.use(
    '/api/categories',
    crudRouter(ctx.handle, {
      table: categories,
      idPrefix: 'cat',
      orderBy: categories.name,
      orderDirection: 'asc',
      search: [categories.name],
      writeRole: 'member',
      deleteRole: 'admin',
      label: 'categoría',
      fields: {
        name: { schema: texto },
      },
    }),
  );

  // El CRUD base va al final: sus rutas (`/:id`) son comodines.
  router.use(
    '/api/items',
    crudRouter(ctx.handle, {
      table: items,
      idPrefix: 'item',
      orderBy: items.name,
      orderDirection: 'asc',
      // El escáner busca por código de barras y por SKU, así que los dos entran
      // en la búsqueda de la lista (`?q=`).
      search: [items.name, items.sku, items.barcode],
      filters: {
        categoryId: { column: items.categoryId, schema: z.string().trim().min(1).max(60) },
      },
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
        sku: { schema: textoOpcional(60) },
        // El código de barras es único por organización (índice parcial). El
        // texto vacío se guarda como NULL, no como "": si no, dos artículos sin
        // código chocarían entre sí.
        barcode: { schema: textoOpcional(60) },
        categoryId: { schema: textoOpcional(60) },
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
   * Un barcode repetido no puede ser un 500: es un dato que la persona escribió
   * mal, y merece un 400 que lo diga. Este manejador va pegado al CRUD de
   * artículos y solo traduce esa violación concreta; cualquier otro error sigue
   * su camino al manejador global.
   */
  router.use('/api/items', (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const mensaje = err instanceof Error ? err.message : '';
    if (/UNIQUE constraint failed:.*barcode/.test(mensaje)) {
      return res.status(400).json({ error: 'Ya hay un artículo con ese código de barras.' });
    }
    next(err);
  });

  /**
   * Datos de ejemplo, para la organizacion de la sesión. Solo en desarrollo:
   * en producción sembrar es un camino que no existe, para que nadie cargue un
   * catálogo falso en una empresa real.
   *
   * La ruta se registra SIEMPRE, y en producción responde 403 con un motivo. Antes
   * no se registraba, así que el 404 no decía si el botón andaba mal, si faltaban
   * permisos o si la función estaba apagada a propósito.
   */
  router.post(
    '/api/seed',
    requireRole('admin'),
    asyncHandler(async (req: Request, res) => {
      if (ctx.config.isProd) {
        throw new AppError(403, 'Cargar artículos de ejemplo está disponible solo en desarrollo.');
      }
      const creados = seedDemo(ctx, orgId(req));
      res.json({ creados, nota: creados === 0 ? 'La organización ya tenía artículos' : undefined });
    }),
  );

  return [router];
}
