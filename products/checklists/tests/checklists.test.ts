import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Checklists e inspecciones sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy. En el producto viejo el
 * aislamiento venía de que cada organizacion tenia su propio login; ahora las
 * organizaciones comparten login y se distinguen por el token, asi que el
 * aislamiento hay que probarlo: que una empresa no pueda leer ni escribir lo de
 * otra, aunque adivine el id.
 *
 * Y hay que probar la invariante que hace que este producto valga, que son dos y
 * estan en el mismo archivo:
 *
 *   - la corrida guarda un SNAPSHOT de la plantilla (por que existe el producto);
 *   - la corrida no se puede cerrar con obligatorios sin responder.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/**
 * Crea una plantilla con sus puntos y devuelve las dos mitades.
 *
 * La API responde `{ template, items }`; aca se renombra `template` a `plantilla`
 * para que los tests se lean en español y no haya que acordarse del nombre de la
 * clave English en cada linea.
 */
async function nuevaPlantilla(orgId: string, datos: Record<string, unknown> = {}) {
  const res = await comoMiembro(orgId)
    .post('/api/templates')
    .send({ name: 'Checklist de prueba', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...res.body, plantilla: res.body.template };
}

/** Empieza una corrida y devuelve la corrida con sus puntos. */
async function nuevaCorrida(orgId: string, datos: Record<string, unknown>) {
  const res = await comoMiembro(orgId).post('/api/runs').send(datos);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/**
 * Crea una plantilla con sus puntos, todos OBLIGATORIOS salvo que se pidan
 * explicitamente en `opcionales` (posiciones 1-based).
 *
 * El default es "obligatorio" a proposito: si el helper dejara el ultimo punto
 * opcional por convenience, los tests de la regla de los obligatorios estarian
 * probando que se puede cerrar una corrida con un obligatoire sin responder, que
 * es justo lo que no tiene que pasar.
 */
async function plantillaConItems(orgId: string, name: string, labels: string[], opcionales: number[] = []) {
  return nuevaPlantilla(orgId, {
    name,
    items: labels.map((label, i) => ({ label, required: opcionales.includes(i + 1) ? 0 : 1 })),
  });
}

/** Crea una plantilla con secciones y devuelve la plantilla, las secciones y los puntos. */
async function plantillaConSecciones(
  orgId: string,
  name: string,
  secciones: Array<{ name: string; items: string[] }>,
) {
  return nuevaPlantilla(orgId, {
    name,
    sections: secciones.map((s) => ({ name: s.name, items: s.items.map((label) => ({ label })) })),
  });
}

async function corridaDe(plantillaId: string, extra: Record<string, unknown> = {}) {
  return nuevaCorrida(TEST_ORG_A, { templateId: plantillaId, ...extra });
}

/** Responde un punto de la corrida. `assert` se apaga para los 400 esperados. */
async function responder(runId: string, position: number, result: string, note?: string) {
  return comoMiembro(TEST_ORG_A)
    .post(`/api/runs/${runId}/items/${position}`)
    .send({ result, note: note ?? null });
}

// ───────────────────────────────────────────────────────────────── la interfaz

/** El JS servido: el HTML de Vite es solo el punto de montaje. */
async function bundle(): Promise<string> {
  const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
  const js = /src="(\/assets\/[^"]+\.js[^"]*)"/.exec(html.text)?.[1];
  expect(js, 'el HTML no referencia el bundle').toBeTruthy();
  const res = await tp.as({ orgId: TEST_ORG_A }).get(js!);
  expect(res.status).toBe(200);
  return res.text;
}

describe('la interfaz', () => {
  it('con sesion sirve la app y sus estaticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Checklists');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organizacion. Por eso no hay ningun id de organizacion en el HTML.
    expect(html.text).not.toContain(TEST_ORG_A);

    // Los assets del bundle de Vite salen del HTML servido, con huella ?v=
    // puesta por el runtime: JS y CSS de la app.
    const assets = [...html.text.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css)[^"]*)"/g)].map(
      (m) => m[1],
    );
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets) {
      expect((await tp.as({ orgId: TEST_ORG_A }).get(asset)).status).toBe(200);
    }

    // Las rutas de cliente las resuelve la SPA: el server les devuelve el shell.
    const ruta = await tp.as({ orgId: TEST_ORG_A }).get('/plantillas');
    expect(ruta.status).toBe(200);
    expect(ruta.text).toContain('Checklists');
  });

  it('no sirve el HTML sin sesion: redirige al login central', async () => {
    const res = await tp.anon().get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });

  it('la UI no ofrece login: la sesion es del Core', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).not.toMatch(/type=["']password["']/i);
    expect(html.text).not.toMatch(/crear cuenta/i);

    // Y la salida se resuelve contra el Core, no contra un logout local: el
    // shell de React la dibuja contra /auth/logout, y eso vive en el bundle.
    expect(await bundle()).toContain('/auth/logout');
  });

  it('la UI no inventa datos ni se saltea al servidor', async () => {
    const js = await bundle();
    expect(js).not.toContain(TEST_ORG_A);
    // Todo lo que se ve sale de la API: los caminos de los endpoints que
    // pintan el tablero, las plantillas, las corridas y los ajustes estan en
    // el bundle (el prefijo /api lo agrega el cliente en runtime).
    for (const ruta of ['/dashboard', '/templates', '/runs', '/settings', '/completar']) {
      expect(js).toContain(ruta);
    }
  });

  it('el form de ajustes conserva config-form y sus campos con name', async () => {
    // El contrato con la pantalla: antes el form vivia en el HTML estatico y el
    // JS lo llenaba por form.elements; ahora React lo renderiza desde el bundle,
    // pero el id y los names siguen siendo los mismos para quien automatice la
    // pantalla por fuera.
    const js = await bundle();
    expect(js).toContain('config-form');
    expect(js).toContain('name:"currency"');
    expect(js).toContain('name:"timezone"');
  });

  it('la UI no borra puntos ni resultados: no edita lo ya ejecutado', async () => {
    const js = await bundle();
    // Un punto respondido es la foto de un hecho. Quitarlo desde la pantalla
    // dejaria la corrida con un hueco, y ese hueco no se explica solo. Quitar un
    // punto de una PLANTILLA si se puede, y es otra cosa: ese no se ha ejecutado
    // nunca. Por eso el filtro mira los borrados sobre /runs/.../items.
    const borrados = [...js.matchAll(/\.delete\(\s*[`"'][^`"']*\/runs\/[^`"']*\/items\/[^`"']*[`"']/g)];
    expect(borrados).toEqual([]);
    // Y quitar un punto de la plantilla solo puede ser sobre una plantilla que no
    // se ha usado: si tiene corridas, el aviso lo dice.
    expect(js).toContain('Las corridas quedan con su copia');
  });
});

// ───────────────────────────────────────────────────────── sesion e identidad

describe('sesion e identidad', () => {
  it('sin sesion no entra a la API', async () => {
    expect((await tp.anon().get('/api/templates')).status).toBe(401);
    expect((await tp.anon().get('/api/runs')).status).toBe(401);
    expect((await tp.anon().get('/api/dashboard')).status).toBe(401);
    expect((await tp.anon().get('/api/settings')).status).toBe(401);
    expect((await tp.anon().post('/api/templates').send({})).status).toBe(401);
    expect((await tp.anon().post('/api/runs').send({})).status).toBe(401);
  });

  it('/api/me dice de que organizacion se entra', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('checklists');
  });
});

// ─────────────────────────────────────────────── el aislamiento entre empresas

describe('el aislamiento entre organizaciones', () => {
  it('rechaza el organizationId que venga en el cuerpo', async () => {
    // `organization_id` lo pone el servidor, nunca el cliente: si se escuchara el
    // cuerpo, bastaria cambiar un campo al crear para escribir en otra empresa.
    // Ahora el campo ni siquiera pasa: se rechaza el 400 y no se escribe nada, que
    // es mas fuerte que ignorarlo en silencio.
    const inválida = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({ name: 'Aislamiento', organizationId: TEST_ORG_B });
    expect(inválida.status).toBe(400);
    expect(inválida.body.error).toContain('organizationId');

    const { plantilla } = await nuevaPlantilla(TEST_ORG_A, { name: 'Aislamiento' });
    expect(plantilla.organizationId).toBe(TEST_ORG_A);

    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/templates/${plantilla.id}`)
      .send({ organizationId: TEST_ORG_B });
    expect(parche.status).toBe(400);

    const fila = tp.sqlite
      .prepare('SELECT organization_id FROM templates WHERE id = ?')
      .get(plantilla.id) as { organization_id: string };
    expect(fila.organization_id).toBe(TEST_ORG_A);

    // Y lo mismo en una corrida: el snapshot tampoco acepta una empresa ajena.
    const corridaInvalida = await comoMiembro(TEST_ORG_A)
      .post('/api/runs')
      .send({ items: [{ label: 'Punto' }], organization_id: TEST_ORG_B });
    expect(corridaInvalida.status).toBe(400);

    const { run } = await nuevaCorrida(TEST_ORG_A, { items: [{ label: 'Punto' }] });
    expect(run.organizationId).toBe(TEST_ORG_A);
    const filaRun = tp.sqlite.prepare('SELECT organization_id FROM runs WHERE id = ?').get(run.id) as {
      organization_id: string;
    };
    expect(filaRun.organization_id).toBe(TEST_ORG_A);
  });

  it('la lista de una empresa no trae lo de otra', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Solo de A', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    const plantillasB = await comoMiembro(TEST_ORG_B).get('/api/templates?limit=500');
    expect(plantillasB.status).toBe(200);
    expect(plantillasB.body.items.map((t: any) => t.id)).not.toContain(plantilla.id);

    const corridasB = await comoMiembro(TEST_ORG_B).get('/api/runs?limit=500');
    expect(corridasB.body.items.map((r: any) => r.id)).not.toContain(run.id);
  });

  it('una plantilla o una corrida de otra organizacion no existe: 404, no 403', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'De A', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    // Un 403 confirmaria que el id existe; un 404 no le dice nada al que prueba.
    expect((await comoAdmin(TEST_ORG_B).get(`/api/templates/${plantilla.id}`)).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).get(`/api/templates/${plantilla.id}/items`)).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).get(`/api/runs/${run.id}`)).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).get(`/api/runs/${run.id}/ficha`)).status).toBe(404);
    expect(items).toHaveLength(2);
  });

  it('no se puede editar ni borrar lo de otra organizacion', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'De A para tocar', ['Uno']);
    const { run } = await corridaDe(plantilla.id);

    expect((await comoAdmin(TEST_ORG_B).patch(`/api/templates/${plantilla.id}`).send({ name: 'Secuestrada' })).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).delete(`/api/templates/${plantilla.id}`)).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).patch(`/api/runs/${run.id}`).send({ status: 'canceled' })).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).delete(`/api/runs/${run.id}`)).status).toBe(404);
  });

  it('tampoco se puede responder, completar ni tocar los puntos de otra empresa', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'De A para responder', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    // Por mas que el id exista, el filtro por organizacion sigue mandando: sin el,
    // B responderia puntos de una corrida de A y la dejaria lista para firmar.
    expect((await comoMiembro(TEST_ORG_B).post(`/api/runs/${run.id}/items/1`).send({ result: 'ok' })).status).toBe(404);
    expect((await comoMiembro(TEST_ORG_B).post(`/api/runs/${run.id}/completar`)).status).toBe(404);

    // Y los puntos de la plantilla ajena tampoco se agregan ni se quitan.
    expect(
      (await comoMiembro(TEST_ORG_B).post(`/api/templates/${plantilla.id}/items`).send({ label: 'Intruso' })).status,
    ).toBe(404);
    expect((await comoMiembro(TEST_ORG_B).delete(`/api/templates/${plantilla.id}/items/${items[0].id}`)).status).toBe(404);

    const punto = tp.sqlite
      .prepare('SELECT result FROM run_items WHERE run_id = ? AND position = 1')
      .get(run.id) as { result: string | null };
    expect(punto.result).toBeNull();
    const corrida = tp.sqlite.prepare('SELECT status FROM runs WHERE id = ?').get(run.id) as { status: string };
    expect(corrida.status).toBe('in_progress');
  });
});

// ─────────────────────────────────────────────────────────────────── plantillas

describe('las plantillas', () => {
  it('exige nombre: sin nombre no hay que revisar', async () => {
    expect((await comoMiembro(TEST_ORG_A).post('/api/templates').send({ name: '   ' })).status).toBe(400);
  });

  it('crea la plantilla con sus puntos y numera de 1 a N', async () => {
    const { plantilla, items } = await plantillaConItems(
      TEST_ORG_A,
      'Apertura de faena',
      ['Extintor con carga vigente', 'Piso sin cables sueltos', 'EPP completo'],
      [3],
    );

    expect(plantilla.active).toBe(1);
    expect(items.map((p: any) => p.position)).toEqual([1, 2, 3]);
    expect(items.map((p: any) => p.label)).toEqual([
      'Extintor con carga vigente',
      'Piso sin cables sueltos',
      'EPP completo',
    ]);
    // El tercero venia pedido como opcional, y eso es lo que queda guardado.
    expect(items.map((p: any) => p.required)).toEqual([1, 1, 0]);
  });

  it('el listado filtra por activas y por texto, y un filtro raro se rechaza', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Buscable por nombre unico', ['Uno']);

    const soloActivas = await comoMiembro(TEST_ORG_A).get('/api/templates?active=1&limit=500');
    expect(soloActivas.body.items.map((t: any) => t.id)).toContain(plantilla.id);

    await comoMiembro(TEST_ORG_A).patch(`/api/templates/${plantilla.id}`).send({ active: 0 });
    const trasDesactivar = await comoMiembro(TEST_ORG_A).get('/api/templates?active=1&limit=500');
    expect(trasDesactivar.body.items.map((t: any) => t.id)).not.toContain(plantilla.id);
    // Sigue existiendo y se ve entre las inactivas: desactivar no es borrar.
    const inactivas = await comoMiembro(TEST_ORG_A).get('/api/templates?active=0&limit=500');
    expect(inactivas.body.items.map((t: any) => t.id)).toContain(plantilla.id);

    const porTexto = await comoMiembro(TEST_ORG_A).get('/api/templates?q=unico');
    expect(porTexto.body.items.map((t: any) => t.id)).toContain(plantilla.id);

    // Un `?active=si` que se tomara por "todas" mostraria inactivas sin avisar.
    const raro = await comoMiembro(TEST_ORG_A).get('/api/templates?active=si');
    expect(raro.status).toBe(400);
  });

  it('un PATCH parcial no borra lo que no se manda', async () => {
    const { plantilla } = await nuevaPlantilla(TEST_ORG_A, {
      name: 'Cierre de obra',
      description: 'Se usa los viernes',
    });
    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/templates/${plantilla.id}`)
      .send({ active: 0 });
    expect(parche.status).toBe(200);
    expect(parche.body.name).toBe('Cierre de obra');
    expect(parche.body.description).toBe('Se usa los viernes');
    expect(parche.body.active).toBe(0);
  });

  it('agregar un punto lo pone al final y toca la plantilla', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Dos puntos', ['Uno', 'Dos']);
    const antes = tp.sqlite.prepare('SELECT updated_at FROM templates WHERE id = ?').get(plantilla.id) as {
      updated_at: string | null;
    };

    const agregado = await comoMiembro(TEST_ORG_A)
      .post(`/api/templates/${plantilla.id}/items`)
      .send({ label: 'Tres', required: 0 });
    expect(agregado.status).toBe(201);
    expect(agregado.body.position).toBe(3);
    expect(agregado.body.required).toBe(0);

    // Agregar un punto es cambiar la plantilla: si no se toca `updated_at`, la
    // columna no sirve para saber que plantilla cambio y cual no.
    const despues = tp.sqlite.prepare('SELECT updated_at FROM templates WHERE id = ?').get(plantilla.id) as {
      updated_at: string | null;
    };
    expect(antes.updated_at).toBeNull();
    expect(despues.updated_at).toBeTruthy();

    const puntos = await comoMiembro(TEST_ORG_A).get(`/api/templates/${plantilla.id}/items`);
    expect(puntos.body.items.map((p: any) => p.position)).toEqual([1, 2, 3]);
  });

  it('borrar el punto 2 de 3 renumera lo que queda a 1 y 2, sin huecos', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'Tres puntos', ['Uno', 'Dos', 'Tres']);

    const borrado = await comoMiembro(TEST_ORG_A).delete(`/api/templates/${plantilla.id}/items/${items[1].id}`);
    expect(borrado.status).toBe(200);
    expect(borrado.body.items.map((p: any) => p.position)).toEqual([1, 2]);
    expect(borrado.body.items.map((p: any) => p.label)).toEqual(['Uno', 'Tres']);

    // La respuesta del servidor es la lista renumerada, y la base agrees con ella.
    const filas = tp.sqlite
      .prepare('SELECT label, position FROM template_items WHERE template_id = ? ORDER BY position')
      .all(plantilla.id) as Array<{ label: string; position: number }>;
    expect(filas).toEqual([
      { label: 'Uno', position: 1 },
      { label: 'Tres', position: 2 },
    ]);
  });

  it('no se puede borrar un punto que no es de esa plantilla', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'Con puntos', ['Uno', 'Dos']);
    const otra = await plantillaConItems(TEST_ORG_A, 'Otra plantilla', ['Su punto']);

    const intento = await comoMiembro(TEST_ORG_A).delete(
      `/api/templates/${otra.template.id}/items/${items[0].id}`,
    );
    expect(intento.status).toBe(404);

    // Y el punto ajeno sigue donde estaba: el UNIQUE de (template_id, position) no
    // se toco ni quedo una lista con numeros raros.
    const puntos = await comoMiembro(TEST_ORG_A).get(`/api/templates/${plantilla.id}/items`);
    expect(puntos.body.items.map((p: any) => p.position)).toEqual([1, 2]);
  });

  it('duplicar copia los puntos y marca el nombre como copia', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'Inspeccion de obra', [
      'Arneses',
      'Cuerdas',
      'Anclajes*',
    ]);

    const copia = await comoMiembro(TEST_ORG_A).post(`/api/templates/${plantilla.id}/duplicar`);
    expect(copia.status).toBe(201);
    expect(copia.body.template.name).toBe('Inspeccion de obra (copia)');
    expect(copia.body.template.id).not.toBe(plantilla.id);
    expect(copia.body.items.map((p: any) => p.position)).toEqual([1, 2, 3]);
    expect(copia.body.items.map((p: any) => p.label)).toEqual(items.map((p: any) => p.label));
    expect(copia.body.items.map((p: any) => p.required)).toEqual(items.map((p: any) => p.required));

    // La original no se toca: duplicar es agregar, no mover.
    const original = await comoMiembro(TEST_ORG_A).get(`/api/templates/${plantilla.id}/items`);
    expect(original.body.items).toHaveLength(3);
  });

  it('duplicar una plantilla con el nombre al limite no se pasa del maximo', async () => {
    const larguisimo = 'A'.repeat(150);
    const { plantilla } = await nuevaPlantilla(TEST_ORG_A, { name: larguisimo });

    const copia = await comoMiembro(TEST_ORG_A).post(`/api/templates/${plantilla.id}/duplicar`);
    expect(copia.status).toBe(201);
    expect(copia.body.template.name).toHaveLength(150);
    // Se recorta la BASE, nunca el sufijo: una copia sin sufijo no se distingue.
    expect(copia.body.template.name).toMatch(/\(copia\)$/);
  });

  it('borrar una plantilla es de admin, no de cualquiera', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Baja de un miembro', ['Uno']);
    expect((await comoMiembro(TEST_ORG_A).delete(`/api/templates/${plantilla.id}`)).status).toBe(403);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/templates/${plantilla.id}`)).status).toBe(200);
  });
});

// ───────────────────────────────────────────────────────────────────── corridas

describe('las corridas', () => {
  it('exige una plantilla o al menos un punto, pero no los dos', async () => {
    const sinNada = await comoMiembro(TEST_ORG_A).post('/api/runs').send({ location: 'Bodega 2' });
    expect(sinNada.status).toBe(400);

    const vacia = await comoMiembro(TEST_ORG_A).post('/api/runs').send({ items: [] });
    expect(vacia.status).toBe(400);

    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Para el conflicto', ['Uno']);
    const ambas = await comoMiembro(TEST_ORG_A)
      .post('/api/runs')
      .send({ templateId: plantilla.id, items: [{ label: 'Otro' }] });
    // Adivinar cual de las dos manda no es una opcion: la API pregunta.
    expect(ambas.status).toBe(400);
    expect(String(ambas.body.error)).toMatch(/no los dos/);
  });

  it('construye el snapshot al empezar una corrida desde la plantilla', async () => {
    const { plantilla } = await plantillaConItems(
      TEST_ORG_A,
      'Apertura de faena',
      ['Extintor con carga vigente', 'Piso sin cables sueltos', 'EPP completo'],
      [3],
    );

    const { run, items } = await corridaDe(plantilla.id, { location: 'Faena norte' });
    expect(run.templateId).toBe(plantilla.id);
    expect(run.templateName).toBe('Apertura de faena');
    expect(run.status).toBe('in_progress');
    expect(run.completedAt).toBeNull();
    expect(run.startedAt).toBeTruthy();

    // El snapshot lleva los puntos en el mismo orden y con el mismo `required`, y
    // las filas propias arrancan sin respuesta. Tambien lleva el tipo y la seccion
    // con la que se hacia la revision: son la foto del punto de ese dia.
    expect(JSON.parse(run.templateItemsJson)).toEqual([
      { position: 1, label: 'Extintor con carga vigente', required: 1, type: 'yes_no', options: null, section: 'General' },
      { position: 2, label: 'Piso sin cables sueltos', required: 1, type: 'yes_no', options: null, section: 'General' },
      { position: 3, label: 'EPP completo', required: 0, type: 'yes_no', options: null, section: 'General' },
    ]);
    // Las filas propias copian el tipo del momento, para validar y pintar sin
    // mirar la plantilla.
    expect(items.map((p: any) => p.type)).toEqual(['yes_no', 'yes_no', 'yes_no']);
    expect(items.map((p: any) => p.position)).toEqual([1, 2, 3]);
    expect(items.every((p: any) => p.result === null && p.answeredAt === null)).toBe(true);
  });

  it('una corrida libre trae sus propios puntos, numerados de 1 a N', async () => {
    const { run, items } = await nuevaCorrida(TEST_ORG_A, {
      location: 'Casa del cliente',
      items: [{ label: 'Puerta abierta' }, { label: 'Mascara puesta', required: 0 }],
    });

    // Sin plantilla no hay nombre que copiar, pero la columna es NOT NULL y una
    // fila sin nombre no se puede ordenar ni buscar.
    expect(run.templateId).toBeNull();
    expect(run.templateName).toBe('Corrida libre');
    expect(items.map((p: any) => p.position)).toEqual([1, 2]);
    expect(items.map((p: any) => p.required)).toEqual([1, 0]);
    expect(JSON.parse(run.templateItemsJson).length).toBe(2);
  });

  it('no se puede inspeccionar con la plantilla de otra empresa ni con una vacia', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Privada de A', ['Uno']);
    const ajena = await comoMiembro(TEST_ORG_B).post('/api/runs').send({ templateId: plantilla.id });
    expect(ajena.status).toBe(404);

    const vacia = await plantillaConItems(TEST_ORG_A, 'Sin puntos', []);
    const sinPuntos = await comoMiembro(TEST_ORG_A).post('/api/runs').send({ templateId: vacia.template.id });
    expect(sinPuntos.status).toBe(400);
    expect(String(sinPuntos.body.error)).toMatch(/puntos/);
  });

  it('responder un punto lo sella con answered_at del servidor', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Para responder', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    const respuesta = await responder(run.id, 1, 'ok');
    expect(respuesta.status).toBe(200);
    expect(respuesta.body.item.result).toBe('ok');
    expect(respuesta.body.item.answeredAt).toBeTruthy();
    // La hora la pone el servidor: "se respondio el jueves" no se escribe a mano.
    expect(respuesta.body.item.answeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const conNota = await responder(run.id, 2, 'fail', 'El cable estaba pelado');
    expect(conNota.body.item.note).toBe('El cable estaba pelado');
  });

  it('rechaza una respuesta que no existe y una posicion que no esta', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Respuestas malas', ['Uno']);
    const { run } = await corridaDe(plantilla.id);

    const rara = await responder(run.id, 1, 'casi');
    expect(rara.status).toBe(400);

    const fueraDeRango = await responder(run.id, 7, 'ok');
    expect(fueraDeRango.status).toBe(404);
  });

  it('completar con un obligatorio sin responder es 400, y dice cual falta', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Con obligatorio pendiente', [
      'Extintor',
      'Piso libre',
    ]);
    const { run } = await corridaDe(plantilla.id);
    await responder(run.id, 1, 'ok');

    const intento = await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`);
    // Una inspeccion firmada sin responder los obligatorios es un formulario
    // firmado en blanco. El 400 tiene que decir a que punto volver.
    expect(intento.status).toBe(400);
    expect(String(intento.body.error)).toMatch(/Piso libre/);

    // Y la corrida sigue abierta, sin `completed_at`: el intento no la toco.
    const queda = tp.sqlite.prepare('SELECT status, completed_at FROM runs WHERE id = ?').get(run.id) as {
      status: string;
      completed_at: string | null;
    };
    expect(queda.status).toBe('in_progress');
    expect(queda.completed_at).toBeNull();
  });

  it('respondidos los obligatorios, completar sella el done', async () => {
    const { plantilla } = await plantillaConItems(
      TEST_ORG_A,
      'Para completar',
      ['Extintor', 'Piso libre', 'EPP'],
      [3],
    );
    const { run } = await corridaDe(plantilla.id);
    await responder(run.id, 1, 'ok');
    await responder(run.id, 2, 'fail', 'Habia un charco de aceite');
    // El tercero era opcional: se puede dejar sin responder y la corrida cierra.
    const cerrada = await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`);

    expect(cerrada.status).toBe(200);
    expect(cerrada.body.run.status).toBe('done');
    expect(cerrada.body.run.completedAt).toBeTruthy();
    expect(cerrada.body.resumen.pendientes).toBe(1);
    expect(cerrada.body.resumen.pendientesRequeridos).toBe(0);
  });

  it('completar de nuevo es 409, y cambiar una respuesta de una corrida cerrada tambien', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Sellada', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);
    await responder(run.id, 1, 'ok');
    await responder(run.id, 2, 'na');
    await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`);

    expect((await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`)).status).toBe(409);
    const cambio = await responder(run.id, 1, 'fail');
    // Cerrada es un hecho. Cambiarlo en silencio es peor que escribirlo dos veces.
    expect(cambio.status).toBe(409);
    expect(String(cambio.body.error)).toMatch(/in_progress/);
  });

  it('el PATCH no es una puerta trasera a la regla de los obligatorios', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'No se firma en blanco', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    // Si el estado fuera un campo mas del CRUD, esto firmaria la inspeccion.
    const intento = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${run.id}`).send({ status: 'done' });
    expect(intento.status).toBe(400);
    expect(String(intento.body.error)).toMatch(/obligatorio/);

    const corrida = tp.sqlite.prepare('SELECT status FROM runs WHERE id = ?').get(run.id) as { status: string };
    expect(corrida.status).toBe('in_progress');
  });

  it('cancelar deja la corrida cancelada y sin completed_at', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'A medias', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);
    await responder(run.id, 1, 'ok');

    const cancelada = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${run.id}`).send({ status: 'canceled' });
    expect(cancelada.status).toBe(200);
    expect(cancelada.body.status).toBe('canceled');
    // Cancelada NO es completada: es la primera diferencia que se mira en una
    // auditoria, y por eso `completed_at` sigue en NULL.
    expect(cancelada.body.completedAt).toBeNull();
    expect(cancelada.body.location).toBeNull();

    // Cancelada no se completa: hay que reabrirla a proposito.
    expect((await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`)).status).toBe(409);
    const reabierta = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${run.id}`).send({ status: 'in_progress' });
    expect(reabierta.body.status).toBe('in_progress');
  });

  it('un PATCH parcial no borra lo que no se manda', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Edicion parcial', ['Uno']);
    const { run } = await corridaDe(plantilla.id, { location: 'Bodega 2', notes: 'Turno de manana' });

    const parche = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${run.id}`).send({ location: 'Bodega 3' });
    expect(parche.status).toBe(200);
    expect(parche.body.location).toBe('Bodega 3');
    expect(parche.body.notes).toBe('Turno de manana');
    expect(parche.body.status).toBe('in_progress');
  });

  it('el listado filtra por estado, por plantilla y por texto', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Buscable de corrida', ['Uno', 'Dos']);
    const abierta = await corridaDe(plantilla.id, { location: 'Deposito norte' });
    const cerrada = await corridaDe(plantilla.id, { location: 'Sucursal centro' });
    await responder(cerrada.run.id, 1, 'ok');
    await responder(cerrada.run.id, 2, 'na');
    await comoMiembro(TEST_ORG_A).post(`/api/runs/${cerrada.run.id}/completar`);

    const porEstado = await comoMiembro(TEST_ORG_A).get('/api/runs?status=done&limit=500');
    const ids = porEstado.body.items.map((r: any) => r.id);
    expect(ids).toContain(cerrada.run.id);
    expect(ids).not.toContain(abierta.run.id);

    const porPlantilla = await comoMiembro(TEST_ORG_A).get(
      `/api/runs?template_id=${plantilla.id}&limit=500`,
    );
    expect(porPlantilla.body.items.map((r: any) => r.id).sort()).toEqual(
      [abierta.run.id, cerrada.run.id].sort(),
    );

    for (const [termino, esperado] of [
      ['Buscable de corrida', cerrada.run.id],
      ['Sucursal', cerrada.run.id],
      ['Deposito', abierta.run.id],
    ] as Array<[string, string]>) {
      const busca = await comoMiembro(TEST_ORG_A).get(`/api/runs?q=${encodeURIComponent(termino)}&limit=500`);
      // La busqueda mira el nombre de la plantilla Y el lugar, asi que "Deposito"
      // tiene que encontrar la corrida abierta aunque su plantilla no lo diga.
      expect(busca.body.items.map((r: any) => r.id), `no encontro ${termino}`).toContain(esperado);
    }

    // Un estado que no existe se rechaza en vez de ignorarse.
    const raro = await comoMiembro(TEST_ORG_A).get('/api/runs?status=terminada');
    expect(raro.status).toBe(400);
  });

  it('borrar una corrida es de admin, y se lleva sus puntos', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Corrida de prueba', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    expect((await comoMiembro(TEST_ORG_A).delete(`/api/runs/${run.id}`)).status).toBe(403);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/runs/${run.id}`)).status).toBe(200);

    const puntos = tp.sqlite.prepare('SELECT count(*) c FROM run_items WHERE run_id = ?').get(run.id) as {
      c: number;
    };
    expect(puntos.c).toBe(0);
  });
});

// ─────────────────────────────────── el snapshot: el motivo del dominio

/**
 * Este bloque es el que justifica que el producto exista.
 *
 * La plantilla sigue viva y se sigue editando; la corrida es un hecho que ya
 * ocurrio. Si la corrida leyera la plantilla, editar la checklist de seguridad
 * MIERDE la historia: las inspecciones de marzo empezarian a mostrar un punto que
 * todavia no existia. La corrida tiene que ser una fotografia.
 */
describe('el snapshot: editar la plantilla no altera lo ya ejecutado', () => {
  it('agregar, renombrar y borrar puntos en la plantilla deja la corrida igual', async () => {
    const { plantilla, items } = await plantillaConItems(
      TEST_ORG_A,
      'Seguridad en obra',
      ['Arneses puestos', 'Cuerdas sin cortes', 'Zona demarcada'],
      [3],
    );
    const { run } = await corridaDe(plantilla.id, { location: 'Faena norte' });
    await responder(run.id, 1, 'ok');
    await responder(run.id, 2, 'fail', 'Cuerda con el alma expuesta');

    const antes = (await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`)).body;
    expect(antes.items.map((p: any) => p.position)).toEqual([1, 2, 3]);
    expect(antes.items.map((p: any) => p.result)).toEqual(['ok', 'fail', null]);

    // Ahora se cambia la plantilla en todas las formas que se puede.
    await comoMiembro(TEST_ORG_A).patch(`/api/templates/${plantilla.id}`).send({ name: 'Seguridad en obra v2' });
    await comoMiembro(TEST_ORG_A).post(`/api/templates/${plantilla.id}/items`).send({ label: 'Radio en la central' });
    await comoMiembro(TEST_ORG_A).delete(`/api/templates/${plantilla.id}/items/${items[0].id}`);

    const despues = (await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`)).body;
    // El nombre es el de ese dia, no el de hoy.
    expect(despues.run.templateName).toBe('Seguridad en obra');
    expect(despues.run.templateId).toBe(plantilla.id);
    // Los puntos son los de ese dia: ni el nuevo, ni el que se borro, ni el
    // renumerado. Y las respuestas siguen donde estaban.
    expect(despues.items.map((p: any) => p.position)).toEqual([1, 2, 3]);
    expect(despues.items.map((p: any) => p.label)).toEqual(['Arneses puestos', 'Cuerdas sin cortes', 'Zona demarcada']);
    expect(despues.items.map((p: any) => p.result)).toEqual(['ok', 'fail', null]);
    expect(JSON.parse(despues.run.templateItemsJson).map((p: any) => p.label)).toEqual([
      'Arneses puestos',
      'Cuerdas sin cortes',
      'Zona demarcada',
    ]);
    // Y el `required` del snapshot tampoco se mezcla con el de la plantilla de hoy.
    expect(JSON.parse(despues.run.templateItemsJson).map((p: any) => p.required)).toEqual([1, 1, 0]);
  });

  it('borrar la plantilla deja vivas las corridas, con su copia intacta', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Checklist que se retira', [
      'Uno',
      'Dos',
    ]);
    const { run } = await corridaDe(plantilla.id, { location: 'Bodega 2' });
    await responder(run.id, 1, 'ok');
    await responder(run.id, 2, 'na');
    await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`);

    // La plantilla se va porque dejo de usarse. La inspeccion ya firmada no se va
    // con ella: el `ON DELETE SET NULL` deja el enlace en NULL y la copia entera.
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/templates/${plantilla.id}`)).status).toBe(200);

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.run.templateId).toBeNull();
    expect(ficha.body.run.templateName).toBe('Checklist que se retira');
    expect(ficha.body.items.map((p: any) => p.label)).toEqual(['Uno', 'Dos']);
    expect(ficha.body.items.map((p: any) => p.result)).toEqual(['ok', 'na']);
    expect(ficha.body.snapshot.items).toHaveLength(2);
    // Y sigue siendo una corrida completada, con su resumen intacto.
    expect(ficha.body.run.status).toBe('done');
    expect(ficha.body.resumen.ok).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────── la ficha

describe('la ficha', () => {
  it('resume los puntos y calcula el cumplimiento con lo que se evaluo', async () => {
    const { plantilla } = await plantillaConItems(
      TEST_ORG_A,
      'Ficha resumida',
      ['Uno', 'Dos', 'Tres', 'Cuatro', 'Cinco'],
      [5],
    );
    const { run } = await corridaDe(plantilla.id);
    // 3 cumplen, 1 no cumple, 1 no aplica, 1 opcional sin responder.
    await responder(run.id, 1, 'ok');
    await responder(run.id, 2, 'ok');
    await responder(run.id, 3, 'ok');
    await responder(run.id, 4, 'fail', 'Sin equipo de proteccion');
    await responder(run.id, 5, 'na');

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.run.id).toBe(run.id);
    expect(ficha.body.resumen).toMatchObject({
      total: 5,
      ok: 3,
      fail: 1,
      na: 1,
      pendientes: 0,
      pendientesRequeridos: 0,
      // `na` no cuenta: 3 de 4 evaluados cumplen. Con `na` en el denominador
      // saldria 60% y una inspeccion "bien" pareceria mediocre.
      cumplimientoPct: 75,
    });
    // El snapshot vuelve parseado, para que la pantalla no desarme el JSON a mano.
    expect(ficha.body.snapshot.templateName).toBe('Ficha resumida');
    expect(ficha.body.snapshot.items[0]).toEqual({
      position: 1,
      label: 'Uno',
      required: 1,
      type: 'yes_no',
      options: null,
      section: 'General',
    });
  });

  it('una corrida sin responder nada no tiene cumplimiento, no cero', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Sin responder', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`);
    // Mostrarle 0% a una corrida recien empezada la haria ver como fallada.
    expect(ficha.body.resumen.cumplimientoPct).toBeNull();
    expect(ficha.body.resumen.pendientes).toBe(2);
    expect(ficha.body.resumen.pendientesRequeridos).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────── el tablero

/**
 * El tablero, sobre una base LIMPIA.
 *
 * No es descuido: sus numeros son sobre el TOTAL de lo que hay en la empresa
 * ("cuantas cerradas", "cumplimiento promedio"), y sobre la base compartida de
 * los tests de arriba la respuesta depende del orden en que corrieron. Con una base
 * limpia el numero que se espera es exacto y no "mayor que el anterior".
 */
describe('el tablero, sobre una base limpia', () => {
  let limpio: TestProduct;

  const admin = (orgId: string) => limpio.as({ orgId, role: 'admin' });
  const miembro = (orgId: string) => limpio.as({ orgId, role: 'member' });

  beforeAll(() => {
    limpio = startTestProduct(definicion);
  });

  afterAll(() => limpio.close());

  async function corridaLibre(name: string, resultado: string[], note?: string) {
    const creada = await miembro(TEST_ORG_A)
      .post('/api/runs')
      .send({ location: name, items: resultado.map((label) => ({ label })) });
    expect(creada.status, JSON.stringify(creada.body)).toBe(201);
    for (const [i, r] of resultado.entries()) {
      if (r) {
        const respuesta = await miembro(TEST_ORG_A)
          .post(`/api/runs/${creada.body.run.id}/items/${i + 1}`)
          .send({ result: r, note: i === 1 ? (note ?? null) : null });
        expect(respuesta.status, JSON.stringify(respuesta.body)).toBe(200);
      }
    }
    await miembro(TEST_ORG_A).post(`/api/runs/${creada.body.run.id}/completar`);
    return creada.body.run;
  }

  it('cuenta por estado y promedia el cumplimiento de las completadas', async () => {
    // Dos corridas cerradas: 2 de 3 cumple (66.7%) y 1 de 2 (50%). El promedio es
    // 58.3%.
    await corridaLibre('Deposito norte', ['ok', 'ok', 'fail'], 'Sin equipo de proteccion');
    await corridaLibre('Sucursal centro', ['ok', 'fail']);

    // Y una corrida abierta, que no debe entrar al promedio de cumplimiento pero
    // si al conteo por estado.
    const abierta = await miembro(TEST_ORG_A)
      .post('/api/runs')
      .send({ location: 'Faena sur', items: [{ label: 'Pendiente' }] });
    expect(abierta.status).toBe(201);

    const tablero = await admin(TEST_ORG_A).get('/api/dashboard');
    expect(tablero.status).toBe(200);
    // Los tres estados se responden siempre, aunque uno tenga cero: una tarjeta que
    // aparece y desaparece hace que la pantalla "salte".
    expect(tablero.body.porStatus).toHaveProperty('in_progress');
    expect(tablero.body.porStatus).toHaveProperty('done');
    expect(tablero.body.porStatus).toHaveProperty('canceled');
    expect(tablero.body.porStatus.in_progress).toBe(1);
    expect(tablero.body.porStatus.done).toBe(2);
    expect(tablero.body.porStatus.canceled).toBe(0);
    expect(tablero.body.total).toBe(3);
    expect(tablero.body.cumplimientoPromedioPct).toBe(58.3);
    expect(tablero.body.corridasCompletadasConsideradas).toBe(2);
  });

  it('trae los puntos fallados de las ultimas 10 corridas, y solo de esas', async () => {
    // Base propia: "las ultimas 10" se cuenta sobre el total, y sobre la base
    // compartida arriba dependeria de las corridas que dejaron los tests previos.
    const reciente = startTestProduct(definicion);
    const comoAdminLimpio = (orgId: string) => reciente.as({ orgId, role: 'admin' });
    const comoMiembroLimpio = (orgId: string) => reciente.as({ orgId, role: 'member' });

    try {
      // La corrida mas vieja lleva un fallo con un nombre propio: como hay 11
      // corridas, queda fuera de las 10 ultimas y su fallo no puede aparecer.
      const vieja = await comoMiembroLimpio(TEST_ORG_A).post('/api/runs').send({
        location: 'Antigua',
        startedAt: '2020-01-01T10:00:00.000Z',
        items: [{ label: 'Fallo de la corrida vieja' }, { label: 'Punto' }],
      });
      expect(vieja.status, JSON.stringify(vieja.body)).toBe(201);
      await comoMiembroLimpio(TEST_ORG_A).post(`/api/runs/${vieja.body.run.id}/items/1`).send({ result: 'fail' });
      await comoMiembroLimpio(TEST_ORG_A).post(`/api/runs/${vieja.body.run.id}/items/2`).send({ result: 'ok' });

      for (let i = 0; i < 10; i += 1) {
        const corrida = await comoMiembroLimpio(TEST_ORG_A).post('/api/runs').send({
          location: `Sitio ${i}`,
          startedAt: `2026-01-${String(i + 1).padStart(2, '0')}T12:00:00.000Z`,
          items: [{ label: `Punto del sitio ${i}` }, { label: 'Otro punto' }],
        });
        expect(corrida.status, JSON.stringify(corrida.body)).toBe(201);
        await comoMiembroLimpio(TEST_ORG_A)
          .post(`/api/runs/${corrida.body.run.id}/items/1`)
          .send({ result: 'fail', note: `Falla ${i}` });
        await comoMiembroLimpio(TEST_ORG_A).post(`/api/runs/${corrida.body.run.id}/items/2`).send({ result: 'ok' });
      }

      const tablero = await comoAdminLimpio(TEST_ORG_A).get('/api/dashboard');
      const fallos = tablero.body.fallos as Array<{ label: string; templateName: string; location: string; note: string }>;
      expect(fallos).toHaveLength(10);
      expect(fallos.map((f) => f.label)).not.toContain('Fallo de la corrida vieja');
      // Y el fallo viene con la corrida de la que salio, para no obligar a abrir
      // diez fichas para encontrarlo.
      expect(fallos[0].templateName).toBe('Corrida libre');
      expect(fallos[0].location).toBeTruthy();
      expect(fallos[0].note).toBeTruthy();
    } finally {
      reciente.close();
    }
  });

  it('el tablero de una empresa no cuenta lo de la otra', async () => {
    await miembro(TEST_ORG_B).post('/api/runs').send({ items: [{ label: 'De B' }] });
    const tableroA = await admin(TEST_ORG_A).get('/api/dashboard');
    const tableroB = await admin(TEST_ORG_B).get('/api/dashboard');

    expect(tableroB.body.total).toBe(1);
    // Si un tablero se llevara por delante corridas de la otra empresa, los conteos
    // sumarian mas que las filas que hay.
    const filas = limpio.sqlite.prepare('SELECT count(*) c FROM runs').get() as { c: number };
    expect(tableroA.body.total + tableroB.body.total).toBe(filas.c);
  });

  it('porResultado cuenta cada veredicto, y "sin" las corridas sin cerrar', async () => {
    const ventas = startTestProduct(definicion);
    const adminDe = (orgId: string) => ventas.as({ orgId, role: 'admin' });
    const miembroDe = (orgId: string) => ventas.as({ orgId, role: 'member' });

    try {
      async function cerrar(resultado: string[], veredicto?: string) {
        const creada = await miembroDe(TEST_ORG_A)
          .post('/api/runs')
          .send({ items: resultado.map((label) => ({ label })) });
        expect(creada.status, JSON.stringify(creada.body)).toBe(201);
        for (const [i, r] of resultado.entries()) {
          await miembroDe(TEST_ORG_A).post(`/api/runs/${creada.body.run.id}/items/${i + 1}`).send({ result: r });
        }
        const cuerpo: Record<string, unknown> = {};
        if (veredicto) cuerpo.result = veredicto;
        await miembroDe(TEST_ORG_A).post(`/api/runs/${creada.body.run.id}/completar`).send(cuerpo);
      }

      await cerrar(['ok', 'ok']); // approved (derivado)
      await cerrar(['ok', 'fail']); // observed (derivado)
      await cerrar(['ok', 'ok'], 'rejected'); // rejected (explícito)
      await miembroDe(TEST_ORG_A).post('/api/runs').send({ items: [{ label: 'Abierta' }] }); // sin cerrar

      const tablero = await adminDe(TEST_ORG_A).get('/api/dashboard');
      expect(tablero.status).toBe(200);
      expect(tablero.body.porResultado).toEqual({ approved: 1, observed: 1, rejected: 1, sin: 1 });
    } finally {
      ventas.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────── el enlace vivo

describe('el enlace con la plantilla', () => {
  it('los puntos de una corrida de plantilla guardan el item_id de su origen', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'Con origen', ['Uno', 'Dos']);
    const { run, items: puntos } = await corridaDe(plantilla.id);
    expect(puntos.map((p: any) => p.itemId)).toEqual([items[0].id, items[1].id]);

    // Una corrida libre no tiene original: su enlace queda NULL.
    const libre = await nuevaCorrida(TEST_ORG_A, { items: [{ label: 'Punto' }] });
    expect(libre.items.map((p: any) => p.itemId)).toEqual([null]);
  });

  it('borrar el item de la plantilla deja el enlace en NULL sin tocar la corrida', async () => {
    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'Enlace que se corta', ['Uno']);
    const { run } = await corridaDe(plantilla.id);

    const borrado = await comoMiembro(TEST_ORG_A).delete(`/api/templates/${plantilla.id}/items/${items[0].id}`);
    expect(borrado.status).toBe(200);

    // El enlace paso a NULL (ON DELETE SET NULL), pero la corrida sigue teniendo
    // su punto tal como estaba: el snapshot no depende del original.
    const fila = tp.sqlite.prepare('SELECT item_id FROM run_items WHERE run_id = ?').get(run.id) as {
      item_id: string | null;
    };
    expect(fila.item_id).toBeNull();
    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`);
    expect(ficha.body.items.map((p: any) => p.label)).toEqual(['Uno']);
  });
});

// ─────────────────────────────────────────────────────────────── las secciones

describe('las secciones', () => {
  it('crea la plantilla con sus secciones y numera de 1 a N dentro de cada una', async () => {
    const creada = await plantillaConSecciones(TEST_ORG_A, 'Obra con grupos', [
      { name: 'Seguridad', items: ['Arneses', 'Casco'] },
      { name: 'Equipos', items: ['Extintor'] },
    ]);

    expect(creada.sections.map((s: any) => s.sortOrder)).toEqual([1, 2]);
    // La posicion es DENTRO de la seccion: la segunda seccion empieza en 1.
    expect(creada.items.map((i: any) => i.position)).toEqual([1, 2, 1]);
    expect(creada.items.map((i: any) => i.sectionId)).toEqual([
      creada.sections[0].id,
      creada.sections[0].id,
      creada.sections[1].id,
    ]);
  });

  it('manda secciones o puntos sueltos, no los dos', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({
        name: 'Conflicto',
        sections: [{ name: 'A', items: [{ label: 'Uno' }] }],
        items: [{ label: 'Otro' }],
      });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/no los dos/);
  });

  it('estructura devuelve las secciones con sus puntos dentro', async () => {
    const creada = await plantillaConSecciones(TEST_ORG_A, 'Con estructura', [
      { name: 'Seguridad', items: ['Casco', 'Arnes'] },
      { name: 'Equipos', items: ['Extintor'] },
    ]);

    const res = await comoMiembro(TEST_ORG_A).get(`/api/templates/${creada.template.id}/estructura`);
    expect(res.status).toBe(200);
    expect(res.body.sections.map((s: any) => s.name)).toEqual(['Seguridad', 'Equipos']);
    expect(res.body.sections.map((s: any) => s.items.map((i: any) => i.label))).toEqual([
      ['Casco', 'Arnes'],
      ['Extintor'],
    ]);
    expect(res.body.sections[0].items.map((i: any) => i.position)).toEqual([1, 2]);
  });

  it('agregar una seccion la pone al final, y renombrarla no la mueve', async () => {
    const creada = await plantillaConSecciones(TEST_ORG_A, 'Con grupos', [
      { name: 'Seguridad', items: ['Uno'] },
    ]);

    const agregada = await comoMiembro(TEST_ORG_A)
      .post(`/api/templates/${creada.template.id}/sections`)
      .send({ name: 'Extintores' });
    expect(agregada.status).toBe(201);
    expect(agregada.body.sortOrder).toBe(2);

    const renombrada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/templates/${creada.template.id}/sections/${creada.sections[0].id}`)
      .send({ name: 'Proteccion personal' });
    expect(renombrada.status).toBe(200);
    expect(renombrada.body.name).toBe('Proteccion personal');
    expect(renombrada.body.sortOrder).toBe(1);
  });

  it('reordenar secciones renumera a 1..N, y exige listarlas todas', async () => {
    const creada = await plantillaConSecciones(TEST_ORG_A, 'Orden', [
      { name: 'A', items: ['uno'] },
      { name: 'B', items: ['dos'] },
      { name: 'C', items: ['tres'] },
    ]);
    const [a, b, c] = creada.sections.map((s: any) => s.id);

    const reordenada = await comoMiembro(TEST_ORG_A)
      .post(`/api/templates/${creada.template.id}/sections/ordenar`)
      .send({ order: [c, a, b] });
    expect(reordenada.status).toBe(200);
    expect(reordenada.body.sections.map((s: any) => s.sortOrder)).toEqual([1, 2, 3]);
    expect(reordenada.body.sections.map((s: any) => s.id)).toEqual([c, a, b]);

    // Listar de menos, repetir o inventar una seccion se rechaza: no se puede
    // "reordenar" sin decir donde queda cada bloque.
    expect(
      (await comoMiembro(TEST_ORG_A).post(`/api/templates/${creada.template.id}/sections/ordenar`).send({ order: [a, b] }))
        .status,
    ).toBe(400);
    expect(
      (
        await comoMiembro(TEST_ORG_A)
          .post(`/api/templates/${creada.template.id}/sections/ordenar`)
          .send({ order: [a, c, 'sec_inventada'] })
      ).status,
    ).toBe(400);
  });

  it('borrar una seccion se lleva sus puntos y renumera lo que queda', async () => {
    const creada = await plantillaConSecciones(TEST_ORG_A, 'Borrar bloque', [
      { name: 'A', items: ['a1', 'a2'] },
      { name: 'B', items: ['b1'] },
      { name: 'C', items: ['c1'] },
    ]);
    const seccionB = creada.sections[1].id;

    const borrado = await comoMiembro(TEST_ORG_A).delete(
      `/api/templates/${creada.template.id}/sections/${seccionB}`,
    );
    expect(borrado.status).toBe(200);
    expect(borrado.body.sections.map((s: any) => s.sortOrder)).toEqual([1, 2]);
    expect(borrado.body.sections.map((s: any) => s.name)).toEqual(['A', 'C']);

    const puntosDeB = tp.sqlite.prepare('SELECT count(*) c FROM template_items WHERE section_id = ?').get(seccionB) as {
      c: number;
    };
    expect(puntosDeB.c).toBe(0);
    const orden = tp.sqlite
      .prepare('SELECT sort_order FROM sections WHERE template_id = ? ORDER BY sort_order')
      .all(creada.template.id) as Array<{ sort_order: number }>;
    expect(orden.map((s) => s.sort_order)).toEqual([1, 2]);
  });

  it('agregar un punto con sectionId lo pone en esa seccion; sin el, en la primera', async () => {
    const creada = await plantillaConSecciones(TEST_ORG_A, 'Suma a una seccion', [
      { name: 'A', items: ['uno'] },
      { name: 'B', items: [] },
    ]);

    const aB = await comoMiembro(TEST_ORG_A)
      .post(`/api/templates/${creada.template.id}/items`)
      .send({ label: 'punto de B', sectionId: creada.sections[1].id });
    expect(aB.status).toBe(201);
    expect(aB.body.position).toBe(1);
    expect(aB.body.sectionId).toBe(creada.sections[1].id);

    const aA = await comoMiembro(TEST_ORG_A)
      .post(`/api/templates/${creada.template.id}/items`)
      .send({ label: 'cualquiera' });
    expect(aA.status).toBe(201);
    expect(aA.body.sectionId).toBe(creada.sections[0].id);
  });

  it('las secciones de otra empresa no se ven ni se tocan desde aca', async () => {
    const a = await plantillaConSecciones(TEST_ORG_A, 'De A con grupos', [{ name: 'Seguridad', items: ['Casco'] }]);
    const plantillaA = a.template.id;
    const seccionA = a.sections[0].id;

    expect((await comoMiembro(TEST_ORG_B).get(`/api/templates/${plantillaA}/estructura`)).status).toBe(404);
    expect(
      (
        await comoMiembro(TEST_ORG_B).post(`/api/templates/${plantillaA}/items`).send({ label: 'Intruso', sectionId: seccionA })
      ).status,
    ).toBe(404);
    expect(
      (
        await comoMiembro(TEST_ORG_B).post(`/api/templates/${plantillaA}/sections/ordenar`).send({ order: [seccionA] })
      ).status,
    ).toBe(404);
    expect((await comoMiembro(TEST_ORG_B).delete(`/api/templates/${plantillaA}/sections/${seccionA}`)).status).toBe(404);
    expect(
      (await comoMiembro(TEST_ORG_B).post(`/api/templates/${plantillaA}/sections`).send({ name: 'Intrusa' })).status,
    ).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────── los tipos

describe('los tipos de punto', () => {
  it('un select sin opciones se rechaza, y un PATCH a select sin opciones tambien', async () => {
    const mal = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({ name: 'Select roto', items: [{ label: 'Elige', type: 'select' }] });
    expect(mal.status).toBe(400);
    expect(String(mal.body.error)).toMatch(/opcion/);

    const { plantilla, items } = await plantillaConItems(TEST_ORG_A, 'Select a corregir', ['Uno']);
    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/templates/${plantilla.id}/items/${items[0].id}`)
      .send({ type: 'select' });
    expect(parche.status).toBe(400);

    // Y vaciarlas a proposito en un select existente tambien es 400.
    const conOpciones = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({ name: 'Select con opciones', items: [{ label: 'Zona', type: 'select', options: ['A', 'B'] }] });
    const id = conOpciones.body.items[0].id;
    expect(
      (
        await comoMiembro(TEST_ORG_A)
          .patch(`/api/templates/${conOpciones.body.template.id}/items/${id}`)
          .send({ options: [] })
      ).status,
    ).toBe(400);
  });

  it('cada tipo se responde segun su forma, y el select valida contra el snapshot', async () => {
    const creada = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({
        name: 'Tipada',
        sections: [
          {
            name: 'General',
            items: [
              { label: 'Seguro (si/no)', type: 'yes_no' },
              { label: 'Observacion', type: 'text' },
              { label: 'Temperatura', type: 'number' },
              { label: 'Zona', type: 'select', options: ['A', 'B', 'C'] },
            ],
          },
        ],
      });
    expect(creada.status).toBe(201);
    const { run } = await corridaDe(creada.body.template.id);
    const puntos = (id: number) => `/api/runs/${run.id}/items/${id}`;

    expect((await comoMiembro(TEST_ORG_A).post(puntos(1)).send({ result: 'ok' })).status).toBe(200);
    // El texto es una respuesta: en los no-sí/no se responde con `value_text`.
    expect((await comoMiembro(TEST_ORG_A).post(puntos(2)).send({ valueText: 'El cable pelado' })).status).toBe(200);
    expect((await comoMiembro(TEST_ORG_A).post(puntos(3)).send({ valueText: '22.5' })).status).toBe(200);
    expect((await comoMiembro(TEST_ORG_A).post(puntos(4)).send({ valueText: 'A' })).status).toBe(200);
    // Una opcion que no estaba en el snapshot es 400, aunque la plantilla hoy
    // tuviera otras: la corrida elige de la lista de ese dia.
    expect((await comoMiembro(TEST_ORG_A).post(puntos(4)).send({ valueText: 'Z' })).status).toBe(400);

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`);
    expect(ficha.body.items.map((p: any) => p.valueText)).toEqual([null, 'El cable pelado', '22.5', 'A']);
    expect(ficha.body.items.map((p: any) => p.result)).toEqual(['ok', null, null, null]);
  });

  it('responder mal el tipo es 400', async () => {
    const creada = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({ name: 'Mal respondida', items: [{ label: 'Texto', type: 'text' }] });
    const { run } = await corridaDe(creada.body.template.id);

    // Un `text` no se responde con `result`: necesita su `value_text`.
    expect((await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/items/1`).send({ result: 'ok' })).status).toBe(400);

    const numerica = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({ name: 'Numerica', items: [{ label: 'Cantidad', type: 'number' }] });
    const { run: runN } = await corridaDe(numerica.body.template.id);
    expect(
      (await comoMiembro(TEST_ORG_A).post(`/api/runs/${runN.id}/items/1`).send({ valueText: 'veintidos' })).status,
    ).toBe(400);
  });

  it('un texto obligatorio sin responder no deja completar', async () => {
    const creada = await comoMiembro(TEST_ORG_A)
      .post('/api/templates')
      .send({ name: 'Texto obligatorio', items: [{ label: 'Escribe la falla', type: 'text' }] });
    const { run } = await corridaDe(creada.body.template.id);

    const intento = await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`);
    expect(intento.status).toBe(400);
    expect(String(intento.body.error)).toMatch(/Escribe la falla/);

    // Respondido, cierra normal.
    await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/items/1`).send({ valueText: 'ok, quedaba bien' });
    expect((await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`)).status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────── el veredicto global

describe('el veredicto global', () => {
  it('al completar se deriva lo minimo si no se manda: observado si fallo algo', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Deriva', ['Uno', 'Dos']);

    const conFalla = await corridaDe(plantilla.id);
    await responder(conFalla.run.id, 1, 'ok');
    await responder(conFalla.run.id, 2, 'fail');
    expect((await comoMiembro(TEST_ORG_A).post(`/api/runs/${conFalla.run.id}/completar`)).body.run.result).toBe('observed');

    const sinFalla = await corridaDe(plantilla.id);
    await responder(sinFalla.run.id, 1, 'ok');
    await responder(sinFalla.run.id, 2, 'ok');
    expect((await comoMiembro(TEST_ORG_A).post(`/api/runs/${sinFalla.run.id}/completar`)).body.run.result).toBe('approved');
  });

  it('un veredicto explicito manda, incluido el rechazo', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Explicito', ['Uno', 'Dos']);
    const { run } = await corridaDe(plantilla.id);
    await responder(run.id, 1, 'ok');
    await responder(run.id, 2, 'ok');

    // rechazar no es algo que la API adivine: es un juicio y se escribe.
    const cerrada = await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`).send({ result: 'rejected' });
    expect(cerrada.status).toBe(200);
    expect(cerrada.body.run.result).toBe('rejected');
  });

  it('el veredicto no se escribe en una corrida abierta, y corregir el de una cerrada si', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Veredicto movible', ['Uno', 'Dos']);

    // Firmar el veredicto de una corrida que sigue abierta dejaba al tablero
    // contando una inspeccion cerrada con `status: in_progress`.
    const abierta = await corridaDe(plantilla.id);
    await responder(abierta.run.id, 1, 'ok');
    await responder(abierta.run.id, 2, 'ok');
    const intento = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${abierta.run.id}`).send({ result: 'approved' });
    expect(intento.status).toBe(400);
    expect((await comoMiembro(TEST_ORG_A).get(`/api/runs/${abierta.run.id}/ficha`)).body.run.result).toBeNull();

    // Cerrada la corrida, el veredicto se deriva de las respuestas.
    const cerrada = await comoMiembro(TEST_ORG_A).post(`/api/runs/${abierta.run.id}/completar`);
    expect(cerrada.body.run.result).toBe('approved');

    // Y ahora si se puede corregir el juicio equivocado, sin reabrir.
    const corregida = await comoMiembro(TEST_ORG_A)
      .patch(`/api/runs/${abierta.run.id}`)
      .send({ result: 'rejected' });
    expect(corregida.status).toBe(200);
    expect(corregida.body.result).toBe('rejected');
    expect(corregida.body.status).toBe('done');
  });

  it('cerrar por PATCH deriva el veredicto de las respuestas', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Derivado por PATCH', ['Uno', 'Dos']);
    const derivada = await corridaDe(plantilla.id);
    await responder(derivada.run.id, 1, 'fail');
    await responder(derivada.run.id, 2, 'ok');
    const porPatch = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${derivada.run.id}`).send({ status: 'done' });
    expect(porPatch.body.result).toBe('observed');
    expect(porPatch.body.status).toBe('done');
  });

  it('reabrir quita el veredicto y desella completed_at', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Reabre', ['Uno']);
    const { run } = await corridaDe(plantilla.id);
    await responder(run.id, 1, 'ok');
    await comoMiembro(TEST_ORG_A).post(`/api/runs/${run.id}/completar`);

    const reabierta = await comoMiembro(TEST_ORG_A).patch(`/api/runs/${run.id}`).send({ status: 'in_progress' });
    expect(reabierta.body.status).toBe('in_progress');
    expect(reabierta.body.result).toBeNull();
    expect(reabierta.body.completedAt).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────── el responsable

describe('el responsable', () => {
  it('performed_by es la foto del nombre de la sesion que empieza la corrida', async () => {
    const { run } = await nuevaCorrida(TEST_ORG_A, { items: [{ label: 'Punto' }] });
    expect(run.performedBy).toBe('Persona de Prueba');

    const porMaria = await tp.as({ orgId: TEST_ORG_A, name: 'Maria Perez' }).post('/api/runs').send({
      items: [{ label: 'Otro punto' }],
    });
    expect(porMaria.body.run.performedBy).toBe('Maria Perez');

    // Y una corrida desde plantilla tambien lleva el nombre de quien la empezo.
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Con responsable', ['Uno']);
    const conPlantilla = await (tp.as({ orgId: TEST_ORG_A, name: 'Otro' }) as any).post('/api/runs').send({
      templateId: plantilla.id,
    });
    expect(conPlantilla.body.run.performedBy).toBe('Otro');
  });
});

// ─────────────────────────────────────────────────────────────────── los adjuntos

describe('los adjuntos', () => {
  it('sube, sirve y borra un archivo de la corrida', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Con adjuntos', ['Uno']);
    const { run } = await corridaDe(plantilla.id);

    const contenido = 'acta de la inspeccion';
    const subida = await comoMiembro(TEST_ORG_A)
      .post(`/api/runs/${run.id}/attachments`)
      .send({ filename: 'acta.txt', mimeType: 'text/plain', data: Buffer.from(contenido).toString('base64') });
    expect(subida.status, JSON.stringify(subida.body)).toBe(201);
    expect(subida.body.attachment.id).toBeTruthy();
    expect(subida.body.attachment.sizeBytes).toBe(contenido.length);
    expect(subida.body.url).toContain(subida.body.attachment.id);

    // La ficha la lista con su enlace, para no buscarla a mano.
    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`);
    expect(ficha.body.attachments).toHaveLength(1);
    expect(ficha.body.attachments[0].filename).toBe('acta.txt');

    const descarga = await comoMiembro(TEST_ORG_A).get(subida.body.url);
    expect(descarga.status).toBe(200);
    // El tipo servido no es el que subio el cliente, y siempre con `nosniff`.
    expect(descarga.headers['content-type']).toBe('application/octet-stream');
    expect(descarga.headers['x-content-type-options']).toBe('nosniff');
    // Al servirse como binario, supertest lo deja en `.body` y no en `.text`.
    expect(Buffer.from(descarga.body).toString('utf8')).toBe(contenido);

    const borrado = await comoMiembro(TEST_ORG_A).delete(
      `/api/runs/${run.id}/attachments/${subida.body.attachment.id}`,
    );
    expect(borrado.status).toBe(200);
    expect((await comoMiembro(TEST_ORG_A).get(subida.body.url)).status).toBe(404);
    expect((await comoMiembro(TEST_ORG_A).get(`/api/runs/${run.id}/ficha`)).body.attachments).toHaveLength(0);
  });

  it('un archivo de mas de 750 KB es 413', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Adjunto pesado', ['Uno']);
    const { run } = await corridaDe(plantilla.id);

    const data = Buffer.alloc(750_100).toString('base64');
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/runs/${run.id}/attachments`)
      .send({ filename: 'pesado.bin', mimeType: 'application/octet-stream', data });
    expect(res.status).toBe(413);
    expect(String(res.body.error)).toMatch(/750/);

    // Y el intento no dejo nada en la base.
    const filas = tp.sqlite
      .prepare('SELECT count(*) c FROM attachments WHERE run_id = ?')
      .get(run.id) as { c: number };
    expect(filas.c).toBe(0);
  });

  it('los adjuntos de una empresa no se sirven desde otra', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Adjunto de A', ['Uno']);
    const { run } = await corridaDe(plantilla.id);
    const subida = await comoMiembro(TEST_ORG_A)
      .post(`/api/runs/${run.id}/attachments`)
      .send({ filename: 'solo-de-a.txt', data: Buffer.from('secreto de A').toString('base64') });

    expect((await comoMiembro(TEST_ORG_B).get(subida.body.url)).status).toBe(404);
    expect(
      (await comoMiembro(TEST_ORG_B).delete(`/api/runs/${run.id}/attachments/${subida.body.attachment.id}`)).status,
    ).toBe(404);
  });

  it('borrar la corrida se lleva sus filas de adjuntos', async () => {
    const { plantilla } = await plantillaConItems(TEST_ORG_A, 'Adjuntos que se van', ['Uno']);
    const { run } = await corridaDe(plantilla.id);
    await comoMiembro(TEST_ORG_A)
      .post(`/api/runs/${run.id}/attachments`)
      .send({ filename: 'paper.png', data: Buffer.from('img').toString('base64') });

    expect((await comoAdmin(TEST_ORG_A).delete(`/api/runs/${run.id}`)).status).toBe(200);
    const filas = tp.sqlite
      .prepare('SELECT count(*) c FROM attachments WHERE run_id = ?')
      .get(run.id) as { c: number };
    expect(filas.c).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────── los ajustes

describe('los ajustes', () => {
  it('se guardan una sola vez por organizacion', async () => {
    const org = TEST_ORG_B;
    const primera = await comoAdmin(org).put('/api/settings').send({ timezone: 'America/Santiago', currency: '$' });
    expect(primera.status).toBe(200);

    const segunda = await comoAdmin(org).put('/api/settings').send({ timezone: 'America/Mexico_City', currency: 'MXN' });
    expect(segunda.status).toBe(200);

    const leidos = await comoAdmin(org).get('/api/settings');
    expect(leidos.body.settings.timezone).toBe('America/Mexico_City');
    expect(leidos.body.settings.currency).toBe('MXN');
    expect(leidos.body.settings.organizationId).toBe(TEST_ORG_B);
    // El indice unico de `settings` es lo que impide que queden dos filas
    // compitiendo por la misma empresa.
    const filas = tp.sqlite.prepare('SELECT count(*) c FROM settings WHERE organization_id = ?').get(org) as {
      c: number;
    };
    expect(filas.c).toBe(1);
  });

  it('un miembro no cambia la moneda ni la zona horaria de la empresa', async () => {
    // Si un miembro la cambiara, la hora a la que se ve cada corrida se moveria
    // para toda la gente a la vez.
    const res = await comoMiembro(TEST_ORG_B).put('/api/settings').send({ timezone: 'Europe/Lisbon' });
    expect(res.status).toBe(403);
  });

  it('rechaza una zona horaria que no existe', async () => {
    const res = await comoAdmin(TEST_ORG_A).put('/api/settings').send({ timezone: 'Marte/Olympus' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Zona horaria/);
  });
});

// ─────────────────────────────────────────────────── el contrato del frontend

describe('el contrato del frontend', () => {
  it('el form de ajustes vive en el bundle y los estaticos viejos ya no', async () => {
    const js = await bundle();
    expect(js).toContain('config-form');
    expect(js).toContain('name:"currency"');
    expect(js).toContain('name:"timezone"');

    // Y nadie pide los estaticos del legacy: si un cache viejo o un link
    // externo los reclaman, tienen que caer a 404, no a un JS con bugs.
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).not.toContain('/app.js');
    expect(html.text).not.toContain('/style.css');
    expect((await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).status).toBe(404);
    expect((await tp.as({ orgId: TEST_ORG_A }).get('/style.css')).status).toBe(404);
  });

  it('la UI no consulta ids que ni el HTML ni el JS definen', async () => {
    // El bug que este test evita: un listener de nivel superior sobre un id que
    // no existe revienta ANTES del bootstrap y deja la app entera en blanco, sin
    // que se vea en ningun error de red. El bundle nuevo no usa selectores de
    // jQuery: consulta ids con getElementById, y el unico que usa es root, que
    // el HTML si define.
    const html = (await tp.as({ orgId: TEST_ORG_A }).get('/')).text;
    const js = await bundle();
    const definidos = new Set([
      ...[...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
      ...[...js.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]),
    ]);
    const consultados = [
      ...[...js.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
      ...[...js.matchAll(/\$\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g)].map((m) => m[1]),
    ];
    const huerfanos = consultados.filter((id) => !definidos.has(id));
    expect(huerfanos, `la UI consulta #${huerfanos.join(', #')} pero nadie lo define`).toEqual([]);
  });
});
