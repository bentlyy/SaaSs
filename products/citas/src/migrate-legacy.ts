/**
 * Migración de las citas legacy a `citas.sqlite`.
 *
 * No es "una base vieja -> un producto". Las citas estaban repartidas en TRES
 * bases legacy, y cada una es un tenant distinto que se vuelve una organización
 * del Core:
 *
 *   products/peluqueria/data/app.db     -> Estética Glow            (9 citas)
 *   products/crm/data/app.db            -> Clientes Vip Studio     (10 citas)
 *   products/recordatorios/data/app.db  -> Estudio Color & Forma   (6 citas)
 *
 * Lo que se encontró al mirar las bases, y cómo se resolvió cada cosa:
 *
 *   - `appointments` trae `resource_id`, que es de canchas, no de citas. Las 25
 *     citas de estos tres tenants lo tienen nulo, así que acá no hay ambigüedad:
 *     las 25 van a citas y las 11 de deportes van a espacios. Si alguna vez
 *     apareciera una con `resource_id`, el migrador se detiene en vez de
 *     adivinar.
 *
 *   - El dinero NO tiene una convención única. En peluqueria, "Corte de cabello"
 *     aparece con `price_at` de 120 y también de 12000, y hay servicios de 180,
 *     450 y 600 con `price_at` de 12000 los cuatro. En crm y recordatorios, en
 *     cambio, las 16 líneas tienen `price_at` exactamente igual al precio del
 *     servicio. Aplicar un `×100` global convertiría bien peluqueria y
 *     arruinaría las otras dos. Se deduce el factor por organización con
 *     `detectarFactor()` y, cuando las fuentes se contradicen, el valor viaja
 *     tal cual y se reporta. Ninguna fila se corrige.
 *
 *   - crm y recordatorios NO tienen filas en `staff_services`: el legacy nunca
 *     llenó esa tabla. Sin ella nadie puede agendar nada. Se deriva del
 *     historial —"este profesional hizo este servicio en esta cita"— y se
 *     reporta como derivado, que no es lo mismo que inventado.
 *
 *   - `reminder_logs` tiene DOS intentos de email para la misma cita: es una
 *     bitácora de intentos, no un registro único. Los 5 están `failed` (el
 *     legacy no tenía SMTP ni webhook configurados), así que su timestamp es
 *     cuándo se INTENTÓ y va en `created_at`; `sent_at` queda nulo porque no se
 *     envió. El destino (`to`) no existe en el legacy: se resuelve con el
 *     contacto del cliente según el canal, y se reporta como derivado.
 *
 *   - Las mismas personas aparecen en dos tenants (Andrés Villa, Irene Campos,
 *     José Renteria, María Sosa y Sofía Mejía están en crm y en recordatorios).
 *     Cada tenant es su propia organización, así que no se fusionan: se copian
 *     tal cual y el informe las lista, porque unificarlas es una decisión de
 *     negocio y no del migrador.
 *
 * Es re-ejecutable: los ids legacy se conservan, así que una segunda pasada no
 * duplica nada (verificado: no hay colisiones de id entre las tres bases).
 *
 *   npm run migrate:legacy -w @amg/citas
 *   npm run migrate:legacy -w @amg/citas -- --legacy products/peluqueria/data/app.db --origen peluqueria
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq } from 'drizzle-orm';
import { closeCoreDb, getCoreDb } from '@amg/platform';
import {
  LegacyReader,
  anotarDiscrepancia,
  autoresSinCore,
  detectarFactor,
  loadProductConfig,
  mapearAutores,
  openProductDb,
  resolverOrganizacion,
  type DiscrepanciaPrecio,
  type InformeMigracion,
} from '@amg/product-runtime';
import { DDL } from './ddl.js';
import {
  appointmentServices,
  appointments,
  customers,
  legacyTenantMap,
  reminders,
  services,
  settings,
  staff,
  staffServices,
} from './schema.js';

export class ErrorMigracion extends Error {}

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
  color: string | null;
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
interface LegacyReminder {
  id: string;
  tenant_id: string;
  appointment_id: string;
  channel: string;
  status: string;
  error: string | null;
  sent_at: string | null;
}

/**
 * Estados que acepta el destino. El legacy usaba solo pending, confirmed y
 * cancelled; `done` y `no_show` quedan disponibles para el producto.
 *
 * Un estado que no esté acá NO se pisa con uno cualquiera: se deja `pending` y se
 * reporta, para que alguien mire esa cita y no aparezca como confirmada.
 */
const ESTADOS: Record<string, string> = {
  confirmed: 'confirmed',
  pending: 'pending',
  done: 'done',
  cancelled: 'cancelled',
  no_show: 'no_show',
};

/** Tabla del destino que corresponde a cada tabla legacy, para el informe. */
const TABLA_DESTINO: Record<string, string> = {
  services: 'services',
  staff: 'staff',
  staff_services: 'staff_services',
  customers: 'customers',
  appointments: 'appointments',
  appointment_services: 'appointment_services',
  reminder_logs: 'reminders',
};

/** Una fuente legacy: de qué producto viejo salen los datos. */
export interface FuenteLegacy {
  etiqueta: string;
  ruta: string;
}

export const FUENTES: FuenteLegacy[] = [
  { etiqueta: 'peluqueria', ruta: '../../products/peluqueria/data/app.db' },
  { etiqueta: 'crm', ruta: '../../products/crm/data/app.db' },
  { etiqueta: 'recordatorios', ruta: '../../products/recordatorios/data/app.db' },
];

export interface OpcionesMigracion {
  destinoPath: string;
  fuentes: FuenteLegacy[];
  /** `id_tenant=slug` para mapear a mano cuando el slug legacy no sirve. */
  overrides?: Map<string, string>;
}

export interface ResumenCitas {
  porOrganizacion: Array<{
    legacy: string;
    organizationId: string;
    accion: string;
    servicios: number;
    profesionales: number;
    asignaciones: number;
    clientes: number;
    citas: number;
    lineas: number;
    recordatorios: number;
  }>;
  /** Asignaciones profesional-servicio sacadas del historial, no del legacy. */
  asignacionesDerivadas: number;
  /** `to` de los recordatorios, resuelto con el contacto del cliente. */
  destinosDerivados: number;
  /** Personas que aparecen en más de una organización. */
  personasRepetidas: Array<{ nombre: string; organizaciones: string[] }>;
  /** Estados de cita que no estaban en la lista y quedaron como `pending`. */
  estadosDesconocidos: string[];
  totalLegacy: Record<string, number>;
  totalDestino: Record<string, number>;
}

export interface ResultadoMigracion {
  informe: InformeMigracion;
  resumen: ResumenCitas;
  cerrar: () => void;
}

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

  const config = loadProductConfig('citas', 'Citas', {
    DB_PATH: destinoPath,
    DB_SCHEMA_VERSION: '1',
  });
  const destino = openProductDb(config, {
    ddl: DDL,
    schema: {
      customers,
      services,
      staff,
      staffServices,
      appointments,
      appointmentServices,
      reminders,
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
  const resumen: ResumenCitas = {
    porOrganizacion: [],
    asignacionesDerivadas: 0,
    destinosDerivados: 0,
    personasRepetidas: [],
    estadosDesconocidos: [],
    totalLegacy: {},
    totalDestino: {},
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
  const yaEsta = (tabla: any, id: string): boolean =>
    db.select({ id: tabla.id }).from(tabla).where(eq(tabla.id, id)).get() !== undefined;

  const correr = destino.sqlite.transaction(() => {
    for (const fuente of existentes) {
      const ruta = fuente.absoluta;
      const reader = new LegacyReader(ruta);
      readers.push(reader);
      reader.exigir(['tenants', 'services', 'staff', 'customers', 'appointments', 'appointment_services']);

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
          servicios: 0,
          profesionales: 0,
          asignaciones: 0,
          clientes: 0,
          citas: 0,
          lineas: 0,
          recordatorios: 0,
        };

        // ── Preferencias, desde la fila del tenant.
        // El legacy no tenía tabla `settings`: los ajustes vivían en `tenants`.
        if (!yaEsta(settings, `cfg_${tenant.id}`)) {
          db.insert(settings)
            .values({
              id: `cfg_${tenant.id}`,
              organizationId: org,
              timezone: tenant.timezone || 'America/Santiago',
              currency: tenant.currency || '$',
              reminderHours: tenant.reminder_hours ?? 12,
              emailEnabled: tenant.email_enabled === 1,
              createdAt: new Date().toISOString(),
            })
            .run();
          anotar('settings');
        }

        // ── Servicios.
        const legacyServices = reader.filas<LegacyService>(
          'SELECT * FROM services WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('services', legacyServices.length);
        for (const s of legacyServices) {
          if (yaEsta(services, s.id)) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(services)
            .values({
              id: s.id,
              organizationId: org,
              name: s.name,
              durationMin: s.duration_min,
              // Sin convertir: el factor se deduce abajo, con las citas, no
              // desde este precio suelto.
              priceCents: s.price,
              description: s.description,
              active: s.active === 1,
              createdAt: s.created_at,
            })
            .run();
          anotar('services');
          conteo.servicios += 1;
        }

        // ── Profesionales.
        const legacyStaff = reader.filas<LegacyStaff>(
          'SELECT * FROM staff WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('staff', legacyStaff.length);
        for (const p of legacyStaff) {
          if (yaEsta(staff, p.id)) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(staff)
            .values({
              id: p.id,
              organizationId: org,
              name: p.name,
              phone: p.phone,
              email: p.email,
              color: p.color,
              active: p.active === 1,
              createdAt: p.created_at,
            })
            .run();
          anotar('staff');
          conteo.profesionales += 1;
        }

        // ── Clientes.
        const legacyCustomers = reader.filas<LegacyCustomer>(
          'SELECT * FROM customers WHERE tenant_id = ? ORDER BY created_at, id',
          tenant.id,
        );
        leer('customers', legacyCustomers.length);
        for (const c of legacyCustomers) {
          if (yaEsta(customers, c.id)) {
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

        // ── Citas.
        const legacyAppts = reader.filas<LegacyAppointment>(
          'SELECT * FROM appointments WHERE tenant_id = ? ORDER BY start_at, id',
          tenant.id,
        );
        leer('appointments', legacyAppts.length);
        for (const a of legacyAppts) {
          if (a.resource_id) {
            // No debería pasar en estas tres fuentes, pero si aparece es una cita
            // de espacio: pertenece a espacios, no a citas. Parar es mejor que
            // guardarla en el producto equivocado.
            throw new ErrorMigracion(
              `La cita ${a.id} de ${tenant.slug} tiene resource_id (${a.resource_id}): es una reserva de espacio y va a espacios, no a citas.`,
            );
          }
          const estado = ESTADOS[a.status];
          if (!estado) {
            const etiqueta = `${a.status} (cita ${a.id})`;
            if (!resumen.estadosDesconocidos.includes(etiqueta)) resumen.estadosDesconocidos.push(etiqueta);
          }
          if (yaEsta(appointments, a.id)) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(appointments)
            .values({
              id: a.id,
              organizationId: org,
              customerId: a.customer_id,
              staffId: a.staff_id,
              startAt: a.start_at,
              endAt: a.end_at,
              notes: a.notes,
              status: estado ?? 'pending',
              // El legacy no guardaba total: se arma con las líneas, más abajo.
              totalCents: 0,
              createdAt: a.created_at,
            })
            .run();
          anotar('appointments');
          conteo.citas += 1;
        }

        // ── Líneas de servicio, y el factor de dinero de esta organización.
        const legacyLines = reader.filas<LegacyAppointmentService>(
          `SELECT ase.* FROM appointment_services ase
           JOIN appointments a ON a.id = ase.appointment_id
           WHERE ase.tenant_id = ? ORDER BY ase.appointment_id, ase.id`,
          tenant.id,
        );
        leer('appointment_services', legacyLines.length);

        const precioDe = new Map(legacyServices.map((s) => [s.id, s.price]));
        const { factor, ambiguo } = detectarFactor(
          legacyLines.map((l) => ({ unidades: precioDe.get(l.service_id) ?? 0, centavos: l.price_at })),
        );

        if (ambiguo) {
          // Se reporta servicio por servicio, no línea por línea: al usuario le
          // sirve ver "este servicio tiene dos precios" y no 25 filas de números.
          for (const s of legacyServices) {
            const vistos = [
              ...new Set(
                legacyLines.filter((l) => l.service_id === s.id).map((l) => l.price_at),
              ),
            ].sort((a, b) => a - b);
            if (vistos.length === 0) continue;
            if (vistos.length === 1 && vistos[0] === s.price) continue;
            anotarDiscrepancia(informe.discrepancias, {
              donde: `${tenant.slug}: servicio "${s.name}"`,
              legacyTenantId: tenant.id,
              unidades: s.price,
              centavos: vistos[vistos.length - 1],
              factor: s.price ? vistos[vistos.length - 1] / s.price : 1,
              motivo:
                vistos.length > 1
                  ? `el catálogo dice ${s.price} pero en las citas aparece como ${vistos.join(' y ')}`
                  : `el catálogo dice ${s.price} y en la cita aparece ${vistos[0]}`,
            });
          }
        }

        for (const l of legacyLines) {
          if (yaEsta(appointmentServices, l.id)) {
            informe.omitidas += 1;
            continue;
          }
          const centavos = factor > 1 ? Math.round(l.price_at * factor) : l.price_at;
          db.insert(appointmentServices)
            .values({
              id: l.id,
              organizationId: org,
              appointmentId: l.appointment_id,
              serviceId: l.service_id,
              serviceName: legacyServices.find((s) => s.id === l.service_id)?.name ?? null,
              priceCents: centavos,
            })
            .run();
          anotar('appointment_services');
          conteo.lineas += 1;

          // El total de la cita es la suma de sus líneas: el legacy no lo
          // guardaba, y calcularlo acá es lo mismo que haría la pantalla.
          const suma = destino.sqlite
            .prepare(
              'SELECT coalesce(sum(price_cents), 0) s FROM appointment_services WHERE appointment_id = ?',
            )
            .get(l.appointment_id) as { s: number };
          db.update(appointments)
            .set({ totalCents: suma.s })
            .where(eq(appointments.id, l.appointment_id))
            .run();
        }

        // ── Asignaciones profesional-servicio.
        //
        // Primero las que el legacy realmente guardó; después las que se deducen
        // del historial, que es lo que permite que estas dos organizaciones
        // puedan agendar algo y no solo mirar su historia.
        const legacyPairs = reader.filas<{ id: string; staff_id: string; service_id: string }>(
          'SELECT * FROM staff_services WHERE tenant_id = ?',
          tenant.id,
        );
        leer('staff_services', legacyPairs.length);
        const pares = new Set<string>();
        for (const par of legacyPairs) {
          pares.add(`${par.staff_id}|${par.service_id}`);
          if (yaEsta(staffServices, par.id)) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(staffServices)
            .values({ id: par.id, organizationId: org, staffId: par.staff_id, serviceId: par.service_id })
            .run();
          anotar('staff_services');
          conteo.asignaciones += 1;
        }

        const derivadas = reader.filas<{ staff_id: string; service_id: string }>(
          `SELECT DISTINCT a.staff_id AS staff_id, ase.service_id AS service_id
           FROM appointments a
           JOIN appointment_services ase ON ase.appointment_id = a.id
           WHERE a.tenant_id = ? AND a.staff_id IS NOT NULL`,
          tenant.id,
        );
        for (const d of derivadas) {
          const clave = `${d.staff_id}|${d.service_id}`;
          if (pares.has(clave)) continue;
          pares.add(clave);
          const id = `deriva_${tenant.id}_${d.staff_id}_${d.service_id}`;
          if (yaEsta(staffServices, id)) {
            informe.omitidas += 1;
            continue;
          }
          db.insert(staffServices)
            .values({ id, organizationId: org, staffId: d.staff_id, serviceId: d.service_id })
            .run();
          anotar('staff_services');
          conteo.asignaciones += 1;
          resumen.asignacionesDerivadas += 1;
        }

        // ── Recordatorios.
        if (reader.tiene('reminder_logs')) {
          const legacyReminders = reader.filas<LegacyReminder>(
            'SELECT * FROM reminder_logs WHERE tenant_id = ? ORDER BY sent_at, id',
            tenant.id,
          );
          leer('reminder_logs', legacyReminders.length);

          // El legacy no guardaba a quién se le avisaba. Sale del cliente de la
          // cita según el canal, y se cuenta como derivado.
          const citasLegacy = reader.filas<{ id: string; customer_id: string }>(
            'SELECT id, customer_id FROM appointments WHERE tenant_id = ?',
            tenant.id,
          );
          const idsCliente = [...new Set(citasLegacy.map((c) => c.customer_id))];
          const contacto = new Map<string, { email: string | null; phone: string | null }>();
          if (idsCliente.length) {
            const marcas = idsCliente.map(() => '?').join(',');
            for (const c of reader.filas<{ id: string; email: string | null; phone: string | null }>(
              `SELECT id, email, phone FROM customers WHERE id IN (${marcas})`,
              ...idsCliente,
            )) {
              contacto.set(c.id, { email: c.email, phone: c.phone });
            }
          }
          const clienteDe = new Map(citasLegacy.map((c) => [c.id, c.customer_id]));

          for (const r of legacyReminders) {
            if (yaEsta(reminders, r.id)) {
              informe.omitidas += 1;
              continue;
            }
            const c = contacto.get(clienteDe.get(r.appointment_id) ?? '');
            const paraQuien = r.channel === 'whatsapp' ? (c?.phone ?? null) : (c?.email ?? null);
            if (paraQuien) resumen.destinosDerivados += 1;
            db.insert(reminders)
              .values({
                id: r.id,
                organizationId: org,
                appointmentId: r.appointment_id,
                channel: r.channel,
                to: paraQuien,
                status: r.status,
                // Fallaron todos los del legacy (SMTP y webhook sin configurar),
                // así que su timestamp es el del INTENTO. Ponerlo en `sent_at`
                // afirmaría que el correo salió.
                sentAt: r.status === 'sent' ? r.sent_at : null,
                error: r.error,
                createdAt: r.sent_at ?? new Date().toISOString(),
              })
              .run();
            anotar('reminders');
            conteo.recordatorios += 1;
          }
        }

        resumen.porOrganizacion.push(conteo);
      }
      reader.cerrar();
      readers.pop();
    }
  });

  try {
    correr();
  } catch (err) {
    for (const r of readers) r.cerrar();
    destino.close();
    closeCoreDb();
    if (err instanceof ErrorMigracion) throw err;
    throw new ErrorMigracion(
      `La migración falló y se revirtió. Las bases legacy no se tocaron.\n${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ── Conteos finales, para que nadie tenga que contarlos a mano.
  for (const destinoTabla of Object.values(TABLA_DESTINO)) {
    resumen.totalDestino[destinoTabla] = (
      destino.sqlite.prepare(`SELECT count(*) c FROM ${destinoTabla}`).get() as { c: number }
    ).c;
  }

  /**
   * Personas que aparecen en más de una organización.
   *
   * No se fusionan: cada tenant es su propia empresa, y decidir que dos son la
   * misma persona es un juicio de negocio, no del migrador. Se listan para que
   * la decisión se tome una vez y no se tome por omisión.
   */
  const porNombre = new Map<string, { nombre: string; orgs: Set<string> }>();
  for (const c of db.select({ name: customers.name, organizationId: customers.organizationId }).from(customers).all()) {
    const clave = c.name.trim().toLowerCase();
    const entrada = porNombre.get(clave);
    if (!entrada) {
      porNombre.set(clave, { nombre: c.name, orgs: new Set([c.organizationId]) });
    } else {
      entrada.orgs.add(c.organizationId);
    }
  }
  for (const entrada of porNombre.values()) {
    if (entrada.orgs.size < 2) continue;
    resumen.personasRepetidas.push({ nombre: entrada.nombre, organizaciones: [...entrada.orgs] });
  }

  const cerrar = () => {
    for (const r of readers) r.cerrar();
    destino.close();
  };
  return { informe, resumen, cerrar };
}

// --- CLI --------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

function main(): void {
  const overrides = new Map<string, string>();
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--org' || !args[i + 1]) continue;
    const [tenantId, slug] = args[i + 1].split('=');
    if (tenantId && slug) overrides.set(tenantId, slug);
    i += 1;
  }

  // `--legacy` migra UNA fuente: sirve para probar el caso difícil, que es el de
  // peluqueria con los precios contradictorios.
  const iLegacy = args.indexOf('--legacy');
  const fuentes: FuenteLegacy[] =
    iLegacy >= 0 && args[iLegacy + 1]
      ? [{ etiqueta: flag('origen', 'puntual'), ruta: args[iLegacy + 1] }]
      : FUENTES;

  const destinoPath = resolve(flag('destino', './data/citas.sqlite'));

  let salida: ResultadoMigracion;
  try {
    salida = migrarLegacy({ destinoPath, fuentes, overrides });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const { informe, resumen } = salida;
  console.log('\nMigración de citas terminada.\n');
  for (const o of informe.organizaciones) {
    console.log(`  ${o.legacyName} (${o.legacySlug}) -> ${o.organizationId}  (${o.accion})`);
  }

  console.log('\n  por organización:');
  for (const c of resumen.porOrganizacion) {
    console.log(
      `    ${c.legacy}\n` +
        `      servicios ${c.servicios} | profesionales ${c.profesionales} | asignaciones ${c.asignaciones} | clientes ${c.clientes}\n` +
        `      citas ${c.citas} | líneas ${c.lineas} | recordatorios ${c.recordatorios}`,
    );
  }

  console.log('\n  leídas del legacy → en el destino:');
  let falta = false;
  for (const [legacyTabla, destinoTabla] of Object.entries(TABLA_DESTINO)) {
    const leidas = resumen.totalLegacy[legacyTabla] ?? 0;
    const escritas = resumen.totalDestino[destinoTabla] ?? 0;
    if (escritas < leidas) falta = true;
    const marca = escritas < leidas ? '  (REVISAR)' : '';
    console.log(`    ${legacyTabla} -> ${destinoTabla}: ${leidas} -> ${escritas}${marca}`);
  }
  console.log(`\n  base destino: ${destinoPath}`);
  if (informe.omitidas > 0) console.log(`  ya estaban (omitidas): ${informe.omitidas}`);

  if (resumen.asignacionesDerivadas > 0) {
    console.log(
      `\n  ${resumen.asignacionesDerivadas} asignación(es) profesional-servicio se DERIVARON del historial.`,
    );
    console.log('  Esas organizaciones tenían la tabla vacía en el legacy, y sin ella no se puede agendar.');
  }
  if (resumen.destinosDerivados > 0) {
    console.log(`  ${resumen.destinosDerivados} recordatorio(s) tomaron su destino del contacto del cliente:`);
    console.log('  el legacy no guardaba a quién se le avisaba.');
  }

  if (informe.discrepancias.length > 0) {
    console.log('\n  DINERO: estas fuentes NO se pudieron convertir con confianza:');
    for (const d of informe.discrepancias) {
      console.log(`    - ${d.donde}: ${d.motivo}`);
    }
    console.log('  Se migró el valor tal cual, sin multiplicar por 100. Revisá los precios a mano.\n');
  } else {
    console.log('\n  DINERO: los precios de las líneas coinciden con el catálogo en las tres fuentes.\n');
  }

  if (informe.autoresSinCore.length > 0) {
    console.log('\n  Los siguientes autores del legacy NO están en el Core:');
    for (const a of informe.autoresSinCore) console.log(`    - ${a}`);
    console.log('  Crealos en el Core y volvé a correr la migración.\n');
  }
  if (resumen.estadosDesconocidos.length > 0) {
    console.log('\n  Estados de cita desconocidos, quedaron como `pending`:');
    for (const e of resumen.estadosDesconocidos) console.log(`    - ${e}`);
    console.log('');
  }
  if (resumen.personasRepetidas.length > 0) {
    console.log('  Estas personas aparecen en más de una organización (NO se fusionaron):');
    for (const p of resumen.personasRepetidas) {
      console.log(`    - ${p.nombre}: en ${p.organizaciones.length} organizaciones`);
    }
    console.log('  Decidir si son la misma persona es un juicio de negocio.\n');
  }

  salida.cerrar();
  closeCoreDb();

  if (falta) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
