/* ============================================================
   Cotizaciones Pro · Frontend SPA (vanilla, sin dependencias)
   Presupuestos y recibos profesionales. Contratos de API:
   documents, customers (core): /api/documents, /api/customers.
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
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    file: '<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    arrowRight: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  /* ---------- Estado ---------- */
  const state = {
    session: null,
    tenant: null,
    customers: [],
    documents: [],
    loaded: { customers: false, documents: false },
    docFilter: { q: '', type: '' },
    busy: false,
    prevFocus: null,
  };

  const DOC_STATUS_LABEL = {
    draft: 'Borrador', sent: 'Enviada', accepted: 'Aceptada', rejected: 'Rechazada',
  };
  const DOC_NEXT = {
    draft: 'sent', sent: 'accepted',
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
      if (btn.dataset.emptyAction === 'new-doc') openNewDocument();
      if (btn.dataset.emptyAction === 'reload') refreshDocs();
      if (btn.dataset.emptyAction === 'new-customer') openNewCustomer();
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
    document.title = `${tenant.name} · Cotizaciones Pro`;
    await Promise.all([refreshCustomers(), refreshDocs()]);
    switchPane(initialView());
  }

  /* ---------- Navegación ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen de cotizaciones'],
    cotizaciones: ['Cotizaciones', 'Presupuestos y recibos'],
    clientes: ['Clientes', 'Tus clientes'],
    config: ['Configuración', 'Ajustes del negocio'],
  };

  function switchPane(view) {
    if (!VIEW_META[view]) view = 'dashboard';
    $$('.nav-btn').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('active', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    $$('[data-view-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.viewPane !== view));
    const [title, sub] = VIEW_META[view];
    $('#view-title').textContent = title;
    $('#view-sub').textContent = sub;
    closeDrawer();
    if (view === 'dashboard') renderDashboard();
    if (view === 'cotizaciones') renderDocs();
    if (view === 'clientes') renderClientes();
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
  async function refreshCustomers() {
    const { customers } = await api('/api/customers');
    state.customers = customers;
    state.loaded.customers = true;
    return customers;
  }
  async function refreshDocs() {
    const { documents } = await api('/api/documents');
    state.documents = documents;
    state.loaded.documents = true;
    return documents;
  }

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 4 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-open').innerHTML = $('#dash-receipts').innerHTML = '<div class="empty-state"><div class="skeleton-cell" style="width:70%"></div><div class="skeleton-cell" style="width:50%"></div></div>';
    try {
      await Promise.all([refreshDocs(), refreshCustomers()]);
      fillDashboard();
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-open').innerHTML = $('#dash-receipts').innerHTML =
        `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="dash-retry" type="button">Reintentar</button></div>`;
      $('#dash-retry')?.addEventListener('click', renderDashboard);
    }
  }

  function fillDashboard() {
    const docs = state.documents;
    const quotes = docs.filter((d) => d.type === 'cotizacion');
    const receipts = docs.filter((d) => d.type === 'recibo');
    const open = quotes.filter((d) => d.status === 'draft' || d.status === 'sent');
    const accepted = quotes.filter((d) => d.status === 'accepted');
    const openValue = open.reduce((acc, d) => acc + d.total, 0);
    const pending = quotes.filter((d) => d.status === 'sent').length;

    const metrics = [
      { label: 'Cotizaciones', value: quotes.length, icon: 'file', tone: 'brand' },
      { label: 'Pendientes de respuesta', value: pending, icon: 'send', tone: pending ? 'warn' : 'brand' },
      { label: 'Aceptadas', value: accepted.length, icon: 'check', tone: 'brand' },
      { label: 'Monto en espera', value: moneyCents(openValue), icon: 'dollar', tone: 'brand' },
    ];
    $('#dash-metrics').innerHTML = metrics.map((m) => `<div class="metric-card">
      <span class="metric-icon ${m.tone}">${svg(m.icon, 20)}</span>
      <div><p class="metric-value">${m.value}</p><p class="metric-label">${esc(m.label)}</p></div>
    </div>`).join('');

    $('#dash-open').innerHTML = open.length
      ? open.slice(0, 5).map((d) => `<div class="item-row">
          <span class="avatar">${svg('file', 15)}</span>
          <div class="item-meta"><b>${esc(d.number)}</b><small>${esc(d.customer?.name || '—')} · ${esc(d.title)}</small></div>
          <span class="tag ${d.status}">${DOC_STATUS_LABEL[d.status] || d.status}</span>
        </div>`).join('')
      : `<div class="empty-state"><span class="empty-icon">${svg('check', 24)}</span><h4>Todo respondido</h4><p>No hay cotizaciones pendientes de respuesta.</p></div>`;

    $('#dash-receipts').innerHTML = receipts.length
      ? receipts.slice(0, 5).map((d) => `<div class="item-row">
          <span class="avatar">${svg('dollar', 15)}</span>
          <div class="item-meta"><b>${esc(d.number)}</b><small>${esc(d.customer?.name || '—')}</small></div>
          <b>${moneyCents(d.total)}</b>
        </div>`).join('')
      : `<div class="empty-state"><span class="empty-icon">${svg('file', 24)}</span><h4>Sin recibos</h4><p>Genera recibos para cobros parciales o pagos.</p></div>`;
  }

  /* ---------- Cotizaciones ---------- */
  async function renderDocs() {
    const tbody = $('#docs-tbody');
    if (!state.loaded.documents) tbody.innerHTML = skeletonRows(6);
    try {
      await refreshDocs();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = state.docFilter.q.trim().toLowerCase();
    const docs = state.documents.filter((d) => {
      const okType = !state.docFilter.type || d.type === state.docFilter.type;
      const okQ = !q || `${d.number} ${d.customer?.name} ${d.title}`.toLowerCase().includes(q);
      return okType && okQ;
    });
    if (!docs.length) {
      $('#docs-tbody').innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin documentos', 'Crea tu primera cotización o recibo para clientes.', 'Crear documento', 'new-doc', 'file')}</td></tr>`;
      bindEmptyActions($('#docs-tbody'));
      return;
    }
    $('#docs-tbody').innerHTML = docs.map((d) => `<tr>
      <td><b>${esc(d.number)}</b></td>
      <td data-label="Tipo">${d.type === 'recibo' ? 'Recibo' : 'Cotización'}</td>
      <td data-label="Cliente">${esc(d.customer?.name || '—')}</td>
      <td data-label="Total"><b>${moneyCents(d.total)}</b></td>
      <td data-label="Estado"><span class="tag ${d.status}">${DOC_STATUS_LABEL[d.status] || d.status}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-pdf="${d.id}" type="button" aria-label="Descargar PDF ${esc(d.number)}">${svg('download', 15)} PDF</button>
        ${DOC_NEXT[d.status] ? `<button class="btn ghost sm" data-status="${d.id}" data-to="${DOC_NEXT[d.status]}" type="button">${d.status === 'draft' ? 'Enviar' : 'Aceptar'}</button>` : ''}
        <button class="btn danger sm" data-del="${d.id}" type="button" aria-label="Eliminar ${esc(d.number)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#docs-tbody [data-pdf]').forEach((b) => b.addEventListener('click', () => window.open(`/api/documents/${b.dataset.pdf}/pdf`, '_blank')));
    $$('#docs-tbody [data-status]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/documents/${b.dataset.status}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.to }) });
        toast('Estado actualizado', 'ok'); await renderDocs();
      } catch (err) { toast(err.message, 'error'); }
    }));
    $$('#docs-tbody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const doc = state.documents.find((x) => x.id === b.dataset.del);
      const ok = await confirmDialog({
        title: 'Eliminar documento',
        message: `¿Eliminar ${doc?.number}? Esta acción no se puede deshacer.`,
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/documents/${b.dataset.del}`, { method: 'DELETE' });
        toast('Documento eliminado', 'ok'); await refreshDocs(); renderDocs();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  function openNewDocument() {
    if (!state.customers.length) {
      toast('Primero registra un cliente', 'error');
      return;
    }
    const cust = state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    openModal('Nuevo documento', `<form class="modal-form" id="doc-form" novalidate>
      <div class="form-row">
        <label class="field"><span>Tipo</span><select name="type"><option value="cotizacion">Cotización</option><option value="recibo">Recibo</option></select></label>
        <label class="field"><span>Cliente</span><select name="customerId">${cust}</select></label>
      </div>
      <label class="field"><span>Título</span><input name="title" placeholder="Descripción corta (opcional)" /></label>
      <div id="doc-lines">
        <div class="doc-line">
          <label class="field" style="grid-column:1/-1"><span>Descripción</span><input name="desc" /></label>
          <label class="field"><span>Cant.</span><input name="qty" type="number" min="1" value="1" /></label>
          <label class="field"><span>Precio</span><input name="price" type="number" step="0.01" value="0" /></label>
        </div>
      </div>
      <button type="button" class="btn ghost sm" id="add-line">${svg('plus', 15)} Agregar línea</button>
      <label class="field"><span>Impuesto %</span><input name="taxPercent" type="number" value="16" min="0" max="100" /></label>
      <div id="doc-total" class="doc-total">Total: <b>$0.00</b></div>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">Generar documento</button>
      </div>
    </form>`);
    bindDocForm();
  }

  function bindDocForm() {
    const form = $('#doc-form');
    const recalc = () => {
      const taxP = Number(form.querySelector('[name=taxPercent]').value) || 0;
      const lines = [...form.querySelectorAll('#doc-lines .doc-line')].map((el) => ({
        qty: Number(el.querySelector('[name=qty]').value) || 0,
        price: Number(el.querySelector('[name=price]').value) || 0,
      }));
      const subtotal = lines.reduce((a, l) => a + l.qty * l.price, 0);
      const total = subtotal * (1 + taxP / 100);
      const el = form.querySelector('#doc-total b');
      if (el) el.textContent = `$${total.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    form.querySelector('#add-line').addEventListener('click', () => {
      const proto = form.querySelector('#doc-lines .doc-line').outerHTML;
      const wrap = document.createElement('div');
      wrap.innerHTML = proto;
      form.querySelector('#doc-lines').appendChild(wrap.firstElementChild);
      recalc();
    });
    form.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalc));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const lineEls = [...form.querySelectorAll('#doc-lines .doc-line')];
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
          body: JSON.stringify({
            type: f.get('type'), customerId: f.get('customerId'),
            title: f.get('title') || undefined, lines, taxPercent: Number(f.get('taxPercent')) || 0,
          }),
        });
        closeModal();
        window.open(`/api/documents/${doc.id}/pdf`, '_blank');
        toast('Documento generado', 'ok');
        await refreshDocs(); renderDocs();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Generar documento'; }
    });
  }

  /* ---------- Clientes ---------- */
  async function renderClientes() {
    const tbody = $('#clientes-tbody');
    if (!state.loaded.customers) tbody.innerHTML = skeletonRows(5);
    try {
      await refreshCustomers();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = state.docFilter.q.trim().toLowerCase();
    const customers = q ? state.customers.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)) : state.customers;
    if (!customers.length) {
      $('#clientes-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin clientes', 'Registra a tus clientes para cotizarles.', 'Registrar cliente', 'new-customer', 'users')}</td></tr>`;
      bindEmptyActions($('#clientes-tbody'));
      return;
    }
    $('#clientes-tbody').innerHTML = customers.map((c) => `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td data-label="Teléfono" class="muted">${esc(c.phone || '—')}</td>
      <td data-label="Correo" class="muted">${esc(c.email || '—')}</td>
      <td data-label="Notas" class="muted">${esc(c.notes || '')}</td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${c.id}" type="button" aria-label="Editar ${esc(c.name)}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${c.id}" type="button" aria-label="Eliminar ${esc(c.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#clientes-tbody [data-edit]').forEach((b) => b.addEventListener('click', () => openCustomerForm(state.customers.find((c) => c.id === b.dataset.edit))));
    $$('#clientes-tbody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const c = state.customers.find((x) => x.id === b.dataset.del);
      const ok = await confirmDialog({
        title: 'Eliminar cliente',
        message: `¿Eliminar a "${c?.name}"?`,
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/api/customers/${c.id}`, { method: 'DELETE' });
        toast('Cliente eliminado', 'ok'); await refreshCustomers(); renderClientes();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  function openNewCustomer() { openCustomerForm(null); }
  function openCustomerForm(c) {
    openModal(c ? `Editar · ${c.name}` : 'Nuevo cliente', `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c?.name || '')}" required /></label>
      <label class="field"><span>Teléfono</span><input name="phone" value="${esc(c?.phone || '')}" /></label>
      <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(c?.email || '')}" /></label>
      <label class="field"><span>Notas</span><textarea name="notes" rows="3">${esc(c?.notes || '')}</textarea></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${c ? 'Guardar' : 'Registrar'}</button>
      </div>
    </form>`);
    const form = $('#modal .modal-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const input = {
        name: f.get('name'), phone: f.get('phone') || '', email: f.get('email') || '',
        notes: f.get('notes') || '',
      };
      try {
        await api(c ? `/api/customers/${c.id}` : '/api/customers', { method: c ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal(); toast(c ? 'Cliente actualizado' : 'Cliente registrado', 'ok');
        await refreshCustomers(); renderClientes();
      } catch (err) { toast(err.message, 'error'); }
    });
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

  /* ---------- Bindings ---------- */
  $('#docs-new').addEventListener('click', () => {
    if (!state.customers.length) { switchPane('clientes'); return; }
    openNewDocument();
  });
  $('#quick-new').addEventListener('click', () => { switchPane('cotizaciones'); setTimeout(openNewDocument, 0); });
  $('#clientes-new').addEventListener('click', openNewCustomer);
  $('[data-go-cotizaciones]').addEventListener('click', () => switchPane('cotizaciones'));

  $('#docs-search').addEventListener('input', debounce((e) => {
    state.docFilter.q = e.target.value;
    renderDocs();
  }, 250));
  $('#docs-type').addEventListener('change', (e) => {
    state.docFilter.type = (e.target.value === 'cotizacion' || e.target.value === 'recibo') ? e.target.value : '';
    renderDocs();
  });
  $('#clientes-search').addEventListener('input', debounce((e) => {
    state.docFilter.q = e.target.value;
    renderClientes();
  }, 250));

  /* ---------- Bootstrap ---------- */
  (async () => {
    try {
      const session = await api('/api/auth/me');
      if (session) { await enterApp(); return; }
    } catch { /* no sesión */ }
    $('#auth-view').classList.remove('hidden');
  })();
})();