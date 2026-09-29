/**
 * Interfaz de clientes.
 *
 * Dos reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. La pantalla NO decide el "hoy" del tablero. Es el servidor quien responde
 *      que dia es en la zona horaria de la empresa: aca el navegador sabe la
 *      fecha del que esta mirando la pantalla, que no es necesariamente la del
 *      negocio. Por eso se pinta lo que llega en `tablero.hoy` y no lo que dice
 *      `new Date()`.
 *
 * Lo que se ve -tarjetas, tablas, botones, etiquetas- viene de `AMIGO_UI`, el
 * modulo compartido: las nueve herramientas dibujan sus tablas con el mismo
 * codigo, y lo unico que escribe este archivo es que columnas tiene cada una.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

const estado = {
  clientes: [],
  seguimientos: [],
  contactos: [],
  cfg: { currency: '$', timezone: 'America/Santiago' },
  /** El "hoy" del negocio, segun el servidor. */
  hoy: null,
};

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [clientes, cfg] = await Promise.all([api('/api/customers?limit=500'), api('/api/settings')]);
  estado.clientes = clientes.items;
  estado.cfg = cfg.settings;
  renderConfig();
  llenarSelect('#tablero-cliente', estado.clientes, 'Todos los clientes');
  llenarSelect('#seguimiento-cliente', estado.clientes, 'Elegí un cliente');
  llenarSelect('#contacto-cliente', estado.clientes, 'Elegí un cliente');
}

/**
 * Llena un `<select>` de clientes.
 *
 * Va con nodos y no con `innerHTML` por una razon que ya se pago una vez: un
 * cliente se llama como se llame, y `innerHTML` con el nombre pegado es una
 * forma de que un nombre con `<` rompa la pagina.
 */
function llenarSelect(sel, lista, vacio) {
  const el = $(sel);
  el.replaceChildren(new Option(vacio, ''));
  for (const c of lista) el.append(new Option(c.name, c.id));
}

const ETIQUETA_ESTADO = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  done: { texto: 'Hecho', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

const ETIQUETA_CONTACTO = {
  llamada: 'Llamada',
  correo: 'Correo',
  visita: 'Visita',
  nota: 'Nota',
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fecha) {
  if (!fecha) return '';
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}

const instanteCorto = (iso) => (iso ? AMIGO_UI.fecha(iso, true) : '');

// ─────────────────────────────────────────────────────────────────────── tablero

/** Un seguimiento en la lista del tablero. */
function fichaSeguimiento(seg) {
  const div = document.createElement('div');
  div.className = 'ui-ficha';
  div.dataset.cliente = seg.customerId;
  const cuerpo = document.createElement('div');
  cuerpo.className = 'ui-ficha__cuerpo';
  const titulo = document.createElement('span');
  titulo.className = 'ui-ficha__titulo';
  titulo.textContent = seg.title;
  const nota = document.createElement('span');
  nota.className = 'ui-ficha__nota';
  nota.textContent = [seg.customerName ?? '', seg.dueDate ? fechaCorta(seg.dueDate) : '']
    .filter(Boolean)
    .join(' · ');
  cuerpo.append(titulo, nota);
  div.append(cuerpo);
  return div;
}

function pintarVacio(contenedor, texto) {
  contenedor.replaceChildren(AMIGO_UI.vacio(document.createElement('div'), texto));
}

async function pintarTablero() {
  const filtro = $('#tablero-cliente').value;
  const [resumen, tablero] = await Promise.all([
    api('/api/resumen'),
    api(`/api/tablero${filtro ? `?customerId=${encodeURIComponent(filtro)}` : ''}`),
  ]);
  // El "hoy" es el del negocio, no el del navegador: se muestra el que calculó el
  // servidor con la zona horaria de la empresa, y no el de esta maquina.
  estado.hoy = tablero.hoy;

  AMIGO_UI.kpis($('#resumen'), [
    [resumen.activos, 'Clientes activos', true],
    [resumen.archivados, 'Archivados'],
    [resumen.seguimientos.porEstado.pending, 'Pendientes'],
    [resumen.seguimientos.vencidos, 'Vencidos'],
    [resumen.seguimientos.paraHoy, 'Para hoy'],
    [resumen.contactos30d, 'Contactos (30 días)'],
  ]);

  const nada = 'Nada por acá';
  const tres = [
    ['#seguimiento-vencidos', tablero.seguimientos.vencidos],
    ['#seguimiento-hoy', tablero.seguimientos.hoy],
    ['#seguimiento-proximos', tablero.seguimientos.proximos],
  ];
  for (const [sel, lista] of tres) {
    const caja = $(sel);
    if (lista.length === 0) pintarVacio(caja, nada);
    else caja.replaceChildren(...lista.map(fichaSeguimiento));
  }

  const cumpleanos = tablero.cumpleanos;
  if (cumpleanos.length === 0) pintarVacio($('#cumpleanos'), nada);
  else {
    $('#cumpleanos').replaceChildren(
      ...cumpleanos.map((c) => {
        const div = document.createElement('div');
        div.className = 'ui-ficha';
        const cuerpo = document.createElement('div');
        cuerpo.className = 'ui-ficha__cuerpo';
        const titulo = document.createElement('span');
        titulo.className = 'ui-ficha__titulo';
        titulo.textContent = c.name;
        const nota = document.createElement('span');
        nota.className = 'ui-ficha__nota';
        nota.textContent = fechaCorta(c.birthday);
        cuerpo.append(titulo, nota);
        div.append(cuerpo);
        return div;
      }),
    );
  }

  const recientes = tablero.contactos;
  if (recientes.length === 0) pintarVacio($('#contactos-recientes'), nada);
  else {
    $('#contactos-recientes').replaceChildren(
      ...recientes.map((c) => {
        const div = document.createElement('div');
        div.className = 'ui-ficha';
        const cuerpo = document.createElement('div');
        cuerpo.className = 'ui-ficha__cuerpo';
        const titulo = document.createElement('span');
        titulo.className = 'ui-ficha__titulo';
        titulo.textContent = c.customerName ?? '';
        const nota = document.createElement('span');
        nota.className = 'ui-ficha__nota';
        nota.textContent = `${ETIQUETA_CONTACTO[c.kind] ?? c.kind}: ${c.summary} · ${instanteCorto(c.happenedAt)}`;
        cuerpo.append(titulo, nota);
        div.append(cuerpo);
        return div;
      }),
    );
  }
}

// ───────────────────────────────────────────────────────────────────── clientes

function pintarClientes() {
  const busqueda = $('#cliente-buscar').value.trim().toLowerCase();
  const lista = busqueda
    ? estado.clientes.filter((c) =>
        [c.name, c.company, c.phone, c.email, c.taxId, c.city].some((v) =>
          String(v ?? '').toLowerCase().includes(busqueda),
        ),
      )
    : estado.clientes;

  const tabla = AMIGO_UI.tabla(['Nombre', 'Tipo', 'Teléfono', 'Correo', 'Ciudad', 'Acciones']);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (lista.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(6, 'No hay clientes que coincidan'));
  } else {
    for (const c of lista) {
      // El documento va debajo del nombre y no en su propia columna: es un dato
      // secundario de la misma persona, y darle columna propia le roba ancho al
      // teléfono, que es lo que se lee de verdad.
      const nombre = AMIGO_UI.celda(c.name, c.taxId ? document.createElement('br') : null, c.taxId || '');
      cuerpo.append(
        AMIGO_UI.fila(
          [
            nombre,
            c.kind === 'empresa' ? 'Empresa' : 'Persona',
            c.phone ?? '—',
            c.email ?? '—',
            c.city ?? '—',
            AMIGO_UI.celda(
              AMIGO_UI.boton('Ficha', () => abrirFicha(c.id).catch((e) => avisar(e.message, true))),
              AMIGO_UI.boton('Editar', () => abrirCliente(c)),
              AMIGO_UI.boton(
                'Archivar',
                async () => {
                  try {
                    await api(`/api/customers/${c.id}`, { method: 'DELETE' });
                    await recargar();
                    avisar('Cliente archivado');
                  } catch (err) {
                    avisar(err.message, true);
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

  $('#clientes-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

function abrirCliente(cliente) {
  $('#cliente-id').value = cliente?.id ?? '';
  $('#cliente-form-titulo').textContent = cliente ? 'Editar cliente' : 'Nuevo cliente';
  $('#cliente-cancelar').hidden = !cliente;
  $('#cliente-nombre').value = cliente?.name ?? '';
  $('#cliente-tipo').value = cliente?.kind ?? 'persona';
  $('#cliente-empresa').value = cliente?.company ?? '';
  $('#cliente-telefono').value = cliente?.phone ?? '';
  $('#cliente-correo').value = cliente?.email ?? '';
  $('#cliente-documento').value = cliente?.taxId ?? '';
  $('#cliente-cumpleanos').value = cliente?.birthday ?? '';
  $('#cliente-direccion').value = cliente?.address ?? '';
  $('#cliente-ciudad').value = cliente?.city ?? '';
  $('#cliente-notas').value = cliente?.notes ?? '';
  $('#cliente-etiquetas').value = cliente?.tags ?? '';
}

$('#cliente-cancelar').addEventListener('click', () => abrirCliente(null));

$('#cliente-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#cliente-id').value;
  // Los campos vacios viajan como null y no como "": el servidor distingue
  // "no lo tengo" de "lo tengo en blanco", y la ficha muestra distinto.
  const cuerpo = {
    name: $('#cliente-nombre').value,
    kind: $('#cliente-tipo').value,
    company: $('#cliente-empresa').value || null,
    phone: $('#cliente-telefono').value || null,
    email: $('#cliente-correo').value || null,
    taxId: $('#cliente-documento').value || null,
    birthday: $('#cliente-cumpleanos').value || null,
    address: $('#cliente-direccion').value || null,
    city: $('#cliente-ciudad').value || null,
    notes: $('#cliente-notas').value || null,
    tags: $('#cliente-etiquetas').value || null,
  };
  try {
    await api(id ? `/api/customers/${id}` : '/api/customers', {
      method: id ? 'PATCH' : 'POST',
      body: cuerpo,
    });
    abrirCliente(null);
    await recargar();
    avisar(id ? 'Cliente actualizado' : 'Cliente creado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#cliente-buscar').addEventListener('input', pintarClientes);

// ──────────────────────────────────────────────────────────────────────── ficha

/**
 * La ficha completa de un cliente, en una ventana.
 *
 * Se arma con nodos porque son datos de una persona: el nombre lo eligio el
 * cliente. Pegarlos con `innerHTML` seria confiar en que nadie se llamar
 * "<script>".
 */
async function abrirFicha(idCliente) {
  const ficha = await api(`/api/customers/${idCliente}/ficha`);
  const c = ficha.customer;
  const caja = document.createElement('div');

  const datos = document.createElement('dl');
  datos.className = 'ui-datos';
  const par = (etiqueta, valor) => {
    if (!valor) return;
    const dt = document.createElement('dt');
    dt.textContent = etiqueta;
    const dd = document.createElement('dd');
    dd.textContent = valor;
    datos.append(dt, dd);
  };
  par('Teléfono', c.phone ?? 'Sin teléfono');
  par('Correo', c.email ?? 'Sin correo');
  par('Cumpleaños', c.birthday ? fechaCorta(c.birthday) : '');
  par('Dirección', c.address);
  par('Ciudad', c.city);
  par('Etiquetas', c.tags);
  par('Notas', c.notes);
  caja.append(datos);

  const resumen = document.createElement('p');
  resumen.className = 'tenue pequeno';
  resumen.style.marginTop = '.75rem';
  resumen.textContent =
    `${ficha.resumen.seguimientosAbiertos} pendiente(s), ` +
    `${ficha.resumen.seguimientosVencidos} vencido(s), ` +
    `${ficha.resumen.contactos} contacto(s)`;
  caja.append(resumen);

  caja.append(seccionSeguimientos(ficha.followups));
  caja.append(seccionContactos(ficha.interactions));

  $('#ficha').replaceChildren(caja);
  $('#ficha-dialog').showModal();
}

/** Un bloque de la ficha: encabezado + lista, o la vacía. */
function seccionSeguimientos(followups) {
  const caja = document.createElement('div');
  caja.style.marginTop = '1rem';
  const h = document.createElement('h4');
  h.textContent = 'Seguimientos';
  const lista = document.createElement('div');
  lista.className = 'ui-lista';
  if (followups.length === 0) lista.append(AMIGO_UI.vacio(document.createElement('div'), 'Sin seguimientos'));
  else {
    for (const f of followups) {
      const fila = document.createElement('div');
      fila.className = 'ui-ficha';
      const titulo = document.createElement('span');
      titulo.className = 'ui-ficha__titulo';
      titulo.textContent = f.title;
      const nota = document.createElement('span');
      nota.className = 'ui-ficha__nota';
      nota.textContent = [
        (ETIQUETA_ESTADO[f.status] ?? { texto: f.status }).texto,
        f.dueDate ? fechaCorta(f.dueDate) : '',
      ]
        .filter(Boolean)
        .join(' · ');
      fila.append(titulo, nota);
      lista.append(fila);
    }
  }
  caja.append(h, lista);
  return caja;
}

function seccionContactos(interactions) {
  const caja = document.createElement('div');
  caja.style.marginTop = '1rem';
  const h = document.createElement('h4');
  h.textContent = 'Historial de contacto';
  const lista = document.createElement('div');
  lista.className = 'ui-lista';
  if (interactions.length === 0) {
    lista.append(AMIGO_UI.vacio(document.createElement('div'), 'Sin contactos registrados'));
  } else {
    for (const i of interactions) {
      const fila = document.createElement('div');
      fila.className = 'ui-ficha';
      const titulo = document.createElement('span');
      titulo.className = 'ui-ficha__titulo';
      titulo.textContent = i.summary;
      const nota = document.createElement('span');
      nota.className = 'ui-ficha__nota';
      nota.textContent = `${ETIQUETA_CONTACTO[i.kind] ?? i.kind} · ${instanteCorto(i.happenedAt)}`;
      fila.append(titulo, nota);
      lista.append(fila);
    }
  }
  caja.append(h, lista);
  return caja;
}

$('#ficha-cerrar').addEventListener('click', () => $('#ficha-dialog').close());

// ───────────────────────────────────────────────────────────────── seguimientos

async function pintarSeguimientos() {
  const cliente = $('#seguimiento-cliente').value;
  const datos = await api(
    `/api/followups?limit=300${cliente ? `&customerId=${encodeURIComponent(cliente)}` : ''}`,
  );
  estado.seguimientos = datos.followups;
  const nombreDe = (id) => estado.clientes.find((c) => c.id === id)?.name ?? '—';

  const tabla = AMIGO_UI.tabla(['Cliente', 'Qué hay que hacer', 'Para el día', 'Estado', 'Acciones']);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (estado.seguimientos.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(5, 'No hay seguimientos'));
  } else {
    for (const f of estado.seguimientos) {
      cuerpo.append(
        AMIGO_UI.fila(
          [
            nombreDe(f.customerId),
            AMIGO_UI.celda(f.title, f.body ? document.createElement('br') : null, f.body || ''),
            fechaCorta(f.dueDate) || '—',
            AMIGO_UI.estadoDe(f.status, ETIQUETA_ESTADO),
            AMIGO_UI.celda(
              AMIGO_UI.boton('Editar', () => abrirSeguimiento(f)),
              AMIGO_UI.boton(f.status === 'done' ? 'Reabrir' : 'Marcar hecho', async () => {
                try {
                  // Solo se manda el estado: la fecha de completado la pone el
                  // servidor, porque "se terminó ahora" es un hecho, no algo que
                  // se escriba a mano.
                  await api(`/api/followups/${f.id}`, {
                    method: 'PATCH',
                    body: { status: f.status === 'done' ? 'pending' : 'done' },
                  });
                  await recargar();
                } catch (err) {
                  avisar(err.message, true);
                }
              }, 'ui-btn ui-btn--chico ui-btn--suave'),
            ),
          ],
          { className: 'acciones' },
        ),
      );
    }
  }

  $('#seguimientos-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

function abrirSeguimiento(seg) {
  $('#seguimiento-id').value = seg?.id ?? '';
  $('#seguimiento-form-titulo').textContent = seg ? 'Editar seguimiento' : 'Nuevo seguimiento';
  $('#seguimiento-cancelar').hidden = !seg;
  $('#seguimiento-cliente').value = seg?.customerId ?? $('#seguimiento-cliente').value ?? '';
  $('#seguimiento-titulo').value = seg?.title ?? '';
  $('#seguimiento-detalle').value = seg?.body ?? '';
  $('#seguimiento-fecha').value = seg?.dueDate ?? '';
  $('#seguimiento-estado').value = seg?.status ?? 'pending';
}

$('#seguimiento-cancelar').addEventListener('click', () => abrirSeguimiento(null));

$('#seguimiento-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#seguimiento-id').value;
  try {
    await api(id ? `/api/followups/${id}` : '/api/followups', {
      method: id ? 'PATCH' : 'POST',
      body: {
        customerId: $('#seguimiento-cliente').value,
        title: $('#seguimiento-titulo').value,
        body: $('#seguimiento-detalle').value || null,
        dueDate: $('#seguimiento-fecha').value || null,
        status: $('#seguimiento-estado').value,
      },
    });
    abrirSeguimiento(null);
    await recargar();
    avisar(id ? 'Seguimiento actualizado' : 'Seguimiento creado');
  } catch (err) {
    avisar(err.message, true);
  }
});

// ──────────────────────────────────────────────────────────────────── contactos

async function pintarContactos() {
  const datos = await api('/api/interactions?limit=300');
  estado.contactos = datos.interactions;
  const nombreDe = (id) => estado.clientes.find((c) => c.id === id)?.name ?? '—';

  const tabla = AMIGO_UI.tabla(['Cliente', 'Tipo', 'Qué pasó', 'Cuándo']);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (estado.contactos.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(4, 'No hay contactos registrados'));
  } else {
    for (const i of estado.contactos) {
      cuerpo.append(
        AMIGO_UI.fila([nombreDe(i.customerId), ETIQUETA_CONTACTO[i.kind] ?? i.kind, i.summary, instanteCorto(i.happenedAt)]),
      );
    }
  }

  $('#contactos-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

$('#contacto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    // No se manda `happenedAt`: un contacto se registra mientras pasa, y anotarlo
    // a mano solo abre la puerta a escribir el dia equivocado.
    await api('/api/interactions', {
      method: 'POST',
      body: {
        customerId: $('#contacto-cliente').value,
        kind: $('#contacto-tipo').value,
        summary: $('#contacto-resumen').value,
      },
    });
    $('#contacto-resumen').value = '';
    await recargar();
    avisar('Contacto registrado');
  } catch (err) {
    avisar(err.message, true);
  }
});

// ───────────────────────────────────────────────────────────────── navegación

/**
 * Las pestañas las lleva el shell compartido (`/amigo.js`): el canal marca la
 * activa, la URL guarda en cuál se está y el botón "atrás" del navegador
 * funciona. Acá solo se dice qué pintar cuando se entra a cada una.
 */
const PANELES = {
  tablero: pintarTablero,
  clientes: () => pintarClientes(),
  seguimientos: pintarSeguimientos,
  contactos: pintarContactos,
};

function alEntrar(panel) {
  if (PANELES[panel]) PANELES[panel]().catch((e) => avisar(e.message, true));
}

/** Vuelve a pedir todo y reagrupa. Se llama después de cada escritura. */
async function recargar() {
  await cargar();
  const activo = document.querySelector('[data-tab][aria-current="page"]')?.dataset.tab ?? 'tablero';
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
 */
function renderConfig() {
  const form = $('#config-form');
  const c = estado.cfg;
  for (const el of form.elements) {
    if (!el.name || c[el.name] === undefined) continue;
    el.value = c[el.name];
  }
}

$('#tablero-cliente').addEventListener('change', () => pintarTablero().catch((e) => avisar(e.message, true)));

$('#seguimiento-cliente').addEventListener('change', () => pintarSeguimientos().catch((e) => avisar(e.message, true)));

$('#nuevo-cliente').addEventListener('click', () => {
  abrirCliente(null);
  AMIGO.mostrar('clientes');
});

AMIGO.montar({
  nombre: 'Clientes',
  paneles: ['tablero', 'clientes', 'seguimientos', 'contactos', 'ajustes'],
  alEntrar,
});

cargar().then(pintarTablero).catch((e) => avisar(e.message, true));
