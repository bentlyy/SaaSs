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

const $ = (sel) => document.querySelector(sel);
const dinero = (centavos) => `$${(centavos / 100).toLocaleString('es-CL', { minimumFractionDigits: 0 })}`;

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

function fila(columnas) {
  const tr = document.createElement('tr');
  for (const c of columnas) {
    const td = document.createElement('td');
    if (c && c.nodo) td.append(c.nodo);
    else td.textContent = c ?? '';
    tr.append(td);
  }
  return tr;
}

function boton(texto, alHacerClic) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = texto;
  b.addEventListener('click', alHacerClic);
  return b;
}

function pintarEspacios() {
  const tabla = document.createElement('table');
  tabla.innerHTML =
    '<thead><tr><th>Nombre</th><th>Tipo</th><th>Aforo</th><th>Tarifa hora</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  for (const e of estado.espacios) {
    const acciones = document.createElement('td');
    acciones.append(
      boton('Editar', () => editarEspacio(e)),
      boton('Archivar', async () => {
        try {
          await api(`/api/spaces/${e.id}`, { method: 'DELETE' });
          avisar(`Espacio "${e.name}" archivado`);
          await cargar();
        } catch (err) { avisar(err.message, true); }
      }),
    );
    cuerpo.append(fila([e.name, e.type, e.capacity, dinero(e.pricePerHourCents), acciones]));
  }
  tabla.append(cuerpo);
  $('#espacios-lista').replaceChildren(tabla);
}

function pintarClientes() {
  const tabla = document.createElement('table');
  tabla.innerHTML = '<thead><tr><th>Nombre</th><th>Telefono</th><th>Correo</th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  for (const c of estado.clientes) {
    cuerpo.append(fila([c.name, c.phone ?? '', c.email ?? '']));
  }
  tabla.append(cuerpo);
  $('#clientes-lista').replaceChildren(tabla);
}

function pintarExtras() {
  const tabla = document.createElement('table');
  tabla.innerHTML = '<thead><tr><th>Nombre</th><th>Precio</th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  for (const x of estado.extras) {
    cuerpo.append(fila([x.name, dinero(x.priceCents)]));
  }
  tabla.append(cuerpo);
  $('#extras-lista').replaceChildren(tabla);
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
    contenedor.textContent = 'Elige un espacio para ver sus horarios.';
    $('#bloqueos-lista').textContent = '';
    return;
  }

  const tabla = document.createElement('table');
  tabla.innerHTML = '<thead><tr><th>Día</th><th>Desde</th><th>Hasta</th><th>Estado</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  for (const h of estado.horarios) {
    const acciones = document.createElement('td');
    acciones.append(
      boton('Editar', () => editarHorario(h)),
      boton('Borrar', async () => {
        try {
          await api(`/api/schedules/${h.id}`, { method: 'DELETE' });
          avisar('Horario borrado');
          await cargarHorarios();
        } catch (err) { avisar(err.message, true); }
      }),
    );
    const toggle = boton(h.active ? 'Desactivar' : 'Activar', async () => {
      try {
        await api(`/api/schedules/${h.id}`, { method: 'PATCH', body: { active: !h.active } });
        avisar(`Horario ${h.active ? 'desactivado' : 'activado'}`);
        await cargarHorarios();
      } catch (err) { avisar(err.message, true); }
    });
    acciones.prepend(toggle);
    cuerpo.append(fila([
      DIAS[h.weekday],
      minutosAHora(h.startTime),
      minutosAHora(h.endTime),
      h.active ? 'activo' : 'inactivo',
      acciones,
    ]));
  }
  if (estado.horarios.length === 0) {
    cuerpo.append(fila(['Sin horario propio', '', '', 'cae a la jornada general', '']));
  }
  tabla.append(cuerpo);
  contenedor.replaceChildren(tabla);

  const bloques = document.createElement('table');
  bloques.innerHTML = '<thead><tr><th>Empieza</th><th>Termina</th><th>Motivo</th><th></th></tr></thead>';
  const cuerpoBloques = document.createElement('tbody');
  for (const b of estado.bloqueos) {
    const acciones = document.createElement('td');
    acciones.append(boton('Quitar', async () => {
      try {
        await api(`/api/blocks/${b.id}`, { method: 'DELETE' });
        avisar('Bloqueo quitado');
        await cargarHorarios();
      } catch (err) { avisar(err.message, true); }
    }));
    cuerpoBloques.append(fila([b.startAt, b.endAt, b.reason ?? '', acciones]));
  }
  if (estado.bloqueos.length === 0) {
    cuerpoBloques.append(fila(['Sin bloqueos', '', '', '']));
  }
  bloques.append(cuerpoBloques);
  $('#bloqueos-lista').replaceChildren(bloques);
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
  cargarHorarios().catch((e) => avisar(e.message, true));
});

$('#horario-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const espacio = espacioHorario();
  if (!espacio) { avisar('Elige un espacio', true); return; }
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
    avisar(id ? 'Horario actualizado' : 'Horario agregado');
    limpiarFormHorario();
    await cargarHorarios();
  } catch (err) { avisar(err.message, true); }
});

$('#horario-cancelar').addEventListener('click', limpiarFormHorario);

$('#bloqueo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const espacio = espacioHorario();
  if (!espacio) { avisar('Elige un espacio', true); return; }
  const cuerpo = {
    spaceId: espacio,
    startAt: new Date($('#bloqueo-inicio').value).toISOString(),
    endAt: new Date($('#bloqueo-fin').value).toISOString(),
    reason: $('#bloqueo-motivo').value || null,
  };
  try {
    await api('/api/blocks', { method: 'POST', body: cuerpo });
    $('#bloqueo-form').reset();
    avisar('Espacio bloqueado');
    await cargarHorarios();
  } catch (err) { avisar(err.message, true); }
});

// ──────────────────────────────────────────────────────────────────── agenda

async function pintarAgenda() {
  const espacio = $('#agenda-espacio').value;
  const fecha = $('#agenda-fecha').value;
  const dia = fecha ? new Date(`${fecha}T00:00:00.000Z`) : new Date();

  const [agenda, resumen, disponibilidad] = await Promise.all([
    api(`/api/agenda?from=${dia.toISOString()}&to=${new Date(dia.getTime() + 86_400_000).toISOString()}${espacio ? `&spaceId=${espacio}` : ''}`),
    api('/api/resumen'),
    espacio
      ? api(`/api/availability?spaceId=${espacio}&date=${dia.toISOString().slice(0, 10)}`)
      : Promise.resolve(null),
  ]);

  $('#resumen').innerHTML = '';
  for (const [titulo, valor] of [
    ['Hoy', resumen.hoy],
    ['Confirmadas', resumen.confirmadas],
    ['Por confirmar', resumen.porConfirmar],
    ['Ingresos de hoy', dinero(resumen.ingresos)],
  ]) {
    const div = document.createElement('div');
    div.className = 'tarjeta';
    div.innerHTML = `<strong>${valor}</strong><span>${titulo}</span>`;
    $('#resumen').append(div);
  }

  const tabla = document.createElement('table');
  tabla.innerHTML =
    '<thead><tr><th>Hora</th><th>Espacio</th><th>Cliente</th><th>Estado</th><th>Total</th><th></th></tr></thead>';
  const cuerpo = document.createElement('tbody');
  for (const b of agenda.bookings) {
    const acciones = document.createElement('td');
    for (const estado of ['confirmed', 'done', 'cancelled']) {
      if (b.status === estado) continue;
      acciones.append(boton(estado, async () => {
        try {
          await api(`/api/bookings/${b.id}`, { method: 'PATCH', body: { status: estado } });
          await pintarAgenda();
        } catch (err) { avisar(err.message, true); }
      }));
    }
    cuerpo.append(fila([
      `${b.startAt.slice(11, 16)} - ${b.endAt.slice(11, 16)}`,
      b.spaceName ?? '-',
      b.customerName ?? 'Sin cliente',
      b.status,
      dinero(b.totalCents),
      acciones,
    ]));
  }
  tabla.append(cuerpo);
  $('#agenda-lista').replaceChildren(tabla);

  const franjas = $('#agenda-disponibles');
  franjas.innerHTML = '';
  if (!disponibilidad) {
    franjas.textContent = 'Elige un espacio para ver sus franjas libres.';
    return;
  }
  for (const s of disponibilidad.slots) {
    franjas.append(boton(`${s.startAt.slice(11, 16)} - ${dinero(s.totalCents)}`, () => {
      $('#reserva-espacio').value = espacio;
      $('#reserva-inicio').value = s.startAt.slice(0, 16);
      $('#reserva-fin').value = s.endAt.slice(0, 16);
      $('#reserva-dialog').showModal();
    }));
  }
  if (disponibilidad.slots.length === 0) {
    franjas.textContent = 'No quedan franjas libres ese dia.';
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
    avisar(id ? 'Espacio actualizado' : 'Espacio creado');
    limpiarFormEspacio();
    await cargar();
  } catch (err) { avisar(err.message, true); }
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
    avisar('Cliente creado');
    await cargar();
  } catch (err) { avisar(err.message, true); }
});

$('#extra-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/addons', {
      method: 'POST',
      body: { name: $('#extra-nombre').value, priceCents: Number($('#extra-precio').value) },
    });
    $('#extra-form').reset();
    avisar('Extra creado');
    await cargar();
  } catch (err) { avisar(err.message, true); }
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
    avisar('Ajustes guardados');
    await cargar();
    await pintarAgenda();
  } catch (err) { avisar(err.message, true); }
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
    avisar('Reserva creada');
    await pintarAgenda();
  } catch (err) {
    // El 409 es el del servidor: dos personas presionaron "Reservar" a la vez, o
    // el horario se ocupó mientras la pantalla estaba abierta. La UI no lo
    // adivina, lo muestra.
    avisar(err.status === 409 ? `Ese horario ya no está libre: ${err.message}` : err.message, true);
  }
});

for (const sel of ['#reserva-espacio', '#reserva-extra', '#reserva-inicio', '#reserva-fin']) {
  $(sel).addEventListener('change', estimarTotal);
}
$('#reserva-cancelar').addEventListener('click', () => $('#reserva-dialog').close());

// ──────────────────────────────────────────────────────────────────── arranque

$('#tabs').addEventListener('click', (ev) => {
  const botonPulsado = ev.target.closest('button[data-tab]');
  if (!botonPulsado) return;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.remove('activo');
  botonPulsado.classList.add('activo');
  for (const s of document.querySelectorAll('main section')) s.hidden = true;
  $(`#panel-${botonPulsado.dataset.tab}`).hidden = false;
  if (botonPulsado.dataset.tab === 'agenda') pintarAgenda().catch((e) => avisar(e.message, true));
  if (botonPulsado.dataset.tab === 'horarios') cargarHorarios().catch((e) => avisar(e.message, true));
});

for (const sel of ['#agenda-espacio', '#agenda-fecha']) {
  $(sel).addEventListener('change', () => pintarAgenda().catch((e) => avisar(e.message, true)));
}
$('#agenda-nueva').addEventListener('click', () => $('#reserva-dialog').showModal());
$('#agenda-fecha').value = new Date().toISOString().slice(0, 10);

cargar()
  .then(() => pintarAgenda())
  .catch((err) => avisar(err.message, true));
