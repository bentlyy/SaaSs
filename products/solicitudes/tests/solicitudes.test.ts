import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Solicitudes y ordenes sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy. En el producto viejo el
 * aislamiento venía de que cada organización tenía su propio login; ahora las
 * organizaciones comparten login y se distinguen por el token, así que el
 * aislamiento hay que probarlo: que una empresa no pueda leer ni escribir lo de
 * otra, aunque adivine el id.
 *
 * Y hay tres reglas que son de ESTE producto y no se pueden dar por supuestas:
 *
 *   - El FOLIO es unico por organización, no global. Dos empresas pueden tener
 *     cada una su orden numero 1.
 *   - El total se guarda en la fila. Si mañana suben las tarifas, una orden vieja
 *     tiene que seguir valiendo lo que valió el día que se hizo.
 *   - Cada línea apunta a algo de ESTA organización. Sin eso, un cliente podría
 *     colar el id de un trabajo de otra empresa y ver su precio.
 *
 * OJO con los sobres de respuesta, que no son todos iguales y por eso confunden:
 * el catálogo (clientes, trabajos, técnicos) lo resuelve `crudRouter`, y devuelve
 * la fila pelada al crear y `{ items }` al listar. Las órdenes y los ajustes son
 * rutas propias y van envueltas en `{ order }` y `{ settings }`.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Alta de trabajo, que es lo que la orden necesita. */
async function nuevoTrabajo(
  orgId: string,
  datos: Record<string, unknown> = {},
): Promise<string> {
  const res = await comoAdmin(orgId)
    .post('/api/services')
    .send({ name: 'Cambio de aceite', priceCents: 25000, durationMin: 60, ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function nuevoCliente(orgId: string, name = 'Ana Torres'): Promise<string> {
  const res = await comoAdmin(orgId).post('/api/customers').send({ name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function nuevoTecnico(orgId: string, name = 'Jorge'): Promise<string> {
  const res = await comoAdmin(orgId).post('/api/technicians').send({ name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  // Datos en A y en B, para probar el aislamiento con ids que existen de verdad
  // en la otra organización.
  await nuevoCliente(TEST_ORG_A, 'Cliente de Alpha');
  await nuevoCliente(TEST_ORG_B, 'Cliente de Beta');
  await nuevoTrabajo(TEST_ORG_A, { name: 'Trabajo de Alpha' });
  await nuevoTrabajo(TEST_ORG_B, { name: 'Trabajo de Beta' });
  await nuevoTecnico(TEST_ORG_A, 'Tecnico de Alpha');
  await nuevoTecnico(TEST_ORG_B, 'Tecnico de Beta');
});

describe('la interfaz', () => {
  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Solicitudes');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organización. Por eso no hay ningún id de organización en el HTML.
    expect(html.text).not.toContain(TEST_ORG_A);

    for (const estatico of ['/app.js', '/style.css']) {
      expect((await tp.as({ orgId: TEST_ORG_A }).get(estatico)).status).toBe(200);
    }
  });

  it('no sirve el HTML sin sesión: redirige al login central', async () => {
    const res = await tp.anon().get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });

  it('la UI no ofrece login: la sesión es del Core', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    // Ningún campo de contraseña: un login en el producto sería un segundo
    // sistema de identidad.
    expect(html.text).not.toMatch(/type=["']password["']/i);

    // Y la salida se resuelve contra el Core, no contra un logout local. Es un
    // enlace normal en el HTML, no una función de JavaScript.
    expect(html.text).toContain('/auth/logout');
  });

  it('la UI no pide vehiculos: el producto es de cualquier rubro', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    // Este producto no tiene el concepto de vehiculo. Si la UI pidiera patente o
    // kilometraje, habria vuelto el producto de un taller mecanico.
    expect(html.text).not.toMatch(/patente/i);
    expect(html.text).not.toMatch(/kilometra/i);
    // Lo que hay es un texto libre para decir sobre qué se trabaja.
    expect(html.text).toMatch(/id="orden-bien"/);
  });

  it('la UI no inventa datos ni resuelve el folio en el navegador', async () => {
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    expect(js.text).not.toContain(TEST_ORG_A);
    expect(js.text).toContain('/api/orders');
  });

  it('el folio de una orden nueva sale de los ajustes ya cargados', async () => {
    // Regresion: `cargar()` guarda el objeto de ajustes tal cual en
    // `estado.cfg`, asi que leer `estado.cfg.settings` es leer `undefined` y el
    // boton "Nueva orden" revienta con un TypeError. Los tests de UI son
    // estaticos, asi que sin este chequeo el bug volveria sin que nadie lo note.
    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;

    // Lo que se guarda es el objeto de ajustes, sin envolver.
    expect(js).toMatch(/estado\.cfg\s*=\s*cfg\.settings/);
    // Y por lo tanto nadie busca un `settings` adentro de el.
    expect(js, 'la UI lee un `settings` anidado que no existe').not.toMatch(/estado\.cfg\.settings/);
    expect(js).toMatch(/estado\.cfg\.nextNumber/);
  });

  it('el form de ajustes se llena por form.elements, no por ids sueltos', async () => {
    // Mismo contrato que el resto de los productos: agregar un ajuste es
    // agregar un <input name="..."> en el HTML, no tocar el JS.
    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;
    const fn = js.match(/function renderConfig\(\)\s*\{[\s\S]*?\n\}/);
    expect(fn, 'no se encontro renderConfig()').toBeTruthy();
    expect(fn![0]).toMatch(/form\.elements/);
  });
});

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/orders')).status).toBe(401);
  });

  it('la API no acepta una organización que no viene del token', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ organizationId: TEST_ORG_B, asset: 'Invasion' });
    expect(res.status).toBe(201);

    // Se creó, pero en la organización del token, no en la que pedía.
    expect(res.body.order.organizationId).toBe(TEST_ORG_A);

    const enB = await comoAdmin(TEST_ORG_B).get('/api/orders');
    expect(enB.body.orders.some((o: any) => o.asset === 'Invasion')).toBe(false);
  });
});

describe('órdenes', () => {
  it('crea una orden con el folio siguiente y lo materializa', async () => {
    const trabajo = (await comoAdmin(TEST_ORG_A).get('/api/services')).body.items[0].id;
    const cliente = (await comoAdmin(TEST_ORG_A).get('/api/customers')).body.items[0].id;

    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/orders')
      .send({
        customerId: cliente,
        technicianId: (await comoAdmin(TEST_ORG_A).get('/api/technicians')).body.items[0].id,
        asset: 'Lavadora del local',
        status: 'in_progress',
        estimatedDelivery: '2026-10-05',
        services: [{ serviceId: trabajo }],
        parts: [{ itemId: 'itm_inventario_1', itemName: 'Pastilla', qty: 4, unitPriceCents: 18500 }],
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const orden = res.body.order;
    // El trabajo sin precio toma la tarifa vigente del catálogo.
    expect(orden.totalCents).toBe(25000 + 4 * 18500);
    expect(orden.asset).toBe('Lavadora del local');
    expect(orden.estimatedDelivery).toBe('2026-10-05');
    expect(orden.number).toBeGreaterThan(0);
  });

  it('el total no se recalcula al leer: cambia con la tarifa del catálogo', async () => {
    const trabajo = await nuevoTrabajo(TEST_ORG_A, { name: 'Ajuste fino', priceCents: 10000 });
    const creada = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ services: [{ serviceId: trabajo }], status: 'done' });
    expect(creada.body.order.totalCents).toBe(10000);

    // Se sube la tarifa del catálogo. La orden vieja tiene que seguir valiendo
    // lo que valió, o el histórico del taller cambia de la noche a la mañana.
    await comoAdmin(TEST_ORG_A).patch(`/api/services/${trabajo}`).send({ priceCents: 999999 });

    const despues = await comoAdmin(TEST_ORG_A).get(`/api/orders/${creada.body.order.id}`);
    expect(despues.body.order.totalCents).toBe(10000);
  });

  it('un precio pactado manda sobre la tarifa del catálogo', async () => {
    const trabajo = await nuevoTrabajo(TEST_ORG_A, { name: 'Trabajo con descuento', priceCents: 10000 });
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ services: [{ serviceId: trabajo, priceCents: 7000 }] });
    // Cuando el cliente negoció, manda lo que se pactó.
    expect(res.body.order.totalCents).toBe(7000);
  });

  it('rechaza un folio repetido en la misma organización', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ number: 1, asset: 'Choca el folio' });
    expect(res.status).toBe(409);
  });

  it('el folio NO es global: dos organizaciones pueden empezar en 1', async () => {
    const a = await comoAdmin(TEST_ORG_A).post('/api/orders').send({ number: 900, asset: 'A' });
    const b = await comoAdmin(TEST_ORG_B).post('/api/orders').send({ number: 900, asset: 'B' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
  });

  it('propone el folio siguiente como el máximo que existe más uno', async () => {
    const res = await comoAdmin(TEST_ORG_A).get('/api/settings');
    // Si se calculara contando, cancelar una orden haría que el folio propuesto
    // fuera uno que ya existe.
    const ordenes = (await comoAdmin(TEST_ORG_A).get('/api/orders?limit=500')).body.orders;
    const maximo = Math.max(...ordenes.map((o: any) => o.number));
    expect(res.body.settings.nextNumber).toBe(maximo + 1);
  });

  it('editar el estado no pierde las líneas', async () => {
    const trabajo = await nuevoTrabajo(TEST_ORG_A, { name: 'Solo para editar' });
    const creada = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({
        services: [{ serviceId: trabajo }],
        parts: [{ itemId: 'itm_x', itemName: 'Filtro', qty: 2, unitPriceCents: 1000 }],
        notes: 'Nota original',
      });

    // Un PATCH con solo el estado: el resto tiene que sobrevivir, o cambiar el
    // estado de una orden borraría su detalle.
    const parcheado = await comoAdmin(TEST_ORG_A)
      .patch(`/api/orders/${creada.body.order.id}`)
      .send({ status: 'done' });
    expect(parcheado.status).toBe(200);

    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/orders/${creada.body.order.id}`);
    expect(detalle.body.order.status).toBe('done');
    expect(detalle.body.order.notes).toBe('Nota original');
    expect(detalle.body.services).toHaveLength(1);
    expect(detalle.body.parts).toHaveLength(1);
    expect(detalle.body.order.totalCents).toBe(25000 + 2000);
  });

  it('reemplaza las líneas al editar y recalcula el total', async () => {
    const trabajo = await nuevoTrabajo(TEST_ORG_A, { name: 'Linea que se va', priceCents: 1000 });
    const creada = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ services: [{ serviceId: trabajo }] });
    expect(creada.body.order.totalCents).toBe(1000);

    const parcheada = await comoAdmin(TEST_ORG_A)
      .patch(`/api/orders/${creada.body.order.id}`)
      .send({ services: [] });
    // Sacar la única línea deja la orden en cero, no con el total viejo.
    expect(parcheada.body.order.totalCents).toBe(0);

    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/orders/${creada.body.order.id}`);
    expect(detalle.body.services).toHaveLength(0);
  });

  it('borra la orden con sus líneas', async () => {
    const trabajo = await nuevoTrabajo(TEST_ORG_A, { name: 'Para borrar' });
    const creada = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ services: [{ serviceId: trabajo }] });

    const res = await comoAdmin(TEST_ORG_A).delete(`/api/orders/${creada.body.order.id}`);
    expect(res.status).toBe(200);

    // Las líneas se van con la orden: el DDL las declara con ON DELETE CASCADE.
    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/orders/${creada.body.order.id}`);
    expect(detalle.status).toBe(404);
  });

  it('rechaza una fecha de entrega que no es una fecha', async () => {
    // "próximo martes" es una respuesta de un taller, no algo que se pueda
    // comparar ni ordenar. Se acepta "2026-10-05" o nada.
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ estimatedDelivery: 'proximo martes' });
    expect(res.status).toBe(400);
  });

  it('rechaza una cantidad de repuesto cero o negativa', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ parts: [{ itemId: 'itm_y', itemName: 'Nada', qty: 0, unitPriceCents: 100 }] });
    expect(res.status).toBe(400);
  });

  it('exige nombre en el repuesto: la línea tiene que poder leerse', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ parts: [{ itemId: 'itm_z', qty: 1, unitPriceCents: 100 }] });
    // El repuesto vive en otra base. Sin el nombre, la línea quedaría con un id
    // que no se puede leer ni acá ni desde la pantalla.
    expect(res.status).toBe(400);
  });
});

describe('tablero y resumen', () => {
  it('agrupa las órdenes por estado y trae los nombres resueltos', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente del tablero');
    await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ customerId: cliente, status: 'estimated', asset: 'Compresor' });

    const res = await comoAdmin(TEST_ORG_A).get('/api/tablero');
    expect(res.status).toBe(200);
    // Se arman los cinco estados aunque alguno esté vacío: una columna que
    // aparece y desaparece hace que la pantalla "salte" mientras se trabaja.
    expect(res.body.columnas).toHaveLength(5);
    expect(res.body.columnas.map((c: any) => c.estado)).toEqual([
      'received',
      'estimated',
      'in_progress',
      'done',
      'cancelled',
    ]);

    const estimada = res.body.columnas.find((c: any) => c.estado === 'estimated');
    const delCompresor = estimada.ordenes.find((o: any) => o.asset === 'Compresor');
    expect(delCompresor.customerName).toBe('Cliente del tablero');
  });

  it('el resumen no cuenta una orden cancelada como trabajo por cobrar', async () => {
    const trabajo = await nuevoTrabajo(TEST_ORG_A, { name: 'Cancelada', priceCents: 5000 });
    const creada = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ services: [{ serviceId: trabajo }], status: 'in_progress' });

    const antes = await comoAdmin(TEST_ORG_A).get('/api/resumen');
    await comoAdmin(TEST_ORG_A)
      .patch(`/api/orders/${creada.body.order.id}`)
      .send({ status: 'cancelled' });
    const despues = await comoAdmin(TEST_ORG_A).get('/api/resumen');

    // Una orden cancelada no se va a entregar: sumarla como deuda daría un número
    // que nadie debe.
    expect(despues.body.abiertas).toBe(antes.body.abiertas - 1);
    expect(despues.body.porCobrarCents).toBe(antes.body.porCobrarCents - 5000);
  });
});

describe('aislamiento entre organizaciones', () => {
  it('no deja ver una orden de otra organización', async () => {
    const ordenB = await comoAdmin(TEST_ORG_B).post('/api/orders').send({ asset: 'De Beta' });
    const res = await comoAdmin(TEST_ORG_A).get(`/api/orders/${ordenB.body.order.id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('no deja modificar una orden de otra organización', async () => {
    const ordenB = await comoAdmin(TEST_ORG_B).post('/api/orders').send({ asset: 'De Beta' });
    const res = await comoAdmin(TEST_ORG_A)
      .patch(`/api/orders/${ordenB.body.order.id}`)
      .send({ asset: 'Robada' });
    expect([403, 404]).toContain(res.status);

    const sigue = await comoAdmin(TEST_ORG_B).get(`/api/orders/${ordenB.body.order.id}`);
    expect(sigue.body.order.asset).toBe('De Beta');
  });

  it('no deja borrar una orden de otra organización', async () => {
    const ordenB = await comoAdmin(TEST_ORG_B).post('/api/orders').send({ asset: 'De Beta' });
    const res = await comoAdmin(TEST_ORG_A).delete(`/api/orders/${ordenB.body.order.id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('no deja usar un cliente de otra organización', async () => {
    const clientesB = await comoAdmin(TEST_ORG_B).get('/api/customers');
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ customerId: clientesB.body.items[0].id });
    expect([400, 403, 404]).toContain(res.status);
  });

  it('no deja usar un técnico de otra organización', async () => {
    const tecnicosB = await comoAdmin(TEST_ORG_B).get('/api/technicians');
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ technicianId: tecnicosB.body.items[0].id });
    expect([400, 403, 404]).toContain(res.status);
  });

  it('no deja usar un trabajo de otra organización en una línea', async () => {
    const serviciosB = await comoAdmin(TEST_ORG_B).get('/api/services');
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/orders')
      .send({ services: [{ serviceId: serviciosB.body.items[0].id }] });
    // Sin esta validación, un cliente podría mandar el id de un trabajo de otra
    // empresa y enterarse de cuánto cobra.
    expect([400, 403, 404]).toContain(res.status);
  });

  it('el tablero de A no muestra órdenes de B', async () => {
    const res = await comoAdmin(TEST_ORG_A).get('/api/tablero');
    const todas = res.body.columnas.flatMap((c: any) => c.ordenes);
    expect(todas.some((o: any) => o.asset === 'De Beta')).toBe(false);
  });
});
