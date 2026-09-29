/**
 * Interfaz de espacios.
 *
 * Dos reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La página se sirve vacía y todo entra por
 *      la API, que es la que filtra por organización. Si el HTML trajera datos,
 *      el servidor tendría que confiar en que el navegador no los altere.
 *
 *   2. La pantalla NO decide si dos reservas se pisan. No sabe ni puede saberlo:
 *      entre que se ve el horario libre y se presiona "Reservar" puede entrar
 *      otra reserva. La decisión es del servidor, y esta UI solo muestra el 409.
 */

const $ = AMIGO_UI.$;
const dinero = AMIGO_UI.dinero;

const estado = {
  espacios: [],
  clientes: [],
  extras: [],
  horarios: [],
  bloqueos: [],
  cfg: { currency: '$', openingMinutes: 480, closingMinutes: 1320, slotMinutes: 60, minAdvanceMinutes: 0 },
};

/** `Date.getUTCDay` y el servidor usan 0 = domingo. */
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

const api = AMIGO_UI.api;


/**
 * Minutos desde medianoche -> "HH:MM", que es lo que acepta un
 * `<input type="time">`.
 *
 * El nombre no dice "ms" aunque parezca: no hay milisegundos en juego, y leer
 * `ms` y pensar en tiempo Unix es justo el error que hace que alguien escriba
 * `new Date(minutosAMs(...))` después.
 */
const minutosAHora = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Una hora local "14:30" son los minutos desde medianoche. */
function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [espacios, clientes, extras, cfg] = await Promise.all([
    api('/api/spaces'),
    api('/api/customers'),
    api('/api/addons'),
    api('/api/settings'),
  ]);
  estado.espacios = espacios.items;
  estado.clientes = clientes.items;
  estado.extras = extras.items;
  estado.cfg = cfg.settings;
  pintar();
  renderConfig();
}

/**
 * Rellena el form de ajustes recorriendo `form.elements` y tomando el `name` de
 * cada input como clave del ajuste.
 *
 * Elegir los campos por id (`$('#cfg-moneda')`) parece más corto, pero mete el
 * nombre del campo en dos lugares: el HTML y acá. El día que se agrega un
 * ajuste y se olvida una de las dos copias, el form se queda a medio pintar y
 * guardar pisa el campo con vacío. Con `name` el bucle es el mismo para todos.
 */
function renderConfig() {
  const form = $('#config-form');
  const c = estado.cfg;
  for (const el of form.elements) {
    if (!el.name || c[el.name] === undefined) continue;
    // `<input type="time">` muestra "HH:MM" y el ajuste guarda minutos al día.
    el.value = el.dataset.horas ? minutosAHora(c[el.name]) : c[el.name];
  }
}

function pintar() {
  const selectorEspacios = $('#agenda-espacio');
  const elegido = selectorEspacios.value;
  selectorEspacios.innerHTML = '<option value="">Todos los espacios</option>';
  for (const e of estado.espacios) {
    const op = document.createElement('option');
    op.value = e.id;
    op.textContent = e.name;
    selectorEspacios.append(op);
  }
  selectorEspacios.value = elegido;

  const selHorario = $('#horario-espacio');
  const horarioElegido = selHorario.value;
  selHorario.innerHTML = '<option value="">Elige un espacio</option>';
  for (const e of estado.espacios) {
    const op = document.createElement('option');
    op.value = e.id;
    op.textContent = e.name;
    selHorario.append(op);
  }
  selHorario.value = horarioElegido;

  const selDia = $('#horario-dia');
  if (selDia.options.length === 0) {
    for (let d = 0; d < 7; d += 1) {
      const op = document.createElement('option');
      op.value = String(d);
      op.textContent = DIAS[d];
      selDia.append(op);
    }
  }

  for (const [sel, lista, vacio] of [
    ['#reserva-espacio', estado.espacios, 'Elige un espacio'],
    ['#reserva-cliente', estado.clientes, 'Sin cliente'],
    ['#reserva-extra', estado.extras, 'Sin extra'],
  ]) {
    const nodo = $(sel);
    const previo = nodo.value;
    nodo.innerHTML = `<option value="">${vacio}</option>`;
    for (const item of lista) {
      const op = document.createElement('option');
      op.value = item.id;
      op.textContent = item.name;
      nodo.append(op);
    }
    nodo.value = previo;
  }

  pintarEspacios();
  pintarClientes();
  pintarExtras();
  pintarHorarios();
}

/**
 * El estado de una reserva, como etiqueta y no como palabra suelta.
 *
 * El servidor guarda los estados en inglés (`confirmed`, `cancelled`) y no se
 * tocan: son el contrato de la API. El que se traduce es el botón y la etiqueta,
 * que son de la pantalla y no del dominio.
 */
const ESTADOS = {
  confirmed: { texto: 'Confirmada', tono: 'ok', accion: 'Confirmar' },
  pending: { texto: 'Por confirmar', tono: 'aviso', accion: 'Pasar a pendiente' },
  done: { texto: 'Completada', tono: 'neutro', accion: 'Marcar hecha' },
  cancelled: { texto: 'Cancelada', tono: 'malo', accion: 'Cancelar' },
};


/**
 * El siguiente paso de una reserva, para no llenar la fila de botones.
 *
 * Tres botones por renglón esconde la información: el que sirve casi siempre es
 * uno, el de avanzar. Cancelar queda siempre, porque es la única acción
 * destructiva y tiene que estar a la mano. Los estados de la API no se tocan;
 * esto solo decide cuál se ofrece.
 */
const SIGUIENTE = { pending: 'confirmed', confirmed: 'done' };


function pintarEspacios() {
  const tabla = AMIGO_UI.tabla([
    { titulo: 'Nombre' },
    { titulo: 'Tipo' },
    { titulo: 'Aforo', num: true },
    { titulo: 'Tarifa hora', num: true },
    { titulo: '' },
  ]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  for (const e of estado.espacios) {
    const acciones = AMIGO_UI.celda(
      AMIGO_UI.boton('Editar', () => editarEspacio(e)),
      AMIGO_UI.boton('Archivar', async () => {
        try {
          await api(`/api/spaces/${e.id}`, { method: 'DELETE' });
          AMIGO_UI.avisar(`Espacio "${e.name}" archivado`);
          await cargar();
        } catch (err) { AMIGO_UI.avisar(err.message, true); }
      }),
    );
    cuerpo.append(AMIGO_UI.fila([e.name, e.type, e.capacity, dinero(e.pricePerHourCents), acciones], { className: 'acciones' }));
  }
  tabla.append(cuerpo);
  $('#espacios-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

function pintarClientes() {
  const tabla = AMIGO_UI.tabla([{ titulo: 'Nombre' }, { titulo: 'Teléfono' }, { titulo: 'Correo' }]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  for (const c of estado.clientes) {
    cuerpo.append(AMIGO_UI.fila([c.name, c.phone ?? '', c.email ?? '']));
  }
  tabla.append(cuerpo);
  $('#clientes-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

function pintarExtras() {
  const tabla = AMIGO_UI.tabla([{ titulo: 'Nombre' }, { titulo: 'Precio', num: true }]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  for (const x of estado.extras) {
    cuerpo.append(AMIGO_UI.fila([x.name, dinero(x.priceCents)]));
  }
  tabla.append(cuerpo);
  $('#extras-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

// ───────────────────────────────────────────────────────── horarios y bloqueos

function espacioHorario() {
  return $('#horario-espacio').value;
}

async function cargarHorarios() {
  const espacio = espacioHorario();
  if (!espacio) {
    estado.horarios = [];
    estado.bloqueos = [];
    pintarHorarios();
    return;
  }
  const [horarios, bloqueos] = await Promise.all([
    api(`/api/schedules?spaceId=${espacio}`),
    api(`/api/blocks?spaceId=${espacio}`),
  ]);
  estado.horarios = horarios.items;
  estado.bloqueos = bloqueos.items;
  pintarHorarios();
}

function pintarHorarios() {
  const espacio = espacioHorario();
  const contenedor = $('#horarios-lista');
  if (!espacio) {
    contenedor.innerHTML = '<p class="pequeno tenue">Elige un espacio para ver sus horarios.</p>';
    $('#bloqueos-lista').innerHTML = '';
    return;
  }

  const tabla = AMIGO_UI.tabla([
    { titulo: 'Día' }, { titulo: 'Desde' }, { titulo: 'Hasta' }, { titulo: 'Estado' }, { titulo: '' },
  ]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  for (const h of estado.horarios) {
    const acciones = AMIGO_UI.celda(
      AMIGO_UI.boton('Editar', () => editarHorario(h)),
      AMIGO_UI.boton('Borrar', async () => {
        try {
          await api(`/api/schedules/${h.id}`, { method: 'DELETE' });
          AMIGO_UI.avisar('Horario borrado');
          await cargarHorarios();
        } catch (err) { AMIGO_UI.avisar(err.message, true); }
      }),
    );
    const toggle = AMIGO_UI.boton(h.active ? 'Desactivar' : 'Activar', async () => {
      try {
        await api(`/api/schedules/${h.id}`, { method: 'PATCH', body: { active: !h.active } });
        AMIGO_UI.avisar(`Horario ${h.active ? 'desactivado' : 'activado'}`);
        await cargarHorarios();
      } catch (err) { AMIGO_UI.avisar(err.message, true); }
    });
    acciones.prepend(toggle);
    cuerpo.append(AMIGO_UI.fila([
      DIAS[h.weekday],
      minutosAHora(h.startTime),
      minutosAHora(h.endTime),
      h.active ? 'Activo' : 'Inactivo',
      acciones,
    ], { className: 'acciones' }));
  }
  if (estado.horarios.length === 0) {
    cuerpo.append(AMIGO_UI.fila(['Sin horario propio', '', '', 'cae a la jornada general', '']));
  }
  tabla.append(cuerpo);
  contenedor.replaceChildren(AMIGO_UI.cajaTabla(tabla));

    const bloques = AMIGO_UI.tabla([{ titulo: 'Empieza' }, { titulo: 'Termina' }, { titulo: 'Motivo' }, { titulo: '' }]);
    const cuerpoBloques = AMIGO_UI.cuerpoDe(bloques);
  for (const b of estado.bloqueos) {
    const acciones = AMIGO_UI.celda(AMIGO_UI.boton('Quitar', async () => {
      try {
        await api(`/api/blocks/${b.id}`, { method: 'DELETE' });
        AMIGO_UI.avisar('Bloqueo quitado');
        await cargarHorarios();
      } catch (err) { AMIGO_UI.avisar(err.message, true); }
    }));
    cuerpoBloques.append(AMIGO_UI.fila([b.startAt, b.endAt, b.reason ?? '', acciones], { className: 'acciones' }));
  }
  if (estado.bloqueos.length === 0) {
    cuerpoBloques.append(AMIGO_UI.fila(['Sin bloqueos', '', '', '']));
  }
  bloques.append(cuerpoBloques);
  $('#bloqueos-lista').replaceChildren(AMIGO_UI.cajaTabla(bloques));
}

/** El form de horario sirve para crear y para editar; el input oculto lo dice. */
function editarHorario(h) {
  $('#horario-form-titulo').textContent = 'Editar horario';
  $('#horario-id').value = h.id;
  $('#horario-dia').value = String(h.weekday);
  $('#horario-desde').value = minutosAHora(h.startTime);
  $('#horario-hasta').value = minutosAHora(h.endTime);
  $('#horario-activo').checked = h.active;
  $('#horario-cancelar').hidden = false;
}

function limpiarFormHorario() {
  $('#horario-form').reset();
  $('#horario-form-titulo').textContent = 'Nuevo horario';
  $('#horario-id').value = '';
  $('#horario-cancelar').hidden = true;
}

$('#horario-espacio').addEventListener('change', () => {
  limpiarFormHorario();
  cargarHorarios().catch((e) => AMIGO_UI.avisar(e.message, true));
});

$('#horario-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const espacio = espacioHorario();
  if (!espacio) { AMIGO_UI.avisar('Elige un espacio', true); return; }
  const id = $('#horario-id').value;
  const cuerpo = {
    spaceId: espacio,
    weekday: Number($('#horario-dia').value),
    startTime: aMinutos($('#horario-desde').value),
    endTime: aMinutos($('#horario-hasta').value),
    active: $('#horario-activo').checked,
  };
  try {
    await api(id ? `/api/schedules/${id}` : '/api/schedules', { method: id ? 'PATCH' : 'POST', body: cuerpo });
    AMIGO_UI.avisar(id ? 'Horario actualizado' : 'Horario agregado');
    limpiarFormHorario();
    await cargarHorarios();
  } catch (err) { AMIGO_UI.avisar(err.message, true); }
});

$('#horario-cancelar').addEventListener('click', limpiarFormHorario);

$('#bloqueo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const espacio = espacioHorario();
  if (!espacio) { AMIGO_UI.avisar('Elige un espacio', true); return; }
  const cuerpo = {
    spaceId: espacio,
    startAt: new Date($('#bloqueo-inicio').value).toISOString(),
    endAt: new Date($('#bloqueo-fin').value).toISOString(),
    reason: $('#bloqueo-motivo').value || null,
  };
  try {
    await api('/api/blocks', { method: 'POST', body: cuerpo });
    $('#bloqueo-form').reset();
    AMIGO_UI.avisar('Espacio bloqueado');
    await cargarHorarios();
  } catch (err) { AMIGO_UI.avisar(err.message, true); }
});

// ──────────────────────────────────────────────────────────────────── agenda

async function pintarAgenda() {
  const espacio = $('#agenda-espacio').value;
  const fecha = $('#agenda-fecha').value;
  const dia = fecha ? new Date(`${fecha}T00:00:00.000Z`) : new Date();

  const [agenda, resumen, disponibilidad] = await Promise.all([
    api(`/api/agenda?from=${dia.toISOString()}&to=${new Date(dia.getTime() + 86_400_000).toISOString()}${espacio ? `&spaceId=${espacio}` : ''}`),
    api(`/api/resumen?date=${dia.toISOString().slice(0, 10)}`),
    espacio
      ? api(`/api/availability?spaceId=${espacio}&date=${dia.toISOString().slice(0, 10)}`)
      : Promise.resolve(null),
  ]);

  // El rótulo sigue al día que se está mirando. Decir "hoy" sobre las cifras de
  // ayer no es un detalle de redacción: es la diferencia entre un tablero que
  // informa y uno que miente con toda seguridad.
  //
  // La comparación es entre fechas, no entre instantes: `dia` es medianoche UTC
  // y `new Date()` es hora local, así que comparar los dos con `toDateString`
  // da "no es hoy" todos los días en cualquier huso detrás de UTC.
  const hoyTexto = new Date();
  const claveHoy = `${hoyTexto.getFullYear()}-${String(hoyTexto.getMonth() + 1).padStart(2, '0')}-${String(hoyTexto.getDate()).padStart(2, '0')}`;
  const clave = dia.toISOString().slice(0, 10);
  const esHoy = clave === claveHoy;
  const cuando = esHoy ? 'Ingresos de hoy' : `Ingresos del ${dia.toLocaleDateString('es', { day: 'numeric', month: 'short' })}`;

  AMIGO_UI.kpis($('#resumen'), [
    [esHoy ? 'Hoy' : 'Ese día', resumen.hoy],
    ['Confirmadas', resumen.confirmadas, true],
    ['Por confirmar', resumen.porConfirmar],
    [cuando, dinero(resumen.ingresos)],
  ]);

  const tabla = AMIGO_UI.tabla([
    { titulo: 'Hora' }, { titulo: 'Espacio' }, { titulo: 'Cliente' }, { titulo: 'Estado' },
    { titulo: 'Total', num: true }, { titulo: '' },
  ]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  for (const b of agenda.bookings) {
    const acciones = AMIGO_UI.celda();
    const cambiar = (estado) => async () => {
      try {
        await api(`/api/bookings/${b.id}`, { method: 'PATCH', body: { status: estado } });
        await pintarAgenda();
      } catch (err) { AMIGO_UI.avisar(err.message, true); }
    };
    const avanza = SIGUIENTE[b.status];
    if (avanza) {
      acciones.append(
        AMIGO_UI.boton(ESTADOS[avanza].accion, cambiar(avanza), 'ui-btn ui-btn--chico ui-btn--suave'),
      );
    }
    if (b.status !== 'cancelled' && b.status !== 'done') {
      acciones.append(
        AMIGO_UI.boton('Cancelar', cambiar('cancelled'), 'ui-btn ui-btn--chico ui-btn--fantasma'),
      );
    }
    cuerpo.append(AMIGO_UI.fila([
      `${b.startAt.slice(11, 16)} - ${b.endAt.slice(11, 16)}`,
      b.spaceName ?? '-',
      b.customerName ?? 'Sin cliente',
        AMIGO_UI.estadoDe(b.status, ESTADOS),
      dinero(b.totalCents),
      acciones,
    ], { className: 'acciones' }));
  }
  if (agenda.bookings.length === 0) {
    cuerpo.append(AMIGO_UI.fila([]));
    cuerpo.lastElementChild.innerHTML =
      '<td colspan="6" class="ui-vacio"><strong>Nada reservado para este día</strong>' +
      'Toca una franja libre de abajo para abrir la primera reserva.</td>';
  }
  tabla.append(cuerpo);
  $('#agenda-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla, { eje: true }));

  const franjas = $('#agenda-disponibles');
  franjas.innerHTML = '';
  if (!disponibilidad) {
    franjas.innerHTML = '<p class="pequeno tenue">Elige un espacio para ver sus franjas libres.</p>';
    return;
  }
  for (const s of disponibilidad.slots) {
    franjas.append(AMIGO_UI.boton(`${s.startAt.slice(11, 16)} · ${dinero(s.totalCents)}`, () => {
      $('#reserva-espacio').value = espacio;
      $('#reserva-inicio').value = s.startAt.slice(0, 16);
      $('#reserva-fin').value = s.endAt.slice(0, 16);
      $('#reserva-dialog').showModal();
    }, 'ui-franja'));
  }
  if (disponibilidad.slots.length === 0) {
    franjas.innerHTML = '<p class="pequeno tenue">No quedan franjas libres ese día.</p>';
  }
}

// ───────────────────────────────────────────────────────────────── formularios

function editarEspacio(e) {
  $('#espacio-form-titulo').textContent = `Editar ${e.name}`;
  $('#espacio-id').value = e.id;
  $('#espacio-nombre').value = e.name;
  $('#espacio-tipo').value = e.type;
  $('#espacio-aforo').value = e.capacity;
  $('#espacio-tarifa').value = e.pricePerHourCents;
  $('#espacio-cancelar').hidden = false;
  $('#espacio-nombre').focus();
}

function limpiarFormEspacio() {
  $('#espacio-form').reset();
  $('#espacio-form-titulo').textContent = 'Nuevo espacio';
  $('#espacio-id').value = '';
  $('#espacio-cancelar').hidden = true;
}

$('#espacio-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const id = $('#espacio-id').value;
  const cuerpo = {
    name: $('#espacio-nombre').value,
    type: $('#espacio-tipo').value,
    capacity: Number($('#espacio-aforo').value),
    pricePerHourCents: Number($('#espacio-tarifa').value),
  };
  try {
    await api(id ? `/api/spaces/${id}` : '/api/spaces', { method: id ? 'PATCH' : 'POST', body: cuerpo });
    AMIGO_UI.avisar(id ? 'Espacio actualizado' : 'Espacio creado');
    limpiarFormEspacio();
    await cargar();
  } catch (err) { AMIGO_UI.avisar(err.message, true); }
});

$('#espacio-cancelar').addEventListener('click', limpiarFormEspacio);

$('#cliente-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/customers', {
      method: 'POST',
      body: {
        name: $('#cliente-nombre').value,
        phone: $('#cliente-telefono').value || null,
        email: $('#cliente-correo').value || null,
      },
    });
    $('#cliente-form').reset();
    AMIGO_UI.avisar('Cliente creado');
    await cargar();
  } catch (err) { AMIGO_UI.avisar(err.message, true); }
});

$('#extra-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/addons', {
      method: 'POST',
      body: { name: $('#extra-nombre').value, priceCents: Number($('#extra-precio').value) },
    });
    $('#extra-form').reset();
    AMIGO_UI.avisar('Extra creado');
    await cargar();
  } catch (err) { AMIGO_UI.avisar(err.message, true); }
});

/**
 * Se lee el form por `name` igual que se pinta, para que el par de funciones
 * no pueda desincronizarse: si un ajuste se agrega al HTML y no a este listado,
 * el servidor no se entera de que existe y el valor se pierde al guardar.
 */
$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const cuerpo = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    // Las horas vuelven a minutos: el input habla "HH:MM" y el ajuste, minutos.
    cuerpo[el.name] = el.dataset.horas ? aMinutos(el.value) : Number(el.value) || el.value;
  }
  try {
    await api('/api/settings', { method: 'PUT', body: cuerpo });
    AMIGO_UI.avisar('Ajustes guardados');
    await cargar();
    await pintarAgenda();
  } catch (err) { AMIGO_UI.avisar(err.message, true); }
});

/** El total se estima en pantalla para dar una idea; el que vale es el del servidor. */
function estimarTotal() {
  const espacio = estado.espacios.find((e) => e.id === $('#reserva-espacio').value);
  const extra = estado.extras.find((x) => x.id === $('#reserva-extra').value);
  if (!espacio) { $('#reserva-total').textContent = '$0'; return; }
  const ini = new Date($('#reserva-inicio').value).getTime();
  const fin = new Date($('#reserva-fin').value).getTime();
  const horas = Number.isNaN(ini) || Number.isNaN(fin) ? 0 : (fin - ini) / 3_600_000;
  $('#reserva-total').textContent = dinero(Math.round(horas * espacio.pricePerHourCents) + (extra?.priceCents ?? 0));
}

$('#reserva-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const cuerpo = {
    spaceId: $('#reserva-espacio').value,
    customerId: $('#reserva-cliente').value || null,
    startAt: new Date($('#reserva-inicio').value).toISOString(),
    endAt: new Date($('#reserva-fin').value).toISOString(),
    notes: $('#reserva-notas').value || null,
    addons: $('#reserva-extra').value
      ? [{ addonId: $('#reserva-extra').value, priceCents: estado.extras.find((x) => x.id === $('#reserva-extra').value).priceCents }]
      : [],
  };
  try {
    await api('/api/bookings', { method: 'POST', body: cuerpo });
    $('#reserva-dialog').close();
    $('#reserva-form').reset();
    AMIGO_UI.avisar('Reserva creada');
    await pintarAgenda();
  } catch (err) {
    // El 409 es el del servidor: dos personas presionaron "Reservar" a la vez, o
    // el horario se ocupó mientras la pantalla estaba abierta. La UI no lo
    // adivina, lo muestra.
    AMIGO_UI.avisar(err.status === 409 ? `Ese horario ya no está libre: ${err.message}` : err.message, true);
  }
});

for (const sel of ['#reserva-espacio', '#reserva-extra', '#reserva-inicio', '#reserva-fin']) {
  $(sel).addEventListener('change', estimarTotal);
}
$('#reserva-cancelar').addEventListener('click', () => $('#reserva-dialog').close());

// ──────────────────────────────────────────────────────────────────── arranque

/**
 * Las pestañas las lleva el shell compartido (`/amigo.js`), que además deja la
 * sección activa en la URL para poder compartir un enlace a "la agenda de hoy".
 * Acá solo se le dice qué hay que cargar cuando se entra a cada una: la agenda y
 * los horarios piden datos propios y las demás ya están en memoria.
 */
function alEntrar(panel) {
  if (panel === 'agenda') pintarAgenda().catch((e) => AMIGO_UI.avisar(e.message, true));
  if (panel === 'horarios') cargarHorarios().catch((e) => AMIGO_UI.avisar(e.message, true));
}

AMIGO.montar({
  nombre: 'Espacios',
  paneles: ['agenda', 'espacios', 'horarios', 'clientes', 'extras', 'ajustes'],
  alEntrar,
});

for (const sel of ['#agenda-espacio', '#agenda-fecha']) {
  $(sel).addEventListener('change', () => pintarAgenda().catch((e) => AMIGO_UI.avisar(e.message, true)));
}
$('#agenda-nueva').addEventListener('click', () => $('#reserva-dialog').showModal());
$('#reserva-cerrar').addEventListener('click', () => $('#reserva-dialog').close());
$('#agenda-fecha').value = new Date().toISOString().slice(0, 10);

cargar()
  .then(() => pintarAgenda())
  .catch((err) => AMIGO_UI.avisar(err.message, true));
