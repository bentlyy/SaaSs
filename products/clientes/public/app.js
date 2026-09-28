/**
 * Interfaz de clientes.
 *
 * Dos reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. La pantalla NO decide el "hoy" del tablero. Es el servidor quien responde
 *      que dia es en la zona horaria de la empresa: aca el navegador sabe la
 *      fecha del que esta mirando la pantalla, que no es necesariamente la del
 *      negocio. Por eso se pinta lo que llega en `tablero.hoy` y no lo que dice
 *      `new Date()`.
 */

const $ = (sel) => document.querySelector(sel);

const estado = {
  clientes: [],
  seguimientos: [],
  contactos: [],
  cfg: { currency: '$', timezone: 'America/Santiago' },
  /** El "hoy" del negocio, segun el servidor. */
  hoy: null,
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

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [clientes, cfg] = await Promise.all([api('/api/customers?limit=500'), api('/api/settings')]);
  estado.clientes = clientes.items;
  estado.cfg = cfg.settings;
  renderConfig();
  const selector = opciones(estado.clientes, 'Todos');
  $('#tablero-cliente').innerHTML = selector;
  $('#seguimiento-cliente').innerHTML = opciones(estado.clientes, 'Elegí un cliente');
  $('#contacto-cliente').innerHTML = opciones(estado.clientes, 'Elegí un cliente');
}

function opciones(lista, vacio) {
  return (
    `<option value="">${escapar(vacio)}</option>` +
    lista.map((x) => `<option value="${x.id}">${escapar(x.name)}</option>`).join('')
  );
}

const ETIQUETA_ESTADO = {
  pending: 'Pendiente',
  done: 'Hecho',
  canceled: 'Cancelado',
};

const ETIQUETA_CONTACTO = {
  llamada: 'Llamada',
  correo: 'Correo',
  visita: 'Visita',
  nota: 'Nota',
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fecha) {
  if (!fecha) return '';
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}

const instanteCorto = (iso) => (iso ? new Date(iso).toLocaleString('es-CL') : '');

// ─────────────────────────────────────────────────────────────────────── tablero

function tarjeta(numero, texto) {
  return `<div class="tarjeta"><strong>${escapar(numero)}</strong><span>${escapar(texto)}</span></div>`;
}

function tarjetaSeguimiento(seg) {
  return (
    `<div class="tarjeta-seguimiento" data-cliente="${seg.customerId}">` +
    `<strong>${escapar(seg.title)}</strong>` +
    `<span>${escapar(seg.customerName ?? '')}${seg.dueDate ? ' · ' + escapar(fechaCorta(seg.dueDate)) : ''}</span>` +
    '</div>'
  );
}

async function pintarTablero() {
  const filtro = $('#tablero-cliente').value;
  const [resumen, tablero] = await Promise.all([
    api('/api/resumen'),
    api(`/api/tablero${filtro ? `?customerId=${encodeURIComponent(filtro)}` : ''}`),
  ]);
  // El "hoy" es el del negocio, no el del navegador: se muestra el que calculó el
  // servidor con la zona horaria de la empresa, y no el de esta maquina.
  estado.hoy = tablero.hoy;

  $('#resumen').innerHTML = [
    tarjeta(resumen.activos, 'Clientes activos'),
    tarjeta(resumen.archivados, 'Archivados'),
    tarjeta(resumen.seguimientos.porEstado.pending, 'Pendientes'),
    tarjeta(resumen.seguimientos.vencidos, 'Vencidos'),
    tarjeta(resumen.seguimientos.paraHoy, 'Para hoy'),
    tarjeta(resumen.contactos30d, 'Contactos (30 días)'),
  ].join('');

  const vacio = '<div class="ficha vacia">Nada por acá</div>';
  $('#seguimiento-vencidos').innerHTML = tablero.seguimientos.vencidos.map(tarjetaSeguimiento).join('') || vacio;
  $('#seguimiento-hoy').innerHTML = tablero.seguimientos.hoy.map(tarjetaSeguimiento).join('') || vacio;
  $('#seguimiento-proximos').innerHTML = tablero.seguimientos.proximos.map(tarjetaSeguimiento).join('') || vacio;

  $('#cumpleanos').innerHTML = tablero.cumpleanos
    .map((c) => `<div class="ficha"><strong>${escapar(c.name)}</strong><span>${escapar(fechaCorta(c.birthday))}</span></div>`)
    .join('') || vacio;

  $('#contactos-recientes').innerHTML = tablero.contactos
    .map(
      (c) =>
        '<div class="ficha"><strong>' +
        escapar(c.customerName ?? '') +
        '</strong><span>' +
        escapar(ETIQUETA_CONTACTO[c.kind] ?? c.kind) +
        ': ' +
        escapar(c.summary) +
        ' · ' +
        escapar(instanteCorto(c.happenedAt)) +
        '</span></div>',
    )
    .join('') || vacio;
}

// ───────────────────────────────────────────────────────────────────── clientes

function pintarClientes() {
  const busqueda = $('#cliente-buscar').value.trim().toLowerCase();
  const lista = busqueda
    ? estado.clientes.filter((c) =>
        [c.name, c.company, c.phone, c.email, c.taxId, c.city].some((v) =>
          String(v ?? '').toLowerCase().includes(busqueda),
        ),
      )
    : estado.clientes;

  $('#clientes-lista').innerHTML = lista.length
    ? '<table><thead><tr><th>Nombre</th><th>Tipo</th><th>Teléfono</th><th>Correo</th><th>Ciudad</th><th>Acciones</th></tr></thead><tbody>' +
      lista
        .map(
          (c) =>
            '<tr><td>' +
            escapar(c.name) +
            (c.taxId ? '<br><small>' + escapar(c.taxId) + '</small>' : '') +
            '</td><td>' +
            escapar(c.kind) +
            '</td><td>' +
            escapar(c.phone ?? '—') +
            '</td><td>' +
            escapar(c.email ?? '—') +
            '</td><td>' +
            escapar(c.city ?? '—') +
            '</td><td>' +
            '<button type="button" data-ficha="' +
            c.id +
            '">Ficha</button> ' +
            '<button type="button" data-editar="' +
            c.id +
            '">Editar</button> ' +
            '<button type="button" data-archivar="' +
            c.id +
            '">Archivar</button>' +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay clientes que coincidan</div>';
}

function abrirCliente(cliente) {
  $('#cliente-id').value = cliente?.id ?? '';
  $('#cliente-form-titulo').textContent = cliente ? 'Editar cliente' : 'Nuevo cliente';
  $('#cliente-cancelar').hidden = !cliente;
  $('#cliente-nombre').value = cliente?.name ?? '';
  $('#cliente-tipo').value = cliente?.kind ?? 'persona';
  $('#cliente-empresa').value = cliente?.company ?? '';
  $('#cliente-telefono').value = cliente?.phone ?? '';
  $('#cliente-correo').value = cliente?.email ?? '';
  $('#cliente-documento').value = cliente?.taxId ?? '';
  $('#cliente-cumpleanos').value = cliente?.birthday ?? '';
  $('#cliente-direccion').value = cliente?.address ?? '';
  $('#cliente-ciudad').value = cliente?.city ?? '';
  $('#cliente-notas').value = cliente?.notes ?? '';
  $('#cliente-etiquetas').value = cliente?.tags ?? '';
}

$('#cliente-cancelar').addEventListener('click', () => abrirCliente(null));

$('#cliente-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#cliente-id').value;
  // Los campos vacios viajan como null y no como "": el servidor distingue
  // "no lo tengo" de "lo tengo en blanco", y la ficha muestra distinto.
  const cuerpo = {
    name: $('#cliente-nombre').value,
    kind: $('#cliente-tipo').value,
    company: $('#cliente-empresa').value || null,
    phone: $('#cliente-telefono').value || null,
    email: $('#cliente-correo').value || null,
    taxId: $('#cliente-documento').value || null,
    birthday: $('#cliente-cumpleanos').value || null,
    address: $('#cliente-direccion').value || null,
    city: $('#cliente-ciudad').value || null,
    notes: $('#cliente-notas').value || null,
    tags: $('#cliente-etiquetas').value || null,
  };
  try {
    await api(id ? `/api/customers/${id}` : '/api/customers', {
      method: id ? 'PATCH' : 'POST',
      body: cuerpo,
    });
    abrirCliente(null);
    await recargar();
    avisar(id ? 'Cliente actualizado' : 'Cliente creado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#cliente-buscar').addEventListener('input', pintarClientes);

$('#clientes-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  try {
    if (boton.dataset.editar) {
      abrirCliente(estado.clientes.find((c) => c.id === boton.dataset.editar));
    } else if (boton.dataset.ficha) {
      await abrirFicha(boton.dataset.ficha);
    } else if (boton.dataset.archivar) {
      await api(`/api/customers/${boton.dataset.archivar}`, { method: 'DELETE' });
      await recargar();
      avisar('Cliente archivado');
    }
  } catch (err) {
    avisar(err.message, true);
  }
});

// ──────────────────────────────────────────────────────────────────────── ficha

async function abrirFicha(idCliente) {
  const ficha = await api(`/api/customers/${idCliente}/ficha`);
  const c = ficha.customer;
  $('#ficha').innerHTML =
    '<h3>' +
    escapar(c.name) +
    '</h3>' +
    '<p class="meta">' +
    escapar(c.kind === 'empresa' ? 'Empresa' : 'Persona') +
    (c.company ? ' · ' + escapar(c.company) : '') +
    (c.taxId ? ' · ' + escapar(c.taxId) : '') +
    '</p>' +
    '<dl>' +
    '<dt>Teléfono</dt><dd>' +
    escapar(c.phone ?? 'Sin teléfono') +
    '</dd>' +
    '<dt>Correo</dt><dd>' +
    escapar(c.email ?? 'Sin correo') +
    '</dd>' +
    (c.birthday ? '<dt>Cumpleaños</dt><dd>' + escapar(fechaCorta(c.birthday)) + '</dd>' : '') +
    (c.address ? '<dt>Dirección</dt><dd>' + escapar(c.address) + '</dd>' : '') +
    (c.city ? '<dt>Ciudad</dt><dd>' + escapar(c.city) + '</dd>' : '') +
    (c.tags ? '<dt>Etiquetas</dt><dd>' + escapar(c.tags) + '</dd>' : '') +
    (c.notes ? '<dt>Notas</dt><dd>' + escapar(c.notes) + '</dd>' : '') +
    '</dl>' +
    '<p class="meta">' +
    ficha.resumen.seguimientosAbiertos +
    ' pendiente(s), ' +
    ficha.resumen.seguimientosVencidos +
    ' vencido(s), ' +
    ficha.resumen.contactos +
    ' contacto(s)</p>' +
    '<h4>Seguimientos</h4><div class="lineas">' +
    (ficha.followups
      .map(
        (f) =>
          '<div class="linea"><span>' +
          escapar(f.title) +
          '</span><span class="estado">' +
          escapar(ETIQUETA_ESTADO[f.status] ?? f.status) +
          (f.dueDate ? ' · ' + escapar(fechaCorta(f.dueDate)) : '') +
          '</span></div>',
      )
      .join('') || '<div class="ficha vacia">Sin seguimientos</div>') +
    '</div>' +
    '<h4>Historial de contacto</h4><div class="lineas">' +
    (ficha.interactions
      .map(
        (i) =>
          '<div class="linea"><span>' +
          escapar(i.summary) +
          '</span><span class="estado">' +
          escapar(ETIQUETA_CONTACTO[i.kind] ?? i.kind) +
          ' · ' +
          escapar(instanteCorto(i.happenedAt)) +
          '</span></div>',
      )
      .join('') || '<div class="ficha vacia">Sin contactos registrados</div>') +
    '</div>';
  $('#ficha-dialog').showModal();
}

$('#ficha-cerrar').addEventListener('click', () => $('#ficha-dialog').close());

// ───────────────────────────────────────────────────────────────── seguimientos

async function pintarSeguimientos() {
  const cliente = $('#seguimiento-cliente').value;
  const datos = await api(
    `/api/followups?limit=300${cliente ? `&customerId=${encodeURIComponent(cliente)}` : ''}`,
  );
  estado.seguimientos = datos.followups;
  const nombreDe = (id) => estado.clientes.find((c) => c.id === id)?.name ?? '—';

  $('#seguimientos-lista').innerHTML = estado.seguimientos.length
    ? '<table><thead><tr><th>Cliente</th><th>Qué hay que hacer</th><th>Para el día</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
      estado.seguimientos
        .map(
          (f) =>
            '<tr><td>' +
            escapar(nombreDe(f.customerId)) +
            '</td><td>' +
            escapar(f.title) +
            (f.body ? '<br><small>' + escapar(f.body) + '</small>' : '') +
            '</td><td>' +
            escapar(fechaCorta(f.dueDate) || '—') +
            '</td><td>' +
            escapar(ETIQUETA_ESTADO[f.status] ?? f.status) +
            '</td><td>' +
            '<button type="button" data-seg-editar="' +
            f.id +
            '">Editar</button> ' +
            '<button type="button" data-seg-estado="' +
            f.id +
            '">' +
            (f.status === 'done' ? 'Reabrir' : 'Marcar hecho') +
            '</button></td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay seguimientos</div>';
}

function abrirSeguimiento(seg) {
  $('#seguimiento-id').value = seg?.id ?? '';
  $('#seguimiento-form-titulo').textContent = seg ? 'Editar seguimiento' : 'Nuevo seguimiento';
  $('#seguimiento-cancelar').hidden = !seg;
  $('#seguimiento-cliente').value = seg?.customerId ?? $('#seguimiento-cliente').value ?? '';
  $('#seguimiento-titulo').value = seg?.title ?? '';
  $('#seguimiento-detalle').value = seg?.body ?? '';
  $('#seguimiento-fecha').value = seg?.dueDate ?? '';
  $('#seguimiento-estado').value = seg?.status ?? 'pending';
}

$('#seguimiento-cancelar').addEventListener('click', () => abrirSeguimiento(null));

$('#seguimiento-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#seguimiento-id').value;
  try {
    await api(id ? `/api/followups/${id}` : '/api/followups', {
      method: id ? 'PATCH' : 'POST',
      body: {
        customerId: $('#seguimiento-cliente').value,
        title: $('#seguimiento-titulo').value,
        body: $('#seguimiento-detalle').value || null,
        dueDate: $('#seguimiento-fecha').value || null,
        status: $('#seguimiento-estado').value,
      },
    });
    abrirSeguimiento(null);
    await recargar();
    avisar(id ? 'Seguimiento actualizado' : 'Seguimiento creado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#seguimientos-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  try {
    if (boton.dataset.segEditar) {
      abrirSeguimiento(estado.seguimientos.find((f) => f.id === boton.dataset.segEditar));
    } else if (boton.dataset.segEstado) {
      const seg = estado.seguimientos.find((f) => f.id === boton.dataset.segEstado);
      // Solo se manda el estado: la fecha de completado la pone el servidor,
      // porque "se terminó ahora" es un hecho, no algo que se escriba a mano.
      await api(`/api/followups/${seg.id}`, {
        method: 'PATCH',
        body: { status: seg.status === 'done' ? 'pending' : 'done' },
      });
      await recargar();
    }
  } catch (err) {
    avisar(err.message, true);
  }
});

// ──────────────────────────────────────────────────────────────────── contactos

async function pintarContactos() {
  const datos = await api('/api/interactions?limit=300');
  estado.contactos = datos.interactions;
  const nombreDe = (id) => estado.clientes.find((c) => c.id === id)?.name ?? '—';

  $('#contactos-lista').innerHTML = estado.contactos.length
    ? '<table><thead><tr><th>Cliente</th><th>Tipo</th><th>Qué pasó</th><th>Cuándo</th></tr></thead><tbody>' +
      estado.contactos
        .map(
          (i) =>
            '<tr><td>' +
            escapar(nombreDe(i.customerId)) +
            '</td><td>' +
            escapar(ETIQUETA_CONTACTO[i.kind] ?? i.kind) +
            '</td><td>' +
            escapar(i.summary) +
            '</td><td>' +
            escapar(instanteCorto(i.happenedAt)) +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay contactos registrados</div>';
}

$('#contacto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    // No se manda `happenedAt`: un contacto se registra mientras pasa, y anotarlo
    // a mano solo abre la puerta a escribir el dia equivocado.
    await api('/api/interactions', {
      method: 'POST',
      body: {
        customerId: $('#contacto-cliente').value,
        kind: $('#contacto-tipo').value,
        summary: $('#contacto-resumen').value,
      },
    });
    $('#contacto-resumen').value = '';
    await recargar();
    avisar('Contacto registrado');
  } catch (err) {
    avisar(err.message, true);
  }
});

// ───────────────────────────────────────────────────────────────── navegación

const PANELES = {
  tablero: pintarTablero,
  clientes: () => pintarClientes(),
  seguimientos: pintarSeguimientos,
  contactos: pintarContactos,
};

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    for (const [nombre, seccion] of Object.entries({
      tablero: '#panel-tablero',
      clientes: '#panel-clientes',
      seguimientos: '#panel-seguimientos',
      contactos: '#panel-contactos',
      ajustes: '#panel-ajustes',
    })) {
      $(seccion).hidden = nombre !== boton.dataset.tab;
    }
    try {
      if (PANELES[boton.dataset.tab]) await PANELES[boton.dataset.tab]();
    } catch (err) {
      avisar(err.message, true);
    }
  });
}

/** Vuelve a pedir todo y reagrupa. Se llama después de cada escritura. */
async function recargar() {
  await cargar();
  const activo = document.querySelector('#tabs button.activo')?.dataset.tab ?? 'tablero';
  if (activo === 'tablero') await pintarTablero();
  else if (PANELES[activo]) await PANELES[activo]();
}

$('#config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const cuerpo = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    cuerpo[el.name] = el.value;
  }
  try {
    const datos = await api('/api/settings', { method: 'PUT', body: cuerpo });
    estado.cfg = datos.settings;
    renderConfig();
    avisar('Ajustes guardados');
  } catch (err) {
    avisar(err.message, true);
  }
});

/**
 * Llena el form de ajustes.
 *
 * Se recorre `form.elements` y se usa el `name` de cada input como clave del
 * ajuste, en vez de buscarlos por id uno por uno. Es lo que permite agregar un
 * ajuste nuevo poniendo un `<input name="...">` en el HTML, sin tocar este JS.
 *
 * OJO: el panel se llama `data-tab="ajustes"`, no `id="config"`. Por eso esto no
 * puede hacer `$$('#config input')`: ese selector no matchea nada y el panel
 * aparece vacío.
 */
function renderConfig() {
  const form = $('#config-form');
  const c = estado.cfg;
  for (const el of form.elements) {
    if (!el.name || c[el.name] === undefined) continue;
    el.value = c[el.name];
  }
}

$('#tablero-cliente').addEventListener('change', async () => {
  try {
    await pintarTablero();
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#seguimiento-cliente').addEventListener('change', pintarSeguimientos);

cargar().then(pintarTablero);
