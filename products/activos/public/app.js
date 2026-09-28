/**
 * Interfaz de activos.
 *
 * Tres reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. El estado de un activo NO se elige en esta pantalla de forma libre: se
 *      cambia registrando el movimiento que lo produjo, y lo hace el servidor
 *      en la misma transaccion. Por eso el listado y la ficha no tienen un
 *      boton de "marcar en reparacion" que escriba el estado por detras: el
 *      unico que escribe estados es la API de movimientos, y asi no quedan
 *      activos en reparacion sin un movimiento que lo explique.
 *      (La unica excepcion es `retired`, que es una decision de negocio y no
 *      un hecho fisico: por eso SI se elige en el formulario.)
 *
 *   3. El dinero se PINTA, no se convierte. Los centavos llegan como
 *      centavos y se muestran como pesos dividiendo por 100 para leerlos. En
 *      esta pantalla no hay ningun `* 100`: convertir dos veces es exactamente
 *      como se rompieron los precios del legacy.
 */

const $ = (sel) => document.querySelector(sel);
const miles = new Intl.NumberFormat('es-CL');

const estado = {
  activos: [],
  cfg: { currency: '$', timezone: 'America/Santiago' },
  /** El activo que esta abierta en la ficha, para reescribirla al moverlo. */
  fichaId: null,
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

/**
 * Centavos a texto legible.
 *
 * `Math.trunc(c / 100)` y `c % 100` son exactos para enteros, asi que el
 * centavo se ve siempre: un costo de $45,01 no se muestra como $45. Y la
 * division es la UNICA operacion de dinero de esta pantalla, porque el numero
 * que llega de la API ya esta en la unidad en que se guarda.
 */
function monto(centavos) {
  const simbolo = estado.cfg?.currency ?? '$';
  const n = Math.trunc(Number(centavos ?? 0));
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${signo}${simbolo} ${miles.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

const ETIQUETA_ESTADO = {
  active: 'En uso',
  repair: 'En reparacion',
  retired: 'Dado de baja',
  lost: 'Perdido',
};

const ETIQUETA_MOVIMIENTO = {
  checkin: 'Volvio',
  checkout: 'Salio',
  maintenance: 'A reparacion',
  loss: 'Se perdio',
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fecha) {
  if (!fecha) return '';
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}

const instanteCorto = (iso) => (iso ? new Date(iso).toLocaleString('es-CL') : '');

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [activos, cfg] = await Promise.all([api('/api/assets?limit=500'), api('/api/settings')]);
  estado.activos = activos.items;
  estado.cfg = cfg.settings;
  renderConfig();
  pintarCosto();
}

function tarjeta(numero, texto) {
  return `<div class="tarjeta"><strong>${escapar(numero)}</strong><span>${escapar(texto)}</span></div>`;
}

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const tablero = await api('/api/dashboard');
  const porStatus = tablero.porStatus;

  $('#resumen').innerHTML = [
    tarjeta(tablero.total, 'Activos en libros'),
    tarjeta(porStatus.active, 'En uso'),
    tarjeta(porStatus.repair, 'En reparacion'),
    tarjeta(porStatus.retired, 'Dados de baja'),
    tarjeta(porStatus.lost, 'Perdidos'),
    tarjeta(monto(tablero.valorEnUsoCents), 'Valor en uso'),
  ].join('');

  const vacio = '<div class="ficha vacia">Todavia no hay activos registrados</div>';
  $('#recientes').innerHTML =
    tablero.recientes
      .map(
        (a) =>
          '<div class="ficha"><strong>' +
          escapar(a.code) +
          ' &middot; ' +
          escapar(a.name) +
          '</strong><span>' +
          escapar(ETIQUETA_ESTADO[a.status] ?? a.status) +
          (a.assignedTo ? ' &middot; ' + escapar(a.assignedTo) : '') +
          (a.location ? ' &middot; ' + escapar(a.location) : '') +
          ' &middot; ' +
          escapar(monto(a.costCents)) +
          '</span></div>',
      )
      .join('') || vacio;
}

// ─────────────────────────────────────────────────────────────────────── activos

function pintarActivos() {
  const busqueda = $('#activo-buscar').value.trim().toLowerCase();
  const estadoFiltro = $('#activo-filtro').value;

  // El filtro de estado y la busqueda se aplican aca, y no con un query a la
  // API, porque la pantalla ya trae el listado completo de la empresa: la
  // busqueda del servidor (`?q=`) sigue existiendo para quien la use desde otro
  // cliente, y las dos buscan en las mismas columnas.
  const lista = estado.activos.filter((a) => {
    if (estadoFiltro && a.status !== estadoFiltro) return false;
    if (!busqueda) return true;
    return [a.code, a.name, a.brand, a.model, a.serial, a.assignedTo].some((v) =>
      String(v ?? '').toLowerCase().includes(busqueda),
    );
  });

  $('#activos-lista').innerHTML = lista.length
    ? '<table><thead><tr><th>Codigo</th><th>Nombre</th><th>Categoria</th><th>Estado</th><th>Lo tiene</th><th>Ubicacion</th><th>Costo</th><th>Acciones</th></tr></thead><tbody>' +
      lista
        .map(
          (a) =>
            '<tr><td>' +
            escapar(a.code) +
            '</td><td>' +
            escapar(a.name) +
            (a.serial ? '<br><small>' + escapar(a.serial) + '</small>' : '') +
            '</td><td>' +
            escapar(a.category) +
            '</td><td>' +
            escapar(ETIQUETA_ESTADO[a.status] ?? a.status) +
            '</td><td>' +
            escapar(a.assignedTo ?? '—') +
            '</td><td>' +
            escapar(a.location ?? '—') +
            '</td><td>' +
            escapar(monto(a.costCents)) +
            '</td><td>' +
            '<button type="button" data-ficha="' +
            a.id +
            '">Ficha</button> ' +
            '<button type="button" data-editar="' +
            a.id +
            '">Editar</button> ' +
            '<button type="button" data-archivar="' +
            a.id +
            '">Archivar</button> ' +
            '<button type="button" data-borrar="' +
            a.id +
            '">Borrar</button>' +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay activos que coincidan</div>';
}

function abrirActivo(activo) {
  $('#activo-id').value = activo?.id ?? '';
  $('#activo-form-titulo').textContent = activo ? 'Editar activo' : 'Nuevo activo';
  $('#activo-cancelar').hidden = !activo;
  $('#activo-codigo').value = activo?.code ?? '';
  $('#activo-nombre').value = activo?.name ?? '';
  $('#activo-categoria').value = activo?.category ?? '';
  $('#activo-marca').value = activo?.brand ?? '';
  $('#activo-modelo').value = activo?.model ?? '';
  $('#activo-serie').value = activo?.serial ?? '';
  $('#activo-estado').value = activo?.status ?? 'active';
  $('#activo-ubicacion').value = activo?.location ?? '';
  $('#activo-responsable').value = activo?.assignedTo ?? '';
  $('#activo-compra').value = activo?.purchaseDate ?? '';
  $('#activo-costo').value = activo?.costCents ?? 0;
  $('#activo-notas').value = activo?.notes ?? '';
  pintarCosto();
}

/** El costo en centavos, mostrado como se va a ver. Nunca se convierte para mandarlo. */
function pintarCosto() {
  $('#activo-costo-vista').textContent = `se ve como ${monto($('#activo-costo').value)}`;
}

$('#activo-costo').addEventListener('input', pintarCosto);

/**
 * El codigo lo propone el servidor.
 *
 * `/api/assets/next-code` es el unico que sabe cual es el numero mas alto de
 * ESTA empresa, asi que la pantalla no lo calcula: si lo hiciera, dos personas
 * de la misma empresa abiertas a la vez propondrían el mismo codigo y la segunda
 * se llevaria un 409.
 */
$('#activo-proponer-codigo').addEventListener('click', async () => {
  try {
    const propuesta = await api('/api/assets/next-code');
    $('#activo-codigo').value = propuesta.code;
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#activo-cancelar').addEventListener('click', () => abrirActivo(null));

$('#activo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#activo-id').value;
  // Los campos vacios viajan como null y no como "": el servidor distingue "no lo
  // tengo" de "lo tengo en blanco", y la ficha los muestra distinto.
  const cuerpo = {
    code: $('#activo-codigo').value,
    name: $('#activo-nombre').value,
    category: $('#activo-categoria').value,
    brand: $('#activo-marca').value || null,
    model: $('#activo-modelo').value || null,
    serial: $('#activo-serie').value || null,
    status: $('#activo-estado').value,
    location: $('#activo-ubicacion').value || null,
    assignedTo: $('#activo-responsable').value || null,
    purchaseDate: $('#activo-compra').value || null,
    // El costo va en centavos, que es como lo guarda la API. El numero entero
    // se manda tal cual: convertirlo aca seria hacerlo dos veces.
    costCents: Number($('#activo-costo').value || 0),
    notes: $('#activo-notas').value || null,
  };
  try {
    await api(id ? `/api/assets/${id}` : '/api/assets', {
      method: id ? 'PATCH' : 'POST',
      body: cuerpo,
    });
    abrirActivo(null);
    await recargar();
    avisar(id ? 'Activo actualizado' : 'Activo creado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#activo-buscar').addEventListener('input', pintarActivos);
$('#activo-filtro').addEventListener('change', pintarActivos);

$('#activos-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  try {
    if (boton.dataset.editar) {
      abrirActivo(estado.activos.find((a) => a.id === boton.dataset.editar));
    } else if (boton.dataset.ficha) {
      await abrirFicha(boton.dataset.ficha);
    } else if (boton.dataset.archivar) {
      // Archivar y borrar son cosas distintas: archivar saca el bien de la lista
      // sin tocar su historial, y es lo que la API ofrece cuando el borrado
      // responde 409.
      await api(`/api/assets/${boton.dataset.archivar}`, { method: 'PATCH', body: { archived: true } });
      await recargar();
      avisar('Activo archivado');
    } else if (boton.dataset.borrar) {
      await api(`/api/assets/${boton.dataset.borrar}`, { method: 'DELETE' });
      await recargar();
      avisar('Activo borrado');
    }
  } catch (err) {
    // El 409 de borrar un activo con historial llega con el texto que explica que
    // lo que corresponde es archivar, asi que se muestra tal cual: es la
    // instruccion, no un error de programa.
    avisar(err.message, true);
  }
});

// ──────────────────────────────────────────────────────────────────────── ficha

async function abrirFicha(idActivo) {
  const ficha = await api(`/api/assets/${idActivo}/ficha`);
  estado.fichaId = idActivo;
  const a = ficha.asset;
  $('#ficha').innerHTML =
    '<h3>' +
    escapar(a.code) +
    ' &middot; ' +
    escapar(a.name) +
    '</h3>' +
    '<p class="meta">' +
    escapar(ETIQUETA_ESTADO[a.status] ?? a.status) +
    ' &middot; ' +
    escapar(a.category) +
    (a.assignedTo ? ' &middot; lo tiene ' + escapar(a.assignedTo) : '') +
    (a.archivedAt ? ' &middot; archivado' : '') +
    '</p>' +
    '<dl>' +
    '<dt>Marca</dt><dd>' +
    escapar(a.brand ?? 'Sin marca') +
    '</dd>' +
    '<dt>Modelo</dt><dd>' +
    escapar(a.model ?? 'Sin modelo') +
    '</dd>' +
    '<dt>Serie</dt><dd>' +
    escapar(a.serial ?? 'Sin serie') +
    '</dd>' +
    '<dt>Ubicacion</dt><dd>' +
    escapar(a.location ?? 'Sin ubicacion') +
    '</dd>' +
    (a.purchaseDate ? '<dt>Comprado</dt><dd>' + escapar(fechaCorta(a.purchaseDate)) + '</dd>' : '') +
    '<dt>Costo</dt><dd>' +
    escapar(monto(a.costCents)) +
    '</dd>' +
    (a.notes ? '<dt>Notas</dt><dd>' + escapar(a.notes) + '</dd>' : '') +
    '</dl>' +
    '<h4>Historial</h4><div class="lineas">' +
    (ficha.movements
      .map(
        (m) =>
          '<div class="linea"><span>' +
          escapar(ETIQUETA_MOVIMIENTO[m.kind] ?? m.kind) +
          (m.note ? ' &middot; ' + escapar(m.note) : '') +
          '</span><span class="estado">' +
          escapar(instanteCorto(m.happenedAt)) +
          '</span></div>',
      )
      .join('') || '<div class="ficha vacia">Sin movimientos registrados</div>') +
    '</div>' +
    '<p class="meta">' +
    ficha.resumen.totalMovimientos +
    ' movimiento(s) en el historial</p>';
  $('#ficha-dialog').showModal();
}

$('#ficha-cerrar').addEventListener('click', () => $('#ficha-dialog').close());

$('#movimiento-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = {
    kind: $('#movimiento-tipo').value,
    note: $('#movimiento-nota').value || null,
  };
  // El responsable se manda SOLO en un checkout, y vacio se manda `null` para
  // que la API lo exija con su mensaje en vez de dejar un movimiento huerfano.
  if (cuerpo.kind === 'checkout') cuerpo.assignedTo = $('#movimiento-responsable').value || null;
  try {
    // No se manda `happenedAt`: un movimiento se registra mientras pasa, y
    // anotarlo a mano solo abre la puerta a escribir el dia equivocado.
    await api(`/api/assets/${estado.fichaId}/movimientos`, { method: 'POST', body: cuerpo });
    $('#movimiento-nota').value = '';
    $('#movimiento-responsable').value = '';
    await recargar();
    await abrirFicha(estado.fichaId);
    avisar('Movimiento registrado');
  } catch (err) {
    avisar(err.message, true);
  }
});

// ─────────────────────────────────────────────────────────────────── navegación

const PANELES = {
  tablero: pintarTablero,
  activos: () => pintarActivos(),
};

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    for (const [nombre, seccion] of Object.entries({
      tablero: '#panel-tablero',
      activos: '#panel-activos',
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
    pintarCosto();
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
 * OJO: el panel se llama `data-tab="ajustes"`, no `id="config"`. Por eso esto
 * no puede hacer `$$('#config input')`: ese selector no matchea nada y el panel
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

cargar().then(pintarTablero);
