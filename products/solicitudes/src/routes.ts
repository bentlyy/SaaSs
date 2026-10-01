import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, like, ne, or, sql } from 'drizzle-orm';
import {
  AppError,
  asyncHandler,
  createId,
  identity,
  nowIso,
  orgId,
  type ProductConfig,
  type ProductContext,
  type ProductDb,
  zonaHoraria,
  enviarAdjunto,
  nombreSeguro,
  revisarAdjunto,
} from '@amg/product-runtime';
import { attachments, comments, requests, settings, statusHistory } from './schema.js';

/**
 * API de solicitudes.
 *
 * Cinco invariantes, y las cinco estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Un cliente no puede pedir las solicitudes de otra empresa aunque
 *      adivine el id.
 *
 *   2. El FOLIO es unico por organizacion. No global: cada empresa numera desde
 *      uno. Si fuera global, la segunda empresa en abrir no podria empezar.
 *
 *   3. El historial de estados se escribe cuando el estado cambia, no en la UI.
 *      Una llamada a la API puede cambiar el estado, y ese cambio tiene que
 *      quedar tan registrado como uno hecho desde la pantalla.
 *
 *   4. Solicitante y responsable son textos libres: no se exige que existan en
 *      ningun catalogo. Por eso cada solicitud se puede leer sin resolver
 *      ninguna referencia.
 *
 *   5. Los adjuntos viven en disco, fuera de la base. `attachments.path` es
 *      relativo a la carpeta de datos y al servir nunca se confia en el como
 *      ruta absoluta: la ruta se re-construye desde el id del adjunto.
 */

const texto = z.string().trim().min(1).max(200);
const textoLargo = z.string().trim().max(4000);
const email = z.string().trim().email('Correo invalido').max(200);
const id = z.string().trim().min(1).max(64);

/**
 * Los estados de una solicitud, en el orden en que se avanza.
 *
 * `closed` y `cancelled` son terminales: se marca `closed_at` y cuentan como
 * solicitudes cerradas. `resolved` es el estado en que se entrego la solucion
 * pero el hilo puede reabrirse, y por eso no cierra.
 */
const ESTADOS = ['open', 'in_progress', 'resolved', 'closed', 'cancelled'] as const;
type Estado = (typeof ESTADOS)[number];

/** Los estados en los que una solicitud sigue pendiente de algo. */
const ABIERTOS: Estado[] = ['open', 'in_progress'];

/** Los estados que cierran: marcan `closed_at` y no cuentan como abiertas. */
const TERMINALES: Estado[] = ['closed', 'cancelled'];

const PRIORIDADES = ['low', 'medium', 'high', 'urgent'] as const;
type Prioridad = (typeof PRIORIDADES)[number];

export const ETIQUETAS_ESTADO: Record<Estado, string> = {
  open: 'Abierta',
  in_progress: 'En curso',
  resolved: 'Resuelta',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
};

export const ETIQUETAS_PRIORIDAD: Record<Prioridad, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  urgent: 'Urgente',
};

/**
 * "Para cuando" es una FECHA, no un instante.
 *
 * Se valida el formato a mano en vez de usar `Date.parse`, porque `Date.parse`
 * acepta "2026-9-4" y "septiembre de 2026" y tambien "42": una fecha limite es
 * lo que se prometio, y tiene que ser una fecha que se pueda leer y comparar.
 */
const fechaLimite = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha limite va como AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha invalida')
  .nullable()
  .optional();

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
  };
}

const solicitudSchema = z.object({
  /** Si no viene, se propone el folio siguiente de la organizacion. */
  number: z.coerce.number().int().min(1).max(9_999_999).nullable().optional(),
  title: texto,
  description: textoLargo.nullable().optional(),
  requesterName: texto,
  requesterEmail: z.union([email, z.literal(''), z.null()]).nullable().optional(),
  responsibleName: z.string().trim().max(150).nullable().optional(),
  priority: z.enum(PRIORIDADES).default('medium'),
  status: z.enum(ESTADOS).default('open'),
  dueAt: fechaLimite,
  resolution: textoLargo.nullable().optional(),
});

/**
 * La carpeta donde viven los adjuntos.
 *
 * Al lado de la base del producto: en produccion es el volumen `/app/data`, asi
 * los archivos sobreviven al recrear el contenedor. En tests la base es
 * `:memory:` y no tiene carpeta: se usa una temporal, una sola por aplicacion,
 * para que una subida y su descarga encuentren el mismo archivo.
 */
const directorioAdjuntosCache = new Map<string, string>();
function directorioAdjuntos(config: ProductConfig): string {
  const cacheado = directorioAdjuntosCache.get(config.dbPath);
  if (cacheado) return cacheado;
  const dir =
    config.dbPath === ':memory:'
      ? join(tmpdir(), `amg-solicitudes-adjuntos-${randomUUID().slice(0, 8)}`)
      : join(dirname(resolve(config.dbPath)), 'attachments');
  directorioAdjuntosCache.set(config.dbPath, dir);
  return dir;
}

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;
  const carpetaAdjuntos = directorioAdjuntos(ctx.config);

  /** Una solicitud tiene que ser de ESTA organizacion, no solo existir. */
  function solicitudDe(org: string, requestId: string) {
    const fila = db
      .select()
      .from(requests)
      .where(and(eq(requests.id, requestId), eq(requests.organizationId, org)))
      .get();
    if (!fila) throw new AppError(404, 'Esa solicitud no existe');
    return fila;
  }

  /**
   * El folio siguiente de una organizacion.
   *
   * Se calcula como el MAYOR folio que existe mas uno, y no como "contar + 1":
   * si se cancela una solicitud, contar da un numero que ya existe y choca
   * contra el indice unico. El maximo mas uno nunca repite.
   */
  function folioSiguiente(org: string) {
    const maximo = db
      .select({ n: sql<number | null>`MAX(${requests.number})` })
      .from(requests)
      .where(eq(requests.organizationId, org))
      .get();
    return (maximo?.n ?? 0) + 1;
  }

  /** Si el estado cierra, marca la fecha; si se reabre, la limpia. */
  function closedAtDe(status: Estado, previo: string | null, ahora: string) {
    return TERMINALES.includes(status) ? previo ?? ahora : null;
  }

  /**
   * Escribe una solicitud: crea o edita, y registra el historial en la MISMA
   * transaccion que guarda el estado. Si falla el historial, no se guarda el
   * estado, y viceversa: un cambio sin rastro es un cambio que no se puede
   * auditar.
   *
   * `escribirSolicitud` DEVUELVE la solicitud, no la envia: la usan el POST y el
   * PATCH, que se diferencian solo en el codigo de estado. El que hace
   * `res.json` es el envoltorio de abajo, porque express no mira el valor de
   * retorno de un handler: si nadie responde, la peticion queda colgada para
   * siempre.
   */
  function escribirSolicitud(
    org: string,
    body: z.infer<typeof solicitudSchema>,
    autor: string,
    idSol?: string,
  ) {
    const ahora = nowIso();

    return db.transaction((tx) => {
      const numero = body.number ?? folioSiguiente(org);

      /**
       * El folio se chequea DENTRO de la transaccion, junto con el insert.
       * Comprobar antes y escribir despues deja una ventana: dos personas
       * creando una solicitud en el mismo segundo pasan las dos el chequeo, y
       * la segunda revienta con un error de SQLite en vez de un 409 que
       * entienda.
       */
      const choque = tx
        .select({ id: requests.id })
        .from(requests)
        .where(
          and(
            eq(requests.organizationId, org),
            eq(requests.number, numero),
            ...(idSol ? [ne(requests.id, idSol)] : []),
          ),
        )
        .get();
      if (choque) {
        throw new AppError(409, `Ya existe la solicitud numero ${numero} en esta empresa`);
      }

      if (idSol) {
        const existente = tx
          .select()
          .from(requests)
          .where(and(eq(requests.id, idSol), eq(requests.organizationId, org)))
          .get();
        if (!existente) throw new AppError(404, 'Esa solicitud no existe');

        const actualizada = tx
          .update(requests)
          .set({
            number: numero,
            title: body.title,
            description: body.description ?? null,
            requesterName: body.requesterName,
            requesterEmail: body.requesterEmail ?? null,
            responsibleName: body.responsibleName ?? null,
            priority: body.priority,
            status: body.status,
            dueAt: body.dueAt ?? null,
            resolution: body.resolution ?? null,
            closedAt: closedAtDe(body.status, existente.closedAt, ahora),
            updatedAt: ahora,
          })
          .where(and(eq(requests.id, idSol), eq(requests.organizationId, org)))
          .returning()
          .get();

        // Un PATCH que no cambia el estado no agrega historial: una edicion de
        // texto no es un acontecimiento de estado.
        if (actualizada.status !== existente.status) {
          tx.insert(statusHistory)
            .values({
              id: createId('solhist'),
              organizationId: org,
              requestId: idSol,
              oldStatus: existente.status,
              newStatus: actualizada.status,
              changedBy: autor,
              createdAt: ahora,
            })
            .run();
        }
        return actualizada;
      }

      const idFinal = createId('sol');
      const estadoInicial = body.status as Estado;
      tx.insert(requests)
        .values({
          id: idFinal,
          organizationId: org,
          number: numero,
          title: body.title,
          description: body.description ?? null,
          requesterName: body.requesterName,
          requesterEmail: body.requesterEmail ?? null,
          responsibleName: body.responsibleName ?? null,
          priority: body.priority,
          status: body.status,
          dueAt: body.dueAt ?? null,
          resolution: body.resolution ?? null,
          closedAt: closedAtDe(estadoInicial, null, ahora),
          createdAt: ahora,
          updatedAt: ahora,
        })
        .run();

      // La primera entrada del historial documenta el estado en que nacio.
      tx.insert(statusHistory)
        .values({
          id: createId('solhist'),
          organizationId: org,
          requestId: idFinal,
          oldStatus: null,
          newStatus: body.status,
          changedBy: autor,
          createdAt: ahora,
        })
        .run();

      return tx.select().from(requests).where(eq(requests.id, idFinal)).get()!;
    });
  }

  // ─────────────────────────────────────────────────────────────────── resumen

  /**
   * Numeros de la pantalla principal, para las tarjetas de arriba.
   *
   * "Vencidas" son las abiertas cuya fecha limite ya paso: pisar la fecha no
   * cierra la solicitud, y contarlas es lo que hace que alguien la retome.
   */
  router.get(
    '/api/resumen',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const todas = db.select().from(requests).where(eq(requests.organizationId, org)).all();

      const fecha = new Date();
      const hoy = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(
        fecha.getDate(),
      ).padStart(2, '0')}`;

      const abiertas = todas.filter((r) => ABIERTOS.includes(r.status as Estado));
      const vencidas = abiertas.filter((r) => r.dueAt !== null && r.dueAt < hoy);
      const resueltas = todas.filter((r) =>
        (['resolved', 'closed', 'cancelled'] as Estado[]).includes(r.status as Estado),
      );
      const alta = abiertas.filter((r) => r.priority === 'high' || r.priority === 'urgent');

      res.json({
        total: todas.length,
        abiertas: abiertas.length,
        vencidas: vencidas.length,
        resueltas: resueltas.length,
        alta: alta.length,
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────── solicitudes

  /**
   * Listado con los filtros de la pantalla: estado, prioridad y busqueda.
   *
   * Los nombres de solicitante y responsable van en la fila, sin resolver
   * ninguna referencia: son textos libres, asi que la lista es una consulta y
   * no un repaso por solicitud.
   */
  router.get(
    '/api/requests',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond = [eq(requests.organizationId, org)];
      if (typeof req.query.status === 'string' && req.query.status) {
        cond.push(eq(requests.status, req.query.status));
      }
      if (typeof req.query.priority === 'string' && req.query.priority) {
        cond.push(eq(requests.priority, req.query.priority));
      }
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q) {
        const patron = `%${q}%`;
        cond.push(
          or(
            like(requests.title, patron),
            like(requests.description, patron),
            like(requests.requesterName, patron),
            like(requests.responsibleName, patron),
          )!,
        );
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

      const filas = db
        .select()
        .from(requests)
        .where(and(...cond))
        .orderBy(desc(requests.number))
        .limit(limite)
        .all();

      res.json({ requests: filas, total: filas.length });
    }),
  );

  /** Una solicitud con su hilo: comentarios, adjuntos e historial. */
  router.get(
    '/api/requests/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      const fila = solicitudDe(org, idSol);

      const hilo = db
        .select()
        .from(comments)
        .where(and(eq(comments.organizationId, org), eq(comments.requestId, idSol)))
        .orderBy(comments.createdAt)
        .all();
      const archivos = db
        .select()
        .from(attachments)
        .where(and(eq(attachments.organizationId, org), eq(attachments.requestId, idSol)))
        .orderBy(attachments.createdAt)
        .all();
      const historial = db
        .select()
        .from(statusHistory)
        .where(and(eq(statusHistory.organizationId, org), eq(statusHistory.requestId, idSol)))
        .orderBy(statusHistory.createdAt)
        .all();

      res.json({
        request: fila,
        comments: hilo,
        attachments: archivos.map((a) => ({
          ...a,
          url: `/api/requests/${idSol}/attachments/${a.id}/file`,
        })),
        history: historial,
      });
    }),
  );

  router.post(
    '/api/requests',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cuerpo = solicitudSchema.parse(req.body);
      const creada = escribirSolicitud(org, cuerpo, identity(req).name);
      res.status(201).json({ request: creada });
    }),
  );

  router.patch(
    '/api/requests/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      const existente = solicitudDe(org, idSol);

      // El PATCH parte de la solicitud que ya existe, asi que un cliente puede
      // mandar solo el estado y no perder el resto. Un `parse` sobre el cuerpo
      // pelado exigiria mandar todos los campos siempre, y el que olvide uno se
      // queda sin guardar sin avisar.
      const body = solicitudSchema.parse({
        number: existente.number,
        title: existente.title,
        description: existente.description,
        requesterName: existente.requesterName,
        requesterEmail: existente.requesterEmail,
        responsibleName: existente.responsibleName,
        priority: existente.priority,
        status: existente.status,
        dueAt: existente.dueAt,
        resolution: existente.resolution,
        ...req.body,
      });

      const actualizada = escribirSolicitud(org, body, identity(req).name, existente.id);
      res.json({ request: actualizada });
    }),
  );

  router.delete(
    '/api/requests/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      solicitudDe(org, idSol);

      // Se leen los adjuntos ANTES de borrar: los archivos viven en disco y el
      // cascade se lleva las filas, pero las filas son lo unico que dice donde
      // estan los archivos.
      const archivos = db
        .select()
        .from(attachments)
        .where(and(eq(attachments.organizationId, org), eq(attachments.requestId, idSol)))
        .all();

      const borrada = db
        .delete(requests)
        .where(and(eq(requests.id, idSol), eq(requests.organizationId, org)))
        .returning()
        .get();
      if (!borrada) throw new AppError(404, 'Esa solicitud no existe');

      for (const archivo of archivos) {
        try {
          unlinkSync(join(carpetaAdjuntos, basename(archivo.path)));
        } catch {
          // Un adjunto cuyo archivo ya no existe no puede impedir el borrado.
        }
      }

      res.json({ request: borrada });
    }),
  );

  // ──────────────────────────────────────────────────────────────── comentarios

  router.post(
    '/api/requests/:id/comments',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      solicitudDe(org, idSol);
      const me = identity(req);

      const cuerpo = z.object({ content: z.string().trim().min(1).max(4000) }).parse(req.body);

      // El autor se congela al momento de escribir: si el usuario cambia de
      // nombre o se borra del Core, el hilo queda igual de legible.
      const comentario = {
        id: createId('solcom'),
        organizationId: org,
        requestId: idSol,
        authorName: me.name,
        authorUserId: me.userId,
        content: cuerpo.content,
        createdAt: nowIso(),
      };
      db.insert(comments).values(comentario).run();

      res.status(201).json({ comment: db.select().from(comments).where(eq(comments.id, comentario.id)).get() });
    }),
  );

  // ────────────────────────────────────────────────────────────────── adjuntos

  /**
   * Adjunta un archivo a la solicitud.
   *
   * El navegador envia el contenido en base64 dentro del JSON de la API; el
   * servidor lo decodifica y lo escribe en disco. El archivo NO entra a la
   * base: lo que se guarda es la referencia con su ruta relativa.
   */
  router.post(
    '/api/requests/:id/attachments',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      solicitudDe(org, idSol);

      const cuerpo = z
        .object({
          filename: z.string().trim().min(1).max(200),
          mimeType: z.string().trim().max(120).nullable().optional(),
          // Se acepta base64 pelado o con prefijo `data:...;base64,`.
          data: z.string().trim().min(4),
        })
        .parse(req.body);

      const luego = cuerpo.data.includes(';base64,') ? cuerpo.data.split(';base64,')[1] : cuerpo.data;
      const buffer = Buffer.from(luego as string, 'base64');
      revisarAdjunto({
        filename: cuerpo.filename,
        mimeType: cuerpo.mimeType,
        bytes: buffer.length,
      }, 750_000);

      const adjuntoId = createId('soladj');
      // El nombre en disco se deriva del id, nunca del que envio el cliente: un
      // nombre llegado de afuera no vale para armar una ruta. El original se
      // conserva solo en la columna `filename`, para mostrarlo y descargarlo, y
      // se sanea para que no pueda romper la cabecera de la descarga.
      mkdirSync(carpetaAdjuntos, { recursive: true });
      writeFileSync(join(carpetaAdjuntos, adjuntoId), buffer);

      const adjunto = {
        id: adjuntoId,
        organizationId: org,
        requestId: idSol,
        filename: nombreSeguro(cuerpo.filename, 'adjunto'),
        path: `attachments/${adjuntoId}`,
        mimeType: cuerpo.mimeType ?? null,
        sizeBytes: buffer.length,
        createdAt: nowIso(),
      };
      db.insert(attachments).values(adjunto).run();

      res.status(201).json({
        attachment: adjunto,
        url: `/api/requests/${idSol}/attachments/${adjuntoId}/file`,
      });
    }),
  );

  /** Descarga el archivo, con el nombre original con el que se envio. */
  router.get(
    '/api/requests/:id/attachments/:attId/file',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      const attId = id.parse(req.params.attId);
      solicitudDe(org, idSol);

      const adjunto = db
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.id, attId), eq(attachments.organizationId, org), eq(attachments.requestId, idSol)),
        )
        .get();
      if (!adjunto) throw new AppError(404, 'Ese adjunto no existe');

      // La ruta se re-construye desde el id y nunca se confia en `adjunto.path`
      // como ruta absoluta: `basename` descarta cualquier intento de escape.
      const ruta = join(carpetaAdjuntos, basename(adjunto.path));
      if (!existsSync(ruta)) throw new AppError(404, 'El archivo ya no existe');

      enviarAdjunto(res, ruta, { filename: adjunto.filename, mimeType: adjunto.mimeType });
    }),
  );

  router.delete(
    '/api/requests/:id/attachments/:attId',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSol = id.parse(req.params.id);
      const attId = id.parse(req.params.attId);
      solicitudDe(org, idSol);

      const adjunto = db
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.id, attId), eq(attachments.organizationId, org), eq(attachments.requestId, idSol)),
        )
        .get();
      if (!adjunto) throw new AppError(404, 'Ese adjunto no existe');

      db.delete(attachments)
        .where(and(eq(attachments.id, attId), eq(attachments.organizationId, org)))
        .run();
      try {
        unlinkSync(join(carpetaAdjuntos, basename(adjunto.path)));
      } catch {
        // Un archivo que ya no esta en disco no impide quitar la fila.
      }

      res.json({ ok: true, deleted: true });
    }),
  );

  // ────────────────────────────────────────────────────────────── preferencias

  router.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const pref = leerPreferencias(db, org);
      // Se manda tambien el folio que se propondria. La UI lo muestra como
      // propuesta y no lo fija: la organizacion puede tener su propia numeracion.
      res.json({ settings: { ...pref, nextNumber: folioSiguiente(org) } });
    }),
  );

  router.put(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idCfg = `cfg_${org}`;
      const cuerpo = z
        .object({
          currency: z.string().trim().min(1).max(5).default('$'),
          timezone: zonaHoraria.default('America/Santiago'),
        })
        .parse(req.body);

      const yaEsta = db.select().from(settings).where(eq(settings.organizationId, org)).get();
      if (yaEsta) {
        db.update(settings)
          .set({ ...cuerpo, updatedAt: nowIso() })
          .where(eq(settings.organizationId, org))
          .run();
      } else {
        db.insert(settings)
          .values({ id: idCfg, organizationId: org, ...cuerpo, createdAt: nowIso() })
          .run();
      }
      res.json({ settings: leerPreferencias(db, org) });
    }),
  );

  return [router];
}