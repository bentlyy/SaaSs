/**
 * Interfaz de control de pagos: la cartera por cobrar de la empresa.
 *
 * Cuatro reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. El estado de un cargo NO se elige en esta pantalla: se cambia
 *      registrando el abono que lo produjo, y lo hace el servidor en la misma
 *      transaccion. Por eso el formulario de alta NO tiene un select de estado, y
 *      la unica forma de cancelar es el boton que llama a `/cancelar`. Si el
 *      estado se escribiera desde aca, quedarian cargos "pagados" sin un centimo
 *      cobrado, y la cartera seria una lista de mentiras.
 *
 *   3. El dinero se PINTA, no se convierte. Los centavos llegan como centavos y
 *      se muestran como pesos dividiendo entre 100 para leerlos. Convertir dos
 *      veces es exactamente como se rompieron los precios del legacy, asi que
 *      esta pantalla no multiplica por 100 en ningun lado. Los formularios
 *      escriben en CENTAVOS, que es la unidad en que la API los guarda.
 *
 *   4. El SALDO NO VIAJA EN LA LISTA. `/api/charges` devuelve filas de la tabla y
 *      el saldo se deriva de los abonos, asi que no puede ser una columna de la
 *      respuesta. Se pide aparte con `/api/charges/saldos`, que lo calcula con un
 *      solo GROUP BY: pedir la ficha de cada cargo para pintar la lista serian 200
 *      idas a la base por cada carga de pantalla.
 */

const $ = (sel) => document.querySelector(sel);
const miles = new Intl.NumberFormat('es-CL');

const estado = {
  cargos: [],
  /** Saldo por cargo, armado por `/api/charges/saldos`. */
  saldos: {},
  cfg: { currency: '$', timezone: 'America/Santiago' },
  rol: 'member',
  /** El cargo que esta abierta en la ficha, para reescribirla al cobrarle. */
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
 * `Math.trunc(c / 100)` y `c % 100` son exactos para enteros, asi que el centavo
 * se ve siempre: un saldo de $45,01 no se muestra como $45. Y la division es la
 * UNICA operacion de dinero de esta pantalla, porque el numero que llega de la
 * API ya esta en la unidad en que se guarda.
 */
function monto(centavos) {
  const simbolo = estado.cfg?.currency ?? '$';
  const n = Math.trunc(Number(centavos ?? 0));
  const signo = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${signo}${simbolo} ${miles.format(Math.trunc(abs / 100))},${String(abs % 100).padStart(2, '0')}`;
}

const ETIQUETA_ESTADO = {
  pending: 'Pendiente',
  partial: 'Parcial',
  paid: 'Pagado',
  canceled: 'Cancelado',
};

const ETIQUETA_METODO = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  other: 'Otro',
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
  const [cargos, cfg, saldos, yo] = await Promise.all([
    api('/api/charges?limit=500'),
    api('/api/settings'),
    api('/api/charges/saldos'),
    api('/api/me'),
  ]);
  estado.cargos = cargos.items;
  estado.cfg = cfg.settings;
  // Un solo mapa para toda la lista, en vez de una ficha por fila.
  estado.saldos = Object.fromEntries(saldos.saldos.map((s) => [s.id, s.saldoCents]));
  estado.rol = yo.role;
  renderConfig();
  pintarMontos();
}

function tarjeta(numero, texto) {
  return `<div class="tarjeta"><strong>${escapar(numero)}</strong><span>${escapar(texto)}</span></div>`;
}

const saldoDe = (id) => estado.saldos[id] ?? 0;

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const tablero = await api('/api/dashboard');
  const porStatus = tablero.porStatus;

  $('#resumen').innerHTML = [
    tarjeta(monto(tablero.cobradoMesCents), 'Cobrado este mes'),
    tarjeta(monto(tablero.pendienteCents), 'Por cobrar'),
    tarjeta(monto(tablero.vencidoCents), 'Vencido'),
    tarjeta(porStatus.pending, 'Cargos pendientes'),
    tarjeta(porStatus.partial, 'Cargos parciales'),
    tarjeta(porStatus.paid, 'Cargos pagados'),
    tarjeta(porStatus.canceled, 'Cargos cancelados'),
  ].join('');

  const vacio = '<div class="ficha vacia">Todavia no hay cargos emitidos</div>';
  $('#recientes').innerHTML =
    tablero.recientes
      .map(
        (c) =>
          '<div class="ficha"><strong>' +
          escapar(c.number) +
          ' &middot; ' +
          escapar(c.customerName) +
          '</strong><span>' +
          escapar(c.concept) +
          ' &middot; ' +
          escapar(ETIQUETA_ESTADO[c.status] ?? c.status) +
          ' &middot; saldo ' +
          escapar(monto(c.saldoCents)) +
          '</span></div>',
      )
      .join('') || vacio;
}

// ──────────────────────────────────────────────────────────────────────── cobros

function pintarCobros() {
  const busqueda = $('#cargo-buscar').value.trim().toLowerCase();
  const estadoFiltro = $('#cargo-filtro').value;

  // El filtro de estado y la busqueda se aplican aca, y no con un query a la
  // API, porque la pantalla ya trae el listado completo de la empresa: la
  // busqueda del servidor (`?q=`) sigue existiendo para quien la use desde otro
  // cliente, y las dos buscan en las mismas columnas.
  const lista = estado.cargos.filter((c) => {
    if (estadoFiltro && c.status !== estadoFiltro) return false;
    if (!busqueda) return true;
    return [c.number, c.concept, c.customerName, c.customerEmail].some((v) =>
      String(v ?? '').toLowerCase().includes(busqueda),
    );
  });

  // Borrar un cargo se lleva sus abonos, asi que no es de cualquiera: se ofrece
  // solo a quien puede. El rol viene de `/api/me`, no de un campo en el HTML.
  const puedeBorrar = estado.rol === 'admin' || estado.rol === 'owner';
  const saldo = saldoDe(c.id);

  $('#cobros-lista').innerHTML = lista.length
    ? '<table><thead><tr><th>Folio</th><th>Cliente</th><th>Concepto</th><th>Emitido</th><th>Vence</th><th>Total</th><th>Saldo</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>' +
      lista
        .map(
          (c) =>
            '<tr><td>' +
            escapar(c.number) +
            '</td><td>' +
            escapar(c.customerName) +
            (c.customerEmail ? '<br><small>' + escapar(c.customerEmail) + '</small>' : '') +
            '</td><td>' +
            escapar(c.concept) +
            '</td><td>' +
            escapar(fechaCorta(c.issuedDate) || '—') +
            '</td><td>' +
            escapar(fechaCorta(c.dueDate) || '—') +
            '</td><td>' +
            escapar(monto(c.amountCents)) +
            '</td><td>' +
            escapar(monto(saldo)) +
            '</td><td>' +
            escapar(ETIQUETA_ESTADO[c.status] ?? c.status) +
            '</td><td>' +
            '<button type="button" data-ficha="' +
            c.id +
            '">Ficha</button> ' +
            '<button type="button" data-editar="' +
            c.id +
            '">Editar</button> ' +
            (puedeBorrar
              ? '<button type="button" data-borrar="' + c.id + '">Borrar</button>'
              : '') +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table>'
    : '<div class="ficha vacia">No hay cargos que coincidan</div>';
}

function abrirCargo(cargo) {
  $('#cargo-id').value = cargo?.id ?? '';
  $('#cargo-form-titulo').textContent = cargo ? 'Editar cargo' : 'Nuevo cargo';
  $('#cargo-cancelar').hidden = !cargo;
  $('#cargo-numero').value = cargo?.number ?? '';
  $('#cargo-concepto').value = cargo?.concept ?? '';
  $('#cargo-cliente-nombre').value = cargo?.customerName ?? '';
  $('#cargo-cliente-id').value = cargo?.customerId ?? '';
  $('#cargo-cliente-email').value = cargo?.customerEmail ?? '';
  $('#cargo-monto').value = cargo?.amountCents ?? 0;
  $('#cargo-emision').value = cargo?.issuedDate ?? '';
  $('#cargo-vencimiento').value = cargo?.dueDate ?? '';
  $('#cargo-notas').value = cargo?.notes ?? '';
  pintarMontos();
}

/** Los montos en centavos, mostrados como se van a ver. Nunca se convierten para mandarlos. */
function pintarMontos() {
  $('#cargo-monto-vista').textContent = `se ve como ${monto($('#cargo-monto').value)}`;
  $('#abono-monto-vista').textContent = `se ve como ${monto($('#abono-monto').value)}`;
}

$('#cargo-monto').addEventListener('input', pintarMontos);
$('#abono-monto').addEventListener('input', pintarMontos);

/**
 * El folio lo propone el servidor.
 *
 * `/api/charges/next-number` es el unico que sabe cual es el numero mas alto de
 * ESTA empresa, asi que la pantalla no lo calcula: si lo hiciera, dos personas de
 * la misma empresa abiertas a la vez propondrían el mismo folio y la segunda se
 * llevaria un 409.
 */
$('#cargo-proponer-numero').addEventListener('click', async () => {
  try {
    const propuesta = await api('/api/charges/next-number');
    $('#cargo-numero').value = propuesta.number;
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#cargo-cancelar').addEventListener('click', () => abrirCargo(null));

$('#cargo-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#cargo-id').value;
  // Los campos vacios viajan como null y no como "": el servidor distingue "no lo
  // tengo" de "lo tengo en blanco", y la ficha los muestra distinto.
  const cuerpo = {
    // El folio vacio viaja como null y no como 0: `number` es opcional y el
    // servidor propone el siguiente cuando no viene. Mandar 0 seria un folio
    // invalido, no "no mande folio".
    number: $('#cargo-numero').value ? Number($('#cargo-numero').value) : null,
    concept: $('#cargo-concepto').value,
    customerName: $('#cargo-cliente-nombre').value,
    customerId: $('#cargo-cliente-id').value || null,
    customerEmail: $('#cargo-cliente-email').value || null,
    issuedDate: $('#cargo-emision').value || null,
    dueDate: $('#cargo-vencimiento').value || null,
    // El total va en centavos, que es como lo guarda la API. El numero entero se
    // manda tal cual: convertirlo aca seria hacerlo dos veces.
    amountCents: Number($('#cargo-monto').value || 0),
    notes: $('#cargo-notas').value || null,
  };
  try {
    await api(id ? `/api/charges/${id}` : '/api/charges', {
      method: id ? 'PATCH' : 'POST',
      body: cuerpo,
    });
    abrirCargo(null);
    await recargar();
    avisar(id ? 'Cargo actualizado' : 'Cargo creado');
  } catch (err) {
    // El 409 de folio repetido y el de "el total no puede bajar de lo cobrado"
    // llegan con el texto que explica la regla: se muestra tal cual.
    avisar(err.message, true);
  }
});

$('#cargo-buscar').addEventListener('input', pintarCobros);
$('#cargo-filtro').addEventListener('change', pintarCobros);

$('#cobros-lista').addEventListener('click', async (e) => {
  const boton = e.target.closest('button');
  if (!boton) return;
  try {
    if (boton.dataset.editar) {
      abrirCargo(estado.cargos.find((c) => c.id === boton.dataset.editar));
    } else if (boton.dataset.ficha) {
      await abrirFicha(boton.dataset.ficha);
    } else if (boton.dataset.borrar) {
      await api(`/api/charges/${boton.dataset.borrar}`, { method: 'DELETE' });
      await recargar();
      avisar('Cargo borrado, con sus abonos');
    }
  } catch (err) {
    avisar(err.message, true);
  }
});

// ──────────────────────────────────────────────────────────────────────── ficha

async function abrirFicha(idCargo) {
  const ficha = await api(`/api/charges/${idCargo}/ficha`);
  estado.fichaId = idCargo;
  const c = ficha.charge;

  $('#ficha').innerHTML =
    '<h3>' +
    escapar(c.number) +
    ' &middot; ' +
    escapar(c.customerName) +
    '</h3>' +
    '<p class="meta">' +
    escapar(ETIQUETA_ESTADO[c.status] ?? c.status) +
    ' &middot; ' +
    escapar(c.concept) +
    (c.dueDate ? ' &middot; vence ' + escapar(fechaCorta(c.dueDate)) : '') +
    '</p>' +
    '<dl>' +
    '<dt>Total</dt><dd>' +
    escapar(monto(ficha.charge.amountCents)) +
    '</dd>' +
    '<dt>Cobrado</dt><dd>' +
    escapar(monto(ficha.pagadoCents)) +
    '</dd>' +
    '<dt>Saldo</dt><dd>' +
    escapar(monto(ficha.saldoCents)) +
    '</dd>' +
    (c.customerEmail ? '<dt>Correo</dt><dd>' + escapar(c.customerEmail) + '</dd>' : '') +
    (c.notes ? '<dt>Notas</dt><dd>' + escapar(c.notes) + '</dd>' : '') +
    '</dl>' +
    '<h4>Abonos</h4><div class="lineas">' +
    (ficha.payments
      .map(
        (p) =>
          '<div class="linea"><span>' +
          escapar(monto(p.amountCents)) +
          ' &middot; ' +
          escapar(ETIQUETA_METODO[p.method] ?? p.method) +
          (p.reference ? ' &middot; ' + escapar(p.reference) : '') +
          '</span><span class="estado">' +
          escapar(instanteCorto(p.receivedAt)) +
          '</span></div>',
      )
      .join('') || '<div class="ficha vacia">Sin abonos registrados</div>') +
    '</div>';

  // El boton de cobrar y el de cancelar se esconden segun el estado, y no para
  // que la API los rechace: la API los rechaza igual (409), pero un boton que
  // siempre va a fallar ensucia la pantalla.
  const cancelado = c.status === 'canceled';
  $('#abono-form').hidden = cancelado || ficha.saldoCents <= 0;
  $('#abono-monto').value = ficha.saldoCents > 0 ? ficha.saldoCents : 0;
  $('#abono-referencia').value = '';
  $('#abono-fecha').value = '';
  $('#ficha-cancelar-cargo').hidden = cancelado || ficha.pagadoCents > 0;
  pintarMontos();
  $('#ficha-dialog').showModal();
}

$('#ficha-cerrar').addEventListener('click', () => $('#ficha-dialog').close());

$('#abono-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = {
    amountCents: Number($('#abono-monto').value || 0),
    method: $('#abono-metodo').value,
    reference: $('#abono-referencia').value || null,
  };
  // Si no se escribe la fecha, NO se manda `receivedAt`: el servidor pone la hora
  // real de ahora. Si se escribe, se manda la medianoche de ese dia en UTC, que
  // es el unico instante que se puede afirmar sin inventar la hora.
  if ($('#abono-fecha').value) cuerpo.receivedAt = `${$('#abono-fecha').value}T00:00:00.000Z`;
  try {
    // El estado del cargo NO se manda: lo recalcula el servidor en la misma
    // transaccion que escribe el abono. Mandarlo seria pedirle a la pantalla que
    // decida si quedo pagado.
    await api(`/api/charges/${estado.fichaId}/abonos`, { method: 'POST', body: cuerpo });
    await recargar();
    await abrirFicha(estado.fichaId);
    avisar('Abono registrado');
  } catch (err) {
    // El 409 de "el abono supera el saldo" se muestra tal cual: es la regla del
    // producto explicada, no un error de programa.
    avisar(err.message, true);
  }
});

$('#ficha-cancelar-cargo').addEventListener('click', async () => {
  try {
    await api(`/api/charges/${estado.fichaId}/cancelar`, { method: 'POST', body: {} });
    await recargar();
    await abrirFicha(estado.fichaId);
    avisar('Cargo cancelado');
  } catch (err) {
    avisar(err.message, true);
  }
});

// ─────────────────────────────────────────────────────────────────────── reporte

async function pintarReporte() {
  const params = new URLSearchParams();
  const desde = $('#reporte-desde').value;
  const hasta = $('#reporte-hasta').value;
  if (desde) params.set('from', desde);
  if (hasta) params.set('to', hasta);

  const reporte = await api(`/api/reporte?${params.toString()}`);
  // Los cuatro tramos se pintan siempre, aunque uno de cero: una fila que aparece
  // y desaparece segun los datos hace que la pantalla "salte".
  $('#reporte-tabla').innerHTML =
    '<table><thead><tr><th>Dias de atraso</th><th>Cargos</th><th>Saldo</th></tr></thead><tbody>' +
    Object.entries(reporte.buckets)
      .map(
        ([clave, b]) =>
          '<tr><td>' +
          escapar(clave) +
          '</td><td>' +
          escapar(b.cargos) +
          '</td><td>' +
          escapar(monto(b.saldoCents)) +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table>';

  $('#reporte-total').textContent =
    `${reporte.totalCargos} cargo(s) con saldo al ${reporte.referencia}: ` +
    `${monto(reporte.totalPendienteCents)} pendientes.`;
}

$('#reporte-filtrar').addEventListener('click', async () => {
  try {
    await pintarReporte();
  } catch (err) {
    avisar(err.message, true);
  }
});

// ─────────────────────────────────────────────────────────────────── navegación

const PANELES = {
  tablero: pintarTablero,
  cobros: () => pintarCobros(),
  reporte: () => pintarReporte(),
};

for (const boton of document.querySelectorAll('#tabs button')) {
  boton.addEventListener('click', async () => {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.remove('activo'));
    boton.classList.add('activo');
    for (const [nombre, seccion] of Object.entries({
      tablero: '#panel-tablero',
      cobros: '#panel-cobros',
      reporte: '#panel-reporte',
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
    pintarMontos();
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
