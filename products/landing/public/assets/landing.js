/* AMG · sesión en la landing.
 *
 * La landing (/) es marketing y no necesita del SPA de la plataforma; este
 * archivo solo la vuelve consciente de la sesión: cuando hay sesión cambia
 * "Ingresar / Crear cuenta" por "Mis aplicaciones / Mi cuenta / Salir" y
 * dibuja la sección "Tus aplicaciones" con acceso directo a cada herramienta
 * activa, sobre la misma base de la landing. Todo el texto que viene de la
 * base se mete con textContent, nunca con innerHTML, igual que en el SPA. */
(function () {
  'use strict';

  var API = '/api';

  /* ── DOM ──────────────────────────────────────────────────────────────── */

  function el(tag, props) {
    var node = document.createElement(tag);
    var attrs = props || {};
    for (var key in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue;
      var value = attrs[key];
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = String(value);
      else if (typeof value === 'function' && key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false || child === '') continue;
      node.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function append(parent, children) {
    if (children === null || children === undefined || children === false) return;
    if (Object.prototype.toString.call(children) === '[object Array]') {
      for (var i = 0; i < children.length; i++) append(parent, children[i]);
      return;
    }
    parent.appendChild(children.nodeType ? children : document.createTextNode(String(children)));
  }

  function mount(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    append(node, Array.prototype.slice.call(arguments, 1));
  }

  /* ── API ──────────────────────────────────────────────────────────────── */

  function api(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }).then(function (res) {
      if (res.status === 204) return {};
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var err = new Error(data.error || 'Algo salió mal.');
        err.status = res.status;
        throw err;
      });
    });
  }

  function loadSession() {
    return api('/auth/me').then(function (session) { return session; }, function () { return null; });
  }

  function signOut() {
    api('/auth/logout', { method: 'POST' }).catch(function () { /* igual se sale */ })
      .then(function () { location.assign('/'); });
  }

  /* ── marca de color por herramienta (igual que el mapa) ──────────────── */

  var COLORES = {
    citas: 'indigo',
    espacios: 'emerald',
    solicitudes: 'amber',
    inventario: 'purple',
    cotizaciones: 'teal',
    clientes: 'blue',
    activos: 'sky',
    checklists: 'cyan',
    pagos: 'orange',
  };

  var ENLACES = {
    indigo: ['text-indigo-900', 'hover:text-indigo-700', 'focus-visible:ring-indigo-700'],
    emerald: ['text-emerald-900', 'hover:text-emerald-700', 'focus-visible:ring-emerald-700'],
    amber: ['text-amber-950', 'hover:text-amber-800', 'focus-visible:ring-amber-800'],
    purple: ['text-purple-900', 'hover:text-purple-700', 'focus-visible:ring-purple-700'],
    teal: ['text-teal-900', 'hover:text-teal-700', 'focus-visible:ring-teal-700'],
    blue: ['text-blue-900', 'hover:text-blue-700', 'focus-visible:ring-blue-700'],
    sky: ['text-sky-900', 'hover:text-sky-700', 'focus-visible:ring-sky-700'],
    cyan: ['text-cyan-900', 'hover:text-cyan-700', 'focus-visible:ring-cyan-700'],
    orange: ['text-orange-900', 'hover:text-orange-700', 'focus-visible:ring-orange-700'],
  };

  function hostOf(url) {
    try { return new URL(url).host; } catch (err) { return String(url || '').replace(/^https?:\/\//, ''); }
  }

  function arrowIcon() {
    var S = 'http://www.w3.org/2000/svg';
    var svg = el('svg', { class: 'w-4 h-4', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    var path = document.createElementNS(S, 'path');
    path.setAttribute('d', 'M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  /* ── navbar: los botones del slot #auth-nav ──────────────────────────── */

  var CLASE_GHOST = 'hidden sm:inline-flex items-center justify-center px-4 py-2 rounded-lg text-body-sm font-body-sm font-medium border border-outline-variant/60 text-primary hover:bg-surface-container-low transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  var CLASE_SOLID = 'inline-flex items-center justify-center bg-primary-container text-on-primary hover:bg-neutral-800 transition-all duration-200 active:scale-95 text-body-sm font-body-sm font-medium px-4 py-2 rounded-lg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';

  function navAuth(guest) {
    if (guest) return [
      el('a', { class: CLASE_GHOST, href: '/login', text: 'Ingresar' }),
      el('a', { class: CLASE_SOLID, href: '/registro', text: 'Crear cuenta' }),
    ];
    return [
      el('a', { class: CLASE_GHOST, href: '/mis-aplicaciones', text: 'Mis aplicaciones' }),
      el('a', { class: CLASE_GHOST, href: '/mi-cuenta', text: 'Mi cuenta' }),
      el('button', { class: CLASE_SOLID, type: 'button', text: 'Salir', onclick: signOut }),
    ];
  }

  /* ── sección "Tus aplicaciones" ──────────────────────────────────────── */

  function appCard(app) {
    var color = COLORES[app.slug] || 'indigo';
    var link = ENLACES[color] || ENLACES.indigo;
    return el('article', { class: 'bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/60 bento-shadow flex flex-col justify-between' },
      el('div', {},
        el('div', { class: 'flex items-center justify-between gap-4 mb-3' },
          el('div', { class: 'flex items-center gap-3 min-w-0' },
            el('span', { class: 'w-2.5 h-2.5 rounded-full bg-' + color + '-500 shrink-0' }),
            el('h3', { class: 'text-headline-sm font-headline-sm text-primary tracking-tight truncate', text: app.name }),
          ),
          el('span', { class: 'px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-label-mono-xs font-label-mono-xs font-semibold shrink-0', text: 'Activa' }),
        ),
        app.tagline ? el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant mb-5', text: app.tagline }) : null,
      ),
      el('div', { class: 'pt-5 border-t border-outline-variant/30 flex items-center justify-between gap-3' },
        el('span', { class: 'text-label-mono-xs font-label-mono-xs text-on-surface-variant truncate', text: hostOf(app.app_url) }),
        app.app_url
          ? el('a', {
              class: 'inline-flex items-center gap-1.5 text-body-sm font-body-sm font-semibold ' + link[0] + ' hover:' + link[1] + ' transition-colors focus:outline-none focus-visible:ring-2 ' + link[2] + ' rounded p-1',
              href: app.app_url,
              target: '_blank',
              rel: 'noopener noreferrer',
            },
            el('span', { text: 'Abrir' }), arrowIcon())
          : el('span', { class: 'text-label-mono-xs font-label-mono-xs text-on-surface-variant', text: 'Sin URL pública' }),
      ),
    );
  }

  function renderApps(session) {
    var section = document.getElementById('tus-aplicaciones');
    if (!section) return;
    var grid = document.getElementById('tus-aplicaciones-grid');
    var sub = document.getElementById('tus-aplicaciones-sub');
    var empty = document.getElementById('tus-aplicaciones-vacio');
    if (!session) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    if (sub && session.organization) sub.textContent = 'Herramientas activas de ' + session.organization.name + '. Entras directo, sin volver a pedir nada.';
    mount(grid, el('div', { class: 'opacity-60', style: 'height: 6rem', text: 'Cargando…' }));

    return api('/account/applications').then(function (data) {
      var active = (data && data.active) || [];
      mount(grid);
      mount(empty);
      if (!active.length) {
        if (empty) {
          empty.classList.remove('hidden');
          mount(empty,
            el('div', { class: 'bg-surface-container-lowest rounded-3xl p-10 border border-outline-variant/60 bento-shadow text-center' },
              el('p', { class: 'text-body-md font-body-md text-on-surface-variant', text: 'Todavía no tienes herramientas activas.' }),
              el('div', { class: 'mt-5' },
                el('a', { class: 'inline-flex items-center justify-center px-6 py-3 rounded-lg bg-primary text-on-primary font-body-sm font-semibold hover:bg-neutral-800 transition-all duration-200 active:scale-95 shadow-sm', href: '/mis-aplicaciones', text: 'Ver herramientas disponibles' })),
            ));
        }
        return;
      }
      mount(grid, active.map(appCard));
    }).catch(function () {
      if (empty) {
        empty.classList.remove('hidden');
        mount(empty,
          el('div', { class: 'rounded-2xl border border-outline-variant/50 bg-surface-container-low p-5 text-body-sm font-body-sm text-on-surface-variant', text: 'No pudimos cargar tus aplicaciones. Recarga la página y vuelve a intentarlo.' }));
      }
    });
  }

  /* ── arranque ────────────────────────────────────────────────────────── */

  function boot() {
    if (!document.getElementById('auth-nav') && !document.getElementById('tus-aplicaciones')) return;
    function run() {
      loadSession().then(function (session) {
        var nav = document.getElementById('auth-nav');
        if (nav) mount(nav, navAuth(!session));
        renderApps(session);
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  boot();
})();