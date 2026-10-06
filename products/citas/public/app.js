/**
 * UI de citas.
 *
 * Dos cosas que acá se notan:
 *
 * 1. No hay login. La sesión llega por cookie desde el Core; si no hay, el
 *    middleware ya redirigió al login central antes de servir este HTML.
 * 2. Cada `fetch` manda `credentials: same-origin` a propósito. Sin eso el
 *    navegador no manda la cookie y la API responde 401 aunque el usuario haya
 *    entrado: el error clásico de "entra y dice que no". De eso se encarga
 *    `AMIGO_UI.api`, que además salta al login cuando la sesión vence.
 *
 * Lo que la interfaz NO hace es decidir si dos citas se pisan. Puede avisarlo
 * mientras se elige la hora, pero el que manda es el servidor: si el chequeo
 * estuviera acá, dos personas agendando a la vez meterían doble reserva.
 *
 * El nombre de la empresa y de la persona, el canal y las pestañas los pone
 * `/amigo.js`; las tablas, tarjetas y etiquetas, `AMIGO_UI`.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

const estado = {
  settings: null,
  resumen: {},
  citas: [],
  clientes: [],
  servicios: [],
  profesionales: [],
  avisos: [],
  horarios: [],
  bloqueos: [],
  fecha: new Date().toISOString().slice(0, 10),
};

/** `Date.getUTCDay` y el servidor usan 0 = domingo. */
const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Los estados de una cita, con su tono. La forma la pone el modulo compartido. */
const ESTADOS = {
  confirmed: { texto: 'Confirmada', tono: 'ok' },
  pending: { texto: 'Por confirmar', tono: 'aviso' },
  done: { texto: 'Realizada', tono: 'acento' },
  cancelled: { texto: 'Cancelada', tono: 'neutro' },
  no_show: { texto: 'No asistió', tono: 'malo' },
};

const ESTADOS_AVISO = {
  sent: { texto: 'Enviado', tono: 'ok' },
  failed: { texto: 'Falló', tono: 'malo' },
  pending: { texto: 'Pendiente', tono: 'aviso' },
};

/** Formatea centavos. El símbolo sale de la organización, no de una constante. */
function pesos(centavos) {
  return AMIGO_UI.dinero(centavos, { simbolo: estado.settings?.currency ?? '$' });
}

/** Envuelve una acción para que un error llegue a la barra y no se pierda. */
async function conAviso(fn) {
  try {
    await fn();
  } catch (e) {
    avisar(e.message, true);
  }
}

// --- hora de la organización --------------------------------------------------

/**
 * La agenda vive en `settings.timezone`, no en la del navegador.
 *
 * El servidor guarda UTC, asi que "las 10:00 del jueves" son un instante y
 * medio dia de fabrica. Si se armara con `new Date('2026-10-02T10:00')` ese
 * instante sale del huso de quien esta mirando, y un taller de Mexico City
 * abierto desde Santiago veria sus citas corridas tres horas.
 */

/** La zona configurada, o UTC si todavia no llego (o si alguien la dejo mala). */
function zona() {
  const z = estado.settings?.timezone;
  if (!z) return 'UTC';
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: z });
    return z;
  } catch {
    return 'UTC';
  }
}

/** Cuanto le falta a UTC para que en `z` sean las `fecha`. En minutos. */
function offsetZona(z, fecha) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: z,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(fecha);
  const n = (tipo) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const comoUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'));
  return (comoUtc - fecha.getTime()) / 60000;
}

/**
 * "2026-10-02" + "10:00" en la zona `z` -> `Date` del instante que corresponde.
 *
 * Se corrige dos veces porque el offset depende del propio instante que se esta
 * calculando: en el cambio de horario de verano la primera cuenta se pasa por
 * una hora y la segunda ya cae del lado correcto.
 */
function instanteEnZona(fecha, hora, z) {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  const naive = Date.UTC(a, m - 1, d, h, min, 0);
  const primera = new Date(naive - offsetZona(z, new Date(naive)) * 60000);
  return new Date(naive - offsetZona(z, primera) * 60000);
}

/** El instante de las 00:00 del `fecha` en la zona `z`. */
function inicioDelDia(fecha, z) {
  return instanteEnZona(fecha, '00:00', z);
}

/** La hora de un instante, vista desde la zona `z`. */
function horaEnZona(iso, z) {
  return new Date(iso).toLocaleTimeString('es-CL', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: z,
  });
}

/** La fecha de un instante, vista desde la zona `z`. */
function fechaEnZona(iso, z) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: z,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const n = (tipo) => p.find((x) => x.type === tipo)?.value ?? '01';
  return `${n('year')}-${n('month')}-${n('day')}`;
}

/** El `fecha` de hoy en la zona `z`, que no siempre es el del navegador. */
function hoyEnZona(z) {
  return fechaEnZona(new Date().toISOString(), z);
}

/** "2026-10-07T15:00" de un `<input type="datetime-local">` -> ["2026-10-07", "15:00"]. */
function partesDeDateTime(valor) {
  const [fecha, hora = '00:00'] = String(valor).split('T');
  return [fecha, hora.slice(0, 5)];
}

// --- carga ------------------------------------------------------------------

/**
 * Si los ajustes del taller ya se/leyeron.
 *
 * `AMIGO.montar()` pinta el panel inicial antes de que `cargar()` termine, y sin
 * `settings.timezone` `zona()` cae en UTC. Si la agenda pidiera su rango en ese
 * momento, saldría con la medianoche de UTC: un request de más y, entre las dos
 * respuestas, un parpadeo con el día equivocado. `cargar()` pinta la agenda
 * apenas sabe la zona, así que el primer `alEntrar` no tiene que pedirla.
 */
let zonaResuelta = false;

async function cargar() {
  const [resumen, settings] = await Promise.all([api('/api/resumen'), api('/api/settings')]);
  estado.resumen = resumen;
  estado.settings = settings.settings;

  // "Hoy" es hoy en la zona del taller. Con el `new Date()` pelado, un taller
  // de Mexico City abierto desde Santiago arrancaba con el dia de ayer.
  estado.fecha = hoyEnZona(zona());
  zonaResuelta = true;
  $('#fecha').value = estado.fecha;
  $('#c-fecha').value = estado.fecha;

  AMIGO_UI.kpis($('#resumen'), [
    [resumen.hoy ?? 0, 'Hoy', true],
    [resumen.futuras ?? 0, 'Futuras'],
    [resumen.porConfirmar ?? 0, 'Por confirmar'],
  ]);

  renderConfig();
  await Promise.all([cargarAgenda(), cargarCatalogos()]);
}

/**
 * Los tres catálogos, que el formulario de cita necesita para poder llenarse.
 *
 * Se piden con la pantalla, no cuando se abre cada panel: el boton "Nueva cita"
 * esta en la barra de arriba, o sea disponible sin haber pasado nunca por
 * Clientes. Antes cada lista se cargaba al entrar a su panel, asi que una cita
 * nueva se abria con los selectores vacios y no habia forma de elegir.
 *
 * `items` y no un nombre propio: es lo que devuelve `crudRouter`, con
 * `{ items, total, limit, offset }`.
 */
async function cargarCatalogos() {
  const [clientes, servicios, profesionales] = await Promise.all([
    api('/api/customers?limit=200'),
    api('/api/services?limit=200'),
    api('/api/staff?limit=200'),
  ]);
  estado.clientes = clientes.items ?? [];
  estado.servicios = servicios.items ?? [];
  estado.profesionales = profesionales.items ?? [];
}

/**
 * La agenda del día, con el rango en UTC.
 *
 * El rango se arma con las 00:00 y las 23:59 del día EN LA ZONA DEL TALLER, que
 * traducidas a UTC no es lo mismo que la medianoche del navegador. Mandar
 * `YYYY-MM-DD` pelado tampoco sirve: el servidor guarda UTC y no sabría de qué
 * día se trata.
 */
async function cargarAgenda() {
  // Sin los ajustes todavia no hay zona que mandar: se espera a que `cargar()`
  // los traiga, en vez de pedir un rango en UTC y volver a pedirlo.
  if (!zonaResuelta) return;
  const z = zona();
  const desde = inicioDelDia(estado.fecha, z).toISOString();
  const hasta = instanteEnZona(estado.fecha, '23:59', z).toISOString();
  const { appointments } = await api(`/api/agenda?from=${desde}&to=${hasta}`);
  estado.citas = appointments ?? [];
  renderAgenda();
}

function renderAgenda() {
  const z = zona();
  const filtro = ($('#buscar').value || '').trim().toLowerCase();
  const citas = estado.citas.filter(
    (c) =>
      !filtro ||
      (c.customerName ?? '').toLowerCase().includes(filtro) ||
      (c.staffName ?? '').toLowerCase().includes(filtro),
  );

  // `eje: true`: en una agenda la primera columna es la hora, y se lee como el eje
  // de tiempos de un calendario, no como "la primera celda de una fila".
  const tabla = AMIGO_UI.tabla([
    'Hora',
    'Cliente',
    'Profesional',
    'Estado',
    { titulo: 'Total', num: true },
  ]);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (citas.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(5, 'No hay citas para este día.'));
  } else {
    for (const c of citas) {
      const hora = document.createElement('span');
      hora.className = 'mono';
      hora.textContent = horaEnZona(c.startAt, z);
      cuerpo.append(
        AMIGO_UI.fila([
          hora,
          c.customerName ?? 'Sin cliente',
          c.staffName ?? 'Sin profesional',
          AMIGO_UI.estadoDe(c.status, ESTADOS),
          pesos(c.totalCents),
        ]),
      );
    }
  }

  $('#dia').replaceChildren(AMIGO_UI.cajaTabla(tabla, { eje: true }));
}

// --- catálogos --------------------------------------------------------------

/** Pinta una tabla simple de un catálogo. `columnas` son [titulo, celda]. */
function tablaDe(columnas, filas, vacio) {
  const tabla = AMIGO_UI.tabla(columnas.map((c) => (typeof c === 'string' ? { titulo: c } : c)));
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  if (filas.length === 0) cuerpo.append(AMIGO_UI.filaVacia(columnas.length, vacio));
  else for (const f of filas) cuerpo.append(AMIGO_UI.fila(f));
  return AMIGO_UI.cajaTabla(tabla);
}

async function cargarClientes() {
  const q = $('#buscar-cli').value.trim();
  const { items } = await api(`/api/customers?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  estado.clientes = items ?? [];
  $('#clientes').replaceChildren(
    tablaDe(
      ['Nombre', 'Teléfono', 'Correo', 'Etiquetas'],
      estado.clientes.map((c) => [c.name, c.phone ?? '—', c.email ?? '—', c.tags ?? '—']),
      'No hay clientes.',
    ),
  );
}

async function cargarServicios() {
  const { items } = await api('/api/services?limit=200');
  estado.servicios = items ?? [];
  $('#servicios').replaceChildren(
    tablaDe(
      ['Nombre', { titulo: 'Duración', num: true }, { titulo: 'Precio', num: true }, 'Estado'],
      estado.servicios.map((s) => [
        s.name,
        `${s.durationMin} min`,
        pesos(s.priceCents),
        AMIGO_UI.etiqueta(s.active ? 'Activo' : 'Inactivo', s.active ? 'ok' : 'neutro'),
      ]),
      'No hay servicios.',
    ),
  );
}

async function cargarProfesionales() {
  const { items } = await api('/api/staff?limit=200');
  estado.profesionales = items ?? [];
  $('#profesionales').replaceChildren(
    tablaDe(
      ['Nombre', 'Teléfono', 'Color', 'Estado'],
      estado.profesionales.map((p) => {
        // El punto de color va antes del nombre: es lo que permite recorrer la
        // tabla de un vistazo y decir de quién es cada fila sin leerla.
        const punto = document.createElement('span');
        punto.className = 'ui-punto';
        punto.style.background = p.color ?? '#999';
        punto.style.display = 'inline-block';
        punto.style.marginRight = '.45rem';
        return [
          AMIGO_UI.celda(punto, p.name),
          p.phone ?? '—',
          p.color ?? '—',
          AMIGO_UI.etiqueta(p.active ? 'Activo' : 'Inactivo', p.active ? 'ok' : 'neutro'),
        ];
      }),
      'No hay profesionales.',
    ),
  );
}

async function cargarAvisos() {
  const { reminders } = await api('/api/reminders?limit=100');
  estado.avisos = reminders ?? [];
  $('#avisos').replaceChildren(
    tablaDe(
      ['Cuándo', 'Canal', 'Destino', 'Estado', 'Error'],
      estado.avisos.map((r) => [
        AMIGO_UI.fecha(r.sentAt ?? r.createdAt, true, zona()),
        r.channel,
        r.to ?? '—',
        AMIGO_UI.estadoDe(r.status, ESTADOS_AVISO),
        r.error ?? '—',
      ]),
      'Todavía no se mandó ningún aviso.',
    ),
  );
}

// --- configuracion ----------------------------------------------------------

/**
 * Rellena el formulario de configuración.
 *
 * Se recorre `form.elements` y no se busca cada input por id: si mañana se
 * agrega un campo, entra solo, y un `id` hardcodeado por acá es un lugar más
 * donde la pantalla puede quedar vacía sin que nada falle.
 */
function renderConfig() {
  const form = $('#config-form');
  const s = estado.settings ?? {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') el.checked = Boolean(s[el.name]);
    else if (s[el.name] !== undefined) el.value = s[el.name];
  }
}

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const err = $('[data-err]', form);
  err.hidden = true;
  const f = new FormData(form);
  const boton = $('button[type=submit]', form);
  boton.disabled = true;
  try {
    const { settings } = await api('/api/settings', {
      method: 'PUT',
      body: {
        timezone: f.get('timezone'),
        currency: f.get('currency'),
        reminderHours: Number(f.get('reminderHours')),
        emailEnabled: f.get('emailEnabled') === 'on',
      },
    });
    estado.settings = settings;
    // El símbolo de la moneda se usa en toda la agenda, así que hay que
    // repintar: si no, la pantalla muestra el signo viejo hasta que se recarga.
    AMIGO_UI.kpis($('#resumen'), [
      [estado.resumen.hoy ?? 0, 'Hoy', true],
      [estado.resumen.futuras ?? 0, 'Futuras'],
      [estado.resumen.porConfirmar ?? 0, 'Por confirmar'],
    ]);
    await cargarAgenda();
    avisar('Ajustes guardados');
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    boton.disabled = false;
  }
});

/** Llena los `<select>` del formulario de cita con lo que hay cargado. */
function llenarSelectores() {
  const select = (sel, lista, texto, vacio) => {
    const el = $(sel);
    el.replaceChildren();
    // Con la lista vacia el desplegable queda sin una sola opcion y no hay forma
    // de explicarlo: `required` dispara el aviso nativo del navegador y el
    // usuario cree que la pantalla esta rota. Un renglon que lo diga es mejor.
    if (lista.length === 0) {
      el.append(new Option(vacio, ''));
      el.disabled = true;
      return;
    }
    el.disabled = false;
    for (const x of lista) el.append(new Option(texto(x), x.id));
  };

  select('#c-cliente', estado.clientes, (c) => c.name, '— sin clientes cargados —');
  select('#c-profesional', estado.profesionales, (p) => p.name, '— sin profesionales cargados —');

  const servicio = $('#c-servicio');
  servicio.replaceChildren(new Option('— sin servicio —', ''));
  for (const s of estado.servicios) servicio.append(new Option(`${s.name} · ${pesos(s.priceCents)}`, s.id));
  // Al abrir el dialogo el precio sale del catálogo, no de lo que quedara de la
  // cita anterior.
  $('#c-precio').value = precioDeCatalogo();
}

// --- horarios ---------------------------------------------------------------

/** Minutos al día -> "HH:MM" para `<input type="time">`. */
function minutosAHora(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

async function cargarHorarios() {
  // Los profesionales se cargan con la pantalla; si no estan, se traen aca para
  // poder elegir "el horario de quién".
  if (estado.profesionales.length === 0) {
    const { items } = await api('/api/staff?limit=200');
    estado.profesionales = items ?? [];
  }
  const sel = $('#horario-profesional');
  sel.replaceChildren();
  if (estado.profesionales.length === 0) {
    sel.append(new Option('— sin profesionales cargados —', ''));
    sel.disabled = true;
  } else {
    sel.disabled = false;
    for (const p of estado.profesionales) sel.append(new Option(p.name, p.id));
  }

  const dia = $('#horario-dia');
  if (dia.options.length === 0) {
    dia.replaceChildren();
    DIAS.forEach((d, i) => dia.append(new Option(d, String(i))));
  }

  await refrescarHorarios();
}

async function refrescarHorarios() {
  const profesional = $('#horario-profesional').value;
  if (!profesional) {
    estado.horarios = [];
    estado.bloqueos = [];
    $('#horarios').replaceChildren(AMIGO_UI.vacio(document.createElement('div'), 'Elige un profesional para ver sus horarios.'));
    $('#bloqueos').replaceChildren();
    return;
  }

  const [h, b] = await Promise.all([
    api(`/api/schedules?staffId=${profesional}`),
    api(`/api/blocks?staffId=${profesional}`),
  ]);
  estado.horarios = h.items;
  estado.bloqueos = b.items;
  renderHorarios();
}

function renderHorarios() {
  const profesional = $('#horario-profesional').value;
  const prof = estado.profesionales.find((p) => p.id === profesional);

  if (estado.horarios.length === 0) {
    $('#horarios').replaceChildren(
      AMIGO_UI.vacio(
        document.createElement('div'),
        `${prof ? prof.name : 'Este profesional'} atiende en la jornada general que pida la consulta. Agrega un horario para cambiarle el día a la semana.`,
      ),
    );
  } else {
    const tabla = AMIGO_UI.tabla(['Día', 'Desde', 'Hasta', 'Estado', '']);
    const cuerpo = AMIGO_UI.cuerpoDe(tabla);
    for (const h of estado.horarios) {
      const acciones = AMIGO_UI.celda(
        AMIGO_UI.boton('Editar', () => editarHorario(h)),
        AMIGO_UI.boton('Borrar', async () => {
          await conAviso(async () => {
            await api(`/api/schedules/${h.id}`, { method: 'DELETE' });
            await refrescarHorarios();
          });
        }, 'ui-btn ui-btn--chico ui-btn--fantasma'),
      );
      cuerpo.append(
        AMIGO_UI.fila(
          [DIAS[h.weekday], minutosAHora(h.startTime), minutosAHora(h.endTime), AMIGO_UI.etiqueta(h.active ? 'Activo' : 'Inactivo', h.active ? 'ok' : 'neutro'), acciones],
          { className: 'acciones' },
        ),
      );
    }
    $('#horarios').replaceChildren(AMIGO_UI.cajaTabla(tabla));
  }

  if (estado.bloqueos.length === 0) {
    $('#bloqueos').replaceChildren(
      AMIGO_UI.vacio(document.createElement('div'), 'Sin bloqueos: el profesional atiende según su horario.'),
    );
  } else {
    const tabla = AMIGO_UI.tabla(['Empieza', 'Termina', 'Motivo', '']);
    const cuerpo = AMIGO_UI.cuerpoDe(tabla);
    for (const b of estado.bloqueos) {
      const acciones = AMIGO_UI.celda(
        AMIGO_UI.boton('Quitar', async () => {
          await conAviso(async () => {
            await api(`/api/blocks/${b.id}`, { method: 'DELETE' });
            await refrescarHorarios();
          });
        }),
      );
      cuerpo.append(
        AMIGO_UI.fila(
          [
            AMIGO_UI.fecha(b.startAt, true, zona()),
            AMIGO_UI.fecha(b.endAt, true, zona()),
            b.reason ?? '—',
            acciones,
          ],
          { className: 'acciones' },
        ),
      );
    }
    $('#bloqueos').replaceChildren(AMIGO_UI.cajaTabla(tabla));
  }
}

function editarHorario(h) {
  $('#horario-dia').value = String(h.weekday);
  $('#horario-desde').value = minutosAHora(h.startTime);
  $('#horario-hasta').value = minutosAHora(h.endTime);
  $('#horario-activo').value = String(h.active);
  $('#horario-cancelar').hidden = false;
  $('#horario-cancelar').dataset.id = h.id;
  $('#horario-err').hidden = true;
}

function limpiarFormHorario() {
  $('#horario-form').reset();
  $('#horario-activo').value = 'true';
  $('#horario-cancelar').hidden = true;
  delete $('#horario-cancelar').dataset.id;
  $('#horario-err').hidden = true;
}

$('#horario-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const caja = $('#horario-err');
  const profesional = $('#horario-profesional').value;
  if (!profesional) {
    caja.textContent = 'Elige un profesional.';
    caja.hidden = false;
    return;
  }
  const id = $('#horario-cancelar').dataset.id;
  try {
    await api(id ? `/api/schedules/${id}` : '/api/schedules', {
      method: id ? 'PATCH' : 'POST',
      body: {
        staffId: profesional,
        weekday: Number($('#horario-dia').value),
        startTime: aMinutos($('#horario-desde').value),
        endTime: aMinutos($('#horario-hasta').value),
        active: $('#horario-activo').value === 'true',
      },
    });
    limpiarFormHorario();
    await refrescarHorarios();
  } catch (e) {
    caja.textContent = e.message;
    caja.hidden = false;
  }
});

$('#horario-cancelar').addEventListener('click', limpiarFormHorario);

$('#bloqueo-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const caja = $('#bloqueo-err');
  const profesional = $('#horario-profesional').value;
  if (!profesional) {
    caja.textContent = 'Elige un profesional.';
    caja.hidden = false;
    return;
  }
  try {
    await api('/api/blocks', {
      method: 'POST',
      body: {
        staffId: profesional,
        // `datetime-local` da "2026-10-07T15:00" sin zona: se interpreta en la
        // del taller, no en la del navegador.
        startAt: instanteEnZona(...partesDeDateTime($('#bloqueo-inicio').value), zona()).toISOString(),
        endAt: instanteEnZona(...partesDeDateTime($('#bloqueo-fin').value), zona()).toISOString(),
        reason: $('#bloqueo-motivo').value || null,
      },
    });
    ev.target.reset();
    await refrescarHorarios();
  } catch (e) {
    caja.textContent = e.message;
    caja.hidden = false;
  }
});

$('#horario-profesional').addEventListener('change', () => conAviso(refrescarHorarios));

// --- acciones ---------------------------------------------------------------

/**
 * El precio del servicio elegido, en la unidad del campo: centavos.
 *
 * El campo se rellena solo porque antes se quedaba en 0 y la cita se guardaba
 * con `totalCents: 0`: se vendia el trabajo y la agenda no abria nada. Es un
 * campo editable, asi que el que quiera otra cosa la cambia a mano.
 *
 * La conversion a money no va en este archivo: la hace `AMIGO_UI.dinero`, en un
 * solo lugar para los nueve productos. Por eso el campo dice "en centavos".
 */
function precioDeCatalogo() {
  const elegido = estado.servicios.find((s) => s.id === $('#c-servicio').value);
  return elegido ? Number(elegido.priceCents ?? 0) : 0;
}

$('#c-servicio').addEventListener('change', () => {
  $('#c-precio').value = precioDeCatalogo();
});

async function guardarCita(evento) {
  evento.preventDefault();
  const caja = $('#c-error');
  caja.hidden = true;

  const fecha = $('#c-fecha').value;
  const servicio = $('#c-servicio').value;
  const z = zona();
  try {
    await api('/api/appointments', {
      method: 'POST',
      body: {
        customerId: $('#c-cliente').value || null,
        staffId: $('#c-profesional').value,
        // "Las 10:00" son las 10:00 DEL TALLER. Armarlo con `new Date(...)` lo
        // convertia al huso de quien esta mirando, y la cita se guardaba corrida.
        startAt: instanteEnZona(fecha, $('#c-hora').value, z).toISOString(),
        endAt: instanteEnZona(fecha, $('#c-hora-fin').value, z).toISOString(),
        status: $('#c-estado').value,
        notes: $('#c-notas').value || null,
        services: servicio ? [{ serviceId: servicio, priceCents: Number($('#c-precio').value || 0) }] : [],
      },
    });
  } catch (e) {
    // El 409 de solapamiento se muestra acá, pero la decisión ya la tomó el
    // servidor: si el navegador mintiera, la cita igual no se guarda.
    caja.textContent = e.message;
    caja.hidden = false;
    return;
  }

  $('#dlg').close();
  estado.fecha = fecha;
  avisar('Cita agendada');
  await conAviso(cargar);
}

/**
 * Alta de catálogo: guardar y refrescar son dos cosas distintas.
 *
 * Antes iban en el mismo `try`: si el refresco fallaba, el `catch` reportaba el
 * error de la recarga como si el alta hubiera fallado, y lo escribia en una caja
 * que estaba DENTRO del dialogo recien cerrado. Resultado: el POST volvia 201 y
 * el usuario no veia ni un mensaje. Aqui el alta se confirma apenas ocurre, y la
 * recarga se avisa por separado.
 */
async function guardarCliente(evento) {
  evento.preventDefault();
  try {
    await api('/api/customers', {
      method: 'POST',
      body: {
        name: $('#cli-nombre').value,
        phone: $('#cli-telefono').value || null,
        email: $('#cli-email').value || null,
        tags: $('#cli-tags').value || null,
      },
    });
  } catch (e) {
    $('#cli-error').textContent = e.message;
    $('#cli-error').hidden = false;
    return;
  }
  $('#dlg-cli').close();
  evento.target.reset();
  avisar('Cliente creado');
  await conAviso(cargarClientes);
}

async function guardarServicio(evento) {
  evento.preventDefault();
  try {
    await api('/api/services', {
      method: 'POST',
      body: {
        name: $('#srv-nombre').value,
        durationMin: Number($('#srv-duracion').value),
        priceCents: Number($('#srv-precio').value),
      },
    });
  } catch (e) {
    $('#srv-error').textContent = e.message;
    $('#srv-error').hidden = false;
    return;
  }
  $('#dlg-srv').close();
  evento.target.reset();
  avisar('Servicio creado');
  await conAviso(cargarServicios);
}

async function guardarProfesional(evento) {
  evento.preventDefault();
  try {
    await api('/api/staff', {
      method: 'POST',
      body: {
        name: $('#per-nombre').value,
        phone: $('#per-telefono').value || null,
        color: $('#per-color').value,
      },
    });
  } catch (e) {
    $('#per-error').textContent = e.message;
    $('#per-error').hidden = false;
    return;
  }
  $('#dlg-per').close();
  evento.target.reset();
  avisar('Profesional creado');
  await conAviso(cargarProfesionales);
}

// --- navegación -------------------------------------------------------------

/** Las pestañas las lleva el shell compartido; acá solo qué pintar en cada una. */
const PANELES = {
  agenda: cargarAgenda,
  clientes: cargarClientes,
  servicios: cargarServicios,
  profesionales: cargarProfesionales,
  horarios: cargarHorarios,
  avisos: cargarAvisos,
  config: async () => renderConfig(),
};

function alEntrar(panel) {
  const fn = PANELES[panel];
  if (fn) conAviso(fn);
}

// --- arranque ---------------------------------------------------------------

$('#fecha').addEventListener('change', (e) => {
  estado.fecha = e.target.value;
  conAviso(cargarAgenda);
});
$('#buscar').addEventListener('input', renderAgenda);
$('#buscar-cli').addEventListener('input', () => conAviso(cargarClientes));

/**
 * Abre el formulario de cita.
 *
 * Recarga los catálogos antes de abrir, y abre SIEMPRE. Antes el `showModal()`
 * venía después de `llenarSelectores()`, así que cualquier falla de esa función
 * dejaba el botón sin hacer nada y sin decir por qué. Si la recarga falla, se
 * abre igual con lo que haya y la barra de avisos lo cuenta.
 */
async function abrirDialogoCita() {
  $('#c-error').hidden = true;
  await conAviso(cargarCatalogos);
  try {
    llenarSelectores();
  } catch (e) {
    avisar(e.message, true);
  }
  $('#c-fecha').value = estado.fecha;
  $('#dlg').showModal();
}

$('#nueva').addEventListener('click', () => {
  void abrirDialogoCita();
});
$('#c-cancelar').addEventListener('click', () => $('#dlg').close());
$('#c-cerrar').addEventListener('click', () => $('#dlg').close());
$('#form-cita').addEventListener('submit', guardarCita);

$('#nuevo-cli').addEventListener('click', () => $('#dlg-cli').showModal());
$('#cli-cancelar').addEventListener('click', () => $('#dlg-cli').close());
$('#cli-cerrar').addEventListener('click', () => $('#dlg-cli').close());
$('#form-cli').addEventListener('submit', guardarCliente);

$('#nuevo-srv').addEventListener('click', () => $('#dlg-srv').showModal());
$('#srv-cancelar').addEventListener('click', () => $('#dlg-srv').close());
$('#srv-cerrar').addEventListener('click', () => $('#dlg-srv').close());
$('#form-srv').addEventListener('submit', guardarServicio);

$('#nuevo-per').addEventListener('click', () => $('#dlg-per').showModal());
$('#per-cancelar').addEventListener('click', () => $('#dlg-per').close());
$('#per-cerrar').addEventListener('click', () => $('#dlg-per').close());
$('#form-per').addEventListener('submit', guardarProfesional);

AMIGO.montar({
  nombre: 'Citas',
  paneles: ['agenda', 'clientes', 'servicios', 'profesionales', 'horarios', 'avisos', 'config'],
  alEntrar,
});

conAviso(cargar);
