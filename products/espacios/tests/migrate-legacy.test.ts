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
 * La migración de espacios.
 *
 * Lo que se prueba acá no es que "corra": es que NO invente. El legacy mezcló
 * reservas de espacio y citas en la misma tabla, y se distinguen por cuál de
 * los dos campos apunta. También dejó `appointment_services` vacía, así que no
 * hay ningún precio pactado contra el cual verificar nada. Cada una de esas
 * rarezas tiene una respuesta definida acá, y si alguien la cambia sin cambiar
 * estos tests, los datos de un cliente quedan mal en silencio.
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
  dir = mkdtempSync(join(tmpdir(), 'amg-espacios-mig-'));
  legacyPath = join(dir, 'legacy.db');
  destinoPath = join(dir, 'espacios.sqlite');
  legacy();
});

afterEach(() => {
  salida?.cerrar();
  salida = null;
  closeCoreDb();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Si algo quedó tomado, el sistema lo limpia solo: es una carpeta temporal.
  }
});

describe('migración de espacios', () => {
  it('mapea cada tenant a su propia organización en el Core', () => {
    const { informe } = migrar();
    expect(informe.organizaciones).toHaveLength(2);
    const ids = informe.organizaciones.map((o) => o.organizationId);
    expect(new Set(ids).size).toBe(2);
    for (const o of informe.organizaciones) {
      expect(o.accion).toBe('creada en el Core');
    }
  });

  it('trae espacios, extras y clientes conservando los ids legacy', () => {
    migrar();
    const espacios = leerDestino('SELECT * FROM spaces ORDER BY name');
    expect(espacios).toHaveLength(5);
    // El id legacy es la idempotencia: se conserva tal cual.
    expect(espacios.find((e) => e.name === 'Cancha Futbol 7')?.id).toBe('rec_futbol7');

    expect(leerDestino('SELECT * FROM addons')).toHaveLength(2);
    expect(leerDestino('SELECT * FROM customers')).toHaveLength(3);
  });

  it('trae el espacio inactivo como inactivo', () => {
    migrar();
    const reparacion = leerDestino("SELECT active FROM spaces WHERE id = 'rec_retirada'")[0];
    // No todo lo que existe está activo: traerse la fila como `1` sería mentir.
    expect(reparacion.active).toBe(0);
  });

  it('pone las reservas en su espacio, con el estado mapeado', () => {
    migrar();
    const reservas = leerDestino('SELECT * FROM bookings ORDER BY id');
    expect(reservas).toHaveLength(5);
    const r1 = reservas.find((r) => r.id === 'res_1');
    expect(r1.space_id).toBe('rec_futbol7');
    expect(r1.status).toBe('confirmed');
    // Cancelada se migra, no se tira: es historia.
    expect(reservas.find((r) => r.id === 'res_cancelada')?.status).toBe('cancelled');
  });

  it('calcula el total que el legacy no guardaba y lo materializa', () => {
    const { resumen } = migrar();
    // 2 horas a 30000.
    expect(leerDestino("SELECT total_cents FROM bookings WHERE id = 'res_1'")[0].total_cents).toBe(60000);
    // 1 hora y media a 15000.
    expect(leerDestino("SELECT total_cents FROM bookings WHERE id = 'res_2'")[0].total_cents).toBe(22500);
    expect(resumen.totalesCalculados).toBe(5);
  });

  it('no multiplica la tarifa por 100 aunque el número se vea grande', () => {
    migrar();
    // 30000 y 60000 YA SON centavos. Multiplicar por 100 sería un error de
    // 100x en la plata de todos los clientes, y es justo lo que pasó en citas.
    const cancha = leerDestino("SELECT price_per_hour_cents FROM spaces WHERE id = 'rec_futbol7'")[0];
    expect(cancha.price_per_hour_cents).toBe(30000);
  });

  it('copia el precio pactado de la línea tal cual, sin convertir', () => {
    crearLegacy(legacyPath, { conLineasDePrecio: true });
    migrar();
    expect(leerDestino('SELECT * FROM booking_addons ORDER BY id')).toHaveLength(2);
    // `price_at` es autoritativo: lo que se pactó en esa reserva.
    expect(leerDestino("SELECT price_cents FROM booking_addons WHERE id = 'lin_1'")[0].price_cents).toBe(500);
    // El total de esa reserva es la tarifa por las horas MÁS el extra.
    expect(leerDestino("SELECT total_cents FROM bookings WHERE id = 'res_1'")[0].total_cents).toBe(60500);
  });

  it('avisa que el dinero no se pudo verificar cuando no hay líneas', () => {
    const { resumen } = migrar();
    // 4 espacios + 2 extras de deportes, más 1 espacio de vip: 7 valores sin
    // contra qué verificarlos. No hay `appointment_services` en el fixture, que
    // es exactamente el problema del legacy real.
    expect(resumen.dineroSinVerificar).toBe(7);
  });

  it('reporta staff e inventario como tablas sin equivalente, y no las copia', () => {
    const { resumen } = migrar();
    const tablas = resumen.sinEquivalente.map((s) => s.tabla);
    expect(tablas).toContain('staff');
    expect(tablas).toContain('inventory_items');
    // El conteo tiene que ser el de verdad: 2 del personal, 2 del inventario.
    expect(resumen.sinEquivalente.find((s) => s.tabla === 'staff')?.filas).toBe(2);
    expect(resumen.sinEquivalente.find((s) => s.tabla === 'inventory_items')?.filas).toBe(2);
    // Y de verdad no están en el destino: no se inventaron tablas para meterlas.
    expect(leerDestino("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('staff','inventory_items')")).toHaveLength(0);
  });

  it('no se rompe si el legacy no tiene tabla de inventario', () => {
    legacy({ sinTablaInventario: true });
    const { resumen } = migrar();
    expect(resumen.sinEquivalente.map((s) => s.tabla)).not.toContain('inventory_items');
    expect(leerDestino('SELECT * FROM spaces')).toHaveLength(5);
  });

  it('frena si una reserva no tiene espacio: no se sabe a cuál pertenece', () => {
    legacy({ reservaSinEspacio: true });
    expect(() => migrar()).toThrow(ErrorMigracion);
    expect(() => migrar()).toThrow(/no tiene resource_id/);
  });

  it('frena si una reserva trae personal Y espacio: no se sabe qué es', () => {
    legacy({ reservaConPersonalYEspacio: true });
    expect(() => migrar()).toThrow(/resource_id y staff_id/);
  });

  it('migra un estado desconocido como pendiente y lo reporta', () => {
    legacy({ estadosRaros: true });
    const { resumen } = migrar();
    expect(resumen.estadosDesconocidos.join()).toMatch(/hold/);
    // No se tira la reserva: perderla por un texto sería peor.
    expect(leerDestino("SELECT status FROM bookings WHERE id = 'res_3'")[0].status).toBe('pending');
  });

  it('avisa de las autoras que no están en el Core', () => {
    legacy({ autoresDesconocidos: true });
    const { informe } = migrar();
    expect(informe.autoresSinCore.join()).toMatch(/ana@legacy\.test/);
  });

  it('no fusiona clientes homónimos de organizaciones distintas', () => {
    const { resumen } = migrar();
    // Mismo nombre, dos tenants, dos organizaciones: se copian tal cual.
    expect(leerDestino("SELECT * FROM customers WHERE name = 'Luisa Herrera'")).toHaveLength(2);
    expect(resumen.personasRepetidas.map((p) => p.nombre)).toContain('Luisa Herrera');
  });

  it('trae un espacio sin color con el default, sin romper la fila', () => {
    legacy({ espacioSinColor: true });
    migrar();
    const yoga = leerDestino("SELECT * FROM spaces WHERE id = 'rec_yoga'")[0];
    // La columna no admite nulos, así que la fila entra igual con el color por
    // defecto. Perder el espacio entero por un color faltante sería peor.
    expect(yoga.color).toBe('#0891b2');
    // Y la fila está completa: no se truncated nada.
    expect(yoga.name).toBe('Sala de Yoga');
    expect(yoga.price_per_hour_cents).toBe(15000);
  });

  it('es idempotente: la segunda pasada no duplica ni recalcula nada', () => {
    migrar();
    const antes = leerDestino('SELECT id, total_cents FROM bookings ORDER BY id');
    const resumenAntes = migrar();
    const despues = leerDestino('SELECT id, total_cents FROM bookings ORDER BY id');

    expect(despues).toHaveLength(antes.length);
    expect(despues).toEqual(antes);
    expect(leerDestino('SELECT * FROM spaces')).toHaveLength(5);
    // Lo que ya estaba se cuenta como omitido, y el informe de la segunda pasada
    // no dice que calculó totales que no calculó.
    expect(resumenAntes.informe.escritas.bookings ?? 0).toBe(0);
    expect(resumenAntes.resumen.totalesCalculados).toBe(0);
  });

  it('usa la jornada por defecto y lo deja dicho', () => {
    migrar();
    const cfg = leerDestino("SELECT * FROM settings WHERE id = 'cfg_ten_deportes'")[0];
    // El legacy no guardaba horario: es un default declarado, no un dato inventado.
    expect(cfg.opening_minutes).toBe(480);
    expect(cfg.closing_minutes).toBe(1320);
    expect(cfg.slot_minutes).toBe(60);
    expect(cfg.timezone).toBe('America/Mexico_City');
  });

  it('se niega a correr si no encuentra ninguna base legacy', () => {
    expect(() =>
      migrarLegacy({ destinoPath, fuentes: [{ etiqueta: 'nada', ruta: join(dir, 'no-existe.db') }] }),
    ).toThrow(/No se encontró ninguna base legacy/);
  });

  it('deja la base íntegra y sin filas huérfanas', () => {
    migrar();
    const db = new Database(destinoPath, { readonly: true });
    try {
      expect((db.prepare('PRAGMA integrity_check').get() as any).integrity_check).toBe('ok');
      expect(db.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});
