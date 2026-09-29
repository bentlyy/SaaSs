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
 *
 * La tabla, las etiquetas y los botones vienen de `AMIGO_UI`; lo de mas abajo
 * es de esta herramienta.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

const estado = {
  activos: [],
  cfg: { currency: '$', timezone: 'America/Santiago' },
  /** El activo que esta abierta en la ficha, para reescribirla al moverlo. */
  fichaId: null,
};

const ESTADOS = {
  active: { texto: 'En uso', tono: 'ok' },
  repair: { texto: 'En reparacion', tono: 'aviso' },
  retired: { texto: 'Dado de baja', tono: 'neutro' },
  lost: { texto: 'Perdido', tono: 'malo' },
};

const MOVIMIENTOS = {
  checkin: { texto: 'Volvio', tono: 'ok' },
  checkout: { texto: 'Salio', tono: 'acento' },
  maintenance: { texto: 'A reparacion', tono: 'aviso' },
  loss: { texto: 'Se perdio', tono: 'malo' },
};

/**
 * Centavos a texto legible, con el centavo SIEMPRE a la vista.
 *
 * Aqui no se usa `AMIGO_UI.dinero` a proposito: ese redondea al peso, que es lo
 * correcto en una venta, y aqui no. Un costo de $45,01 mostrado como $45 hace
 * pensar que el activo costo menos de lo que costo, y en un inventario la
 * diferencia entre el valor contable y el real se nota. La division por 100 es
 * la UNICA operacion de dinero de esta pantalla, porque el numero que llega de
 * la API ya esta en la unidad en que se guarda.
 */
const fmtMonto = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function monto(centavos) {
  return `${estado.cfg?.currency ?? '$'} ${fmtMonto.format(Math.trunc(Number(centavos ?? 0)) / 100)}`;
}

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

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const tablero = await api('/api/dashboard');
  const porStatus = tablero.porStatus;

  AMIGO_UI.kpis($('#resumen'), [
    [tablero.total, 'Activos en libros', true],
    [porStatus.active, 'En uso'],
    [porStatus.repair, 'En reparacion'],
    [porStatus.retired, 'Dados de baja'],
    [porStatus.lost, 'Perdidos'],
    [monto(tablero.valorEnUsoCents), 'Valor en uso'],
  ]);

  const caja = $('#recientes');
  if (tablero.recientes.length === 0) {
    AMIGO_UI.vacio(caja, 'Todavia no hay activos registrados');
    return;
  }
  caja.replaceChildren(
    ...tablero.recientes.map((a) => {
      const ficha = document.createElement('div');
      ficha.className = 'ui-ficha';
      const cuerpo = document.createElement('div');
      cuerpo.className = 'ui-ficha__cuerpo';
      const titulo = document.createElement('span');
      titulo.className = 'ui-ficha__titulo';
      titulo.textContent = `${a.code} · ${a.name}`;
      const nota = document.createElement('span');
      nota.className = 'ui-ficha__nota';
      // Los datos que vienen, se muestran; los que no, no se inventan.
      nota.textContent = [ESTADOS[a.status]?.texto ?? a.status, a.assignedTo, a.location, monto(a.costCents)]
        .filter(Boolean)
        .join(' · ');
      cuerpo.append(titulo, nota);
      const acciones = document.createElement('div');
      acciones.className = 'ui-ficha__acciones';
      acciones.append(AMIGO_UI.boton('Ficha', () => abrirFicha(a.id).catch((e) => avisar(e.message, true))));
      ficha.append(cuerpo, acciones);
      return ficha;
    }),
  );
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

  const tabla = AMIGO_UI.tabla(
    ['Codigo', 'Nombre', 'Categoria', 'Estado', 'Lo tiene', 'Ubicacion', 'Costo', ''],
    { num: [6] },
  );
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (lista.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(8, 'No hay activos que coincidan'));
  } else {
    for (const a of lista) {
      // El numero de serie va debajo del nombre y no en su propia columna: es un
      // dato de la etiqueta del bien, y darle una columna propia obligaba a
      // empujar la de acciones fuera de la pantalla en pantallas normales.
      const nombre = document.createElement('div');
      const fuerte = document.createElement('div');
      fuerte.className = 'ui-ficha__titulo';
      fuerte.textContent = a.name;
      nombre.append(fuerte);
      if (a.serial) {
        const serie = document.createElement('div');
        serie.className = 'ui-ficha__nota';
        serie.textContent = a.serial;
        nombre.append(serie);
      }

      cuerpo.append(
        AMIGO_UI.fila(
          [
            a.code,
            nombre,
            a.category,
            AMIGO_UI.estadoDe(a.status, ESTADOS),
            a.assignedTo ?? '—',
            a.location ?? '—',
            monto(a.costCents),
            AMIGO_UI.celda(
              AMIGO_UI.boton('Ficha', () => abrirFicha(a.id).catch((e) => avisar(e.message, true))),
              AMIGO_UI.boton('Editar', () => abrirActivo(a)),
              AMIGO_UI.boton(
                'Archivar',
                async () => {
                  // Archivar y borrar son cosas distintas: archivar saca el bien de
                  // la lista sin tocar su historial, y es lo que la API ofrece
                  // cuando el borrado responde 409.
                  try {
                    await api(`/api/assets/${a.id}`, { method: 'PATCH', body: { archived: true } });
                    await recargar();
                    avisar('Activo archivado');
                  } catch (e) {
                    avisar(e.message, true);
                  }
                },
                'ui-btn ui-btn--chico ui-btn--fantasma',
              ),
              AMIGO_UI.boton(
                'Borrar',
                async () => {
                  try {
                    await api(`/api/assets/${a.id}`, { method: 'DELETE' });
                    await recargar();
                    avisar('Activo borrado');
                  } catch (e) {
                    // El 409 de borrar un activo con historial llega con el texto
                    // que explica que lo que corresponde es archivar, asi que se
                    // muestra tal cual: es la instruccion, no un error de programa.
                    avisar(e.message, true);
                  }
                },
                'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
              ),
            ),
          ],
          { num: [6], className: 'acciones' },
        ),
      );
    }
  }

  $('#activos-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

function abrirActivo(activo) {
  $('#activo-id').value = activo?.id ?? '';
  $('#activo-form-titulo').textContent = activo ? 'Editar activo' : 'Nuevo activo';
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
  if (!$('#activo-dialog').open) $('#activo-dialog').showModal();
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

$('#activo-cancelar').addEventListener('click', () => $('#activo-dialog').close());
$('#activo-cerrar').addEventListener('click', () => $('#activo-dialog').close());
$('#activo-nuevo').addEventListener('click', () => abrirActivo(null));

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
    $('#activo-dialog').close();
    await recargar();
    avisar(id ? 'Activo actualizado' : 'Activo creado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#activo-buscar').addEventListener('input', pintarActivos);
$('#activo-filtro').addEventListener('change', pintarActivos);

// ──────────────────────────────────────────────────────────────────────── ficha

/** Un par etiqueta/valor. La ficha es una lista de datos, no filas que comparar. */
function dato(termino, valor) {
  const dt = document.createElement('dt');
  dt.textContent = termino;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  return [dt, dd];
}

async function abrirFicha(idActivo) {
  const ficha = await api(`/api/assets/${idActivo}/ficha`);
  estado.fichaId = idActivo;
  const a = ficha.asset;
  const caja = $('#ficha');
  caja.replaceChildren();

  const titulo = document.createElement('h2');
  titulo.textContent = `${a.code} · ${a.name}`;

  const linea = document.createElement('div');
  linea.className = 'ui-fila';
  linea.append(
    AMIGO_UI.estadoDe(a.status, ESTADOS),
    AMIGO_UI.etiqueta(a.category, 'neutro'),
  );
  if (a.assignedTo) linea.append(AMIGO_UI.etiqueta(`Lo tiene ${a.assignedTo}`, 'neutro'));
  if (a.archivedAt) linea.append(AMIGO_UI.etiqueta('Archivado', 'neutro'));

  // Los pares se arman con una lista y no con innerHTML: la ficha muestra
  // nombre de marca, serie y notas, que son texto que eligio el cliente.
  const datos = document.createElement('dl');
  datos.className = 'ui-datos';
  datos.append(
    ...dato('Marca', a.brand ?? 'Sin marca'),
    ...dato('Modelo', a.model ?? 'Sin modelo'),
    ...dato('Serie', a.serial ?? 'Sin serie'),
    ...dato('Ubicacion', a.location ?? 'Sin ubicacion'),
  );
  if (a.purchaseDate) datos.append(...dato('Comprado', fechaCorta(a.purchaseDate)));
  datos.append(...dato('Costo', monto(a.costCents)));
  if (a.notes) datos.append(...dato('Notas', a.notes));

  const hist = document.createElement('h3');
  hist.className = 'ui-tarjeta__cab';
  hist.textContent = 'Historial';
  const lista = document.createElement('div');
  lista.className = 'ui-lista';

  if (ficha.movements.length === 0) {
    AMIGO_UI.vacio(lista, 'Sin movimientos registrados');
  } else {
    for (const m of ficha.movements) {
      const fila = document.createElement('div');
      fila.className = 'ui-ficha';
      const cuerpo = document.createElement('div');
      cuerpo.className = 'ui-ficha__cuerpo';
      const tit = document.createElement('span');
      tit.className = 'ui-ficha__titulo';
      tit.textContent = MOVIMIENTOS[m.kind]?.texto ?? m.kind;
      cuerpo.append(tit);
      if (m.note) {
        const nota = document.createElement('span');
        nota.className = 'ui-ficha__nota';
        nota.textContent = m.note;
        cuerpo.append(nota);
      }
      const cuando = document.createElement('div');
      cuando.className = 'ui-ficha__acciones';
      cuando.append(AMIGO_UI.etiqueta(instanteCorto(m.happenedAt), 'neutro'));
      fila.append(cuerpo, cuando);
      lista.append(fila);
    }
  }

  const resumen = document.createElement('p');
  resumen.className = 'ui-pista';
  resumen.textContent = `${ficha.resumen.totalMovimientos} movimiento(s) en el historial`;

  caja.append(titulo, linea, datos, hist, lista, resumen);
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

$('#config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cuerpo = {};
  for (const el of e.target.elements) {
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

// ─────────────────────────────────────────────────────────────────── navegación

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

/**
 * Pinta la sección que está a la vista.
 *
 * Se pregunta al shell y no a este archivo, porque la sección activa vive en la
 * URL y la elige el shell. Así, guardar y volver a pintar no manda a nadie de
 * vuelta al tablero: quien está revisando activos se queda en activos.
 */
function repintar() {
  const activo = document.querySelector('[data-tab][aria-current="page"]')?.dataset.tab ?? 'tablero';
  if (activo === 'activos') return pintarActivos();
  if (activo === 'tablero') return pintarTablero();
  return undefined;
}

/** Vuelve a pedir todo y vuelve a pintar lo que se está viendo. */
async function recargar() {
  await cargar();
  await repintar();
}

AMIGO.montar({ nombre: 'Activos', paneles: ['tablero', 'activos', 'ajustes'], alEntrar: conAviso(repintar) });

/** Corre una parte de la pantalla y avisa si falla, en vez de dejarla a medias. */
async function conAviso(fn) {
  try {
    await fn();
  } catch (e) {
    avisar(e.message, true);
  }
}

cargar().then(repintar).catch((e) => avisar(e.message, true));
