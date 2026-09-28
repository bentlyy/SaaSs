import { Router } from 'express';
import { and, count, desc, eq, isNull, sql } from 'drizzle-orm';
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
import { assetMovements, assets, settings } from './schema.js';

/**
 * API de activos.
 *
 * Cuatro invariantes, y las cuatro estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Una empresa no puede pedir los datos de otra aunque adivine el id.
 *
 *   2. Un movimiento apunta a un activo de ESTA organizacion. Sin ese chequeo, un
 *      movimiento quedaria colgado de un id de otra empresa y el `CASCADE` de
 *      la base podria borrar el activo equivocado.
 *
 *   3. El tipo de un movimiento DECIDE el estado del activo, y las dos cosas se
 *      escriben en la MISMA transaccion. Un checkout que queda en la base sin
 *      cambiar el estado deja un activo "activo" que en realidad esta en manos
 *      de otra persona, que es exactamente el dato que este producto existe para
 *      no equivocar.
 *
 *   4. El historial NO se edita ni se borra. `asset_movements` tiene endpoint de
 *      alta y de lectura, y nada mas. Una fila que dice "el jueves se perdio en
 *      obra" deja de ser verdad si se puede corregir en silencio.
 *
 * ESTE producto NO tiene fuente legacy: no hay datos de activos en ningun
 * producto viejo. Por eso no hay `migrate-legacy.ts` ni `legacy_tenant_map` que
 * mapear. Un migrador sin datos de los que leer es fiction.
 *
 * El dinero aparece UNA vez, en `cost_cents`, y siempre en centavos enteros. La
 * columna, la API y la pantalla hablan la misma unidad de punta a punta: no hay
 * `* 100` en ningun lado, porque convertir dos veces es como se rompieron los
 * precios del legacy.
 */

const texto = z.string().trim().min(1).max(150);
const id = z.string().trim().min(1).max(64);

/**
 * El codigo del bien: lo que la gente dice en voz alta ("el EQ-004").
 *
 * Corto a proposito. Un codigo es una etiqueta, y una etiqueta de 40 caracteres
 * no se dicta por radio. Se comparan y se ordenan tal cual, sin pasar a
 * mayusculas: `eq-004` y `EQ-004` serian dos bienes distintos, y el indice
 * UNICO los aceptaria como tales, que es la unica forma de que el codigo que ve
 * la gente sea el codigo que esta en la base.
 */
const codigo = z.string().trim().min(1, 'El codigo no puede ir vacio').max(40);

/** `z.coerce.boolean()` convierte "false" en `true`; esto si lo lee bien. */
const booleano = z.preprocess((v) => {
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'si';
  return v;
}, z.boolean());

/**
 * "Comprado el" es una FECHA, no un instante.
 *
 * Se valida el formato a mano en vez de usar `Date.parse`, porque `Date.parse`
 * acepta "2026-9-4" y "septiembre de 2026" y tambien "42": la fecha de compra de
 * un bien es un dia del calendario, y guardarla con hora inventa precision que
 * nadie tiene y corre el dia al convertir desde un huso al este.
 */
const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de compra va como AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha invalida')
  .nullable()
  .optional();

/** Un instante ISO: un movimiento si importa la hora, porque ya ocurrio. */
const instante = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Instante invalido: va como ISO, por ejemplo 2026-09-27T15:00:00.000Z');

/**
 * El costo del bien, en CENTAVOS.
 *
 * `z.coerce.number()` acepta el `"45055"` que manda un formulario y el `45055`
 * que manda otro cliente, y `Math.round` lo deja en un entero: una columna de
 * patrimonio que guarde `45055.4` tiene un valor que no es un centimo, y al
 * sumarlo con otros la diferencia aparece en el total de la empresa, que es el
 * numero que nadie puede explicar. Se redondea UNA vez, al escribir; para leer
 * no hace falta, porque lo que se guardo ya es entero.
 */
const centavos = z
  .coerce
  .number()
  .finite('El costo tiene que ser un numero')
  .min(0, 'El costo no puede ser negativo')
  .max(100_000_000_000)
  .transform((v) => Math.round(v))
  .refine((v) => Number.isSafeInteger(v), 'El costo tiene que ser un numero entero de centavos');

/**
 * Los cuatro estados de un bien, y las cuatro preguntas a las que contestan.
 *
 * Son cerrados a proposito: `active` esta en uso, `repair` esta en el taller,
 * `retired` salio de servicio y `lost` no aparece mas. Un texto libre permitiria
 * escribir "reparado" o "baja" y la columna dejaria de poder filtrarse, que es
 * la unica razon por la que existe.
 */
const ESTADOS = ['active', 'repair', 'retired', 'lost'] as const;
type Estado = (typeof ESTADOS)[number];

/**
 * Los cuatro hechos fisicos que se registran sobre un activo.
 *
 * `maintenance` y `loss` no son "retiros" ni "altas": son hechos que cambian el
 * estado sin cambiar de manos. Dar de baja un bien (`retired`) NO es un hecho
 * fisico sino una decision de negocio sobre el patrimonio, y por eso no es un
 * tipo de movimiento: se registra cambiando el estado, y asi la tabla de
 * historial queda con lo que se le hizo al equipo y no con lo que la empresa
 * resolvio sobre el.
 */
const TIPOS_MOVIMIENTO = ['checkin', 'checkout', 'maintenance', 'loss'] as const;
type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number];

/**
 * Que estado deja cada tipo de movimiento.
 *
 * `checkout` deja `active` y no `assigned`: el bien sale pero sigue siendo del
 * patrimonio y en uso, lo unico que cambia es quien lo tiene. `checkin` tambien
 * deja `active`, porque un bien que vuelve del taller o de la obra vuelve a
 * estar operativo, y por eso el unico estado que necesita "estar quieto" es
 * `repair`.
 */
const ESTADO_QUE_DEJA: Record<TipoMovimiento, Estado> = {
  checkin: 'active',
  checkout: 'active',
  maintenance: 'repair',
  loss: 'lost',
};

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
  };
}

/**
 * El cuerpo de un activo.
 *
 * `status` entra por la API y no sale derivado: un bien puede ponerse en
 * `repair` desde la pantalla sin tener que inventar un movimiento de taller, y
 * `retired` SOLO se puede poner asi, porque es una decision y no un hecho.
 *
 * `archived` es un booleano y no `archived_at`: la fecha la pone el servidor
 * cuando se archiva, y `archived: false` la saca. Aceptar la fecha desde el
 * cliente permitiria mandar `"9999-01-01"` y sacar el bien de la vista para
 * siempre.
 */
const activoSchema = z.object({
  code: codigo,
  name: texto,
  category: texto,
  brand: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(80).nullable().optional(),
  serial: z.string().trim().max(80).nullable().optional(),
  status: z.enum(ESTADOS).default('active'),
  location: z.string().trim().max(150).nullable().optional(),
  assignedTo: z.string().trim().max(120).nullable().optional(),
  purchaseDate: fecha,
  costCents: centavos.default(0),
  notes: z.string().trim().max(2000).nullable().optional(),
  archived: booleano.optional(),
});

const movimientoSchema = z.object({
  kind: z.enum(TIPOS_MOVIMIENTO),
  assignedTo: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
  /** Si no viene, el movimiento se registra ahora. */
  happenedAt: instante.optional(),
});

/**
 * El prefijo con el que arranca una empresa que todavia no tiene codigos.
 *
 * "EQ" es de equipo, que es lo mas comun, y es una PROPUESTA: la pantalla la
 * muestra y el usuario la cambia antes de guardar. Es preferible a inventar un
 * prefijo en el servidor: el que etiqueta un bien es quien sabe si alli llevan
 * "EQ", "MAQ" o "TL-".
 */
const PREFIJO_POR_DEFECTO = 'EQ-';

/** Un codigo es `<prefijo><numero>`: `EQ-004` es `EQ-` mas `004`. */
const CON_NUMERO_AL_FINAL = /^(.*?)(\d+)$/;

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /** Un activo tiene que ser de ESTA organizacion, no solo existir. */
  function activoDe(org: string, activoId: string) {
    const fila = db
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.id, activoId), eq(assets.organizationId, org)))
      .get();
    // El mensaje dice "no existe" a proposito: un "es de otra empresa" confirmaria
    // que ese id existe, que es justo la informacion que se le quiere negar.
    if (!fila) throw new AppError(404, 'Ese activo no existe');
  }

  const activoVisible = (org: string, activoId: string) =>
    db
      .select()
      .from(assets)
      .where(and(eq(assets.id, activoId), eq(assets.organizationId, org)))
      .get();

  // ─────────────────────────────────────────────────────────────────── tablero

  /**
   * Los numeros del patrimonio: cuantos hay de cada estado, cuanto valen los
   * que estan en uso y los ultimos que se registraron.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razon que `low-stock` en
   * el inventario: si no, "dashboard" se lee como un id.
   *
   * El valor que se muestra es el de los `active` y por eso la tarjeta se
   * llama "valor en uso": un bien dado de baja o perdido sigue en el
   * inventario, pero no es capital trabajando. La cifra del patrimonio completo,
   * que incluiria lo perdido, es otra pregunta, y mezclarla en la misma tarjeta
   * hace que ninguna de las dos se pueda leer.
   *
   * Se arman LOS CUATRO estados aunque alguno no tenga activos, para que la
   * pantalla no encoja y crezca segun los datos del mes.
   */
  router.get(
    '/api/dashboard',
    asyncHandler(async (req, res) => {
      const org = orgId(req);

      // Los archivados quedan fuera de las tres cifras: archivar es sacarlos de
      // la operacion sin perder la historia, y un tablero que los cuenta como
      // parte del patrimonio no esta diciendo la verdad.
      const grupos = db
        .select({
          status: assets.status,
          cantidad: count(),
          centavos: sql<number>`coalesce(sum(${assets.costCents}), 0)`,
        })
        .from(assets)
        .where(and(eq(assets.organizationId, org), isNull(assets.archivedAt)))
        .groupBy(assets.status)
        .all();

      const de = (estado: Estado) => grupos.find((g) => g.status === estado);
      const recientes = db
        .select({
          id: assets.id,
          code: assets.code,
          name: assets.name,
          category: assets.category,
          status: assets.status,
          location: assets.location,
          assignedTo: assets.assignedTo,
          costCents: assets.costCents,
        })
        .from(assets)
        .where(and(eq(assets.organizationId, org), isNull(assets.archivedAt)))
        .orderBy(desc(assets.createdAt))
        .limit(5)
        .all();

      res.json({
        total: grupos.reduce((acc, g) => acc + g.cantidad, 0),
        porStatus: Object.fromEntries(ESTADOS.map((e) => [e, de(e)?.cantidad ?? 0])),
        valorEnUsoCents: de('active')?.centavos ?? 0,
        recientes,
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────────── codigo

  /**
   * El siguiente codigo libre de la organizacion.
   *
   * Va antes que el `crudRouter` de `/api/assets` porque este tiene un `GET /:id`
   * generico: sin esta ruta de arriba, "next-code" seria un id y la pantalla de
   * alta recibiria un 404 en vez de una propuesta.
   *
   * Como se elige el prefijo: el del codigo con el NUMERO mas alto de toda la
   * empresa. Es la misma logica del folio de `solicitudes` y por el mismo motivo:
   * si se usara el del ultimo creado, alguien que escribiera a mano "EQ-999"
   * dejaria de ser el tope y la numeracion volveria hacia atras, pisando un
   * codigo que ya existe. El `while` del final no es decorativo: es la garantia
   * de que el codigo propuesto esta LIBRE de verdad, y no solo libre segun la
   * aritmetica del maximo.
   *
   * Se miran TODOS los activos de la empresa, incluidos los archivados: un bien
   * archivado sigue ocupando su codigo, porque se puede volver a sacar, y
   * reciclar el codigo de un bien dado de baja por error es como se termina
   * con dos equipos con el mismo numero en el taller.
   *
   * Cuando ningun codigo tiene numero ("LAPTOP-ANA", "PROY-A") no hay serie que
   * seguir, y se propone el prefijo por defecto desde 1. Inventar un numero
   * suelto en medio de la lista sin avisar es peor que empezar de nuevo.
   */
  router.get(
    '/api/assets/next-code',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const codigos = db.select({ code: assets.code }).from(assets).where(eq(assets.organizationId, org)).all();

      const series = new Map<string, { max: number; ancho: number }>();
      for (const { code } of codigos) {
        const partes = CON_NUMERO_AL_FINAL.exec(code);
        if (!partes) continue;
        const [, prefijo, numero] = partes;
        const n = Number(numero);
        const actual = series.get(prefijo);
        if (!actual || n > actual.max) {
          // El ancho se guarda del codigo mas alto: si la empresa numera con
          // ceros ("EQ-004"), el siguiente se propone con el mismo ancho
          // ("EQ-005") y no como "EQ-5", que romperse la serie a la vista.
          series.set(prefijo, { max: n, ancho: numero.length });
        }
      }

      const elegido = [...series.entries()].sort((a, b) => b[1].max - a[1].max)[0];
      if (!elegido) {
        res.json({ code: `${PREFIJO_POR_DEFECTO}1`, prefijo: PREFIJO_POR_DEFECTO });
        return;
      }

      const [prefijo, { ancho }] = elegido;
      const existentes = new Set(codigos.map((c) => c.code));
      let numero = elegido[1].max + 1;
      let candidato = `${prefijo}${String(numero).padStart(ancho, '0')}`;
      while (existentes.has(candidato)) {
        numero += 1;
        candidato = `${prefijo}${String(numero).padStart(ancho, '0')}`;
      }
      res.json({ code: candidato, prefijo });
    }),
  );

  // ────────────────────────────────────────────────────────────────────── ficha

  /**
   * La ficha de un activo: sus datos y todo lo que se le hizo, del movimiento
   * mas nuevo al mas viejo.
   *
   * El historial va en `DESC` de `happened_at` porque la pregunta que se hace
   * mirando una ficha es "que le paso la ultima vez", y `asset_id + happened_at`
   * es el indice declarado en el esquema, en ese orden exacto.
   */
  router.get(
    '/api/assets/:id/ficha',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const activoId = id.parse(req.params.id);
      const activo = activoVisible(org, activoId);
      if (!activo) throw new AppError(404, 'Ese activo no existe');

      const movimientos = db
        .select()
        .from(assetMovements)
        .where(and(eq(assetMovements.organizationId, org), eq(assetMovements.assetId, activoId)))
        .orderBy(desc(assetMovements.happenedAt), desc(assetMovements.createdAt))
        .all();

      res.json({
        asset: activo,
        movements: movimientos,
        resumen: {
          totalMovimientos: movimientos.length,
          ultimoMovimientoAt: movimientos[0]?.happenedAt ?? null,
        },
      });
    }),
  );

  // ────────────────────────────────────────────────────────────────── movimientos

  /**
   * Registrar un movimiento y aplicar su efecto sobre el estado.
   *
   * Las dos escrituras van en UNA transaccion. Es la invariante central del
   * producto: un checkout que queda guardado sin cambiar el estado deja un
   * activo "activo" que en realidad esta en manos de otra persona, y un
   * `loss` sin el estado "perdido" deja un bien que la empresa todavia cuenta
   * como propio. Mitad del hecho guardado es peor que no guardar nada.
   *
   * `better-sqlite3` es sincrono, asi que `transaction` devuelve el valor del
   * callback y no una promesa: no hay que esperarlo, y un `await` de mas
   * solo haria creer que la escritura se completa despues.
   */
  router.post(
    '/api/assets/:id/movimientos',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const activoId = id.parse(req.params.id);
      const body = movimientoSchema.parse(req.body);

      // Un retiro sin responsable es un "@pendiente" suelto: se sabe que el
      // equipo se llevo alguien, y no se sabe quien. Se pide antes de tocar la
      // base, para que un formulario a medio llenar no deje un movimiento
      // escrito con el estado cambiado.
      if (body.kind === 'checkout' && !body.assignedTo) {
        throw new AppError(400, 'Un retiro (checkout) necesita saber a quien se entrega: manda assignedTo');
      }

      const ahora = nowIso();
      const escrito = db.transaction((tx) => {
        const activo = tx
          .select()
          .from(assets)
          .where(and(eq(assets.id, activoId), eq(assets.organizationId, org)))
          .get();
        if (!activo) throw new AppError(404, 'Ese activo no existe');

        const movimiento = tx
          .insert(assetMovements)
          .values({
            id: createId('actmov'),
            organizationId: org,
            assetId: activoId,
            kind: body.kind,
            note: body.note ?? null,
            // Sin `happenedAt` el movimiento se registra ahora. Un movimiento se
            // escribe mientras pasa, y anotar la hora a mano solo abre la puerta
            // a escribir el dia equivocado.
            happenedAt: body.happenedAt ?? ahora,
            createdAt: ahora,
          })
          .returning()
          .get();

        const cambios = {
          status: ESTADO_QUE_DEJA[body.kind],
          updatedAt: ahora,
          // El responsable SOLO se escribe en un checkout, que es el unico
          // movimiento que cambia de manos. En un checkin no se borra: la
          // ultima persona que lo tuvo es informacion, y se reemplaza en el
          // proximo checkout en vez de desaparecer.
          ...(body.kind === 'checkout' && body.assignedTo ? { assignedTo: body.assignedTo } : {}),
        };
        const actualizado = tx
          .update(assets)
          .set(cambios)
          .where(and(eq(assets.id, activoId), eq(assets.organizationId, org)))
          .returning()
          .get();

        return { asset: actualizado, movement: movimiento };
      });

      res.status(201).json(escrito);
    }),
  );

  // ───────────────────────────────────────────────────────────────────── escribir

  /**
   * El codigo es unico por empresa, y el `409` se decide DENTRO de la
   * transaccion.
   *
   * Comprobar antes de escribir deja una ventana: dos personas que registren el
   * mismo equipo en el mismo segundo pasan las dos el chequeo, y la segunda
   * revienta con un error de SQLite en vez de un 409 que la pantalla entienda.
   * El indice UNIQUE sigue siendo la garantia real; esto solo convierte el
   * error en algo que se puede mostrar.
   *
   * Estas tres rutas de escritura van ANTES que el `crudRouter` de `/api/assets`
   * por el mismo motivo que `next-code` y que `ficha`: Express resuelve en orden
   * de registro, asi que la primera coincidencia gana. El `crudRouter` se queda
   * con la lista y con la lectura puntual, que es la parte que SI es CRUD
   * generico; el alta, la edicion y el borrado se escriben a mano porque cada
   * una tiene una regla de negocio que el CRUD generico no puede expresar.
   */
  router.post(
    '/api/assets',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = activoSchema.parse(req.body);
      const ahora = nowIso();

      const creado = db.transaction((tx) => {
        const choque = tx
          .select({ id: assets.id })
          .from(assets)
          .where(and(eq(assets.organizationId, org), eq(assets.code, body.code)))
          .get();
        if (choque) {
          throw new AppError(409, `Ya existe un activo con el codigo ${body.code} en esta empresa`);
        }
        return tx
          .insert(assets)
          .values({
            id: createId('act'),
            organizationId: org,
            code: body.code,
            name: body.name,
            category: body.category,
            brand: body.brand ?? null,
            model: body.model ?? null,
            serial: body.serial ?? null,
            status: body.status,
            location: body.location ?? null,
            assignedTo: body.assignedTo ?? null,
            purchaseDate: body.purchaseDate ?? null,
            costCents: body.costCents,
            notes: body.notes ?? null,
            archivedAt: body.archived ? ahora : null,
            createdAt: ahora,
          })
          .returning()
          .get();
      });

      res.status(201).json(creado);
    }),
  );

  router.patch(
    '/api/assets/:id',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const activoId = id.parse(req.params.id);
      const existente = activoVisible(org, activoId);
      if (!existente) throw new AppError(404, 'Ese activo no existe');

      // El PATCH parte del activo que ya existe, asi que se puede mandar solo el
      // estado y no perder el resto. Un `parse` sobre el cuerpo pelado exigiria
      // mandar todos los campos siempre, y el que olvide uno se queda sin
      // guardar sin avisar.
      const body = activoSchema.parse({
        code: existente.code,
        name: existente.name,
        category: existente.category,
        brand: existente.brand,
        model: existente.model,
        serial: existente.serial,
        status: existente.status,
        location: existente.location,
        assignedTo: existente.assignedTo,
        purchaseDate: existente.purchaseDate,
        costCents: existente.costCents,
        notes: existente.notes,
        ...req.body,
      });

      // Archivar es reversible y la fecha la pone el servidor: si viene el
      // booleano, se archiva con AHORA o se saca con null. Si no viene, el
      // activo sigue como estaba.
      const ahora = nowIso();
      const archivado = body.archived === undefined ? existente.archivedAt : body.archived ? ahora : null;

      const actualizado = db.transaction((tx) => {
        if (body.code !== existente.code) {
          const choque = tx
            .select({ id: assets.id })
            .from(assets)
            .where(and(eq(assets.organizationId, org), eq(assets.code, body.code)))
            .get();
          if (choque) {
            throw new AppError(409, `Ya existe un activo con el codigo ${body.code} en esta empresa`);
          }
        }
        return tx
          .update(assets)
          .set({
            code: body.code,
            name: body.name,
            category: body.category,
            brand: body.brand ?? null,
            model: body.model ?? null,
            serial: body.serial ?? null,
            status: body.status,
            location: body.location ?? null,
            assignedTo: body.assignedTo ?? null,
            purchaseDate: body.purchaseDate ?? null,
            costCents: body.costCents,
            notes: body.notes ?? null,
            archivedAt: archivado,
            updatedAt: ahora,
          })
          .where(and(eq(assets.id, activoId), eq(assets.organizationId, org)))
          .returning()
          .get();
      });

      res.json(actualizado);
    }),
  );

  /**
   * Borrar un activo es la excepcion, y solo cuando no tiene historia.
   *
   * Un activo con movimientos no se borra en cascada desde la API. El CASCADE
   * del DDL existe para la baja definitiva, y desde un boton de la pantalla es
   * justo el error que no se quiere cometer: se lleva por delante la prueba de
   * que un equipo se perdio en obra o de que estaba en el taller. En vez de
   * borrarlo se ofrece `archived`, que saca el bien de la lista sin perder ni el
   * activo ni su historial.
   *
   * Un activo SIN movimientos si se borra de verdad: se creo por error, no tiene
   * historia que perder, y dejarlo archivado seria ruido en la tabla.
   */
  router.delete(
    '/api/assets/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const activoId = id.parse(req.params.id);
      activoDe(org, activoId);

      const movimientos = db
        .select({ n: count() })
        .from(assetMovements)
        .where(and(eq(assetMovements.organizationId, org), eq(assetMovements.assetId, activoId)))
        .get();
      if ((movimientos?.n ?? 0) > 0) {
        throw new AppError(
          409,
          'Este activo tiene movimientos en su historial y no se borra en cascada: ' +
            'archivalo (PATCH {"archived": true}) en su lugar, que sale de la lista sin perder la historia.',
        );
      }

      const borrado = db
        .delete(assets)
        .where(and(eq(assets.id, activoId), eq(assets.organizationId, org)))
        .returning()
        .get();
      res.json({ asset: borrado, deleted: true });
    }),
  );

  // ────────────────────────────────────────────────────────────────── preferencias

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
   * Por eso el PUT pide `admin`: si un miembro las cambiara, la lectura del
   * costo de todo el patrimonio se moveria para toda la gente a la vez. Leer es
   * libre; cambiar la configuracion compartida no.
   *
   * La zona se valida contra `Intl` en vez de contra una lista escrita a mano:
   * cualquier zona de la base de IANA sirve, y una lista propia envejece. Una
   * zona que el runtime no conoce se rechaza con un mensaje util.
   */
  router.put(
    '/api/settings',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cuerpo = z
        .object({
          currency: z.string().trim().min(1).max(5).default('$'),
          timezone: z.string().trim().min(1).max(64).default('America/Santiago'),
        })
        .parse(req.body);

      try {
        new Intl.DateTimeFormat('en-CA', { timeZone: cuerpo.timezone }).format(new Date());
      } catch {
        throw new AppError(400, `Zona horaria desconocida: ${cuerpo.timezone}`);
      }

      const existente = db.select().from(settings).where(eq(settings.organizationId, org)).get();
      if (existente) {
        db.update(settings)
          .set({ ...cuerpo, updatedAt: nowIso() })
          .where(eq(settings.id, existente.id))
          .run();
      } else {
        db.insert(settings)
          .values({ id: `cfg_${org}`, organizationId: org, ...cuerpo, createdAt: nowIso() })
          .run();
      }
      res.json({ settings: { organizationId: org, ...leerPreferencias(db, org) } });
    }),
  );

  // ─────────────────────────────────────────────────────────────────────── CRUD

  /**
   * La lectura de la ficha del activo: la lista con busqueda y el detalle.
   *
   * `archive: true` esconde los archivados de la lista, que es exactamente lo
   * que significa archivar. El `total` sale del mismo filtro, asi que el
   * paginador y las tarjetas cuentan la misma cosa que la tabla muestra.
   *
   * La busqueda cubre las seis columnas por las que de verdad se busca un bien:
   * el codigo, el nombre, la marca, el modelo, el numero de serie y quien lo
   * tiene. Falta la categoria a proposito: nadie busca "todas las herramientas"
   * escribiendo la palabra herramienta, y la pantalla tiene un filtro de estado
   * para eso.
   */
  router.use(
    '/api/assets',
    crudRouter(ctx.handle, {
      table: assets,
      idPrefix: 'act',
      label: 'activo',
      search: [assets.code, assets.name, assets.brand, assets.model, assets.serial, assets.assignedTo],
      orderBy: assets.code,
      orderDirection: 'asc',
      archive: true,
      fields: {
        code: { schema: codigo },
        name: { schema: texto },
        category: { schema: texto },
        brand: { schema: z.string().trim().max(80).nullable().optional() },
        model: { schema: z.string().trim().max(80).nullable().optional() },
        serial: { schema: z.string().trim().max(80).nullable().optional() },
        status: { schema: z.enum(ESTADOS).default('active') },
        location: { schema: z.string().trim().max(150).nullable().optional() },
        assignedTo: { schema: z.string().trim().max(120).nullable().optional() },
        purchaseDate: { schema: fecha },
        costCents: { schema: centavos.default(0) },
        notes: { schema: z.string().trim().max(2000).nullable().optional() },
        archivedAt: { readonly: true },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}
