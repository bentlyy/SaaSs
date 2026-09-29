/* AMG · sesión en la landing.
 *
 * La landing (/) es marketing y no necesita del SPA de la plataforma; este
 * archivo la vuelve consciente de la sesión: cuando hay sesión cambia
 * "Ingresar / Crear cuenta" por "Mis aplicaciones / Mi cuenta / Salir" y
 * dibuja sobre la misma base las secciones "Tus aplicaciones", "Tu cuenta"
 * y sus ajustes (perfil, seguridad, organización, miembros, facturación).
 * Todo el texto que viene de la base se mete con textContent, nunca con
 * innerHTML, igual que en el SPA. */
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
      else if (key === 'dataset') for (var dk in value) node.dataset[dk] = String(value[dk]);
      else if (typeof value === 'function' && key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
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

  /* ── formatos ─────────────────────────────────────────────────────────── */

  function money(amount, currency) {
    var value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: currency || 'CLP',
        maximumFractionDigits: 0,
      }).format(value);
    } catch (err) {
      return '$' + value;
    }
  }

  function periodLabel(period) {
    if (period === 'yearly' || period === 'annual') return 'al año';
    if (period === 'once' || period === 'one_time') return 'pago único';
    return 'al mes';
  }

  function dateLabel(iso) {
    if (!iso) return '—';
    var when = new Date(iso);
    if (isNaN(when.getTime())) return '—';
    return when.toLocaleDateString('es-CL', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function relativeLabel(iso) {
    if (!iso) return '—';
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '—';
    var minutes = Math.round((Date.now() - then) / 60000);
    if (minutes < 1) return 'recién';
    if (minutes < 60) return 'hace ' + minutes + ' min';
    var hours = Math.round(minutes / 60);
    if (hours < 24) return 'hace ' + hours + ' h';
    var days = Math.round(hours / 24);
    if (days < 30) return 'hace ' + days + (days === 1 ? ' día' : ' días');
    return dateLabel(iso);
  }

  /* ── API ──────────────────────────────────────────────────────────────── */

  function fieldErrorsOf(errors) {
    var out = {};
    if (!errors) return out;
    if (errors.fieldErrors) {
      for (var field in errors.fieldErrors) {
        var list = errors.fieldErrors[field];
        if (list && list.length) out[field] = list[0];
      }
    } else if (Object.prototype.toString.call(errors) === '[object Array]') {
      for (var i = 0; i < errors.length; i++) {
        if (errors[i] && errors[i].path && errors[i].message) out[errors[i].path] = errors[i].message;
      }
    }
    return out;
  }

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
        var err = new Error(data.error || 'Algo salió mal. Inténtalo de nuevo.');
        err.status = res.status;
        err.fields = fieldErrorsOf(data.errors);
        throw err;
      });
    }, function () {
      throw new Error('No pudimos conectarnos con el servidor. Revisa tu conexión.');
    });
  }

  function loadSession() {
    return api('/auth/me').then(function (session) {
      return session;
    }, function (err) {
      if (err.status === 401) return null;
      throw err;
    });
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
      el('button', { class: CLASE_GHOST, type: 'button', text: 'Ingresar', onclick: abrirLogin }),
      el('a', { class: CLASE_SOLID, href: '/registro', text: 'Crear cuenta' }),
    ];
    /* Con sesión, todo sucede en la landing: un solo botón de identidad
     * abre el menú con "Mi cuenta", "Mis aplicaciones" y "Salir". */
    return menuSesion(sesionActual);
  }

  /* ── ventana de login ────────────────────────────────────────────────── */

  var menuActivo = null;
  var menuActivoCerrar = null;

  function cerrarMenuActivo() {
    if (menuActivoCerrar) { menuActivoCerrar(); menuActivoCerrar = null; menuActivo = null; }
  }

  function abrirLogin() {
    var alerta = el('div', { dataset: { alert: '' } });
    var form = el('form', { class: 'grid gap-4', novalidate: true },
      alerta,
      campo('email', 'Correo', { type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'tucorreo@negocio.cl' }),
      campo('password', 'Contraseña', { type: 'password', autocomplete: 'current-password' }),
      el('button', { class: BTN_SOLIDO + ' w-full justify-center', type: 'submit', text: 'Ingresar' }),
      el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: '¿Olvidaste tu contraseña? ' },
        el('a', { class: 'text-primary font-medium underline underline-offset-2', href: '/recuperar', text: 'Recuperarla' })),
      el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: '¿Aún no tienes cuenta? ' },
        el('a', { class: 'text-primary font-medium underline underline-offset-2', href: '/registro', text: 'Crea una gratis' })),
    );
    bindForm(form, function (values) {
      return api('/auth/login', { method: 'POST', body: { email: values.email, password: values.password } });
    }, function () { location.assign('/'); });

    var cerrar = el('button', { class: 'absolute top-4 right-4 w-9 h-9 grid place-items-center rounded-full text-on-surface-variant hover:bg-surface-container-low transition-colors', type: 'button', 'aria-label': 'Cerrar' },
      el('span', { class: 'material-symbols-outlined text-xl', text: 'close' }));
    var panel = el('div', { class: 'w-full max-w-md bg-surface-container-lowest rounded-3xl border border-outline-variant/60 bento-shadow p-6 md:p-8 relative' },
      el('div', { class: 'mb-5 pr-8' },
        el('h2', { class: 'text-headline-lg font-headline-lg text-primary tracking-tight', text: 'Ingresa a tu cuenta' }),
        el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant mt-1', text: 'Un solo acceso para todas tus herramientas.' }),
      ),
      form,
    );
    panel.appendChild(cerrar);
    var overlay = el('div', { class: 'fixed inset-0 z-[70] flex items-center justify-center p-4 bg-primary/45 backdrop-blur-sm', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ingresar a tu cuenta' },
      panel);
    document.body.appendChild(overlay);

    function cerrarDialogo() {
      document.removeEventListener('keydown', onKey);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    function onKey(event) { if (event.key === 'Escape') cerrarDialogo(); }
    cerrar.addEventListener('click', cerrarDialogo);
    overlay.addEventListener('click', function (event) { if (event.target === overlay) cerrarDialogo(); });
    document.addEventListener('keydown', onKey);
    var primer = form.querySelector('[name="email"]');
    if (primer && primer.focus) primer.focus();
  }

  /* ── menú de sesión en el navbar ─────────────────────────────────────── */

  function menuSesion(session) {
    var ses = session || {};
    var user = ses.user || {};
    var nombre = user.name || 'Usuario';
    var email = user.email || '';
    var chevron = el('span', { class: 'material-symbols-outlined text-[1.05rem] text-on-surface-variant transition-transform duration-200', text: 'expand_more' });

    var trig = el('button', {
      class: 'inline-flex items-center gap-2 rounded-full border border-outline-variant/60 bg-surface-container-lowest pl-1.5 pr-3 py-1.5 hover:bg-surface-container-low transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
      type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    },
      el('span', { class: 'w-8 h-8 rounded-full bg-primary text-on-primary grid place-items-center text-body-sm font-body-sm font-semibold', text: avatarInicial(nombre) }),
      el('span', { class: 'hidden sm:inline text-body-sm font-body-sm font-medium text-primary', text: String(nombre).split(' ')[0] }),
      chevron,
    );

    var sheet = el('div', { class: 'hidden absolute right-0 top-full mt-2 w-72 z-50 rounded-2xl border border-outline-variant/60 bg-surface-container-lowest bento-shadow p-2', role: 'menu' },
      el('div', { class: 'px-3 py-2.5 border-b border-outline-variant/30 mb-1' },
        el('p', { class: 'text-body-sm font-body-sm font-semibold text-primary truncate', text: nombre }),
        el('p', { class: 'text-body-xs font-body-xs text-on-surface-variant truncate', text: email }),
      ),
    );

    function opcion(ic, texto, fn) {
      var item = el('button', { class: 'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-body-sm font-body-sm text-primary hover:bg-surface-container-low transition-colors text-left', type: 'button' },
        el('span', { class: 'material-symbols-outlined text-xl text-on-surface-variant', text: ic }),
        el('span', { text: texto }),
      );
      item.addEventListener('click', function () { cerrar(); fn(); });
      return item;
    }

    sheet.appendChild(opcion('person', 'Mi cuenta', function () { mostrarVista('cuenta'); }));
    sheet.appendChild(opcion('apps', 'Mis aplicaciones', function () { mostrarVista('apps'); }));
    sheet.appendChild(el('div', { class: 'my-1 h-px bg-outline-variant/30' }));
    sheet.appendChild(opcion('logout', 'Salir', signOut));

    var wrapper = el('div', { class: 'relative' }, trig, sheet);

    function cerrar() {
      sheet.classList.add('hidden');
      trig.setAttribute('aria-expanded', 'false');
      chevron.classList.remove('rotate-180');
      if (menuActivo === wrapper) { menuActivo = null; menuActivoCerrar = null; }
    }
    trig.addEventListener('click', function (event) {
      event.stopPropagation();
      if (!sheet.classList.contains('hidden')) { cerrar(); return; }
      cerrarMenuActivo();
      sheet.classList.remove('hidden');
      trig.setAttribute('aria-expanded', 'true');
      chevron.classList.add('rotate-180');
      menuActivo = wrapper;
      menuActivoCerrar = cerrar;
    });
    return wrapper;
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
                el('a', { class: 'inline-flex items-center justify-center px-6 py-3 rounded-lg bg-primary text-on-primary font-body-sm font-semibold hover:bg-neutral-800 transition-all duration-200 active:scale-95 shadow-sm', href: '/#herramientas', text: 'Ver el mapa de herramientas' })),
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

  /* ── piezas de la sección "Tu cuenta" ────────────────────────────────── */

  var ROLES = { owner: 'Dueño', admin: 'Administrador', member: 'Miembro' };

  var BTN_SOLIDO = 'inline-flex items-center justify-center bg-primary-container text-on-primary hover:bg-neutral-800 transition-all duration-200 active:scale-95 text-body-sm font-body-sm font-medium px-5 py-2.5 rounded-lg shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  var BTN_FANTA = 'inline-flex items-center justify-center px-5 py-2.5 rounded-lg text-body-sm font-body-sm font-medium border border-outline-variant/60 text-primary hover:bg-surface-container-low transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  var BTN_FANTA_SM = 'inline-flex items-center justify-center px-3 py-1.5 rounded-lg text-body-xs font-body-xs font-medium border border-outline-variant/60 text-primary hover:bg-surface-container-low transition-all duration-200 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary';
  var BTN_FANTA_SM_DANGER = BTN_FANTA_SM + ' text-red-700 border-red-200/70 hover:bg-red-50';
  var INPUT = 'w-full rounded-lg border border-outline-variant/70 bg-surface-container-lowest px-3.5 py-2.5 text-body-sm font-body-sm text-primary placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-colors';
  var LABEL = 'text-label-mono-xs font-label-mono-xs text-on-surface-variant';
  var PILL_OK = 'px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200/70 text-label-mono-xs font-label-mono-xs font-semibold';
  var PILL_NEUTRO = 'px-2.5 py-0.5 rounded-full bg-surface-container text-on-surface-variant border border-outline-variant/60 text-label-mono-xs font-label-mono-xs font-semibold';
  var FILA = 'divide-y divide-outline-variant/40 rounded-xl border border-outline-variant/50 bg-surface-container-low/60 overflow-hidden';

  function rolLabel(role) { return ROLES[role] || role || 'Miembro'; }

  function okBox(msg) {
    return el('div', { class: 'rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200/70 px-3.5 py-2.5 text-body-sm font-body-sm', role: 'status', text: msg });
  }

  function badBox(msg) {
    return el('div', { class: 'rounded-lg bg-red-50 text-red-800 border border-red-200/70 px-3.5 py-2.5 text-body-sm font-body-sm', role: 'alert', text: msg });
  }

  function flash(kind, message) {
    var target = document.querySelector('#mi-cuenta [data-toast]');
    if (!target) return;
    mount(target, kind === 'ok' ? okBox(message) : badBox(message));
    clearTimeout(flash._t);
    flash._t = setTimeout(function () { mount(target); }, 5000);
  }

  function campo(name, label, options) {
    var o = options || {};
    return el('div', { class: 'grid gap-1.5' },
      el('label', { class: LABEL, for: 'f-' + name, text: label }),
      el('input', {
        class: INPUT,
        name: name, id: 'f-' + name, type: o.type || 'text',
        value: o.value === undefined || o.value === null ? '' : o.value,
        placeholder: o.placeholder || '',
        autocomplete: o.autocomplete || 'off',
        inputmode: o.inputMode || null,
        minlength: o.minLength || null,
        maxlength: o.maxLength || null,
        required: o.required !== false,
      }),
      o.hint ? el('p', { class: 'text-body-xs font-body-xs text-on-surface-variant/70', text: o.hint }) : null,
      el('p', { class: 'hidden text-body-xs font-body-xs text-red-600 mt-0.5', dataset: { error: name } }),
    );
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      if (!button.hasAttribute('data-label')) button.setAttribute('data-label', button.textContent);
      button.disabled = true;
      mount(button, el('span', { text: button.getAttribute('data-label') }), el('span', { class: 'opacity-60', text: '…' }));
    } else {
      button.disabled = false;
      mount(button, button.getAttribute('data-label') || 'Guardar');
    }
  }

  function clearErrores(form) {
    var slots = form.querySelectorAll('[data-error]');
    for (var i = 0; i < slots.length; i++) { slots[i].classList.add('hidden'); slots[i].textContent = ''; }
    var marcados = form.querySelectorAll('input, select');
    for (var j = 0; j < marcados.length; j++) marcados[j].classList.remove('border-red-400');
  }

  function showErrores(form, fields) {
    for (var name in fields) {
      var input = form.querySelector('[name="' + name + '"]');
      var slot = form.querySelector('[data-error="' + name + '"]');
      if (input) input.classList.add('border-red-400');
      if (slot) { slot.textContent = fields[name]; slot.classList.remove('hidden'); }
    }
  }

  function bindForm(form, handler, onOk) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var button = form.querySelector('[type="submit"]');
      var alerta = form.querySelector('[data-alert]');
      clearErrores(form);
      setBusy(button, true);
      var values = {};
      var datos = new FormData(form);
      datos.forEach(function (value, key) { values[key] = typeof value === 'string' ? value.trim() : value; });
      Promise.resolve()
        .then(function () { return handler(values); })
        .then(function (result) {
          setBusy(button, false);
          if (alerta) mount(alerta, okBox('Guardado.'));
          if (onOk) onOk(result);
        })
        .catch(function (err) {
          setBusy(button, false);
          if (err && err.fields) showErrores(form, err.fields);
          var msg = (err && err.message) ? err.message : 'Algo salió mal. Inténtalo de nuevo.';
          if (alerta) mount(alerta, badBox(msg));
          else flash('bad', msg);
        });
    });
  }

  function panel(titulo, subtitulo, body) {
    var extra = Array.prototype.slice.call(arguments, 3);
    return el('div', { class: 'bg-surface-container-lowest rounded-3xl border border-outline-variant/60 bento-shadow p-6 md:p-8' },
      el('div', { class: 'mb-5' },
        el('h3', { class: 'text-headline-md font-headline-md text-primary tracking-tight', text: titulo }),
        subtitulo ? el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant mt-1', text: subtitulo }) : null,
      ),
      body,
      extra,
    );
  }

  function skeleton(alto) {
    return el('div', { class: 'rounded-xl bg-surface-container-low animate-pulse', style: 'height: ' + (alto || '2.6rem') });
  }

  /* ── resumen y sesión ────────────────────────────────────────────────── */

  function avatarInicial(name) {
    return String(name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  function dato(label, value) {
    return el('div', {},
      el('dt', { class: 'text-label-mono-xs font-label-mono-xs text-on-surface-variant', text: label }),
      el('dd', { class: 'text-body-md font-body-md text-primary mt-1', text: value || '—' }),
    );
  }

  function resumenCard(data) {
    var nombre = data.user ? data.user.name : '—';
    var email = data.user ? data.user.email : '—';
    return el('article', { class: 'bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/60 bento-shadow h-full' },
      el('div', { class: 'flex items-center gap-4' },
        el('span', { class: 'w-12 h-12 rounded-full bg-primary text-on-primary grid place-items-center text-headline-md font-headline-md', text: avatarInicial(nombre) }),
        el('div', { class: 'min-w-0' },
          el('p', { class: 'text-headline-sm font-headline-sm text-primary tracking-tight truncate', text: nombre }),
          el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant truncate', text: email }),
        ),
      ),
      el('dl', { class: 'mt-6 pt-6 border-t border-outline-variant/40 grid grid-cols-1 sm:grid-cols-2 gap-5' },
        dato('ORGANIZACIÓN', data.organization ? data.organization.name : '—'),
        dato('ROL', rolLabel(data.role)),
        dato('CORREO', email),
        dato('SESIÓN DE', nombre),
      ),
    );
  }

  function accionesCard(data) {
    var toggle = el('button', { class: BTN_SOLIDO + ' w-full', type: 'button', text: 'Ver y editar ajustes' });
    toggle.addEventListener('click', function () {
      var contenedor = document.getElementById('mi-cuenta-ajustes');
      if (!contenedor) return;
      var abierto = !contenedor.classList.contains('hidden');
      if (abierto) {
        contenedor.classList.add('hidden');
        toggle.textContent = 'Ver y editar ajustes';
        toggle.setAttribute('aria-expanded', 'false');
      } else {
        contenedor.classList.remove('hidden');
        toggle.textContent = 'Ocultar ajustes';
        toggle.setAttribute('aria-expanded', 'true');
        setTimeout(function () {
          if (contenedor.scrollIntoView) contenedor.scrollIntoView({ block: 'start' });
        }, 40);
      }
    });
    return el('article', { class: 'bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/60 bento-shadow h-full flex flex-col justify-between' },
      el('div', {},
        el('p', { class: 'text-label-caps font-label-caps text-on-surface-variant', text: 'SESIÓN' }),
        el('p', { class: 'text-headline-sm font-headline-sm text-primary tracking-tight mt-1', text: 'Operás como ' + rolLabel(data.role) }),
        el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant mt-2', text: 'Perfil, contraseña, miembros, organización y facturación se editan acá mismo, sin salir de esta página.' }),
      ),
      el('div', { class: 'mt-6 grid gap-3' },
        toggle,
        el('button', { class: BTN_FANTA + ' w-full', type: 'button', text: 'Cerrar sesión', onclick: signOut }),
      ),
    );
  }

  /* ── paneles de ajustes ──────────────────────────────────────────────── */

  function perfilPanel(data) {
    var alerta = el('div', { dataset: { alert: '' } });
    var form = el('form', { class: 'grid gap-4', novalidate: true },
      alerta,
      el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
        campo('name', 'Nombre', { value: data.user.name, autocomplete: 'name' }),
        campo('email', 'Correo', { type: 'email', value: data.user.email, autocomplete: 'email', inputMode: 'email' }),
      ),
      el('div', { class: 'flex flex-wrap items-center gap-3' },
        el('button', { class: BTN_SOLIDO, type: 'submit', text: 'Guardar cambios' }),
        el('span', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: 'Rol · ' + rolLabel(data.role) }),
      ),
    );
    bindForm(form, function (values) {
      return api('/auth/profile', { method: 'PATCH', body: { name: values.name, email: values.email } });
    }, function () { refrescarResumen(); });
    return panel('Tu perfil', 'Datos de la persona que usa la cuenta.', form);
  }

  function cargarSesiones(contenedor) {
    api('/auth/sessions').then(function (result) {
      mount(contenedor, result.sessions.length
        ? el('div', { class: FILA }, result.sessions.map(function (item) {
            var row = el('div', { class: 'flex items-center justify-between gap-4 px-4 py-3' },
              el('div', { class: 'min-w-0' },
                el('div', { class: 'flex items-center gap-2' },
                  el('strong', { class: 'text-body-sm font-body-sm text-primary', text: item.current ? 'Esta sesión' : 'Otra sesión' }),
                  item.current ? el('span', { class: PILL_OK, text: 'Actual' }) : null,
                ),
                el('p', { class: 'text-body-xs font-body-xs text-on-surface-variant mt-0.5', text: [item.ip, item.user_agent].filter(Boolean).join(' · ') || 'Sin datos' }),
                el('p', { class: 'text-body-xs font-body-xs text-on-surface-variant', text: 'Última actividad ' + relativeLabel(item.last_seen_at) + ' · vence ' + dateLabel(item.expires_at) }),
              ),
            );
            if (!item.current) {
              var cerrar = el('button', { class: BTN_FANTA_SM_DANGER, type: 'button', text: 'Cerrar' });
              cerrar.addEventListener('click', function () {
                api('/auth/sessions/' + encodeURIComponent(item.id), { method: 'DELETE' })
                  .then(function () { location.reload(); })
                  .catch(function (err) { flash('bad', err.message); });
              });
              row.appendChild(cerrar);
            }
            return row;
          }))
        : el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: 'No tienes otras sesiones abiertas.' }));
    }).catch(function () { mount(contenedor, badBox('No pudimos cargar las sesiones.')); });
  }

  function seguridadPanel(data) {
    var lista = el('div', { class: 'grid gap-2' }, skeleton('3.2rem'));
    var alerta = el('div', { dataset: { alert: '' } });
    var salirTodo = el('button', { class: BTN_FANTA_SM_DANGER, type: 'button', text: 'Cerrar todas mis sesiones' });
    salirTodo.addEventListener('click', function () {
      if (!window.confirm('Se cerrarán todas tus sesiones, incluida esta. ¿Seguir?')) return;
      api('/auth/sessions', { method: 'DELETE' })
        .then(function () { location.assign('/login'); })
        .catch(function (err) { flash('bad', err.message); });
    });
    var form = el('form', { class: 'grid gap-4', novalidate: true },
      alerta,
      el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
        campo('currentPassword', 'Contraseña actual', { type: 'password', autocomplete: 'current-password' }),
        campo('newPassword', 'Nueva contraseña', { type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'Mínimo 8 caracteres' }),
      ),
      el('div', { class: 'flex flex-wrap items-center gap-3' },
        el('button', { class: BTN_SOLIDO, type: 'submit', text: 'Cambiar contraseña' }),
        salirTodo,
      ),
    );
    bindForm(form, function (values) {
      return api('/auth/password', { method: 'POST', body: { currentPassword: values.currentPassword, newPassword: values.newPassword } });
    }, function () { form.reset(); });
    cargarSesiones(lista);
    return panel('Seguridad', 'Sesiones abiertas y contraseña.',
      el('div', { class: 'grid gap-4' },
        lista,
        el('div', { class: 'h-px bg-outline-variant/40' }),
        form,
      ));
  }

  function organizacionPanel(data) {
    var cuerpo = [];
    if (data.organizations && data.organizations.length > 1) {
      var select = el('select', { class: INPUT, 'aria-label': 'Organización activa' });
      data.organizations.forEach(function (org2) {
        var id = org2.organization ? org2.organization.id : org2.id;
        select.appendChild(el('option', { value: id, selected: id === data.organization.id },
          (org2.organization ? org2.organization.name : org2.name) + ' · ' + org2.role));
      });
      var alertaOrg = el('div', { dataset: { alert: '' } });
      var sw = el('form', { class: 'grid gap-4', novalidate: true },
        alertaOrg,
        el('div', { class: 'flex flex-wrap items-end gap-3' },
          el('div', { class: 'grid gap-1.5 grow' },
            el('label', { class: LABEL, for: 'f-org-cambio', text: 'Estás trabajando en' }),
            select,
          ),
          el('button', { class: BTN_SOLIDO, type: 'submit', text: 'Cambiar' }),
        ),
      );
      bindForm(sw, function () {
        return api('/auth/switch-organization', { method: 'POST', body: { organizationId: select.value } });
      }, function () { location.reload(); });
      cuerpo.push(panel('Organizaciones', 'Perteneces a más de una. Elige con cuál operás.', sw));
    }
    if (data.role === 'owner' || data.role === 'admin') {
      var alertaNom = el('div', { dataset: { alert: '' } });
      var nom = el('form', { class: 'grid gap-4', novalidate: true },
        alertaNom,
        el('div', { class: 'grid gap-1.5' },
          el('label', { class: LABEL, for: 'f-org-name', text: 'Nombre de la organización' }),
          el('input', { class: INPUT, id: 'f-org-name', name: 'name', value: data.organization.name, maxlength: 80, required: true }),
          el('p', { class: 'hidden text-body-xs font-body-xs text-red-600 mt-0.5', dataset: { error: 'name' } }),
        ),
        el('div', {},
          el('button', { class: BTN_SOLIDO, type: 'submit', text: 'Guardar' }),
        ),
      );
      bindForm(nom, function (values) {
        return api('/account/organization', { method: 'PATCH', body: { name: values.name } });
      }, function () { refrescarResumen(); });
      cuerpo.push(panel('Organización', data.organization.name, nom));
    }
    return cuerpo;
  }

  function miembroRow(member, data) {
    var isSelf = member.user_id === data.user.id;
    var isOwner = data.role === 'owner';
    var editable = isOwner || isSelf;
    var row = el('div', { class: 'flex items-center justify-between gap-4 px-4 py-3' },
      el('div', { class: 'min-w-0' },
        el('strong', { class: 'text-body-sm font-body-sm text-primary', text: member.name }),
        isSelf ? el('span', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: ' (tú)' }) : null,
        el('p', { class: 'text-body-xs font-body-xs text-on-surface-variant mt-0.5', text: member.email + ' · ' + dateLabel(member.joined_at) }),
      ),
    );
    var control;
    if (editable) {
      var select = el('select', { class: INPUT + ' w-auto', 'aria-label': 'Rol de ' + member.name });
      [['owner', 'owner'], ['admin', 'admin'], ['member', 'member']].forEach(function (par) {
        select.appendChild(el('option', { value: par[0], selected: par[0] === member.role }, par[1]));
      });
      select.addEventListener('change', function () {
        api('/auth/organizations/' + encodeURIComponent(data.organization.id) + '/members/' + encodeURIComponent(member.user_id), {
          method: 'PUT',
          body: { role: select.value },
        }).then(function () { flash('ok', 'Rol actualizado.'); location.reload(); })
          .catch(function (err) { flash('bad', err.message); });
      });
      control = select;
    } else {
      control = el('span', { class: PILL_NEUTRO, text: member.role });
    }
    var acciones2 = el('div', { class: 'flex items-center gap-2' }, control);
    if (isOwner && !isSelf) {
      var sacar = el('button', { class: BTN_FANTA_SM_DANGER, type: 'button', text: 'Sacar' });
      sacar.addEventListener('click', function () {
        if (!window.confirm('¿Sacar a ' + member.name + ' de la organización?')) return;
        api('/auth/organizations/' + encodeURIComponent(data.organization.id) + '/members/' + encodeURIComponent(member.user_id), { method: 'DELETE' })
          .then(function () { location.reload(); })
          .catch(function (err) { flash('bad', err.message); });
      });
      acciones2.appendChild(sacar);
    }
    row.appendChild(acciones2);
    return row;
  }

  function miembrosPanel(data) {
    var isOwner = data.role === 'owner';
    var lista = el('div', { class: 'grid gap-2' }, skeleton('3.2rem'));
    api('/account/members').then(function (result) {
      mount(lista, result.members.length
        ? el('div', { class: FILA }, result.members.map(function (member) { return miembroRow(member, data); }))
        : el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: 'Todavía no hay nadie más.' }));
    }).catch(function () { mount(lista, badBox('No pudimos cargar los miembros.')); });

    var cuerpo = el('div', { class: 'grid gap-4' }, lista);
    if (isOwner) {
      var alerta = el('div', { dataset: { alert: '' } });
      var selectRol = el('select', { class: INPUT, name: 'role' },
        el('option', { value: 'member' }, 'member'),
        el('option', { value: 'admin' }, 'admin'),
      );
      var invite = el('form', { class: 'grid gap-4', novalidate: true },
        alerta,
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 items-end gap-4' },
          el('div', { class: 'grid gap-1.5' },
            el('label', { class: LABEL, for: 'f-invite-email', text: 'Invitar por correo' }),
            el('input', { class: INPUT, id: 'f-invite-email', name: 'email', type: 'email', placeholder: 'persona@negocio.cl', required: true }),
            el('p', { class: 'hidden text-body-xs font-body-xs text-red-600 mt-0.5', dataset: { error: 'email' } }),
          ),
          el('div', { class: 'grid gap-1.5' },
            el('label', { class: LABEL, for: 'f-invite-role', text: 'Rol' }),
            selectRol,
          ),
          el('button', { class: BTN_SOLIDO, type: 'submit', text: 'Invitar' }),
        ),
      );
      bindForm(invite, function (values) {
        return api('/auth/organizations/' + encodeURIComponent(data.organization.id) + '/invitations', {
          method: 'POST',
          body: { email: values.email, role: values.role },
        });
      }, function () { invite.reset(); });
      cuerpo.appendChild(el('div', { class: 'h-px bg-outline-variant/40' }));
      cuerpo.appendChild(invite);
    }
    return panel('Miembros', isOwner ? 'Invita a tu equipo y define qué puede hacer.' : 'Personas con acceso a esta organización.', cuerpo);
  }

  function facturacionPanel(data) {
    var lista = el('div', { class: 'grid gap-2' }, skeleton('3.2rem'));
    api('/account/payments').then(function (result) {
      mount(lista, result.payments.length
        ? el('div', { class: 'overflow-x-auto rounded-xl border border-outline-variant/50' },
            el('table', { class: 'w-full text-left' },
              el('thead', {}, el('tr', {},
                el('th', { class: 'px-4 py-2.5 text-label-mono-xs font-label-mono-xs text-on-surface-variant border-b border-outline-variant/40', text: 'Fecha' }),
                el('th', { class: 'px-4 py-2.5 text-label-mono-xs font-label-mono-xs text-on-surface-variant border-b border-outline-variant/40', text: 'Monto' }),
                el('th', { class: 'px-4 py-2.5 text-label-mono-xs font-label-mono-xs text-on-surface-variant border-b border-outline-variant/40', text: 'Estado' }),
                el('th', { class: 'px-4 py-2.5 text-label-mono-xs font-label-mono-xs text-on-surface-variant border-b border-outline-variant/40', text: 'Origen' }),
              )),
              el('tbody', {}, result.payments.map(function (payment) {
                var estado = payment.status === 'paid' ? PILL_OK : payment.status === 'failed' ? 'px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200/70 text-label-mono-xs font-label-mono-xs font-semibold' : 'px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200/70 text-label-mono-xs font-label-mono-xs font-semibold';
                return el('tr', { class: 'border-b border-outline-variant/30 last:border-b-0' },
                  el('td', { class: 'px-4 py-2.5 text-body-sm font-body-sm text-on-surface-variant', text: dateLabel(payment.paid_at || payment.created_at) }),
                  el('td', { class: 'px-4 py-2.5 text-body-sm font-body-sm text-primary', text: money(payment.amount, payment.currency) }),
                  el('td', { class: 'px-4 py-2.5', },
                    el('span', { class: estado, text: payment.status })),
                  el('td', { class: 'px-4 py-2.5 text-body-sm font-body-sm text-on-surface-variant', text: payment.provider }),
                );
              })),
            ))
        : el('p', { class: 'text-body-sm font-body-sm text-on-surface-variant', text: 'Todavía no hay pagos registrados.' }));
    }).catch(function () { mount(lista, el('div')); });

    return panel('Facturación', 'Suscripciones y pagos de AMG.',
      el('div', { class: 'flex flex-wrap items-center gap-3 mb-4' },
        el('span', { class: PILL_OK, text: data.active + (data.active === 1 ? ' activa' : ' activas') }),
        el('span', { class: PILL_NEUTRO, text: data.available + ' disponibles' }),
        data.role === 'owner' ? null : el('p', { class: 'text-body-xs font-body-xs text-on-surface-variant', text: 'Solo el owner puede activar o cancelar suscripciones.' }),
      ),
      lista,
    );
  }

  /* ── sección "Tu cuenta" ─────────────────────────────────────────────── */

  function refrescarResumen() {
    var datos = document.getElementById('mi-cuenta-datos');
    if (!datos) return;
    api('/account/summary').then(function (data) {
      mount(datos, resumenCard(data));
    }).catch(function () { /* se queda como estaba */ });
  }

  function renderCuenta(session) {
    var section = document.getElementById('mi-cuenta');
    var datos = document.getElementById('mi-cuenta-datos');
    var acciones = document.getElementById('mi-cuenta-acciones');
    var ajustes = document.getElementById('mi-cuenta-ajustes');
    var sub = document.getElementById('mi-cuenta-sub');
    if (!section) return;
    if (!session) {
      section.classList.add('hidden');
      if (ajustes) ajustes.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    if (sub) sub.textContent = 'Tus datos, la organización y todo lo de tu cuenta, en esta misma página.';
    mount(datos, skeleton('10rem'));
    mount(acciones, skeleton('10rem'));

    api('/account/summary').then(function (data) {
      mount(datos, resumenCard(data));
      mount(acciones, accionesCard(data));
      if (ajustes) mount(ajustes, el('div', { class: 'grid gap-6' },
        perfilPanel(data),
        seguridadPanel(data),
        organizacionPanel(data),
        data.role === 'admin' || data.role === 'owner' ? miembrosPanel(data) : null,
        facturacionPanel(data),
      ));
    }).catch(function () {
      mount(datos, badBox('No pudimos cargar tu cuenta. Recarga la página y vuelve a intentarlo.'));
    });
  }

  /* ── vistas: landing, aplicaciones y cuenta ─────────────────────────────── */

  var sesionActual = null;

  function seccionesDeMain() {
    return Array.prototype.slice.call(document.querySelectorAll('main > section'));
  }

  function mostrarVista(vista) {
    if (vista === 'landing') {
      seccionesDeMain().forEach(function (sec) {
        if (sec.id === 'tus-aplicaciones' || sec.id === 'mi-cuenta') sec.classList.add('hidden');
        else sec.classList.remove('hidden');
      });
    } else {
      var activa = vista === 'apps' ? 'tus-aplicaciones' : 'mi-cuenta';
      seccionesDeMain().forEach(function (sec) {
        if (sec.id === activa) sec.classList.remove('hidden');
        else sec.classList.add('hidden');
      });
    }
    window.scrollTo(0, 0);
  }

  function volverLanding() {
    mostrarVista('landing');
    if (location.hash) history.replaceState(null, '', location.pathname);
  }

  /* ── ancla a una sección (enlaces de la landing) ──────────────────────── */

  function saltarAAncla() {
    var id = (location.hash || '').replace(/^#/, '');
    if (!id || !document.getElementById(id)) return;
    var intentos = 0;
    (function poll() {
      var target = document.getElementById(id);
      if (target && !target.classList.contains('hidden') && target.scrollIntoView) {
        target.scrollIntoView({ block: 'start' });
      } else if (intentos < 20) {
        intentos += 1;
        setTimeout(poll, 100);
      }
    })();
  }

  function aplicarHashInicial() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (sesionActual && (hash === 'mi-cuenta' || hash === 'tus-aplicaciones')) {
      mostrarVista(hash === 'mi-cuenta' ? 'cuenta' : 'apps');
    } else {
      mostrarVista('landing');
    }
    if (hash && hash !== 'mi-cuenta' && hash !== 'tus-aplicaciones') saltarAAncla();
  }

  function vincularSesionEnPagina() {
    document.querySelectorAll('[data-volver]').forEach(function (link) {
      link.addEventListener('click', function (event) { event.preventDefault(); volverLanding(); });
    });
    var logo = document.querySelector('header nav a[href="#"]');
    if (logo) logo.addEventListener('click', function (event) { event.preventDefault(); volverLanding(); });
    window.addEventListener('hashchange', function () {
      var hash = (location.hash || '').replace(/^#/, '');
      if (sesionActual && (hash === 'mi-cuenta' || hash === 'tus-aplicaciones')) {
        mostrarVista(hash === 'mi-cuenta' ? 'cuenta' : 'apps');
        return;
      }
      mostrarVista('landing');
      if (hash) saltarAAncla();
    });
  }

  /* ── arranque ────────────────────────────────────────────────────────── */

  function boot() {
    if (!document.getElementById('auth-nav') && !document.getElementById('tus-aplicaciones') && !document.getElementById('mi-cuenta')) return;
    function run() {
      loadSession().then(function (session) {
        sesionActual = session;
        var nav = document.getElementById('auth-nav');
        if (nav) mount(nav, navAuth(!session));
        renderApps(session);
        renderCuenta(session);
        aplicarHashInicial();
        vincularSesionEnPagina();
        document.addEventListener('click', function () { cerrarMenuActivo(); });
      });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  boot();
})();