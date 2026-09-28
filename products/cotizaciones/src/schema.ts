import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de cotizaciones: presupuestos con lineas, importes en centavos y un
 * estado que avanza.
 *
 * Que este producto sea ESTO y no otra cosa importa, porque el legacy traia 17
 * tablas y este producto es dueno de DOS de ellas (`documents` de los productos
 * legacy `cotizaciones` y `documentos`):
 *
 *   - El cliente NO se duplica aca. Lo absorbio el producto `clientes`, que es su
 *     dueno. Por eso `customer_id` va SUELTO (sin llave foranea) y el nombre del
 *     cliente se COPIA en `customer_name`: una cotizacion tiene que poder leerse
 *     aunque el cliente se renombre, se de de baja o nunca se migre. Es un
 *     snapshot, no una copia de confianza: la fuente de verdad del cliente sigue
 *     siendo el producto `clientes`.
 *   - La agenda es de `citas`, el stock de `inventario`, los espacios de
 *     `espacios`. Aca no hay ni una fila de eso.
 *
 * `number` es el FOLIO y es unico por organizacion, no global. Dos empresas
 * pueden tener cada una su cotizacion numero 1, y en la practica las dos empiezan
 * en 1: si el folio fuera global, la segunda empresa en abrir no podria empezar.
 * Por eso el indice UNICO es `(organization_id, number)` y no `number` solo.
 *
 * El dinero esta en CENTAVOS, enteros, en las tres columnas de importe
 * (`subtotal_cents`, `tax_cents`, `total_cents`) y en las dos de linea. Nunca
 * en float: 0.1 + 0.2 en punto flotante da 0.30000000000000004, y un total que
 * no cuadra centavo a centavo es un total que nadie puede emitir.
 *
 * `tax_rate_bp` esta en PUNTOS BASICOS (1600 = 16%), no en porcentaje ni en
 * fracción: 16% es 0.16, y guardar una tasa en float es la forma rapida de que
 * el impuesto de una cotizacion sea de un centavo distinto al que se cotizo. Un
 * entero de puntos basicos no tiene error de redondeo.
 *
 * `subtotal_cents`, `tax_cents` y `total_cents` son valores MATERIALIZADOS, no
 * formulas que se calculen al leer: una cotizacion aceptada tiene que seguir
 * valiendo lo que valio el dia que se acepto, aunque manana cambien los precios
 * o la tasa de impuesto.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/**
 * La cotizacion. El centro de todo.
 *
 * `issue_date` y `valid_until` son FECHAS (`AAAA-MM-DD`), no instantes: lo que
 * responde la primera es "desde cuando cotiza" y la segunda "hasta cuando vale
 * esta oferta". Guardarlas como texto evita el corrimiento de dia que aparece
 * al convertir una fecha local a UTC en un huso al oeste, y evita que el navegador
 * y el servidor discrepen sobre que dia es hoy.
 */
export const quotes = sqliteTable(
  'quotes',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    /** Folio de la empresa. Unico por organizacion, NO global. */
    number: integer('number').notNull(),
    /**
     * Nombre del cliente en el momento de cotizar.
     *
     * Es un SNAPSHOT y por eso es NOT NULL aunque `customer_id` sea nulo: la
     * linea de un presupuesto tiene que poder leerse sola. Si el nombre se
     * buscara en vivo en el producto `clientes`, cambiar el nombre de un cliente
     * reescribiria la historia de cotizaciones viejas.
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
    customerEmail: text('customer_email'),
    title: text('title'),
    /** draft | sent | accepted | rejected | expired. */
    status: text('status').notNull().default('draft'),
    issueDate: text('issue_date'),
    validUntil: text('valid_until'),
    /** Puntos basicos: 1600 = 16%. Entero, nunca float. */
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    subtotalCents: integer('subtotal_cents').notNull().default(0),
    taxCents: integer('tax_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull().default(0),
    notes: text('notes'),
    /** Se sella sola al pasar a `sent`. El legacy no traia esta fecha. */
    sentAt: text('sent_at'),
    /** Se sella sola al pasar a `accepted`. El legacy no traia esta fecha. */
    acceptedAt: text('accepted_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    index('idx_cotizaciones_quotes_org').on(t.organizationId),
    // El folio es por organizacion. Unico porque dos cotizaciones con el mismo
    // folio en la misma empresa no se pueden distinguir al leerlas.
    uniqueIndex('idx_cotizaciones_quotes_org_number').on(t.organizationId, t.number),
    // La consulta que hace la pantalla todo el tiempo: "que cotizo este mes y en
    // que estado esta".
    index('idx_cotizaciones_quotes_estado').on(t.organizationId, t.status, t.issueDate),
  ],
);

/**
 * Linea de la cotizacion, con el precio CONGELADO al momento de cotizar.
 *
 * `unit_price_cents` y `line_total_cents` son los importes pactados, no los del
 * catalogo: si manana sube el precio del mismo trabajo, esta cotizacion sigue
 * valiendo lo que valio cuando se hizo.
 *
 * `qty` es REAL a proposito: media hora de consultoria o 2,5 dias de trabajo son
 * fracciones reales y no un numero entero. El importe SIEMPRE se redondea a
 * centavo entero (`Math.round`) antes de guardarse; el float solo existe como
 * cantidad.
 */
export const quoteLines = sqliteTable(
  'quote_lines',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    /**
     * La cotizacion a la que pertenece la linea. `ON DELETE CASCADE` en el DDL:
     * una linea sin cotizacion no significa nada, y dejarla huerfana seria
     * consultar basura.
     */
    quoteId: text('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    /** Orden en que se leen. Sale del indice de la lista, no de un contador. */
    position: integer('position').notNull(),
    description: text('description').notNull(),
    qty: real('qty').notNull().default(1),
    unitPriceCents: integer('unit_price_cents').notNull().default(0),
    lineTotalCents: integer('line_total_cents').notNull().default(0),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('idx_cotizaciones_lines_org').on(t.organizationId),
    // Como se lee una cotizacion: sus lineas, en orden.
    index('idx_cotizaciones_lines_quote').on(t.quoteId, t.position),
  ],
);

/**
 * Preferencias de la organizacion.
 *
 * La moneda y la zona horaria vienen del tenant legacy. `default_tax_rate_bp` NO
 * se deduce de los datos: las cotizaciones migradas traen la tasa que se les
 * aplico, pero suponer cual era la "preferida" seria inventar. Se arranca en 0 y
 * el migrador informa en pantalla la tasa que mas se uso, para que la elija
 * alguien.
 */
export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    currency: text('currency').notNull().default('$'),
    timezone: text('timezone').notNull().default('America/Santiago'),
    /** Tasa de impuesto que se propone al cotizar, en puntos basicos. */
    defaultTaxRateBp: integer('default_tax_rate_bp').notNull().default(0),
    /** Dias de vigencia que se proponen en `valid_until`. */
    validityDays: integer('validity_days').notNull().default(30),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  // Una fila por organizacion: el indice unico es lo que evita que dos personas
  // guardando la configuracion a la vez dejen dos filas compitiendo.
  (t) => [uniqueIndex('idx_cotizaciones_settings_org').on(t.organizationId)],
);

/**
 * Mapa tenant legacy -> organizacion del Core.
 *
 * Se declara al final porque es la tabla de la que salen todas las
 * `organization_id`. Es lo que hace que la migracion sea re-ejecutable: la
 * segunda corrida lee el mapa y no vuelve a crear la organizacion.
 *
 * Y es lo que hace que DOS bases legacy con el MISMO `tenants.id` terminen en la
 * misma organizacion: las dos son la misma empresa, partida en dos productos
 * viejos. Por eso los folios de las dos pueden chocar entre si.
 */
export const cotizacionesSchema = {
  quotes,
  quoteLines,
  settings,
};
