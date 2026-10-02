import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq, gte, lt, lte, ne, sql } from 'drizzle-orm';
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
import {
  chargePayments,
  chargeRefunds,
  charges,
  settings,
  ESTADOS_CARGO,
  type EstadoCargo,
} from './schema.js';

/**
 * API de control de pagos: la cartera por cobrar de la empresa.
 *
 * LO QUE ESTE PRODUCTO ES
 *
 * Lo que la empresa le tiene que COBRAR a SUS CLIENTES: cargos, cuentas por
 * cobrar y abonos recibidos.
 *
 * LO QUE NO ES, Y POR QUE IMPORTA
 *
 * NO es lo que la empresa le paga a AMG por la suscripcion. Eso lo cobra el
 * Core en su propia tabla `payments`, en `core.sqlite`. Aca los abonos se llaman
 * `charge_payments` a proposito: dos pagos que se dicen igual, en dos bases
 * distintas, y la unica defensa es que no compartan nombre. Ver la cabecera de
 * `schema.ts` y `docs/DATA_ISOLATION.md`.
 *
 * Las invariantes, y las cinco estan en este archivo:
 *
 *   1. Toda consulta lleva `eq(organization_id, la de la sesion)`. Viene de
 *      `orgId(req)`, que lee la identidad del Core, nunca del cuerpo ni de un
 *      query. Una empresa no puede pedir los datos de otra aunque adivine el id.
 *
 *   2. EL SALDO NO ESTA EN UNA COLUMNA. `amount_cents` es el total pactado y lo
 *      cobrado se deriva sumando `charge_payments`. No existe `paid_cents`: una
 *      columna de cobrado se desincroniza de los abonos en el primer abono que se
 *      registre a mano, y a partir de ahi la cartera muestra un numero que nadie
 *      sabe de donde sale.
 *
 *   3. Un abono NO puede dejar el saldo en negativo, y el chequeo va DENTRO de la
 *      transaccion que escribe el abono. Comprobar antes deja una ventana: dos
 *      personas cobrando el mismo cargo en el mismo segundo pasan las dos el
 *      chequeo, y la segunda revienta con un error de SQLite en vez de un 409 que
 *      la pantalla entienda. Con el chequeo adentro, la segunda recibe 409 y NO
 *      queda escrito ni el abono ni el cambio de estado.
 *
 *   4. El `status` se RECALCULA desde el saldo, y solo desde el saldo. Nunca se
 *      escribe a mano por la API: si el PATCH lo aceptara, quedarian cargos
 *      "pagados" sin un centimo cobrado. La unica excepcion es `canceled`, que es
 *      una DECISION y no un hecho de caja, y por eso tiene su propio endpoint: no
 *      se recalcula y no lo deshace un abono.
 *
 *   5. Cancelar un cargo con plata cobrada es 409. Cancelar significa "esto no se
 *      va a cobrar", no "se borro la historia": si ya entro dinero, primero hay
 *      que devolverlo, y eso es otro documento con su propia razon social.
 *
 *   6. Por la misma razon, BORRAR un cargo con plata cobrada tambien es 409. Antes
 *      el CASCADE del DGL se lo llevaba en silencio y un admin podia deshacer con
 *      un clic el registro de lo que la empresa recibio. Un cargo con abonos se
 *      cancela; solo se borra el que no tiene un centimo cobrado.
 *
 * ESTE producto NO tiene fuente legacy: no hay datos de cartera en ningun producto
 * viejo. Por eso no hay `migrate-legacy.ts` ni `legacy_tenant_map` que mapear. Un
 * migrador sin datos de los que leer es fiction.
 *
 * El dinero aparece UNA vez, en `amount_cents` de cada tabla, y siempre en
 * centavos enteros. La columna, la API y la pantalla hablan la misma unidad de
 * punta a punta: no hay `* 100` en ningun lado, porque convertir dos veces es como
 * se rompieron los precios del legacy.
 */

const texto = z.string().trim().min(1).max(150);
const id = z.string().trim().min(1).max(64);
const email = z.string().trim().email('Correo invalido').max(200);

/**
 * `AAAA-MM-DD`, con el CALENDARIO validado y no solo la forma.
 *
 * El `regex` descarta `27-09-2026` y `2026/09/27`, y el `refine` descarta
 * `2026-02-31`: `Date.parse` no lanza con esa fecha, la correje a `2 de marzo` en
 * silencio, asi que un cargo con vencimiento el 31 de febrero se guardaria
 * vencido desde el dia 2. Como la fecha es texto (`AAAA-MM-DD`), el `Date.parse`
 * va con un `T00:00:00Z` pegado: asi se interpreta en UTC y no en la zona de la
 * maquina que este corriendo el test, que haria fallar el mismo codigo en
 * Santiago y en Madrid.
 */
const dia = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')
  .refine((v) => {
    // Se vuelve a armar la fecha y se comprueba que no haya cambiado: eso
    // descarta `2026-02-31` y `2026-13-01`, que `Date.parse` normaliza en silencio
    // en vez de fallar.
    const [anio, mes, diaNum] = v.split('-').map(Number);
    const fecha = new Date(Date.UTC(anio, mes - 1, diaNum));
    return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === diaNum;
  }, 'Fecha invalida: ese dia no existe en el calendario');

/** Un instante ISO: un abono importa la hora, porque ya ocurrio. */
const instante = z
  .string()
  .trim()
  .refine(
    (v) => !Number.isNaN(Date.parse(v)),
    'Instante invalido: va como ISO, por ejemplo 2026-09-27T15:00:00.000Z',
  );

/**
 * Montos en CENTAVOS enteros y positivos.
 *
 * `z.coerce.number()` acepta el `"45055"` que manda un formulario y el `45055`
 * que manda otro cliente, y el `Math.round` deja un entero: una cartera que
 * guarde `45055.4` tiene un valor que no es un centimo, y al sumarlo con otros la
 * diferencia aparece en el total que nadie puede explicar. Se redondea UNA vez,
 * al escribir; para leer no hace falta, porque lo que se guardo ya es entero.
 *
 * El `> 0` va DESPUES del redondeo y no antes, y es a proposito: si se validara
 * antes, un `-0.4` pasaria el chequeo de positivo, se redondearia a `0` en el
 * borde y llegaria al `CHECK (amount_cents > 0)` del DDL, que responde 500 en vez
 * de un 400 que la pantalla sabe mostrar. Un abono de cero o negativo dejaria la
 * cartera al reves, asi que no es un caso que se pueda relajar.
 */
const centavos = z
  .coerce
  .number()
  .finite('El monto tiene que ser un numero')
  .max(100_000_000_000)
  .transform((v) => Math.round(v))
  .refine((v) => Number.isSafeInteger(v), 'El monto tiene que ser un numero entero de centavos')
  .refine((v) => v > 0, 'El monto tiene que ser mayor que cero: un abono de cero o negativo dejaria la cartera al reves');

/**
 * Los cuatro estados de un cargo, y las cuatro preguntas a las que contestan.
 *
 * La lista cerrada vive en `schema.ts`, porque es parte del esquema y no de una
 * ruta: la columna la declara con `{ enum: ... }` y asi TypeScript exige que
 * cualquier estado que se escriba pertenezca a esta lista.
 */
const ESTADOS = ESTADOS_CARGO;
type Estado = EstadoCargo;

/** Los estados en los que todavia se debe plata. Un cancelado no se debe. */
const CON_SALDO: Estado[] = ['pending', 'partial'];

/**
 * Como entro el dinero. Cuatro valores cerrados porque la pregunta que se le hace
 * a un abono es "como llego", y un texto libre ("transferencia banco state") no se
 * puede agrupar para cerrar la caja del dia.
 */
const METODOS = ['cash', 'card', 'transfer', 'other'] as const;
type Metodo = (typeof METODOS)[number];

/**
 * La base del producto o una transaccion suya.
 *
 * Se declara como "algo que sabe hacer un SELECT" y no como la base entera porque
 * los helpers de lectura tienen que servir para las dos cosas: el saldo se lee en
 * el tablero (base) y en el mismo instante en que se va a escribir un abono
 * (transaccion), y que el segundo caso pueda reusar el primer helper es
 * justamente lo que garantiza que las dos cifras sean la misma cifra.
 */
type Consulta = { select: ProductDb['db']['select'] };

/**
 * El estado se DEDUCE del saldo. Nunca se escribe a mano.
 *
 * Con cero abonos no se debe nada todavia (`pending`); con abonos que no cubren el
 * total se debe una parte (`partial`); con abonos que cubren el total no se debe
 * nada (`paid`). Esta funcion es la UNICA fuente de esos tres valores, asi que no
 * puede quedar un cargo "pagado" sin un centimo cobrado.
 *
 * `canceled` NO sale de aqui, y es deliberado: cancelar es una decision de la
 * empresa, no una consecuencia de la aritmetica. Si esta funcion lo devolviera,
 * el siguiente abono de un cargo cancelado lo resucitaria solo, sin que nadie lo
 * decidiera. Por eso el `canceled` lo pone su endpoint y nadie mas.
 */
function estadoDesdeSaldo(pagado: number, total: number): Estado {
  if (pagado <= 0) return 'pending';
  return pagado >= total ? 'paid' : 'partial';
}

/** Cuanto se ha devuelto de un cargo, en centavos. Como el abono, derivado. */
function devueltoDe(c: Consulta, org: string, cargoId: string): number {
  const fila = c
    .select({ n: sql<number>`coalesce(sum(${chargeRefunds.amountCents}), 0)` })
    .from(chargeRefunds)
    .where(and(eq(chargeRefunds.organizationId, org), eq(chargeRefunds.chargeId, cargoId)))
    .get();
  return fila?.n ?? 0;
}

/**
 * Cuanto se ha cobrado NETO de un cargo: lo que entro menos lo que salio.
 * SIEMPRE derivado, nunca columna.
 *
 * El neto es una sola cifra a proposito. Si el saldo, el estado y el tablero tuvieran
 * que restar las devoluciones por su cuenta, cada uno seria un lugar mas donde
 * olvidarse, y el fallo se veria como "la cartera no cuadra" sin poder senalado. Con
 * un unico `pagadoDe`, devolver plata baja el saldo y reabre el cargo por el mismo
 * camino por el que lo subio un abono, que es lo unico que puede ser.
 */
function pagadoDe(c: Consulta, org: string, cargoId: string): number {
  const fila = c
    .select({ n: sql<number>`coalesce(sum(${chargePayments.amountCents}), 0)` })
    .from(chargePayments)
    .where(and(eq(chargePayments.organizationId, org), eq(chargePayments.chargeId, cargoId)))
    .get();
  return (fila?.n ?? 0) - devueltoDe(c, org, cargoId);
}

/** La misma cifra para TODOS los cargos de la empresa, en UNA sola consulta. */
function pagadoPorCargo(c: Consulta, org: string): Map<string, number> {
  const filas = c
    .select({
      cargoId: chargePayments.chargeId,
      pagado: sql<number>`coalesce(sum(${chargePayments.amountCents}), 0)`,
    })
    .from(chargePayments)
    .where(eq(chargePayments.organizationId, org))
    .groupBy(chargePayments.chargeId)
    .all();
  const devoluciones = c
    .select({
      cargoId: chargeRefunds.chargeId,
      devuelto: sql<number>`coalesce(sum(${chargeRefunds.amountCents}), 0)`,
    })
    .from(chargeRefunds)
    .where(eq(chargeRefunds.organizationId, org))
    .groupBy(chargeRefunds.chargeId)
    .all();
  const porCargo = new Map(filas.map((f) => [f.cargoId, f.pagado]));
  for (const d of devoluciones) {
    porCargo.set(d.cargoId, (porCargo.get(d.cargoId) ?? 0) - d.devuelto);
  }
  return porCargo;
}

/**
 * El saldo de un cargo. Nunca baja de cero: por invariante no puede.
 *
 * Un cargo CANCELADO vale cero y no `total - cobrado`. La cuenta de arriba le
 * daria el total entero, porque un cancelado no admite abonos y entonces su
 * cobrado es 0: la cartera mostraria como deuda lo que la empresa acaba de
 * condonar. Por eso el estado entra como argumento en vez de suponerlo, y por eso
 * todos los que arman saldos lo pasan.
 */
function saldoDe(pagado: number, total: number, estado?: Estado | null): number {
  if (estado === 'canceled') return 0;
  return total - pagado;
}

/** Desfase de la zona horaria de la empresa, en milisegundos. */
function desfaseMs(zona: string, cuando: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(cuando);
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  // `hour` puede venir como 24 a medianoche en algunos runtimes; `% 24` lo arregla.
  const comoUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  // El formateador entrega segundos, no milisegundos: se compara contra el instante
  // recortado al segundo para que el desfase salga en segundos enteros y no dependa
  // de los milisegundos del reloj.
  return comoUtc - (cuando.getTime() - (cuando.getTime() % 1000));
}

/**
 * El dia de hoy EN LA ZONA DE LA EMPRESA, como `AAAA-MM-DD`.
 *
 * No `new Date().toISOString().slice(0, 10)`: eso es el dia en UTC, y entre las
 * 21:00 y las 24:00 en Santiago ya es manana. Con ese corrimiento, el "vencido" del
 * tablero y el primer tramo del reporte de antiguedad cuentan mal un dia todos
 * los dias, y nadie se da cuenta porque el error es de un dia, no de un ano.
 */
function hoyEn(zona: string, cuando: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    cuando,
  );
}

/**
 * El mes en curso de la empresa, como instantes ISO de apertura y cierre.
 *
 * El desfase se toma del instante actual, asi que en un pais que cambia de hora
 * dentro del mes el corte queda corrido unas horas. Se acepta: un producto de
 * cartera no lleva la tabla de transiciones DST, y el error posible es de horas
 * sobre un corte de un mes, no de un dia sobre un corte de un dia.
 */
function mesEnCurso(zona: string, cuando: Date = new Date()) {
  const mes = hoyEn(zona, cuando).slice(0, 7);
  const desfase = desfaseMs(zona, cuando);
  const apertura = new Date(Date.parse(`${mes}-01T00:00:00Z`));
  const siguiente = new Date(Date.UTC(apertura.getUTCFullYear(), apertura.getUTCMonth() + 1, 1));
  return {
    desde: new Date(apertura.getTime() - desfase).toISOString(),
    hasta: new Date(siguiente.getTime() - desfase).toISOString(),
  };
}

/** Dias de atraso de un cargo a una fecha de referencia. Negativo = aun no vence. */
function diasDeAtraso(vence: string | null, referencia: string): number {
  // Sin `due_date` no hay atraso medible, asi que el cargo cae en el primer tramo
  // en vez de desaparecer del reporte. Un cartera que esconde lo que no tiene
  // fecha de vencimiento es una cartera que se ve menor de lo que es.
  if (!vence) return 0;
  return Math.floor(
    (Date.parse(`${referencia}T00:00:00Z`) - Date.parse(`${vence}T00:00:00Z`)) / 86_400_000,
  );
}

/** Los cuatro tramos del reporte de antiguedad, siempre los cuatro. */
const TRAMOS = [
  { clave: '0-30', hasta: 30 },
  { clave: '31-60', hasta: 60 },
  { clave: '61-90', hasta: 90 },
  { clave: 'mas-90', hasta: Number.POSITIVE_INFINITY },
] as const;

function tramoDe(dias: number): string {
  if (dias <= 0) return '0-30';
  return TRAMOS.find((t) => dias <= t.hasta)!.clave;
}

/**
 * El cuerpo de un cargo.
 *
 * `status` NO esta en este schema, y no es un olvido: el estado se recalcula desde
 * el saldo, asi que si entrara por la API un PATCH podria dejar un cargo "pagado"
 * sin un centimo cobrado. Quien quiera cambiarlo usa `/abonos` o `/cancelar`, y el
 * PATCH responde 400 con el mensaje que dice cual de las dos.
 */
const cargoSchema = z.object({
  /** Si no viene, se propone el folio siguiente de la organizacion. */
  number: z.coerce.number().int().min(1).max(9_999_999).nullable().optional(),
  customerName: texto,
  /** Referencia suelta al producto `crm`. Sin FK: es otra base. */
  customerId: id.nullable().optional(),
  customerEmail: z.union([email, z.literal(''), z.null()]).nullable().optional(),
  concept: texto,
  amountCents: centavos,
  issuedDate: dia.nullable().optional(),
  dueDate: dia.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

const abonoSchema = z.object({
  amountCents: centavos,
  method: z.enum(METODOS).default('other'),
  reference: z.string().trim().max(120).nullable().optional(),
  /** Si no viene, el abono se registra ahora. */
  receivedAt: instante.optional(),
});

/**
 * La devolucion.
 *
 * `amountCents` es un entero POSITIVO, igual que el abono, y no un numero con
 * signo: la devolucion es un documento que dice "salieron 5000", no "el abono de
 * 5000 ahora es -5000". La diferencia no es de forma, es de contabilidad, y la
 * tabla `charge_refunds` con su `CHECK (> 0)` es la que la defiende.
 *
 * `reason` es obligatorio y `min(1)`: una devolucion sin motivo es exactamente el
 * tipo de movimiento que despues nadie sabe explicar, que es lo que el abono
 * nunca fue porque un abono siempre tiene un comprobante.
 */
const devolucionSchema = z.object({
  amountCents: centavos,
  reason: z.string().trim().min(1, 'Deci por que se devuelve').max(500),
  method: z.enum(METODOS).default('other'),
  reference: z.string().trim().max(120).nullable().optional(),
  /** Si no viene, la devolucion se registra ahora. */
  refundedAt: instante.optional(),
});

const cancelarSchema = z.object({
  /** Por que se cancela. Opcional: el estado se cancela igual. */
  notes: z.string().trim().max(2000).nullable().optional(),
});

export function leerPreferencias(db: ProductDb['db'], org: string) {
  const fila = db.select().from(settings).where(eq(settings.organizationId, org)).get();
  return {
    currency: fila?.currency ?? '$',
    timezone: fila?.timezone ?? 'America/Santiago',
  };
}

/** `req.query.x` puede venir repetido, y un array no es una fecha. */
function queryUnValor(valor: unknown): string | undefined {
  if (typeof valor !== 'string' || !valor.trim()) return undefined;
  return valor.trim();
}

/** Una fecha del query string, validada. 400 si viene mal, no 500 ni silencio. */
function diaDelQuery(valor: unknown, campo: string): string | null {
  const bruto = queryUnValor(valor);
  if (bruto === undefined) return null;
  const parsed = dia.safeParse(bruto);
  if (!parsed.success) {
    throw new AppError(400, `${campo} va como AAAA-MM-DD (${campo}=2026-09-27)`);
  }
  return parsed.data;
}

export function buildRoutes(ctx: ProductContext): Router[] {
  const router = Router();
  const { db } = ctx.handle;

  /** Un cargo tiene que ser de ESTA organizacion, no solo existir. */
  function cargoDe(org: string, cargoId: string) {
    const fila = db
      .select()
      .from(charges)
      .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
      .get();
    // El mensaje dice "no existe" a proposito: un "es de otra empresa" confirmaria
    // que ese id existe, que es justo la informacion que se le quiere negar.
    if (!fila) throw new AppError(404, 'Ese cargo no existe');
    return fila;
  }

  /**
   * El folio siguiente de una organizacion.
   *
   * Se calcula como el MAYOR folio que existe mas uno, y no como "contar + 1": si
   * se borra un cargo, contar da un numero que ya existe y choca contra el indice
   * unico. El maximo mas uno nunca repite.
   *
   * Se miran TODOS los cargos, incluidos los pagados y los cancelados: un folio
   * dado no vuelve a usarse, y reciclarlo es como se termina con dos facturas con
   * el mismo numero en la cartera.
   */
  function folioSiguiente(c: Consulta, org: string): number {
    const maximo = c
      .select({ n: sql<number | null>`MAX(${charges.number})` })
      .from(charges)
      .where(eq(charges.organizationId, org))
      .get();
    return (maximo?.n ?? 0) + 1;
  }

  // ─────────────────────────────────────────────────────────────────── tablero

  /**
   * Las cifras de la cartera: cuanto se ha cobrado este mes, cuanto queda por
   * cobrar y cuanto de eso ya esta vencido.
   *
   * Va antes que cualquier ruta con `/:id` por la misma razon que `next-number` en
   * `activos`: si no, "dashboard" se lee como un id.
   *
   * `pendienteCents` es la suma de los SALDOS, no de los totales: un cargo pagado
   * a medias no aporta con lo que se emitio sino con lo que falta. Y un cargo
   * cancelado no aporta nada, porque no se va a cobrar y sumarlo daria una deuda
   * que la empresa se cancelo a si misma.
   *
   * Los cuatro estados se responden siempre, aunque uno no tenga cargos: una
   * tarjeta que aparece y desaparece segun los datos del mes hace que la pantalla
   * "salte" mientras se trabaja.
   */
  router.get(
    '/api/dashboard',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const { timezone } = leerPreferencias(db, org);
      const hoy = hoyEn(timezone);
      const mes = mesEnCurso(timezone);

      const todos = db.select().from(charges).where(eq(charges.organizationId, org)).all();
      const pagado = pagadoPorCargo(db, org);

      const saldoDe_ = (c: (typeof todos)[number]) =>
        saldoDe(pagado.get(c.id) ?? 0, c.amountCents, c.status);

      const abiertos = todos.filter((c) => CON_SALDO.includes(c.status));
      const pendienteCents = abiertos.reduce((acc, c) => acc + saldoDe_(c), 0);
      // Vencido es "el saldo que ya se paso de la fecha pactada", no "el total del
      // cargo": un cargo pagado a medias y vencido debe SOLO lo que falta.
      const vencidoCents = abiertos
        .filter((c) => !!c.dueDate && c.dueDate! < hoy)
        .reduce((acc, c) => acc + saldoDe_(c), 0);

      // El cobrado del mes se cuenta por `received_at`, el instante en que entro
      // la plata, y no por `created_at`, que es cuando se escribio la fila: un
      // abono que se registra hoy de una transferencia de ayer es dinero de ayer.
      const cobrado = db
        .select({ total: sql<number>`coalesce(sum(${chargePayments.amountCents}), 0)` })
        .from(chargePayments)
        .where(
          and(
            eq(chargePayments.organizationId, org),
            gte(chargePayments.receivedAt, mes.desde),
            lt(chargePayments.receivedAt, mes.hasta),
          ),
        )
        .get();

      // Y lo que salio este mes, por el mismo `refunded_at`. Va aparte y no restado
      // del cobrado porque son dos cifras distintas: "lo que entro" y "lo que
      // devolvimos" se leen distinto en el tablero, y restarlos dari un "neto" que
      // no es ni lo uno ni lo otro. Las dos se devuelven y la pantalla decide.
      const devuelto = db
        .select({ total: sql<number>`coalesce(sum(${chargeRefunds.amountCents}), 0)` })
        .from(chargeRefunds)
        .where(
          and(
            eq(chargeRefunds.organizationId, org),
            gte(chargeRefunds.refundedAt, mes.desde),
            lt(chargeRefunds.refundedAt, mes.hasta),
          ),
        )
        .get();

      const recientes = todos
        .slice()
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map((c) => ({ ...c, pagadoCents: pagado.get(c.id) ?? 0, saldoCents: saldoDe_(c) }));

      res.json({
        total: todos.length,
        porStatus: Object.fromEntries(ESTADOS.map((e) => [e, todos.filter((c) => c.status === e).length])),
        pendienteCents,
        cobradoMesCents: cobrado?.total ?? 0,
        devueltoMesCents: devuelto?.total ?? 0,
        vencidoCents,
        recientes,
      });
    }),
  );

  // ─────────────────────────────────────────────────────────────────── el folio

  /**
   * El folio siguiente de la organizacion.
   *
   * Va antes del `crudRouter` de `/api/charges` porque este tiene un `GET /:id`
   * generico: sin esta ruta de arriba, "next-number" seria un id y la pantalla de
   * alta recibiria un 404 en vez de una propuesta.
   *
   * Y va antes a proposito de que la pantalla calcule el numero: si lo calculara
   * ella, dos personas de la misma empresa abiertas a la vez propondrían el mismo
   * folio y la segunda se llevaria un 409.
   */
  router.get(
    '/api/charges/next-number',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      res.json({ number: folioSiguiente(db, org) });
    }),
  );

  /**
   * El saldo de TODOS los cargos de la empresa, en una sola respuesta.
   *
   * Existe por una razon concreta: `/api/charges` es el `crudRouter` y devuelve
   * filas de la tabla, y el saldo no es una columna (ver la invariante 2). Sin
   * esta ruta, la pantalla tendria que pedir la ficha de cada cargo para pintar la
   * lista, y eso son 200 idas a la base por cada carga de pantalla.
   *
   * Se calcula con UN `GROUP BY` sobre todos los abonos de la empresa, no con una
   * consulta por cargo: la cartera de una empresa con dos mil cargos son dos mil
   * sumas, y la respuesta sigue siendo una sola.
   */
  router.get(
    '/api/charges/saldos',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const todos = db
        .select({ id: charges.id, amountCents: charges.amountCents, status: charges.status })
        .from(charges)
        .where(eq(charges.organizationId, org))
        .all();
      const pagado = pagadoPorCargo(db, org);
      res.json({
        saldos: todos.map((c) => ({
          id: c.id,
          pagadoCents: pagado.get(c.id) ?? 0,
          saldoCents: saldoDe(pagado.get(c.id) ?? 0, c.amountCents, c.status),
        })),
      });
    }),
  );

  // ────────────────────────────────────────────────────────────────────── ficha

  /**
   * La ficha de un cargo: sus datos y todos sus abonos, del mas nuevo al mas
   * viejo.
   *
   * Los abonos van en `DESC` de `received_at` porque la pregunta que se hace
   * mirando una ficha es "cuando fue la ultima vez que me pago", y el saldo se
   * lee como un numero: la ficha es donde se ve de donde sale.
   */
  router.get(
    '/api/charges/:id/ficha',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cargoId = id.parse(req.params.id);
      const cargo = cargoDe(org, cargoId);

      const abonos = db
        .select()
        .from(chargePayments)
        .where(and(eq(chargePayments.organizationId, org), eq(chargePayments.chargeId, cargoId)))
        .orderBy(desc(chargePayments.receivedAt), desc(chargePayments.createdAt))
        .all();

      // Las devoluciones van aparte de los abonos, no mezcladas: la ficha es donde
      // alguien mira "cuando fue la ultima vez que me pagado" y revisa que cuadre,
      // y una lista unica de movimientos con signos hace falta una calculadora
      // mental para entenderla. Abonos primero, devoluciones despues.
      const devoluciones = db
        .select()
        .from(chargeRefunds)
        .where(and(eq(chargeRefunds.organizationId, org), eq(chargeRefunds.chargeId, cargoId)))
        .orderBy(desc(chargeRefunds.refundedAt), desc(chargeRefunds.createdAt))
        .all();

      // El NETO es la cifra que manda, y sale del MISMO `pagadoDe` que usan el
      // tablero y el reporte. Que la ficha pueda decir una cosa y la cartera otra
      // seria el peor fallo posible del producto: el saldo de la ficha es
      // exactamente el saldo que el cliente ve en la factura.
      const pagadoCents = pagadoDe(db, org, cargoId);
      const devueltoCents = devoluciones.reduce((acc, d) => acc + d.amountCents, 0);
      res.json({
        charge: cargo,
        payments: abonos,
        refunds: devoluciones,
        // Lo que entro en total, que no es el mismo numero que el neto cuando hubo
        // devoluciones. Se devuelven los dos para que la ficha se pueda auditar.
        abonadoCents: abonos.reduce((acc, a) => acc + a.amountCents, 0),
        devueltoCents,
        pagadoCents,
        saldoCents: saldoDe(pagadoCents, cargo.amountCents, cargo.status),
      });
    }),
  );

  // ───────────────────────────────────────────────────────────────── abonos

  /**
   * Registrar un abono y recalcular el estado del cargo.
   *
   * Las dos escrituras van en UNA transaccion, y esa es la invariante central del
   * producto: un abono guardado sin recalcular deja un cargo con plata cobrada que
   * sigue diciendo "pendiente", y la cartera pasa a ser una lista de mentiras.
   * Mitad del hecho guardado es peor que no guardar nada.
   *
   * `better-sqlite3` es sincrono, asi que `transaction` devuelve el valor del
   * callback y no una promesa: no hay que esperarlo, y un `await` de mas solo
   * haria creer que la escritura se completa despues.
   */
  router.post(
    '/api/charges/:id/abonos',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cargoId = id.parse(req.params.id);
      const body = abonoSchema.parse(req.body);
      const ahora = nowIso();

      const escrito = db.transaction((tx) => {
        const cargo = tx
          .select()
          .from(charges)
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .get();
        if (!cargo) throw new AppError(404, 'Ese cargo no existe');

        // Un cargo cancelado no se recalcula, asi que un abono sobre el no tendria
        // estado donde reflejarse: quedaria plata cobrada en un cargo que la
        // empresa dio por perdido, y el saldo de la ficha diria una cosa y el
        // estado otra.
        if (cargo.status === 'canceled') {
          throw new AppError(409, 'Este cargo esta cancelado y no admite abonos');
        }

        // El saldo se lee DENTRO de la transaccion, no antes. Comprobar antes
        // deja la ventana de los dos cobros simultaneos.
        const pagado = pagadoDe(tx, org, cargoId);
        const saldo = saldoDe(pagado, cargo.amountCents);
        if (body.amountCents > saldo) {
          throw new AppError(
            409,
            `El abono de ${body.amountCents} centavos supera el saldo de ${saldo} centavos: ` +
              'un abono no puede dejar la cartera al reves',
          );
        }

        const abono = tx
          .insert(chargePayments)
          .values({
            id: createId('pagabono'),
            organizationId: org,
            chargeId: cargoId,
            amountCents: body.amountCents,
            method: body.method,
            reference: body.reference ?? null,
            // Sin `receivedAt` el abono se registra ahora: se escribe mientras pasa,
            // y anotarlo a mano solo abre la puerta a escribir el dia equivocado.
            receivedAt: body.receivedAt ?? ahora,
            createdAt: ahora,
          })
          .returning()
          .get();

        // El estado se deriva de lo que quedo, nunca se elige. Un abono que iguala
        // exactamente el saldo deja el cargo pagado sin tocar nada mas.
        const pagadoTotal = pagado + body.amountCents;
        const actualizado = tx
          .update(charges)
          .set({ status: estadoDesdeSaldo(pagadoTotal, cargo.amountCents), updatedAt: ahora })
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .returning()
          .get();

        return {
          charge: actualizado,
          payment: abono,
          pagadoCents: pagadoTotal,
          // El cargo no puede estar cancelado aqui: se rechazo mas arriba, y por eso
          // el estado no hace falta para calcular este saldo.
          saldoCents: saldoDe(pagadoTotal, cargo.amountCents),
        };
      });

      res.status(201).json(escrito);
    }),
  );

  // ────────────────────────────────────────────────────────────────── devoluciones

  /**
   * Registrar una devolucion: la plata que salio despues de haber entrado.
   *
   * Esta es la salida que los dos 409 de mas abajo prometen. Sin ella, "primero hay
   * que devolver esa plata" era un consejo que el producto no sabia cumplir, y el
   * abono quedaba atrapado: los abonos no se borran (el DELETE es 409 justamente
   * para no perder el registro de lo que entro) y un abono negativo lo rechaza el
   * schema y el `CHECK (> 0)`.
   *
   * ES UN DOCUMENTO NUEVO, y esa es la decision de fondo. La alternativa obvia
   * seria borrar el abono equivocado y dejar el correcto, pero eso borra un hecho
   * de caja que ocurrio de verdad: la empresa recibio esa plata, se fue y volvio.
   * Con una devolucion aparte, las dos operaciones quedan las dos, y el cargo que
   * se queria anular conserva su historia completa.
   *
   * Que no se pueda devolver mas de lo cobrado, ni lo que nunca se cobro, es el
   * mismo invariante del abono pero al reves, y por la misma razon: el chequeo va
   * DENTRO de la transaccion que escribe. Comprobar antes deja la ventana en la
   * que dos devoluciones simultaneas pasan las dos el chequeo.
   *
   * El saldo y el estado los vuelve a calcular el mismo `estadoDesdeSaldo` de
   * siempre, alimentado por el cobrado NETO de `pagadoDe`. Por eso devolver todo lo
   * cobrado reabre el cargo como `pending` sin que nadie escriba el estado a mano,
   * y por eso devolver de mas es 409 y no un saldo negativo.
   */
  router.post(
    '/api/charges/:id/devoluciones',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cargoId = id.parse(req.params.id);
      const body = devolucionSchema.parse(req.body ?? {});
      const ahora = nowIso();
      // La fecha es la del movimiento de plata, no la del click: una devolucion
      // pueden meterla a posteriori y tiene que caer en el mes en que salio el
      // dinero, que es donde el tablero la suma.
      const devuelto = body.refundedAt ?? ahora;

      const escrito = db.transaction((tx) => {
        const cargo = tx
          .select()
          .from(charges)
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .get();
        if (!cargo) throw new AppError(404, 'Ese cargo no existe');

        if (cargo.status === 'canceled') {
          throw new AppError(
            409,
            'Ese cargo esta cancelado: no se devuelve nada de un cargo que ya no se cobra',
          );
        }

        const pagado = pagadoDe(tx, org, cargoId);
        if (pagado <= 0) {
          throw new AppError(
            409,
            'Ese cargo no tiene plata cobrada que devolver: se borra o se cancela nomas',
          );
        }
        if (body.amountCents > pagado) {
          throw new AppError(
            409,
            `Ese cargo tiene ${pagado} centavos cobrados y la devolucion es de ` +
              `${body.amountCents}: no se devuelve mas de lo que entro`,
          );
        }

        const devolucion = {
          id: createId('pagref'),
          organizationId: org,
          chargeId: cargoId,
          amountCents: body.amountCents,
          reason: body.reason,
          method: body.method,
          reference: body.reference ?? null,
          refundedAt: devuelto,
          createdAt: ahora,
        };
        tx.insert(chargeRefunds).values(devolucion).run();

        const pagadoTotal = pagadoDe(tx, org, cargoId);
        const estado = estadoDesdeSaldo(pagadoTotal, cargo.amountCents);
        const actualizado = tx
          .update(charges)
          .set({ status: estado, updatedAt: ahora })
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .returning()
          .get();

        return {
          charge: actualizado,
          refund: devolucion,
          // El NETO, que es lo que la cartera debe mostrar despues de esto.
          pagadoCents: pagadoTotal,
          saldoCents: saldoDe(pagadoTotal, cargo.amountCents),
        };
      });

      res.status(201).json(escrito);
    }),
  );

  // ────────────────────────────────────────────────────────────────── cancelar

  /**
   * Cancelar un cargo: "esto no se va a cobrar".
   *
   * Cancelar es una DECISION y por eso tiene endpoint propio en vez de ser un
   * estado mas que se puede poner desde el formulario: si el PATCH lo aceptara, el
   * estado pasaria a ser una palabra mas entre cuatro, y la diferencia entre "me
   * pagaron de menos" y "no me van a pagar" se pierde.
   *
   * Y es la unica operacion que escribe `canceled`, y no se recalcula: el siguiente
   * abono de un cargo cancelado esta prohibido, y editar el total tampoco lo
   * resucita.
   *
   * Cancelar dos veces NO es un error: es la misma operacion idempotente, para que
   * un doble clic en el boton no deje a la empresa con un error en pantalla
   * despues de que el cargo ya quedo cancelado.
   */
  router.post(
    '/api/charges/:id/cancelar',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cargoId = id.parse(req.params.id);
      const body = cancelarSchema.parse(req.body ?? {});
      const ahora = nowIso();

      const cancelado = db.transaction((tx) => {
        const cargo = tx
          .select()
          .from(charges)
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .get();
        if (!cargo) throw new AppError(404, 'Ese cargo no existe');

        // El chequeo es sobre el DINERO COBRADO, no sobre el estado: la pregunta
        // real es si se puede borrar plata que ya entro, y esa pregunta no depende
        // de lo que diga la columna.
        const pagado = pagadoDe(tx, org, cargoId);
        if (pagado > 0) {
          throw new AppError(
            409,
            `No se cancela un cargo con ${pagado} centavos ya cobrados: primero hay que devolver esa plata. ` +
              'Registra la devolucion y despues cancelalo. Cancelar significa "no se va a cobrar", ' +
              'no "se borro la historia"',
          );
        }

        if (cargo.status === 'canceled') return cargo;

        return tx
          .update(charges)
          .set({
            status: 'canceled',
            // La nota de cancelacion solo se escribe si viene. Reemplazar unas
            // notas que hablaban del trabajo por un "cancelado" perderia el motivo
            // por el que se emitio, que a veces es justo lo que se necesita saber.
            notes: body.notes ?? cargo.notes,
            updatedAt: ahora,
          })
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .returning()
          .get();
      });

      res.json({ charge: cancelado });
    }),
  );

  // ────────────────────────────────────────────────────────────── escribir cargo

  /**
   * El folio se decide DENTRO de la transaccion, y el `409` tambien.
   *
   * Comprobar antes de escribir deja una ventana: dos personas que creen un cargo
   * en el mismo segundo pasan las dos el chequeo, y la segunda revienta con un
   * error de SQLite en vez de un 409 que la pantalla entienda. El indice UNIQUE
   * sigue siendo la garantia real; esto solo convierte el error en algo que se
   * puede mostrar.
   */
  router.post(
    '/api/charges',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const body = cargoSchema.parse(req.body);
      const ahora = nowIso();

      const creado = db.transaction((tx) => {
        // Sin folio se propone el siguiente. El folio va SIEMPRE por empresa: si
        // fuera global, la segunda empresa en abrir no podria empezar en 1.
        const numero = body.number ?? folioSiguiente(tx, org);
        const choque = tx
          .select({ id: charges.id })
          .from(charges)
          .where(and(eq(charges.organizationId, org), eq(charges.number, numero)))
          .get();
        if (choque) {
          throw new AppError(409, `Ya existe el cargo numero ${numero} en esta empresa`);
        }

        return tx
          .insert(charges)
          .values({
            id: createId('pagcargo'),
            organizationId: org,
            number: numero,
            customerName: body.customerName,
            customerId: body.customerId ?? null,
            customerEmail: body.customerEmail ?? null,
            concept: body.concept,
            amountCents: body.amountCents,
            // Un cargo nace pendiente SIEMPRE. Ponerlo `paid` al crearse seria
            // una cartera con un numero que nadie cobro, y el estado se deriva
            // del saldo, no de lo que el cliente paso.
            status: 'pending',
            issuedDate: body.issuedDate ?? null,
            dueDate: body.dueDate ?? null,
            notes: body.notes ?? null,
            createdAt: ahora,
          })
          .returning()
          .get();
      });

      res.status(201).json({ charge: creado });
    }),
  );

  /**
   * Editar un cargo. El total y el folio se revalidan, y el estado se vuelve a
   * derivar.
   *
   * Editar el total de un cargo que ya tiene abonos es la operacion que mas puede
   * romper la invariante del saldo, asi que se limita a una sola cosa: el total no
   * puede bajar de lo ya cobrado. Bajarlo dejaria saldo negativo, que es la unica
   * forma de que la cartera diga que la empresa le debe plata al cliente.
   */
  router.patch(
    '/api/charges/:id',
    requireRole('member'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cargoId = id.parse(req.params.id);
      const existente = cargoDe(org, cargoId);

      // El estado se rechaza en vez de ignorarse. Un PATCH que acepta `status` y
      // no lo aplica deja al que lo mando creyendo que el cargo quedo pagado, y
      // esa duda no se resuelve sola.
      if (req.body?.status !== undefined) {
        throw new AppError(
          400,
          'El estado de un cargo no se edita: se cambia registrando un abono ' +
            '(POST /api/charges/:id/abonos) o cancelando (POST /api/charges/:id/cancelar)',
        );
      }

      // El PATCH parte del cargo que ya existe, asi que se puede mandar solo el
      // concepto y no perder el resto. Un `parse` sobre el cuerpo pelado exigiria
      // mandar todos los campos siempre, y el que olvide uno se queda sin guardar
      // sin avisar.
      const body = cargoSchema.parse({
        number: existente.number,
        customerName: existente.customerName,
        customerId: existente.customerId,
        customerEmail: existente.customerEmail,
        concept: existente.concept,
        amountCents: existente.amountCents,
        issuedDate: existente.issuedDate,
        dueDate: existente.dueDate,
        notes: existente.notes,
        ...req.body,
      });
      const ahora = nowIso();

      const actualizado = db.transaction((tx) => {
        if (body.number !== existente.number) {
          const choque = tx
            .select({ id: charges.id })
            .from(charges)
            .where(
              and(
                eq(charges.organizationId, org),
                eq(charges.number, body.number!),
                // El cargo que se esta editando no choca consigo mismo.
                ne(charges.id, cargoId),
              ),
            )
            .get();
          if (choque) {
            throw new AppError(409, `Ya existe el cargo numero ${body.number} en esta empresa`);
          }
        }

        const pagado = pagadoDe(tx, org, cargoId);
        if (body.amountCents < pagado) {
          throw new AppError(
            409,
            `El total no puede bajar de los ${pagado} centavos ya cobrados: dejaria el saldo en negativo`,
          );
        }

        return tx
          .update(charges)
          .set({
            number: body.number ?? existente.number,
            customerName: body.customerName,
            customerId: body.customerId ?? null,
            customerEmail: body.customerEmail ?? null,
            concept: body.concept,
            amountCents: body.amountCents,
            issuedDate: body.issuedDate ?? null,
            dueDate: body.dueDate ?? null,
            notes: body.notes ?? null,
            // El estado se vuelve a DERIVAR del saldo nuevo, porque cambiar el
            // total cambia el saldo. Un cancelado se queda cancelado: cancelar es
            // explicito y no lo deshace un numero que alguien edito.
            status: existente.status === 'canceled' ? 'canceled' : estadoDesdeSaldo(pagado, body.amountCents),
            updatedAt: ahora,
          })
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .returning()
          .get();
      });

      res.json({ charge: actualizado });
    }),
  );

  /**
   * Borrar un cargo: solo si no tiene un centimo cobrado.
   *
   * El CASCADE del DDL se sigue aplicando, pero ya no es una puerta: si hay
   * abonos, este endpoint responde 409. El CASCADE sin este chequeo dejaba que un
   * admin deshiciera con un clic el registro de plata que la empresa recibio de
   * verdad, y no habia forma de saber despues cuanto se habia cobrado. El dinero
   * que entra no se borra: se devuelve, y esa devolucion es otro documento con su
   * propia razon social.
   *
   * Sin abonos, borrar sigue siendo lo de siempre: un cargo cargado por error se
   * borra sin dejar rastro, que es lo que se quiere de el.
   *
   * El camino para deshacer un cargo con plata cobrada es `/cancelar`, que ya
   * tiene su propio 409 para el caso inverso. Los dos operaciones separsers del
   * mismo principio: lo que no se toco sigue diciendo la verdad.
   *
   * Sigue siendo de `admin`: borrar un cargo borra el registro de la cartera, y
   * eso no lo decide cualquier miembro.
   */
  router.delete(
    '/api/charges/:id',
    requireRole('admin'),
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const cargoId = id.parse(req.params.id);
      // En transaccion porque el chequeo y el borrado tienen que ver la misma foto:
      // si alguien cobra entre medio, sin esto se podrian borrar abonos que todavia
      // no son visibles para la consulta.
      const borrado = db.transaction((tx) => {
        const cargo = tx
          .select()
          .from(charges)
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .get();
        if (!cargo) throw new AppError(404, 'Ese cargo no existe');

        const pagado = pagadoDe(tx, org, cargoId);
        if (pagado > 0) {
          throw new AppError(
            409,
            `Este cargo tiene ${pagado} centavos ya cobrados y no se borra: se devuelve la plata y se cancela. ` +
              'Borrarlo eliminaria el registro de la plata que entro. Si el abono estaba mal, ' +
              'registra una devolucion en vez de tratar de borrar el abono',
          );
        }

        return tx
          .delete(charges)
          .where(and(eq(charges.id, cargoId), eq(charges.organizationId, org)))
          .returning()
          .get();
      });

      res.json({ charge: borrado, deleted: true });
    }),
  );

  // ────────────────────────────────────────────────────────────────── reporte

  /**
   * La antiguedad de la cartera: cuanto se le debe a quien y desde cuando.
   *
   * La pregunta que responde es "que parte de lo que me deben esta perdida", y por
   * eso se ordena por dias de atraso y no por monto: un saldo chico de hace cinco
   * meses es mas urgente que uno grande que vence la semana que viene.
   *
   * `from` y `to` filtran por `issued_date` (cuando se emitio el cargo), no por
   * vencimiento: un reporte de cartera se pregunta sobre lo que se emitio en un
   * periodo. Un cargo sin `issued_date` no entra en un rango de fechas, porque sin
   * fecha no se puede saber si se emitio dentro o fuera.
   *
   * La referencia de los dias de atraso es `to` cuando viene, y HOY cuando no. Es
   * la diferencia entre un reporte y una foto: "la cartera al 30 de septiembre" tiene
   * que seguir diciendo lo mismo dentro de un mes, y si los dias de atraso se
   * midieran contra hoy, el mismo archivo daria cuatro numeros distintos segun el
   * dia en que se abra.
   *
   * Un cargo CANCELADO no aparece: no se va a cobrar, y contarlo haria que la
   * cartera del reporte pareciera mas grande que la real.
   */
  router.get(
    '/api/reporte',
    asyncHandler(async (req, res) => {
      const org = orgId(req);
      const { timezone } = leerPreferencias(db, org);
      const desde = diaDelQuery(req.query.from, 'from');
      const hasta = diaDelQuery(req.query.to, 'to');
      const referencia = hasta ?? hoyEn(timezone);

      const filas = db
        .select()
        .from(charges)
        .where(
          and(
            eq(charges.organizationId, org),
            ne(charges.status, 'canceled'),
            ...(desde ? [gte(charges.issuedDate, desde)] : []),
            ...(hasta ? [lte(charges.issuedDate, hasta)] : []),
          ),
        )
        .all();

      const pagado = pagadoPorCargo(db, org);
      const conSaldo = filas
        .map((c) => ({ cargo: c, saldo: saldoDe(pagado.get(c.id) ?? 0, c.amountCents, c.status) }))
        .filter((f) => f.saldo > 0);

      // Los cuatro tramos se arman TODOS, aunque alguno quede en cero: una columna
      // que aparece y desaparece segun los datos hace que la pantalla "salte".
      const buckets: Record<string, { cargos: number; saldoCents: number }> = Object.fromEntries(
        TRAMOS.map((t) => [t.clave, { cargos: 0, saldoCents: 0 }]),
      );
      for (const { cargo, saldo } of conSaldo) {
        const clave = tramoDe(diasDeAtraso(cargo.dueDate, referencia));
        buckets[clave].cargos += 1;
        buckets[clave].saldoCents += saldo;
      }

      res.json({
        from: desde,
        to: hasta,
        referencia,
        buckets,
        totalPendienteCents: conSaldo.reduce((acc, f) => acc + f.saldo, 0),
        totalCargos: conSaldo.length,
      });
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
   * Por eso el PUT pide `admin`: si un miembro las cambiara, la lectura del saldo de
   * toda la cartera se moveria para toda la gente a la vez, y en este producto la
   * zona no es decorativa: decide que dia es hoy para el reporte de antiguedad y
   * cual es el mes en curso del "cobrado del mes". Leer es libre; cambiar la
   * configuracion compartida no.
   *
   * La zona se valida contra `Intl` en vez de contra una lista escrita a mano:
   * cualquier zona de la base de IANA sirve, y una lista propia envejece.
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
   * El listado y la lectura puntual del cargo.
   *
   * La busqueda cubre las cuatro columnas por las que de verdad se busca un cargo:
   * el folio, el concepto, el nombre del cliente y su correo. El numero se busca
   * con `LIKE` sobre una columna INTEGER, y SQLite convierte el numero a texto
   * para comparar, asi que `?q=0042` encuentra el folio 42.
   *
   * El `POST`, el `PATCH` y el `DELETE` de ESTA ruta no se usan: quedan escondidos
   * detras de los de a mano que estan mas arriba, que son los que deciden el folio
   * dentro de la transaccion y recalculan el estado desde el saldo. Express
   * resuelve en orden de registro, asi que la primera coincidencia gana. Se dejan
   * los endpoints declarados aqui porque los usa la pantalla y porque la declaracion
   * de campos documenta las columnas una sola vez.
   */
  router.use(
    '/api/charges',
    crudRouter(ctx.handle, {
      table: charges,
      idPrefix: 'pagcargo',
      label: 'cargo',
      search: [charges.number, charges.concept, charges.customerName, charges.customerEmail],
      // Sin esto `?status=pending` se ignoraba en silencio y la pantalla de cartera
      // mostrar los cuatro estados mientras aparentaba estar filtrada.
      filters: { status: { column: charges.status, schema: z.enum(ESTADOS) } },
      orderBy: charges.number,
      orderDirection: 'desc',
      fields: {
        number: { schema: z.coerce.number().int().min(1).max(9_999_999) },
        customerName: { schema: texto },
        customerId: { schema: id.nullable().optional() },
        customerEmail: { schema: z.union([email, z.literal(''), z.null()]).nullable().optional() },
        concept: { schema: texto },
        amountCents: { schema: centavos },
        // `readonly`: el estado no se escribe por la API. Lo decide el saldo.
        status: { readonly: true },
        issuedDate: { schema: dia.nullable().optional() },
        dueDate: { schema: dia.nullable().optional() },
        notes: { schema: z.string().trim().max(2000).nullable().optional() },
        createdAt: { readonly: true },
        updatedAt: { readonly: true },
      },
    }),
  );

  return [router];
}
