/**
 * Migracion de las ordenes de trabajo del legacy de `talleres` a
 * `solicitudes.sqlite`.
 *
 * No es "una base vieja -> un producto". Hoy trae una sola fuente, pero el
 * criterio ya es el de todos los productos: cada tenant legacy se vuelve una
 * organizacion del Core, y los ids legacy se conservan para que la pasada sea
 * re-ejecutable.
 *
 *   products/talleres/data/app.db -> Talleres El Mecanico (7 ordenes)
 *
 * Lo que se encontro al mirar la base, y como se resolvio cada cosa:
 *
 *   - El legacy guardaba en cada orden la marca, el modelo, la patente, el anio
 *     y el kilometraje del vehiculo. ESTE PRODUCTO NO TIENE VEHICULOS: es para
 *     cualquier rubro, y un producto que exige patente no sirve para una
 *     instalacion electrica. Esos cinco campos NO se copian a ningun lado, y no
 *     se tiran en silencio: se cuentan y se reportan al final de la corrida, con
 *     el numero exacto de ordenes que los tenian. Lo que las reemplaza es el
 *     campo `asset`, un texto libre, que va NULL en las ordenes migradas
 *     justamente porque aca no hay un equivalente fiel de "Nissan Versa a123bc".
 *
 *   - Los 7 estados que traia el legacy (received, estimated, in_progress, done,
 *     cancelled) se conservan tal cual. Es el flujo de un taller de verdad, y
 *     cambiarlo seria inventar una mejora que nadie pidio.
 *
 *   - `work_order_services.price_at` y `work_order_parts.unit_price_at` son los
 *     precios PACTADOS. Son autoritativos: se copian tal cual y nunca se
 *     multiplican por 100. El precio del catalogo (`services.price`) solo se
 *     usa para las ordenes nuevas en las que la linea no trae precio.
 *
 *   - El legacy NO guardaba el total de la orden. Se calcula como la suma del
 *     trabajo pactado mas la cantidad por el precio unitario de cada repuesto, y
 *     se materializa en `total_cents`: si manana suben los precios, una orden ya
 *     cerrada tiene que seguir valiendo lo que valio.
 *
 *   - `work_order_parts` apunta a `inventory_items`, que NO son de este producto:
 *     los absorbio `inventario`, que es su dueno. Se copian el id y una foto del
 *     nombre (`item_name`) para que la linea se pueda leer sin abrir el otro
 *     producto, y las dos tablas de inventario se reportan como tables sin
 *     equivalente aca.
 *
 *   - `staff` (3 personas) se migra a `technicians`. No son usuarios: son las
 *     personas que ejecutan el trabajo, y 6 de las 7 ordenes los nombran.
 *
 *   - `customers.birthdate` no tiene destino. La fecha de cumpleaños es para
 *     recordatorios de una peluqueria, que es el origen de este legacy; en una
 *     orden de trabajo no significa nada. Se reporta.
 *
 *   - El resto de tablas del legacy (appointments, documents, followups,
 *     reminder_logs, resources, staff_services) estan VACIAS. No se mencionan en
 *     el informe porque una tabla vacia no es una perdida: se contarian y
 *     saldria "0 filas sin destino", que suena a problema donde no hay nada.
 *
 *   npm run migrate:legacy -w @amg/solicitudes
 *   npm run migrate:legacy -w @amg/solicitudes -- --legacy products/talleres/data/app.db --origen talleres
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeCoreDb, getCoreDb } from '@amg/platform';
import {
  LegacyReader,
  autoresSinCore,
  loadProductConfig,
  mapearAutores,
  openProductDb,
  resolverOrganizacion,
  type InformeMigracion,
} from '@amg/product-runtime';
import { DDL } from './ddl.js';
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

export class ErrorMigracion extends Error {}

interface LegacyWorkOrder {
  id: string;
  tenant_id: string;
  number: number;
  customer_id: string;
  staff_id: string | null;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_plate: string;
  vehicle_year: number | null;
  vehicle_odo: number | null;
  status: string;
  estimated_delivery: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
interface LegacyOrderService {
  id: string;
  tenant_id: string;
  order_id: string;
  service_id: string;
  price_at: number;
}
interface LegacyOrderPart {
  id: string;
  tenant_id: string;
  order_id: string;
  item_id: string;
  qty: number;
  unit_price_at: number;
}
interface LegacyItem {
  id: string;
  tenant_id: string;
  name: string;
}
interface LegacyCustomer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  birthdate: string | null;
  notes: string | null;
  tags: string | null;
  created_at: string;
}
interface LegacyService {
  id: string;
  tenant_id: string;
  name: string;
  duration_min: number;
  price: number;
  description: string | null;
  active: number;
  created_at: string;
}
interface LegacyStaff {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  color: string;
  active: number;
  created_at: string;
}

export interface FuenteLegacy {
  etiqueta: string;
  ruta: string;
}
export interface OpcionesMigracion {
  destinoPath: string;
  fuentes: FuenteLegacy[];
  /** `id_tenant=slug` para mapear a mano cuando el slug legacy no sirve. */
  overrides?: Map<string, string>;
}

/** Lo que el legacy trae y el destino NO tiene, para que quede escrito. */
export interface SinEquivalente {
  tabla: string;
  filas: number;
  motivo: string;
}

export interface ResumenSolicitudes {
  porOrganizacion: Array<{
    legacy: string;
    organizationId: string;
    accion: string;
    ordenes: number;
    trabajos: number;
    lineas: number;
    partes: number;
    clientes: number;
    tecnicos: number;
  }>;
  /** Totales que el legacy no guardaba y se calcularon. */
  totalesCalculados: number;
  /** Tablas del legacy que no tienen destino aqui. */
  sinEquivalente: SinEquivalente[];
  /**
   * CAMPOS del legacy que no tienen destino, contados por orden.
   *
   * Esto va aparte de `sinEquivalente` porque esos no son tablas: son columnas
   * de una tabla que SI se migra. Perderlas es tan real como perder una tabla, y
   * si no se cuentan, la proxima persona que mire el informe asume que la orden
   * se migro completa.
   */
  camposSinDestino: Array<{ campo: string; ordenes: number; motivo: string }>;
  /** Personas que aparecen en mas de una organizacion. */
  personasRepetidas: Array<{ nombre: string; organizaciones: string[] }>;
  /** Estados de orden que no estaban en la lista. */
  estadosDesconocidos: string[];
  /**
   * Lineas que apuntan a algo que no existe en el legacy.
   *
   * No va en `informe.discrepancias` porque esa lista es para diferencias de
   * dinero, y esta no es una: es una referencia colgando. Mezclarlas haria que un
   * informe de precios malereciera dos cosas que no tienen nada que ver.
   */
  referenciasSinDestino: string[];
  /** Ordenes sin tecnico asignado. */
  sinTecnico: number;
  totalLegacy: Record<string, number>;
  totalDestino: Record<string, number>;
  /** Filas que ya estaban, por tabla del destino. */
  omitidasPorTabla: Record<string, number>;
}

export interface ResultadoMigracion {
  informe: InformeMigracion;
  resumen: ResumenSolicitudes;
  cerrar: () => void;
}

/**
 * Estados que el destino conoce.
 *
 * Lo que no este en la lista NO se tira: se migra como `received` y se reporta. Un
 * estado que el destino no tiene puede ser un estado nuevo del legacy, y perder
 * una orden por un texto es peor que dejarla sin confirmar.
 */
const ESTADOS: Record<string, string> = {
  received: 'received',
  estimated: 'estimated',
  in_progress: 'in_progress',
  done: 'done',
  cancelled: 'cancelled',
};

/** Tiene que ser el mismo default que el de la columna en el DDL. */
const COLOR_POR_DEFECTO = '#4f46e5';

export function migrarLegacy(opciones: OpcionesMigracion): ResultadoMigracion {
  const { destinoPath, fuentes, overrides = new Map() } = opciones;

  /**
   * Se comprueba que exista AL MENOS UNA fuente antes de abrir el destino.
   *
   * Al reves, correr la migracion sin datos creaba una base nueva vacia y
   * reportaba "terminada, 0 migrados", que es lo mas parecido a un exito que
   * puede ser. Acá no se abre nada: si no hay nada que migrar, se dice.
   */
  const rutas = fuentes.map((f) => ({ ...f, absoluta: resolve(f.ruta) }));
  const existentes = rutas.filter((f) => existsSync(f.absoluta));
  if (existentes.length === 0) {
    throw new ErrorMigracion(
      `No se encontro ninguna base legacy que migrar:\n${rutas
        .map((f) => `  - ${f.etiqueta}: ${f.absoluta}`)
        .join('\n')}`,
    );
  }

  const config = loadProductConfig('solicitudes', 'Solicitudes y Ordenes', {
    DB_PATH: destinoPath,
    DB_SCHEMA_VERSION: '1',
  });
  const destino = openProductDb(config, {
    ddl: DDL,
    schema: {
      customers,
      services,
      technicians,
      orders,
      orderServices,
      orderParts,
      settings,
      legacyTenantMap,
    },
  });
  const db = destino.db;

  // El Core se abre aca: sin el no hay a que organizacion apuntar.
  getCoreDb();

  const readers: LegacyReader[] = [];
  const informe: InformeMigracion = {
    organizaciones: [],
    escritas: {},
    omitidas: 0,
    autoresSinCore: [],
    discrepancias: [],
    leidas: {},
  };
  const resumen: ResumenSolicitudes = {
    porOrganizacion: [],
    totalesCalculados: 0,
    sinEquivalente: [],
    camposSinDestino: [],
    personasRepetidas: [],
    estadosDesconocidos: [],
    referenciasSinDestino: [],
    sinTecnico: 0,
    totalLegacy: {},
    totalDestino: {},
    omitidasPorTabla: {},
  };

  const anotar = (tabla: string, n = 1) => {
    informe.escritas[tabla] = (informe.escritas[tabla] ?? 0) + n;
  };
  const leer = (tabla: string, n: number) => {
    informe.leidas[tabla] = (informe.leidas[tabla] ?? 0) + n;
    resumen.totalLegacy[tabla] = (resumen.totalLegacy[tabla] ?? 0) + n;
  };

  /**
   * ¿Ya esta esta fila? El id legacy se conserva, asi que eso es la idempotencia
   * entera: una segunda pasada no duplica nada.
   */
  const yaEsta = (tabla: any, id: string, nombre?: string): boolean => {
    const existe =
      db.select({ id: tabla.id }).from(tabla).where(eq(tabla.id, id)).get() !== undefined;
    // Se anotan por tabla, no en un total unico: si no, el informe de la
    // segunda pasada solo puede decir "ya habia 25" y no cuales.
    if (existe && nombre) {
      resumen.omitidasPorTabla[nombre] = (resumen.omitidasPorTabla[nombre] ?? 0) + 1;
    }
    return existe;
  };

  const correr = destino.sqlite.transaction(() => {
    /** El nombre de una persona ya visto, para detectar repetidos entre orgs. */
    const nombreEnOrganizacion = new Map<string, Set<string>>();

    for (const fuente of existentes) {
      const reader = new LegacyReader(fuente.absoluta);
      readers.push(reader);
      reader.exigir(['tenants', 'work_orders', 'customers', 'services']);

      for (const tenant of reader.tenants()) {
        const res = resolverOrganizacion(tenant, { mapa: legacyTenantMap, db, overrides });
        informe.organizaciones.push(res);
        const org = res.organizationId;

        const autores = mapearAutores(reader.users());
        informe.autoresSinCore = autoresSinCore(autores.values());

        const conteo = {
          legacy: `${tenant.name} (${tenant.slug}) <- ${fuente.etiqueta}`,
          organizationId: org,
          accion: res.accion,
          ordenes: 0,
          trabajos: 0,
          lineas: 0,
          partes: 0,
          clientes: 0,
          tecnicos: 0,
        };

        // ── Preferencias, desde la fila del tenant.
        // El legacy no tenia tabla `settings`: la moneda y la zona vivian en
        // `tenants`.
        const configDeOrg = db
          .select({ id: settings.id })
          .from(settings)
          .where(eq(settings.organizationId, org))
          .get();
        if (!configDeOrg) {
          db.insert(settings)
            .values({
              id: `cfg_${tenant.id}`,
              organizationId: org,
              timezone: tenant.timezone || 'America/Santiago',
              currency: tenant.currency || '$',
              // El folio siguiente se deja en 1 y se ajusta mas abajo, con el
              // maximo de las ordenes migradas. Ponerlo a mano antes de saber
              // cuantas ordenes hay seria inventar un numero.
              nextNumber: 1,
              createdAt: new Date().toISOString(),
            })
            .run();
          anotar('settings');
        }

        // ── Tecnicos (el `staff` del legacy).
        const legacyStaff = reader.filas<LegacyStaff>(
          'SELECT * FROM staff WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('staff', legacyStaff.length);
        for (const s of legacyStaff) {
          if (yaEsta(technicians, s.id, 'technicians')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(technicians)
            .values({
              id: s.id,
              organizationId: org,
              name: s.name,
              phone: s.phone,
              email: s.email,
              // La columna no admite nulos y el legacy los admite: si alguna vez
              // aparece una fila sin color, entra con el default en vez de romper
              // la carga de la fila entera.
              color: s.color ?? COLOR_POR_DEFECTO,
              active: s.active === 1,
              createdAt: s.created_at,
            })
            .run();
          anotar('technicians');
          conteo.tecnicos += 1;
        }

        // ── Trabajos (el `services` del legacy).
        const legacyServices = reader.filas<LegacyService>(
          'SELECT * FROM services WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('services', legacyServices.length);
        for (const s of legacyServices) {
          if (yaEsta(services, s.id, 'services')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(services)
            .values({
              id: s.id,
              organizationId: org,
              name: s.name,
              durationMin: s.duration_min,
              priceCents: s.price,
              description: s.description,
              active: s.active === 1,
              createdAt: s.created_at,
            })
            .run();
          anotar('services');
          conteo.trabajos += 1;
        }

        // ── Clientes.
        const legacyCustomers = reader.filas<LegacyCustomer>(
          'SELECT * FROM customers WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('customers', legacyCustomers.length);
        for (const c of legacyCustomers) {
          const vistos = nombreEnOrganizacion.get(c.name) ?? new Set<string>();
          vistos.add(org);
          nombreEnOrganizacion.set(c.name, vistos);
          if (yaEsta(customers, c.id, 'customers')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(customers)
            .values({
              id: c.id,
              organizationId: org,
              name: c.name,
              phone: c.phone,
              email: c.email,
              notes: c.notes,
              tags: c.tags,
              createdAt: c.created_at,
            })
            .run();
          anotar('customers');
          conteo.clientes += 1;
        }

        // ── Ordenes.
        const legacyOrders = reader.filas<LegacyWorkOrder>(
          'SELECT * FROM work_orders WHERE tenant_id = ? ORDER BY number, id',
          tenant.id,
        );
        leer('work_orders', legacyOrders.length);
        /** Las que se insertaron en ESTA pasada: lo que se cuenta al final. */
        const ordenesNuevas = new Set<string>();
        for (const o of legacyOrders) {
          if (o.staff_id) {
            // Si el tecnico no existe, la referencia quedaria colgando. Con
            // ON DELETE SET NULL no rompe, pero una orden que apunta a nadie es
            // una orden sin responsable, y eso es mejor verlo en el informe que
            // descobrirlo en la pantalla.
            const existe = legacyStaff.find((s) => s.id === o.staff_id);
            if (!existe) {
              throw new ErrorMigracion(
                `La orden ${o.number} de ${tenant.slug} apunta al tecnico ${o.staff_id}, ` +
                  'que no esta en el legacy. Revisa el dato antes de migrar.',
              );
            }
          } else {
            resumen.sinTecnico += 1;
          }
          const estado = ESTADOS[o.status];
          if (!estado) {
            const etiqueta = `${o.status} (orden ${o.number})`;
            if (!resumen.estadosDesconocidos.includes(etiqueta)) {
              resumen.estadosDesconocidos.push(etiqueta);
            }
          }
          if (yaEsta(orders, o.id, 'orders')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(orders)
            .values({
              id: o.id,
              organizationId: org,
              number: o.number,
              customerId: o.customer_id,
              technicianId: o.staff_id,
              // El legacy no tiene un "sobre que se trabaja" generico: solo
              // vehiculos. Va NULL a proposito. Inventar aqui un
              // "Nissan Versa" como si fuera el equivalente seria mentir sobre
              // lo que se migro.
              asset: null,
              status: estado ?? 'received',
              estimatedDelivery: o.estimated_delivery,
              notes: o.notes,
              // El legacy no guardaba total: se calcula abajo y se materializa.
              totalCents: 0,
              createdAt: o.created_at,
              updatedAt: o.updated_at,
            })
            .run();
          anotar('orders');
          conteo.ordenes += 1;
          ordenesNuevas.add(o.id);
        }

        // ── Trabajo de cada orden, y repuestos.
        const legacyLines = reader.filas<LegacyOrderService>(
          `SELECT * FROM work_order_services WHERE tenant_id = ? ORDER BY order_id, id`,
          tenant.id,
        );
        leer('work_order_services', legacyLines.length);
        for (const l of legacyLines) {
          if (yaEsta(orderServices, l.id, 'order_services')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(orderServices)
            .values({
              id: l.id,
              organizationId: org,
              orderId: l.order_id,
              serviceId: l.service_id,
              // `price_at` es lo que se pacto en esa orden: autoritativo, se
              // copia tal cual. Nunca se multiplica.
              priceCents: l.price_at,
            })
            .run();
          anotar('order_services');
          conteo.lineas += 1;
        }

        /**
         * Los repuestos viven en la base de `inventario`, que es otra base. Para
         * que la linea se pueda LEER sin abrir el otro producto, se copia tambien
         * el nombre del item. Si el item no aparece en este legacy, la linea
         * entra igual con el id y un nombre explicito, y se reporta: perder el
         * nombre es molesto, pero perder la linea entera es peor.
         */
        // Se pregunta con `tiene` porque una base sin `inventory_items` es
        // valida: las ordenes de una empresa de servicios pueden no tener
        // catalogo de repuestos, y una linea de repuesto sin nombre sigue
        // siendo una linea de repuesto.
        const legacyItems = reader.tiene('inventory_items')
          ? reader.filas<LegacyItem>(
              'SELECT id, tenant_id, name FROM inventory_items WHERE tenant_id = ?',
              tenant.id,
            )
          : [];
        const legacyParts = reader.filas<LegacyOrderPart>(
          'SELECT * FROM work_order_parts WHERE tenant_id = ? ORDER BY order_id, id',
          tenant.id,
        );
        leer('work_order_parts', legacyParts.length);
        for (const p of legacyParts) {
          if (yaEsta(orderParts, p.id, 'order_parts')) {
            informe.omitidas += 1;
            continue;
          }
          const item = legacyItems.find((i) => i.id === p.item_id);
          if (!item) {
            resumen.referenciasSinDestino.push(
              `La linea de repuesto ${p.id} apunta al item ${p.item_id}, que no esta ` +
                'en el inventory_items de este legacy. Entro con el id y sin nombre.',
            );
          }
          db.insert(orderParts)
            .values({
              id: p.id,
              organizationId: org,
              orderId: p.order_id,
              itemId: p.item_id,
              itemName: item?.name ?? `Repuesto ${p.item_id}`,
              qty: p.qty,
              // `unit_price_at` es lo pactado: autoritativo, se copia tal cual.
              unitPriceCents: p.unit_price_at,
            })
            .run();
          anotar('order_parts');
          conteo.partes += 1;
        }

        // El total es el trabajo pactado mas los repuestos. Se MATERIALIZA
        // porque los precios cambian manana y una orden vieja tiene que seguir
        // valiendo lo que valio el dia que se hizo.
        //
        // El UPDATE corre sobre todas las ordenes de la fuente, no solo sobre
        // las nuevas: si una pasada anterior se corto entre el INSERT y aca, esto
        // la cura. Es idempotente. Lo que se CUENTA son solo las nuevas, para
        // que el informe de la segunda pasada no diga que se calculo nada.
        let maxFolio = 0;
        for (const o of legacyOrders) {
          maxFolio = Math.max(maxFolio, o.number);
          const trabajo = legacyLines
            .filter((l) => l.order_id === o.id)
            .reduce((acc, l) => acc + l.price_at, 0);
          const repuestos = legacyParts
            .filter((p) => p.order_id === o.id)
            .reduce((acc, p) => acc + p.qty * p.unit_price_at, 0);
          destino.sqlite
            .prepare('UPDATE orders SET total_cents = ? WHERE id = ?')
            .run(trabajo + repuestos, o.id);
          if (ordenesNuevas.has(o.id)) resumen.totalesCalculados += 1;
        }

        // El folio siguiente se ajusta con el maximo REAL de las ordenes
        // migradas. Si se dejara en 1, la primera orden nueva chocaria contra el
        // indice unico (organization_id, number) con una orden que ya existe.
        if (maxFolio > 0) {
          destino.sqlite
            .prepare('UPDATE settings SET next_number = ? WHERE organization_id = ?')
            .run(maxFolio + 1, org);
        }

        // ── Lo que este producto NO se lleva.
        // Se cuenta y se dice. Que un dato del legacy no tenga destino es una
        // decision, y una decision que no se escribe es una que alguien va a
        // volver a tomar sin saber que paso.
        //
        // Se pregunta con `tiene` porque no todas las bases legacy tienen todas
        // las tablas, y contarlas en una que no existe tira la migracion entera
        // por algo que no importa: que la base no tenga `inventory_items`.
        //
        // OJO: `contar` lee la columna `n`, asi que el alias es `n` y no otro.
        // Con `COUNT(*) c` devuelve 0 en silencio y el informe miente diciendo
        // que no habia filas.
        if (reader.tiene('inventory_items')) {
          const itemsN = reader.contar(
            'SELECT COUNT(*) n FROM inventory_items WHERE tenant_id = ?',
            tenant.id,
          );
          if (itemsN > 0) {
            resumen.sinEquivalente.push({
              tabla: 'inventory_items',
              filas: itemsN,
              motivo: 'los absorbio el producto `inventario`, que es su dueno',
            });
          }
        }
        if (reader.tiene('inventory_movements')) {
          const movN = reader.contar(
            'SELECT COUNT(*) n FROM inventory_movements WHERE tenant_id = ?',
            tenant.id,
          );
          if (movN > 0) {
            resumen.sinEquivalente.push({
              tabla: 'inventory_movements',
              filas: movN,
              motivo: 'los absorbio el producto `inventario`, que es su dueno',
            });
          }
        }

        // Los CAMPOS que no tienen destino van aparte de las TABLAS, porque se
        // pierden igual de real y el informe tiene que decirlo con el mismo peso.
        // Los cinco del vehiculo se cuentan juntos como UN dato ("de que vehiculo
        // es esta orden"), porque es lo que un humano necesita saber: no le
        // importa cuantos campos tenia, le importa que habia un vehiculo y que
        // aca no esta.
        const conVehiculo = legacyOrders.filter(
          (o) => o.vehicle_make || o.vehicle_model || o.vehicle_plate,
        ).length;
        if (conVehiculo > 0) {
          resumen.camposSinDestino.push({
            campo: 'vehicle_make, vehicle_model, vehicle_plate, vehicle_year, vehicle_odo',
            ordenes: conVehiculo,
            motivo:
              'este producto no tiene vehiculos: es para cualquier rubro. Quedan solo en el legacy',
          });
        }
        const conCumple = legacyCustomers.filter((c) => c.birthdate).length;
        if (conCumple > 0) {
          resumen.camposSinDestino.push({
            campo: 'customers.birthdate',
            ordenes: conCumple,
            motivo:
              'la fecha de cumpleanos es para recordatorios de peluqueria, el origen de este legacy; en una orden no significa nada',
          });
        }

        resumen.porOrganizacion.push(conteo);
      }
    }

    // Personas que aparecen en mas de una organizacion. No se fusionan: cada
    // tenant es su propia empresa, y unificarlas es una decision de negocio, no
    // del migrador.
    for (const [nombre, orgs] of nombreEnOrganizacion) {
      if (orgs.size > 1) {
        resumen.personasRepetidas.push({ nombre, organizaciones: [...orgs] });
      }
    }

    for (const [tabla, n] of Object.entries(informe.escritas)) {
      resumen.totalDestino[tabla] = n;
    }
  });

  /**
   * Se EJECUTA la transaccion. Ojo: `sqlite.transaction(...)` solo la arma y la
   * devuelve; no la corre. Olvidar esta llamada deja la base vacia y el informe
   * dice "terminada" sin una sola fila escrita, que es el falso exito mas
   * peligroso que hay. Los tests cuentan filas en el destino justamente para que
   * esto no pueda volver a pasar en silencio.
   */
  correr();

  // Si se leyó algo del legacy y no se escribió NI SE OMITIÓ nada, no fue una
  // migracion exitosa: fue una que no corrio. Se dice acá, con las dos manos.
  //
  // El caso "se leyó y no se escribió" si es normal: es la segunda pasada de una
  // base ya migrada, y ahi `omitidas` esta lleno. Por eso la condicion mira las
  // dos cosas juntas y no solo las escrituras.
  const leidas = Object.values(informe.leidas).reduce((a, b) => a + b, 0);
  const escritas = Object.values(informe.escritas).reduce((a, b) => a + b, 0);
  if (leidas > 0 && escritas === 0 && informe.omitidas === 0) {
    throw new ErrorMigracion(
      `Se leyeron ${leidas} filas del legacy y no se escribio ni se omito ninguna. ` +
        'Algo impidio que la migracion corriera.',
    );
  }

  return {
    informe,
    resumen,
    cerrar: () => {
      for (const r of readers) r.cerrar();
      destino.close();
      closeCoreDb();
    },
  };
}

// ──────────────────────────────────────────────────────────────────── CLI

/**
 * El CLI solo corre si este archivo es el programa que se ejecuto.
 *
 * Sin este guard, IMPORTAR el modulo desde un test dispara la migracion entera
 * contra las bases legacy REALES y deja los datos en la base real del producto.
 * Es invisible: el test que importa pasa igual, y un rato despues aparece una
 * base con datos de clientes que nadie migro a proposito. Por eso la comparacion
 * es contra `process.argv[1]`, que dice que archivo se esta corriendo de verdad.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  /** Fuentes por defecto: las bases legacy que este producto absorbe. */
  const FUENTES: FuenteLegacy[] = [
    { etiqueta: 'talleres', ruta: '../../products/talleres/data/app.db' },
  ];

  /**
   * Tabla del legacy → tabla del destino.
   *
   * El legacy llama `services` a lo que aca son "trabajos", `staff` a lo que son
   * "tecnicos" y `work_orders` a lo que son "ordenes". Sin este mapa el informe
   * compararia "staff" contra lo que se escribio en "technicians" y saldria
   * cero, que parece una migracion vacia.
   */
  const TABLAS: Record<string, string> = {
    work_orders: 'orders',
    work_order_services: 'order_services',
    work_order_parts: 'order_parts',
    services: 'services',
    staff: 'technicians',
    customers: 'customers',
  };

  const args = process.argv.slice(2);
  const bandera = (nombre: string): string | undefined => {
    const i = args.indexOf(`--${nombre}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const destinoPath = resolve(bandera('destino') ?? './data/solicitudes.sqlite');
  const rutas = bandera('legacy');
  const fuentes: FuenteLegacy[] = rutas
    ? [{ etiqueta: bandera('origen') ?? 'legacy', ruta: rutas }]
    : FUENTES;

  const overrides = new Map<string, string>();
  const parOrganizacion = bandera('org');
  if (parOrganizacion) {
    for (const par of parOrganizacion.split(',')) {
      const [tenantId, slug] = par.split('=');
      if (tenantId && slug) overrides.set(tenantId, slug);
    }
  }

  try {
    const { informe, resumen, cerrar } = migrarLegacy({ destinoPath, fuentes, overrides });

    console.log('\nMigracion de solicitudes terminada.\n');
    for (const o of informe.organizaciones) {
      console.log(`  ${o.legacyName} (${o.legacySlug}) -> ${o.organizationId}  (${o.accion})`);
    }

    console.log('\n  por organizacion:');
    for (const c of resumen.porOrganizacion) {
      console.log(`    ${c.legacy}`);
      console.log(
        `      ordenes ${c.ordenes} | trabajos ${c.trabajos} | clientes ${c.clientes}` +
          ` | tecnicos ${c.tecnicos} | lineas de trabajo ${c.lineas} | repuestos ${c.partes}`,
      );
    }

    /**
     * Conteo tabla por tabla: cuantas filas traia el legacy y cuantas quedaron en
     * el destino.
     *
     * Se imprime el nombre de la tabla LEGACY y el de la tabla DESTINO porque
     * son distintos (`staff` -> `technicians`), y comparar los numeros usando el
     * nombre del legacy daria siempre cero del lado del destino: las escrituras
     * se anotan con el nombre de la tabla nueva.
     *
     * Se suman las omitidas a las escritas porque en una segunda pasada no se
     * escribe nada y todo estaba ya. Marcar eso como descuadre seria hacer sonar
     * una alarma en la corrida mas tranquila que existe.
     */
    console.log('\n  leidas del legacy → presentes en el destino:');
    let descuadre = 0;
    for (const [legacy, destino] of Object.entries(TABLAS)) {
      const leidas = resumen.totalLegacy[legacy] ?? 0;
      if (leidas === 0) continue;
      const escritas = resumen.totalDestino[destino] ?? 0;
      const omitidas = resumen.omitidasPorTabla[destino] ?? 0;
      const total = escritas + omitidas;
      if (total !== leidas) descuadre += 1;
      const marca = total === leidas ? '' : '   <-- NO CUADRA';
      const detalle = omitidas > 0 ? ` (${escritas} nuevas, ${omitidas} ya estaban)` : '';
      console.log(`    ${legacy} → ${destino}: ${leidas} → ${total}${detalle}${marca}`);
    }
    if (descuadre > 0) {
      console.log(`\n  ${descuadre} tabla(s) no cuadran. No se dé por buena esta migracion.`);
    }
    if (informe.omitidas > 0) {
      console.log(`\n  ya estaban (omitidas): ${informe.omitidas}`);
    }

    if (resumen.totalesCalculados > 0) {
      console.log(`\n  ${resumen.totalesCalculados} orden(es) NO tenian total guardado:`);
      console.log('  se calculo con el trabajo pactado y los repuestos, y se guardo en la orden,');
      console.log('  para que cambiar los precios despues no cambie la historia.');
    }

    if (resumen.sinTecnico > 0) {
      console.log(`\n  ${resumen.sinTecnico} orden(es) no tienen tecnico asignado.`);
    }

    if (resumen.camposSinDestino.length > 0) {
      console.log('\n  ATENCION: estos DATOS del legacy NO tienen destino en este producto:');
      for (const c of resumen.camposSinDestino) {
        console.log(`    - ${c.campo}: ${c.ordenes} registro(s). ${c.motivo}.`);
      }
      console.log('  No se copiaron ni se tiraron: quedan solo en el legacy.');
    }

    if (resumen.sinEquivalente.length > 0) {
      console.log('\n  Estas TABLAS del legacy NO tienen destino en este producto:');
      for (const s of resumen.sinEquivalente) {
        console.log(`    - ${s.tabla}: ${s.filas} fila(s). ${s.motivo}.`);
      }
      console.log('  No se copiaron ni se tiraron: quedan solo en el legacy.');
    }

    if (resumen.estadosDesconocidos.length > 0) {
      console.log('\n  Estados de orden desconocidos, quedaron como `received`:');
      for (const e of resumen.estadosDesconocidos) console.log(`    - ${e}`);
    }

    if (resumen.referenciasSinDestino.length > 0) {
      console.log('\n  Estas referencias del legacy apuntan a algo que no existe:');
      for (const d of resumen.referenciasSinDestino) console.log(`    - ${d}`);
      console.log('  La linea se migro igual, con un nombre de reemplazo.');
    }

    if (informe.discrepancias.length > 0) {
      console.log('\n  Discrepancias de dinero:');
      for (const d of informe.discrepancias) {
        console.log(`    - ${d.donde}: ${d.unidades} unidad(es), ${d.centavos} centavos.`);
      }
    }

    if (informe.autoresSinCore.length > 0) {
      console.log('\n  Los siguientes autores del legacy NO estan en el Core:');
      for (const a of informe.autoresSinCore) console.log(`    - ${a}`);
      console.log('  Crealos en el Core y volve a correr la migracion.');
    }

    if (resumen.personasRepetidas.length > 0) {
      console.log('\n  Estas personas aparecen en mas de una organizacion (NO se fusionaron):');
      for (const p of resumen.personasRepetidas) {
        console.log(`    - ${p.nombre}: en ${p.organizaciones.length} organizaciones`);
      }
      console.log('  Decidir si son la misma persona es un juicio de negocio.');
    }

    console.log(`\n  base destino: ${destinoPath}\n`);
    cerrar();
  } catch (e) {
    console.error('\nMIGRACION FALLIDA\n');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
