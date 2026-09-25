import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Server, type AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';

// El registro debe rechazar el slug NO autorizado ANTES de tocar la base:
// ni tenant, ni usuario, ni staff pueden quedar huérfanos.
let dir: string;
let file: string;
let server: Server;
let base: string;

const nuevo = {
  businessName: 'Empresa Fuera de Lista',
  slug: 'fuera-de-lista',
  ownerName: 'Dueño Externo',
  email: 'externo@ejemplo.cl',
  password: 'secreto123',
};

const cuenta = (() => {
  const { sqlite } = getDb();
  sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM appointment_services; DELETE FROM appointments;
               DELETE FROM documents; DELETE FROM inventory_movements; DELETE FROM inventory_items;
               DELETE FROM staff_services; DELETE FROM services; DELETE FROM staff;
               DELETE FROM customers; DELETE FROM users; DELETE FROM tenants;`);
  return { tenants: 0, users: 0, staff: 0 };
})();

function conteos() {
  const db = getDb().db;
  return {
    tenants: db.select().from(schema.tenants).all().length,
    users: db.select().from(schema.users).all().length,
    staff: db.select().from(schema.staffMembers).all().length,
  };
}

function puerta(data: unknown) {
  writeFileSync(file, JSON.stringify(data));
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'clients-register-'));
  file = join(dir, 'clients.json');
  process.env.CLIENTS_FILE = file;

  const app = createApp({ name: 'Pruebas', product: 'peluqueria' });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  delete process.env.CLIENTS_FILE;
  rmSync(dir, { recursive: true, force: true });
  server.close();
});

beforeEach(() => {
  getDb().sqlite.exec(`DELETE FROM users; DELETE FROM tenants;`);
});

async function registrar(body: unknown) {
  return fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('registro con la puerta de clientes encendida', () => {
  it('rechaza con 403 el slug que no está en la lista', async () => {
    puerta({ enabled: true, clients: { peluqueria: ['demo-pelu'] } });
    const res = await registrar(nuevo);
    expect(res.status).toBe(403);
    const cuerpo = (await res.json()) as { error: string };
    expect(cuerpo.error).toMatch(/todavía no está activado/i);
  });

  it('no deja filas huérfanas: ni tenant, ni usuario, ni staff', async () => {
    puerta({ enabled: true, clients: { peluqueria: ['demo-pelu'] } });
    await registrar(nuevo);
    expect(conteos()).toEqual(cuenta);
    expect(conteos()).toEqual({ tenants: 0, users: 0, staff: 0 });
  });

  it('el slug puede reutilizarse después si lo agregas a la lista', async () => {
    puerta({ enabled: true, clients: { peluqueria: ['demo-pelu'] } });
    expect((await registrar(nuevo)).status).toBe(403);

    puerta({ enabled: true, clients: { peluqueria: ['demo-pelu', nuevo.slug] } });
    expect((await registrar(nuevo)).status).toBe(201);
    expect(conteos().tenants).toBe(1);
    expect(conteos().users).toBe(1);
  });

  it('otro producto no autoriza slugs de peluqueria', async () => {
    puerta({ enabled: true, clients: { deportes: ['deportes-demo'] } });
    expect((await registrar(nuevo)).status).toBe(403);
    expect(conteos().tenants).toBe(0);
  });

  it('con la puerta apagada el registro sigue abierto', async () => {
    puerta({ enabled: false, clients: {} });
    expect((await registrar(nuevo)).status).toBe(201);
    expect(conteos().tenants).toBe(1);
  });
});
