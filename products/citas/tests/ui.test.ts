import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * La pantalla de Citas contra el DOM de verdad.
 *
 * Estos tests existen por una razon concreta: los tres bugs mas graves que
 * salieron en produccion eran TODOS de frontend, y los 37 tests que habia
 * pasaban igual con la app rota. Sonaba a backend, porque el backend contestaba
 * bien; lo que estaba roto era que la UI no miraba lo que el backend mandaba.
 *
 *   - Los catalogos salen de `crudRouter` como `{ items, total, limit, offset }`.
 *     La UI leia `{ customers }` y se comia un `undefined.map`: los cuatro
 *     paneles quedaban en blanco, sin tabla y sin estado vacio.
 *   - "Nueva cita" llenaba sus selectores con catalogos que recien se cargaban al
 *     abrir cada panel, asi que se abria con los desplegables vacios. Y si el
 *     relleno fallaba, el `showModal()` nunca llegaba: el boton no hacia nada.
 *   - Tras un alta correcta, el refresco de la lista fallaba y el `catch`
 *     reportaba ese error como si el alta hubiera fallado, escribiendolo en una
 *     caja de error DENTRO del dialogo ya cerrado. El usuario no veia nada.
 *
 * El `fetch` va de mentira y devuelve la FORMA REAL de cada respuesta. Si
 * `crudRouter` cambia su contrato, o la UI vuelve a leer una clave que no existe,
 * falla aca y no en produccion.
 */

process.env.TZ = 'America/Santiago';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const COMUN = join(RAIZ, '..', '..', 'packages', 'product-runtime', 'public');

const leer = (ruta: string): string => readFileSync(ruta, 'utf8');

/** El taller trabaja en Mexico City: seis horas antes que UTC y que Santiago. */
const ZONA_TALLER = 'America/Mexico_City';

/** Las respuestas que el producto recibe de verdad, con su forma de verdad. */
function respuestas(): Record<string, unknown> {
  return {
    '/api/resumen': { futuras: 3, hoy: 1, porConfirmar: 2 },
    '/api/settings': {
      settings: {
        id: 'cfg_1',
        timezone: ZONA_TALLER,
        currency: '$',
        reminderHours: 12,
        emailEnabled: false,
      },
    },
    // 2026-10-06T04:00Z son las 22:00 del 5 de octubre en Mexico City.
    '/api/agenda': {
      appointments: [
        {
          id: 'cita_1',
          customerId: 'cicliente_1',
          staffId: 'citapero_1',
          startAt: '2026-10-06T04:00:00.000Z',
          endAt: '2026-10-06T04:30:00.000Z',
          notes: null,
          status: 'confirmed',
          totalCents: 12000,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: null,
          customerName: 'Irene Campos',
          staffName: 'Marco Ruiz',
        },
      ],
    },
    // La clave es `items`. Asi la respondio siempre.
    '/api/customers': {
      items: [
        { id: 'cicliente_1', name: 'Irene Campos', phone: '+52 55 0000 0001', email: null, tags: 'vip' },
        { id: 'cicliente_2', name: 'Ana Torres', phone: null, email: 'ana@example.com', tags: null },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    },
    '/api/services': {
      items: [
        { id: 'citaserv_1', name: 'Corte', durationMin: 30, priceCents: 12000, active: true },
        { id: 'citaserv_2', name: ' alignments', durationMin: 45, priceCents: 15000, active: false },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    },
    '/api/staff': {
      items: [
        { id: 'citapero_1', name: 'Marco Ruiz', phone: null, color: '#4f46e5', active: true },
        { id: 'citapero_2', name: 'Lucia Ortega', phone: null, color: '#0ea5e9', active: true },
      ],
      total: 2,
      limit: 200,
      offset: 0,
    },
    '/api/reminders': { reminders: [] },
  };
}

interface Harness {
  window: Window & typeof globalThis;
  document: Document;
  /** Las peticiones que la UI hizo, en orden. */
  llamadas: Array<{ metodo: string; ruta: string; cuerpo: any }>;
  /** Cuantas filas tiene la tabla de un panel. */
  filas(selector: string): number;
  textos(selector: string): string[];
  /** El id del primer `<option>` de un `<select>`. */
  valor(selector: string): string;
  /** Espera a que se vacien las promesas pendientes. */
  settle(): Promise<void>;
}

let SECUENCIA = 0;

async function montar(panel = 'agenda'): Promise<Harness> {
  SECUENCIA += 1;
  const respuestasBase = respuestas();
  const llamadas: Harness['llamadas'] = [];
  const creadas: Record<string, any[]> = {};

  const dom = new JSDOM(leer(join(RAIZ, 'public', 'index.html')), {
    url: `https://citas.test/?panel=${panel}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;

  // jsdom no implementa `<dialog>` modal. Lo que importa para estos tests es que
  // `showModal()` y `close()` cambien `open`; el dialogo de verdad ya se probo en
  // el navegador.
  const proto = window.HTMLDialogElement.prototype as unknown as {
    showModal?: () => void;
    close?: () => void;
  };
  proto.showModal = function (this: HTMLDialogElement) {
    this.open = true;
  };
  proto.close = function (this: HTMLDialogElement) {
    this.open = false;
  };

  const ajuste = (ruta: string, cuerpo: any) => {
    // El alta primero: si no, la rama de lectura se la come.
    if (cuerpo && ruta === '/api/customers') {
      const nuevo = { id: `cicliente_nuevo_${SECUENCIA}`, ...cuerpo };
      (creadas['/api/customers'] ??= []).push(nuevo);
      return { status: 201, body: nuevo };
    }
    // Cualquier lectura de clientes incluye lo que se haya creado en el test, y
    // con el filtro `q` que manda el buscador del panel.
    if (ruta.startsWith('/api/customers')) {
      const base = (respuestasBase['/api/customers'] as { items: any[] }).items;
      const items = [...base, ...(creadas['/api/customers'] ?? [])];
      const q = new URL(`https://x${ruta}`).searchParams.get('q');
      const filtrados = q
        ? items.filter((c) => `${c.name} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase()))
        : items;
      return {
        status: 200,
        body: { items: filtrados, total: filtrados.length, limit: 200, offset: 0 },
      };
    }
    for (const [rutaBase, cuerpoRespuesta] of Object.entries(respuestasBase)) {
      if (ruta === rutaBase || ruta.startsWith(`${rutaBase}?`)) {
        return { status: 200, body: cuerpoRespuesta };
      }
    }
    // `staffId` cambia el id, la clave sigue siendo `items`.
    if (ruta.startsWith('/api/schedules') || ruta.startsWith('/api/blocks')) {
      return { status: 200, body: { items: [] } };
    }
    return { status: 404, body: { error: `sin stub para ${ruta}` } };
  };

  window.fetch = (async (entrada: any, init: any = {}) => {
    const ruta = String(entrada);
    const metodo = (init?.method ?? 'GET').toUpperCase();
    let cuerpo: any = null;
    if (typeof init?.body === 'string') {
      try {
        cuerpo = JSON.parse(init.body);
      } catch {
        cuerpo = init.body;
      }
    }
    llamadas.push({ metodo, ruta, cuerpo });

    const { status, body } = ajuste(ruta, metodo === 'POST' ? cuerpo : null);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof window.fetch;

  // Lo que en produccion aparecia era un `TypeError` tragado por el `catch` que
  // muestra el error en la barra. Acá se anotan los que se escapan, que son los
  // que rompen la pantalla sin avisar.
  const errores: string[] = [];
  (window as unknown as { __errores: string[] }).__errores = errores;
  window.addEventListener('error', (ev) => {
    errores.push(String((ev as ErrorEvent).message ?? ev));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    errores.push(String((ev as PromiseRejectionEvent).reason));
  });

  window.eval(leer(join(COMUN, 'amigo-ui.js')));
  window.eval(leer(join(COMUN, 'amigo.js')));
  window.eval(leer(join(RAIZ, 'public', 'app.js')));

  const doc = window.document;
  const settle = async () => {
    for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0));
  };
  await settle();

  return {
    window,
    document: doc,
    llamadas,
    settle,
    filas: (sel) => doc.querySelectorAll(`${sel} tbody tr`).length,
    textos: (sel) => Array.from(doc.querySelectorAll(`${sel} tbody tr`)).map((f) => f.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    valor: (sel) => (doc.querySelector(sel) as HTMLSelectElement | null)?.value ?? '',
  };
}

/** El texto del banner de avisos, o null si esta oculto. */
function aviso(h: Harness): string | null {
  const caja = h.document.getElementById('aviso');
  if (!caja || (caja as HTMLDivElement).hidden) return null;
  return caja.textContent?.trim() || null;
}

/** Los errores que la UI lanzo de verdad, que es lo que aparecio en produccion. */
function erroresLanzados(h: Harness): string[] {
  return (h.window as unknown as { __errores?: string[] }).__errores ?? [];
}

describe('los catalogos se pintan', () => {
  it('Clientes lista los clientes que devuelve la API', async () => {
    const h = await montar('clientes');
    // Antes: cero filas, porque `customers` era `undefined` y `.map` reventaba.
    expect(h.filas('#clientes')).toBe(2);
    expect(h.textos('#clientes').join(' ')).toContain('Irene Campos');
    expect(h.textos('#clientes').join(' ')).toContain('Ana Torres');
    expect(erroresLanzados(h)).toEqual([]);
  });

  it('Servicios lista los servicios con su duracion y su precio', async () => {
    const h = await montar('servicios');
    expect(h.filas('#servicios')).toBe(2);
    const texto = h.textos('#servicios').join(' ');
    expect(texto).toContain('Corte');
    expect(texto).toContain('30 min');
    expect(texto).toContain('$120');
  });

  it('Profesionales lista los profesionales', async () => {
    const h = await montar('profesionales');
    expect(h.filas('#profesionales')).toBe(2);
    expect(h.textos('#profesionales').join(' ')).toContain('Marco Ruiz');
  });

  it('Horarios ofrece elegir un profesional', async () => {
    const h = await montar('horarios');
    const sel = h.document.getElementById('horario-profesional') as HTMLSelectElement;
    expect(sel.options.length).toBe(2);
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(['Marco Ruiz', 'Lucia Ortega']);
  });

  it('Avisos aguanta la lista vacia sin romperse', async () => {
    const h = await montar('avisos');
    expect(h.filas('#avisos')).toBe(1); // la fila de "Todavia no se mando ningun aviso"
    expect(erroresLanzados(h)).toEqual([]);
  });
});

describe('el boton "Nueva cita"', () => {
  it('abre el dialogo', async () => {
    const h = await montar('agenda');
    const dlg = h.document.getElementById('dlg') as HTMLDialogElement;
    expect(dlg.open).toBe(false);
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();
    expect(dlg.open).toBe(true);
  });

  it('trae clientes y profesionales para elegir', async () => {
    // El bug: los catalogos se cargaban al abrir su panel, asi que desde la
    // Agenda los desplegables iban vacios y "Agendar" no dejaba confirmar nada.
    const h = await montar('agenda');
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();

    const clientes = h.document.getElementById('c-cliente') as HTMLSelectElement;
    const profesionales = h.document.getElementById('c-profesional') as HTMLSelectElement;
    const servicios = h.document.getElementById('c-servicio') as HTMLSelectElement;

    expect(Array.from(clientes.options).map((o) => o.textContent)).toEqual(['Irene Campos', 'Ana Torres']);
    expect(Array.from(profesionales.options).map((o) => o.textContent)).toEqual(['Marco Ruiz', 'Lucia Ortega']);
    expect(servicios.options.length).toBe(3); // "sin servicio" + los dos del catalogo
  });

  it('sigue abriendo aunque el relleno de los selectores falle', async () => {
    // Antes el `showModal()` venia DESPUES del relleno: si este fallaba, el
    // boton no hacia absolutamente nada, sin error y sin aviso.
    const h = await montar('agenda');
    h.window.eval('window.llenarSelectores = () => { throw new Error("revento el relleno"); };');
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();
    expect((h.document.getElementById('dlg') as HTMLDialogElement).open).toBe(true);
  });

  it('dice algo util cuando el catalogo esta vacio, en vez de un desplegable mudo', async () => {
    const h = await montar('agenda');
    h.window.fetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ items: [], total: 0, limit: 200, offset: 0 }),
    })) as never;
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();
    const clientes = h.document.getElementById('c-cliente') as HTMLSelectElement;
    expect(clientes.textContent).toMatch(/sin clientes/i);
  });
});

describe('el precio de la cita', () => {
  it('se llena con el precio del catalogo al elegir el servicio', async () => {
    // Antes el campo se quedaba en 0 y la cita se guardaba con
    // `totalCents: 0`: el taller vendia el trabajo y la agenda no abria nada.
    // El campo esta en centavos, que es la unidad de la API: por eso el
    // catalogo muestra "$ 150" y el campo recibe 15000.
    const h = await montar('agenda');
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();

    const servicios = h.document.getElementById('c-servicio') as HTMLSelectElement;
    const precio = h.document.getElementById('c-precio') as HTMLInputElement;

    servicios.value = 'citaserv_2'; // Alineacion, 15000 centavos
    servicios.dispatchEvent(new h.window.Event('change', { bubbles: true }));

    expect(precio.value).toBe('15000');
  });

  it('la cita guarda lo que dice el campo, sin que el navegador convierta', async () => {
    // La regla del repo: el frontend no multiplica ni divide montos, la
    // conversion vive en el backend y en `AMIGO_UI.dinero`. El campo esta en
    // centavos y lo que tiene es lo que se guarda.
    const h = await montar('agenda');
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();

    (h.document.getElementById('c-cliente') as HTMLSelectElement).value = 'cicliente_1';
    (h.document.getElementById('c-profesional') as HTMLSelectElement).value = 'citapero_1';
    (h.document.getElementById('c-fecha') as HTMLInputElement).value = '2026-10-13';
    (h.document.getElementById('c-hora') as HTMLInputElement).value = '09:00';
    (h.document.getElementById('c-hora-fin') as HTMLInputElement).value = '10:00';
    const servicios = h.document.getElementById('c-servicio') as HTMLSelectElement;
    servicios.value = 'citaserv_1';
    servicios.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    (h.document.getElementById('form-cita') as HTMLFormElement).dispatchEvent(
      new h.window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await h.settle();

    const post = h.llamadas.find((c) => c.metodo === 'POST' && c.ruta === '/api/appointments');
    // Corte vale 12000 centavos = $120. Mandar 120 (lo que se ve en el catalogo)
    // seria una cita de $1,20.
    expect(post?.cuerpo.services).toEqual([{ serviceId: 'citaserv_1', priceCents: 12000 }]);
  });

  it('volver a abrir el dialogo no arrastra el precio del servicio anterior', async () => {
    const h = await montar('agenda');
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();
    const servicios = h.document.getElementById('c-servicio') as HTMLSelectElement;
    const precio = h.document.getElementById('c-precio') as HTMLInputElement;

    servicios.value = 'citaserv_1';
    servicios.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    precio.value = '999'; // el taller lo corrige a mano
    (h.document.getElementById('c-cancelar') as HTMLButtonElement).click();

    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();
    // Sin servicio elegido no hay precio que arrastrar.
    expect(precio.value).toBe('0');
  });
});

describe('la agenda no pide el dia en UTC', () => {
  it('la primera y unica peticion ya sale con el rango de la zona del taller', async () => {
    // `AMIGO.montar()` pintaba el panel inicial antes de que llegaran los
    // ajustes, y sin `settings.timezone` la zona cae en UTC: salia un rango
    // 00:00Z-23:59Z que se pedia otra vez despues. Un request de mas y, entre
    // las dos respuestas, un parpadeo con el dia equivocado.
    const h = await montar('agenda');
    const pedidos = h.llamadas.filter((c) => c.ruta.startsWith('/api/agenda'));
    expect(pedidos).toHaveLength(1);
    // Mexico City es UTC-6: el dia arranca a las 06:00Z y termina a las 05:59Z
    // del dia siguiente. A medianoche UTC le faltan las seis primeras horas.
    expect(pedidos[0].ruta).toMatch(/from=\d{4}-\d{2}-\d{2}T06:00:00\.000Z/);
    expect(pedidos[0].ruta).toMatch(/to=\d{4}-\d{2}-\d{2}T05:59:00\.000Z/);
  });

  it('cambiar de seccion en el canal vuelve a pedir la agenda', async () => {
    // El shell llama a `window.AMIGO_alEntrar`, un global que ningun producto
    // define: el panel se mostraba y no se pedia nada, asi que aparecia vacio.
    const h = await montar('agenda');
    expect(h.llamadas.filter((c) => c.ruta.startsWith('/api/agenda'))).toHaveLength(1);
    expect(h.filas('#clientes')).toBe(0); // todavia no se pinto: el panel esta oculto

    h.document.querySelector<HTMLAnchorElement>('[data-tab="clientes"]')!.click();
    await h.settle();
    expect(h.filas('#clientes')).toBe(2);
    expect(h.textos('#clientes').join(' ')).toContain('Irene Campos');
  });

  it('el boton de atras del navegador tambien repinta el panel', async () => {
    const h = await montar('agenda');
    h.document.querySelector<HTMLAnchorElement>('[data-tab="servicios"]')!.click();
    await h.settle();
    expect(h.filas('#servicios')).toBe(2);

    h.window.history.back();
    h.window.dispatchEvent(new h.window.PopStateEvent('popstate'));
    await h.settle();
    expect(h.filas('#dia')).toBe(1);
  });
});

describe('crear un cliente', () => {
  it('confirma el alta y la lista muestra al recien creado', async () => {
    const h = await montar('clientes');
    const form = h.document.getElementById('form-cli') as HTMLFormElement;
    (h.document.getElementById('cli-nombre') as HTMLInputElement).value = 'Cliente Nuevo';
    (h.document.getElementById('cli-telefono') as HTMLInputElement).value = '+56 9 0000 0000';

    form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
    await h.settle();

    const post = h.llamadas.find((c) => c.metodo === 'POST' && c.ruta === '/api/customers');
    expect(post?.cuerpo).toMatchObject({ name: 'Cliente Nuevo' });
    // El alta se confirma apenas ocurre: antes el mensaje de exito estaba DESPUES
    // del refresco, y si el refresco fallaba no se veia nunca.
    expect(aviso(h)).toBe('Cliente creado');
    expect(h.textos('#clientes').join(' ')).toContain('Cliente Nuevo');
    expect(erroresLanzados(h)).toEqual([]);
  });

  it('muestra el error del servidor adentro del dialogo, con el dialogo abierto', async () => {
    const h = await montar('clientes');
    h.window.fetch = (async (entrada: any, init: any) => {
      const ruta = String(entrada);
      if (ruta === '/api/customers' && init?.method === 'POST') {
        return { ok: false, status: 400, json: async () => ({ error: 'Datos invalidos' }) };
      }
      return { ok: true, status: 200, json: async () => respuestas()[ruta.split('?')[0]] ?? { items: [] } };
    }) as never;

    // El dialogo abierto es la situacion real: sin el, la caja de error esta
    // dentro del dialogo y no se ve. Por eso el dialogo NO se cierra cuando el
    // alta falla.
    (h.document.getElementById('nuevo-cli') as HTMLButtonElement).click();
    const form = h.document.getElementById('form-cli') as HTMLFormElement;
    (h.document.getElementById('cli-nombre') as HTMLInputElement).value = 'Malo';
    form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
    await h.settle();

    const caja = h.document.getElementById('cli-error') as HTMLDivElement;
    expect(caja.hidden).toBe(false);
    expect(caja.textContent).toContain('Datos invalidos');
    expect((h.document.getElementById('dlg-cli') as HTMLDialogElement).open).toBe(true);
  });
});

describe('la hora es la del taller, no la del navegador', () => {
  it('el navegador simulado esta en Santiago y el taller en Mexico City', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('America/Santiago');
  });

  it('la cita de las 22:00 aparece en su hora, no corrida tres horas', async () => {
    const h = await montar('agenda');
    const h5 = h.document.getElementById('fecha') as HTMLInputElement;
    h5.value = '2026-10-05';
    h5.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    await h.settle();

    // La cita es 2026-10-06T04:00Z: en Mexico City es el 5 a las 22:00.
    // Con la zona del taller tiene que CAER en el dia 5 y verse a las 22:00.
    const pedidoDelDia5 = h.llamadas.filter((c) => c.ruta.startsWith('/api/agenda')).at(-1);
    const desde = new URL(`https://x${pedidoDelDia5!.ruta}`).searchParams.get('from')!;
    const hasta = new URL(`https://x${pedidoDelDia5!.ruta}`).searchParams.get('to')!;
    const t = Date.parse('2026-10-06T04:00:00.000Z');
    expect(t).toBeGreaterThanOrEqual(Date.parse(desde));
    expect(t).toBeLessThanOrEqual(Date.parse(hasta));

    const filas = h.textos('#dia');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatch(/10:00\s*p\.\s*m\./);
    // Y no puede verse a la 01:00, que es lo que pasaba con la zona del navegador.
    expect(filas[0]).not.toMatch(/01:00/);
  });

  it('el rango del dia sale de la zona del taller, no de la medianoche del navegador', async () => {
    const h = await montar('agenda');
    const h5 = h.document.getElementById('fecha') as HTMLInputElement;
    h5.value = '2026-10-05';
    h5.dispatchEvent(new h.window.Event('change', { bubbles: true }));
    await h.settle();

    const ultima = h.llamadas.filter((c) => c.ruta.startsWith('/api/agenda')).at(-1)!;
    const desde = new URL(`https://x${ultima.ruta}`).searchParams.get('from')!;
    // 2026-10-05T00:00 en Mexico City son las 06:00 UTC. Con el navegador en
    // Santiago el rango arrancaba a las 03:00 UTC, seis horas antes de tiempo.
    expect(desde).toBe('2026-10-05T06:00:00.000Z');
  });

  it('"Nueva cita" manda la hora del taller, no la del navegador', async () => {
    const h = await montar('agenda');
    (h.document.getElementById('nueva') as HTMLButtonElement).click();
    await h.settle();

    (h.document.getElementById('c-fecha') as HTMLInputElement).value = '2026-10-09';
    (h.document.getElementById('c-hora') as HTMLInputElement).value = '09:00';
    (h.document.getElementById('c-hora-fin') as HTMLInputElement).value = '10:00';
    (h.document.getElementById('form-cita') as HTMLFormElement).dispatchEvent(
      new h.window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await h.settle();

    const post = h.llamadas.find((c) => c.metodo === 'POST' && c.ruta === '/api/appointments');
    // 09:00 en Mexico City = 15:00 UTC. Con el navegador en Santiago eran las
    // 12:00 UTC: la cita se guardaba corrida tres horas.
    expect(post?.cuerpo.startAt).toBe('2026-10-09T15:00:00.000Z');
    expect(post?.cuerpo.endAt).toBe('2026-10-09T16:00:00.000Z');
  });
});

describe('el resumen de la portada', () => {
  it('pinta las tres tarjetas con lo que devuelve la API', async () => {
    const h = await montar('agenda');
    const tarjetas = h.document.querySelectorAll('#resumen .ui-kpi__etiqueta');
    expect(Array.from(tarjetas).map((t) => t.textContent)).toEqual(['1', '3', '2']);
  });
});
