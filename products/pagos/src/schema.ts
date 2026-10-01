import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de pagos: lo que la empresa le COBRA a sus clientes.
 *
 * LO MAS IMPORTANTE DE ESTE ARCHIVO, Y POR QUE ESTA ENCIMA Y NO ABAJO
 *
 * NO EXISTE (NI DEBE EXISTIR) UNA TABLA `payments` EN ESTE PRODUCTO.
 *
 * En el Core hay una tabla `payments` y es de OTRA cosa: es lo que el CLIENTE le
 * paga a AMG por la SUSCRIPCION. Son dos pagos que se dicen igual y no son
 * ninguno parecido:
 *
 *   - `core.sqlite` -> `payments` = el dinero que entra A AMG desde el cliente que
 *     esta pagando el producto. El Core la necesita para saber si la suscripcion
 *     esta al dia, y por eso la escribe el producto `landing` con los datos que le
 *     manda el cliente.
 *   - `pagos.sqlite` -> ESTE producto = el dinero que la empresa le cobra a SUS
 *     clientes por los trabajos que le hizo. Facturas, cuentas por cobrar, abonos
 *     recibidos.
 *
 * El error que se repite en este repo es poner el nombre corto en la tabla nueva:
 * se escribe `payments` porque "un abono es un pago", y la tabla queda con el
 * nombre del Core en otra base. No colisiona en SQLite (bases distintas, nombres
 * iguales, ninguna se entera), asi que el bug NO EXPLOTA: se descubre meses
 * despues, cuando alguien busca "los pagos" en la base equivocada, encuentra los
 * abonos de los clientes de la empresa, y los confunde con la suscripcion que
 * esta pagando AMG. Para evitarlo la tabla se llama `charge_payments` y NO
 * `payments`: dos palabras de mas, y con ese nombre no hay forma de confundirla.
 * `docs/DATA_ISOLATION.md` documenta la confusion completa.
 *
 * MAS COSAS QUE ESTE PRODUCTO ES, Y MAS COSAS QUE NO ES
 *
 *   - EL CLIENTE NO SE DUPLICA. Los clientes viven en el producto `clientes`, que
 *     es su dueno y esta en otra base. Por eso `customer_id` va SUELTO (sin llave
 *     foranea, como en `cotizaciones`) y el nombre se COPIA en `customer_name`:
 *     un cargo tiene que poder leerse aunque el cliente se renombre, se de de
 *     baja o nunca se migre. `customer_name` es un SNAPSHOT, no una copia de
 *     confianza: la fuente de verdad del cliente sigue siendo `clientes`.
 *   - NO es contabilidad ni facturacion electrona. Esto no emite comprobantes
 *     fiscales, no calcula impuestos y no se entera de retenciones. Es el
 *     control de la cartera: que emitiste, cuanto te deben y cuanto te han
 *     pagado.
 *   - NO es la agenda de cobros. `citas` es para agendar visitas; este producto
 *     solo guarda que un abono se recibio, con su metodo y su referencia.
 *
 * ESTE PRODUCTO NO TIENE FUENTE LEGACY, y no es un olvido: ninguno de los
 * productos viejos traia un control de cartera de clientes. Por eso NO se declara
 * `legacy_tenant_map` ni existe un `migrate-legacy.ts`: un migrador sin datos de
 * los que leer es fiction, y una tabla de mapeo que nunca se llena es ruido que
 * invita a escribir el.
 *
 * EL SALDO NO ESTA EN UNA COLUMNA, Y ESA ES LA DECISION CENTRAL DEL PRODUCTO.
 * `charges` guarda el TOTAL pactado (`amount_cents`) y lo cobrado se DERIVA
 * sumando `charge_payments`. No hay `paid_cents` ni `saldo_cents`, por dos
 * razones que se refuerzan: (1) una columna de "cobrado" se desincroniza de los
 * abonos en el primer abono que se registre a mano en la base, y a partir de ahi
 * la cartera muestra un numero que nadie sabe de donde sale; (2) con el saldo
 * derivado no hay DOS verdades que puedan discrepar, hay una sola, y se puede
 * corregir borrando un abono en vez de recalcular a mano una columna.
 *
 * Por el mismo motivo el `status` NUNCA se escribe a mano: se RECALCULA desde el
 * saldo en la misma transaccion que registra el abono. Es la unica forma de que
 * "pagado" signifique exactamente "el saldo es cero".
 *
 * El dinero esta en CENTAVOS enteros, en las dos columnas de importe. Nunca en
 * float: 0.1 + 0.2 en punto flotante da 0.30000000000000004, y una cartera que no
 * cuadra centavo a centavo es una cartera que nadie puede cerrar. El factor de
 * conversion no vive en este archivo porque no hay conversion que hacer: la
 * columna y la API ya hablan la misma unidad de punta a punta.
 *
 * TODA tabla lleva `organization_id` NOT NULL con su indice, y todas las
 * consultas filtran por el. No hay `tenant_id`: la identidad la trae el Core.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/**
 * Los cuatro estados posibles de un cargo, y las cuatro preguntas a las que
 * contestan.
 *
 * Son cerrados a proposito, y viven AQUI y no en las rutas porque son parte del
 * esquema: `pending` no tiene abonos, `partial` tiene abonos que no cubren el
 * total, `paid` tiene saldo cero y `canceled` se decidio anular. Un texto libre
 * permitiria escribir "pagado parcial" o "anulado" y la columna dejaria de poder
 * filtrarse, que es la unica razon por la que la columna existe.
 *
 * Declararlos en la columna (`{ enum: ... }`) hace que TypeScript los exija al
 * escribir: si una ruta mandara un estado que no esta en esta lista, no
 * compilaria.
 */
export const ESTADOS_CARGO = ['pending', 'partial', 'paid', 'canceled'] as const;

export type EstadoCargo = (typeof ESTADOS_CARGO)[number];

/**
 * Un cargo: lo que la empresa le tiene que cobrar a un cliente.
 *
 * `number` es el FOLIO y es unico POR ORGANIZACION, no global. Dos empresas
 * pueden tener cada una su cargo numero 1, y en la practica las dos empiezan en
 * 1: si el folio fuera global, la segunda empresa en abrir no podria empezar, que
 * es el mismo argumento que sostiene el folio de `solicitudes` y de `cotizaciones`.
 *
 * `amount_cents` es el TOTAL pactado, y es lo unico que se pacta. Lo cobrado se
 * deriva de `charge_payments` y NO se copia en una columna: ver la cabecera de
 * este archivo.
 *
 * `status` tiene cuatro valores cerrados y se RECALCULA, no se elige:
 * `pending` sin abonos, `partial` con abonos que no cubren el total, `paid` con
 * saldo cero y `canceled` cuando alguien lo cancela a proposito. Un quinto valor
 * libre permitiria escribir "pagado parcial" o "anulado" y la columna dejaria de
 * poder filtrarse, que es la unica razon por la que la columna existe.
 *
 * `issued_date` y `due_date` son FECHAS (`AAAA-MM-DD`), no instantes: lo que
 * responden es "desde cuando se emitio" y "para cuando hay que pagar". Guardarlas
 * como texto evita el corrimiento de dia que aparece al convertir una fecha local
 * a UTC en un huso al oeste, y evita que el navegador y el servidor discrepen
 * sobre que dia es hoy. El indice `(organization_id, status, due_date)` esta en
 * ese orden porque es la consulta del reporte de antiguedad: que hay vencido, y
 * desde cuando.
 */
export const charges = sqliteTable(
  'charges',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    /** Folio de la empresa. Unico por organizacion, NO global. */
    number: integer('number').notNull(),
    /**
     * Nombre del cliente en el momento de emitir el cargo.
     *
     * Es un SNAPSHOT y por eso es NOT NULL aunque `customer_id` sea nulo: un
     * cargo tiene que poder leerse solo. Si el nombre se buscara en vivo en el
     * producto `clientes`, cambiar el nombre de un cliente reescribiria la
     * historia de cartera vieja.
     */
    customerName: text('customer_name').notNull(),
    /**
     * Id del cliente en el producto `clientes`. Referencia SUELTA, sin FK.
     *
     * No puede llevar llave foranea: los clientes viven en la base de otro
     * producto, y SQLite no valida referencias entre bases. Declararla daria la
     * sensacion de integridad que en realidad no existe.
     */
    customerId: text('customer_id'),
    /** Correo del cliente al momento de emitir. Tambien es snapshot. */
    customerEmail: text('customer_email'),
    /** Que se esta cobrando: "instalacion de red", "contrato mensual". */
    concept: text('concept').notNull(),
    /** Total pactado en CENTAVOS enteros. Nunca pesos con decimales. */
    amountCents: integer('amount_cents').notNull(),
    /** pending | partial | paid | canceled. Se recalcula, no se elige. */
    status: text('status', { enum: ESTADOS_CARGO }).notNull().default('pending'),
    /** `AAAA-MM-DD`. El dia que se emitio, no el instante. */
    issuedDate: text('issued_date'),
    /** `AAAA-MM-DD`. El dia en que se vence, si se pactó. */
    dueDate: text('due_date'),
    notes: text('notes'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    // El folio es por organizacion. Unico porque dos cargos con el mismo folio en
    // la misma empresa no se pueden distinguir al leerlos, y es tambien la
    // garantia real contra el choque al crear dos veces el mismo folio.
    uniqueIndex('idx_pagos_charges_org_number').on(t.organizationId, t.number),
    // La consulta que hace la pantalla todo el tiempo: "que me deben, y que ya
    // esta vencido". Las tres columnas se filtran siempre juntas.
    index('idx_pagos_charges_org_status_due').on(t.organizationId, t.status, t.dueDate),
  ],
);

/**
 * Un abono recibido: dinero que entro por un cargo.
 *
 * NO es una tabla `payments`. Ver la cabecera de este archivo: la tabla `payments`
 * del Core es la suscripcion que el cliente le paga a AMG, y esta es la cartera
 * que la empresa le cobra a sus clientes. Son dos cosas distintas en dos bases
 * distintas, y por eso esta se llama `charge_payments`.
 *
 * `amount_cents` es POSITIVO: un abono suma, y lo que se devuelve al cliente es un
 * documento distinto con su propia razon social, no un abono negativo. La
 * invariante que lo hace coherente es que un abono nunca puede pasar el saldo:
 * si lo pasara, el cargo quedaria debiendole plata al cliente y la cartera
 * mentiria. Esa comprobacion vive en `routes.ts` y se hace DENTRO de la
 * transaccion que escribe el abono, porque comprobarla antes deja una ventana
 * entre el chequeo y la escritura.
 *
 * `charge_id` es NOT NULL y va con ON DELETE CASCADE. Un abono sin cargo no
 * significa nada, y si el cargo se borra de verdad sus abonos se van con el,
 * porque consultarlos seria consultar basura. El borrado en cascada lo decide el
 * DDL, no el codigo: si dependiera de acordarse, algun dia se cuela un camino que
 * borra el cargo y deja los abonos colgando.
 *
 * `method` son cuatro valores cerrados: como entro el dinero importa para cerrar
 * la caja del dia, y un texto libre ("transferencia banco") dejaria la columna
 * sin poder agrupar.
 *
 * `received_at` es un INSTANTE ISO, no una fecha: un abono se registra mientras
 * pasa, y el dia de la caja es la pregunta que se hace al mirar la lista. A
 * diferencia de `due_date`, aqui importa la hora, porque dos abonos del mismo dia
 * tienen que poder ordenarse.
 *
 * No tiene `updated_at` porque NO se edita: un abono es un hecho de caja. Corregir
 * en silencio uno que se escribio mal es peor que escribirlo dos veces, porque la
 * fila deja de decir que paso y pasa a decir lo que alguien escribio despues.
 */
export const chargePayments = sqliteTable(
  'charge_payments',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    chargeId: text('charge_id')
      .notNull()
      .references(() => charges.id, { onDelete: 'cascade' }),
    /** Cuanto entro, en CENTAVOS enteros y positivo. */
    amountCents: integer('amount_cents').notNull(),
    /** cash | card | transfer | other. */
    method: text('method').notNull().default('other'),
    /** Comprobante del abono: "transferencia 12345", "boleta 8891". */
    reference: text('reference'),
    /** Instante ISO UTC de cuando se recibio el dinero. */
    receivedAt: text('received_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // La consulta del tablero: "cuanto entro este mes". El indice va en ese orden
    // porque `received_at` se filtra por un rango (el mes) y siempre junto a la
    // organizacion, y sin la organizacion al principio seria un barrido de tabla.
    index('idx_pagos_charge_payments_org_received').on(t.organizationId, t.receivedAt),
    // La consulta de la ficha y del saldo: cuanto se ha cobrado de ESTE cargo.
    index('idx_pagos_charge_payments_charge').on(t.chargeId),
  ],
);

/**
 * Devoluciones: plata que SALIO de la empresa despues de haber entrado.
 *
 * Es una tabla aparte y no un abono con signo menos por tres razones:
 *
 *   1. `charge_payments` tiene `CHECK (amount_cents > 0)`. Ese CHECK es la ultima
 *      linea de defensa del saldo, y un abono negativo lo reventaria desde adentro
 *      de la base, que es el unico lugar del que no se puede recuperar con un 409.
 *   2. Una devolucion necesita su propia razon ("se devuelve por el trabajo mal
 *      hecho"), mientras que el abono es solo "entro plata". Meter el motivo en el
 *      `reference` del abono seria disfrazar un dato de caja de texto libre.
 *   3. Los dos se necesitan por separado para el tablero: lo que entro este mes y
 *      lo que salio este mes son cifras distintas y sumarlas en una sola columna
 *      daria un numero que no es ninguno de los dos.
 *
 * Es lo que los dos 409 de `routes.ts` ya prometian: borrar dice "se cancela",
 * cancelar dice "primero hay que devolver esa plata". Sin esta tabla, las dos
 * frases eran un consejo que el producto no sabia cumplir, y el abono quedaba
 * atrapado para siempre porque tampoco se puede borrar.
 */
export const chargeRefunds = sqliteTable(
  'charge_refunds',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    chargeId: text('charge_id')
      .notNull()
      .references(() => charges.id, { onDelete: 'cascade' }),
    /** Cuanto salio, en CENTAVOS enteros y positivo. */
    amountCents: integer('amount_cents').notNull(),
    /** Por que se devolvio. A diferencia del abono, aqui es obligatorio. */
    reason: text('reason').notNull(),
    /** cash | card | transfer | other. */
    method: text('method').notNull().default('other'),
    /** Comprobante de la salida: "recibo 8891", "transferencia 12345". */
    reference: text('reference'),
    /** Instante ISO UTC de cuando salio el dinero. */
    refundedAt: text('refunded_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    // La ficha del cargo y el saldo devuelto: la misma consulta que el abono.
    index('idx_pagos_charge_refunds_charge').on(t.chargeId),
    // Lo que salio por mes y por empresa, para el tablero.
    index('idx_pagos_charge_refunds_org_refunded').on(t.organizationId, t.refundedAt),
  ],
);

/**
 * Preferencias de la organizacion.
 *
 * Una fila por organizacion, con indice UNIQUE: es lo que evita que dos personas
 * guardando la configuracion a la vez dejen dos filas compitiendo. Sin ese
 * indice, `leerPreferencias` devolveria una de las dos al azar.
 *
 * La moneda y la zona horaria son de la EMPRESA, no de la persona que esta
 * mirando: si las guardara por usuario, dos personas de la misma empresa verian
 * los mismos numeros con simbolos distintos. Y la zona horaria no es decorativa
 * en este producto: es la que decide que dia es hoy para el reporte de
 * antiguedad y cual es el mes en curso del "cobrado del mes".
 */
export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    currency: text('currency').notNull().default('$'),
    timezone: text('timezone').notNull().default('America/Santiago'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [uniqueIndex('idx_pagos_settings_org').on(t.organizationId)],
);

export const pagosSchema = {
  charges,
  chargePayments,
  chargeRefunds,
  settings,
};
