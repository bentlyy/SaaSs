/**
 * UI del inventario.
 *
 * Dos cosas que acá se notan:
 *
 * 1. No hay login. La sesión llega por cookie desde el Core; si no hay, el
 *    middleware ya redirigió al login central antes de servir este HTML.
 * 2. Cada `fetch` manda `credentials: same-origin` a propósito. Sin eso el
 *    navegador no manda la cookie y la API responde 401 aunque el usuario esté
 *   entered: el error clásico de "entra y dice que no".
 */

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('es-CL');

/**
 * Formatea centavos. El símbolo sale de la configuración de la organización, no
 * de una constante: cada empresa guarda sus precios como quiere verlos.
 */
const pesos = (centavos) => {
  const simbolo = estado.settings?.currency ?? '$';
  return `${simbolo} ${fmt.format(Math.round(centavos / 100))}`;
};

const estado = { articulos: [], me: null, editando: null };

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
  });
  if (res.status === 401) {
    // La sesión central venció o la suscripción ya no está: volvemos al login.
    const cuerpo = await res.json().catch(() => ({}));
    if (cuerpo.loginUrl) {
      window.location.href = cuerpo.loginUrl;
      throw new Error('sesion vencida');
    }
  }
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalle = cuerpo.errors?.fieldErrors
      ? Object.entries(cuerpo.errors.fieldErrors)
          .map(([campo, msgs]) => `${campo}: ${msgs.join(' ')}`)
          .join(' · ')
      : cuerpo.error || `Error ${res.status}`;
    throw new Error(detalle);
  }
  return cuerpo;
}

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

function pintarMe() {
  const { user, organization, role } = estado.me;
  $('#usuario').textContent = user.name || user.email;
  $('#org').textContent = organization.slug;
  $('#rol').textContent = role;
  $('#org-nombre').textContent = organization.name || organization.slug;
  // Mover stock, dar de baja y guardar la configuración son de admin: la UI lo
  // oculta, pero la garantía real está en la API, no acá.
  const puedeMover = role === 'admin' || role === 'owner';
  document.querySelectorAll('[data-requiere-admin]').forEach((el) => {
    el.classList.toggle('oculto', !puedeMover);
  });
}

function pintarResumen(r) {
  const tarjetas = [
    { n: r.items, t: 'artículos' },
    { n: fmt.format(r.unidades), t: 'unidades' },
    { n: pesos(r.valorCents), t: 'valor de stock' },
    { n: r.movimientos, t: 'movimientos' },
  ];
  if (r.stockBajo > 0) tarjetas.push({ n: r.stockBajo, t: 'en stock bajo', alerta: true });
  $('#resumen').innerHTML = tarjetas
    .map((c) => `<div class="tarjeta${c.alerta ? ' alerta' : ''}"><b>${c.n}</b><span>${c.t}</span></div>`)
    .join('');
}

function pintarArticulos() {
  const cuerpo = $('#filas');
  if (estado.articulos.length === 0) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="vacio">Todavía no hay artículos. Creá el primero.</td></tr>`;
    return;
  }
  cuerpo.innerHTML = estado.articulos
    .map((a) => {
      const bajo = a.quantity <= a.minQuantity;
      return `<tr>
        <td>${esc(a.name)}</td>
        <td>${esc(a.sku || '—')}</td>
        <td class="num ${bajo ? 'bajo' : ''}">${fmt.format(a.quantity)}${
          bajo ? ` <small>(mín ${fmt.format(a.minQuantity)})</small>` : ''
        }</td>
        <td>${esc(a.unit)}</td>
        <td class="num">${pesos(a.priceCents)}</td>
        <td>
          <div class="fila-acciones">
            <button class="link" data-editar="${a.id}" type="button">Editar</button>
            <button data-mover="${a.id}" type="button" data-requiere-admin>Mover</button>
            <button class="link" data-borrar="${a.id}" type="button" data-requiere-admin>Baja</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

function pintarMovimientos(movs) {
  const cuerpo = $('#movimientos');
  if (movs.length === 0) {
    cuerpo.innerHTML = `<tr><td colspan="5" class="vacio">Sin movimientos todavía.</td></tr>`;
    return;
  }
  cuerpo.innerHTML = movs
    .map(
      (m) => `<tr>
        <td class="num ${m.delta > 0 ? 'sube' : 'bajo'}">${m.delta > 0 ? '+' : ''}${fmt.format(m.delta)}</td>
        <td>${esc(m.itemName || '—')}</td>
        <td>${esc(m.reason)}</td>
        <td>${esc(m.actorName || '—')}</td>
        <td>${cuando(m.createdAt)}</td>
      </tr>`,
    )
    .join('');
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function cuando(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
      body: JSON.stringify({
        defaultUnit: f.get('defaultUnit'),
        defaultMinQuantity: Number(f.get('defaultMinQuantity')),
        currency: f.get('currency'),
      }),
    });
  } catch (e) {
    // El error se muestra junto al form, no en un alert: es un problema de un
    // campo, y la persona lo tiene a la vista.
    err.textContent = e.message;
    err.classList.remove('oculto');
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

function abrir(titulo, campos, onGuardar) {
  $('#titulo').textContent = titulo;
  $('#error').classList.add('oculto');
  $('#campos').innerHTML = campos
    .map(
      (c) => `<div class="campo">
        <label for="c_${c.name}">${esc(c.label)}</label>
        <input id="c_${c.name}" name="${c.name}" type="${c.type || 'text'}" value="${esc(c.value ?? '')}"
          ${c.required ? 'required' : ''} ${c.step ? `step="${c.step}"` : ''} ${c.min !== undefined ? `min="${c.min}"` : ''} />
      </div>`,
    )
    .join('');
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
      const caja = $('#error');
      caja.textContent = err.message;
      caja.classList.remove('oculto');
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
    (datos) => api('/api/items', { method: 'POST', body: JSON.stringify(datos) }),
  );

document.addEventListener('click', async (ev) => {
  const editar = ev.target.closest('[data-editar]');
  const mover = ev.target.closest('[data-mover]');
  const borrar = ev.target.closest('[data-borrar]');

  try {
    if (editar) {
      const a = estado.articulos.find((x) => x.id === editar.dataset.editar);
      if (!a) return;
      abrir(
        `Editar ${a.name}`,
        [
          { name: 'name', label: 'Nombre', value: a.name, required: true },
          { name: 'sku', label: 'SKU', value: a.sku ?? '' },
          { name: 'minQuantity', label: 'Stock mínimo', type: 'number', min: 0, value: a.minQuantity },
          { name: 'unit', label: 'Unidad', value: a.unit },
          { name: 'priceCents', label: 'Precio en centavos', type: 'number', min: 0, value: a.priceCents },
        ],
        (datos) => api(`/api/items/${a.id}`, { method: 'PATCH', body: JSON.stringify(datos) }),
      );
    }

    if (mover) {
      const a = estado.articulos.find((x) => x.id === mover.dataset.mover);
      if (!a) return;
      abrir(
        `Mover stock de ${a.name}`,
        [
          { name: 'delta', label: 'Cantidad (negativa para salir)', type: 'number', required: true, step: '1' },
          { name: 'reason', label: 'Motivo', required: true },
        ],
        (datos) =>
          api(`/api/items/${a.id}/movements`, {
            method: 'POST',
            body: JSON.stringify({ delta: Number(datos.delta), reason: datos.reason }),
          }),
      );
    }

    if (borrar) {
      const a = estado.articulos.find((x) => x.id === borrar.dataset.borrar);
      if (!a) return;
      if (!confirm(`¿Dar de baja ${a.name}? Se conserva el historial.`)) return;
      await api(`/api/items/${a.id}`, { method: 'DELETE' });
      await cargar();
    }
  } catch (err) {
    alert(err.message);
  }
});

// --- arranque ---------------------------------------------------------------

let temporizador;
$('#buscar').oninput = () => {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => api(`/api/items?q=${encodeURIComponent($('#buscar').value.trim())}`)
    .then((r) => { estado.articulos = r.items; pintarArticulos(); })
    .catch(() => {}), 250);
};

$('#salir').onclick = () => {
  window.location.href = '/auth/logout';
};

cargar().catch((err) => {
  if (err.message !== 'sesion vencida') {
    document.body.insertAdjacentHTML(
      'afterbegin',
      `<p class="error" style="padding:16px">No pudimos cargar el inventario: ${esc(err.message)}</p>`,
    );
  }
});
