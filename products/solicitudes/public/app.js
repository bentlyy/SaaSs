/**
 * Interfaz de solicitudes y ordenes.
 *
 * Dos reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. La pantalla NO decide el folio ni el total. No sabe si esta orden es la
 *      numero 8 o la 9: eso lo dice el servidor, que es el unico que ve las
 *      ordenes de las otras organizaciones. El total que se muestra aca es una
 *      aproximacion para leerlo antes de guardar, y el que queda escrito es el
 *      que calcula la API.
 */

const $ = (sel) => document.querySelector(sel);
const dinero = (centavos) =>
  `${estado.cfg.currency}${(centavos / 100).toLocaleString('es-CL', { minimumFractionDigits: 0 })}`;

const estado = {
  trabajos: [],
  clientes: [],
  tecnicos: [],
  cfg: { currency: '$', nextNumber: 1 },
  /** Las líneas de la orden que se está editando, antes de guardarla. */
  borrador: { services: [], parts: [] },
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
    err.detalle = datos;
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

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [trabajos, clientes, tecnicos, cfg] = await Promise.all([
    api('/api/services'),
    api('/api/customers'),
    api('/api/technicians'),
    api('/api/settings'),
  ]);
  estado.trabajos = trabajos.items;
  estado.clientes = clientes.items;
  estado.tecnicos = tecnicos.items;
  estado.cfg = cfg.settings;
  pintar();
}

const nombreDe = (lista, id) => lista.find((x) => x.id === id)?.name ?? null;
const etiquetaEstado = (e) =>
  ({
    received: 'Recibida',
    estimated: 'Cotizada',
    in_progress: 'En trabajo',
    done: 'Entregada',
    cancelled: 'Cancelada',
  })[e] ?? e;

function opciones(lista, vacio) {
  return (
    `<option value="">${vacio}</option>` +
    lista.map((x) => `<option value="${x.id}">${escapar(x.name)}</option>`).join('')
  );
}

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const [resumen, tablero] = await Promise.all([api('/api/resumen'), api('/api/tablero')]);

  $('#resumen').innerHTML = [
    ['Abiertas', resumen.abiertas],
    ['Por cotizar', resumen.porEstado.estimated],
    ['Entregadas', resumen.porEstado.done],
    ['Por cobrar', dinero(resumen.porCobrarCents)],
  ]
    .map(([titulo, valor]) => `<div class="tarjeta"><strong>${valor}</strong><span>${titulo}</span></div>`)
    .join('');

  $('#tablero').innerHTML = tablero.columnas
    .map(
      (c) => `
      <div class="columna">
        <h4>${etiquetaEstado(c.estado)} (${c.ordenes.length})</h4>
        ${
          c.ordenes.length === 0
            ? '<div class="ficha vacia">Sin órdenes</div>'
            : c.ordenes
                .map(
                  (o) => `
          <div class="ficha" data-orden="${o.id}">
            <strong>#${o.number} · ${escapar(o.customerName ?? 'Sin cliente')}</strong>
            <span>${escapar(o.asset ?? o.notes ?? 'Sin detalle')}</span>
            <span>${o.technicianName ? escapar(o.technicianName) : 'Sin técnico'} · ${dinero(o.totalCents)}</span>
          </div>`,
                )
                .join('')
        }
      </div>`,
    )
    .join('');

  for (const ficha of document.querySelectorAll('.ficha[data-orden]')) {
    ficha.addEventListener('click', () => abrirOrden(ficha.dataset.orden));
  }
}

async function pintarOrdenes() {
  const { orders } = await api('/api/orders?limit=200');
  $('#ordenes-lista').innerHTML = orders.length === 0
    ? '<p>Todavía no hay órdenes.</p>'
    : `<table>
        <thead><tr><th>Folio</th><th>Cliente</th><th>Sobre qué</th><th>Técnico</th><th>Estado</th><th>Entrega</th><th>Total</th><th></th></tr></thead>
        <tbody>
          ${orders
            .map(
              (o) => `<tr>
                <td>#${o.number}</td>
                <td>${escapar(nombreDe(estado.clientes, o.customerId) ?? '—')}</td>
                <td>${escapar(o.asset ?? '—')}</td>
                <td>${escapar(nombreDe(estado.tecnicos, o.technicianId) ?? '—')}</td>
                <td>${etiquetaEstado(o.status)}</td>
                <td>${escapar(o.estimatedDelivery ?? '—')}</td>
                <td>${dinero(o.totalCents)}</td>
                <td>
                  <button data-ver="${o.id}">Ver</button>
                  <button data-borrar="${o.id}">Borrar</button>
                </td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>`;

  for (const b of document.querySelectorAll('[data-ver]')) {
    b.addEventListener('click', () => abrirOrden(b.dataset.ver));
  }
  for (const b of document.querySelectorAll('[data-borrar]')) {
    b.addEventListener('click', async () => {
      if (!confirm('¿Borrar la orden y sus líneas?')) return;
      try {
        await api(`/api/orders/${b.dataset.borrar}`, { method: 'DELETE' });
        avisar('Orden borrada');
        await recargar();
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

// ──────────────────────────────────────────────────────────────────── catálogos

function pintarTrabajos() {
  $('#trabajos-lista').innerHTML = `<table>
    <thead><tr><th>Nombre</th><th>Duración</th><th>Tarifa</th><th>Descripción</th><th></th></tr></thead>
    <tbody>
      ${
        estado.trabajos
          .map(
            (t) => `<tr>
          <td>${escapar(t.name)}</td>
          <td>${t.durationMin} min</td>
          <td>${dinero(t.priceCents)}</td>
          <td>${escapar(t.description ?? '—')}</td>
          <td>
            <button data-editar="${t.id}">Editar</button>
            <button data-borrar-trabajo="${t.id}">Borrar</button>
          </td>
        </tr>`,
          )
          .join('') || '<tr><td colspan="5">Sin trabajos.</td></tr>'
      }
    </tbody>
  </table>`;

  for (const b of document.querySelectorAll('[data-editar]')) {
    b.addEventListener('click', () => {
      const t = estado.trabajos.find((x) => x.id === b.dataset.editar);
      $('#trabajo-id').value = t.id;
      $('#trabajo-nombre').value = t.name;
      $('#trabajo-duracion').value = t.durationMin;
      $('#trabajo-precio').value = t.priceCents;
      $('#trabajo-descripcion').value = t.description ?? '';
      $('#trabajo-form-titulo').textContent = `Editar ${t.name}`;
      $('#trabajo-cancelar').hidden = false;
    });
  }
  for (const b of document.querySelectorAll('[data-borrar-trabajo]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/services/${b.dataset.borrarTrabajo}`, { method: 'DELETE' });
        avisar('Trabajo borrado');
        await recargar();
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

function pintarTecnicos() {
  $('#tecnicos-lista').innerHTML = `<table>
    <thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
    <tbody>
      ${
        estado.tecnicos
          .map(
            (t) => `<tr>
          <td><span style="color:${escapar(t.color)}">●</span> ${escapar(t.name)}</td>
          <td>${escapar(t.phone ?? '—')}</td>
          <td>${escapar(t.email ?? '—')}</td>
          <td>
            <button data-editar-tecnico="${t.id}">Editar</button>
            <button data-borrar-tecnico="${t.id}">Borrar</button>
          </td>
        </tr>`,
          )
          .join('') || '<tr><td colspan="4">Sin técnicos.</td></tr>'
      }
    </tbody>
  </table>`;

  for (const b of document.querySelectorAll('[data-editar-tecnico]')) {
    b.addEventListener('click', () => {
      const t = estado.tecnicos.find((x) => x.id === b.dataset.editarTecnico);
      $('#tecnico-id').value = t.id;
      $('#tecnico-nombre').value = t.name;
      $('#tecnico-telefono').value = t.phone ?? '';
      $('#tecnico-correo').value = t.email ?? '';
      $('#tecnico-color').value = t.color ?? '#4f46e5';
      $('#tecnico-form-titulo').textContent = `Editar ${t.name}`;
      $('#tecnico-cancelar').hidden = false;
    });
  }
  for (const b of document.querySelectorAll('[data-borrar-tecnico]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/technicians/${b.dataset.borrarTecnico}`, { method: 'DELETE' });
        avisar('Técnico borrado');
        await recargar();
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

function pintarClientes() {
  $('#clientes-lista').innerHTML = `<table>
    <thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th></th></tr></thead>
    <tbody>
      ${
        estado.clientes
          .map(
            (c) => `<tr>
          <td>${escapar(c.name)}</td>
          <td>${escapar(c.phone ?? '—')}</td>
          <td>${escapar(c.email ?? '—')}</td>
          <td><button data-borrar-cliente="${c.id}">Borrar</button></td>
        </tr>`,
          )
          .join('') || '<tr><td colspan="4">Sin clientes.</td></tr>'
      }
    </tbody>
  </table>`;

  for (const b of document.querySelectorAll('[data-borrar-cliente]')) {
    b.addEventListener('click', async () => {
      try {
        await api(`/api/customers/${b.dataset.borrarCliente}`, { method: 'DELETE' });
        avisar('Cliente borrado');
        await recargar();
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

// ──────────────────────────────────────────────────────────────── diálogo orden

function pintarLineas() {
  $('#orden-trabajos').innerHTML =
    estado.borrador.services
      .map(
        (l, i) => `<div class="linea">
        <span>${escapar(nombreDe(estado.trabajos, l.serviceId) ?? l.serviceId)}</span>
        <span>${dinero(l.priceCents ?? 0)}</span>
        <button type="button" class="quitar" data-quitar-servicio="${i}">Quitar</button>
      </div>`,
      )
      .join('') || '<p class="ficha vacia">Sin trabajos.</p>';

  $('#orden-partes').innerHTML =
    estado.borrador.parts
      .map(
        (p, i) => `<div class="linea">
        <span>${escapar(p.itemName)}</span>
        <span>${p.qty} × ${dinero(p.unitPriceCents)}</span>
        <button type="button" class="quitar" data-quitar-parte="${i}">Quitar</button>
      </div>`,
      )
      .join('') || '<p class="ficha vacia">Sin repuestos.</p>';

  // Solo una estimación para leerla antes de guardar. El que queda escrito es el
  // que calcula el servidor.
  const total =
    estado.borrador.services.reduce((acc, l) => acc + (l.priceCents ?? 0), 0) +
    estado.borrador.parts.reduce((acc, p) => acc + p.qty * p.unitPriceCents, 0);
  $('#orden-total').textContent = dinero(total);

  for (const b of document.querySelectorAll('[data-quitar-servicio]')) {
    b.addEventListener('click', () => {
      estado.borrador.services.splice(Number(b.dataset.quitarServicio), 1);
      pintarLineas();
    });
  }
  for (const b of document.querySelectorAll('[data-quitar-parte]')) {
    b.addEventListener('click', () => {
      estado.borrador.parts.splice(Number(b.dataset.quitarParte), 1);
      pintarLineas();
    });
  }
}

async function abrirOrden(idOrden) {
  const { order, services: trabajos, parts } = await api(`/api/orders/${idOrden}`);
  $('#orden-form-titulo').textContent = `Orden #${order.number}`;
  $('#orden-folio').value = order.number;
  $('#orden-cliente').value = order.customerId ?? '';
  $('#orden-tecnico').value = order.technicianId ?? '';
  $('#orden-bien').value = order.asset ?? '';
  $('#orden-estado').value = order.status;
  $('#orden-entrega').value = order.estimatedDelivery ?? '';
  $('#orden-notas').value = order.notes ?? '';
  estado.borrador = { services: trabajos, parts };
  estado.editando = order.id;
  pintarLineas();
  $('#orden-dialog').showModal();
}

function abrirNueva() {
  $('#orden-form-titulo').textContent = 'Nueva orden';
  // `estado.cfg` YA es el objeto de ajustes (ver `cargar()`), asi que el folio
  // siguiente se lee directo de ahi y no de un `settings` anidado que no existe.
  $('#orden-folio').value = estado.cfg.nextNumber;
  $('#orden-cliente').value = '';
  $('#orden-tecnico').value = '';
  $('#orden-bien').value = '';
  $('#orden-estado').value = 'received';
  $('#orden-entrega').value = '';
  $('#orden-notas').value = '';
  estado.borrador = { services: [], parts: [] };
  estado.editando = null;
  pintarLineas();
  $('#orden-dialog').showModal();
}

// ─────────────────────────────────────────────────────────────────────── eventos

$('#orden-trabajo-agregar').addEventListener('click', () => {
  const id = $('#orden-trabajo-nuevo').value;
  if (!id) return avisar('Elegí un trabajo primero', true);
  const trabajo = estado.trabajos.find((t) => t.id === id);
  // El precio se congela al agregar la línea, con la tarifa de ahora. Si el
  // catálogo sube mañana, esta orden sigue valiendo lo que valía hoy.
  estado.borrador.services.push({ serviceId: id, priceCents: trabajo.priceCents });
  pintarLineas();
});

$('#orden-parte-agregar').addEventListener('click', () => {
  const itemId = $('#orden-parte-id').value.trim();
  const itemName = $('#orden-parte-nombre').value.trim();
  if (!itemId || !itemName) return avisar('El repuesto necesita id y nombre', true);
  estado.borrador.parts.push({
    itemId,
    itemName,
    qty: Number($('#orden-parte-cantidad').value) || 1,
    unitPriceCents: Number($('#orden-parte-precio').value) || 0,
  });
  $('#orden-parte-id').value = '';
  $('#orden-parte-nombre').value = '';
  $('#orden-parte-cantidad').value = '1';
  $('#orden-parte-precio').value = '0';
  pintarLineas();
});

$('#orden-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cuerpo = {
    number: Number($('#orden-folio').value) || null,
    customerId: $('#orden-cliente').value || null,
    technicianId: $('#orden-tecnico').value || null,
    asset: $('#orden-bien').value.trim() || null,
    status: $('#orden-estado').value,
    estimatedDelivery: $('#orden-entrega').value || null,
    notes: $('#orden-notas').value.trim() || null,
    services: estado.borrador.services,
    parts: estado.borrador.parts,
  };
  try {
    if (estado.editando) {
      await api(`/api/orders/${estado.editando}`, { method: 'PATCH', body: cuerpo });
      avisar('Orden actualizada');
    } else {
      await api('/api/orders', { method: 'POST', body: cuerpo });
      avisar('Orden creada');
    }
    $('#orden-dialog').close();
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#orden-cancelar').addEventListener('click', () => $('#orden-dialog').close());
$('#orden-nueva').addEventListener('click', abrirNueva);

$('#trabajo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cuerpo = {
    name: $('#trabajo-nombre').value.trim(),
    durationMin: Number($('#trabajo-duracion').value) || 0,
    priceCents: Number($('#trabajo-precio').value) || 0,
    description: $('#trabajo-descripcion').value.trim() || null,
  };
  const id = $('#trabajo-id').value;
  try {
    await api(id ? `/api/services/${id}` : '/api/services', {
      method: id ? 'PATCH' : 'POST',
      body: cuerpo,
    });
    avisar(id ? 'Trabajo actualizado' : 'Trabajo creado');
    $('#trabajo-form').reset();
    $('#trabajo-id').value = '';
    $('#trabajo-cancelar').hidden = true;
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#trabajo-cancelar').addEventListener('click', () => {
  $('#trabajo-form').reset();
  $('#trabajo-id').value = '';
  $('#trabajo-cancelar').hidden = true;
});

$('#tecnico-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cuerpo = {
    name: $('#tecnico-nombre').value.trim(),
    phone: $('#tecnico-telefono').value.trim() || null,
    email: $('#tecnico-correo').value.trim() || null,
    color: $('#tecnico-color').value.trim() || null,
  };
  const id = $('#tecnico-id').value;
  try {
    await api(id ? `/api/technicians/${id}` : '/api/technicians', {
      method: id ? 'PATCH' : 'POST',
      body: cuerpo,
    });
    avisar(id ? 'Técnico actualizado' : 'Técnico creado');
    $('#tecnico-form').reset();
    $('#tecnico-id').value = '';
    $('#tecnico-cancelar').hidden = true;
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#tecnico-cancelar').addEventListener('click', () => {
  $('#tecnico-form').reset();
  $('#tecnico-id').value = '';
  $('#tecnico-cancelar').hidden = true;
});

$('#cliente-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/customers', {
      method: 'POST',
      body: {
        name: $('#cliente-nombre').value.trim(),
        phone: $('#cliente-telefono').value.trim() || null,
        email: $('#cliente-correo').value.trim() || null,
      },
    });
    avisar('Cliente creado');
    $('#cliente-form').reset();
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        currency: $('#cfg-moneda').value.trim() || '$',
        timezone: $('#cfg-zona').value.trim(),
        nextNumber: Number($('#cfg-folio').value) || 1,
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
  tablero: pintarTablero,
  ordenes: pintarOrdenes,
  trabajos: () => pintarTrabajos(),
  tecnicos: () => pintarTecnicos(),
  clientes: () => pintarClientes(),
};

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    for (const [nombre, seccion] of Object.entries({
      tablero: '#panel-tablero',
      ordenes: '#panel-ordenes',
      trabajos: '#panel-trabajos',
      tecnicos: '#panel-tecnicos',
      clientes: '#panel-clientes',
      ajustes: '#panel-ajustes',
    })) {
      $(seccion).hidden = nombre !== boton.dataset.tab;
    }
    if (PANELES[boton.dataset.tab]) await PANELES[boton.dataset.tab]();
  });
}

/** Vuelve a pedir todo y reagrupa. Se llama después de cada escritura. */
async function recargar() {
  await cargar();
  const activo = document.querySelector('#tabs button.activo')?.dataset.tab ?? 'tablero';
  if (PANELES[activo]) await PANELES[activo]();
}

cargar().then(async () => {
  $('#orden-cliente').innerHTML = opciones(estado.clientes, 'Sin cliente');
  $('#orden-tecnico').innerHTML = opciones(estado.tecnicos, 'Sin técnico');
  $('#orden-trabajo-nuevo').innerHTML = opciones(estado.trabajos, 'Elegí un trabajo');
  $('#tablero-cliente').innerHTML = opciones(estado.clientes, 'Todos');
  $('#tablero-tecnico').innerHTML = opciones(estado.tecnicos, 'Todos');
  renderConfig();
  await pintarTablero();
});

/**
 * Llena el form de ajustes.
 *
 * Se recorre `form.elements` y se usa el `name` de cada input como clave del
 * ajuste, en vez de buscarlos por id uno por uno. Es lo que permite agregar un
 * ajuste nuevo poniendo un `<input name="...">` en el HTML, sin tocar este JS.
 *
 * OJO: el pane se llama `data-tab="ajustes"`, no `id="config"`. Por eso esto no
 * puede hacer `$$('#config input')`: ese selector no matchea nada y el pane
 * aparece vacio.
 */
function renderConfig() {
  const form = $('#config-form');
  const c = estado.cfg;
  for (const el of form.elements) {
    if (!el.name || c[el.name] === undefined) continue;
    el.value = c[el.name];
  }
}
