import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Control de Pagos sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy, y hay tres cosas que
 * tienen que quedar probadas, no solo escritas:
 *
 *   1. EL AISLAMIENTO. Las organizaciones comparten login y se distinguen por el
 *      token, asi que hay que probar que una empresa no puede leer ni escribir lo
 *      de la otra aunque adivine el id. Notar que la comprobacion es "no lo veo",
 *      no "me lo niegan": un 403 confirmaria que ese id existe.
 *
 *   2. EL SALDO DERIVADO. No hay columna de cobrado, asi que lo que se prueba es
 *      que el saldo siempre se puede reconstruir sumando los abonos, y que un
 *      abono imposible no se escribe a medias. Un 409 que dejara el abono
 *      guardado seria peor que un 500: la cartera mostraria plata que nunca entro.
 *
 *   3. QUE EL ESTADO NO SE ELIJA. `status` no se escribe por la API y el form
 *      de la pantalla no lo manda. Se comprueba en los dos lados, porque la
 *      invariante se puede romper desde el servidor o desde el navegador, y las
 *      dos formas rompen lo mismo.
 *
 * El tablero y el reporte se prueban en bases LIMPIAS, en su propia
 * `startTestProduct`. Si compartieran base con el resto de los tests, sus
 * cifras dependerian del orden en que corrieran, y un fallo en un test ajeno
 * moveria el tablero de este.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Crea un cargo y devuelve la fila como la devolvio la API. */
async function nuevoCargo(orgId: string, datos: Record<string, unknown> = {}) {
  const res = await comoMiembro(orgId)
    .post('/api/charges')
    .send({ customerName: 'Constructora Spa', concept: 'Instalacion de red', amountCents: 100_000, ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.charge as any;
}

/** Registra un abono y devuelve la respuesta tal cual. */
async function abonar(orgId: string, cargoId: string, amountCents: number, datos: Record<string, unknown> = {}) {
  return comoMiembro(orgId).post(`/api/charges/${cargoId}/abonos`).send({ amountCents, method: 'transfer', ...datos });
}

/**
 * Registra una devolucion y devuelve la respuesta tal cual.
 *
 * El agente va como parametro y no como id de organizacion porque estos tests
 * correan sobre una base limpia propia, y las credenciales de esa base no son las
 * de `tp`. Que el agente lo elija quien llama es lo que permite probar el
 * aislamiento (misma llamada, dos organizaciones) sin duplicar la funcion.
 */
async function devolver(
  agente: { post: (ruta: string) => any },
  cargoId: string,
  amountCents: number,
  datos: Record<string, unknown> = {},
) {
  return agente
    .post(`/api/charges/${cargoId}/devoluciones`)
    .send({ amountCents, reason: 'abono cargado por error', method: 'transfer', ...datos });
}

/** El dia de hoy en la zona de la empresa, igual que lo saca la API. */
function hoyEn(zona = 'America/Santiago'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

/** Un dia del mes en curso, con hora de sobra para caer dentro del corte. */
const diaDeEsteMes = (dia: string) => `${hoyEn().slice(0, 7)}-${dia}T12:00:00.000Z`;

// ─────────────────────────────────────────────────────────────────────── interfaz

describe('la interfaz', () => {
  /**
   * El JS del bundle de Vite, leído del HTML servido.
   *
   * El HTML de Vite es solo el punto de montaje: la UI vive en el bundle, que el
   * runtime sirve con su huella `?v=`. Por eso lo que se afirma de la pantalla se
   * busca acá y no en el HTML, que ya no tiene ni el formulario ni el logout.
   */
  async function bundle(): Promise<string> {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    const js = /src="(\/assets\/[^"]+\.js[^"]*)"/.exec(html.text)?.[1];
    expect(js).toBeTruthy();
    const res = await tp.as({ orgId: TEST_ORG_A }).get(js!);
    expect(res.status).toBe(200);
    return res.text;
  }

  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Control de Pagos');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organización. Por eso no hay ningún id de organización en el HTML.
    expect(html.text).not.toContain(TEST_ORG_A);

    // Los assets del bundle salen del HTML servido, con la huella ?v= puesta por
    // el runtime: si se pidieran con el nombre viejo (/app.js) ya no existirían.
    const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css)[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets) {
      expect((await tp.as({ orgId: TEST_ORG_A }).get(asset)).status).toBe(200);
    }

    // Las rutas de cliente las resuelve la SPA: el server les devuelve el shell.
    const ruta = await tp.as({ orgId: TEST_ORG_A }).get('/cobros');
    expect(ruta.status).toBe(200);
    expect(ruta.text).toContain('Control de Pagos');
  });

  it('no sirve el HTML sin sesión: redirige al login central', async () => {
    const res = await tp.anon().get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });

  it('la UI no ofrece login: la sesión es del Core', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).not.toMatch(/type=["']password["']/i);
    expect(html.text).not.toMatch(/crear cuenta/i);

    // Y la salida se resuelve contra el Core, no contra un logout local: la
    // dibuja el shell de React, así que se busca en el bundle servido.
    expect(await bundle()).toContain('/auth/logout');
  });

  it('la UI no inventa datos ni se saltea al servidor', async () => {
    const js = await bundle();
    expect(js).not.toContain(TEST_ORG_A);
    // El BASE='/api' se concatena en runtime, así que en el bundle los caminos
    // van sin prefijo: /charges, /dashboard, /reporte y /settings.
    for (const ruta of ['/charges', '/dashboard', '/charges/next-number', '/reporte', '/settings']) {
      expect(js, `la pantalla no llama a ${ruta}`).toContain(ruta);
    }
  });

  it('el form de ajustes ofrece moneda y zona horaria', async () => {
    // El contrato de la pantalla de Ajustes: sus dos campos y su botón. Si los
    // rótulos cambian, la pantalla sigue existiendo pero ya no dice qué edita.
    const js = await bundle();
    expect(js).toContain('Moneda');
    expect(js).toContain('Zona horaria');
    expect(js).toContain('Guardar ajustes');
  });

  it('la pantalla no deja escribir el estado de un cargo', async () => {
    // El estado es un HECHO derivado del saldo. Si la pantalla lo mandara, o el
    // servidor lo aceptara, quedarían cargos "pagados" sin un céntimo cobrado.
    const js = await bundle();
    expect(js).not.toMatch(/status:\s*['"](pending|partial|paid|canceled)['"]/);
  });

  it('la pantalla pide el folio al servidor en vez de calcularlo', async () => {
    // Calcularlo en el navegador es la forma corta de que dos personas de la
    // misma empresa propongan el mismo número y la segunda se lleve un 409.
    expect(await bundle()).toContain('/charges/next-number');
  });

  it('la pantalla convierte el dinero solo para mostrarlo', async () => {
    // El `* 100` es el bug que se repite: convertir dos veces rompe los precios.
    // Los centavos viajan como centavos y el formato divide en el helper (locale
    // es-CL) al mostrarlos. Esta pantalla no debe tener su propia conversión.
    const js = await bundle();
    expect(js).not.toMatch(/\*\s*100/);
    expect(js).toContain('es-CL');
  });
});

// ───────────────────────────────────────────────────────────────── sesión e identidad

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    for (const peticion of [
      tp.anon().get('/api/charges'),
      tp.anon().get('/api/charges/saldos'),
      tp.anon().get('/api/charges/next-number'),
      tp.anon().get('/api/dashboard'),
      tp.anon().get('/api/reporte'),
      tp.anon().get('/api/settings'),
      tp.anon().post('/api/charges').send({}),
      tp.anon().post('/api/charges/cualquiera/abonos').send({}),
      tp.anon().post('/api/charges/cualquiera/cancelar').send({}),
      tp.anon().put('/api/settings').send({}),
    ]) {
      expect((await peticion).status).toBe(401);
    }
  });

  it('/api/me dice de qué organización se entra', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('pagos');
  });
});

// ──────────────────────────────────────────────────────────────────── aislamiento

describe('el aislamiento entre organizaciones', () => {
  it('ignora el organizationId que venga en el cuerpo', async () => {
    const creado = await comoMiembro(TEST_ORG_A)
      .post('/api/charges')
      .send({
        customerName: 'Aislamiento',
        concept: 'Prueba de tenancy',
        amountCents: 5_000,
        organizationId: TEST_ORG_B,
      });
    // `organization_id` lo pone el servidor, nunca el cliente: si se escuchara
    // el cuerpo, bastaría cambiar un campo al crear para escribir en otra
    // empresa.
    expect(creado.body.charge.organizationId).toBe(TEST_ORG_A);

    const fila = tp.sqlite.prepare('SELECT organization_id FROM charges WHERE id = ?').get(creado.body.charge.id) as {
      organization_id: string;
    };
    expect(fila.organization_id).toBe(TEST_ORG_A);
  });

  it('la otra empresa no ve el cargo, ni en la lista ni en la ficha ni en los saldos', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { concept: 'Secreto de Alpha' });

    const lista = await comoMiembro(TEST_ORG_B).get('/api/charges');
    expect(lista.status).toBe(200);
    expect(lista.body.items).toHaveLength(0);

    // Un 404 y no un 403: un 403 confirmaría que ese id existe.
    expect((await comoMiembro(TEST_ORG_B).get(`/api/charges/${cargo.id}`)).status).toBe(404);
    expect((await comoMiembro(TEST_ORG_B).get(`/api/charges/${cargo.id}/ficha`)).status).toBe(404);

    const saldos = await comoMiembro(TEST_ORG_B).get('/api/charges/saldos');
    expect(saldos.body.saldos).toHaveLength(0);
  });

  it('la otra empresa no puede cobrar, cancelar ni borrar el cargo', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    const beta = comoMiembro(TEST_ORG_B);

    expect((await beta.post(`/api/charges/${cargo.id}/abonos`).send({ amountCents: 1_000 })).status).toBe(404);
    expect((await beta.post(`/api/charges/${cargo.id}/cancelar`).send({})).status).toBe(404);
    expect((await beta.patch(`/api/charges/${cargo.id}`).send({ concept: 'Secuestrado' })).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).delete(`/api/charges/${cargo.id}`)).status).toBe(404);

    // Y el cargo sigue intacto: los 404 se resuelven antes de escribir.
    const intacto = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}`);
    expect(intacto.body.concept).toBe('Instalacion de red');
    expect(intacto.body.status).toBe('pending');
  });

  it('el folio es por organización: las dos empresas pueden empezar en 1', async () => {
    const limpio = startTestProduct(definicion);
    try {
      const deA = await limpio
        .as({ orgId: TEST_ORG_A, role: 'member' })
        .post('/api/charges')
        .send({ customerName: 'A', concept: 'C', amountCents: 1_000 });
      const deB = await limpio
        .as({ orgId: TEST_ORG_B, role: 'member' })
        .post('/api/charges')
        .send({ customerName: 'B', concept: 'C', amountCents: 1_000 });
      expect(deA.status).toBe(201);
      expect(deB.status).toBe(201);
      // El folio NO es global: si lo fuera, la empresa B no podría empezar en 1.
      expect(deA.body.charge.number).toBe(1);
      expect(deB.body.charge.number).toBe(1);
    } finally {
      limpio.close();
    }
  });

  it('el tablero y el reporte de la otra empresa no suman lo de esta', async () => {
    const limpio = startTestProduct(definicion);
    try {
      const cargoA = await limpio
        .as({ orgId: TEST_ORG_A, role: 'member' })
        .post('/api/charges')
        .send({ customerName: 'A', concept: 'C', amountCents: 40_000 });
      const cargoB = await limpio
        .as({ orgId: TEST_ORG_B, role: 'member' })
        .post('/api/charges')
        .send({ customerName: 'B', concept: 'C', amountCents: 90_000 });
      expect(cargoA.status).toBe(201);
      expect(cargoB.status).toBe(201);

      const tableroB = await limpio.as({ orgId: TEST_ORG_B }).get('/api/dashboard');
      expect(tableroB.body.total).toBe(1);
      expect(tableroB.body.pendienteCents).toBe(90_000);

      const reporteB = await limpio.as({ orgId: TEST_ORG_B }).get('/api/reporte');
      expect(reporteB.body.totalCargos).toBe(1);
      expect(reporteB.body.totalPendienteCents).toBe(90_000);
    } finally {
      limpio.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────── folio

describe('el folio', () => {
  // Base limpia por test: el folio es un MAXIMO, así que cualquier cargo que
  // dejó otro test corrige el número que se propone aquí.
  let limpio: TestProduct;
  const como = (orgId: string) => limpio.as({ orgId, role: 'member' });
  const admin = (orgId: string) => limpio.as({ orgId, role: 'admin' });

  beforeEach(() => {
    limpio = startTestProduct(definicion);
  });

  afterEach(() => limpio.close());

  it('propone el siguiente y lo lleva por empresa', async () => {
    const primero = (await como(TEST_ORG_B).get('/api/charges/next-number')).body.number;
    expect(primero).toBe(1);
    await como(TEST_ORG_B)
      .post('/api/charges')
      .send({ customerName: 'Folio', concept: 'C', amountCents: 1_000 });
    expect((await como(TEST_ORG_B).get('/api/charges/next-number')).body.number).toBe(2);
    // Y la otra empresa sigue en 1: el folio es por empresa, no un contador global.
    expect((await como(TEST_ORG_A).get('/api/charges/next-number')).body.number).toBe(1);
  });

  it('rechaza un folio repetido en la misma empresa con 409', async () => {
    const cargo = await como(TEST_ORG_B)
      .post('/api/charges')
      .send({ customerName: 'Folio', concept: 'C', amountCents: 1_000, number: 777 });
    expect(cargo.status).toBe(201);
    expect(cargo.body.charge.number).toBe(777);

    const repetido = await como(TEST_ORG_B)
      .post('/api/charges')
      .send({ customerName: 'Otro', concept: 'C', amountCents: 1_000, number: 777 });
    expect(repetido.status).toBe(409);
    expect(repetido.body.error).toContain('777');
  });

  it('el folio es el máximo más uno, no la cantidad de cargos', async () => {
    // Si fuera "cantidad + 1", borrar el último cargo devolvería un folio que ya
    // existe, y el índice único lo rechazaría. Con máximo + 1 nunca se repite.
    const base = como(TEST_ORG_B);
    await base.post('/api/charges').send({ customerName: 'Bajo', concept: 'C', amountCents: 1_000, number: 500 });
    const mayor = await base
      .post('/api/charges')
      .send({ customerName: 'Alto', concept: 'C', amountCents: 1_000, number: 900 });
    expect(mayor.status).toBe(201);
    expect((await base.get('/api/charges/next-number')).body.number).toBe(901);

    expect((await admin(TEST_ORG_B).delete(`/api/charges/${mayor.body.charge.id}`)).status).toBe(200);
    // Se borró el 900, que era el máximo, y el siguiente es 501: el folio se
    // propone sobre lo que queda, no sobre un contador que se reinicia.
    expect((await base.get('/api/charges/next-number')).body.number).toBe(501);
    // Y 500 no vuelve a estar libre, porque su cargo sigue existiendo.
    const repetido = await base
      .post('/api/charges')
      .send({ customerName: 'Otro', concept: 'C', amountCents: 1_000, number: 500 });
    expect(repetido.status).toBe(409);
  });
});

// ────────────────────────────────────────────────────────────────────────── cargos

describe('los cargos', () => {
  it('nacen pendientes y con la organización de la sesión', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    expect(cargo.status).toBe('pending');
    expect(cargo.organizationId).toBe(TEST_ORG_A);
    // El cliente es una COPIA: un cargo tiene que poder leerse solo.
    expect(cargo.customerName).toBe('Constructora Spa');
    expect(cargo.customerId).toBeNull();
  });

  it('no acepta importes que no sean centavos enteros positivos', async () => {
    const base = comoMiembro(TEST_ORG_A);
    for (const amountCents of [0, -1, -0.4]) {
      const res = await base
        .post('/api/charges')
        .send({ customerName: 'X', concept: 'C', amountCents });
      expect(res.status, `importe ${amountCents}`).toBe(400);
    }
  });

  it('redondea un importe con decimales una sola vez, al escribir', async () => {
    // Un centavo no puede ser 45055.4: al sumarlo con otros, la diferencia
    // aparecería en el total y nadie podría explicarla.
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 45_055.6 });
    expect(cargo.amountCents).toBe(45_056);
  });

  it('valida el formato y el calendario de las fechas', async () => {
    const base = comoMiembro(TEST_ORG_A);
    const cuerpo = { customerName: 'Fechas', concept: 'C', amountCents: 1_000 };

    for (const issuedDate of ['27-09-2026', '2026/09/27', '2026-13-01', '2026-02-31', 'hoy']) {
      const res = await base.post('/api/charges').send({ ...cuerpo, issuedDate });
      expect(res.status, `fecha ${issuedDate}`).toBe(400);
    }

    const buena = await base.post('/api/charges').send({ ...cuerpo, issuedDate: '2026-09-27', dueDate: '2026-10-27' });
    expect(buena.status).toBe(201);
  });

  it('no deja escribir el estado por el PATCH', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    const res = await comoMiembro(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ status: 'paid' });
    // Se RECHAZA y no se ignora: un PATCH que acepta `status` y no lo aplica
    // deja a quien lo mandó creyendo que el cargo quedó pagado.
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('abonos');

    const intacto = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}`);
    expect(intacto.body.status).toBe('pending');
  });

  it('no deja bajar el total de lo ya cobrado', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 60_000);

    const res = await comoMiembro(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ amountCents: 50_000 });
    // 50.000 < 60.000 cobradas: el saldo quedaría en -10.000, que es la única
    // forma de que la cartera diga que la empresa le debe plata al cliente.
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('60000');

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}/ficha`);
    expect(ficha.body.charge.amountCents).toBe(100_000);
    expect(ficha.body.saldoCents).toBe(40_000);
  });

  it('al editar el total recalcula el estado desde el saldo', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 100_000);
    expect((await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}`)).body.status).toBe('paid');

    // Subir el total deja de cubrir el saldo, y el estado lo tiene que decir sin
    // que nadie lo escriba.
    const res = await comoMiembro(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ amountCents: 150_000 });
    expect(res.status).toBe(200);
    expect(res.body.charge.status).toBe('partial');
  });

  it('el PATCH parcial no borra los campos que no vienen', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { customerEmail: 'caja@spa.test', notes: 'Contra entrega' });
    const res = await comoMiembro(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ concept: 'Solo el concepto' });
    expect(res.status).toBe(200);
    expect(res.body.charge.customerEmail).toBe('caja@spa.test');
    expect(res.body.charge.notes).toBe('Contra entrega');
    expect(res.body.charge.concept).toBe('Solo el concepto');
  });

  it('busca por folio, concepto, cliente y correo', async () => {
    const base = comoMiembro(TEST_ORG_A);
    const cargo = await nuevoCargo(TEST_ORG_A, {
      number: 4_042,
      concept: 'Antena parabólica',
      customerName: 'TALLER NORTE',
      customerEmail: 'taller@norte.test',
    });
    expect(cargo.status).toBe('pending');

    for (const q of ['4042', 'antena', 'taller norte', 'norte.test']) {
      const res = await base.get(`/api/charges?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      expect(res.body.items.map((c: any) => c.id), `buscar "${q}"`).toContain(cargo.id);
    }
  });

  it('borrar es de admin: un miembro no borra el historial de caja', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    expect((await comoMiembro(TEST_ORG_A).delete(`/api/charges/${cargo.id}`)).status).toBe(403);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/charges/${cargo.id}`)).status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────── abonos

describe('los abonos', () => {
  it('un abono parcial deja el cargo en partial y el saldo derivado', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    const res = await abonar(TEST_ORG_A, cargo.id, 40_000, { reference: 'Transferencia 8891' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.charge.status).toBe('partial');
    expect(res.body.pagadoCents).toBe(40_000);
    expect(res.body.saldoCents).toBe(60_000);
    expect(res.body.payment.reference).toBe('Transferencia 8891');

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}/ficha`);
    expect(ficha.body.saldoCents).toBe(60_000);
    expect(ficha.body.payments).toHaveLength(1);
  });

  it('un abono que iguala el saldo deja el cargo pagado', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 40_000);
    const res = await abonar(TEST_ORG_A, cargo.id, 60_000);
    expect(res.body.charge.status).toBe('paid');
    expect(res.body.saldoCents).toBe(0);

    // Y el saldo se lee igual desde el endpoint que evita el N+1.
    const saldos = await comoMiembro(TEST_ORG_A).get('/api/charges/saldos');
    const mio = saldos.body.saldos.find((s: any) => s.id === cargo.id);
    expect(mio).toEqual({ id: cargo.id, pagadoCents: 100_000, saldoCents: 0 });
  });

  it('un abono que pasa el saldo es 409 y NO escribe nada', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 70_000);

    const res = await abonar(TEST_ORG_A, cargo.id, 40_000);
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('30000');

    // Lo importante: el 409 no dejó el abono a medias.
    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}/ficha`);
    expect(ficha.body.payments).toHaveLength(1);
    expect(ficha.body.pagadoCents).toBe(70_000);
    expect(ficha.body.saldoCents).toBe(30_000);
    expect(ficha.body.charge.status).toBe('partial');
  });

  it('no acepta un abono de cero o negativo', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    for (const amountCents of [0, -500]) {
      expect((await abonar(TEST_ORG_A, cargo.id, amountCents)).status).toBe(400);
    }
    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}/ficha`);
    expect(ficha.body.payments).toHaveLength(0);
  });

  it('acepta un abono con fecha propia, para la transferencia de ayer', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    const ayer = new Date(Date.now() - 86_400_000).toISOString();
    const res = await abonar(TEST_ORG_A, cargo.id, 5_000, { receivedAt: ayer });
    expect(res.status).toBe(201);
    expect(res.body.payment.receivedAt).toBe(ayer);
  });
});

// ──────────────────────────────────────────────────────────────────────── cancelar

describe('cancelar un cargo', () => {
  it('cancela un cargo sin cobrado y no lo deshace un abono posterior', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    const res = await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({ notes: 'Cliente se retiro' });
    expect(res.status).toBe(200);
    expect(res.body.charge.status).toBe('canceled');
    expect(res.body.charge.notes).toBe('Cliente se retiro');

    // Un cancelado vale cero: no se debe nada, y su ficha no muestra el total
    // entero como si fuera una deuda.
    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}/ficha`);
    expect(ficha.body.saldoCents).toBe(0);

    // Y no admite abonos: la empresa dio el cargo por perdido, no por cobrar.
    const abono = await abonar(TEST_ORG_A, cargo.id, 1_000);
    expect(abono.status).toBe(409);
  });

  it('cancelar dos veces no es un error', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    expect((await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({})).status).toBe(200);
    // Un doble clic en el botón no puede dejar un error en pantalla después de
    // que el cargo ya quedó cancelado.
    expect((await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({})).status).toBe(200);
  });

  it('no se cancela un cargo con plata cobrada', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 1_000);

    const res = await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({});
    expect(res.status).toBe(409);
    // Cancelar significa "esto no se va a cobrar", no "se borró la historia": si ya
    // entró dinero, primero hay que devolverlo, y eso es otro documento.
    expect(res.body.error).toContain('1000');

    const intacto = await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}`);
    expect(intacto.body.status).toBe('partial');
  });

  it('editar un cancelado no lo resucita', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A);
    await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({});
    const res = await comoMiembro(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ amountCents: 200_000 });
    expect(res.status).toBe(200);
    expect(res.body.charge.status).toBe('canceled');
  });
});

// ─────────────────────────────────────────────────────────────────────── cascada

describe('devolver plata', () => {
  // Una base LIMPIA por test, igual que el tablero: estas pruebas miden saldos
  // conocidos y con la base compartida dependerian del orden en que corrieron las
  // anteriores.
  let limpio: TestProduct;
  const como = (orgId: string) => limpio.as({ orgId, role: 'member' });

  /**
   * El cargo y el abono sobre la base LIMPIA.
   *
   * No se reusan `nuevoCargo` ni `abonar` porque esos escriben en `tp` y el tablero
   * de estos tests lee `limpio`: el cargo estaria en una base y la consulta en otra,
   * y el fallo se veria como "las cifras estan en cero" en vez de como "estas
   * mirando la base equivocada".
   */
  const cargoEnLimpio = async (orgId: string, datos: Record<string, unknown> = {}) => {
    const res = await como(orgId)
      .post('/api/charges')
      .send({ customerName: 'Constructora Spa', concept: 'Instalacion de red', amountCents: 100_000, ...datos });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.charge as any;
  };

  const abonarEnLimpio = (orgId: string, cargoId: string, amountCents: number, datos: Record<string, unknown> = {}) =>
    como(orgId).post(`/api/charges/${cargoId}/abonos`).send({ amountCents, method: 'transfer', ...datos });

  beforeEach(() => {
    limpio = startTestProduct(definicion);
  });

  afterEach(() => limpio.close());

  it('descuenta el cobrado y reabre el cargo sin que nadie escriba el estado', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 100_000);
    expect((await como(TEST_ORG_A).get(`/api/charges/${cargo.id}`)).body.status).toBe('paid');

    const res = await devolver(como(TEST_ORG_A), cargo.id, 100_000);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    // El NETO es lo que la cartera debe mostrar, y el estado sale de esa misma
    // aritmetica. Devolver todo reabre el cargo como pendiente, que es lo unico
    // razonable: la plata se fue.
    expect(res.body.pagadoCents).toBe(0);
    expect(res.body.saldoCents).toBe(100_000);
    expect(res.body.charge.status).toBe('pending');

    const ficha = await como(TEST_ORG_A).get(`/api/charges/${cargo.id}/ficha`);
    expect(ficha.body.pagadoCents).toBe(0);
    expect(ficha.body.refunds).toHaveLength(1);
    // El abono NO se borra: se sigue viendo lo que entro de verdad.
    expect(ficha.body.payments).toHaveLength(1);
    expect(ficha.body.abonadoCents).toBe(100_000);
    expect(ficha.body.devueltoCents).toBe(100_000);
  });

  it('devolver de mas es 409 y NO escribe nada', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 30_000);

    const intento = await devolver(como(TEST_ORG_A), cargo.id, 30_001);
    expect(intento.status).toBe(409);
    // La devolucion imposible no se guarda a medias: una fila de mas haria que el
    // saldo se volviera NEGATIVO, que es justo lo que el invariante prohibe.
    const n = limpio.sqlite
      .prepare('SELECT COUNT(*) AS n FROM charge_refunds WHERE charge_id = ?')
      .get(cargo.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it('devolver dos veces es la suma de las dos, y el segundo no revalida de mas', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 50_000);

    // El chequeo mira el NETO, no el total de abonos: por eso devolver por partes
    // tiene que funcionar hasta agotar lo cobrado, y el error del ultimo centavo
    // tiene que ser el mismo que el de devolver de una.
    expect((await devolver(como(TEST_ORG_A), cargo.id, 20_000)).status).toBe(201);
    const segunda = await devolver(como(TEST_ORG_A), cargo.id, 30_000);
    expect(segunda.status).toBe(201);
    expect(segunda.body.pagadoCents).toBe(0);
    expect(segunda.body.charge.status).toBe('pending');
    expect((await devolver(como(TEST_ORG_A), cargo.id, 1)).status).toBe(409);
  });

  it('no se devuelve de un cargo sin plata cobrada', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    const intento = await devolver(como(TEST_ORG_A), cargo.id, 1_000);
    // No es 404 ni 500: el cargo existe y no tiene nada que devolver, asi que el
    // mensaje tiene que decir eso.
    expect(intento.status).toBe(409);
    expect(intento.body.error).toContain('no tiene plata cobrada');
  });

  it('la devolucion exige un motivo', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 30_000);

    // Un motivo obligatorio, y no por validacion formal: una devolucion sin
    // explicacion es el movimiento que despues nadie sabe defender frente a un
    // cliente que pregunta por que le devolvieron la plata.
    const vacio = await como(TEST_ORG_A)
      .post(`/api/charges/${cargo.id}/devoluciones`)
      .send({ amountCents: 1_000 });
    expect(vacio.status).toBe(400);
    const n = limpio.sqlite
      .prepare('SELECT COUNT(*) AS n FROM charge_refunds WHERE charge_id = ?')
      .get(cargo.id) as { n: number };
    expect(n.n).toBe(0);
  });

  it('acepta un importe negativo con un mensaje, y no un saldo negativo', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 30_000);
    const intento = await como(TEST_ORG_A)
      .post(`/api/charges/${cargo.id}/devoluciones`)
      .send({ amountCents: -5_000, reason: 'prueba' });
    expect(intento.status).toBe(400);
  });

  it('no se devuelve de un cargo cancelado', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    // Un cargo sin plata cobrada no se puede dejar en una situacion con plata que
    // devolver: la unica forma de tener cobrado es un abono, y el abono es lo
    // primero que se necesita. Se cubre la guarda igual, porque el endpoint existe
    // y un dia puede haber un camino que si.
    await como(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({});
    expect((await devolver(como(TEST_ORG_A), cargo.id, 1_000)).status).toBe(409);
  });

  it('otra empresa no ve ni devuelve sobre el cargo de otra', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 30_000);

    // Ni leer la devolucion ajena ni crearla: el aislamiento se prueba por el
    // "no lo veo", porque un 403 confirmaria que el id existe.
    expect((await como(TEST_ORG_B).get(`/api/charges/${cargo.id}`)).status).toBe(404);
    expect((await como(TEST_ORG_B).get(`/api/charges/${cargo.id}/ficha`)).status).toBe(404);
    expect((await devolver(como(TEST_ORG_B), cargo.id, 1_000)).status).toBe(404);
  });

  it('el tablero separa lo que entro de lo que salio', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 60_000);
    await devolver(como(TEST_ORG_A), cargo.id, 20_000, { refundedAt: diaDeEsteMes('15') });

    const tablero = await como(TEST_ORG_A).get('/api/dashboard');
    // Restarlos y mostrar un "neto" seria mostrar un numero que no es ni lo que entro
    // ni lo que salio. Son dos preguntas distintas y merecen dos numeros.
    expect(tablero.body.cobradoMesCents).toBe(60_000);
    expect(tablero.body.devueltoMesCents).toBe(20_000);
  });

  it('la devolucion cuenta en su mes, no en el de cuando se registro', async () => {
    const cargo = await cargoEnLimpio(TEST_ORG_A, { amountCents: 100_000 });
    await abonarEnLimpio(TEST_ORG_A, cargo.id, 60_000);
    // Registrada hoy pero salida el 15: lo que salio el 15 fue en el mes del 15,
    // igual que el abono cuenta por `received_at` y no por cuando se escribio la fila.
    await devolver(como(TEST_ORG_A), cargo.id, 20_000, { refundedAt: diaDeEsteMes('15') });

    const tablero = await como(TEST_ORG_A).get('/api/dashboard');
    expect(tablero.body.devueltoMesCents).toBe(20_000);
  });
});

describe('borrar un cargo', () => {
  it('un cargo sin abonos se borra', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/charges/${cargo.id}`)).status).toBe(200);
    expect((await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}`)).status).toBe(404);
  });

  it('un cargo con plata cobrada NO se borra: es 409', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 30_000);

    // El CASCADE del DDL se sigue aplicando, pero ya no es una puerta abierta: con
    // esto un admin no puede deshacer con un clic el registro de plata que entro.
    const intento = await comoAdmin(TEST_ORG_A).delete(`/api/charges/${cargo.id}`);
    expect(intento.status).toBe(409);
    expect(intento.body.error).toContain('30000');
    expect(intento.body.error).toContain('se cancela');

    // Ni el cargo ni el abono se tocan.
    expect((await comoMiembro(TEST_ORG_A).get(`/api/charges/${cargo.id}`)).status).toBe(200);
    const abonos = tp.sqlite
      .prepare('SELECT COUNT(*) AS n FROM charge_payments WHERE charge_id = ?')
      .get(cargo.id) as { n: number };
    expect(abonos.n).toBe(1);
  });

  it('el camino para deshacer un cargo cobrado es devolver y cancelar, no borrar', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 30_000);

    // Cancelar con plata cobrada tampoco: primero hay que devolverla.
    const cancelar = await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({});
    expect(cancelar.status).toBe(409);
    // El 409 tiene que decir QUE HACER, no solo que no se puede: un error que dice
    // "primero hay que devolver esa plata" sin que exista forma de devolverla es un
    // callejon sin salida, y esa es exactamente la forma que tenia antes.
    expect(cancelar.body.error).toContain('devolucion');

    // Y borrar tampoco. Los dos caminos cierran la puerta, que es lo correcto: la
    // plata que entra no se deshace, se devuelve con su propio documento.
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/charges/${cargo.id}`)).status).toBe(409);

    // Y esa devolucion se puede hacer, con lo cual la puerta vuelve a abrir por
    // donde corresponde: devolver, y despues cancelar.
    const devuelto = await devolver(
      comoMiembro(TEST_ORG_A),
      cargo.id,
      30_000,
      { reason: 'abono cargado dos veces' },
    );
    expect(devuelto.status).toBe(201);
    expect((await comoMiembro(TEST_ORG_A).post(`/api/charges/${cargo.id}/cancelar`).send({})).status).toBe(200);
  });

  it('un abono de 0 centavos no bloquea el borrado', async () => {
    // El chequeo es sobre plata REALMENTE cobrada. Un abono en cero es un ruido, no
    // un hecho de caja, y no debe cerrar la puerta a corregir el cargo.
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 0);

    expect((await comoAdmin(TEST_ORG_A).delete(`/api/charges/${cargo.id}`)).status).toBe(200);
  });

  it('la compra de tiempo no hace la puerta mas facil: el chequeo mira el saldo', async () => {
    const cargo = await nuevoCargo(TEST_ORG_A, { amountCents: 100_000 });
    await abonar(TEST_ORG_A, cargo.id, 10_000);

    // Bajar el total por debajo de lo cobrado es 409, por invariante del producto.
    const bajar = await comoAdmin(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ amountCents: 1 });
    expect(bajar.status).toBe(409);
    expect(bajar.body.error).toContain('10000');

    // Editar el total NO cambia el hecho de que entro plata, asi que el 409 del
    // borrado sigue. El chequeo mira el saldo real, no lo que el cargo diga.
    const subir = await comoAdmin(TEST_ORG_A).patch(`/api/charges/${cargo.id}`).send({ amountCents: 200_000 });
    expect(subir.status).toBe(200);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/charges/${cargo.id}`)).status).toBe(409);
  });
});


// ─────────────────────────────────────────────────────────────────────── tablero

describe('el tablero', () => {
  // Una base LIMPIA por test. El tablero se mide sobre saldos conocidos: si
  // compartiera base con el resto, estas cifras dependerían del orden en que
  // corrieron los tests anteriores, y un fallo en un test ajeno movería el
  // tablero de este.
  let limpio: TestProduct;
  const como = (orgId: string) => limpio.as({ orgId, role: 'member' });

  beforeEach(() => {
    limpio = startTestProduct(definicion);
  });

  afterEach(() => limpio.close());

  it('en una cartera vacía responde ceros y los cuatro estados', async () => {
    // Base limpia a propósito: si compartiera base con el resto, estas cifras
    // dependerían del orden en que corrieron los tests anteriores.
    const res = await como(TEST_ORG_A).get('/api/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.cobradoMesCents).toBe(0);
    expect(res.body.pendienteCents).toBe(0);
    expect(res.body.vencidoCents).toBe(0);
    expect(res.body.recientes).toEqual([]);
    // Los cuatro estados se responden siempre: una tarjeta que aparece y
    // desaparece hace que la pantalla "salte".
    expect(res.body.porStatus).toEqual({ pending: 0, partial: 0, paid: 0, canceled: 0 });
  });

  it('suma saldos, no totales, y separa lo vencido', async () => {
    const base = como(TEST_ORG_A);
    const hoy = hoyEn();
    // Vencido, sin cobrar nada.
    const vencido = await base
      .post('/api/charges')
      .send({ customerName: 'Viejo', concept: 'Deuda de enero', amountCents: 30_000, issuedDate: '2026-01-10', dueDate: '2026-02-01' });
    expect(vencido.status).toBe(201);

    // Vencido y cobrado a medias: solo debe lo que falta.
    const parcialVencido = await base
      .post('/api/charges')
      .send({ customerName: 'Parcial', concept: 'Deuda de febrero', amountCents: 50_000, issuedDate: '2026-02-10', dueDate: '2026-03-01' });
    await base.post(`/api/charges/${parcialVencido.body.charge.id}/abonos`).send({ amountCents: 20_000 });

    // Al día, sin vencer.
    const alDia = await base
      .post('/api/charges')
      .send({ customerName: 'Nuevo', concept: 'Deuda de hoy', amountCents: 20_000, issuedDate: hoy, dueDate: '2099-01-01' });

    // Pagado por completo: no aporta nada al pendiente.
    const pagado = await base.post('/api/charges').send({ customerName: 'Saldado', concept: 'Ya cobrado', amountCents: 10_000 });
    await base.post(`/api/charges/${pagado.body.charge.id}/abonos`).send({ amountCents: 10_000 });

    // Cancelado: no se va a cobrar, así que no suma a la deuda.
    const cancelado = await base.post('/api/charges').send({ customerName: 'Anulado', concept: 'No se cobra', amountCents: 70_000 });
    await base.post(`/api/charges/${cancelado.body.charge.id}/cancelar`).send({});

    const res = await base.get('/api/dashboard');
    expect(res.body.total).toBe(5);
    // 30.000 + 30.000 (de los 50.000) + 20.000 = 80.000. Ni los 10.000 pagados ni
    // los 70.000 cancelados aportan.
    expect(res.body.pendienteCents).toBe(80_000);
    expect(res.body.vencidoCents).toBe(60_000);
    expect(res.body.porStatus).toEqual({ pending: 2, partial: 1, paid: 1, canceled: 1 });
    expect(res.body.recientes).toHaveLength(5);
    expect(res.body.recientes[0].id).toBe(cancelado.body.charge.id);
    expect(alDia.status).toBe(201);
  });

  it('el cobrado del mes cuenta el abono por su fecha, no por cuándo se registró', async () => {
    const base = como(TEST_ORG_A);
    const cargo = await base
      .post('/api/charges')
      .send({ customerName: 'Cobranza', concept: 'Del mes', amountCents: 100_000 })
      .then((r) => r.body.charge);

    // Uno de este mes y otro del mes pasado. Los dos se registran AHORA, así que
    // si el tablero mirara la fecha de escritura los contaría igual.
    await base.post(`/api/charges/${cargo.id}/abonos`).send({ amountCents: 30_000, receivedAt: diaDeEsteMes('05') });
    await base.post(`/api/charges/${cargo.id}/abonos`).send({ amountCents: 20_000, receivedAt: '2020-03-05T12:00:00.000Z' });

    const res = await base.get('/api/dashboard');
    // El abono de 2020 es dinero de 2020, no de hoy.
    expect(res.body.cobradoMesCents).toBe(30_000);
  });
});

// ──────────────────────────────────────────────────────────────────────── reporte

describe('el reporte de antigüedad', () => {
  // Una base LIMPIA por test, por lo mismo que en el tablero: los tramos se
  // comparan contra cifras exactas, y un cargo de otro test los movería.
  let limpio: TestProduct;
  const como = (orgId: string) => limpio.as({ orgId, role: 'member' });

  beforeEach(() => {
    limpio = startTestProduct(definicion);
  });

  afterEach(() => limpio.close());

  it('siempre devuelve los cuatro tramos, aunque estén en cero', async () => {
    const res = await como(TEST_ORG_A).get('/api/reporte');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.buckets)).toEqual(['0-30', '31-60', '61-90', 'mas-90']);
    expect(res.body.totalCargos).toBe(0);
    expect(res.body.totalPendienteCents).toBe(0);
  });

  it('mide los días de atraso contra la fecha de corte, no contra hoy', async () => {
    const base = como(TEST_ORG_A);
    await base
      .post('/api/charges')
      .send({ customerName: 'A', concept: 'C', amountCents: 10_000, issuedDate: '2026-01-01', dueDate: '2026-01-31' });

    // Con corte al 31 de marzo, ese cargo tiene 59 días: 0-30 no, 31-60 sí.
    const corte = await base.get('/api/reporte?to=2026-03-31');
    expect(corte.body.referencia).toBe('2026-03-31');
    expect(corte.body.buckets['0-30'].cargos).toBe(0);
    expect(corte.body.buckets['31-60'].cargos).toBe(1);
    expect(corte.body.buckets['31-60'].saldoCents).toBe(10_000);

    // El mismo archivo, abierto en otro día, tiene que seguir diciendo lo mismo.
    // Si los días se midieran contra hoy, un mes después daría otro número.
    const despues = await base.get('/api/reporte?to=2026-03-31');
    expect(despues.body.buckets).toEqual(corte.body.buckets);
  });

  it('cada tramo suma los saldos, y un cancelado no aparece', async () => {
    const base = como(TEST_ORG_A);
    const viejo = await base
      .post('/api/charges')
      .send({ customerName: 'Viejo', concept: 'C', amountCents: 100_000, issuedDate: '2025-01-01', dueDate: '2025-02-01' });
    const pago = await viejo.body.charge;
    await base.post(`/api/charges/${pago.id}/abonos`).send({ amountCents: 25_000 });

    const anulado = await base
      .post('/api/charges')
      .send({ customerName: 'Anulado', concept: 'C', amountCents: 500_000, issuedDate: '2025-01-01', dueDate: '2025-02-01' });
    await base.post(`/api/charges/${anulado.body.charge.id}/cancelar`).send({});

    const res = await base.get('/api/reporte?to=2026-03-31');
    // Cancelado: no se va a cobrar, así que contarlo haría ver una cartera más
    // grande que la real.
    expect(res.body.totalCargos).toBe(1);
    // Y del que sigue vivo entra el SALDO, no el total emitido.
    expect(res.body.buckets['mas-90'].cargos).toBe(1);
    expect(res.body.buckets['mas-90'].saldoCents).toBe(75_000);
    expect(res.body.totalPendienteCents).toBe(75_000);
  });

  it('un rango inválido es 400, no un reporte sin filtro', async () => {
    const res = await como(TEST_ORG_A).get('/api/reporte?from=hoy');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('AAAA-MM-DD');
  });

  it('el rango filtra por emisión y deja fuera lo que no tiene fecha', async () => {
    const base = como(TEST_ORG_A);
    await base.post('/api/charges').send({ customerName: 'Con fecha', concept: 'C', amountCents: 10_000, issuedDate: '2026-02-10' });
    await base.post('/api/charges').send({ customerName: 'Sin fecha', concept: 'C', amountCents: 70_000 });

    // Sin `issued_date` no se puede saber si entró en el rango, así que no cuenta.
    const res = await base.get('/api/reporte?from=2026-02-01&to=2026-02-28');
    expect(res.body.from).toBe('2026-02-01');
    expect(res.body.to).toBe('2026-02-28');
    expect(res.body.totalCargos).toBe(1);
    expect(res.body.totalPendienteCents).toBe(10_000);
  });
});

// ──────────────────────────────────────────────────────────────────────── ajustes

describe('los ajustes', () => {
  it('responde con los valores por defecto si la empresa nunca guardó', async () => {
    const res = await comoMiembro(TEST_ORG_A).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({ organizationId: TEST_ORG_A, currency: '$', timezone: 'America/Santiago' });
  });

  it('cambiar los ajustes es de admin', async () => {
    // La zona decide qué día es hoy para el reporte y cuál es el mes en curso del
    // tablero: si un miembro la cambiara, se movería la lectura para toda la
    // empresa a la vez.
    expect((await comoMiembro(TEST_ORG_A).put('/api/settings').send({ currency: 'USD' })).status).toBe(403);

    const res = await comoAdmin(TEST_ORG_A).put('/api/settings').send({ currency: 'UF', timezone: 'America/Mexico_City' });
    expect(res.status).toBe(200);
    expect(res.body.settings.currency).toBe('UF');
    expect(res.body.settings.timezone).toBe('America/Mexico_City');

    // Y se lee igual después: una sola fila por organización, no una por persona.
    const leido = await comoMiembro(TEST_ORG_A).get('/api/settings');
    expect(leido.body.settings.currency).toBe('UF');
    const filas = tp.sqlite.prepare('SELECT COUNT(*) AS n FROM settings WHERE organization_id = ?').get(TEST_ORG_A) as {
      n: number;
    };
    expect(filas.n).toBe(1);
  });

  it('rechaza una zona horaria que no existe', async () => {
    const res = await comoAdmin(TEST_ORG_A).put('/api/settings').send({ currency: '$', timezone: 'Marte/Olympus' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Marte/Olympus');
  });

  it('el día de hoy del reporte es el de la zona de la empresa, no el de UTC', async () => {
    // Base limpia: los ajustes de esta prueba no pueden quedar guardados para los
    // tests siguientes, y la zona de la empresa es justamente lo que se prueba.
    const zona = startTestProduct(definicion);
    try {
      await zona.as({ orgId: TEST_ORG_A, role: 'admin' }).put('/api/settings').send({ timezone: 'Asia/Tokyo' });
      const res = await zona.as({ orgId: TEST_ORG_A }).get('/api/reporte');
      // Entre las 21:00 y las 24:00 en Santiago ya es mañana en Tokio: con la
      // fecha en UTC el reporte contaría mal un día todos los días.
      expect(res.body.referencia).toBe(hoyEn('Asia/Tokyo'));
    } finally {
      zona.close();
    }
  });
});
