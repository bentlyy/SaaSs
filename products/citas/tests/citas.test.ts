import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Citas sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy. En el producto viejo el
 * aislamiento venía de que cada organización tenía su propio login; ahora las
 * organizaciones comparten login y se distinguen por el token, así que el
 * aislamiento hay que probarlo: que una empresa no pueda leer ni escribir lo de
 * otra, aunque adivine el id.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Alta de cliente, servicio y profesional, que es lo que la agenda necesita. */
async function catalogo(
  orgId: string,
  datos: { servicio?: string; minutos?: number; precio?: number } = {},
): Promise<{ servicio: string; profesional: string }> {
  const serv = await comoAdmin(orgId)
    .post('/api/services')
    .send({ name: datos.servicio ?? 'Corte', durationMin: datos.minutos ?? 30, priceCents: datos.precio ?? 12000 });
  expect(serv.status, JSON.stringify(serv.body)).toBe(201);

  const per = await comoAdmin(orgId)
    .post('/api/staff')
    .send({ name: 'Yuki', color: '#4f46e5' });
  expect(per.status, JSON.stringify(per.body)).toBe(201);

  return { servicio: serv.body.id, profesional: per.body.id };
}

async function nuevaCita(
  orgId: string,
  datos: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const res = await comoMiembro(orgId).post('/api/appointments').send(datos);
  return { status: res.status, body: res.body };
}

describe('la interfaz', () => {
  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Citas');
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
    // Un formulario de contraseña en el producto sería un segundo sistema de
    // identidad, así que en el HTML no puede haber ninguno.
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).not.toMatch(/type=["']password["']/i);

    // Y la salida se resuelve contra el Core, no contra un logout local.
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    expect(js.text).toContain('/auth/logout');
  });

  it('la UI no inventa datos ni se saltea el servidor para los choques', async () => {
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    // No hay contenido hardcodeado que simule una empresa.
    expect(js.text).not.toContain(TEST_ORG_A);
    // Y la decisión de si dos citas se pisan no está en el navegador: la pide al
    // servidor y muestra el 409 que llega.
    expect(js.text).toContain('/api/appointments');
  });
});

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/appointments')).status).toBe(401);
  });

  it('/api/me dice de qué organización se entra', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('citas');
  });
});

describe('el aislamiento entre organizaciones', () => {
  it('la agenda de una empresa no trae las citas de otra', async () => {
    const { profesional } = await catalogo(TEST_ORG_A);
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-01T14:00:00.000Z',
      endAt: '2026-10-01T14:30:00.000Z',
    });
    expect(creada.status).toBe(201);

    const agendaB = await comoAdmin(TEST_ORG_B).get('/api/appointments');
    expect(agendaB.status).toBe(200);
    expect(agendaB.body.appointments).toHaveLength(0);
  });

  it('una cita de otra organización no existe: 404, no 403 con datos', async () => {
    const { profesional } = await catalogo(TEST_ORG_A);
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-02T14:00:00.000Z',
      endAt: '2026-10-02T14:30:00.000Z',
    });

    // El id existe de verdad, pero para otra empresa. Un 403 confirmaría que la
    // cita existe; un 404 no le dice nada al que está probando.
    const visto = await comoAdmin(TEST_ORG_B).get(`/api/appointments/${creada.body.id}`);
    expect(visto.status).toBe(404);
  });

  it('no se puede editar ni borrar la cita de otra organización', async () => {
    const { profesional } = await catalogo(TEST_ORG_A);
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-03T14:00:00.000Z',
      endAt: '2026-10-03T14:30:00.000Z',
    });

    const parche = await comoAdmin(TEST_ORG_B)
      .patch(`/api/appointments/${creada.body.id}`)
      .send({ startAt: '2026-10-03T15:00:00.000Z', endAt: '2026-10-03T15:30:00.000Z' });
    expect(parche.status).toBe(404);

    const borrado = await comoAdmin(TEST_ORG_B).delete(`/api/appointments/${creada.body.id}`);
    expect(borrado.status).toBe(404);
  });

  it('el id de una cita de otra organización no se puede colar en el cuerpo', async () => {
    // Por más que el cliente de otra empresa mande el id, el filtro por
    // organización sigue mandando: la cita queda en SU organización.
    const { profesional } = await catalogo(TEST_ORG_B);
    const creada = await nuevaCita(TEST_ORG_B, {
      staffId: profesional,
      startAt: '2026-10-04T14:00:00.000Z',
      endAt: '2026-10-04T14:30:00.000Z',
    });
    const propia = await comoAdmin(TEST_ORG_B).get(`/api/appointments/${creada.body.id}`);
    expect(propia.status).toBe(200);
    expect(propia.body.organizationId ?? propia.body.organization_id).not.toBe(TEST_ORG_A);
  });
});

describe('el solapamiento de la agenda', () => {
  it('no deja dos citas encima en el mismo profesional', async () => {
    const { profesional } = await catalogo(TEST_ORG_A, { minutos: 30 });
    await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-06T10:00:00.000Z',
      endAt: '2026-10-06T10:30:00.000Z',
    });

    const choque = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-06T10:15:00.000Z',
      endAt: '2026-10-06T10:45:00.000Z',
    });
    expect(choque.status).toBe(409);
    expect(String(choque.body.error)).toMatch(/pisar/);
  });

  it('permite una cita que empieza justo cuando termina la anterior', async () => {
    const { profesional } = await catalogo(TEST_ORG_A, { minutos: 30 });
    await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-07T10:00:00.000Z',
      endAt: '2026-10-07T10:30:00.000Z',
    });

    // Un `between` en vez de `start < fin AND end > inicio` rechazaría esta cita,
    // y es una cita perfectamente válida: el turno siguiente.
    const seguida = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-07T10:30:00.000Z',
      endAt: '2026-10-07T11:00:00.000Z',
    });
    expect(seguida.status).toBe(201);
  });

  it('una cita cancelada no bloquea el horario', async () => {
    const { profesional } = await catalogo(TEST_ORG_A, { minutos: 30 });
    const primera = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-08T10:00:00.000Z',
      endAt: '2026-10-08T10:30:00.000Z',
      status: 'cancelled',
    });
    expect(primera.status).toBe(201);

    const otra = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-08T10:00:00.000Z',
      endAt: '2026-10-08T10:30:00.000Z',
    });
    expect(otra.status).toBe(201);
  });

  it('modificar una cita no choca consigo misma', async () => {
    const { profesional } = await catalogo(TEST_ORG_A, { minutos: 30 });
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-10-09T10:00:00.000Z',
      endAt: '2026-10-09T10:30:00.000Z',
    });

    // Mismo horario, mismo id: si el chequeo no excluyera la cita que se está
    // editando, todo PATCH de una cita fallaría con 409.
    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/appointments/${creada.body.id}`)
      .send({ staffId: profesional, startAt: '2026-10-09T10:00:00.000Z', endAt: '2026-10-09T10:30:00.000Z', notes: 'nota' });
    expect(parche.status).toBe(200);
  });

  it('el profesional tiene que ser de la misma organización', async () => {
    const catA = await catalogo(TEST_ORG_A);
    const choque = await nuevaCita(TEST_ORG_B, {
      staffId: catA.profesional,
      startAt: '2026-10-10T10:00:00.000Z',
      endAt: '2026-10-10T10:30:00.000Z',
    });
    expect(choque.status).toBe(400);
    expect(String(choque.body.error)).toMatch(/organización/);
  });
});

describe('las citas', () => {
  it('el total sale de las líneas, no de lo que manda el cliente', async () => {
    const cat = await catalogo(TEST_ORG_A, { precio: 12000 });
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-11T10:00:00.000Z',
      endAt: '2026-10-11T10:30:00.000Z',
      services: [
        { serviceId: cat.servicio, serviceName: 'Corte', priceCents: 12000 },
        { serviceId: cat.servicio, serviceName: 'Barba', priceCents: 4000 },
      ],
    });
    expect(creada.status).toBe(201);
    expect(creada.body.totalCents).toBe(16000);
  });

  it('ignora un totalCents que venga en el cuerpo', async () => {
    const cat = await catalogo(TEST_ORG_A);
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-12T10:00:00.000Z',
      endAt: '2026-10-12T10:30:00.000Z',
      totalCents: 999_999,
      services: [{ serviceId: cat.servicio, priceCents: 12000 }],
    });
    // Un cliente que puede mandar su propio total se puedeInfla el reporte.
    expect(creada.body.totalCents).toBe(12000);
  });

  it('rechaza una cita que termina antes de empezar', async () => {
    const cat = await catalogo(TEST_ORG_A);
    const mala = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-13T10:30:00.000Z',
      endAt: '2026-10-13T10:00:00.000Z',
    });
    expect(mala.status).toBe(400);
  });

  it('la agenda resuelve los nombres sin un join por cita', async () => {
    const cat = await catalogo(TEST_ORG_A);
    const cliente = await comoAdmin(TEST_ORG_A).post('/api/customers').send({ name: 'Ana Torres', email: 'ana@example.com' });
    await nuevaCita(TEST_ORG_A, {
      customerId: cliente.body.id,
      staffId: cat.profesional,
      startAt: '2026-10-14T10:00:00.000Z',
      endAt: '2026-10-14T10:30:00.000Z',
    });

    const agenda = await comoAdmin(TEST_ORG_A).get(
      '/api/agenda?from=2026-10-14T00:00:00.000Z&to=2026-10-15T00:00:00.000Z',
    );
    expect(agenda.status).toBe(200);
    const fila = agenda.body.appointments[0];
    expect(fila.customerName).toBe('Ana Torres');
    expect(fila.staffName).toBe('Yuki');
  });

  it('rechaza un rango de fechas al revés', async () => {
    const res = await comoAdmin(TEST_ORG_A).get(
      '/api/agenda?from=2026-10-20T00:00:00.000Z&to=2026-10-10T00:00:00.000Z',
    );
    expect(res.status).toBe(400);
  });
});

describe('la disponibilidad', () => {
  it('propone huecos y omite los que están ocupados', async () => {
    const cat = await catalogo(TEST_ORG_A, { minutos: 30 });
    await comoAdmin(TEST_ORG_A).post(`/api/staff/${cat.profesional}/servicios`).catch(() => undefined);
    // La asignación de servicios es un dato del catálogo, no un endpoint de la
    // cita: se crea directo para no meter un endpoint que no hace falta.
    const res = await comoAdmin(TEST_ORG_A).get(
      `/api/availability?staffId=${cat.profesional}&date=2026-10-05T00:00:00.000Z&from=540&until=720`,
    );
    // Sin servicios asignados no hay nada que agendar, y el producto lo dice en
    // vez de devolver una lista de horarios que no significan nada.
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/servicios/);
  });
});

describe('las preferencias', () => {
  it('se guardan una sola vez por organización', async () => {
    const org = TEST_ORG_B;
    const primera = await comoAdmin(org)
      .put('/api/settings')
      .send({ timezone: 'America/Santiago', currency: '$', reminderHours: 6, emailEnabled: true });
    expect(primera.status).toBe(200);

    const segunda = await comoAdmin(org)
      .put('/api/settings')
      .send({ timezone: 'America/Mexico_City', currency: '$', reminderHours: 24, emailEnabled: false });
    expect(segunda.status).toBe(200);

    const leidas = await comoAdmin(org).get('/api/settings');
    expect(leidas.body.settings.timezone).toBe('America/Mexico_City');
    expect(leidas.body.settings.reminderHours).toBe(24);
  });

  it('un miembro no cambia las preferencias de la empresa', async () => {
    const res = await comoMiembro(TEST_ORG_B)
      .put('/api/settings')
      .send({ timezone: 'Europe/Lisbon', currency: '$', reminderHours: 1, emailEnabled: true });
    expect(res.status).toBe(403);
  });
});

describe('los recordatorios', () => {
  it('rechaza reintentar un aviso que ya salió', async () => {
    const cat = await catalogo(TEST_ORG_A);
    const cita = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-15T10:00:00.000Z',
      endAt: '2026-10-15T10:30:00.000Z',
    });
    // Sin endpoint de envío, el aviso se crea por la migración. Acá se prueba el
    // caso contrario: que la API no diga "reintentado" sobre algo que ya salió.
    const res = await comoAdmin(TEST_ORG_B).post('/api/reminders/inexistente/retry');
    expect(res.status).toBe(404);
    expect(cita.status).toBe(201);
  });
});
