import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { closeCoreDb } from '@amg/platform';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrarLegacy, type FuenteLegacy, type ResultadoMigracion } from '../src/migrate-legacy.js';
import { crearLegacy, type OpcionesFixture } from './legacy-fixture.js';

/**
 * La migración de clientes.
 *
 * Lo que se prueba acá no es que "corra": es que NO invente. El legacy trae un
 * estado escrito de otra forma, contactos que son texto vacío en vez de nulo, un
 * cumpleaños que no es una fecha y trece tablas que no son de este producto. Cada
 * una de esas rarezas tiene una respuesta definida acá, y si alguien la cambia sin
 * cambiar estos tests, los datos de un cliente quedan mal convertidos en
 * silencio.
 */

let dir: string;
let legacyPath: string;
let destinoPath: string;
let salida: ResultadoMigracion | null = null;

/** Crea la base legacy de mentira y devuelve la lista de fuentes a migrar. */
function legacy(opts: OpcionesFixture = {}): FuenteLegacy[] {
  crearLegacy(legacyPath, opts);
  return [{ etiqueta: 'fixture', ruta: legacyPath }];
}

/** Corre la migración y la deja abierta para poder leer el destino. */
function migrar(fuentes: FuenteLegacy[] = [{ etiqueta: 'fixture', ruta: legacyPath }]) {
  salida = migrarLegacy({ destinoPath, fuentes });
  return salida;
}

/**
 * Lee una tabla del destino y CIERRA la conexión.
 *
 * En Windows un handle de SQLite abierto impide borrar el archivo, así que abrir
 * sin cerrar hace fallar el `afterEach` con EBUSY y el error del test real queda
 * tapado por un error de limpieza.
 */
function leerDestino(sql: string, ...params: unknown[]): any[] {
  const db = new Database(destinoPath, { readonly: true });
  try {
    return db.prepare(sql).all(...params) as any[];
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amg-clientes-mig-'));
  legacyPath = join(dir, 'legacy.db');
  destinoPath = join(dir, 'clientes.sqlite');
});

afterEach(() => {
  salida?.cerrar();
  salida = null;
  closeCoreDb();
  rmSync(dir, { recursive: true, force: true });
});

describe('lo que se migra', () => {
  it('trae los clientes y los seguimientos de cada tenant', () => {
    migrar(legacy());
    const c = salida!.resumen.porOrganizacion;
    expect(c).toHaveLength(1);

    const crm = c[0];
    expect(crm.legacy).toContain('Clientes Vip Studio');
    expect(crm.organizationId).toBeTruthy();
    expect(crm.clientes).toBe(4);
    expect(crm.seguimientos).toBe(4);
  });

  it('conserva el id legacy, para que la migración sea re-ejecutable', () => {
    migrar(legacy());
    expect(leerDestino('SELECT id FROM customers ORDER BY id').map((r) => r.id)).toEqual([
      'cli_1',
      'cli_2',
      'cli_3',
      'cli_4',
    ]);
    expect(leerDestino('SELECT id FROM followups ORDER BY id').map((r) => r.id)).toEqual([
      'seg_1',
      'seg_2',
      'seg_3',
      'seg_4',
    ]);
  });

  it('cada fila queda en la organización de su tenant', () => {
    migrar(legacy());
    const orgs = new Set(leerDestino('SELECT organization_id FROM customers').map((c) => c.organization_id));
    expect(orgs.size).toBe(1);
    // Y esa organización es la del mapa, no una cualquiera.
    expect(leerDestino('SELECT organization_id FROM legacy_tenant_map')[0].organization_id).toBe(
      [...orgs][0],
    );
  });

  it('trae el cumpleaños de `birthdate` a `birthday` como fecha', () => {
    migrar(legacy({ cumpleañosInvalido: false }));
    const fila = leerDestino("SELECT birthday FROM customers WHERE id = 'cli_3'")[0];
    // La columna del destino se llama distinto a propósito: `birthday` es una
    // fecha (AAAA-MM-DD) y no un instante, para que el cumpleaños no corra de dia.
    expect(fila.birthday).toBe('1990-05-14');
  });

  it('lo que el legacy no tenía en la ficha queda en NULL, no inventado', () => {
    migrar(legacy());
    const c = leerDestino(
      "SELECT kind, company, tax_id, address, city FROM customers WHERE id = 'cli_1'",
    )[0];
    // El legacy no distinguía persona de empresa: poner `empresa` en alguna sería
    // inventar un dato de identidad que nadie escribió.
    expect(c.kind).toBe('persona');
    expect(c.company).toBeNull();
    expect(c.tax_id).toBeNull();
    expect(c.address).toBeNull();
    expect(c.city).toBeNull();
  });

  it('traduce `cancelled` del legacy a `canceled` del producto', () => {
    migrar(legacy());
    const seg = leerDestino("SELECT status FROM followups WHERE id = 'seg_3'")[0];
    // Si la forma vieja entrara, un `WHERE status = 'canceled'` dejaría de
    // encontrar la mitad de los cancelados.
    expect(seg.status).toBe('canceled');
    expect(leerDestino("SELECT count(*) c FROM followups WHERE status = 'cancelled'")[0].c).toBe(0);
  });

  it('deja `completed_at` en NULL: el legacy no guardaba cuándo se completó', () => {
    migrar(legacy());
    const hecho = leerDestino("SELECT status, completed_at FROM followups WHERE id = 'seg_2'")[0];
    expect(hecho.status).toBe('done');
    // Poner la fecha de creación afirmaría que se hizo el día que se creó, que
    // no es lo mismo que cuando se terminó.
    expect(hecho.completed_at).toBeNull();
  });

  it('trae las preferencias del tenant, que en el legacy vivían en la tabla tenants', () => {
    migrar(legacy());
    const prefs = leerDestino('SELECT timezone, currency FROM settings');
    expect(prefs).toHaveLength(1);
    expect(prefs[0].timezone).toBe('America/Mexico_City');
    expect(prefs[0].currency).toBe('$');
  });
});

describe('el contacto vacío', () => {
  it('convierte el texto vacío en NULL y lo cuenta', () => {
    migrar(legacy({ contactosVacios: true }));
    const c = leerDestino("SELECT phone, email FROM customers WHERE id = 'cli_2'")[0];
    // En JavaScript `''` es verdadero: sin normalizar, la ficha diría "tiene
    // teléfono" de un cliente al que no se le puede llamar.
    expect(c.phone).toBeNull();
    expect(c.email).toBeNull();
    expect(salida!.resumen.vaciosAnulados).toBeGreaterThan(0);
  });

  it('no toca un contacto de verdad', () => {
    migrar(legacy());
    const c = leerDestino("SELECT phone, email FROM customers WHERE id = 'cli_1'")[0];
    expect(c.phone).toBe('+52 55 5555 4001');
    expect(c.email).toBe('maria@example.com');
  });
});

describe('lo que no se inventa', () => {
  it('un cumpleaños que no es una fecha queda en NULL y se reporta', () => {
    migrar(legacy({ cumpleañosInvalido: true }));
    const c = leerDestino("SELECT birthday FROM customers WHERE id = 'cli_4'")[0];
    // Un día de cumpleaños inventado se manda un regalo en la fecha equivocada
    // todos los años. Mejor no tener el dato que tener el equivocado.
    expect(c.birthday).toBeNull();
    expect(salida!.resumen.fechasInvalidas.some((f) => f.includes('14/05/1991'))).toBe(true);
  });

  it('un estado de seguimiento desconocido queda en pending y se reporta', () => {
    migrar(legacy({ estadoRaro: true }));
    const seg = leerDestino("SELECT status FROM followups WHERE id = 'seg_4'")[0];
    // No se lo marca como hecho: sería afirmar algo que nadie sabe.
    expect(seg.status).toBe('pending');
    expect(salida!.resumen.estadosDesconocidos.some((e) => e.includes('rescheduled'))).toBe(true);
  });

  it('una autora que no está en el Core se reporta y no se le inventa una cuenta', () => {
    migrar(legacy({ autoresDesconocidos: true }));
    expect(salida!.informe.autoresSinCore.some((a) => a.includes('diana@legacy.test'))).toBe(true);
  });

  it('el historial de contacto queda vacío porque el legacy no lo tenía', () => {
    migrar(legacy());
    expect(leerDestino('SELECT count(*) c FROM interactions')[0].c).toBe(0);
    // Y el informe lo dice, en vez de dejar un cero mudo que parece un error.
    expect(salida!.resumen.avisos.some((a) => a.includes('historial de contacto'))).toBe(true);
  });

  it('un seguimiento que apunta a un cliente inexistente detiene la migración', () => {
    crearLegacy(legacyPath, { seguimientoRoto: true });
    expect(() => migrar([{ etiqueta: 'fixture', ruta: legacyPath }])).toThrow(/cli_inexistente/);
  });
});

describe('las tablas que no son de este producto', () => {
  it('no copia las citas, los servicios ni los profesionales', () => {
    migrar(legacy({ conTablasAjenas: true }));
    // No es una falta del migrador: la cita es de `citas`, y tener la misma
    // agenda en dos productos es una copia que termina mandando sobre la otra.
    expect(leerDestino('SELECT count(*) c FROM customers')[0].c).toBe(4);
    const tablas = salida!.informe.escritas;
    expect(tablas.appointments).toBeUndefined();
    expect(tablas.services).toBeUndefined();
    expect(tablas.staff).toBeUndefined();
  });

  it('las cuenta y dice de qué producto son', () => {
    migrar(legacy({ conTablasAjenas: true }));
    const porTabla = new Map(salida!.resumen.tablasAjenas.map((t) => [t.legacy, t]));
    expect(porTabla.get('appointments')).toEqual({ legacy: 'appointments', destino: 'citas', filas: 1 });
    expect(porTabla.get('documents')?.destino).toBe('cotizaciones');
    expect(porTabla.get('inventory_items')?.destino).toBe('inventario');
  });

  it('con tablas vacías, el informe las menciona igual con cero filas', () => {
    migrar(legacy({ conTablasAjenas: false }));
    // La tabla existe y está vacía: eso también es información. Lo que no se
    // hace es inventar una columna o una fila para llenar el informe.
    expect(salida!.resumen.tablasAjenas.length).toBeGreaterThan(0);
    expect(salida!.resumen.tablasAjenas.every((t) => t.filas === 0)).toBe(true);
  });

  it('una tabla que no existe en el legacy no se reporta', () => {
    crearLegacy(legacyPath, { conTablasAjenas: true });
    // Un legacy más viejo puede no tener la tabla de cotizaciones todavía.
    const db = new Database(legacyPath);
    db.exec('DROP TABLE documents');
    db.close();

    migrar([{ etiqueta: 'fixture', ruta: legacyPath }]);
    expect(salida!.resumen.tablasAjenas.map((t) => t.legacy)).not.toContain('documents');
  });
});

describe('las propiedades del migrador', () => {
  it('es re-ejecutable: la segunda pasada no duplica nada', () => {
    migrar(legacy());
    const primera = leerDestino('SELECT count(*) c FROM customers')[0].c;
    const organizacionesPrimera = salida!.informe.organizaciones.length;

    salida!.cerrar();
    salida = null;
    migrar([{ etiqueta: 'fixture', ruta: legacyPath }]);

    expect(leerDestino('SELECT count(*) c FROM customers')[0].c).toBe(primera);
    expect(leerDestino('SELECT count(*) c FROM followups')[0].c).toBe(4);
    expect(salida!.informe.omitidas).toBeGreaterThan(0);
    // Y no crea organizaciones nuevas: la segunda pasada las encuentra por slug.
    expect(salida!.informe.organizaciones).toHaveLength(organizacionesPrimera);
    expect(salida!.informe.organizaciones.every((o) => o.accion === 'ya migrada')).toBe(true);
  });

  it('en la segunda pasada el informe dice cuántos clientes tiene la organización', () => {
    migrar(legacy());
    salida!.cerrar();
    salida = null;
    migrar([{ etiqueta: 'fixture', ruta: legacyPath }]);

    // El informe es lo que lee una persona antes de migrar de verdad. Si en la
    // segunda pasada dijera "0 clientes" porque no insertó nada, la conclusión
    // seria que la migración anterior se perdió.
    const porOrg = salida!.resumen.porOrganizacion;
    expect(porOrg).toHaveLength(1);
    expect(porOrg[0].clientes).toBe(leerDestino('SELECT count(*) c FROM customers')[0].c);
    expect(porOrg[0].seguimientos).toBe(4);
    expect(porOrg[0].contactos).toBe(0);
  });

  it('no toca la base legacy', () => {
    legacy();
    const antes = new Database(legacyPath, { readonly: true });
    const clientes = antes.prepare('SELECT count(*) c FROM customers').get() as { c: number };
    const estados = antes.prepare('SELECT group_concat(status) s FROM followups').get() as { s: string };
    antes.close();

    migrar([{ etiqueta: 'fixture', ruta: legacyPath }]);

    const despues = new Database(legacyPath, { readonly: true });
    expect((despues.prepare('SELECT count(*) c FROM customers').get() as { c: number }).c).toBe(clientes.c);
    // El `cancelled` del legacy sigue escrito con dos eles: leer en solo lectura
    // de verdad, no "traducir" el origen.
    expect((despues.prepare('SELECT group_concat(status) s FROM followups').get() as { s: string }).s).toBe(estados.s);
    despues.close();
  });

  it('si un dato no cierra, la migración se revierte entera', () => {
    crearLegacy(legacyPath, { seguimientoRoto: true });
    expect(() => migrar([{ etiqueta: 'fixture', ruta: legacyPath }])).toThrow();

    // La base destino puede existir (el runtime crea el archivo y el esquema al
    // abrirla) pero no puede tener ni una fila de negocio a medias.
    const destino = new Database(destinoPath, { readonly: true });
    expect((destino.prepare('SELECT count(*) c FROM customers').get() as { c: number }).c).toBe(0);
    expect((destino.prepare('SELECT count(*) c FROM followups').get() as { c: number }).c).toBe(0);
    destino.close();
  });

  it('avisa si el archivo legacy no está, en vez de crear una base vacía', () => {
    expect(() => migrar([{ etiqueta: 'fantasma', ruta: join(dir, 'no-existe.db') }])).toThrow(/No se encontró/);
    // Y lo importante: ni siquiera abre el destino, así que no deja una base
    // nueva que parezca una migración exitosa con cero datos.
    expect(existsSync(destinoPath)).toBe(false);
  });
});
