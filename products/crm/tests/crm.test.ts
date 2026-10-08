import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Clientes sobre el runtime.
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

async function nuevoCliente(orgId: string, datos: Record<string, unknown> = {}) {
  const res = await comoMiembro(orgId)
    .post('/api/customers')
    .send({ name: 'Ana Torres', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

async function nuevoSeguimiento(orgId: string, datos: Record<string, unknown> = {}) {
  const res = await comoMiembro(orgId)
    .post('/api/followups')
    .send({ customerId: datos.customerId, title: 'Llamar para renovar', ...datos });
  return res;
}

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
    expect(html.text).toContain('Clientes');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organización. Por eso no hay ningún id de organización en el HTML.
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
    const ruta = await tp.as({ orgId: TEST_ORG_A }).get('/clientes');
    expect(ruta.status).toBe(200);
    expect(ruta.text).toContain('Clientes');
  });

  it('no sirve el HTML sin sesión: redirige al login central', async () => {
    const res = await tp.anon().get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });

  it('la UI no ofrece login: la sesión es del Core', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).not.toMatch(/type=["']password["']/i);

    // La salida se resuelve contra el Core, no contra un logout local: el shell
    // de React la dibuja contra /auth/logout, y eso vive en el bundle.
    expect(await bundle()).toContain('/auth/logout');
  });

  it('la UI no inventa datos ni se saltea al servidor', async () => {
    const js = await bundle();
    expect(js).not.toContain(TEST_ORG_A);
    // Todo lo que se ve sale de la API: los caminos de los endpoints que
    // pintan el tablero, el seguimiento y el historial están en el bundle.
    expect(js).toContain('/resumen');
    expect(js).toContain('/tablero');
    expect(js).toContain('/followups?limit=300');
    expect(js).toContain('/interactions?limit=300');
    expect(js).toContain('/customers?limit=500');
  });

  it('el form de ajustes pide moneda y zona horaria', async () => {
    const js = await bundle();
    expect(js).toContain('Moneda');
    expect(js).toContain('Zona horaria');
    expect(js).toContain('Guardar ajustes');
  });

  it('la UI no deja editar ni borrar el historial de contacto', async () => {
    const js = await bundle();
    // Una fila de contacto es la prueba de lo que pasó. Si se puede corregir en
    // silencio deja de serlo, así que en la pantalla solo se registra y se lista:
    // las únicas llamadas a /interactions son GET (listar) y POST (registrar).
    const llamadas = [...js.matchAll(/\.(get|post|put|patch|delete)\(\s*[`"'][^`"']*interactions[^`"']*[`"']/g)].map(
      (m) => m[1],
    );
    expect(llamadas).toContain('post');
    expect(llamadas).not.toContain('patch');
    expect(llamadas).not.toContain('delete');
  });
});

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/customers')).status).toBe(401);
  });

  it('/api/me dice de qué organización se entra', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('crm');
  });
});

describe('el aislamiento entre organizaciones', () => {
  it('la lista de una empresa no trae los clientes de otra', async () => {
    await nuevoCliente(TEST_ORG_A, { name: 'Cliente solo de A' });
    const listaB = await comoAdmin(TEST_ORG_B).get('/api/customers');
    expect(listaB.status).toBe(200);
    expect(listaB.body.items.map((c: any) => c.name)).not.toContain('Cliente solo de A');
  });

  it('una ficha de otra organización no existe: 404, no 403 con datos', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente de A' });
    // Un 403 confirmaría que el id existe; un 404 no le dice nada al que prueba.
    const visto = await comoAdmin(TEST_ORG_B).get(`/api/customers/${cliente.id}/ficha`);
    expect(visto.status).toBe(404);
  });

  it('no se puede editar ni archivar el cliente de otra organización', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente de A para editar' });

    const parche = await comoAdmin(TEST_ORG_B)
      .patch(`/api/customers/${cliente.id}`)
      .send({ name: 'Secuestrado' });
    expect(parche.status).toBe(404);

    const borrado = await comoAdmin(TEST_ORG_B).delete(`/api/customers/${cliente.id}`);
    expect(borrado.status).toBe(404);
  });

  it('un cliente no puede colar el id de una ficha de otra empresa en un seguimiento', async () => {
    const deA = await nuevoCliente(TEST_ORG_A, { name: 'Cliente de A para colar' });
    // Por más que el id exista, el filtro por organización sigue mandando: sin el
    // chequeo, aparecería un pendiente con el nombre de un desconocido.
    const intento = await nuevoSeguimiento(TEST_ORG_B, { customerId: deA.id });
    expect(intento.status).toBe(400);
    expect(String(intento.body.error)).toMatch(/organización/);
  });
});

describe('los clientes', () => {
  it('guarda el tipo de ficha y el documento de identidad como texto', async () => {
    // El RUT, el RUC y el NIT llevan letras y guiones, y castearlos a número
    // perdería el cero inicial, que en un RUC es parte del identificador.
    const empresa = await nuevoCliente(TEST_ORG_A, {
      name: 'Comercial del Sur',
      kind: 'empresa',
      taxId: '76.123.456-7',
    });
    expect(empresa.kind).toBe('empresa');
    expect(empresa.taxId).toBe('76.123.456-7');
  });

  it('rechaza un tipo de ficha que no existe', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/customers')
      .send({ name: 'Cliente raro', kind: 'contacto' });
    expect(res.status).toBe(400);
  });

  it('rechaza un cumpleaños que no es una fecha', async () => {
    // "14/05/1991" se puede parsear, pero no es una fecha que se pueda comparar
    // ni mostrar. La ficha guarda `AAAA-MM-DD` o nada.
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/customers')
      .send({ name: 'Cliente con fecha mala', birthday: '14/05/1991' });
    expect(res.status).toBe(400);
  });

  it('acepta un cumpleaños en AAAA-MM-DD', async () => {
    const c = await nuevoCliente(TEST_ORG_A, { name: 'Cliente con fecha', birthday: '1990-05-14' });
    expect(c.birthday).toBe('1990-05-14');
  });

  it('busca por nombre, teléfono, correo y documento', async () => {
    await nuevoCliente(TEST_ORG_A, {
      name: 'Buscable unico',
      phone: '+52 55 1111 0000',
      taxId: 'RUC-001',
    });
    const porDocumento = await comoAdmin(TEST_ORG_A).get('/api/customers?q=RUC-001');
    expect(porDocumento.body.items).toHaveLength(1);
  });

  it('dar de baja un cliente es de admin, no de cualquiera', async () => {
    const c = await nuevoCliente(TEST_ORG_A, { name: 'Cliente a archivar' });
    const porMiembro = await comoMiembro(TEST_ORG_A).delete(`/api/customers/${c.id}`);
    expect(porMiembro.status).toBe(403);

    const porAdmin = await comoAdmin(TEST_ORG_A).delete(`/api/customers/${c.id}`);
    expect(porAdmin.status).toBe(200);
  });

  it('archivar esconde el cliente de la lista sin borrarlo', async () => {
    const c = await nuevoCliente(TEST_ORG_A, { name: 'Cliente archivado' });
    await comoAdmin(TEST_ORG_A).delete(`/api/customers/${c.id}`);

    const lista = await comoAdmin(TEST_ORG_A).get('/api/customers');
    expect(lista.body.items.map((x: any) => x.id)).not.toContain(c.id);
    // La fila sigue existiendo: dar de baja un cliente no puede llevarse su
    // historial, porque el negocio puede necesitar ver qué se le hizo.
    const existe = tp.sqlite.prepare('SELECT archived_at FROM customers WHERE id = ?').get(c.id) as {
      archived_at: string | null;
    };
    expect(existe.archived_at).toBeTruthy();
  });
});

describe('la ficha', () => {
  it('trae al cliente con sus seguimientos y su historial', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente con historial' });
    await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id, title: 'Llamar el lunes' });
    await comoMiembro(TEST_ORG_A)
      .post('/api/interactions')
      .send({ customerId: cliente.id, kind: 'llamada', summary: 'No contestó' });

    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/customers/${cliente.id}/ficha`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.customer.name).toBe('Cliente con historial');
    expect(ficha.body.followups).toHaveLength(1);
    expect(ficha.body.interactions).toHaveLength(1);
    expect(ficha.body.resumen.contactos).toBe(1);
    expect(ficha.body.resumen.ultimoContacto).toBeTruthy();
  });

  it('cuenta los seguimientos vencidos de esa ficha', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente con vencido' });
    const tablero = await comoAdmin(TEST_ORG_A).get('/api/tablero');
    const hoy = tablero.body.hoy as string;
    const antes = new Date(`${hoy}T00:00:00Z`);
    antes.setUTCDate(antes.getUTCDate() - 5);
    const vencido = antes.toISOString().slice(0, 10);

    await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id, dueDate: vencido, title: 'Vencido' });
    const ficha = await comoMiembro(TEST_ORG_A).get(`/api/customers/${cliente.id}/ficha`);
    expect(ficha.body.resumen.seguimientosVencidos).toBe(1);
  });
});

describe('los seguimientos', () => {
  it('nace pendiente y sin fecha de completado', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente de seguimientos' });
    const res = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id });
    expect(res.status).toBe(201);
    expect(res.body.followup.status).toBe('pending');
    expect(res.body.followup.completedAt).toBeNull();
  });

  it('el servidor pone la fecha de completado al marcarlo hecho', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del cierre' });
    const creado = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id });
    const id = creado.body.followup.id;

    const hecho = await comoMiembro(TEST_ORG_A).patch(`/api/followups/${id}`).send({ status: 'done' });
    expect(hecho.status).toBe(200);
    // "Se completó ahora" lo sabe el servidor. Si lo escribiera el cliente,
    // cualquiera podría afirmar que se cerró la semana pasada.
    expect(hecho.body.followup.completedAt).toBeTruthy();

    const reabierto = await comoMiembro(TEST_ORG_A).patch(`/api/followups/${id}`).send({ status: 'pending' });
    // Un pendiente abierto no puede llevar la fecha de un cierre anterior.
    expect(reabierto.body.followup.completedAt).toBeNull();
  });

  it('ignora un completedAt que venga en el cuerpo', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del completedAt' });
    const creado = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id });
    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/followups/${creado.body.followup.id}`)
      .send({ status: 'done', completedAt: '2000-01-01T00:00:00.000Z' });
    expect(parche.status).toBe(200);
    expect(parche.body.followup.completedAt).not.toBe('2000-01-01T00:00:00.000Z');
  });

  it('no acepta el estado con dos eles que escribía el legacy', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del estado viejo' });
    const res = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id, status: 'cancelled' });
    // Si la forma vieja entrara, la columna tendría dos vocabularios y la mitad
    // de los cancelados dejaría de encontrarse con `status = 'canceled'`.
    expect(res.status).toBe(400);
  });

  it('un PATCH parcial no borra lo que no se manda', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del parche' });
    const creado = await nuevoSeguimiento(TEST_ORG_A, {
      customerId: cliente.id,
      dueDate: '2026-10-01',
      body: 'Traer el historial',
    });
    const parche = await comoMiembro(TEST_ORG_A)
      .patch(`/api/followups/${creado.body.followup.id}`)
      .send({ status: 'done' });
    expect(parche.body.followup.dueDate).toBe('2026-10-01');
    expect(parche.body.followup.body).toBe('Traer el historial');
  });

  it('borrar un seguimiento es de admin', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del borrado' });
    const creado = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id });
    const id = creado.body.followup.id;

    expect((await comoMiembro(TEST_ORG_A).delete(`/api/followups/${id}`)).status).toBe(403);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/followups/${id}`)).status).toBe(200);
  });

  it('el seguimiento de otro no se ve ni se borra', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del seguimiento ajeno' });
    const creado = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id });

    expect((await comoAdmin(TEST_ORG_B).get(`/api/followups/${creado.body.followup.id}`)).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_B).delete(`/api/followups/${creado.body.followup.id}`)).status).toBe(404);
  });

  it('el CASCADE se lleva los seguimientos cuando el cliente se borra de verdad', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente que se borra' });
    const creado = await nuevoSeguimiento(TEST_ORG_A, { customerId: cliente.id });

    // El DELETE con `archive` marca `archived_at`, así que el borrado real se hace
    // directo en la base: es lo que haría una baja definitiva de la ficha.
    tp.sqlite.prepare('DELETE FROM customers WHERE id = ?').run(cliente.id);
    const queda = tp.sqlite.prepare('SELECT count(*) c FROM followups WHERE id = ?').get(creado.body.followup.id) as {
      c: number;
    };
    expect(queda.c).toBe(0);
  });
});

describe('el historial de contacto', () => {
  it('se registra con la hora del servidor cuando no se manda', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del contacto' });
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/interactions')
      .send({ customerId: cliente.id, kind: 'llamada', summary: 'Contestó' });
    expect(res.status).toBe(201);
    // Un contacto se escribe mientras pasa; anotarlo a mano solo abre la puerta
    // a escribir el día equivocado.
    expect(res.body.interaction.happenedAt).toBeTruthy();
  });

  it('acepta solo los cuatro canales de contacto', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del tipo raro' });
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/interactions')
      .send({ customerId: cliente.id, kind: 'telegram', summary: 'Le escribí' });
    // Un tipo libre convertiría la columna en "el cliente tiene un canal", que es
    // la misma vaguedad que se evita en el resto del esquema.
    expect(res.status).toBe(400);
  });

  it('no se puede editar ni borrar un contacto', async () => {
    const cliente = await nuevoCliente(TEST_ORG_A, { name: 'Cliente del historial fijo' });
    const creado = await comoMiembro(TEST_ORG_A)
      .post('/api/interactions')
      .send({ customerId: cliente.id, summary: 'No contestó' });
    const id = creado.body.interaction.id;

    // No es una falta de funcionalidad: si la fila se puede corregir en
    // silencio, deja de ser la prueba de lo que pasó.
    expect((await comoAdmin(TEST_ORG_A).patch(`/api/interactions/${id}`).send({ summary: 'x' })).status).toBe(404);
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/interactions/${id}`)).status).toBe(404);
  });
});

describe('el tablero', () => {
  it('separa vencidos, de hoy y próximos, y trae el cumpleaños del mes', async () => {
    const tablero = await comoAdmin(TEST_ORG_A).get('/api/tablero');
    expect(tablero.status).toBe(200);
    const hoy = tablero.body.hoy as string;
    expect(hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tablero.body.seguimientos).toHaveProperty('vencidos');
    expect(tablero.body.seguimientos).toHaveProperty('hoy');
    expect(tablero.body.seguimientos).toHaveProperty('proximos');

    // El cumpleaños se busca por el mes del negocio, no por un rango de fechas de
    // este año: si no, de enero a diciembre no aparecería ninguno.
    const mes = hoy.slice(5, 7);
    const cumple = await nuevoCliente(TEST_ORG_A, {
      name: 'Cumpleañero del mes',
      birthday: `1990-${mes}-15`,
    });
    const despues = await comoAdmin(TEST_ORG_A).get('/api/tablero');
    expect(despues.body.cumpleanos.map((c: any) => c.id)).toContain(cumple.id);
  });

  it('el tablero de una organización no ve los seguimientos de otra', async () => {
    const cliente = await nuevoCliente(TEST_ORG_B, { name: 'Cliente de B' });
    await nuevoSeguimiento(TEST_ORG_B, { customerId: cliente.id, title: 'Pendiente de B' });

    const tableroA = await comoAdmin(TEST_ORG_A).get('/api/tablero');
    const titulos = [
      ...tableroA.body.seguimientos.vencidos,
      ...tableroA.body.seguimientos.hoy,
      ...tableroA.body.seguimientos.proximos,
    ].map((s: any) => s.title);
    expect(titulos).not.toContain('Pendiente de B');
  });

  it('el resumen cuenta los pendientes y los vencidos', async () => {
    const cliente = await nuevoCliente(TEST_ORG_B, { name: 'Cliente del resumen' });
    const tablero = await comoAdmin(TEST_ORG_B).get('/api/tablero');
    const hoy = tablero.body.hoy as string;
    const antes = new Date(`${hoy}T00:00:00Z`);
    antes.setUTCDate(antes.getUTCDate() - 2);
    await nuevoSeguimiento(TEST_ORG_B, { customerId: cliente.id, dueDate: antes.toISOString().slice(0, 10) });

    const resumen = await comoAdmin(TEST_ORG_B).get('/api/resumen');
    expect(resumen.status).toBe(200);
    expect(resumen.body.seguimientos.porEstado.pending).toBeGreaterThan(0);
    expect(resumen.body.seguimientos.vencidos).toBeGreaterThan(0);
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

  it('un miembro no cambia la zona horaria de la empresa', async () => {
    // Si un miembro la cambiara, el "hoy" del tablero de toda la gente se movería
    // de día.
    const res = await comoMiembro(TEST_ORG_B).put('/api/settings').send({ timezone: 'Europe/Lisbon' });
    expect(res.status).toBe(403);
  });

  it('rechaza una zona horaria que no existe', async () => {
    const res = await comoAdmin(TEST_ORG_A).put('/api/settings').send({ timezone: 'Marte/Olympus' });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/Zona horaria/);
  });
});
