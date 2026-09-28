import { Router } from 'express';
import { and, asc, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppError,
  asyncHandler,
  createId,
  crudRouter,
  nowIso,
  orgId,
  requireRole,
  type ProductContext,
  type ProductDb,
} from '@amg/product-runtime';
import { runItems, runs, settings, templateItems, templates } from './schema.js';

/**
 * API de checklists e inspecciones.
 *
 * Cuatro invariantes, y las cuatro estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Una empresa no puede pedir los datos de otra aunque adivine el id.
 *
 *   2. La EJECUCION guarda un SNAPSHOT de la plantilla: el nombre y los puntos se
 *      copian al crearla. Editar la plantilla despues no puede cambiar lo ya
 *      ejecutado, y borrarla tampoco. Es el motivo del dominio, y esta en
 *      `POST /api/runs` y en el `ON DELETE SET NULL` del DDL.
 *
 *   3. Una corrida NO se puede completar si quedan puntos obligatorios sin
 *      responder. El chequeo va DENTRO de la transaccion que la cierra, y el 400
 *      dice cuales faltan. Cerrar con pendientes produce el "firmado en verde" que
 *      este producto existe para no equivocar.
 *
 *   4. `position` no tiene huecos: cuando se borra un punto, los que quedan se
 *      renumeran a 1..N. Y la renumeracion va en DOS fases, porque el indice
 *      UNIQUE `(template_id, position)` rechaza el simple "baja el 3 al 2" cuando
 *      el 2 todavia existe.
 *
 * ── POR QUE HAY RUTAS A MANO Y HAY `crudRouter` ──────────────────────────────
 *
 * `crudRouter` cubre el CRUD que es CRUD. Lo que NO cubre son tres cosas de este
 * producto, y por eso estan escritas a mano. Todas van ANTES del `crudRouter` que
 * comparten la URL, porque Express resuelve en orden de registro y gana la primera
 * coincidencia:
 *
 *   a) Las listas con un filtro que no es `?q=`. El CRUD generico solo sabe
 *      buscar texto; `?active=1` y `?status=` se hacen con el mismo
 *      `eq(organization_id, org)` y devuelven la misma forma de respuesta
 *      (`items`, `total`, `limit`, `offset`).
 *
 *   b) `POST /api/templates` y `POST /api/runs` con filas HIJAS en la misma
 *      llamada. El CRUD generico inserta una fila; este producto inserta la
 *      plantilla y sus puntos, o la corrida y su snapshot, en UNA transaccion. Una
 *      plantilla sin puntos o una corrida sin puntos son dos mitades del mismo
 *      hecho.
 *
 *   c) `PATCH /api/runs/:id` con la maquina de estados. Dejar el estado como un
 *      campo mas del CRUD seria una puerta trasera a la invariante 3: un PATCH con
 *      `status: "done"` sin responder los obligatorios. Por eso `status` NO es un
 *      campo escribible del `crudRouter` de corridas.
 *
 * ESTE producto NO tiene fuente legacy: no hay datos de inspecciones en ningun
 * producto viejo. Por eso no hay `migrate-legacy.ts` ni `legacy_tenant_map` que
 * mapear. Un migrador sin datos de los que leer es fiction.
 */

const texto = z.string().trim().min(1).max(150);
const id = z.string().trim().min(1).max(64);

/** La conexion que entrega `db.transaction`, para los helpers de este archivo. */
type Tx = Parameters<Parameters<ProductDb['db']['transaction']>[0]>[0];

/**
 * `active` y `required` son booleanos en la API y 0/1 en la base.
 *
 * Aceptar las tres formas (true, 1, "1") evita el `z.coerce.boolean()`, que
 * convierte `"false"` en `true`: un formulario que manda `"false"` y termina
 * guardando "activada" es un bug que se descubre tarde y se entiende peor. La
 * columna se guarda siempre 0 o 1 porque es lo que el CHECK del DDL acepta y lo
 * que el filtro `?active=1` compara.
 */
const flag = z
  .union([z.boolean(), z.literal(0), z.literal(1), z.literal('0'), z.literal('1')])
  .transform((v) => (v === true || v === 1 || v === '1' ? 1 : 0));

/** Un punto de checklist: lo que se revisa. El `position` lo pone el servidor. */
const itemSchema = z.object({
  label: z.string().trim().min(1, 'Un punto necesita un texto').max(200),
  required: flag.default(1),
});

/** Un instante ISO: una inspeccion importa la hora, porque ya ocurrio. */
const instante = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Instante invalido: va como ISO, por ejemplo 2026-09-27T15:00:00.000Z');

/**
 * Los tres estados de una corrida, y las tres preguntas a las que contestan.
 *
 * Son cerrados a proposito: `in_progress` se esta llenando, `done` se cerro firmada
 * y `canceled` se abandono a medias. Un texto libre permitiria escribir
 * "terminada" o "cerrada" y la columna dejaria de poder filtrarse, que es la unica
 * razon por la que existe. El CHECK del DDL repite esta lista.
 */
const ESTADOS = ['in_progress', 'done', 'canceled'] as const;
type Estado = (typeof ESTADOS)[number];

/**
 * Las tres respuestas a un punto de inspeccion, y solo tres.
 *
 * `na` existe y es importante: un punto que en ese lugar no aplica ("el equipo
 * generador estaba en obra todo el dia") no es un `ok` con nota, y contarlo como
 * cumplimiento le regalaria a la empresa un punto que nadie reviso. Por eso el
 * resumen cuenta `na` aparte y el cumplimiento lo ignora.
 */
const RESPUESTAS = ['ok', 'fail', 'na'] as const;

/**
 * El nombre que lleva una corrida libre, la que se creo sin plantilla.
 *
 * `runs.template_name` es NOT NULL porque una corrida tiene que decir QUE se
 * estaba revisando, y en la corrida libre no hay plantilla de la que sacarlo. Se
 * pone este nombre en vez de dejar la columna nullable o la cadena vacia: una
 * fila sin nombre no se puede ordenar ni buscar, y el listado de corridas es
 * justamente donde se busca.
 */
const CORRIDA_LIBRE = 'Corrida libre';

/**
 * El sufijo de la copia, y como se agrega sin pasarse del maximo.
 *
 * Si el nombre ya esta al limite, `nombre + " (copia)"` seria mas largo de lo que
 * la columna y el validador aceptan, y la copia fallaria por un detalle de largo.
 * Se recorta la BASE, nunca el sufijo: una plantilla que se llamara
 * "Inspeccion (copia)" y no dijera de que es un problema mas confuso que una a la
 * que se le recortara el nombre.
 */
const SUFIJO_COPIA = ' (copia)';
const NOMBRE_MAX = 150;

function conSufijo(nombre: string, sufijo: string): string {
  const base = nombre.length + sufijo.length <= NOMBRE_MAX ? nombre : nombre.slice(0, NOMBRE_MAX - sufijo.length);
  return base.concat(sufijo);
}

/**
 * Normaliza el cuerpo de snake_case a camelCase ANTES de validarlo.
 *
 * El mismo endpoint acepta `template_id` y `templateId` porque el nombre de la
 * columna y el del campo JSON son dos formas de lo mismo, y obligar a que el
 * cliente acierte una sola es una forma de romperse sola. La respuesta es SIEMPRE
 * camelCase, que es lo que habla el resto de la API del runtime.
 *
 * Las claves que no son de la tabla (por ejemplo `organizationId` en el cuerpo)
 * se descartan igual: los schemas de este archivo son `z.object` y zod tira lo que
 * no conoce. El `organization_id` lo pone el servidor, y por eso se puede mandar
 * en el cuerpo sin efecto.
 */
function cuerpo(req: { body?: unknown }): Record<string, unknown> {
  const crudo = (req.body ?? {}) as Record<string, unknown>;
  const salida: Record<string, unknown> = {};
  for (const [clave, valor] of Object.entries(crudo)) {
    salida[clave] = valor;
    const camel = clave.replace(/_([a-z])/g, (_, letra: string) => letra.toUpperCase());
    if (camel !== clave) salida[camel] ??= valor;
  }
  return salida;
}

/**
 * El resumen de una corrida: los mismos numeros, aca y en el tablero.
 *
 * `cumplimientoPct` divide por `ok + fail`, o sea por los puntos que de verdad se
 * evaluaron. Un `na` no cuenta (el punto no aplicaba) y un pendiente opcional
 * tampoco (nadie dijo que fuera necesario). Si se dividiera por el total, "no
 * aplicaba" contaria como fallado y una inspeccion hecha en un sitio vacio
 * saldria con 0% sin que nadie haya fallado nada.
 *
 * Es `null` y no 0 cuando no hay nada evaluado: una corrida recien empezada no
 * tiene cumplimiento, y mostrarle 0% la haria ver como fallada.
 */
function resumir(items: Array<{ result: string | null; required: number }>) {
  let ok = 0;
  let fail = 0;
  let na = 0;
  let pendientes = 0;
  let pendientesRequeridos = 0;
  for (const item of items) {
    if (item.result === 'ok') ok += 1;
    else if (item.result === 'fail') fail += 1;
    else if (item.result === 'na') na += 1;
    else {
      pendientes += 1;
      if (item.required) pendientesRequeridos += 1;
    }
  }
  const evaluados = ok + fail;
  return {
    total: items.length,
    ok,
    fail,
    na,
    pendientes,
    pendientesRequeridos,
    cumplimientoPct: evaluados > 0 ? Math.round((ok / evaluados) * 1000) / 10 : null,
  };
}

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
  };
}

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /** Una plantilla tiene que ser de ESTA organizacion, no solo existir. */
  function plantillaVisible(org: string, plantillaId: string) {
    const fila = db
      .select()
      .from(templates)
      .where(and(eq(templates.id, plantillaId), eq(templates.organizationId, org)))
      .get();
    // El mensaje dice "no existe" a proposito: un "es de otra empresa" confirmaria
    // que ese id existe, que es justo la informacion que se le quiere negar.
    if (!fila) throw new AppError(404, 'Esa plantilla no existe');
    return fila;
  }

  function corridaVisible(org: string, corridaId: string) {
    const fila = db
      .select()
      .from(runs)
      .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
      .get();
    if (!fila) throw new AppError(404, 'Esa corrida no existe');
    return fila;
  }

  /** Los puntos de una plantilla, en el orden en que se llenan. */
  function itemsDePlantilla(org: string, plantillaId: string) {
    return db
      .select()
      .from(templateItems)
      .where(and(eq(templateItems.organizationId, org), eq(templateItems.templateId, plantillaId)))
      .orderBy(asc(templateItems.position))
      .all();
  }

  /** Los puntos de una corrida, en el orden en que se llenan. */
  function itemsDeCorrida(org: string, corridaId: string) {
    return db
      .select()
      .from(runItems)
      .where(and(eq(runItems.organizationId, org), eq(runItems.runId, corridaId)))
      .orderBy(asc(runItems.position))
      .all();
  }

  /**
   * Los puntos que OBLIGAN a responder antes de cerrar.
   *
   * Recibe la conexion de la transaccion a proposito, y no la de la peticion: si
   * esta cuenta se hiciera por fuera, dos personas cerrando la misma corrida al
   * mismo tiempo podrian leer "0 pendientes" las dos y la segunda cerraria con
   * los obligatorios recien borrados. Contar y cerrar tienen que mirar lo mismo.
   */
  function pendientesObligatorios(tx: Tx, org: string, corridaId: string) {
    return tx
      .select({ position: runItems.position, label: runItems.label })
      .from(runItems)
      .where(
        and(
          eq(runItems.organizationId, org),
          eq(runItems.runId, corridaId),
          isNull(runItems.result),
          eq(runItems.required, 1),
        ),
      )
      .orderBy(asc(runItems.position))
      .all();
  }

  /**
   * Renumera los puntos de una plantilla a 1..N, en DOS fases.
   *
   * La primera fase los deja en posiciones NEGATIVAS y la segunda les pone el
   * numero final. Sin la primera, mover el 3 al 2 revienta el indice UNIQUE
   * `(template_id, position)` porque el 2 sigue ocupado: SQLite evalua las filas de
   * un UPDATE de a una y aborta en la primera que choca. Con la primera fase, los
   * numeros negativos no chocan con nadie porque todavia no hay ninguno.
   *
   * Va dentro de la transaccion que la llamo, asi que un fallo deja la lista como
   * estaba y no con los numeros a la mitad.
   */
  function renumerarItems(tx: Tx, org: string, plantillaId: string) {
    const vigentes = tx
      .select()
      .from(templateItems)
      .where(and(eq(templateItems.organizationId, org), eq(templateItems.templateId, plantillaId)))
      .orderBy(asc(templateItems.position))
      .all();

    vigentes.forEach((item, i) => {
      tx.update(templateItems).set({ position: -(i + 1) }).where(eq(templateItems.id, item.id)).run();
    });
    return vigentes.map((item, i) =>
      tx.update(templateItems)
        .set({ position: i + 1 })
        .where(eq(templateItems.id, item.id))
        .returning()
        .get(),
    );
  }

  // ─────────────────────────────────────────────────────────────────── tablero

  /**
   * Los numeros de las inspecciones: cuantas hay de cada estado, cuanto se cumple
   * en promedio entre las cerradas y que fallo en las ultimas.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razon que el tablero de
   * los demas productos: si no, "dashboard" se lee como un id.
   *
   * Los tres estados se arman aunque alguno tenga cero, para que la pantalla no
   * encoja y crezca segun los datos del mes.
   */
  router.get(
    '/api/dashboard',
    asyncHandler(async (req, res) => {
      const org = orgId(req);

      const grupos = db
        .select({ status: runs.status, cantidad: count() })
        .from(runs)
        .where(eq(runs.organizationId, org))
        .groupBy(runs.status)
        .all();
      const de = (estado: Estado) => grupos.find((g) => g.status === estado);

      /**
       * El cumplimiento promedio es POR CORRIDA, no sobre todos los items juntos.
       *
       * Promediar los items de todas las corridas pesa cada corrida por su
       * tamano: la empresa que revisa con listas de 40 puntos moveria la cifra mas
       * que la que revisa con listas de 4, y el numero mostrado seria el promedio
       * de una lista imaginaria que nadie hizo. Se calcula el porcentaje de cada
       * corrida cerrada y se promedian esos.
       *
       * El tope de 500 corridas cerradas es a proposito: el promedio es una
       * tendencia reciente, no un historico, y promediar 40.000 filas en cada
       * carga del tablero es un trabajo que no compra nada.
       */
      const cerradas = db
        .select({ id: runs.id })
        .from(runs)
        .where(and(eq(runs.organizationId, org), eq(runs.status, 'done')))
        .orderBy(desc(runs.completedAt))
        .limit(500)
        .all();

      const idsCerradas = cerradas.map((c) => c.id);
      const porCorrida = idsCerradas.length
        ? db
            .select({
              runId: runItems.runId,
              ok: sql<number>`sum(case when ${runItems.result} = 'ok' then 1 else 0 end)`,
              fail: sql<number>`sum(case when ${runItems.result} = 'fail' then 1 else 0 end)`,
            })
            .from(runItems)
            .where(and(eq(runItems.organizationId, org), inArray(runItems.runId, idsCerradas)))
            .groupBy(runItems.runId)
            .all()
        : [];
      // Las corridas sin nada evaluado (todo `na`, o cerradas sin responder ningun
      // opcional) no entran al promedio: no tienen cumplimiento, y contarlas como
      // 0% hundiria la empresa sin que nadie haya fallado nada.
      const porcentajes = porCorrida
        .map((fila) => ({ evaluados: fila.ok + fila.fail, ok: fila.ok }))
        .filter((f) => f.evaluados > 0)
        .map((f) => (f.ok / f.evaluados) * 100);
      const cumplimientoPromedioPct =
        porcentajes.length === 0 ? null : Math.round((porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length) * 10) / 10;

      /** Los puntos fallados de las 10 corridas mas recientes. */
      const recientes = db
        .select({ id: runs.id, templateName: runs.templateName, location: runs.location, startedAt: runs.startedAt })
        .from(runs)
        .where(eq(runs.organizationId, org))
        .orderBy(desc(runs.startedAt), desc(runs.createdAt))
        .limit(10)
        .all();
      const deCorrida = new Map(recientes.map((r) => [r.id, r]));
      const fallos = recientes.length
        ? db
            .select()
            .from(runItems)
            .where(
              and(
                eq(runItems.organizationId, org),
                eq(runItems.result, 'fail'),
                inArray(runItems.runId, recientes.map((r) => r.id)),
              ),
            )
            .orderBy(asc(runItems.position))
            .all()
            .map((item) => ({
              runId: item.runId,
              templateName: deCorrida.get(item.runId)?.templateName ?? CORRIDA_LIBRE,
              location: deCorrida.get(item.runId)?.location ?? null,
              startedAt: deCorrida.get(item.runId)?.startedAt ?? null,
              position: item.position,
              label: item.label,
              note: item.note,
              answeredAt: item.answeredAt,
            }))
        : [];

      res.json({
        total: grupos.reduce((acc, g) => acc + g.cantidad, 0),
        porStatus: Object.fromEntries(ESTADOS.map((e) => [e, de(e)?.cantidad ?? 0])),
        cumplimientoPromedioPct,
        corridasCompletadasConsideradas: cumplimientoPromedioPct === null ? 0 : cerradas.length,
        fallos,
      });
    }),
  );

  // ───────────────────────────────────────────────────────────────── plantillas

  const plantillaSchema = z.object({
    name: texto,
    description: z.string().trim().max(1000).nullable().optional(),
    active: flag.default(1),
    items: z.array(itemSchema).default([]),
  });

  /**
   * El listado de plantillas, con el filtro de activas.
   *
   * Esta lista esta escrita a mano y no con el `crudRouter` porque el CRUD solo
   * sabe filtrar por `?q=`, y "solo las activas" es la pregunta que hace el
   * formulario de "empezar una corrida" en la mayoria de las veces. La forma de la
   * respuesta es la misma que la del CRUD, y el filtro por organizacion es el
   * mismo `eq(...)`.
   *
   * Un `active` que no sea 0 ni 1 se rechaza en vez de ignorarse: un `?active=si`
   * que se tomara por "todas" muestra plantillas inactivas sin avisar, y el que
   * lo escribio no se entera hasta que elige una que no debia.
   */
  router.get(
    '/api/templates',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const where: SQL[] = [eq(templates.organizationId, org)];

      const crudo = typeof req.query.active === 'string' ? req.query.active.trim() : '';
      if (crudo !== '') {
        if (crudo !== '0' && crudo !== '1') {
          throw new AppError(400, 'El filtro active vale 1 (activas) u 0 (inactivas)');
        }
        where.push(eq(templates.active, crudo === '1' ? 1 : 0));
      }

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q) {
        const patron = `%${q}%`;
        where.push(or(like(templates.name, patron), like(templates.description, patron))!);
      }

      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const offset = Number(req.query.offset) || 0;
      const items = db
        .select()
        .from(templates)
        .where(and(...where))
        .orderBy(asc(templates.name))
        .limit(limit)
        .offset(offset)
        .all();
      const [{ total }] = db.select({ total: count() }).from(templates).where(and(...where)).all();
      res.json({ items, total, limit, offset });
    }),
  );

  /**
   * Crear una plantilla, con sus puntos, en UNA transaccion.
   *
   * Los puntos son opcionales porque una plantilla recien pensada se puede crear
   * vacia y llenarla despues, pero si vienen se escriben con la plantilla. Media
   * transaccion que quedara con los puntos a medias es peor que no guardar nada:
   * alguien tendria que saber cuales de los que escribio se perdieron.
   *
   * Los `position` los pone el SERVIDOR, 1..N, en el orden en que llegaron. Si los
   * aceptara del cliente, dos personas que abrieran el mismo formulario a la vez
   * podrian mandar el mismo numero y la segunda se llevaria un error de SQLite en
   * vez de una lista ordenada.
   */
  router.post(
    '/api/templates',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = plantillaSchema.parse(cuerpo(req));
      const ahora = nowIso();

      const { plantilla, items } = db.transaction((tx) => {
        const creada = tx
          .insert(templates)
          .values({
            id: createId('tpl'),
            organizationId: org,
            name: body.name,
            description: body.description ?? null,
            active: body.active,
            createdAt: ahora,
          })
          .returning()
          .get();

        const puntos = body.items.map((item, i) =>
          tx
            .insert(templateItems)
            .values({
              id: createId('tpit'),
              organizationId: org,
              templateId: creada.id,
              position: i + 1,
              label: item.label,
              required: item.required,
            })
            .returning()
            .get(),
        );
        return { plantilla: creada, items: puntos };
      });

      res.status(201).json({ template: plantilla, items });
    }),
  );

  /**
   * Los puntos de una plantilla, en orden.
   *
   * Es el lado de lectura del par con `POST /items` y `DELETE /items/:itemId`: sin
   * el, la pantalla tendria que traer todas las plantillas y adivinar cuales
   * puntos son de cada una.
   */
  router.get(
    '/api/templates/:id/items',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantilla = plantillaVisible(org, id.parse(req.params.id));
      res.json({ items: itemsDePlantilla(org, plantilla.id) });
    }),
  );

  /**
   * Agregar un punto al final de la plantilla.
   *
   * El numero se calcula DENTRO de la transaccion, como el maximo actual + 1.
   * Calcularlo en JavaScript antes de abrirla deja la puerta abierta: dos personas
   * agregando a la vez partirian del mismo maximo y la segunda chocaria contra el
   * indice UNIQUE. Ademas se toca `updated_at` de la plantilla: cambiar sus puntos
   * es cambiar la plantilla, y "editada" tiene que significar algo.
   */
  router.post(
    '/api/templates/:id/items',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const body = z
        .object({ label: itemSchema.shape.label, required: itemSchema.shape.required.default(1) })
        .parse(cuerpo(req));
      const ahora = nowIso();

      const punto = db.transaction((tx) => {
        const plantilla = tx
          .select({ id: templates.id })
          .from(templates)
          .where(and(eq(templates.id, plantillaId), eq(templates.organizationId, org)))
          .get();
        if (!plantilla) throw new AppError(404, 'Esa plantilla no existe');

        const [{ siguiente }] = tx
          .select({ siguiente: sql<number>`coalesce(max(${templateItems.position}), 0) + 1` })
          .from(templateItems)
          .where(eq(templateItems.templateId, plantillaId))
          .all();

        const creado = tx
          .insert(templateItems)
          .values({
            id: createId('tpit'),
            organizationId: org,
            templateId: plantillaId,
            position: siguiente,
            label: body.label,
            required: body.required,
          })
          .returning()
          .get();

        tx.update(templates).set({ updatedAt: ahora }).where(eq(templates.id, plantillaId)).run();
        return creado;
      });

      res.status(201).json(punto);
    }),
  );

  /**
   * Borrar un punto y RENUMERAR lo que quedo, del 1 al ultimo sin huecos.
   *
   * Es una sola operacion y va en una sola transaccion por dos razones: sin
   * renumerar queda un "1, 3, 4" que hay que leer saltandolo, y con el renumerado a
   * medias y un fallo en el medio queda una lista con numeros negativos.
   *
   * El punto se busca por `template_id` Y por `organization_id`, no solo por su
   * id: sin el filtro, un punto de otra empresa se podria borrar desde una
   * plantilla ajena, porque los ids los genera el servidor y no son secretos.
   */
  router.delete(
    '/api/templates/:id/items/:itemId',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const itemId = id.parse(req.params.itemId);
      const ahora = nowIso();

      const items = db.transaction((tx) => {
        const plantilla = tx
          .select({ id: templates.id })
          .from(templates)
          .where(and(eq(templates.id, plantillaId), eq(templates.organizationId, org)))
          .get();
        if (!plantilla) throw new AppError(404, 'Esa plantilla no existe');

        const borrado = tx
          .delete(templateItems)
          .where(
            and(
              eq(templateItems.id, itemId),
              eq(templateItems.organizationId, org),
              eq(templateItems.templateId, plantillaId),
            ),
          )
          .returning()
          .get();
        if (!borrado) throw new AppError(404, 'Ese punto no existe en esta plantilla');

        const renumerados = renumerarItems(tx, org, plantillaId);
        tx.update(templates).set({ updatedAt: ahora }).where(eq(templates.id, plantillaId)).run();
        return renumerados;
      });

      res.json({ deleted: true, items });
    }),
  );

  /**
   * Duplicar una plantilla con sus puntos.
   *
   * Existe por una razon concreta: el uso real es "copio la checklist de apertura
   * de faena y le agrego los puntos de este cliente", no "recrear los doce puntos
   * a mano". Y al duplicar SOLO se copian la plantilla y sus puntos: NO se copian
   * las corridas, porque una corrida es un hecho que ocurrio en un lugar, y clonar
   * hechos es la forma mas rapida de que la informacion se duplique sin que nadie
   * la haya duplicado.
   */
  router.post(
    '/api/templates/:id/duplicar',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const originalId = id.parse(req.params.id);
      const original = plantillaVisible(org, originalId);
      const ahora = nowIso();

      const { plantilla, items } = db.transaction((tx) => {
        const creada = tx
          .insert(templates)
          .values({
            id: createId('tpl'),
            organizationId: org,
            name: conSufijo(original.name, SUFIJO_COPIA),
            description: original.description,
            // La copia nace ACTIVA: el motivo de duplicar es empezar a usarla ya.
            active: 1,
            createdAt: ahora,
          })
          .returning()
          .get();

        const fuente = tx
          .select()
          .from(templateItems)
          .where(and(eq(templateItems.organizationId, org), eq(templateItems.templateId, originalId)))
          .orderBy(asc(templateItems.position))
          .all();
        const puntos = fuente.map((item) =>
          tx
            .insert(templateItems)
            .values({
              id: createId('tpit'),
              organizationId: org,
              templateId: creada.id,
              position: item.position,
              label: item.label,
              required: item.required,
            })
            .returning()
            .get(),
        );
        return { plantilla: creada, items: puntos };
      });

      res.status(201).json({ template: plantilla, items });
    }),
  );

  // ─────────────────────────────────────────────────────────────────── corridas

  const corridaSchema = z.object({
    templateId: z.string().trim().min(1).max(64).optional(),
    items: z.array(itemSchema).optional(),
    location: z.string().trim().max(150).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    startedAt: instante.optional(),
  });

  /**
   * El listado de corridas, con su estado, su plantilla y su busqueda.
   *
   * A mano, y no con el `crudRouter`, por lo mismo que el listado de plantillas:
   * el CRUD solo filtra por `?q=`, y estas son las tres preguntas que la pantalla
   * hace de verdad ("las que estan abiertas", "las de esta plantilla", "donde
   * dice bodega").
   *
   * Ordena por `started_at` descendente y no por `created_at`: una corrida
   * importada puede empezar antes de existir, y lo que se mira al principio es
   * cuando se hizo, no cuando se escribio.
   */
  router.get(
    '/api/runs',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const where: SQL[] = [eq(runs.organizationId, org)];

      const estadoCrudo = typeof req.query.status === 'string' ? req.query.status.trim() : '';
      if (estadoCrudo !== '') {
        if (!(ESTADOS as readonly string[]).includes(estadoCrudo)) {
          throw new AppError(400, `El estado "${estadoCrudo}" no existe; usa ${ESTADOS.join(', ')}`);
        }
        where.push(eq(runs.status, estadoCrudo));
      }

      const plantillaCruda = typeof req.query.template_id === 'string' ? req.query.template_id.trim() : '';
      if (plantillaCruda !== '') where.push(eq(runs.templateId, plantillaCruda));

      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (q) {
        const patron = `%${q}%`;
        where.push(or(like(runs.templateName, patron), like(runs.location, patron))!);
      }

      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const offset = Number(req.query.offset) || 0;
      const items = db
        .select()
        .from(runs)
        .where(and(...where))
        .orderBy(desc(runs.startedAt), desc(runs.createdAt))
        .limit(limit)
        .offset(offset)
        .all();
      const [{ total }] = db.select({ total: count() }).from(runs).where(and(...where)).all();
      res.json({ items, total, limit, offset });
    }),
  );

  /**
   * Empezar una corrida, CONSTRUYENDO EL SNAPSHOT.
   *
   * Este es el corazon del producto. Lo que pasa aca, en una transaccion:
   *
   *   1. Se lee la plantilla CON SUS PUNTOS, de esta organizacion.
   *   2. Se copian el nombre y los puntos a `runs.template_name` y
   *      `runs.template_items_json`.
   *   3. Se crean las filas de `run_items` con esos mismos puntos, sin respuesta.
   *
   * Desde ese momento la corrida no vuelve a mirar la plantilla. Editarla, o
   * borrarla, no le cambia ni un caracter: por eso el enlace queda en NULL (ON
   * DELETE SET NULL) y el nombre sigue siendo el de ese dia.
   *
   * Se acepta una corrida LIBRE con `items` y sin `templateId`, para revisar algo
   * que no esta en ninguna plantilla. Se acepta UNA de las dos cosas, no las dos:
   * si se mandan las dos, la plantilla y la lista harian el mismo papel y el
   * snapshot seria el de una o el de la otra segun el orden de las lineas del
   * controlador. Adivinar no es una opcion; se pregunta.
   */
  router.post(
    '/api/runs',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = corridaSchema.parse(cuerpo(req));
      if (body.templateId && body.items) {
        throw new AppError(400, 'Manda templateId (que se copia) o items (corrida libre), no los dos');
      }
      if (!body.templateId && !body.items?.length) {
        throw new AppError(400, 'Una corrida necesita una plantilla (templateId) o al menos un punto (items)');
      }
      const ahora = nowIso();

      const { run, items } = db.transaction((tx) => {
        let nombre: string;
        let puntos: Array<{ label: string; required: number }>;
        let plantillaId: string | null = null;

        if (body.templateId) {
          const plantilla = tx
            .select()
            .from(templates)
            .where(and(eq(templates.id, body.templateId), eq(templates.organizationId, org)))
            .get();
          if (!plantilla) throw new AppError(404, 'Esa plantilla no existe');

          const fuente = tx
            .select()
            .from(templateItems)
            .where(and(eq(templateItems.organizationId, org), eq(templateItems.templateId, plantilla.id)))
            .orderBy(asc(templateItems.position))
            .all();
          if (fuente.length === 0) {
            throw new AppError(400, 'Esa plantilla no tiene puntos: agregale al menos uno antes de inspeccionar');
          }
          plantillaId = plantilla.id;
          nombre = plantilla.name;
          puntos = fuente.map((p) => ({ label: p.label, required: p.required }));
        } else {
          nombre = CORRIDA_LIBRE;
          puntos = (body.items ?? []).map((p) => ({ label: p.label, required: p.required }));
        }

        // El snapshot se arma con las MISMAS posiciones que tendran las filas de
        // `run_items`. Que coincidan es lo que hace que la ficha y el JSON del
        // snapshot cuenten exactamente lo mismo.
        const snapshot = puntos.map((p, i) => ({ position: i + 1, label: p.label, required: p.required }));

        const creada = tx
          .insert(runs)
          .values({
            id: createId('run'),
            organizationId: org,
            templateId: plantillaId,
            templateName: nombre,
            templateItemsJson: JSON.stringify(snapshot),
            location: body.location ?? null,
            status: 'in_progress',
            notes: body.notes ?? null,
            startedAt: body.startedAt ?? ahora,
            createdAt: ahora,
          })
          .returning()
          .get();

        const filas = snapshot.map((p) =>
          tx
            .insert(runItems)
            .values({
              id: createId('rnit'),
              organizationId: org,
              runId: creada.id,
              position: p.position,
              label: p.label,
              required: p.required,
            })
            .returning()
            .get(),
        );
        return { run: creada, items: filas };
      });

      res.status(201).json({ run, items });
    }),
  );

  /**
   * La ficha de una corrida: sus datos, sus puntos con la respuesta y el resumen.
   *
   * Devuelve tambien el snapshot ya PARSEADO, porque la pantalla lo muestra tal
   * cual ("que se estaba revisando") y no tiene que ir a desarmar un JSON con un
   * `try`. La fila cruda sigue viniendo en `run`, sin transformar, para el que
   * prefiera el texto.
   */
  router.get(
    '/api/runs/:id/ficha',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corrida = corridaVisible(org, id.parse(req.params.id));
      const items = itemsDeCorrida(org, corrida.id);

      res.json({
        run: corrida,
        items,
        snapshot: { templateName: corrida.templateName, items: JSON.parse(corrida.templateItemsJson) },
        resumen: resumir(items),
      });
    }),
  );

  /**
   * Responder un punto.
   *
   * Se responde POR POSICION y no por el id del item: quien llena la corrida ve
   * "2. Los cables estan protegidos" y contesta "2", no el id interno. El servidor
   * busca la fila, y si no existe responde 404 en vez de escribir un resultado en el
   * lugar equivocado.
   *
   * `answered_at` lo pone el servidor y nunca el cliente: "el punto se respondio el
   * jueves" no puede ser algo que alguien escriba a mano cuando le parezca.
   *
   * Y solo se responde con la corrida ABIERTA. Completada o cancelada es un hecho
   * cerrado, y el 409 dice que hay que reabrirla a proposito (con un PATCH de
   * estado, que queda escrito) en vez de cambiar una firma en silencio.
   */
  router.post(
    '/api/runs/:id/items/:position',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const position = z.coerce
        .number()
        .int('La posicion es un numero entero')
        .min(1, 'Las posiciones empiezan en 1')
        .parse(req.params.position);
      const body = z
        .object({
          result: z.enum(RESPUESTAS, {
            errorMap: () => ({ message: `La respuesta tiene que ser ${RESPUESTAS.join(', ')}` }),
          }),
          note: z.string().trim().max(2000).nullable().optional(),
        })
        .parse(cuerpo(req));
      const ahora = nowIso();

      const { run, item } = db.transaction((tx) => {
        const corrida = tx
          .select()
          .from(runs)
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .get();
        if (!corrida) throw new AppError(404, 'Esa corrida no existe');
        if (corrida.status !== 'in_progress') {
          throw new AppError(
            409,
            `Esta corrida ya esta ${corrida.status === 'done' ? 'completada' : 'cancelada'}: reabrila con ` +
              'PATCH {"status": "in_progress"} antes de cambiar una respuesta',
          );
        }

        const punto = tx
          .update(runItems)
          .set({ result: body.result, note: body.note ?? null, answeredAt: ahora })
          .where(
            and(eq(runItems.organizationId, org), eq(runItems.runId, corridaId), eq(runItems.position, position)),
          )
          .returning()
          .get();
        if (!punto) throw new AppError(404, 'Ese punto no existe en esta corrida');

        const actualizada = tx
          .update(runs)
          .set({ updatedAt: ahora })
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .returning()
          .get();
        return { run: actualizada, item: punto };
      });

      res.json({ run, item });
    }),
  );

  /**
   * Cerrar la corrida.
   *
   * El 400 va DENTRO de la transaccion que cierra, y es la invariante que hace
   * que este producto valga: una inspeccion firmada sin responder los puntos
   * obligatorios no es una inspeccion, es un formulario firmado en blanco. El
   * mensaje dice cuantos y cuales, no solo "faltan cosas", porque la persona que
   * esta frente a la pantalla tiene que saber a que puntos volver.
   *
   * Cerrada la corrida, `completed_at` queda sellado con AHORA. Cancelarla no lo
   * sella: cancelada no es completada, y esa diferencia es la primera que se mira
   * en una auditoria.
   */
  router.post(
    '/api/runs/:id/completar',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const ahora = nowIso();

      const corrida = db.transaction((tx) => {
        const fila = tx
          .select()
          .from(runs)
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .get();
        if (!fila) throw new AppError(404, 'Esa corrida no existe');
        if (fila.status === 'done') throw new AppError(409, 'Esta corrida ya estaba completada');
        if (fila.status === 'canceled') {
          throw new AppError(409, 'Esta corrida esta cancelada: reabrila con PATCH {"status": "in_progress"}');
        }

        const faltantes = pendientesObligatorios(tx, org, corridaId);
        if (faltantes.length > 0) {
          throw new AppError(
            400,
            `Faltan ${faltantes.length} punto(s) obligatorio(s) por responder: ` +
              faltantes.map((f) => `${f.position} (${f.label})`).join(', '),
          );
        }

        return tx
          .update(runs)
          .set({ status: 'done', completedAt: ahora, updatedAt: ahora })
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .returning()
          .get();
      });

      res.json({ run: corrida, resumen: resumir(itemsDeCorrida(org, corridaId)) });
    }),
  );

  /**
   * Editar una corrida: donde se hizo, que se anoto y en que estado esta.
   *
   * Esta ruta esta a mano, y no como un campo mas del `crudRouter`, por la
   * invariante del cierre: si el estado fuera escribible sin reglas, un PATCH con
   * `status: "done"` firmaria una inspeccion sin responder los obligatorios por la
   * puerta de atras. Aca pasar a `done` exige exactamente lo que exige
   * `POST /completar`.
   *
   * Volver a `in_progress` DESELLA `completed_at`, y es la unica forma de cambiar
   * una respuesta de una corrida cerrada. Que quede escrito, con su nuevo
   * `updated_at`, es lo que convierte el reabrir en un acto y no en un olvido.
   */
  router.patch(
    '/api/runs/:id',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const body = z
        .object({
          location: z.string().trim().max(150).nullable().optional(),
          notes: z.string().trim().max(2000).nullable().optional(),
          status: z.enum(ESTADOS).optional(),
        })
        .parse(cuerpo(req));
      const ahora = nowIso();

      const corrida = db.transaction((tx) => {
        const fila = tx
          .select()
          .from(runs)
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .get();
        if (!fila) throw new AppError(404, 'Esa corrida no existe');

        const cambios: Partial<typeof runs.$inferInsert> = { updatedAt: ahora };
        if (body.location !== undefined) cambios.location = body.location;
        if (body.notes !== undefined) cambios.notes = body.notes;

        if (body.status !== undefined && body.status !== fila.status) {
          if (body.status === 'done') {
            const faltantes = pendientesObligatorios(tx, org, corridaId);
            if (faltantes.length > 0) {
              throw new AppError(
                400,
                `No se puede completar: faltan ${faltantes.length} punto(s) obligatorio(s) por responder: ` +
                  faltantes.map((f) => `${f.position} (${f.label})`).join(', '),
              );
            }
            cambios.status = 'done';
            cambios.completedAt = ahora;
          } else {
            // Cancelar y reabrir: en los dos casos la corrida deja de estar
            // cerrada. Cancelar NO sella `completed_at`, porque cancelada no es
            // completada y esa es la diferencia que se lee despues.
            cambios.status = body.status;
            cambios.completedAt = null;
          }
        }

        return tx
          .update(runs)
          .set(cambios)
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .returning()
          .get();
      });

      res.json(corrida);
    }),
  );

  // ───────────────────────────────────────────────────────────────── preferencias

  router.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      res.json({ settings: { organizationId: org, ...leerPreferencias(db, org) } });
    }),
  );

  /**
   * La zona horaria y la moneda son de la EMPRESA, no de la persona.
   *
   * Por eso el PUT pide `admin`: si un miembro las cambiara, la hora a la que se ve
   * cada corrida se moveria para toda la gente a la vez. Leer es libre; cambiar la
   * configuracion compartida no.
   *
   * La zona se valida contra `Intl` y no contra una lista escrita a mano: cualquier
   * zona de la base de IANA sirve, y una lista propia envejece. Una zona que el
   * runtime no conoce se rechaza con un mensaje util.
   */
  router.put(
    '/api/settings',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const ajustes = z
        .object({
          currency: z.string().trim().min(1).max(5).default('$'),
          timezone: z.string().trim().min(1).max(64).default('America/Santiago'),
        })
        .parse(cuerpo(req));

      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: ajustes.timezone }).format(new Date());
      } catch {
        throw new AppError(400, `Zona horaria desconocida: ${ajustes.timezone}`);
      }

      const existente = db.select().from(settings).where(eq(settings.organizationId, org)).get();
      if (existente) {
        db.update(settings)
          .set({ ...ajustes, updatedAt: nowIso() })
          .where(eq(settings.id, existente.id))
          .run();
      } else {
        db.insert(settings)
          .values({ id: `cfg_${org}`, organizationId: org, ...ajustes, createdAt: nowIso() })
          .run();
      }
      res.json({ settings: { organizationId: org, ...leerPreferencias(db, org) } });
    }),
  );

  // ─────────────────────────────────────────────────────────────────────── CRUD

  /**
   * El resto del CRUD de las dos listas.
   *
   * De las plantillas, `crudRouter` sirve el detalle (`GET /:id`), la edicion
   * (`PATCH /:id`, que es donde vive el toggle de `active`) y el borrado
   * (`DELETE /:id`, de admin: quitar una plantilla de la empresa es decision de un
   * responsable, no de cualquiera que este llenando una). El listado y el alta
   * estan mas arriba porque necesitan el filtro de activas y los puntos en la misma
   * llamada.
   *
   * De las corridas, sirve el detalle y el borrado, tambien de admin y por el
   * mismo motivo: borrar una corrida es borrar una inspeccion. El alta, la edicion,
   * el listado y todos los metodos de los puntos estan mas arriba, por las razones
   * del comentario de esta seccion.
   *
   * Borrar una plantilla NO borra sus corridas: el `ON DELETE SET NULL` del DDL
   * deja cada corrida con su `template_name` y su `template_items_json` intactos.
   */
  router.use(
    '/api/templates',
    crudRouter(ctx.handle, {
      table: templates,
      idPrefix: 'tpl',
      label: 'plantilla',
      orderBy: templates.name,
      orderDirection: 'asc',
      writeRole: 'member',
      deleteRole: 'admin',
      fields: {
        name: { schema: texto },
        description: { schema: z.string().trim().max(1000).nullable().optional() },
        active: { schema: flag },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  router.use(
    '/api/runs',
    crudRouter(ctx.handle, {
      table: runs,
      idPrefix: 'run',
      label: 'corrida',
      orderBy: runs.startedAt,
      orderDirection: 'desc',
      search: [runs.templateName, runs.location],
      writeRole: 'member',
      deleteRole: 'admin',
      fields: {
        // El estado NO es un campo escribible del CRUD, y esa es la razon de que
        // `PATCH /api/runs/:id` este escrito a mano: un estado libre permitiria
        // firmar una inspeccion saltandose la regla de los obligatorios.
        templateId: { readonly: true },
        templateName: { readonly: true },
        templateItemsJson: { readonly: true },
        location: { schema: z.string().trim().max(150).nullable().optional() },
        status: { readonly: true },
        notes: { schema: z.string().trim().max(2000).nullable().optional() },
        startedAt: { readonly: true },
        completedAt: { readonly: true },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}
