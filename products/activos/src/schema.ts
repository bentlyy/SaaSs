import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Esquema de activos: el patrimonio de la empresa y su historial.
 *
 * Que este producto sea ESTO y no otra cosa importa, porque "activo" es una
 * palabra que en este repo ya significa otra cosa:
 *
 *   - Los REPUESTOS que se venden son del producto `inventario`, con su stock y
 *     su precio. Aca no hay ni un solo stock: lo que se controla es lo que la
 *     empresa POSEE.
 *   - La persona que usa un equipo no es un `customer` de `crm` ni un
 *     `staff` de `citas`. Es un nombre escrito al vuelo en `assigned_to`, y esa
 *     es una decision importante: un activo se le entrega a un proveedor, a un
 *     tecnico o al socio que lo lleva puesto, y ninguno de esos es una ficha
 *     de ningun otro producto. Modelarlo como `user_id` obligaria a dar de alta
 *     a alguien solo para poder decir que tiene un taladro.
 *
 * Lo que queda aca son DOS cosas y ninguna mas: QUE se tiene (`assets`, con su
 * estado y quien lo tiene) y QUE le pasó (`asset_movements`, que no se edita).
 *
 * `status` tiene cuatro valores cerrados y no un texto libre, porque las cuatro
 * respuestas a la pregunta "en que esta esto" son distintas de verdad:
 * `active` esta en uso, `repair` esta en el taller, `retired` salio de servicio
 * y `lost` no aparece mas. Un quinto valor libre permitiria escribir "reparado",
 * "baja" o "roto" y la columna dejaria de poder filtrarse.
 *
 * `assigned_to` es TEXTO LIBRE a proposito, por lo mismo que `solicitudes` no
 * exige patente: el responsable de un activo es casi siempre alguien que no
 * tiene cuenta en el sistema, y una FK a `crm` obligaria a inventar una
 * ficha para poder entregar un taladro.
 *
 * `cost_cents` es el unico importe del producto, y esta en CENTAVOS enteros
 * (`INTEGER`), nunca en pesos con decimales. La razon es la de siempre: un
 * float no puede representar 0.10 de forma exacta, y un patrimonio que suma
 * manyas filas de float termina con centavos que no existen. El factor de
 * conversion no vive en este archivo porque no hay conversion que hacer: la
 * columna y la API ya hablan la misma unidad de punta a punta.
 *
 * ESTE PRODUCTO NO TIENE FUENTE LEGACY. No hay ningun producto viejo con datos de
 * activos (los nueve del legacy son agenda, stock, repuestos, documentos y
 * clientes), asi que no se declara `legacy_tenant_map`: una tabla que nunca se
 * llena es ruido que invita a escribir un migrador que no tiene de donde leer.
 *
 * TODA tabla lleva `organization_id` NOT NULL con su indice, y todas las
 * consultas filtran por el. No hay `tenant_id`: la identidad la trae el Core.
 *
 * Los nombres de indice son los mismos que aparecen en `ddl.ts`, a proposito. Si
 * difieren, el DDL crearia un indice y Drizzle otro con las mismas columnas: dos
 * indices para lo mismo, y el segundo no lo usa nadie.
 */

/**
 * Un equipo, una herramienta o un bien de la empresa.
 *
 * `code` es NOT NULL y UNIQUE junto a `organization_id`, y no un numero global:
 * cada empresa numera sus propios activos desde uno, igual que sus ordenes. Dos
 * empresas pueden tener cada una un `EQ-001` sin que sea un problema, y un
 * indice global obligaria a la segunda empresa a inventar otro prefijo.
 *
 * El `code` es ademas el identificador que ve la gente ("el EQ-004"), asi que
 * va primero en la lista y ordena por el.
 *
 * `purchase_date` es una FECHA (`AAAA-MM-DD`), no un instante: "comprado en
 * marzo" es un dia, y guardarlo con hora inventa precision que nadie tiene y
 * corre un dia al convertir de un huso al este.
 */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    /** Etiqueta del bien, unica por empresa: "EQ-004", "NOT-LEN-3". */
    code: text('code').notNull(),
    name: text('name').notNull(),
    /**
     * Familia del bien: "herramienta", "equipo de computo", "vehiculo".
     *
     * Es texto y no una tabla de categorias porque nadie mantiene un catalogo
     * de categorias de patrimonio, y una FK a un catalogo vacio solo agrega una
     * pantalla que hay que llenar antes de poder registrar un taladro.
     */
    category: text('category').notNull(),
    brand: text('brand'),
    model: text('model'),
    /** Numero de serie del fabricante. Distingue dos equipos del mismo modelo. */
    serial: text('serial'),
    status: text('status').notNull().default('active'),
    location: text('location'),
    /**
     * Quien lo tiene ahora, en texto libre. Un empleado, un proveedor, un
     * tecnico: casi ninguno tiene cuenta en el sistema.
     */
    assignedTo: text('assigned_to'),
    /** `AAAA-MM-DD`. El dia que se compro, no el instante. */
    purchaseDate: text('purchase_date'),
    /** Costo de compra en CENTAVOS enteros. Nunca pesos con decimales. */
    costCents: integer('cost_cents').notNull().default(0),
    notes: text('notes'),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at'),
  },
  (t) => [
    // El codigo es unico POR EMPRESA. Unico porque dos activos con el mismo
    // codigo en la misma empresa no se distinguen ni al leerlos ni al
    // contarlos, y es tambien la garantia real contra el choque al crear dos
    // veces el mismo bien.
    uniqueIndex('idx_activos_assets_org_code').on(t.organizationId, t.code),
    // "Que tengo activo y de que tipo": es la consulta del tablero y la del
    // filtro de la pantalla. El indice va en ese orden porque las dos columnas
    // se filtran siempre juntas.
    index('idx_activos_assets_org_status_category').on(t.organizationId, t.status, t.category),
  ],
);

/**
 * Que le paso a un activo.
 *
 * Es un HISTORIAL, no una agenda: no se agenda nada y no se puede modificar lo
 * que ya ocurrio. Por eso solo tiene `happened_at` y `created_at`, y no
 * `updated_at`. Editar en silencio un movimiento es peor que escribirlo dos
 * veces, porque la fila deja de decir que paso y pasa a decir lo que alguien
 * escribio despues de que pasara.
 *
 * `asset_id` es NOT NULL y va con ON DELETE CASCADE. Un movimiento sin activo
 * no se puede leer: nadie sabe de que equipo hablabamos. Y si el activo se
 * borra de verdad, sus movimientos se van con el, porque consultarlos seria
 * consultar basura.
 *
 * `kind` son cuatro valores cerrados: `checkin`, `checkout`, `maintenance` y
 * `loss`. Cada uno deja el activo en un estado concreto, y esa regla vive en
 * `routes.ts` porque es una invariante de la API, no del almacenamiento.
 *
 * El indice esta en `(organization_id, asset_id, happened_at)` porque esa es la
 * consulta de la ficha, del movimiento mas nuevo al mas viejo, y porque sin el
 * `organization_id` al principio el filtro obligatorio seria un barrido de tabla.
 */
export const assetMovements = sqliteTable(
  'asset_movements',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    note: text('note'),
    /** Instante ISO UTC de cuando ocurrio. */
    happenedAt: text('happened_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('idx_activos_movements_org_asset_time').on(t.organizationId, t.assetId, t.happenedAt)],
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
 * los mismos numeros con simbolos distintos.
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
  (t) => [uniqueIndex('idx_activos_settings_org').on(t.organizationId)],
);

export const activosSchema = {
  assets,
  assetMovements,
  settings,
};
