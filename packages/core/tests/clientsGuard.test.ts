import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientGateEnabled, isClientActive } from '../src/guards/clientsGuard.js';

let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'clients-guard-'));
  file = join(dir, 'clients.json');
  process.env.CLIENTS_FILE = file;
});

afterAll(() => {
  delete process.env.CLIENTS_FILE;
  rmSync(dir, { recursive: true, force: true });
});

function write(data: unknown) {
  writeFileSync(file, JSON.stringify(data));
}

describe('clientsGuard', () => {
  it('todos pasan si el archivo no existe', () => {
    rmSync(file, { force: true });
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'cualquiera')).toBe(true);
  });

  it('todos pasan si enabled no es exactamente true', () => {
    write({ enabled: false, clients: { peluqueria: ['demo-pelu'] } });
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'libre')).toBe(true);
  });

  it('bloquea slugs fuera de la lista cuando la puerta está encendida', () => {
    write({ enabled: true, clients: { peluqueria: ['demo-pelu'] } });
    expect(isClientActive('peluqueria', 'demo-pelu')).toBe(true);
    expect(isClientActive('peluqueria', 'otro')).toBe(false);
    expect(isClientActive('deportes', 'demo-pelu')).toBe(false);
  });

  it('JSON inválido se comporta como puerta abierta', () => {
    writeFileSync(file, '{no valido');
    expect(clientGateEnabled()).toBe(false);
    expect(isClientActive('peluqueria', 'x')).toBe(true);
  });
});