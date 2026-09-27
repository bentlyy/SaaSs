/**
 * Migración de los datos del inventario legacy (`tenant_id`) a `organization_id`.
 *
 * Es un CLI, no algo que corre en cada arranque: migrar datos es una operación
 * puntual, con fecha y decisión, no un efecto secundario de levantar el server.
 *
 *   npm run migrate:legacy -w @amg/inventario
 *   npm run migrate:legacy -w @amg/inventario -- --legacy <ruta> --destino <ruta>
 *   npm run migrate:legacy -w @amg/inventario -- --org id_tenant=slug-nuevo
 *
 * Propiedades:
 *
 *   - No toca la base legacy. Se abre en solo lectura. Si algo sale mal, el
 *     legacy sigue sirviendo el producto viejo.
 *   - Es re-ejecutable. El destino de cada `tenant_id` queda anotado en
 *     `legacy_tenant_map`, así que una segunda corrida no crea organizaciones
 *     duplicadas ni duplica artículos.
 *   - Lee de varias fuentes. El inventario de un producto puede estar partido:
 *     el legacy que lo tenía más los artículos que otro producto guardaba sin
 *     ser su dueño. Cada fuente se informa por separado, y si dos comparten un
 *     `tenant_id` la migración se detiene en vez de mezclar dos empresas en un
 *     mismo stock.
 *   - No inventa usuarios. El autor de un movimiento se resuelve por email
 *     contra el Core; si ese usuario no existe, el movimiento queda con el
 *     nombre legacy como foto histórica y el informe lista los emails que hay
 *     que crear en el Core. Inventar una contraseña sería peor que no migrar.
 *   - La organización se busca por slug en el Core y, si no está, se crea con el
 *     nombre del legacy. El Core sigue siendo la única fuente de verdad de qué
 *     organizaciones existen.
 *   - La lógica está en `migrarLegacy()`, separada de la CLI, porque migrar
 *     datos ajenos es la operación más fácil de arruinar y la única que no se
 *     puede repetir para arreglar un error. Lo que migra se prueba contra una
 *     base legacy y un Core de mentira.
 */

import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { closeCoreDb, createOrganization, findOrganizationBySlug, findUserByEmail, getCoreDb } from '@amg/platform';
import { loadProductConfig, openProductDb, type ProductDb } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { items, legacyTenantMap, movements, settings } from './schema.js';

interface LegacyTenant {
  id: string;
  name: string;
  slug: string;
}
interface LegacyItem {
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  quantity: number;
  min_qty: number;
  unit: string;
  price: number;
  active: number;
  created_at: string;
}
interface LegacyMovement {
  id: string;
  tenant_id: string;
  item_id: string;
  delta: number;
  reason: string;
  user_id: string | null;
  created_at: string;
}
interface LegacyUser {
  id: string;
  name: string;
  email: string;
}

export interface FuenteLegacy {
  /** Nombre corto para el informe: "inventario", "deportes". */
  etiqueta: string;
  /** Base legacy de la que se leen los datos. */
  ruta: string;
  /**
   * Fuente que puede faltar sin que la migración se caiga.
   *
   * La principal es obligatoria: si no está, no hay nada que migrar y seguir
   * sería un falso "no había datos". Las secundarias son de otros productos ya
   * consolidados, y su archivo puede no estar en un checkout parcial. Se saltan
   * avisando, no en silencio: el informe dice cuáles se leyeron.
   */
  opcional?: boolean;
}

export interface MigracionOpciones {
  /**
   * De dónde se lee, en orden. Puede ser más de una: el inventario de un
   * producto puede estar repartido entre el legacy que lo tenía y el de otro
   * producto que guardaba artículos sin ser dueño de ellos.
   */
  fuentes: FuenteLegacy[];
  destinoPath: string;
  /** `id_tenant=slug` para mapear a mano cuando el slug legacy no sirve. */
  overrides?: Map<string, string>;
}

export interface ResumenMigracion {
  organizaciones: Array<{ legacy: string; organizationId: string; accion: string; fuente: string }>;
  /** Lo que aportó cada fuente, para poder comparar contra la base de origen. */
  porFuente: Array<{ etiqueta: string; articulos: number; movimientos: number; omitidos: number }>;
  /** Fuentes opcionales que no estaban en el disco y se saltaron. */
  fuentesSaltadas: string[];
  articulos: number;
  movimientos: number;
  omitidos: number;
  /** Autores legacy que no existen en el Core: hay que crearlos a mano. */
  autoresSinCore: string[];
  /** Movimientos a los que una corrida anterior les asocia su usuario del Core. */
  autoresAsociados: number;
  /**
   * Artículos cuya cantidad no se explica con sus movimientos.
   *
   * No se corrigen: la cantidad es lo que la empresa tenía y el movimiento es lo
   * que registró, y decidir cuál mintió es un juicio de negocio, no del
   * migrador. Se listan para que alguien lo mire.
   */
  descuadrados: Array<{ id: string; name: string; quantity: number; sumaMovimientos: number }>;
}

export interface ResultadoMigracion {
  resumen: ResumenMigracion;
  /** Movimientos en el legacy y en el destino, para que el llamador los compare. */
  totalLegacy: number;
  totalDestino: number;
  /**
   * Queda abierto a propósito: el que migra necesita poder contar y leer la base
   * destino después de correr esto. `cerrar()` la cierra.
   */
  destino: ProductDb;
  cerrar: () => void;
}

export class ErrorMigracion extends Error {}

/** DDL mínimo del legacy: lo único que este migrador necesita encontrar. */
const LEGACY_DDL = `
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE inventory_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_qty INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'unidad',
  price INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  user_id TEXT,
  created_at TEXT NOT NULL
);
`;

export function migrarLegacy(opciones: MigracionOpciones): ResultadoMigracion {
  const { fuentes, destinoPath, overrides = new Map() } = opciones;

  if (fuentes.length === 0) {
    throw new ErrorMigracion('No se pasó ninguna fuente legacy.');
  }

  const fuentesSaltadas: string[] = [];
  const aLeer: Array<{ etiqueta: string; ruta: string }> = [];
  for (const f of fuentes) {
    if (!existsSync(f.ruta)) {
      if (f.opcional) {
        fuentesSaltadas.push(`${f.etiqueta} (${f.ruta})`);
        continue;
      }
      throw new ErrorMigracion(`No existe la base legacy en ${f.ruta}`);
    }
    aLeer.push({ etiqueta: f.etiqueta, ruta: f.ruta });
  }

  if (aLeer.length === 0) {
    throw new ErrorMigracion('Ninguna fuente legacy existe en disco.');
  }

  /**
   * Todas las fuentes se abren y se validan ANTES de tocar el destino.
   *
   * Si la segunda fuente resultara inválida y se descubriera después de haber
   * copiado la primera, la transacción cubre que el destino no quede a medias,
   * pero la organización de la primera ya quedó creada en el Core. Fallar
   * temprano deja el Core tan limpio como el destino.
   */
  const abiertas: Array<{ etiqueta: string; ruta: string; legacy: Database.Database; tiene: (t: string) => boolean }> = [];
  const cerrarTodas = () => {
    for (const f of abiertas) {
      try {
        f.legacy.close();
      } catch {
        // Si ya estaba cerrada, seguimos: el error real ya se reporto.
      }
    }
  };

  for (const { etiqueta, ruta } of aLeer) {
    const legacy = new Database(ruta, { readonly: true });
    const tiene = (t: string) =>
      (legacy.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t) as unknown) !== undefined;
    if (!tiene('inventory_items')) {
      legacy.close();
      cerrarTodas();
      throw new ErrorMigracion(`${ruta} no tiene la tabla inventory_items: no parece un inventario legacy.`);
    }
    abiertas.push({ etiqueta, ruta, legacy, tiene });
  }
  const legacys = abiertas;

  /**
   * Un `tenant_id` repetido entre dos fuentes haría que la segunda organización
   * se saltara el mapa y sus artículos quedaran apuntando a la organización de
   * la primera. Los ids son `id_<hex>` y no se repiten en la práctica, pero si
   * se repitieran el silencio sería lo peor: la migración "terminaría bien" y
   * dejaría dos empresas mezcladas en un solo stock.
   */
  const dueniosDe = new Map<string, string>();
  for (const f of legacys) {
    const filas = f.legacy.prepare('SELECT id FROM tenants').all() as Array<{ id: string }>;
    for (const { id } of filas) {
      const otro = dueniosDe.get(id);
      if (otro && otro !== f.etiqueta) {
        cerrarTodas();
        throw new ErrorMigracion(
          `El tenant ${id} aparece en dos fuentes: ${otro} y ${f.etiqueta}. ` +
            'Sin esto, los artículos de la segunda se sumarian al stock de la primera.',
        );
      }
      dueniosDe.set(id, f.etiqueta);
    }
  }

  const config = loadProductConfig('inventario', 'Inventario', {
    DB_PATH: destinoPath,
    DB_SCHEMA_VERSION: '1',
  });
  const destino = openProductDb(config, { ddl: DDL, schema: { items, movements, settings, legacyTenantMap } });
  const db = destino.db;

  // El Core se abre acá: sin él no hay a qué organización apuntar.
  getCoreDb();

  const cerrar = () => {
    for (const f of legacys) f.legacy.close();
    destino.close();
  };

  const resumen: ResumenMigracion = {
    organizaciones: [],
    porFuente: [],
    fuentesSaltadas,
    articulos: 0,
    movimientos: 0,
    omitidos: 0,
    autoresSinCore: [],
    autoresAsociados: 0,
    descuadrados: [],
  };

  /**
   * Todo el copiado va en una transacción del destino: o quedan los artículos
   * y sus movimientos, o no queda ninguno. Medio migrado es peor que no
   * migrado, porque parece que sí.
   *
   * Lo que NO se puede deshacer es la organización creada en el Core, que se
   * escribe antes. Es a propósito: primero se anota en el Core y después en el
   * destino, así una corrida que se corta deja una organización huérfana
   * reutilizable —la próxima corrida la encuentra por slug— en vez de una
   * fila apuntando a una organización que no existe.
   */
  const correr = destino.sqlite.transaction(() => {
    for (const fuente of legacys) {
      const tenants = fuente.legacy.prepare('SELECT id, name, slug FROM tenants').all() as LegacyTenant[];
      const legacyUsers = fuente.tiene('users')
        ? (fuente.legacy.prepare('SELECT id, name, email FROM users').all() as LegacyUser[])
        : [];

      /**
       * legacy user id -> { coreUserId, name, email }
       *
       * El mapa es POR FUENTE a propósito. Los ids de usuario son `id_<hex>` y
       * dos bases distintas pueden tener el mismo valor; si el mapa fuera global,
       * un movimiento de `deportes` podría quedar firmado con el nombre de un
       * usuario de otra empresa que casualmente comparte id.
       */
      const autores = new Map<string, { coreUserId: string | null; name: string; email: string }>();
      for (const u of legacyUsers) {
        const core = findUserByEmail(u.email);
        autores.set(u.id, { coreUserId: core?.id ?? null, name: u.name, email: u.email });
      }

      const antes = { articulos: resumen.articulos, movimientos: resumen.movimientos, omitidos: resumen.omitidos };

    for (const t of tenants) {
      const yaMapeado = db
        .select()
        .from(legacyTenantMap)
        .where(eq(legacyTenantMap.legacyTenantId, t.id))
        .get();

      const slugForzado = overrides.get(t.id);
      let organizationId = yaMapeado?.organizationId;
      let accion = 'ya migrada';

      if (!organizationId) {
        const slug = slugForzado ?? t.slug;
        const existente = findOrganizationBySlug(slug);
        if (existente) {
          organizationId = existente.id;
          accion = 'encontrada en el Core';
        } else {
          const creada = createOrganization({ name: t.name, slug });
          organizationId = creada.id;
          accion = 'creada en el Core';
        }
        db.insert(legacyTenantMap)
          .values({
            legacyTenantId: t.id,
            legacySlug: t.slug,
            legacyName: t.name,
            organizationId,
            migratedAt: new Date().toISOString(),
          })
          .run();
      }

      resumen.organizaciones.push({
        legacy: `${t.name} (${t.slug})`,
        organizationId,
        accion,
        fuente: fuente.etiqueta,
      });

      // Artículos. Se conserva el id legacy: los movimientos lo referencian.
      const legacyItems = fuente.legacy
        .prepare('SELECT * FROM inventory_items WHERE tenant_id = ?')
        .all(t.id) as LegacyItem[];
      for (const it of legacyItems) {
        const existe = db.select({ id: items.id }).from(items).where(eq(items.id, it.id)).get();
        if (existe) {
          resumen.omitidos += 1;
          continue;
        }
        db.insert(items)
          .values({
            id: it.id,
            organizationId,
            name: it.name,
            sku: it.sku ?? null,
            quantity: it.quantity,
            minQuantity: it.min_qty,
            unit: it.unit,
            priceCents: it.price,
            active: it.active === 1,
            createdAt: it.created_at,
          })
          .run();
        resumen.articulos += 1;
      }

      // Movimientos, en orden cronológico.
      const legacyMovs = fuente.legacy
        .prepare('SELECT * FROM inventory_movements WHERE tenant_id = ? ORDER BY created_at, id')
        .all(t.id) as LegacyMovement[];
      for (const mv of legacyMovs) {
        const autor = mv.user_id ? autores.get(mv.user_id) : undefined;
        const yaEsta = db
          .select({ id: movements.id, actorUserId: movements.actorUserId })
          .from(movements)
          .where(eq(movements.id, mv.id))
          .get();

        if (yaEsta) {
          resumen.omitidos += 1;
          // Un movimiento que se migró sin autor (porque su usuario no estaba en
          // el Core) se completa ahora, si el usuario ya se creó. Sin esto, el
          // aviso de "volvé a correr la migración" sería falso: la segunda
          // pasada lo omitiría y el movimiento quedaría sindueño para siempre.
          if (!yaEsta.actorUserId && autor?.coreUserId) {
            db.update(movements)
              .set({ actorUserId: autor.coreUserId, actorName: autor.name })
              .where(eq(movements.id, mv.id))
              .run();
            resumen.autoresAsociados += 1;
          }
          continue;
        }

        if (autor && !autor.coreUserId) {
          const etiqueta = `${autor.email} (${autor.name})`;
          if (!resumen.autoresSinCore.includes(etiqueta)) resumen.autoresSinCore.push(etiqueta);
        }
        db.insert(movements)
          .values({
            id: mv.id,
            organizationId,
            itemId: mv.item_id,
            delta: mv.delta,
            reason: mv.reason,
            actorUserId: autor?.coreUserId ?? null,
            actorName: autor?.name ?? null,
            createdAt: mv.created_at,
          })
          .run();
        resumen.movimientos += 1;
      }
    }

      // El desglose por fuente es lo que permite revisar la migración contra
      // cada base de origen, y no contra un total que no se sabe de dónde sale.
      resumen.porFuente.push({
        etiqueta: fuente.etiqueta,
        articulos: resumen.articulos - antes.articulos,
        movimientos: resumen.movimientos - antes.movimientos,
        omitidos: resumen.omitidos - antes.omitidos,
      });
    }
  });

  try {
    correr();
  } catch (err) {
    cerrar();
    closeCoreDb();
    throw new ErrorMigracion(
      `La migración falló y se revirtió. La base legacy no se tocó.\n${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // Suma de todas las fuentes: el destino tiene que poder explicar el total de
  // todo lo que se leyó, no solo de la primera base.
  const totalLegacy = legacys.reduce(
    (n, f) =>
      n + (f.legacy.prepare('SELECT COUNT(*) c FROM inventory_movements').get() as { c: number }).c,
    0,
  );
  const totalDestino = (
    destino.sqlite.prepare('SELECT COUNT(*) c FROM movements').get() as { c: number }
  ).c;

  /**
   * ¿La cantidad de cada artículo se explica con sus movimientos?
   *
   * En el v2 la cantidad SOLO cambia por un movimiento, así que si acá no
   * cuadra, el v2 va a mostrar un stock que su propio historial no explica.
   * No se ajusta nada: se informa. Un seed del legacy genera cantidades y
   * movimientos por separado y nunca cuadra; en datos reales, en cambio, un
   * descuadre suele ser un movimiento perdido y merece una mirada.
   */
  const cantidades = db.select({ id: items.id, name: items.name, quantity: items.quantity }).from(items).all();
  for (const art of cantidades) {
    const suma = Number(
      (
        destino.sqlite
          .prepare('SELECT coalesce(sum(delta), 0) s FROM movements WHERE item_id = ?')
          .get(art.id) as { s: number }
      ).s,
    );
    if (suma !== art.quantity) {
      resumen.descuadrados.push({ id: art.id, name: art.name, quantity: art.quantity, sumaMovimientos: suma });
    }
  }

  return { resumen, totalLegacy, totalDestino, destino, cerrar };
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

  // La base legacy vive en `data/legacy/` en la raíz del repo, no en
  // `products/`: el producto viejo ya no existe como carpeta y la migración tiene
  // que poder volver a correrse meses después, aunque sea para verificar.
  const principal: FuenteLegacy = {
    etiqueta: 'inventario',
    ruta: resolve(flag('legacy', '../../data/legacy/inventario-legacy.db')),
  };

  /**
   * Segunda fuente: los artículos que `deportes` guardaba sin ser su dueño.
   *
   * Es opcional a propósito. `deportes` ya se consolidó y su volumen se va a
   * conservar un tiempo sin uso, así que un checkout parcial sin ese archivo es
   * normal y no puede abortar una migración de inventario.
   */
  const secundarias: FuenteLegacy[] = [
    { etiqueta: 'deportes', ruta: resolve(flag('deportes', '../../products/deportes/data/app.db')), opcional: true },
  ];

  /** `--fuente <etiqueta>=<ruta>` repetible, para sumar bases a medida. */
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== '--fuente' || !args[i + 1]) continue;
    const [etiqueta, ruta] = args[i + 1].split('=');
    if (etiqueta && ruta) secundarias.push({ etiqueta, ruta: resolve(ruta) });
    i += 1;
  }

  const destinoPath = resolve(flag('destino', './data/inventario.sqlite'));

  let salida: ResultadoMigracion;
  try {
    salida = migrarLegacy({ fuentes: [principal, ...secundarias], destinoPath, overrides });
  } catch (err) {
    console.error(err instanceof ErrorMigracion ? err.message : err);
    process.exit(1);
  }

  const { resumen, totalLegacy, totalDestino } = salida;

  console.log('\nMigración de inventario terminada.\n');
  for (const o of resumen.organizaciones) {
    console.log(`  ${o.legacy} -> ${o.organizationId}  (${o.accion})  [${o.fuente}]`);
  }
  console.log(`\n  artículos migrados:   ${resumen.articulos}`);
  console.log('  movimientos migrados:');
  for (const f of resumen.porFuente) {
    const detalle = f.omitidos > 0 ? ` (${f.movimientos} nuevos, ${f.omitidos} ya estaban)` : '';
    console.log(`    ${f.etiqueta}: ${f.articulos} artículos, ${f.movimientos} movimientos${detalle}`);
  }
  if (resumen.fuentesSaltadas.length > 0) {
    console.log('\n  fuentes que NO se leyeron (no estaban en el disco):');
    for (const s of resumen.fuentesSaltadas) console.log(`    - ${s}`);
    console.log('  Si esperabas datos de ahí, la migración está incompleta.');
  }
  if (resumen.omitidos > 0) console.log(`  ya estaban (omitidos): ${resumen.omitidos}`);
  console.log(`  base destino:         ${destinoPath}`);

  const cuadra = totalDestino >= totalLegacy;
  console.log(`\n  movimientos en destino: ${totalDestino} de ${totalLegacy} del legacy ${cuadra ? '(ok)' : '(REVISAR)'}`);

  salida.cerrar();
  closeCoreDb();

  if (resumen.autoresSinCore.length > 0) {
    console.log('\n  Los siguientes autores del legacy NO están en el Core, así que sus');
    console.log('  movimientos quedaron con el nombre como foto histórica y sin usuario:');
    for (const a of resumen.autoresSinCore) console.log(`    - ${a}`);
    console.log('  Crealos en el Core y volvé a correr la migración para asociarlos.\n');
  }

  if (resumen.descuadrados.length > 0) {
    console.log(`  ${resumen.descuadrados.length} artículo(s) cuya cantidad NO se explica con sus movimientos:`);
    for (const d of resumen.descuadrados) {
      console.log(`    - ${d.name}: stock ${d.quantity}, y sus movimientos suman ${d.sumaMovimientos}`);
    }
    console.log('  Se migraron igual, sin tocarlos: la cantidad es lo que la empresa tenía.');
    console.log('  Revisá si falta algún movimiento antes de mirar el stock como bueno.\n');
  }

  if (!cuadra) process.exit(1);
}

// Sólo corre si lo invocaron como comando. Importado desde un test, no.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
