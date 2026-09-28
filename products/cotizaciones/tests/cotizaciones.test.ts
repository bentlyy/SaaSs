import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { startTestProduct, TEST_ORG_A, TEST_ORG_B, type TestProduct } from '@amg/product-runtime/testing';
import { definicion } from '../src/app.js';

/**
 * Cotizaciones sobre el runtime.
 *
 * Estos tests son los que reemplazan a los del legacy. En el producto viejo el
 * aislamiento venia de que cada organizacion tenia su propio login; ahora las
 * organizaciones comparten login y se distinguen por el token, asi que el
 * aislamiento hay que probarlo: que una empresa no pueda leer ni escribir lo de
 * otra, aunque adivine el id.
 *
 * Y hay cuatro reglas que son de ESTE producto y no se pueden dar por supuestas:
 *
 *   - El FOLIO es unico por organizacion, no global. Dos empresas pueden tener
 *     cada una su cotizacion numero 1.
 *   - El dinero se MATERIALIZA en la fila. Si manana suben los precios o cambia
 *     la tasa de impuesto, una cotizacion vieja tiene que seguir valiendo lo que
 *     valio el dia que se hizo.
 *   - El estado SOLO se mueve por `POST /api/quotes/:id/estado`, que ademas
 *     sella cuando se mando y cuando se acepto. Un PATCH no cambia el estado: si
 *     lo cambiara, se podria aceptar una cotizacion sin dejar rastro.
 *   - Las lineas se reemplazan enteras. Editar una linea suelta dejaria numeros
 *     que no cuadran con el total.
 *
 * OJO con los sobres de respuesta, que no son todos iguales y por eso confunden:
 * el listado y la lectura de cotizaciones los resuelve `crudRouter`, que devuelve
 * `{ items }` al listar y la fila pelada al leer. Las rutas propias van envueltas
 * en `{ quote }`, `{ lines }` y `{ settings }`.
 */

let tp: TestProduct;

const comoAdmin = (orgId: string) => tp.as({ orgId, role: 'admin' });
const comoMiembro = (orgId: string) => tp.as({ orgId, role: 'member' });

beforeAll(() => {
  tp = startTestProduct(definicion);
});

afterAll(() => tp.close());

/** Alta de cotizacion, que es lo que casi todos los tests necesitan. */
async function nuevaCotizacion(orgId: string, datos: Record<string, unknown> = {}) {
  const res = await comoMiembro(orgId)
    .post('/api/quotes')
    .send({
      customerName: 'Ana Torres',
      issueDate: '2026-09-20',
      lines: [{ description: 'Logo y tarjetas', qty: 2, unitPriceCents: 25000 }],
      ...datos,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.quote as any;
}

beforeAll(async () => {
  // Datos en A y en B, para probar el aislamiento con ids que existen de verdad
  // en la otra organizacion.
  await nuevaCotizacion(TEST_ORG_A, { customerName: 'Cliente de Alpha' });
  await nuevaCotizacion(TEST_ORG_B, { customerName: 'Cliente de Beta' });
});

describe('la interfaz', () => {
  it('con sesion sirve la app y sus estaticos', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.status).toBe(200);
    expect(html.text).toContain('Cotizaciones');
    // La UI no embebe datos: todo entra por la API, que es la que filtra por
    // organizacion. Por eso no hay ningun id de organizacion en el HTML.
    expect(html.text).not.toContain(TEST_ORG_A);

    for (const estatico of ['/app.js', '/style.css']) {
      expect((await tp.as({ orgId: TEST_ORG_A }).get(estatico)).status).toBe(200);
    }
  });

  it('no sirve el HTML sin sesion: redirige al login central', async () => {
    const res = await tp.anon().get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/api/sso/authorize');
  });

  it('la UI no ofrece login ni usuarios: la sesion es del Core', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    // Ningun campo de contrasena: un login en el producto seria un segundo
    // sistema de identidad, que es justo lo que esta arquitectura prohibe.
    expect(html.text).not.toMatch(/type=["']password["']/i);
    expect(html.text).not.toMatch(/registro|crear cuenta/i);

    // Y la salida se resuelve contra el Core, no contra un logout local. Es un
    // enlace normal en el HTML, no una funcion de JavaScript.
    expect(html.text).toContain('/auth/logout');
  });

  it('la UI no gestiona clientes: son del producto `clientes`', async () => {
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    // Este producto NO es dueno del cliente. Si la UI tuviera una pantalla de
    // clientes, habria vuelto el producto viejo, que si los tenia.
    expect(html.text).not.toMatch(/id="clientes-lista"/);
    expect(html.text).not.toMatch(/type=["']tel["']/i);
    // Y si dice de donde viene el nombre.
    expect(html.text).toMatch(/Nombre del cliente/);
  });

  it('la UI no inventa datos ni resuelve el folio en el navegador', async () => {
    const js = await tp.as({ orgId: TEST_ORG_A }).get('/app.js');
    expect(js.text).not.toContain(TEST_ORG_A);
    expect(js.text).toContain('/api/quotes');
    // El folio se PIDE al servidor, no se calcula con un contador de la pagina.
    expect(js.text).toContain('/api/settings');
  });

  it('el folio de una cotizacion nueva sale de los ajustes ya cargados', async () => {
    // Regresion: `cargar()` guarda el objeto de ajustes tal cual en `estado.cfg`,
    // asi que leer `estado.cfg.settings` es leer `undefined` y el boton "Nueva
    // cotizacion" revienta con un TypeError. Los tests de UI son estaticos, asi
    // que sin este chequeo el bug volveria sin que nadie lo note.
    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;

    // Lo que se guarda es el objeto de ajustes, sin envolver.
    expect(js).toMatch(/estado\.cfg\s*=\s*cfg\.settings/);
    // Y por lo tanto nadie busca un `settings` adentro de el.
    expect(js, 'la UI lee un `settings` anidado que no existe').not.toMatch(/estado\.cfg\.settings/);
    expect(js).toMatch(/estado\.cfg\.nextNumber/);
  });

  it('el form de ajustes se llena por form.elements, no por ids sueltos', async () => {
    // Mismo contrato que el resto de los productos: agregar un ajuste es agregar
    // un <input name="..."> en el HTML, no tocar el JS.
    const html = await tp.as({ orgId: TEST_ORG_A }).get('/');
    expect(html.text).toMatch(/<form id="config-form">/);

    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;
    const fn = js.match(/function renderConfig\(\)\s*\{[\s\S]*?\n\}/);
    expect(fn, 'no se encontro renderConfig()').toBeTruthy();
    expect(fn![0]).toMatch(/form\.elements/);
  });

  it('la UI no manda el estado en el formulario de cotizacion', async () => {
    // El estado tiene su propia ruta, que ademas sella la fecha de envio y de
    // aceptacion. Si el formulario lo mandara en el cuerpo, el PATCH seria una
    // segunda puerta para aceptar una cotizacion sin sello.
    const js = (await tp.as({ orgId: TEST_ORG_A }).get('/app.js')).text;
    expect(js).toMatch(/\/estado`/);
    const cuerpo = js.match(/const cuerpo = \{[\s\S]*?\n  \};/);
    expect(cuerpo, 'no se encontro el cuerpo del formulario').toBeTruthy();
    expect(cuerpo![0]).not.toMatch(/status/);
  });
});

describe('sesion e identidad', () => {
  it('sin sesion no entra a la API', async () => {
    expect((await tp.anon().get('/api/quotes')).status).toBe(401);
    expect((await tp.anon().get('/api/dashboard')).status).toBe(401);
  });

  it('la API no acepta una organizacion que no viene del token', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, {
      customerName: 'Invasion',
      organizationId: TEST_ORG_B,
    } as any);

    // Se creo, pero en la organizacion del token, no en la que pedia.
    expect(creada.organizationId).toBe(TEST_ORG_A);

    const enB = await comoAdmin(TEST_ORG_B).get('/api/quotes?limit=500');
    expect(enB.body.items.some((q: any) => q.customerName === 'Invasion')).toBe(false);
  });
});

describe('cotizaciones', () => {
  it('crea una cotizacion con el folio siguiente y lo materializa', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { title: 'Diseno de identidad' });
    // 2 x 25000 = 50000, sin impuesto.
    expect(creada.subtotalCents).toBe(50000);
    expect(creada.taxCents).toBe(0);
    expect(creada.totalCents).toBe(50000);
    expect(creada.title).toBe('Diseno de identidad');
    expect(creada.number).toBeGreaterThan(0);
    expect(creada.status).toBe('draft');
  });

  it('el impuesto se calcula sobre el subtotal ya redondeado, en centavos enteros', async () => {
    // 3 x 3333 = 9999 (media linea de centavo: 0.5 x 3333 = 1666.5), y el 16% de
    // eso son 1599.84 centavos, que redondea a 1600.
    const creada = await nuevaCotizacion(TEST_ORG_A, {
      taxRateBp: 1600,
      lines: [{ description: 'Consultoria', qty: 0.5, unitPriceCents: 3333 }],
    });
    expect(creada.subtotalCents).toBe(1667);
    expect(creada.taxCents).toBe(Math.round((1667 * 1600) / 10_000));
    expect(creada.totalCents).toBe(creada.subtotalCents + creada.taxCents);
    // Enteros de punta a punta: un importe en float es un total que no cuadra
    // centavo a centavo.
    expect(Number.isInteger(creada.taxCents)).toBe(true);
    expect(Number.isInteger(creada.totalCents)).toBe(true);
  });

  it('guarda el precio de la linea CONGELADO y el importe de la linea una vez', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, {
      lines: [
        { description: 'Media hora', qty: 0.5, unitPriceCents: 3333 },
        { description: 'Traslado', qty: 3, unitPriceCents: 1234 },
      ],
    });
    const { body } = await comoMiembro(TEST_ORG_A).get(`/api/quotes/${creada.id}/lineas`);
    expect(body.lines).toHaveLength(2);
    expect(body.lines[0].unitPriceCents).toBe(3333);
    expect(body.lines[0].lineTotalCents).toBe(1667);
    expect(body.lines[1].lineTotalCents).toBe(3702);
    // El total es la suma de lo que se mostro en cada linea, no un redondeo al
    // final: si no, la suma de las lineas visibles no daria con el pie.
    expect(creada.subtotalCents).toBe(1667 + 3702);
  });

  it('el total no se recalcula al leer: cambiar la tasa de los ajustes no lo toca', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { title: 'Precio congelado' });
    expect(creada.totalCents).toBe(50000);

    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ currency: '$', timezone: 'America/Santiago', defaultTaxRateBp: 1900, validityDays: 30 });

    const despues = await comoMiembro(TEST_ORG_A).get(`/api/quotes/${creada.id}`);
    // La cotizacion viejo tiene que seguir valiendo lo que valia, o el
    // historico de la empresa cambia de la noche a la mañana.
    expect(despues.body.totalCents).toBe(50000);
    expect(despues.body.taxRateBp).toBe(0);
  });

  it('rechaza un folio repetido en la misma organizacion', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { title: 'Primera' });
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/quotes')
      .send({ customerName: 'Choca el folio', number: creada.number, lines: [] });
    // El indice UNIQUE (organization_id, number) tambien lo impediria, pero como
    // error de SQLite: el 409 dice que paso y en que numero.
    expect(res.status).toBe(409);
    expect(String(res.body.error)).toContain(String(creada.number));
  });

  it('el folio NO es global: dos organizaciones pueden empezar en 1', async () => {
    const a = await comoMiembro(TEST_ORG_A).post('/api/quotes').send({ customerName: 'A', number: 900, lines: [] });
    const b = await comoMiembro(TEST_ORG_B).post('/api/quotes').send({ customerName: 'B', number: 900, lines: [] });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(b.status, JSON.stringify(b.body)).toBe(201);
  });

  it('propone el folio siguiente como el maximo que existe mas uno', async () => {
    const res = await comoAdmin(TEST_ORG_A).get('/api/quotes/next-number');
    const lista = (await comoAdmin(TEST_ORG_A).get('/api/quotes?limit=500')).body.items;
    const maximo = Math.max(...lista.map((q: any) => q.number));
    // Si se calculara contando, borrar la ultima cotizacion haria que el folio
    // propuesto fuera uno que ya existe.
    expect(res.body.number).toBe(maximo + 1);
  });

  it('los ajustes traen el mismo folio siguiente que su propia ruta', async () => {
    const [ajustes, siguiente] = await Promise.all([
      comoAdmin(TEST_ORG_A).get('/api/settings'),
      comoAdmin(TEST_ORG_A).get('/api/quotes/next-number'),
    ]);
    // Si se calcularan por separado, la pantalla abriria el formulario con un
    // folio y el servidor responderia con otro.
    expect(ajustes.body.settings.nextNumber).toBe(siguiente.body.number);
  });

  it('exige nombre de cliente: la cotizacion tiene que poder leerse sola', async () => {
    const res = await comoMiembro(TEST_ORG_A).post('/api/quotes').send({ lines: [] });
    expect(res.status).toBe(400);
  });

  it('rechaza una fecha que no es una fecha', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/quotes')
      .send({ customerName: 'Ana', issueDate: 'proximo martes', lines: [] });
    expect(res.status).toBe(400);
  });

  it('rechaza una cantidad de linea cero o negativa', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/quotes')
      .send({ customerName: 'Ana', lines: [{ description: 'Nada', qty: 0, unitPriceCents: 100 }] });
    expect(res.status).toBe(400);
  });

  it('rechaza una tasa de impuesto que pasa de 100%', async () => {
    const res = await comoMiembro(TEST_ORG_A)
      .post('/api/quotes')
      .send({ customerName: 'Ana', taxRateBp: 10_001, lines: [] });
    expect(res.status).toBe(400);
  });
});

describe('editar cotizaciones', () => {
  it('un PATCH sin lineas conserva las que hay', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { notes: 'Nota original' });
    const parcheada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/quotes/${creada.id}`)
      .send({ customerName: 'Ana Torres Editada' });

    expect(parcheada.status, JSON.stringify(parcheada.body)).toBe(200);
    // Si el PATCH vaciara el detalle, cambiar el nombre de un cliente borraria las
    // lineas de su cotizacion.
    expect(parcheada.body.lines).toHaveLength(1);
    expect(parcheada.body.quote.customerName).toBe('Ana Torres Editada');
    expect(parcheada.body.quote.notes).toBe('Nota original');
    expect(parcheada.body.quote.totalCents).toBe(50000);
  });

  it('un PATCH con lineas reemplaza el detalle y recalcula el total', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    const parcheada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/quotes/${creada.id}`)
      .send({ lines: [{ description: 'Cambio', qty: 4, unitPriceCents: 1000 }] });

    expect(parcheada.body.quote.subtotalCents).toBe(4000);
    expect(parcheada.body.lines).toHaveLength(1);
    expect(parcheada.body.lines[0].description).toBe('Cambio');
  });

  it('sacar la ultima linea deja la cotizacion en cero, no con el total viejo', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    const parcheada = await comoMiembro(TEST_ORG_A).patch(`/api/quotes/${creada.id}`).send({ lines: [] });
    expect(parcheada.body.quote.subtotalCents).toBe(0);
    expect(parcheada.body.quote.totalCents).toBe(0);
    expect(parcheada.body.lines).toHaveLength(0);
  });

  it('el PATCH no cambia el estado aunque se lo manden', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    const parcheada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/quotes/${creada.id}`)
      .send({ status: 'accepted', customerName: 'Ana Torres' });

    // El estado tiene su propia ruta, que ademas sella la fecha. Si el PATCH
    // aceptara la cotizacion, se podria aceptar sin dejar rastro de cuando.
    expect(parcheada.status).toBe(200);
    expect(parcheada.body.quote.status).toBe('draft');
    expect(parcheada.body.quote.acceptedAt).toBeNull();
  });

  it('el PATCH no cambia el folio de una cotizacion que no manda numero', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    await nuevaCotizacion(TEST_ORG_A, { title: 'Ocupa el folio siguiente' });
    const parcheada = await comoMiembro(TEST_ORG_A)
      .patch(`/api/quotes/${creada.id}`)
      .send({ customerName: 'Ana Torres' });
    // Editar el cliente no puede mover el folio: el papel que tiene el cliente
    // impreso tiene que seguir siendo el mismo.
    expect(parcheada.body.quote.number).toBe(creada.number);
  });

  it('borrar la cotizacion se lleva sus lineas', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { title: 'Para borrar' });
    const res = await comoMiembro(TEST_ORG_A).delete(`/api/quotes/${creada.id}`);
    expect(res.status).toBe(200);

    // Las lineas se van con la cotizacion: el DDL las declara con ON DELETE
    // CASCADE, y una linea sin cotizacion no significa nada.
    expect((await comoMiembro(TEST_ORG_A).get(`/api/quotes/${creada.id}`)).status).toBe(404);
    const huerfanas = tp.sqlite
      .prepare('SELECT COUNT(*) n FROM quote_lines WHERE quote_id = ?')
      .get(creada.id) as { n: number };
    expect(huerfanas.n).toBe(0);
  });
});

describe('estados', () => {
  it('sella la fecha de envio y la de aceptacion', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    expect(creada.sentAt).toBeNull();

    const enviada = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'sent' });
    expect(enviada.status, JSON.stringify(enviada.body)).toBe(200);
    expect(enviada.body.quote.status).toBe('sent');
    expect(enviada.body.quote.sentAt).not.toBeNull();

    const aceptada = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'accepted' });
    expect(aceptada.body.quote.status).toBe('accepted');
    expect(aceptada.body.quote.acceptedAt).not.toBeNull();
  });

  it('rechaza volver a borrador una cotizacion aceptada', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { status: 'accepted' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'draft' });
    // Una cotizacion aceptada es un acuerdo con el cliente. Volverla a borrador
    // haria que "aceptada" dejara de significar algo.
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('no vuelve a borrador');
  });

  it('una cotizacion rechazada no vuelve a borrador', async () => {
    // Se puede cotizar OTRA vez, pero esa es una cotizacion nueva con su propio
    // folio: reabrir la rechazada destruiria el historico de por que se rechazo.
    const creada = await nuevaCotizacion(TEST_ORG_A);
    await comoMiembro(TEST_ORG_A).post(`/api/quotes/${creada.id}/estado`).send({ status: 'sent' });
    await comoMiembro(TEST_ORG_A).post(`/api/quotes/${creada.id}/estado`).send({ status: 'rejected' });

    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'draft' });
    expect(res.status).toBe(400);
  });

  it('una cotizacion vencida se puede reenviar con el mismo folio', async () => {
    // La oferta vencida la conoce el cliente: reenviarla con el mismo folio es lo
    // correcto, y el sello de la PRIMERA vez que se mando no se borra.
    const creada = await nuevaCotizacion(TEST_ORG_A);
    const primera = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'sent' });
    const sello = primera.body.quote.sentAt;

    await comoMiembro(TEST_ORG_A).post(`/api/quotes/${creada.id}/estado`).send({ status: 'expired' });
    const reenvio = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'sent' });

    expect(reenvio.body.quote.status).toBe('sent');
    expect(reenvio.body.quote.number).toBe(creada.number);
    expect(reenvio.body.quote.sentAt).toBe(sello);
  });

  it('repetir el estado actual no es un error', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    const otra = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'draft' });
    // El cliente puede reintentar un POST que ya llego: responder 400 lo haria
    // parecer un fallo.
    expect(otra.status).toBe(200);
  });

  it('rechaza un estado que el producto no conoce', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A);
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${creada.id}/estado`)
      .send({ status: 'hold' });
    expect(res.status).toBe(400);
  });
});

describe('tablero y ajustes', () => {
  it('agrupa por estado y suma el dinero que si esta sobre la mesa', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { title: 'Cotizacion del tablero' });
    await comoMiembro(TEST_ORG_A).post(`/api/quotes/${creada.id}/estado`).send({ status: 'sent' });

    const res = await comoMiembro(TEST_ORG_A).get('/api/dashboard');
    expect(res.status).toBe(200);
    // Se arman los cinco estados aunque alguno este vacio: una columna que
    // aparece y desaparece hace que la pantalla "salte" mientras se trabaja.
    expect(res.body.porEstado).toEqual({
      draft: expect.any(Number),
      sent: expect.any(Number),
      accepted: expect.any(Number),
      rejected: expect.any(Number),
      expired: expect.any(Number),
    });
    expect(res.body.porEstado.sent).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('el resumen no cuenta una cotizacion rechazada como dinero por cobrar', async () => {
    const creada = await nuevaCotizacion(TEST_ORG_A, { title: 'Se rechaza' });
    // Todavia esta en borrador: cuenta.
    const antes = await comoMiembro(TEST_ORG_A).get('/api/dashboard');
    expect(antes.body.totalCents).toBeGreaterThan(0);

    await comoMiembro(TEST_ORG_A).post(`/api/quotes/${creada.id}/estado`).send({ status: 'sent' });
    await comoMiembro(TEST_ORG_A).post(`/api/quotes/${creada.id}/estado`).send({ status: 'rejected' });
    const despues = await comoMiembro(TEST_ORG_A).get('/api/dashboard');

    // Una cotizacion rechazada no es una deuda ni una venta: sumarla daria un
    // numero que nadie debe y que haria tomar decisiones equivocadas.
    expect(despues.body.totalCents).toBe(antes.body.totalCents - creada.totalCents);
    // Pero la cotizacion sigue existiendo y sigue en la lista: rechazada no es
    // borrada.
    expect(despues.body.total).toBe(antes.body.total);
    expect(despues.body.porEstado.rejected).toBeGreaterThan(0);
  });

  it('guarda y devuelve los ajustes de la organizacion', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ currency: 'CLP', timezone: 'America/Santiago', defaultTaxRateBp: 1900, validityDays: 15 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.settings.currency).toBe('CLP');
    expect(res.body.settings.defaultTaxRateBp).toBe(1900);
    expect(res.body.settings.validityDays).toBe(15);

    const leidos = await comoAdmin(TEST_ORG_A).get('/api/settings');
    expect(leidos.body.settings.currency).toBe('CLP');

    // Se deja como estaba, para que los tests que viene no dependan de la moneda.
    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ currency: '$', timezone: 'America/Santiago', defaultTaxRateBp: 0, validityDays: 30 });
  });

  it('rechaza una vigencia de cero dias', async () => {
    const res = await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ currency: '$', timezone: 'America/Santiago', validityDays: 0 });
    expect(res.status).toBe(400);
  });

  it('los ajustes son por organizacion: lo de A no aparece en B', async () => {
    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ currency: 'EUR', timezone: 'America/Madrid', validityDays: 45 });
    const b = await comoAdmin(TEST_ORG_B).get('/api/settings');
    expect(b.body.settings.currency).not.toBe('EUR');
    expect(b.body.settings.validityDays).not.toBe(45);

    await comoAdmin(TEST_ORG_A)
      .put('/api/settings')
      .send({ currency: '$', timezone: 'America/Santiago', validityDays: 30 });
  });
});

describe('aislamiento entre organizaciones', () => {
  it('no deja ver una cotizacion de otra organizacion', async () => {
    const b = await nuevaCotizacion(TEST_ORG_B, { customerName: 'De Beta' });
    const res = await comoMiembro(TEST_ORG_A).get(`/api/quotes/${b.id}`);
    expect([403, 404]).toContain(res.status);
  });

  it('no deja modificar una cotizacion de otra organizacion', async () => {
    const b = await nuevaCotizacion(TEST_ORG_B, { customerName: 'De Beta' });
    const res = await comoMiembro(TEST_ORG_A)
      .patch(`/api/quotes/${b.id}`)
      .send({ customerName: 'Robada' });
    expect([403, 404]).toContain(res.status);

    const sigue = await comoMiembro(TEST_ORG_B).get(`/api/quotes/${b.id}`);
    expect(sigue.body.customerName).toBe('De Beta');
  });

  it('no deja borrar una cotizacion de otra organizacion', async () => {
    const b = await nuevaCotizacion(TEST_ORG_B, { customerName: 'De Beta' });
    const res = await comoMiembro(TEST_ORG_A).delete(`/api/quotes/${b.id}`);
    expect([403, 404]).toContain(res.status);
    expect((await comoMiembro(TEST_ORG_B).get(`/api/quotes/${b.id}`)).status).toBe(200);
  });

  it('no deja cambiar el estado de una cotizacion de otra organizacion', async () => {
    const b = await nuevaCotizacion(TEST_ORG_B, { customerName: 'De Beta' });
    const res = await comoMiembro(TEST_ORG_A)
      .post(`/api/quotes/${b.id}/estado`)
      .send({ status: 'accepted' });
    expect([403, 404]).toContain(res.status);
    expect((await comoMiembro(TEST_ORG_B).get(`/api/quotes/${b.id}`)).body.status).toBe('draft');
  });

  it('no deja leer las lineas de una cotizacion de otra organizacion', async () => {
    const b = await nuevaCotizacion(TEST_ORG_B, { customerName: 'De Beta' });
    const res = await comoMiembro(TEST_ORG_A).get(`/api/quotes/${b.id}/lineas`);
    expect([403, 404]).toContain(res.status);
  });

  it('el listado de A no trae cotizaciones de B', async () => {
    const res = await comoAdmin(TEST_ORG_A).get('/api/quotes?limit=500');
    expect(res.body.items.some((q: any) => q.customerName === 'De Beta')).toBe(false);
  });

  it('el tablero de A no suma el dinero de B', async () => {
    const antes = await comoAdmin(TEST_ORG_A).get('/api/dashboard');
    await nuevaCotizacion(TEST_ORG_B, { title: 'Caro', lines: [{ description: 'X', qty: 1, unitPriceCents: 999_999 }] });
    const despues = await comoAdmin(TEST_ORG_A).get('/api/dashboard');
    expect(despues.body.totalCents).toBe(antes.body.totalCents);
  });
});

describe('el esquema', () => {
  it('las tablas del producto son las que declara y ninguna mas', () => {
    const tablas = tp.tables();
    for (const t of ['quotes', 'quote_lines', 'settings', 'legacy_tenant_map']) {
      expect(tablas, `falta la tabla ${t}`).toContain(t);
    }
    // Este producto NO es dueno de los clientes ni del catalogo de servicios: si
    // aparecieran aca, se habria duplicado lo que es de otro producto.
    for (const t of ['customers', 'services', 'users', 'tenants']) {
      expect(tablas, `${t} no es de este producto`).not.toContain(t);
    }
  });

  it('cada tabla de negocio lleva organization_id y un indice por organizacion', () => {
    for (const tabla of ['quotes', 'quote_lines', 'settings', 'legacy_tenant_map']) {
      const columnas = tp.sqlite.prepare(`PRAGMA table_info(${tabla})`).all() as Array<{ name: string }>;
      expect(columnas.map((c) => c.name), `${tabla} sin organization_id`).toContain('organization_id');

      // Se revisa indice por indice: `PRAGMA index_info` toma UN nombre, asi que
      // preguntar por todos de una vez no se puede.
      const indices = tp.sqlite.prepare(`PRAGMA index_list(${tabla})`).all() as Array<{ name: string }>;
      const algunoConOrg = indices.some((indice) => {
        const cols = tp.sqlite.prepare(`PRAGMA index_info('${indice.name}')`).all() as Array<{ name: string }>;
        return cols.some((c) => c.name === 'organization_id');
      });
      expect(algunoConOrg, `${tabla} no tiene ningun indice por organization_id`).toBe(true);
    }
  });

  it('el folio es unico por organizacion y no global', () => {
    const indices = tp.sqlite.prepare('PRAGMA index_list(quotes)').all() as Array<{ name: string; unique: number }>;
    const unico = indices.find((i) => i.unique === 1 && i.name.includes('org_number'));
    expect(unico, 'no hay indice unico (organization_id, number)').toBeDefined();
  });
});
