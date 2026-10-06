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
 *
 * La tabla, las etiquetas y los botones vienen de `AMIGO_UI`; lo de mas abajo
 * es de esta herramienta.
 */

const $ = AMIGO_UI.$;
const api = AMIGO_UI.api;
const avisar = AMIGO_UI.avisar;

const estado = {
  cargos: [],
  /** Saldo por cargo, armado por `/api/charges/saldos`. */
  saldos: {},
  cfg: { currency: '$', timezone: 'America/Santiago' },
  rol: 'member',
  /** El cargo que esta abierta en la ficha, para reescribirla al cobrarle. */
  fichaId: null,
};

const ESTADOS = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  partial: { texto: 'Parcial', tono: 'acento' },
  paid: { texto: 'Pagado', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

const METODOS = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  other: 'Otro',
};

/**
 * Centavos a texto legible, con el centavo SIEMPRE a la vista.
 *
 * Se reutiliza `AMIGO_UI.dinero` pidiendole dos decimales: el helper ya sabe
 * formatear y simbolo de la organización; solo hay que no redondear. Un saldo
 * de $45,01 mostrado como $45 hace desaparecer deuda.
 */
function monto(centavos) {
  return AMIGO_UI.dinero(centavos, {
    simbolo: estado.cfg?.currency ?? '$',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fecha) {
  if (!fecha) return '';
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}

const instanteCorto = (iso) => (iso ? new Date(iso).toLocaleString('es-CL') : '');

const saldoDe = (id) => estado.saldos[id] ?? 0;

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

// ─────────────────────────────────────────────────────────────────────── tablero

async function pintarTablero() {
  const tablero = await api('/api/dashboard');
  const porStatus = tablero.porStatus;

  AMIGO_UI.kpis($('#resumen'), [
    [monto(tablero.cobradoMesCents), 'Cobrado este mes', true],
    [monto(tablero.pendienteCents), 'Por cobrar'],
    [monto(tablero.vencidoCents), 'Vencido'],
    [porStatus.pending, 'Cargos pendientes'],
    [porStatus.partial, 'Cargos parciales'],
    [porStatus.paid, 'Cargos pagados'],
    [porStatus.canceled, 'Cargos cancelados'],
  ]);

  const caja = $('#recientes');
  if (tablero.recientes.length === 0) {
    AMIGO_UI.vacio(caja, 'Todavia no hay cargos emitidos');
    return;
  }
  caja.replaceChildren(
    ...tablero.recientes.map((c) => {
      const ficha = document.createElement('div');
      ficha.className = 'ui-ficha';
      const cuerpo = document.createElement('div');
      cuerpo.className = 'ui-ficha__cuerpo';
      const titulo = document.createElement('span');
      titulo.className = 'ui-ficha__titulo';
      titulo.textContent = `${c.number} · ${c.customerName}`;
      const nota = document.createElement('span');
      nota.className = 'ui-ficha__nota';
      nota.textContent = `${c.concept} · saldo ${monto(c.saldoCents)}`;
      cuerpo.append(titulo, nota);
      const acciones = document.createElement('div');
      acciones.className = 'ui-ficha__acciones';
      acciones.append(
        AMIGO_UI.estadoDe(c.status, ESTADOS),
        AMIGO_UI.boton('Ficha', () => abrirFicha(c.id).catch((e) => avisar(e.message, true))),
      );
      ficha.append(cuerpo, acciones);
      return ficha;
    }),
  );
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

  const tabla = AMIGO_UI.tabla(
    ['Folio', 'Cliente', 'Concepto', 'Emitido', 'Vence', 'Total', 'Saldo', 'Estado', ''],
    { num: [5, 6] },
  );
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);

  if (lista.length === 0) {
    cuerpo.append(AMIGO_UI.filaVacia(9, 'No hay cargos que coincidan'));
  } else {
    for (const c of lista) {
      // El correo va debajo del cliente y no en su propia columna: es el mismo
      // dato duplicado, y darle columna propia empujaba las de dinero fuera de
      // la pantalla en cualquier laptop.
      const cliente = document.createElement('div');
      const fuerte = document.createElement('div');
      fuerte.className = 'ui-ficha__titulo';
      fuerte.textContent = c.customerName;
      cliente.append(fuerte);
      if (c.customerEmail) {
        const correo = document.createElement('div');
        correo.className = 'ui-ficha__nota';
        correo.textContent = c.customerEmail;
        cliente.append(correo);
      }

      // El saldo va con color: en una cartera, ver de un vistazo cuanto se le
      // debe a cada uno es el trabajo de esta pantalla, y si hay que leer la
      // cifra para saber si es rojo, no se hizo el trabajo.
      const saldo = saldoDe(c.id);
      const celdaSaldo =
        saldo > 0 ? AMIGO_UI.etiqueta(monto(saldo), 'malo') : AMIGO_UI.etiqueta(monto(saldo), 'ok');

      const botones = [
        AMIGO_UI.boton('Ficha', () => abrirFicha(c.id).catch((e) => avisar(e.message, true))),
        AMIGO_UI.boton('Editar', () => abrirCargo(c)),
      ];
      // El boton solo aparece si el cargo no tiene nada cobrado. Un cargo con
      // abonos no se borra (la API responde 409), asi que ofrecer el boton y
      // dejar que revente seria mostrar algo que nunca puede funcionar.
      //
      // "Cobrado" se deduce del saldo sin pedir otra consulta: el saldo nunca es
      // negativo, asi que saldo < total es exactamente "entro plata". Un cargo
      // pagado queda en 0 y por eso tambien se cuenta aqui.
      const tieneCobrado = saldoDe(c.id) < c.amountCents;
      if (puedeBorrar && !tieneCobrado) {
        botones.push(
          AMIGO_UI.boton(
            'Borrar',
            async () => {
              try {
                await api(`/api/charges/${c.id}`, { method: 'DELETE' });
                await recargar();
                avisar('Cargo borrado');
              } catch (err) {
                avisar(err.message, true);
              }
            },
            'ui-btn ui-btn--chico ui-btn--fantasma ui-btn--peligro',
          ),
        );
      }

      cuerpo.append(
        AMIGO_UI.fila(
          [
            c.number,
            cliente,
            c.concept,
            fechaCorta(c.issuedDate) || '—',
            fechaCorta(c.dueDate) || '—',
            monto(c.amountCents),
            celdaSaldo,
            AMIGO_UI.estadoDe(c.status, ESTADOS),
            AMIGO_UI.celda(...botones),
          ],
          { num: [5], className: 'acciones' },
        ),
      );
    }
  }

  $('#cobros-lista').replaceChildren(AMIGO_UI.cajaTabla(tabla));
}

function abrirCargo(cargo) {
  $('#cargo-id').value = cargo?.id ?? '';
  $('#cargo-form-titulo').textContent = cargo ? 'Editar cargo' : 'Nuevo cargo';
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
  if (!$('#cargo-dialog').open) $('#cargo-dialog').showModal();
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

$('#cargo-cancelar').addEventListener('click', () => $('#cargo-dialog').close());
$('#cargo-cerrar').addEventListener('click', () => $('#cargo-dialog').close());
$('#cargo-nuevo').addEventListener('click', () => abrirCargo(null));

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
    $('#cargo-dialog').close();
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

// ──────────────────────────────────────────────────────────────────────── ficha

/** Un par etiqueta/valor. La ficha es una lista de datos, no filas que comparar. */
function dato(termino, valor) {
  const dt = document.createElement('dt');
  dt.textContent = termino;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  return [dt, dd];
}

async function abrirFicha(idCargo) {
  const ficha = await api(`/api/charges/${idCargo}/ficha`);
  estado.fichaId = idCargo;
  const c = ficha.charge;
  const caja = $('#ficha');
  caja.replaceChildren();

  const titulo = document.createElement('h2');
  titulo.textContent = `${c.number} · ${c.customerName}`;

  const linea = document.createElement('div');
  linea.className = 'ui-fila';
  linea.append(AMIGO_UI.estadoDe(c.status, ESTADOS));
  if (c.dueDate) linea.append(AMIGO_UI.etiqueta(`Vence ${fechaCorta(c.dueDate)}`, 'neutro'));

  const datos = document.createElement('dl');
  datos.className = 'ui-datos';
  datos.append(
    ...dato('Concepto', c.concept),
    ...dato('Total', monto(ficha.charge.amountCents)),
    ...dato('Cobrado', monto(ficha.pagadoCents)),
  );
  // "Devuelto" solo aparece cuando hubo devoluciones: en una ficha sin ellas es una
  // fila en cero que hace preguntar que se devolvio, y la respuesta es nada.
  if (ficha.devueltoCents > 0) datos.append(...dato('Devuelto', monto(ficha.devueltoCents)));
  datos.append(...dato('Saldo', monto(ficha.saldoCents)));
  if (c.customerEmail) datos.append(...dato('Correo', c.customerEmail));
  if (c.notes) datos.append(...dato('Notas', c.notes));

  const abonos = document.createElement('h3');
  abonos.className = 'ui-tarjeta__cab';
  abonos.textContent = 'Abonos';
  const lista = document.createElement('div');
  lista.className = 'ui-lista';

  if (ficha.payments.length === 0) {
    AMIGO_UI.vacio(lista, 'Sin abonos registrados');
  } else {
    for (const p of ficha.payments) {
      const fila = document.createElement('div');
      fila.className = 'ui-ficha';
      const cuerpo = document.createElement('div');
      cuerpo.className = 'ui-ficha__cuerpo';
      const tit = document.createElement('span');
      tit.className = 'ui-ficha__titulo';
      tit.textContent = METODOS[p.method] ?? p.method;
      cuerpo.append(tit);
      if (p.reference) {
        const nota = document.createElement('span');
        nota.className = 'ui-ficha__nota';
        nota.textContent = p.reference;
        cuerpo.append(nota);
      }
      const cuando = document.createElement('div');
      cuando.className = 'ui-ficha__acciones';
      cuando.append(
        AMIGO_UI.etiqueta(instanteCorto(p.receivedAt), 'neutro'),
        AMIGO_UI.etiqueta(monto(p.amountCents), 'ok'),
      );
      fila.append(cuerpo, cuando);
      lista.append(fila);
    }
  }

  caja.append(titulo, linea, datos, abonos, lista);

  // Las devoluciones van en su propia seccion y solo se pinta si hay. Se ocultan
  // igual que el boton que las crea cuando no hay nada que devolver: la razon es la
  // misma del boton, un control que siempre va a fallar ensucia la pantalla.
  const seccionDevoluciones = document.createElement('div');
  seccionDevoluciones.hidden = ficha.refunds.length === 0;
  const devoluciones = document.createElement('h3');
  devoluciones.className = 'ui-tarjeta__cab';
  devoluciones.textContent = 'Devoluciones';
  const listaDevoluciones = document.createElement('div');
  listaDevoluciones.className = 'ui-lista';

  for (const d of ficha.refunds) {
    const fila = document.createElement('div');
    fila.className = 'ui-ficha';
    const cuerpo = document.createElement('div');
    cuerpo.className = 'ui-ficha__cuerpo';
    const tit = document.createElement('span');
    tit.className = 'ui-ficha__titulo';
    tit.textContent = d.reason;
    cuerpo.append(tit);
    // El motivo va en el titulo y el comprobante en la nota, al reves del abono, y
    // por una razon concreta: del abono el dato util es "como y cuando pago", y del
    // motivo de una devolucion lo util es "por que salio".
    if (d.reference) {
      const nota = document.createElement('span');
      nota.className = 'ui-ficha__nota';
      nota.textContent = `${METODOS[d.method] ?? d.method} · ${d.reference}`;
      cuerpo.append(nota);
    } else {
      const nota = document.createElement('span');
      nota.className = 'ui-ficha__nota';
      nota.textContent = METODOS[d.method] ?? d.method;
      cuerpo.append(nota);
    }
    const cuando = document.createElement('div');
    cuando.className = 'ui-ficha__acciones';
    cuando.append(
      AMIGO_UI.etiqueta(instanteCorto(d.refundedAt), 'neutro'),
      AMIGO_UI.etiqueta(monto(d.amountCents), 'malo'),
    );
    fila.append(cuerpo, cuando);
    listaDevoluciones.append(fila);
  }

  seccionDevoluciones.append(devoluciones, listaDevoluciones, formDevolucion(ficha));
  caja.append(seccionDevoluciones);

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

/**
 * El formulario de devolucion, armado en JS porque solo existe cuando hay plata
 * cobrada que devolver.
 *
 * Va aparte del formulario de abono y no es el mismo formulario con el signo
 * cambiado: la devolucion tiene una razon obligatoria y el abono no, y un solo
 * formulario con un campo que a veces no aplica hace que la gente lo deje en
 * blanco sin querer.
 */
function formDevolucion(ficha) {
  const form = document.createElement('form');
  form.className = 'ui-tarjeta ui-form';
  form.id = 'devolucion-form';

  const titulo = document.createElement('h3');
  titulo.className = 'ui-tarjeta__cab';
  titulo.textContent = 'Devolver plata';

  const motivo = document.createElement('label');
  motivo.textContent = 'Por que se devuelve';
  const motivoInput = document.createElement('input');
  motivoInput.name = 'reason';
  motivoInput.type = 'text';
  motivoInput.required = true;
  motivoInput.maxLength = 500;
  motivoInput.placeholder = 'trabajo mal hecho';

  const montoLabel = document.createElement('label');
  montoLabel.textContent = 'Monto (centavos)';
  const montoInput = document.createElement('input');
  montoInput.name = 'amountCents';
  montoInput.type = 'number';
  montoInput.min = '1';
  montoInput.step = '1';
  montoInput.required = true;
  montoInput.value = String(ficha.pagadoCents);
  const vista = document.createElement('span');
  vista.className = 'ui-pista';
  vista.textContent = `de ${monto(ficha.pagadoCents)} cobrados`;

  const metodoLabel = document.createElement('label');
  metodoLabel.textContent = 'Como salio';
  const metodo = document.createElement('select');
  metodo.name = 'method';
  for (const [clave, texto] of Object.entries(METODOS)) {
    const op = document.createElement('option');
    op.value = clave;
    op.textContent = texto;
    metodo.append(op);
  }

  const refLabel = document.createElement('label');
  refLabel.textContent = 'Comprobante';
  const ref = document.createElement('input');
  ref.name = 'reference';
  ref.type = 'text';
  ref.maxLength = 120;

  const fechaLabel = document.createElement('label');
  fechaLabel.textContent = 'Salio el (vacio = ahora)';
  const fecha = document.createElement('input');
  fecha.name = 'refundedAt';
  fecha.type = 'date';

  const enviar = document.createElement('button');
  enviar.type = 'submit';
  enviar.className = 'ui-btn';
  enviar.textContent = 'Registrar devolucion';

  // El monto por defecto es TODO lo cobrado, porque devolver todo es lo que se
  // quiere casi siempre (el abono estaba mal) y es lo que habilita el cancelar que
  // la API exige. Escribir a mano el saldo a devolver obliga a sumar a mano.
  montoInput.addEventListener('input', () => {
    vista.textContent = `de ${monto(ficha.pagadoCents)} cobrados`;
  });

  form.append(
    titulo,
    motivo,
    motivoInput,
    montoLabel,
    montoInput,
    vista,
    metodoLabel,
    metodo,
    refLabel,
    ref,
    fechaLabel,
    fecha,
    enviar,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cuerpo = {
      amountCents: Number(montoInput.value),
      reason: motivoInput.value.trim(),
      method: metodo.value,
      reference: ref.value.trim() || null,
    };
    if (fecha.value) cuerpo.refundedAt = new Date(`${fecha.value}T12:00:00Z`).toISOString();
    try {
      await api(`/api/charges/${estado.fichaId}/devoluciones`, { method: 'POST', body: cuerpo });
    } catch (error) {
      avisar(error.message, true);
      return;
    }
    avisar('Devolucion registrada');
    await abrirFicha(estado.fichaId);
    await recargar();
  });

  return form;
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

$('#reporte-filtrar').addEventListener('click', () => conAviso(pintarReporte));

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
  const tabla = AMIGO_UI.tabla(['Dias de atraso', 'Cargos', 'Saldo'], { num: [1, 2] });
  const cuerpo = AMIGO_UI.cuerpoDe(tabla);
  for (const [clave, b] of Object.entries(reporte.buckets)) {
    cuerpo.append(AMIGO_UI.fila([clave, b.cargos, monto(b.saldoCents)], { num: [1, 2] }));
  }
  $('#reporte-tabla').replaceChildren(AMIGO_UI.cajaTabla(tabla));

  $('#reporte-total').textContent =
    `${reporte.totalCargos} cargo(s) con saldo al ${reporte.referencia}: ` +
    `${monto(reporte.totalPendienteCents)} pendientes.`;
}

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
 * URL y la elige el shell. Así, cobrar y volver a pintar no manda a nadie de
 * vuelta al tablero: quien está en la cartera se queda en la cartera.
 */
function repintar() {
  const activo = document.querySelector('[data-tab][aria-current="page"]')?.dataset.tab ?? 'tablero';
  if (activo === 'cobros') return pintarCobros();
  if (activo === 'reporte') return pintarReporte();
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
    pintarMontos();
    avisar('Ajustes guardados');
  } catch (err) {
    avisar(err.message, true);
  }
});

AMIGO.montar({ nombre: 'Control de Pagos', paneles: ['tablero', 'cobros', 'reporte', 'ajustes'], alEntrar: () => conAviso(repintar) });

/** Corre una parte de la pantalla y avisa si falla, en vez de dejarla a medias. */
async function conAviso(fn) {
  try {
    await fn();
  } catch (e) {
    avisar(e.message, true);
  }
}

cargar().then(repintar).catch((e) => avisar(e.message, true));
