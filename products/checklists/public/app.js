/**
 * Interfaz de checklists e inspecciones.
 *
 * Cuatro reglas que no son de estilo sino de arquitectura:
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
 *      mostrarlos: la corrida ya lleva su copia, y una plantilla cambiada despues
 *      no puede alterar lo que se responde.
 *
 *   4. La numeracion de los puntos la muestra el servidor (1..N, sin huecos) y la
 *      pantalla no la recalcula. Si la recalculara, el "3" que ve la persona y el
 *      que se manda al responder serian dos numeros distintos en cuanto alguien
 *      borre un punto en otra pestania.
 */

const $ = (sel) => document.querySelector(sel);

const estado = {
  plantillas: [],
  /** Los puntos de la plantilla abierta en el editor, en orden. */
  puntos: [],
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

const instanteCorto = (iso) => (iso ? new Date(iso).toLocaleString('es-CL') : '');

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
  // abajo, uno por uno, con su propio endpoint. Volver a mandar el textarea
  // sobreescribiria la lista de la plantilla con lo que la pantalla recuerda, y en
  // cuanto alguien abriera la misma plantilla en otra pestania se perderian los
  // puntos que agrego.
  $('#plantilla-items').value = '';
  $('#plantilla-items').disabled = Boolean(plantilla);
  $('#plantilla-editor').hidden = !plantilla;
  if (plantilla) {
    $('#plantilla-seleccionada').textContent = plantilla.name;
    abrirPuntos(plantilla.id);
  }
}

async function abrirPuntos(plantillaId) {
  const datos = await api(`/api/templates/${plantillaId}/items`);
  estado.puntos = datos.items;
  $('#plantilla-seleccionada').textContent =
    estado.plantillas.find((t) => t.id === plantillaId)?.name ?? '';
  $('#plantilla-puntos-lista').innerHTML = datos.items.length
    ? datos.items
        .map(
          (p) =>
            '<div class="linea"><span><strong>' +
            p.position +
            '.</strong> ' +
            escapar(p.label) +
            ' ' +
            (p.required ? '<small>(obligatorio)</small>' : '<small>(opcional)</small>') +
            '</span><span class="estado">' +
            '<button type="button" data-quitar="' +
            p.id +
            '">Quitar</button></span></div>',
        )
        .join('')
    : '<div class="ficha vacia">Esta plantilla no tiene puntos todavia</div>';
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
      // los escribe en la misma transaccion, y asi no queda una plantilla a la que
      // le falte la mitad de la lista.
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

$('#plantillas-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  try {
    if (boton.dataset.editar) {
      abrirPlantilla(estado.plantillas.find((t) => t.id === boton.dataset.editar));
    } else if (boton.dataset.puntos) {
      $('#plantilla-id').value = boton.dataset.puntos;
      $('#plantilla-seleccionada').textContent =
        estado.plantillas.find((t) => t.id === boton.dataset.puntos)?.name ?? '';
      $('#plantilla-editor').hidden = false;
      await abrirPuntos(boton.dataset.puntos);
    } else if (boton.dataset.toggle) {
      // El toggle va por PATCH y no por un endpoint propio: `active` es un campo
      // mas de la plantilla, y desactivarla es editarla.
      const plantilla = estado.plantillas.find((t) => t.id === boton.dataset.toggle);
      await api(`/api/templates/${plantilla.id}`, { method: 'PATCH', body: { active: plantilla.active ? 0 : 1 } });
      await recargar();
      avisar(plantilla.active ? 'Plantilla desactivada' : 'Plantilla activada');
    } else if (boton.dataset.duplicar) {
      await api(`/api/templates/${boton.dataset.duplicar}/duplicar`, { method: 'POST' });
      await recargar();
      avisar('Plantilla duplicada con sus puntos');
    } else if (boton.dataset.borrar) {
      // Borrar la plantilla NO borra las corridas: el servidor las deja con su
      // copia. El aviso lo dice, porque "borre la plantilla" suena a "borre el
      // historial" y no lo es.
      await api(`/api/templates/${boton.dataset.borrar}`, { method: 'DELETE' });
      if ($('#plantilla-id').value === boton.dataset.borrar) {
        $('#plantilla-id').value = '';
        $('#plantilla-editor').hidden = true;
      }
      await recargar();
      avisar('Plantilla borrada. Las corridas quedan con su copia.');
    }
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#punto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const plantillaId = $('#plantilla-id').value;
  if (!plantillaId) return;
  try {
    await api(`/api/templates/${plantillaId}/items`, {
      method: 'POST',
      body: { label: $('#punto-label').value, required: $('#punto-requerido').checked ? 1 : 0 },
    });
    $('#punto-label').value = '';
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Punto agregado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#plantilla-puntos-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  const plantillaId = $('#plantilla-id').value;
  try {
    // El servidor renumera lo que queda a 1..N y devuelve la lista nueva: por eso
    // esta pantalla repinta con la respuesta en vez de tapar el numero en local.
    await api(`/api/templates/${plantillaId}/items/${boton.dataset.quitar}`, { method: 'DELETE' });
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Punto quitado y renumerado');
  } catch (err) {
    avisar(err.message, true);
  }
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
    ? '<table><thead><tr><th>Plantilla</th><th>Lugar</th><th>Estado</th><th>Empezo</th><th>Cerrada</th><th>Acciones</th></tr></thead><tbody>' +
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
            escapar(instanteCorto(r.startedAt)) +
            '</td><td>' +
            escapar(instanteCorto(r.completedAt) || '—') +
            '</td><td>' +
            '<button type="button" data-ficha="' +
            r.id +
            '">Ficha</button> ' +
            (r.status === 'in_progress' ? '<button type="button" data-completar="' + r.id + '">Completar</button> ' : '') +
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
 * La ficha de una corrida: su datos, el resumen y cada punto por responder.
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
  $('#ficha').innerHTML =
    '<h3>' +
    escapar(r.templateName) +
    '</h3>' +
    '<p class="meta">' +
    escapar(ETIQUETA_RUN[r.status] ?? r.status) +
    (r.location ? ' &middot; ' + escapar(r.location) : '') +
    ' &middot; empezo ' +
    escapar(instanteCorto(r.startedAt)) +
    (r.completedAt ? ' &middot; cerrada ' + escapar(instanteCorto(r.completedAt)) : '') +
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
    ficha.items
      .map(
        (p) =>
          '<div class="punto ' +
          escapar(p.result ?? 'sin') +
          '"><span class="numero">' +
          p.position +
          '.</span>' +
          '<span class="texto"><strong>' +
          escapar(p.label) +
          '</strong>' +
          (p.required ? '' : ' <small>(opcional)</small>') +
          (p.answeredAt ? '<br><small>respondido ' + escapar(instanteCorto(p.answeredAt)) + '</small>' : '') +
          '</span>' +
          '<span class="acciones">' +
          ['ok', 'fail', 'na']
            .map(
              (resultado) =>
                '<button type="button" data-marcar="' +
                p.position +
                '" data-resultado="' +
                resultado +
                '"' +
                (editable ? '' : ' disabled') +
                '>' +
                escapar(ETIQUETA_RESULTADO[resultado]) +
                '</button>',
            )
            .join('') +
          '</span>' +
          (editable
            ? '<input class="nota" id="item-nota-' +
              p.position +
              '" maxlength="2000" placeholder="Nota del punto" value="' +
              escapar(p.note ?? '') +
              '">'
            : p.note
              ? '<span class="nota-texto">' + escapar(p.note) + '</span>'
              : '') +
          '</div>',
      )
      .join('') +
    '</div>';

  $('#corrida-editar-lugar').value = r.location ?? '';
  $('#corrida-editar-notas').value = r.notes ?? '';
  $('#corrida-editar-estado').value = r.status;
  // Reabrir solo tiene sentido cerrada, y completar solo abierta: dejar
  // habilitados los botones que la maquina de estados no acepta es formar a la
  // gente para recibir un 409.
  $('#ficha-completar').disabled = !editable;
  $('#ficha-cancelar').disabled = r.status === 'canceled';
  $('#ficha-reabrir').disabled = editable;

  $('#ficha-dialog').showModal();
}

/** Un punto se responde por su POSICION, y con la nota que este en su campo. */
$('#ficha').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton || !boton.dataset.marcar) return;
  const nota = document.getElementById(`item-nota-${boton.dataset.marcar}`);
  try {
    await api(`/api/runs/${estado.corridaId}/items/${boton.dataset.marcar}`, {
      method: 'POST',
      body: { result: boton.dataset.resultado, note: nota ? nota.value || null : null },
    });
    await abrirFicha(estado.corridaId);
    avisar('Respuesta registrada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#corrida-editar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/runs/${estado.corridaId}`, {
      method: 'PATCH',
      body: {
        location: $('#corrida-editar-lugar').value || null,
        notes: $('#corrida-editar-notas').value || null,
        status: $('#corrida-editar-estado').value,
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
  try {
    await api(`/api/runs/${runId}/completar`, { method: 'POST' });
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
