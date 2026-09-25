import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clientGateEnabled,
  gateResumen,
  isClientActive,
  loadGate,
  resetAvisoPuerta,
} from '../src/guards/clientsGuard.js';

let dir: string;
let file: string;
let nodeEnv: string | undefined;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'clients-guard-'));
  file = join(dir, 'clients.json');
  process.env.CLIENTS_FILE = file;
  nodeEnv = process.env.NODE_ENV;
});

afterAll(() => {
  delete process.env.CLIENTS_FILE;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  resetAvisoPuerta();
  delete process.env.NODE_ENV;
});

afterEach(() => {
  delete process.env.NODE_ENV;
});

function write(data: unknown) {
  writeFileSync(file, JSON.stringify(data));
}

function comoProduccion() {
  process.env.NODE_ENV = 'production';
}

describe('clientsGuard en desarrollo', () => {
  it('deja pasar a todos si el archivo no existe', () => {
    rmSync(file, { force: true });
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'cualquiera')).toBe(true);
  });

  it('deja pasar a todos si el JSON esta roto', () => {
    writeFileSync(file, '{no valido');
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'x')).toBe(true);
  });

  it('respeta enabled:false como puerta abierta', () => {
    write({ enabled: false, clients: { peluqueria: ['demo-pelu'] } });
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'libre')).toBe(true);
  });

  it('bloquea slugs fuera de la lista cuando la puerta esta encendida', () => {
    write({ enabled: true, clients: { peluqueria: ['demo-pelu'] } });
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(true);
    expect(isClientActive('peluqueria', 'otro')).toBe(false);
    expect(isClientActive('deportes', 'demo-pelu')).toBe(false);
  });
});

describe('clientsGuard en produccion (fail-closed)', () => {
  it('con enabled:true funciona como siempre', () => {
    comoProduccion();
    write({ enabled: true, clients: { peluqueria: ['demo-pelu'] } });
    expect(clientGateEnabled()).toBe(true);
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(true);
    expect(isClientActive('peluqueria', 'otro')).toBe(false);
  });

  it('NADIE entra si el archivo no existe', () => {
    comoProduccion();
    rmSync(file, { force: true });
    expect(clientGateEnabled()).toBe(true);
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(false);
    expect(isClientActive('peluqueria', 'cualquiera')).toBe(false);
    expect(loadGate().source).toBe('faltante');
  });

  it('NADIE entra si el JSON esta corrupto', () => {
    comoProduccion();
    writeFileSync(file, '{no valido');
    expect(clientGateEnabled()).toBe(true);
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(false);
    expect(loadGate().source).toBe('invalido');
  });

  it('NADIE entra con enabled:false, ni siquiera los slugs de la lista', () => {
    comoProduccion();
    write({ enabled: false, clients: { peluqueria: ['demo-pelu'] } });
    expect(clientGateEnabled()).toBe(true);
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(false);
    expect(loadGate().source).toBe('desactivado');
  });

  it('NADIE entra si enabled falta, aunque la lista este llena', () => {
    comoProduccion();
    write({ clients: { peluqueria: ['demo-pelu'] } });
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(false);
  });

  it('NADIE entra si el archivo esta vacio', () => {
    comoProduccion();
    writeFileSync(file, '');
    expect(clientGateEnabled()).toBe(true);
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(false);
  });

  it('avisa una sola vez por proceso cuando la config esta rota', () => {
    comoProduccion();
    rmSync(file, { force: true });
    const errores: unknown[] = [];
    const original = console.error;
    console.error = (...a: unknown[]) => errores.push(a.join(' '));
    try {
      isClientActive('peluqueria', 'a');
      isClientActive('peluqueria', 'b');
      isClientActive('crm', 'c');
    } finally {
      console.error = original;
    }
    expect(errores).toHaveLength(1);
    expect(String(errores[0])).toMatch(/PUERTA CERRADA/);
  });
});

describe('gateResumen', () => {
  it('no filtra la ruta del archivo', () => {
    comoProduccion();
    rmSync(file, { force: true });
    const resumen = gateResumen();
    expect(resumen).toEqual({ cerrada: true, source: 'faltante' });
    expect(JSON.stringify(resumen)).not.toContain(dir);
  });

  it('reporta archivo cuando todo esta bien', () => {
    comoProduccion();
    write({ enabled: true, clients: { crm: ['demo-crm'] } });
    expect(gateResumen()).toEqual({ cerrada: true, source: 'archivo' });
  });
});
