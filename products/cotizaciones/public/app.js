/**
 * Interfaz de cotizaciones.
 *
 * Tres reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La pagina se sirve vacia y todo
 *      entra por la API, que es la que filtra por organizacion. Si el HTML
 *      trajera datos, el servidor tendria que confiar en que el navegador no los
 *      altere.
 *
 *   2. La pantalla NO resuelve el folio ni el total. No sabe si esta cotizacion
 *      es la numero 8 o la 9: eso lo dice el servidor, que es el unico que ve
 *      las cotizaciones de las otras organizaciones. El total que se muestra aca
 *      es una aproximacion para leerlo antes de guardar, y el que queda escrito
 *      es el que calcula la API.
 *
 *   3. La pantalla NO cambia el estado. El estado se mueve por
 *      `POST /api/quotes/:id/estado`, que es la unica puerta que ademas sella
 *      cuando se mando y cuando se acepto. Si el formulario mandara el estado en
 *      el PATCH, se podria aceptar una cotizacion sin dejar rastro.
 *
 * La forma de la tabla, las etiquetas y los botones viene de `AMIGO_UI`; lo de
 * mas abajo es de esta herramienta.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

/** Los estados del negocio, con su tono. Que el color ayude a barrer la tabla. */
const ESTADOS = {
  draft: { texto: 'Borrador', tono: 'neutro' },
  sent: { texto: 'Enviada', tono: 'acento' },
  accepted: { texto: 'Aceptada', tono: 'ok' },
  rejected: { texto: 'Rechazada', tono: 'malo' },
  expired: { texto: 'Vencida', tono: 'neutro' },
};

/** A donde se puede ir desde cada estado. Es la misma tabla que valida el servidor. */
const TRANSICIONES = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: [],
  expired: ['sent'],
};

const estado = {
  cotizaciones: [],
  cfg: { currency: '$', defaultTaxRateBp: 0, validityDays: 30, nextNumber: 1 },
  /** Las lineas de la cotizacion que se esta editando, antes de guardarla. */
  borrador: [],
  editando: null,
};

/** La moneda la elige la organizacion: el total se muestra en la suya, no en la del programador. */
const dinero = (centavos) => AMIGO_UI.dinero(centavos, { simbolo: estado.cfg.currency });

/** La fecha de hoy en `AAAA-MM-DD`, que es como el servidor la espera. */
function hoy() {
  return new Date().toLocaleDateString('en-CA');
}

/** Hoy mas N dias, para proponer la vigencia de la oferta. */
function dentroDe(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString('en-CA');
}

// ─────────────────────────────────────────────────────────────── carga de datos

async function cargar() {
  const [lista, cfg] = await Promise.all([api('/api/quotes?limit=500'), api('/api/settings')]);
  estado.cotizaciones = lista.items;
  // Lo que se guarda es el objeto de ajustes SIN envolver. Leer un `settings`
  // adentro de `cfg` seria leer `undefined` y reventar al pintar.
  estado.cfg = cfg.settings;
  renderConfig();
  pintarFiltroEstado();
  await repintar();
}

/** Vuelve a pedir todo y vuelve a pintar lo que se está viendo. */
async function recargar() {
  await cargar();
}

/**
 * Pinta la sección que está a la vista.
 *
 * Se pregunta al shell y no a este archivo, porque la sección activa vive en la
 * URL y la elige el shell. Así, guardar y volver a pintar no manda a nadie de
 * vuelta al inicio: quien está revisando cotizaciones se queda en
 * cotizaciones.
 */
function repintar() {
  const activo = document.querySelector('[data-tab][aria-current="page"]')?.dataset.tab ?? 'inicio';
  return pintar(activo);
}

// ─────────────────────────────────────────────────────────────────────── inicio

async function pintarInicio() {
  const d = await api('/api/dashboard');
  AMIGO_UI.kpis($('#resumen'), [
    [d.total, 'Cotizaciones'],
    [d.porEstado.sent, 'Enviadas'],
    [d.porEstado.accepted, 'Aceptadas'],
    [d.mesCents, `Del mes (${d.mes})`, true],
    [d.totalCents, 'En la mesa'],
  ]);

  // "Pendientes de respuesta" son las enviadas y las borradores: lo que todavia
  // no tiene veredicto del cliente. Las aceptadas y las rechazadas ya lo tienen.
  const abiertas = estado.cotizaciones.filter((c) => c.status === 'sent' || c.status === 'draft');
  const caja = $('#abiertas');

  if (abiertas.length === 0) {
    AMIGO_UI.vacio(caja, 'No hay cotizaciones esperando respuesta.');
    return;
  }

  caja.replaceChildren(
    ...abiertas.map((c) => {
      const ficha = document.createElement('div');
      ficha.className = 'ui-ficha';
      const cuerpo = document.createElement('div');
      cuerpo.className = 'ui-ficha__cuerpo';
      const titulo = document.createElement('span');
      titulo.className = 'ui-ficha__titulo';
      titulo.textContent = `#${c.number} · ${c.customerName}`;
      const detalle = document.createElement('span');
      detalle.className = 'ui-ficha__nota';
      detalle.textContent = c.title ?? 'Sin titulo';
      cuerpo.append(titulo, detalle);
      const acciones = document.createElement('div');
      acciones.className = 'ui-ficha__acciones';
      acciones.append(
        AMIGO_UI.boton('Ver', () => abrirCotizacion(c.id).catch((e) => avisar(e.message, true))),
        AMIGO_UI.boton(dinero(c.totalCents), () => abrirCotizacion(c.id), 'ui-etiqueta ui-etiqueta--acento'),
      );
      ficha.append(cuerpo, acciones);
      return ficha;
    }),
  );
}

// ─────────────────────────────────────────────────────────────── cotizaciones

function pintarCotizaciones() {
  const filtro = $('#filtro-estado').value;
  const busqueda = $('#buscar').value.trim().toLowerCase();
  const lista = estado.cotizaciones.filter((c) => {
    if (filtro && c.status !== filtro) return false;
    if (!busqueda) return true;
    return [String(c.number), c.customerName ?? '', c.title ?? '']
      .join(' ')
      .toLowerCase()
      .includes(busqueda);
  });

  const tabla = AMIGO_UI.tabla(['Folio', 'Cliente', 'Emision', 'Estado', 'Total', ''], { num: [4] });
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (lista.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(6, 'Todavia no hay cotizaciones.'));
  } else {
    for (const c of lista) {
      cuerpo.append(
        AMIGO_UI.fila(
          [
            `#${c.number}`,
            c.customerName,
            c.issueDate ?? '—',
            AMIGO_UI.estadoDe(c.status, ESTADOS),
            dinero(c.totalCents),
            AMIGO_UI.celda(
              AMIGO_UI.boton('Ver', () => abrirCotizacion(c.id).catch((e) => avisar(e.message, true))),
              AMIGO_UI.boton(
                'Borrar',
                async () => {
                  if (!confirm('Borrar la cotizacion y sus lineas?')) return;
                  try {
                    await api(`/api/quotes/${c.id}`, { method: 'DELETE' });
                    avisar('Cotizacion borrada');
                    await recargar();
                  } catch (e) {
                    avisar(e.message, true);
                  }
                },
                'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
              ),
            ),
          ],
          { num: [4], className: 'acciones' },
        ),
      );
    }
  }

  $('#cotizaciones-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

// ────────────────────────────────────────────────────────── dialogo cotizacion

function pintarLineas() {
  const caja = $('#cot-lineas');
  if (estado.borrador.length === 0) {
    AMIGO_UI.vacio(caja, 'Sin lineas.');
  } else {
    caja.replaceChildren(
      ...estado.borrador.map((l, i) => {
        const ficha = document.createElement('div');
        ficha.className = 'ui-ficha';
        const cuerpo = document.createElement('div');
        cuerpo.className = 'ui-ficha__cuerpo';
        const desc = document.createElement('span');
        desc.className = 'ui-ficha__titulo';
        desc.textContent = l.description;
        const nota = document.createElement('span');
        nota.className = 'ui-ficha__nota';
        nota.textContent = `${l.qty} × ${dinero(l.unitPriceCents)}`;
        cuerpo.append(desc, nota);
        const acciones = document.createElement('div');
        acciones.className = 'ui-ficha__acciones';
        acciones.append(
          AMIGO_UI.boton(dinero(l.lineTotalCents ?? 0), null, 'ui-etiqueta'),
          AMIGO_UI.boton(
            'Quitar',
            () => {
              estado.borrador.splice(i, 1);
              pintarLineas();
            },
            'ui-btn ui-btn--chico ui-btn--fantasma',
          ),
        );
        ficha.append(cuerpo, acciones);
        return ficha;
      }),
    );
  }

  // Solo una estimacion para leerla antes de guardar. El que queda escrito es el
  // que calcula el servidor.
  const subtotal = estado.borrador.reduce((acc, l) => acc + (l.lineTotalCents ?? 0), 0);
  const bp = Number($('#cot-impuesto').value) || 0;
  $('#cot-total').textContent = dinero(subtotal + Math.round((subtotal * bp) / 10_000));
}

/** Los botones de estado: solo los destinos que la tabla de transiciones permite. */
function pintarEstados(actual) {
  const destinos = TRANSICIONES[actual] ?? [];
  const caja = $('#cot-estados');
  if (destinos.length === 0) {
    AMIGO_UI.vacio(caja, `Una cotizacion ${ESTADOS[actual]?.texto ?? actual} ya no cambia de estado.`);
    return;
  }
  caja.replaceChildren(
    ...destinos.map((destino) =>
      AMIGO_UI.boton(
        `Pasar a ${ESTADOS[destino]?.texto ?? destino}`,
        async () => {
          try {
            await api(`/api/quotes/${estado.editando}/estado`, { method: 'POST', body: { status: destino } });
            avisar('Estado actualizado');
            await recargar();
            if (estado.editando) await abrirCotizacion(estado.editando);
          } catch (e) {
            avisar(e.message, true);
          }
        },
        'ui-btn ui-btn--chico',
      ),
    ),
  );
}

async function abrirCotizacion(id) {
  const c = estado.cotizaciones.find((x) => x.id === id);
  if (!c) return avisar('La cotizacion no esta en la lista', true);

  const { lines } = await api(`/api/quotes/${id}/lineas`);
  estado.editando = id;
  estado.borrador = lines.map((l) => ({
    description: l.description,
    qty: l.qty,
    unitPriceCents: l.unitPriceCents,
    lineTotalCents: l.lineTotalCents,
  }));

  $('#cotizacion-form-titulo').textContent = `Cotizacion #${c.number}`;
  $('#cotizacion-id').value = c.id;
  $('#cot-folio').value = c.number;
  $('#cot-cliente').value = c.customerName ?? '';
  $('#cot-cliente-id').value = c.customerId ?? '';
  $('#cot-correo').value = c.customerEmail ?? '';
  $('#cot-titulo').value = c.title ?? '';
  $('#cot-emision').value = c.issueDate ?? hoy();
  $('#cot-vigencia').value = c.validUntil ?? '';
  $('#cot-impuesto').value = c.taxRateBp ?? 0;
  $('#cot-notas').value = c.notes ?? '';

  pintarLineas();
  pintarEstados(c.status);
  $('#cotizacion-dialog').showModal();
}

function abrirNueva() {
  estado.editando = null;
  estado.borrador = [];
  $('#cotizacion-form-titulo').textContent = 'Nueva cotizacion';
  $('#cotizacion-id').value = '';
  // El folio es una PROPUESTA del servidor, no una reserva: si dos personas abren
  // el formulario a la vez, la segunda que guarde recibe un 409 y recarga.
  $('#cot-folio').value = estado.cfg.nextNumber;
  $('#cot-cliente').value = '';
  $('#cot-cliente-id').value = '';
  $('#cot-correo').value = '';
  $('#cot-titulo').value = '';
  $('#cot-emision').value = hoy();
  $('#cot-vigencia').value = dentroDe(estado.cfg.validityDays);
  $('#cot-impuesto').value = estado.cfg.defaultTaxRateBp;
  $('#cot-notas').value = '';
  pintarLineas();
  pintarEstados('draft');
  $('#cotizacion-dialog').showModal();
}

// ─────────────────────────────────────────────────────────────────────── eventos

$('#linea-agregar').addEventListener('click', () => {
  const description = $('#linea-descripcion').value.trim();
  if (!description) return avisar('La linea necesita una descripcion', true);
  const qty = Number($('#linea-cantidad').value) || 1;
  const unitPriceCents = Number($('#linea-precio').value) || 0;
  estado.borrador.push({ description, qty, unitPriceCents, lineTotalCents: Math.round(qty * unitPriceCents) });
  $('#linea-descripcion').value = '';
  $('#linea-cantidad').value = '1';
  $('#linea-precio').value = '0';
  pintarLineas();
});

$('#cot-impuesto').addEventListener('input', pintarLineas);

$('#cotizacion-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  // El estado NO va en el cuerpo: se cambia por su propia ruta, que ademas sella
  // la fecha. Mandarlo por aca seria una segunda puerta sin sello.
  const cuerpo = {
    number: Number($('#cot-folio').value) || null,
    customerName: $('#cot-cliente').value.trim(),
    customerId: $('#cot-cliente-id').value.trim() || null,
    customerEmail: $('#cot-correo').value.trim() || null,
    title: $('#cot-titulo').value.trim() || null,
    issueDate: $('#cot-emision').value || null,
    validUntil: $('#cot-vigencia').value || null,
    taxRateBp: Number($('#cot-impuesto').value) || 0,
    notes: $('#cot-notas').value.trim() || null,
    lines: estado.borrador.map(({ description, qty, unitPriceCents }) => ({ description, qty, unitPriceCents })),
  };
  try {
    if (estado.editando) {
      await api(`/api/quotes/${estado.editando}`, { method: 'PATCH', body: cuerpo });
      avisar('Cotizacion actualizada');
    } else {
      await api('/api/quotes', { method: 'POST', body: cuerpo });
      avisar('Cotizacion creada');
    }
    $('#cotizacion-dialog').close();
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#cotizacion-cancelar').addEventListener('click', () => $('#cotizacion-dialog').close());
$('#cotizacion-cerrar').addEventListener('click', () => $('#cotizacion-dialog').close());
$('#cotizacion-nueva').addEventListener('click', abrirNueva);
$('#buscar').addEventListener('input', pintarCotizaciones);
$('#filtro-estado').addEventListener('change', pintarCotizaciones);

$('#config-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = $('#config-form');
  try {
    await api('/api/settings', {
      method: 'PUT',
      body: {
        currency: form.elements.currency.value.trim() || '$',
        timezone: form.elements.timezone.value.trim(),
        defaultTaxRateBp: Number(form.elements.defaultTaxRateBp.value) || 0,
        validityDays: Number(form.elements.validityDays.value) || 30,
      },
    });
    avisar('Ajustes guardados');
    await recargar();
  } catch (e) {
    avisar(e.message, true);
  }
});

// ───────────────────────────────────────────────────────────────── navegación

/** Cada pestaña dice qué pintar. El shell decide cuál está activa. */
function pintar(panel) {
  if (panel === 'ajustes') return;
  if (panel === 'cotizaciones') return pintarCotizaciones();
  return pintarInicio();
}

/** El filtro de estado se arma UNA vez: si se rearmara en cada `cargar()`,
 *  guardar unos ajustes borraria el estado que el usuario estaba filtrando. */
let filtroArmado = false;
function pintarFiltroEstado() {
  if (filtroArmado) return;
  filtroArmado = true;
  $('#filtro-estado').replaceChildren(
    new Option('Todos los estados', ''),
    ...Object.keys(ESTADOS).map((e) => new Option(ESTADOS[e].texto, e)),
  );
}

AMIGO.montar({ nombre: 'Cotizaciones', paneles: ['inicio', 'cotizaciones', 'ajustes'], alEntrar: conAviso(pintar) });

/** Corre una parte de la pantalla y avisa si falla, en vez de dejar la vista a medias. */
async function conAviso(fn) {
  try {
    await fn();
  } catch (e) {
    avisar(e.message, true);
  }
}

cargar().catch((e) => avisar(e.message, true));

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
  // El folio siguiente no es un input: es el unico dato de los ajustes que NO se
  // puede escribir, y por eso vive aparte del form.
  $('#cfg-folio').textContent = String(c.nextNumber ?? 1);
}
