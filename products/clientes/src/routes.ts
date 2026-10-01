import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
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
import { customers, followups, interactions, settings } from './schema.js';

/**
 * API de clientes.
 *
 * Cuatro invariantes, y las cuatro estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Un cliente no puede pedir los datos de otra empresa aunque adivine
 *      el id.
 *
 *   2. Un seguimiento o un contacto tienen que apuntar a un cliente de ESTA
 *      organizacion. Sin ese chequeo, un cliente colaria el id de una ficha de
 *      otra empresa y apareceria un pendiente con el nombre de un desconocido.
 *
 *   3. `completed_at` lo pone el SERVIDOR cuando el seguimiento pasa a `done`, y
 *      no el cliente. "Se completo ahora" es un hecho del sistema: si lo
 *      escribiera el cuerpo de la peticion, cualquiera podria afirmar que se
 *      completo la semana pasada.
 *
 *   4. El historial de contacto NO se edita ni se borra por API. Se agrega y se
 *      lee. Un registro que dice "llame el martes y no contesto" deja de ser
 *      verdad si se puede corregir en silencio, asi que `interactions` tiene
 *      endpoint de alta y de lectura, y nada mas.
 *
 * ESTE producto no maneja dinero. El precio de un trabajo es de `citas` y el de
 * una propuesta es de `cotizaciones`; aca no hay un solo importe, asi que no hay
 * centavos que convertir ni que underlies mas.
 */

const texto = z.string().trim().min(1).max(150);
const email = z.string().trim().email('Correo invalido').max(200);
const id = z.string().trim().min(1).max(64);

/** `z.coerce.boolean()` convierte "false" en `true`; esto si lo lee bien. */
const booleano = z.preprocess((v) => {
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'si';
  return v;
}, z.boolean());

/**
 * "Para cuando" es una FECHA, no un instante.
 *
 * Se valida el formato a mano en vez de usar `Date.parse`, porque `Date.parse`
 * acepta "2026-9-4" y "septiembre de 2026" y tambien "42": "el lunes hay que
 * llamarlo" es un dia, no un momento. Guardarla como texto `AAAA-MM-DD` ademas
 * evita el corrimiento de dia que aparece al convertir una fecha local a UTC en
 * un huso al oeste, que es donde estan casi todos estos negocios.
 */
const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha invalida')
  .nullable()
  .optional();

/** Un instante ISO: aqui si importa la hora, porque es un hecho que ya ocurrio. */
const instante = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Instante invalido: va como ISO, por ejemplo 2026-09-27T15:00:00.000Z');

/**
 * Los estados de un seguimiento: `pending`, `done` y `canceled`.
 *
 * `canceled` con una sola ele es lo que usa el producto. El legacy escribia
 * `cancelled` con dos: el migrador traduce, y la API no acepta la forma vieja
 * para que no convivan las dos en la misma columna.
 */
const ESTADOS = ['pending', 'done', 'canceled'] as const;
type Estado = (typeof ESTADOS)[number];

/** Estados en los que un seguimiento sigue pendiente de algo. */
const PENDIENTES: Estado[] = ['pending'];

/** Los cuatro canales de contacto que una ficha distingue de verdad. */
const TIPOS_CONTACTO = ['llamada', 'correo', 'visita', 'nota'] as const;

/** Los dos tipos de ficha: una persona o una empresa. */
const TIPOS_CLIENTE = ['persona', 'empresa'] as const;

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
  };
}

/**
 * El "hoy" de la organizacion, no el de UTC.
 *
 * El tablero responde "que tengo que hacer HOY", asi que la respuesta depende de
 * donde esta la empresa. A las 21:00 en `America/Mexico_City` ya es manana en
 * el servidor, y un tablero que dijera "hoy" con la fecha de UTC mandaria a
 * llamar a la gente del dia que ya termino.
 *
 * `en-CA` es el unico locale de Intl que rinde `AAAA-MM-DD`, y por eso se usa ese
 * y no `es-CL`, que devolveria `27/09/2026`. Una zona horaria que el runtime de
 * Node no conoce cae en UTC en vez de romper la pantalla: es mejor mostrar una
 * fecha que la de otro huso que no mostrar nada.
 */
function hoyDe(org: string, db: ProductDb['db']): string {
  const { timezone } = leerPreferencias(db, org);
  for (const zona of [timezone, 'UTC']) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zona,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      // Se prueba la siguiente zona; si ninguna sirve, se devuelve la de UTC.
    }
  }
  return new Date().toISOString().slice(0, 10);
}

const seguimientoSchema = z.object({
  customerId: id,
  title: texto,
  body: z.string().trim().max(2000).nullable().optional(),
  dueDate: fecha,
  status: z.enum(ESTADOS).default('pending'),
});

const contactoSchema = z.object({
  customerId: id,
  kind: z.enum(TIPOS_CONTACTO).default('nota'),
  summary: texto,
  /** Si no viene, se toma el instante de ahora: un contacto ocurre cuando se registra. */
  happenedAt: instante.optional(),
});

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /**
   * Un cliente tiene que ser de ESTA organizacion, no solo existir.
   *
   * El mensaje dice "no existe" a proposito: un "es de otra empresa" confirmaria
   * que ese id existe, que es justo la informacion que se le quiere negar.
   */
  function clienteDe(org: string, customerId: string) {
    const fila = db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, org)))
      .get();
    if (!fila) throw new AppError(400, 'Ese cliente no existe en esta organización');
  }

  const clienteVisible = (org: string, customerId: string) =>
    db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, org)))
      .get();

  // ─────────────────────────────────────────────────────────────────── tablero

  /**
   * Lo que hay que hacer hoy: la pantalla principal.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razon que `low-stock` en
   * el inventario: si no, "tablero" se lee como un id.
   *
   * Los seguimientos vienen en tres bolsas y no en una sola con un color: vencido
   * ya es un problema, hoy es el trabajo, y proximo es contexto. Juntarlos obliga
   * a que la pantalla tenga que decidir el color de cada fila.
   *
   * Los nombres de cliente se resuelven con un `IN` y no con una consulta por
   * fila: con 200 seguimientos eso serian 200 idas a la base en cada carga.
   */
  router.get(
    '/api/tablero',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const hoy = hoyDe(org, db);
      const mes = hoy.slice(5, 7);

      const cond: SQL[] = [eq(followups.organizationId, org), eq(followups.status, 'pending')];
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(followups.customerId, req.query.customerId));
      }
      const pendiente = db
        .select()
        .from(followups)
        .where(and(...cond))
        .orderBy(asc(followups.dueDate))
        .limit(200)
        .all();

      // Vencido es "la fecha paso", no "la fecha paso hace mas de N dias": una
      // tarea de ayer sigue vencida hoy, y por eso se compara con `<` y no con
      // una diferencia de dias.
      const conFecha = (f: (typeof pendiente)[number]) => f.dueDate !== null;
      const vencidos = pendiente.filter((f) => conFecha(f) && f.dueDate! < hoy);
      const paraHoy = pendiente.filter((f) => f.dueDate === hoy);
      const proximos = pendiente.filter((f) => conFecha(f) && f.dueDate! > hoy);

      // Los cumpleaños del mes se buscan por el SUBSTRING del mes, no por rango de
      // fechas: un cumpleaños es un dia y un mes que se repiten cada año, y traerlo
      // como fecha de este año lo dejaria fuera entre enero y diciembre.
      const cumpleanos = db
        .select({ id: customers.id, name: customers.name, birthday: customers.birthday })
        .from(customers)
        .where(
          and(
            eq(customers.organizationId, org),
            isNull(customers.archivedAt),
            sql`substr(${customers.birthday}, 6, 2) = ${mes}`,
          ),
        )
        .orderBy(customers.birthday)
        .all();

      const contactos = db
        .select({
          id: interactions.id,
          customerId: interactions.customerId,
          kind: interactions.kind,
          summary: interactions.summary,
          happenedAt: interactions.happenedAt,
        })
        .from(interactions)
        .where(eq(interactions.organizationId, org))
        .orderBy(desc(interactions.happenedAt))
        .limit(10)
        .all();

      const ids = [
        ...new Set([
          ...[...vencidos, ...paraHoy, ...proximos].map((f) => f.customerId),
          ...contactos.map((c) => c.customerId),
        ]),
      ];
      const nombres = ids.length
        ? db
            .select({ id: customers.id, name: customers.name })
            .from(customers)
            .where(and(eq(customers.organizationId, org), inArray(customers.id, ids)))
            .all()
        : [];
      const nombreDe = (customerId: string) => nombres.find((c) => c.id === customerId)?.name ?? null;

      res.json({
        hoy,
        seguimientos: {
          vencidos: vencidos.map((f) => ({ ...f, customerName: nombreDe(f.customerId) })),
          hoy: paraHoy.map((f) => ({ ...f, customerName: nombreDe(f.customerId) })),
          proximos: proximos.map((f) => ({ ...f, customerName: nombreDe(f.customerId) })),
        },
        cumpleanos,
        contactos: contactos.map((c) => ({ ...c, customerName: nombreDe(c.customerId) })),
      });
    }),
  );

  /**
   * Los numeros de las tarjetas de arriba.
   *
   * "Este mes" son los ULTIMOS 30 DIAS de contactos, no el mes calendario: el mes
   * calendario cambia a mitad de mes y hace que el numero baje solo, sin que
   * nadie haya hecho menos. Con 30 dias la tarjeta responde "hice trabajo
   * reciente", que es lo que se quiere saber mirando un tablero.
   */
  router.get(
    '/api/resumen',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const hoy = hoyDe(org, db);

      const clientes = db
        .select({ archivado: customers.archivedAt })
        .from(customers)
        .where(eq(customers.organizationId, org))
        .all();
      const seguimientos = db
        .select({ status: followups.status, dueDate: followups.dueDate })
        .from(followups)
        .where(eq(followups.organizationId, org))
        .all();
      const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const contactos = db
        .select({ id: interactions.id })
        .from(interactions)
        .where(
          and(eq(interactions.organizationId, org), sql`${interactions.happenedAt} >= ${desde}`),
        )
        .all();

      res.json({
        total: clientes.length,
        activos: clientes.filter((c) => c.archivado === null).length,
        archivados: clientes.filter((c) => c.archivado !== null).length,
        seguimientos: {
          total: seguimientos.length,
          porEstado: Object.fromEntries(ESTADOS.map((e) => [e, seguimientos.filter((f) => f.status === e).length])),
          vencidos: seguimientos.filter((f) => f.status === 'pending' && f.dueDate !== null && f.dueDate < hoy).length,
          paraHoy: seguimientos.filter((f) => f.status === 'pending' && f.dueDate === hoy).length,
        },
        contactos30d: contactos.length,
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────────── ficha

  /**
   * La ficha completa de un cliente: sus seguimientos y su historial de contacto.
   *
   * Se declara antes del CRUD de clientes a proposito: `/api/customers/:id/ficha`
   * tiene dos segmentos y el `GET /:id` generico tiene uno, asi que no se pisan,
   * pero dejarla escrita arriba deja claro cual de las dos gana sin que haya que
   * resolverlo probando.
   */
  router.get(
    '/api/customers/:id/ficha',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idCliente = id.parse(req.params.id);
      const hoy = hoyDe(org, db);
      const cliente = clienteVisible(org, idCliente);
      // El 404 tambien tapa "es de otra organizacion": confirmar que existe le
      // diria al que prueba que ese id es real.
      if (!cliente) throw new AppError(404, 'Ese cliente no existe');

      const susSeguimientos = db
        .select()
        .from(followups)
        .where(and(eq(followups.organizationId, org), eq(followups.customerId, idCliente)))
        .orderBy(desc(followups.dueDate))
        .all();
      const suHistorial = db
        .select()
        .from(interactions)
        .where(and(eq(interactions.organizationId, org), eq(interactions.customerId, idCliente)))
        .orderBy(desc(interactions.happenedAt))
        .all();

      res.json({
        customer: cliente,
        followups: susSeguimientos,
        interactions: suHistorial,
        resumen: {
          seguimientosAbiertos: susSeguimientos.filter((f) => (PENDIENTES as string[]).includes(f.status)).length,
          seguimientosVencidos: susSeguimientos.filter(
            (f) => f.status === 'pending' && f.dueDate !== null && f.dueDate < hoy,
          ).length,
          contactos: suHistorial.length,
          ultimoContacto: suHistorial[0]?.happenedAt ?? null,
        },
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────── seguimientos

  /**
   * Los seguimientos van con router a mano y no con `crudRouter`, por dos cosas
   * que el CRUD generico no puede expresar:
   *
   *   - `completed_at` se deriva del estado, y lo pone el servidor.
   *   - `customer_id` se valida contra la organizacion antes de escribir.
   *
   * El resto si seria CRUD, pero partir el alta del resto del endpoint para que
   * el CRUD controle la edicion es peor que escribir los cinco.
   */
  router.get(
    '/api/followups',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond: SQL[] = [eq(followups.organizationId, org)];
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(followups.customerId, req.query.customerId));
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        cond.push(eq(followups.status, req.query.status));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const filas = db
        .select()
        .from(followups)
        .where(and(...cond))
        .orderBy(asc(followups.dueDate), desc(followups.createdAt))
        .limit(limite)
        .all();
      res.json({ followups: filas });
    }),
  );

  router.get(
    '/api/followups/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const fila = db
        .select()
        .from(followups)
        .where(and(eq(followups.id, id.parse(req.params.id)), eq(followups.organizationId, org)))
        .get();
      if (!fila) throw new AppError(404, 'Ese seguimiento no existe');
      res.json({ followup: fila });
    }),
  );

  /**
   * Que `completed_at` represente lo que dice decir.
   *
   * Al crear, si el seguimiento ya nace `done` (se carga algo que el legacy ya
   * habia hecho), el instante es ahora: es lo unico que se sabe.
   *
   * Al editar se guarda el valor que ya tenia si el estado no cambia, y se pone
   * el instante actual si pasa a `done`. Volver a `pending` lo limpia, porque un
   * seguimiento abierto no puede llevar la fecha de un cierre anterior.
   */
  function completedAtDe(estado: Estado, anterior: string | null): string | null {
    if (estado === 'done') return anterior ?? nowIso();
    return null;
  }

  router.post(
    '/api/followups',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = seguimientoSchema.parse(req.body);
      clienteDe(org, body.customerId);

      const creado = db
        .insert(followups)
        .values({
          id: createId('cliseg'),
          organizationId: org,
          customerId: body.customerId,
          title: body.title,
          body: body.body ?? null,
          dueDate: body.dueDate ?? null,
          status: body.status,
          completedAt: completedAtDe(body.status, null),
          createdAt: nowIso(),
        })
        .returning()
        .get();
      res.status(201).json({ followup: creado });
    }),
  );

  router.patch(
    '/api/followups/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idSeg = id.parse(req.params.id);
      const existente = db
        .select()
        .from(followups)
        .where(and(eq(followups.id, idSeg), eq(followups.organizationId, org)))
        .get();
      if (!existente) throw new AppError(404, 'Ese seguimiento no existe');

      // El PATCH parte del seguimiento que ya existe, asi que se puede mandar solo
      // el estado sin perder el resto. Un `parse` sobre el cuerpo pelado exigiria
      // mandar todos los campos siempre, y el que olvide uno se queda sin guardar
      // sin avisar.
      const body = seguimientoSchema.parse({
        customerId: existente.customerId,
        title: existente.title,
        body: existente.body,
        dueDate: existente.dueDate,
        status: existente.status,
        ...req.body,
      });
      if (body.customerId !== existente.customerId) clienteDe(org, body.customerId);

      const actualizado = db
        .update(followups)
        .set({
          customerId: body.customerId,
          title: body.title,
          body: body.body ?? null,
          dueDate: body.dueDate ?? null,
          status: body.status,
          completedAt: completedAtDe(body.status, existente.completedAt),
          updatedAt: nowIso(),
        })
        .where(and(eq(followups.id, idSeg), eq(followups.organizationId, org)))
        .returning()
        .get();
      res.json({ followup: actualizado });
    }),
  );

  /**
   * Borrar un seguimiento es una exception, no la regla.
   *
   * Un pendiente que ya no aplica casi siempre se cancela, y `canceled` queda en
   * el historial de la ficha. Borrar de verdad es para el que se creo por error,
   * y por eso es un `admin` el que lo hace.
   */
  router.delete(
    '/api/followups/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const borrado = db
        .delete(followups)
        .where(and(eq(followups.id, id.parse(req.params.id)), eq(followups.organizationId, org)))
        .returning()
        .get();
      if (!borrado) throw new AppError(404, 'Ese seguimiento no existe');
      res.json({ followup: borrado, deleted: true });
    }),
  );

  // ────────────────────────────────────────────────────────────────── contactos

  /**
   * El historial de contacto: se AGREGA y se LEE. No hay PATCH ni DELETE a
   * proposito, y no es una falta de funcionalidad.
   *
   * La fila dice "el martes llamé y no contestó". Si se puede editar en
   * silencio, el registro deja de ser la prueba de lo que pasó y pasa a ser lo
   * que alguien escribió despues de lo que pasó. Cuando la entrada esta
   * equivocada de verdad, lo correcto es agregar la correccion como un contacto
   * nuevo, que es lo que paso en la vida real.
   */
  router.get(
    '/api/interactions',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond: SQL[] = [eq(interactions.organizationId, org)];
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(interactions.customerId, req.query.customerId));
      }
      if (typeof req.query.kind === 'string' && req.query.kind) {
        cond.push(eq(interactions.kind, req.query.kind));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const filas = db
        .select()
        .from(interactions)
        .where(and(...cond))
        .orderBy(desc(interactions.happenedAt))
        .limit(limite)
        .all();
      res.json({ interactions: filas });
    }),
  );

  router.post(
    '/api/interactions',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = contactoSchema.parse(req.body);
      clienteDe(org, body.customerId);

      const creada = db
        .insert(interactions)
        .values({
          id: createId('clicont'),
          organizationId: org,
          customerId: body.customerId,
          kind: body.kind,
          summary: body.summary,
          // Sin `happenedAt` el contacto se registra ahora. Un contacto se
          // escribe mientras pasa, y anotar a mano la hora solo abre la puerta a
          // escribir la de otro dia sin querer.
          happenedAt: body.happenedAt ?? nowIso(),
          createdAt: nowIso(),
        })
        .returning()
        .get();
      res.status(201).json({ interaction: creada });
    }),
  );

  // ──────────────────────────────────────────────────────────────── preferencias

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
   * Por eso el PUT pide `admin`: si un miembro las cambiara, el "hoy" del tablero
   * de toda la gente se moveria de dia. Leer es libre; cambiar la configuracion
   * compartida no.
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

      // Se valida la zona horaria contra Intl en vez de contra una lista escrita
      // a mano: cualquier zona de la base de IANA sirve, y una lista propia
      // envejece. Una zona que el runtime no conoce se rechaza con un mensaje
      // util, no con un tablero que muestra la fecha de otro huso.
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
   * La ficha del cliente es CRUD generico, con `archive`.
   *
   * Archivar en vez de borrar es lo que hace la columna `archived_at`: dar de
   * baja un cliente no puede llevarse sus seguimientos, porque el negocio puede
   * necesitar ver que se le hizo. Los seguimientos y el historial se van con el
   * CASCADE solo si el cliente se borra de verdad, que es lo que hace el
   * `requireRole('admin')` de abajo.
   *
   * Se monta en `/api/customers` y la ficha se resolvio mas arriba.
   */
  router.use(
    '/api/customers',
    crudRouter(ctx.handle, {
      table: customers,
      idPrefix: 'clicliente',
      label: 'cliente',
      search: [customers.name, customers.company, customers.email, customers.phone, customers.taxId],
      // El selector de tipo de la pantalla manda `?kind=empresa`; sin esto el
      // filtro se ignoraba y la lista daba igual los dos tipos.
      filters: { kind: { column: customers.kind, schema: z.enum(TIPOS_CLIENTE) } },
      orderBy: customers.name,
      orderDirection: 'asc',
      archive: true,
      // Dar de baja un cliente es decision de negocio, no parte de cargarlo.
      deleteRole: 'admin',
      fields: {
        name: { schema: texto },
        company: { schema: z.string().trim().max(200).nullable().optional() },
        kind: { schema: z.enum(TIPOS_CLIENTE).default('persona') },
        email: { schema: z.union([email, z.literal(''), z.null()]).nullable().optional() },
        phone: { schema: z.string().trim().max(40).nullable().optional() },
        // Texto y no numero: el RUT, el RUC y el NIT llevan letras y guiones, y
        // castearlos a numero pierde el cero inicial.
        taxId: { schema: z.string().trim().max(32).nullable().optional() },
        address: { schema: z.string().trim().max(300).nullable().optional() },
        city: { schema: z.string().trim().max(120).nullable().optional() },
        notes: { schema: z.string().trim().max(2000).nullable().optional() },
        tags: { schema: z.string().trim().max(500).nullable().optional() },
        birthday: { schema: fecha },
        archivedAt: { readonly: true },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}
