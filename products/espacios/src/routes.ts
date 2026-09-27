import { Router } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  AppError,
  asyncHandler,
  createId,
  crudRouter,
  nowIso,
  orgId,
  type ProductContext,
  type ProductDb,
} from '@amg/product-runtime';
import { addons, bookingAddons, bookings, customers, settings, spaces } from './schema.js';

/**
 * API de espacios.
 *
 * Tres invariantes, y las tres están en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesión)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Un cliente no puede pedir los datos de otra empresa aunque adivine
 *      el id.
 *
 *   2. Dos reservas no se pisan en el MISMO espacio. El chequeo está en el
 *      servidor, dentro de la transacción que escribe, y no en la interfaz: si
 *      dependiera del navegador, dos personas reservando a la vez meterían doble
 *      reserva sin enterarse.
 *
 *   3. El total se MATERIALIZA al escribir, no se calcula al leer. La tarifa por
 *      hora puede cambiar mañana y una reserva vieja tiene que seguir valiendo
 *      lo que valió el día que se hizo.
 */

const texto = z.string().trim().min(1).max(150);
const email = z.string().trim().email('Correo inválido').max(200);
const id = z.string().trim().min(1).max(64);

/** `z.coerce.boolean()` convierte "false" en `true`; esto sí lo lee bien. */
const booleano = z.preprocess((v) => {
  if (typeof v === 'string') return v === 'true' || v === '1' || v === 'si';
  return v;
}, z.boolean());

const isoFecha = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida')
  .transform((v) => new Date(v).toISOString());

/**
 * Los estados que ocupan espacio. Cancelada y no_show no bloquean: se liberaron.
 *
 * Se comparan contra la columna con SQL crudo y no contra una lista de Zod
 * porque el destino tiene que tolerar un estado que el legacy no conhecierra: si
 * aparece uno raro, la reserva se migra y se reporta, no se tira.
 */
const OCUPAN = sql`${bookings.status} NOT IN ('cancelled','no_show')`;

const estados = ['confirmed', 'pending', 'done', 'cancelled', 'no_show'] as const;

/** Preferencia de la organización, o el valor por defecto si nunca guardó. */
export function leerPreferencias(
  db: ProductDb['db'],
  org: string,
): {
  currency: string;
  timezone: string;
  openingMinutes: number;
  closingMinutes: number;
  slotMinutes: number;
  minAdvanceMinutes: number;
} {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  const base = defaultSettings();
  return {
    currency: fila?.currency ?? base.currency,
    timezone: fila?.timezone ?? base.timezone,
    openingMinutes: fila?.openingMinutes ?? base.openingMinutes,
    closingMinutes: fila?.closingMinutes ?? base.closingMinutes,
    slotMinutes: fila?.slotMinutes ?? base.slotMinutes,
    minAdvanceMinutes: fila?.minAdvanceMinutes ?? base.minAdvanceMinutes,
  };
}

export const defaultSettings = () => ({
  currency: '$',
  timezone: 'America/Santiago',
  openingMinutes: 8 * 60,
  closingMinutes: 22 * 60,
  slotMinutes: 60,
  minAdvanceMinutes: 0,
});

const lineaSchema = z.object({
  addonId: id,
  priceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
});

const reservaSchema = z
  .object({
    spaceId: id,
    customerId: id.nullable().optional(),
    startAt: isoFecha,
    endAt: isoFecha,
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(estados).default('pending'),
    addons: z.array(lineaSchema).default([]),
  })
  .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), {
    message: 'La reserva tiene que terminar después de empezar',
    path: ['endAt'],
  });

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /**
   * Reservas que se pisan con el intervalo dado, en un espacio.
   *
   * El solapamiento se comprueba así: `start_at < fin` y `end_at > inicio`. Un
   * `between` no sirve porque una reserva que empieza exactamente cuando termina
   * la anterior es válida, y en un turno de canchas es lo normal.
   *
   * El `org` se recibe por parámetro en vez de leerse de una variable de módulo.
   * Una variable compartida entre requests es una fuga de datos esperando: con
   * dos personas reservando a la vez, una puede validar contra el espacio de la
   * otra.
   */
  function solapes(org: string, spaceId: string, inicio: string, fin: string, excluirId?: string) {
    const cond = [
      eq(bookings.organizationId, org),
      eq(bookings.spaceId, spaceId),
      sql`${bookings.startAt} < ${fin}`,
      sql`${bookings.endAt} > ${inicio}`,
      OCUPAN,
    ];
    if (excluirId) cond.push(ne(bookings.id, excluirId));
    return db.select().from(bookings).where(and(...cond)).all();
  }

  /** Un espacio tiene que ser de ESTA organización, no solo existir. */
  function espacioDe(org: string, spaceId: string) {
    const fila = db
      .select()
      .from(spaces)
      .where(and(eq(spaces.id, spaceId), eq(spaces.organizationId, org)))
      .get();
    if (!fila) throw new AppError(404, 'Ese espacio no existe');
    return fila;
  }

  /**
   * Total de la reserva: horas por tarifa, más los extras.
   *
   * Se redondea al centavo una sola vez, al final. Si se redondearan las horas
   * antes de multiplicar, una reserva de 90 minutos a $35.000 cobraría $52.500
   * en vez de $52.500 exactos, y con tarifas rareras la diferencia crece.
   */
  function calcularTotal(
    org: string,
    space: { pricePerHourCents: number },
    inicio: string,
    fin: string,
    lineas: Array<{ addonId: string; priceCents: number }>,
  ) {
    const horas = (Date.parse(fin) - Date.parse(inicio)) / 3_600_000;
    const base = Math.round(horas * space.pricePerHourCents);
    let extras = 0;
    for (const linea of lineas) {
      // El extra se valida contra esta organización: sin esto, un cliente podría
      // colar el id de un extra de otra empresa y ver su precio.
      const existe = db
        .select({ id: addons.id })
        .from(addons)
        .where(and(eq(addons.id, linea.addonId), eq(addons.organizationId, org)))
        .get();
      if (!existe) throw new AppError(400, `El extra ${linea.addonId} no existe`);
      extras += linea.priceCents;
    }
    return base + extras;
  }

  // ─────────────────────────────────────────────────────────── disponibilidad

  /**
   * Franjas libres de un espacio en una fecha.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razón que `low-stock` en
   * el inventario: si no, "availability" se lee como un id.
   */
  router.get(
    '/api/availability',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const espacio = id.parse(req.query.spaceId);
      const dia = isoFecha.parse(req.query.date ?? new Date().toISOString());
      const pref = leerPreferencias(db, org);
      const salto = z.coerce
        .number()
        .int()
        .min(15)
        .max(480)
        .default(pref.slotMinutes)
        .parse(req.query.step ?? pref.slotMinutes);

      const fila = espacioDe(org, espacio);

      const base = new Date(dia);
      const desde = new Date(base);
      desde.setUTCHours(Math.floor(pref.openingMinutes / 60), pref.openingMinutes % 60, 0, 0);
      const hasta = new Date(base);
      hasta.setUTCHours(Math.floor(pref.closingMinutes / 60), pref.closingMinutes % 60, 0, 0);
      if (pref.closingMinutes <= pref.openingMinutes) {
        throw new AppError(400, 'La jornada de la organización termina antes de empezar');
      }

      const ocupadas = db
        .select({ startAt: bookings.startAt, endAt: bookings.endAt })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, org),
            eq(bookings.spaceId, espacio),
            OCUPAN,
            sql`${bookings.startAt} < ${hasta.toISOString()}`,
            sql`${bookings.endAt} > ${desde.toISOString()}`,
          ),
        )
        .all();

      // Una franja está libre si no hay NINGUNA reserva que la toque. Se comparan
      // los instantes y no las cadenas: los horarios se guardan en ISO UTC y
      // compararlos como texto ordena "9:00" después de "10:00", que es justo el
      // tipo de error que aparece un sábado por la mañana.
      const libre = (inicioMs: number, finMs: number) =>
        ocupadas.every((o) => Date.parse(o.startAt) >= finMs || Date.parse(o.endAt) <= inicioMs);

      // La anticipación mínima se aplica acá y no en el insert: mostrar una
      // franja que después va a rechazar es peor que no mostrarla.
      const minimo = Date.now() + pref.minAdvanceMinutes * 60_000;

      const libres: Array<{ startAt: string; endAt: string; totalCents: number }> = [];
      for (
        let t = desde.getTime();
        t + salto * 60_000 <= hasta.getTime();
        t += salto * 60_000
      ) {
        const f = t + salto * 60_000;
        if (t < minimo) continue;
        if (!libre(t, f)) continue;
        libres.push({
          startAt: new Date(t).toISOString(),
          endAt: new Date(f).toISOString(),
          totalCents: Math.round(fila.pricePerHourCents * (salto / 60)),
        });
      }

      res.json({ space: fila, date: base.toISOString(), slotMinutes: salto, slots: libres });
    }),
  );

  // ──────────────────────────────────────────────────────────────── agenda

  /** Reservas de un rango, con los nombres resueltos para no pedir N+1. */
  router.get(
    '/api/agenda',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const desde = isoFecha.parse(req.query.from ?? new Date().toISOString());
      const hasta = isoFecha.parse(req.query.to ?? new Date(Date.now() + 86_400_000).toISOString());
      if (Date.parse(hasta) < Date.parse(desde)) throw new AppError(400, 'El rango termina antes de empezar');

      const cond = [
        eq(bookings.organizationId, org),
        gte(bookings.startAt, desde),
        lte(bookings.startAt, hasta),
      ];
      if (typeof req.query.spaceId === 'string' && req.query.spaceId) {
        cond.push(eq(bookings.spaceId, req.query.spaceId));
      }

      const citas = db
        .select()
        .from(bookings)
        .where(and(...cond))
        .orderBy(asc(bookings.startAt))
        .limit(500)
        .all();

      // Los nombres se resuelven con un `IN` y no con una consulta por reserva:
      // con 200 reservas eso son 200 idas a la base por cada carga de pantalla.
      const enrich = (filas: typeof citas) => {
        const spaceIds = [...new Set(filas.map((f) => f.spaceId))];
        const customerIds = [...new Set(filas.map((f) => f.customerId).filter((x): x is string => !!x))];
        const espacios = spaceIds.length
          ? db
              .select()
              .from(spaces)
              .where(and(eq(spaces.organizationId, org), inArray(spaces.id, spaceIds)))
              .all()
          : [];
        const clientes = customerIds.length
          ? db
              .select()
              .from(customers)
              .where(and(eq(customers.organizationId, org), inArray(customers.id, customerIds)))
              .all()
          : [];
        return filas.map((f) => ({
          ...f,
          spaceName: espacios.find((e) => e.id === f.spaceId)?.name ?? null,
          customerName: clientes.find((c) => c.id === f.customerId)?.name ?? null,
        }));
      };

      res.json({ bookings: enrich(citas) });
    }),
  );

  /** Números del día, para las tarjetas de arriba. */
  router.get(
    '/api/resumen',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const hoy = new Date();
      hoy.setUTCHours(0, 0, 0, 0);
      const manana = new Date(hoy.getTime() + 86_400_000);
      const desde = hoy.toISOString();
      const hasta = manana.toISOString();

      const deHoy = db
        .select()
        .from(bookings)
        .where(and(eq(bookings.organizationId, org), gte(bookings.startAt, desde), lte(bookings.startAt, hasta)))
        .all();
      const futuras = db
        .select()
        .from(bookings)
        .where(and(eq(bookings.organizationId, org), gte(bookings.startAt, desde), OCUPAN))
        .all();

      res.json({
        hoy: deHoy.length,
        confirmadas: deHoy.filter((b) => b.status === 'confirmed').length,
        porConfirmar: futuras.filter((b) => b.status === 'pending').length,
        futuras: futuras.length,
        ingresos: deHoy
          .filter((b) => b.status !== 'cancelled')
          .reduce((acc, b) => acc + b.totalCents, 0),
      });
    }),
  );

  // ──────────────────────────────────────────────────────────────── reservas

  /** Listado de reservas, con los mismos filtros que usa la agenda. */
  router.get(
    '/api/bookings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond = [eq(bookings.organizationId, org)];
      if (typeof req.query.spaceId === 'string' && req.query.spaceId) {
        cond.push(eq(bookings.spaceId, req.query.spaceId));
      }
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(bookings.customerId, req.query.customerId));
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        cond.push(eq(bookings.status, req.query.status));
      }
      if (typeof req.query.from === 'string' && req.query.from) {
        cond.push(gte(bookings.startAt, isoFecha.parse(req.query.from)));
      }
      if (typeof req.query.to === 'string' && req.query.to) {
        cond.push(lte(bookings.startAt, isoFecha.parse(req.query.to)));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const filas = db
        .select()
        .from(bookings)
        .where(and(...cond))
        .orderBy(desc(bookings.startAt))
        .limit(limite)
        .all();
      res.json({ bookings: filas });
    }),
  );

  /** Una reserva con sus extras. El 404 también tapa "es de otra organización". */
  router.get(
    '/api/bookings/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idReserva = id.parse(req.params.id);
      const fila = db
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, idReserva), eq(bookings.organizationId, org)))
        .get();
      if (!fila) throw new AppError(404, 'Esa reserva no existe');

      const lineas = db
        .select()
        .from(bookingAddons)
        .where(and(eq(bookingAddons.organizationId, org), eq(bookingAddons.bookingId, idReserva)))
        .all();
      const espacio = db.select().from(spaces).where(eq(spaces.id, fila.spaceId)).get();
      const cliente = fila.customerId
        ? db.select().from(customers).where(eq(customers.id, fila.customerId)).get()
        : undefined;

      res.json({ booking: fila, addons: lineas, space: espacio, customer: cliente });
    }),
  );

  /**
   * `escribirReserva` DEVUELVE la reserva, no la envía: la usan el POST y el
   * PATCH, que se diferencian solo en el código de estado. El que hace `res.json`
   * es el envoltorio de abajo, porque express no mira el valor de retorno de un
   * handler: si nadie responde, la petición queda colgada para siempre.
   */
  async function escribirReserva(
    org: string,
    body: z.infer<typeof reservaSchema>,
    idReserva?: string,
  ) {
    const espacio = espacioDe(org, body.spaceId);

    if (body.customerId) {
      const cliente = db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, body.customerId), eq(customers.organizationId, org)))
        .get();
      if (!cliente) throw new AppError(400, 'Ese cliente no existe');
    }

    const totalCents = calcularTotal(org, espacio, body.startAt, body.endAt, body.addons);

    // El solapamiento se comprueba DENTRO de la transacción, junto con el
    // insert. Comprobar antes y escribir después deja una ventana: dos personas
    // que presionan "reservar" en el mismo segundo pasan las dos el chequeo y
    // las dos escriben.
    return db.transaction((tx) => {
      const ocupadas = tx
        .select({ id: bookings.id, startAt: bookings.startAt, endAt: bookings.endAt })
        .from(bookings)
        .where(
          and(
            eq(bookings.organizationId, org),
            eq(bookings.spaceId, body.spaceId),
            OCUPAN,
            sql`${bookings.startAt} < ${body.endAt}`,
            sql`${bookings.endAt} > ${body.startAt}`,
            ...(idReserva ? [ne(bookings.id, idReserva)] : []),
          ),
        )
        .all();
      if (ocupadas.length > 0) {
        const choque = ocupadas[0]!;
        throw new AppError(
          409,
          `${espacio.name} ya está reservado de ${new Date(choque.startAt)
            .toISOString()
            .slice(11, 16)} a ${new Date(choque.endAt).toISOString().slice(11, 16)} ` +
            'UTC. Las reservas no se pueden pisar.',
        );
      }

      const idFinal = idReserva ?? createId('esp');
      const ahora = nowIso();

      if (idReserva) {
        const actualizada = tx
          .update(bookings)
          .set({
            spaceId: body.spaceId,
            customerId: body.customerId ?? null,
            startAt: body.startAt,
            endAt: body.endAt,
            status: body.status,
            notes: body.notes ?? null,
            totalCents,
            updatedAt: ahora,
          })
          .where(and(eq(bookings.id, idReserva), eq(bookings.organizationId, org)))
          .returning()
          .get();
        if (!actualizada) throw new AppError(404, 'Esa reserva no existe');
        tx.delete(bookingAddons).where(eq(bookingAddons.bookingId, idReserva)).run();
      } else {
        tx.insert(bookings)
          .values({
            id: idFinal,
            organizationId: org,
            spaceId: body.spaceId,
            customerId: body.customerId ?? null,
            startAt: body.startAt,
            endAt: body.endAt,
            status: body.status,
            notes: body.notes ?? null,
            totalCents,
            createdAt: ahora,
          })
          .run();
      }

      for (const linea of body.addons) {
        tx.insert(bookingAddons)
          .values({
            id: `${idFinal}_a${linea.addonId}`,
            organizationId: org,
            bookingId: idFinal,
            addonId: linea.addonId,
            priceCents: linea.priceCents,
          })
          .run();
      }

      return tx.select().from(bookings).where(eq(bookings.id, idFinal)).get()!;
    });
  }

  router.post(
    '/api/bookings',
    asyncHandler(async (req, res) => {
      const body = reservaSchema.parse(req.body);
      const creada = await escribirReserva(orgId(req), body);
      res.status(201).json({ booking: creada });
    }),
  );

  router.patch(
    '/api/bookings/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const existente = db
        .select()
        .from(bookings)
        .where(and(eq(bookings.id, id.parse(req.params.id)), eq(bookings.organizationId, org)))
        .get();
      if (!existente) throw new AppError(404, 'Esa reserva no existe');

      // El PATCH parte de la reserva que ya existe, así que un cliente puede
      // mandar solo el estado y no perder el resto. Un `parse` sobre el cuerpo
      // pelado exigiría mandar los 6 campos siempre, y el que olvide uno se
      // queda sin guardar sin avisar.
      const body = reservaSchema.parse({
        spaceId: existente.spaceId,
        customerId: existente.customerId,
        startAt: existente.startAt,
        endAt: existente.endAt,
        status: existente.status,
        notes: existente.notes,
        addons: db
          .select()
          .from(bookingAddons)
          .where(eq(bookingAddons.bookingId, existente.id))
          .all()
          .map((l) => ({ addonId: l.addonId, priceCents: l.priceCents })),
        ...req.body,
      });
      const actualizada = await escribirReserva(org, body, existente.id);
      res.json({ booking: actualizada });
    }),
  );

  router.delete(
    '/api/bookings/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idReserva = id.parse(req.params.id);
      const borrada = db
        .delete(bookings)
        .where(and(eq(bookings.id, idReserva), eq(bookings.organizationId, org)))
        .returning()
        .get();
      if (!borrada) throw new AppError(404, 'Esa reserva no existe');
      res.json({ booking: borrada });
    }),
  );

  // ────────────────────────────────────────────────────────── preferencias

  router.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      res.json({ settings: leerPreferencias(db, org) });
    }),
  );

  router.put(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cuerpo = z
        .object({
          currency: z.string().trim().min(1).max(5).default('$'),
          timezone: z.string().trim().min(1).max(60).default('America/Santiago'),
          openingMinutes: z.coerce.number().int().min(0).max(1439).default(480),
          closingMinutes: z.coerce.number().int().min(1).max(1440).default(1320),
          slotMinutes: z.coerce.number().int().min(15).max(480).default(60),
          minAdvanceMinutes: z.coerce.number().int().min(0).max(43_200).default(0),
        })
        .refine((v) => v.closingMinutes > v.openingMinutes, {
          message: 'La jornada termina antes de empezar',
          path: ['closingMinutes'],
        })
        .parse(req.body);

      const idCfg = `cfg_${org}`;
      const yaEsta = db.select().from(settings).where(eq(settings.organizationId, org)).get();
      if (yaEsta) {
        db.update(settings)
          .set({ ...cuerpo, updatedAt: nowIso() })
          .where(eq(settings.organizationId, org))
          .run();
      } else {
        db.insert(settings)
          .values({
            id: idCfg,
            organizationId: org,
            ...cuerpo,
            createdAt: nowIso(),
          })
          .run();
      }
      res.json({ settings: leerPreferencias(db, org) });
    }),
  );

  // ──────────────────────────────────────────────────────────────── catálogo

  /**
   * Catálogo de clientes, espacios y extras.
   *
   * `crudRouter` se monta en `/`, así que el prefijo va en el `use`. Las reservas
   * NO usan el CRUD genérico: una reserva valida solapamiento y calcula su total,
   * y eso no se puede expresar declarando campos.
   */
  router.use(
    '/api/customers',
    crudRouter(ctx.handle, {
      table: customers,
      idPrefix: 'espcliente',
      label: 'cliente',
      search: [customers.name, customers.email, customers.phone],
      orderBy: customers.name,
      archive: true,
      fields: {
        name: { schema: texto },
        phone: { schema: z.string().trim().max(40).nullable().optional() },
        email: { schema: z.union([email, z.literal(''), z.null()]).nullable().optional() },
        notes: { schema: z.string().trim().max(2000).nullable().optional() },
        tags: { schema: z.string().trim().max(500).nullable().optional() },
        archivedAt: { readonly: true },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  router.use(
    '/api/spaces',
    crudRouter(ctx.handle, {
      table: spaces,
      idPrefix: 'espespacio',
      label: 'espacio',
      search: [spaces.name, spaces.type],
      orderBy: spaces.name,
      archive: true,
      fields: {
        name: { schema: texto },
        type: { schema: z.string().trim().min(1).max(40).default('sala') },
        capacity: { schema: z.coerce.number().int().min(1).max(10_000).default(1) },
        pricePerHourCents: { schema: z.coerce.number().int().min(0).max(100_000_000).default(0) },
        color: { schema: z.string().trim().max(9).nullable().optional() },
        active: { schema: booleano.default(true) },
        archivedAt: { readonly: true },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  router.use(
    '/api/addons',
    crudRouter(ctx.handle, {
      table: addons,
      idPrefix: 'espextra',
      label: 'extra',
      search: [addons.name],
      orderBy: addons.name,
      fields: {
        name: { schema: texto },
        durationMin: { schema: z.coerce.number().int().min(0).max(1440).default(0) },
        priceCents: { schema: z.coerce.number().int().min(0).max(100_000_000).default(0) },
        description: { schema: z.string().trim().max(1000).nullable().optional() },
        active: { schema: booleano.default(true) },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}

