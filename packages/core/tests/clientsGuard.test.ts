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
  delete process.env.CLIENTS_GATE;
});

afterEach(() => {
  delete process.env.NODE_ENV;
  delete process.env.CLIENTS_GATE;
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

  it('deja pasar a todos en modo subscriptions sin confirmar', () => {
    write({ mode: 'subscriptions' });
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'cualquiera')).toBe(true);
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
    // Y ahora ademas dice POR QUE, que es lo que faltaba: antes el operador
    // editaba una lista llena y no tenia forma de saber por que no servia.
    expect(loadGate().source).toBe('invalido');
    expect(loadGate().detalle).toMatch(/mode/);
  });

  it('NADIE entra si enabled falta, aunque la lista este llena', () => {
    comoProduccion();
    write({ clients: { peluqueria: ['demo-pelu'] } });
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(false);
  });

  // -------------------------------------------------------------- subscriptions
  it('mode:subscriptions abre la puerta SOLO si el contenedor lo confirma', () => {
    comoProduccion();
    write({ mode: 'subscriptions' });

    // Sin confirmar: el producto no consulta el Core, asi que la lista manda.
    delete process.env.CLIENTS_GATE;
    expect(loadGate().cerrada).toBe(true);
    expect(loadGate().mode).toBe('allowlist');

    // Confirmado: manda el Core y la lista deja de existir.
    process.env.CLIENTS_GATE = 'subscriptions';
    expect(loadGate().cerrada).toBe(false);
    expect(loadGate().source).toBe('suscripciones');
    expect(loadGate().mode).toBe('subscriptions');
    expect(isClientActive('peluqueria', 'nadie-me-listo')).toBe(true);
  });

  it('el archivo no puede abrir un producto que no confirma suscripciones', () => {
    comoProduccion();
    // El archivo pide abrir, el contenedor no lo confirma: gana lo mas cerrado.
    write({ mode: 'subscriptions', clients: { peluqueria: ['demo-pelu'] } });
    delete process.env.CLIENTS_GATE;
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(true);
    expect(isClientActive('peluqueria', 'otro')).toBe(false);
    expect(loadGate().detalle).toMatch(/CLIENTS_GATE/);
  });

  it('mode:allowlist con la lista es igual que enabled:true', () => {
    comoProduccion();
    delete process.env.CLIENTS_GATE;
    write({ mode: 'allowlist', clients: { peluqueria: ['demo-pelu'] } });
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(true);
    expect(isClientActive('peluqueria', 'otro')).toBe(false);
    expect(gateResumen()).toEqual({ cerrada: true, source: 'archivo', mode: 'allowlist' });
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
    expect(resumen).toEqual({ cerrada: true, source: 'faltante', mode: 'ninguno' });
    expect(JSON.stringify(resumen)).not.toContain(dir);
  });

  it('reporta archivo cuando todo esta bien', () => {
    comoProduccion();
    delete process.env.CLIENTS_GATE;
    write({ mode: 'allowlist', clients: { crm: ['demo-crm'] } });
    expect(gateResumen()).toEqual({ cerrada: true, source: 'archivo', mode: 'allowlist' });
  });
});
