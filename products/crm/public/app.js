/* ============================================================
   CRM Pro · Gestión de clientes · Frontend SPA (vanilla)
   Cartera con etiquetas, seguimientos y actividad de visitas.
   Contratos de API: customers, followups, appointments, services,
   staff (core) · /api/customers, /api/followups, ...
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const HUMAN_STATUS = { pending: 'Pendiente', confirmed: 'Confirmada', done: 'Realizada', cancelled: 'Cancelada', noshow: 'No asistió' };
  const FOLLOW_STATUS = { pending: 'Pendiente', done: 'Hecho', cancelled: 'Cancelado' };

  const ICON = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 13"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  const state = {
    tenant: null,
    stats: null,
    customers: [],
    staff: [],
    services: [],
    appointments: [],
    followups: [],
    loaded: { customers: false, staff: false, services: false, appointments: false, followups: false },
    followFilter: { q: '', status: '' },
    prevFocus: null,
  };

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
      const a = btn.dataset.emptyAction;
      if (a === 'new-customer') openCustomerForm(null);
      if (a === 'new-appt') openCitaForm(null);
      if (a === 'new-follow') openFollowForm(null);
      if (a === 'refresh') refreshViews();
      if (a === 'refresh-follow') renderFollowups();
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
  const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  async function enterApp() {
    const { session, tenant, user } = await api('/api/auth/me');
    state.tenant = tenant;
    $('#auth-view').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-chip').textContent = user.name;
    $('#user-avatar').textContent = initials(user.name);
    $('#user-tenant').textContent = tenant.name;
    document.title = `${tenant.name} · CRM Pro`;
    await refreshViews();
    switchPane(initialView());
  }

  /* ---------- Navegación ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen de clientes y actividad'],
    clientes: ['Clientes', 'Cartera con etiquetas'],
    seguimientos: ['Seguimientos', 'Tareas de contacto con clientes'],
    citas: ['Visitas', 'Agenda y historial de visitas'],
    config: ['Configuración', 'Datos de tu negocio'],
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
    if (view === 'clientes') renderClientes();
    if (view === 'seguimientos') renderFollowups();
    if (view === 'citas') renderCitas();
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
  async function refreshViews() {
    const jobs = [];
    jobs.push(api('/api/followups/stats').then((s) => { state.stats = s; }).catch(() => null));
    jobs.push(api('/api/customers').then((c) => { state.customers = c.customers; state.loaded.customers = true; }).catch(() => null));
    jobs.push(api('/api/staff').then((s) => { state.staff = s.staffMembers ?? s.staff ?? []; state.loaded.staff = true; }).catch(() => null));
    jobs.push(api('/api/services').then((s) => { state.services = s.services; state.loaded.services = true; }).catch(() => null));
    jobs.push(api('/api/followups').then((f) => { state.followups = f.followups; state.loaded.followups = true; }).catch(() => null));
    jobs.push(loadAppointments(30).catch(() => null));
    await Promise.all(jobs);
    fillTagOptions();
  }

  function loadAppointments(rangeDays = 30) {
    const start = new Date(Date.now() - 45 * 86400_000);
    const end = new Date(Date.now() + rangeDays * 86400_000);
    const iso = (d) => d.toISOString().slice(0, 10);
    return api(`/api/appointments?from=${iso(start)}&to=${iso(end)}`).then((a) => {
      state.appointments = a.appointments;
      state.loaded.appointments = true;
      return a.appointments;
    });
  }

  function fillTagOptions() {
    const tags = [...new Set(state.customers.flatMap((c) => (c.tags || '').split(',').map((t) => t.trim()).filter(Boolean)))].sort();
    const sel = $('#clientes-tag');
    const current = sel.value;
    sel.innerHTML = `<option value="">Todas</option>` + tags.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
    sel.value = current;
  }

  function tagChips(c, limit = 3) {
    const tags = (c.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    const shown = tags.slice(0, limit).map((t) => `<span class="chip">${esc(t)}</span>`).join('');
    const extra = tags.length > limit ? `<span class="chip dim">+${tags.length - limit}</span>` : '';
    return `<span class="chip-row">${shown}${extra}</span>`;
  }

  const fmtDT = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const fmtD = (iso) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  const fmtDateOnly = (y) => { if (!y) return '—'; const d = new Date(`${y}T00:00:00`); return isNaN(d) ? y : new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(d); };

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 4 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-follow').innerHTML = $('#dash-tags').innerHTML = $('#dash-next').innerHTML = '';
    try {
      await refreshViews();
      const s = state.stats;
      if (!s) throw new Error('Sin respuesta del servidor');
      const metrics = [
        { label: 'Clientes', value: s.customers.total, icon: 'users', tone: '' },
        { label: 'Con correo', value: s.customers.withEmail, icon: 'mail', tone: '' },
        { label: 'Seguimientos', value: s.followups.pending, icon: 'pen', tone: '', sub: s.followups.overdue ? `${s.followups.overdue} vencidos` : 'al día' },
        { label: 'Visitas 30 días', value: s.visits.done30, icon: 'clock', tone: '', sub: s.visits.upcoming7 ? `+${s.visits.upcoming7} próximas` : 'sin próximas' },
      ];
      $('#dash-metrics').innerHTML = metrics.map((m) => `<div class="metric-card ${m.tone}">
        <span class="metric-icon">${svg(m.icon, 20)}</span>
        <div><p class="metric-value">${m.value}</p><p class="metric-label">${esc(m.label)}${m.sub ? ` · ${esc(m.sub)}` : ''}</p></div>
      </div>`).join('');

      const next = state.appointments
        .filter((a) => (a.status === 'pending' || a.status === 'confirmed') && Date.parse(a.start_at) > Date.now())
        .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))
        .slice(0, 6);
      $('#dash-next').innerHTML = next.length
        ? next.map((a) => `<div class="item-row">
            <span class="avatar">${svg('users', 15)}</span>
            <div class="item-meta"><b>${esc(a.customer?.name || '—')}</b><small>${esc(a.services.map((s) => s.name).join(', ') || a.notes || '')} · ${esc(fmtDT(a.start_at))}</small></div>
            <span class="tag ${a.status === 'confirmed' ? 'confirmed' : 'pending'}">${HUMAN_STATUS[a.status] || a.status}</span>
          </div>`).join('')
        : `<div class="empty-state"><span class="empty-icon">${svg('calendar', 24)}</span><h4>Sin próximas visitas</h4><p>Agenda una cita para mantener la cartera activa.</p><button class="btn primary sm" data-empty-action="new-appt" type="button">${svg('plus', 15)} Agendar</button></div>`;
      bindEmptyActions($('#dash-next'));

      const pending = state.followups.filter((f) => f.status === 'pending').slice(0, 6);
      $('#dash-follow').innerHTML = pending.length
        ? pending.map((f) => `<div class="item-row ${f.overdue ? 'row-low' : ''}">
            <span class="avatar ${f.overdue ? 'warn' : ''}">${svg(f.overdue ? 'alert' : 'pen', 15)}</span>
            <div class="item-meta"><b>${esc(f.customer?.name || '—')}</b><small>${esc(f.title)} · ${f.overdue ? 'venció el' : 'vence el'} ${esc(fmtDateOnly(f.due_date))}</small></div>
            <span class="tag ${f.overdue ? 'rejected' : 'draft'}">${f.overdue ? 'Vencido' : 'Pendiente'}</span>
          </div>`).join('')
        : `<div class="empty-state"><span class="empty-icon">${svg('check', 24)}</span><h4>Todo al día</h4><p>No hay seguimientos pendientes.</p></div>`;

      const tags = s.tags.slice(0, 12);
      $('#dash-tags').innerHTML = tags.length
        ? tags.map((t) => `<div class="item-row">
            <span class="avatar">${svg('tag', 15)}</span>
            <div class="item-meta"><b>${esc(t.tag)}</b><small>clientes etiquetados</small></div>
            <span class="tag accepted">${t.count}</span>
          </div>`).join('')
        : `<div class="empty-state"><span class="empty-icon">${svg('tag', 24)}</span><h4>Sin etiquetas</h4><p>Asigna etiquetas como «vip» o «frecuente» a tus clientes.</p></div>`;
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-next').innerHTML = $('#dash-follow').innerHTML = $('#dash-tags').innerHTML =
        `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" data-empty-action="refresh" type="button">Reintentar</button></div>`;
      bindEmptyActions($('#dash-next'));
    }
  }

  /* ---------- Clientes ---------- */
  async function renderClientes() {
    const tbody = $('#clientes-tbody');
    if (!state.loaded.customers) tbody.innerHTML = skeletonRows(6);
    try {
      const { customers } = await api('/api/customers');
      state.customers = customers;
      state.loaded.customers = true;
      fillTagOptions();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'refresh')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = $('#clientes-search').value.trim().toLowerCase();
    const tag = $('#clientes-tag').value;
    const rows = state.customers.filter((c) => {
      const matchQ = !q || `${c.name} ${c.email} ${c.phone} ${c.tags || ''} ${c.notes || ''}`.toLowerCase().includes(q);
      const matchTag = !tag || (c.tags || '').split(',').map((t) => t.trim()).includes(tag);
      return matchQ && matchTag;
    });
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin clientes', 'Registra clientes con email y teléfono para empezar a gestionar tu cartera.', 'Registrar cliente', 'new-customer', 'users')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    tbody.innerHTML = rows.map((c) => `<tr>
      <td><div><b>${esc(c.name)}</b></div></td>
      <td data-label="Teléfono" class="muted">${esc(c.phone || '—')}</td>
      <td data-label="Correo" class="muted">${esc(c.email || '—')}</td>
      <td data-label="Etiquetas">${tagChips(c)}</td>
      <td data-label="Notas" class="muted">${esc((c.notes || '').slice(0, 40)) || '—'}</td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-view-c="${c.id}" type="button" aria-label="Ver detalle de ${esc(c.name)}">${svg('eye', 15)}</button>
        <button class="btn ghost sm" data-edit="${c.id}" type="button" aria-label="Editar ${esc(c.name)}">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${c.id}" type="button" aria-label="Eliminar ${esc(c.name)}">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#clientes-tbody [data-view-c]').forEach((b) => b.addEventListener('click', () => openCustomerDetail(b.dataset.viewC)));
    $$('#clientes-tbody [data-edit]').forEach((b) => b.addEventListener('click', () => openCustomerForm(state.customers.find((c) => c.id === b.dataset.edit))));
    $$('#clientes-tbody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const c = state.customers.find((x) => x.id === b.dataset.del);
      const ok = await confirmDialog({ title: 'Eliminar cliente', message: `¿Eliminar a "${c?.name}"? El historial de seguimiento se borrará.`, danger: true });
      if (!ok) return;
      try {
        await api(`/api/customers/${c.id}`, { method: 'DELETE' });
        toast('Cliente eliminado', 'ok'); await refreshViews(); renderClientes();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  function openCustomerForm(c) {
    openModal(c ? `Editar · ${c.name}` : 'Nuevo cliente', `<form class="modal-form" novalidate>
      <label class="field"><span>Nombre</span><input name="name" value="${esc(c?.name || '')}" required /></label>
      <div class="form-grid two">
        <label class="field"><span>Teléfono</span><input name="phone" value="${esc(c?.phone || '')}" placeholder="+52…" /></label>
        <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(c?.email || '')}" /></label>
      </div>
      <label class="field"><span>Cumpleaños</span><input name="birthdate" type="date" value="${esc(c?.birthdate || '')}" /></label>
      <label class="field"><span>Etiquetas (separadas por coma)</span><input name="tags" value="${esc(c?.tags || '')}" placeholder="vip, frecuente, nuevo" /> </label>
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
      const input = { name: f.get('name'), phone: f.get('phone') || '', email: f.get('email') || '', birthdate: f.get('birthdate') || '', tags: f.get('tags') || '', notes: f.get('notes') || '' };
      try {
        await api(c ? `/api/customers/${c.id}` : '/api/customers', { method: c ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal(); toast(c ? 'Cliente actualizado' : 'Cliente registrado', 'ok');
        await refreshViews(); renderClientes();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function openCustomerDetail(id) {
    try {
      const { customer } = await api(`/api/customers/${id}`);
      const tags = (customer.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
      const html = `
        <div class="detail-grid">
          <div class="detail-item"><span>Visitas realizadas</span><b>${customer.visits}</b></div>
          <div class="detail-item"><span>Última visita</span><b>${customer.lastVisit ? esc(fmtDT(customer.lastVisit)) : '—'}</b></div>
          <div class="detail-item"><span>Próxima cita</span><b>${customer.nextVisit ? esc(fmtDT(customer.nextVisit)) : '—'}</b></div>
          <div class="detail-item"><span>Seguimientos abiertos</span><b>${customer.followupsPending?.length ?? 0}</b></div>
        </div>
        <div class="detail-section">
          <h4>Contacto</h4>
          <div class="chip-row">
            ${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}
            <span class="chip dim">${esc(customer.phone || 'sin teléfono')}</span>
            <span class="chip dim">${esc(customer.email || 'sin correo')}</span>
          </div>
          ${customer.notes ? `<p class="follow-body" style="margin-top:10px">${esc(customer.notes)}</p>` : ''}
        </div>
        <div class="detail-section">
          <h4>Seguimientos pendientes</h4>
          <div class="mini-list" id="detail-follow">
            ${(customer.followupsPending || []).length
              ? customer.followupsPending.map((f) => `<div class="mini-row"><span>${esc(f.title)}</span><span class="muted">${esc(f.due_date || 'sin fecha')}</span></div>`).join('')
              : `<p class="follow-body">Sin seguimientos abiertos.</p>`}
          </div>
        </div>
        <div class="row-actions" style="margin-top:16px">
          <button type="button" class="btn ghost" data-close>Cerrar</button>
          <button type="button" class="btn primary" data-cf="${id}" data-cn="${esc(customer.name)}">${svg('pen', 15)} Crear seguimiento</button>
        </div>`;
      openModal(customer.name, html);
      $('#modal').querySelector('[data-cf]').addEventListener('click', () => { closeModal(); openFollowForm({ customerId: id }); });
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ---------- Seguimientos ---------- */
  async function renderFollowups() {
    const tbody = $('#follow-tbody');
    if (!state.loaded.followups) tbody.innerHTML = skeletonRows(5);
    const q = state.followFilter.q.trim();
    const status = state.followFilter.status;
    const params = new URLSearchParams();
    if (status === 'overdue') params.set('overdue', '1');
    else if (status) params.set('status', status);
    if (q) params.set('q', q);
    try {
      const { followups } = await api(`/api/followups?${params}`);
      state.followups = followups;
      state.loaded.followups = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'refresh-follow')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    if (!state.followups.length) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin seguimientos', 'Crea tareas de contacto: llamar, cotizar, encuestar…', 'Nuevo seguimiento', 'new-follow', 'pen')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    tbody.innerHTML = state.followups.map((f) => `<tr class="${f.overdue ? 'row-low' : ''}">
      <td><b>${esc(f.customer?.name || '—')}</b></td>
      <td><b>${esc(f.title)}</b>${f.body ? `<div class="follow-body">${esc(f.body)}</div>` : ''}</td>
      <td data-label="Vence"><span class="${f.overdue ? 'due-over' : 'muted'}">${f.due_date ? esc(fmtDateOnly(f.due_date)) : '—'}</span></td>
      <td data-label="Estado"><span class="tag ${f.status === 'done' ? 'done' : f.status === 'cancelled' ? 'cancelled' : f.overdue ? 'rejected' : 'pending'}">${FOLLOW_STATUS[f.status] || f.status}${f.overdue ? ' · vencido' : ''}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        ${f.status === 'pending' ? `<button class="btn ghost sm" data-mark="${f.id}" type="button" title="Marcar hecho">${svg('check', 15)} Hecho</button>` : ''}
        <button class="btn ghost sm" data-edit="${f.id}" type="button" aria-label="Editar">${svg('edit', 15)}</button>
        <button class="btn danger sm" data-del="${f.id}" type="button" aria-label="Eliminar">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#follow-tbody [data-mark]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/followups/${b.dataset.mark}`, { method: 'PUT', body: JSON.stringify({ status: 'done' }) });
        toast('Seguimiento completado', 'ok');
        await refreshViews(); renderFollowups();
      } catch (e) { toast(e.message, 'error'); }
    }));
    $$('#follow-tbody [data-edit]').forEach((b) => b.addEventListener('click', () => openFollowForm(state.followups.find((f) => f.id === b.dataset.edit))));
    $$('#follow-tbody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Eliminar seguimiento', message: '¿Eliminar este seguimiento?', danger: true });
      if (!ok) return;
      try {
        await api(`/api/followups/${b.dataset.del}`, { method: 'DELETE' });
        toast('Seguimiento eliminado', 'ok'); await refreshViews(); renderFollowups();
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  function openFollowForm(f) {
    const customers = state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    openModal(f ? 'Editar seguimiento' : 'Nuevo seguimiento', `<form class="modal-form" id="follow-form" novalidate>
      <label class="field"><span>Cliente</span><select name="customerId" required>${customers}</select></label>
      <label class="field"><span>Título</span><input name="title" value="${esc(f?.title || '')}" placeholder="Llamar para renovar" required /></label>
      <label class="field"><span>Notas</span><textarea name="body" rows="3">${esc(f?.body || '')}</textarea></label>
      <label class="field"><span>Fecha límite</span><input name="dueDate" type="date" value="${esc(f?.due_date || today)}" /></label>
      ${f ? `<label class="field"><span>Estado</span><select name="status">
        <option value="pending">Pendiente</option>
        <option value="done">Hecho</option>
        <option value="cancelled">Cancelado</option>
      </select></label>` : ''}
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${f ? 'Guardar' : 'Crear'}</button>
      </div>
    </form>`);
    const form = $('#follow-form');
    const sel = form.querySelector('[name=customerId]');
    if (f) {
      sel.value = f.customer_id || f.customerId || (f.customer ? f.customer.id : '');
      if (f.status) form.querySelector('[name=status]').value = f.status;
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const input = { customerId: fd.get('customerId'), title: fd.get('title'), body: fd.get('body') || '', dueDate: fd.get('dueDate') || '' };
      if (f) input.status = fd.get('status');
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api(f ? `/api/followups/${f.id}` : '/api/followups', { method: f ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal(); toast(f ? 'Seguimiento actualizado' : 'Seguimiento creado', 'ok');
        await refreshViews(); renderFollowups();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }

  /* ---------- Visitas ---------- */
  const staffName = (id) => state.staff.find((s) => s.id === id)?.name || '—';

  async function renderCitas() {
    const tbody = $('#citas-tbody');
    if (!state.loaded.appointments) tbody.innerHTML = skeletonRows(6);
    try {
      await loadAppointments();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'refresh')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = $('#citas-search').value.trim().toLowerCase();
    const rows = q
      ? state.appointments.filter((a) => `${a.customer?.name ?? ''} ${a.services.map((s) => s.name).join(' ')} ${a.notes ?? ''}`.toLowerCase().includes(q))
      : state.appointments;
    const sorted = [...rows].sort((a, b) => Date.parse(b.start_at) - Date.parse(a.start_at)).slice(0, 100);
    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin visitas', 'Agenda una cita para registrar la actividad del cliente.', 'Nueva visita', 'new-appt', 'calendar')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    tbody.innerHTML = sorted.map((a) => `<tr>
      <td><b>${esc(a.customer?.name || '—')}</b></td>
      <td data-label="Cuándo" class="muted">${esc(fmtDT(a.start_at))}</td>
      <td data-label="Servicio" class="muted">${esc(a.services.map((s) => s.name).join(', ') || a.notes || '—')}</td>
      <td data-label="Quién" class="muted">${esc(staffName(a.staff_id))}</td>
      <td data-label="Estado"><span class="tag ${a.status === 'confirmed' ? 'confirmed' : a.status === 'done' ? 'done' : a.status === 'cancelled' ? 'cancelled' : 'pending'}">${HUMAN_STATUS[a.status] || a.status}</span></td>
      <td data-label="Acciones"><div class="row-actions">
        <button class="btn ghost sm" data-status="${a.id}" data-to="${a.status === 'pending' ? 'confirmed' : a.status === 'confirmed' ? 'done' : 'confirmed'}" type="button">${a.status === 'pending' ? 'Confirmar' : a.status === 'confirmed' ? 'Realizada' : 'Confirmar'}</button>
        <button class="btn danger sm" data-del="${a.id}" type="button" aria-label="Eliminar cita">${svg('trash', 15)}</button>
      </div></td>
    </tr>`).join('');
    $$('#citas-tbody [data-status]').forEach((b) => b.addEventListener('click', async () => {
      try {
        await api(`/api/appointments/${b.dataset.status}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.to }) });
        toast('Estado actualizado', 'ok'); await loadAppointments(); renderCitas();
      } catch (err) { toast(err.message, 'error'); }
    }));
    $$('#citas-tbody [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({ title: 'Eliminar cita', message: '¿Eliminar esta cita?', danger: true });
      if (!ok) return;
      try {
        await api(`/api/appointments/${b.dataset.del}`, { method: 'DELETE' });
        toast('Cita eliminada', 'ok'); await loadAppointments(); renderCitas();
      } catch (err) { toast(err.message, 'error'); }
    }));
  }

  function openCitaForm(c) {
    const customers = state.customers.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    const staff = state.staff.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    const services = state.services.map((x) => `<option value="${x.id}" data-min="${x.durationMin}">${esc(x.name)}</option>`).join('');
    const when = c ? new Date(c.start_at).toISOString().slice(0, 16) : new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16);
    openModal(c ? 'Editar cita' : 'Nueva visita', `<form class="modal-form" id="cita-form" novalidate>
      <label class="field"><span>Cliente</span><select name="customerId">${customers}</select></label>
      <label class="field"><span>Fecha y hora</span><input name="startAt" type="datetime-local" value="${esc(when)}" required /></label>
      <div class="form-row">
        <label class="field"><span>Servicio</span><select name="serviceId">${services}</select></label>
        <label class="field"><span>Quién atiende</span><select name="staffId">${staff}</select></label>
      </div>
      <label class="field"><span>Notas</span><input name="notes" value="${esc(c?.notes || '')}" placeholder="Motivo de la visita" /></label>
      ${c ? `<label class="field"><span>Estado</span><select name="status">
        <option value="${esc(c.status)}">${esc(HUMAN_STATUS[c.status] || c.status)}</option>
        <option value="pending">Pendiente</option><option value="confirmed">Confirmada</option>
        <option value="done">Realizada</option><option value="cancelled">Cancelada</option><option value="noshow">No asistió</option>
      </select></label>` : ''}
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${c ? 'Guardar' : 'Agendar'}</button>
      </div>
    </form>`);
    const form = $('#cita-form');
    if (c) {
      form.querySelector('[name=customerId]').value = c.customer_id;
      if (c.staff_id) form.querySelector('[name=staffId]').value = c.staff_id;
      if (c.services[0]) form.querySelector('[name=serviceId]').value = c.services[0].id;
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const svc = state.services.find((s) => s.id === f.get('serviceId')) || state.services[0];
      const input = {
        customerId: f.get('customerId'),
        staffId: f.get('staffId') || null,
        startAt: new Date(f.get('startAt')).toISOString(),
        durationMin: svc?.durationMin ?? 30,
        serviceIds: [f.get('serviceId')],
        notes: f.get('notes') || '',
      };
      if (c) input.status = f.get('status');
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api(c ? `/api/appointments/${c.id}` : '/api/appointments', { method: c ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal(); toast(c ? 'Cita actualizada' : 'Visita agendada', 'ok');
        await loadAppointments(); renderCitas();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }

  /* ---------- Config ---------- */
  function renderConfig() {
    const t = state.tenant;
    $$('#config input').forEach((el) => { if (el.name) el.value = t[el.name] ?? ''; });
  }
  $('#config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', e.target);
    err.textContent = '';
    const f = new FormData($('#config-form'));
    const input = {
      name: f.get('name'), phone: f.get('phone') || '', address: f.get('address') || '',
      currency: f.get('currency') || '$', timezone: f.get('timezone') || 'America/Mexico_City',
    };
    try {
      const { tenant } = await api('/api/auth/settings', { method: 'PUT', body: JSON.stringify(input) });
      state.tenant = tenant;
      $('#user-tenant').textContent = tenant.name;
      toast('Configuración guardada', 'ok');
      await refreshViews();
    } catch (ex) { err.textContent = ex.message; }
  });

  /* ---------- Helpers ---------- */
  function debounce(fn, ms = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------- Bindings ---------- */
  $('#citas-new').addEventListener('click', () => { if (!state.customers.length) { switchPane('clientes'); return; } openCitaForm(null); });
  $('#clientes-new').addEventListener('click', () => openCustomerForm(null));
  $('#follow-new').addEventListener('click', () => { if (!state.customers.length) { switchPane('clientes'); return; } openFollowForm(null); });
  $('[data-go-follow]').addEventListener('click', () => { if (!state.customers.length) { switchPane('clientes'); return; } openFollowForm(null); });
  $('[data-go-citas]').addEventListener('click', () => switchPane('citas'));
  $('#clientes-search').addEventListener('input', debounce(() => renderClientes(), 250));
  $('#clientes-tag').addEventListener('change', () => renderClientes());
  $('#follow-search').addEventListener('input', debounce((e) => { state.followFilter.q = e.target.value; renderFollowups(); }, 250));
  $('#follow-status').addEventListener('change', (e) => { state.followFilter.status = e.target.value; renderFollowups(); });
  $('#citas-search').addEventListener('input', debounce(() => renderCitas(), 250));

  /* ---------- Bootstrap ---------- */
  (async () => {
    try {
      const session = await api('/api/auth/me');
      if (session) { await enterApp(); return; }
    } catch { /* no sesión */ }
    $('#auth-view').classList.remove('hidden');
  })();
})();