/**
 * Interfaz de cotizaciones.
 *
 * Tres reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. La pantalla NO resuelve el folio ni el total. No sabe si esta cotizacion
 *      es la numero 8 o la 9: eso lo dice el servidor, que es el unico que ve
 *      las cotizaciones de las otras organizaciones. El total que se muestra aca
 *      es una aproximacion para leerlo antes de guardar, y el que queda escrito
 *      es el que calcula la API.
 *
 *   3. La pantalla NO cambia el estado. El estado se mueve por
 *      `POST /api/quotes/:id/estado`, que es la unica puerta que ademas sella
 *      cuando se mando y cuando se acepto. Si el formulario mandara el estado en
 *      el PATCH, se podria aceptar una cotizacion sin dejar rastro.
 */

const $ = (sel) => document.querySelector(sel);
const dinero = (centavos) =>
  `${estado.cfg.currency}${(centavos / 100).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const ESTADOS = ['draft', 'sent', 'accepted', 'rejected', 'expired'];
const ETIQUETA = {
  draft: 'Borrador',
  sent: 'Enviada',
  accepted: 'Aceptada',
  rejected: 'Rechazada',
  expired: 'Vencida',
};

/** A donde se puede ir desde cada estado. Es la misma tabla que valida el servidor. */
const TRANSICIONES = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: [],
  expired: ['sent'],
};

const estado = {
  cotizaciones: [],
  cfg: { currency: '$', defaultTaxRateBp: 0, validityDays: 30, nextNumber: 1 },
  /** Las lineas de la cotizacion que se esta editando, antes de guardarla. */
  borrador: [],
  editando: null,
};

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    headers: { 'content-type': 'application/json' },
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(datos.error ?? 'No se pudo completar la operacion');
    err.status = res.status;
    throw err;
  }
  return datos;
}

function avisar(mensaje, malo = false) {
  const caja = $('#aviso');
  caja.textContent = mensaje;
  caja.classList.toggle('malo', malo);
  caja.hidden = false;
  clearTimeout(caja.t);
  caja.t = setTimeout(() => { caja.hidden = true; }, 5000);
}

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** La fecha de hoy en `AAAA-MM-DD`, que es como el servidor la espera. */
function hoy() {
  return new Date().toLocaleDateString('en-CA');
}

/** Hoy mas N dias, para proponer la vigencia de la oferta. */
function dentroDe(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
}

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [lista, cfg] = await Promise.all([api('/api/quotes?limit=500'), api('/api/settings')]);
  estado.cotizaciones = lista.items;
  // Lo que se guarda es el objeto de ajustes SIN envolver. Leer un `settings`
  // adentro de `cfg` seria leer `undefined` y reventar al pintar.
  estado.cfg = cfg.settings;
}

// ─────────────────────────────────────────────────────────────────────── inicio

async function pintarInicio() {
  const d = await api('/api/dashboard');
  $('#resumen').innerHTML = [
    ['Cotizaciones', d.total],
    ['Enviadas', d.porEstado.sent],
    ['Aceptadas', d.porEstado.accepted],
    [`Del mes (${d.mes})`, dinero(d.mesCents)],
    ['En la mesa', dinero(d.totalCents)],
  ]
    .map(([titulo, valor]) => `<div class="tarjeta"><strong>${valor}</strong><span>${titulo}</span></div>`)
    .join('');

  // "Pendientes de respuesta" son las enviadas y las borradores: lo que todavia
  // no tiene veredicto del cliente. Las aceptadas y las rechazadas ya lo tienen.
  const abiertas = estado.cotizaciones.filter((c) => c.status === 'sent' || c.status === 'draft');
  $('#abiertas').innerHTML =
    abiertas.length === 0
      ? '<p>No hay cotizaciones esperando respuesta.</p>'
      : abiertas
          .map(
            (c) => `<div class="ficha">
              <strong>#${c.number} · ${escapar(c.customerName)}</strong>
              <span>${escapar(c.title ?? 'Sin titulo')}</span>
              <span>${dinero(c.totalCents)}</span>
            </div>`,
          )
          .join('');
}

// ─────────────────────────────────────────────────────────────── cotizaciones

function pintarCotizaciones() {
  const filtro = $('#filtro-estado').value;
  const busqueda = $('#buscar').value.trim().toLowerCase();
  const lista = estado.cotizaciones.filter((c) => {
    if (filtro && c.status !== filtro) return false;
    if (!busqueda) return true;
    return [String(c.number), c.customerName ?? '', c.title ?? '']
      .join(' ')
      .toLowerCase()
      .includes(busqueda);
  });

  $('#cotizaciones-lista').innerHTML =
    lista.length === 0
      ? '<p>Todavia no hay cotizaciones.</p>'
      : `<table>
          <thead><tr><th>Folio</th><th>Cliente</th><th>Emision</th><th>Estado</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${lista
              .map(
                (c) => `<tr>
                  <td>#${c.number}</td>
                  <td>${escapar(c.customerName)}</td>
                  <td>${escapar(c.issueDate ?? '—')}</td>
                  <td>${ETIQUETA[c.status] ?? c.status}</td>
                  <td>${dinero(c.totalCents)}</td>
                  <td>
                    <button type="button" data-ver="${escapar(c.id)}">Ver</button>
                    <button type="button" data-borrar="${escapar(c.id)}">Borrar</button>
                  </td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>`;

  for (const b of document.querySelectorAll('[data-ver]')) {
    b.addEventListener('click', () => abrirCotizacion(b.dataset.ver));
  }
  for (const b of document.querySelectorAll('[data-borrar]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Borrar la cotizacion y sus lineas?')) return;
      try {
        await api(`/api/quotes/${b.dataset.borrar}`, { method: 'DELETE' });
        avisar('Cotizacion borrada');
        await recargar();
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

// ────────────────────────────────────────────────────────── dialogo cotizacion

function pintarLineas() {
  $('#cot-lineas').innerHTML =
    estado.borrador
      .map(
        (l, i) => `<div class="linea">
          <span>${escapar(l.description)}</span>
          <span>${l.qty} × ${dinero(l.unitPriceCents)}</span>
          <span>${dinero(l.lineTotalCents ?? 0)}</span>
          <button type="button" data-quitar="${i}">Quitar</button>
        </div>`,
      )
      .join('') || '<p class="ficha vacia">Sin lineas.</p>';

  // Solo una estimacion para leerla antes de guardar. El que queda escrito es el
  // que calcula el servidor.
  const subtotal = estado.borrador.reduce((acc, l) => acc + (l.lineTotalCents ?? 0), 0);
  const bp = Number($('#cot-impuesto').value) || 0;
  $('#cot-total').textContent = dinero(subtotal + Math.round((subtotal * bp) / 10_000));

  for (const b of document.querySelectorAll('[data-quitar]')) {
    b.addEventListener('click', () => {
      estado.borrador.splice(Number(b.dataset.quitar), 1);
      pintarLineas();
    });
  }
}

/** Los botones de estado: solo los destinos que la tabla de transiciones permite. */
function pintarEstados(actual) {
  const destinos = TRANSICIONES[actual] ?? [];
  $('#cot-estados').innerHTML =
    destinos.length === 0
      ? `<span class="ficha vacia">Una cotizacion ${ETIQUETA[actual] ?? actual} ya no cambia de estado.</span>`
      : destinos
          .map((e) => `<button type="button" data-estado="${e}">Pasar a ${ETIQUETA[e]}</button>`)
          .join('');

  for (const b of document.querySelectorAll('[data-estado]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/quotes/${estado.editando}/estado`, { method: 'POST', body: { status: b.dataset.estado } });
        avisar('Estado actualizado');
        await recargar();
        if (estado.editando) await abrirCotizacion(estado.editando);
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

async function abrirCotizacion(id) {
  const c = estado.cotizaciones.find((x) => x.id === id);
  if (!c) return avisar('La cotizacion no esta en la lista', true);

  const { lines } = await api(`/api/quotes/${id}/lineas`);
  estado.editando = id;
  estado.borrador = lines.map((l) => ({
    description: l.description,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    lineTotalCents: l.lineTotalCents,
  }));

  $('#cotizacion-form-titulo').textContent = `Cotizacion #${c.number}`;
  $('#cotizacion-id').value = c.id;
  $('#cot-folio').value = c.number;
  $('#cot-cliente').value = c.customerName ?? '';
  $('#cot-cliente-id').value = c.customerId ?? '';
  $('#cot-correo').value = c.customerEmail ?? '';
  $('#cot-titulo').value = c.title ?? '';
  $('#cot-emision').value = c.issueDate ?? hoy();
  $('#cot-vigencia').value = c.validUntil ?? '';
  $('#cot-impuesto').value = c.taxRateBp ?? 0;
  $('#cot-notas').value = c.notes ?? '';

  pintarLineas();
  pintarEstados(c.status);
  $('#cotizacion-dialog').showModal();
}

function abrirNueva() {
  estado.editando = null;
  estado.borrador = [];
  $('#cotizacion-form-titulo').textContent = 'Nueva cotizacion';
  $('#cotizacion-id').value = '';
  // El folio es una PROPUESTA del servidor, no una reserva: si dos personas abren
  // el formulario a la vez, la segunda que guarde recibe un 409 y recarga.
  $('#cot-folio').value = estado.cfg.nextNumber;
  $('#cot-cliente').value = '';
  $('#cot-cliente-id').value = '';
  $('#cot-correo').value = '';
  $('#cot-titulo').value = '';
  $('#cot-emision').value = hoy();
  $('#cot-vigencia').value = dentroDe(estado.cfg.validityDays);
  $('#cot-impuesto').value = estado.cfg.defaultTaxRateBp;
  $('#cot-notas').value = '';
  pintarLineas();
  pintarEstados('draft');
  $('#cotizacion-dialog').showModal();
}

// ─────────────────────────────────────────────────────────────────────── eventos

$('#linea-agregar').addEventListener('click', () => {
  const description = $('#linea-descripcion').value.trim();
  if (!description) return avisar('La linea necesita una descripcion', true);
  const qty = Number($('#linea-cantidad').value) || 1;
  const unitPriceCents = Number($('#linea-precio').value) || 0;
  estado.borrador.push({ description, qty, unitPriceCents, lineTotalCents: Math.round(qty * unitPriceCents) });
  $('#linea-descripcion').value = '';
  $('#linea-cantidad').value = '1';
  $('#linea-precio').value = '0';
  pintarLineas();
});

$('#cot-impuesto').addEventListener('input', pintarLineas);

$('#cotizacion-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // El estado NO va en el cuerpo: se cambia por su propia ruta, que ademas sella
  // la fecha. Mandarlo por aca seria una segunda puerta sin sello.
  const cuerpo = {
    number: Number($('#cot-folio').value) || null,
    customerName: $('#cot-cliente').value.trim(),
    customerId: $('#cot-cliente-id').value.trim() || null,
    customerEmail: $('#cot-correo').value.trim() || null,
    title: $('#cot-titulo').value.trim() || null,
    issueDate: $('#cot-emision').value || null,
    validUntil: $('#cot-vigencia').value || null,
    taxRateBp: Number($('#cot-impuesto').value) || 0,
    notes: $('#cot-notas').value.trim() || null,
    lines: estado.borrador.map(({ description, qty, unitPriceCents }) => ({ description, qty, unitPriceCents })),
  };
  try {
    if (estado.editando) {
      await api(`/api/quotes/${estado.editando}`, { method: 'PATCH', body: cuerpo });
      avisar('Cotizacion actualizada');
    } else {
      await api('/api/quotes', { method: 'POST', body: cuerpo });
      avisar('Cotizacion creada');
    }
    $('#cotizacion-dialog').close();
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#cotizacion-cancelar').addEventListener('click', () => $('#cotizacion-dialog').close());
$('#cotizacion-nueva').addEventListener('click', abrirNueva);
$('#buscar').addEventListener('input', pintarCotizaciones);
$('#filtro-estado').addEventListener('change', pintarCotizaciones);

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = $('#config-form');
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        currency: form.elements.currency.value.trim() || '$',
        timezone: form.elements.timezone.value.trim(),
        defaultTaxRateBp: Number(form.elements.defaultTaxRateBp.value) || 0,
        validityDays: Number(form.elements.validityDays.value) || 30,
      },
    });
    avisar('Ajustes guardados');
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

// ───────────────────────────────────────────────────────────────── navegación

const PANELES = {
  inicio: pintarInicio,
  cotizaciones: pintarCotizaciones,
  ajustes: async () => renderConfig(),
};

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    for (const [nombre, seccion] of Object.entries({
      inicio: '#panel-inicio',
      cotizaciones: '#panel-cotizaciones',
      ajustes: '#panel-ajustes',
    })) {
      $(seccion).hidden = nombre !== boton.dataset.tab;
    }
    if (PANELES[boton.dataset.tab]) await PANELES[boton.dataset.tab]();
  });
}

/** Vuelve a pedir todo y reagrupa. Se llama despues de cada escritura. */
async function recargar() {
  await cargar();
  renderConfig();
  const activo = document.querySelector('#tabs button.activo')?.dataset.tab ?? 'inicio';
  if (PANELES[activo]) await PANELES[activo]();
}

/**
 * Llena el form de ajustes.
 *
 * Se recorre `form.elements` y se usa el `name` de cada input como clave del
 * ajuste, en vez de buscarlos por id uno por uno. Es lo que permite agregar un
 * ajuste nuevo poniendo un `<input name="...">` en el HTML, sin tocar este JS.
 */
function renderConfig() {
  const form = $('#config-form');
  const c = estado.cfg;
  for (const el of form.elements) {
    if (!el.name || c[el.name] === undefined) continue;
    el.value = c[el.name];
  }
  // El folio siguiente no es un input: es el unico dato de los ajustes que NO se
  // puede escribir, y por eso vive aparte del form.
  $('#cfg-folio').textContent = String(c.nextNumber ?? 1);
}

/** El filtro de estado se arma UNA vez: si se rearmara en cada `renderConfig()`,
 *  guardar unos ajustes borraria el estado que el usuario estaba filtrando. */
function pintarFiltroEstado() {
  $('#filtro-estado').innerHTML =
    '<option value="">Todos los estados</option>' +
    ESTADOS.map((e) => `<option value="${e}">${ETIQUETA[e]}</option>`).join('');
}

cargar().then(async () => {
  renderConfig();
  pintarFiltroEstado();
  await pintarInicio();
});
