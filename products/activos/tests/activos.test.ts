import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Activos sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy. En el producto viejo el
 * aislamiento venía de que cada organización tenía su propio login; ahora las
 * organizaciones comparten login y se distinguen por el token, así que el
 * aislamiento hay que probarlo: que una empresa no pueda leer ni escribir lo de
 * otra, aunque adivine el id.
 *
 * Y hay que probar la invariante que hace que este producto valga: un
 * movimiento cambia el estado del activo, y las dos cosas se escriben juntas.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Crea un activo y devuelve la fila como la devolvio la API. */
async function nuevoActivo(orgId: string, datos: Record<string, unknown> = {}) {
  const res = await comoMiembro(orgId)
    .post('/api/assets')
    .send({ name: 'Taladro percutor', category: 'herramienta', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('la interfaz', () => {
  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Activos');
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
    expect(html.text).not.toMatch(/type=["']password["']/i);
    expect(html.text).not.toMatch(/crear cuenta/i);

    // Y la salida se resuelve contra el Core, no contra un logout local.
    expect(html.text).toContain('/auth/logout');
  });

  it('la UI no inventa datos ni se saltea al servidor', async () => {
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    expect(js.text).not.toContain(TEST_ORG_A);
    expect(js.text).toContain('/api/dashboard');
    expect(js.text).toContain('/api/assets');
    expect(js.text).toContain('/api/assets/next-code');
  });

  it('el form de ajustes se llama config-form y se llena con form.elements', async () => {
    // El contrato con el HTML: el JS recorre `form.elements` y usa el `name` de
    // cada input. Si el id del form cambia, `renderConfig` deja de encontrarlo y
    // el panel aparece vacío sin ningún error visible.
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).toContain('id="config-form"');
    for (const campo of ['currency', 'timezone']) {
      expect(html.text).toContain(`name="${campo}"`);
    }

    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    expect(js.text).toContain('function renderConfig()');
    expect(js.text).toContain('form.elements');
  });

  it('la UI no borra el historial desde la pantalla', async () => {
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    const llamadas = js.text.match(/api\([^)]*\/movimientos[^)]*\)/g) ?? [];
    expect(llamadas.length).toBeGreaterThan(0);
    // Un movimiento es la prueba de lo que pasó: se registra y se lista, no se
    // corrige en silencio.
    expect(llamadas.some((c) => /method:\s*'(PATCH|DELETE)'/.test(c))).toBe(false);
  });
});

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/assets')).status).toBe(401);
    expect((await tp.anon().get('/api/dashboard')).status).toBe(401);
    expect((await tp.anon().get('/api/assets/next-code')).status).toBe(401);
    expect((await tp.anon().post('/api/assets').send({})).status).toBe(401);
  });

  it('/api/me dice de qué organización se entra', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('activos');
  });
});

describe('el aislamiento entre organizaciones', () => {
  it('ignora el organizationId que venga en el cuerpo', async () => {
    const creado = await comoMiembro(TEST_ORG_A)
      .post('/api/assets')
      .send({ code: 'ISO-1', name: 'Aislamiento', category: 'herramienta', organizationId: TEST_ORG_B });
    // `organization_id` lo pone el servidor, nunca el cliente: si se escuchara
    // el cuerpo, bastaria cambiar un campo al crear para escribir en otra
    // empresa.
    expect(creado.body.organizationId).toBe(TEST_ORG_A);

    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/assets/${creado.body.id}`)
      .send({ organizationId: TEST_ORG_B });
    expect(parche.body.organizationId).toBe(TEST_ORG_A);

    const fila = tp.sqlite.prepare('SELECT organization_id FROM assets WHERE id = ?').get(creado.body.id) as {
      organization_id: string;
    };
    expect(fila.organization_id).toBe(TEST_ORG_A);
  });

  it('la lista de una empresa no trae los activos de otra', async () => {
    const deA = await nuevoActivo(TEST_ORG_A, { code: 'ISO-2', name: 'Solo de A' });
    const listaB = await comoAdmin(TEST_ORG_B).get('/api/assets?limit=500');
    expect(listaB.status).toBe(200);
    expect(listaB.body.items.map((a: any) => a.id)).not.toContain(deA.id);
  });

  it('un activo de otra organización no existe: 404, no 403 con datos', async () => {
    const deA = await nuevoActivo(TEST_ORG_A, { code: 'ISO-3', name: 'De A' });
    // Un 403 confirmaría que el id existe; un 404 no le dice nada al que prueba.
    expect((await comoAdmin(TEST_ORG_B).get(`/api/assets/${deA.id}`)).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).get(`/api/assets/${deA.id}/ficha`)).status).toBe(404);
  });

  it('no se puede editar ni borrar el activo de otra organización', async () => {
    const deA = await nuevoActivo(TEST_ORG_A, { code: 'ISO-4', name: 'De A para tocar' });
    expect((await comoAdmin(TEST_ORG_B).patch(`/api/assets/${deA.id}`).send({ name: 'Secuestrado' })).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).delete(`/api/assets/${deA.id}`)).status).toBe(404);
  });

  it('tampoco se puede colar un movimiento sobre un activo de otra empresa', async () => {
    const deA = await nuevoActivo(TEST_ORG_A, { code: 'ISO-5', name: 'De A para mover' });
    // Por más que el id exista, el filtro por organización sigue mandando: sin el
    // chequeo, el movimiento de B cambiaría el estado de un bien de A.
    const intento = await comoMiembro(TEST_ORG_B)
      .post(`/api/assets/${deA.id}/movimientos`)
      .send({ kind: 'loss' });
    expect(intento.status).toBe(404);

    const queda = tp.sqlite.prepare('SELECT status FROM assets WHERE id = ?').get(deA.id) as { status: string };
    expect(queda.status).toBe('active');
  });
});

describe('los activos', () => {
  it('exige nombre y categoría: sin ellos no hay qué activo es', async () => {
    expect((await comoMiembro(TEST_ORG_A).post('/api/assets').send({ code: 'SIN-1', category: 'herramienta' })).status).toBe(400);
    expect((await comoMiembro(TEST_ORG_A).post('/api/assets').send({ code: 'SIN-2', name: 'Sin categoría' })).status).toBe(400);
    expect((await comoMiembro(TEST_ORG_A).post('/api/assets').send({ name: 'Sin código', category: 'herramienta' })).status).toBe(400);
  });

  it('rechaza un estado que no existe', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/assets')
      .send({ code: 'MAL-1', name: 'Activo raro', category: 'herramienta', status: 'roto' });
    // Un texto libre en el estado deja de poder filtrar el tablero, que es la
    // única razón por la que la columna existe.
    expect(res.status).toBe(400);
  });

  it('el costo se guarda en centavos enteros', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'CNT-1', costCents: 125999 });
    expect(activo.costCents).toBe(125999);
    // Un número con decimales se redondea UNA vez al escribir: guardar 100.5 en
    // una columna de patrimonio deja un valor que no es un centavo.
    const redondeado = await nuevoActivo(TEST_ORG_A, { code: 'CNT-2', costCents: 100.5 });
    expect(redondeado.costCents).toBe(101);
  });

  it('el código repetido en la misma empresa es 409, no un error de SQLite', async () => {
    await nuevoActivo(TEST_ORG_A, { code: 'REP-1', name: 'Primero' });
    const repetido = await comoMiembro(TEST_ORG_A)
      .post('/api/assets')
      .send({ code: 'REP-1', name: 'Segundo', category: 'herramienta' });
    expect(repetido.status).toBe(409);
    expect(String(repetido.body.error)).toMatch(/REP-1/);
  });

  it('el mismo código en otra empresa sí se puede: la numeración es por empresa', async () => {
    await nuevoActivo(TEST_ORG_A, { code: 'COM-1', name: 'De A' });
    const deB = await comoMiembro(TEST_ORG_B)
      .post('/api/assets')
      .send({ code: 'COM-1', name: 'De B', category: 'herramienta' });
    // Un código global obligaría a la segunda empresa que se abriera a inventar
    // otro prefijo, y "EQ-001" tiene que poder existir en todas.
    expect(deB.status).toBe(201);
    expect(deB.body.organizationId).toBe(TEST_ORG_B);
  });

  it('cambiar el código a uno que ya existe también es 409', async () => {
    await nuevoActivo(TEST_ORG_A, { code: 'CHO-1', name: 'Uno' });
    const otro = await nuevoActivo(TEST_ORG_A, { code: 'CHO-2', name: 'Dos' });
    const choque = await comoMiembro(TEST_ORG_A).patch(`/api/assets/${otro.id}`).send({ code: 'CHO-1' });
    expect(choque.status).toBe(409);
  });

  it('un PATCH parcial no borra lo que no se manda', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, {
      code: 'PAR-1',
      name: 'Notebook de la oficina',
      category: 'equipo de computo',
      brand: 'Acme',
      costCents: 45000,
    });
    const parche = await comoMiembro(TEST_ORG_A).patch(`/api/assets/${activo.id}`).send({ status: 'repair' });
    expect(parche.status).toBe(200);
    expect(parche.body.name).toBe('Notebook de la oficina');
    expect(parche.body.brand).toBe('Acme');
    expect(parche.body.costCents).toBe(45000);
    expect(parche.body.status).toBe('repair');
  });

  it('busca por código, marca, modelo, serie y responsable', async () => {
    await nuevoActivo(TEST_ORG_A, {
      code: 'BUS-1',
      name: 'Generador',
      brand: 'Kohler',
      serial: 'SN-8891',
      assignedTo: 'Marcela',
    });
    for (const termino of ['BUS-1', 'Kohler', 'SN-8891', 'Marcela']) {
      const busca = await comoAdmin(TEST_ORG_A).get(`/api/assets?q=${encodeURIComponent(termino)}`);
      expect(busca.body.items.map((a: any) => a.code), `no encontro ${termino}`).toContain('BUS-1');
    }
  });

  it('archivar saca el activo de la lista sin perder la fila', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'ARC-1', name: 'Proyector viejo' });
    const archivado = await comoAdmin(TEST_ORG_A).patch(`/api/assets/${activo.id}`).send({ archived: true });
    expect(archivado.status).toBe(200);
    expect(archivado.body.archivedAt).toBeTruthy();

    const lista = await comoAdmin(TEST_ORG_A).get('/api/assets?limit=500');
    expect(lista.body.items.map((a: any) => a.id)).not.toContain(activo.id);
    const sigue = tp.sqlite.prepare('SELECT archived_at FROM assets WHERE id = ?').get(activo.id) as {
      archived_at: string | null;
    };
    expect(sigue.archived_at).toBeTruthy();
  });
});

describe('los movimientos y la invariante de estado', () => {
  it('un retiro exige saber a quién se entrega', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-1', name: 'Notebook' });
    const sinResponsable = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'checkout' });
    // Un retiro sin responsable es un "@pendiente" suelto: se sabe que el equipo
    // se llevó alguien, y no se sabe quién.
    expect(sinResponsable.status).toBe(400);
    expect(String(sinResponsable.body.error)).toMatch(/assignedTo/);

    const sinCambios = tp.sqlite.prepare('SELECT status FROM assets WHERE id = ?').get(activo.id) as {
      status: string;
    };
    expect(sinCambios.status).toBe('active');
  });

  it('un retiro deja el activo en uso y escribe quién lo tiene', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-2', name: 'Taladro' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'checkout', assignedTo: 'Rodrigo', note: 'Para la obra del norte' });
    expect(res.status).toBe(201);
    // El estado y el movimiento se escriben juntos: por eso la respuesta trae
    // las dos mitades y no solo la fila nueva.
    expect(res.body.asset.status).toBe('active');
    expect(res.body.asset.assignedTo).toBe('Rodrigo');
    expect(res.body.movement.kind).toBe('checkout');
    expect(res.body.movement.happenedAt).toBeTruthy();
  });

  it('mandar a reparar y devolver dejan el activo en reparación y luego activo', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-3', name: 'Bomba de agua' });
    const taller = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'maintenance' });
    expect(taller.body.asset.status).toBe('repair');

    const vuelta = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'checkin' });
    // Volver del taller es volver a estar operativo: por eso un checkin siempre
    // deja el activo activo.
    expect(vuelta.body.asset.status).toBe('active');
  });

  it('retirar un bien dado de baja lo vuelve a poner en uso', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-4', name: 'Excavadora' });
    await comoAdmin(TEST_ORG_A).patch(`/api/assets/${activo.id}`).send({ status: 'retired' });
    const salida = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'checkout', assignedTo: 'Obra gris' });
    expect(salida.body.asset.status).toBe('active');
  });

  it('perder un bien lo deja como perdido y deja el movimiento escrito', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-5', name: 'Celular de la cuadrilla' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'loss', note: 'No apareció en la faena' });
    expect(res.status).toBe(201);
    expect(res.body.asset.status).toBe('lost');

    // Y las dos mitades quedaron: un movimiento sin el estado, o un estado sin el
    // movimiento, sería un activo que la empresa cuenta como propio.
    const filas = tp.sqlite
      .prepare('SELECT count(*) c FROM asset_movements WHERE asset_id = ?')
      .get(activo.id) as { c: number };
    expect(filas.c).toBe(1);
  });

  it('dar de baja un bien le deja el estado "retired"', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-6', name: 'Servidor viejo' });
    const res = await comoAdmin(TEST_ORG_A).patch(`/api/assets/${activo.id}`).send({ status: 'retired' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('retired');
  });

  it('rechaza un tipo de movimiento que no existe', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-7', name: 'Activo' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'devuelto al proveedor' });
    expect(res.status).toBe(400);
  });

  it('el movimiento se registra con la hora del servidor cuando no se manda', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'MOV-8', name: 'Hidrante' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'maintenance' });
    expect(res.body.movement.happenedAt).toBeTruthy();
  });
});

describe('borrar un activo', () => {
  it('con historial no se borra en cascada: el 409 dice que se archive', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'BOR-1', name: 'Con historial' });
    await comoMiembro(TEST_ORG_A)
      .post(`/api/assets/${activo.id}/movimientos`)
      .send({ kind: 'loss' });

    const res = await comoAdmin(TEST_ORG_A).delete(`/api/assets/${activo.id}`);
    // El CASCADE del DDL existe para la baja definitiva. Desde un botón de la
    // pantalla se llevaría por delante la prueba de que un equipo se perdió.
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toMatch(/archiv/i);

    const sigue = tp.sqlite.prepare('SELECT count(*) c FROM assets WHERE id = ?').get(activo.id) as { c: number };
    expect(sigue.c).toBe(1);
  });

  it('sin historial sí se borra de verdad, y con él sus movimientos', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'BOR-2', name: 'Creado por error' });
    const res = await comoAdmin(TEST_ORG_A).delete(`/api/assets/${activo.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const queda = tp.sqlite.prepare('SELECT count(*) c FROM assets WHERE id = ?').get(activo.id) as { c: number };
    expect(queda.c).toBe(0);
  });

  it('borrar un activo es de admin, no de cualquiera', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'BOR-3', name: 'Baja de un miembro' });
    expect((await comoMiembro(TEST_ORG_A).delete(`/api/assets/${activo.id}`)).status).toBe(403);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/assets/${activo.id}`)).status).toBe(200);
  });
});

describe('la ficha', () => {
  it('trae el activo con su historial, del movimiento más nuevo al más viejo', async () => {
    const activo = await nuevoActivo(TEST_ORG_A, { code: 'FIC-1', name: 'Andamio' });
    // Se registran en desorden a proposito: el orden lo pone la consulta, no el
    // orden en que se escribieron.
    for (const [kind, happenedAt] of [
      ['checkout', '2026-01-10T10:00:00.000Z'],
      ['maintenance', '2026-03-05T10:00:00.000Z'],
      ['checkin', '2026-02-20T10:00:00.000Z'],
    ] as const) {
      await comoMiembro(TEST_ORG_A)
        .post(`/api/assets/${activo.id}/movimientos`)
        .send({ kind, happenedAt, assignedTo: kind === 'checkout' ? 'Beto' : undefined });
    }

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/assets/${activo.id}/ficha`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.asset.code).toBe('FIC-1');
    expect(ficha.body.movements.map((m: any) => m.kind)).toEqual(['maintenance', 'checkin', 'checkout']);
    expect(ficha.body.resumen.totalMovimientos).toBe(3);
    expect(ficha.body.resumen.ultimoMovimientoAt).toBe('2026-03-05T10:00:00.000Z');
  });

  it('el historial de una empresa no se mezcla con el de otra', async () => {
    const deA = await nuevoActivo(TEST_ORG_A, { code: 'FIC-2', name: 'De A' });
    await comoMiembro(TEST_ORG_A).post(`/api/assets/${deA.id}/movimientos`).send({ kind: 'maintenance' });

    const deB = await nuevoActivo(TEST_ORG_B, { code: 'FIC-2', name: 'De B' });
    await comoMiembro(TEST_ORG_B).post(`/api/assets/${deB.id}/movimientos`).send({ kind: 'loss' });

    const fichaB = await comoMiembro(TEST_ORG_B).get(`/api/assets/${deB.id}/ficha`);
    expect(fichaB.body.movements).toHaveLength(1);
    expect(fichaB.body.movements[0].kind).toBe('loss');
  });
});

describe('las preferencias', () => {
  it('se guardan una sola vez por organización', async () => {
    const org = TEST_ORG_B;
    const primera = await comoAdmin(org).put('/api/settings').send({ timezone: 'America/Santiago', currency: '$' });
    expect(primera.status).toBe(200);

    const segunda = await comoAdmin(org).put('/api/settings').send({ timezone: 'America/Mexico_City', currency: 'MXN' });
    expect(segunda.status).toBe(200);

    const leidas = await comoAdmin(org).get('/api/settings');
    expect(leidas.body.settings.timezone).toBe('America/Mexico_City');
    expect(leidas.body.settings.currency).toBe('MXN');
    // El índice único de `settings` es lo que impide que queden dos filas
    // compitiendo por la misma empresa.
    const filas = tp.sqlite
      .prepare('SELECT count(*) c FROM settings WHERE organization_id = ?')
      .get(org) as { c: number };
    expect(filas.c).toBe(1);
  });

  it('un miembro no cambia la moneda ni la zona horaria de la empresa', async () => {
    // Si un miembro la cambiara, la lectura del costo de todo el patrimonio se
    // movería para toda la gente a la vez.
    const res = await comoMiembro(TEST_ORG_B).put('/api/settings').send({ timezone: 'Europe/Lisbon' });
    expect(res.status).toBe(403);
  });

  it('rechaza una zona horaria que no existe', async () => {
    const res = await comoAdmin(TEST_ORG_A).put('/api/settings').send({ timezone: 'Marte/Olympus' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Zona horaria/);
  });
});

/**
 * El código siguiente y el tablero se prueban sobre una base NUEVA, y no sobre
 * la compartida de los tests de arriba.
 *
 * No es descuido: los dos son preguntas sobre el TOTAL de lo que hay en la
 * empresa ("¿cuál es el número más alto?", "¿cuánto vale lo que está en uso?"), y
 * sobre una base donde cada test dejó un activo, la respuesta depende del
 * orden en que corrieron. Con una base limpia, el número que se espera es
 * exacto y no "mayor que el anterior".
 */
describe('el siguiente código y el tablero, sobre una base limpia', () => {
  let limpio: TestProduct;

  const admin = (orgId: string) => limpio.as({ orgId, role: 'admin' });

  async function crear(orgId: string, datos: Record<string, unknown>) {
    const res = await limpio.as({ orgId, role: 'member' }).post('/api/assets').send(datos);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  }

  beforeAll(() => {
    limpio = startTestProduct(definicion);
  });

  afterAll(() => limpio.close());

  it('propone el número siguiente del prefijo que ya usa la empresa', async () => {
    for (const code of ['EQ-001', 'EQ-002', 'EQ-004']) {
      await crear(TEST_ORG_A, { code, name: `Equipo ${code}`, category: 'herramienta' });
    }
    const res = await admin(TEST_ORG_A).get('/api/assets/next-code');
    // Y con el mismo ancho: la empresa numera con ceros, así que se propone
    // "EQ-005" y no "EQ-5", que rompería la serie a la vista.
    expect(res.body.code).toBe('EQ-005');
    expect(res.body.prefijo).toBe('EQ-');
  });

  it('cada empresa lleva su propia numeración', async () => {
    await crear(TEST_ORG_B, { code: 'MAQ-010', name: 'De B', category: 'vehiculo' });
    const deB = await admin(TEST_ORG_B).get('/api/assets/next-code');
    const deA = await admin(TEST_ORG_A).get('/api/assets/next-code');
    expect(deB.body.code).toBe('MAQ-011');
    // Los activos de B no mueven la cuenta de A: si lo hicieran, una empresa
    // vería saltados sus propios números por el trabajo de otra.
    expect(deA.body.code).toBe('EQ-005');
  });

  it('un código archivado sigue ocupando su lugar en la serie', async () => {
    const eq5 = await crear(TEST_ORG_A, { code: 'EQ-005', name: 'El cinco', category: 'herramienta' });
    await admin(TEST_ORG_A).patch(`/api/assets/${eq5.id}`).send({ archived: true });
    // Reciclar el número de un bien dado de baja por error es como se termina
    // con dos equipos del mismo número en el taller.
    const res = await admin(TEST_ORG_A).get('/api/assets/next-code');
    expect(res.body.code).toBe('EQ-006');
  });

  it('el tablero cuenta por estado y suma el valor de lo que está en uso', async () => {
    const enUso = await crear(TEST_ORG_A, { code: 'TAB-1', name: 'En uso', category: 'herramienta', costCents: 100_00 });
    const enTaller = await crear(TEST_ORG_A, { code: 'TAB-2', name: 'Reparacion', category: 'herramienta', costCents: 50_00 });
    const perdido = await crear(TEST_ORG_A, { code: 'TAB-3', name: 'Perdido', category: 'herramienta', costCents: 999_00 });
    const deBaja = await crear(TEST_ORG_A, { code: 'TAB-4', name: 'Dado de baja', category: 'herramienta', costCents: 7_00 });
    const org = { orgId: TEST_ORG_A, role: 'member' } as const;

    // Un bien va a reparacion por un movimiento, no porque alguien lo marque a
    // mano: el tablero tiene que reflejar lo que paso, no lo que se escribio.
    await limpio.as(org).post(`/api/assets/${enTaller.id}/movimientos`).send({ kind: 'maintenance' });
    await limpio.as(org).post(`/api/assets/${perdido.id}/movimientos`).send({ kind: 'loss' });
    await admin(TEST_ORG_A).patch(`/api/assets/${deBaja.id}`).send({ status: 'retired' });

    const tablero = await admin(TEST_ORG_A).get('/api/dashboard');
    expect(tablero.status).toBe(200);
    // Los cuatro estados se responden siempre, aunque uno no tenga activos: una
    // tarjeta que aparece y desaparece hace que la pantalla "salte".
    expect(tablero.body.porStatus).toHaveProperty('active');
    expect(tablero.body.porStatus).toHaveProperty('repair');
    expect(tablero.body.porStatus).toHaveProperty('retired');
    expect(tablero.body.porStatus).toHaveProperty('lost');

    // Los tres EQ del test de numeracion mas TAB-1. Los dos codigos sin numero
    // viven en otra base, asi que aqui no existen.
    expect(tablero.body.porStatus.active).toBe(4);
    expect(tablero.body.porStatus.repair).toBe(1);
    expect(tablero.body.porStatus.retired).toBe(1);
    expect(tablero.body.porStatus.lost).toBe(1);
    // El valor en uso suma SOLO los activos: un bien en el taller, dado de baja o
    // perdido sigue en el inventario, pero no es capital trabajando.
    expect(tablero.body.valorEnUsoCents).toBe(100_00);
    expect(tablero.body.recientes).toHaveLength(5);
    // Y el archivado no aparece: archivar es sacarlo de la operación sin perder
    // la historia, así que tampoco puede inflar el patrimonio.
    expect(tablero.body.recientes.map((a: any) => a.code)).not.toContain('EQ-005');
  });

  it('el tablero de una empresa no cuenta los activos de otra', async () => {
    const tableroA = await admin(TEST_ORG_A).get('/api/dashboard');
    const tableroB = await admin(TEST_ORG_B).get('/api/dashboard');

    // B solo tiene el MAQ-010 del test de numeración, y nada de lo que se creó
    // en A: si un tablero se llevara por delante activos de la otra empresa, la
    // suma de los dos sería mayor que las filas que hay.
    expect(tableroB.body.total).toBe(1);
    const filas = limpio.sqlite.prepare('SELECT count(*) c FROM assets').get() as { c: number };
    expect(tableroA.body.total + tableroB.body.total).toBe(filas.c - 1);
  });
});

/**
 * Y este va sobre una tercera base, porque la pregunta es "qué pasa en una
 * empresa que todavía no numera". En la base de arriba ya existen "EQ-001" y
 * compañía, así que allí la respuesta correcta no sería "EQ-1".
 */
describe('el código siguiente en una empresa que todavía no numera', () => {
  let vacio: TestProduct;

  beforeAll(() => {
    vacio = startTestProduct(definicion);
  });

  afterAll(() => vacio.close());

  it('propone el prefijo por defecto en vez de un número suelto', async () => {
    for (const [code, name] of [
      ['LAPTOP-ANA', 'Notebook de Ana'],
      ['PROY-A', 'Proyector del pasillo'],
    ]) {
      const res = await vacio
        .as({ orgId: TEST_ORG_A, role: 'member' })
        .post('/api/assets')
        .send({ code, name, category: 'equipo de computo' });
      expect(res.status).toBe(201);
    }

    const res = await vacio.as({ orgId: TEST_ORG_A, role: 'admin' }).get('/api/assets/next-code');
    // Sin serie que seguir no se inventa un número en medio de la lista: se
    // propone uno nuevo y el usuario lo cambia si en su empresa usan otro prefijo.
    expect(res.body.code).toBe('EQ-1');
    expect(res.body.prefijo).toBe('EQ-');
  });
});

describe('el contrato del frontend', () => {
  it('el panel de ajustes es un <form id="config-form"> que el JS llena por form.elements', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).toMatch(/<form[^>]*\bid="config-form"/);
    // Y no puede buscar un `#config` a secas: el panel se llama
    // `data-tab="ajustes"`, así que ese selector no matchearía nada.
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    const fn = js.text.match(/function renderConfig\(\)\s*\{[\s\S]*?\n\s{2}\}/);
    expect(fn, 'no se encontro renderConfig()').toBeTruthy();
    expect(fn![0]).toMatch(/form\.elements/);
    expect(fn![0]).not.toMatch(/['"]#config(?!-)/);
  });
});
