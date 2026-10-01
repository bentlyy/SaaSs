/**
 * UI del inventario.
 *
 * Dos cosas que acá se notan:
 *
 * 1. No hay login. La sesión llega por cookie desde el Core; si no hay, el
 *    middleware ya redirigió al login central antes de servir este HTML.
 * 2. Cada petición va con `credentials: same-origin` (lo pone `AMIGO_UI.api`).
 *    Sin eso el navegador no manda la cookie y la API responde 401 aunque el
 *    usuario esté entered: el error clásico de "entra y dice que no".
 *
 * Lo que dibuja —tarjetas, tablas, botones, etiquetas— viene de `AMIGO_UI`, el
 * módulo compartido por los nueve productos. Acá queda solo lo del inventario:
 * qué columnas tiene su tabla y qué significa una baja de stock.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const fmt = new Intl.NumberFormat('es-CL');
const esc = AMIGO_UI.esc;

const estado = { articulos: [], me: null, editando: null };

/**
 * Formatea centavos. El símbolo sale de la configuración de la organización, no
 * de una constante: cada empresa guarda sus precios como quiere verlos.
 */
const pesos = (centavos) => {
  const simbolo = estado.settings?.currency ?? '$';
  return `${simbolo} ${fmt.format(Math.round(centavos / 100))}`;
};

const cuando = (iso) => (iso ? AMIGO_UI.fecha(iso, true) : '—');

// --- carga ------------------------------------------------------------------

async function cargar() {
  const [me, resumen, articulos, movs, config] = await Promise.all([
    api('/api/me'),
    api('/api/resumen'),
    api(`/api/items?q=${encodeURIComponent($('#buscar').value.trim())}`),
    api('/api/movements?limit=40'),
    api('/api/settings'),
  ]);
  estado.me = me;
  estado.articulos = articulos.items;
  estado.settings = config;
  pintarMe();
  pintarResumen(resumen);
  pintarArticulos();
  pintarMovimientos(movs.movements);
  renderConfig();
}

/**
 * El nombre de la persona, el de la empresa y el rol ya los pone `amigo.js` en el
 * canal lateral. Acá solo queda lo que es de este producto: esconder las
 * acciones de admin.
 *
 * Mover stock, dar de baja y sembrar son de admin: la UI lo oculta, pero la
 * garantía real está en la API, no acá.
 */
function pintarMe() {
  const puedeMover = estado.me.role === 'admin' || estado.me.role === 'owner';
  document.querySelectorAll('[data-requiere-admin]').forEach((el) => {
    el.hidden = !puedeMover;
  });
  // Sembrar solo existe fuera de produccion. Si el boton queda a la vista ahi,
  // el admin toca "Cargar ejemplos" y recibe un 404 sin explicacion de por que.
  const sembrar = $('#sembrar');
  if (sembrar) sembrar.hidden = !puedeMover || !estado.settings?.seedAvailable;
}

function pintarResumen(r) {
  const tarjetas = [
    ['Artículos', fmt.format(r.items)],
    ['Unidades', fmt.format(r.unidades)],
    ['Valor de stock', pesos(r.valorCents)],
    ['Movimientos', fmt.format(r.movimientos)],
  ];
  // El stock bajo va aparte y con color: es lo único de esta lista que pide una
  // acción, y mezclado con los otros números nadie lo nota.
  if (r.stockBajo > 0) {
    tarjetas.push([r.stockBajo === 1 ? '1 artículo en stock bajo' : `${fmt.format(r.stockBajo)} artículos en stock bajo`, 'Revisar', true]);
  }
  AMIGO_UI.kpis($('#resumen'), tarjetas);
}

function pintarArticulos() {
  const cuerpo = $('#filas');
  if (estado.articulos.length === 0) {
    cuerpo.replaceChildren(AMIGO_UI.filaVacia(6, 'Todavía no hay artículos. Creá el primero.'));
    return;
  }

  const cuerpoTabla = [];
  for (const a of estado.articulos) {
    const bajo = a.quantity <= a.minQuantity;
    const stock = document.createElement('div');
    stock.append(document.createTextNode(fmt.format(a.quantity)));
    if (bajo) {
      // El mínimo se escribe al lado de la cantidad y no en otra columna: la
      // pregunta "¿cuánto le falta?" se responde leyendo el mismo numero.
      const nota = document.createElement('small');
      nota.className = 'tenue';
      nota.textContent = ` (mín ${fmt.format(a.minQuantity)})`;
      stock.append(nota);
    }

    const acciones = AMIGO_UI.celda(
      AMIGO_UI.boton('Editar', () => abrirEdicion(a)),
      AMIGO_UI.boton('Mover', () => abrirMovimiento(a), 'ui-btn ui-btn--chico'),
      AMIGO_UI.boton('Baja', () => darDeBaja(a), 'ui-btn ui-btn--chico ui-btn--fantasma'),
    );
    acciones.firstChild.dataset.requiereAdmin = '';

    cuerpoTabla.push(AMIGO_UI.fila([a.name, a.sku || '—', stock, a.unit, pesos(a.priceCents), acciones], { className: 'acciones' }));
  }
  cuerpo.replaceChildren(...cuerpoTabla);
}

function pintarMovimientos(movs) {
  const cuerpo = $('#movimientos');
  if (movs.length === 0) {
    cuerpo.replaceChildren(AMIGO_UI.filaVacia(5, 'Sin movimientos todavía.'));
    return;
  }

  const filas = [];
  for (const m of movs) {
    const delta = document.createElement('span');
    delta.className = m.delta > 0 ? 'ui-etiqueta ui-etiqueta--ok' : 'ui-etiqueta ui-etiqueta--malo';
    delta.textContent = (m.delta > 0 ? '+' : '') + fmt.format(m.delta);
    filas.push(AMIGO_UI.fila([delta, m.itemName || '—', m.reason, m.actorName || '—', cuando(m.createdAt)]));
  }
  cuerpo.replaceChildren(...filas);
}

// --- configuración ----------------------------------------------------------

/**
 * Rellena el form de configuración.
 *
 * Se recorre `form.elements` y no se busca cada input por id: el form es la
 * lista de campos, y si mañana se agrega uno queda guardado sin tocar esta
 * función. Los ids quedan para el `<label for>`.
 */
function renderConfig() {
  const form = $('#config-form');
  const s = estado.settings ?? {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (s[el.name] === undefined) continue;
    el.value = s[el.name];
  }
}

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const err = $('[data-err]', form);
  err.textContent = '';
  const f = new FormData(form);
  const boton = $('button[type=submit]', form);
  boton.disabled = true;
  try {
    estado.settings = await api('/api/settings', {
      method: 'PUT',
      body: {
        defaultUnit: f.get('defaultUnit'),
        defaultMinQuantity: Number(f.get('defaultMinQuantity')),
        currency: f.get('currency'),
      },
    });
  } catch (e) {
    // El error se muestra junto al form, no en un alert: es un problema de un
    // campo, y la persona lo tiene a la vista.
    err.textContent = e.message;
  } finally {
    boton.disabled = false;
  }
});

$('#sembrar').onclick = async () => {
  if (!confirm('Cargar artículos de ejemplo en esta organización?')) return;
  try {
    const r = await api('/api/seed', { method: 'POST' });
    await cargar();
    alert(r.creados ? `Se cargaron ${r.creados} artículos de ejemplo.` : r.nota);
  } catch (e) {
    alert(e.message);
  }
};

// --- diálogos ---------------------------------------------------------------

const dialogo = $('#dialogo');

/** El error vive en un `#error` que se muestra y se esconde, no en un alert. */
function mostrarError(mensaje) {
  const caja = $('#error');
  caja.textContent = mensaje;
  caja.hidden = !mensaje;
}

function abrir(titulo, campos, onGuardar) {
  $('#titulo').textContent = titulo;
  mostrarError('');
  $('#campos').replaceChildren(
    ...campos.map((c) => {
      const div = document.createElement('div');
      div.className = 'ui-campo';
      const id = `c_${c.name}`;
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = c.label;
      const input = document.createElement('input');
      input.id = id;
      input.name = c.name;
      input.type = c.type || 'text';
      input.value = c.value ?? '';
      if (c.required) input.required = true;
      if (c.step) input.step = c.step;
      if (c.min !== undefined) input.min = c.min;
      div.append(label, input);
      return div;
    }),
  );
  dialogo.returnValue = '';
  dialogo.showModal();
  dialogo.onclose = async () => {
    if (dialogo.returnValue !== 'guardar') return;
    const datos = Object.fromEntries(
      [...$('#campos').querySelectorAll('input')].map((i) => [i.name, i.value]),
    );
    try {
      await onGuardar(datos);
      await cargar();
    } catch (err) {
      mostrarError(err.message);
      dialogo.showModal();
    }
  };
}

$('#nuevo').onclick = () =>
  abrir(
    'Nuevo artículo',
    [
      { name: 'name', label: 'Nombre', required: true },
      { name: 'sku', label: 'SKU' },
      {
        name: 'minQuantity',
        label: 'Stock mínimo',
        type: 'number',
        min: 0,
        value: estado.settings?.defaultMinQuantity ?? 0,
      },
      { name: 'unit', label: 'Unidad', value: estado.settings?.defaultUnit ?? 'unidad' },
      { name: 'priceCents', label: 'Precio en centavos', type: 'number', min: 0, value: 0 },
    ],
    (datos) => api('/api/items', { method: 'POST', body: datos }),
  );

function abrirEdicion(a) {
  abrir(
    `Editar ${a.name}`,
    [
      { name: 'name', label: 'Nombre', value: a.name, required: true },
      { name: 'sku', label: 'SKU', value: a.sku ?? '' },
      { name: 'minQuantity', label: 'Stock mínimo', type: 'number', min: 0, value: a.minQuantity },
      { name: 'unit', label: 'Unidad', value: a.unit },
      { name: 'priceCents', label: 'Precio en centavos', type: 'number', min: 0, value: a.priceCents },
    ],
    (datos) => api(`/api/items/${a.id}`, { method: 'PATCH', body: datos }),
  );
}

function abrirMovimiento(a) {
  abrir(
    `Mover stock de ${a.name}`,
    [
      { name: 'delta', label: 'Cantidad (negativa para salir)', type: 'number', required: true, step: '1' },
      { name: 'reason', label: 'Motivo', required: true },
    ],
    (datos) =>
      api(`/api/items/${a.id}/movements`, {
        method: 'POST',
        body: { delta: Number(datos.delta), reason: datos.reason },
      }),
  );
}

async function darDeBaja(a) {
  if (!confirm(`¿Dar de baja ${a.name}? Se conserva el historial.`)) return;
  try {
    await api(`/api/items/${a.id}`, { method: 'DELETE' });
    await cargar();
  } catch (err) {
    alert(err.message);
  }
}

// --- arranque ---------------------------------------------------------------

let temporizador;
$('#buscar').oninput = () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => api(`/api/items?q=${encodeURIComponent($('#buscar').value.trim())}`)
    .then((r) => { estado.articulos = r.items; pintarArticulos(); })
    .catch(() => {}), 250);
};

/**
 * Sin `alEntrar` a propósito: `cargar()` ya pide artículos, movimientos y
 * ajustes a la vez, y se vuelve a ejecutar después de cada cambio. Un refresco
 * por panel sería la misma llamada dos veces para ver lo mismo.
 */
AMIGO.montar({
  nombre: 'inventario',
  paneles: ['articulos', 'movimientos', 'configuracion'],
});

cargar().catch((err) => {
  if (err.vencida) return;
  const aviso = document.createElement('p');
  aviso.className = 'ui-aviso ui-aviso--malo';
  aviso.textContent = `No pudimos cargar el inventario: ${err.message}`;
  document.querySelector('.ui-main').prepend(aviso);
});
