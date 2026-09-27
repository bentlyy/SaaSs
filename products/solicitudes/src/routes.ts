import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
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
import {
  customers,
  legacyTenantMap,
  orderParts,
  orderServices,
  orders,
  services,
  settings,
  technicians,
} from './schema.js';

/**
 * API de solicitudes y ordenes.
 *
 * Cuatro invariantes, y las cuatro estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Un cliente no puede pedir los datos de otra empresa aunque adivine
 *      el id.
 *
 *   2. El FOLIO es unico por organizacion. No global: cada empresa numera desde
 *      uno. Si fuera global, la segunda empresa en abrir no podria empezar.
 *
 *   3. Cada linea apunta a algo de ESTA organizacion. Sin esto, un cliente
 *      podria colar el id de un trabajo de otra empresa y ver su precio. Los
 *      repuestos se validan distinto porque viven en otra base: ahi no se puede
 *      validar nada, y por eso el nombre viaja congelado en la linea.
 *
 *   4. El total se MATERIALIZA al escribir, no se calcula al leer. El precio de
 *      un repuesto o de una hora de mano de obra cambia manana, y una orden ya
 *      cerrada tiene que seguir valiendo lo que valio el dia que se pacto.
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
 * Los estados de una orden, en el orden en que se avanza.
 *
 * Son los cinco del legacy de talleres, y se conservan tal cual: ese flujo ya
 * lo usaba un negocio de verdad, asi que cambiarlo seria inventar una mejora.
 * `done` y `cancelled` son terminales: no cuentan como trabajo abierto.
 */
const ESTADOS = ['received', 'estimated', 'in_progress', 'done', 'cancelled'] as const;
type Estado = (typeof ESTADOS)[number];

/** Estados en los que una orden sigue pendiente de algo. */
const ABIERTOS: Estado[] = ['received', 'estimated', 'in_progress'];

/**
 * "Para cuando" es una FECHA, no un instante.
 *
 * Se valida el formato a mano en vez de usar `Date.parse`, porque `Date.parse`
 * acepta "2026-9-4" y "septiembre de 2026" y tambien "42": una fecha de entrega
 * es lo que el cliente prometio, y tiene que ser una fecha que se pueda leer y
 * comparar. Guardarla como texto `YYYY-MM-DD` ademas evita el corrimiento de dia
 * que aparece al convertir una fecha local a UTC en un huso al oeste.
 */
const fechaEntrega = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de entrega va como AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha invalida')
  .nullable()
  .optional();

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
    nextNumber: fila?.nextNumber ?? 1,
  };
}

/**
 * Linea de trabajo: un trabajo del catalogo y lo que se pacto por el.
 *
 * `priceCents` es opcional a proposito. Si viene, es lo pactado y manda sobre el
 * precio del catalogo; si no viene, se usa la tarifa vigente. Asi una orden nueva
 * se arma sin tener que escribir a mano el precio de cada linea.
 */
const lineaTrabajoSchema = z.object({
  serviceId: id,
  priceCents: z.coerce.number().int().min(0).max(100_000_000).optional(),
});

/**
 * Linea de repuesto.
 *
 * `itemName` es obligatorio porque el repuesto vive en otra base: si no se
 * manda, la linea queda con un id que no se puede leer ni aqui ni desde esta
 * pantalla, y una orden hay que poder leerla sin abrir otro producto.
 */
const lineaRepuestoSchema = z.object({
  itemId: id,
  itemName: texto,
  qty: z.coerce.number().int().min(1).max(10_000).default(1),
  unitPriceCents: z.coerce.number().int().min(0).max(100_000_000).default(0),
});

const ordenSchema = z.object({
  /** Si no viene, se propone el folio siguiente de la organizacion. */
  number: z.coerce.number().int().min(1).max(9_999_999).nullable().optional(),
  customerId: id.nullable().optional(),
  technicianId: id.nullable().optional(),
  asset: z.string().trim().max(200).nullable().optional(),
  status: z.enum(ESTADOS).default('received'),
  estimatedDelivery: fechaEntrega,
  notes: z.string().trim().max(2000).nullable().optional(),
  services: z.array(lineaTrabajoSchema).default([]),
  parts: z.array(lineaRepuestoSchema).default([]),
});

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /** Un cliente tiene que ser de ESTA organizacion, no solo existir. */
  function clienteDe(org: string, customerId: string) {
    const fila = db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.organizationId, org)))
      .get();
    if (!fila) throw new AppError(400, 'Ese cliente no existe');
  }

  /** Un tecnico tiene que ser de ESTA organizacion, no solo existir. */
  function tecnicoDe(org: string, technicianId: string) {
    const fila = db
      .select({ id: technicians.id })
      .from(technicians)
      .where(and(eq(technicians.id, technicianId), eq(technicians.organizationId, org)))
      .get();
    if (!fila) throw new AppError(400, 'Ese tecnico no existe');
  }

  /**
   * Trabajo del catalogo, o la tarifa vigente si la linea no trae precio.
   *
   * Se valida que sea de esta organizacion: sin eso, un cliente podria mandar el
   * id de un trabajo de otra empresa y enterarse de cuanto cobra.
   */
  function trabajoDe(org: string, serviceId: string) {
    const fila = db
      .select()
      .from(services)
      .where(and(eq(services.id, serviceId), eq(services.organizationId, org)))
      .get();
    if (!fila) throw new AppError(400, `El trabajo ${serviceId} no existe`);
    return fila;
  }

  /**
   * Total de la orden: trabajo pactado mas repuestos.
   *
   * El total se MATERIALIZA porque las tarifas cambian. Y se calcula una sola vez,
   * al escribir: si se calculara al leer, cambiar el precio de un repuesto
   * reescribiria el total de ordenes viejas.
   */
  function calcularTotal(
    org: string,
    lineas: Array<{ serviceId: string; priceCents?: number }>,
    partes: Array<{ qty: number; unitPriceCents: number }>,
  ) {
    let total = 0;
    for (const linea of lineas) {
      const trabajo = trabajoDe(org, linea.serviceId);
      total += linea.priceCents ?? trabajo.priceCents;
    }
    for (const parte of partes) {
      total += parte.qty * parte.unitPriceCents;
    }
    return total;
  }

  // ───────────────────────────────────────────────────────────────── tablero

  /**
   * Las ordenes agrupadas por estado: la pantalla principal.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razon que
   * `low-stock` en el inventario: si no, "tablero" se lee como un id.
   *
   * Los nombres de cliente y tecnico se resuelven con un `IN` y no con una
   * consulta por orden: con 200 ordenes eso serian 200 idas a la base por cada
   * carga de pantalla.
   */
  router.get(
    '/api/tablero',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond = [eq(orders.organizationId, org)];
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(orders.customerId, req.query.customerId));
      }
      if (typeof req.query.technicianId === 'string' && req.query.technicianId) {
        cond.push(eq(orders.technicianId, req.query.technicianId));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 200, 1), 500);

      const filas = db
        .select()
        .from(orders)
        .where(and(...cond))
        .orderBy(desc(orders.number))
        .limit(limite)
        .all();

      const clienteIds = [...new Set(filas.map((f) => f.customerId).filter((x): x is string => !!x))];
      const tecnicoIds = [
        ...new Set(filas.map((f) => f.technicianId).filter((x): x is string => !!x)),
      ];
      const clientes = clienteIds.length
        ? db
            .select()
            .from(customers)
            .where(and(eq(customers.organizationId, org), inArray(customers.id, clienteIds)))
            .all()
        : [];
      const tecnicos = tecnicoIds.length
        ? db
            .select()
            .from(technicians)
            .where(and(eq(technicians.organizationId, org), inArray(technicians.id, tecnicoIds)))
            .all()
        : [];

      const ordenadas = filas.map((f) => ({
        ...f,
        customerName: clientes.find((c) => c.id === f.customerId)?.name ?? null,
        technicianName: tecnicos.find((t) => t.id === f.technicianId)?.name ?? null,
      }));

      // Un tablero por estado. Se arman TODOS los estados, aunque algunos no
      // tengan ordenes: una columna que aparece y desaparece segun los datos
      // hace que la pantalla "salte" mientras se trabaja.
      const columnas = ESTADOS.map((estado) => ({
        estado,
        ordenes: ordenadas.filter((o) => o.status === estado),
      }));

      res.json({ columnas, total: ordenadas.length });
    }),
  );

  /** Numeros del mes, para las tarjetas de arriba. */
  router.get(
    '/api/resumen',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const todas = db.select().from(orders).where(eq(orders.organizationId, org)).all();
      const porEstado = (e: string) => todas.filter((o) => o.status === e).length;

        // El trabajo abierto es lo que falta por entregar. Una orden cancelada no
        // cuenta: no se va a entregar, y sumarla como si fuera deuda daria un
        // numero que nadie debe.
      const abiertas = todas.filter((o) => (ABIERTOS as string[]).includes(o.status));

      res.json({
        total: todas.length,
        porEstado: Object.fromEntries(ESTADOS.map((e) => [e, porEstado(e)])),
        abiertas: abiertas.length,
        // Lo que falta por cobrar: solo lo que se hizo o se empezo.
        porCobrarCents: abiertas.reduce((acc, o) => acc + o.totalCents, 0),
        entregadoCents: todas
          .filter((o) => o.status === 'done')
          .reduce((acc, o) => acc + o.totalCents, 0),
      });
    }),
  );

  // ───────────────────────────────────────────────────────────────── ordenes

  /** Listado de ordenes, con los mismos filtros que el tablero. */
  router.get(
    '/api/orders',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cond = [eq(orders.organizationId, org)];
      if (typeof req.query.status === 'string' && req.query.status) {
        cond.push(eq(orders.status, req.query.status));
      }
      if (typeof req.query.customerId === 'string' && req.query.customerId) {
        cond.push(eq(orders.customerId, req.query.customerId));
      }
      if (typeof req.query.technicianId === 'string' && req.query.technicianId) {
        cond.push(eq(orders.technicianId, req.query.technicianId));
      }
      const limite = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
      const filas = db
        .select()
        .from(orders)
        .where(and(...cond))
        .orderBy(desc(orders.number))
        .limit(limite)
        .all();
      res.json({ orders: filas });
    }),
  );

  /** Una orden con sus lineas. El 404 tambien tapa "es de otra organizacion". */
  router.get(
    '/api/orders/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idOrden = id.parse(req.params.id);
      const fila = db
        .select()
        .from(orders)
        .where(and(eq(orders.id, idOrden), eq(orders.organizationId, org)))
        .get();
      if (!fila) throw new AppError(404, 'Esa orden no existe');

      const trabajos = db
        .select()
        .from(orderServices)
        .where(and(eq(orderServices.organizationId, org), eq(orderServices.orderId, idOrden)))
        .all();
      const partes = db
        .select()
        .from(orderParts)
        .where(and(eq(orderParts.organizationId, org), eq(orderParts.orderId, idOrden)))
        .all();
      const cliente = fila.customerId
        ? db
            .select()
            .from(customers)
            .where(and(eq(customers.id, fila.customerId), eq(customers.organizationId, org)))
            .get()
        : undefined;
      const tecnico = fila.technicianId
        ? db
            .select()
            .from(technicians)
            .where(and(eq(technicians.id, fila.technicianId), eq(technicians.organizationId, org)))
            .get()
        : undefined;

      res.json({ order: fila, services: trabajos, parts: partes, customer: cliente, technician: tecnico });
    }),
  );

  /**
   * El folio siguiente de una organizacion.
   *
   * Se calcula como el MAYOR folio que existe mas uno, y no como "contar + 1":
   * si se cancela una orden, contar da un numero que ya existe y choca contra el
   * indice unico. El maximo mas uno nunca repite.
   */
  function folioSiguiente(org: string) {
    const maximo = db
      .select({ n: sql<number | null>`MAX(${orders.number})` })
      .from(orders)
      .where(eq(orders.organizationId, org))
      .get();
    return (maximo?.n ?? 0) + 1;
  }

  /**
   * `escribirOrden` DEVUELVE la orden, no la envia: la usan el POST y el PATCH,
   * que se diferencian solo en el codigo de estado. El que hace `res.json` es el
   * envoltorio de abajo, porque express no mira el valor de retorno de un
   * handler: si nadie responde, la peticion queda colgada para siempre.
   */
  async function escribirOrden(org: string, body: z.infer<typeof ordenSchema>, idOrden?: string) {
    if (body.customerId) clienteDe(org, body.customerId);
    if (body.technicianId) tecnicoDe(org, body.technicianId);

    const totalCents = calcularTotal(org, body.services, body.parts);
    const ahora = nowIso();

    return db.transaction((tx) => {
      const numero = body.number ?? folioSiguiente(org);

      /**
       * El folio se chequea DENTRO de la transaccion, junto con el insert.
       * Comprobar antes y escribir despues deja una ventana: dos personas
       * creando una orden en el mismo segundo pasan las dos el chequeo, y la
       * segunda revienta con un error de SQLite en vez de un 409 que entienda.
       */
      const choque = tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.organizationId, org),
            eq(orders.number, numero),
            ...(idOrden ? [ne(orders.id, idOrden)] : []),
          ),
        )
        .get();
      if (choque) {
        throw new AppError(409, `Ya existe la orden numero ${numero} en esta empresa`);
      }

      const idFinal = idOrden ?? createId('sol');
      const base = {
        number: numero,
        customerId: body.customerId ?? null,
        technicianId: body.technicianId ?? null,
        asset: body.asset ?? null,
        status: body.status,
        estimatedDelivery: body.estimatedDelivery ?? null,
        notes: body.notes ?? null,
        totalCents,
        updatedAt: ahora,
      };

      if (idOrden) {
        const actualizada = tx
          .update(orders)
          .set(base)
          .where(and(eq(orders.id, idOrden), eq(orders.organizationId, org)))
          .returning()
          .get();
        if (!actualizada) throw new AppError(404, 'Esa orden no existe');
        // Las lineas se reemplazan enteras: son el detalle de la orden y van
        // siempre juntas. Editar una linea suelta dejaria numeros que no
        // cuadran con el total.
        tx.delete(orderServices).where(eq(orderServices.orderId, idOrden)).run();
        tx.delete(orderParts).where(eq(orderParts.orderId, idOrden)).run();
      } else {
        tx.insert(orders)
          .values({ id: idFinal, organizationId: org, ...base, createdAt: ahora })
          .run();
      }

      for (const [i, linea] of body.services.entries()) {
        const trabajo = trabajoDe(org, linea.serviceId);
        tx.insert(orderServices)
          .values({
            // El id deriva de la orden y la posicion, no de un aleatorio: la
            // segunda pasada de una edicion no deja lineas huerfanas ni choca
            // con ids de otra orden.
            id: `${idFinal}_s${i + 1}`,
            organizationId: org,
            orderId: idFinal,
            serviceId: linea.serviceId,
            priceCents: linea.priceCents ?? trabajo.priceCents,
          })
          .run();
      }

      for (const [i, parte] of body.parts.entries()) {
        tx.insert(orderParts)
          .values({
            id: `${idFinal}_p${i + 1}`,
            organizationId: org,
            orderId: idFinal,
            itemId: parte.itemId,
            itemName: parte.itemName,
            qty: parte.qty,
            unitPriceCents: parte.unitPriceCents,
          })
          .run();
      }

      return tx.select().from(orders).where(eq(orders.id, idFinal)).get()!;
    });
  }

  router.post(
    '/api/orders',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const creada = await escribirOrden(org, ordenSchema.parse(req.body));
      res.status(201).json({ order: creada });
    }),
  );

  router.patch(
    '/api/orders/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idOrden = id.parse(req.params.id);
      const existente = db
        .select()
        .from(orders)
        .where(and(eq(orders.id, idOrden), eq(orders.organizationId, org)))
        .get();
      if (!existente) throw new AppError(404, 'Esa orden no existe');

      // El PATCH parte de la orden que ya existe, asi que un cliente puede
      // mandar solo el estado y no perder el resto. Un `parse` sobre el cuerpo
      // pelado exigiria mandar todos los campos siempre, y el que olvide uno se
      // queda sin guardar sin avisar.
      const body = ordenSchema.parse({
        number: existente.number,
        customerId: existente.customerId,
        technicianId: existente.technicianId,
        asset: existente.asset,
        status: existente.status,
        estimatedDelivery: existente.estimatedDelivery,
        notes: existente.notes,
        services: db
          .select()
          .from(orderServices)
          .where(eq(orderServices.orderId, existente.id))
          .all()
          .map((l) => ({ serviceId: l.serviceId, priceCents: l.priceCents })),
        parts: db
          .select()
          .from(orderParts)
          .where(eq(orderParts.orderId, existente.id))
          .all()
          .map((p) => ({
            itemId: p.itemId,
            itemName: p.itemName,
            qty: p.qty,
            unitPriceCents: p.unitPriceCents,
          })),
        ...req.body,
      });
      const actualizada = await escribirOrden(org, body, existente.id);
      res.json({ order: actualizada });
    }),
  );

  router.delete(
    '/api/orders/:id',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idOrden = id.parse(req.params.id);
      // Las lineas se van con la orden: el DDL las declara con ON DELETE
      // CASCADE, asi que no hay que borrarlas a mano. Una orden sin lineas no
      // tiene sentido, y dejarlas huerfanas seria consultar basura.
      const borrada = db
        .delete(orders)
        .where(and(eq(orders.id, idOrden), eq(orders.organizationId, org)))
        .returning()
        .get();
      if (!borrada) throw new AppError(404, 'Esa orden no existe');
      res.json({ order: borrada });
    }),
  );

  // ────────────────────────────────────────────────────────────── preferencias

  router.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const pref = leerPreferencias(db, org);
      // Se manda tambien el folio que se propondría. La UI lo muestra como
      // propuesta y no lo fija: la organizacion puede tener su propia numeracion.
      res.json({ settings: { ...pref, nextNumber: folioSiguiente(org) } });
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
          nextNumber: z.coerce.number().int().min(1).max(9_999_999).default(1),
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
          .values({ id: idCfg, organizationId: org, ...cuerpo, createdAt: nowIso() })
          .run();
      }
      res.json({ settings: leerPreferencias(db, org) });
    }),
  );

  // ────────────────────────────────────────────────────────────────── catalogo

  /**
   * Catalogo de clientes, trabajos y tecnicos.
   *
   * `crudRouter` se monta en `/`, asi que el prefijo va en el `use`. Las ordenes
   * NO usan el CRUD generico: validan folio, ownership de las lineas y calculan
   * el total, y eso no se puede expresar declarando campos.
   */
  router.use(
    '/api/customers',
    crudRouter(ctx.handle, {
      table: customers,
      idPrefix: 'solcliente',
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
      idPrefix: 'soltrabajo',
      label: 'trabajo',
      search: [services.name, services.description],
      orderBy: services.name,
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

  router.use(
    '/api/technicians',
    crudRouter(ctx.handle, {
      table: technicians,
      idPrefix: 'soltecnico',
      label: 'tecnico',
      search: [technicians.name],
      orderBy: technicians.name,
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
