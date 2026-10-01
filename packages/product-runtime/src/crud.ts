import { and, asc, count, desc, eq, isNull, like, or, type SQL } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z, type ZodTypeAny } from 'zod';
import { orgId, requireRole, type Identity } from './auth.js';
import { AppError, asyncHandler } from './errors.js';
import { createId, nowIso } from './ids.js';
import type { ProductDb } from './db.js';

/**
 * CRUD con aislamiento incorporado.
 *
 * La idea: que un endpoint NO PUEDA quedarse sin filtro de organizacion. Un
 * `crudRouter` genera los cinco endpoints (listar, ver, crear, editar, borrar)
 * y todos llevan `organization_id` puesto por el servidor. Un producto que
 * necesita algo distinto escribe su router a mano, pero igual tiene que pasar
 * por `orgId(req)`.
 *
 * Que organization_id venga de la sesion y no del cuerpo es lo que impide la
 * escalada horizontal: no hay forma de que el cliente diga "los datos son de
 * otra empresa" porque no se le escucha.
 */

export interface FieldSpec {
  /** Validador del valor. Opcional para columnas de solo lectura. */
  schema?: ZodTypeAny;
  /** Valor por defecto al crear. */
  default?: unknown;
  /** Solo lectura: no se puede escribir por la API (ej. created_at). */
  readonly?: boolean;
  /** Transformar el valor antes de escribir (ej. boolean -> 0/1). */
  toDb?: (value: any) => any;
  /** Transformar al leer. */
  fromDb?: (value: any) => any;
}

export type Fields = Record<string, FieldSpec>;

export interface CrudOptions {
  /** Tabla del producto. Debe tener `id` y `organization_id`. */
  table: any;
  fields: Fields;
  /** Prefijo de los ids que genera. */
  idPrefix?: string;
  /** Orden por defecto de la lista. */
  orderBy?: any;
  orderDirection?: 'asc' | 'desc';
  /** Columnas donde se busca con ?q= */
  search?: any[];
  /**
   * Filtros de igualdad permitidos en el listado, con su validador.
   *
   * Sin esto, `?status=pending` se ignora en silencio y la pantalla parece filtrada
   * mientras muestra todo: es peor que un error, porque el usuario cree que está
   * mirando una cartera y está mirando otra. Cada filtro se valida con su schema y
   * un valor que no existe devuelve 400 en vez de caer a "sin filtro".
   *
   * Solo se lee lo que el producto declara acá, así que ningún endpoint puede
   * terminar filtrando por una columna que la sesión no conoce.
   */
  filters?: Record<string, { column: any; schema: ZodTypeAny }>;
  /** Maximo de filas por pagina, para que un listar no se coma la memoria. */
  defaultLimit?: number;
  maxLimit?: number;
  /** En vez de borrar, marcar `archived_at` (si la tabla lo tiene). */
  archive?: boolean;
  /**
   * Rol mínimo para crear y editar. Por defecto `member`: en la mayoría de los
   * productos cualquier miembro de la empresa escribe sus datos.
   */
  writeRole?: Identity['role'];
  /**
   * Rol mínimo para dar de baja. Por defecto, el mismo que `writeRole`.
   *
   * Existe aparte porque casi siempre la baja es una decisión de negocio más
   * fuerte que crear un registro: se puede dejar que un miembro cargue
   * artículos y que solo un admin los de de baja, que es como funcionaba el
   * inventario legacy.
   */
  deleteRole?: Identity['role'];
  /** Nombre del producto, para los mensajes. */
  label?: string;
}

interface Db {
  db: ProductDb['db'];
}

function pick(source: Record<string, unknown>, fields: Fields, partial: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.readonly) continue;
    const raw = source[name];
    if (raw === undefined) {
      if (partial) continue;
      if (spec.default !== undefined) out[name] = spec.default;
      continue;
    }
    out[name] = spec.toDb ? spec.toDb(raw) : raw;
  }
  return out;
}

/**
 * Arma el schema de validación a partir de la declaración de campos.
 *
 * El `.partial()` se aplica al OBJETO, no a cada campo: un campo puede ser
 * cualquier cosa de zod (un `z.preprocess`, un `z.coerce.number().default(0)`,
 * un `z.string().optional()`) y sólo `ZodObject` tiene `.partial()`. Si se
 * llama sobre el campo, un `ZodEffects` revienta con "partial is not a
 * function".
 *
 * Efecto útil: en un PATCH, un campo ausente queda en `undefined` y no se
 * escribe, aunque su schema tenga default. Un default sólo entra al crear.
 */
/**
 * Traduce el `unrecognized_keys` de zod a un error que diga QUE campo sobra.
 *
 * Sin esto el 400 llegaba como `Datos invalidos` con el texto en ingles
 * ("Unrecognized key(s) in object: 'emial'") escondido en `errors.formErrors`, y
 * el error que mas importa --el nombre mal escrito que el usuario creyo que se
 * guardo-- no se leia. Se sube a `error` para que la UI lo muestre igual que
 * cualquier otro.
 */
function parseCuerpo(schema: ZodTypeAny, cuerpo: unknown) {
  const r = schema.safeParse(cuerpo ?? {});
  if (r.success) return r.data;
  const sobrantes = r.error.issues.filter((i) => i.code === 'unrecognized_keys');
  if (sobrantes.length) {
    const nombres = [...new Set(sobrantes.flatMap((i) => (i as { keys: string[] }).keys))];
    throw new AppError(
      400,
      `Campo desconocido: ${nombres.join(', ')}. Revisa el nombre; si esta bien escrito, no lo mandes.`,
      r.error.flatten(),
    );
  }
  throw r.error;
}

function buildSchema(fields: Fields, partial: boolean) {
  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.readonly) continue;
    shape[name] = spec.schema ?? z.any();
  }
  // `.strict()` y no el default (que borra lo sobrante en silencio): un `emial`
  // mal escrito se aceptaba, se descartaba y el alta salia con el correo vacio,
  // y el usuario no se enteraba hasta que intentaba mandarlo.
  const objeto = z.object(shape).strict();
  return partial ? objeto.partial() : objeto;
}

function readRow(row: any, fields: Fields) {
  if (!row) return row;
  const out: Record<string, unknown> = { ...row };
  for (const [name, spec] of Object.entries(fields)) {
    if (spec.fromDb && name in out) out[name] = spec.fromDb(out[name]);
  }
  return out;
}

export function crudRouter(handle: Db, options: CrudOptions): Router {
  const {
    table,
    fields,
    idPrefix = 'row',
    orderBy = table.createdAt,
    orderDirection = 'desc',
    search = [],
    filters = {},
    defaultLimit = 200,
    maxLimit = 1000,
    archive = false,
    writeRole = 'member',
    deleteRole = writeRole,
  } = options;

  const createSchema = buildSchema(fields, false);
  const updateSchema = buildSchema(fields, true);
  const router = Router();

  // Los permisos se aplican por metodo: leer es de cualquiera, escribir tiene su
  // minimo y dar de baja el suyo. Un `member` que no puede crear un artículo no
  // es un bug del runtime, es lo que el producto declaró.
  const puedeEscribir = requireRole(writeRole);
  const puedeBorrar = requireRole(deleteRole);

  const orgColumn = table.organizationId;
  if (!orgColumn) {
    throw new Error('crudRouter: la tabla necesita una columna organization_id');
  }

  /** GET / -> lista de la organizacion, jamas de otra. */
  router.get(
    '/',
    asyncHandler(async (req: Request, res) => {
      const org = orgId(req);
      const where: SQL[] = [eq(orgColumn, org)];

      if (archive && table.archivedAt) {
        // `archived_at IS NULL`, no `= NULL`: en SQL, comparar con NULL nunca
        // es verdadero, asi que con `eq` volverian todos los registros.
        where.push(isNull(table.archivedAt));
      }

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q && search.length > 0) {
        const match = `%${q}%`;
        const parts = search.map((column) => like(column, match));
        where.push(or(...parts)!);
      }

      for (const [name, spec] of Object.entries(filters)) {
        const raw = req.query[name];
        if (raw === undefined) continue;
        // Un filtro sin valor ("?status") se ignora: el usuario quiere todos, no
        // una lista vacia. Un valor que NO existe es un error de la pantalla y se
        // dice, en vez de devolver todo y dejar que el usuario crea que filtro.
        if (raw === '') continue;
        const parsed = spec.schema.safeParse(Array.isArray(raw) ? raw[0] : raw);
        if (!parsed.success) {
          throw new AppError(400, `El filtro ${name} no es valido`, {
            fields: parsed.error.issues.map((i) => `${i.path.join('.') || name}: ${i.message}`),
          });
        }
        where.push(eq(spec.column, parsed.data));
      }

      const limit = Math.min(Number(req.query.limit) || defaultLimit, maxLimit);
      const offset = Number(req.query.offset) || 0;
      const order = orderDirection === 'asc' ? asc(orderBy) : desc(orderBy);

      const rows = handle.db
        .select()
        .from(table)
        .where(and(...where))
        .orderBy(order)
        .limit(limit)
        .offset(offset)
        .all()
        .map((r: any) => readRow(r, fields));

      const [{ total }] = handle.db
        .select({ total: count() })
        .from(table)
        .where(and(...where))
        .all() as Array<{ total: number }>;

      res.json({ items: rows, total, limit, offset });
    }),
  );

  /** GET /:id -> de la organizacion o 404. Nunca 403: no se confirma que exista. */
  router.get(
    '/:id',
    asyncHandler(async (req: Request, res) => {
      const row = handle.db
        .select()
        .from(table)
        .where(and(eq(table.id, req.params.id), eq(orgColumn, orgId(req))))
        .get();
      if (!row) throw new AppError(404, 'No encontrado');
      res.json(readRow(row, fields));
    }),
  );

  /** POST / -> crea en la organizacion de la sesion. El id lo pone el servidor. */
  router.post(
    '/',
    puedeEscribir,
    asyncHandler(async (req: Request, res) => {
      const data = pick(parseCuerpo(createSchema, req.body), fields, false);
      const row = handle.db
        .insert(table)
        .values({
          id: createId(idPrefix),
          organizationId: orgId(req),
          ...data,
          ...(table.createdAt ? { createdAt: nowIso() } : {}),
        } as any)
        .returning()
        .get();
      res.status(201).json(readRow(row, fields));
    }),
  );

  /** PATCH /:id */
  router.patch(
    '/:id',
    puedeEscribir,
    asyncHandler(async (req: Request, res) => {
      const data = pick(parseCuerpo(updateSchema, req.body), fields, true);
      const row = handle.db
        .update(table)
        .set({ ...data, ...(table.updatedAt ? { updatedAt: nowIso() } : {}) } as any)
        .where(and(eq(table.id, req.params.id), eq(orgColumn, orgId(req))))
        .returning()
        .get();
      if (!row) throw new AppError(404, 'No encontrado');
      res.json(readRow(row, fields));
    }),
  );

  /** DELETE /:id -> borra, o archiva si la tabla tiene archived_at. */
  router.delete(
    '/:id',
    puedeBorrar,
    asyncHandler(async (req: Request, res) => {
      const where = and(eq(table.id, req.params.id), eq(orgColumn, orgId(req)));
      if (archive && table.archivedAt) {
        const row = handle.db
          .update(table)
          .set({ archivedAt: nowIso() } as any)
          .where(where)
          .returning()
          .get();
        if (!row) throw new AppError(404, 'No encontrado');
        return res.json({ ok: true, archived: true });
      }
      const row = handle.db.delete(table).where(where).returning().get();
      if (!row) throw new AppError(404, 'No encontrado');
      res.json({ ok: true, deleted: true });
    }),
  );

  return router;
}
