/* ============================================================
   Taller Pro · Frontend SPA (vanilla, sin dependencias)
   Órdenes de trabajo + piezas de inventario. Contratos de API:
   workorders, customers, services, staff, inventory, auth (core).
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const moneyCents = (cents) => `$${(Number(cents ?? 0) / 100).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Iconos (stroke, estilo Lucide) ---------- */
  const ICON = {
    menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    car: '<path d="M 10 3.8 3.6 16.6a2 2 0 0 0 .27 2.23l.01.01a2 2 0 0 0 2 2h.01a2 2 0 0 0 1.6-.8L 13.2 14"/><path d="M17 8 7 22h-2"/><path d="M21 16V8a2 2 0 0 0-1.06-1.77l-7-4a2 2 0 0 0-1.88 0l-7 4A2 2 0 0 0 4.97 8.6"/><path d="M8 4h7a2 2 0 0 1 2 2v5"/><path d="m21 16-3 3-3-3"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  /* ---------- Estado ---------- */
  const state = {
    session: null,
    tenant: null,
    customers: [], services: [], staff: [], orders: [], items: [],
    loaded: { customers: false, services: false, staff: false, orders: false, items: false },
    orderFilter: { status: 'all', q: '' },
    busy: false,
    prevFocus: null,
  };

  const ORDER_STATUS = ['received', 'estimated', 'in_progress', 'done', 'cancelled'];
  const STATUS_LABEL = {
    received: 'Recibida', estimated: 'Presupuestada', in_progress: 'En proceso',
    done: 'Completada', cancelled: 'Cancelada',
  };

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
  function openModal(title, html, large = false) {
    state.prevFocus = document.activeElement;
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').classList.toggle('lg', large);
    $('#modal').querySelector('.modal-content').classList.toggle('lg', large);
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

  /* ---------- Confirm ---------- */
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
      $('#modal').addEventListener('click', (e) => {
        if (e.target === $('#modal')) { $('#modal').classList.add('hidden'); resolve(false); }
      }, { once: true });
    });
  }

  /* ---------- Estados visuales ---------- */
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
    $$('[data-empty-action]', scope).forEach((btn) => btn.addEventListener('click', () => openDialogFor(btn.dataset.emptyAction)));
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
    document.title = `${tenant.name} · Taller Pro`;
    await refreshAll();
    switchPane(initialView());
  }

  /* ---------- Navegación ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen del taller hoy'],
    ordenes: ['Órdenes', 'Órdenes de trabajo y piezas asignadas'],
    clientes: ['Clientes', 'Vehículos y clientes registrados'],
    labores: ['Labores', 'Catálogo de servicios del taller'],
    mecanicos: ['Mecánicos', 'Personal del taller'],
    inventario: ['Piezas', 'Inventario de piezas e insumos'],
    config: ['Configuración', 'Ajustes del negocio'],
  };
  const ORDER = ['dashboard', 'ordenes', 'clientes', 'labores', 'mecanicos', 'inventario', 'config'];

  function switchPane(view) {
    if (!VIEW_META[view]) view = 'dashboard';
    $$('.nav-btn').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    $$('[data-view-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.viewPane !== view));
    const [title, sub] = VIEW_META[view];
    $('#view-title').textContent = title;
    $('#view-sub').textContent = sub;
    closeDrawer();
    if (view === 'dashboard') renderDashboard();
    if (view === 'ordenes') renderOrdenes();
    if (window.location.hash !== `#/${view}`) history.replaceState(null, '', `#/${view}`);
  }
  function initialView() {
    const v = (window.location.hash || '').replace('#/', '');
    return VIEW_META[v] ? v : 'dashboard';
  }
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => switchPane(btn.dataset.view)));
  window.addEventListener('popstate', () => switchPane(initialView()));

  function openDrawer() { $('#sidebar').classList.add('open'); $('#overlay').hidden = false; document.body.style.overflow = 'hidden'; }
  function closeDrawer() { $('#sidebar').classList.remove('open'); $('#overlay').hidden = true; document.body.style.overflow = ''; }
  $('#nav-open').addEventListener('click', openDrawer);
  $('#nav-close').addEventListener('click', closeDrawer);
  $('#overlay').addEventListener('click', closeDrawer);

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 4 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-orders').innerHTML = `<div class="empty-state"><div class="skeleton-cell" style="width:80%"></div><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:70%"></div></div>`;
    try {
      await ensureCollections();
      fillDashboard();
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-orders').innerHTML = `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="dash-retry" type="button">Reintentar</button></div>`;
      $('#dash-retry')?.addEventListener('click', renderDashboard);
    }
  }

  async function ensureCollections() {
    const [customers, services, staff, items, orders] = await Promise.all([
      api('/api/customers'), api('/api/services'), api('/api/staff'),
      api('/api/inventory'), api('/api/workorders'),
    ]);
    state.customers = customers.customers;
    state.services = services.services;
    state.staff = staff.staff;
    state.items = items.items;
    state.orders = orders.orders;
    state.loaded = { customers: true, services: true, staff: true, orders: true, items: true };
  }

  function fillDashboard() {
    const open = state.orders.filter((o) => ['received', 'estimated', 'in_progress'].includes(o.status));
    const inShop = state.orders.filter((o) => ['received', 'in_progress'].includes(o.status));
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(now.getTime() + 7 * 86400000);
    const dueSoon = state.orders.filter((o) => {
      if (!o.estimated_delivery || ['done', 'cancelled'].includes(o.status)) return false;
      const d = new Date(o.estimated_delivery + 'T12:00:00');
      return d >= now && d < weekFromNow;
    });
    const lowStock = state.items.filter((i) => i.quantity <= i.minQty);

    const cards = [
      { icon: 'wrench', label: 'Órdenes en taller', value: inShop.length, cls: '', hint: `${open.length} abiertas en total` },
      { icon: 'calendar', label: 'Entregas en 7 días', value: dueSoon.length, cls: '', hint: 'órdenes con fecha estimada' },
      { icon: 'box', label: 'Piezas bajo stock', value: lowStock.length, cls: lowStock.length ? 'danger' : 'ok', hint: 'debajo del mínimo' },
      { icon: 'users', label: 'Clientes', value: state.customers.length, cls: '', hint: 'con vehículos registrados' },
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
    const active = state.orders.filter((o) => !['done', 'cancelled'].includes(o.status))
      .sort((a, b) => b.number - a.number).slice(0, 6);
    if (!active.length) {
      $('#dash-orders').innerHTML = `<div class="empty-state"><span class="empty-icon">${svg('wrench', 24)}</span><h4>Sin órdenes activas</h4><p>Recibe un vehículo para abrir la primera orden.</p><button class="btn primary sm" data-empty-action="new-order" type="button">${svg('plus', 15)} Nueva orden</button></div>`;
      bindEmptyActions($('#dash-orders'));
      return;
    }
    $('#dash-orders').innerHTML = active.map((o) => `
      <button class="up-item" type="button" data-go-ordenes>
        <span class="up-time">#${o.number}</span>
        <span class="up-body"><b>${esc(o.vehicle.make)} ${esc(o.vehicle.model)} · ${esc(custMap.get(o.customer_id) || 'Cliente')}</b><small>${esc(o.vehicle.plate.toUpperCase())} · ${esc(STATUS_LABEL[o.status] || o.status)}</small></span>
        <span class="tag ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
        <span class="up-arrow">${svg('arrowRight', 16)}</span>
      </button>`).join('');
    $$('[data-go-ordenes]').forEach((b) => b.addEventListener('click', () => switchPane('ordenes')));
  }
  const fmtDue = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dBase = new Date(d); dBase.setHours(0, 0, 0, 0);
    const diff = Math.round((dBase - today) / 86400000);
    if (diff < 0) return `<span class="due-over">Atrasada</span>`;
    if (diff === 0) return `<span class="due-soon">Hoy</span>`;
    if (diff === 1) return `<span class="due-soon">Mañana</span>`;
    return `${diff} días`;
  };

  /* ---------- Acciones rápidas ---------- */
  $$('[data-action]').forEach((btn) => btn.addEventListener('click', () => openDialogFor(btn.dataset.action)));

  function openDialogFor(action) {
    switch (action) {
      case 'new-order': openOrderForm(null); break;
      case 'new-customer': openNewCustomer(); break;
      case 'new-item': openNewItem(); break;
      case 'new-labor': openNewLabor(); break;
      default: break;
    }
  }
  $('#quick-new').addEventListener('click', () => openOrderForm(null));
  $$('[data-go-ordenes]').forEach((b) => b.addEventListener('click', () => switchPane('ordenes')));

  /* ============================================================
     ÓRDENES DE TRABAJO
     ============================================================ */
  async function renderOrdenes() {
    const tbody = $('#ordenes-tbody');
    if (!state.loaded.orders) tbody.innerHTML = skeletonRows(8);
    try {
      await ensureCollections();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="8">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-ordenes')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    let rows = state.orders;
    if (state.orderFilter.status !== 'all') rows = rows.filter((o) => o.status === state.orderFilter.status);
    const q = state.orderFilter.q.trim().toLowerCase();
    if (q) {
      const custMap = new Map(state.customers.map((c) => [c.id, c.name]));
      rows = rows.filter((o) =>
        o.vehicle.make.toLowerCase().includes(q) ||
        o.vehicle.model.toLowerCase().includes(q) ||
        o.vehicle.plate.toLowerCase().includes(q) ||
        String(o.number).includes(q) ||
        String(custMap.get(o.customer_id) || '').toLowerCase().includes(q));
    }
    rows = [...rows].sort((a, b) => b.number - a.number);
    if (!rows.length) {
      const msg = state.orders.length ? 'Ninguna orden coincide con el filtro.' : 'Abre tu primera orden de trabajo para comenzar.';
      $('#ordenes-tbody').innerHTML = `<tr><td colspan="8">${emptyStateHtml('Sin órdenes', msg, state.orders.length ? '' : 'Nueva orden', 'new-order', 'car')}</td></tr>`;
      bindEmptyActions($('#ordenes-tbody'));
      return;
    }
    $('#ordenes-tbody').innerHTML = rows.map(orderRow).join('');
    bindOrderTables();
  }

  function orderRow(o) {
    const cust = state.customers.find((c) => c.id === o.customer_id);
    const mech = state.staff.find((s) => s.id === o.staff_id);
    const statusOpts = ORDER_STATUS.map((s) =>
      `<option value="${s}" ${o.status === s ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('');
    return `<tr class="${o.status === 'cancelled' ? 'row-soft' : ''}">
      <td><b>#${o.number}</b><div class="muted" style="font-size:12px">${escd(o.notes ? o.notes.slice(0, 40) : '')}</div></td>
      <td><b>${esc(o.vehicle.make)} ${esc(o.vehicle.model)}</b><div class="muted" style="font-size:12px">${esc(o.vehicle.plate.toUpperCase())}${o.vehicle.year ? ` · ${o.vehicle.year}` : ''}</div></td>
      <td data-label="Cliente">${esc(cust?.name || '—')}</td>
      <td data-label="Mecánico">${esc(mech?.name || '—')}</td>
      <td data-label="Estado">
        <select class="order-status" data-status="${o.id}" aria-label="Cambiar estado de la orden #${o.number}">
          ${statusOpts}
        </select>
      </td>
      <td data-label="Entrega">${fmtDue(o.estimated_delivery)}${o.estimated_delivery ? `<div class="muted" style="font-size:12px">${esc(o.estimated_delivery)}</div>` : ''}</td>
      <td data-label="Total"><b>${moneyCents(o.totals.total)}</b></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${o.id}" type="button" aria-label="Editar orden #${o.number}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${o.id}" type="button" aria-label="Eliminar orden #${o.number}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`;
  }
  const escd = (s) => esc(s);

  function bindOrderTables() {
    $$('[data-status]').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        const { order } = await api(`/api/workorders/${sel.dataset.status}/status`, {
          method: 'PATCH', body: JSON.stringify({ status: sel.value }),
        });
        const old = state.orders.find((o) => o.id === order.id);
        if (old) { Object.assign(old, order); state.orders = [...state.orders]; }
        toast(`Orden #${order.number}: ${STATUS_LABEL[order.status]}`, 'ok');
        await renderOrdenes();
        await renderInventario();
      } catch (err) { toast(err.message, 'error'); await renderOrdenes(); }
    }));
    tbodyBind('#ordenes-tbody', 'orders');
  }

  function tbodyBind(sel, resource) {
    const tbody = $(sel);
    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      if (resource === 'orders') {
        const order = state.orders.find((x) => x.id === b.dataset.edit);
        if (order) openOrderForm(order);
      }
    }));
    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.del;
      const isOrder = resource === 'orders';
      const ok = await confirmDialog({
        title: isOrder ? '¿Eliminar orden?' : '¿Eliminar?',
        message: isOrder
          ? 'Las piezas asignadas se devolverán al inventario. Esta acción no se puede deshacer.'
          : 'Esta acción no se puede deshacer.',
        danger: true,
      });
      if (!ok) return;
      const path = {
        orders: '/api/workorders', customers: '/api/customers', services: '/api/services',
        staff: '/api/staff', inventory: '/api/inventory',
      }[resource];
      try {
        await api(`${path}/${id}`, { method: 'DELETE' });
        toast(isOrder ? 'Orden eliminada' : 'Eliminado', 'ok');
        await renderPanel(resource);
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  /* ---------- Form de orden (crear / editar) ---------- */
  function partRowHtml(part) {
    const itemId = part?.item_id || '';
    const qty = part?.qty || 1;
    const opts = ['<option value="">— elige pieza —</option>'].concat(state.items.map((i) =>
      `<option value="${i.id}" ${i.id === itemId ? 'selected' : ''} data-price="${i.price}">${esc(i.name)} · ${i.quantity} disp. · ${moneyCents(i.price * 100)}</option>`)).join('');
    return `<div class="part-row" data-part-row>
      <label class="field"><span>Pieza</span><select name="part-item">${opts}</select></label>
      <label class="field"><span>Cant.</span><input name="part-qty" type="number" min="1" value="${qty}" /></label>
      <div><span class="muted" style="font-size:12px">Subtotal</span><b class="part-sub"></b></div>
      <button type="button" class="icon-btn part-remove" aria-label="Quitar pieza">${svg('x', 16)}</button>
    </div>`;
  }

  function workorderFormHtml(o) {
    const custOpts = ['<option value="">— elige cliente —</option>'].concat(state.customers.map((c) =>
      `<option value="${c.id}" ${o?.customer_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`)).join('');
    const staffOpts = ['<option value="">Sin asignar</option>'].concat(state.staff.filter((s) => s.active).map((s) =>
      `<option value="${s.id}" ${o?.staff_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`)).join('');
    const labores = state.services.filter((s) => s.active).map((s) => {
      const on = o?.services?.some((x) => x.id === s.id) || false;
      return `<label class="check"><input type="checkbox" name="serviceIds" value="${s.id}" ${on ? 'checked' : ''} data-price="${s.price}" /> <span><b>${esc(s.name)}</b> <small class="muted">${s.durationMin ? `${s.durationMin} min · ` : ''}${moneyCents(s.price * 100)}</small></span></label>`;
    }).join('') || '<p class="muted">Crea labores en el catálogo para agregarlas a esta orden.</p>';
    const parts = (o?.parts?.length ? o.parts : [{ item_id: '', qty: 1 }]).map(partRowHtml).join('');
    const estDel = o?.estimated_delivery ? o.estimated_delivery.slice(0, 10) : '';
    const statusOpts = ORDER_STATUS.map((s) =>
      `<option value="${s}" ${(!o || o.status === s) ? 'selected' : ''}>${STATUS_LABEL[s]}</option>`).join('');
    return `<form class="modal-form" id="order-form" novalidate>
      <div class="form-row">
        <label class="field"><span>Cliente *</span><select name="customerId" required>${custOpts}</select></label>
        <label class="field"><span>Mecánico</span><select name="staffId">${staffOpts}</select></label>
      </div>
      <fieldset class="divide-nicely">
        <legend>Vehículo</legend>
        <div class="form-row">
          <label class="field"><span>Marca *</span><input name="make" value="${esc(o?.vehicle?.make || '')}" placeholder="Nissan" required /></label>
          <label class="field"><span>Modelo *</span><input name="model" value="${esc(o?.vehicle?.model || '')}" placeholder="Versa" required /></label>
        </div>
        <div class="form-row">
          <label class="field"><span>Placa *</span><input name="plate" value="${esc(o?.vehicle?.plate || '')}" placeholder="ABC123" required /></label>
          <label class="field"><span>Año</span><input name="year" type="number" min="1900" max="2200" value="${o?.vehicle?.year || ''}" /></label>
          <label class="field"><span>Odómetro</span><input name="odo" type="number" min="0" value="${o?.vehicle?.odo || ''}" /></label>
        </div>
      </fieldset>
      <fieldset class="divide-nicely">
        <legend>Labores</legend>
        <div class="order-labores">${labores}</div>
      </fieldset>
      <div class="form-row">
        <label class="field"><span>Entrega estimada</span><input name="estimatedDelivery" type="date" value="${estDel}" /></label>
        <label class="field"><span>Estado</span><select name="status">${statusOpts}</select></label>
      </div>
      <fieldset class="divide-nicely">
        <legend>Piezas (se descuentan del inventario)</legend>
        <div id="parts-rows">${parts}</div>
        <button type="button" class="btn ghost sm" id="add-part">${svg('plus', 15)} Agregar pieza</button>
      </fieldset>
      <label class="field"><span>Notas</span><textarea name="notes" rows="2">${esc(o?.notes || '')}</textarea></label>
      <div class="order-total"><span>Total estimado</span><b id="order-total-value">${o ? moneyCents(o.totals.total) : '$0.00'}</b></div>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${o ? 'Guardar cambios' : 'Abrir orden'}</button>
      </div>
      <p class="form-error" data-err></p>
    </form>`;
  }

  function recomputeOrderTotal() {
    const form = $('#order-form');
    if (!form) return;
    let total = 0;
    form.querySelectorAll('input[name=serviceIds]:checked').forEach((cb) => {
      total += Number(cb.dataset.price || 0) * 100;
    });
    form.querySelectorAll('[data-part-row]').forEach((row) => {
      const sel = row.querySelector('[name=part-item]');
      const qty = Number(row.querySelector('[name=part-qty]').value) || 0;
      const price = Number(sel.selectedOptions?.[0]?.dataset?.price || 0);
      const sub = row.querySelector('.part-sub');
      total += price * 100 * qty;
      if (sub) sub.textContent = price && qty ? moneyCents(price * 100 * qty) : '—';
    });
    const el = $('#order-total-value');
    if (el) el.textContent = moneyCents(total);
  }

  function openOrderForm(order) {
    openModal(order ? `Orden #${order.number}` : 'Nueva orden de trabajo', workorderFormHtml(order), true);
    const form = $('#order-form');
    if (!form) return;

    $('#add-part').addEventListener('click', () => {
      $('#parts-rows').insertAdjacentHTML('beforeend', partRowHtml({ qty: 1 }));
      bindPartsRows();
      recomputeOrderTotal();
    });
    bindPartsRows();
    recomputeOrderTotal();

    form.querySelectorAll('input[name=serviceIds], [data-part-row] input, [data-part-row] select').forEach((el) =>
      el.addEventListener('input', recomputeOrderTotal));
    form.querySelectorAll('input[name=serviceIds]').forEach((el) =>
      el.addEventListener('change', recomputeOrderTotal));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('[data-err]', form);
      err.textContent = '';
      const f = new FormData(form);
      const serviceIds = [...form.querySelectorAll('input[name=serviceIds]:checked')].map((cb) => cb.value);
      const parts = [...form.querySelectorAll('[data-part-row]')].map((row) => ({
        itemId: row.querySelector('[name=part-item]').value,
        qty: Number(row.querySelector('[name=part-qty]').value) || 0,
      })).filter((p) => p.itemId && p.qty > 0);
      const body = {
        customerId: f.get('customerId'),
        staffId: f.get('staffId') || null,
        vehicle: {
          make: f.get('make'),
          model: f.get('model'),
          plate: f.get('plate'),
          year: f.get('year') ? Number(f.get('year')) : undefined,
          odo: f.get('odo') ? Number(f.get('odo')) : undefined,
        },
        serviceIds,
        parts,
        estimatedDelivery: f.get('estimatedDelivery') || null,
        notes: f.get('notes') || '',
        status: f.get('status'),
      };
      const btn = form.querySelector('button[type=submit]');
      const prevHtml = btn?.innerHTML || '';
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
      try {
        const { order } = await api(order ? `/api/workorders/${order.id}` : '/api/workorders', {
          method: order ? 'PUT' : 'POST',
          body: JSON.stringify(body),
        });
        closeModal();
        toast(order ? `Orden #${order.number} actualizada` : `Orden #${order.number} abierta`, 'ok');
        await refreshWorkshop();
        switchPane('ordenes');
      } catch (ex) {
        err.textContent = ex.message;
        if (btn) { btn.disabled = false; btn.innerHTML = prevHtml; }
      }
    });
  }

  function bindPartsRows() {
    $('#parts-rows').querySelectorAll('[data-part-row]').forEach((row) => {
      const qtyInput = row.querySelector('[name=part-qty]');
      const sel = row.querySelector('[name=part-item]');
      qtyInput.addEventListener('input', recomputeOrderTotal);
      sel.addEventListener('change', () => {
        if (!sel.value && qtyInput.value === '') qtyInput.value = '1';
        recomputeOrderTotal();
      });
      row.querySelector('.part-remove')?.addEventListener('click', () => {
        row.remove();
        recomputeOrderTotal();
      });
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
      state.loaded.customers = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-clientes')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.customers.length) {
      $('#clientes-count').textContent = '0 clientes';
      $('#clientes-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Aún no tienes clientes', 'Registra tu primer cliente para abrir órdenes.', 'Registrar cliente', 'new-customer', 'userPlus')}</td></tr>`;
      bindEmptyActions($('#clientes-tbody'));
      return;
    }
    $('#clientes-count').textContent = `${state.customers.length} cliente${state.customers.length === 1 ? '' : 's'}`;
    $('#clientes-tbody').innerHTML = state.customers.map((c) => `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td data-label="Teléfono">${esc(c.phone || '—')}</td>
      <td data-label="Correo">${esc(c.email || '—')}</td>
      <td data-label="Notas" class="muted">${esc(c.notes || '—')}</td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${c.id}" type="button" aria-label="Editar ${esc(c.name)}">${svg('edit', 15)} Editar</button>
        <button class="btn danger sm" data-del="${c.id}" type="button" aria-label="Eliminar ${esc(c.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    tbodyBind('#clientes-tbody', 'customers');
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
      tbody.innerHTML = customers.map((c) => customerRow(c)).join('');
      tbodyBind('#clientes-tbody', 'customers');
    } catch (err) { toast(err.message, 'error'); }
  }, 250));

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

  function customerFormHtml(c) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>Teléfono</span><input name="phone" value="${esc(c?.phone || '')}" /></label>
        <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(c?.email || '')}" /></label>
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
    bindSimpleForm('#modal .modal-form', '/api/customers', 'POST', renderClientes, mapCustomer);
  }

  /* ============================================================
     LABORES (servicios)
     ============================================================ */
  async function renderLabores() {
    const tbody = $('#labores-tbody');
    if (!state.loaded.services) tbody.innerHTML = skeletonRows(5);
    try {
      const { services } = await api('/api/services');
      state.services = services;
      state.loaded.services = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-labores')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.services.length) {
      $('#labores-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin labores', 'Agrega labores al catálogo para facturarlas en las órdenes.', 'Nueva labor', 'new-labor', 'wrench')}</td></tr>`;
      bindEmptyActions($('#labores-tbody'));
      return;
    }
    $('#labores-tbody').innerHTML = state.services.map((s) => `<tr>
      <td><b>${esc(s.name)}</b>${s.description ? `<div class="muted" style="font-size:12px">${esc(s.description)}</div>` : ''}</td>
      <td data-label="Duración">${s.durationMin === 0 ? '—' : `${s.durationMin} min`}</td>
      <td data-label="Precio"><b>${moneyCents(s.price * 100)}</b></td>
      <td data-label="Estado"><span class="tag ${s.active ? 'in_progress' : 'off'}">${s.active ? 'Activa' : 'Inactiva'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${s.id}" type="button" aria-label="Editar ${esc(s.name)}">${svg('edit', 15)} Editar</button>
        <button class="btn danger sm" data-del="${s.id}" type="button" aria-label="Eliminar ${esc(s.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    tbodyBind('#labores-tbody', 'services');
  }

  function laborFormHtml(s) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(s?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>Duración (min)</span><input name="durationMin" type="number" value="${s?.durationMin ?? 60}" min="0" required /></label>
        <label class="field"><span>Precio</span><input name="price" type="number" step="0.01" value="${s?.price ?? 0}" min="0" required /></label>
      </div>
      <label class="field"><span>Descripción</span><input name="description" value="${esc(s?.description || '')}" /></label>
      <label class="field"><span>Estado</span><select name="active"><option value="true" ${s?.active === false ? '' : 'selected'}>Activa</option><option value="false" ${s?.active === false ? 'selected' : ''}>Inactiva</option></select></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${s ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  function openNewLabor() {
    openModal('Nueva labor', laborFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/services', 'POST', renderLabores, mapService);
  }

  /* ============================================================
     MECÁNICOS (staff)
     ============================================================ */
  async function renderMecanicos() {
    const tbody = $('#mecanicos-tbody');
    if (!state.loaded.staff) tbody.innerHTML = skeletonRows(5);
    try {
      const { staff } = await api('/api/staff');
      state.staff = staff;
      state.loaded.staff = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-mecanicos')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.staff.length) {
      $('#mecanicos-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin mecánicos', 'Da de alta a tu equipo para asignar órdenes.', 'Agregar mecánico', 'new-mecanico', 'wrench')}</td></tr>`;
      bindEmptyActions($('#mecanicos-tbody'));
      return;
    }
    $('#mecanicos-tbody').innerHTML = state.staff.map((s) => `<tr>
      <td><span class="dot" style="background:${s.color || '#c2410c'}"></span><b>${esc(s.name)}</b></td>
      <td data-label="Teléfono">${esc(s.phone || '—')}</td>
      <td data-label="Correo">${esc(s.email || '—')}</td>
      <td data-label="Estado"><span class="tag ${s.active ? 'in_progress' : 'off'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${s.id}" type="button" aria-label="Editar ${esc(s.name)}">${svg('edit', 15)} Editar</button>
        <button class="btn danger sm" data-del="${s.id}" type="button" aria-label="Eliminar ${esc(s.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    tbodyBind('#mecanicos-tbody', 'staff');
  }

  function staffFormHtml(s) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(s?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>Teléfono</span><input name="phone" value="${esc(s?.phone || '')}" /></label>
        <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(s?.email || '')}" /></label>
      </div>
      <label class="field"><span>Estado</span><select name="active"><option value="true" ${s?.active === false ? '' : 'selected'}>Activo</option><option value="false" ${s?.active === false ? 'selected' : ''}>Inactivo</option></select></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${s ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  function openNewMecanico() {
    openModal('Nuevo mecánico', staffFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/staff', 'POST', renderMecanicos, mapStaff);
  }

  /* ============================================================
     INVENTARIO / PIEZAS
     ============================================================ */
  async function renderInventario() {
    const tbody = $('#inventario-tbody');
    if (!state.loaded.items) tbody.innerHTML = skeletonRows(7);
    try {
      const { items } = await api('/api/inventory');
      state.items = items;
      state.loaded.items = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-items')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const low = state.items.filter((i) => i.quantity <= i.minQty).length;
    $('#inventario-low').textContent = low;
    if (!state.items.length) {
      $('#inventario-tbody').innerHTML = `<tr><td colspan="7">${emptyStateHtml('Sin piezas en inventario', 'Registra piezas e insumos; las órdenes los descuentan automáticamente.', 'Agregar pieza', 'new-item', 'box')}</td></tr>`;
      bindEmptyActions($('#inventario-tbody'));
      return;
    }
    $('#inventario-tbody').innerHTML = state.items.map((i) => `<tr class="${i.quantity <= i.minQty ? 'row-low' : ''}">
      <td><b>${esc(i.name)}</b></td>
      <td data-label="SKU" class="muted">${esc(i.sku || '—')}</td>
      <td data-label="Existencia"><b>${i.quantity}</b> ${i.quantity <= i.minQty ? `${svg('alert', 14)}` : ''}</td>
      <td data-label="Mínimo">${i.minQty}</td>
      <td data-label="Precio"><b>${moneyCents(i.price * 100)}</b></td>
      <td data-label="Estado"><span class="tag ${i.quantity <= i.minQty ? 'received' : 'in_progress'}">${i.quantity <= i.minQty ? 'Bajo' : 'OK'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-move="${i.id}" type="button" aria-label="Ajustar stock de ${esc(i.name)}">${svg('repeat', 15)} +/-</button>
        <button class="btn ghost sm" data-edit="${i.id}" type="button" aria-label="Editar ${esc(i.name)}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${i.id}" type="button" aria-label="Eliminar ${esc(i.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#inventario-tbody [data-move]').forEach((b) => b.addEventListener('click', () => openMovement(b.dataset.move)));
    tbodyBind('#inventario-tbody', 'inventory');
  }

  function itemFormHtml(i) {
    return `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(i?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>SKU</span><input name="sku" value="${esc(i?.sku || '')}" /></label>
        <label class="field"><span>Unidad</span><input name="unit" value="${esc(i?.unit || 'pieza')}" /></label>
      </div>
      <div class="form-row">
        <label class="field"><span>Existencia</span><input name="quantity" type="number" value="${i?.quantity ?? 0}" min="0" /></label>
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
    openModal('Nueva pieza', itemFormHtml(null));
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
      <label class="field"><span>Motivo</span><input name="reason" placeholder="reposición, merma, préstamo…" required /></label>
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
      reminderHours: 24,
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
  $('#labores-new').addEventListener('click', openNewLabor);
  $('#mecanicos-new').addEventListener('click', openNewMecanico);
  $('#inventario-new').addEventListener('click', openNewItem);
  $('#ordenes-new').addEventListener('click', () => openOrderForm(null));

  $('#ordenes-search').addEventListener('input', debounce((e) => {
    state.orderFilter.q = e.target.value;
    renderOrdenes();
  }, 250));
  $('#ordenes-status').addEventListener('change', (e) => {
    state.orderFilter.status = e.target.value;
    renderOrdenes();
  });

  const mapCustomer = (f) => ({
    name: f.get('name'),
    phone: f.get('phone') || '',
    email: f.get('email') || '',
    notes: f.get('notes') || '',
  });
  const mapService = (f) => ({
    name: f.get('name'),
    durationMin: Number(f.get('durationMin')) || 0,
    price: Number(f.get('price')) || 0,
    description: f.get('description') || '',
    active: f.get('active') === 'true',
  });
  const mapStaff = (f) => ({
    name: f.get('name'),
    phone: f.get('phone') || '',
    email: f.get('email') || '',
    active: f.get('active') === 'true',
  });
  const mapItem = (f) => ({
    name: f.get('name'),
    sku: f.get('sku') || '',
    unit: f.get('unit'),
    quantity: Number(f.get('quantity')) || 0,
    minQty: Number(f.get('minQty')) || 0,
    price: Number(f.get('price')) || 0,
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

  function renderPanel(resource) {
    if (resource === 'customers') return renderClientes();
    if (resource === 'services') return renderLabores();
    if (resource === 'staff') return renderMecanicos();
    if (resource === 'inventory') return renderInventario();
    if (resource === 'orders') return renderOrdenes();
  }

  const editFormMap = (resource, id) => ({
    customers: () => openModal('Editar cliente', customerFormHtml(state.customers.find((x) => x.id === id))),
    services: () => openModal('Editar labor', laborFormHtml(state.services.find((x) => x.id === id))),
    staff: () => openModal('Editar mecánico', staffFormHtml(state.staff.find((x) => x.id === id))),
    inventory: () => openModal('Editar pieza', itemFormHtml(state.items.find((x) => x.id === id))),
  }[resource]);

  $('#clientes-tbody').addEventListener('click', (e) => tbodyEdit(e, 'customers'));
  $('#labores-tbody').addEventListener('click', (e) => tbodyEdit(e, 'services'));
  $('#mecanicos-tbody').addEventListener('click', (e) => tbodyEdit(e, 'staff'));
  $('#inventario-tbody').addEventListener('click', (e) => tbodyEdit(e, 'inventory'));

  async function tbodyEdit(e, resource) {
    const b = e.target.closest('[data-edit]');
    if (!b) return;
    const id = b.dataset.edit;
    const open = editFormMap(resource, id);
    if (!open) return;
    open();
    const editMap = {
      customers: () => bindSimpleForm('#modal .modal-form', `/api/customers/${id}`, 'PUT', renderClientes, mapCustomer),
      services: () => bindSimpleForm('#modal .modal-form', `/api/services/${id}`, 'PUT', renderLabores, mapService),
      staff: () => bindSimpleForm('#modal .modal-form', `/api/staff/${id}`, 'PUT', renderMecanicos, mapStaff),
      inventory: () => bindSimpleForm('#modal .modal-form', `/api/inventory/${id}`, 'PUT', renderInventario, mapItem),
    };
    editMap[resource]();
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ============================================================
     REFRESH + INICIO
     ============================================================ */
  async function refreshWorkshop() {
    await ensureCollections();
    state.loaded = { customers: true, services: true, staff: true, orders: true, items: true };
  }

  async function refreshAll() {
    renderConfig();
    try {
      await ensureCollections();
    } catch (e) {
      $('#auth-view').classList.remove('hidden');
      $('#app').classList.add('hidden');
      return;
    }
    const pane = initialView();
    if (pane === 'clientes') renderClientes();
    if (pane === 'labores') renderLabores();
    if (pane === 'mecanicos') renderMecanicos();
    if (pane === 'inventario') renderInventario();
  }

  (async () => {
    try {
      const { session, tenant, user } = await api('/api/auth/me');
      state.session = session;
      state.tenant = tenant;
      $('#auth-view').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#user-chip').textContent = `${user.name}`;
      $('#user-avatar').textContent = initials(user.name);
      $('#user-tenant').textContent = tenant.name;
      document.title = `${tenant.name} · Taller Pro`;
      await refreshAll();
      switchPane(initialView());
    } catch (e) {
      console.error('Boot fallido', e);
      $('#auth-view').classList.remove('hidden');
    }
  })();
})();