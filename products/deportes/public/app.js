/* ============================================================
   Deportes Pro · Frontend SPA (vanilla, sin dependencias)
   Reservas por bloque de canchas/instalaciones. Contratos de
   API: customers, services, resources, appointments, inventory,
   documents, dashboard, auth (core).
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const money = (v) => `$${Number(v ?? 0).toLocaleString('es')}`;
  const moneyCents = (cents) => `$${(Number(cents ?? 0) / 100).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Iconos (un solo lenguaje: stroke, estilo Lucide) ---------- */
  const ICON = {
    menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    prev: '<polyline points="15 18 9 12 15 6"/>',
    next: '<polyline points="9 18 15 12 9 6"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    plusCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>',
    minusCircle: '<circle cx="12" cy="12" r="10"/><line x1="8" y1="12" x2="16" y2="12"/>',
    arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  /* ---------- Estado ---------- */
  const state = {
    session: null,
    tenant: null,
    year: 0, month: 0, monday: null,
    dayFocus: 0,
    resourceFilter: 'all',
    statusFilter: 'all',
    customers: [], services: [], staff: [], resources: [], appointments: [], items: [], documents: [],
    dashboard: null,
    loaded: { customers: false, services: false, staff: false, resources: false, appointments: false, items: false, documents: false },
    busy: false,
    prevFocus: null,
  };

  const STATUS_LABEL = {
    pending: 'Pendiente', confirmed: 'Confirmada', done: 'Completada',
    cancelled: 'Cancelada', noshow: 'No asistió',
  };
  const DOC_STATUS_LABEL = {
    draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada', rejected: 'Rechazada',
  };
  const STATUS_COLOR = {
    pending: 'var(--st-pending)', confirmed: 'var(--st-confirmed)', done: 'var(--st-done)',
    cancelled: 'var(--st-cancelled)', noshow: 'var(--st-noshow)',
  };
  const STATUS_FG = {
    pending: 'var(--st-pending-fg)', confirmed: 'var(--st-confirmed-fg)', done: 'var(--st-done-fg)',
    cancelled: 'var(--st-cancelled-fg)', noshow: 'var(--st-noshow-fg)',
  };

  const isNarrowQ = window.matchMedia('(max-width: 720px)');
  const isNarrow = () => isNarrowQ.matches;

  /* ---------- API ---------- */
  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const isJson = res.headers.get('content-type')?.includes('json');
    if (!res.ok) {
      const body = isJson ? await res.json() : {};
      throw new Error(body.error || `Error ${res.status}`);
    }
    return isJson ? res.json() : res;
  }

  /* ---------- Toast ---------- */
  function toast(message, kind = 'info') {
    const icons = { ok: 'check', error: 'alert', info: 'info' };
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = svg(icons[kind] || 'info', 17) + `<span>${esc(message)}</span>`;
    $('#toasts').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }, 2600);
    setTimeout(() => el.remove(), 2900);
  }

  /* ---------- Modal (accesible) ---------- */
  function openModal(title, html) {
    state.prevFocus = document.activeElement;
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
    requestAnimationFrame(() => {
      const first = $('#modal').querySelector('input:not([type=hidden]):not([disabled]), select, textarea, button');
      if (first) first.focus();
    });
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal-body').innerHTML = '';
    if (state.prevFocus && document.contains(state.prevFocus)) state.prevFocus.focus();
  }
  $('#modal').addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]') || e.target === $('#modal');
    if (close && !$('#modal').classList.contains('hidden')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
  });

  /* ---------- Confirm (sustituye a confirm()) ---------- */
  function confirmDialog({ title = '¿Confirmar?', message = '', danger = false, confirmLabel = 'Eliminar' } = {}) {
    return new Promise((resolve) => {
      const html = `
        <div class="confirm-body">${esc(message)}</div>
        <div class="confirm-actions">
          <button type="button" class="btn ghost" data-confirm-cancel>Cancelar</button>
          <button type="button" class="btn ${danger ? 'danger solid' : 'primary'}" data-confirm-ok>${esc(confirmLabel)}</button>
        </div>`;
      if (!$('#modal').classList.contains('hidden')) closeModal();
      openModal(title, html);
      $('#modal').querySelector('[data-confirm-cancel]').focus();
      $('#modal').querySelector('[data-confirm-ok]').addEventListener('click', () => { closeModal(); resolve(true); });
      $('#modal').querySelector('[data-confirm-cancel]').addEventListener('click', () => { closeModal(); resolve(false); });
      $('#modal').querySelector('[data-close]')?.addEventListener('click', () => resolve(false));
      $('#modal').addEventListener('click', (e) => {
        if (e.target === $('#modal')) { $('#modal').classList.add('hidden'); resolve(false); }
      }, { once: true });
    });
  }

  /* ---------- Estado visual de carga / vacío ---------- */
  function skeletonRows(cells, rows = 4) {
    const tds = Array.from({ length: cells }, () => `<td><div class="skeleton-cell"></div></td>`).join('');
    return Array.from({ length: rows }, () => `<tr>${tds}</tr>`).join('');
  }
  function emptyStateHtml(title, text, btnLabel, action, icon = 'inbox') {
    return `<div class="empty-state">
      <span class="empty-icon">${svg(icon, 24)}</span>
      <h4>${esc(title)}</h4>
      <p>${esc(text)}</p>
      ${btnLabel ? `<button class="btn primary sm" data-empty-action="${esc(action)}" type="button">${svg('plus', 15)} ${esc(btnLabel)}</button>` : ''}
    </div>`;
  }
  function bindEmptyActions(scope) {
    $$('[data-empty-action]', scope).forEach((btn) => btn.addEventListener('click', () => {
      openDialogFor(btn.dataset.emptyAction);
    }));
  }

  /* ---------- Auth ---------- */
  $$('.seg-btn').forEach((btn) => btn.addEventListener('click', () => {
    $$('.seg-btn').forEach((b) => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    const tab = btn.dataset.tab;
    $('#login-form').classList.toggle('hidden', tab !== 'login');
    $('#register-form').classList.toggle('hidden', tab !== 'register');
  }));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', e.target);
    err.textContent = '';
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      enterApp();
    } catch (ex) { err.textContent = ex.message; }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', e.target);
    err.textContent = '';
    try {
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) });
      toast('Cuenta creada. ¡Bienvenido!', 'ok');
      enterApp();
    } catch (ex) { err.textContent = ex.message; }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  });

  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  async function enterApp() {
    const { session, tenant, user } = await api('/api/auth/me');
    state.session = session;
    state.tenant = tenant;
    $('#auth-view').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-chip').textContent = `${user.name}`;
    $('#user-avatar').textContent = initials(user.name);
    $('#user-tenant').textContent = tenant.name;
    document.title = `${tenant.name} · Deportes Pro`;
    await refreshAll();
    switchPane(initialView());
  }

  /* ---------- Navegación (hash + sidebar) ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen del centro hoy'],
    reservas: ['Reservas', 'Bloques por cancha e instalación'],
    clientes: ['Clientes', 'Deportistas registrados'],
    canchas: ['Canchas', 'Canchas e instalaciones'],
    servicios: ['Servicios', 'Paquetes y servicios'],
    inventario: ['Inventario', 'Control de stock'],
    documentos: ['Documentos', 'Cotizaciones y recibos'],
    config: ['Configuración', 'Ajustes del negocio'],
  };
  const ORDER = ['dashboard', 'reservas', 'clientes', 'canchas', 'servicios', 'inventario', 'documentos', 'config'];

  function switchPane(view) {
    if (!VIEW_META[view]) view = 'dashboard';
    $$('.nav-btn').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    $$('[data-view-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.viewPane !== view));
    const [title, sub] = VIEW_META[view];
    $('#view-title').textContent = title;
    $('#view-sub').textContent = sub;
    closeDrawer();
    if (view === 'dashboard') renderDashboard();
    if (window.location.hash !== `#/${view}`) history.replaceState(null, '', `#/${view}`);
  }
  function initialView() {
    const v = (window.location.hash || '').replace('#/', '');
    return VIEW_META[v] ? v : 'dashboard';
  }
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchPane(btn.dataset.view)));
  window.addEventListener('popstate', () => switchPane(initialView()));

  /* Mobile drawer */
  function openDrawer() { $('#sidebar').classList.add('open'); $('#overlay').hidden = false; document.body.style.overflow = 'hidden'; }
  function closeDrawer() { $('#sidebar').classList.remove('open'); $('#overlay').hidden = true; document.body.style.overflow = ''; }
  $('#nav-open').addEventListener('click', openDrawer);
  $('#nav-close').addEventListener('click', closeDrawer);
  $('#overlay').addEventListener('click', closeDrawer);

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 3 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-upcoming').innerHTML = `<div class="empty-state"><div class="skeleton-cell" style="width:80%"></div><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:70%"></div></div>`;
    try {
      const data = await api('/api/dashboard/summary');
      state.dashboard = data;
      fillDashboard();
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-upcoming').innerHTML = `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="dash-retry" type="button">Reintentar</button></div>`;
      $('#dash-retry')?.addEventListener('click', renderDashboard);
    }
  }

  function fillDashboard() {
    const { summary, upcoming } = state.dashboard;
    const activeCanchas = state.resources.filter((r) => r.active);
    const cards = [
      { icon: 'calendar', label: 'Reservas hoy (confirmadas)', value: summary.appointmentsToday, cls: 'ok', hint: 'bloques para esta jornada' },
      { icon: 'scissors', label: 'Canchas activas', value: activeCanchas.length, cls: '', hint: `${state.resources.length} en total` },
      { icon: 'users', label: 'Clientes', value: summary.customers, cls: '', hint: 'deportistas registrados' },
    ];
    $('#dash-metrics').innerHTML = cards.map((c) => `
      <div class="metric-card ${c.cls}">
        <span class="metric-icon">${svg(c.icon, 22)}</span>
        <div class="metric-info">
          <div class="metric-value">${Number(c.value ?? 0)}</div>
          <div class="metric-label">${esc(c.label)}</div>
          <p class="muted" style="font-size:12px;margin-top:4px">${esc(c.hint)}</p>
        </div>
      </div>`).join('');

    const custMap = new Map(state.customers.map((c) => [c.id, c.name]));
    const resMap = new Map(state.resources.map((r) => [r.id, r]));
    if (!upcoming.length) {
      $('#dash-upcoming').innerHTML = `<div class="empty-state"><span class="empty-icon">${svg('clock', 24)}</span><h4>Sin reservas próximas</h4><p>Reserva un bloque para empezar.</p><button class="btn primary sm" data-empty-action="new-appt" type="button">${svg('plus', 15)} Nueva reserva</button></div>`;
      bindEmptyActions($('#dash-upcoming'));
      return;
    }
    $('#dash-upcoming').innerHTML = upcoming.map((a) => {
      const start = new Date(Date.parse(a.start_at));
      const res = resMap.get(a.resource_id);
      const title = res ? `${res.name}` : '—';
      return `<button class="up-item" type="button" data-go-reservas>
        <span class="up-time">${fmtDay(start)}</span>
        <span class="up-body"><b>${esc(custMap.get(a.customer_id) || 'Cliente')}</b><small>${esc(title)}</small></span>
        <span class="tag ${a.status}">${STATUS_LABEL[a.status] || a.status}</span>
        <span class="up-arrow">${svg('arrowRight', 16)}</span>
      </button>`;
    }).join('');
    $('#dash-upcoming').innerHTML += `<div style="padding:10px 20px;border-top:1px solid var(--border)"><button class="btn ghost sm" data-go-reservas type="button">Ver todas en el calendario</button></div>`;
    $$('[data-go-reservas]').forEach((b) => b.addEventListener('click', () => switchPane('reservas')));
  }
  const fmtDay = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  /* ---------- Acciones rápidas ---------- */
  $$('[data-action]').forEach((btn) => btn.addEventListener('click', () => openDialogFor(btn.dataset.action)));

  function openDialogFor(action) {
    switch (action) {
      case 'new-appt': openNewAppointment(Date.now()); break;
      case 'new-customer': openNewCustomer(); break;
      case 'new-service': openNewService(); break;
      case 'new-resource': openNewResource(); break;
      case 'new-item': openNewItem(); break;
      case 'new-stock':
        switchPane('inventario');
        if (state.items.length) openMovement(state.items[0].id);
        else openNewItem();
        break;
      case 'new-doc':
        switchPane('documentos');
        openNewDocument();
        break;
      case 'reload-clientes': renderClientes(); break;
      case 'reload-resources': renderCanchas(); break;
      case 'reload-services': renderServicios(); break;
      case 'reload-items': renderInventario(); break;
      case 'reload-docs': renderDocumentos(); break;
      default: break;
    }
  }

  $('#quick-new').addEventListener('click', () => openNewAppointment(Date.now()));

  /* ============================================================
     RESERVAS (agenda por cancha)
     ============================================================ */
  function startOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    return d;
  }
  function setWeekFromDate(date) {
    const monday = startOfWeek(date);
    state.year = monday.getFullYear();
    state.month = monday.getMonth();
    state.monday = monday;
    state.dayFocus = isNarrow() ? (date.getDay() + 6) % 7 : 0;
    renderAgenda();
  }

  const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const DAY_NAMES_S = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const START_HOUR = 8;
  const END_HOUR = 22;
  const SLOT_H = 46;

  const fmtISODate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  function agendaSkeleton() {
    const ghost = Array.from({ length: (END_HOUR - START_HOUR) * 2 }, () =>
      `<div class="agenda-body-row">${Array.from({ length: 8 }, () => '<div class="agenda-cell"><div class="skeleton-cell"></div></div>').join('')}</div>`).join('');
    return `<div class="agenda-row">${ghost}</div>`;
  }

  async function renderAgenda() {
    const monday = state.monday || startOfWeek(new Date());
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    $('#agenda-range').textContent = `${fmtISODate(monday)} → ${fmtISODate(sunday)}`;

    $('#agenda-grid').innerHTML = agendaSkeleton();
    try {
      const { appointments } = await api(`/api/appointments?from=${fmtISODate(monday)}&to=${fmtISODate(sunday)}`);
      state.appointments = appointments;
    } catch (e) {
      $('#agenda-grid').innerHTML = `<div class="empty-state" style="min-height:260px;justify-content:center"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar la agenda</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="agenda-retry" type="button">Reintentar</button></div>`;
      $('#agenda-retry')?.addEventListener('click', renderAgenda);
      return;
    }

    const resMap = new Map(state.resources.map((r) => [r.id, r]));
    const custMap = new Map(state.customers.map((c) => [c.id, c]));
    const todayKey = new Date().toDateString();

    buildResourceFilter();

    let filtered = state.appointments;
    if (state.resourceFilter !== 'all') filtered = filtered.filter((a) => a.resource_id === state.resourceFilter);
    if (state.statusFilter !== 'all') filtered = filtered.filter((a) => a.status === state.statusFilter);

    const days = isNarrow() ? [state.dayFocus] : [0, 1, 2, 3, 4, 5, 6];
    const columns = days.length + 1;
    const gridCols = `60px repeat(${days.length}, minmax(${isNarrow() ? 0 : 128}px, 1fr))`;

    let head = `<div class="agenda-head" style="grid-template-columns:${gridCols}"><div></div>`;
    for (const i of days) {
      const day = new Date(monday); day.setDate(monday.getDate() + i);
      const isToday = day.toDateString() === todayKey;
      head += `<div class="${isToday ? 'today' : ''}">${isNarrow() ? DAY_NAMES[i] : DAY_NAMES_S[i]} ${day.getDate()}</div>`;
    }
    head += '</div>';

    let body = '';
    for (let h = START_HOUR; h < END_HOUR; h++) {
      for (const [mm, min] of [[0, 0], [30, 1]]) {
        const dayMs = (h * 60 + min * 30) * 60000;
        const label = `${String(h).padStart(2, '0')}:${min === 0 ? '00' : '30'}`;
        let row = `<div class="agenda-body-row" style="grid-template-columns:${gridCols}">`;
        if (min === 0) row += `<div class="agenda-cell hour-label">${label}</div>`;
        else row += `<div class="agenda-cell hour-label"></div>`;

        for (const i of days) {
          const day = new Date(monday); day.setDate(monday.getDate() + i);
          const cellDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min * 30);
          const cellStart = cellDate.getTime();
          const isToday = day.toDateString() === todayKey;
          row += `<div class="agenda-cell${isToday ? ' today' : ''}" data-day="${i}" data-time="${cellStart}" role="gridcell">`;

          const dayApps = filtered.filter((a) => {
            const st = Date.parse(a.start_at);
            const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
            const dayEnd = dayStart + 24 * 60 * 60 * 1000;
            return st >= dayStart && st < dayEnd && st >= cellStart && st < cellStart + 30 * 60000;
          });
          for (const a of dayApps) {
            const cust = custMap.get(a.customer_id);
            const res = resMap.get(a.resource_id);
            const start = Date.parse(a.start_at);
            const dur = Math.max(30, (Date.parse(a.end_at) - start) / 60000);
            const top = ((start - cellStart) / 60000) * (SLOT_H / 30);
            const height = Math.max((dur / 30) * SLOT_H - 5, 26);
            const color = res?.color || '#047857';
            const textColor = luminance(color) < 140 ? '#ffffff' : '#1c1917';
            const timeLabel = fmtDay(new Date(start));
            row += `<div class="agenda-slot ${a.status}" data-appt="${a.id}" tabindex="0" role="button"
                aria-label="${esc(cust?.name || 'Cliente')}, ${esc(res?.name || 'cancha')}, ${timeLabel}, ${STATUS_LABEL[a.status] || a.status}"
                style="top:${top}px;height:${height}px;background:${color}D9;color:${textColor};--st:${STATUS_COLOR[a.status]};--status-fg:${STATUS_FG[a.status]}">
              <span class="slot-time">${timeLabel}</span>
              <b>${esc(cust?.name || '?')}</b>
              <span class="meta">${esc(res?.name || '')}</span>
              ${a.status !== 'confirmed' && a.status !== 'done' ? `<span class="slot-status">${STATUS_LABEL[a.status] || a.status}</span>` : ''}
            </div>`;
          }
          row += `</div>`;
        }
        row += '</div>';
        body += row;
      }
    }

    $('#agenda-grid').innerHTML = `<div class="agenda-row"><div style="display:contents">${head}${body}</div></div>`;

    const dayAppsTotal = state.appointments.filter((a) => Date.parse(a.start_at) >= monday.getTime() && Date.parse(a.start_at) < sunday.getTime() + 86400000);
    const hoyCount = dayAppsTotal.filter((a) => {
      const d = new Date(Date.parse(a.start_at));
      return d.toDateString() === todayKey && ['pending', 'confirmed'].includes(a.status);
    }).length;
    $('#agenda-caption').innerHTML = dayAppsTotal.length
      ? `Reservas programadas esta semana: <b>${filtered.length}</b>${filtered.length !== dayAppsTotal.length ? ' (con filtros)' : ''} · Reservas de hoy: <b>${hoyCount}</b>`
      : 'Sin reservas en esta semana. Haz clic en una franja horaria para agendar un bloque.';

    buildLegend(resMap);
    bindAgendaCells();
    bindSlots();
    updateDayLabel();
  }

  function luminance(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  }

  function buildResourceFilter() {
    const sel = $('#agenda-resource');
    const cur = sel.value;
    const opts = ['<option value="all">Todas las canchas</option>']
      .concat(state.resources.filter((r) => r.active).map((r) => `<option value="${r.id}" ${r.id === cur ? 'selected' : ''}>${esc(r.name)}</option>`))
      .join('');
    sel.innerHTML = opts;
  }

  function buildLegend(resMap) {
    const chips = [...resMap.values()].filter((r) => r.active).map((r) =>
      `<span class="legend-chip"><i style="--b:${r.color}CC;--c:${r.color}"></i>${esc(r.name)}</span>`);
    const stChips = Object.keys(STATUS_LABEL).map((k) =>
      `<span class="legend-chip"><i style="--b:${STATUS_COLOR[k]}33;--c:${STATUS_COLOR[k]}"></i>${STATUS_LABEL[k]}</span>`);
    $('#agenda-legend').innerHTML = chips.concat(stChips).join('');
  }

  function agendaDayAt(daysFromMonday) {
    const monday = state.monday || startOfWeek(new Date());
    const d = new Date(monday);
    d.setDate(monday.getDate() + daysFromMonday);
    return d;
  }

  function bindAgendaCells() {
    $('#agenda-grid').querySelectorAll('.agenda-cell[data-time]').forEach((cell) => {
      cell.addEventListener('click', () => openNewAppointment(Number(cell.dataset.time)));
      cell.addEventListener('dragover', (e) => { if (state.dragAppt) e.preventDefault(); cell.classList.add('drop-ok'); });
      cell.addEventListener('dragleave', () => cell.classList.remove('drop-ok'));
      cell.addEventListener('drop', (e) => {
        e.preventDefault();
        cell.classList.remove('drop-ok');
        if (!state.dragAppt) return;
        void handleAppointmentDrop(state.dragAppt.id, Number(cell.dataset.time));
      });
    });
  }

  function bindSlots() {
    $$('.agenda-slot[data-appt]', $('#agenda-grid')).forEach((slot) => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditAppointment(slot.dataset.appt);
      });
      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEditAppointment(slot.dataset.appt); }
      });
      if (!isNarrow()) {
        slot.draggable = true;
        slot.addEventListener('dragstart', (e) => {
          state.dragAppt = state.appointments.find((a) => a.id === slot.dataset.appt) || null;
          if (state.dragAppt) { e.dataTransfer.setData('text/plain', state.dragAppt.id); slot.classList.add('dragging'); }
        });
        slot.addEventListener('dragend', () => { slot.classList.remove('dragging'); state.dragAppt = null; });
      }
    });
  }

  async function handleAppointmentDrop(id, cellTime) {
    const a = state.appointments.find((x) => x.id === id);
    if (!a) return;
    const startAt = new Date(cellTime).toISOString();
    const durationMin = Math.round((Date.parse(a.end_at) - Date.parse(a.start_at)) / 60000);
    try {
      await api(`/api/appointments/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          customerId: a.customer_id,
          staffId: a.staff_id || null,
          resourceId: a.resource_id || null,
          startAt,
          durationMin,
          serviceIds: (a.services || []).map((s) => s.id),
          notes: a.notes || '',
          status: a.status,
        }),
      });
      toast('Reserva reprogramada', 'ok');
      await renderAgenda();
    } catch (err) { toast(err.message, 'error'); }
  }

  /* Navegación de la agenda */
  $('#agenda-today').addEventListener('click', () => setWeekFromDate(new Date()));
  $('#agenda-prev').addEventListener('click', () => setWeekFromDate(new Date(state.monday).setDate(state.monday.getDate() - 7)));
  $('#agenda-next').addEventListener('click', () => setWeekFromDate(new Date(state.monday).setDate(state.monday.getDate() + 7)));
  $('#agenda-new').addEventListener('click', () => openNewAppointment(Date.now()));

  $('#agenda-day-prev').addEventListener('click', () => { state.dayFocus = (state.dayFocus + 6) % 7; renderAgenda(); });
  $('#agenda-day-next').addEventListener('click', () => { state.dayFocus = (state.dayFocus + 1) % 7; renderAgenda(); });
  $('#agenda-day-today').addEventListener('click', () => {
    state.dayFocus = (new Date().getDay() + 6) % 7;
    setWeekFromDate(new Date());
  });
  isNarrowQ.addEventListener('change', (e) => {
    if (e.matches) state.dayFocus = (new Date().getDay() + 6) % 7;
    else state.dayFocus = 0;
    renderAgenda();
  });

  function updateDayLabel() {
    if (!state.monday) return;
    const d = agendaDayAt(state.dayFocus);
    const el = $('#agenda-day-label');
    if (el) el.textContent = `${DAY_NAMES[state.dayFocus]} ${d.getDate()}/${d.getMonth() + 1}`;
  }

  /* Filtros */
  $('#agenda-resource').addEventListener('change', (e) => { state.resourceFilter = e.target.value; renderAgenda(); });
  $('#agenda-status').addEventListener('change', (e) => { state.statusFilter = e.target.value; renderAgenda(); });

  /* ---------- Formulario de reserva ---------- */
  function pickHtml() {
    const cust = state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const res = state.resources.filter((r) => r.active).map((r) =>
      `<option value="${r.id}" style="color:${r.color}">${esc(r.name)} · ${r.capacity} pers. · ${money(r.pricePerHour)}/h</option>`).join('');
    const serv = state.services.filter((s) => s.active).map((s) =>
      `<option value="${s.id}" data-dur="${s.durationMin}">${esc(s.name)} · ${s.durationMin} min · ${money(s.price)}</option>`).join('');
    return { cust, res, serv };
  }

  const sel = (list, id) => list.replace(`value="${id}"`, `value="${id}" selected`);

  function appointmentFormHtml(a) {
    const { cust, res, serv } = pickHtml();
    const startLocal = a ? localInput(new Date(Date.parse(a.start_at))) : '';
    const services = a ? (a.services || []).map((s) => s.id).join(',') : '';
    const startNoRes = `<option value="">Sin cancha</option>`;
    const resOpts = a && a.resource_id ? sel(res, a.resource_id) : res;
    const statusOpts = Object.entries(STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}" ${a && a.status === k ? 'selected' : ''}>${v}</option>`).join('');

    return `
      <form class="modal-form" novalidate>
        <div class="form-row">
          <label class="field"><span>Cliente</span><select name="customerId">${sel(cust + `<option value="">Selecciona…</option>`, a ? a.customer_id : '')}</select></label>
          <label class="field"><span>Cancha / instalación</span><select name="resourceId">${startNoRes}${resOpts}</select></label>
        </div>
        <label class="field"><span>Servicios / paquetes (opcional, Ctrl+clic para varios)</span>
          <select name="serviceIds" multiple size="4">${services ? markMulti(serv, services) : serv}</select>
        </label>
        <div class="form-row">
          <label class="field"><span>Fecha y hora</span><input type="datetime-local" name="startAt" value="${startLocal}" required /></label>
          <label class="field"><span>Duración (min, bloque)</span><input type="number" name="durationMin" value="${a ? durMinutes(a) : 60}" min="5" max="600" required /></label>
        </div>
        <label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(a?.notes || '')}</textarea></label>
        <div class="form-row">
          <label class="field"><span>Estado</span><select name="status">${statusOpts}</select></label>
        </div>
        <div class="row-actions">
          ${a ? `<button type="button" class="btn danger" data-delete>${svg('trash', 16)} Eliminar</button>` : ''}
          <button type="submit" class="btn primary">${a ? 'Guardar cambios' : 'Reservar bloque'}</button>
        </div>
      </form>`;
  }

  function markMulti(options, selected) {
    const ids = selected.split(',').filter(Boolean);
    return options.split('</option>').map((o) => {
      const m = o.match(/value="([^"]+)"/);
      if (!m) return o + '</option>';
      return ids.includes(m[1]) ? o.replace(`value="${m[1]}"`, `value="${m[1]}" selected`) + '</option>' : o + '</option>';
    }).join('');
  }
  const durMinutes = (a) => Math.round((Date.parse(a.end_at) - Date.parse(a.start_at)) / 60000);
  function localInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function openNewAppointment(atMs) {
    if (!state.resources.length) { toast('Crea primero una cancha/instalación', 'error'); return; }
    if (!state.customers.length) { toast('Crea primero un cliente', 'error'); return; }
    const dt = new Date(atMs);
    dt.setMinutes(Math.round(dt.getMinutes() / 30) * 30, 0, 0);
    openModal('Nueva reserva', appointmentFormHtml(null));
    const startInput = $('#modal').querySelector('input[name="startAt"]');
    if (startInput) startInput.value = localInput(dt);
    bindAppointmentForm(null, dt);
  }

  function openEditAppointment(id) {
    const a = state.appointments.find((x) => x.id === id);
    if (!a) return;
    openModal(`Reserva ${STATUS_LABEL[a.status]?.toLowerCase()}`, appointmentFormHtml(a));
    bindAppointmentForm(a);
    const del = $('#modal').querySelector('[data-delete]');
    if (del) del.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Eliminar reserva', message: `¿Eliminar la reserva del calendario? Esta acción no se puede deshacer.`, danger: true });
      if (!ok) return;
      await api(`/api/appointments/${a.id}`, { method: 'DELETE' });
      closeModal(); toast('Reserva eliminada', 'ok'); await renderAgenda();
    });
  }

  function bindAppointmentForm(existing) {
    const form = $('#modal').querySelector('.modal-form');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const input = {
        customerId: f.get('customerId'),
        staffId: null,
        resourceId: f.get('resourceId') || null,
        startAt: new Date(f.get('startAt')).toISOString(),
        durationMin: Math.max(5, Number(f.get('durationMin')) || 60),
        serviceIds: f.getAll('serviceIds'),
        notes: f.get('notes') || '',
        status: f.get('status'),
      };
      const btn = form.querySelector('button[type=submit]');
      const prevHtml = btn.innerHTML; btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        if (existing) await api(`/api/appointments/${existing.id}`, { method: 'PUT', body: JSON.stringify(input) });
        else await api('/api/appointments', { method: 'POST', body: JSON.stringify(input) });
        closeModal(); toast(existing ? 'Reserva actualizada' : 'Reserva registrada', 'ok');
        await renderAgenda();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.innerHTML = prevHtml; }
    });
  }

  /* ============================================================
     CLIENTES
     ============================================================ */
  async function renderClientes() {
    const tbody = $('#clientes-tbody');
    if (!state.loaded.customers) tbody.innerHTML = skeletonRows(5);
    try {
      const { customers } = await api('/api/customers');
      state.customers = customers;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-clientes')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.customers.length) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('Aún no tienes clientes', 'Registra tu primer cliente para reservar bloques.', 'Registrar cliente', 'new-customer', 'userPlus')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    $('#clientes-count').textContent = `${state.customers.length} cliente${state.customers.length === 1 ? '' : 's'}`;
    $('#clientes-tbody').innerHTML = state.customers.map(customerRow).join('');
    bindTable('#clientes-tbody', 'customers');
  }

  function customerRow(c) {
    return `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td data-label="Teléfono">${esc(c.phone || '—')}</td>
      <td data-label="Correo">${esc(c.email || '—')}</td>
      <td data-label="Notas" class="muted">${esc(c.notes || '—')}</td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${c.id}" type="button" aria-label="Editar ${esc(c.name)}">${svg('edit', 15)} Editar</button>
        <button class="btn danger sm" data-del="${c.id}" type="button" aria-label="Eliminar ${esc(c.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`;
  }

  $('#clientes-search').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const tbody = $('#clientes-tbody');
    tbody.innerHTML = skeletonRows(5);
    try {
      const { customers } = await api(`/api/customers?q=${encodeURIComponent(q)}`);
      if (!customers.length) {
        $('#clientes-count').textContent = 'Sin resultados';
        tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin resultados', `No encontramos clientes con “${q}”.`, 'Registrar cliente', 'new-customer', 'search')}</td></tr>`;
        bindEmptyActions(tbody);
        return;
      }
      $('#clientes-count').textContent = `${customers.length} cliente${customers.length === 1 ? '' : 's'}`;
      tbody.innerHTML = customers.map(customerRow).join('');
      bindTable('#clientes-tbody', 'customers');
    } catch (err) { toast(err.message, 'error'); }
  }, 250));

  function customerFormHtml(c) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>Teléfono</span><input name="phone" value="${esc(c?.phone || '')}" /></label>
        <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(c?.email || '')}" /></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Cumpleaños</span><input name="birthdate" type="date" value="${esc(c?.birthdate || '')}" /></label>
        <label class="field"><span>Etiquetas</span><input name="tags" value="${esc(c?.tags || '')}" /></label>
      </div>
      <label class="field"><span>Notas</span><textarea name="notes" rows="3">${esc(c?.notes || '')}</textarea></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${c ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  function openNewCustomer() {
    openModal('Nuevo cliente', customerFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/customers', 'POST', renderClientes, mapCustomer, 'Agregar');
  }

  /* ============================================================
     CANCHAS / RECURSOS
     ============================================================ */
  async function renderCanchas() {
    const tbody = $('#canchas-tbody');
    if (!state.loaded.resources) tbody.innerHTML = skeletonRows(6);
    try {
      const { resources } = await api('/api/resources');
      state.resources = resources;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-resources')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.resources.length) {
      $('#canchas-tbody').innerHTML = `<tr><td colspan="6">${emptyStateHtml('Aún no tienes canchas', 'Da de alta tu primera instalación para poder reservarla.', 'Crear cancha', 'new-resource', 'scissors')}</td></tr>`;
      bindEmptyActions($('#canchas-tbody'));
      return;
    }
    $('#canchas-tbody').innerHTML = state.resources.map((r) => `<tr>
      <td><span class="dot" style="background:${r.color}"></span><b>${esc(r.name)}</b></td>
      <td data-label="Tipo">${esc(r.type)}</td>
      <td data-label="Capacidad">${r.capacity} pers.</td>
      <td data-label="Precio/hora"><b>${money(r.pricePerHour)}</b></td>
      <td data-label="Estado"><span class="tag ${r.active ? 'confirmed' : 'off'}">${r.active ? 'Activa' : 'Inactiva'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${r.id}" type="button" aria-label="Editar ${esc(r.name)}">${svg('edit', 15)} Editar</button>
        <button class="btn danger sm" data-del="${r.id}" type="button" aria-label="Eliminar ${esc(r.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    bindTable('#canchas-tbody', 'resources');
  }

  function resourceFormHtml(r) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(r?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>Tipo</span><input name="type" value="${esc(r?.type || 'cancha')}" placeholder="cancha, sala, pista…" required /></label>
        <label class="field"><span>Capacidad (personas)</span><input name="capacity" type="number" value="${r?.capacity ?? 10}" min="1" required /></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Precio por hora</span><input name="pricePerHour" type="number" step="0.01" value="${r?.pricePerHour ?? 0}" min="0" required /></label>
        <label class="field"><span>Color en agenda</span><input name="color" type="color" value="${r?.color || '#047857'}" /></label>
      </div>
      <label class="field"><span>Estado</span><select name="active"><option value="true" ${r?.active === false ? '' : 'selected'}>Activa</option><option value="false" ${r?.active === false ? 'selected' : ''}>Inactiva</option></select></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${r ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  function openNewResource() {
    openModal('Nueva cancha / instalación', resourceFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/resources', 'POST', renderCanchas, mapResource);
  }

  /* ============================================================
     SERVICIOS
     ============================================================ */
  async function renderServicios() {
    const tbody = $('#servicios-tbody');
    if (!state.loaded.services) tbody.innerHTML = skeletonRows(5);
    try {
      const { services } = await api('/api/services');
      state.services = services;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-services')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.services.length) {
      $('#servicios-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Aún no tienes servicios', 'Agrega paquetes o servicios para incluir en las reservas.', 'Crear servicio', 'new-service')}</td></tr>`;
      bindEmptyActions($('#servicios-tbody'));
      return;
    }
    $('#servicios-tbody').innerHTML = state.services.map((s) => `<tr>
      <td><b>${esc(s.name)}</b>${s.description ? `<div class="muted" style="font-size:12px">${esc(s.description)}</div>` : ''}</td>
      <td data-label="Duración">${s.durationMin === 0 ? '—' : `${s.durationMin} min`}</td>
      <td data-label="Precio"><b>${money(s.price)}</b></td>
      <td data-label="Estado"><span class="tag ${s.active ? 'confirmed' : 'off'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${s.id}" type="button" aria-label="Editar ${esc(s.name)}">${svg('edit', 15)} Editar</button>
        <button class="btn danger sm" data-del="${s.id}" type="button" aria-label="Eliminar ${esc(s.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    bindTable('#servicios-tbody', 'services');
  }

  function serviceFormHtml(s) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(s?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>Duración (min, 0 = fija)</span><input name="durationMin" type="number" value="${s?.durationMin ?? 60}" min="0" required /></label>
        <label class="field"><span>Precio</span><input name="price" type="number" step="0.01" value="${s?.price ?? 0}" min="0" required /></label>
      </div>
      <label class="field"><span>Descripción</span><input name="description" value="${esc(s?.description || '')}" /></label>
      <label class="field"><span>Estado</span><select name="active"><option value="true" ${s?.active === false ? '' : 'selected'}>Activo</option><option value="false" ${s?.active === false ? 'selected' : ''}>Inactivo</option></select></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${s ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  function openNewService() {
    openModal('Nuevo servicio', serviceFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/services', 'POST', renderServicios, (f) => ({
      name: f.get('name'), durationMin: Number(f.get('durationMin')),
      price: Number(f.get('price')), description: f.get('description') || '',
      active: f.get('active') === 'true',
    }));
  }

  /* ============================================================
     INVENTARIO
     ============================================================ */
  async function renderInventario() {
    const tbody = $('#inventario-tbody');
    if (!state.loaded.items) tbody.innerHTML = skeletonRows(7);
    try {
      const { items } = await api('/api/inventory');
      state.items = items;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-items')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const low = state.items.filter((i) => i.quantity <= i.minQty).length;
    $('#inventario-low').textContent = low;
    if (!state.items.length) {
      $('#inventario-tbody').innerHTML = `<tr><td colspan="7">${emptyStateHtml('Sin artículos en inventario', 'Registra balones y equipo para controlar el stock del centro.', 'Agregar artículo', 'new-item', 'box')}</td></tr>`;
      bindEmptyActions($('#inventario-tbody'));
      return;
    }
    $('#inventario-tbody').innerHTML = state.items.map((i) => `<tr class="${i.quantity <= i.minQty ? 'row-low' : ''}">
      <td><b>${esc(i.name)}</b></td>
      <td data-label="SKU" class="muted">${esc(i.sku || '—')}</td>
      <td data-label="Cantidad"><b>${i.quantity}</b> ${i.quantity <= i.minQty ? `${svg('alert', 14)}` : ''}</td>
      <td data-label="Mínimo">${i.minQty}</td>
      <td data-label="Unidad" class="muted">${esc(i.unit)}</td>
      <td data-label="Precio"><b>${moneyCents(i.price * 100)}</b></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-move="${i.id}" type="button" aria-label="Ajustar stock de ${esc(i.name)}">${svg('repeat', 15)} +/-</button>
        <button class="btn ghost sm" data-edit="${i.id}" type="button" aria-label="Editar ${esc(i.name)}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${i.id}" type="button" aria-label="Eliminar ${esc(i.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    document.querySelectorAll('#inventario-tbody [data-move]').forEach((b) =>
      b.addEventListener('click', () => openMovement(b.dataset.move)));
    bindTable('#inventario-tbody', 'inventory');
  }

  function itemFormHtml(i) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(i?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>SKU</span><input name="sku" value="${esc(i?.sku || '')}" /></label>
        <label class="field"><span>Unidad</span><input name="unit" value="${esc(i?.unit || 'pieza')}" /></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Cantidad</span><input name="quantity" type="number" value="${i?.quantity ?? 0}" min="0" /></label>
        <label class="field"><span>Mínimo</span><input name="minQty" type="number" value="${i?.minQty ?? 0}" min="0" /></label>
      </div>
      <label class="field"><span>Precio unitario</span><input name="price" type="number" step="0.01" value="${i ? i.price.toFixed(2) : '0.00'}" min="0" /></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${i ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  function openNewItem() {
    openModal('Nuevo artículo', itemFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/inventory', 'POST', renderInventario, mapItem);
  }

  function openMovement(id) {
    const item = state.items.find((x) => x.id === id);
    if (!item) return;
    openModal(`Ajustar stock · ${item.name}`, `<form class="modal-form" novalidate>
      <div class="field">
        <span>Operación</span>
        <div class="seg">
          <button type="button" class="seg-btn active" data-sign="1">Entrada (+)</button>
          <button type="button" class="seg-btn" data-sign="-1">Salida (−)</button>
        </div>
      </div>
      <input type="text" value="Cantidad actual: ${item.quantity}" readonly />
      <label class="field"><span>Cantidad</span><input name="delta" type="number" min="1" required /></label>
      <label class="field"><span>Motivo</span><input name="reason" placeholder="reposición, renta, merma…" required /></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">Registrar</button>
      </div>
    </form>`);
    bindMovementForm(id);
  }

  function bindMovementForm(id) {
    const form = $('#modal').querySelector('.modal-form');
    if (!form) return;
    let sign = 1;
    form.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => {
      sign = Number(b.dataset.sign);
      form.querySelectorAll('[data-sign]').forEach((x) => {
        const on = x === b;
        x.classList.toggle('active', on);
        x.setAttribute('aria-selected', String(on));
      });
    }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const reason = String(f.get('reason') || '').trim();
      if (!reason) { toast('Indica un motivo', 'error'); return; }
      const delta = sign * Number(f.get('delta'));
      try {
        await api(`/api/inventory/${id}/movements`, {
          method: 'POST',
          body: JSON.stringify({ delta, reason }),
        });
        closeModal(); toast('Stock actualizado', 'ok'); await renderInventario();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ============================================================
     DOCUMENTOS
     ============================================================ */
  async function renderDocumentos() {
    const tbody = $('#documentos-tbody');
    if (!state.loaded.documents) tbody.innerHTML = skeletonRows(6);
    try {
      const { documents } = await api('/api/documents');
      state.documents = documents;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-docs')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.documents.length) {
      $('#documentos-tbody').innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin documentos', 'Genera tu primera cotización o recibo para clientes.', 'Crear cotización', 'new-doc', 'fileText')}</td></tr>`;
      bindEmptyActions($('#documentos-tbody'));
      return;
    }
    $('#documentos-tbody').innerHTML = state.documents.map((d) => `<tr>
      <td><b>${esc(d.number)}</b></td>
      <td data-label="Tipo">${d.type === 'recibo' ? 'Recibo' : 'Cotización'}</td>
      <td data-label="Cliente">${esc(d.customer?.name || '—')}</td>
      <td data-label="Total"><b>${moneyCents(d.total * 100)}</b></td>
      <td data-label="Estado"><span class="tag ${d.status}">${DOC_STATUS_LABEL[d.status] || d.status}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-pdf="${d.id}" type="button" aria-label="Descargar PDF ${esc(d.number)}">${svg('download', 15)} PDF</button>
        <button class="btn ghost sm" data-status="${d.id}" data-to="accepted" type="button">Aceptar</button>
        <button class="btn ghost sm" data-status="${d.id}" data-to="sent" type="button">Enviar</button>
        <button class="btn danger sm" data-del="${d.id}" type="button" aria-label="Eliminar documento ${esc(d.number)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    document.querySelectorAll('#documentos-tbody [data-pdf]').forEach((b) =>
      b.addEventListener('click', () => window.open(`/api/documents/${b.dataset.pdf}/pdf`, '_blank')));
    document.querySelectorAll('#documentos-tbody [data-status]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api(`/api/documents/${b.dataset.status}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.to }) });
          toast('Estado actualizado', 'ok'); await renderDocumentos();
        } catch (err) { toast(err.message, 'error'); }
      }));
    bindTable('#documentos-tbody', 'documents');
  }

  function openNewDocument() {
    const cust = state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">Crea clientes primero</option>';
    openModal('Nueva cotización', `<form class="modal-form" id="doc-form" novalidate>
      <div class="form-row">
        <label class="field"><span>Tipo</span><select name="type"><option value="cotizacion">Cotización</option><option value="recibo">Recibo</option></select></label>
        <label class="field"><span>Cliente</span><select name="customerId">${cust}</select></label>
      </div>
      <label class="field"><span>Título</span><input name="title" placeholder="Renta de cancha + balones" /></label>
      <div id="doc-lines">
        <div class="panel" style="padding:12px;margin-bottom:8px">
          <div data-line style="display:grid;gap:8px">
            <label class="field"><span>Descripción</span><input name="desc" /></label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <label class="field"><span>Cant.</span><input name="qty" type="number" min="1" value="1" /></label>
              <label class="field"><span>Precio</span><input name="price" type="number" step="0.01" value="0" /></label>
            </div>
          </div>
        </div>
      </div>
      <button type="button" class="btn ghost sm" id="add-line">${svg('plus', 15)} Agregar línea</button>
      <label class="field"><span>Impuesto %</span><input name="taxPercent" type="number" value="0" min="0" max="100" /></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">Generar documento</button>
      </div>
    </form>`);

    $('#add-line').addEventListener('click', () => {
      const proto = $('#doc-lines [data-line]').outerHTML;
      $('#doc-lines').insertAdjacentHTML('beforeend', proto);
    });

    $('#doc-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const lineEls = [...document.querySelectorAll('#doc-lines [data-line]')];
      const lines = lineEls.map((el) => ({
        description: el.querySelector('[name=desc]').value,
        qty: Number(el.querySelector('[name=qty]').value),
        price: Number(el.querySelector('[name=price]').value),
      })).filter((l) => l.description);
      if (!lines.length) { toast('Agrega al menos una línea', 'error'); return; }
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Generando…';
      try {
        const { document: doc } = await api('/api/documents', {
          method: 'POST',
          body: JSON.stringify({ type: f.get('type'), customerId: f.get('customerId'), title: f.get('title') || undefined, lines, taxPercent: Number(f.get('taxPercent')) }),
        });
        closeModal();
        window.open(`/api/documents/${doc.id}/pdf`, '_blank');
        toast('Documento generado', 'ok');
        await renderDocumentos();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Generar documento'; }
    });
  }

  /* ============================================================
     CONFIGURACIÓN
     ============================================================ */
  function renderConfig() {
    const t = state.tenant;
    const form = $('#config-form');
    Object.entries(form.elements).forEach(([, el]) => {
      if (!el.name) return;
      if (el.type === 'checkbox') el.checked = Boolean(t[el.name]);
      else el.value = t[el.name] ?? '';
    });
  }
  $('#config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', e.target);
    err.textContent = '';
    const f = new FormData(e.target);
    const input = {
      name: f.get('name'),
      phone: f.get('phone') || '',
      address: f.get('address') || '',
      currency: f.get('currency') || '$',
      timezone: f.get('timezone') || 'America/Mexico_City',
      reminderHours: Number(f.get('reminderHours')) || 24,
      whatsappWebhook: f.get('whatsappWebhook') || '',
      whatsappToken: f.get('whatsappToken') || '',
      emailEnabled: Boolean(f.get('emailEnabled')),
    };
    try {
      const { tenant } = await api('/api/auth/settings', { method: 'PUT', body: JSON.stringify(input) });
      state.tenant = tenant;
      $('#user-tenant').textContent = tenant.name;
      toast('Configuración guardada', 'ok');
    } catch (ex) { err.textContent = ex.message; }
  });

  /* ============================================================
     BINDINGS REUSABLES
     ============================================================ */
  $('#clientes-new').addEventListener('click', openNewCustomer);
  $('#canchas-new').addEventListener('click', openNewResource);
  $('#servicios-new').addEventListener('click', openNewService);
  $('#inventario-new').addEventListener('click', openNewItem);
  $('#documentos-new').addEventListener('click', openNewDocument);

  function bindTable(tbodySel, resource) {
    const tbody = $(tbodySel);
    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.edit;
      const formMap = {
        customers: () => openModal('Editar cliente', customerFormHtml(state.customers.find((x) => x.id === id))),
        resources: () => openModal('Editar cancha', resourceFormHtml(state.resources.find((x) => x.id === id))),
        services: () => openModal('Editar servicio', serviceFormHtml(state.services.find((x) => x.id === id))),
        inventory: () => openModal('Editar artículo', itemFormHtml(state.items.find((x) => x.id === id))),
      };
      if (formMap[resource]) formMap[resource]();
      const editMap = {
        customers: () => bindSimpleForm('#modal .modal-form', `/api/customers/${id}`, 'PUT', renderClientes, mapCustomer),
        resources: () => bindSimpleForm('#modal .modal-form', `/api/resources/${id}`, 'PUT', renderCanchas, mapResource),
        services: () => bindSimpleForm('#modal .modal-form', `/api/services/${id}`, 'PUT', renderServicios, (f) => ({
          name: f.get('name'), durationMin: Number(f.get('durationMin')), price: Number(f.get('price')),
          description: f.get('description') || '', active: f.get('active') === 'true',
        })),
        inventory: () => bindSimpleForm('#modal .modal-form', `/api/inventory/${id}`, 'PUT', renderInventario, mapItem),
      };
      if (editMap[resource]) editMap[resource]();
    }));

    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.del;
      const ok = await confirmDialog({
        title: '¿Eliminar?',
        message: 'Esta acción no se puede deshacer. Se eliminará el registro de forma definitiva.',
        danger: true,
      });
      if (!ok) return;
      const path = { customers: '/api/customers', resources: '/api/resources', services: '/api/services', inventory: '/api/inventory', documents: '/api/documents' }[resource];
      try {
        await api(`${path}/${id}`, { method: 'DELETE' });
        toast('Eliminado', 'ok');
        if (resource === 'resources') { await renderCanchas(); await renderAgenda(); }
        else if (resource === 'services') { await renderServicios(); }
        else await renderPanel(resource);
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  async function renderPanel(resource) {
    if (resource === 'customers') await renderClientes();
    if (resource === 'resources') await renderCanchas();
    if (resource === 'services') await renderServicios();
    if (resource === 'inventory') await renderInventario();
    if (resource === 'documents') await renderDocumentos();
  }

  const mapCustomer = (f) => ({
    name: f.get('name'), phone: f.get('phone') || '', email: f.get('email') || '',
    birthdate: f.get('birthdate') || '', notes: f.get('notes') || '', tags: f.get('tags') || '',
  });
  const mapResource = (f) => ({
    name: f.get('name'), type: f.get('type'), capacity: Number(f.get('capacity')),
    pricePerHour: Number(f.get('pricePerHour')), color: f.get('color') || undefined,
    active: f.get('active') === 'true',
  });
  const mapItem = (f) => ({
    name: f.get('name'), sku: f.get('sku') || '', unit: f.get('unit'),
    quantity: Number(f.get('quantity')), minQty: Number(f.get('minQty')), price: Number(f.get('price')),
  });

  function bindSimpleForm(formSel, path, method, after, mapFn) {
    const form = $(formSel);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      let payload = Object.fromEntries(f);
      if (mapFn) payload = mapFn(f);
      const btn = form.querySelector('button[type=submit]');
      const prevHtml = btn?.innerHTML || '';
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
      try {
        await api(path, { method, body: JSON.stringify(payload) });
        closeModal(); toast('Guardado', 'ok'); await after();
      } catch (err) { toast(err.message, 'error'); if (btn) { btn.disabled = false; btn.innerHTML = prevHtml; } }
    });
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ============================================================
     REFRESH + INICIO
     ============================================================ */
  async function refreshAll() {
    renderConfig();
    await Promise.all([
      renderClientes().then(() => { state.loaded.customers = true; }),
      renderCanchas().then(() => { state.loaded.resources = true; }),
      renderServicios().then(() => { state.loaded.services = true; }),
      renderInventario().then(() => { state.loaded.items = true; }),
      renderDocumentos().then(() => { state.loaded.documents = true; }),
    ]);
    setWeekFromDate(new Date());
    state.loaded.appointments = true;
  }

  (async () => {
    try {
      const { session, tenant } = await api('/api/auth/me');
      state.session = session;
      state.tenant = tenant;
      $('#auth-view').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#user-chip').textContent = session.name;
      $('#user-avatar').textContent = initials(session.name);
      $('#user-tenant').textContent = tenant.name;
      document.title = `${tenant.name} · Deportes Pro`;
      await refreshAll();
      switchPane(initialView());
    } catch (e) {
      console.error('Boot fallido', e);
      $('#auth-view').classList.remove('hidden');
    }
  })();

  setInterval(() => {
    const el = $('#agenda-day-label');
    if (el && !el.textContent && state.monday) updateDayLabel();
  }, 300);
})();