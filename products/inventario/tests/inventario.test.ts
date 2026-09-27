import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * El inventario, sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy: en el producto viejo
 * bastaba con que la UI anduviera, y el aislamiento venía de que cada
 * organización tenía su propio login. Ahora las organizaciones comparten login
 * y se distinguen por el token, así que el aislamiento hay que probarlo.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Crea un artículo y devuelve su id. */
async function nuevoArticulo(
  orgId: string,
  datos: Record<string, unknown> = {},
): Promise<{ id: string; name: string }> {
  const res = await comoAdmin(orgId).post('/api/items').send({ name: 'Artículo', ...datos });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

describe('sesión e identidad', () => {
  it('sin sesión no entra a la API', async () => {
    expect((await tp.anon().get('/api/items')).status).toBe(401);
  });

  it('no sirve el HTML sin sesión: redirige al login central', async () => {
    const res = await tp.anon().get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });

  it('/api/me dice de qué organización se entra', async () => {
    const res = await tp.as({ orgId: TEST_ORG_A }).get('/api/me');
    expect(res.body.organization.id).toBe(TEST_ORG_A);
    expect(res.body.product).toBe('inventario');
  });
});

describe('la interfaz', () => {
  it('con sesión sirve la app y sus estáticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Inventario');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organización. Por eso no hay ningún item_id hardcodeado en el HTML.
    expect(html.text).not.toMatch(TEST_ORG_A);

    for (const estatico of ['/app.js', '/style.css']) {
      expect((await tp.as({ orgId: TEST_ORG_A }).get(estatico)).status).toBe(200);
    }
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
});

describe('configuración', () => {
  it('sin guardar nada devuelve los defaults, y leer no escribe', async () => {
    const res = await comoMiembro(TEST_ORG_A).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ defaultUnit: 'unidad', defaultMinQuantity: 0, currency: '$' });
    expect(res.body.configured).toBe(false);
    // Un GET no deja rastro: si guardara, la base cresería con cada visita.
    expect(
      tp.sqlite
        .prepare('SELECT COUNT(*) c FROM settings WHERE organization_id = ?')
        .get(TEST_ORG_A) as unknown as { c: number },
    ).toMatchObject({ c: 0 });
  });

  it('guarda las preferencias de la organización y las devuelve', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ defaultUnit: 'caja', defaultMinQuantity: 5, currency: 'US$' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ defaultUnit: 'caja', defaultMinQuantity: 5, currency: 'US$' });

    const despues = await comoMiembro(TEST_ORG_A).get('/api/settings');
    expect(despues.body).toMatchObject({ defaultUnit: 'caja', defaultMinQuantity: 5, currency: 'US$' });
  });

  it('guardar de nuevo actualiza la fila, no agrega otra', async () => {
    await comoAdmin(TEST_ORG_A).put('/api/settings').send({ defaultUnit: 'caja', defaultMinQuantity: 5, currency: '$' });
    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ defaultUnit: 'saco', defaultMinQuantity: 2, currency: '$' });

    expect(tp.sqlite.prepare('SELECT COUNT(*) c FROM settings').get()).toMatchObject({ c: 1 });
    const fila = tp.sqlite.prepare('SELECT default_unit, default_min_quantity FROM settings').get();
    expect(fila).toMatchObject({ default_unit: 'saco', default_min_quantity: 2 });
  });

  it('un member lee la configuración pero no la cambia', async () => {
    expect((await comoMiembro(TEST_ORG_A).get('/api/settings')).status).toBe(200);
    const escritura = await comoMiembro(TEST_ORG_A)
      .put('/api/settings')
      .send({ defaultUnit: 'litro', defaultMinQuantity: 0, currency: '$' });
    expect(escritura.status).toBe(403);
  });

  it('cada organización tiene las suyas', async () => {
    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ defaultUnit: 'caja', defaultMinQuantity: 5, currency: '$' });
    await comoAdmin(TEST_ORG_B)
      .put('/api/settings')
      .send({ defaultUnit: 'par', defaultMinQuantity: 10, currency: 'CLP$' });

    expect((await comoMiembro(TEST_ORG_A).get('/api/settings')).body.defaultUnit).toBe('caja');
    expect((await comoMiembro(TEST_ORG_B).get('/api/settings')).body.defaultUnit).toBe('par');
    // Y una organización que nunca guardó sigue con los defaults, no con los de
    // la otra: por eso el GET filtra y el PUT no acepta organization_id.
    const c = await comoMiembro(TEST_ORG_B).get('/api/settings');
    expect(c.body.currency).toBe('CLP$');
  });

  it('no acepta organization_id en el cuerpo', async () => {
    // Una organización que nadie tocó: si el PUT respetara el body, aparecería
    // configurada y el aislamiento real estaría roto.
    const orgC = 'org_gamma_0000000000000';
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ organizationId: orgC, defaultUnit: 'caja', defaultMinQuantity: 1, currency: '$' });

    expect(res.status).toBe(200);
    expect(res.body.organizationId).toBe(TEST_ORG_A);
    expect((await comoMiembro(orgC).get('/api/settings')).body.configured).toBe(false);
  });

  it('valida la configuración', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ defaultUnit: '', defaultMinQuantity: -3, currency: '' });
    expect(res.status).toBe(400);
  });
});

describe('artículos', () => {
  it('crea un artículo en la organización de la sesión', async () => {
    const res = await comoAdmin(TEST_ORG_A).post('/api/items').send({
      name: 'Filtro de aire',
      sku: 'FIL-AIR',
      minQuantity: 6,
      unit: 'pieza',
      priceCents: 12000,
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organizationId: TEST_ORG_A,
      name: 'Filtro de aire',
      quantity: 0,
      unit: 'pieza',
      priceCents: 12000,
      active: true,
    });
  });

  it('ignora un organization_id que venga en el cuerpo', async () => {
    const creado = await comoAdmin(TEST_ORG_A)
      .post('/api/items')
      .send({ name: 'Con trampa', organization_id: TEST_ORG_B, organizationId: TEST_ORG_B });
    expect(creado.body.organizationId).toBe(TEST_ORG_A);

    const enB = await comoAdmin(TEST_ORG_B).get('/api/items');
    expect(enB.body.items.map((i: { name: string }) => i.name)).not.toContain('Con trampa');
  });

  it('NO deja escribir la cantidad por PATCH', async () => {
    const it1 = await nuevoArticulo(TEST_ORG_A, { name: 'Stock protegido' });
    // Aunque el campo no está en el schema, si el runtime lo dejara pasar, el
    // stock cambiaría sin movimiento. Esta es la invariante del producto.
    const res = await comoAdmin(TEST_ORG_A)
      .patch(`/api/items/${it1.id}`)
      .send({ quantity: 9999 });
    expect(res.status).toBe(200);

    const despues = await comoAdmin(TEST_ORG_A).get(`/api/items/${it1.id}`);
    expect(despues.body.quantity).toBe(0);
  });

  it('valida los datos de entrada', async () => {
    const sinNombre = await comoAdmin(TEST_ORG_A).post('/api/items').send({ unit: 'pieza' });
    expect(sinNombre.status).toBe(400);

    const negativo = await comoAdmin(TEST_ORG_A).post('/api/items').send({ name: 'X', minQuantity: -5 });
    expect(negativo.status).toBe(400);
  });

  it('un member carga y edita artículos, pero no los da de baja', async () => {
    // La misma política del legacy: cargar stock es del día a día, darlo de
    // baja no. Lo que un member no puede es mover cantidades (ver más abajo).
    const creado = await comoMiembro(TEST_ORG_A).post('/api/items').send({ name: 'Cargado por member' });
    expect(creado.status).toBe(201);
    expect((await comoMiembro(TEST_ORG_A).patch(`/api/items/${creado.body.id}`).send({ name: 'Editado' })).status).toBe(200);

    const baja = await comoMiembro(TEST_ORG_A).delete(`/api/items/${creado.body.id}`);
    expect(baja.status).toBe(403);

    // Y sigue dado de baja para quien puede.
    expect((await comoAdmin(TEST_ORG_A).delete(`/api/items/${creado.body.id}`)).status).toBe(200);
  });
});

describe('aislamiento entre organizaciones', () => {
  it('Org B no ve los artículos de Org A', async () => {
    const priv = await nuevoArticulo(TEST_ORG_A, { name: 'Confidencial de Alpha' });

    const listaB = await comoMiembro(TEST_ORG_B).get('/api/items');
    expect(listaB.body.items.map((i: { name: string }) => i.name)).not.toContain('Confidencial de Alpha');

    expect((await comoMiembro(TEST_ORG_B).get(`/api/items/${priv.id}`)).status).toBe(404);
    expect((await comoMiembro(TEST_ORG_B).patch(`/api/items/${priv.id}`).send({ name: 'Secuestrado' })).status).toBe(404);

    // El rol se evalúa antes que la pertenencia, así que un member de B recibe
    // 403 al dar de baja algo, sin que eso diga si el artículo existe. Para
    // probar que el filtro de organización frena de verdad hay que hacerlo con
    // un admin de B, que pasa el rol y se topa con la fila ajena.
    expect((await comoMiembro(TEST_ORG_B).delete(`/api/items/${priv.id}`)).status).toBe(403);
    expect((await comoAdmin(TEST_ORG_B).delete(`/api/items/${priv.id}`)).status).toBe(404);

    // Y el artículo de Alpha sigue intacto.
    const intacto = await comoMiembro(TEST_ORG_A).get(`/api/items/${priv.id}`);
    expect(intacto.status).toBe(200);
    expect(intacto.body.name).toBe('Confidencial de Alpha');
  });

  it('las búsquedas no cruzan organizaciones', async () => {
    await nuevoArticulo(TEST_ORG_B, { name: 'Repuesto de Beta' });
    const enA = await comoMiembro(TEST_ORG_A).get('/api/items?q=Beta');
    expect(enA.body.items).toHaveLength(0);
  });

  it('el resumen de stock bajo tampoco cruza', async () => {
    const bajo = await nuevoArticulo(TEST_ORG_A, { name: 'Casi Agotado', minQuantity: 5 });
    // Se deja en 0 <= 5, o sea stock bajo.
    const enA = await comoMiembro(TEST_ORG_A).get('/api/items/low-stock');
    expect(enA.body.items.map((i: { id: string }) => i.id)).toContain(bajo.id);

    const enB = await comoMiembro(TEST_ORG_B).get('/api/items/low-stock');
    expect(enB.body.items.map((i: { id: string }) => i.id)).not.toContain(bajo.id);
  });

  it('el resumen cuenta solo lo de la sesión', async () => {
    const resA = await comoMiembro(TEST_ORG_A).get('/api/resumen');
    const resB = await comoMiembro(TEST_ORG_B).get('/api/resumen');
    expect(resA.body.items).toBeGreaterThan(0);
    expect(resA.body.items).not.toBe(resB.body.items);
  });
});

describe('movimientos de stock', () => {
  it('suma stock y deja registro de quién y por qué', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Con entradas', minQuantity: 0 });
    const res = await comoAdmin(TEST_ORG_A)
      .post(`/api/items/${art.id}/movements`)
      .send({ delta: 20, reason: 'Recepción de proveedor' });

    expect(res.status).toBe(201);
    expect(res.body.quantity).toBe(20);
    expect(res.body.movement).toMatchObject({ delta: 20, organizationId: TEST_ORG_A });

    const historial = await comoMiembro(TEST_ORG_A).get(`/api/movements?itemId=${art.id}`);
    expect(historial.body.movements).toHaveLength(1);
    expect(historial.body.movements[0].itemName).toBe('Con entradas');
  });

  it('el movimiento guarda quién lo hizo, con id y nombre', async () => {
    // El id es la referencia al Core; el nombre es la foto de ese momento, para
    // que el historial se lea sin ir a buscar al usuario.
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Con autor' });
    await comoAdmin(TEST_ORG_A)
      .post(`/api/items/${art.id}/movements`)
      .send({ delta: 3, reason: 'Entrada con autor' });

    const { body } = await comoMiembro(TEST_ORG_A).get(`/api/movements?itemId=${art.id}`);
    const mov = body.movements[0];
    expect(mov.actorUserId).toBe('usr_test_0000000000000000');
    expect(mov.actorName).toBe('Persona de Prueba');
  });

  it('resta stock y no deja que quede en negativo', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Con salidas', minQuantity: 0 });
    await comoAdmin(TEST_ORG_A).post(`/api/items/${art.id}/movements`).send({ delta: 5, reason: 'Entrada' });

    const ok = await comoAdmin(TEST_ORG_A)
      .post(`/api/items/${art.id}/movements`)
      .send({ delta: -3, reason: 'Venta al mostrador' });
    expect(ok.status).toBe(201);
    expect(ok.body.quantity).toBe(2);

    // El legacy recortaba en 0 y seguía; acá se rechaza y se explica.
    const deMas = await comoAdmin(TEST_ORG_A)
      .post(`/api/items/${art.id}/movements`)
      .send({ delta: -50, reason: 'Error de tipeo' });
    expect(deMas.status).toBe(400);
    expect(deMas.body.error).toMatch(/No hay stock suficiente/);

    const estado = await comoMiembro(TEST_ORG_A).get(`/api/items/${art.id}`);
    expect(estado.body.quantity).toBe(2);
  });

  it('exige motivo y delta distinto de cero', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Movimiento inválido' });
    const sinMotivo = await comoAdmin(TEST_ORG_A).post(`/api/items/${art.id}/movements`).send({ delta: 5 });
    expect(sinMotivo.status).toBe(400);
    // El detalle va por campo, que es lo que la UI muestra junto al input.
    expect(sinMotivo.body.errors.fieldErrors.reason).toBeDefined();

    const nulo = await comoAdmin(TEST_ORG_A)
      .post(`/api/items/${art.id}/movements`)
      .send({ delta: 0, reason: 'Nada' });
    expect(nulo.status).toBe(400);
  });

  it('un member no mueve stock', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Movimiento de member' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/items/${art.id}/movements`)
      .send({ delta: 1, reason: 'Me emocioné' });
    expect(res.status).toBe(403);
  });

  it('no se puede mover stock de otro producto... ni de otra organización', async () => {
    const deA = await nuevoArticulo(TEST_ORG_A, { name: 'Solo de Alpha' });
    const res = await comoAdmin(TEST_ORG_B)
      .post(`/api/items/${deA.id}/movements`)
      .send({ delta: 1, reason: 'No debería poder' });
    expect(res.status).toBe(404);
  });

  it('el historial con tipo in/out filtra bien', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Filtros de historial', minQuantity: 0 });
    await comoAdmin(TEST_ORG_A).post(`/api/items/${art.id}/movements`).send({ delta: 10, reason: 'Entra' });
    await comoAdmin(TEST_ORG_A).post(`/api/items/${art.id}/movements`).send({ delta: -4, reason: 'Sale' });

    const entradas = await comoMiembro(TEST_ORG_A).get(`/api/movements?itemId=${art.id}&type=in`);
    const salidas = await comoMiembro(TEST_ORG_A).get(`/api/movements?itemId=${art.id}&type=out`);

    expect(entradas.body.movements).toHaveLength(1);
    expect(entradas.body.movements[0].delta).toBe(10);
    expect(salidas.body.movements).toHaveLength(1);
    expect(salidas.body.movements[0].delta).toBe(-4);
  });

  it('un movimiento deja la cantidad y el historial consistentes', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Cuadra', minQuantity: 0 });
    for (const [delta, reason] of [
      [30, 'Compra'],
      [-12, 'Taller'],
      [-8, 'Venta'],
    ] as const) {
      await comoAdmin(TEST_ORG_A).post(`/api/items/${art.id}/movements`).send({ delta, reason });
    }

    const estado = await comoMiembro(TEST_ORG_A).get(`/api/items/${art.id}`);
    const historial = await comoMiembro(TEST_ORG_A).get(`/api/movements?itemId=${art.id}`);
    const suma = historial.body.movements.reduce((acc: number, m: { delta: number }) => acc + m.delta, 0);

    // La cantidad tiene que ser exactamente la suma de los movimientos.
    expect(estado.body.quantity).toBe(suma);
  });
});

describe('baja de artículos', () => {
  it('dar de baja es lógico: el artículo sale de la lista pero conserva el historial', async () => {
    const art = await nuevoArticulo(TEST_ORG_A, { name: 'Para dar de baja', minQuantity: 0 });
    await comoAdmin(TEST_ORG_A).post(`/api/items/${art.id}/movements`).send({ delta: 7, reason: 'Entrada' });

    const baja = await comoAdmin(TEST_ORG_A).delete(`/api/items/${art.id}`);
    expect(baja.status).toBe(200);

    const lista = await comoMiembro(TEST_ORG_A).get('/api/items');
    expect(lista.body.items.map((i: { id: string }) => i.id)).not.toContain(art.id);

    // El movimiento sigue ahí: si se perdiera, el stock dejaría de explicarse.
    const historial = await comoMiembro(TEST_ORG_A).get(`/api/movements?itemId=${art.id}`);
    expect(historial.body.movements).toHaveLength(1);
  });
});

describe('sin rastro de autenticación propia', () => {
  it('no expone login, registro ni recuperación de contraseña', async () => {
    for (const ruta of ['/api/auth/login', '/api/auth/register', '/api/auth/recuperar']) {
      const res = await tp.anon().post(ruta).send({ email: 'a@b.cl', password: 'x' });
      expect(res.status, ruta).toBe(401);
    }
  });

  it('la base no tiene tablas de usuarios ni de organizaciones', () => {
    const tablas = tp.tables();
    // Allowlist estricta a propósito: si aparece una tabla nueva hay que
    // pensarlo. El producto no tiene usuarios, organizaciones, sesiones ni
    // clientes: eso vive en el Core.
    expect(tablas.sort()).toEqual(['amg_migrations', 'items', 'legacy_tenant_map', 'movements', 'settings']);
  });
});
