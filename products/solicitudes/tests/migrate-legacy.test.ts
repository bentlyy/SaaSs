import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { closeCoreDb } from '@amg/platform';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  ErrorMigracion,
  migrarLegacy,
  type FuenteLegacy,
  type ResultadoMigracion,
} from '../src/migrate-legacy.js';
import { crearLegacy, type OpcionesFixture } from './legacy-fixture.js';

/**
 * La migracion de solicitudes.
 *
 * Lo que se prueba aca no es que "corra": es que NO invente. El legacy guardaba
 * datos de vehiculo en cada orden y este producto no tiene vehiculos; guardaba
 * lineas de repuesto que apuntan a otra base; y NO guardaba el total de la orden.
 * Cada una de esas rarezas tiene una respuesta definida aca, y si alguien la
 * cambia sin cambiar estos tests, los datos de un cliente quedan mal en silencio.
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

/** Corre la migracion y la deja abierta para poder leer el destino. */
function migrar(fuentes: FuenteLegacy[] = [{ etiqueta: 'fixture', ruta: legacyPath }]) {
  salida = migrarLegacy({ destinoPath, fuentes });
  return salida;
}

/**
 * Lee una tabla del destino y CIERRA la conexion.
 *
 * En Windows un handle de SQLite abierto impide borrar el archivo, asi que abrir
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

/**
 * Escribe en el destino a proposito, para simular lo que pasaria si el negocio
 * subiera precios despues de migrar.
 *
 * Se abre SIN `readonly` porque aca si hay que escribir. `leerDestino` no puede
 * servir para esto: `.all()` sobre un UPDATE tira "This statement does not
 * return data", que es un error del helper y no del producto.
 */
function escribirDestino(sql: string, ...params: unknown[]): void {
  const db = new Database(destinoPath);
  try {
    db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'amg-solicitudes-mig-'));
  legacyPath = join(dir, 'legacy.db');
  destinoPath = join(dir, 'solicitudes.sqlite');
  legacy();
});

afterEach(() => {
  salida?.cerrar();
  salida = null;
  closeCoreDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Si algo quedo tomado, el sistema lo limpia solo: es una carpeta temporal.
  }
});

describe('migracion de solicitudes', () => {
  it('mapea cada tenant a su propia organizacion en el Core', () => {
    const { informe } = migrar();
    expect(informe.organizaciones).toHaveLength(2);
    const ids = informe.organizaciones.map((o) => o.organizationId);
    expect(new Set(ids).size).toBe(2);
    for (const o of informe.organizaciones) {
      expect(o.accion).toBe('creada en el Core');
    }
  });

  it('trae ordenes, trabajos, clientes y tecnicos conservando los ids legacy', () => {
    migrar();
    const ordenes = leerDestino('SELECT * FROM orders ORDER BY organization_id, number');
    expect(ordenes).toHaveLength(6);
    // El id legacy es la idempotencia: se conserva tal cual.
    expect(ordenes.find((o) => o.id === 'ord_1')?.id).toBe('ord_1');

    expect(leerDestino('SELECT * FROM services')).toHaveLength(3);
    expect(leerDestino('SELECT * FROM customers')).toHaveLength(3);
    expect(leerDestino('SELECT * FROM technicians')).toHaveLength(4);
  });

  it('trae la orden sin tecnico y la cuenta en el informe', () => {
    const { resumen } = migrar();
    const sinTecnico = leerDestino('SELECT * FROM orders WHERE technician_id IS NULL');
    expect(sinTecnico).toHaveLength(1);
    expect(sinTecnico[0].id).toBe('ord_2');
    expect(resumen.sinTecnico).toBe(1);
  });

  it('trae el tecnico sin color con el color por defecto', () => {
    migrar();
    // La columna del destino no admite nulos y el legacy los admite: sin el
    // default, la fila entera no entraria.
    const fila = leerDestino('SELECT * FROM technicians WHERE id = ?', 'tec_2')[0];
    expect(fila.color).toBe('#4f46e5');
  });

  it('preserva los cinco estados del legacy', () => {
    migrar();
    const estados = leerDestino('SELECT DISTINCT status FROM orders ORDER BY status').map(
      (f) => f.status,
    );
    // Son los del taller de verdad: received, estimated, in_progress, done,
    // cancelled. Cambiarlos seria inventar una mejora que nadie pidio.
    expect(estados).toEqual(['cancelled', 'done', 'estimated', 'in_progress', 'received']);
  });

  it('un estado desconocido se migra como received y se reporta', () => {
    crearLegacy(legacyPath, { estadosRaros: true });
    const { resumen } = migrar();
    const ordenes = leerDestino('SELECT * FROM orders WHERE id = ?', 'ord_4');
    expect(ordenes[0].status).toBe('received');
    expect(resumen.estadosDesconocidos.join(' ')).toContain('hold');
  });

  // ─────────────────────────────────────────────────────────── lo que se pierde

  it('reporta el vehiculo como dato SIN destino, sin inventar un equivalente', () => {
    const { resumen } = migrar();
    // 5 de las 6 ordenes del fixture traen vehiculo. `ord_tec` viene con las
    // columnas en cadena vacia, y una cadena vacia NO es un vehiculo: si se
    // contara, el informe estaria diciendo que se perdio algo que no existia.
    const vehiculo = resumen.camposSinDestino.find((c) => c.campo.startsWith('vehicle_make'));
    expect(vehiculo).toBeDefined();
    expect(vehiculo!.ordenes).toBe(5);
    expect(vehiculo!.motivo).toContain('no tiene vehiculos');
  });

  it('el asset de las ordenes migradas queda en NULL a proposito', () => {
    migrar();
    // Poner "Nissan Versa a123bc" aca seria mentir sobre lo que se migro: el
    // producto no tiene el concepto de vehiculo, tiene un texto libre.
    const conAsset = leerDestino("SELECT * FROM orders WHERE asset IS NOT NULL AND asset <> ''");
    expect(conAsset).toHaveLength(0);
  });

  it('reporta el cumpleanos del cliente como dato sin destino', () => {
    const { resumen } = migrar();
    const cumple = resumen.camposSinDestino.find((c) => c.campo === 'customers.birthdate');
    expect(cumple).toBeDefined();
    // Solo cli_1 lo tiene.
    expect(cumple!.ordenes).toBe(1);
  });

  it('reporta el inventario como tabla sin equivalente, sin copiarlo', () => {
    const { resumen } = migrar();
    const items = resumen.sinEquivalente.find((s) => s.tabla === 'inventory_items');
    expect(items).toBeDefined();
    expect(items!.filas).toBe(2);
    expect(items!.motivo).toContain('inventario');
    // Y no existe en el destino: es de otro producto.
    expect(leerDestino("SELECT name FROM sqlite_master WHERE name = 'inventory_items'")).toHaveLength(0);
  });

  it('reporta los movimientos de inventario como tabla sin equivalente', () => {
    const { resumen } = migrar();
    const movs = resumen.sinEquivalente.find((s) => s.tabla === 'inventory_movements');
    expect(movs).toBeDefined();
    expect(movs!.filas).toBe(1);
  });

  it('una base sin inventario migra igual', () => {
    crearLegacy(legacyPath, { sinTablaInventario: true });
    const { resumen } = migrar();
    // El `tiene` evita que contar una tabla inexistente tire la migracion entera
    // por algo que no importa.
    expect(resumen.sinEquivalente.find((s) => s.tabla === 'inventory_items')).toBeUndefined();
    expect(leerDestino('SELECT * FROM orders')).toHaveLength(6);
  });

  it('una base sin movimientos migra igual', () => {
    crearLegacy(legacyPath, { sinTablaMovimientos: true });
    const { resumen } = migrar();
    expect(resumen.sinEquivalente.find((s) => s.tabla === 'inventory_movements')).toBeUndefined();
  });

  // ─────────────────────────────────────────────────────────────── el dinero

  it('copia el precio pactado tal cual, sin multiplicar por 100', () => {
    migrar();
    // 25000 son $250.00. Si alguien multiplicara, 25000 x 100 = 2500000 y la
    // cuenta saldria a 25000 pesos por un cambio de aceite.
    const linea = leerDestino('SELECT * FROM order_services WHERE id = ?', 'lin_1')[0];
    expect(linea.price_cents).toBe(25000);

    const parte = leerDestino('SELECT * FROM order_parts WHERE id = ?', 'par_1')[0];
    expect(parte.unit_price_cents).toBe(18500);
  });

  it('calcula el total que el legacy no guardaba y lo materializa', () => {
    const { resumen } = migrar();
    // ord_1: trabajo 25000 + 60000 = 85000, repuestos 4 x 18500 + 1 x 9800 = 83800.
    // Total 168800.
    const orden = leerDestino('SELECT * FROM orders WHERE id = ?', 'ord_1')[0];
    expect(orden.total_cents).toBe(85000 + 74000 + 9800);
    expect(resumen.totalesCalculados).toBe(6);
  });

  it('el total no cambia si el precio del catalogo cambia despues', () => {
    migrar();
    // Se sube la tarifa del trabajo en el CATALOGO. La orden ya pactada tiene que
    // seguir valiendo lo que valio: para eso el total esta guardado en la fila.
    escribirDestino('UPDATE services SET price_cents = 999999 WHERE id = ?', 'srv_aceite');
    const orden = leerDestino('SELECT * FROM orders WHERE id = ?', 'ord_1')[0];
    expect(orden.total_cents).toBe(85000 + 74000 + 9800);
  });

  it('ajusta el folio siguiente al maximo de las ordenes migradas', () => {
    migrar();
    // Si se dejara en 1, la primera orden nueva chocaria contra el indice unico
    // (organization_id, number) con una orden que ya existe.
    const taller = leerDestino(
      "SELECT s.* FROM settings s JOIN orders o ON o.organization_id = s.organization_id WHERE o.id = 'ord_5'",
    )[0];
    expect(taller.next_number).toBe(6);
  });

  it('copia el nombre del repuesto para que la linea se lea sin otro producto', () => {
    migrar();
    // Los repuestos viven en la base de `inventario`, que es otra base. La linea
    // guarda una foto del nombre para poder leerse sin abrirla.
    const parte = leerDestino('SELECT * FROM order_parts WHERE id = ?', 'par_1')[0];
    expect(parte.item_name).toBe('Pastilla de freno');
  });

  it('una linea cuyo repuesto no existe entra con un nombre de reemplazo y se reporta', () => {
    const { resumen } = migrar();
    const parte = leerDestino('SELECT * FROM order_parts WHERE id = ?', 'par_3')[0];
    // Perder el nombre es molesto; perder la linea entera es peor.
    expect(parte.item_name).toBe('Repuesto itm_fantasma');
    expect(resumen.referenciasSinDestino.join(' ')).toContain('itm_fantasma');
    expect(resumen.totalDestino.order_parts).toBe(3);
  });

  // ─────────────────────────────────────────────────────────────── idempotencia

  it('la segunda pasada no duplica nada y no vuelve a calcular totales', () => {
    migrar();
    const primera = {
      ordenes: leerDestino('SELECT * FROM orders').length,
      lineas: leerDestino('SELECT * FROM order_services').length,
    };

    const segunda = migrar();
    expect(leerDestino('SELECT * FROM orders')).toHaveLength(primera.ordenes);
    expect(leerDestino('SELECT * FROM order_services')).toHaveLength(primera.lineas);
    expect(segunda.informe.omitidas).toBeGreaterThan(0);
    // Los totales NO se vuelven a contar: el informe de la segunda pasada tiene
    // que decir que no calculó nada, o parece quenake migró de nuevo.
    expect(segunda.resumen.totalesCalculados).toBe(0);
  });

  it('la segunda pasada no vuelve a crear organizaciones', () => {
    migrar();
    const { informe } = migrar();
    for (const o of informe.organizaciones) {
      expect(o.accion).toBe('ya migrada');
    }
  });

  it('el mapa legacy -> organización queda escrito', () => {
    migrar();
    const mapa = leerDestino('SELECT * FROM legacy_tenant_map');
    expect(mapa).toHaveLength(2);
    expect(mapa.find((m) => m.legacy_slug === 'demo-talleres')).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────── fallas

  it('una orden que apunta a un tecnico inexistente frena la migracion', () => {
    crearLegacy(legacyPath, { ordenConTecnicoInexistente: true });
    // Dejar la referencia colgando en silencio es peor que no migrar: una orden
    // sin responsable es una orden que nadie va a ver.
    expect(() => migrar()).toThrow(ErrorMigracion);
    expect(() => migrar()).toThrow(/tec_fantasma/);
  });

  it('sin ninguna base legacy no se abre el destino', () => {
    expect(() => migrar([{ etiqueta: 'fantasma', ruta: join(dir, 'no-existe.db') }])).toThrow(
      /No se encontro ninguna base legacy/,
    );
    // Y sobre todo: no se creó una base vacía diciendo que terminó.
    expect(() => leerDestino('SELECT 1')).toThrow();
  });

  it('reporta los autores del legacy que no estan en el Core', () => {
    crearLegacy(legacyPath, { autoresDesconocidos: true });
    const { informe } = migrar();
    expect(informe.autoresSinCore.join(' ')).toContain('Ana Legacy');
  });

  it('reporta el mismo nombre de cliente en dos organizaciones sin fusionarlas', () => {
    const { resumen } = migrar();
    expect(resumen.personasRepetidas.map((p) => p.nombre)).toContain('Ana Torres');
    // Y siguen siendo dos clientes distintos.
    expect(leerDestino("SELECT * FROM customers WHERE name = 'Ana Torres'")).toHaveLength(2);
  });
});
