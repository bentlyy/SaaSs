import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LegacyReader,
  ErrorMigracion,
  detectarFactor,
  unidadesDeLineas,
  anotarDiscrepancia,
  type DiscrepanciaPrecio,
} from '../src/legacy.js';

/**
 * El lector legacy y la normalización de dinero.
 *
 * El dinero es la parte peligrosa: un factor mal deducido no rompe ningún test de
 * integridad, deja la base sana y multiplica todos los precios por 100. Por eso
 * acá se prueban los casos que en la vida real se encontraron, no losbonitos.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amg-legacy-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Crea una base legacy con el esquema minimo que pida el test. */
function crearLegacy(nombre: string, ddl: string): string {
  const ruta = join(dir, nombre);
  const db = new Database(ruta);
  db.exec(ddl);
  db.close();
  return ruta;
}

const TENANTS_DDL = `
CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT, slug TEXT, product TEXT, currency TEXT, timezone TEXT);
CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT);
`;

describe('LegacyReader', () => {
  it('falla con un mensaje claro si la base no existe', () => {
    expect(() => new LegacyReader(join(dir, 'no-existe.db'))).toThrow(ErrorMigracion);
    expect(() => new LegacyReader(join(dir, 'no-existe.db'))).toThrow(/No existe la base legacy/);
  });

  it('no puede escribir: la base se abre en solo lectura', () => {
    const ruta = crearLegacy('ro.db', `${TENANTS_DDL}
CREATE TABLE notas (id TEXT PRIMARY KEY, texto TEXT);
INSERT INTO notas VALUES ('a','hola');`);
    const r = new LegacyReader(ruta);
    try {
      // Que existan las funciones de escritura es esperable en sqlite3; lo que
      // importa es que fuss la apertura readonly y que un write tire.
      expect(r.tiene('notas')).toBe(true);
      expect(() => r.filas('INSERT INTO notas VALUES (?,?)', 'b', 'x')).toThrow();
    } finally {
      r.cerrar();
    }
  });

  it('exigir() nombra las tablas que faltan, no todas', () => {
    const ruta = crearLegacy('parcial.db', `${TENANTS_DDL}
CREATE TABLE appointments (id TEXT PRIMARY KEY);`);
    const r = new LegacyReader(ruta);
    try {
      expect(() => r.exigir(['appointments'])).not.toThrow();
      expect(() => r.exigir(['appointments', 'appointment_services', 'customers'])).toThrow(
        /no tiene appointment_services, customers/,
      );
    } finally {
      r.cerrar();
    }
  });

  it('devuelve tenants y usuarios, y tolera que no existan', () => {
    const ruta = crearLegacy('poblada.db', `${TENANTS_DDL}
INSERT INTO tenants VALUES ('t1','Estetica Glow','demo-pelu','peluqueria','$','America/Mexico_City');
INSERT INTO users VALUES ('u1','Maria Owner','demo@pelu.com');`);
    const r = new LegacyReader(ruta);
    try {
      expect(r.tenants()).toEqual([
        expect.objectContaining({ id: 't1', slug: 'demo-pelu', product: 'peluqueria' }),
      ]);
      expect(r.users()).toEqual([expect.objectContaining({ email: 'demo@pelu.com' })]);
    } finally {
      r.cerrar();
    }

    const vacia = crearLegacy('vacia.db', 'CREATE TABLE otra (id TEXT PRIMARY KEY);');
    const r2 = new LegacyReader(vacia);
    try {
      expect(r2.tenants()).toEqual([]);
      expect(r2.users()).toEqual([]);
    } finally {
      r2.cerrar();
    }
  });

  it('contar() devuelve 0 en vez de(undefined) si la consulta no trae n', () => {
    const ruta = crearLegacy('c.db', 'CREATE TABLE t (id TEXT PRIMARY KEY, v INTEGER); INSERT INTO t VALUES (\'a\',1);');
    const r = new LegacyReader(ruta);
    try {
      expect(r.contar('SELECT count(*) AS n FROM t')).toBe(1);
      expect(r.contar('SELECT v FROM t')).toBe(0);
    } finally {
      r.cerrar();
    }
  });
});

describe('detección del factor unidades -> centavos', () => {
  it('deduce ×100 cuando todas las muestras coinciden', () => {
    // Caso peluqueria: price en unidades, price_at en centavos.
    expect(detectarFactor([
      { unidades: 120, centavos: 12000 },
      { unidades: 180, centavos: 18000 },
    ])).toEqual({ factor: 100, ambiguo: false });
  });

  it('deduce factor 1 cuando el legacy ya guardaba centavos', () => {
    // Caso crm y recordatorios: price == price_at.
    expect(detectarFactor([
      { unidades: 980, centavos: 980 },
      { unidades: 380, centavos: 380 },
    ])).toEqual({ factor: 1, ambiguo: false });
  });

  it('se niega a deducir cuando las fuentes se contradicen', () => {
    // Este es el caso real: un servicio de 180 con price_at de 12000.
    const r = detectarFactor([
      { unidades: 120, centavos: 12000 },
      { unidades: 180, centavos: 12000 },
    ]);
    expect(r.ambiguo).toBe(true);
    expect(r.factor).toBe(1);
  });

  it('se niega a deducir con una sola muestra', () => {
    // Con un solo dato no hay con qué comparar: devolver 100 "porque suena bien"
    // es exactamente el error que hay que evitar.
    expect(detectarFactor([{ unidades: 120, centavos: 12000 }])).toEqual({ factor: 1, ambiguo: true });
  });

  it('se niega cuando el factor no es un entero', () => {
    expect(detectarFactor([{ unidades: 3, centavos: 10 }])).toEqual({ factor: 1, ambiguo: true });
  });

  it('ignora los ceros en vez de dividirlos', () => {
    const r = detectarFactor([
      { unidades: 0, centavos: 0 },
      { unidades: 120, centavos: 12000 },
      { unidades: 180, centavos: 18000 },
    ]);
    expect(r).toEqual({ factor: 100, ambiguo: false });
  });

  it('con todo en cero no inventa un factor', () => {
    expect(detectarFactor([{ unidades: 0, centavos: 0 }])).toEqual({ factor: 1, ambiguo: true });
  });
});

describe('unidades de las líneas de un documento', () => {
  it('suma precio por cantidad', () => {
    expect(unidadesDeLineas('[{"price":45,"qty":120},{"price":520,"qty":60}]')).toBe(45 * 120 + 520 * 60);
  });

  it('devuelve 0 si el JSON está roto, para que se reporte y no se convierta', () => {
    expect(unidadesDeLineas('{no es json')).toBe(0);
    expect(unidadesDeLineas('null')).toBe(0);
    expect(unidadesDeLineas('{"no":"es una lista"}')).toBe(0);
  });

  it('tolera valores raros sin devolver NaN', () => {
    expect(unidadesDeLineas('[{"price":"x","qty":2},{"price":10,"qty":1}]')).toBe(10);
  });

  it('deduce el factor de un documento real contra su subtotal', () => {
    // cotizaciones: subtotal 1_130_000 con lineas que suman 11_300.
    const unidades = unidadesDeLineas('[{"price":4800,"qty":1},{"price":6500,"qty":1}]');
    expect(detectarFactor([{ unidades, centavos: 1130000 }])).toEqual({ factor: 1, ambiguo: true });
  });
});

describe('informe de discrepancias', () => {
  it('no repite la misma discrepancia', () => {
    const lista: DiscrepanciaPrecio[] = [];
    const d: DiscrepanciaPrecio = {
      donde: 'services.precio',
      legacyTenantId: 't1',
      unidades: 180,
      centavos: 12000,
      factor: NaN,
      motivo: 'las muestras no coinciden',
    };
    anotarDiscrepancia(lista, d);
    anotarDiscrepancia(lista, { ...d });
    expect(lista).toHaveLength(1);
  });

  it('distingue discrepancias de organizaciones distintas', () => {
    const lista: DiscrepanciaPrecio[] = [];
    const base: DiscrepanciaPrecio = {
      donde: 'services.precio',
      legacyTenantId: 't1',
      unidades: 180,
      centavos: 12000,
      factor: NaN,
      motivo: 'x',
    };
    anotarDiscrepancia(lista, base);
    anotarDiscrepancia(lista, { ...base, legacyTenantId: 't2' });
    expect(lista).toHaveLength(2);
  });
});
