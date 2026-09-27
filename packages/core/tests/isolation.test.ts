import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { getDb, schema } from '../src/db/index.js';
import { eq } from 'drizzle-orm';

/**
 * AISLAMIENTO ENTRE ORGANIZACIONES, EN TODOS LOS MÓDULOS
 * =======================================================
 *
 * Este archivo existe porque el aislamiento de este repositorio era una
 * SUPOSICIÓN hasta ahora. La aislamiento venía de que cada cliente tenía su
 * propio login y su propia base; nadie lo comprobaba. Con el Core, todos los
 * clientes de un producto comparten login y base, y se distinguen por
 * `tenant_id`. En ese modelo, un `where` olvidado no es un detalle: es la fila
 * de otro cliente.
 *
 * Por eso esto NO es "un test más". Son 7 productos legacy (peluqueria,
 * deportes, talleres, documentos, cotizaciones, crm, recordatorios) servidos
 * por el mismo `packages/core`, así que un hueco en un módulo se reproduce en
 * todos a la vez. Y el agujero clásico no es "el listado filtra mal", que se ve
 * mirando el código: es un `PUT /api/customers/:id` con el id de otro, que no
 * se ve hasta que se intenta.
 *
 * La técnica es siempre la misma: la organización B pide un recurso que es de A
 * y tiene que recibir 404. Un 403 también valdría, pero 404 es lo que hace el
 * código, y además no confirma la existencia del recurso ajeno. Un 200 es un
 * fallo, siempre.
 *
 * Lo que NO se comprueba aquí y hay que comprobar a mano: que la UI nodepte
 * datos de otra organización en el navegador (eso es caché del front).
 */

let server: Server;
let base = '';

const TENANT_A = 'aisla-a';
const TENANT_B = 'aisla-b';

interface Ctx {
  cookie: string;
  tenantId: string;
  userId: string;
}

/** Registra una organización y devuelve su cookie de sesión. */
async function crearOrganizacion(slug: string, nombre: string): Promise<Ctx> {
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      businessName: nombre,
      slug,
      ownerName: `Dueño ${slug}`,
      email: `dueno@${slug}.test`,
      password: 'secreto123',
    }),
  });
  if (r.status !== 201) throw new Error(`registro ${slug} devolvió ${r.status}`);
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
  const { db } = getDb();
  const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).get()!;
  const user = db.select().from(schema.users).where(eq(schema.users.email, `dueno@${slug}.test`)).get()!;
  return { cookie, tenantId: tenant.id, userId: user.id };
}

function como(ctx: Ctx) {
  return async (path: string, init: RequestInit = {}) =>
    fetch(base + path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        cookie: ctx.cookie,
        ...(init.headers ?? {}),
      },
    });
}

let a: Ctx;
let b: Ctx;

/** Rango de fechas que cubre todo lo sembrado, para los listados que lo exigen. */
const hoy = new Date().toISOString().slice(0, 10);
const manana = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

/** Crea en A todos los tipos de fila que los módulos consummen. */
function sembrarEnA(): Record<string, string> {
  const { db } = getDb();
  const t = a.tenantId;
  const customer = db.insert(schema.customers).values({ tenant_id: t, name: 'Cliente de A', phone: '111' }).returning().get();
  const service = db.insert(schema.services).values({ tenant_id: t, name: 'Servicio de A', durationMin: 30, price: 5000 }).returning().get();
  const staff = db.insert(schema.staffMembers).values({ tenant_id: t, name: 'Sasha de A' }).returning().get();
  const resource = db.insert(schema.resources).values({ tenant_id: t, name: 'Cancha de A', type: 'cancha', capacity: 4, pricePerHour: 9000 }).returning().get();
  const item = db.insert(schema.inventoryItems).values({ tenant_id: t, name: 'Repuesto de A', sku: 'A-1', quantity: 10, price: 18500 }).returning().get();
  const doc = db.insert(schema.documents).values({
    tenant_id: t,
    type: 'factura',
    number: 'F-A-1',
    title: 'Factura de A',
    customer_id: customer.id,
    customer_snapshot: 'Cliente de A',
    lines: JSON.stringify([{ description: 'Servicio de A', qty: 1, price: 10000 }]),
    subtotal: 10000,
    tax: 1600,
    total: 11600,
    status: 'draft',
  }).returning().get();
  const appt = db.insert(schema.appointments).values({
    tenant_id: t,
    customer_id: customer.id,
    staff_id: staff.id,
    service_id: service.id,
    start_at: new Date(Date.now() + 86_400_000).toISOString(),
    end_at: new Date(Date.now() + 90 * 60_000).toISOString(),
    status: 'confirmed',
  }).returning().get();
  const followup = db.insert(schema.followups).values({
    tenant_id: t,
    customer_id: customer.id,
    title: 'Llamar a Cliente de A',
    body: 'contenido de A',
    due_date: new Date().toISOString(),
    status: 'pending',
  }).returning().get();
  const reminder = db.insert(schema.reminderLogs).values({
    tenant_id: t,
    appointment_id: appt.id,
    channel: 'whatsapp',
    status: 'failed',
    error: 'fallo de prueba',
    sent_at: new Date().toISOString(),
  }).returning().get();
  const order = db.insert(schema.workOrders).values({
    tenant_id: t,
    number: 1,
    customer_id: customer.id,
    vehicle_make: 'Toyota',
    vehicle_model: 'Hilux',
    vehicle_plate: 'AA-11-11',
    status: 'received',
  }).returning().get();

  return {
    customer: customer.id,
    service: service.id,
    staff: staff.id,
    resource: resource.id,
    item: item.id,
    document: doc.id,
    appointment: appt.id,
    followup: followup.id,
    reminder: reminder.id,
    order: order.id,
  };
}

beforeAll(async () => {
  // Se monta TODA la superficie del core. Los productos legacy activan
  // subconjuntos distintos de estos routers (`deportes` los resources,
  // `talleres` los workorders, `inventario` sólo inventario), pero todos
  // consumen el mismo código: un `where` olvidado aquí se reproduce en los
  // siete productos a la vez. Probar producto por producto dejaría módulos sin
  // cubrir según qué flags se elijan, que es justo la clase de olvido que se
  // cuela.
  const app = createApp({
    name: 'Aislamiento',
    product: 'aislamiento-test',
    routers: {
      customers: true, services: true, staff: true, appointments: true,
      documents: true, inventory: true, resources: true, workorders: true,
      reminders: true, followups: true, dashboard: true,
    },
  });
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' ? addr!.port : addr}`;
});

beforeEach(async () => {
  const { sqlite } = getDb();
  sqlite.exec(`DELETE FROM reminder_logs; DELETE FROM work_order_parts; DELETE FROM work_order_services;
               DELETE FROM work_orders; DELETE FROM appointment_services; DELETE FROM followups;
               DELETE FROM appointments; DELETE FROM documents; DELETE FROM inventory_movements;
               DELETE FROM inventory_items; DELETE FROM staff_services; DELETE FROM services;
               DELETE FROM staff; DELETE FROM resources; DELETE FROM customers;
               DELETE FROM users; DELETE FROM tenants;`);
  a = await crearOrganizacion(TENANT_A, 'Empresa A');
  b = await crearOrganizacion(TENANT_B, 'Empresa B');
});

afterAll(() => server.close());

describe('B no alcanza ni un dato de A', () => {
  /** Cada caso: B pide algo de A y tiene que recibir 404. */
  const casos: Array<{ nombre: string; clave: keyof ReturnType<typeof sembrarEnA>; metodo: string; ruta: (id: string) => string; cuerpo?: unknown }> = [
    { nombre: 'cliente', clave: 'customer', metodo: 'GET', ruta: (id) => `/api/customers/${id}` },
    { nombre: 'servicio', clave: 'service', metodo: 'GET', ruta: (id) => `/api/services/${id}` },
    { nombre: 'personal', clave: 'staff', metodo: 'GET', ruta: (id) => `/api/staff/${id}` },
    { nombre: 'recurso', clave: 'resource', metodo: 'GET', ruta: (id) => `/api/resources/${id}` },
    { nombre: 'ítem de inventario', clave: 'item', metodo: 'GET', ruta: (id) => `/api/inventory/${id}` },
    { nombre: 'documento', clave: 'document', metodo: 'GET', ruta: (id) => `/api/documents/${id}` },
    { nombre: 'cita', clave: 'appointment', metodo: 'GET', ruta: (id) => `/api/appointments/${id}` },
    { nombre: 'seguimiento', clave: 'followup', metodo: 'GET', ruta: (id) => `/api/followups/${id}` },
    { nombre: 'orden de trabajo', clave: 'order', metodo: 'GET', ruta: (id) => `/api/workorders/${id}` },

    // Y no solo leer: también escribir. Un 404 en un PUT significa que ni
    // siquiera se puede pisar el dato ajeno.
    { nombre: 'cliente (PUT)', clave: 'customer', metodo: 'PUT', ruta: (id) => `/api/customers/${id}`, cuerpo: { name: 'Secuestrado' } },
    { nombre: 'servicio (PUT)', clave: 'service', metodo: 'PUT', ruta: (id) => `/api/services/${id}`, cuerpo: { name: 'Secuestrado', durationMin: 30, price: 1 } },
    { nombre: 'ítem (PUT)', clave: 'item', metodo: 'PUT', ruta: (id) => `/api/inventory/${id}`, cuerpo: { name: 'Secuestrado', quantity: 1, price: 1 } },
    { nombre: 'recurso (PUT)', clave: 'resource', metodo: 'PUT', ruta: (id) => `/api/resources/${id}`, cuerpo: { name: 'Secuestrado', type: 'cancha', capacity: 1, pricePerHour: 1 } },
    { nombre: 'cita (PUT)', clave: 'appointment', metodo: 'PUT', ruta: (id) => `/api/appointments/${id}`, cuerpo: { customerId: 'x', startAt: new Date(Date.now() + 259_200_000).toISOString(), durationMin: 30, status: 'cancelled' } },
    { nombre: 'cita (DELETE)', clave: 'appointment', metodo: 'DELETE', ruta: (id) => `/api/appointments/${id}` },
    { nombre: 'cliente (DELETE)', clave: 'customer', metodo: 'DELETE', ruta: (id) => `/api/customers/${id}` },
    { nombre: 'documento (DELETE)', clave: 'document', metodo: 'DELETE', ruta: (id) => `/api/documents/${id}` },
  ];

  for (const caso of casos) {
    it(`no puede ${caso.metodo} el ${caso.nombre} de A`, async () => {
      const ids = sembrarEnA();
      const id = ids[caso.clave];
      expect(id, `no se pudo ubicar el id del ${caso.nombre}`).toBeTruthy();

      const res = await como(b)(caso.ruta(id), {
        method: caso.metodo,
        body: caso.cuerpo ? JSON.stringify(caso.cuerpo) : undefined,
      });
      expect(res.status, `${caso.metodo} ${caso.ruta(id)} devolvió ${res.status} para un id ajeno`).toBe(404);
    });
  }
});

describe('los listados de B no contienen nada de A', () => {
  it('clientes, servicios, personal, recursos, inventario, documentos, citas y órdenes', async () => {
    sembrarEnA();
    const pedir = como(b);
    const rutas: Array<[string, string]> = [
      ['clientes', '/api/customers'],
      ['servicios', '/api/services'],
      ['personal', '/api/staff'],
      ['recursos', '/api/resources'],
      ['inventario', '/api/inventory'],
      ['movimientos', '/api/inventory/movements'],
      ['documentos', '/api/documents'],
      // La lista de citas exige un rango explícito; se da uno que contiene la
      // cita sembrada en A, que es justo la que B no debe ver.
      ['citas', `/api/appointments?from=${hoy}&to=${manana}`],
      ['seguimientos', '/api/followups'],
      ['registro de recordatorios', '/api/reminders/logs'],
      ['órdenes', '/api/workorders'],
      ['resumen', '/api/dashboard/summary'],
    ];
    for (const [nombre, ruta] of rutas) {
      const res = await pedir(ruta);
      expect(res.status, `${ruta} devolvió ${res.status}`).toBe(200);
      const cuerpo = await res.json();
      // Cualquier objeto devuelto tiene que pertenecer a B. Se comprueba por
      // nombre, que es como se notaría una fuga en la UI.
      const texto = JSON.stringify(cuerpo);
      expect(texto, `${ruta} leaked datos de la organización A`).not.toMatch(/ de A["']/);
      const vacio = Array.isArray(cuerpo) ? cuerpo.length === 0 : true;
      if (vacio) expect(cuerpo).toBeDefined();
    }
  });

  it('el resumen de B no cuenta los datos de A', async () => {
    sembrarEnA();
    const res = await como(b)('/api/dashboard/summary');
    expect(res.status).toBe(200);
    const { summary, upcoming } = await res.json();

    // A tiene 1 cliente, 1 cita de mañana y un ítem de inventario; B no tiene
    // nada. Los contadores tienen que estar en cero, no en uno: un contador que
    // suma lo ajeno no filtra datos por /api/customers pero sí por aquí.
    expect(summary.customers).toBe(0);
    expect(summary.appointmentsToday).toBe(0);
    expect(summary.lowStockItems).toBe(0);
    expect(upcoming).toEqual([]);
  });
});

describe('las escrituras de B no tocan los datos de A', () => {
  it('crear recursos en B no aparece en el listado de A', async () => {
    const ids = sembrarEnA();
    const crear = como(b);
    const altaCliente = await crear('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ name: 'Cliente de B', phone: '999' }),
    });
    expect(altaCliente.status).toBe(201);
    const nuevo = (await altaCliente.json()).customer.id;

    const listaA = await como(a)('/api/customers');
    const idsA = (await listaA.json()).customers.map((c: { id: string }) => c.id);
    expect(idsA).toContain(ids.customer);
    expect(idsA).not.toContain(nuevo);
  });

  it('B no puede colgar su cita de un servicio de A', async () => {
    const ids = sembrarEnA();
    // Si la validación de referencias no filtra por tenant, B agenda sobre el
    // catálogo de A. Elkalba tiene que estar en la cita.
    const res = await como(b)('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        customerId: ids.customer,
        serviceId: ids.service,
        startAt: new Date(Date.now() + 172_800_000).toISOString(),
        endAt: new Date(Date.now() + 172_800_000 + 1_800_000).toISOString(),
      }),
    });
    // Cualquiera de estos dos resultados es correcto; un 201 con datos de A, no.
    expect([201, 400, 404, 409]).toContain(res.status);

    if (res.status === 201) {
      const cita = (await res.json()).appointment;
      expect(cita.serviceId).not.toBe(ids.service);
    }
  });
});
