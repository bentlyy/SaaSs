/**
 * Migración de los datos del legacy `crm` a `clientes.sqlite`.
 *
 * No es "una base vieja -> un producto". La base de `crm` es un clon de las 17
 * tablas de siempre y este producto es dueño de DOS de ellas. Lo demás se
 * reporta como destino ajeno, que es la parte importante de este archivo:
 *
 *   - `appointments`, `appointment_services`, `services`, `staff` y
 *     `staff_services` son de `citas`. Las 10 citas del crm ya estan ahi, con su
 *     profesional y su hora. Copiarlas aca seria tener la misma agenda en dos
 *     productos, y la segunda copia siempre termina desactualizada.
 *   - `documents` es de `cotizaciones` (tiene lineas, impuestos y total).
 *   - `inventory_items` e `inventory_movements` son de `inventario`. Aca no se
 *     lleva ni un solo stock.
 *   - `reminder_logs` es de `recordatorios`.
 *   - `resources` es de `espacios`.
 *   - `work_orders` es de `solicitudes`.
 *
 * Lo que este producto trae son las tres tablas que si le corresponden:
 * clientes, seguimientos y contacto. Y aca viene lo raro: `followups` si tiene
 * datos (7) y `interactions` NO EXISTE en el legacy. El destino queda vacio y el
 * informe lo dice, porque un historial inventado a partir de las notas de un
 * seguimiento seria historia ficticia.
 *
 * Que se encontró al mirar los datos de verdad, y cómo se resolvió cada cosa:
 *
 *   - El legacy escribe `cancelled` con dos eles y el producto usa `canceled`
 *     con una. Se traduce al migrar: si la forma vieja entrara, la columna
 *     tendría dos vocabularios y un `WHERE status = 'canceled'` dejaría de
 *     encontrar la mitad de los cancelados.
 *   - `customers.birthdate` existe pero las 8 filas vienen en NULL. Se migra a
 *     `birthday`, que es la FECHA (`AAAA-MM-DD`) que usa la ficha. Si alguna vez
 *     aparece un valor con otra forma, no se inventa una fecha: se deja en NULL
 *     y se reporta, porque un dia de cumpleaños inventado se manda un regalo en la
 *     fecha equivocada todos los años.
 *   - El legacy no tiene `company`, `kind`, `tax_id`, `address` ni `city` en la
 *     ficha. Se quedan en NULL y `kind` queda en `persona`: son 8 personas con
 *     nombre y teléfono, y adivinar que alguna era empresa seria inventar.
 *   - `followups.updated_at` es NOT NULL en el legacy, pero `completed_at` no
 *     existe: no se sabe cuando se completo un seguimiento, asi que queda NULL.
 *     La API lo pone cuando alguien marca `done`, que es el unico momento en que
 *     el dato es cierto.
 *   - `customers.email` y `customers.phone` traen cadenas vacias en varias filas
 *     (`''`), no NULL. Se normalizan a NULL y se cuentan: en JavaScript `''` es
 *     verdadero, asi que sin normalizar la ficha diria "tiene teléfono" de un
 *     cliente al que no se le puede llamar.
 *   - El slug `demo-crm` probablemente ya exista en el Core, porque la migración
 *     de `citas` lo creó para este mismo tenant. Se reusa con
 *     `resolverOrganizacion` y no se crea una organización gemela: dos
 *     organizaciones con los mismos clientes es exactamente la clase de duplicado
 *     que este producto tiene que evitar.
 *
 * Es re-ejecutable: los ids legacy se conservan, así que una segunda pasada no
 * duplica nada.
 *
 *   npm run migrate:legacy -w @amg/clientes
 *   npm run migrate:legacy -w @amg/clientes -- --legacy products/crm/data/app.db
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
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
import { customers, followups, interactions, legacyTenantMap, settings } from './schema.js';

export class ErrorMigracion extends Error {}

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

interface LegacyFollowup {
  id: string;
  tenant_id: string;
  customer_id: string;
  title: string;
  body: string | null;
  due_date: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Estados que acepta el destino. El legacy solo usaba pending, done y `cancelled`.
 *
 * Un estado que no este aca NO se pisa con uno cualquiera: se deja `pending` y se
 * reporta, para que nadie mire ese seguimiento y lo vea como algo que hay que
 * hacer cuando en realidad nadie sabe que paso con el.
 */
const ESTADOS: Record<string, string> = {
  pending: 'pending',
  done: 'done',
  cancelled: 'canceled',
};

/** Tabla del destino que corresponde a cada tabla legacy, para el informe. */
const TABLA_DESTINO: Record<string, string> = {
  customers: 'customers',
  followups: 'followups',
  // El legacy NO tiene tabla de contactos: se escribe igual para que el informe
  // muestre el 0 en vez de una fila que no existe.
  interactions: 'interactions',
};

/**
 * Las tablas del legacy que NO son de este producto, y donde viven.
 *
 * Se leen y se cuentan, pero no se escriben. No es descuido: es que copiar una
 * tabla a un producto que no es el suyo deja dos versiones de la misma verdad, y
 * la segunda termina mandando sobre la primera.
 */
const TABLAS_AJENAS: Array<{ legacy: string; destino: string }> = [
  { legacy: 'appointments', destino: 'citas' },
  { legacy: 'appointment_services', destino: 'citas' },
  { legacy: 'services', destino: 'citas' },
  { legacy: 'staff', destino: 'citas' },
  { legacy: 'staff_services', destino: 'citas' },
  { legacy: 'documents', destino: 'cotizaciones' },
  { legacy: 'inventory_items', destino: 'inventario' },
  { legacy: 'inventory_movements', destino: 'inventario' },
  { legacy: 'reminder_logs', destino: 'recordatorios' },
  { legacy: 'resources', destino: 'espacios' },
  { legacy: 'work_orders', destino: 'solicitudes' },
  { legacy: 'work_order_services', destino: 'solicitudes' },
  { legacy: 'work_order_parts', destino: 'solicitudes' },
];

/** Una fuente legacy: de qué producto viejo salen los datos. */
export interface FuenteLegacy {
  etiqueta: string;
  ruta: string;
}

export const FUENTES: FuenteLegacy[] = [{ etiqueta: 'crm', ruta: '../../products/crm/data/app.db' }];

export interface OpcionesMigracion {
  destinoPath: string;
  fuentes: FuenteLegacy[];
  /** `id_tenant=slug` para mapear a mano cuando el slug legacy no sirve. */
  overrides?: Map<string, string>;
}

export interface ResumenClientes {
  porOrganizacion: Array<{
    legacy: string;
    organizationId: string;
    accion: string;
    clientes: number;
    seguimientos: number;
    contactos: number;
  }>;
  /** Filas del legacy que viven en otro producto, con su destino. */
  tablasAjenas: Array<{ legacy: string; destino: string; filas: number }>;
  /** Estados de seguimiento que no estaban en la lista. */
  estadosDesconocidos: string[];
  /** Fechas de cumpleaños que no eran una fecha y quedaron en NULL. */
  fechasInvalidas: string[];
  /** Cadenas vacias convertidas en NULL, para que la ficha no diga que hay. */
  vaciosAnulados: number;
  /** Cosas que no son errores pero que alguien tiene que mirar. */
  avisos: string[];
  totalLegacy: Record<string, number>;
  totalDestino: Record<string, number>;
}

export interface ResultadoMigracion {
  informe: InformeMigracion;
  resumen: ResumenClientes;
  cerrar: () => void;
}

/**
 * Vacio -> NULL.
 *
 * El legacy guardaba el telefono y el correo como `''` cuando el usuario no los
 * cargo, no como NULL. Se normaliza porque en el destino `''` y NULL significan
 * cosas distintas para la pantalla: la ficha muestra "sin telefono" con NULL y
 * muestra un telefono vacio con `''`.
 */
function vacioANull(valor: string | null): string | null {
  if (valor === null) return null;
  const limpio = valor.trim();
  return limpio === '' ? null : limpio;
}

/** `AAAA-MM-DD` y nada mas. Cualquier otra cosa se reporta, no se adivina. */
function fechaValida(valor: string | null): valor is string {
  if (valor === null) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  return !Number.isNaN(Date.parse(`${valor}T00:00:00Z`));
}

export function migrarLegacy(opciones: OpcionesMigracion): ResultadoMigracion {
  const { destinoPath, fuentes, overrides = new Map() } = opciones;

  /**
   * Se comprueba que exista AL MENOS UNA fuente antes de abrir el destino.
   *
   * Al reves, correr la migración sin datos creaba una base nueva vacía y
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

  const config = loadProductConfig('clientes', 'Clientes', {
    DB_PATH: destinoPath,
    DB_SCHEMA_VERSION: '1',
  });
  const destino = openProductDb(config, {
    ddl: DDL,
    schema: { customers, followups, interactions, settings, legacyTenantMap },
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
  const resumen: ResumenClientes = {
    porOrganizacion: [],
    tablasAjenas: [],
    estadosDesconocidos: [],
    fechasInvalidas: [],
    vaciosAnulados: 0,
    avisos: [],
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
  const avisar = (texto: string) => {
    if (!resumen.avisos.includes(texto)) resumen.avisos.push(texto);
  };

  /**
   * ¿Ya está esta fila? El id legacy se conserva, así que eso es la idempotencia
   * entera: una segunda pasada no duplica nada.
   */
  const yaEsta = (tabla: any, id: string): boolean =>
    db.select({ id: tabla.id }).from(tabla).where(eq(tabla.id, id)).get() !== undefined;

  let cerrarFuentes = (): void => {
    for (const r of readers) r.cerrar();
  };

  try {
    // ── Primera pasada: abrir y resolver las organizaciones.
    //
    // Todas las organizaciones se resuelven ANTES de tocar datos de negocio, y no
    // por prolijidad: si una fila se escribiera apuntando a una organización que
    // despues resulta que no se pudo crear, quedaria un cliente apuntando al
    // vacio. Resolver todo primero deja que la escritura de datos sea solo
    // inserciones que ya saben a donde van.
    const fuentesAbiertas: Array<{ reader: LegacyReader; etiqueta: string }> = [];
    const tenantsPorFuente: Array<{
      reader: LegacyReader;
      etiqueta: string;
      tenants: ReturnType<LegacyReader['tenants']>;
    }> = [];

    for (const fuente of existentes) {
      const reader = new LegacyReader(fuente.absoluta);
      readers.push(reader);
      reader.exigir(['tenants', 'customers', 'followups']);
      fuentesAbiertas.push({ reader, etiqueta: fuente.etiqueta });
      const tenants = reader.tenants();
      if (tenants.length === 0) {
        avisar(`${fuente.etiqueta}: la base no tiene tenants, no hay nada que migrar.`);
      }
      tenantsPorFuente.push({ reader, etiqueta: fuente.etiqueta, tenants });
    }

    const organizacionDe = new Map<string, string>();
    for (const { etiqueta, tenants } of tenantsPorFuente) {
      for (const tenant of tenants) {
        const res = resolverOrganizacion(tenant, { mapa: legacyTenantMap, db, overrides });
        informe.organizaciones.push(res);

        // Si el slug ya existia en el Core por otro motivo, se avisa. No se frena
        // la migración: la organización es válida igual, y lo que se reporta es
        // justo lo que el usuario tiene que ir a mirar.
        const previa = organizacionDe.get(res.organizationId);
        if (previa && previa !== tenant.id) {
          throw new ErrorMigracion(
            `Los tenants legacy ${previa} y ${tenant.id} resolvieron a la misma organización ${res.organizationId}. ` +
              'Revisá el slug o usá --org id_tenant=slug para separarlos.',
          );
        }
        organizacionDe.set(res.organizationId, tenant.id);

        if (res.accion === 'encontrada en el Core' && res.legacyName !== tenant.name) {
          avisar(
            `El slug "${res.legacySlug}" ya existe en el Core como otra empresa. ` +
              `Los datos de "${tenant.name}" van a ${res.organizationId}.`,
          );
        }
        if (res.accion === 'encontrada en el Core') {
          avisar(
            `La organización ${res.organizationId} ya existía (slug "${res.legacySlug}"): se reusa, no se crea otra.`,
          );
        }
      }
    }

    // Los autores del legacy se resuelven una vez, antes de migrar: no hay tablas
    // de authorship que los referencien, pero el informe tiene que decir igual
    // quienes quedaron sin cuenta en el Core.
    for (const { reader } of fuentesAbiertas) {
      const autores = mapearAutores(reader.users());
      for (const nombre of autoresSinCore(autores.values())) {
        if (!informe.autoresSinCore.includes(nombre)) informe.autoresSinCore.push(nombre);
      }
    }

    // ── Segunda pasada: los datos, en UNA transaccion.
    destino.sqlite.transaction(() => {
      for (const { reader, etiqueta, tenants } of tenantsPorFuente) {
        for (const tenant of tenants) {
          const res = informe.organizaciones.find((o) => o.legacyTenantId === tenant.id)!;
          const org = res.organizationId;
          const conteo = {
            legacy: `${tenant.name} (${tenant.slug}) <- ${etiqueta}`,
            organizationId: org,
            accion: res.accion,
            clientes: 0,
            seguimientos: 0,
            contactos: 0,
          };

          // ── Preferencias, desde la fila del tenant.
          // El legacy no tenía tabla `settings`: los ajustes vivían en `tenants`.
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
                createdAt: new Date().toISOString(),
              })
              .run();
            anotar('settings');
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
            const tel = vacioANull(c.phone);
            const mail = vacioANull(c.email);
            if (tel !== c.phone || mail !== c.email) resumen.vaciosAnulados += 1;

            // El cumpleaños va a `birthday` y solo si es una fecha de verdad. Las 8
            // filas del crm vienen en NULL, y si alguna vez no viniera, se
            // reporta en vez de inventar un dia.
            let cumpleanos: string | null = null;
            const crudo = vacioANull(c.birthdate);
            if (crudo !== null) {
              if (fechaValida(crudo)) cumpleanos = crudo;
              else {
                const nota = `${crudo} (cliente ${c.name})`;
                if (!resumen.fechasInvalidas.includes(nota)) resumen.fechasInvalidas.push(nota);
              }
            }

            db.insert(customers)
              .values({
                id: c.id,
                organizationId: org,
                name: c.name,
                // El legacy no distinguia persona de empresa: quedan NULL y
                // `persona`. Poner `empresa` en alguna seria inventar un dato
                // de identidad que nadie escribio.
                company: null,
                kind: 'persona',
                email: mail,
                phone: tel,
                taxId: null,
                address: null,
                city: null,
                notes: c.notes,
                tags: c.tags,
                birthday: cumpleanos,
                archivedAt: null,
                createdAt: c.created_at,
              })
              .run();
            anotar('customers');
          }

          // ── Seguimientos.
          const legacyFollowups = reader.filas<LegacyFollowup>(
            'SELECT * FROM followups WHERE tenant_id = ? ORDER BY due_date, id',
            tenant.id,
          );
          leer('followups', legacyFollowups.length);

          const clientes = new Set(
            db
              .select({ id: customers.id })
              .from(customers)
              .where(eq(customers.organizationId, org))
              .all()
              .map((c) => c.id),
          );

          for (const f of legacyFollowups) {
            const estado = ESTADOS[f.status];
            if (!estado) {
              const nota = `${f.status} (seguimiento "${f.title}" de ${f.customer_id})`;
              if (!resumen.estadosDesconocidos.includes(nota)) resumen.estadosDesconocidos.push(nota);
            }
            if (yaEsta(followups, f.id)) {
              informe.omitidas += 1;
              continue;
            }
            // Un seguimiento sin cliente es un "@pendiente" suelto. Si el legacy
            // lo tiene roto, se frena: dejarlo a medias seria peor que no
            // migrar, y el error dice exactamente que fila lo causa.
            if (!clientes.has(f.customer_id)) {
              throw new ErrorMigracion(
                `El seguimiento ${f.id} ("${f.title}") apunta al cliente ${f.customer_id}, que no esta en ${tenant.slug}.`,
              );
            }
            db.insert(followups)
              .values({
                id: f.id,
                organizationId: org,
                customerId: f.customer_id,
                title: f.title,
                body: f.body,
                dueDate: f.due_date,
                status: estado ?? 'pending',
                // NULL a proposito: el legacy no guardaba cuando se completo un
                // seguimiento. Poner la fecha de creacion afirmaria que se hizo
                // el dia que se creo, que no es lo mismo.
                completedAt: null,
                createdAt: f.created_at,
                updatedAt: f.updated_at,
              })
              .run();
            anotar('followups');
          }

          // ── Contactos: el legacy no tiene la tabla, asi que no hay nada que
          // leer. Se deja en cero a proposito y el informe lo dice: un historial
          // armado con las notas de los seguimientos seria historia ficticia.

          // Lo que se reporta por organizacion es lo que quedo en el destino, no
          // lo que se inserto en esta pasada. Si se corre dos veces, lo segundo
          // da cero y hace pensar que se perdio todo.
          const enDestino = (tabla: typeof customers | typeof followups | typeof interactions) =>
            db.select({ n: sql<number>`count(*)` }).from(tabla).where(eq(tabla.organizationId, org)).get()?.n ?? 0;
          conteo.clientes = enDestino(customers);
          conteo.seguimientos = enDestino(followups);
          conteo.contactos = enDestino(interactions);

          resumen.porOrganizacion.push(conteo);
        }

        // ── Lo que NO es de este producto, contado para el informe.
        for (const tabla of TABLAS_AJENAS) {
          if (!reader.tiene(tabla.legacy)) continue;
          const filas = reader.contar(`SELECT count(*) n FROM ${tabla.legacy}`);
          resumen.tablasAjenas.push({ legacy: tabla.legacy, destino: tabla.destino, filas });
        }
      }
    })();
  } catch (err) {
    cerrarFuentes();
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
  if ((resumen.totalDestino.interactions ?? 0) === 0) {
    avisar('El legacy no tenia historial de contacto: la tabla de contactos queda vacia a proposito.');
  }

  const cerrar = () => {
    cerrarFuentes();
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

  // `--legacy` migra UNA fuente: sirve para probar la migración contra una copia
  // del legacy antes de correrla con la de verdad.
  const iLegacy = args.indexOf('--legacy');
  const fuentes: FuenteLegacy[] =
    iLegacy >= 0 && args[iLegacy + 1]
      ? [{ etiqueta: flag('origen', 'puntual'), ruta: args[iLegacy + 1] }]
      : FUENTES;

  const destinoPath = resolve(flag('destino', './data/clientes.sqlite'));

  let salida: ResultadoMigracion;
  try {
    salida = migrarLegacy({ destinoPath, fuentes, overrides });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const { informe, resumen } = salida;
  console.log('\nMigración de clientes terminada.\n');
  for (const o of informe.organizaciones) {
    console.log(`  ${o.legacyName} (${o.legacySlug}) -> ${o.organizationId}  (${o.accion})`);
  }

  console.log('\n  por organización:');
  for (const c of resumen.porOrganizacion) {
    console.log(
      `    ${c.legacy}\n` +
        `      clientes ${c.clientes} | seguimientos ${c.seguimientos} | contactos ${c.contactos}`,
    );
  }

  console.log('\n  leídas del legacy → en el destino:');
  let falta = false;
  for (const [legacyTabla, destinoTabla] of Object.entries(TABLA_DESTINO)) {
    const leidas = resumen.totalLegacy[legacyTabla] ?? 0;
    const escritas = resumen.totalDestino[destinoTabla] ?? 0;
    // El 0 de contactos es lo esperado, asi que no marca falta: lo que marca
    // falta es que el destino tenga menos filas de las que habia.
    if (escritas < leidas) falta = true;
    const marca = escritas < leidas ? '  (REVISAR)' : '';
    console.log(`    ${legacyTabla} -> ${destinoTabla}: ${leidas} -> ${escritas}${marca}`);
  }

  if (resumen.tablasAjenas.length > 0) {
    console.log('\n  tablas del legacy que NO son de este producto:');
    for (const t of resumen.tablasAjenas) {
      const donde = t.filas > 0 ? `  <- ${t.filas} fila(s) para ${t.destino}` : `  (vacia; ${t.destino})`;
      console.log(`    ${t.legacy}${donde}`);
    }
    console.log('  No se copiaron: cada dato tiene un solo dueño, y ese es el producto de la derecha.');
  }

  console.log(`\n  base destino: ${destinoPath}`);
  if (informe.omitidas > 0) console.log(`  ya estaban (omitidas): ${informe.omitidas}`);
  if (resumen.vaciosAnulados > 0) {
    console.log(
      `  ${resumen.vaciosAnulados} cliente(s) vinieron sin teléfono o sin correo y quedaron en NULL.`,
    );
  }

  if (resumen.avisos.length > 0) {
    console.log('\n  avisos:');
    for (const a of resumen.avisos) console.log(`    - ${a}`);
  }
  if (resumen.fechasInvalidas.length > 0) {
    console.log('\n  fechas de cumpleaños que NO eran una fecha, quedaron en NULL:');
    for (const f of resumen.fechasInvalidas) console.log(`    - ${f}`);
    console.log('  No se adivinó un día de cumpleaños: se manda un regalo en la fecha equivocada todos los años.\n');
  }
  if (resumen.estadosDesconocidos.length > 0) {
    console.log('\n  estados de seguimiento desconocidos, quedaron como `pending`:');
    for (const e of resumen.estadosDesconocidos) console.log(`    - ${e}`);
    console.log('');
  }
  if (informe.autoresSinCore.length > 0) {
    console.log('\n  Los siguientes autores del legacy NO están en el Core:');
    for (const a of informe.autoresSinCore) console.log(`    - ${a}`);
    console.log('  Crealos en el Core y volvé a correr la migración.\n');
  }

  salida.cerrar();
  closeCoreDb();

  if (falta) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
