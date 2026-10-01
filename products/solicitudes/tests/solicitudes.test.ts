import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Solicitudes (helpdesk) sobre el runtime.
 *
 * Este producto se reescribio completo como mesa de ayuda: pedidos con folio,
 * solicitante, responsable, prioridad, comentarios, adjuntos e historial de
 * estados. Ya no es un taller mecanico, asi que no hay ordenes, trabajos,
 * tecnicos ni clientes.
 *
 * Las reglas que son de ESTE producto y no se pueden dar por supuestas:
 *
 *   - El FOLIO es unico por organizacion, no global.
 *   - El HISTORIAL de estados se escribe con cada cambio, dentro de la misma
 *     transaccion que guarda el estado: un cambio sin rastro no se puede
 *     auditar.
 *   - `closed_at` se marca al cerrar/cancelar y se limpia si la solicitud se
 *     reabre.
 *   - Los ADJUNTOS viven en disco; la columna `path` es relativa, y al servir
 *     se reconstruye desde el id del adjunto.
 *   - Solicitante y responsable son textos libres: no se exige que existan en
 *     ningun catalogo.
 *
 * OJO con los sobres de respuesta: el listado devuelve `{ requests }`, el hilo
 * `{ request, comments, attachments, history }`, y los adjuntos `{ attachment,
 * url }`. Nada de `{ items }`: este producto no usa el CRUD generico.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Alta de solicitud y devuelve su id. */
async function nuevaSolicitud(
  orgId: string,
  datos: Record<string, unknown> = {},
): Promise<string> {
  const res = await comoAdmin(orgId)
    .post('/api/requests')
    .send({ title: 'No abre la impresora', requesterName: 'Ana Torres', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.request.id;
}

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
    expect(html.text).toContain('/auth/logout');
  });

  it('la UI no reabrió ordenes de taller: no hay técnicos ni clientes', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    // Esto es una mesa de ayuda: no se registran técnicos, clientes ni
    // repuestos, y la pantalla no tiene una columna de "Sobre qué se trabaja".
    expect(html.text).not.toMatch(/técnico/i);
    expect(html.text).not.toMatch(/repuesto/i);
    expect(html.text).toMatch(/id="sol-titulo"/);
  });

  it('la UI no inventa datos ni decide el folio en el navegador', async () => {
    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;
    expect(js).not.toContain(TEST_ORG_A);
    expect(js).toContain('/api/requests');
    // El folio se lee de los ajustes que trae el servidor.
    expect(js).toMatch(/estado\.cfg\.nextNumber/);
  });

  it('el form de ajustes se llena por form.elements, no por ids sueltos', async () => {
    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;
    const fn = js.match(/function renderConfig\(\)\s*\{[\s\S]*?\n\}/);
    expect(fn, 'no se encontro renderConfig()').toBeTruthy();
    expect(fn![0]).toMatch(/form\.elements/);
  });

  it('el esquema es el del helpdesk y no el del taller viejo', async () => {
    const tablas = tp.tables();
    expect(tablas).toEqual(expect.arrayContaining(['requests', 'comments', 'attachments', 'status_history', 'settings']));
    expect(tablas).not.toContain('orders');
    expect(tablas).not.toContain('legacy_tenant_map');
  });
});

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/requests')).status).toBe(401);
  });

  it('la API no acepta una organización que no viene del token', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .post('/api/requests')
      .send({ organizationId: TEST_ORG_B, title: 'Invasion', requesterName: 'X' });
    expect(res.status).toBe(201);

    expect(res.body.request.organizationId).toBe(TEST_ORG_A);

    const enB = await comoAdmin(TEST_ORG_B).get('/api/requests');
    expect(enB.body.requests.some((r: any) => r.title === 'Invasion')).toBe(false);
  });
});

describe('solicitudes', () => {
  it('crea con folio siguiente, prioridad por defecto y el estado inicial', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/requests')
      .send({
        title: 'No carga el portal',
        description: 'Da error 500 en la vista de reportes',
        requesterName: 'Pablo Ríos',
        requesterEmail: 'pablo@alpha.test',
        responsibleName: 'Equipo plataforma',
        dueAt: '2026-10-15',
      });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = res.body.request;
    expect(r.number).toBeGreaterThan(0);
    expect(r.priority).toBe('medium');
    expect(r.status).toBe('open');
    expect(r.requesterEmail).toBe('pablo@alpha.test');
    expect(r.closedAt).toBeNull();
  });

  it('no crea sin título ni sin solicitante', async () => {
    expect((await comoAdmin(TEST_ORG_A).post('/api/requests').send({ requesterName: 'X' })).status).toBe(400);
    expect((await comoAdmin(TEST_ORG_A).post('/api/requests').send({ title: 'X' })).status).toBe(400);
  });

  it('propone el folio siguiente como el máximo que existe más uno', async () => {
    const res = await comoAdmin(TEST_ORG_A).get('/api/settings');
    const solicitudes = (await comoAdmin(TEST_ORG_A).get('/api/requests?limit=500')).body.requests;
    const maximo = Math.max(...solicitudes.map((r: any) => r.number));
    expect(res.body.settings.nextNumber).toBe(maximo + 1);
  });

  it('rechaza un folio repetido en la misma organización', async () => {
    const res = await comoAdmin(TEST_ORG_A).post('/api/requests').send({
      number: 1,
      title: 'Choca el folio',
      requesterName: 'X',
    });
    expect(res.status).toBe(409);
  });

  it('el folio NO es global: dos organizaciones pueden empezar en 1', async () => {
    const a = await comoAdmin(TEST_ORG_A).post('/api/requests').send({ number: 900, title: 'A', requesterName: 'X' });
    const b = await comoAdmin(TEST_ORG_B).post('/api/requests').send({ number: 900, title: 'B', requesterName: 'Y' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
  });

  it('rechaza una fecha límite que no es una fecha', async () => {
    const res = await comoAdmin(TEST_ORG_A).post('/api/requests').send({
      title: 'Fecha inventada',
      requesterName: 'X',
      dueAt: 'después de la reunión',
    });
    expect(res.status).toBe(400);
  });

  it('editar solo el estado no pierde el resto y registra el cambio', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A, { dueAt: '2026-10-05', resolution: null });

    const parcheado = await comoAdmin(TEST_ORG_A)
      .patch(`/api/requests/${idSol}`)
      .send({ status: 'in_progress' });
    expect(parcheado.status).toBe(200);

    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect(detalle.body.request.title).toBe('No abre la impresora');
    expect(detalle.body.request.requesterName).toBe('Ana Torres');
    expect(detalle.body.request.status).toBe('in_progress');

    // El historial creció: la creación (open) más el cambio a en curso.
    expect(detalle.body.history).toHaveLength(2);
    const cambio = detalle.body.history[1];
    expect(cambio.oldStatus).toBe('open');
    expect(cambio.newStatus).toBe('in_progress');
    expect(cambio.changedBy).toBe('Persona de Prueba');
  });

  it('un PATCH sin cambio de estado no agrega historial', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    const antes = detalle.body.history.length;

    await comoAdmin(TEST_ORG_A).patch(`/api/requests/${idSol}`).send({ priority: 'high' });

    const despues = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect(despues.body.request.priority).toBe('high');
    expect(despues.body.history).toHaveLength(antes);
  });

  it('cierra la solicitud marcando closed_at y la reabre limpiándolo', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A, { resolution: 'Se reinició el equipo' });

    const cerrada = await comoAdmin(TEST_ORG_A)
      .patch(`/api/requests/${idSol}`)
      .send({ status: 'closed' });
    expect(cerrada.body.request.closedAt).toBeTruthy();

    const reabierta = await comoAdmin(TEST_ORG_A)
      .patch(`/api/requests/${idSol}`)
      .send({ status: 'open' });
    expect(reabierta.body.request.closedAt).toBeNull();
    expect(reabierta.body.request.resolution).toBe('Se reinició el equipo');
  });

  it('el listado filtra por estado, prioridad y búsqueda', async () => {
    await nuevaSolicitud(TEST_ORG_A, { priority: 'urgent', title: 'Sincroniza backups' });

    const porEstado = await comoAdmin(TEST_ORG_A).get('/api/requests?status=resolved');
    // Ninguna resolvió el estado resolved, asi que no aparece ninguna.
    expect(porEstado.body.requests.some((r: any) => r.priority === 'urgent')).toBe(false);

    const porPrioridad = await comoAdmin(TEST_ORG_A).get('/api/requests?priority=urgent');
    expect(porPrioridad.body.requests.length).toBeGreaterThan(0);
    expect(porPrioridad.body.requests.every((r: any) => r.priority === 'urgent')).toBe(true);

    const porBusqueda = await comoAdmin(TEST_ORG_A).get('/api/requests?q=backups');
    expect(porBusqueda.body.requests.length).toBeGreaterThan(0);
  });

  it('borra la solicitud con su hilo y su historial', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    await comoAdmin(TEST_ORG_A).post(`/api/requests/${idSol}/comments`).send({ content: 'Un comentario' });

    const res = await comoAdmin(TEST_ORG_A).delete(`/api/requests/${idSol}`);
    expect(res.status).toBe(200);

    expect((await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`)).status).toBe(404);
    // El cascade se llevó los comentarios de la solicitud.
    const sqlite = tp.sqlite;
    const quedan = sqlite.prepare(`SELECT COUNT(*) AS n FROM comments WHERE request_id = ?`).get(idSol);
    expect((quedan as { n: number }).n).toBe(0);
  });

  it('el resumen cuenta abiertas, vencidas, resueltas y de prioridad alta', async () => {
    await nuevaSolicitud(TEST_ORG_A, { priority: 'urgent', dueAt: '2001-01-01' });
    await nuevaSolicitud(TEST_ORG_A).then((id) =>
      comoAdmin(TEST_ORG_A).patch(`/api/requests/${id}`).send({ status: 'closed' }),
    );

    const res = await comoAdmin(TEST_ORG_A).get('/api/resumen');
    expect(res.body.abiertas).toBeGreaterThanOrEqual(1);
    expect(res.body.vencidas).toBeGreaterThanOrEqual(1);
    expect(res.body.resueltas).toBeGreaterThanOrEqual(1);
    expect(res.body.alta).toBeGreaterThanOrEqual(1);
  });
});

describe('historial de estados', () => {
  it('registra el estado inicial al crear', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A, { status: 'in_progress' });
    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    const [inicial] = detalle.body.history;
    expect(inicial.oldStatus).toBeNull();
    expect(inicial.newStatus).toBe('in_progress');
    expect(inicial.changedBy).toBe('Persona de Prueba');
  });

  it('una solicitud de otra organización no deja ver su historial', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_B);
    const res = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect([403, 404]).toContain(res.status);
  });
});

describe('comentarios', () => {
  it('guarda el comentario con el autor de la sesión', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/requests/${idSol}/comments`)
      .send({ content: 'Ya lo estoy viendo' });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.comment.content).toBe('Ya lo estoy viendo');
    expect(res.body.comment.authorName).toBe('Persona de Prueba');
    expect(res.body.comment.authorUserId).toBeTruthy();
  });

  it('rechaza un comentario vacío', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const res = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/comments`)
      .send({ content: '   ' });
    expect(res.status).toBe(400);
  });

  it('no deja comentar una solicitud de otra organización', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_B);
    const res = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/comments`)
      .send({ content: 'Intromisión' });
    expect([403, 404]).toContain(res.status);
  });
});

describe('adjuntos', () => {
  it('guarda el archivo, lo lista y lo devuelve entero al descargarlo', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const contenido = Buffer.from('captura de pantalla del error');

    const subida = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({
        filename: 'captura.png',
        mimeType: 'image/png',
        data: contenido.toString('base64'),
      });

    expect(subida.status, JSON.stringify(subida.body)).toBe(201);
    const a = subida.body.attachment;
    expect(a.filename).toBe('captura.png');
    expect(a.sizeBytes).toBe(contenido.length);
    expect(a.path).toMatch(/^attachments\//);
    expect(subida.body.url).toContain('/file');

    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect(detalle.body.attachments).toHaveLength(1);

    const descarga = await comoAdmin(TEST_ORG_A).get(
      `/api/requests/${idSol}/attachments/${a.id}/file`,
    );
    expect(descarga.status).toBe(200);
    // El tipo que se sirve NO es el que subio el cliente: un PNG que se sirve
    // como `text/html` se ejecuta en el origen del producto. Siempre baja como
    // archivo, con `nosniff` para que el navegador no lo interprete.
    expect(descarga.headers['content-type']).toBe('application/octet-stream');
    expect(descarga.headers['x-content-type-options']).toBe('nosniff');
    expect(descarga.headers['content-disposition']).toMatch(/^attachment/);
    expect(descarga.body).toEqual(contenido);
  });

  it('no sirve un HTML subido como si fuera una página del producto', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const subida = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({
        filename: 'engano.html',
        mimeType: 'text/html',
        data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      });
    expect(subida.status).toBe(415);

    // Y si se disfraza de binario generico, igual baja como descarga.
    const disfraz = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({
        filename: 'engano.html',
        mimeType: 'application/octet-stream',
        data: Buffer.from('<script>alert(1)</script>').toString('base64'),
      });
    expect(disfraz.status).toBe(201);
    const descarga = await comoAdmin(TEST_ORG_A).get(
      `/api/requests/${idSol}/attachments/${disfraz.body.attachment.id}/file`,
    );
    expect(descarga.headers['content-type']).toBe('application/octet-stream');
    expect(descarga.headers['x-content-type-options']).toBe('nosniff');
  });

  it('limpia el nombre del archivo para que no rompa la descarga', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const subida = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({
        filename: '../../etc/passwd".txt',
        mimeType: 'text/plain',
        data: Buffer.from('x').toString('base64'),
      });
    expect(subida.status, JSON.stringify(subida.body)).toBe(201);
    const guardado = subida.body.attachment.filename;
    expect(guardado).not.toMatch(/[/\\]/);
    expect(guardado).not.toContain('"');
    expect(guardado).not.toMatch(/^\.\./);

    const descarga = await comoAdmin(TEST_ORG_A).get(
      `/api/requests/${idSol}/attachments/${subida.body.attachment.id}/file`,
    );
    expect(descarga.status).toBe(200);
    expect(descarga.headers['content-disposition']).not.toMatch(/path=|filename=".*[/\\]/);
  });

  it('acepta un data URI con prefijo', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const contenido = Buffer.from('hola');
    const res = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({
        filename: 'nota.txt',
        mimeType: 'text/plain',
        data: `data:text/plain;base64,${contenido.toString('base64')}`,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.attachment.sizeBytes).toBe(contenido.length);
  });

  it('rechaza un archivo que excede 750 KB', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    // 760 KB decodificados caben en el body de 1 MB sin exceder el parser de
    // JSON, asi que quien responde es la regla del producto, no express.
    const res = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({ filename: 'grande.bin', data: Buffer.alloc(760_000).toString('base64') });
    expect(res.status).toBe(413);
  });

  it('una petición que excede el body de 1 MB tampoco se acepta', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const res = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({ filename: 'enorme.bin', data: Buffer.alloc(1_100_000).toString('base64') });
    expect(res.status).toBe(413);
  });

  it('no deja ver ni descargar el adjunto de otra organización', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_B);
    const subida = await comoAdmin(TEST_ORG_B)
      .post(`/api/requests/${idSol}/attachments`)
      .send({ filename: 'secreto.txt', data: Buffer.from('datos de B').toString('base64') });

    const detalleA = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect([403, 404]).toContain(detalleA.status);

    const descarga = await comoAdmin(TEST_ORG_A).get(
      `/api/requests/${idSol}/attachments/${subida.body.attachment.id}/file`,
    );
    expect([403, 404]).toContain(descarga.status);
  });

  it('quitar un adjunto lo borra de la lista', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_A);
    const subida = await comoAdmin(TEST_ORG_A)
      .post(`/api/requests/${idSol}/attachments`)
      .send({ filename: 'tmp.txt', data: Buffer.from('x').toString('base64') });

    const res = await comoAdmin(TEST_ORG_A).delete(
      `/api/requests/${idSol}/attachments/${subida.body.attachment.id}`,
    );
    expect(res.status).toBe(200);

    const detalle = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect(detalle.body.attachments).toHaveLength(0);
  });
});

describe('aislamiento entre organizaciones', () => {
  it('no deja ver una solicitud de otra organización', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_B);
    const res = await comoAdmin(TEST_ORG_A).get(`/api/requests/${idSol}`);
    expect([403, 404]).toContain(res.status);
  });

  it('no deja modificar una solicitud de otra organización', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_B, { title: 'De Beta' });
    const res = await comoAdmin(TEST_ORG_A)
      .patch(`/api/requests/${idSol}`)
      .send({ title: 'Robada' });
    expect([403, 404]).toContain(res.status);

    const sigue = await comoAdmin(TEST_ORG_B).get(`/api/requests/${idSol}`);
    expect(sigue.body.request.title).toBe('De Beta');
  });

  it('no deja borrar una solicitud de otra organización', async () => {
    const idSol = await nuevaSolicitud(TEST_ORG_B);
    const res = await comoAdmin(TEST_ORG_A).delete(`/api/requests/${idSol}`);
    expect([403, 404]).toContain(res.status);
  });

  it('la lista de A no muestra solicitudes de B', async () => {
    await nuevaSolicitud(TEST_ORG_B, { title: 'Titulo de Beta' });
    const res = await comoAdmin(TEST_ORG_A).get('/api/requests?limit=500');
    expect(res.body.requests.some((r: any) => r.title === 'Titulo de Beta')).toBe(false);
  });
});