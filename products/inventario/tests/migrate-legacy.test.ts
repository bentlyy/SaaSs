import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  closeCoreDb,
  createOrganization,
  createUser,
  findOrganizationBySlug,
  findUserByEmail,
  platformConfig,
} from '@amg/platform';
import { crearLegacyConDatos } from './legacy-fixture.js';
import { migrarLegacy, type ResultadoMigracion } from '../src/migrate-legacy.js';
import { items, legacyTenantMap, movements } from '../src/schema.js';

/**
 * Tests de la migración de datos.
 *
 * Corren contra bases de verdad —un Core y un legacy de mentira en carpetas
 * temporales— y no contra mocks, porque lo que hay que verificar es que el SQL
 * de la migración funciona sobre un archivo SQLite real y que las funciones del
 * Core crean de verdad la organización. Un mock que devuelve lo que uno espera
 * no demostraría nada: demostraría que el test está bien escrito.
 *
 * `CORE_DB_PATH` lo fija `tests/setup.ts`, antes de que se cargue la config del
 * Core: si lo fijáramos acá, el Core apuntaría al `data/core/core.sqlite` de
 * desarrollo y estos tests escribirían en la base real. El aislamiento entre
 * tests se logra borrando el archivo del Core, no cambiando la ruta, porque la
 * config del Core es una constante leída una sola vez.
 */

const CORE_PATH = platformConfig.dbPath;
let dir: string;
let legacyPath: string;
let destinoPath: string;
/** Todo lo que se abrió en un test, para cerrarlo aunque el test falle. */
let abiertos: ResultadoMigracion[] = [];

const HASH_FALSO = 'hash-falso-para-el-test-no-es-una-contrasena-real';

beforeEach(() => {
  // Un Core vacío por test: si no, una organización creada en un test aparecería
  // en el siguiente y las aserciones sobre "creada" vs "encontrada" no valdrían.
  closeCoreDb();
  for (const sufijo of ['', '-wal', '-shm']) rmSync(`${CORE_PATH}${sufijo}`, { force: true });

  dir = mkdtempSync(join(tmpdir(), 'inventario-mig-'));
  legacyPath = join(dir, 'legacy.db');
  destinoPath = join(dir, 'inventario.sqlite');
  crearLegacyConDatos(legacyPath);
});

afterEach(() => {
  // Cerrar siempre, aunque el test haya fallado a mitad: un handle abierto
  // deja el archivo tomado y el `rm` de abajo falla con EBUSY.
  for (const r of abiertos) {
    try {
      r.cerrar();
    } catch {
      // Si ya estaba cerrado, seguimos.
    }
  }
  abiertos = [];
  closeCoreDb();
  rmSync(dir, { recursive: true, force: true });
});

const correr = (extra: Partial<Parameters<typeof migrarLegacy>[0]> = {}) => {
  const r = migrarLegacy({ legacyPath, destinoPath, ...extra });
  abiertos.push(r);
  return r;
};

describe('migración de datos del legacy', () => {
  it('crea una organización en el Core por cada tenant', () => {
    const { resumen, cerrar } = correr();
    expect(resumen.organizaciones).toHaveLength(2);
    expect(findOrganizationBySlug('demo-inventario')?.name).toBe('Bodega Central');
    expect(findOrganizationBySlug('demo-norte')?.name).toBe('Sucursal Norte');
    cerrar();
  });

  it('copia todos los artículos y movimientos, sin perder ninguno', () => {
    const { totalLegacy, totalDestino, cerrar } = correr();
    expect(totalLegacy).toBe(4);
    expect(totalDestino).toBe(4);
    cerrar();
  });

  it('deja cada artículo en la organización de su tenant, sin mezclarlos', () => {
    const { destino, cerrar } = correr();
    const central = findOrganizationBySlug('demo-inventario')!.id;
    const norte = findOrganizationBySlug('demo-norte')!.id;

    const todos = destino.db.select().from(items).all();
    expect(todos).toHaveLength(4);
    // Ningún artículo sin organización: esa es la columna de la que depende
    // todo el aislamiento del producto.
    expect(todos.every((i) => i.organizationId.length > 0)).toBe(true);
    expect(todos.find((i) => i.id === 'itm_3')?.organizationId).toBe(norte);
    expect(todos.filter((i) => i.organizationId === central)).toHaveLength(3);
    cerrar();
  });

  it('conserva el id legacy del artículo y del movimiento', () => {
    const { destino, cerrar } = correr();
    // Los movimientos apuntan al id del artículo, no a uno nuevo: si el id
    // cambiara, el historial quedaría huérfano.
    const mov = destino.db.select().from(movements).all();
    expect(mov.find((m) => m.id === 'mov_1')?.itemId).toBe('itm_1');
    expect(destino.db.select().from(items).all().map((i) => i.id).sort()).toEqual([
      'itm_1',
      'itm_2',
      'itm_3',
      'itm_4',
    ]);
    cerrar();
  });

  it('trae los artículos inactivos como tales, no como activos', () => {
    const { destino, cerrar } = correr();
    // El legacy guardaba `active`; perderlo reactivaría un artículo retirado.
    expect(destino.db.select().from(items).all().find((i) => i.id === 'itm_4')?.active).toBe(false);
    cerrar();
  });

  it('traduce los campos del legacy a los del producto', () => {
    const { destino, cerrar } = correr();
    const filtro = destino.db.select().from(items).all().find((i) => i.id === 'itm_1');
    expect(filtro).toMatchObject({
      name: 'Filtro de aire',
      sku: 'FIL-AIR',
      quantity: 10,
      minQuantity: 4,
      unit: 'unidad',
      priceCents: 25000,
    });
    cerrar();
  });

  it('es re-ejecutable: no duplica nada ni crea organizaciones de más', () => {
    const primera = correr();
    const orgOriginal = findOrganizationBySlug('demo-inventario')!.id;
    primera.cerrar();

    const segunda = correr();
    expect(segunda.resumen.articulos).toBe(0);
    expect(segunda.resumen.movimientos).toBe(0);
    expect(segunda.resumen.omitidos).toBe(8); // 4 artículos + 4 movimientos
    // La organización es la misma, no una nueva con el mismo slug.
    expect(findOrganizationBySlug('demo-inventario')!.id).toBe(orgOriginal);
    expect(segunda.totalDestino).toBe(4);
    segunda.cerrar();
  });

  it('anota de qué organización vino cada tenant, para poder auditarlo', () => {
    const { destino, cerrar } = correr();
    const mapeo = destino.db.select().from(legacyTenantMap).all();
    expect(mapeo).toHaveLength(2);
    expect(mapeo.find((m) => m.legacyTenantId === 'ten_legacy_1')?.organizationId).toBe(
      findOrganizationBySlug('demo-inventario')!.id,
    );
    cerrar();
  });

  it('reutiliza la organización que ya existe en el Core en vez de crear otra', () => {
    const previa = createOrganization({ name: 'Bodega Central', slug: 'demo-inventario' });
    const { resumen, cerrar } = correr();
    const org = resumen.organizaciones.find((o) => o.legacy.includes('demo-inventario'));
    expect(org).toMatchObject({ organizationId: previa.id, accion: 'encontrada en el Core' });
    cerrar();
  });

  it('permite forzar el slug con un override', () => {
    const overrides = new Map([['ten_legacy_1', 'bodega-central-ok']]);
    const { resumen, cerrar } = correr({ overrides });
    const org = resumen.organizaciones.find((o) => o.legacy.includes('demo-inventario'));
    expect(findOrganizationBySlug('bodega-central-ok')!.id).toBe(org?.organizationId);
    cerrar();
  });

  it('asocia el autor con el usuario del Core cuando ya existe', () => {
    createUser({ name: 'Ana Legacy', email: 'ana@legacy.test', passwordHash: HASH_FALSO });
    const { resumen, destino, cerrar } = correr();
    expect(resumen.autoresSinCore).toEqual([]);

    const mov = destino.db.select().from(movements).all().find((m) => m.id === 'mov_1');
    expect(mov?.actorUserId).toBe(findUserByEmail('ana@legacy.test')!.id);
    // Y el nombre queda como foto histórica, para leer el historial sin Core.
    expect(mov?.actorName).toBe('Ana Legacy');
    cerrar();
  });

  it('avisa de los autores que no están en el Core y no les inventa usuario', () => {
    const { resumen, destino, cerrar } = correr();
    // Inventar una contraseña sería peor que no migrar: se avisa y se sigue.
    expect(resumen.autoresSinCore).toEqual(['ana@legacy.test (Ana Legacy)']);
    const mov = destino.db.select().from(movements).all().find((m) => m.id === 'mov_1');
    expect(mov?.actorUserId).toBeNull();
    // Pero el nombre queda, para que el historial se pueda leer igual.
    expect(mov?.actorName).toBe('Ana Legacy');
    cerrar();
  });

  it('al re-correr, completa el autor de los movimientos que quedaron sin dueño', () => {
    // Primera pasada: Ana todavía no existe en el Core.
    const primera = correr();
    expect(primera.resumen.autoresSinCore).toHaveLength(1);
    expect(primera.resumen.autoresAsociados).toBe(0);
    primera.cerrar();

    // Se crea Ana y se vuelve a correr: el aviso de la CLI se cumple.
    createUser({ name: 'Ana Legacy', email: 'ana@legacy.test', passwordHash: HASH_FALSO });
    const segunda = correr();
    expect(segunda.resumen.autoresSinCore).toEqual([]);
    expect(segunda.resumen.autoresAsociados).toBe(2); // mov_1 y mov_2 son de Ana

    const deAna = segunda.destino.db.select().from(movements).all().filter((m) => m.id === 'mov_1' || m.id === 'mov_2');
    expect(deAna).toHaveLength(2);
    expect(deAna.every((m) => m.actorUserId === findUserByEmail('ana@legacy.test')!.id)).toBe(true);
    // Y el que no tenía autor sigue sin él: no se inventa.
    expect(segunda.destino.db.select().from(movements).all().find((m) => m.id === 'mov_3')?.actorUserId).toBeNull();
    segunda.cerrar();
  });

  it('avisa de los artículos cuyo stock no cuadra con sus movimientos, sin tocarlos', () => {
    // El fixture tiene 10 y -2 sobre un artículo que quedó en 10: no cuadra.
    const { resumen, destino, cerrar } = correr();

    expect(resumen.descuadrados.length).toBeGreaterThan(0);
    const itm1 = resumen.descuadrados.find((d) => d.id === 'itm_1');
    expect(itm1).toMatchObject({ name: 'Filtro de aire', quantity: 10, sumaMovimientos: 8 });

    // Y no se "arregla": la cantidad sigue siendo la del legacy. Decidir cuál de
    // los dos mintió es un juicio de negocio, no del migrador.
    expect(destino.db.select().from(items).all().find((i) => i.id === 'itm_1')?.quantity).toBe(10);
    cerrar();
  });

  it('no inventa movimientos para cuadrar el stock', () => {
    const { totalLegacy, totalDestino, cerrar } = correr();
    // Si rellenara con un movimiento de ajuste, el historial dejaría de
    // coincidir con el legacy. El migrador copia, no argumenta.
    expect(totalDestino).toBe(totalLegacy);
    cerrar();
  });

  it('rechaza una base que no es un inventario legacy, sin escribir nada', () => {
    const otra = join(dir, 'otra.db');
    const db = new Database(otra);
    db.exec('CREATE TABLE lo_que_sea (id TEXT)');
    db.close();

    expect(() => migrarLegacy({ legacyPath: otra, destinoPath })).toThrow(/inventory_items/);
    // Y no dejó una base destino con tablas a medio migrar.
    expect(existsSync(destinoPath)).toBe(false);
  });

  it('avisa si la base legacy no existe', () => {
    expect(() => migrarLegacy({ legacyPath: join(dir, 'no-existe.db'), destinoPath })).toThrow(/No existe/);
  });

  it('no toca la base legacy', () => {
    correr().cerrar();
    const st = new Database(legacyPath, { readonly: true });
    const articulos = (st.prepare('SELECT COUNT(*) c FROM inventory_items').get() as { c: number }).c;
    const movs = (st.prepare('SELECT COUNT(*) c FROM inventory_movements').get() as { c: number }).c;
    st.close();
    expect(articulos).toBe(4);
    expect(movs).toBe(4);
  });
});
