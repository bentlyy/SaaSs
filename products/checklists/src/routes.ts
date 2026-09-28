import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { Router } from 'express';
import { and, asc, count, desc, eq, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  AppError,
  asyncHandler,
  createId,
  crudRouter,
  identity,
  nowIso,
  orgId,
  requireRole,
  type ProductConfig,
  type ProductContext,
  type ProductDb,
} from '@amg/product-runtime';
import { attachments, runItems, runs, sections, settings, templateItems, templates } from './schema.js';

/**
 * API de checklists e inspecciones.
 *
 * Siete invariantes, y todas estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Una empresa no puede pedir los datos de otra aunque adivine el id.
 *
 *   2. La EJECUCION guarda un SNAPSHOT de la plantilla: el nombre, las secciones
 *      y los puntos se copian al crearla. Editar la plantilla despues no puede
 *      cambiar lo ya ejecutado, y borrarla tampoco. Es el motivo del dominio, y
 *      esta en `POST /api/runs` y en los `ON DELETE SET NULL` del DDL.
 *
 *   3. Una corrida NO se puede completar si quedan puntos obligatorios sin
 *      responder. El chequeo va DENTRO de la transaccion que la cierra, y el 400
 *      dice cuales faltan. "Sin responder" se define por tipo: un `yes_no` que no
 *      tiene `result`, y un `text`/`number`/`select` sin `value_text`.
 *
 *   4. El veredicto global (`approved`/`observed`/`rejected`) es un JUICIO del
 *      inspector y NO se adivina solo de los items: se manda al completar o por
 *      PATCH, a proposito. Si no se manda al completar, se deriva de lo minimo
 *      que todo checklist comparte: si hay algun punto "no cumple", la
 *      inspeccion quedo con observaciones; si no, aprobo.
 *
 *   5. Un punto se responde SEGUN SU TIPO. `yes_no` responde con `result`
 *      (`ok`/`fail`/`na`); `text`, `number` y `select` responden con `value_text`
 *      (y el `select` se valida contra las opciones de la plantilla, guardadas
 *      en el snapshot de la corrida, no contra las del dia de hoy).
 *
 *   6. `position` no tiene huecos: cuando se borra un item, los que quedan de su
 *      seccion se renumeran a 1..N, y lo mismo las secciones de su plantilla. La
 *      renumeracion va en DOS fases, porque el indice UNIQUE rechaza el simple
 *      "baja el 3 al 2" cuando el 2 todavia existe.
 *
 *   7. Los adjuntos viven en disco, fuera de la base. `attachments.path` es
 *      relativo a la carpeta de datos y al servir nunca se confia en el como
 *      ruta absoluta: la ruta se re-construye desde el id del adjunto.
 *
 * ── POR QUE HAY RUTAS A MANO Y HAY `crudRouter` ──────────────────────────────
 *
 * `crudRouter` cubre el CRUD que es CRUD. Lo que NO cubre son las cosas de este
 * producto, y por eso estan escritas a mano. Todas van ANTES del `crudRouter`
 * que comparten la URL, porque Express resuelve en orden de registro y gana la
 * primera coincidencia.
 *
 * ESTE producto NO tiene fuente legacy: no hay datos de inspecciones en ningun
 * producto viejo. Por eso no hay `migrate-legacy.ts` ni `legacy_tenant_map` que
 * mapear. Un migrador sin datos de los que leer es fiction. SI hay una migracion
 * de ESQUEMA (ver `migrations.ts`): la base de datos de este producto ya existe
 * y tiene datos de antes de las secciones y de los adjuntos.
 */

const texto = z.string().trim().min(1).max(150);
const textoLargo = z.string().trim().max(4000);
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

/**
 * Los cuatro tipos de respuesta de un punto.
 *
 * Son cerrados a proposito: `yes_no` se responde cumple/no cumple/no aplica,
 * `text` con un texto libre, `number` con un numero y `select` eligiendo una de
 * las opciones de `options`. Un nombre libre permitiria escribir "cualitativo" y
 * la API dejaria de saber que control pintar ni como validar la respuesta.
 */
const TIPOS = ['yes_no', 'text', 'number', 'select'] as const;
type Tipo = (typeof TIPOS)[number];

/**
 * Los tres veredictos GLOBALES de una inspeccion.
 *
 * A diferencia del estado (`done`), que dice QUE se cerro, el resultado dice COMO
 * quedo: `approved` aprobo, `observed` salio con observaciones y `rejected` se
 * rechazo. Son cerrados porque son los tres valores que el catalogo define y es
 * lo que se puede filtrar y contar; un texto libre romperia el tablero.
 */
const RESULTADOS_GLOBAL = ['approved', 'observed', 'rejected'] as const;
type ResultadoGlobal = (typeof RESULTADOS_GLOBAL)[number];

export const ETIQUETAS_RESULTADO_GLOBAL: Record<ResultadoGlobal, string> = {
  approved: 'Aprobado',
  observed: 'Observado',
  rejected: 'Rechazado',
};

/**
 * Un punto de checklist: lo que se revisa. El `position` lo pone el servidor.
 *
 * `type` dice como se responde y `options` las opciones de `select`. `yes_no` es
 * el default porque es el unico que convive con la maquina de `ok/fail/na` y con
 * todo el historial que se escribio con ella.
 */
const itemSchema = z.object({
  label: z.string().trim().min(1, 'Un punto necesita un texto').max(200),
  required: flag.default(1),
  type: z.enum(TIPOS).default('yes_no'),
  options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
});

/** Una seccion: el grupo con nombre que ordena los puntos de una plantilla. */
const sectionSchema = z.object({
  name: z.string().trim().min(1, 'Una seccion necesita un nombre').max(150),
  items: z.array(itemSchema).default([]),
});

/**
 * Valida los extras de un item segun su tipo.
 *
 * Un `select` sin opciones no se puede responder: no es una advertencia
 * estetica, es que la lista de la que elegir es la propia respuesta. En los
 * otros tipos las opciones no significan nada y se descartan en el servidor.
 */
function validarItem(item: z.infer<typeof itemSchema>) {
  if (item.type === 'select' && (!item.options || item.options.length === 0)) {
    throw new AppError(400, 'Un punto de seleccion necesita al menos una opcion');
  }
}

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
 * Las tres respuestas a un punto de tipo `yes_no`, y solo tres.
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
 * La seccion que se crea cuando una plantilla se arma con puntos sueltos (sin
 * bloques).
 */
const SECCION_UNICA = 'General';

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

/** Un `options_json` de la base a la lista que entiende la API. */
function optionsDe(fila: { optionsJson: string | null }): string[] | null {
  return fila.optionsJson ? (JSON.parse(fila.optionsJson) as string[]) : null;
}

/** El snapshot de un punto de la corrida, tal como viaja en el JSON. */
interface PuntoSnapshot {
  position: number;
  label: string;
  required: number;
  type: Tipo;
  options: string[] | null;
  section: string | null;
}

/** `true` si el punto ya tiene respuesta segun su tipo. */
function respondido(item: { type: string; result: string | null; valueText: string | null }): boolean {
  if (item.type === 'yes_no') return item.result !== null;
  return item.valueText !== null && item.valueText.trim() !== '';
}

/**
 * El resumen de una corrida: los mismos numeros, aca y en el tablero.
 *
 * `cumplimientoPct` divide por `ok + fail`, o sea por los puntos `yes_no` que de
 * verdad se evaluaron. Un `na` no cuenta (el punto no aplicaba). Si se dividiera
 * por el total, "no aplicaba" contaria como fallado y una inspeccion hecha en un
 * sitio vacio saldria con 0% sin que nadie haya fallado nada. Un punto de texto,
 * numero o seleccion no es ni `ok` ni `fail`: se cuenta en `respondidos` y no
 * entra al cumplimiento.
 *
 * Es `null` y no 0 cuando no hay nada evaluado `yes_no`: una corrida recien
 * empezada no tiene cumplimiento, y mostrarle 0% la haria ver como fallada.
 */
function resumir(items: Array<{ result: string | null; required: number; type: string; valueText: string | null }>) {
  let ok = 0;
  let fail = 0;
  let na = 0;
  let respondidos = 0;
  let pendientes = 0;
  let pendientesRequeridos = 0;
  for (const item of items) {
    if (item.result === 'ok') ok += 1;
    else if (item.result === 'fail') fail += 1;
    else if (item.result === 'na') na += 1;
    if (respondido(item)) respondidos += 1;
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
    respondidos,
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
      ? join(tmpdir(), `amg-checklists-adjuntos-${randomUUID().slice(0, 8)}`)
      : join(dirname(resolve(config.dbPath)), 'attachments');
  directorioAdjuntosCache.set(config.dbPath, dir);
  return dir;
}

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;
  const carpetaAdjuntos = directorioAdjuntos(ctx.config);

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

  /** Las secciones de una plantilla, en el orden en que se llenan. */
  function seccionesDePlantilla(sql: ProductDb['db'], org: string, plantillaId: string) {
    return sql
      .select()
      .from(sections)
      .where(and(eq(sections.organizationId, org), eq(sections.templateId, plantillaId)))
      .orderBy(asc(sections.sortOrder))
      .all();
  }

  /**
   * Los items de una plantilla, FLAT y en orden: por el orden de su seccion y
   * dentro de la seccion, por `position`. La posicion que ve cada seccion es por
   * seccion; el orden GLOBAL se arma aca, a partir de las dos columnas.
   */
  function itemsDePlantilla(sql: ProductDb['db'], org: string, plantillaId: string) {
    const secciones = seccionesDePlantilla(sql, org, plantillaId);
    const items = sql
      .select()
      .from(templateItems)
      .where(and(eq(templateItems.organizationId, org), eq(templateItems.templateId, plantillaId)))
      .orderBy(asc(templateItems.position))
      .all();
    const orden = new Map(secciones.map((s, i) => [s.id, i]));
    return items.sort(
      (a, b) => (orden.get(a.sectionId) ?? 0) - (orden.get(b.sectionId) ?? 0) || a.position - b.position,
    );
  }

  /** Los items de UNA seccion, en el orden en que se llenan. */
  function itemsDeSeccion(sql: ProductDb['db'], org: string, seccionId: string) {
    return sql
      .select()
      .from(templateItems)
      .where(and(eq(templateItems.organizationId, org), eq(templateItems.sectionId, seccionId)))
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
   *
   * "Sin responder" depende del tipo: un `yes_no` sin `result`, y un
   * `text`/`number`/`select` sin `value_text` (o vacio).
   */
  function pendientesObligatorios(tx: Tx, org: string, corridaId: string) {
    return tx
      .select({ position: runItems.position, label: runItems.label })
      .from(runItems)
      .where(
        and(
          eq(runItems.organizationId, org),
          eq(runItems.runId, corridaId),
          eq(runItems.required, 1),
          or(
            and(eq(runItems.type, 'yes_no'), isNull(runItems.result)),
            and(
              sql`${runItems.type} != 'yes_no'`,
              or(isNull(runItems.valueText), sql`${runItems.valueText} = ''`),
            ),
          ),
        ),
      )
      .orderBy(asc(runItems.position))
      .all();
  }

  /**
   * Renumera los puntos de una SECCION a 1..N, en DOS fases.
   *
   * La primera fase los deja en posiciones NEGATIVAS y la segunda les pone el
   * numero final. Sin la primera, mover el 3 al 2 revienta el indice UNIQUE
   * `(section_id, position)` porque el 2 sigue ocupado: SQLite evalua las filas de
   * un UPDATE de a una y aborta en la primera que choca. Con la primera fase, los
   * numeros negativos no chocan con nadie porque todavia no hay ninguno.
   *
   * Va dentro de la transaccion que la llamo, asi que un fallo deja la lista como
   * estaba y no con los numeros a la mitad.
   */
  function renumerarItems(tx: Tx, org: string, seccionId: string) {
    const vigentes = itemsDeSeccion(tx, org, seccionId);
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

  /**
   * Renumera las secciones de una plantilla a 1..N, en DOS fases. Igual que los
   * items: sin la fase negativa, bajar una seccion choca contra el UNIQUE
   * `(template_id, sort_order)`.
   */
  function renumerarSecciones(tx: Tx, org: string, plantillaId: string) {
    const vigentes = seccionesDePlantilla(tx, org, plantillaId);
    vigentes.forEach((sec) => {
      tx.update(sections).set({ sortOrder: -(sec.sortOrder) }).where(eq(sections.id, sec.id)).run();
    });
    return vigentes.map((sec, i) =>
      tx.update(sections).set({ sortOrder: i + 1 }).where(eq(sections.id, sec.id)).returning().get(),
    );
  }

  /**
   * El veredicto global de una corrida al cerrar.
   *
   * El inspector puede mandarlo (juicio explicito), y si no viene se deriva lo
   * minimo que todo checklist comparte: si algun punto `yes_no` quedo "no
   * cumple", la inspeccion salio con observaciones; si no, aprobo. `rejected` no
   * se deriva nunca: rechazar es un juicio que hay que escribir.
   */
  function veredictoDe(items: Array<{ result: string | null }>, explicito?: ResultadoGlobal): ResultadoGlobal {
    if (explicito) return explicito;
    return items.some((i) => i.result === 'fail') ? 'observed' : 'approved';
  }

  // ─────────────────────────────────────────────────────────────────── tablero

  /**
   * Los numeros de las inspecciones: cuantas hay de cada estado, de cada
   * veredicto, cuanto se cumple en promedio entre las cerradas y que fallo en las
   * ultimas.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razon que el tablero de
   * los demas productos: si no, "dashboard" se lee como un id.
   *
   * Los estados y veredictos se arman aunque alguno tenga cero, para que la
   * pantalla no encoja y crezca segun los datos del mes.
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
      const porResultado = db
        .select({ resultado: runs.result, cantidad: count() })
        .from(runs)
        .where(eq(runs.organizationId, org))
        .groupBy(runs.result)
        .all();
      const deResultado = (r: string | null) => porResultado.find((g) => g.resultado === r)?.cantidad ?? 0;

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
        porResultado: {
          approved: deResultado('approved'),
          observed: deResultado('observed'),
          rejected: deResultado('rejected'),
          sin: deResultado(null),
        },
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
    /**
     * Los puntos sueltos (epoca sin secciones). Si se mandan y no hay `sections`,
     * el servidor los pone en una seccion "General" de la plantilla, para que una
     * lista siempre tenga donde vivir.
     */
    items: z.array(itemSchema).default([]),
    sections: z.array(sectionSchema).default([]),
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
   * Crear una plantilla, con sus secciones y sus puntos, en UNA transaccion.
   *
   * Las secciones y los puntos son opcionales porque una plantilla recien pensada
   * se puede crear vacia y llenarla despues, pero si vienen se escriben con la
   * plantilla. Media transaccion que quedara con los puntos a medias es peor que
   * no guardar nada: alguien tendria que saber cuales de los que escribio se
   * perdieron.
   *
   * Los `sort_order` y los `position` los pone el SERVIDOR, 1..N, en el orden en
   * que llegaron. Si los aceptara del cliente, dos personas que abrieran el mismo
   * formulario a la vez podrian mandar el mismo numero y la segunda se llevaria un
   * error de SQLite en vez de una lista ordenada.
   */
  router.post(
    '/api/templates',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = plantillaSchema.parse(cuerpo(req));
      if (body.sections.length > 0 && body.items.length > 0) {
        throw new AppError(400, 'Manda secciones (con sus puntos) o puntos sueltos, no los dos');
      }
      if (body.sections.length > 0) {
        body.sections.forEach((sec) => sec.items.forEach(validarItem));
      } else {
        body.items.forEach(validarItem);
      }
      const ahora = nowIso();

      // Las secciones que se crean: las mandadas, o un unico bloque "General" que
      // recibe los puntos sueltos. Que una plantilla SIEMPRE arranque con al menos
      // una seccion es lo que garantiza que despues se le puedan agregar puntos sin
      // preguntar "y donde pongo este punto".
      const bloques = body.sections.length > 0 ? body.sections : [{ name: SECCION_UNICA, items: body.items }];

      const { plantilla, secciones, items } = db.transaction((tx) => {
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

        const seccionesCreadas: Array<{ id: string; name: string; sortOrder: number }> = [];
        const puntos: Array<typeof templateItems.$inferSelect> = [];
        bloques.forEach((seccion, iSec) => {
          const sec = tx
            .insert(sections)
            .values({
              id: createId('sec'),
              organizationId: org,
              templateId: creada.id,
              name: seccion.name,
              sortOrder: iSec + 1,
            })
            .returning()
            .get();
          seccionesCreadas.push(sec);
          seccion.items.forEach((item, iItem) => {
            puntos.push(
              tx
                .insert(templateItems)
                .values({
                  id: createId('tpit'),
                  organizationId: org,
                  templateId: creada.id,
                  sectionId: sec.id,
                  position: iItem + 1,
                  label: item.label,
                  required: item.required,
                  type: item.type,
                  optionsJson: item.type === 'select' ? JSON.stringify(item.options) : null,
                })
                .returning()
                .get(),
            );
          });
        });
        return { plantilla: creada, secciones: seccionesCreadas, items: puntos };
      });

      res.status(201).json({ template: plantilla, sections: secciones, items });
    }),
  );

  /**
   * La estructura de una plantilla: sus secciones, cada una con sus puntos.
   *
   * Es como el editor la pinta y como la guarda: secciones ordenadas (la API ya
   * las deja 1..N) y dentro de cada una los puntos por su `position`. Es el lado
   * de lectura del par con los mismos endpoints que mueven secciones y puntos.
   */
  router.get(
    '/api/templates/:id/estructura',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantilla = plantillaVisible(org, id.parse(req.params.id));
      const secciones = seccionesDePlantilla(db, org, plantilla.id).map((s) => ({
        ...s,
        items: itemsDeSeccion(db, org, s.id).map((p) => ({ ...p, options: optionsDe(p) })),
      }));
      res.json({ template: plantilla, sections: secciones });
    }),
  );

  /**
   * Los puntos de una plantilla, en orden (las secciones en su orden).
   *
   * Es la lista FLAT, visible para compatibilidad con la UI sencilla y con tests
   * que piden "los puntos tal cual". El editor usa `/estructura`, que agrupa.
   */
  router.get(
    '/api/templates/:id/items',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantilla = plantillaVisible(org, id.parse(req.params.id));
      const items = itemsDePlantilla(db, org, plantilla.id).map((p) => ({ ...p, options: optionsDe(p) }));
      res.json({ items });
    }),
  );

  /**
   * Crear una seccion al final de la plantilla.
   *
   * El numero se calcula DENTRO de la transaccion, como el maximo actual + 1.
   * Calcularlo en JavaScript antes de abrirla deja la puerta abierta: dos personas
   * agregando a la vez partirian del mismo maximo y la segunda chocaria contra el
   * indice UNIQUE.
   */
  router.post(
    '/api/templates/:id/sections',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const body = z.object({ name: sectionSchema.shape.name }).parse(cuerpo(req));

      const seccion = db.transaction((tx) => {
        plantillaVisible(org, plantillaId);
        const [{ siguiente }] = tx
          .select({ siguiente: sql<number>`coalesce(max(${sections.sortOrder}), 0) + 1` })
          .from(sections)
          .where(eq(sections.templateId, plantillaId))
          .all();
        return tx
          .insert(sections)
          .values({
            id: createId('sec'),
            organizationId: org,
            templateId: plantillaId,
            name: body.name,
            sortOrder: siguiente,
          })
          .returning()
          .get();
      });

      res.status(201).json(seccion);
    }),
  );

  /**
   * Renombrar una seccion.
   *
   * Solo el nombre se edita de esta forma: el ORDEN se cambia con
   * `/sections/ordenar`, que renumera, y no perdiendo una seccion para volverla a
   * crear.
   */
  router.patch(
    '/api/templates/:id/sections/:sectionId',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const seccionId = id.parse(req.params.sectionId);
      const body = z.object({ name: sectionSchema.shape.name }).parse(cuerpo(req));

      const actualizada = db
        .update(sections)
        .set({ name: body.name })
        .where(
          and(
            eq(sections.id, seccionId),
            eq(sections.organizationId, org),
            eq(sections.templateId, plantillaId),
          ),
        )
        .returning()
        .get();
      if (!actualizada) throw new AppError(404, 'Esa seccion no existe en esta plantilla');
      res.json(actualizada);
    }),
  );

  /**
   * Reordenar las secciones de la plantilla.
   *
   * El cliente manda el orden DADO por los ids (`order: [id1, id2, ...]`) y el
   * servidor renumera a 1..N. Se exige que la lista contenga exactamente las
   * secciones de la plantilla, y la renumeracion va en dos fases por el UNIQUE.
   */
  router.post(
    '/api/templates/:id/sections/ordenar',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const body = z.object({ order: z.array(z.string().trim().min(1).max(64)) }).parse(cuerpo(req));

      const reordenadas = db.transaction((tx) => {
        plantillaVisible(org, plantillaId);
        const vigentes = seccionesDePlantilla(tx, org, plantillaId);
        const conjunto = new Set(body.order);
        if (
          body.order.length !== vigentes.length ||
          !vigentes.every((s) => conjunto.has(s.id)) ||
          conjunto.size !== body.order.length
        ) {
          throw new AppError(400, 'El orden tiene que listar todas las secciones de la plantilla, sin repetir');
        }
        body.order.forEach((seccionId, i) => {
          tx.update(sections)
            .set({ sortOrder: -(i + 1) })
            .where(and(eq(sections.id, seccionId), eq(sections.templateId, plantillaId)))
            .run();
        });
        return body.order.map((seccionId, i) =>
          tx.update(sections).set({ sortOrder: i + 1 }).where(eq(sections.id, seccionId)).returning().get(),
        );
      });

      res.json({ sections: reordenadas });
    }),
  );

  /**
   * Borrar una seccion y SUS PUNTOS, y renumerar lo que queda a 1..N.
   *
   * Los puntos se van con la seccion (CASCADE): una seccion vacia que se borra se
   * puede borrar por que era vacia; una con puntos se borra con ellos porque un
   * punto sin seccion no tiene donde vivir. Las corridas ya hechas no se tocan:
   * llevan su snapshot.
   */
  router.delete(
    '/api/templates/:id/sections/:sectionId',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const seccionId = id.parse(req.params.sectionId);
      const ahora = nowIso();

      const secciones = db.transaction((tx) => {
        plantillaVisible(org, plantillaId);
        const borrada = tx
          .delete(sections)
          .where(
            and(
              eq(sections.id, seccionId),
              eq(sections.organizationId, org),
              eq(sections.templateId, plantillaId),
            ),
          )
          .returning()
          .get();
        if (!borrada) throw new AppError(404, 'Esa seccion no existe en esta plantilla');
        const renumeradas = renumerarSecciones(tx, org, plantillaId);
        tx.update(templates).set({ updatedAt: ahora }).where(eq(templates.id, plantillaId)).run();
        return renumeradas;
      });

      res.json({ deleted: true, sections: secciones });
    }),
  );

  /**
   * Agregar un punto al final de UNA SECCION.
   *
   * Sin `sectionId`, se usa la PRIMERA seccion de la plantilla (la del `sort_order`
   * 1), y si la plantilla todavia no tiene ninguna se crea una "General": asi una
   * plantilla vacia nunca queda sin un punto donde dejar el punto.
   *
   * El numero se calcula DENTRO de la transaccion, como el maximo actual + 1 de la
   * seccion. Calcularlo en JavaScript antes de abrirla deja la puerta abierta: dos
   * personas agregando a la vez partirian del mismo maximo y la segunda chocaria
   * contra el indice UNIQUE. Ademas se toca `updated_at` de la plantilla: cambiar
   * sus puntos es cambiar la plantilla, y "editada" tiene que significar algo.
   */
  router.post(
    '/api/templates/:id/items',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const body = z
        .object({
          label: itemSchema.shape.label,
          required: itemSchema.shape.required.default(1),
          type: itemSchema.shape.type.default('yes_no'),
          options: itemSchema.shape.options,
          sectionId: z.string().trim().min(1).max(64).optional(),
        })
        .parse(cuerpo(req));
      validarItem(body);
      const ahora = nowIso();

      const punto = db.transaction((tx) => {
        plantillaVisible(org, plantillaId);

        let seccionId = body.sectionId;
        if (!seccionId) {
          const primera = tx
            .select({ id: sections.id })
            .from(sections)
            .where(and(eq(sections.organizationId, org), eq(sections.templateId, plantillaId)))
            .orderBy(asc(sections.sortOrder))
            .limit(1)
            .get();
          if (!primera) {
            seccionId = tx
              .insert(sections)
              .values({
                id: createId('sec'),
                organizationId: org,
                templateId: plantillaId,
                name: SECCION_UNICA,
                sortOrder: 1,
              })
              .returning()
              .get()
              .id;
          } else {
            seccionId = primera.id;
          }
        }

        const [{ siguiente }] = tx
          .select({ siguiente: sql<number>`coalesce(max(${templateItems.position}), 0) + 1` })
          .from(templateItems)
          .where(eq(templateItems.sectionId, seccionId))
          .all();

        const creado = tx
          .insert(templateItems)
          .values({
            id: createId('tpit'),
            organizationId: org,
            templateId: plantillaId,
            sectionId: seccionId,
            position: siguiente,
            label: body.label,
            required: body.required,
            type: body.type,
            optionsJson: body.type === 'select' ? JSON.stringify(body.options) : null,
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
   * Editar un punto de la plantilla: texto, obligatoriedad, tipo u opciones.
   *
   * Es como se cambia un punto SIN recrearlo: el que ya existe conserva el id, y
   * las corridas que lo copiaron conservan su propia fotografia. Cambiar el tipo
   * a `select` sin opciones se rechaza; dejar de ser `select` descarta las
   * opciones que no significan nada fuera de el.
   */
  router.patch(
    '/api/templates/:id/items/:itemId',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const plantillaId = id.parse(req.params.id);
      const itemId = id.parse(req.params.itemId);
      const body = z
        .object({
          label: itemSchema.shape.label.optional(),
          required: itemSchema.shape.required.optional(),
          type: itemSchema.shape.type.optional(),
          options: itemSchema.shape.options,
        })
        .parse(cuerpo(req));
      if (body.type === 'select' && (!body.options || body.options.length === 0)) {
        throw new AppError(400, 'Un punto de seleccion necesita al menos una opcion');
      }
      const ahora = nowIso();

      const actualizado = db.transaction((tx) => {
        plantillaVisible(org, plantillaId);
        const existente = tx
          .select()
          .from(templateItems)
          .where(
            and(
              eq(templateItems.id, itemId),
              eq(templateItems.organizationId, org),
              eq(templateItems.templateId, plantillaId),
            ),
          )
          .get();
        if (!existente) throw new AppError(404, 'Ese punto no existe en esta plantilla');

        const tipo = body.type ?? existente.type;
        const cambios: Partial<typeof templateItems.$inferInsert> = {};
        if (body.label !== undefined) cambios.label = body.label;
        if (body.required !== undefined) cambios.required = body.required;
        if (body.type !== undefined) cambios.type = body.type;
        // Las opciones solo significan para `select`. Un `select` sin opciones no
        // se puede responder, y dejar de ser `select` descarta las viejas: una
        // opcion de un punto que ya no elige nada es ruido.
        if (tipo === 'select' && body.options !== undefined && body.options.length === 0) {
          throw new AppError(400, 'Un punto de seleccion necesita al menos una opcion');
        }
        if (body.type !== undefined || body.options !== undefined) {
          cambios.optionsJson = tipo === 'select' ? JSON.stringify(body.options ?? []) : null;
        }

        const fila = tx
          .update(templateItems)
          .set(cambios)
          .where(eq(templateItems.id, itemId))
          .returning()
          .get();
        tx.update(templates).set({ updatedAt: ahora }).where(eq(templates.id, plantillaId)).run();
        return fila;
      });

      res.json({ ...actualizado, options: optionsDe(actualizado) });
    }),
  );

  /**
   * Borrar un punto y RENUMERAR lo que quedo en su seccion, 1..N sin huecos.
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

        const renumerados = renumerarItems(tx, org, borrado.sectionId);
        tx.update(templates).set({ updatedAt: ahora }).where(eq(templates.id, plantillaId)).run();
        return renumerados;
      });

      res.json({ deleted: true, items });
    }),
  );

  /**
   * Duplicar una plantilla con sus secciones y sus puntos.
   *
   * Existe por una razon concreta: el uso real es "copio la checklist de apertura
   * de faena y le agrego los puntos de este cliente", no "recrear los doce puntos
   * a mano". Y al duplicar SOLO se copian la plantilla, sus secciones y sus
   * puntos: NO se copian las corridas, porque una corrida es un hecho que ocurrio
   * en un lugar, y clonar hechos es la forma mas rapida de que la informacion se
   * duplique sin que nadie la haya duplicado.
   */
  router.post(
    '/api/templates/:id/duplicar',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const originalId = id.parse(req.params.id);
      const original = plantillaVisible(org, originalId);
      const ahora = nowIso();

      const { plantilla, secciones, items } = db.transaction((tx) => {
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

        const mapaIds = new Map<string, string>();
        const seccionesCreadas = seccionesDePlantilla(tx, org, originalId).map((sec) => {
          const nueva = tx
            .insert(sections)
            .values({
              id: createId('sec'),
              organizationId: org,
              templateId: creada.id,
              name: sec.name,
              sortOrder: sec.sortOrder,
            })
            .returning()
            .get();
          mapaIds.set(sec.id, nueva.id);
          return nueva;
        });

        const puntos = itemsDePlantilla(tx, org, originalId).map((item) =>
          tx
            .insert(templateItems)
            .values({
              id: createId('tpit'),
              organizationId: org,
              templateId: creada.id,
              sectionId: mapaIds.get(item.sectionId) ?? item.sectionId,
              position: item.position,
              label: item.label,
              required: item.required,
              type: item.type,
              optionsJson: item.optionsJson,
            })
            .returning()
            .get(),
        );
        return { plantilla: creada, secciones: seccionesCreadas, items: puntos };
      });

      res.status(201).json({ template: plantilla, sections: secciones, items });
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
   *   1. Se lee la plantilla CON SUS SECCIONES y sus puntos, de esta
   *      organizacion.
   *   2. Se copian el nombre, las secciones y los puntos a `runs.template_name` y
   *      `runs.template_items_json` (con tipo, opciones y seccion por punto).
   *   3. Se crean las filas de `run_items` con esos mismos puntos, sin respuesta,
   *      con `item_id` apuntando al punto de la plantilla del que salieron.
   *
   * Desde ese momento la corrida no vuelve a mirar la plantilla. Editarla, o
   * borrarla, no le cambia ni un caracter: por eso el enlace queda en NULL (ON
   * DELETE SET NULL) y el nombre sigue siendo el de ese dia.
   *
   * Los puntos se numeran GLOBALES (1..N a traves de todas las secciones): la
   * posicion le da el orden a la corrida y es la misma con la que se responde,
   * aunque en la plantilla cada seccion cuente desde 1. `performed_by` es la foto
   * del nombre de quien la comienza, desde la identidad de la sesion.
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
      if (body.items) body.items.forEach(validarItem);
      const ahora = nowIso();
      const realizo = identity(req).name;

      const { run, items } = db.transaction((tx) => {
        let nombre: string;
        let plantillaId: string | null = null;
        let snapshot: PuntoSnapshot[];
        /** El id del item de la plantilla del que salio cada punto del snapshot. */
        let originales: Array<string | null>;

        if (body.templateId) {
          const plantilla = tx
            .select()
            .from(templates)
            .where(and(eq(templates.id, body.templateId), eq(templates.organizationId, org)))
            .get();
          if (!plantilla) throw new AppError(404, 'Esa plantilla no existe');

          const secciones = seccionesDePlantilla(tx, org, plantilla.id);
          const orden = new Map(secciones.map((s, i) => [s.id, i]));
          const nombreSeccion = new Map(secciones.map((s) => [s.id, s.name]));
          const fuente = tx
            .select()
            .from(templateItems)
            .where(and(eq(templateItems.organizationId, org), eq(templateItems.templateId, plantilla.id)))
            .orderBy(asc(templateItems.position))
            .all()
            .sort((a, b) => (orden.get(a.sectionId) ?? 0) - (orden.get(b.sectionId) ?? 0) || a.position - b.position);
          if (fuente.length === 0) {
            throw new AppError(400, 'Esa plantilla no tiene puntos: agregale al menos uno antes de inspeccionar');
          }
          plantillaId = plantilla.id;
          nombre = plantilla.name;
          originales = fuente.map((p) => p.id);
          snapshot = fuente.map((p, i) => ({
            position: i + 1,
            label: p.label,
            required: p.required,
            type: p.type as Tipo,
            options: p.optionsJson ? (JSON.parse(p.optionsJson) as string[]) : null,
            section: nombreSeccion.get(p.sectionId) ?? null,
          }));
        } else {
          nombre = CORRIDA_LIBRE;
          originales = (body.items ?? []).map(() => null);
          snapshot = (body.items ?? []).map((p, i) => ({
            position: i + 1,
            label: p.label,
            required: p.required,
            type: p.type,
            options: p.type === 'select' ? (p.options ?? null) : null,
            section: null,
          }));
        }

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
            performedBy: realizo,
            notes: body.notes ?? null,
            startedAt: body.startedAt ?? ahora,
            createdAt: ahora,
          })
          .returning()
          .get();

        const filas = snapshot.map((p, i) =>
          tx
            .insert(runItems)
            .values({
              id: createId('rnit'),
              organizationId: org,
              runId: creada.id,
              itemId: originales[i] ?? null,
              position: p.position,
              label: p.label,
              required: p.required,
              type: p.type,
              optionsJson: p.options ? JSON.stringify(p.options) : null,
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
   * La ficha de una corrida: sus datos, sus puntos con la respuesta, el resumen y
   * sus adjuntos.
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
      const items = itemsDeCorrida(org, corrida.id).map((p) => ({ ...p, options: optionsDe(p) }));
      const archivos = db
        .select()
        .from(attachments)
        .where(and(eq(attachments.organizationId, org), eq(attachments.runId, corrida.id)))
        .orderBy(asc(attachments.createdAt))
        .all()
        .map((a) => ({ ...a, url: `/api/runs/${corrida.id}/attachments/${a.id}/file` }));

      res.json({
        run: corrida,
        items,
        snapshot: { templateName: corrida.templateName, items: JSON.parse(corrida.templateItemsJson) },
        resumen: resumir(items),
        attachments: archivos,
      });
    }),
  );

  /** La respuesta a un punto de la corrida. */
  const respuestaSchema = z.object({
    result: z.enum(RESPUESTAS).optional(),
    valueText: z.string().trim().max(4000).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  });

  /**
   * Valida y normaliza la respuesta de un punto SEGUN SU TIPO.
   *
   * `yes_no` responde con `result`; los demas tipos con `value_text`. El `select`
   * se valida contra las opciones de ESTA corrida (las del snapshot), no contra
   * las de la plantilla de hoy: si la plantilla cambia despues de empezar, la
   * corrida sigue eligiendo de la lista de ese dia.
   */
  function normalizarRespuesta(tipo: Tipo, options: string[] | null, body: z.infer<typeof respuestaSchema>) {
    if (tipo === 'yes_no') {
      if (body.result === undefined) {
        throw new AppError(400, `Este punto se responde con ${RESPUESTAS.join(', ')}`);
      }
      return { result: body.result, valueText: null };
    }

    const valor = body.valueText?.trim() ?? '';
    if (valor === '') {
      throw new AppError(400, 'Este punto necesita una respuesta');
    }
    if (tipo === 'number') {
      const numero = Number(valor);
      if (!Number.isFinite(numero)) throw new AppError(400, 'La respuesta tiene que ser un numero');
    }
    if (tipo === 'select' && !options?.includes(valor)) {
      throw new AppError(400, 'Esa opcion no esta en la lista del punto');
    }
    return { result: null, valueText: valor };
  }

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
      const body = respuestaSchema.parse(cuerpo(req));
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
          .select()
          .from(runItems)
          .where(
            and(eq(runItems.organizationId, org), eq(runItems.runId, corridaId), eq(runItems.position, position)),
          )
          .get();
        if (!punto) throw new AppError(404, 'Ese punto no existe en esta corrida');

        const respuesta = normalizarRespuesta(punto.type as Tipo, optionsDe(punto), body);
        const actualizado = tx
          .update(runItems)
          .set({ ...respuesta, note: body.note ?? null, answeredAt: ahora })
          .where(eq(runItems.id, punto.id))
          .returning()
          .get();

        const corridaActualizada = tx
          .update(runs)
          .set({ updatedAt: ahora })
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .returning()
          .get();
        return { run: corridaActualizada, item: actualizado };
      });

      res.json({ run, item });
    }),
  );

  /**
   * Cerrar la corrida, DECIDIENDO EL Veredicto GLOBAL.
   *
   * El 400 va DENTRO de la transaccion que cierra, y es la invariante que hace
   * que este producto valga: una inspeccion firmada sin responder los puntos
   * obligatorios no es una inspeccion, es un formulario firmado en blanco. El
   * mensaje dice cuantos y cuales, no solo "faltan cosas", porque la persona que
   * esta frente a la pantalla tiene que saber a que puntos volver.
   *
   * El veredicto (`approved`/`observed`/`rejected`) se puede mandar explicto en
   * el cuerpo; si no viene, se deriva lo minimo (ver `veredictoDe`).
   *
   * Cerrada la corrida, `completed_at` queda sellado con AHORA y el veredicto
   * queda fijo. Cancelarla no lo sella: cancelada no es completada, y esa
   * diferencia es la primera que se mira en una auditoria.
   */
  router.post(
    '/api/runs/:id/completar',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const body = z
        .object({ result: z.enum(RESULTADOS_GLOBAL).optional() })
        .optional()
        .parse(cuerpo(req) as Record<string, unknown> | undefined);
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

        const evaluados = tx
          .select({ result: runItems.result })
          .from(runItems)
          .where(and(eq(runItems.organizationId, org), eq(runItems.runId, corridaId)))
          .all();
        const resultado = veredictoDe(evaluados, body?.result);

        return tx
          .update(runs)
          .set({ status: 'done', result: resultado, completedAt: ahora, updatedAt: ahora })
          .where(and(eq(runs.id, corridaId), eq(runs.organizationId, org)))
          .returning()
          .get();
      });

      res.json({ run: corrida, resumen: resumir(itemsDeCorrida(org, corridaId)) });
    }),
  );

  /**
   * Editar una corrida: donde se hizo, que se anoto, el veredicto y en que estado
   * esta.
   *
   * Esta ruta esta a mano, y no como un campo mas del `crudRouter`, por la
   * invariante del cierre: si el estado fuera escribible sin reglas, un PATCH con
   * `status: "done"` firmaria una inspeccion sin responder los obligatorios por la
   * puerta de atras. Aca pasar a `done` exige exactamente lo que exige
   * `POST /completar`.
   *
   * El veredicto se puede fijar o limpiar (`result: null`) a proposito: es la
   * forma de corregir un juicio equivocado sin reblar la corrida completa.
   *
   * Volver a `in_progress` DESELLA `completed_at` y quita el veredicto, y es la
   * unica forma de cambiar una respuesta de una corrida cerrada. Que quede
   * escrito, con su nuevo `updated_at`, es lo que convierte el reabrir en un acto
   * y no en un olvido.
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
          result: z.enum(RESULTADOS_GLOBAL).nullable().optional(),
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
        if (body.result !== undefined) cambios.result = body.result;

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
            const evaluados = tx
              .select({ result: runItems.result })
              .from(runItems)
              .where(and(eq(runItems.organizationId, org), eq(runItems.runId, corridaId)))
              .all();
            cambios.status = 'done';
            cambios.completedAt = ahora;
            // Si no se dijo veredicto al completar y no hay uno puesto, se deriva.
            if (cambios.result === undefined && fila.result === null) {
              cambios.result = veredictoDe(evaluados);
            }
          } else {
            // Cancelar y reabrir: en los dos casos la corrida deja de estar
            // cerrada. Cancelar NO sella `completed_at`, porque cancelada no es
            // completada. Reabrir quita el veredicto: la corrida se firma de
            // nuevo, y el juicio viejo no vale para la nueva pasada.
            cambios.status = body.status;
            cambios.completedAt = null;
            if (fila.status === 'done') cambios.result = null;
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

  // ─────────────────────────────────────────────────────────────────── adjuntos

  /**
   * Adjunta un archivo a la corrida: una foto o un documento de la inspeccion.
   *
   * El navegador envia el contenido en base64 dentro del JSON de la API; el
   * servidor lo decodifica y lo escribe en disco. El archivo NO entra a la base:
   * lo que se guarda es la referencia con su ruta relativa.
   */
  router.post(
    '/api/runs/:id/attachments',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      corridaVisible(org, corridaId);

      const cuerpoAdjunto = z
        .object({
          filename: z.string().trim().min(1).max(200),
          mimeType: z.string().trim().max(120).nullable().optional(),
          // Se acepta base64 pelado o con prefijo `data:...;base64,`.
          data: z.string().trim().min(4),
        })
        .parse(req.body);

      const luego = cuerpoAdjunto.data.includes(';base64,') ? cuerpoAdjunto.data.split(';base64,')[1] : cuerpoAdjunto.data;
      const buffer = Buffer.from(luego as string, 'base64');
      // El limite de 750 KB es un poco menor al tope de 1 MB del JSON: el body
      // en base64 ocupa 4/3 del archivo, y quien exceda el tope tiene que saberlo
      // con un 413 que signifique algo.
      if (buffer.length < 1 || buffer.length > 750_000) {
        throw new AppError(413, 'El archivo no puede superar 750 KB');
      }

      const adjuntoId = createId('chlaj');
      // El nombre en disco se deriva del id, nunca del que envio el cliente: un
      // nombre llegado de afuera no vale para armar una ruta. El original se
      // conserva solo en la columna `filename`, para mostrarlo y descargarlo.
      mkdirSync(carpetaAdjuntos, { recursive: true });
      writeFileSync(join(carpetaAdjuntos, adjuntoId), buffer);

      const adjunto = {
        id: adjuntoId,
        organizationId: org,
        runId: corridaId,
        filename: cuerpoAdjunto.filename,
        path: `attachments/${adjuntoId}`,
        mimeType: cuerpoAdjunto.mimeType ?? null,
        sizeBytes: buffer.length,
        createdAt: nowIso(),
      };
      db.insert(attachments).values(adjunto).run();

      res.status(201).json({
        attachment: adjunto,
        url: `/api/runs/${corridaId}/attachments/${adjuntoId}/file`,
      });
    }),
  );

  /** Descarga el archivo, con el nombre original con el que se envio. */
  router.get(
    '/api/runs/:id/attachments/:attId/file',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const attId = id.parse(req.params.attId);
      corridaVisible(org, corridaId);

      const adjunto = db
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.id, attId), eq(attachments.organizationId, org), eq(attachments.runId, corridaId)),
        )
        .get();
      if (!adjunto) throw new AppError(404, 'Ese adjunto no existe');

      // La ruta se re-construye desde el id y nunca se confia en `adjunto.path`
      // como ruta absoluta: `basename` descarta cualquier intento de escape.
      const ruta = join(carpetaAdjuntos, basename(adjunto.path));
      if (!existsSync(ruta)) throw new AppError(404, 'El archivo ya no existe');

      if (adjunto.mimeType) res.setHeader('content-type', adjunto.mimeType);
      res.download(ruta, adjunto.filename);
    }),
  );

  router.delete(
    '/api/runs/:id/attachments/:attId',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const attId = id.parse(req.params.attId);
      corridaVisible(org, corridaId);

      const adjunto = db
        .select()
        .from(attachments)
        .where(
          and(eq(attachments.id, attId), eq(attachments.organizationId, org), eq(attachments.runId, corridaId)),
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

  /**
   * Borrar una corrida, y sus archivos en disco.
   *
   * Está a mano y de admin, antes de que el `crudRouter` tome el `DELETE`, por
   * dos razones: borrar una corrida es borrar una inspeccion (decision de un
   * responsable), y los archivos de sus adjuntos viven EN DISCO y no se borran
   * solos con la fila. Primero se lista el adjunto, se borra la corrida (CASCADE
   * se lleva sus puntos y sus filas de adjuntos) y despues se borran los
   * archivos; si un archivo ya no esta, no impide el borrado.
   */
  router.delete(
    '/api/runs/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const corridaId = id.parse(req.params.id);
      const corrida = corridaVisible(org, corridaId);

      const archivos = db
        .select()
        .from(attachments)
        .where(and(eq(attachments.organizationId, org), eq(attachments.runId, corridaId)))
        .all();
      db.delete(runs).where(and(eq(runs.id, corridaId), eq(runs.organizationId, org))).run();
      for (const archivo of archivos) {
        try {
          unlinkSync(join(carpetaAdjuntos, basename(archivo.path)));
        } catch {
          // Un archivo que ya no esta en disco no impide el borrado.
        }
      }

      res.json({ deleted: true });
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
   * De las corridas, sirve el detalle; el borrado esta escrito a mano mas arriba
   * (de admin y con limpieza de archivos en disco). El alta, la edicion, el
   * listado y todos los metodos de los puntos estan mas arriba, por las razones
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
        // El estado y el veredicto NO son campos escribibles del CRUD, y esa es la
        // razon de que `PATCH /api/runs/:id` este escrito a mano: un estado libre
        // permitiria firmar una inspeccion saltandose la regla de los obligatorios.
        templateId: { readonly: true },
        templateName: { readonly: true },
        templateItemsJson: { readonly: true },
        location: { schema: z.string().trim().max(150).nullable().optional() },
        status: { readonly: true },
        result: { readonly: true },
        performedBy: { readonly: true },
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