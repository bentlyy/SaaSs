/* ==========================================================================
   AMIGO-UI · las piezas que se dibujan igual en los nueve productos
   --------------------------------------------------------------------------
   `amigo.css` pone la forma. Este archivo pone el código que la arma, y existe
   por una razón concreta: cada tabla, cada botón y cada etiqueta de estado se
   construían con un helper propio dentro de cada producto. Nueve copias del
   mismo código que se parecían pero no eran iguales, y un día una tabla
   quedó con el marco y otra sin él, y la culpa fue de una línea repetida.

   Con un solo modulo, las tablas de los nueve son literalmente el mismo
   código. Si mañana se cambia cómo se ve una tabla, cambia en los nueve, y
   no hay forma de que dos productos queden distintos por descuido.

   Un producto usa estas piezas y escribe solo lo suyo: que columnas tiene su
   tabla, que estados tiene su negocio, que toca en su API.

   Sin dependencias y sin build, como `amigo.js`.
   ========================================================================== */
(function () {
  'use strict';

  var TONOS = {
    ok: 'ui-etiqueta--ok',
    aviso: 'ui-etiqueta--aviso',
    malo: 'ui-etiqueta--malo',
    acento: 'ui-etiqueta--acento',
    neutro: '',
  };

  /** Selector corto. Todos los productos lo usan igual. */
  function $(sel) {
    return document.querySelector(sel);
  }

  /** Texto que viene de la API y va al DOM. Nunca se concatena crudo. */
  function esc(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /**
   * Centavos -> "$1.500". El separador de miles lo pone el navegador según el
   * locale, no una expresión regular propia: escribir el separador a mano es
   * como se termina con "1.500,00" en un sitio que cobra en pesos enteros.
   *
   * `simbolo` existe porque la moneda no es siempre el peso: la elige la
   * organización en sus ajustes, y un producto que hardcodara el `$` le
   * mostraria la cifra equivocada a quien cobra en otra cosa. Por defecto es `$`,
   * que es lo que usan la mayoria.
   */
  function dinero(centavos, opciones) {
    var op = Object.assign({ minimumFractionDigits: 0, simbolo: '$' }, opciones);
    var simbolo = op.simbolo;
    delete op.simbolo;
    return simbolo + (Number(centavos || 0) / 100).toLocaleString('es-CL', op);
  }

  /** Fecha ISO -> "12 oct 2026", sin la zona horaria del navegador de por medio. */
  function fecha(iso, conHora) {
    if (!iso) return '';
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    var dia = d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
    if (!conHora) return dia;
    return dia + ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Una celda con lo que se le pase: texto, numero o nodo.
   *
   * Por eso existe `celda()`: un `<td>` no puede contener otro `<td>`, asi que
   * la columna de acciones necesita un agrupador. Antes de esto se pasaba el
   * `div` equivocado y el HTML de la tabla decia `[object HTMLTableCellElement]`
   * al pie de cada fila.
   */
  function celda() {
    var f = document.createDocumentFragment();
    for (var i = 0; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null) continue;
      f.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return f;
  }

  /**
   * Un renglon de tabla.
   *
   * `opciones.className` se aplica a la ULTIMA columna, no a todas. Aplicarlo a
   * todas fue un bug: la celda de acciones quedaba alineada a la derecha y con
   * `white-space: nowrap` en cada celda de la fila, y en las tablas anchas la
   * tabla se estiraba de mas.
   *
   * `opciones.num` dice que columnas llevan cifras, y hay dos formas porque las
   * dos hacen falta: `true` para la ultima columna, y una lista de indices para
   * las que estan en medio. Una tabla de cotizaciones tiene el total en la
   * quinta de seis porque al lado va el boton de borrar, y ese numero alineado
   * a la izquierda con la columna de al lado hace que no parezca un total.
   */
  function fila(columnas, opciones) {
    var op = opciones || {};
    var numeros = Array.isArray(op.num) ? op.num : op.num === true ? [columnas.length - 1] : [];
    var tr = document.createElement('tr');
    for (var i = 0; i < columnas.length; i++) {
      var c = columnas[i];
      var td = document.createElement('td');
      if (c instanceof Node) td.append(c);
      else td.textContent = c == null ? '' : String(c);
      if (op.className && i === columnas.length - 1) td.className = op.className;
      if (numeros.indexOf(i) !== -1) td.className = (td.className ? td.className + ' ' : '') + 'num';
      if (op.numero && i === columnas.length - 1) td.className = 'num';
      tr.append(td);
    }
    return tr;
  }

  /**
   * El marco de una tabla: borde, esquinas y scroll horizontal.
   *
   * `eje: true` convierte la tabla en tabla de agenda, donde la primera columna
   * es el eje de lectura (la hora) y deja de repartirse con las demas. Se pide
   * por tabla y no se detecta solo: que columna es el eje depende de que
   * muestra la tabla, y eso lo sabe quien la escribe.
   */
  function cajaTabla(tabla, opciones) {
    var op = opciones || {};
    var caja = document.createElement('div');
    caja.className = 'ui-tabla-caja' + (op.eje ? ' ui-tabla-caja--eje' : '');
    var scroll = document.createElement('div');
    scroll.className = 'ui-tabla-scroll';
    scroll.append(tabla);
    caja.append(scroll);
    return caja;
  }

  /**
   * Una tabla con su encabezado.
   *
   * `columnas` son textos; con `num: true` la columna queda alineada a la
   * derecha, que es como se lee un numero. Se declara aqui y no en cada
   * producto para que las once tablas de los nueve productos numeren igual.
   *
   * `op.num` acepta lo mismo que `fila()`: `true` para la ultima columna, o la
   * lista de indices de las que son cifras. Encabezado y celda tienen que
   * coincidir: si la `th` queda a la derecha y la `td` a la izquierda, el
   * numero se ve desalineado con su propio titulo.
   */
  function tabla(columnas, opciones) {
    var op = opciones || {};
    var numeros = Array.isArray(op.num) ? op.num : op.num === true ? [columnas.length - 1] : [];
    var t = document.createElement('table');
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    for (var i = 0; i < columnas.length; i++) {
      var th = document.createElement('th');
      var col = columnas[i];
      th.textContent = typeof col === 'string' ? col : col.titulo;
      if ((typeof col === 'object' && col.num) || numeros.indexOf(i) !== -1) th.className = 'num';
      tr.append(th);
    }
    thead.append(tr);
    t.append(thead);
    t.append(document.createElement('tbody'));
    if (op.clase) t.className = op.clase;
    return t;
  }

  /** El cuerpo de una tabla, para poder vaciarlo y volver a llenarlo. */
  function cuerpoDe(t) {
    var b = t.querySelector('tbody');
    if (!b) {
      b = document.createElement('tbody');
      t.append(b);
    }
    b.replaceChildren();
    return b;
  }

  /**
   * Boton de fila. Chico y discreto por defecto: el boton de una fila compite
   * con el dato de al lado, y si grita, la tabla deja de leerse como tabla.
   */
  function boton(texto, alHacerClic, clase) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = clase || 'ui-btn ui-btn--chico ui-btn--fantasma';
    b.textContent = texto;
    if (alHacerClic) b.addEventListener('click', alHacerClic);
    return b;
  }

  /**
   * Una etiqueta de estado.
   *
   * El estado crudo del servidor (`confirmed`, `open`, `paid`) nunca se pinta
   * tal cual: se traduce y se le da tono. Que el estado se vea con color es lo
   * que permite recorrer una tabla de un vistazo sin leer cada celda.
   */
  function etiqueta(texto, tono) {
    var s = document.createElement('span');
    s.className = ('ui-etiqueta ' + (TONOS[tono] ?? TONOS.neutro)).trim();
    s.textContent = texto;
    return s;
  }

  /**
   * Traduce un estado del dominio a la etiqueta que se ve.
   *
   * `mapa` es del producto, porque los estados son suyos: un pago no tiene los
   * mismos que una reserva. Lo que es de todos es que la forma sea la misma.
   */
  function estadoDe(clave, mapa) {
    var info = mapa[clave];
    if (!info) return etiqueta(clave, 'neutro');
    return etiqueta(typeof info === 'string' ? info : info.texto, typeof info === 'string' ? 'neutro' : info.tono);
  }

  /**
   * Las tarjetas de arriba.
   *
   * `filas` son [etiqueta, valor, esAcento]. Se pintan todas juntas porque
   * cuatro tarjetas que se rellenan una por una en cuatro partes del codigo
   * terminan con tres del mismo ancho y la cuarta distinta.
   */
  function kpis(contenedor, filas) {
    contenedor.replaceChildren();
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i];
      var div = document.createElement('div');
      div.className = 'ui-kpi';
      var cifra = document.createElement('span');
      cifra.className = 'ui-kpi__cifra' + (f[2] ? ' ui-kpi__cifra--acento' : '');
      cifra.textContent = f[1];
      var etiquetaTexto = document.createElement('span');
      etiquetaTexto.className = 'ui-kpi__etiqueta';
      etiquetaTexto.textContent = f[0];
      div.append(cifra, etiquetaTexto);
      if (f[3]) {
        var nota = document.createElement('span');
        nota.className = 'ui-kpi__nota';
        nota.textContent = f[3];
        div.append(nota);
      }
      contenedor.append(div);
    }
    return contenedor;
  }

  /**
   * El aviso de una operacion: el mismo en los nueve, siempre en el mismo
   * lugar y siempre con el mismo tiempo en pantalla.
   *
   * El elemento se busca por `#aviso` y se marca `hidden`. Por eso la hoja
   * compartida trae `[hidden] { display: none !important }`: sin eso, un
   * `.ui-aviso { display: flex }` le gana al navegador y el aviso nunca se va.
   */
  function avisar(mensaje, malo) {
    var caja = typeof mensaje === 'string' ? $('#aviso') : mensaje;
    if (!caja) return;
    caja.textContent = typeof mensaje === 'string' ? mensaje : caja.textContent;
    caja.className = 'ui-aviso ' + (malo ? 'ui-aviso--malo' : 'ui-aviso--ok');
    caja.hidden = false;
    clearTimeout(caja._t);
    caja._t = setTimeout(function () { caja.hidden = true; }, 5000);
  }

  /** "Sin resultados" en el lugar de una tabla vacia, que parece un error. */
  function vacio(contenedor, texto) {
    var p = document.createElement('p');
    p.className = 'ui-vacio';
    p.textContent = texto;
    contenedor.replaceChildren(p);
    return p;
  }

  /**
   * El renglon de una tabla que no tiene nada que mostrar.
   *
   * Sin esto, cada tabla vacia se escribia a mano con un `colspan` que
   * occasionualmente era el numero equivocado, y el texto se caia en una sola
   * celda angosta en vez de ocupar el ancho de la tabla.
   */
  function filaVacia(columnas, texto) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = columnas;
    td.append(vacio(document.createElement('div'), texto));
    tr.append(td);
    return tr;
  }

  /**
   * `fetch` que habla el mismo idioma de errores en los nueve.
   *
   * Acepta el body como objeto o como texto ya serializado, porque conviven las
   * dos convenciones en el código anterior y obligar a elegir una hacia atrás
   * rompía la mitad de los productos. `FormData` pasa sin tocar: es lo que usa
   * la subida de archivos y serializarlo produciría "[object FormData]".
   *
   * Cuando la sesión central vence el servidor responde 401 con la URL del
   * login. Sin este salto, quien usa la herramienta ve una pantalla en blanco
   * con un error en vez de volver a iniciar sesión: el clásico "entro y dice
   * que no". El `throw` posterior evita que siga Pintando con datos vacíos.
   */
  async function api(ruta, opciones) {
    var opt = opciones || {};
    var cuerpo = opt.body;
    var esTexto = typeof cuerpo === 'string' || (typeof FormData !== 'undefined' && cuerpo instanceof FormData);
    var init = {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      ...opt,
      body: cuerpo == null ? undefined : esTexto ? cuerpo : JSON.stringify(cuerpo),
    };
    var res = await fetch(ruta, init);
    var datos = await res.json().catch(function () { return {}; });

    if (res.status === 401 && datos.loginUrl) {
      window.location.href = datos.loginUrl;
      var vencido = new Error('sesion vencida');
      vencido.vencida = true;
      throw vencido;
    }

    if (!res.ok) {
      var detalle = datos.errors && datos.errors.fieldErrors
        ? Object.keys(datos.errors.fieldErrors)
            .map(function (campo) { return campo + ': ' + datos.errors.fieldErrors[campo].join(' '); })
            .join(' · ')
        : datos.error || 'No se pudo completar la operacion';
      var err = new Error(detalle);
      err.status = res.status;
      err.detalle = datos;
      throw err;
    }
    return datos;
  }

  window.AMIGO_UI = {
    $: $, esc: esc, dinero: dinero, fecha: fecha,
    celda: celda, fila: fila, cajaTabla: cajaTabla, tabla: tabla, cuerpoDe: cuerpoDe,
    boton: boton, etiqueta: etiqueta, estadoDe: estadoDe, TONOS: TONOS,
    kpis: kpis, avisar: avisar, vacio: vacio, filaVacia: filaVacia, api: api,
  };
})();
