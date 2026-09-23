/* ============================================================
   DocuPro · Generación de documentos · Frontend SPA (vanilla)
   Facturas, notas de venta, cotizaciones y recibos en PDF,
   con catálogo de conceptos para armar líneas. Contratos de API:
   documents, customers, inventory (core): /api/documents, /api/customers, /api/inventory.
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const moneyCents = (cents) => `$${(Number(cents ?? 0) / 100).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const moneyUnits = (units) => `$${Number(units ?? 0).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Iconos ---------- */
  const ICON = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    dollar: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  /* ---------- Estado ---------- */
  const state = {
    tenant: null,
    customers: [],
    documents: [],
    concepts: [],
    loaded: { customers: false, documents: false, concepts: false },
    docFilter: { q: '', type: '' },
    prevFocus: null,
  };

  const DOC_KINDS = {
    factura: { label: 'Factura', tone: 'accepted' },
    nota_venta: { label: 'Nota de venta', tone: 'sent' },
    cotizacion: { label: 'Cotización', tone: 'draft' },
    recibo: { label: 'Recibo', tone: 'brand' },
  };
  const DOC_STATUS_LABEL = {
    draft: 'Borrador', sent: 'Enviado', accepted: 'Aceptado', rejected: 'Rechazado',
  };
  const DOC_NEXT = { draft: 'sent', sent: 'accepted' };

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

  /* ---------- Modal ---------- */
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
      if (btn.dataset.emptyAction === 'reload') renderDocumentos();
      if (btn.dataset.emptyAction === 'new-customer') openNewCustomer();
      if (btn.dataset.emptyAction === 'reload-concepts') renderConceptos();
      if (btn.dataset.emptyAction === 'new-concept') openNewConcepto();
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
    state.tenant = tenant;
    $('#auth-view').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-chip').textContent = `${user.name}`;
    $('#user-avatar').textContent = initials(user.name);
    $('#user-tenant').textContent = tenant.name;
    document.title = `${tenant.name} · DocuPro`;
    await Promise.all([refreshCustomers(), refreshDocs(), refreshConcepts()]);
    switchPane(initialView());
  }

  /* ---------- Navegación ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen de documentos'],
    documentos: ['Documentos', 'Facturas, notas, cotizaciones y recibos'],
    clientes: ['Clientes', 'Tus clientes'],
    conceptos: ['Conceptos', 'Catálogo para armar líneas'],
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
    if (view === 'documentos') renderDocumentos();
    if (view === 'clientes') renderClientes();
    if (view === 'conceptos') renderConceptos();
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
  async function refreshConcepts() {
    const { items } = await api('/api/inventory');
    state.concepts = items;
    state.loaded.concepts = true;
    return items;
  }

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 4 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-docs').innerHTML = $('#dash-bytype').innerHTML = '<div class="empty-state"><div class="skeleton-cell" style="width:70%"></div><div class="skeleton-cell" style="width:50%"></div></div>';
    try {
      await Promise.all([refreshDocs(), refreshCustomers()]);
      fillDashboard();
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-docs').innerHTML = $('#dash-bytype').innerHTML =
        `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="dash-retry" type="button">Reintentar</button></div>`;
      $('#dash-retry')?.addEventListener('click', renderDashboard);
    }
  }
  function fillDashboard() {
    const docs = state.documents;
    const sent = docs.filter((d) => d.status === 'sent');
    const accepted = docs.filter((d) => d.status === 'accepted');
    const invoices = docs.filter((d) => d.type === 'factura');
    const totalEmitido = docs.filter((d) => d.status === 'accepted').reduce((a, d) => a + d.total, 0);
    const metrics = [
      { label: 'Documentos', value: docs.length, icon: 'file', tone: 'brand' },
      { label: 'Facturas', value: invoices.length, icon: 'file', tone: 'brand' },
      { label: 'Enviados', value: sent.length, icon: 'send', tone: sent ? 'warn' : 'brand' },
      { label: 'Facturado (acept.)', value: moneyCents(totalEmitido), icon: 'dollar', tone: 'brand' },
    ];
    $('#dash-metrics').innerHTML = metrics.map((m) => `<div class="metric-card">
      <span class="metric-icon ${m.tone}">${svg(m.icon, 20)}</span>
      <div><p class="metric-value">${m.value}</p><p class="metric-label">${esc(m.label)}</p></div>
    </div>`).join('');

    $('#dash-docs').innerHTML = docs.length
      ? docs.slice(0, 5).map((d) => `<div class="item-row">
          <span class="avatar">${svg('file', 15)}</span>
          <div class="item-meta"><b>${esc(d.number)} · ${DOC_KINDS[d.type]?.label || d.type}</b><small>${esc(d.customer?.name || '—')}</small></div>
          <b>${moneyCents(d.total)}</b>
        </div>`).join('')
      : `<div class="empty-state"><span class="empty-icon">${svg('file', 24)}</span><h4>Sin documentos</h4><p>Genera tu primera factura o cotización.</p></div>`;

    const byType = Object.entries(DOC_KINDS).map(([k, meta]) => ({
      type: k, label: meta.label, count: docs.filter((d) => d.type === k).length,
    })).filter((x) => x.count > 0);
    $('#dash-bytype').innerHTML = byType.length
      ? byType.map((x) => `<div class="item-row">
          <span class="tag ${x.type === 'factura' ? 'accepted' : x.type === 'nota_venta' ? 'sent' : x.type === 'cotizacion' ? 'draft' : 'brand'}">${esc(x.label)}</span>
          <b>${x.count}</b>
        </div>`).join('')
      : `<div class="empty-state"><span class="empty-icon">${svg('inbox', 24)}</span><h4>Sin actividad</h4><p>Los documentos aparecerán aquí.</p></div>`;
  }

  /* ---------- Documentos ---------- */
  async function renderDocumentos() {
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
      $('#docs-tbody').innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin documentos', 'Crea tu primer documento y descárgalo en PDF.', 'Crear documento', 'new-doc', 'file')}</td></tr>`;
      bindEmptyActions($('#docs-tbody'));
      return;
    }
    $('#docs-tbody').innerHTML = docs.map((d) => `<tr>
      <td><b>${esc(d.number)}</b></td>
      <td data-label="Tipo"><span class="tag ${DOC_KINDS[d.type]?.tone || 'brand'}">${DOC_KINDS[d.type]?.label || d.type}</span></td>
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
        toast('Estado actualizado', 'ok'); await renderDocumentos();
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
        toast('Documento eliminado', 'ok'); await refreshDocs(); renderDocumentos();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  const conceptOptions = () => {
    const active = state.concepts.filter((c) => c.active);
    if (!active.length) return '';
    return `<option value="">— desde catálogo —</option>` +
      active.map((c) => `<option value="${c.id}">${esc(c.name)}${c.price ? ` · ${moneyUnits(c.price)}` : ''}</option>`).join('');
  };

  function openNewDocument() {
    if (!state.customers.length) { toast('Primero registra un cliente', 'error'); return; }
    openModal('Nuevo documento', `<form class="modal-form" id="doc-form" novalidate>
      <div class="form-row">
        <label class="field"><span>Tipo</span><select name="type">
          <option value="factura">Factura</option>
          <option value="nota_venta">Nota de venta</option>
          <option value="cotizacion">Cotización</option>
          <option value="recibo">Recibo</option>
        </select></label>
        <label class="field"><span>Cliente</span><select name="customerId">${state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Título</span><input name="title" placeholder="Aparece en el PDF (opcional)" /></label>
      <label class="field"><span>Conceptos del catálogo</span><select id="concept-pick"><option value="">— elige un concepto para agregar —</option>${conceptOptions()}</select></label>
      <div id="doc-lines"></div>
      <button type="button" class="btn ghost sm" id="add-line">${svg('plus', 15)} Agregar línea manual</button>
      <label class="field"><span>Impuesto %</span><input name="taxPercent" type="number" value="16" min="0" max="100" /></label>
      <div id="doc-total" class="doc-total">Total: <b>$0.00</b></div>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">Generar documento</button>
      </div>
    </form>`, true);
    bindDocForm();
  }

  function makeLine(desc = '', qty = 1, price = '') {
    if (!desc) { desc = $('.field input') ? '' : ''; }
    const div = document.createElement('div');
    div.className = 'doc-line';
    div.innerHTML = `
      <label class="field" style="grid-column:1/-1"><span>Descripción</span><input name="desc" value="${esc(desc)}" /></label>
      <label class="field"><span>Cant.</span><input name="qty" type="number" min="1" value="${qty}" /></label>
      <label class="field"><span>Precio</span><input name="price" type="number" step="0.01" value="${esc(price)}" /></label>
      <button type="button" class="icon-btn line-remove" aria-label="Quitar línea">${svg('trash', 15)}</button>`;
    div.querySelector('.line-remove').addEventListener('click', () => div.remove(), recalc);
    return div;
  }
  let recalc = null;

  function bindDocForm() {
    const form = $('#doc-form');
    const linesEl = $('#doc-lines', form);
    linesEl.appendChild(makeLine('', 1, ''));
    linesEl.appendChild(makeLine('', 1, ''));

    recalc = () => {
      const taxP = Number(form.querySelector('[name=taxPercent]').value) || 0;
      const rows = [...form.querySelectorAll('#doc-lines .doc-line')].map((el) => ({
        qty: Number(el.querySelector('[name=qty]').value) || 0,
        price: Number(el.querySelector('[name=price]').value) || 0,
      }));
      const subtotal = rows.reduce((a, l) => a + l.qty * l.price, 0);
      const total = subtotal * (1 + taxP / 100);
      const el = form.querySelector('#doc-total b');
      if (el) el.textContent = `$${total.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    form.querySelector('#add-line').addEventListener('click', () => { linesEl.appendChild(makeLine('', 1, '')); recalc(); });
    form.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalc));

    const pick = form.querySelector('#concept-pick');
    pick.addEventListener('change', () => {
      if (!pick.value) return;
      const c = state.concepts.find((x) => x.id === pick.value);
      if (!c) return;
      const div = makeLine(c.name, 1, c.price);
      linesEl.appendChild(div);
      div.querySelectorAll('input').forEach((el) => el.addEventListener('input', recalc));
      pick.value = '';
      recalc();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const lines = [...form.querySelectorAll('#doc-lines .doc-line')].map((el) => ({
        description: el.querySelector('[name=desc]').value,
        qty: Number(el.querySelector('[name=qty]').value),
        price: Number(el.querySelector('[name=price]').value),
      })).filter((l) => l.description);
      if (!lines.length) { toast('Agrega al menos una línea con descripción', 'error'); return; }
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
        await refreshDocs(); renderDocumentos();
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
      $('#clientes-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin clientes', 'Registra a tus clientes para emitir documentos.', 'Registrar cliente', 'new-customer', 'users')}</td></tr>`;
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
      const ok = await confirmDialog({ title: 'Eliminar cliente', message: `¿Eliminar a "${c?.name}"?`, danger: true });
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
      const input = { name: f.get('name'), phone: f.get('phone') || '', email: f.get('email') || '', notes: f.get('notes') || '' };
      try {
        await api(c ? `/api/customers/${c.id}` : '/api/customers', { method: c ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal(); toast(c ? 'Cliente actualizado' : 'Cliente registrado', 'ok');
        await refreshCustomers(); renderClientes();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---------- Conceptos (catálogo) ---------- */
  const renderConceptos = async () => {
    const tbody = $('#conceptos-tbody');
    if (!state.loaded.concepts) tbody.innerHTML = skeletonRows(5);
    try {
      await refreshConcepts();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-concepts')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = $('#conceptos-search').value.trim().toLowerCase();
    const concepts = q ? state.concepts.filter((c) => `${c.name} ${c.sku}`.toLowerCase().includes(q)) : state.concepts;
    if (!concepts.length) {
      $('#conceptos-tbody').innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin conceptos', 'Agrega conceptos frecuentes para armar documentos rápido.', 'Agregar concepto', 'new-concept', 'box')}</td></tr>`;
      bindEmptyActions($('#conceptos-tbody'));
      return;
    }
    $('#conceptos-tbody').innerHTML = concepts.map((c) => `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td data-label="SKU" class="muted">${esc(c.sku || '—')}</td>
      <td data-label="Precio"><b>${moneyUnits(c.price)}</b></td>
      <td data-label="Estado"><span class="tag ${c.active ? 'accepted' : 'rejected'}">${c.active ? 'Activo' : 'Inactivo'}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-edit="${c.id}" type="button" aria-label="Editar ${esc(c.name)}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${c.id}" type="button" aria-label="Eliminar ${esc(c.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#conceptos-tbody [data-edit]').forEach((b) => b.addEventListener('click', () => openConceptForm(state.concepts.find((c) => c.id === b.dataset.edit))));
    $$('#conceptos-tbody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const c = state.concepts.find((x) => x.id === b.dataset.del);
      const ok = await confirmDialog({ title: 'Eliminar concepto', message: `¿Eliminar "${c?.name}" del catálogo?`, danger: true });
      if (!ok) return;
      try {
        await api(`/api/inventory/${c.id}`, { method: 'DELETE' });
        toast('Concepto eliminado', 'ok'); await refreshConcepts(); renderConceptos();
      } catch (err) { toast(err.message, 'error'); }
    }));
  };
  function openNewConcepto() { openConceptForm(null); }
  function openConceptForm(c) {
    openModal(c ? `Editar · ${c.name}` : 'Nuevo concepto', `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c?.name || '')}" required /></label>
      <div class="form-row">
        <label class="field"><span>SKU (opcional)</span><input name="sku" value="${esc(c?.sku || '')}" /></label>
        <label class="field"><span>Precio</span><input name="price" type="number" step="0.01" min="0" value="${c?.price ?? ''}" required /></label>
      </div>
      <label class="field"><span>Unidad</span><input name="unit" value="${esc(c?.unit || 'servicio')}" /></label>
      <label class="field check"><input name="active" type="checkbox" ${c === null || c.active ? 'checked' : ''} /> <span>Activo (se puede usar en documentos)</span></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${c ? 'Guardar' : 'Agregar'}</button>
      </div>
    </form>`);
    const form = $('#modal .modal-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const input = {
        name: f.get('name'), sku: f.get('sku') || '',
        quantity: c?.quantity ?? 0, minQty: 0, unit: f.get('unit') || 'servicio',
        price: Number(f.get('price')) || 0, active: form.querySelector('[name=active]').checked,
      };
      try {
        await api(c ? `/api/inventory/${c.id}` : '/api/inventory', { method: c ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal(); toast(c ? 'Concepto actualizado' : 'Concepto agregado', 'ok');
        await refreshConcepts(); renderConceptos();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---------- Config ---------- */
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
      name: f.get('name'), phone: f.get('phone') || '', address: f.get('address') || '',
      currency: f.get('currency') || '$', timezone: f.get('timezone') || 'America/Mexico_City',
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
  $('#docs-new').addEventListener('click', () => { if (!state.customers.length) { switchPane('clientes'); return; } openNewDocument(); });
  $('#quick-new').addEventListener('click', () => { switchPane('documentos'); setTimeout(openNewDocument, 0); });
  $('#clientes-new').addEventListener('click', openNewCustomer);
  $('#conceptos-new').addEventListener('click', openNewConcepto);
  $('[data-go-documentos]').addEventListener('click', () => switchPane('documentos'));
  $('#docs-search').addEventListener('input', debounce((e) => { state.docFilter.q = e.target.value; renderDocumentos(); }, 250));
  $('#docs-type').addEventListener('change', (e) => {
    const v = e.target.value;
    state.docFilter.type = ['factura', 'nota_venta', 'cotizacion', 'recibo'].includes(v) ? v : '';
    renderDocumentos();
  });
  $('#clientes-search').addEventListener('input', debounce((e) => { state.docFilter.q = e.target.value; renderClientes(); }, 250));
  $('#conceptos-search').addEventListener('input', debounce((e) => { state.docFilter.q = e.target.value; renderConceptos(); }, 250));

  /* ---------- Bootstrap ---------- */
  (async () => {
    try {
      const session = await api('/api/auth/me');
      if (session) { await enterApp(); return; }
    } catch { /* no sesión */ }
    $('#auth-view').classList.remove('hidden');
  })();
})();