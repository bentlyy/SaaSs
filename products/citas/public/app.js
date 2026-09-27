/**
 * UI de citas.
 *
 * Dos cosas que acá se notan:
 *
 * 1. No hay login. La sesión llega por cookie desde el Core; si no hay, el
 *    middleware ya redirigió al login central antes de servir este HTML.
 * 2. Cada `fetch` manda `credentials: same-origin` a propósito. Sin eso el
 *    navegador no manda la cookie y la API responde 401 aunque el usuario haya
 *    entrado: el error clásico de "entra y dice que no".
 *
 * Lo que la interfaz NO hace es decidir si dos citas se pisan. Puede avisarlo
 * mientras se elige la hora, pero el que manda es el servidor: si el chequeo
 * estuviera acá, dos personas agendando a la vez meterían doble reserva.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const fmt = new Intl.NumberFormat('es-CL');

const estado = {
  me: null,
  settings: null,
  resumen: {},
  citas: [],
  clientes: [],
  servicios: [],
  profesionales: [],
  avisos: [],
  fecha: new Date().toISOString().slice(0, 10),
  vista: 'agenda',
};

/** Formatea centavos. El símbolo sale de la organización, no de una constante. */
const pesos = (centavos) => `${estado.settings?.currency ?? '$'} ${fmt.format(Math.round(centavos / 100))}`;

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
  });
  if (res.status === 401) {
    // La sesión central venció o la suscripción ya no está: volvemos al login.
    const cuerpo = await res.json().catch(() => ({}));
    if (cuerpo.loginUrl) {
      window.location.href = cuerpo.loginUrl;
      throw new Error('sesion vencida');
    }
  }
  const cuerpo = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detalle = cuerpo.errors?.fieldErrors
      ? Object.entries(cuerpo.errors.fieldErrors)
          .map(([campo, msgs]) => `${campo}: ${msgs.join(' ')}`)
          .join(' · ')
      : cuerpo.error || `Error ${res.status}`;
    throw new Error(detalle);
  }
  return cuerpo;
}

/** Muestra un error en la barra de arriba, sin tirar nada por la consola. */
function avisar(mensaje) {
  const caja = $('#error');
  if (!mensaje) {
    caja.classList.add('oculto');
    caja.textContent = '';
    return;
  }
  caja.textContent = mensaje;
  caja.classList.remove('oculto');
}

/** Envuelve una acción para que un error llegue a la barra y no se pierda. */
async function conAviso(fn) {
  try {
    avisar(null);
    await fn();
  } catch (e) {
    avisar(e.message);
  }
}

// --- carga ------------------------------------------------------------------

async function cargar() {
  const [me, resumen, settings] = await Promise.all([
    api('/api/me'),
    api('/api/resumen'),
    api('/api/settings'),
  ]);
  estado.me = me;
  estado.resumen = resumen;
  estado.settings = settings.settings;

  $('#org').textContent = me.organization?.name ?? '';
  $('#usuario').textContent = me.user?.name ?? me.user?.email ?? '';
  $('#rol').textContent = me.organization?.role ?? '';
  $('#fecha').value = estado.fecha;
  $('#c-fecha').value = estado.fecha;

  renderResumen();
  await cargarAgenda();
}

function renderResumen() {
  const r = estado.resumen;
  $('#resumen').innerHTML = [
    ['Hoy', r.hoy ?? 0],
    ['Futuras', r.futuras ?? 0],
    ['Por confirmar', r.porConfirmar ?? 0],
  ]
    .map(([titulo, valor]) => `<div class="tarjeta"><b>${valor}</b><span>${titulo}</span></div>`)
    .join('');
}

/**
 * La agenda del día, con el rango en UTC.
 *
 * El `new Date(fecha)` se parsea como medianoche local y se manda en ISO: el
 * servidor guarda UTC, y si se mandara `YYYY-MM-DD` pelado no se sabría de qué
 * día se trata.
 */
async function cargarAgenda() {
  const desde = new Date(`${estado.fecha}T00:00:00`).toISOString();
  const hasta = new Date(`${estado.fecha}T23:59:59`).toISOString();
  const { appointments } = await api(`/api/agenda?from=${desde}&to=${hasta}`);
  estado.citas = appointments;
  renderAgenda();
}

function renderAgenda() {
  const filtro = ($('#buscar').value || '').trim().toLowerCase();
  const citas = estado.citas.filter(
    (c) =>
      !filtro ||
      (c.customerName ?? '').toLowerCase().includes(filtro) ||
      (c.staffName ?? '').toLowerCase().includes(filtro),
  );

  if (citas.length === 0) {
    $('#dia').innerHTML = '<p class="vacio">No hay citas para este día.</p>';
    return;
  }

  $('#dia').innerHTML = `<table>
    <thead><tr><th>Hora</th><th>Cliente</th><th>Profesional</th><th>Estado</th><th class="num">Total</th></tr></thead>
    <tbody>${citas
      .map(
        (c) => `<tr>
          <td class="hora">${new Date(c.startAt).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</td>
          <td>${escapar(c.customerName ?? 'Sin cliente')}</td>
          <td>${escapar(c.staffName ?? 'Sin profesional')}</td>
          <td><span class="st st-${c.status}">${c.status}</span></td>
          <td class="num">${pesos(c.totalCents)}</td>
        </tr>`,
      )
      .join('')}</tbody>
  </table>`;
}

/** Escapa lo que viene de la base antes de meterlo en el HTML. */
function escapar(texto) {
  return String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

// --- catálogos --------------------------------------------------------------

async function cargarClientes() {
  const q = $('#buscar-cli').value.trim();
  const { customers } = await api(`/api/customers?limit=200${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  estado.clientes = customers;
  $('#clientes').innerHTML = customers.length
    ? `<table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Correo</th><th>Etiquetas</th></tr></thead><tbody>${customers
        .map(
          (c) => `<tr><td>${escapar(c.name)}</td><td>${escapar(c.phone ?? '—')}</td><td>${escapar(
            c.email ?? '—',
          )}</td><td>${escapar(c.tags ?? '—')}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="vacio">No hay clientes.</p>';
}

async function cargarServicios() {
  const { services } = await api('/api/services?limit=200');
  estado.servicios = services;
  $('#servicios').innerHTML = services.length
    ? `<table><thead><tr><th>Nombre</th><th class="num">Duración</th><th class="num">Precio</th><th>Estado</th></tr></thead><tbody>${services
        .map(
          (s) => `<tr><td>${escapar(s.name)}</td><td class="num">${s.durationMin} min</td><td class="num">${pesos(
            s.priceCents,
          )}</td><td>${s.active ? 'Activo' : 'Inactivo'}</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="vacio">No hay servicios.</p>';
}

async function cargarProfesionales() {
  const { staff } = await api('/api/staff?limit=200');
  estado.profesionales = staff;
  $('#profesionales').innerHTML = staff.length
    ? `<table><thead><tr><th>Nombre</th><th>Teléfono</th><th>Color</th><th>Estado</th></tr></thead><tbody>${staff
        .map(
          (p) =>
            `<tr><td><span class="punto" style="background:${escapar(p.color ?? '#999')}"></span>${escapar(
              p.name,
            )}</td><td>${escapar(p.phone ?? '—')}</td><td>${escapar(p.color ?? '—')}</td><td>${
              p.active ? 'Activo' : 'Inactivo'
            }</td></tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="vacio">No hay profesionales.</p>';
}

async function cargarAvisos() {
  const { reminders } = await api('/api/reminders?limit=100');
  estado.avisos = reminders;
  $('#avisos').innerHTML = reminders.length
    ? `<table><thead><tr><th>Cuándo</th><th>Canal</th><th>Destino</th><th>Estado</th><th>Error</th></tr></thead><tbody>${reminders
        .map(
          (r) => `<tr>
            <td>${new Date(r.sentAt ?? r.createdAt).toLocaleString('es-CL')}</td>
            <td>${escapar(r.channel)}</td>
            <td>${escapar(r.to ?? '—')}</td>
            <td><span class="st st-${r.status === 'sent' ? 'confirmed' : 'cancelled'}">${escapar(r.status)}</span></td>
            <td class="error-txt">${escapar(r.error ?? '—')}</td>
          </tr>`,
        )
        .join('')}</tbody></table>`
    : '<p class="vacio">Todavía no se mandó ningún aviso.</p>';
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
    if (el.type === 'checkbox') {
      el.checked = Boolean(s[el.name]);
    } else if (s[el.name] !== undefined) {
      el.value = s[el.name];
    }
  }
}

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const err = $('[data-err]', form);
  err.textContent = '';
  const f = new FormData(form);
  const boton = $('button[type=submit]', form);
  boton.disabled = true;
  try {
    const { settings } = await api('/api/settings', {
      method: 'PUT',
      body: JSON.stringify({
        timezone: f.get('timezone'),
        currency: f.get('currency'),
        reminderHours: Number(f.get('reminderHours')),
        emailEnabled: f.get('emailEnabled') === 'on',
      }),
    });
    estado.settings = settings;
    // El símbolo de la moneda se usa en toda la agenda, así que hay que
    // repintar: si no, la pantalla muestra el signo viejo hasta que se recarga.
    renderResumen();
    await cargarAgenda();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove('oculto');
  } finally {
    boton.disabled = false;
  }
});

/** Llena los `<select>` del formulario de cita con lo que hay cargado. */
function llenarSelectores() {  const opciones = (lista, valor, texto) =>
    lista.map((x) => `<option value="${escapar(valor(x))}">${escapar(texto(x))}</option>`).join('');
  $('#c-cliente').innerHTML = estado.clientes.map((c) => `<option value="${escapar(c.id)}">${escapar(c.name)}</option>`).join('');
  $('#c-profesional').innerHTML = estado.profesionales
    .map((p) => `<option value="${escapar(p.id)}">${escapar(p.name)}</option>`)
    .join('');
  $('#c-servicio').innerHTML =
    `<option value="">— sin servicio —</option>` +
    opciones(estado.servicios, (s) => s.id, (s) => `${s.name} · ${pesos(s.priceCents)}`);

  // Al elegir un servicio se ofrece su precio: es lo de casi siempre, y editable.
  $('#c-servicio').addEventListener('change', () => {
    const s = estado.servicios.find((x) => x.id === $('#c-servicio').value);
    if (s) $('#c-precio').value = s.priceCents;
  });
}

// --- acciones ---------------------------------------------------------------

async function guardarCita(evento) {
  evento.preventDefault();
  const caja = $('#c-error');
  caja.classList.add('oculto');

  const fecha = $('#c-fecha').value;
  const servicio = $('#c-servicio').value;
  try {
    await api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        customerId: $('#c-cliente').value || null,
        staffId: $('#c-profesional').value,
        startAt: new Date(`${fecha}T${$('#c-hora').value}:00`).toISOString(),
        endAt: new Date(`${fecha}T${$('#c-hora-fin').value}:00`).toISOString(),
        status: $('#c-estado').value,
        notes: $('#c-notas').value || null,
        services: servicio ? [{ serviceId: servicio, priceCents: Number($('#c-precio').value || 0) }] : [],
      }),
    });
    $('#dlg').close();
    estado.fecha = fecha;
    await cargarAgenda();
    await cargar();
  } catch (e) {
    // El 409 de solapamiento se muestra acá, pero la decisión ya la tomó el
    // servidor: si el navegador mintiera, la cita igual no se guarda.
    caja.textContent = e.message;
    caja.classList.remove('oculto');
  }
}

async function guardarCliente(evento) {
  evento.preventDefault();
  try {
    await api('/api/customers', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#cli-nombre').value,
        phone: $('#cli-telefono').value || null,
        email: $('#cli-email').value || null,
        tags: $('#cli-tags').value || null,
      }),
    });
    $('#dlg-cli').close();
    evento.target.reset();
    await cargarClientes();
  } catch (e) {
    $('#cli-error').textContent = e.message;
    $('#cli-error').classList.remove('oculto');
  }
}

async function guardarServicio(evento) {
  evento.preventDefault();
  try {
    await api('/api/services', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#srv-nombre').value,
        durationMin: Number($('#srv-duracion').value),
        priceCents: Number($('#srv-precio').value),
      }),
    });
    $('#dlg-srv').close();
    evento.target.reset();
    await cargarServicios();
  } catch (e) {
    $('#srv-error').textContent = e.message;
    $('#srv-error').classList.remove('oculto');
  }
}

async function guardarProfesional(evento) {
  evento.preventDefault();
  try {
    await api('/api/staff', {
      method: 'POST',
      body: JSON.stringify({
        name: $('#per-nombre').value,
        phone: $('#per-telefono').value || null,
        color: $('#per-color').value,
      }),
    });
    $('#dlg-per').close();
    evento.target.reset();
    await cargarProfesionales();
  } catch (e) {
    $('#per-error').textContent = e.message;
    $('#per-error').classList.remove('oculto');
  }
}

function cambiarVista(vista) {
  estado.vista = vista;
  for (const b of $$('#pestanas button')) b.classList.toggle('activo', b.dataset.vista === vista);
  for (const s of $$('.vista')) s.classList.toggle('oculto', s.id !== `vista-${vista}`);

  const cargar = {
    agenda: cargarAgenda,
    clientes: cargarClientes,
    servicios: cargarServicios,
    profesionales: cargarProfesionales,
    avisos: cargarAvisos,
    config: renderConfig,
  }[vista];
  conAviso(cargar);
}

// --- arranque ---------------------------------------------------------------

$('#pestanas').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-vista]');
  if (b) cambiarVista(b.dataset.vista);
});

$('#fecha').addEventListener('change', (e) => {
  estado.fecha = e.target.value;
  conAviso(cargarAgenda);
});
$('#buscar').addEventListener('input', renderAgenda);
$('#buscar-cli').addEventListener('input', conAviso.bind(null, cargarClientes));

$('#nueva').addEventListener('click', () => {
  llenarSelectores();
  $('#c-error').classList.add('oculto');
  $('#dlg').showModal();
});
$('#c-cancelar').addEventListener('click', () => $('#dlg').close());
$('#form-cita').addEventListener('submit', guardarCita);

$('#nuevo-cli').addEventListener('click', () => $('#dlg-cli').showModal());
$('#cli-cancelar').addEventListener('click', () => $('#dlg-cli').close());
$('#form-cli').addEventListener('submit', guardarCliente);

$('#nuevo-srv').addEventListener('click', () => $('#dlg-srv').showModal());
$('#srv-cancelar').addEventListener('click', () => $('#dlg-srv').close());
$('#form-srv').addEventListener('submit', guardarServicio);

$('#nuevo-per').addEventListener('click', () => $('#dlg-per').showModal());
$('#per-cancelar').addEventListener('click', () => $('#dlg-per').close());
$('#form-per').addEventListener('submit', guardarProfesional);

// La salida se resuelve contra el Core, no contra un logout local: este producto
// no tiene sesión propia que cerrar.
$('#salir').addEventListener('click', () => {
  window.location.href = '/auth/logout';
});

conAviso(cargar);
