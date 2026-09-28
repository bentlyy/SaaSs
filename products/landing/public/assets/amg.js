/* AMG · controlador de la UI de la plataforma.
 *
 * Sin framework y sin build: el Core sirve estos archivos tal cual. Todo el
 * texto que viene de la base (nombres, descripciones, correos) se mete con
 * textContent, nunca con innerHTML, para que un producto mal sembrado no
 * termine ejecutando scripts en el navegador de un cliente. */
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
      else if (key === 'dataset') for (var d in value) node.dataset[d] = value[d];
      else if (key.slice(0, 2) === 'on' && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false || child === '') return;
    if (Object.prototype.toString.call(child) === '[object Array]') {
      for (var i = 0; i < child.length; i++) append(parent, child[i]);
      return;
    }
    parent.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  function mount(node) {
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    for (var i = 1; i < arguments.length; i++) append(node, arguments[i]);
  }

  var byId = function (id) { return document.getElementById(id); };
  var slot = function (id) { return byId(id); };

  /* ── marca ────────────────────────────────────────────────────────────── */

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    var node = document.createElementNS(SVG_NS, tag);
    for (var key in attrs) node.setAttribute(key, String(attrs[key]));
    return node;
  }

  /* Misma geometría que la landing: cuatro rectángulos. */
  function logo() {
    var svg = svgEl('svg', { viewBox: '0 0 28 28', width: 26, height: 26, fill: 'none', 'aria-hidden': 'true' });
    svg.appendChild(svgEl('rect', { x: 2, y: 2, width: 10, height: 15, rx: 3.5, fill: 'currentColor' }));
    svg.appendChild(svgEl('rect', { x: 14, y: 2, width: 12, height: 7, rx: 3, fill: 'currentColor', opacity: 0.75 }));
    svg.appendChild(svgEl('rect', { x: 14, y: 11, width: 12, height: 15, rx: 3.5, fill: 'currentColor', opacity: 0.9 }));
    svg.appendChild(svgEl('rect', { x: 2, y: 19, width: 10, height: 7, rx: 3, fill: 'currentColor', opacity: 0.6 }));
    return svg;
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

  function dateTimeLabel(iso) {
    if (!iso) return '—';
    var when = new Date(iso);
    if (isNaN(when.getTime())) return '—';
    return when.toLocaleString('es-CL', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  function firstName(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }

  function slugify(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
  }

  /* ── API ──────────────────────────────────────────────────────────────── */

  function ApiError(status, message, fields) {
    this.name = 'ApiError';
    this.status = status;
    this.message = message;
    this.fields = fields || {};
  }
  ApiError.prototype = Object.create(Error.prototype);

  /* El errorHandler del Core devuelve { error, errors } y los errores de Zod
   * vienen con flatten(): { fieldErrors: { email: ['...'] } }. */
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
        throw new ApiError(res.status, data.error || 'Algo salió mal. Inténtalo de nuevo.', fieldErrorsOf(data.errors));
      });
    }, function () {
      throw new ApiError(0, 'No pudimos conectarnos con el servidor. Revisa tu conexión.');
    });
  }

  function loadSession() {
    return api('/auth/me').then(function (session) {
      return session;
    }, function (err) {
      if (err instanceof ApiError && err.status === 401) return null;
      throw err;
    });
  }

  function signOut() {
    return api('/auth/logout', { method: 'POST' }).catch(function () { /* igual se sale */ })
      .then(function () { location.assign('/'); });
  }

  /* ── formularios ──────────────────────────────────────────────────────── */

  function field(name, label, options) {
    var opts = options || {};
    var input;
    if (opts.type === 'select') {
      var options_ = opts.options || [];
      input = el('select', { name: name, id: 'f-' + name });
      for (var i = 0; i < options_.length; i++) {
        input.appendChild(el('option', { value: options_[i].value, selected: options_[i].value === opts.value }, options_[i].label));
      }
    } else {
      input = el('input', {
        name: name,
        id: 'f-' + name,
        type: opts.type || 'text',
        value: opts.value === undefined || opts.value === null ? '' : opts.value,
        placeholder: opts.placeholder || '',
        autocomplete: opts.autocomplete || 'off',
        inputmode: opts.inputMode || null,
        minlength: opts.minLength || null,
        maxlength: opts.maxLength || null,
        required: opts.required !== false,
      });
    }
    return el('div', { class: 'field' },
      el('label', { for: 'f-' + name, text: label }),
      input,
      opts.hint ? el('span', { class: 'hint', text: opts.hint }) : null,
      el('span', { class: 'field-error', dataset: { error: name } }),
    );
  }

  function setBusy(button, busy) {
    if (!button) return;
    if (busy) {
      if (button.getAttribute('data-label') === null) button.setAttribute('data-label', button.textContent);
      button.disabled = true;
      mount(button, el('span', { class: 'spinner' }), el('span', { text: button.getAttribute('data-label') }));
    } else {
      button.disabled = false;
      mount(button, button.getAttribute('data-label') || 'Enviar');
    }
  }

  function clearFieldErrors(form) {
    var slots = form.querySelectorAll('[data-error]');
    for (var i = 0; i < slots.length; i++) slots[i].textContent = '';
    var marked = form.querySelectorAll('.is-invalid');
    for (var j = 0; j < marked.length; j++) marked[j].classList.remove('is-invalid');
    var box = form.querySelector('[data-alert]');
    if (box) mount(box);
  }

  function showFieldErrors(form, fields) {
    for (var name in fields) {
      var input = form.querySelector('[name="' + name + '"]');
      var target = form.querySelector('[data-error="' + name + '"]');
      if (input) input.classList.add('is-invalid');
      if (target) target.textContent = fields[name];
    }
  }

  function bindForm(form, handler) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var button = form.querySelector('[type="submit"]');
      var box = form.querySelector('[data-alert]');
      clearFieldErrors(form);
      setBusy(button, true);
      var values = {};
      var data = new FormData(form);
      data.forEach(function (value, key) { values[key] = typeof value === 'string' ? value.trim() : value; });
      Promise.resolve()
        .then(function () { return handler(values, form); })
        .catch(function (err) {
          if (err instanceof ApiError) {
            showFieldErrors(form, err.fields);
            if (box) mount(box, el('div', { class: 'alert alert--bad', role: 'alert', text: err.message }));
            else flash('bad', err.message);
          } else {
            if (window.console) console.error(err);
            if (box) mount(box, el('div', { class: 'alert alert--bad', role: 'alert', text: 'Algo salió mal. Inténtalo de nuevo.' }));
            else flash('bad', 'Algo salió mal. Inténtalo de nuevo.');
          }
        })
        .then(function () { setBusy(button, false); });
    });
  }

  function flash(kind, message) {
    var target = document.querySelector('[data-toast]');
    if (!target) return;
    mount(target, el('div', { class: 'alert alert--' + kind, role: 'status', text: message }));
    if (kind === 'ok') setTimeout(function () { mount(target); }, 6000);
  }

  /* ── piezas de UI ─────────────────────────────────────────────────────── */

  function panel(title, subtitle) {
    var body = Array.prototype.slice.call(arguments, 2);
    return el('section', { class: 'card stack' },
      el('div', { class: 'row-between' },
        el('div', {},
          el('h2', { text: title }),
          subtitle ? el('p', { class: 'small soft', text: subtitle }) : null,
        ),
      ),
      body,
    );
  }

  function authCard(title, subtitle) {
    var body = Array.prototype.slice.call(arguments, 2);
    return el('div', { class: 'card card--pad-lg stack' },
      el('div', { class: 'stack' },
        el('h1', { text: title }),
        subtitle ? el('p', { class: 'small soft', text: subtitle }) : null,
      ),
      body,
    );
  }

  function errorBox(err) {
    var message = err instanceof ApiError ? err.message : 'No pudimos cargar esta información.';
    return el('div', { class: 'alert alert--bad', text: message });
  }

  function emptyBox(message) {
    return el('div', { class: 'card card--flat center soft small', text: message });
  }

  function skeletons(count) {
    var out = [];
    for (var i = 0; i < count; i++) out.push(el('div', { class: 'card skeleton', style: 'height: 11rem' }));
    return out;
  }

  function accessTag(state) {
    if (!state) return el('span', { class: 'tag', text: '—' });
    if (state.allowed) {
      return el('span', { class: 'tag tag--ok' }, el('span', { class: 'dot' }), 'Activa');
    }
    var labels = {
      'organizacion-inactiva': ['tag--bad', 'Organización suspendida'],
      'producto-inexistente': ['tag--bad', 'No disponible'],
      'producto-inactivo': ['tag--bad', 'Fuera de servicio'],
      'sin-suscripcion': ['tag', 'Sin contratar'],
      'suscripcion-vencida': ['tag--warn', 'Vencida'],
      'suscripcion-no-activa': ['tag--warn', 'Pendiente'],
    };
    var found = labels[state.reason] || ['tag', state.reason || '—'];
    return el('span', { class: 'tag ' + found[0] }, el('span', { class: 'dot' }), found[1]);
  }

  /* ── chrome ───────────────────────────────────────────────────────────── */

  function renderShell(session) {
    var header = document.querySelector('[data-topbar]');
    if (header) {
      var here = location.pathname;
      var nav = [
        el('a', { href: '/productos', text: 'Productos', 'aria-current': here === '/productos' || here === '/precios' ? 'page' : null }),
        el('a', { href: '/mis-aplicaciones', text: 'Mis aplicaciones', 'aria-current': here === '/mis-aplicaciones' || here === '/contratar' ? 'page' : null }),
        el('a', { href: '/contacto', text: 'Contacto', 'aria-current': here === '/contacto' || here === '/demos' ? 'page' : null }),
      ];
      if (session) {
        nav.push(el('a', { class: 'btn btn--sm btn--ghost', href: '/mi-cuenta', text: firstName(session.user.name) || 'Mi cuenta' }));
        nav.push(el('button', { class: 'btn btn--sm', type: 'button', text: 'Salir', onclick: signOut }));
      } else {
        nav.push(el('a', { class: 'btn btn--sm btn--ghost', href: '/login', text: 'Ingresar' }));
        nav.push(el('a', { class: 'btn btn--sm', href: '/registro', text: 'Crear cuenta' }));
      }
      mount(header, el('div', { class: 'wrap topbar__in' },
        el('a', { class: 'brand', href: '/', 'aria-label': 'AMG, inicio' }, logo(), el('span', { text: 'AMG' })),
        el('nav', { class: 'nav', 'aria-label': 'Navegación principal' }, nav),
      ));
    }

    var footer = document.querySelector('[data-footer]');
    if (footer) {
      mount(footer, el('div', { class: 'wrap footer__in' },
        el('span', { text: '© ' + new Date().getFullYear() + ' AMG · Suite de herramientas operativas' }),
        el('span', { class: 'row' },
          el('a', { href: '/productos', text: 'Productos' }),
          el('a', { href: '/contacto', text: 'Contacto' }),
          el('a', { href: 'https://wa.me/56953818617', target: '_blank', rel: 'noopener', text: 'WhatsApp' }),
        ),
      ));
    }
  }

  function requireSession(session) {
    if (session) return;
    location.replace('/login?return_to=' + encodeURIComponent(location.pathname + location.search));
  }

  /* Solo rutas internas: el Core igual sanea, pero no leemos un host ajeno.
   * Sin return_to explícito, se vuelve a la landing (/), que es ahora la base:
   * ahí ya se ven la sesión y las aplicaciones activas. */
  function returnTarget() {
    var raw = new URLSearchParams(location.search).get('return_to');
    if (raw && /^\/(?!\/)/.test(raw)) return raw;
    return '/';
  }

  /* ── páginas ──────────────────────────────────────────────────────────── */

  var pages = {};

  /* Catálogo público. Sin sesión: el precio es información de venta. */
  pages.productos = function (session) {
    var target = slot('catalogo');
    var search = slot('buscar');
    var count = slot('conteo');
    mount(target, skeletons(6));

    return api('/products').then(function (data) {
      var products = data.products || [];
      var grid = el('div', { class: 'grid grid--2' });

      function draw(list) {
        if (count) {
          count.textContent = list.length === products.length
            ? products.length + (products.length === 1 ? ' herramienta' : ' herramientas')
            : list.length + ' de ' + products.length;
        }
        if (list.length === 0) {
          mount(grid, emptyBox('Ninguna herramienta coincide con tu búsqueda.'));
          return;
        }
        mount(grid, list.map(function (product) { return productCard(product, session); }));
      }

      if (search) {
        search.addEventListener('input', function () {
          var term = search.value.trim().toLowerCase();
          if (!term) { draw(products); return; }
          draw(products.filter(function (product) {
            return (product.name + ' ' + (product.tagline || '') + ' ' + product.description).toLowerCase().indexOf(term) >= 0;
          }));
        });
      }

      draw(products);
      mount(target, grid);
    }).catch(function (err) {
      mount(target, errorBox(err));
    });
  };

  function productCard(product, session) {
    var detail = '/productos/' + encodeURIComponent(product.slug);
    var activate = session
      ? '/contratar?p=' + encodeURIComponent(product.slug)
      : '/login?return_to=' + encodeURIComponent('/contratar?p=' + product.slug);
    return el('article', { class: 'card product' },
      el('div', { class: 'product__top' },
        el('a', { class: 'product__title', href: detail }, el('h3', { text: product.name })),
        el('span', { class: 'tag', text: periodLabel(product.billing_period) }),
      ),
      product.tagline ? el('p', { class: 'small soft', text: product.tagline }) : null,
      el('p', { class: 'small mute mt', text: product.description }),
      el('div', { class: 'product__foot' },
        el('span', { class: 'product__price', text: money(product.price, product.currency) }),
        el('span', { class: 'row' },
          el('a', { class: 'btn btn--sm btn--ghost', href: detail, text: 'Detalle' }),
          el('a', { class: 'btn btn--sm', href: activate, text: 'Activar' }),
        ),
      ),
    );
  }

  pages.producto = function (session) {
    var target = slot('detalle');
    var slug = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
    mount(target, el('div', { class: 'card skeleton', style: 'height: 16rem' }));

    return api('/products/' + encodeURIComponent(slug)).then(function (data) {
      var product = data.product;
      document.title = product.name + ' · AMG';
      var activate = session
        ? '/contratar?p=' + encodeURIComponent(product.slug)
        : '/login?return_to=' + encodeURIComponent('/contratar?p=' + product.slug);
      mount(target, el('div', { class: 'grid grid--2' },
        el('div', { class: 'stack' },
          el('a', { class: 'small mute', href: '/productos', text: '← Todos los productos' }),
          el('h1', { text: product.name }),
          product.tagline ? el('p', { class: 'soft', text: product.tagline }) : null,
          el('p', { class: 'soft', text: product.description }),
          product.app_url
            ? el('p', { class: 'small mute mono', text: product.app_url })
            : el('p', { class: 'small mute' }, el('span', { class: 'tag tag--warn' }, el('span', { class: 'dot' }), 'Próximamente')),
        ),
        el('div', { class: 'card card--pad-lg stack' },
          el('span', { class: 'tag', text: periodLabel(product.billing_period) }),
          el('div', { class: 'product__price', style: 'font-size: 1.6rem', text: money(product.price, product.currency) }),
          el('a', { class: 'btn btn--block', href: activate, text: 'Activar ahora' }),
          el('p', { class: 'small mute center' }, 'La activación la confirma AMG. Puedes administrarla desde ', el('a', { href: '/mis-aplicaciones', text: 'Mis aplicaciones' }), '.'),
        ),
      ));
    }).catch(function (err) {
      mount(target, el('div', { class: 'stack' },
        errorBox(err),
        el('a', { class: 'btn btn--ghost', href: '/productos', text: 'Ver todos los productos' }),
      ));
    });
  };

  /* ── autenticación ────────────────────────────────────────────────────── */

  var AUTH_MODES = {
    '/login': 'login',
    '/registro': 'registro',
    '/recuperar': 'recuperar',
    '/reset': 'reset',
    '/verificar-email': 'verificar',
    '/invitacion': 'invitacion',
  };

  pages.auth = function (session) {
    var mode = AUTH_MODES[location.pathname] || 'login';
    var target = slot('panel');
    var params = new URLSearchParams(location.search);

    if (session && (mode === 'login' || mode === 'registro' || mode === 'invitacion')) {
      location.replace(returnTarget());
      return Promise.resolve();
    }

    if (mode === 'registro') return renderRegistro(target);
    if (mode === 'recuperar') return renderRecuperar(target);
    if (mode === 'reset') return renderReset(target, params.get('token'));
    if (mode === 'verificar') return renderVerificar(target, params.get('token'));
    if (mode === 'invitacion') return renderInvitacion(target, params.get('token'));
    return renderLogin(target);
  };

  function renderLogin(target) {
    document.title = 'Ingresar · AMG';
    var back = new URLSearchParams(location.search).get('return_to') || '';
    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      field('email', 'Correo', { type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'tucorreo@negocio.cl' }),
      field('password', 'Contraseña', { type: 'password', autocomplete: 'current-password' }),
      back ? el('input', { type: 'hidden', name: 'returnUrl', value: back }) : null,
      el('button', { class: 'btn btn--block', type: 'submit', text: 'Ingresar' }),
      el('p', { class: 'small mute center' }, '¿Olvidaste tu contraseña? ', el('a', { href: '/recuperar', text: 'Recuperarla' })),
    );
    bindForm(form, function (values) {
      return api('/auth/login', {
        method: 'POST',
        body: { email: values.email, password: values.password, returnUrl: values.returnUrl || undefined },
      }).then(function (result) {
        location.assign(result.return_url || returnTarget());
      });
    });
    mount(target, authCard('Ingresa a tu cuenta', 'Un solo acceso para todas tus herramientas.', form));
  }

  function renderRegistro(target) {
    document.title = 'Crear cuenta · AMG';
    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      field('name', 'Tu nombre', { autocomplete: 'name', placeholder: 'Andrea González' }),
      field('email', 'Correo', { type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'tucorreo@negocio.cl' }),
      field('password', 'Contraseña', { type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'Mínimo 8 caracteres' }),
      field('organizationName', 'Nombre del negocio', { placeholder: 'Salón Aurora' }),
      field('organizationSlug', 'Identificador del negocio', {
        required: false,
        hint: 'Solo minúsculas, números y guiones. Queda como tu enlace público.',
      }),
      el('button', { class: 'btn btn--block', type: 'submit', text: 'Crear cuenta' }),
      el('p', { class: 'small mute center' }, '¿Ya tienes cuenta? ', el('a', { href: '/login', text: 'Ingresa' })),
    );

    var nameInput = form.querySelector('[name="organizationName"]');
    var slugInput = form.querySelector('[name="organizationSlug"]');
    var slugEdited = false;
    slugInput.addEventListener('input', function () { slugEdited = true; });
    nameInput.addEventListener('input', function () {
      if (!slugEdited) slugInput.value = slugify(nameInput.value);
    });

    bindForm(form, function (values) {
      var body = {
        name: values.name,
        email: values.email,
        password: values.password,
        organizationName: values.organizationName,
      };
      if (values.organizationSlug) body.organizationSlug = values.organizationSlug;
      return api('/auth/register', { method: 'POST', body: body }).then(function () {
        location.assign('/');
      });
    });
    mount(target, authCard('Crea tu cuenta', 'Un solo acceso para todas las herramientas de AMG.', form));
  }

  function renderRecuperar(target) {
    document.title = 'Recuperar contraseña · AMG';
    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      field('email', 'Correo', { type: 'email', autocomplete: 'email', inputMode: 'email', placeholder: 'tucorreo@negocio.cl' }),
      el('button', { class: 'btn btn--block', type: 'submit', text: 'Enviar enlace' }),
      el('p', { class: 'small mute center' }, el('a', { href: '/login', text: 'Volver a ingresar' })),
    );
    bindForm(form, function (values) {
      return api('/auth/password/forgot', { method: 'POST', body: { email: values.email } }).then(function (result) {
        mount(target, authCard('Revisa tu correo', result.message,
          el('a', { class: 'btn btn--ghost btn--block', href: '/login', text: 'Volver a ingresar' })));
      });
    });
    mount(target, authCard('Recupera tu contraseña', 'Te enviamos un enlace para crear una nueva.', form));
  }

  function renderReset(target, token) {
    document.title = 'Nueva contraseña · AMG';
    if (!token) {
      mount(target, authCard('Enlace incompleto', 'El enlace de recuperación está incompleto.',
        el('a', { class: 'btn btn--ghost btn--block', href: '/recuperar', text: 'Pedir uno nuevo' })));
      return;
    }
    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      field('password', 'Nueva contraseña', { type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'Mínimo 8 caracteres' }),
      field('confirm', 'Repite la contraseña', { type: 'password', autocomplete: 'new-password' }),
      el('button', { class: 'btn btn--block', type: 'submit', text: 'Guardar contraseña' }),
    );
    bindForm(form, function (values) {
      if (values.password !== values.confirm) throw new ApiError(400, 'Las contraseñas no coinciden');
      return api('/auth/password/reset', { method: 'POST', body: { token: token, password: values.password } })
        .then(function (result) {
          mount(target, authCard('Contraseña cambiada', result.message,
            el('a', { class: 'btn btn--block', href: '/login', text: 'Ingresar' })));
        });
    });
    mount(target, authCard('Elige una nueva contraseña', 'Con esto tu contraseña anterior deja de servir.', form));
  }

  function renderVerificar(target, token) {
    document.title = 'Verificar correo · AMG';
    if (!token) {
      mount(target, authCard('Enlace incompleto', 'El enlace de verificación está incompleto.',
        el('a', { class: 'btn btn--ghost btn--block', href: '/login', text: 'Volver a ingresar' })));
      return;
    }
    mount(target, authCard('Verificando tu correo', 'Un momento…',
      el('div', { class: 'row' }, el('span', { class: 'spinner', style: 'border-color: var(--surface-highest); border-top-color: var(--ink-soft)' }))));

    return api('/auth/verify-email', { method: 'POST', body: { token: token } }).then(function (result) {
      mount(target, authCard('Correo verificado',
        result.alreadyVerified ? 'Ese correo ya estaba verificado.' : 'Listo. Ya puedes usar todas tus herramientas.',
        el('a', { class: 'btn btn--block', href: '/login', text: 'Ingresar' })));
    }).catch(function (err) {
      mount(target, authCard('No pudimos verificar', err instanceof ApiError ? err.message : 'Inténtalo de nuevo.',
        el('a', { class: 'btn btn--ghost btn--block', href: '/login', text: 'Volver a ingresar' })));
    });
  }

  function renderInvitacion(target, token) {
    document.title = 'Aceptar invitación · AMG';
    if (!token) {
      mount(target, authCard('Enlace incompleto', 'El enlace de invitación está incompleto.',
        el('a', { class: 'btn btn--ghost btn--block', href: '/login', text: 'Volver a ingresar' })));
      return;
    }
    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      field('name', 'Tu nombre', { autocomplete: 'name' }),
      field('password', 'Elige tu contraseña', { type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'Mínimo 8 caracteres' }),
      field('confirm', 'Repite la contraseña', { type: 'password', autocomplete: 'new-password' }),
      el('button', { class: 'btn btn--block', type: 'submit', text: 'Aceptar invitación' }),
    );
    bindForm(form, function (values) {
      if (values.password !== values.confirm) throw new ApiError(400, 'Las contraseñas no coinciden');
      return api('/auth/invitations/accept', {
        method: 'POST',
        body: { token: token, name: values.name, password: values.password },
      }).then(function () {
        location.assign('/');
      });
    });
    mount(target, authCard('Te invitaron a AMG', 'Crea tu contraseña para entrar.', form));
  }

  /* ── mi cuenta ────────────────────────────────────────────────────────── */

  pages.cuenta = function (session) {
    requireSession(session);
    var target = slot('cuenta');
    mount(target, el('div', { class: 'card skeleton', style: 'height: 20rem' }));

    return api('/account/summary').then(function (data) {
      var isAdmin = data.role === 'admin' || data.role === 'owner';
      mount(target, el('div', { class: 'stack-lg' },
        el('div', { dataset: { toast: '' } }),
        perfil(data),
        data.organizations.length > 1 ? cambiarOrganizacion(data) : null,
        isAdmin ? datosOrganizacion(data) : null,
        isAdmin ? miembros(data) : null,
        seguridad(data),
        facturacion(data),
      ));
    }).catch(function (err) {
      if (err instanceof ApiError && err.status === 401) { requireSession(null); return; }
      mount(target, errorBox(err));
    });
  };

  function perfil(data) {
    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      el('div', { class: 'grid grid--2' },
        field('name', 'Nombre', { value: data.user.name, autocomplete: 'name' }),
        field('email', 'Correo', { type: 'email', value: data.user.email, autocomplete: 'email', inputMode: 'email' }),
      ),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--sm', type: 'submit', text: 'Guardar cambios' }),
        el('span', { class: 'row' },
          el('span', { class: 'tag' + (data.user.email_verified_at ? ' tag--ok' : ' tag--warn') },
            el('span', { class: 'dot' }),
            data.user.email_verified_at ? 'Correo verificado' : 'Correo sin verificar'),
          el('span', { class: 'tag' }, el('span', { class: 'dot' }), 'Rol: ' + data.role),
        ),
      ),
    );
    bindForm(form, function (values) {
      return api('/auth/profile', { method: 'PATCH', body: { name: values.name, email: values.email } })
        .then(function () { flash('ok', 'Perfil actualizado.'); });
    });
    return panel('Tu perfil', 'Datos de la persona que usa la cuenta.', form);
  }

  function cambiarOrganizacion(data) {
    var select = el('select', { id: 'f-org' });
    for (var i = 0; i < data.organizations.length; i++) {
      var org = data.organizations[i];
      select.appendChild(el('option', { value: org.organization ? org.organization.id : org.id, selected: (org.organization ? org.organization.id : org.id) === data.organization.id },
        (org.organization ? org.organization.name : org.name) + ' · ' + org.role));
    }
    var form = el('form', { class: 'row' },
      el('div', { class: 'field grow' }, el('label', { for: 'f-org', text: 'Estás trabajando en' }), select),
      el('button', { class: 'btn', type: 'submit', text: 'Cambiar' }),
    );
    bindForm(form, function () {
      return api('/auth/switch-organization', { method: 'POST', body: { organizationId: select.value } })
        .then(function () { location.reload(); });
    });
    return panel('Organizaciones', 'Perteneces a más de una. Elige con cuál operas.', form);
  }

  function datosOrganizacion(data) {
    var form = el('form', { class: 'row', novalidate: true },
      el('div', { class: 'field grow' },
        el('label', { for: 'f-orgname', text: 'Nombre de la organización' }),
        el('input', { id: 'f-orgname', name: 'name', value: data.organization.name, maxlength: 80, required: true }),
        el('span', { class: 'field-error', dataset: { error: 'name' } }),
      ),
      el('button', { class: 'btn', type: 'submit', text: 'Guardar' }),
    );
    bindForm(form, function (values) {
      return api('/account/organization', { method: 'PATCH', body: { name: values.name } })
        .then(function () { flash('ok', 'Organización actualizada.'); });
    });
    return panel('Organización', data.organization.name, form);
  }

  function miembros(data) {
    var isOwner = data.role === 'owner';
    var body = el('div', { class: 'stack' },
      el('div', { class: 'list', id: 'lista-miembros' }, el('div', { class: 'skeleton', style: 'height: 3rem' })),
    );

    api('/account/members').then(function (result) {
      mount(byId('lista-miembros'), result.members.length ? result.members.map(function (member) {
        return memberRow(member, data, isOwner);
      }) : el('div', { class: 'soft small', style: 'padding: 0.85rem 0', text: 'Todavía no hay nadie más.' }));
    }).catch(function (err) { mount(byId('lista-miembros'), errorBox(err)); });

    if (isOwner) {
      var invite = el('form', { class: 'row', novalidate: true },
        el('div', { class: 'field grow' },
          el('label', { for: 'f-invite', text: 'Invitar por correo' }),
          el('input', { id: 'f-invite', name: 'email', type: 'email', placeholder: 'persona@negocio.cl', required: true }),
          el('span', { class: 'field-error', dataset: { error: 'email' } }),
        ),
        el('div', { class: 'field' },
          el('label', { for: 'f-inviterole', text: 'Rol' }),
          el('select', { id: 'f-inviterole', name: 'role' },
            el('option', { value: 'member' }, 'member'),
            el('option', { value: 'admin' }, 'admin'),
          ),
        ),
        el('button', { class: 'btn', type: 'submit', text: 'Invitar' }),
      );
      bindForm(invite, function (values) {
        return api('/auth/organizations/' + encodeURIComponent(data.organization.id) + '/invitations', {
          method: 'POST',
          body: { email: values.email, role: values.role },
        }).then(function () { flash('ok', 'Invitación enviada. Le llega un enlace por correo.'); });
      });
      body.appendChild(el('div', { class: 'divider', text: 'invitar' }));
      body.appendChild(invite);
    }

    return panel('Miembros', isOwner ? 'Invita a tu equipo y define qué puede hacer.' : 'Personas con acceso a esta organización.', body);
  }

  function memberRow(member, data, isOwner) {
    var isSelf = member.user_id === data.user.id;
    var roles = [
      { value: 'owner', label: 'owner' },
      { value: 'admin', label: 'admin' },
      { value: 'member', label: 'member' },
    ];
    /* Solo el owner (o la propia persona) puede cambiar su rol. Si no, ni le
     * dibujamos el control: el Core lo rechazaría igual y es mejor no ofrecer
     * un botón que nunca va a funcionar. */
    var editable = isOwner || isSelf;
    var control;
    if (editable) {
      var select = el('select', { 'aria-label': 'Rol de ' + member.name },
        roles.map(function (role) { return el('option', { value: role.value, selected: role.value === member.role }, role.label); }));
      select.addEventListener('change', function () {
        api('/auth/organizations/' + encodeURIComponent(data.organization.id) + '/members/' + encodeURIComponent(member.user_id), {
          method: 'PUT',
          body: { role: select.value },
        }).then(function () { flash('ok', 'Rol actualizado.'); })
          .catch(function (err) { flash('bad', err.message); location.reload(); });
      });
      control = select;
    } else {
      control = el('span', { class: 'tag', text: member.role });
    }

    var actions = [control];
    if (isOwner && !isSelf) {
      var revoke = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Sacar' });
      revoke.addEventListener('click', function () {
        if (!window.confirm('¿Sacar a ' + member.name + ' de la organización?')) return;
        api('/auth/organizations/' + encodeURIComponent(data.organization.id) + '/members/' + encodeURIComponent(member.user_id), { method: 'DELETE' })
          .then(function () { location.reload(); })
          .catch(function (err) { flash('bad', err.message); });
      });
      actions.push(revoke);
    }

    return el('div', { class: 'list__row' },
      el('div', {},
        el('div', {}, el('strong', { text: member.name }), isSelf ? el('span', { class: 'mute', text: ' (tú)' }) : null),
        el('div', { class: 'small mute', text: member.email + ' · ' + dateLabel(member.joined_at) }),
      ),
      el('div', { class: 'row' }, actions),
    );
  }

  function seguridad(data) {
    var lista = el('div', { class: 'list' }, el('div', { class: 'skeleton', style: 'height: 3rem' }));
    var body = el('div', { class: 'stack' }, lista);

    api('/auth/sessions').then(function (result) {
      mount(lista, result.sessions.map(function (item) {
        var row = el('div', { class: 'list__row' },
          el('div', {},
            el('div', { class: 'row' },
              el('strong', { text: item.current ? 'Esta sesión' : 'Otra sesión' }),
              item.current ? el('span', { class: 'tag tag--ok' }, el('span', { class: 'dot' }), 'Actual') : null,
            ),
            el('div', { class: 'small mute', text: [item.ip, item.user_agent].filter(Boolean).join(' · ') || 'Sin datos' }),
            el('div', { class: 'small mute', text: 'Última actividad ' + relativeLabel(item.last_seen_at) + ' · vence ' + dateLabel(item.expires_at) }),
          ),
        );
        if (!item.current) {
          var revoke = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Cerrar' });
          revoke.addEventListener('click', function () {
            api('/auth/sessions/' + encodeURIComponent(item.id), { method: 'DELETE' })
              .then(function () { location.reload(); })
              .catch(function (err) { flash('bad', err.message); });
          });
          row.appendChild(el('div', {}, revoke));
        }
        return row;
      }));
    }).catch(function (err) { mount(lista, errorBox(err)); });

    var logoutAll = el('button', { class: 'btn btn--sm btn--danger', type: 'button', text: 'Cerrar todas mis sesiones' });
    logoutAll.addEventListener('click', function () {
      if (!window.confirm('Se cerrarán todas tus sesiones, incluida esta. ¿Seguir?')) return;
      api('/auth/sessions', { method: 'DELETE' })
        .then(function () { location.assign('/login'); })
        .catch(function (err) { flash('bad', err.message); });
    });
    body.appendChild(el('div', { class: 'divider', text: 'contraseña' }));

    var form = el('form', { class: 'stack', novalidate: true },
      el('div', { dataset: { alert: '' } }),
      el('div', { class: 'grid grid--2' },
        field('currentPassword', 'Contraseña actual', { type: 'password', autocomplete: 'current-password' }),
        field('newPassword', 'Nueva contraseña', { type: 'password', autocomplete: 'new-password', minLength: 8, hint: 'Mínimo 8 caracteres' }),
      ),
      el('div', { class: 'row' },
        el('button', { class: 'btn btn--sm', type: 'submit', text: 'Cambiar contraseña' }),
        logoutAll,
      ),
    );
    bindForm(form, function (values) {
      return api('/auth/password', {
        method: 'POST',
        body: { currentPassword: values.currentPassword, newPassword: values.newPassword },
      }).then(function (result) {
        form.reset();
        flash('ok', result.message);
      });
    });
    body.appendChild(form);

    return panel('Seguridad', 'Sesiones abiertas y contraseña.', body);
  }

  function facturacion(data) {
    var body = el('div', { class: 'stack' },
      el('div', { class: 'row' },
        el('span', { class: 'tag tag--ok' }, el('span', { class: 'dot' }), data.active + (data.active === 1 ? ' activa' : ' activas')),
        el('span', { class: 'tag' }, el('span', { class: 'dot' }), data.available + ' disponibles'),
        el('a', { class: 'btn btn--sm', href: '/mis-aplicaciones', text: 'Administrar' }),
      ),
      data.role === 'owner' ? null : el('p', { class: 'small mute', text: 'Solo el owner puede activar o cancelar suscripciones.' }),
      el('div', { class: 'list', id: 'lista-pagos' }, el('div', { class: 'skeleton', style: 'height: 3rem' })),
    );

    api('/account/payments').then(function (result) {
      mount(byId('lista-pagos'), result.payments.length
        ? el('table', {},
            el('thead', {}, el('tr', {},
              el('th', { text: 'Fecha' }),
              el('th', { class: 'num', text: 'Monto' }),
              el('th', { text: 'Estado' }),
              el('th', { text: 'Origen' }),
            )),
            el('tbody', {}, result.payments.map(function (payment) {
              return el('tr', {},
                el('td', { text: dateLabel(payment.paid_at || payment.created_at) }),
                el('td', { class: 'num', text: money(payment.amount, payment.currency) }),
                el('td', {}, el('span', { class: 'tag ' + (payment.status === 'paid' ? 'tag--ok' : payment.status === 'failed' ? 'tag--bad' : 'tag--warn') },
                  el('span', { class: 'dot' }), payment.status)),
                el('td', { class: 'small mute', text: payment.provider }),
              );
            })),
          )
        : el('div', { class: 'soft small', style: 'padding: 0.85rem 0', text: 'Todavía no hay pagos registrados.' }));
    }).catch(function () { mount(byId('lista-pagos'), el('div')); });

    return panel('Facturación', 'Suscripciones y pagos de AMG.', body);
  }

  /* ── mis aplicaciones ─────────────────────────────────────────────────── */

  pages.aplicaciones = function (session) {
    requireSession(session);
    var target = slot('aplicaciones');
    var focus = new URLSearchParams(location.search).get('p');
    mount(target, skeletons(3));

    return api('/account/applications').then(function (data) {
      var isOwner = session.role === 'owner';
      function reload() { return pages.aplicaciones(session); }

      mount(target, el('div', { class: 'stack-lg' },
        el('div', { dataset: { toast: '' } }),
        el('div', { class: 'page-head' },
          el('h1', { text: 'Mis aplicaciones' }),
          el('p', { class: 'soft', text: 'Herramientas activas de ' + data.organization.name + ' y las que puedes contratar.' }),
        ),
        el('section', { class: 'stack' },
          el('h2', { text: 'Activas' }),
          data.active.length
            ? el('div', { class: 'grid grid--2' }, data.active.map(function (entry) {
                return appCard(entry, true, isOwner, focus, reload);
              }))
            : emptyBox('Todavía no tienes ninguna herramienta activa. Elige una de las de abajo.'),
        ),
        el('section', { class: 'stack' },
          el('h2', { text: 'Disponibles' }),
          data.available.length
            ? el('div', { class: 'grid grid--2' }, data.available.map(function (entry) {
                return appCard(entry, false, isOwner, focus, reload);
              }))
            : emptyBox('No hay herramientas disponibles por ahora.'),
        ),
      ));

      if (focus) {
        var targetCard = target.querySelector('[data-slug="' + focus.replace(/"/g, '') + '"]');
        if (targetCard && targetCard.scrollIntoView) targetCard.scrollIntoView({ block: 'center' });
      }
    }).catch(function (err) {
      if (err instanceof ApiError && err.status === 401) { requireSession(null); return; }
      mount(target, errorBox(err));
    });
  };

  function appCard(entry, contracted, isOwner, focus, reload) {
    var product = entry;
    var state = entry.access;
    var highlight = focus && product.slug === focus;
    var actions = [];

    if (contracted) {
      if (product.app_url) {
        actions.push(el('a', { class: 'btn btn--sm', href: product.app_url, target: '_blank', rel: 'noopener', text: 'Abrir' }));
      } else {
        actions.push(el('span', { class: 'tag tag--warn', text: 'Sin URL pública' }));
      }
      if (isOwner) {
        var cancel = el('button', { class: 'btn btn--sm btn--ghost', type: 'button', text: 'Cancelar' });
        cancel.addEventListener('click', function () {
          var subscription = state && state.subscription;
          if (!subscription) return;
          if (!window.confirm('¿Cancelar ' + product.name + '? Perderás el acceso.')) return;
          setBusy(cancel, true);
          api('/account/subscriptions/' + encodeURIComponent(subscription.id) + '/cancel', { method: 'POST' })
            .then(reload)
            .catch(function (err) { setBusy(cancel, false); flash('bad', err.message); });
        });
        actions.push(cancel);
      }
    } else if (isOwner) {
      var activate = el('button', { class: 'btn btn--sm', type: 'button', text: 'Activar' });
      activate.addEventListener('click', function () {
        if (!window.confirm('¿Activar ' + product.name + ' por ' + money(product.price, product.currency) + ' ' + periodLabel(product.billing_period) + '?')) return;
        setBusy(activate, true);
        api('/account/subscriptions', { method: 'POST', body: { productSlug: product.slug } })
          .then(function (result) { flash('ok', result.message); return reload(); })
          .catch(function (err) { setBusy(activate, false); flash('bad', err.message); });
      });
      actions.push(activate);
    } else {
      actions.push(el('span', { class: 'small mute', text: 'Pídeselo al owner' }));
    }

    var period = state && state.subscription && state.subscription.current_period_end
      ? ' · hasta el ' + dateLabel(state.subscription.current_period_end)
      : '';

    return el('article', {
      class: 'card product',
      dataset: { slug: product.slug },
      style: highlight ? 'outline: 2px solid var(--accent); outline-offset: 2px' : null,
    },
      el('div', { class: 'product__top' },
        el('a', { class: 'product__title', href: '/productos/' + encodeURIComponent(product.slug) }, el('h3', { text: product.name })),
        accessTag(state),
      ),
      product.tagline ? el('p', { class: 'small soft', text: product.tagline }) : null,
      el('p', { class: 'small mute mt', text: product.description }),
      el('div', { class: 'product__foot' },
        el('span', { class: 'product__price' },
          money(product.price, product.currency),
          el('span', { class: 'mute', text: ' ' + periodLabel(product.billing_period) + period }),
        ),
        el('span', { class: 'row' }, actions),
      ),
    );
  }

  pages.contacto = function () { return Promise.resolve(); };

  /* ── arranque ─────────────────────────────────────────────────────────── */

  function boot() {
    var page = document.body.dataset.page;
    if (!page || !pages[page]) return;

    function run() {
      loadSession().then(function (session) {
        renderShell(session);
        return pages[page](session);
      }).catch(function (err) {
        if (window.console) console.error(err);
      });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
    else run();
  }

  boot();
})();
