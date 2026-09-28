/**
 * Interfaz de solicitudes (helpdesk).
 *
 * Una regla que no es de estilo sino de arquitectura:
 *
 *   No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *   entra por la API, que es la que filtra por organizacion. Si el HTML
 *   trajera datos, el servidor tendria que confiar en que el navegador no los
 *   altere.
 *
 * Y una segunda: la pantalla NO decide el folio. No sabe si esta solicitud es
 * la numero 8 o la 9: eso lo dice el servidor, que es el unico que ve las
 * solicitudes de las otras organizaciones. El folio que se muestra es la
 * propuesta del servidor, y se puede cambiar.
 */

const $ = (sel) => document.querySelector(sel);

const estado = {
  cfg: { currency: '$', nextNumber: 1 },
  /** La solicitud abierta en el dialogo: null cuando es una nueva. */
  editando: null,
  /** El hilo de la solicitud abierta, para no repetir la consulta. */
  hilo: { comments: [], attachments: [], history: [] },
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

const ETIQUETAS_ESTADO = {
  open: 'Abierta',
  in_progress: 'En curso',
  resolved: 'Resuelta',
  closed: 'Cerrada',
  cancelled: 'Cancelada',
};

const ETIQUETAS_PRIORIDAD = { low: 'Baja', medium: 'Media', high: 'Alta', urgent: 'Urgente' };

const etiquetaEstado = (e) => ETIQUETAS_ESTADO[e] ?? e;
const etiquetaPrioridad = (p) => ETIQUETAS_PRIORIDAD[p] ?? p;

/** La fecha se muestra como vino: lo importante es el dia, no la hora. */
function fecha(texto) {
  if (!texto) return '—';
  const f = texto.slice(0, 10);
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
}

const hoy = new Date();
const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(
  hoy.getDate(),
).padStart(2, '0')}`;

// ─────────────────────────────────────────────────────────────── pantalla principal

async function cargar() {
  const cfg = await api('/api/settings');
  estado.cfg = cfg.settings;
}

async function pintarResumen() {
  const r = await api('/api/resumen');
  $('#resumen').innerHTML = [
    ['Abiertas', r.abiertas, ''],
    ['Vencidas', r.vencidas, 'urgente'],
    ['Resueltas', r.resueltas, ''],
    ['Prioridad alta', r.alta, 'urgente'],
  ]
    .map(
      ([titulo, valor, clase]) =>
        `<div class="tarjeta ${clase}"><strong>${valor}</strong><span>${titulo}</span></div>`,
    )
    .join('');
}

async function pintarLista() {
  const q = encodeURIComponent($('#filtro-q').value.trim());
  const status = $('#filtro-estado').value;
  const priority = $('#filtro-prioridad').value;
  const params = new URLSearchParams({ limit: '500' });
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (q) params.set('q', q);
  const { requests } = await api(`/api/requests?${params.toString()}`);

  if (requests.length === 0) {
    $('#solicitudes-lista').innerHTML = '<p>Todavía no hay solicitudes.</p>';
    return;
  }

  const claseEstado = (s) => ({ closed: 'cerrada', cancelled: 'cerrada' })[s] ?? '';
  const clasePrioridad = (p) => ({ high: 'alta', urgent: 'urgente' })[p] ?? '';
  const vencida = (r) =>
    r.status === 'open' || r.status === 'in_progress' ? r.dueAt !== null && r.dueAt < hoyIso : false;

  $('#solicitudes-lista').innerHTML = `<table>
    <thead><tr><th>Folio</th><th>Título</th><th>Solicitante</th><th>Responsable</th><th>Prioridad</th><th>Estado</th><th>Vence</th><th></th></tr></thead>
    <tbody>
      ${requests
        .map(
          (r) => `<tr>
            <td>#${r.number}</td>
            <td>${escapar(r.title)}</td>
            <td>${escapar(r.requesterName)}</td>
            <td>${escapar(r.responsibleName ?? '—')}</td>
            <td><span class="etiqueta ${clasePrioridad(r.priority)}">${etiquetaPrioridad(r.priority)}</span></td>
            <td><span class="etiqueta ${claseEstado(r.status)}">${etiquetaEstado(r.status)}</span></td>
            <td><span class="etiqueta ${vencida(r) ? 'vencida' : ''}">${fecha(r.dueAt)}</span></td>
            <td>
              <button data-ver="${r.id}">Ver</button>
              <button data-borrar="${r.id}">Borrar</button>
            </td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>`;

  for (const b of document.querySelectorAll('[data-ver]')) {
    b.addEventListener('click', () => abrirSolicitud(b.dataset.ver));
  }
  for (const b of document.querySelectorAll('[data-borrar]')) {
    b.addEventListener('click', async () => {
      if (!confirm('¿Borrar la solicitud con su hilo y sus adjuntos?')) return;
      try {
        await api(`/api/requests/${b.dataset.borrar}`, { method: 'DELETE' });
        avisar('Solicitud borrada');
        await pintarLista();
        await pintarResumen();
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

// ────────────────────────────────────────────────────────────────────── diálogo

function limpiaFormulario() {
  estado.editando = null;
  estado.hilo = { comments: [], attachments: [], history: [] };
  $('#solicitud-form').reset();
  // El folio propuesto sale de los ajustes que ya trajo el servidor.
  $('#sol-folio').value = estado.cfg.nextNumber;
  $('#sol-prioridad').value = 'medium';
  $('#sol-estado').value = 'open';
  $('#solicitud-form-titulo').textContent = 'Nueva solicitud';
  $('#solicitud-guardar').textContent = 'Guardar solicitud';
  $('#hilo-seccion').hidden = true;
}

function pintarHilo() {
  const { comments, attachments: archivos, history } = estado.hilo;

  $('#hilo').innerHTML =
    comments.length === 0
      ? '<p class="evento">Sin comentarios todavía.</p>'
      : comments
          .map(
            (c) => `<div class="comentario">
            <span class="autor">${escapar(c.authorName)}</span>
            <span class="fecha"> · ${fecha(c.createdAt)}</span>
            <p>${escapar(c.content)}</p>
          </div>`,
          )
          .join('');

  $('#adjuntos').innerHTML =
    archivos.length === 0
      ? '<p class="evento">Sin adjuntos.</p>'
      : archivos
          .map(
            (a) => `<div class="adjunto">
            <a href="${a.url}" download="${escapar(a.filename)}">${escapar(a.filename)}</a>
            <span class="tamano">${(a.sizeBytes / 1024).toFixed(1)} KB</span>
            <button type="button" data-quitar-adjunto="${a.id}">Quitar</button>
          </div>`,
          )
          .join('');

  $('#historial').innerHTML =
    history.length === 0
      ? '<p class="evento">Sin cambios de estado.</p>'
      : history
          .map(
            (h) => `<div class="evento">
            <span class="autor">${h.oldStatus ? `${etiquetaEstado(h.oldStatus)} → ${etiquetaEstado(h.newStatus)}` : `Creada en estado ${etiquetaEstado(h.newStatus)}`}</span>
            <span class="fecha"> · ${escapar(h.changedBy)} · ${fecha(h.createdAt)}</span>
          </div>`,
          )
          .join('');

  for (const b of document.querySelectorAll('[data-quitar-adjunto]')) {
    b.addEventListener('click', async () => {
      if (!confirm('¿Quitar este adjunto?')) return;
      try {
        await api(`/api/requests/${estado.editando}/attachments/${b.dataset.quitarAdjunto}`, {
          method: 'DELETE',
        });
        await abrirSolicitud(estado.editando);
      } catch (e) {
        avisar(e.message, true);
      }
    });
  }
}

async function abrirSolicitud(idSol) {
  const { request, comments, attachments: archivos, history } = await api(`/api/requests/${idSol}`);
  estado.editando = request.id;
  estado.hilo = { comments, attachments: archivos, history };

  $('#solicitud-form-titulo').textContent = `Solicitud #${request.number}`;
  $('#sol-folio').value = request.number;
  $('#sol-prioridad').value = request.priority;
  $('#sol-estado').value = request.status;
  $('#sol-titulo').value = request.title;
  $('#sol-descripcion').value = request.description ?? '';
  $('#sol-solicitante').value = request.requesterName;
  $('#sol-correo').value = request.requesterEmail ?? '';
  $('#sol-responsable').value = request.responsibleName ?? '';
  $('#sol-vencimiento').value = request.dueAt ?? '';
  $('#sol-resolucion').value = request.resolution ?? '';
  $('#solicitud-guardar').textContent = 'Guardar cambios';
  $('#hilo-seccion').hidden = false;
  pintarHilo();
  $('#solicitud-dialog').showModal();
}

// ─────────────────────────────────────────────────────────────────────── eventos

function cuerpoDelFormulario() {
  return {
    number: Number($('#sol-folio').value) || null,
    title: $('#sol-titulo').value.trim(),
    description: $('#sol-descripcion').value.trim() || null,
    requesterName: $('#sol-solicitante').value.trim(),
    requesterEmail: $('#sol-correo').value.trim() || null,
    responsibleName: $('#sol-responsable').value.trim() || null,
    priority: $('#sol-prioridad').value,
    status: $('#sol-estado').value,
    dueAt: $('#sol-vencimiento').value || null,
    resolution: $('#sol-resolucion').value.trim() || null,
  };
}

$('#solicitud-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    if (estado.editando) {
      await api(`/api/requests/${estado.editando}`, { method: 'PATCH', body: cuerpoDelFormulario() });
      avisar('Solicitud actualizada');
    } else {
      await api('/api/requests', { method: 'POST', body: cuerpoDelFormulario() });
      avisar('Solicitud creada');
    }
    $('#solicitud-dialog').close();
    await pintarLista();
    await pintarResumen();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#solicitud-cancelar').addEventListener('click', () => $('#solicitud-dialog').close());
$('#solicitud-nueva').addEventListener('click', () => {
  limpiaFormulario();
  $('#solicitud-dialog').showModal();
});

$('#comentario-agregar').addEventListener('click', async () => {
  const contenido = $('#comentario-texto').value.trim();
  if (!contenido) return avisar('Escribí un comentario primero', true);
  if (!estado.editando) return;
  try {
    await api(`/api/requests/${estado.editando}/comments`, {
      method: 'POST',
      body: { content: contenido },
    });
    $('#comentario-texto').value = '';
    await abrirSolicitud(estado.editando);
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#adjunto-agregar').addEventListener('click', async () => {
  const archivo = $('#adjunto-archivo').files[0];
  if (!archivo) return avisar('Elegí un archivo primero', true);
  if (!estado.editando) return;
  if (archivo.size > 750_000) return avisar('El archivo no puede superar 750 KB', true);
  try {
    // El navegador lee el archivo y lo manda en base64 dentro del JSON; el
    // servidor lo decodifica y lo guarda en disco.
    const data = await new Promise((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(lector.result);
      lector.onerror = () => reject(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });
    await api(`/api/requests/${estado.editando}/attachments`, {
      method: 'POST',
      body: { filename: archivo.name, mimeType: archivo.type || null, data },
    });
    $('#adjunto-archivo').value = '';
    avisar('Archivo adjuntado');
    await abrirSolicitud(estado.editando);
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#filtro-q').addEventListener('input', () => pintarLista());
$('#filtro-estado').addEventListener('change', () => pintarLista());
$('#filtro-prioridad').addEventListener('change', () => pintarLista());

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        currency: $('#cfg-moneda').value.trim() || '$',
        timezone: $('#cfg-zona').value.trim(),
      },
    });
    avisar('Ajustes guardados');
    await cargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

// ───────────────────────────────────────────────────────────────── navegación

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    $('#panel-solicitudes').hidden = boton.dataset.tab !== 'solicitudes';
    $('#panel-ajustes').hidden = boton.dataset.tab !== 'ajustes';
    if (boton.dataset.tab === 'ajustes') renderConfig();
  });
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
}

cargar().then(async () => {
  $('#sol-folio').value = estado.cfg.nextNumber;
  await pintarResumen();
  await pintarLista();
});