/**
 * Migración de las reservas legacy a `espacios.sqlite`.
 *
 * No es "una base vieja -> un producto". Hoy trae una sola fuente, pero el
 * criterio ya es el de todos los productos: cada tenant legacy se vuelve una
 * organización del Core, y los ids legacy se conservan para que la pasada sea
 * re-ejecutable.
 *
 *   products/deportes/data/app.db -> Sport Center MX (11 reservas)
 *
 * Lo que se encontró al mirar la base, y cómo se resolvió cada cosa:
 *
 *   - Las 11 reservas traen `resource_id` y `staff_id` nulo. Acá no hay ambigüedad:
 *     un `resource_id` es un espacio, así que las 11 van a espacios. Si alguna
 *     viniera SIN `resource_id`, el migrador se detiene en vez de inventar a qué
 *     espacio pertenece.
 *
 *   - `appointment_services` está VACÍA. No hay ni una línea con el precio
 *     pactado de una reserva, así que no hay contra qué verificar la tarifa por
 *     hora ni los precios de los extras. Por eso el dinero se copia tal cual y se
 *     reporta: no hay conversión que deducir, y `×100` a ciegas arruinaría los
 *     valores. La convención de cada tenant es distinta y eso se verifica
 *     contra datos, no suponiendo.
 *
 *   - El legacy NO guardaba el total de la reserva. Se calcula con la tarifa por
 *     hora y el tiempo ocupado, y se materializa en `total_cents`: si la tarifa
 *     cambia mañana, una reserva vieja tiene que seguir valiendo lo que valió.
 *
 *   - `services` tenía 4 filas y ninguna usada por una reserva. Son extras
 *     (alquiler de equipo, clase grupal), no espacios: van a `addons`.
 *
 *   - `staff` tenía 2 filas —un recepción y una coordinadora— y ninguna reserva
 *     las menciona. Un producto de reserva de espacios no agenda personal, así
 *     que NO se inventa una tabla para guardarlas: se reportan como tabla sin
 *     equivalente en el destino.
 *
 *   - `inventory_items` tenía 4 filas. NO son de este producto: los absorbió
 *     `inventario`, que es su dueño. Se reportan para que nadie busque aquí lo
 *     que está allá, y para que quede escrito que la migración de este producto
 *     no las tocó.
 *
 *   - La jornada (a qué hora abre, a qué hora cierra, de cuánto son las franjas)
 *     NO existía en el legacy. Se usa el valor por defecto y se reporta, porque
 *     un horario inventado en silencio es peor que uno declarado como default.
 *
 *   npm run migrate:legacy -w @amg/espacios
 *   npm run migrate:legacy -w @amg/espacios -- --legacy products/deportes/data/app.db --origen deportes
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
  addons,
  bookingAddons,
  bookings,
  customers,
  legacyTenantMap,
  settings,
  spaces,
} from './schema.js';

export class ErrorMigracion extends Error {}

interface LegacyResource {
  id: string;
  tenant_id: string;
  name: string;
  type: string;
  capacity: number;
  price_per_hour: number;
  color: string | null;
  active: number;
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
interface LegacyCustomer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tags: string | null;
  created_at: string;
}
interface LegacyAppointment {
  id: string;
  tenant_id: string;
  customer_id: string;
  staff_id: string | null;
  resource_id: string | null;
  start_at: string;
  end_at: string;
  notes: string | null;
  status: string;
  created_at: string;
}
interface LegacyAppointmentService {
  id: string;
  tenant_id: string;
  appointment_id: string;
  service_id: string;
  price_at: number;
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

export interface ResumenEspacios {
  porOrganizacion: Array<{
    legacy: string;
    organizationId: string;
    accion: string;
    espacios: number;
    extras: number;
    clientes: number;
    reservas: number;
    lineas: number;
  }>;
  /** Totales que el legacy no guardaba y se calcularon. */
  totalesCalculados: number;
  /** Tablas del legacy que no tienen destino aquí. */
  sinEquivalente: SinEquivalente[];
  /** Personas que aparecen en más de una organización. */
  personasRepetidas: Array<{ nombre: string; organizaciones: string[] }>;
  /** Estados de reserva que no estaban en la lista. */
  estadosDesconocidos: string[];
  /** Tarifas y precios de extras que no se pudieron verificar. */
  dineroSinVerificar: number;
  totalLegacy: Record<string, number>;
  totalDestino: Record<string, number>;
  /** Filas que ya estaban, por tabla del destino. */
  omitidasPorTabla: Record<string, number>;
}

export interface ResultadoMigracion {
  informe: InformeMigracion;
  resumen: ResumenEspacios;
  cerrar: () => void;
}

/**
 * Estados que el destino conoce. Cancelada y `no_show` no ocupan espacio.
 *
 * Lo que no esté en la lista NO se tira: se migra como `pending` y se reporta. Un
 * estado que el destino no tiene puede ser un estado nuevo del legacy, y perder
 * una reserva por un texto es peor que dejar una pendiente sin confirmar.
 */
const ESTADOS: Record<string, string> = {
  pending: 'pending',
  confirmed: 'confirmed',
  done: 'done',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

/** Jornada por defecto, porque el legacy no guardaba ninguna. */
const JORNADA = { openingMinutes: 8 * 60, closingMinutes: 22 * 60, slotMinutes: 60 };

/** Tiene que ser el mismo default que el de la columna en el DDL. */
const COLOR_POR_DEFECTO = '#0891b2';

export function migrarLegacy(opciones: OpcionesMigracion): ResultadoMigracion {
  const { destinoPath, fuentes, overrides = new Map() } = opciones;

  /**
   * Se comprueba que exista AL MENOS UNA fuente antes de abrir el destino.
   *
   * Al revés, correr la migración sin datos creaba una base nueva vacía y
   * reportaba "terminada, 0 migrados", que es lo más parecido a un éxito que
   * puede ser. Acá no se abre nada: si no hay nada que migrar, se dice.
   */
  const rutas = fuentes.map((f) => ({ ...f, absoluta: resolve(f.ruta) }));
  const existentes = rutas.filter((f) => existsSync(f.absoluta));
  if (existentes.length === 0) {
    throw new ErrorMigracion(
      `No se encontró ninguna base legacy que migrar:\n${rutas
        .map((f) => `  - ${f.etiqueta}: ${f.absoluta}`)
        .join('\n')}`,
    );
  }

  const config = loadProductConfig('espacios', 'Espacios', {
    DB_PATH: destinoPath,
    DB_SCHEMA_VERSION: '1',
  });
  const destino = openProductDb(config, {
    ddl: DDL,
    schema: {
      customers,
      spaces,
      addons,
      bookings,
      bookingAddons,
      settings,
      legacyTenantMap,
    },
  });
  const db = destino.db;

  // El Core se abre acá: sin él no hay a qué organización apuntar.
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
  const resumen: ResumenEspacios = {
    porOrganizacion: [],
    totalesCalculados: 0,
    sinEquivalente: [],
    personasRepetidas: [],
    estadosDesconocidos: [],
    dineroSinVerificar: 0,
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
   * ¿Ya está esta fila? El id legacy se conserva, así que eso es la idempotencia
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
      reader.exigir(['tenants', 'resources', 'customers', 'appointments']);

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
          espacios: 0,
          extras: 0,
          clientes: 0,
          reservas: 0,
          lineas: 0,
        };

        // ── Preferencias, desde la fila del tenant.
        // El legacy no tenía tabla `settings`: la moneda y la zona vivían en
        // `tenants`. La jornada no existía, así que va el default y se reporta.
        if (!yaEsta(settings, `cfg_${tenant.id}`, 'settings')) {
          db.insert(settings)
            .values({
              id: `cfg_${tenant.id}`,
              organizationId: org,
              timezone: tenant.timezone || 'America/Santiago',
              currency: tenant.currency || '$',
              ...JORNADA,
              createdAt: new Date().toISOString(),
            })
            .run();
          anotar('settings');
        }

        // ── Espacios (los `resources` del legacy).
        const legacySpaces = reader.filas<LegacyResource>(
          'SELECT * FROM resources WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('resources', legacySpaces.length);
        for (const r of legacySpaces) {
          if (yaEsta(spaces, r.id, 'spaces')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(spaces)
            .values({
              id: r.id,
              organizationId: org,
              name: r.name,
              type: r.type || 'sala',
              capacity: r.capacity,
              // La TARIFA se copia tal cual. No hay ninguna línea de reserva con
              // el precio pactado contra la cual verificarla, y sin esa
              // referencia cualquier conversión sería una suposición.
              pricePerHourCents: r.price_per_hour,
              // La columna no admite nulos y el legacy los admite: si algún día
              // aparece una fila sin color, entra con el default en vez de
              // romper la carga de la fila entera.
              color: r.color ?? COLOR_POR_DEFECTO,
              active: r.active === 1,
              createdAt: r.created_at,
            })
            .run();
          anotar('spaces');
          conteo.espacios += 1;
        }
        // La tarifa no se pudo verificar contra ninguna reserva: se cuenta una
        // por espacio ESCRITO, y el informe lo dice una vez con el número.
        resumen.dineroSinVerificar += conteo.espacios;

        // ── Extras (los `services` del legacy).
        const legacyAddons = reader.filas<LegacyService>(
          'SELECT * FROM services WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('services', legacyAddons.length);
        for (const s of legacyAddons) {
          if (yaEsta(addons, s.id, 'addons')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(addons)
            .values({
              id: s.id,
              organizationId: org,
              name: s.name,
              durationMin: s.duration_min,
              // Igual que la tarifa: sin línea que la contradiga, el valor viaja
              // tal cual.
              priceCents: s.price,
              description: s.description,
              active: s.active === 1,
              createdAt: s.created_at,
            })
            .run();
          anotar('addons');
          conteo.extras += 1;
        }
        resumen.dineroSinVerificar += conteo.extras;

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

        // ── Reservas.
        const legacyBookings = reader.filas<LegacyAppointment>(
          'SELECT * FROM appointments WHERE tenant_id = ? ORDER BY start_at, id',
          tenant.id,
        );
        leer('appointments', legacyBookings.length);
        /** Las que se insertaron en ESTA pasada: lo que se cuenta al final. */
        const reservasNuevas = new Set<string>();
        for (const a of legacyBookings) {
          if (!a.resource_id) {
            // Una reserva sin espacio no es una reserva de este producto: no hay
            // a qué cancha pertenece. Parar es mejor que guardarla en un
            // espacio inventado, porque después nadie la encuentra ni la puede
            // cobrar.
            throw new ErrorMigracion(
              `La reserva ${a.id} de ${tenant.slug} no tiene resource_id: no se sabe a qué espacio pertenece.`,
            );
          }
          if (a.staff_id) {
            // El legacy mezclaba los dos conceptos en una tabla. Una reserva con
            // personal Y espacio es una cita, no un espacio: se reporta para que
            // alguien la revise a mano.
            throw new ErrorMigracion(
              `La reserva ${a.id} de ${tenant.slug} tiene resource_id y staff_id a la vez: ` +
                'no se sabe si es una reserva de espacio o una cita. Revisala a mano.',
            );
          }
          const estado = ESTADOS[a.status];
          if (!estado) {
            const etiqueta = `${a.status} (reserva ${a.id})`;
            if (!resumen.estadosDesconocidos.includes(etiqueta)) {
              resumen.estadosDesconocidos.push(etiqueta);
            }
          }
          if (yaEsta(bookings, a.id, 'bookings')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(bookings)
            .values({
              id: a.id,
              organizationId: org,
              spaceId: a.resource_id,
              customerId: a.customer_id,
              startAt: a.start_at,
              endAt: a.end_at,
              notes: a.notes,
              status: estado ?? 'pending',
              // El legacy no guardaba total: se calcula abajo y se materializa.
              totalCents: 0,
              createdAt: a.created_at,
            })
            .run();
          anotar('bookings');
          conteo.reservas += 1;
          reservasNuevas.add(a.id);
        }

        // ── Extras de la reserva, y el total que el legacy no guardaba.
        const legacyLines = reader.filas<LegacyAppointmentService>(
          `SELECT ase.* FROM appointment_services ase
           JOIN appointments a ON a.id = ase.appointment_id
           WHERE ase.tenant_id = ? ORDER BY ase.appointment_id, ase.id`,
          tenant.id,
        );
        leer('appointment_services', legacyLines.length);

        for (const l of legacyLines) {
          if (yaEsta(bookingAddons, l.id, 'booking_addons')) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(bookingAddons)
            .values({
              id: l.id,
              organizationId: org,
              bookingId: l.appointment_id,
              addonId: l.service_id,
              // `price_at` es lo que se pactó en esa reserva: autoritativo, se
              // copia tal cual. Nunca se multiplica.
              priceCents: l.price_at,
            })
            .run();
          anotar('booking_addons');
          conteo.lineas += 1;
        }

        // El total es la tarifa por el tiempo ocupado, más los extras. Se
        // MATERIALIZA porque la tarifa puede cambiar mañana y una reserva vieja
        // tiene que seguir valiendo lo que valió el día que se hizo.
        //
        // El UPDATE corre sobre todas las reservas de la fuente, no solo sobre
        // las nuevas: si una pasada anterior se cortó entre el INSERT y acá, esto
        // la cura. Es idempotente. Lo que se CUENTA son solo las nuevas, para
        // que el informe de la segunda pasada no diga que se calculó nada.
        for (const a of legacyBookings) {
          const espacio = legacySpaces.find((r) => r.id === a.resource_id);
          if (!espacio) continue; // sin resource_id el migrador ya se detuvo arriba
          const extras = legacyLines
            .filter((l) => l.appointment_id === a.id)
            .reduce((acc, l) => acc + l.price_at, 0);
          const horas = (Date.parse(a.end_at) - Date.parse(a.start_at)) / 3_600_000;
          const total = Math.round(horas * espacio.price_per_hour) + extras;
          destino.sqlite
            .prepare('UPDATE bookings SET total_cents = ? WHERE id = ?')
            .run(total, a.id);
          if (reservasNuevas.has(a.id)) resumen.totalesCalculados += 1;
        }

        // ── Lo que este producto NO se lleva.
        // Se cuenta y se dice. Que una tabla del legacy no tenga destino es una
        // decisión, y una decisión que no se escribe es una que alguien va a
        // volver a tomar sin saber qué pasó.
        //
        // Se pregunta con `tiene` porque no todas las bases legacy tienen todas
        // las tablas, y contarlas en una que no existe tira la migración entera
        // por algo que no importa: que la base no tenga `staff`.
        //
        // OJO: `contar` lee la columna `n`, así que el alias es `n` y no otro.
        // Con `COUNT(*) c` devuelve 0 en silencio y el informe miente diciendo
        // que no había filas.
        if (reader.tiene('staff')) {
          const staffN = reader.contar(
            'SELECT COUNT(*) n FROM staff WHERE tenant_id = ?',
            tenant.id,
          );
          if (staffN > 0) {
            resumen.sinEquivalente.push({
              tabla: 'staff',
              filas: staffN,
              motivo:
                'un producto de reserva de espacios no agenda personal, y ninguna reserva los menciona',
            });
          }
        }
        if (reader.tiene('inventory_items')) {
          const itemsN = reader.contar(
            'SELECT COUNT(*) n FROM inventory_items WHERE tenant_id = ?',
            tenant.id,
          );
          if (itemsN > 0) {
            resumen.sinEquivalente.push({
              tabla: 'inventory_items',
              filas: itemsN,
              motivo: 'los absorbió el producto `inventario`, que es su dueño',
            });
          }
        }

        resumen.porOrganizacion.push(conteo);
      }
    }

    // Personas que aparecen en más de una organización. No se fusionan: cada
    // tenant es su propia empresa, y unificarlas es una decisión de negocio, no
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
   * Se EJECUTA la transacción. Ojo: `sqlite.transaction(...)` solo la arma y la
   * devuelve; no la corre. Olvidar esta llamada deja la base vacía y el informe
   * dice "terminada" sin una sola fila escrita, que es el falso éxito más
   * peligroso que hay. Los tests cuentan filas en el destino justamente para que
   * esto no pueda volver a pasar en silencio.
   */
  correr();

  // Si se leyó algo del legacy y no se escribió NI SE OMITIÓ nada, no fue una
  // migración exitosa: fue una que no corrió. Se dice acá, con las dos manos.
  //
  // El caso "se leyó y no se escribió" sí es normal: es la segunda pasada de una
  // base ya migrada, y ahí `omitidas` está lleno. Por eso la condición mira las
  // dos cosas juntas y no solo las escrituras.
  const leidas = Object.values(informe.leidas).reduce((a, b) => a + b, 0);
  const escritas = Object.values(informe.escritas).reduce((a, b) => a + b, 0);
  if (leidas > 0 && escritas === 0 && informe.omitidas === 0) {
    throw new ErrorMigracion(
      `Se leyeron ${leidas} filas del legacy y no se escribió ni se omitió ninguna. ` +
        'Algo impidió que la migración corriera.',
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
 * El CLI solo corre si este archivo es el programa que se ejecutó.
 *
 * Sin este guard, IMPORTAR el módulo desde un test dispara la migración entera
 * contra las bases legacy REALES y deja los datos en la base real del producto.
 * Es invisible: el test que importa pasa igual, y un rato después aparece una
 * base con datos de clientes que nadie migró a propósito. Por eso la comparación
 * es contra `process.argv[1]`, que dice qué archivo se está corriendo de verdad.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  /** Fuentes por defecto: las bases legacy que este producto absorbe. */
  const FUENTES: FuenteLegacy[] = [
    { etiqueta: 'deportes', ruta: '../../products/deportes/data/app.db' },
  ];

  /**
   * Tabla del legacy → tabla del destino.
   *
   * El legacy llama `resources` a lo que acá es un espacio y `services` a lo que
   * es un extra. Sin este mapa el informe compararía "resources" contra lo que
   * se escribió en "spaces" y saldría cero, que parece una migración vacía.
   */
  const TABLAS: Record<string, string> = {
    resources: 'spaces',
    services: 'addons',
    customers: 'customers',
    appointments: 'bookings',
    appointment_services: 'booking_addons',
  };

  const args = process.argv.slice(2);
  const bandera = (nombre: string): string | undefined => {
    const i = args.indexOf(`--${nombre}`);
    return i >= 0 ? args[i + 1] : undefined;
  };

  const destinoPath = resolve(bandera('destino') ?? './data/espacios.sqlite');
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

    console.log('\nMigración de espacios terminada.\n');
    for (const o of informe.organizaciones) {
      console.log(`  ${o.legacyName} (${o.legacySlug}) -> ${o.organizationId}  (${o.accion})`);
    }

    console.log('\n  por organización:');
    for (const c of resumen.porOrganizacion) {
      console.log(`    ${c.legacy}`);
      console.log(
        `      espacios ${c.espacios} | extras ${c.extras} | clientes ${c.clientes}` +
          ` | reservas ${c.reservas} | extras de reserva ${c.lineas}`,
      );
    }

    /**
     * Conteo tabla por tabla: cuántas filas traía el legacy y cuántas quedaron
     * en el destino.
     *
     * Se imprime el nombre de la tabla LEGACY y el de la tabla DESTINO porque
     * son distintos (`resources` -> `spaces`), y comparar los números usando el
     * nombre del legacy daría siempre cero del lado del destino: las escrituras
     * se anotan con el nombre de la tabla nueva.
     *
     * Se suman las omitidas a las escritas porque en una segunda pasada no se
     * escribe nada y todo estaba ya. Marcar eso como descuadre sería hacer
     * sonar una alarma en la corrida más tranquila que existe.
     */
    console.log('\n  leídas del legacy → presentes en el destino:');
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
      console.log(`\n  ${descuadre} tabla(s) no cuadran. No se dé por buena esta migración.`);
    }
    if (informe.omitidas > 0) {
      console.log(`\n  ya estaban (omitidas): ${informe.omitidas}`);
    }

    if (resumen.totalesCalculados > 0) {
      console.log(`\n  ${resumen.totalesCalculados} reserva(s) NO tenían total guardado:`);
      console.log('  se calculó con la tarifa por hora y se guardó en la reserva,');
      console.log('  para que cambiar la tarifa después no cambie la historia.');
    }

    if (resumen.dineroSinVerificar > 0) {
      console.log(
        `\n  DINERO: ${resumen.dineroSinVerificar} valor(es) NO se pudieron verificar.`,
      );
      console.log('  Esta base no tiene ni una línea de reserva con el precio pactado,');
      console.log('  así que no hay contra qué comparar la tarifa ni los extras. Se copiaron');
      console.log('  tal cual, sin multiplicar por nada. Revisá los precios a mano.');
    }

    if (resumen.sinEquivalente.length > 0) {
      console.log('\n  Estas tablas del legacy NO tienen destino en este producto:');
      for (const s of resumen.sinEquivalente) {
        console.log(`    - ${s.tabla}: ${s.filas} fila(s). ${s.motivo}.`);
      }
      console.log('  No se copiaron ni se tiraron: quedan solo en el legacy.');
    }

    if (resumen.estadosDesconocidos.length > 0) {
      console.log('\n  Estados de reserva desconocidos, quedaron como `pending`:');
      for (const e of resumen.estadosDesconocidos) console.log(`    - ${e}`);
    }

    if (informe.autoresSinCore.length > 0) {
      console.log('\n  Los siguientes autores del legacy NO están en el Core:');
      for (const a of informe.autoresSinCore) console.log(`    - ${a}`);
      console.log('  Crealos en el Core y volvé a correr la migración.');
    }

    if (resumen.personasRepetidas.length > 0) {
      console.log('\n  Estas personas aparecen en más de una organización (NO se fusionaron):');
      for (const p of resumen.personasRepetidas) {
        console.log(`    - ${p.nombre}: en ${p.organizaciones.length} organizaciones`);
      }
      console.log('  Decidir si son la misma persona es un juicio de negocio.');
    }

    console.log(`\n  base destino: ${destinoPath}\n`);
    cerrar();
  } catch (e) {
    console.error('\nMIGRACIÓN FALLIDA\n');
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
