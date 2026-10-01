/* ==========================================================================
   AMIGO · el shell de los nueve productos
   --------------------------------------------------------------------------
   Este archivo no dibuja la pantalla del producto: solo completa las cuatro
   cosas que son iguales en todos. Un producto escribe su HTML con la forma que
   quiere y este script le llena:

     · el nombre de la empresa y de la persona, arriba a la izquierda y abajo
     · la lista de las otras herramientas contracted
     · el estado de la seccion activa, en la URL y en el canal

   La forma (tokens, tarjetas, botones, tablas) vive en `amigo.css`. Un producto
   no dibuja la navegacion ni reescribe la geometria: por eso las nueve se ven
   como la misma aplicacion y no como nueve sitios parecidos.

   Sin dependencias y sin build.
   ========================================================================== */
(function () {
  'use strict';

  /** Escapa texto que va al DOM. El nombre de la empresa lo eligio el cliente. */
  function esc(valor) {
    return String(valor == null ? '' : valor).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** "Deportes y Salud" -> "DS". Las palabras de relleno no cuentan. */
  function iniciales(nombre) {
    var palabras = String(nombre == null ? '' : nombre)
      .trim()
      .split(/\s+/)
      .filter(function (p) { return p && !/^(de|del|la|el|los|las|y|para|con)$/i.test(p); });
    if (palabras.length === 0) return '?';
    if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
    return (palabras[0].charAt(0) + palabras[1].charAt(0)).toUpperCase();
  }

  /** El panel pedido, o el primero. Vive en la URL para poder compartir un enlace. */
  function panelDeUrl(disponibles) {
    var pedido = new URLSearchParams(location.search).get('panel');
    return pedido && disponibles.indexOf(pedido) !== -1 ? pedido : disponibles[0];
  }

  /* ── cuenta ────────────────────────────────────────────────────────── */

  function pintarCuenta(datos) {
    var org = (datos && datos.organizacion) || {};
    var usr = (datos && datos.usuario) || {};
    var nombreEmpresa = org.nombre || org.slug || '';
    var nombreUsuario = usr.nombre || usr.email || '';

    document.querySelectorAll('[data-amigo="empresa"]').forEach(function (n) {
      n.textContent = nombreEmpresa;
    });
    document.querySelectorAll('[data-amigo="usuario"]').forEach(function (n) {
      n.textContent = nombreUsuario;
    });
    document.querySelectorAll('[data-amigo="correo"]').forEach(function (n) {
      n.textContent = usr.email || '';
    });
    document.querySelectorAll('[data-amigo="avatar"]').forEach(function (n) {
      n.textContent = iniciales(nombreUsuario);
    });
    document.querySelectorAll('[data-amigo="logo"]').forEach(function (n) {
      n.textContent = iniciales(document.title.split('·')[0].trim() || 'AMG');
    });
  }

  /* ── las otras herramientas ────────────────────────────────────────── */

  function pintarHerramientas(datos) {
    var caja = document.querySelector('[data-amigo="otras"]');
    if (!caja) return;
    var actuales = (datos && datos.herramientas) || [];
    var actual = datos && datos.herramienta;
    // La herramienta en la que ya estas no se lista: seria un enlace a si mismo.
    var otras = actuales.filter(function (h) { return h.slug !== actual; });
    var titulo = document.querySelector('[data-amigo="otras-titulo"]');
    if (otras.length === 0) {
      if (titulo) titulo.hidden = true;
      return;
    }
    if (titulo) titulo.hidden = false;
    caja.innerHTML = otras
      .map(function (h) {
        // Sin URL no hay a donde ir: se nombra y ya, en vez de un enlace roto.
        if (!h.url) return '<span class="ui-nav__inactivo">' + esc(h.name) + '</span>';
        return '<a href="' + esc(h.url) + '">' + esc(h.name) + '</a>';
      })
      .join('');
  }

  /* ── secciones ─────────────────────────────────────────────────────── */

  function marcar(clave) {
    document.querySelectorAll('[data-tab]').forEach(function (n) {
      if (n.dataset.tab === clave) n.setAttribute('aria-current', 'page');
      else n.removeAttribute('aria-current');
    });
    document.querySelectorAll('[data-panel]').forEach(function (n) {
      n.hidden = n.dataset.panel !== clave;
    });
    var titulo = document.querySelector('[data-amigo="titulo"]');
    if (titulo) {
      var activa = document.querySelector('[data-tab][aria-current="page"]');
      if (activa) titulo.textContent = (activa.textContent || '').trim();
    }
  }

  function mostrar(clave) {
    marcar(clave);
    if (typeof window.AMIGO_alEntrar === 'function') window.AMIGO_alEntrar(clave);
  }

  /* ── arranque ──────────────────────────────────────────────────────── */

  function montar(opciones) {
    var cfg = opciones || {};
    if (cfg.color) document.documentElement.style.setProperty('--acento', cfg.color);
    if (cfg.acentoTenue) document.documentElement.style.setProperty('--acento-tenue', cfg.acentoTenue);

    // Se acepta `['agenda', 'espacios']` o `[{clave: 'agenda', titulo: '…'}]`.
    var paneles = (cfg.paneles || []).map(function (p) {
      return typeof p === 'string' ? p : p.clave;
    }).filter(Boolean);
    if (paneles.length > 0) {
      var inicial = panelDeUrl(paneles);
      document.querySelectorAll('[data-tab]').forEach(function (n) {
        n.addEventListener('click', function (ev) {
          ev.preventDefault();
          history.pushState({ panel: n.dataset.tab }, '', '?panel=' + n.dataset.tab);
          mostrar(n.dataset.tab);
        });
      });
      window.addEventListener('popstate', function () { mostrar(panelDeUrl(paneles)); });
      marcar(inicial);
      // `alEntrar` pinta el panel: es adorno, no el arranque. Si viene mal (por
      // ejemplo una Promise en vez de una función, que es lo que pasa al
      // escribir `conAviso(fn)` en vez de `() => conAviso(fn)`) no debe tumbar el
      // resto del montaje ni impedir cargar la cuenta de arriba.
      if (typeof cfg.alEntrar === 'function') {
        try {
          cfg.alEntrar(inicial);
        } catch (err) {
          console.error('AMIGO.montar: alEntrar falló', err);
        }
      }
    }

    fetch('/api/inicio', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (datos) {
        if (!datos) return;
        pintarCuenta(datos);
        pintarHerramientas(datos);
      })
      .catch(function () {
        // La cuenta y el salto entre herramientas son adorno: si esta llamada
        // falla, la herramienta se sigue usando igual.
      });
  }

  window.AMIGO = { montar: montar, mostrar: mostrar, esc: esc, iniciales: iniciales };
})();
