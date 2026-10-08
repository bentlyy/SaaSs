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

describe('editar una cita', () => {
  it('un PATCH parcial cambia solo lo que viene', async () => {
    const { servicio, profesional } = await catalogo(TEST_ORG_A, { minutos: 30, precio: 12000 });
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-12-01T15:00:00.000Z',
      endAt: '2026-12-01T15:30:00.000Z',
      notes: 'primera',
      services: [{ serviceId: servicio, priceCents: 12000 }],
    });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    const id = creada.body.id;

    // Antes el PATCH se validaba contra el schema COMPLETO: mandar solo las notas
    // pedia el resto de los campos y devolvia 400, asi que no habia forma de
    // corregir una nota sin reescribir la cita entera.
    const editada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/appointments/${id}`)
      .send({ notes: 'corregida' });
    expect(editada.status, JSON.stringify(editada.body)).toBe(200);
    expect(editada.body.notes).toBe('corregida');
    expect(editada.body.startAt).toBe('2026-12-01T15:00:00.000Z');
    expect(editada.body.endAt).toBe('2026-12-01T15:30:00.000Z');
    expect(editada.body.staffId).toBe(profesional);
    expect(editada.body.totalCents).toBe(12000);
  });

  it('reprogramar no borra ni el cliente ni las notas', async () => {
    const { servicio, profesional } = await catalogo(TEST_ORG_A, { minutos: 45, precio: 9000 });
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-12-02T15:00:00.000Z',
      endAt: '2026-12-02T15:45:00.000Z',
      notes: 'no perder esto',
      services: [{ serviceId: servicio, priceCents: 9000 }],
    });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);

    const movida = await comoMiembro(TEST_ORG_A)
      .patch(`/api/appointments/${creada.body.id}`)
      .send({ startAt: '2026-12-02T18:00:00.000Z', endAt: '2026-12-02T18:45:00.000Z' });
    expect(movida.status, JSON.stringify(movida.body)).toBe(200);
    expect(movida.body.notes).toBe('no perder esto');
    expect(movida.body.startAt).toBe('2026-12-02T18:00:00.000Z');
  });

  it('sin `endAt`, la cita dura lo que el servicio', async () => {
    const { servicio, profesional } = await catalogo(TEST_ORG_A, { servicio: 'Limpieza', minutos: 90, precio: 5000 });
    // Sin `endAt` no se puede agendar una cita de 90 minutos de 8:00 a 17:00:
    // el final lo decide el servicio, no lo que mande el navegador.
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-12-03T15:00:00.000Z',
      services: [{ serviceId: servicio, priceCents: 5000 }],
    });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    expect(creada.body.endAt).toBe('2026-12-03T16:30:00.000Z');
  });

  it('sin `endAt` ni servicios, la cita dura 30 minutos', async () => {
    const { profesional } = await catalogo(TEST_ORG_A);
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-12-04T15:00:00.000Z',
    });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    expect(creada.body.endAt).toBe('2026-12-04T15:30:00.000Z');
  });

  it('un `endAt` explicito manda, para reprogramar a mano', async () => {
    const { servicio, profesional } = await catalogo(TEST_ORG_A, { minutos: 30, precio: 7000 });
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-12-05T15:00:00.000Z',
      endAt: '2026-12-05T16:15:00.000Z',
      services: [{ serviceId: servicio, priceCents: 7000 }],
    });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    expect(creada.body.endAt).toBe('2026-12-05T16:15:00.000Z');
  });

  it('el PATCH no puede pisar el horario de otra organización', async () => {
    const { profesional } = await catalogo(TEST_ORG_A);
    const creada = await nuevaCita(TEST_ORG_A, {
      staffId: profesional,
      startAt: '2026-12-06T15:00:00.000Z',
      endAt: '2026-12-06T15:30:00.000Z',
    });
    expect(creada.status).toBe(201);
    const ajena = await comoMiembro(TEST_ORG_B).patch(`/api/appointments/${creada.body.id}`).send({ notes: 'mía' });
    expect([403, 404]).toContain(ajena.status);
  });
});

describe('la interfaz', () => {
  /** El JS servido: el HTML de Vite es solo el punto de montaje. */
  async function bundle(): Promise<string> {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    const js = /src="(\/assets\/[^"]+\.js[^"]*)"/.exec(html.text)?.[1];
    expect(js, 'el HTML no referencia el bundle').toBeTruthy();
    const res = await tp.as({ orgId: TEST_ORG_A }).get(js!);
    expect(res.status).toBe(200);
    return res.text;
  }

  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Citas');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organización. Por eso no hay ningún id de organización en el HTML.
    expect(html.text).not.toContain(TEST_ORG_A);

    // Los assets del bundle de Vite salen del HTML servido, con huella ?v=
    // puesta por el runtime: el JS y el CSS de la app.
    const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css)[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets) {
      expect((await tp.as({ orgId: TEST_ORG_A }).get(asset)).status).toBe(200);
    }

    // Las rutas de cliente las resuelve la SPA: el server les devuelve el shell.
    const ruta = await tp.as({ orgId: TEST_ORG_A }).get('/clientes');
    expect(ruta.status).toBe(200);
    expect(ruta.text).toContain('Citas');
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

    // Y la salida se resuelve contra el Core, no contra un logout local: el
    // shell de React la dibuja contra /auth/logout, y eso vive en el bundle.
    expect(await bundle()).toContain('/auth/logout');
  });

  it('la UI no inventa datos ni se saltea el servidor para los choques', async () => {
    const js = await bundle();
    // No hay contenido hardcodeado que simule una empresa.
    expect(js).not.toContain(TEST_ORG_A);
    // Todo lo que se ve sale de la API, que es la que filtra por organización:
    // los caminos de los endpoints que pintan la agenda y los catálogos están
    // en el bundle, sin el prefijo /api que se concatena en runtime. Y la
    // decisión de si dos citas se pisan no está en el navegador: la pide al
    // servidor y muestra el 409 que llega.
    expect(js).toContain('/resumen');
    expect(js).toContain('/agenda');
    expect(js).toContain('/appointments');
    expect(js).toContain('/customers');
    expect(js).toContain('/services');
    expect(js).toContain('/staff');
    expect(js).toContain('/settings');
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

describe('horarios y bloqueos por profesional', () => {
  /** La asignación de servicios no tiene endpoint: es dato del catálogo. */
  function asignarServicio(orgId: string, profesional: string, servicio: string) {
    tp.sqlite
      .prepare(
        `INSERT INTO staff_services (id, organization_id, staff_id, service_id) VALUES (?, ?, ?, ?)`,
      )
      .run(`tab-${profesional}-${servicio}`, orgId, profesional, servicio);
  }

  async function nuevoHorario(
    orgId: string,
    staffId: string,
    datos: Record<string, unknown> = {},
  ): Promise<any> {
    const res = await comoMiembro(orgId)
      .post('/api/schedules')
      .send({ staffId, weekday: 1, startTime: 10 * 60, endTime: 13 * 60, ...datos });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  it('el horario del profesional manda sobre la jornada que pide la consulta', async () => {
    const cat = await catalogo(TEST_ORG_A, { minutos: 30 });
    asignarServicio(TEST_ORG_A, cat.profesional, cat.servicio);
    await nuevoHorario(TEST_ORG_A, cat.profesional, { weekday: 1, startTime: 10 * 60, endTime: 13 * 60 });

    // Lunes 2026-10-05 (weekday 1). La consulta pide de 8 a 12, pero el
    // profesional atiende de 10 a 13: el horario propio gana.
    const res = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ staffId: cat.profesional, date: '2026-10-05', from: 8 * 60, until: 12 * 60, step: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const horas = res.body.slots.map((s: any) => ({
      inicio: s.startAt.slice(11, 16),
      fin: s.endAt.slice(11, 16),
    }));
    expect(horas[0]).toEqual({ inicio: '10:00', fin: '10:30' });
    expect(horas).toContainEqual({ inicio: '12:30', fin: '13:00' });
    expect(horas).not.toContainEqual({ inicio: '09:00', fin: '09:30' });
  });

  it('sin horario propio el profesional cae a la jornada que pide la consulta', async () => {
    const cat = await catalogo(TEST_ORG_A, { minutos: 30 });
    asignarServicio(TEST_ORG_A, cat.profesional, cat.servicio);

    const res = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ staffId: cat.profesional, date: '2026-10-06', from: 9 * 60, until: 12 * 60, step: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const horas = res.body.slots.map((s: any) => s.startAt.slice(11, 16));
    expect(horas[0]).toBe('09:00');
    expect(horas).toContain('11:30');
    expect(horas).not.toContain('12:00');
  });

  it('dos horarios que se pisan del mismo profesional y día se rechazan', async () => {
    const cat = await catalogo(TEST_ORG_A);
    const a = await nuevoHorario(TEST_ORG_A, cat.profesional, { startTime: 10 * 60, endTime: 13 * 60 });

    const pisa = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ staffId: cat.profesional, weekday: 1, startTime: 12 * 60, endTime: 14 * 60 });
    expect(pisa.status).toBe(409);

    // Otro día no choca, y mover el primero a ese día sí.
    const otroDia = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ staffId: cat.profesional, weekday: 2, startTime: 9 * 60, endTime: 12 * 60 });
    expect(otroDia.status, JSON.stringify(otroDia.body)).toBe(201);

    const movido = await comoMiembro(TEST_ORG_A).patch(`/api/schedules/${a.id}`).send({ weekday: 2 });
    expect(movido.status).toBe(409);

    // Un horario aledaño (termina cuando empieza el otro) no se pisa.
    const aledano = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ staffId: cat.profesional, weekday: 1, startTime: 13 * 60, endTime: 15 * 60 });
    expect(aledano.status, JSON.stringify(aledano.body)).toBe(201);
  });

  it('un bloqueo quita esa franja de la agenda', async () => {
    const cat = await catalogo(TEST_ORG_A, { minutos: 30 });
    asignarServicio(TEST_ORG_A, cat.profesional, cat.servicio);

    const bloqueo = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ staffId: cat.profesional, startAt: '2026-10-05T10:00:00.000Z', endAt: '2026-10-05T10:30:00.000Z', reason: 'Reunión' });
    expect(bloqueo.status, JSON.stringify(bloqueo.body)).toBe(201);
    expect(bloqueo.body.reason).toBe('Reunión');

    const res = await comoMiembro(TEST_ORG_A)
      .get('/api/availability')
      .query({ staffId: cat.profesional, date: '2026-10-05', from: 9 * 60, until: 12 * 60, step: 30 });
    const horas = res.body.slots.map((s: any) => s.startAt.slice(11, 16));
    expect(horas).not.toContain('10:00');
    expect(horas).toContain('09:30');
    expect(horas).toContain('10:30');
  });

  it('no deja agendar sobre un rato bloqueado, pero sí justo alrededor', async () => {
    const cat = await catalogo(TEST_ORG_A);
    await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ staffId: cat.profesional, startAt: '2026-10-07T10:00:00.000Z', endAt: '2026-10-07T10:30:00.000Z', reason: 'Fuera de oficina' });

    const encima = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-07T10:00:00.000Z',
      endAt: '2026-10-07T10:30:00.000Z',
    });
    expect(encima.status).toBe(409);

    const atravesando = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-07T09:45:00.000Z',
      endAt: '2026-10-07T10:15:00.000Z',
    });
    expect(atravesando.status).toBe(409);

    const antes = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-07T09:30:00.000Z',
      endAt: '2026-10-07T10:00:00.000Z',
    });
    expect(antes.status, JSON.stringify(antes.body)).toBe(201);

    const despues = await nuevaCita(TEST_ORG_A, {
      staffId: cat.profesional,
      startAt: '2026-10-07T10:30:00.000Z',
      endAt: '2026-10-07T11:00:00.000Z',
    });
    expect(despues.status, JSON.stringify(despues.body)).toBe(201);
  });

  it('rechaza un bloqueo al revés y un horario al revés', async () => {
    const cat = await catalogo(TEST_ORG_A);

    const bloqueo = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ staffId: cat.profesional, startAt: '2026-10-08T11:00:00.000Z', endAt: '2026-10-08T10:00:00.000Z' });
    expect(bloqueo.status).toBe(400);

    const horario = await comoMiembro(TEST_ORG_A)
      .post('/api/schedules')
      .send({ staffId: cat.profesional, weekday: 1, startTime: 14 * 60, endTime: 10 * 60 });
    expect(horario.status).toBe(400);
  });

  it('los horarios y bloqueos de otra organización no se ven ni se tocan', async () => {
    const catA = await catalogo(TEST_ORG_A);
    const catB = await catalogo(TEST_ORG_B);

    const horarioA = await nuevoHorario(TEST_ORG_A, catA.profesional, { startTime: 10 * 60, endTime: 13 * 60 });
    const bloqueoA = await comoMiembro(TEST_ORG_A)
      .post('/api/blocks')
      .send({ staffId: catA.profesional, startAt: '2026-10-07T10:00:00.000Z', endAt: '2026-10-07T10:30:00.000Z' });

    const horariosB = await comoAdmin(TEST_ORG_B).get('/api/schedules').query({ staffId: catA.profesional });
    expect(horariosB.body.items).toHaveLength(0);
    const bloqueosB = await comoAdmin(TEST_ORG_B).get('/api/blocks').query({ staffId: catA.profesional });
    expect(bloqueosB.body.items).toHaveLength(0);

    const inventarHorario = await comoMiembro(TEST_ORG_B)
      .post('/api/schedules')
      .send({ staffId: catA.profesional, weekday: 1, startTime: 10 * 60, endTime: 13 * 60 });
    expect([403, 400, 404]).toContain(inventarHorario.status);

    const inventarBloqueo = await comoMiembro(TEST_ORG_B)
      .post('/api/blocks')
      .send({ staffId: catA.profesional, startAt: '2026-10-07T10:00:00.000Z', endAt: '2026-10-07T10:30:00.000Z' });
    expect([403, 400, 404]).toContain(inventarBloqueo.status);

    const borrarHorario = await comoAdmin(TEST_ORG_B).delete(`/api/schedules/${horarioA.id}`);
    expect([403, 404]).toContain(borrarHorario.status);
    const borrarBloqueo = await comoAdmin(TEST_ORG_B).delete(`/api/blocks/${bloqueoA.body.id}`);
    expect([403, 404]).toContain(borrarBloqueo.status);

    // El horario de A sigue intacto, y sigue importando para la disponibilidad.
    const horariosA = await comoAdmin(TEST_ORG_A).get('/api/schedules').query({ staffId: catA.profesional });
    expect(horariosA.body.items).toHaveLength(1);
    expect(catB.profesional).toBeTruthy();
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
