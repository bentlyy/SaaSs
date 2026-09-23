/* ============================================================
   Inventario Pro · Frontend SPA (vanilla, sin dependencias)
   Artículos, stock y movimientos trazables. Contratos de API:
   inventory (core): /api/inventory, /api/inventory/movements.
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const moneyCents = (cents) => `${(Number(cents ?? 0) / 100).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).concat('')}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Iconos (stroke, estilo Lucide) ---------- */
  const ICON = {
    menu: '<line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/>',
    x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    repeat: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    arrowDown: '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>',
    arrowUp: '<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  /* ---------- Estado ---------- */
  const state = {
    session: null,
    tenant: null,
    items: [],
    movements: [],
    loaded: { items: false, movements: false },
    stockFilter: { type: '', itemId: '', q: '' },
    busy: false,
    prevFocus: null,
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
    $$('[data-empty-action]', scope).forEach((btn) => btn.addEventListener('click', () => {
      if (btn.dataset.emptyAction === 'new-item') openNewItem();
      if (btn.dataset.emptyAction === 'reload') refreshItems();
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
    document.title = `${tenant.name} · Inventario Pro`;
    await refreshMoves();
    switchPane(initialView());
  }

  /* ---------- Navegación ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen de tu inventario'],
    articulos: ['Artículos', 'Control de stock y precios'],
    movimientos: ['Movimientos', 'Historial trazable de entradas y salidas'],
    config: ['Configuración', 'Ajustes del negocio'],
  };
  const ORDER = ['dashboard', 'articulos', 'movimientos', 'config'];

  function switchPane(view) {
    if (!VIEW_META[view]) view = 'dashboard';
    $$('.nav-btn').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    $$('[data-view-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.viewPane !== view));
    const [title, sub] = VIEW_META[view];
    $('#view-title').textContent = title;
    $('#view-sub').textContent = sub;
    closeDrawer();
    if (view === 'dashboard') renderDashboard();
    if (view === 'articulos') renderArticulos();
    if (view === 'movimientos') renderMovements();
    if (view === 'config') renderConfig();
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

  /* ---------- Datos ---------- */
  async function refreshItems() {
    const { items } = await api('/api/inventory');
    state.items = items;
    state.loaded.items = true;
    fillItemSelect();
    return items;
  }
  async function refreshMoves() {
    const params = new URLSearchParams();
    if (state.stockFilter.type) params.set('type', state.stockFilter.type);
    if (state.stockFilter.itemId) params.set('itemId', state.stockFilter.itemId);
    const q = params.toString();
    const { movements } = await api(`/api/inventory/movements${q ? `?${q}` : ''}`);
    state.movements = movements;
    state.loaded.movements = true;
    return movements;
  }

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 4 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-low').innerHTML = '<div class="empty-state"><div class="skeleton-cell" style="width:80%"></div><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:70%"></div></div>';
    $('#dash-moves').innerHTML = '<div class="empty-state"><div class="skeleton-cell" style="width:80%"></div><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:70%"></div></div>';
    try {
      await Promise.all([refreshItems(), refreshMoves()]);
      fillDashboard();
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-low').innerHTML = $('#dash-moves').innerHTML =
        `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="dash-retry" type="button">Reintentar</button></div>`;
      $('#dash-retry')?.addEventListener('click', renderDashboard);
    }
  }

  function fillDashboard() {
    const low = state.items.filter((i) => i.quantity <= i.minQty);
    const totalValue = state.items.reduce((acc, i) => acc + (i.price ?? 0) * i.quantity, 0);
    const units = state.items.reduce((acc, i) => acc + i.quantity, 0);
    const moves = state.movements;
    const inSum = moves.filter((m) => m.delta > 0).reduce((acc, m) => acc + m.delta, 0);
    const outSum = moves.filter((m) => m.delta < 0).reduce((acc, m) => acc + m.delta, 0);

    const metrics = [
      { label: 'Artículos', value: state.items.length, icon: 'box', tone: 'brand' },
      { label: 'Unidades en stock', value: units.toLocaleString('es'), icon: 'repeat', tone: 'brand' },
      { label: 'Valor del inventario', value: moneyCents(totalValue), icon: 'dollar', tone: 'brand' },
      { label: 'Bajo stock', value: low.length, icon: 'alert', tone: low.length ? 'warn' : 'brand' },
    ];
    $('#dash-metrics').innerHTML = metrics.map((m) => `<div class="metric-card">
      <span class="metric-icon ${m.tone}">${svg(m.icon, 20)}</span>
      <div><p class="metric-value">${m.value}</p><p class="metric-label">${esc(m.label)}</p></div>
    </div>`).join('');

    const movesInfo =
      `<p class="low-hint">${svg('arrowDown', 14)} Entradas: <b>+${inSum.toLocaleString('es')}</b> · ${svg('arrowUp', 14)} Salidas: <b>${outSum.toLocaleString('es')}</b> (últimos movimientos)</p>`;

    $('#dash-low').innerHTML = low.length
      ? low.slice(0, 5).map((i) => `<div class="item-row">
          <span class="avatar" style="background:var(--warn-bg);color:var(--warn-fg)">${svg('alert', 15)}</span>
          <div class="item-meta"><b>${esc(i.name)}</b><small>${esc(i.sku || 'sin SKU')}</small></div>
          <span class="tag warn">${i.quantity} / ${i.minQty}</span>
        </div>`).join('')
      : `<div class="empty-state"><span class="empty-icon">${svg('check', 24)}</span><h4>Stock saludable</h4><p>Ningún artículo por debajo de su mínimo.</p></div>`;

    $('#dash-moves').innerHTML = moves.length
      ? moves.slice(0, 6).map((m) => `<div class="item-row">
          <span class="avatar ${m.delta > 0 ? '' : 'warn-tone'}">${m.delta > 0 ? svg('arrowDown', 15) : svg('arrowUp', 15)}</span>
          <div class="item-meta"><b>${esc(m.item?.name || '—')}</b><small>${esc(m.reason)}</small></div>
          <span class="tag ${m.delta > 0 ? 'confirmed' : 'cancelled'}">${m.delta > 0 ? '+' : ''}${m.delta}</span>
        </div>`).join('') + movesInfo
      : `<div class="empty-state"><span class="empty-icon">${svg('box', 24)}</span><h4>Sin movimientos</h4><p>Registra entradas o salidas para ver la actividad.</p></div>`;
  }

  /* ---------- Artículos ---------- */
  async function renderArticulos() {
    const tbody = $('#articulos-tbody');
    if (!state.loaded.items) tbody.innerHTML = skeletonRows(7);
    try {
      await refreshItems();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="7">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const low = state.items.filter((i) => i.quantity <= i.minQty).length;
    $('#articulos-low').textContent = low;
    const q = state.stockFilter.q.toLowerCase().trim();
    const items = q ? state.items.filter((i) => `${i.name} ${i.sku}`.toLowerCase().includes(q)) : state.items;
    if (!items.length) {
      $('#articulos-tbody').innerHTML = `<tr><td colspan="7">${emptyStateHtml('Sin artículos', 'Registra artículos y controla su existencia.', 'Agregar artículo', 'new-item', 'box')}</td></tr>`;
      bindEmptyActions($('#articulos-tbody'));
      return;
    }
    $('#articulos-tbody').innerHTML = items.map((i) => `<tr class="${i.quantity <= i.minQty ? 'row-low' : ''}">
      <td><b>${esc(i.name)}</b></td>
      <td data-label="SKU" class="muted">${esc(i.sku || '—')}</td>
      <td data-label="Existencia"><b>${i.quantity}</b> ${i.quantity <= i.minQty ? `${svg('alert', 14)}` : ''}</td>
      <td data-label="Mínimo">${i.minQty}</td>
      <td data-label="Precio"><b>${moneyCents(i.price)}</b></td>
      <td data-label="Estado"><span class="tag ${i.quantity <= i.minQty ? 'warn' : 'confirmed'}">${i.quantity <= i.minQty ? 'Bajo' : 'OK'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-move="${i.id}" type="button" aria-label="Ajustar stock de ${esc(i.name)}">${svg('repeat', 15)} +/-</button>
        <button class="btn ghost sm" data-edit="${i.id}" type="button" aria-label="Editar ${esc(i.name)}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${i.id}" type="button" aria-label="Eliminar ${esc(i.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#articulos-tbody [data-move]').forEach((b) => b.addEventListener('click', () => openMovement(b.dataset.move)));
    bindItemActions($('#articulos-tbody'));
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
      <label class="field"><span>Precio unitario</span><input name="price" type="number" step="0.01" value="${i ? (i.price / 100).toFixed(2) : '0.00'}" min="0" /></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${i ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`;
  }

  const mapItem = (f) => ({
    name: f.get('name'),
    sku: f.get('sku') || '',
    quantity: Number(f.get('quantity')) || 0,
    minQty: Number(f.get('minQty')) || 0,
    unit: f.get('unit') || 'pieza',
    price: Number(f.get('price')),
  });

  function openNewItem() {
    openModal('Nuevo artículo', itemFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/inventory', 'POST', refreshAllUi, mapItem);
  }

  function openEditItem(id) {
    const item = state.items.find((x) => x.id === id);
    if (!item) return;
    openModal(`Editar · ${item.name}`, itemFormHtml(item));
    bindSimpleForm('#modal .modal-form', `/api/inventory/${id}`, 'PUT', refreshAllUi, mapItem);
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
      <input type="text" value="Cantidad actual: ${item.quantity} ${esc(item.unit)}" readonly />
      <label class="field"><span>Cantidad</span><input name="delta" type="number" min="1" required /></label>
      <label class="field"><span>Motivo</span><input name="reason" placeholder="recepción, venta, merma…" required /></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">Registrar</button>
      </div>
    </form>`);
    bindMovementForm(id, item);
  }

  function bindMovementForm(id, item) {
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
        closeModal(); toast('Stock actualizado', 'ok');
        await refreshAllUi();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function bindItemActions(scope) {
    $$('[data-edit]', scope).forEach((b) => b.addEventListener('click', () => openEditItem(b.dataset.edit)));
    $$('[data-del]', scope).forEach((b) => b.addEventListener('click', async () => {
      const item = state.items.find((x) => x.id === b.dataset.del);
      if (!item) return;
      const ok = await confirmDialog({
        title: 'Eliminar artículo',
        message: `¿Eliminar "${item.name}"? Se quitará también su historial de movimientos.`,
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/inventory/${item.id}`, { method: 'DELETE' });
        toast('Artículo eliminado', 'ok');
        await refreshAllUi();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  function bindSimpleForm(selector, path, method, after, mapper) {
    const form = $(selector);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = mapper(new FormData(form));
      try {
        await api(path, { method, body: JSON.stringify(data) });
        closeModal();
        toast('Guardado', 'ok');
        await after();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---------- Movimientos ---------- */
  function fillItemSelect() {
    const sel = $('#moves-item');
    const prev = sel.value;
    sel.innerHTML = `<option value="">Todos los artículos</option>` +
      state.items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('');
    if (state.items.some((i) => i.id === prev)) sel.value = prev;
    else sel.value = '';
  }

  async function renderMovements() {
    const tbody = $('#moves-tbody');
    if (!state.loaded.movements) tbody.innerHTML = skeletonRows(6);
    try {
      await refreshMoves();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.movements.length) {
      $('#moves-tbody').innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin movimientos', 'Registra entradas o salidas desde el módulo de artículos.', 'Ver artículos', 'reload', 'repeat')}</td></tr>`;
      return;
    }
    $('#moves-tbody').innerHTML = state.movements.map((m) => `<tr>
      <td data-label="Fecha" class="muted">${fmtDate(m.created_at)}</td>
      <td data-label="Artículo"><b>${esc(m.item?.name || '—')}</b> <span class="muted">${esc(m.item?.unit || '')}</span></td>
      <td data-label="Tipo"><span class="tag ${m.delta > 0 ? 'confirmed' : 'cancelled'}">${m.delta > 0 ? 'Entrada' : 'Salida'}</span></td>
      <td data-label="Cantidad"><b class="${m.delta > 0 ? 'ok-fg' : 'danger-fg'}">${m.delta > 0 ? '+' : ''}${m.delta}</b></td>
      <td data-label="Motivo">${esc(m.reason)}</td>
      <td data-label="Usuario" class="muted">${esc(m.user?.name || '—')}</td>
    </tr>`).join('');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Configuración ---------- */
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
    };
    try {
      const { tenant } = await api('/api/auth/settings', { method: 'PUT', body: JSON.stringify(input) });
      state.tenant = tenant;
      $('#user-tenant').textContent = tenant.name;
      toast('Configuración guardada', 'ok');
    } catch (ex) { err.textContent = ex.message; }
  });

  /* ---------- Helpers ---------- */
  function debounce(fn, ms = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  async function refreshAllUi() {
    await refreshItems();
    if (!state.loaded.movements) return;
    await refreshMoves();
    const view = (window.location.hash || '').replace('#/', '');
    if (view === 'movimientos') renderMovements();
    if (view === 'dashboard') renderDashboard();
  }

  /* ---------- Bindings ---------- */
  $('#articulos-new').addEventListener('click', openNewItem);
  $('#moves-new').addEventListener('click', () => { switchPane('articulos'); setTimeout(() => {
    if (state.items.length) openMovement(state.items[0].id);
  }, 0); });
  $('#quick-new').addEventListener('click', openNewItem);
  $('[data-go-articulos]').addEventListener('click', () => switchPane('articulos'));

  $('#articulos-search').addEventListener('input', debounce((e) => {
    state.stockFilter.q = e.target.value;
    renderArticulos();
  }, 250));

  $('#moves-item').addEventListener('change', async (e) => {
    state.stockFilter.itemId = e.target.value;
    await refreshMoves();
    renderMovements();
  });
  $('#moves-type').addEventListener('change', async (e) => {
    state.stockFilter.type = e.target.value;
    await refreshMoves();
    renderMovements();
  });

  /* ---------- Bootstrap ---------- */
  (async () => {
    try {
      const session = await api('/api/auth/me');
      if (session) { await enterApp(); return; }
    } catch { /* no sesión */ }
    $('#auth-view').classList.remove('hidden');
  })();
})();