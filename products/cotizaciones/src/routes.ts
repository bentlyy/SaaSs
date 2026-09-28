import { Router } from 'express';
import { z } from 'zod';
import { and, eq, ne, sql } from 'drizzle-orm';
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
import { quoteLines, quotes, settings } from './schema.js';

/**
 * API de cotizaciones.
 *
 * Cinco invariantes, y las cinco estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Un cliente no puede pedir los datos de otra empresa aunque adivine
 *      el id, y no puede "crear en otra" mandando `organizationId` en el JSON:
 *      el campo ni siquiera existe en el esquema de entrada.
 *
 *   2. El FOLIO es unico por organizacion. No global: cada empresa numera desde
 *      uno. Si fuera global, la segunda empresa en abrir no podria empezar.
 *
 *   3. El dinero se CALCULA aqui y se MATERIALIZA en la fila. Los importes no se
 *      recalculan al leer: una cotizacion aceptada tiene que seguir valiendo lo
 *      que valio el dia que se acepto, aunque manana cambien los precios o la
 *      tasa de impuesto.
 *
 *   4. El estado SOLO se mueve por `POST /api/quotes/:id/estado`, que ademas
 *      sella `sent_at` y `accepted_at`. Un PATCH no cambia el estado: si lo
 *      cambiara, se podria aceptar una cotizacion sin dejar rastro de cuando se
 *      acepto.
 *
 *   5. Las lineas se reemplazan enteras. Son el detalle de la cotizacion y van
 *      siempre juntas: editar una linea suelta dejaria numeros que no cuadran
 *      con el total.
 */

const texto = z.string().trim().min(1).max(150);
const email = z.string().trim().email('Correo invalido').max(200);
const id = z.string().trim().min(1).max(64);

/** Importes en centavos: enteros, con un techo de 100 millones ($1.000.000). */
const centavos = z.coerce.number().int().min(0).max(100_000_000);

/**
 * "Desde cuando" y "hasta cuando" son FECHAS, no instantes.
 *
 * Se valida el formato a mano en vez de usar `Date.parse`, porque `Date.parse`
 * acepta "2026-9-4" y tambien "42": una fecha de vigencia es lo que se le
 * promete al cliente, y tiene que ser una fecha que se pueda leer y comparar.
 * Guardarla como texto `AAAA-MM-DD` ademas evita el corrimiento de dia que
 * aparece al convertir una fecha local a UTC en un huso al oeste.
 */
const fecha = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Fecha invalida')
  .nullable()
  .optional();

/**
 * Los cinco estados de una cotizacion, en el orden en que se avanza.
 *
 * Son los del legacy (`documents.status`) y se conservan tal cual: ese flujo ya
 * lo usaba un negocio de verdad, asi que cambiarlo seria inventar una mejora que
 * nadie pidio. Lo que NO se conserva es `documents.type` (cotizacion, factura,
 * recibo, nota_venta): eso no es un estado, es el tipo de papel que se emitio.
 */
const ESTADOS = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
type Estado = (typeof ESTADOS)[number];

/**
 * A donde se puede ir desde cada estado.
 *
 * La regla que no se negocia: de `accepted` y de `rejected` NO se vuelve a
 * `draft`. Una cotizacion aceptada es un acuerdo con el cliente; volverla a
 * borrador haria que "aceptada" dejara de significar algo y que el total
 * historico quedara sin respaldo. `rejected` es terminal por la misma razon: se
 * puede cotizar OTRA vez, pero esa es una cotizacion nueva con su propio folio.
 *
 * `expired` si es una puerta de ida y vuelta: una oferta vencida se puede
 * reenviar con el mismo folio, porque el cliente ya la conoce.
 */
const TRANSICIONES: Record<Estado, Estado[]> = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: [],
  expired: ['sent'],
};

/** Linea de la cotizacion. El importe lo calcula el servidor, no el cliente. */
const lineaSchema = z.object({
  description: texto,
  qty: z.coerce.number().positive('La cantidad tiene que ser mayor que cero').max(1_000_000).default(1),
  unitPriceCents: centavos.default(0),
});

const quoteSchema = z.object({
  /** Si no viene, se propone el folio siguiente de la organizacion. */
  number: z.coerce.number().int().min(1).max(9_999_999).nullable().optional(),
  customerName: texto,
  /** Referencia suelta al producto `clientes`. No se valida: es otra base. */
  customerId: id.nullable().optional(),
  customerEmail: z.union([email, z.literal(''), z.null()]).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  status: z.enum(ESTADOS).default('draft'),
  issueDate: fecha,
  validUntil: fecha,
  /** Puntos basicos: 1600 = 16%. 10000 = 100%, que es el tope. */
  taxRateBp: z.coerce.number().int().min(0).max(10_000).default(0),
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z.array(lineaSchema).default([]),
});

/** El cuerpo del PATCH es el de la creacion, pero sin `status`. */
const quotePatchSchema = quoteSchema.omit({ status: true });

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
    defaultTaxRateBp: fila?.defaultTaxRateBp ?? 0,
    validityDays: fila?.validityDays ?? 30,
  };
}

/**
 * Cuanto va a sumar cada linea, en centavos enteros.
 *
 * `qty` puede ser fraccion (media hora, 2,5 dias), asi que el producto es float
 * y el resultado se redondea UNA vez, al centavo, con `Math.round`. Redondear
 * cada linea y no el total es lo correcto: el total es la suma de lo que se
 * mostro en cada linea, y redondear al final hacen que la suma de las lineas
 * visibles no de el total que dice el pie.
 */
function lineasConTotal(lineas: z.infer<typeof lineaSchema>[]) {
  return lineas.map((l, i) => ({
    position: i + 1,
    description: l.description,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    lineTotalCents: Math.round(l.qty * l.unitPriceCents),
  }));
}

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /**
   * El folio siguiente de una organizacion: el MAYOR que existe mas uno.
   *
   * No es "contar + 1": si se borra la ultima cotizacion, contar da un folio que
   * ya existe y choca contra el indice unico. El maximo mas uno nunca repite.
   *
   * El `handle` se pasa por parametro para que serve igual para la base y para
   * la transaccion: dentro de un PATCH el folio se resuelve sobre la misma
   * conexion en la que se escribe.
   */
  function folioSiguiente(handle: { select: (...args: any[]) => any }, org: string): number {
    const maximo = handle
      .select({ n: sql<number | null>`MAX(${quotes.number})` })
      .from(quotes)
      .where(eq(quotes.organizationId, org))
      .get();
    return (maximo?.n ?? 0) + 1;
  }

  /** Una cotizacion con sus lineas. El 404 tambien tapa "es de otra organizacion". */
  function leerQuote(org: string, idQuote: string) {
    const fila = db
      .select()
      .from(quotes)
      .where(and(eq(quotes.id, idQuote), eq(quotes.organizationId, org)))
      .get();
    if (!fila) throw new AppError(404, 'Esa cotizacion no existe');
    return fila;
  }

  function leerLineas(org: string, idQuote: string) {
    return db
      .select()
      .from(quoteLines)
      .where(and(eq(quoteLines.organizationId, org), eq(quoteLines.quoteId, idQuote)))
      .orderBy(quoteLines.position)
      .all();
  }

  // ─────────────────────────────────────────────────────────────────── tablero

  /**
   * El resumen de arriba de la pantalla: cuanto hay en cada estado y cuanto
   * dinero hay encima de la mesa.
   *
   * Las dos sumas EXCLUYEN las rechazadas, y no por redondeo: una cotizacion
   * rechazada no es una deuda ni una venta, asi que sumarla daria un numero que
   * nadie debe y que haria tomar decisiones equivocadas. Es el mismo criterio que
   * las ordenes canceladas en `solicitudes`.
   *
   * El mes se arma con `issue_date`, que es texto `AAAA-MM-DD`: se compara por
   * prefijo en UTC. Usar la zona horaria de la organizacion haria que el mismo
   * numero cambiara segun quien lo mire, y un total que depende de quien pregunta
   * no es un total.
   */
  router.get(
    '/api/dashboard',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const todas = db.select().from(quotes).where(eq(quotes.organizationId, org)).all();

      const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0])) as Record<Estado, number>;
      for (const q of todas) {
        if (q.status in porEstado) porEstado[q.status as Estado] += 1;
      }

      const vivas = todas.filter((q) => q.status !== 'rejected');
      const mes = new Date().toISOString().slice(0, 7);
      const delMes = vivas.filter((q) => (q.issueDate ?? '').startsWith(mes));

      res.json({
        total: todas.length,
        porEstado,
        totalCents: vivas.reduce((acc, q) => acc + q.totalCents, 0),
        mesCents: delMes.reduce((acc, q) => acc + q.totalCents, 0),
        mes,
      });
    }),
  );

  // ───────────────────────────────────────────────────────────────── cotizaciones
  // Las rutas de arriba de este bloque van ANTES del `crudRouter` de mas abajo a
  // proposito: Express prueba en orden de declaracion, asi que el POST, el PATCH
  // y el cambio de estado son los que atienden. El CRUD aporta el listado, la
  // lectura y el borrado, que si son CRUD simple.

  /**
   * El folio que se propone al abrir una cotizacion nueva.
   *
   * Es una PROPUESTA, no una reserva: si dos personas abren el formulario a la
   * vez, la segunda que guarde choca con un 409 y tiene que recargar. Fijar el
   * folio por adelantado en la base seria peor: dejaria huecos, y el dia que
   * alguien mire la numeracion va a preguntar por que falta la numero 14.
   */
  router.get(
    '/api/quotes/next-number',
    asyncHandler(async (req, res) => {
      res.json({ number: folioSiguiente(db, orgId(req)) });
    }),
  );

  /** Las lineas de una cotizacion, en orden. El listado del CRUD no las trae. */
  router.get(
    '/api/quotes/:id/lineas',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idQuote = id.parse(req.params.id);
      leerQuote(org, idQuote);
      res.json({ lines: leerLineas(org, idQuote) });
    }),
  );

  /**
   * El UNICO camino para cambiar el estado.
   *
   * Se separa del PATCH por dos razones concretas. Una: sella `sent_at` y
   * `accepted_at`, que son la unica forma de saber cuando se negocio cada
   * cotizacion. Dos: las transiciones se validan contra una tabla explicita, y
   * de `accepted` no se vuelve a `draft`.
   */
  router.post(
    '/api/quotes/:id/estado',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idQuote = id.parse(req.params.id);
      const { status } = z.object({ status: z.enum(ESTADOS) }).parse(req.body);

      const actual = leerQuote(org, idQuote);
      const destino = status as Estado;
      if (destino === actual.status) {
        // No es un error: el cliente puede reintentar y no hay nada que hacer.
        return res.json({ quote: actual });
      }
      // Una cotizacion migrada podria tener un estado que este producto no conoce
      // (el legacy cobro un estado nuevo). No se adivina: se dice, porque un
      // `includes` sobre `undefined` reventaria con un error de JavaScript.
      const desde = actual.status as Estado;
      if (!(desde in TRANSICIONES)) {
        throw new AppError(400, `La cotizacion esta en un estado desconocido: ${actual.status}`);
      }
      if (!TRANSICIONES[desde].includes(destino)) {
        throw new AppError(
          400,
          actual.status === 'accepted' || actual.status === 'rejected'
            ? `Una cotizacion ${actual.status} no vuelve a borrador: cotiza una nueva.`
            : `No se puede pasar de ${actual.status} a ${destino}`,
        );
      }

      const ahora = nowIso();
      const cambia = {
        status: destino,
        updatedAt: ahora,
        // El sello se escribe UNA vez: reenviar una cotizacion vencida no borra
        // la fecha en que se mando la primera vez.
        ...(destino === 'sent' ? { sentAt: actual.sentAt ?? ahora } : {}),
        ...(destino === 'accepted' ? { acceptedAt: actual.acceptedAt ?? ahora } : {}),
      };

      const actualizada = db
        .update(quotes)
        .set(cambia)
        .where(and(eq(quotes.id, idQuote), eq(quotes.organizationId, org)))
        .returning()
        .get();
      res.json({ quote: actualizada });
    }),
  );

  /**
   * `escribirQuote` DEVUELVE la cotizacion, no la envia: la usan el POST y el
   * PATCH, que se diferencian solo en el codigo de estado. El que hace
   * `res.json` es el envoltorio de abajo, porque express no mira el valor de
   * retorno de un handler: si nadie responde, la peticion queda colgada para
   * siempre.
   *
   * `status` va por parametro y NO en el cuerpo porque un PATCH no cambia el
   * estado (para eso esta `POST /api/quotes/:id/estado`) y porque una cotizacion
   * migrada puede traer un estado que este producto no conoce, que es un `string`
   * cualquiera y no uno de los cinco: pasarlo por el tipo del cuerpo obligaria a
   * mentir sobre lo que hay en la base. En el PATCH no se usa.
   */
  async function escribirQuote(
    org: string,
    body: z.infer<typeof quotePatchSchema>,
    idQuote?: string,
    status: Estado = 'draft',
  ) {
    const lineas = lineasConTotal(body.lines);
    const subtotal = lineas.reduce((acc, l) => acc + l.lineTotalCents, 0);
    // El impuesto se calcula sobre el subtotal ya redondeado, que es el numero
    // que se mostro, y con `Math.round` una sola vez.
    const tax = Math.round((subtotal * body.taxRateBp) / 10_000);
    const ahora = nowIso();

    return db.transaction((tx) => {
      const numero = body.number ?? folioSiguiente(tx, org);

      /**
       * El folio se chequea DENTRO de la transaccion, junto con el insert.
       * Comprobar antes y escribir despues deja una ventana: dos personas
       * creando una cotizacion en el mismo segundo pasan las dos el chequeo, y
       * la segunda revienta con un error de SQLite en vez de un 409 que entienda.
       */
      const choque = tx
        .select({ id: quotes.id })
        .from(quotes)
        .where(
          and(
            eq(quotes.organizationId, org),
            eq(quotes.number, numero),
            ...(idQuote ? [ne(quotes.id, idQuote)] : []),
          ),
        )
        .get();
      if (choque) {
        throw new AppError(409, `Ya existe la cotizacion numero ${numero} en esta empresa`);
      }

      const idFinal = idQuote ?? createId('cot');
      const base = {
        number: numero,
        customerName: body.customerName,
        customerId: body.customerId ?? null,
        customerEmail: body.customerEmail || null,
        title: body.title ?? null,
        issueDate: body.issueDate ?? null,
        validUntil: body.validUntil ?? null,
        taxRateBp: body.taxRateBp,
        subtotalCents: subtotal,
        taxCents: tax,
        totalCents: subtotal + tax,
        notes: body.notes ?? null,
        updatedAt: ahora,
      };

      if (idQuote) {
        const actualizada = tx
          .update(quotes)
          .set(base)
          .where(and(eq(quotes.id, idQuote), eq(quotes.organizationId, org)))
          .returning()
          .get();
        if (!actualizada) throw new AppError(404, 'Esa cotizacion no existe');
        // Las lineas se reemplazan enteras: son el detalle de la cotizacion y
        // van siempre juntas. Editar una linea suelta dejaria numeros que no
        // cuadran con el total.
        tx.delete(quoteLines).where(eq(quoteLines.quoteId, idFinal)).run();
      } else {
        // Una cotizacion creada ya en `sent` o `accepted` se sella con la hora de
        // creacion: alguien la dio por buena al escribirla, y no se va a pedir
        // que la registre a mano despues.
        const creado = {
          ...base,
          status,
          ...(status === 'sent' || status === 'accepted' || status === 'expired'
            ? { sentAt: ahora }
            : {}),
          ...(status === 'accepted' ? { acceptedAt: ahora } : {}),
        };
        tx.insert(quotes)
          .values({ id: idFinal, organizationId: org, ...creado, createdAt: ahora })
          .run();
      }

      for (const l of lineas) {
        tx.insert(quoteLines)
          .values({
            // El id deriva de la cotizacion y la posicion, no de un aleatorio: la
            // segunda pasada de una edicion no deja lineas huerfanas ni choca
            // con ids de otra cotizacion.
            id: `${idFinal}_l${l.position}`,
            organizationId: org,
            quoteId: idFinal,
            position: l.position,
            description: l.description,
            qty: l.qty,
            unitPriceCents: l.unitPriceCents,
            lineTotalCents: l.lineTotalCents,
            createdAt: ahora,
          })
          .run();
      }

      return tx.select().from(quotes).where(eq(quotes.id, idFinal)).get()!;
    });
  }

  router.post(
    '/api/quotes',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      // `z.object` descarta las claves que no conoce, asi que un
      // `organizationId` en el cuerpo no llega ni a proposito: la organizacion
      // sale del token y punto.
      const creado = quoteSchema.parse(req.body);
      const fila = await escribirQuote(org, creado, undefined, creado.status);
      res.status(201).json({ quote: fila, lines: leerLineas(org, fila.id) });
    }),
  );

  router.patch(
    '/api/quotes/:id',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const idQuote = id.parse(req.params.id);
      const existente = leerQuote(org, idQuote);

      /**
       * El PATCH parte de la cotizacion que ya existe, asi que un cliente puede
       * mandar solo el cliente y no perder el resto. Un `parse` sobre el cuerpo
       * pelado exigiria mandar todos los campos siempre, y el que olvide uno se
       * queda sin guardar sin avisar.
       *
       * `status` se saca del cuerpo A MANO. El esquema ya no lo acepta (por eso
       * el estado tiene su propia ruta), pero sin esta linea el `...req.body`
       * de abajo lo volveria a colar y el PATCH seria una segunda puerta para
       * aceptar una cotizacion sin sello.
       */
      const { status: _estadoPorPatch, ...cambios } = (req.body ?? {}) as Record<string, unknown>;
      const body = quotePatchSchema.parse({
        number: existente.number,
        customerName: existente.customerName,
        customerId: existente.customerId,
        customerEmail: existente.customerEmail,
        title: existente.title,
        issueDate: existente.issueDate,
        validUntil: existente.validUntil,
        taxRateBp: existente.taxRateBp,
        notes: existente.notes,
        // Si el cuerpo no trae `lines`, se conservan las que hay. Si trae
        // `lines: []`, se borran todas: sacar la ultima linea tiene que dejar la
        // cotizacion en cero, no con el total viejo.
        lines: leerLineas(org, existente.id).map((l) => ({
          description: l.description,
          qty: l.qty,
          unitPriceCents: l.unitPriceCents,
        })),
        ...cambios,
      });

      const actualizada = await escribirQuote(org, body, existente.id);
      res.json({ quote: actualizada, lines: leerLineas(org, actualizada.id) });
    }),
  );

  // ────────────────────────────────────────────────────────────── preferencias

  router.get(
    '/api/settings',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const pref = leerPreferencias(db, org);
      // Se manda tambien el folio que se propondría, aunque la cotizacion nueva
      // lo pida por su cuenta: la UI lo muestra como propuesta y no lo fija.
      res.json({ settings: { ...pref, nextNumber: folioSiguiente(db, org) } });
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
          defaultTaxRateBp: z.coerce.number().int().min(0).max(10_000).default(0),
          validityDays: z.coerce.number().int().min(1).max(3_650).default(30),
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
          .values({ id: `cfg_${org}`, organizationId: org, ...cuerpo, createdAt: nowIso() })
          .run();
      }
      res.json({ settings: leerPreferencias(db, org) });
    }),
  );

  // ───────────────────────────────────────────────────────── listado y borrado

  /**
   * Listado, lectura y borrado de cotizaciones: el CRUD generico.
   *
   * Se monta en `/api/quotes`, asi que el prefijo va en el `use`. El POST y el
   * PATCH propios, de mas arriba, atienden esas dos rutas y por eso el CRUD no
   * aporta escritura para esta tabla: los importes, el estado y los sellos
   * quedan de solo lectura en la declaracion de campos, para que ninguna via
   * generica pueda escribir dinero.
   *
   * La busqueda cubre el nombre del cliente (que es un snapshot, asi que
   * encuentra tambien las cotizaciones de clientes que ya no estan dados de
   * alta), el titulo y el folio. En SQLite, `LIKE` sobre una columna INTEGER
   * convierte a texto, asi que buscar por folio funciona.
   */
  router.use(
    '/api/quotes',
    crudRouter(ctx.handle, {
      table: quotes,
      idPrefix: 'cot',
      label: 'cotizacion',
      search: [quotes.customerName, quotes.title, quotes.number],
      orderBy: quotes.number,
      orderDirection: 'desc',
      fields: {
        customerName: { schema: texto },
        customerId: { schema: id.nullable().optional() },
        customerEmail: { schema: z.union([email, z.literal(''), z.null()]).nullable().optional() },
        title: { schema: z.string().trim().max(200).nullable().optional() },
        issueDate: { schema: fecha },
        validUntil: { schema: fecha },
        notes: { schema: z.string().trim().max(2000).nullable().optional() },
        // El folio, los importes, la tasa, el estado y los sellos NO se escriben
        // por aca: los calcula y sella el servidor, en las rutas de mas arriba.
        number: { readonly: true },
        organizationId: { readonly: true },
        status: { readonly: true },
        taxRateBp: { readonly: true },
        subtotalCents: { readonly: true },
        taxCents: { readonly: true },
        totalCents: { readonly: true },
        sentAt: { readonly: true },
        acceptedAt: { readonly: true },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}
