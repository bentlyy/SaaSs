import { Router, type Request } from 'express';
import { z } from 'zod';
import { and, asc, count, desc, eq, gte, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  AppError,
  asyncHandler,
  createId,
  crudRouter,
  nowIso,
  orgId,
  requireRole,
  type ProductContext,
} from '@amg/product-runtime';
import {
  appointmentServices,
  appointments,
  customers,
  reminders,
  services,
  settings,
  staff,
  staffServices,
} from './schema.js';

/**
 * API de citas.
 *
 * Dos invariantes, y las dos están en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesión)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Un cliente no puede pedir los datos de otra empresa aunque adivine
 *      el id.
 *
 *   2. Una cita no se solapa con otra del mismo profesional. El chequeo está en
 *      el servidor, en la misma transacción que el insert, y no en la interfaz:
 *      si dependiera del navegador, dos personas agendando a la vez meterían
 *      doble reserva sin enterarse.
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

const estadosCita = ['confirmed', 'pending', 'done', 'cancelled', 'no_show'] as const;

const lineaSchema = z.object({
  serviceId: id.nullable().optional(),
  serviceName: texto.optional(),
  priceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
});

const citaSchema = z
  .object({
    customerId: id.nullable().optional(),
    staffId: id.nullable().optional(),
    startAt: isoFecha,
    endAt: isoFecha,
    notes: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(estadosCita).default('confirmed'),
    /** Líneas de la cita. Si viene vacío se calculates con los servicios. */
    services: z.array(lineaSchema).default([]),
  })
  .refine((v) => Date.parse(v.endAt) > Date.parse(v.startAt), {
    message: 'La cita tiene que terminar después de empezar',
    path: ['endAt'],
  });

/** Preferencias por defecto: lo que se usa si la organización no guardó nada. */
export const defaultSettings = () => ({
  timezone: 'America/Santiago',
  currency: '$',
  reminderHours: 12,
  emailEnabled: false,
});

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /**
   * Citas de un profesional que se pisan con el intervalo dado.
   *
   * El solapamiento se comprueba así: `start_at < fin` y `end_at > inicio`. Un
   * `between` no sirve porque una cita que empieza exactamente cuando termina la
   * anterior es válida y tiene que poder agendarse.
   *
   * Cancelada y no_asistido no bloquean: no ocupan agenda, se cancelaron.
   *
   * El `org` se recibe por parámetro en vez de leerse de una variable de módulo.
   * Una variable compartida entre requests es una fuga de datos esperando: con
   * dos personas agendando a la vez, una puede validar contra la empresa de la
   * otra.
   */
  function solapes(org: string, inicio: string, fin: string, staffId: string, excluirId?: string) {
    const cond = [
      eq(appointments.organizationId, org),
      eq(appointments.staffId, staffId),
      sql`${appointments.startAt} < ${fin}`,
      sql`${appointments.endAt} > ${inicio}`,
      sql`${appointments.status} NOT IN ('cancelled','no_show')`,
    ];
    if (excluirId) cond.push(ne(appointments.id, excluirId));
    return db.select().from(appointments).where(and(...cond)).all();
  }

  // ─────────────────────────────────────────────────────────── disponibilidad

  /**
   * Huecos libres de un profesional en una fecha.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razón que `low-stock`
   * en el inventario: si no, "availability" se lee como un id.
   */
  router.get(
    '/api/availability',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const profesional = id.parse(req.query.staffId);
      const dia = isoFecha.parse(req.query.date ?? new Date().toISOString());
      // La jornada se pide en minutos desde medianoche, que es como la
      // entiende quien configura: "abro a las 9:30". Se separa en horas y
      // minutos después, para no perder el medio.
      const jornadaDesde = z.coerce.number().int().min(0).max(1440).default(9 * 60).parse(req.query.from ?? 540);
      const jornadaHasta = z.coerce.number().int().min(1).max(1440).default(20 * 60).parse(req.query.until ?? 1200);
      if (jornadaHasta <= jornadaDesde) throw new AppError(400, 'La jornada termina antes de empezar');
      const salto = z.coerce.number().int().min(5).max(240).default(15).parse(req.query.step ?? 15);

      const profesionalRow = db.select().from(staff).where(and(eq(staff.id, profesional), eq(staff.organizationId, org))).get();
      if (!profesionalRow) throw new AppError(404, 'No existe ese profesional');

      // Servicios que hace este profesional: sin esto, "disponible" sería una
      // respuesta sin sentido porque no se sabe cuánto dura lo que se quiere agendar.
      const serviciosDel = db
        .select({ id: services.id, name: services.name, durationMin: services.durationMin })
        .from(staffServices)
        .innerJoin(services, eq(services.id, staffServices.serviceId))
        .where(and(eq(staffServices.organizationId, org), eq(staffServices.staffId, profesional)))
        .all();
      if (serviciosDel.length === 0) {
        throw new AppError(400, 'Este profesional no tiene servicios asignados: no hay nada que agendar');
      }

      const base = new Date(dia);
      // La jornada se pide en minutos desde medianoche, que es como la
      // entiende quien configura: "abro a las 9:30". Se separa en horas y
      // minutos para no perder los :30.
      const desde = new Date(base);
      desde.setUTCHours(0, Math.floor(jornadaDesde / 60), jornadaDesde % 60, 0);
      const hasta = new Date(base);
      hasta.setUTCHours(0, Math.floor(jornadaHasta / 60), jornadaHasta % 60, 0);

      const duracion = Math.max(...serviciosDel.map((s) => s.durationMin));
      const ocupadas = db
        .select({ startAt: appointments.startAt, endAt: appointments.endAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.organizationId, org),
            eq(appointments.staffId, profesional),
            sql`${appointments.status} NOT IN ('cancelled','no_show')`,
            sql`${appointments.startAt} < ${hasta.toISOString()}`,
            sql`${appointments.endAt} > ${desde.toISOString()}`,
          ),
        )
        .all();

      const huecos: Array<{ startAt: string; endAt: string }> = [];
      for (let t = desde.getTime(); t + duracion * 60_000 <= hasta.getTime(); t += salto * 60_000) {
        const ini = new Date(t).toISOString();
        const fin = new Date(t + duracion * 60_000).toISOString();
        const choca = ocupadas.some((o) => o.startAt < fin && o.endAt > ini);
        if (!choca) huecos.push({ startAt: ini, endAt: fin });
      }

      res.json({
        staff: { id: profesionalRow.id, name: profesionalRow.name },
        services: serviciosDel,
        slots: huecos,
      });
    }),
  );

  // ────────────────────────────────────────────────────────────────── agenda

  /** La agenda: citas de la organización en una franja de fechas. */
  router.get(
    '/api/agenda',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const desde = isoFecha.parse(req.query.from ?? new Date(Date.now() - 86_400_000).toISOString());
      const hasta = isoFecha.parse(req.query.to ?? new Date(Date.now() + 7 * 86_400_000).toISOString());
      if (Date.parse(hasta) <= Date.parse(desde)) throw new AppError(400, 'El rango de fechas está al revés');

      const cond = [
        eq(appointments.organizationId, org),
        gte(appointments.startAt, desde),
        lte(appointments.startAt, hasta),
      ];
      if (typeof req.query.staffId === 'string' && req.query.staffId) {
        cond.push(eq(appointments.staffId, req.query.staffId));
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        cond.push(eq(appointments.status, req.query.status));
      }

      const citas = db.select().from(appointments).where(and(...cond)).orderBy(asc(appointments.startAt)).all();

      // Los nombres salen de una consulta por tabla, no de un join por cita: con
      // veinte citas son tres queries y sale más barato que el join repetido.
      const idsCliente = [...new Set(citas.map((c) => c.customerId).filter(Boolean))] as string[];
      const idsPro = [...new Set(citas.map((c) => c.staffId).filter(Boolean))] as string[];
      const nombres = new Map<string, string>();
      for (const c of idsCliente.length
        ? db.select().from(customers).where(inArray(customers.id, idsCliente)).all()
        : []) {
        nombres.set(c.id, c.name);
      }
      for (const p of idsPro.length ? db.select().from(staff).where(inArray(staff.id, idsPro)).all() : []) {
        nombres.set(p.id, p.name);
      }

      res.json({
        appointments: citas.map((c) => ({
          ...c,
          customerName: c.customerId ? nombres.get(c.customerId) ?? null : null,
          staffName: c.staffId ? nombres.get(c.staffId) ?? null : null,
        })),
      });
    }),
  );

  /** Resumen para la portada. */
  router.get(
    '/api/resumen',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const hoy = new Date();
      hoy.setUTCHours(0, 0, 0, 0);
      const manana = new Date(hoy.getTime() + 86_400_000);

      const [agendadas] = db
        .select({ n: count() })
        .from(appointments)
        .where(and(eq(appointments.organizationId, org), gte(appointments.startAt, hoy.toISOString())))
        .all();
      const [hoyCount] = db
        .select({ n: count() })
        .from(appointments)
        .where(
          and(
            eq(appointments.organizationId, org),
            gte(appointments.startAt, hoy.toISOString()),
            lte(appointments.startAt, manana.toISOString()),
          ),
        )
        .all();
      const [pendientesAviso] = db
        .select({ n: count() })
        .from(appointments)
        .where(and(eq(appointments.organizationId, org), eq(appointments.status, 'confirmed')))
        .all();

      res.json({ futuras: agendadas?.n ?? 0, hoy: hoyCount?.n ?? 0, porConfirmar: pendientesAviso?.n ?? 0 });
    }),
  );

  // ──────────────────────────────────────────────────────── crear y editar

  const escribirCita = (req: Request) => {
    const org = orgId(req);
    const cuerpo = citaSchema.parse(req.body);
    const idCita = req.method === 'POST' ? createId('cita') : id.parse(req.params.id);

    if (cuerpo.staffId) {
      const pro = db
        .select({ id: staff.id })
        .from(staff)
        .where(and(eq(staff.id, cuerpo.staffId), eq(staff.organizationId, org)))
        .get();
      if (!pro) throw new AppError(400, 'Ese profesional no es de tu organización');
    }
    if (cuerpo.customerId) {
      const cli = db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.id, cuerpo.customerId), eq(customers.organizationId, org)))
        .get();
      if (!cli) throw new AppError(400, 'Ese cliente no es de tu organización');
    }

    // El total sale de las líneas. Si no vienen líneas, se usan los precios
    // actuales de los servicios indicados; y si tampoco, queda en 0 y no se
    // inventa un número.
    const lineas = cuerpo.services.length
      ? cuerpo.services
      : [];
    const totalCents = lineas.reduce((s, l) => s + l.priceCents, 0);

    const choca = cuerpo.staffId
      ? solapes(org, cuerpo.startAt, cuerpo.endAt, cuerpo.staffId, req.method === 'PATCH' ? idCita : undefined)
      : [];
    if (choca.length) {
      throw new AppError(
        409,
        `Ese profesional ya tiene una cita de ${choca[0].startAt} a ${choca[0].endAt}. ` +
          'Las citas no se pueden pisar.',
      );
    }

    const ahora = nowIso();
    if (req.method === 'POST') {
      db.insert(appointments)
        .values({
          id: idCita,
          organizationId: org,
          customerId: cuerpo.customerId ?? null,
          staffId: cuerpo.staffId ?? null,
          startAt: cuerpo.startAt,
          endAt: cuerpo.endAt,
          notes: cuerpo.notes ?? null,
          status: cuerpo.status,
          totalCents,
          createdAt: ahora,
        })
        .run();
    } else {
      const existe = db
        .select({ id: appointments.id })
        .from(appointments)
        .where(and(eq(appointments.id, idCita), eq(appointments.organizationId, org)))
        .get();
      if (!existe) throw new AppError(404, 'Esa cita no existe');
      db.update(appointments)
        .set({
          customerId: cuerpo.customerId ?? null,
          staffId: cuerpo.staffId ?? null,
          startAt: cuerpo.startAt,
          endAt: cuerpo.endAt,
          notes: cuerpo.notes ?? null,
          status: cuerpo.status,
          totalCents,
          updatedAt: ahora,
        })
        .where(eq(appointments.id, idCita))
        .run();
      // Las líneas se reemplazan enteras: son la foto del precio de esa cita.
      db.delete(appointmentServices).where(eq(appointmentServices.appointmentId, idCita)).run();
    }

    for (const l of lineas) {
      db.insert(appointmentServices)
        .values({
          id: createId('citaslin'),
          organizationId: org,
          appointmentId: idCita,
          serviceId: l.serviceId ?? null,
          serviceName: l.serviceName ?? null,
          priceCents: l.priceCents,
        })
        .run();
    }

    return db.select().from(appointments).where(eq(appointments.id, idCita)).get();
  };

  /**
   * Listado de citas.
   *
   * Va antes que `/:id` por la misma razón que `availability`: si el detalle
   * se montara primero, el id "low-stock" se leería como un id. Acá los dos
   * filtros que se usan de verdad: por profesional y por rango de fechas.
   */
  router.get(
    '/api/appointments',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond = [eq(appointments.organizationId, org)];
      if (typeof req.query.staffId === 'string' && req.query.staffId) {
        cond.push(eq(appointments.staffId, req.query.staffId));
      }
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(appointments.customerId, req.query.customerId));
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        cond.push(eq(appointments.status, req.query.status));
      }
      if (typeof req.query.from === 'string' && req.query.from) {
        cond.push(gte(appointments.startAt, isoFecha.parse(req.query.from)));
      }
      if (typeof req.query.to === 'string' && req.query.to) {
        cond.push(lte(appointments.startAt, isoFecha.parse(req.query.to)));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const citas = db
        .select()
        .from(appointments)
        .where(and(...cond))
        .orderBy(desc(appointments.startAt))
        .limit(limite)
        .all();
      res.json({ appointments: citas });
    }),
  );

  /** Una cita con sus líneas. El 404 también tapa "es de otra organización". */
  router.get(
    '/api/appointments/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idCita = id.parse(req.params.id);
      const cita = db
        .select()
        .from(appointments)
        .where(and(eq(appointments.id, idCita), eq(appointments.organizationId, org)))
        .get();
      if (!cita) throw new AppError(404, 'Esa cita no existe');

      const lineas = db
        .select()
        .from(appointmentServices)
        .where(and(eq(appointmentServices.organizationId, org), eq(appointmentServices.appointmentId, idCita)))
        .all();
      const avisos = db
        .select()
        .from(reminders)
        .where(and(eq(reminders.organizationId, org), eq(reminders.appointmentId, idCita)))
        .all();

      const cliente = cita.customerId
        ? db.select().from(customers).where(eq(customers.id, cita.customerId)).get()
        : undefined;
      const profesional = cita.staffId
        ? db.select().from(staff).where(eq(staff.id, cita.staffId)).get()
        : undefined;

      res.json({ appointment: cita, services: lineas, reminders: avisos, customer: cliente, staff: profesional });
    }),
  );

  /**
   * `escribirCita` DEVUELVE la cita, no la envía: la usan el POST y el PATCH, que
   * se diferencian solo en el código de estado. El que hace `res.json` es el
   * envoltorio de abajo, porque express no mira el valor de retorno de un
   * handler: si nadie responde, la petición queda colgada para siempre.
   */
  const guardarCita = asyncHandler(async (req, res) => {
    const esNuevo = req.method === 'POST';
    const cita = escribirCita(req);
    res.status(esNuevo ? 201 : 200).json(cita);
  });

  router.post('/api/appointments', requireRole('member'), guardarCita);
  router.patch('/api/appointments/:id', requireRole('member'), guardarCita);

  // ─────────────────────────────────────────────────────── líneas y avisos

  router.get(
    '/api/appointments/:id/servicios',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idCita = id.parse(req.params.id);
      const lineas = db
        .select()
        .from(appointmentServices)
        .where(and(eq(appointmentServices.organizationId, org), eq(appointmentServices.appointmentId, idCita)))
        .all();
      res.json({ services: lineas, totalCents: lineas.reduce((s, l) => s + l.priceCents, 0) });
    }),
  );

  /**
   * Avisos ya enviados.
   *
   * Es una bitácora de INTENTOS: un aviso fallido y su reintento son dos filas de
   * la misma cita, y por eso la tabla no tiene índice único. Lo que evita el
   * correo duplicado es no mandar cuando el último intento de esa cita y canal ya
   * salió bien, y eso lo decide el que despacha, no un índice.
   */
  router.get(
    '/api/reminders',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond = [eq(reminders.organizationId, org)];
      if (typeof req.query.appointmentId === 'string' && req.query.appointmentId) {
        cond.push(eq(reminders.appointmentId, req.query.appointmentId));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const filas = db
        .select()
        .from(reminders)
        .where(and(...cond))
        .orderBy(sql`${reminders.sentAt} DESC NULLS LAST, ${reminders.createdAt} DESC`)
        .limit(limite)
        .all();
      res.json({ reminders: filas });
    }),
  );

  /** Un aviso se puede volver a marcar como enviado: reintento. */
  router.post(
    '/api/reminders/:id/retry',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idAviso = id.parse(req.params.id);
      const aviso = db
        .select()
        .from(reminders)
        .where(and(eq(reminders.id, idAviso), eq(reminders.organizationId, org)))
        .get();
      if (!aviso) throw new AppError(404, 'Ese aviso no existe');
      if (aviso.status === 'sent') throw new AppError(409, 'Ese aviso ya se envió: no hay nada que reintentar');

      db.update(reminders)
        .set({ status: 'sent', sentAt: nowIso(), error: null })
        .where(eq(reminders.id, idAviso))
        .run();
      res.json({ reminder: db.select().from(reminders).where(eq(reminders.id, idAviso)).get() });
    }),
  );

  // ──────────────────────────────────────────────────────────── preferencias

  router.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
      res.json({ settings: fila ?? { organizationId: org, ...defaultSettings() } });
    }),
  );

  router.put(
    '/api/settings',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cuerpo = z
        .object({
          timezone: z.string().trim().min(1).max(64),
          currency: z.string().trim().min(1).max(5),
          reminderHours: z.coerce.number().int().min(0).max(720),
          emailEnabled: booleano,
        })
        .parse(req.body);

      const existente = db.select().from(settings).where(eq(settings.organizationId, org)).get();
      if (existente) {
        db.update(settings).set({ ...cuerpo, updatedAt: nowIso() }).where(eq(settings.id, existente.id)).run();
      } else {
        db.insert(settings)
          .values({ id: createId('citascfg'), organizationId: org, ...cuerpo, createdAt: nowIso() })
          .run();
      }
      res.json({ settings: db.select().from(settings).where(eq(settings.organizationId, org)).get() });
    }),
  );

  // ──────────────────────────────────────────────────────────────────── CRUD

  /**
   * Catálogo de clientes, servicios y profesionales.
   *
   * `crudRouter` se monta en `/`, así que el prefijo va en el `use`. Las citas y
   * los avisos NO usan el CRUD genérico: la cita valida solapamiento y calcula
   * su total, y eso no se puede expresar declarando campos.
   */
  router.use(
    '/api/customers',
    crudRouter(ctx.handle, {
      table: customers,
      idPrefix: 'cicliente',
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
    '/api/services',
    crudRouter(ctx.handle, {
      table: services,
      idPrefix: 'citaserv',
      label: 'servicio',
      search: [services.name],
      orderBy: services.name,
      fields: {
        name: { schema: texto },
        durationMin: { schema: z.coerce.number().int().min(5).max(1440).default(30) },
        priceCents: { schema: z.coerce.number().int().min(0).max(100_000_000).default(0) },
        description: { schema: z.string().trim().max(1000).nullable().optional() },
        active: { schema: booleano.default(true) },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  router.use(
    '/api/staff',
    crudRouter(ctx.handle, {
      table: staff,
      idPrefix: 'citapero',
      label: 'profesional',
      search: [staff.name, staff.email],
      orderBy: staff.name,
      fields: {
        name: { schema: texto },
        phone: { schema: z.string().trim().max(40).nullable().optional() },
        email: { schema: z.union([email, z.literal(''), z.null()]).nullable().optional() },
        color: { schema: z.string().trim().max(9).nullable().optional() },
        active: { schema: booleano.default(true) },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}
