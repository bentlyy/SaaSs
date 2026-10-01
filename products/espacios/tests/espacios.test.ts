import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Reservas de espacios sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy. En el producto viejo el
 * aislamiento venía de que cada organización tenía su propio login; ahora las
 * organizaciones comparten login y se distinguen por el token, así que el
 * aislamiento hay que probarlo: que una empresa no pueda leer ni escribir lo de
 * otra, aunque adivine el id.
 *
 * Y hay tres reglas que son de ESTE producto y no se pueden dar por supuestas:
 *
 *   - El choque de horarios se decide por ESPACIO, no por persona. Dos reservas
 *     en canchas distintas a la misma hora son normales y tienen que entrar.
 *   - Los intervalos son medio abiertos: una reserva que termina a las 11 puede
 *     ser seguida por otra que empieza a las 11, sin choque.
 *   - El total se guarda en la fila. Si mañana suben la tarifa, una reserva vieja
 *     tiene que seguir valiendo lo que valió el día que se hizo.
 *
 * OJO con los sobres de respuesta, que no son todos iguales y por eso confunden:
 * el catálogo (espacios, clientes, extras) lo resuelve `crudRouter`, y devuelve
 * la fila pelada al crear y `{ items }` al listar. Las reservas y los ajustes son
 * rutas propias y van envueltas en `{ booking }` y `{ settings }`.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Alta de espacio, que es lo que la agenda necesita. */
async function nuevoEspacio(
  orgId: string,
  datos: Record<string, unknown> = {},
): Promise<string> {
  const res = await comoAdmin(orgId)
    .post('/api/spaces')
    .send({ name: 'Cancha', capacity: 10, pricePerHourCents: 30000, ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

async function nuevoCliente(orgId: string, name = 'Ana Torres'): Promise<string> {
  const res = await comoAdmin(orgId).post('/api/customers').send({ name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id;
}

beforeAll(async () => {
  // Un cliente y un espacio en A, y los mismos en B, para probar el aislamiento
  // con ids que existen de verdad en la otra organización.
  await nuevoCliente(TEST_ORG_A, 'Cliente de Alpha');
  await nuevoCliente(TEST_ORG_B, 'Cliente de Beta');
  await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Alpha' });
  await nuevoEspacio(TEST_ORG_B, { name: 'Cancha de Beta' });
});

describe('la interfaz', () => {
  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Espacios');
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

  it('la UI no inventa datos ni resuelve los choques en el navegador', async () => {
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    expect(js.text).not.toContain(TEST_ORG_A);
    // Si dos reservas se pisan, lo dice el servidor: la UI muestra el 409.
    expect(js.text).toContain('/api/bookings');
  });
});

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/bookings')).status).toBe(401);
  });

  it('la API no acepta una organización que no viene del token', async () => {
    // El `organizationId` del cuerpo es una pista, no una autoridad: el que
    // manda es el del token. Con campos desconocidos rechazados, ni siquiera se
    // llega a crear: antes se creaba en la org del token y la pista se perdia.
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/spaces')
      .send({ name: 'Invasor', organizationId: TEST_ORG_B, capacity: 2, pricePerHourCents: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('organizationId');

    // Y en las dos organizaciones no hay ni rastro del intento.
    for (const org of [TEST_ORG_A, TEST_ORG_B]) {
      const lista = await comoAdmin(org).get('/api/spaces?limit=500');
      expect(lista.body.items.some((e: any) => e.name === 'Invasor')).toBe(false);
    }
  });
});

describe('espacios, clientes y extras', () => {
  it('crea y lista los espacios de la organización', async () => {
    const res = await comoAdmin(TEST_ORG_A).get('/api/spaces');
    expect(res.status).toBe(200);
    const nombres = res.body.items.map((e: any) => e.name);
    expect(nombres).toContain('Cancha de Alpha');
    expect(nombres).not.toContain('Cancha de Beta');
  });

  it('exige nombre en un espacio', async () => {
    const res = await comoAdmin(TEST_ORG_A).post('/api/spaces').send({ capacity: 10 });
    // Un espacio sin nombre no se puede mostrar en ninguna agenda.
    expect(res.status).toBe(400);
  });

  it('pone aforo por defecto si no le mandan uno', async () => {
    // No es un error: una sala de reuniones cabe una persona por omisión y la
    // dueña lo ajusta después. Lo que no se acepta es un aforo sin sentido.
    const res = await comoAdmin(TEST_ORG_A).post('/api/spaces').send({ name: 'Sala chica' });
    expect(res.status).toBe(201);
    expect(res.body.capacity).toBe(1);
  });

  it('rechaza un aforo negativo o una tarifa negativa', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/spaces')
      .send({ name: 'Imposible', capacity: -3, pricePerHourCents: 100 });
    expect(res.status).toBe(400);
  });

  it('crea y archiva clientes y los saca del listado', async () => {
    const creado = await comoAdmin(TEST_ORG_A).post('/api/customers').send({ name: 'Cliente Archivado' });
    expect(creado.status).toBe(201);

    const antes = await comoAdmin(TEST_ORG_A).get('/api/customers');
    expect(antes.body.items.some((c: any) => c.name === 'Cliente Archivado')).toBe(true);

    const archivado = await comoAdmin(TEST_ORG_A).delete(`/api/customers/${creado.body.id}`);
    expect(archivado.status).toBe(200);

    const despues = await comoAdmin(TEST_ORG_A).get('/api/customers');
    expect(despues.body.items.some((c: any) => c.name === 'Cliente Archivado')).toBe(false);
  });

  it('crea extras con precio y duración', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/addons')
      .send({ name: 'Alquiler de equipo', durationMin: 0, priceCents: 5000 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.priceCents).toBe(5000);
  });
});

describe('aislamiento entre organizaciones', () => {
  it('no deja ver un espacio de otra organización', async () => {
    const espaciosB = await comoAdmin(TEST_ORG_B).get('/api/spaces');
    const idB = espaciosB.body.items[0].id;

    const res = await comoAdmin(TEST_ORG_A).get(`/api/spaces/${idB}`);
    expect([403, 404]).toContain(res.status);
  });

  it('no deja modificar un espacio de otra organización', async () => {
    const espaciosB = await comoAdmin(TEST_ORG_B).get('/api/spaces');
    const idB = espaciosB.body.items[0].id;

    const res = await comoAdmin(TEST_ORG_A)
      .patch(`/api/spaces/${idB}`)
      .send({ name: 'Robada' });
    expect([403, 404]).toContain(res.status);

    const sigue = await comoAdmin(TEST_ORG_B).get(`/api/spaces/${idB}`);
    expect(sigue.body.name).toBe('Cancha de Beta');
  });

  it('no deja crear una reserva en un espacio de otra organización', async () => {
    const espaciosB = await comoAdmin(TEST_ORG_B).get('/api/spaces');
    const clientesA = await comoAdmin(TEST_ORG_A).get('/api/customers');

    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espaciosB.body.items[0].id,
        customerId: clientesA.body.items[0].id,
        startAt: '2026-10-01T14:00:00.000Z',
        endAt: '2026-10-01T15:00:00.000Z',
      });
    expect([403, 400, 404]).toContain(res.status);

    // Y no se coló: la agenda de B sigue sin esa reserva.
    const reservasB = await comoAdmin(TEST_ORG_B).get('/api/bookings');
    expect(reservasB.body.bookings).toHaveLength(0);
  });

  it('no deja usar un extra de otra organización', async () => {
    const extraB = await comoAdmin(TEST_ORG_B)
      .post('/api/addons')
      .send({ name: 'Extra de Beta', durationMin: 0, priceCents: 100 });
    const espacioA = (await comoAdmin(TEST_ORG_A).get('/api/spaces')).body.items[0].id;
    const clienteA = (await comoAdmin(TEST_ORG_A).get('/api/customers')).body.items[0].id;

    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacioA,
        customerId: clienteA,
        startAt: '2026-10-02T14:00:00.000Z',
        endAt: '2026-10-02T15:00:00.000Z',
        addons: [{ addonId: extraB.body.id, priceCents: 100 }],
      });
    expect([403, 400, 404]).toContain(res.status);
  });
});

describe('el resumen de las tarjetas de arriba', () => {
  it('cuenta el día que se le pide, no siempre el de hoy', async () => {
    const org = await comoAdmin(TEST_ORG_A);
    const cliente = (await org.get('/api/customers')).body.items[0].id;
    // El total lo calcula el servidor desde la tarifa del espacio: no se manda.
    const barato = await nuevoEspacio(TEST_ORG_A, { name: 'Sala Barata', pricePerHourCents: 10_000 });
    const caro = await nuevoEspacio(TEST_ORG_A, { name: 'Sala Cara', pricePerHourCents: 25_000 });

    // Fechas fijas y no "hoy": si la prueba dependiera del reloj, correría mal a
    // medianoche sin que nadie hubiera tocado nada.
    const unaHora = (espacio: string, dia: string) =>
      org
        .post('/api/bookings')
        .send({ spaceId: espacio, customerId: cliente, startAt: `${dia}T14:00:00.000Z`, endAt: `${dia}T15:00:00.000Z` });
    expect((await unaHora(barato, '2026-11-10')).status).toBe(201);
    expect((await unaHora(caro, '2026-11-11')).status).toBe(201);

    const uno = await org.get('/api/resumen?date=2026-11-10');
    const otro = await org.get('/api/resumen?date=2026-11-11');

    expect(uno.status).toBe(200);
    expect(uno.body.date).toBe('2026-11-10');
    expect(otro.body.date).toBe('2026-11-11');

    // Cada día trae SU reserva y SU ingreso, no la del otro.
    expect(uno.body.hoy).toBe(1);
    expect(otro.body.hoy).toBe(1);
    expect(uno.body.ingresos).toBe(10_000);
    expect(otro.body.ingresos).toBe(25_000);
  });

  it('las cuatro tarjetas hablan del mismo día, incluidas las pendientes', async () => {
    const org = await comoAdmin(TEST_ORG_A);
    const cliente = (await org.get('/api/customers')).body.items[0].id;
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Sala de Coherencia' });

    const crear = (inicio: string, fin: string, status: string) =>
      org
        .post('/api/bookings')
        .send({ spaceId: espacio, customerId: cliente, startAt: inicio, endAt: fin, status });

    await crear('2026-11-20T14:00:00.000Z', '2026-11-20T15:00:00.000Z', 'confirmed');
    await crear('2026-11-20T16:00:00.000Z', '2026-11-20T17:00:00.000Z', 'pending');
    // Una pendiente en OTRO día. Si el resumen la mezclara, las tarjetas
    // dirían "2 por confirmar" sobre un día que solo tiene una.
    await crear('2026-11-25T14:00:00.000Z', '2026-11-25T15:00:00.000Z', 'pending');

    const r = await org.get('/api/resumen?date=2026-11-20');
    expect(r.body.hoy).toBe(2);
    expect(r.body.confirmadas).toBe(1);
    expect(r.body.porConfirmar).toBe(1);
  });

  it('una fecha con formato raro es 400, no el resumen de hoy', async () => {
    // Si el parámetro viniera roto y se ignorara en silencio, la agenda
    // mostraría los números de otro día sin avisar. Mejor un error visible.
    const res = await comoAdmin(TEST_ORG_A).get('/api/resumen?date=ayer');
    expect(res.status).toBe(400);
  });
});

describe('choques de horario', () => {
  it('no deja dos reservas en el MISMO espacio al mismo tiempo', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Choques' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente de Choques');

    const primera = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-05T14:00:00.000Z',
        endAt: '2026-10-05T16:00:00.000Z',
      });
    expect(primera.status, JSON.stringify(primera.body)).toBe(201);

    const segunda = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-05T15:00:00.000Z',
        endAt: '2026-10-05T17:00:00.000Z',
      });
    expect(segunda.status).toBe(409);
  });

  it('permite dos reservas al mismo tiempo si son espacios DISTINTOS', async () => {
    const cancha1 = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Paralela 1' });
    const cancha2 = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Paralela 2' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente Paralelo');

    const base = {
      customerId: cliente,
      startAt: '2026-10-06T14:00:00.000Z',
      endAt: '2026-10-06T15:00:00.000Z',
    };
    const a = await comoMiembro(TEST_ORG_A).post('/api/bookings').send({ ...base, spaceId: cancha1 });
    const b = await comoMiembro(TEST_ORG_A).post('/api/bookings').send({ ...base, spaceId: cancha2 });

    // Esto es lo que distingue a un producto de espacios de uno de citas: el
    // choque es por espacio, no por persona ni por franja horaria global.
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
  });

  it('deja una reserva justo cuando termina la anterior', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Follow the Sun' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente Follow the Sun');

    const primera = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-07T14:00:00.000Z',
        endAt: '2026-10-07T15:00:00.000Z',
      });
    expect(primera.status).toBe(201);

    // El intervalo es medio abierto [14, 15): a las 15 el espacio ya está libre.
    const segunda = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-07T15:00:00.000Z',
        endAt: '2026-10-07T16:00:00.000Z',
      });
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201);
  });

  it('deja reutilizar el horario de una reserva cancelada', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Cancelada' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente Cancelacion');

    const primera = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-08T14:00:00.000Z',
        endAt: '2026-10-08T15:00:00.000Z',
      });
    expect(primera.status).toBe(201);

    const cancelada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/bookings/${primera.body.booking.id}`)
      .send({ status: 'cancelled' });
    expect(cancelada.status, JSON.stringify(cancelada.body)).toBe(200);
    expect(cancelada.body.booking.status).toBe('cancelled');

    // Una reserva cancelada no ocupa la cancha: el horario queda libre.
    const segunda = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-08T14:00:00.000Z',
        endAt: '2026-10-08T15:00:00.000Z',
      });
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201);
  });

  it('rechaza una reserva que termina antes de empezar', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Imposible' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente Imposible');

    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-09T16:00:00.000Z',
        endAt: '2026-10-09T14:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('calcula el total con la tarifa por hora y los extras', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha con Total', pricePerHourCents: 30000 });
    const extra = await comoAdmin(TEST_ORG_A)
      .post('/api/addons')
      .send({ name: 'Equipo', durationMin: 0, priceCents: 5000 });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente del Total');

    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-10T14:00:00.000Z',
        endAt: '2026-10-10T16:00:00.000Z',
        addons: [{ addonId: extra.body.id, priceCents: 5000 }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // 2 horas a 30000, más 5000 del extra. El total queda guardado en la fila, no
    // se calcula al vuelo: si mañana suben la tarifa, esta reserva no cambia.
    expect(res.body.booking.totalCents).toBe(65000);
  });
});

describe('la franja tiene que ser reservable', () => {
  // La zona por defecto de las pruebas es America/Santiago, que en octubre va
  // tres horas atras del UTC: 14:00Z son las 11:00 locales, dentro de la jornada
  // de 08:00 a 22:00. Los casos de abajo eligen horas que en UTC parecen
  // razonables y en horario local no lo son, que es justo el error que se
  // estaba dejando pasar.
  const enHoras = { startAt: '2026-11-10T14:00:00.000Z', endAt: '2026-11-10T16:00:00.000Z' };

  it('acepta una reserva dentro de la jornada', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha En Horario' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente En Horario');
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, ...enHoras });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('no deja reservar una fecha que ya paso', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha del Pasado' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente del Pasado');
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2020-01-01T14:00:00.000Z',
        endAt: '2020-01-01T16:00:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/pasó|pasó|anticipación/i);
  });

  it('no deja reservar antes de que abra', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Madrugada' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente de Madrugada');
    // 04:00Z son la 01:00 en Santiago: de madrugada, con la cancha cerrada.
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-11-10T04:00:00.000Z',
        endAt: '2026-11-10T06:00:00.000Z',
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/atiende/i);
  });

  it('no deja reservar despues de que cierre', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Noche' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente de Noche');
    // 19:00 a 23:00 locales: la segunda hora ya esta fuera de la jornada.
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-11-10T22:00:00.000Z',
        endAt: '2026-11-11T02:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('no deja una reserva que cruza la medianoche', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Trasnoche' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente Trasnoche');
    // 01:00Z son las 22:00 del dia anterior en Santiago, y 04:00Z es la 01:00 del
    // siguiente: la franja atraviesa las doce de la noche local.
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-11-11T01:00:00.000Z',
        endAt: '2026-11-11T04:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('la jornada se respeta segun los ajustes de cada organizacion', async () => {
    const ORG = TEST_ORG_B;
    const espacio = await nuevoEspacio(ORG, { name: 'Cancha 24h' });
    const cliente = await nuevoCliente(ORG, 'Cliente 24h');
    // 01:00 a 03:00 locales: fuera de la jornada de 08:00 a 22:00.
    const madrugada = { startAt: '2026-11-10T04:00:00.000Z', endAt: '2026-11-10T06:00:00.000Z' };

    const cerrada = await comoMiembro(ORG)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, ...madrugada });
    expect(cerrada.status).toBe(400);

    await comoAdmin(ORG)
      .put('/api/settings')
      .send({ openingMinutes: 0, closingMinutes: 1439, timezone: 'America/Santiago' });

    const abierta = await comoMiembro(ORG)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, ...madrugada });
    expect(abierta.status, JSON.stringify(abierta.body)).toBe(201);
  });

  it('rechaza una zona horaria que no existe', async () => {
    const res = await comoAdmin(TEST_ORG_A).put('/api/settings').send({ timezone: 'Marte/Olympus' });
    expect(res.status).toBe(400);
  });
});

describe('disponibilidad', () => {
  it('ofrece franjas libres dentro de la jornada y respeta las ocupadas', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Agenda' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente de Agenda');

    const creada = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({
        spaceId: espacio,
        customerId: cliente,
        startAt: '2026-10-13T14:00:00.000Z',
        endAt: '2026-10-13T16:00:00.000Z',
        status: 'confirmed',
      });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);

    const res = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ spaceId: espacio, date: '2026-10-13' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    // Se miran las HORAS de las franjas, no el JSON entero: el JSON incluye el
    // espacio con su `createdAt`, que es la hora de ahora y puede caer
    // justamente en las 14:00 y hacer fallar una búsqueda de texto.
    const horas = res.body.slots.map((s: any) => s.startAt.slice(11, 16));

    // Las dos horas ocupadas no se ofrecen.
    expect(horas).not.toContain('14:00');
    expect(horas).not.toContain('15:00');
    // La que termina a las 14:00 sí, y la que empieza a las 16:00 también: el
    // turno de cancha es corrido, no hay que dejar un margen entre turnos.
    expect(horas).toContain('13:00');
    expect(horas).toContain('16:00');
    // Y el día empieza a la apertura, no a medianoche.
    expect(horas[0]).toBe('08:00');
  });

  it('no ofrece franjas de un espacio de otra organización', async () => {
    const espaciosB = await comoAdmin(TEST_ORG_B).get('/api/spaces');
    const res = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ spaceId: espaciosB.body.items[0].id, date: '2026-10-14' });
    expect([403, 404]).toContain(res.status);
  });
});

describe('horarios y bloqueos de espacio', () => {
  async function nuevoHorario(
    orgId: string,
    spaceId: string,
    datos: Record<string, unknown> = {},
  ): Promise<any> {
    const res = await comoMiembro(orgId)
      .post('/api/schedules')
      .send({ spaceId, weekday: 2, startTime: 9 * 60, endTime: 12 * 60, ...datos });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  it('el horario semanal del espacio manda, y sin él cae a la jornada general', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha con Horario' });
    await nuevoHorario(TEST_ORG_A, espacio, { startTime: 9 * 60, endTime: 12 * 60 });

    // Martes 2026-10-13 (weekday 2): el horario propio de 9:00 a 12:00. El
    // intervalo es medio abierto: la franja de las 12 no entra porque termina
    // justo a las 12.
    const martes = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ spaceId: espacio, date: '2026-10-13' });
    expect(martes.status, JSON.stringify(martes.body)).toBe(200);
    expect(martes.body.slots.map((s: any) => s.startAt.slice(11, 16))).toEqual(['09:00', '10:00', '11:00']);

    // Miércoles 2026-10-14 (weekday 3): sin fila, cae a la jornada general 08:00-22:00.
    const miercoles = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ spaceId: espacio, date: '2026-10-14' });
    expect(miercoles.status).toBe(200);
    const horasMie = miercoles.body.slots.map((s: any) => s.startAt.slice(11, 16));
    expect(horasMie[0]).toBe('08:00');
    expect(horasMie).toContain('21:00');
  });

  it('dos horarios que se pisan del mismo espacio y día se rechazan', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha que se Pisa' });
    const a = await nuevoHorario(TEST_ORG_A, espacio, { startTime: 9 * 60, endTime: 12 * 60 });

    // Se superponen de 11 a 12.
    const pisa = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ spaceId: espacio, weekday: 2, startTime: 11 * 60, endTime: 14 * 60 });
    expect(pisa.status).toBe(409);

    // Un horario que empieza justo cuando termina el otro no se pisa.
    const aledano = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ spaceId: espacio, weekday: 2, startTime: 12 * 60, endTime: 14 * 60 });
    expect(aledano.status, JSON.stringify(aledano.body)).toBe(201);

    // Otro día de la semana no choca con los de hoy.
    const otroDia = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ spaceId: espacio, weekday: 3, startTime: 10 * 60, endTime: 13 * 60 });
    expect(otroDia.status, JSON.stringify(otroDia.body)).toBe(201);

    // Pero mover el primero al miércoles lo haría pisar con el recién creado.
    const movido = await comoMiembro(TEST_ORG_A).patch(`/api/schedules/${a.id}`).send({ weekday: 3 });
    expect(movido.status).toBe(409);
  });

  it('un horario inactivo no manda y vuelve a valer la jornada general', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Día off' });
    const horario = await nuevoHorario(TEST_ORG_A, espacio, { startTime: 9 * 60, endTime: 12 * 60 });

    const apagado = await comoMiembro(TEST_ORG_A).patch(`/api/schedules/${horario.id}`).send({ active: false });
    expect(apagado.status, JSON.stringify(apagado.body)).toBe(200);
    expect(apagado.body.active).toBe(false);

    const martes = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ spaceId: espacio, date: '2026-10-13' });
    const horas = martes.body.slots.map((s: any) => s.startAt.slice(11, 16));
    // Sin horario activo el espacio vuelve a la jornada general: la franja de
    // las 8 sale de nuevo, y las de las 9-11 que daba el horario desactivado
    // también podrían salir (son parte de la jornada). Lo que ya no hay es
    // horario propio: el día es completo, no se corta a las 12.
    expect(horas[0]).toBe('08:00');
    expect(horas).toContain('21:00');
  });

  it('un bloqueo quita esa franja de la disponibilidad', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Bloqueada' });
    await nuevoHorario(TEST_ORG_A, espacio, { startTime: 9 * 60, endTime: 12 * 60 });

    const bloqueo = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ spaceId: espacio, startAt: '2026-10-13T10:00:00.000Z', endAt: '2026-10-13T11:00:00.000Z', reason: 'Reunión' });
    expect(bloqueo.status, JSON.stringify(bloqueo.body)).toBe(201);
    expect(bloqueo.body.reason).toBe('Reunión');

    const martes = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ spaceId: espacio, date: '2026-10-13' });
    // La franja de las 10 desapareció; la de las 11 está intacta.
    expect(martes.body.slots.map((s: any) => s.startAt.slice(11, 16))).toEqual(['09:00', '11:00']);
  });

  it('no deja reservar sobre un rato bloqueado, pero sí justo alrededor', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha de Reserva Bloqueada' });
    const cliente = await nuevoCliente(TEST_ORG_A, 'Cliente de Bloqueo de Reserva');

    await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ spaceId: espacio, startAt: '2026-10-13T14:00:00.000Z', endAt: '2026-10-13T15:00:00.000Z', reason: 'Mantención' });

    const encima = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, startAt: '2026-10-13T14:00:00.000Z', endAt: '2026-10-13T15:00:00.000Z' });
    expect(encima.status).toBe(409);

    const atravesando = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, startAt: '2026-10-13T13:30:00.000Z', endAt: '2026-10-13T14:30:00.000Z' });
    expect(atravesando.status).toBe(409);

    // Alrededor del bloqueo, el espacio está libre: el bloqueo no ensucia la
    // cancha fuera de su franja.
    const antes = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, startAt: '2026-10-13T13:00:00.000Z', endAt: '2026-10-13T14:00:00.000Z' });
    expect(antes.status, JSON.stringify(antes.body)).toBe(201);

    const despues = await comoMiembro(TEST_ORG_A)
      .post('/api/bookings')
      .send({ spaceId: espacio, customerId: cliente, startAt: '2026-10-13T15:00:00.000Z', endAt: '2026-10-13T16:00:00.000Z' });
    expect(despues.status, JSON.stringify(despues.body)).toBe(201);
  });

  it('rechaza un bloqueo que termina antes de empezar y un horario al revés', async () => {
    const espacio = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Imposible de Bloquear' });

    const bloqueo = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ spaceId: espacio, startAt: '2026-10-13T16:00:00.000Z', endAt: '2026-10-13T14:00:00.000Z' });
    expect(bloqueo.status).toBe(400);

    const horario = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ spaceId: espacio, weekday: 2, startTime: 12 * 60, endTime: 9 * 60 });
    expect(horario.status).toBe(400);
  });

  it('los horarios y bloqueos de otra organización no se ven ni se tocan', async () => {
    const espacioA = await nuevoEspacio(TEST_ORG_A, { name: 'Cancha Confidencial A' });
    const espacioB = await nuevoEspacio(TEST_ORG_B, { name: 'Cancha Confidencial B' });

    const horarioA = await nuevoHorario(TEST_ORG_A, espacioA, { startTime: 9 * 60, endTime: 12 * 60 });
    const bloqueoA = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ spaceId: espacioA, startAt: '2026-10-13T10:00:00.000Z', endAt: '2026-10-13T11:00:00.000Z' });

    // B no ve las filas de A ni siquiera preguntando por el espacio de A.
    const horariosB = await comoAdmin(TEST_ORG_B).get('/api/schedules').query({ spaceId: espacioA });
    expect(horariosB.body.items).toHaveLength(0);
    const bloqueosB = await comoAdmin(TEST_ORG_B).get('/api/blocks').query({ spaceId: espacioA });
    expect(bloqueosB.body.items).toHaveLength(0);

    // A no puede inventarle horarios ni bloqueos a un espacio de B.
    const inventarHorario = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ spaceId: espacioB, weekday: 2, startTime: 9 * 60, endTime: 12 * 60 });
    expect([403, 400, 404]).toContain(inventarHorario.status);

    const inventarBloqueo = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ spaceId: espacioB, startAt: '2026-10-13T10:00:00.000Z', endAt: '2026-10-13T11:00:00.000Z' });
    expect([403, 400, 404]).toContain(inventarBloqueo.status);

    // Y B no puede tocar los de A con ids que no debería conocer.
    const borrarHorario = await comoAdmin(TEST_ORG_B).delete(`/api/schedules/${horarioA.id}`);
    expect([403, 404]).toContain(borrarHorario.status);
    const borrarBloqueo = await comoAdmin(TEST_ORG_B).delete(`/api/blocks/${bloqueoA.body.id}`);
    expect([403, 404]).toContain(borrarBloqueo.status);

    // Siguen intactos para A.
    const horariosA = await comoAdmin(TEST_ORG_A).get('/api/schedules').query({ spaceId: espacioA });
    expect(horariosA.body.items).toHaveLength(1);
    const bloqueosA = await comoAdmin(TEST_ORG_A).get('/api/blocks').query({ spaceId: espacioA });
    expect(bloqueosA.body.items).toHaveLength(1);
  });
});

describe('ajustes', () => {
  it('guarda y devuelve la jornada de la organización', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({
        timezone: 'America/Mexico_City',
        currency: '$',
        openingMinutes: 540,
        closingMinutes: 1260,
        slotMinutes: 30,
        minAdvanceMinutes: 0,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const leido = await comoAdmin(TEST_ORG_A).get('/api/settings');
    expect(leido.body.settings.openingMinutes).toBe(540);
    expect(leido.body.settings.slotMinutes).toBe(30);
  });

  it('no deja cambiar los ajustes de otra organización', async () => {
    const antes = await comoAdmin(TEST_ORG_B).get('/api/settings');
    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ openingMinutes: 300, closingMinutes: 1200, slotMinutes: 20, minAdvanceMinutes: 0 });

    const despues = await comoAdmin(TEST_ORG_B).get('/api/settings');
    // El cambio de A no tocó los de B: son organizaciones distintas.
    expect(despues.body).toEqual(antes.body);
  });

  it('rechaza una jornada al revés o una franja de cero', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ openingMinutes: 1200, closingMinutes: 600, slotMinutes: 0, minAdvanceMinutes: 0 });
    expect(res.status).toBe(400);
  });
});
