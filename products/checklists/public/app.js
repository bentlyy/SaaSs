/**
 * Interfaz de checklists e inspecciones.
 *
 * Reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. Una corrida NO se cierra desde esta pantalla. No hay ningun boton que
 *      escriba el estado por detras: el unico camino es `POST /api/runs/:id/completar`
 *      (o un PATCH de estado, que aplica la misma regla), y el 400 que vuelve dice
 *      que puntos obligatorios faltan. Si el boton "completar" funcionara sin
 *      respuesta del servidor, la pantalla seria la puerta trasera de la invariante
 *      que hace que este producto valga.
 *
 *   3. Los puntos que se ven en una ficha son los de LA CORRIDA, no los de la
 *      plantilla. Por eso la pantalla nunca vuelve a pedir la plantilla para
 *      mostrarlos: la corrida ya lleva su copia (tipo, opciones y seccion
 *      incluidos), y una plantilla cambiada despues no puede alterar lo que se
 *      responde.
 *
 *   4. Los numeros los muestra el servidor (secciones y puntos 1..N sin huecos)
 *      y la pantalla no los recalcula. Si los recalculara, el "3" que ve la
 *      persona y el que se manda al responder serian dos numeros distintos en
 *      cuanto alguien borre un punto en otra pestania.
 *
 *   5. Cada punto se responde SEGUN SU TIPO: Si/No con tres botones, y texto,
 *      numero o seleccion con su campo y su boton Guardar. El select solo puede
 *      elegir de las opciones del snapshot de la corrida, que son las de ese dia.
 *
 *   6. Un punto respondido es un hecho. De una corrida no se quita nada: editar
 *      la plantilla cambia lo que vendra, no lo que ya paso.
 */

const $ = (sel) => document.querySelector(sel);

const RESPUESTAS = ['ok', 'fail', 'na'];

const estado = {
  plantillas: [],
  /** La estructura de la plantilla abierta en el editor (`/estructura`). */
  estructura: { template: null, sections: [] },
  /** El punto que se esta editando en el editor, para saber a donde mandar el PATCH. */
  puntoEditando: null,
  corridas: [],
  cfg: { currency: '$', timezone: 'America/Santiago' },
  /** La corrida abierta en la ficha, para reescribirla al responder un punto. */
  corridaId: null,
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

const ETIQUETA_RUN = {
  in_progress: 'En curso',
  done: 'Completada',
  canceled: 'Cancelada',
};

const ETIQUETA_RESULTADO = {
  ok: 'Cumple',
  fail: 'No cumple',
  na: 'No aplica',
};

const ETIQUETA_TIPO = {
  yes_no: 'Si / No',
  text: 'Texto',
  number: 'Numero',
  select: 'Seleccion',
};

const ETIQUETA_RESULTADO_GLOBAL = {
  approved: 'Aprobado',
  observed: 'Observado',
  rejected: 'Rechazado',
};

/**
 * Una linea del textarea de puntos a la lista que espera la API.
 *
 * La convencion es que un `*` AL FINAL marca el punto como opcional, y el `*` se
 * saca del texto: mandarlo como parte de la etiqueta haria que el punto se
 * llamara "Extintor *", que es exactamente la clase de dato que despues nadie
 * sabe si es parte de la etiqueta o un resto del formato.
 *
 * Se descarta toda linea vacia: la ultima linea de un textarea casi siempre esta
 * vacia, y mandarla seria un 400 "un punto necesita un texto" por un salto de linea.
 */
function puntosDesdeTexto(texto) {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const opcional = linea.endsWith('*');
      return { label: (opcional ? linea.slice(0, -1) : linea).trim(), required: opcional ? 0 : 1 };
    })
    .filter((punto) => punto.label !== '');
}

/** Las opciones de un select escritas en un textarea (una por linea). */
function opcionesDesdeTexto(texto) {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);
}

const instanteCorto = (iso) => (iso ? new Date(iso).toLocaleString('es-CL') : '');

function tamanoCorto(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;
}

/** `null` es "todavia no hay nada que medir": se muestra como un guion. */
function porcentaje(valor) {
  return valor === null || valor === undefined ? '—' : `${valor}%`;
}

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [plantillas, corridas, cfg] = await Promise.all([
    api('/api/templates?limit=500'),
    api('/api/runs?limit=500'),
    api('/api/settings'),
  ]);
  estado.plantillas = plantillas.items;
  estado.corridas = corridas.items;
  estado.cfg = cfg.settings;
  renderConfig();
  pintarSelectores();
}

function tarjeta(numero, texto) {
  return `<div class="tarjeta"><strong>${escapar(numero)}</strong><span>${escapar(texto)}</span></div>`;
}

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const tablero = await api('/api/dashboard');

  $('#resumen').innerHTML = [
    tarjeta(tablero.total, 'Corridas'),
    tarjeta(tablero.porStatus.in_progress, 'En curso'),
    tarjeta(tablero.porStatus.done, 'Completadas'),
    tarjeta(tablero.porStatus.canceled, 'Canceladas'),
    tarjeta(tablero.porResultado.approved, 'Aprobadas'),
    tarjeta(tablero.porResultado.observed, 'Observadas'),
    tarjeta(tablero.porResultado.rejected, 'Rechazadas'),
    tarjeta(tablero.porResultado.sin, 'Sin veredicto'),
    tarjeta(porcentaje(tablero.cumplimientoPromedioPct), 'Cumplimiento promedio'),
  ].join('');

  // El tablero arma la lista de fallas con el nombre de la corrida pegado a cada
  // punto. El servidor se lo manda junto: el punto sin saber de donde salio obliga
  // a abrir diez fichas para encontrarlo.
  $('#fallos').innerHTML =
    tablero.fallos
      .map(
        (f) =>
          '<div class="linea"><span><strong>' +
          escapar(f.position + '. ' + f.label) +
          '</strong>' +
          (f.note ? '<br><small>' + escapar(f.note) + '</small>' : '') +
          '</span><span class="estado">' +
          escapar(f.templateName) +
          (f.location ? ' &middot; ' + escapar(f.location) : '') +
          ' &middot; ' +
          escapar(instanteCorto(f.startedAt)) +
          '</span></div>',
      )
      .join('') || '<div class="ficha vacia">No hay puntos fallados en las ultimas corridas</div>';
}

// ─────────────────────────────────────────────────────────────────── plantillas

function pintarPlantillas() {
  const busqueda = $('#plantilla-buscar').value.trim().toLowerCase();
  const filtro = $('#plantilla-filtro').value;

  const lista = estado.plantillas.filter((t) => {
    if (filtro === '1' && !t.active) return false;
    if (filtro === '0' && t.active) return false;
    if (!busqueda) return true;
    return [t.name, t.description].some((v) => String(v ?? '').toLowerCase().includes(busqueda));
  });

  $('#plantillas-lista').innerHTML = lista.length
    ? '<table><thead><tr><th>Nombre</th><th>Descripcion</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
      lista
        .map(
          (t) =>
            '<tr><td>' +
            escapar(t.name) +
            '</td><td>' +
            escapar(t.description ?? '—') +
            '</td><td>' +
            (t.active ? 'Activa' : 'Inactiva') +
            '</td><td>' +
            '<button type="button" data-puntos="' +
            t.id +
            '">Puntos</button> ' +
            '<button type="button" data-editar="' +
            t.id +
            '">Editar</button> ' +
            '<button type="button" data-toggle="' +
            t.id +
            '">' +
            (t.active ? 'Desactivar' : 'Activar') +
            '</button> ' +
            '<button type="button" data-duplicar="' +
            t.id +
            '">Duplicar</button> ' +
            '<button type="button" data-borrar="' +
            t.id +
            '">Borrar</button>' +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay plantillas que coincidan</div>';
}

/** Los dos selectores de plantillas (empezar corrida y filtrar corridas). */
function pintarSelectores() {
  const opcion = (t) => `<option value="${escapar(t.id)}">${escapar(t.name)}</option>`;
  // Solo las activas alcanzan al selector de "empezar corrida": una plantilla
  // desactivada existe, pero elegirla a proposito se hace con el filtro de la
  // lista, no por accidente desde el formulario.
  const activas = estado.plantillas.filter((t) => t.active);

  $('#corrida-plantilla').innerHTML =
    '<option value="">Corrida libre (sin plantilla)</option>' + activas.map(opcion).join('');

  const elegido = $('#corrida-plantilla-filtro').value;
  $('#corrida-plantilla-filtro').innerHTML =
    '<option value="">Todas</option>' + estado.plantillas.map(opcion).join('');
  $('#corrida-plantilla-filtro').value = elegido;
}

function abrirPlantilla(plantilla) {
  $('#plantilla-id').value = plantilla?.id ?? '';
  $('#plantilla-titulo').textContent = plantilla ? 'Editar plantilla' : 'Nueva plantilla';
  $('#plantilla-cancelar').hidden = !plantilla;
  $('#plantilla-nombre').value = plantilla?.name ?? '';
  $('#plantilla-descripcion').value = plantilla?.description ?? '';
  // Al editar NO se tocan los puntos que ya estan: se editan en el editor de
  // abajo, por seccion y uno por uno, con sus propios endpoints. Volver a mandar
  // el textarea sobreescribiria la lista de la plantilla con lo que la pantalla
  // recuerda, y en cuanto alguien abriera la misma plantilla en otra pestania se
  // perderian los puntos que agrego.
  $('#plantilla-items').value = '';
  $('#plantilla-items').disabled = Boolean(plantilla);
  $('#plantilla-editor').hidden = !plantilla;
  estado.puntoEditando = null;
  if (plantilla) {
    $('#plantilla-seleccionada').textContent = plantilla.name;
    abrirPuntos(plantilla.id);
  }
}

async function abrirPuntos(plantillaId) {
  const datos = await api(`/api/templates/${plantillaId}/estructura`);
  estado.estructura = datos;
  $('#plantilla-seleccionada').textContent =
    estado.plantillas.find((t) => t.id === plantillaId)?.name ?? datos.template.name ?? '';
  pintarEditor();
}

/**
 * Pinta el editor completo: la lista de secciones con sus puntos, el selector de
 * seccion del form de agregar y los forms de edicion (que quedan ocultos).
 *
 * Los `position` que se muestran son los de la API: las secciones ya vienen
 * 1..N y los puntos de cada seccion 1..N, renumerados por el servidor.
 */
function pintarEditor() {
  const { sections } = estado.estructura;

  // El selector de seccion del form de agregar un punto.
  const elegida = $('#punto-seccion').value;
  $('#punto-seccion').innerHTML = sections
    .map((s, i) => `<option value="${escapar(s.id)}">${i + 1}. ${escapar(s.name)}</option>`)
    .join('');
  if (!sections.some((s) => s.id === elegida)) {
    $('#punto-seccion').value = sections[0]?.id ?? '';
  } else {
    $('#punto-seccion').value = elegida;
  }

  $('#plantilla-secciones-lista').innerHTML = sections.length
    ? sections
        .map((s, i) => {
          const puntos = s.items.length
            ? s.items
                .map(
                  (p) =>
                    '<div class="linea"><span><strong>' +
                    p.position +
                    '.</strong> ' +
                    escapar(p.label) +
                    ' <small>(' +
                    escapar(ETIQUETA_TIPO[p.type] ?? p.type) +
                    ' · ' +
                    (p.required ? 'obligatorio' : 'opcional') +
                    ')</small></span><span class="estado">' +
                    '<button type="button" data-editar-item="' +
                    p.id +
                    '">Editar</button> ' +
                    '<button type="button" data-quitar="' +
                    p.id +
                    '">Quitar</button></span></div>',
                )
                .join('')
            : '<div class="ficha vacia">Esta seccion no tiene puntos todavia</div>';
          return (
            '<section class="seccion"><div class="seccion-cabecera"><strong>' +
            (i + 1) +
            '.</strong>' +
            '<span class="seccion-nombre">' +
            escapar(s.name) +
            '</span><span class="estado">' +
            '<button type="button" data-seccion-subir="' +
            s.id +
            '">Subir</button> ' +
            '<button type="button" data-seccion-bajar="' +
            s.id +
            '">Bajar</button> ' +
            '<button type="button" data-seccion-renombrar="' +
            s.id +
            '">Renombrar</button> ' +
            '<button type="button" data-seccion-borrar="' +
            s.id +
            '">Borrar seccion</button></span></div>' +
            '<div class="seccion-puntos">' +
            puntos +
            '</div></section>'
          );
        })
        .join('')
    : '<div class="ficha vacia">Esta plantilla no tiene secciones todavia. Agrega una abajo o empieza por los puntos.</div>';

  // Los forms de edicion arrancan siempre ocultos; se abren al pulsar Editar.
  estado.puntoEditando = null;
  $('#punto-editar-form').hidden = true;
}

$('#plantilla-cancelar').addEventListener('click', () => {
  abrirPlantilla(null);
  $('#plantilla-editor').hidden = true;
});

$('#plantilla-buscar').addEventListener('input', pintarPlantillas);
$('#plantilla-filtro').addEventListener('change', pintarPlantillas);

$('#plantilla-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#plantilla-id').value;
  const cuerpo = {
    name: $('#plantilla-nombre').value,
    description: $('#plantilla-descripcion').value || null,
  };
  try {
    if (id) {
      await api(`/api/templates/${id}`, { method: 'PATCH', body: cuerpo });
    } else {
      // Los puntos iniciales van en la misma llamada que la plantilla: el servidor
      // los escribe en la misma transaccion, en la seccion "General", y asi no
      // queda una plantilla a la que le falte la mitad de la lista.
      const items = puntosDesdeTexto($('#plantilla-items').value);
      await api('/api/templates', { method: 'POST', body: { ...cuerpo, items } });
    }
    abrirPlantilla(null);
    $('#plantilla-editor').hidden = true;
    await recargar();
    avisar(id ? 'Plantilla actualizada' : 'Plantilla creada');
  } catch (err) {
    avisar(err.message, true);
  }
});

/**
 * Mueve una seccion una posicion, mandando el orden NUEVO entero a la API.
 *
 * El servidor exige la lista completa del orden y renumera a 1..N: por eso aca
 * no se toca ningun numero, solo se intercambian los ids y se pregunta de nuevo.
 */
async function moverSeccion(seccionId, delta) {
  const orden = estado.estructura.sections.map((s) => s.id);
  const indice = orden.indexOf(seccionId);
  const destino = indice + delta;
  if (indice < 0 || destino < 0 || destino >= orden.length) return;
  [orden[indice], orden[destino]] = [orden[destino], orden[indice]];
  const plantillaId = $('#plantilla-id').value;
  try {
    await api(`/api/templates/${plantillaId}/sections/ordenar`, { method: 'POST', body: { order: orden } });
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Seccion movida');
  } catch (err) {
    avisar(err.message, true);
  }
}

/** Abre el form de renombrar la seccion con el nombre actual listo para editar. */
function abrirRenombrarSeccion(seccion) {
  $('#seccion-renombrar-id').value = seccion.id;
  $('#seccion-renombrar-nombre').value = seccion.name;
  $('#seccion-renombrar-form').hidden = false;
  $('#seccion-renombrar-nombre').focus();
}

$('#seccion-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plantillaId = $('#plantilla-id').value;
  if (!plantillaId) return;
  try {
    await api(`/api/templates/${plantillaId}/sections`, {
      method: 'POST',
      body: { name: $('#seccion-nombre').value },
    });
    $('#seccion-nombre').value = '';
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Seccion agregada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#seccion-renombrar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plantillaId = $('#plantilla-id').value;
  try {
    await api(
      `/api/templates/${plantillaId}/sections/${$('#seccion-renombrar-id').value}`,
      { method: 'PATCH', body: { name: $('#seccion-renombrar-nombre').value } },
    );
    $('#seccion-renombrar-form').hidden = true;
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Seccion renombrada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#seccion-renombrar-cancelar').addEventListener('click', () => {
  $('#seccion-renombrar-form').hidden = true;
});

// El editor de secciones delega todo (clic en botones, envio de forms): los
// controles viven adentro de la lista y cambian con cada repintado.
$('#plantilla-secciones-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  const plantillaId = $('#plantilla-id').value;
  try {
    if (boton.dataset.seccionSubir) {
      await moverSeccion(boton.dataset.seccionSubir, -1);
    } else if (boton.dataset.seccionBajar) {
      await moverSeccion(boton.dataset.seccionBajar, 1);
    } else if (boton.dataset.seccionRenombrar) {
      const seccion = estado.estructura.sections.find((s) => s.id === boton.dataset.seccionRenombrar);
      if (seccion) abrirRenombrarSeccion(seccion);
    } else if (boton.dataset.seccionBorrar) {
      // Borrar una seccion borra SUS PUNTOS con ella; las corriadas ya hechas no
      // se tocan, que es lo que dice el aviso.
      if (!confirm('Se borran la seccion y sus puntos de la plantilla. Las corridas quedan con su copia.')) return;
      await api(`/api/templates/${plantillaId}/sections/${boton.dataset.seccionBorrar}`, { method: 'DELETE' });
      await abrirPuntos(plantillaId);
      await recargar();
      avisar('Seccion borrada y renumerada');
    } else if (boton.dataset.quitar) {
      // El servidor renumera lo que queda a 1..N y devuelve la lista nueva: por eso
      // esta pantalla repinta con la respuesta en vez de tapar el numero en local.
      await api(`/api/templates/${plantillaId}/items/${boton.dataset.quitar}`, { method: 'DELETE' });
      await abrirPuntos(plantillaId);
      await recargar();
      avisar('Punto quitado y renumerado');
    } else if (boton.dataset.editarItem) {
      const punto = estado.estructura.sections
        .flatMap((s) => s.items)
        .find((p) => p.id === boton.dataset.editarItem);
      if (!punto) return;
      estado.puntoEditando = punto.id;
      $('#punto-editar-id').value = punto.id;
      $('#punto-editar-label').value = punto.label;
      $('#punto-editar-tipo').value = punto.type;
      $('#punto-editar-required').checked = Boolean(punto.required);
      $('#punto-editar-opciones').value = (punto.options ?? []).join('\n');
      $('#punto-editar-opciones-caja').hidden = punto.type !== 'select';
      $('#punto-editar-form').hidden = false;
      $('#punto-editar-label').focus();
    }
  } catch (err) {
    avisar(err.message, true);
  }
});

// Las opciones solo significan para un punto de seleccion: el campo aparece y
// desaparece con el tipo elegido, y no se presta a llenar opciones inutiles.
$('#punto-tipo').addEventListener('change', () => {
  $('#punto-opciones-caja').hidden = $('#punto-tipo').value !== 'select';
});

$('#punto-editar-tipo').addEventListener('change', () => {
  $('#punto-editar-opciones-caja').hidden = $('#punto-editar-tipo').value !== 'select';
});

$('#punto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plantillaId = $('#plantilla-id').value;
  if (!plantillaId) return;
  const tipo = $('#punto-tipo').value;
  const cuerpo = {
    label: $('#punto-label').value,
    required: $('#punto-requerido').checked ? 1 : 0,
    type: tipo,
    sectionId: $('#punto-seccion').value || undefined,
  };
  if (tipo === 'select') cuerpo.options = opcionesDesdeTexto($('#punto-opciones').value);
  try {
    await api(`/api/templates/${plantillaId}/items`, { method: 'POST', body: cuerpo });
    $('#punto-label').value = '';
    $('#punto-opciones').value = '';
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Punto agregado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#punto-editar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plantillaId = $('#plantilla-id').value;
  const itemId = $('#punto-editar-id').value;
  const tipo = $('#punto-editar-tipo').value;
  const cuerpo = {
    label: $('#punto-editar-label').value,
    required: $('#punto-editar-required').checked ? 1 : 0,
    type: tipo,
  };
  if (tipo === 'select') cuerpo.options = opcionesDesdeTexto($('#punto-editar-opciones').value);
  try {
    await api(`/api/templates/${plantillaId}/items/${itemId}`, { method: 'PATCH', body: cuerpo });
    $('#punto-editar-form').hidden = true;
    estado.puntoEditando = null;
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Punto actualizado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#punto-editar-cancelar').addEventListener('click', () => {
  $('#punto-editar-form').hidden = true;
  estado.puntoEditando = null;
});

// ─────────────────────────────────────────────────────────────────────── corridas

function pintarCorridas() {
  const busqueda = $('#corrida-buscar').value.trim().toLowerCase();
  const filtroEstado = $('#corrida-estado').value;
  const plantillaFiltro = $('#corrida-plantilla-filtro').value;

  const lista = estado.corridas.filter((r) => {
    if (filtroEstado && r.status !== filtroEstado) return false;
    // El filtro por plantilla se acepta aunque la plantilla ya no exista (si se
    // borro, la corrida quedo con `template_id` en NULL y no aparece en ninguna).
    if (plantillaFiltro && r.templateId !== plantillaFiltro) return false;
    if (!busqueda) return true;
    return [r.templateName, r.location].some((v) => String(v ?? '').toLowerCase().includes(busqueda));
  });

  $('#corridas-lista').innerHTML = lista.length
    ? '<table><thead><tr><th>Plantilla</th><th>Lugar</th><th>Estado</th><th>Responsable</th><th>Veredicto</th><th>Empezo</th><th>Cerrada</th><th>Acciones</th></tr></thead><tbody>' +
      lista
        .map(
          (r) =>
            '<tr><td>' +
            escapar(r.templateName) +
            (r.templateId ? '' : ' <small>(plantilla borrada)</small>') +
            '</td><td>' +
            escapar(r.location ?? '—') +
            '</td><td>' +
            escapar(ETIQUETA_RUN[r.status] ?? r.status) +
            '</td><td>' +
            escapar(r.performedBy ?? '—') +
            '</td><td>' +
            escapar(r.result ? ETIQUETA_RESULTADO_GLOBAL[r.result] ?? r.result : '—') +
            '</td><td>' +
            escapar(instanteCorto(r.startedAt)) +
            '</td><td>' +
            escapar(instanteCorto(r.completedAt) || '—') +
            '</td><td>' +
            '<button type="button" data-ficha="' +
            r.id +
            '">Ficha</button> ' +
            (r.status === 'in_progress'
              ? '<button type="button" data-completar="' + r.id + '">Completar</button> '
              : '') +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay corridas que coincidan</div>';
}

$('#corrida-buscar').addEventListener('input', pintarCorridas);
$('#corrida-estado').addEventListener('change', pintarCorridas);
$('#corrida-plantilla-filtro').addEventListener('change', pintarCorridas);

$('#corrida-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plantillaId = $('#corrida-plantilla').value;
  const cuerpo = {
    location: $('#corrida-lugar').value || null,
    notes: $('#corrida-notas').value || null,
  };
  if (plantillaId) {
    // Con plantilla no se mandan puntos: el servidor los copia. Mandarlos tambien
    // seria pedir las dos cosas a la vez, y la API lo rechaza antes de escribir.
    cuerpo.templateId = plantillaId;
  } else {
    cuerpo.items = puntosDesdeTexto($('#corrida-items').value);
    if (cuerpo.items.length === 0) {
      avisar('Una corrida libre necesita al menos un punto', true);
      return;
    }
  }
  try {
    const creada = await api('/api/runs', { method: 'POST', body: cuerpo });
    $('#corrida-lugar').value = '';
    $('#corrida-notas').value = '';
    $('#corrida-items').value = '';
    await recargar();
    await abrirFicha(creada.run.id);
    avisar('Corrida empezada. Sus puntos quedaron copiados de la plantilla.');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#corridas-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  try {
    if (boton.dataset.ficha) {
      await abrirFicha(boton.dataset.ficha);
    } else if (boton.dataset.completar) {
      await completar(boton.dataset.completar);
    }
  } catch (err) {
    avisar(err.message, true);
  }
});

// ────────────────────────────────────────────────────────────────────────── ficha

/**
 * El control de UN punto de la corrida, segun su tipo.
 *
 * Si/No se responde con los tres botones (y el que esta elegido queda marcado);
 * texto, numero y seleccion con su campo y su boton Guardar. Cuando la corrida ya
 * esta cerrada, en vez de controles se muestra la respuesta tal como quedo.
 */
function controlPunto(p, editable) {
  if (editable) {
    if (p.type === 'yes_no') {
      return (
        '<span class="acciones">' +
        RESPUESTAS.map(
          (resultado) =>
            '<button type="button" data-marcar="' +
            p.position +
            '" data-resultado="' +
            resultado +
            '"' +
            (p.result === resultado ? ' class="activo"' : '') +
            '>' +
            escapar(ETIQUETA_RESULTADO[resultado]) +
            '</button>',
        ).join('') +
        '</span>'
      );
    }
    const opciones = p.options ?? [];
    const campo =
      p.type === 'select'
        ? '<select id="item-valor-' +
          p.position +
          '"><option value="">Elegir…</option>' +
          opciones
            .map((o) => '<option value="' + escapar(o) + '">' + escapar(o) + '</option>')
            .join('') +
          '</select>'
        : '<input id="item-valor-' +
          p.position +
          '" type="' +
          (p.type === 'number' ? 'number' : 'text') +
          '" maxlength="4000">';
    return (
      '<span class="acciones">' +
      campo +
      '<button type="button" data-guardar-valor="' +
      p.position +
      '">Guardar</button></span>'
    );
  }
  if (p.type === 'yes_no') {
    return '<span class="respuesta">' + (p.result ? escapar(ETIQUETA_RESULTADO[p.result]) : '—') + '</span>';
  }
  return '<span class="respuesta">' + (p.valueText ? escapar(p.valueText) : '—') + '</span>';
}

/** Una linea de la ficha: el punto con bos controles y su nota. */
function puntoHtml(p, editable) {
  return (
    '<div class="punto ' +
    escapar(p.result ?? 'sin') +
    '"><span class="numero">' +
    p.position +
    '.</span><span class="texto"><strong>' +
    escapar(p.label) +
    '</strong> <small>(' +
    escapar(ETIQUETA_TIPO[p.type] ?? p.type) +
    ' · ' +
    (p.required ? 'obligatorio' : 'opcional') +
    ')</small>' +
    (p.answeredAt ? '<br><small>respondido ' + escapar(instanteCorto(p.answeredAt)) + '</small>' : '') +
    '</span>' +
    controlPunto(p, editable) +
    (editable
      ? '<input class="nota" id="item-nota-' +
        p.position +
        '" maxlength="2000" placeholder="Nota del punto" value="' +
        escapar(p.note ?? '') +
        '">'
      : p.note
        ? '<span class="nota-texto">' + escapar(p.note) + '</span>'
        : '') +
    '</div>'
  );
}

/**
 * La ficha de una corrida: sus datos, el resumen, sus puntos agrupados por la
 * seccion del SNAPSHOT, el veredicto global y sus adjuntos.
 *
 * Los puntos que se pintan son los de `run_items`, es decir los que el servidor
 * copio de la plantilla al empezar. La plantilla no se vuelve a pedir nunca, y esa
 * es la forma de que quede escrito que lo que se responde es una foto, no la
 * plantilla de hoy.
 */
async function abrirFicha(runId) {
  const ficha = await api(`/api/runs/${runId}/ficha`);
  const r = ficha.run;
  const resumen = ficha.resumen;
  estado.corridaId = runId;

  const editable = r.status === 'in_progress';

  // La seccion de cada punto sale del snapshot de la corrida, y los puntos se
  // agrupan con ella: un punto nunca se muestra bajo la seccion equivocada por
  // mas que la plantilla haya cambiado de nombre despues.
  const seccionDe = {};
  ficha.snapshot.items.forEach((p) => {
    seccionDe[p.position] = p.section ?? null;
  });
  const grupos = [];
  for (const p of ficha.items) {
    const seccion = seccionDe[p.position] ?? null;
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.nombre !== seccion) grupos.push({ nombre: seccion, items: [] });
    grupos[grupos.length - 1].items.push(p);
  }
  const puntoscHtml = grupos
    .map(
      (g) =>
        (g.nombre ? '<h4>' + escapar(g.nombre) + '</h4>' : '') +
        g.items.map((p) => puntoHtml(p, editable)).join(''),
    )
    .join('');

  const adjuntosHtml =
    '<h4>Adjuntos</h4>' +
    (ficha.attachments.length
      ? '<div class="adjuntos">' +
        ficha.attachments
          .map(
            (a) =>
              '<div class="adjunto"><a href="' +
              a.url +
              '" download="' +
              escapar(a.filename) +
              '">' +
              escapar(a.filename) +
              '</a> <small>' +
              tamanoCorto(a.sizeBytes) +
              (a.createdAt ? ' &middot; ' + escapar(instanteCorto(a.createdAt)) : '') +
              '</small>' +
              (editable
                ? ' <button type="button" data-adjunto-borrar="' + a.id + '">Quitar</button>'
                : '') +
              '</div>',
          )
          .join('')
      : '<div class="ficha vacia">Sin adjuntos</div>') +
    (editable
      ? '<form id="adjunto-form"><div class="fila"><input type="file" id="adjunto-archivo" accept="image/*,video/*,application/pdf,application/*"><button type="submit">Adjuntar archivo</button></div></form>'
      : '');

  $('#ficha').innerHTML =
    '<h3>' +
    escapar(r.templateName) +
    '</h3>' +
    '<p class="meta">' +
    escapar(ETIQUETA_RUN[r.status] ?? r.status) +
    (r.location ? ' &middot; ' + escapar(r.location) : '') +
    (r.performedBy ? ' &middot; responsable: ' + escapar(r.performedBy) : '') +
    ' &middot; empezo ' +
    escapar(instanteCorto(r.startedAt)) +
    (r.completedAt ? ' &middot; cerrada ' + escapar(instanteCorto(r.completedAt)) : '') +
    '</p>' +
    '<p class="meta">' +
    (r.result
      ? 'Veredicto: <strong>' + escapar(ETIQUETA_RESULTADO_GLOBAL[r.result] ?? r.result) + '</strong>'
      : r.status === 'done'
        ? 'Veredicto: —'
        : '') +
    '</p>' +
    '<p class="meta">Cumplimiento ' +
    escapar(porcentaje(resumen.cumplimientoPct)) +
    ' &middot; ' +
    resumen.ok +
    ' cumple &middot; ' +
    resumen.fail +
    ' no cumple &middot; ' +
    resumen.na +
    ' no aplica' +
    (resumen.pendientesRequeridos
      ? ' &middot; <strong>faltan ' + resumen.pendientesRequeridos + ' obligatorio(s)</strong>'
      : '') +
    '</p>' +
    (r.notes ? '<dl><dt>Notas</dt><dd>' + escapar(r.notes) + '</dd></dl>' : '') +
    '<h4>Puntos de esta corrida</h4>' +
    '<div class="puntos">' +
    (puntoscHtml || '<div class="ficha vacia">No hay puntos que revisar</div>') +
    '</div>' +
    adjuntosHtml;

  // Los campos de respuesta de texto, numero y seleccion se rellenan despues del
  // innerHTML: un `<select>` no se deja preseleccionado con el atributo value.
  if (editable) {
    for (const p of ficha.items) {
      if (p.type === 'yes_no') continue;
      const campo = document.getElementById('item-valor-' + p.position);
      if (campo) campo.value = p.valueText ?? '';
    }
  }

  $('#corrida-editar-lugar').value = r.location ?? '';
  $('#corrida-editar-notas').value = r.notes ?? '';
  $('#corrida-editar-estado').value = r.status;
  $('#corrida-editar-resultado').value = r.result ?? '';
  // Reabrir solo tiene sentido cerrada, y completar solo abierta: dejar
  // habilitados los botones que la maquina de estados no acepta es formar a la
  // gente para recibir un 409.
  $('#ficha-completar').disabled = !editable;
  $('#ficha-cancelar').disabled = r.status === 'canceled';
  $('#ficha-reabrir').disabled = editable;

  $('#ficha-dialog').showModal();
}

/**
 * Responder un punto de la ficha.
 *
 * Hay dos clases de clic: los botones de Si/No (marcar) y el Guardar de texto,
 * numero y seleccion. Los dos mandan por la POSICION del punto y con la nota del
 * campo de la fila; la diferencia es que los primeros mandan `result` y los
 * segundos `valueText`.
 */
$('#ficha').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  const notaEl = document.getElementById(`item-nota-${boton.dataset.marcar ?? boton.dataset.guardarValor}`);
  const nota = notaEl ? notaEl.value || null : null;
  try {
    if (boton.dataset.marcar) {
      await api(`/api/runs/${estado.corridaId}/items/${boton.dataset.marcar}`, {
        method: 'POST',
        body: { result: boton.dataset.resultado, note: nota },
      });
    } else if (boton.dataset.guardarValor) {
      const valorEl = document.getElementById(`item-valor-${boton.dataset.guardarValor}`);
      await api(`/api/runs/${estado.corridaId}/items/${boton.dataset.guardarValor}`, {
        method: 'POST',
        body: { valueText: valorEl ? valorEl.value : null, note: nota },
      });
    } else if (boton.dataset.adjuntoBorrar) {
      await api(`/api/runs/${estado.corridaId}/attachments/${boton.dataset.adjuntoBorrar}`, {
        method: 'DELETE',
      });
      await abrirFicha(estado.corridaId);
      avisar('Adjunto quitado');
      return;
    } else {
      return;
    }
    await abrirFicha(estado.corridaId);
    avisar('Respuesta registrada');
  } catch (err) {
    avisar(err.message, true);
  }
});

/** Subir un adjunto: el navegador lo convierte a base64 y la API lo guarda. */
$('#ficha').addEventListener('submit', async (e) => {
  if (!e.target.matches('#adjunto-form')) return;
  e.preventDefault();
  const archivo = document.getElementById('adjunto-archivo').files[0];
  if (!archivo) {
    avisar('Elige un archivo primero', true);
    return;
  }
  if (archivo.size > 750_000) {
    avisar('El archivo no puede superar 750 KB', true);
    return;
  }
  try {
    const data = await new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });
    const separado = String(data).indexOf(';base64,');
    await api(`/api/runs/${estado.corridaId}/attachments`, {
      method: 'POST',
      body: {
        filename: archivo.name,
        mimeType: archivo.type || null,
        data: separado >= 0 ? String(data).slice(separado + ';base64,'.length) : String(data),
      },
    });
    await abrirFicha(estado.corridaId);
    avisar('Archivo adjuntado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#corrida-editar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultado = $('#corrida-editar-resultado').value;
  try {
    await api(`/api/runs/${estado.corridaId}`, {
      method: 'PATCH',
      body: {
        location: $('#corrida-editar-lugar').value || null,
        notes: $('#corrida-editar-notas').value || null,
        status: $('#corrida-editar-estado').value,
        result: resultado || null,
      },
    });
    await recargar();
    await abrirFicha(estado.corridaId);
    avisar('Corrida actualizada');
  } catch (err) {
    // El 400 de "no se puede completar con obligatorios sin responder" llega
    // tal cual: es la instruccion, no un error de programa.
    avisar(err.message, true);
  }
});

/** Cerrar la corrida. El 400 con los puntos que faltan se muestra tal cual. */
async function completar(runId) {
  const resultado = $('#corrida-editar-resultado').value;
  try {
    // El veredicto solo se manda si se eligio: si no, el servidor lo deriva de
    // los puntos (aprobado si no hay "no cumple", observado si los hay).
    await api(`/api/runs/${runId}/completar`, {
      method: 'POST',
      body: resultado ? { result: resultado } : {},
    });
    await recargar();
    await abrirFicha(runId);
    avisar('Corrida completada y sellada');
  } catch (err) {
    avisar(err.message, true);
  }
}

$('#ficha-completar').addEventListener('click', () => completar(estado.corridaId));

$('#ficha-cancelar').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${estado.corridaId}`, { method: 'PATCH', body: { status: 'canceled' } });
    await recargar();
    await abrirFicha(estado.corridaId);
    avisar('Corrida cancelada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#ficha-reabrir').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${estado.corridaId}`, { method: 'PATCH', body: { status: 'in_progress' } });
    await recargar();
    await abrirFicha(estado.corridaId);
    avisar('Corrida reabierta');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#ficha-borrar').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${estado.corridaId}`, { method: 'DELETE' });
    estado.corridaId = null;
    $('#ficha-dialog').close();
    await recargar();
    avisar('Corrida borrada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#ficha-cerrar').addEventListener('click', () => $('#ficha-dialog').close());

// ─────────────────────────────────────────────────────────────────── navegación

const PANELES = {
  tablero: pintarTablero,
  plantillas: pintarPlantillas,
  corridas: pintarCorridas,
};

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    for (const [nombre, seccion] of Object.entries({
      tablero: '#panel-tablero',
      plantillas: '#panel-plantillas',
      corridas: '#panel-corridas',
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

/** Vuelve a pedir todo y reagrupa. Se llama despues de cada escritura. */
async function recargar() {
  await cargar();
  pintarPlantillas();
  pintarCorridas();
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

cargar().then(pintarTablero);