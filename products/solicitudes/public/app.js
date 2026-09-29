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
 *
 * El nombre de la empresa y de la persona, el canal y las pestañas los pone
 * `/amigo.js`; las tablas, tarjetas y etiquetas, `AMIGO_UI`.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

const estado = {
  cfg: { currency: '$', nextNumber: 1 },
  /** La solicitud abierta en el dialogo: null cuando es una nueva. */
  editando: null,
  /** El hilo de la solicitud abierta, para no repetir la consulta. */
  hilo: { comments: [], attachments: [], history: [] },
};

/**
 * Los estados y las prioridades, con su tono.
 *
 * El tono importa tanto como la palabra: una tabla donde todo dice "Pendiente"
 * sin color obliga a leer celda por celda. Con color, un barrido de la vista
 * dice cuantas hay urgentes.
 */
const ESTADOS = {
  open: { texto: 'Abierta', tono: 'acento' },
  in_progress: { texto: 'En curso', tono: 'aviso' },
  resolved: { texto: 'Resuelta', tono: 'ok' },
  closed: { texto: 'Cerrada', tono: 'neutro' },
  cancelled: { texto: 'Cancelada', tono: 'neutro' },
};

const PRIORIDADES = {
  low: { texto: 'Baja', tono: 'neutro' },
  medium: { texto: 'Media', tono: 'neutro' },
  high: { texto: 'Alta', tono: 'aviso' },
  urgent: { texto: 'Urgente', tono: 'malo' },
};

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
  AMIGO_UI.kpis($('#resumen'), [
    [r.abiertas, 'Abiertas', true],
    [r.vencidas, 'Vencidas'],
    [r.resueltas, 'Resueltas'],
    [r.alta, 'Prioridad alta'],
  ]);
}

/** Vencida es solo si sigue abierta: una resuelta que pasó su fecha no lo está. */
const vencida = (r) =>
  (r.status === 'open' || r.status === 'in_progress') && r.dueAt !== null && r.dueAt < hoyIso;

async function pintarLista() {
  const q = encodeURIComponent($('#filtro-q').value.trim());
  const status = $('#filtro-estado').value;
  const priority = $('#filtro-prioridad').value;
  const params = new URLSearchParams({ limit: '500' });
  if (status) params.set('status', status);
  if (priority) params.set('priority', priority);
  if (q) params.set('q', q);
  const { requests } = await api(`/api/requests?${params.toString()}`);

  const tabla = AMIGO_UI.tabla([
    'Folio',
    'Título',
    'Solicitante',
    'Responsable',
    'Prioridad',
    'Estado',
    'Vence',
    '',
  ]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (requests.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(8, 'Todavía no hay solicitudes.'));
  } else {
    for (const r of requests) {
      const folio = document.createElement('span');
      folio.className = 'mono';
      folio.textContent = `#${r.number}`;

      // La fecha límite es texto y no etiqueta cuando no hay problema: un chip por
      // cada fila convierte la columna en ruido. El color se reserva para lo que
      // hay que mirar de verdad, que es la fecha que ya pasó.
      const vence = document.createElement('span');
      vence.textContent = fecha(r.dueAt);
      const celdaVence = vencida(r) ? AMIGO_UI.etiqueta(`${fecha(r.dueAt)} · vencida`, 'malo') : vence;

      cuerpo.append(
        AMIGO_UI.fila(
          [
            folio,
            r.title,
            r.requesterName,
            r.responsibleName ?? '—',
            AMIGO_UI.estadoDe(r.priority, PRIORIDADES),
            AMIGO_UI.estadoDe(r.status, ESTADOS),
            celdaVence,
            AMIGO_UI.celda(
              AMIGO_UI.boton('Ver', () => abrirSolicitud(r.id).catch((e) => avisar(e.message, true))),
              AMIGO_UI.boton(
                'Borrar',
                async () => {
                  if (!confirm('¿Borrar la solicitud con su hilo y sus adjuntos?')) return;
                  try {
                    await api(`/api/requests/${r.id}`, { method: 'DELETE' });
                    avisar('Solicitud borrada');
                    await pintarLista();
                    await pintarResumen();
                  } catch (e) {
                    avisar(e.message, true);
                  }
                },
                'ui-btn ui-btn--chico ui-btn--fantasma',
              ),
            ),
          ],
          { className: 'acciones' },
        ),
      );
    }
  }

  $('#solicitudes-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
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

  const cajaHilo = $('#hilo');
  if (comments.length === 0) {
    cajaHilo.replaceChildren(AMIGO_UI.vacio(document.createElement('div'), 'Sin comentarios todavía.'));
  } else {
    cajaHilo.replaceChildren(
      ...comments.map((c) => {
        const div = document.createElement('article');
        div.className = 'ui-comentario';
        const cabeza = document.createElement('div');
        cabeza.className = 'ui-comentario__cabeza';
        const autor = document.createElement('span');
        autor.className = 'ui-comentario__autor';
        autor.textContent = c.authorName;
        const cuando = document.createElement('span');
        cuando.className = 'ui-comentario__fecha';
        cuando.textContent = fecha(c.createdAt);
        cabeza.append(autor, cuando);
        const texto = document.createElement('p');
        texto.className = 'ui-comentario__texto';
        texto.textContent = c.content;
        div.append(cabeza, texto);
        return div;
      }),
    );
  }

  const cajaAdj = $('#adjuntos');
  if (archivos.length === 0) {
    cajaAdj.replaceChildren(AMIGO_UI.vacio(document.createElement('div'), 'Sin adjuntos.'));
  } else {
    cajaAdj.replaceChildren(
      ...archivos.map((a) => {
        const fila = document.createElement('div');
        fila.className = 'ui-ficha';
        const enlace = document.createElement('a');
        enlace.href = a.url;
        enlace.download = a.filename;
        enlace.textContent = a.filename;
        const cuerpo = document.createElement('div');
        cuerpo.className = 'ui-ficha__cuerpo';
        const nota = document.createElement('span');
        nota.className = 'ui-ficha__nota';
        nota.textContent = `${(a.sizeBytes / 1024).toFixed(1)} KB`;
        cuerpo.append(enlace, nota);
        const acciones = document.createElement('div');
        acciones.className = 'ui-ficha__acciones';
        acciones.append(
          AMIGO_UI.boton(
            'Quitar',
            async () => {
              if (!confirm('¿Quitar este adjunto?')) return;
              try {
                await api(`/api/requests/${estado.editando}/attachments/${a.id}`, { method: 'DELETE' });
                await abrirSolicitud(estado.editando);
              } catch (e) {
                avisar(e.message, true);
              }
            },
            'ui-btn ui-btn--chico ui-btn--fantasma',
          ),
        );
        fila.append(cuerpo, acciones);
        return fila;
      }),
    );
  }

  const cajaHist = $('#historial');
  if (history.length === 0) {
    cajaHist.replaceChildren(AMIGO_UI.vacio(document.createElement('div'), 'Sin cambios de estado.'));
  } else {
    cajaHist.replaceChildren(
      ...history.map((h) => {
        const div = document.createElement('div');
        div.className = 'ui-evento';
        const cambio = document.createElement('div');
        cambio.className = 'ui-evento__cambio';
        cambio.textContent = h.oldStatus
          ? `${(ESTADOS[h.oldStatus] ?? { texto: h.oldStatus }).texto} → ${(ESTADOS[h.newStatus] ?? { texto: h.newStatus }).texto}`
          : `Creada en estado ${(ESTADOS[h.newStatus] ?? { texto: h.newStatus }).texto}`;
        const meta = document.createElement('div');
        meta.className = 'ui-evento__meta';
        meta.textContent = `${h.changedBy} · ${fecha(h.createdAt)}`;
        div.append(cambio, meta);
        return div;
      }),
    );
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
$('#solicitud-cerrar').addEventListener('click', () => $('#solicitud-dialog').close());
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

$('#filtro-q').addEventListener('input', () => pintarLista().catch((e) => avisar(e.message, true)));
$('#filtro-estado').addEventListener('change', () => pintarLista().catch((e) => avisar(e.message, true)));
$('#filtro-prioridad').addEventListener('change', () => pintarLista().catch((e) => avisar(e.message, true)));

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

// ───────────────────────────────────────────────────────────────── navegación

/** Las pestañas las lleva el shell compartido; acá solo qué pintar en cada una. */
function alEntrar(panel) {
  if (panel === 'ajustes') renderConfig();
  else pintarLista().catch((e) => avisar(e.message, true));
}

AMIGO.montar({
  nombre: 'Solicitudes',
  paneles: ['solicitudes', 'ajustes'],
  alEntrar,
});

cargar()
  .then(async () => {
    renderConfig();
    $('#sol-folio').value = estado.cfg.nextNumber;
    await pintarResumen();
    await pintarLista();
  })
  .catch((e) => avisar(e.message, true));
