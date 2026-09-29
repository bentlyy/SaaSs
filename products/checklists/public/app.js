/**
 * Interfaz de checklists e inspecciones.
 *
 * Reglas que no son de estilo sino de arquitectura:
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
 *      mostrarlos: la corrida ya lleva su copia (tipo, opciones y seccion
 *      incluidos), y una plantilla cambiada despues no puede alterar lo que se
 *      responde.
 *
 *   4. Los numeros los muestra el servidor (secciones y puntos 1..N sin huecos)
 *      y la pantalla no los recalcula. Si los recalculara, el "3" que ve la
 *      persona y el que se manda al responder serian dos numeros distintos en
 *      cuanto alguien borre un punto en otra pestania.
 *
 *   5. Cada punto se responde SEGUN SU TIPO: Si/No con tres botones, y texto,
 *      numero o seleccion con su campo y su boton Guardar. El select solo puede
 *      elegir de las opciones del snapshot de la corrida, que son las de ese dia.
 *
 *   6. Un punto respondido es un hecho. De una corrida no se quita nada: editar
 *      la plantilla cambia lo que vendra, no lo que ya paso.
 *
 * Lo unico que este producto pone de su cuenta son las dos listas de puntos
 * (`ck-` en su `style.css`). Las tablas, etiquetas, tarjetas y botones vienen de
 * `AMIGO_UI`, igual que en los otros ocho.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

const RESPUESTAS = ['ok', 'fail', 'na'];

const RUNS = {
  in_progress: { texto: 'En curso', tono: 'acento' },
  done: { texto: 'Completada', tono: 'ok' },
  canceled: { texto: 'Cancelada', tono: 'neutro' },
};

const RESULTADO = {
  ok: { texto: 'Cumple', tono: 'ok' },
  fail: { texto: 'No cumple', tono: 'malo' },
  na: { texto: 'No aplica', tono: 'aviso' },
};

const TIPOS = {
  yes_no: 'Si / No',
  text: 'Texto',
  number: 'Numero',
  select: 'Seleccion',
};

const VEREDICTO = {
  approved: 'Aprobado',
  observed: 'Observado',
  rejected: 'Rechazado',
};

const estado = {
  plantillas: [],
  /** La estructura de la plantilla abierta en el editor (`/estructura`). */
  estructura: { template: null, sections: [] },
  /** La plantilla abierta en el editor de puntos, para saber a donde mandar. */
  plantillaId: null,
  corridas: [],
  cfg: { currency: '$', timezone: 'America/Santiago' },
  /** La corrida abierta en la ficha, para reescribirla al responder un punto. */
  corridaId: null,
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

/** Las opciones de un select escritas en un textarea (una por linea). */
function opcionesDesdeTexto(texto) {
  return String(texto ?? '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);
}

const instanteCorto = (iso) => (iso ? new Date(iso).toLocaleString('es-CL') : '');

function tamanoCorto(bytes) {
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${bytes} B`;
}

/** `null` es "todavia no hay nada que medir": se muestra como un guion. */
function porcentaje(valor) {
  return valor === null || valor === undefined ? '—' : `${valor}%`;
}

/** Una etiqueta que no depende de un mapa: para metadatos, no para estados. */
const nota = (texto) => AMIGO_UI.etiqueta(texto, 'neutro');

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

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const tablero = await api('/api/dashboard');

  AMIGO_UI.kpis($('#resumen'), [
    [tablero.total, 'Corridas', true],
    [tablero.porStatus.in_progress, 'En curso'],
    [tablero.porStatus.done, 'Completadas'],
    [tablero.porStatus.canceled, 'Canceladas'],
    [tablero.porResultado.approved, 'Aprobadas'],
    [tablero.porResultado.observed, 'Observadas'],
    [tablero.porResultado.rejected, 'Rechazadas'],
    [tablero.porResultado.sin, 'Sin veredicto'],
    [porcentaje(tablero.cumplimientoPromedioPct), 'Cumplimiento promedio'],
  ]);

  // El tablero arma la lista de fallas con el nombre de la corrida pegado a cada
  // punto. El servidor se lo manda junto: el punto sin saber de donde salio obliga
  // a abrir diez fichas para encontrarlo.
  const caja = $('#fallos');
  if (tablero.fallos.length === 0) {
    AMIGO_UI.vacio(caja, 'No hay puntos fallados en las ultimas corridas');
    return;
  }
  caja.replaceChildren(
    ...tablero.fallos.map((f) => {
      const ficha = document.createElement('div');
      ficha.className = 'ui-ficha';
      const cuerpo = document.createElement('div');
      cuerpo.className = 'ui-ficha__cuerpo';
      const titulo = document.createElement('span');
      titulo.className = 'ui-ficha__titulo';
      titulo.textContent = `${f.position}. ${f.label}`;
      cuerpo.append(titulo);
      if (f.note) {
        const extra = document.createElement('span');
        extra.className = 'ui-ficha__nota';
        extra.textContent = f.note;
        cuerpo.append(extra);
      }
      const acciones = document.createElement('div');
      acciones.className = 'ui-ficha__acciones';
      acciones.append(nota([f.templateName, f.location, instanteCorto(f.startedAt)].filter(Boolean).join(' · ')));
      ficha.append(cuerpo, acciones);
      return ficha;
    }),
  );
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

  const tabla = AMIGO_UI.tabla(['Nombre', 'Descripcion', 'Estado', '']);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (lista.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(4, 'No hay plantillas que coincidan'));
  } else {
    for (const t of lista) {
      cuerpo.append(
        AMIGO_UI.fila(
          [
            t.name,
            t.description ?? '—',
            t.active ? nota('Activa') : nota('Inactiva'),
            AMIGO_UI.celda(
              AMIGO_UI.boton('Puntos', () => abrirEditor(t.id)),
              AMIGO_UI.boton('Editar', () => abrirPlantilla(t)),
              AMIGO_UI.boton(
                t.active ? 'Desactivar' : 'Activar',
                async () => {
                  try {
                    await api(`/api/templates/${t.id}`, { method: 'PATCH', body: { active: !t.active } });
                    await recargar();
                    avisar(t.active ? 'Plantilla desactivada' : 'Plantilla activada');
                  } catch (e) {
                    avisar(e.message, true);
                  }
                },
              ),
              AMIGO_UI.boton(
                'Duplicar',
                async () => {
                  try {
                    await api(`/api/templates/${t.id}/duplicar`, { method: 'POST', body: {} });
                    await recargar();
                    avisar('Plantilla duplicada');
                  } catch (e) {
                    avisar(e.message, true);
                  }
                },
              ),
              AMIGO_UI.boton(
                'Borrar',
                async () => {
                  if (!confirm('Borrar la plantilla y sus puntos?')) return;
                  try {
                    await api(`/api/templates/${t.id}`, { method: 'DELETE' });
                    if (estado.plantillaId === t.id) estado.plantillaId = null;
                    await recargar();
                    avisar('Plantilla borrada');
                  } catch (e) {
                    avisar(e.message, true);
                  }
                },
                'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
              ),
            ),
          ],
          { className: 'acciones' },
        ),
      );
    }
  }

  $('#plantillas-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

/** Los dos selectores de plantillas (empezar corrida y filtrar corridas). */
function pintarSelectores() {
  // Solo las activas alcanzan al selector de "empezar corrida": una plantilla
  // desactivada existe, pero elegirla a proposito se hace con el filtro de la
  // lista, no por accidente desde el formulario.
  const activas = estado.plantillas.filter((t) => t.active);

  $('#corrida-plantilla').replaceChildren(
    new Option('Corrida libre (sin plantilla)', ''),
    ...activas.map((t) => new Option(t.name, t.id)),
  );

  // El filtro se rearma pero se le devuelve lo que habia: recargar la pantalla
  // despues de guardar algo no puede cambiar el filtro que alguien eligio.
  const elegido = $('#corrida-plantilla-filtro').value;
  $('#corrida-plantilla-filtro').replaceChildren(
    new Option('Todas', ''),
    ...estado.plantillas.map((t) => new Option(t.name, t.id)),
  );
  $('#corrida-plantilla-filtro').value = elegido;
}

function abrirPlantilla(plantilla) {
  $('#plantilla-id').value = plantilla?.id ?? '';
  $('#plantilla-titulo').textContent = plantilla ? 'Editar plantilla' : 'Nueva plantilla';
  $('#plantilla-cancelar').hidden = !plantilla;
  $('#plantilla-nombre').value = plantilla?.name ?? '';
  $('#plantilla-descripcion').value = plantilla?.description ?? '';
  // Al editar NO se tocan los puntos que ya estan: se editan en el editor, por
  // seccion y uno por uno, con sus propios endpoints. Volver a mandar el textarea
  // sobreescribiria la lista de la plantilla con lo que la pantalla recuerda, y
  // en cuanto alguien abriera la misma plantilla en otra pestania se perderian
  // los puntos que agrego.
  $('#plantilla-items').value = '';
  $('#plantilla-items').disabled = Boolean(plantilla);
  if (!$('#plantilla-dialog').open) $('#plantilla-dialog').showModal();
}

$('#plantilla-cancelar').addEventListener('click', () => $('#plantilla-dialog').close());
$('#plantilla-cerrar').addEventListener('click', () => $('#plantilla-dialog').close());
$('#plantilla-nueva').addEventListener('click', () => abrirPlantilla(null));
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
      // los escribe en la misma transaccion, en la seccion "General", y asi no
      // queda una plantilla a la que le falte la mitad de la lista.
      const items = puntosDesdeTexto($('#plantilla-items').value);
      await api('/api/templates', { method: 'POST', body: { ...cuerpo, items } });
    }
    $('#plantilla-dialog').close();
    await recargar();
    avisar(id ? 'Plantilla actualizada' : 'Plantilla creada');
  } catch (err) {
    avisar(err.message, true);
  }
});

// ────────────────────────────────────────────────────────────────────── editor

/** Abre el editor de puntos de una plantilla. */
async function abrirEditor(plantillaId) {
  estado.plantillaId = plantillaId;
  await abrirPuntos(plantillaId);
  $('#plantilla-editor').hidden = false;
  $('#plantilla-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function abrirPuntos(plantillaId) {
  const datos = await api(`/api/templates/${plantillaId}/estructura`);
  estado.estructura = datos;
  estado.plantillaId = plantillaId;
  $('#plantilla-seleccionada').textContent =
    estado.plantillas.find((t) => t.id === plantillaId)?.name ?? datos.template.name ?? '';
  pintarEditor();
}

/** Un punto dentro del editor: su numero, su texto, su tipo y sus botones. */
function pintarItem(p) {
  const fila = document.createElement('div');
  fila.className = 'ck-item';
  const texto = document.createElement('div');
  texto.className = 'ck-item__texto';
  const fuerte = document.createElement('strong');
  fuerte.textContent = `${p.position}. ${p.label}`;
  const meta = document.createElement('div');
  meta.className = 'ck-item__meta';
  meta.textContent = `${TIPOS[p.type] ?? p.type} · ${p.required ? 'obligatorio' : 'opcional'}`;
  texto.append(fuerte, meta);
  const acciones = document.createElement('div');
  acciones.className = 'ck-item__acciones';
  acciones.append(
    AMIGO_UI.boton('Editar', () => abrirEditarPunto(p.id)),
    AMIGO_UI.boton(
      'Quitar',
      () => quitarPunto(p.id),
      'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
    ),
  );
  fila.append(texto, acciones);
  return fila;
}

function abrirEditarPunto(itemId) {
  const punto = estado.estructura.sections.flatMap((s) => s.items).find((p) => p.id === itemId);
  if (!punto) return;
  $('#punto-editar-id').value = punto.id;
  $('#punto-editar-label').value = punto.label;
  $('#punto-editar-tipo').value = punto.type;
  $('#punto-editar-required').checked = Boolean(punto.required);
  $('#punto-editar-opciones').value = (punto.options ?? []).join('\n');
  $('#punto-editar-opciones-caja').hidden = punto.type !== 'select';
  $('#punto-editar-form').hidden = false;
  $('#punto-editar-label').focus();
}

/**
 * Pinta el editor completo: la lista de secciones con sus puntos y el selector de
 * seccion del form de agregar.
 *
 * Los `position` que se muestran son los de la API: las secciones ya vienen
 * 1..N y los puntos de cada seccion 1..N, renumerados por el servidor.
 */
function pintarEditor() {
  const { sections } = estado.estructura;

  // El selector de seccion del form de agregar un punto.
  const elegida = $('#punto-seccion').value;
  $('#punto-seccion').replaceChildren(
    ...sections.map((s, i) => new Option(`${i + 1}. ${s.name}`, s.id)),
  );
  $('#punto-seccion').value = sections.some((s) => s.id === elegida) ? elegida : sections[0]?.id ?? '';

  const caja = $('#plantilla-secciones-lista');
  if (sections.length === 0) {
    AMIGO_UI.vacio(
      caja,
      'Esta plantilla no tiene secciones todavia. Agrega una abajo o empieza por los puntos.',
    );
    return;
  }

  caja.replaceChildren(
    ...sections.map((s, i) => {
      const seccion = document.createElement('div');
      seccion.className = 'ck-seccion';

      const cab = document.createElement('div');
      cab.className = 'ck-seccion__cab';
      const num = document.createElement('span');
      num.className = 'ck-seccion__num';
      num.textContent = String(i + 1);
      const nombre = document.createElement('span');
      nombre.className = 'ck-seccion__nombre';
      nombre.textContent = s.name;
      const acciones = document.createElement('div');
      acciones.className = 'ck-seccion__acciones';
      acciones.append(
        AMIGO_UI.boton('Subir', () => moverSeccion(s.id, -1)),
        AMIGO_UI.boton('Bajar', () => moverSeccion(s.id, 1)),
        AMIGO_UI.boton('Renombrar', () => abrirRenombrarSeccion(s)),
        AMIGO_UI.boton(
          'Borrar sección',
          () => borrarSeccion(s.id),
          'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
        ),
      );
      cab.append(num, nombre, acciones);

      const puntos = document.createElement('div');
      puntos.className = 'ck-seccion__puntos';
      if (s.items.length === 0) {
        AMIGO_UI.vacio(puntos, 'Esta seccion no tiene puntos todavia');
      } else {
        puntos.replaceChildren(...s.items.map(pintarItem));
      }

      seccion.append(cab, puntos);
      return seccion;
    }),
  );

  // Los forms de edicion arrancan siempre ocultos; se abren al pulsar Editar.
  $('#punto-editar-form').hidden = true;
}

/**
 * Mueve una seccion una posicion, mandando el orden NUEVO entero a la API.
 *
 * El servidor exige la lista completa del orden y renumera a 1..N: por eso aca
 * no se toca ningun numero, solo se intercambian los ids y se pregunta de nuevo.
 */
async function moverSeccion(seccionId, delta) {
  const orden = estado.estructura.sections.map((s) => s.id);
  const indice = orden.indexOf(seccionId);
  const destino = indice + delta;
  if (indice < 0 || destino < 0 || destino >= orden.length) return;
  [orden[indice], orden[destino]] = [orden[destino], orden[indice]];
  const plantillaId = estado.plantillaId;
  try {
    await api(`/api/templates/${plantillaId}/sections/ordenar`, { method: 'POST', body: { order: orden } });
    await abrirPuntos(plantillaId);
    await recargar();
    avisar('Seccion movida');
  } catch (e) {
    avisar(e.message, true);
  }
}

/** Abre el form de renombrar la seccion con el nombre actual listo para editar. */
function abrirRenombrarSeccion(seccion) {
  $('#seccion-renombrar-id').value = seccion.id;
  $('#seccion-renombrar-nombre').value = seccion.name;
  $('#seccion-renombrar-form').hidden = false;
  $('#seccion-renombrar-nombre').focus();
}

async function borrarSeccion(seccionId) {
  // Borrar una seccion borra SUS PUNTOS con ella; las corriadas ya hechas no
  // se tocan, que es lo que dice el aviso.
  if (!confirm('Se borran la seccion y sus puntos de la plantilla. Las corridas quedan con su copia.')) return;
  try {
    await api(`/api/templates/${estado.plantillaId}/sections/${seccionId}`, { method: 'DELETE' });
    await abrirPuntos(estado.plantillaId);
    await recargar();
    avisar('Seccion borrada y renumerada');
  } catch (e) {
    avisar(e.message, true);
  }
}

async function quitarPunto(itemId) {
  try {
    // El servidor renumera lo que queda a 1..N y devuelve la lista nueva: por eso
    // esta pantalla repinta con la respuesta en vez de tapar el numero en local.
    await api(`/api/templates/${estado.plantillaId}/items/${itemId}`, { method: 'DELETE' });
    await abrirPuntos(estado.plantillaId);
    await recargar();
    avisar('Punto quitado y renumerado');
  } catch (e) {
    avisar(e.message, true);
  }
}

$('#seccion-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!estado.plantillaId) return;
  try {
    await api(`/api/templates/${estado.plantillaId}/sections`, {
      method: 'POST',
      body: { name: $('#seccion-nombre').value },
    });
    $('#seccion-nombre').value = '';
    await abrirPuntos(estado.plantillaId);
    await recargar();
    avisar('Seccion agregada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#seccion-renombrar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api(`/api/templates/${estado.plantillaId}/sections/${$('#seccion-renombrar-id').value}`, {
      method: 'PATCH',
      body: { name: $('#seccion-renombrar-nombre').value },
    });
    $('#seccion-renombrar-form').hidden = true;
    await abrirPuntos(estado.plantillaId);
    await recargar();
    avisar('Seccion renombrada');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#seccion-renombrar-cancelar').addEventListener('click', () => {
  $('#seccion-renombrar-form').hidden = true;
});

// Las opciones solo significan para un punto de seleccion: el campo aparece y
// desaparece con el tipo elegido, y no se presta a llenar opciones inutiles.
$('#punto-tipo').addEventListener('change', () => {
  $('#punto-opciones-caja').hidden = $('#punto-tipo').value !== 'select';
});

$('#punto-editar-tipo').addEventListener('change', () => {
  $('#punto-editar-opciones-caja').hidden = $('#punto-editar-tipo').value !== 'select';
});

$('#punto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!estado.plantillaId) return;
  const tipo = $('#punto-tipo').value;
  const cuerpo = {
    label: $('#punto-label').value,
    required: $('#punto-requerido').checked ? 1 : 0,
    type: tipo,
    sectionId: $('#punto-seccion').value || undefined,
  };
  if (tipo === 'select') cuerpo.options = opcionesDesdeTexto($('#punto-opciones').value);
  try {
    await api(`/api/templates/${estado.plantillaId}/items`, { method: 'POST', body: cuerpo });
    $('#punto-label').value = '';
    $('#punto-opciones').value = '';
    await abrirPuntos(estado.plantillaId);
    await recargar();
    avisar('Punto agregado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#punto-editar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = $('#punto-editar-tipo').value;
  const cuerpo = {
    label: $('#punto-editar-label').value,
    required: $('#punto-editar-required').checked ? 1 : 0,
    type: tipo,
  };
  if (tipo === 'select') cuerpo.options = opcionesDesdeTexto($('#punto-editar-opciones').value);
  try {
    await api(`/api/templates/${estado.plantillaId}/items/${$('#punto-editar-id').value}`, {
      method: 'PATCH',
      body: cuerpo,
    });
    $('#punto-editar-form').hidden = true;
    await abrirPuntos(estado.plantillaId);
    await recargar();
    avisar('Punto actualizado');
  } catch (err) {
    avisar(err.message, true);
  }
});

$('#punto-editar-cancelar').addEventListener('click', () => {
  $('#punto-editar-form').hidden = true;
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

  const tabla = AMIGO_UI.tabla(['Plantilla', 'Lugar', 'Estado', 'Responsable', 'Veredicto', 'Empezo', 'Cerrada', '']);
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (lista.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(8, 'No hay corridas que coincidan'));
  } else {
    for (const r of lista) {
      // "Sin plantilla" se avisa en la celda y no con un signo de interrogacion:
      // una corrida sin plantilla es normal, y tiene que poder leerse sola.
      const plantilla = document.createElement('div');
      const fuerte = document.createElement('div');
      fuerte.className = 'ui-ficha__titulo';
      fuerte.textContent = r.templateName;
      plantilla.append(fuerte);
      if (!r.templateId) {
        const aviso = document.createElement('div');
        aviso.className = 'ui-ficha__nota';
        aviso.textContent = 'plantilla borrada';
        plantilla.append(aviso);
      }

      const botones = [AMIGO_UI.boton('Ficha', () => abrirFicha(r.id).catch((e) => avisar(e.message, true)))];
      if (r.status === 'in_progress') {
        botones.push(AMIGO_UI.boton('Completar', () => completar(r.id)));
      }

      cuerpo.append(
        AMIGO_UI.fila(
          [
            plantilla,
            r.location ?? '—',
            AMIGO_UI.estadoDe(r.status, RUNS),
            r.performedBy ?? '—',
            r.result ? nota(VEREDICTO[r.result] ?? r.result) : '—',
            instanteCorto(r.startedAt),
            instanteCorto(r.completedAt) || '—',
            AMIGO_UI.celda(...botones),
          ],
          { className: 'acciones' },
        ),
      );
    }
  }

  $('#corridas-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
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

// ────────────────────────────────────────────────────────────────────────── ficha

/**
 * El control de UN punto de la corrida, segun su tipo.
 *
 * Si/No se responde con los tres botones (y el que esta elegido queda marcado);
 * texto, numero y seleccion con su campo y su boton Guardar. Cuando la corrida ya
 * esta cerrada, en vez de controles se muestra la respuesta tal como quedo.
 */
function controlPunto(p, editable) {
  if (!editable) {
    const texto = p.type === 'yes_no' ? (p.result ? RESULTADO[p.result]?.texto ?? p.result : '—') : p.valueText || '—';
    const celda = document.createElement('span');
    celda.className = 'ui-ficha__nota';
    celda.textContent = texto;
    return celda;
  }

  const caja = document.createElement('div');
  caja.className = 'ck-punto__control';

  if (p.type === 'yes_no') {
    for (const resultado of RESPUESTAS) {
      // El boton que esta elegido queda marcado, y con `aria-pressed` para que no
      // sea solo un color: el que se responde "no cumple" tiene que poder saberse
      // sin distinguir tonos.
      const b = AMIGO_UI.boton(
        RESULTADO[resultado].texto,
        () => responder(p.position, { result: resultado }),
        p.result === resultado ? 'ui-btn ui-btn--chico ui-btn--suave' : 'ui-btn ui-btn--chico ui-btn--fantasma',
      );
      b.setAttribute('aria-pressed', String(p.result === resultado));
      caja.append(b);
    }
    return caja;
  }

  const opciones = p.options ?? [];
  if (p.type === 'select') {
    const select = document.createElement('select');
    select.id = `item-valor-${p.position}`;
    select.replaceChildren(new Option('Elegir…', ''), ...opciones.map((o) => new Option(o, o)));
    // El valor se pone aca y no como atributo: un `<select>` no se deja
    // preseleccionar con `value` en el HTML.
    select.value = p.valueText ?? '';
    caja.append(select);
  } else {
    const input = document.createElement('input');
    input.id = `item-valor-${p.position}`;
    input.type = p.type === 'number' ? 'number' : 'text';
    input.maxLength = 4000;
    input.value = p.valueText ?? '';
    caja.append(input);
  }
  caja.append(AMIGO_UI.boton('Guardar', () => responder(p.position, { valueText: null }), 'ui-btn ui-btn--chico'));
  return caja;
}

/** Un punto de la corrida: su numero, su texto, su control y su nota. */
function pintarPunto(p, editable) {
  const fila = document.createElement('div');
  fila.className = `ck-punto ck-punto--${p.result ?? 'sin'}`;

  const num = document.createElement('span');
  num.className = 'ck-punto__num';
  num.textContent = String(p.position);

  const texto = document.createElement('div');
  texto.className = 'ck-punto__texto';
  const fuerte = document.createElement('strong');
  fuerte.textContent = p.label;
  const meta = document.createElement('div');
  meta.className = 'ck-punto__nota';
  meta.textContent = `${TIPOS[p.type] ?? p.type} · ${p.required ? 'obligatorio' : 'opcional'}`;
  texto.append(fuerte, meta);
  if (p.answeredAt) {
    const cuando = document.createElement('div');
    cuando.className = 'ck-punto__nota';
    cuando.textContent = `respondido ${instanteCorto(p.answeredAt)}`;
    texto.append(cuando);
  }

  fila.append(num, texto, controlPunto(p, editable));

  if (editable) {
    const campoNota = document.createElement('input');
    campoNota.className = 'ck-punto__nota-campo';
    campoNota.id = `item-nota-${p.position}`;
    campoNota.maxLength = 2000;
    campoNota.placeholder = 'Nota del punto';
    campoNota.value = p.note ?? '';
    fila.append(campoNota);
  } else if (p.note) {
    const textoNota = document.createElement('div');
    textoNota.className = 'ck-punto__nota ck-punto__nota-campo';
    textoNota.textContent = p.note;
    fila.append(textoNota);
  }

  return fila;
}

/**
 * La ficha de una corrida: sus datos, el resumen, sus puntos agrupados por la
 * seccion del SNAPSHOT y sus adjuntos.
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
  const caja = $('#ficha');
  caja.replaceChildren();

  const titulo = document.createElement('h2');
  titulo.textContent = r.templateName;

  const linea = document.createElement('div');
  linea.className = 'ui-fila';
  linea.append(AMIGO_UI.estadoDe(r.status, RUNS));
  if (r.result) linea.append(AMIGO_UI.etiqueta(`Veredicto: ${VEREDICTO[r.result] ?? r.result}`, 'neutro'));
  for (const meta of [r.location, r.performedBy && `responsable: ${r.performedBy}`]) {
    if (meta) linea.append(nota(meta));
  }

  const datos = document.createElement('dl');
  datos.className = 'ui-datos';
  datos.append(...par('Empezo', instanteCorto(r.startedAt)));
  if (r.completedAt) datos.append(...par('Cerrada', instanteCorto(r.completedAt)));
  datos.append(
    ...par('Cumplimiento', porcentaje(resumen.cumplimientoPct)),
    ...par('Puntos', `${resumen.ok} cumple · ${resumen.fail} no cumple · ${resumen.na} no aplica`),
  );

  // "Faltan N obligatorios" es lo unico de la ficha que avisa de un problema, y va
  // con color y no como una nota más: es el motivo por el que "Completar" va a
  // fallar, y conviene verlo antes de intentarlo.
  if (resumen.pendientesRequeridos) {
    const faltan = document.createElement('p');
    faltan.className = 'ui-aviso ui-aviso--aviso';
    faltan.textContent = `Faltan ${resumen.pendientesRequeridos} punto(s) obligatorio(s) por responder`;
    caja.append(titulo, linea, datos, faltan);
  } else {
    caja.append(titulo, linea, datos);
  }
  if (r.notes) caja.append(notas('Notas', r.notes));

  // La seccion de cada punto sale del snapshot de la corrida, y los puntos se
  // agrupan con ella: un punto nunca se muestra bajo la seccion equivocada por
  // mas que la plantilla haya cambiado de nombre despues.
  const seccionDe = {};
  for (const p of ficha.snapshot.items) seccionDe[p.position] = p.section ?? null;
  const grupos = [];
  for (const p of ficha.items) {
    const seccion = seccionDe[p.position] ?? null;
    const ultimo = grupos[grupos.length - 1];
    if (!ultimo || ultimo.nombre !== seccion) grupos.push({ nombre: seccion, items: [] });
    grupos[grupos.length - 1].items.push(p);
  }

  const enc = document.createElement('h3');
  enc.className = 'ui-tarjeta__cab';
  enc.textContent = 'Puntos de esta corrida';
  caja.append(enc);
  if (grupos.length === 0) {
    // Un parrafo de "no hay nada" pegado a la caja, y NO `AMIGO_UI.vacio`: esa
    // funcion vacia el contenedor que recibe, y acá el contenedor es la ficha
    // entera, con el titulo y el resumen ya escritos arriba.
    const sinPuntos = document.createElement('p');
    sinPuntos.className = 'ui-vacio';
    sinPuntos.textContent = 'No hay puntos que revisar';
    caja.append(sinPuntos);
  } else {
    for (const g of grupos) {
      if (g.nombre) {
        const h = document.createElement('h4');
        h.textContent = g.nombre;
        caja.append(h);
      }
      caja.append(...g.items.map((p) => pintarPunto(p, editable)));
    }
  }

  const encAdj = document.createElement('h3');
  encAdj.className = 'ui-tarjeta__cab';
  encAdj.textContent = 'Adjuntos';
  caja.append(encAdj);
  $('#adjunto-form').hidden = !editable;
  if (ficha.attachments.length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'ui-vacio';
    vacio.textContent = 'Sin adjuntos';
    caja.append(vacio);
  } else {
    const lista = document.createElement('div');
    lista.className = 'ck-adjuntos';
    for (const a of ficha.attachments) {
      const fila = document.createElement('div');
      fila.className = 'ck-adjunto';
      const enlace = document.createElement('a');
      enlace.href = a.url;
      enlace.download = a.filename;
      enlace.textContent = a.filename;
      const meta = document.createElement('span');
      meta.className = 'ck-adjunto__meta';
      meta.textContent = [tamanoCorto(a.sizeBytes), a.createdAt && instanteCorto(a.createdAt)]
        .filter(Boolean)
        .join(' · ');
      fila.append(enlace, meta);
      if (editable) {
        const acciones = document.createElement('div');
        acciones.className = 'ck-adjunto__acciones';
        acciones.append(
          AMIGO_UI.boton(
            'Quitar',
            async () => {
              try {
                await api(`/api/runs/${estado.corridaId}/attachments/${a.id}`, { method: 'DELETE' });
                await abrirFicha(estado.corridaId);
                avisar('Adjunto quitado');
              } catch (e) {
                avisar(e.message, true);
              }
            },
            'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
          ),
        );
        fila.append(acciones);
      }
      lista.append(fila);
    }
    caja.append(lista);
  }

  $('#corrida-editar-lugar').value = r.location ?? '';
  $('#corrida-editar-notas').value = r.notes ?? '';
  $('#corrida-editar-estado').value = r.status;
  $('#corrida-editar-resultado').value = r.result ?? '';
  // Reabrir solo tiene sentido cerrada, y completar solo abierta: dejar
  // habilitados los botones que la maquina de estados no acepta es formar a la
  // gente para recibir un 409.
  $('#ficha-completar').disabled = !editable;
  $('#ficha-cancelar').disabled = r.status === 'canceled';
  $('#ficha-reabrir').disabled = editable;

  $('#ficha-dialog').showModal();
}

/** Un par etiqueta/valor. */
function par(termino, valor) {
  const dt = document.createElement('dt');
  dt.textContent = termino;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  return [dt, dd];
}

/** Un par con texto largo, como las notas de la corrida. */
function notas(termino, valor) {
  const dl = document.createElement('dl');
  dl.className = 'ui-datos';
  dl.append(...par(termino, valor));
  return dl;
}

/** Responder un punto: con veredicto (Si/No) o con el valor escrito. */
async function responder(posicion, cuerpo) {
  const notaEl = document.getElementById(`item-nota-${posicion}`);
  const payload = { ...cuerpo, note: notaEl ? notaEl.value || null : null };
  if ('valueText' in cuerpo) {
    const valorEl = document.getElementById(`item-valor-${posicion}`);
    payload.valueText = valorEl ? valorEl.value : null;
  }
  try {
    await api(`/api/runs/${estado.corridaId}/items/${posicion}`, { method: 'POST', body: payload });
    await abrirFicha(estado.corridaId);
    avisar('Respuesta registrada');
  } catch (e) {
    avisar(e.message, true);
  }
}

/** Subir un adjunto: el navegador lo convierte a base64 y la API lo guarda. */
$('#adjunto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const archivo = $('#adjunto-archivo').files[0];
  if (!archivo) return avisar('Elige un archivo primero', true);
  if (archivo.size > 750_000) return avisar('El archivo no puede superar 750 KB', true);
  try {
    const data = await new Promise((resolver, rechazar) => {
      const lector = new FileReader();
      lector.onload = () => resolver(lector.result);
      lector.onerror = () => rechazar(new Error('No se pudo leer el archivo'));
      lector.readAsDataURL(archivo);
    });
    const separado = String(data).indexOf(';base64,');
    await api(`/api/runs/${estado.corridaId}/attachments`, {
      method: 'POST',
      body: {
        filename: archivo.name,
        mimeType: archivo.type || null,
        data: separado >= 0 ? String(data).slice(separado + ';base64,'.length) : String(data),
      },
    });
    await abrirFicha(estado.corridaId);
    avisar('Archivo adjuntado');
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#corrida-editar-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const resultado = $('#corrida-editar-resultado').value;
  try {
    await api(`/api/runs/${estado.corridaId}`, {
      method: 'PATCH',
      body: {
        location: $('#corrida-editar-lugar').value || null,
        notes: $('#corrida-editar-notas').value || null,
        status: $('#corrida-editar-estado').value,
        result: resultado || null,
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
  const resultado = $('#corrida-editar-resultado').value;
  try {
    // El veredicto solo se manda si se eligio: si no, el servidor lo deriva de
    // los puntos (aprobado si no hay "no cumple", observado si los hay).
    await api(`/api/runs/${runId}/completar`, {
      method: 'POST',
      body: resultado ? { result: resultado } : {},
    });
    await recargar();
    await abrirFicha(runId);
    avisar('Corrida completada y sellada');
  } catch (e) {
    avisar(e.message, true);
  }
}

$('#ficha-completar').addEventListener('click', () => completar(estado.corridaId));

$('#ficha-cancelar').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${estado.corridaId}`, { method: 'PATCH', body: { status: 'canceled' } });
    await recargar();
    await abrirFicha(estado.corridaId);
    avisar('Corrida cancelada');
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#ficha-reabrir').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${estado.corridaId}`, { method: 'PATCH', body: { status: 'in_progress' } });
    await recargar();
    await abrirFicha(estado.corridaId);
    avisar('Corrida reabierta');
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#ficha-borrar').addEventListener('click', async () => {
  try {
    await api(`/api/runs/${estado.corridaId}`, { method: 'DELETE' });
    estado.corridaId = null;
    $('#ficha-dialog').close();
    await recargar();
    avisar('Corrida borrada');
  } catch (e) {
    avisar(e.message, true);
  }
});

$('#ficha-cerrar').addEventListener('click', () => $('#ficha-dialog').close());

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
 * URL y la elige el shell. El editor de puntos, en cambio, NO se cierra al salir
 * de la sección: se pierde la estructura a medio armar y volver a pedirla sería
 * una ida y vuelta por cada punto que se agrega.
 */
function repintar() {
  const activo = document.querySelector('[data-tab][aria-current="page"]')?.dataset.tab ?? 'tablero';
  if (activo === 'plantillas') return pintarPlantillas();
  if (activo === 'corridas') return pintarCorridas();
  if (activo === 'tablero') return pintarTablero();
  return undefined;
}

/** Vuelve a pedir todo y vuelve a pintar lo que se está viendo. */
async function recargar() {
  await cargar();
  await repintar();
}

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
    avisar('Ajustes guardados');
  } catch (err) {
    avisar(err.message, true);
  }
});

AMIGO.montar({
  nombre: 'Checklists',
  paneles: ['tablero', 'plantillas', 'corridas', 'ajustes'],
  alEntrar: conAviso(repintar),
});

/** Corre una parte de la pantalla y avisa si falla, en vez de dejarla a medias. */
async function conAviso(fn) {
  try {
    await fn();
  } catch (e) {
    avisar(e.message, true);
  }
}

cargar().then(repintar).catch((e) => avisar(e.message, true));
