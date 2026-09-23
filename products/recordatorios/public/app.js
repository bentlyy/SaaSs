/* ============================================================
   Alertas Pro · Recordatorios WhatsApp/email · Frontend SPA (vanilla)
   Panel de envíos: canales, histórico, próximas citas y prueba de
   recordatorios. Contratos de API: reminders, appointments, customers,
   services, staff (core) · /api/reminders, /api/appointments, ...
   ============================================================ */
(() => {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const daysAgo = (iso) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86400_000));
  const HUMAN_STATUS = { pending: 'Pendiente', confirmed: 'Confirmada', done: 'Realizada', cancelled: 'Cancelada', noshow: 'No asistió' };

  const ICON = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 13"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
    inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
    whatsapp: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/><path d="M9.5 9.5a.5.5 0 0 0 0 5 4 4 0 0 0 4 4 .5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5 2.5 2.5 0 0 1-.5-.06 2.5 2.5 0 0 1-.44-.22l-.17-.08a4 4 0 0 1-.75-.75H9.6a.5.5 0 0 1-.09-.86z"/>',
    edit: '<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
    settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  };
  const svg = (name, size = 18) =>
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name] || ICON.info}</svg>`;

  const state = {
    tenant: null,
    status: null,
    scheduled: [],
    logs: [],
    customers: [],
    staff: [],
    services: [],
    appointments: [],
    loaded: { customers: false, staff: false, services: false, appointments: false },
    envioFilter: { q: '', channel: '', status: '' },
    prevFocus: null,
    quickNew: null,
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
      if (a === 'refresh') refreshViews();
      if (a === 'reload-logs') renderEnvioLogs();
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
    document.title = `${tenant.name} · Alertas Pro`;
    await refreshViews();
    switchPane(initialView());
  }

  /* ---------- Navegación ---------- */
  const VIEW_META = {
    dashboard: ['Inicio', 'Resumen de recordatorios'],
    envios: ['Envíos', 'Historial de mensajes'],
    proximas: ['Próximas citas', 'Recordatorios por enviar'],
    citas: ['Citas', 'Agenda de visitas'],
    clientes: ['Clientes', 'Contactos de tus clientes'],
    config: ['Configuración', 'Canales y negocio'],
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
    if (view === 'envios') renderEnvioLogs();
    if (view === 'proximas') renderScheduled();
    if (view === 'citas') renderCitas();
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
  async function refreshViews() {
    const jobs = [];
    jobs.push(api('/api/reminders/status').then((s) => { state.status = s; }).catch(() => null));
    jobs.push(api('/api/reminders/scheduled').then((s) => { state.scheduled = s.items; }).catch(() => null));
    jobs.push(api('/api/reminders/logs?limit=100').then((l) => { state.logs = l.logs; }).catch(() => null));
    jobs.push(api('/api/customers').then((c) => { state.customers = c.customers; state.loaded.customers = true; }).catch(() => null));
    jobs.push(api('/api/staff').then((s) => { state.staff = s.staffMembers ?? s.staff ?? []; state.loaded.staff = true; }).catch(() => null));
    jobs.push(api('/api/services').then((s) => { state.services = s.services; state.loaded.services = true; }).catch(() => null));
    await Promise.all(jobs);
  }

  function loadAppointments(rangeDays = 21) {
    const start = new Date(Date.now() - 7 * 86400_000);
    const end = new Date(Date.now() + rangeDays * 86400_000);
    const iso = (d) => d.toISOString().slice(0, 10);
    return api(`/api/appointments?from=${iso(start)}&to=${iso(end)}`).then((a) => {
      state.appointments = a.appointments;
      state.loaded.appointments = true;
      return a.appointments;
    });
  }

  /* ---------- Procesar ahora ---------- */
  async function runReminders(btnId) {
    const btn = $(btnId);
    if (btn) { btn.disabled = true; btn.innerHTML = svg('refresh', 15) + ' <span>Procesando…</span>'; }
    try {
      const r = await api('/api/reminders/run', { method: 'POST' });
      toast(`${r.sent} recordatorio(s) procesado(s)`, r.sent ? 'ok' : 'info');
      await refreshViews();
      if (window.location.hash === '#/envios' || true) renderEnvioLogs();
      renderDashboard();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = svg('send', 15) + ' <span>Procesar ahora</span>'; }
    }
  }
  $('#run-now').addEventListener('click', () => runReminders('#run-now'));
  $('#quick-run').addEventListener('click', () => runReminders('#quick-run'));

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    $('#dash-metrics').innerHTML = Array.from({ length: 4 }, () =>
      `<div class="metric-card"><span class="metric-icon skeleton-cell" style="width:46px;height:46px;border-radius:12px"></span><div style="flex:1"><div class="skeleton-cell" style="width:60%"></div><div class="skeleton-cell" style="width:40%;margin-top:8px"></div></div></div>`).join('');
    $('#dash-channels').innerHTML = $('#dash-logs').innerHTML = '<div class="empty-state"><div class="skeleton-cell" style="width:70%"></div><div class="skeleton-cell" style="width:50%"></div></div>';
    try {
      await refreshViews();
      const s = state.status;
      if (!s) throw new Error('Sin respuesta del servidor');
      const metrics = [
        { label: 'Enviados', value: s.logs.sent, icon: 'check', tone: 'brand' },
        { label: 'Fallidos', value: s.logs.failed, icon: 'alert', tone: s.logs.failed ? 'warn' : 'brand' },
        { label: 'Citas por recordar', value: s.upcoming, icon: 'clock', tone: 'brand' },
        { label: 'Anticipación', value: `${s.reminderHours}h`, icon: 'send', tone: 'brand' },
      ];
      $('#dash-metrics').innerHTML = metrics.map((m) => `<div class="metric-card">
        <span class="metric-icon ${m.tone}">${svg(m.icon, 20)}</span>
        <div><p class="metric-value">${m.value}</p><p class="metric-label">${esc(m.label)}</p></div>
      </div>`).join('');

      const emailOk = s.channels.email.enabled && s.channels.email.configured;
      const waOk = s.channels.whatsapp.enabled;
      const channels = [
        { name: 'Email', icon: 'mail', ok: emailOk, note: s.channels.email.enabled ? (s.channels.email.configured ? 'SMTP configurado en .env' : 'SMTP pendiente (.env)') : 'Deshabilitado' },
        { name: 'WhatsApp', icon: 'whatsapp', ok: waOk, note: s.channels.whatsapp.enabled ? 'Webhook listo' : 'Webhook pendiente' },
      ];
      $('#dash-channels').innerHTML = channels.map((c) => `<div class="item-row">
        <span class="avatar ${c.ok ? '' : 'warn'}">${svg(c.icon, 15)}</span>
        <div class="item-meta"><b>${esc(c.name)}</b><small>${esc(c.note)}</small></div>
        <span class="tag ${c.ok ? 'accepted' : 'rejected'}">${c.ok ? 'Activo' : 'Inactivo'}</span>
      </div>`).join('');

      $('#dash-logs').innerHTML = state.logs.length
        ? state.logs.slice(0, 5).map((l) => `<div class="item-row">
            <span class="avatar">${svg(l.channel === 'whatsapp' ? 'whatsapp' : 'mail', 15)}</span>
            <div class="item-meta"><b>${esc(l.customer?.name || '—')}</b><small>${esc(l.channel)} · ${l.appointment ? rowDate(l.appointment.start_at) : ''}</small></div>
            <span class="tag ${l.status === 'sent' ? 'accepted' : 'rejected'}">${l.status === 'sent' ? 'Enviado' : 'Fallido'}</span>
          </div>`).join('')
        : `<div class="empty-state"><span class="empty-icon">${svg('inbox', 24)}</span><h4>Sin envíos</h4><p>Ejecuta «Procesar ahora» o espera el scheduler.</p></div>`;
    } catch (e) {
      $('#dash-metrics').innerHTML = '';
      $('#dash-channels').innerHTML = $('#dash-logs').innerHTML =
        `<div class="empty-state"><span class="empty-icon">${svg('alert', 24)}</span><h4>No se pudo cargar</h4><p>${esc(e.message)}</p><button class="btn ghost sm" id="dash-retry" type="button">Reintentar</button></div>`;
      $('#dash-retry')?.addEventListener('click', renderDashboard);
    }
  }

  function rowDate(iso) {
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  }

  /* ---------- Envíos ---------- */
  async function renderEnvioLogs() {
    const tbody = $('#logs-tbody');
    try {
      const q = state.envioFilter.q.trim().toLowerCase();
      const params = new URLSearchParams({ limit: '200' });
      if (state.envioFilter.channel) params.set('channel', state.envioFilter.channel);
      if (state.envioFilter.status) params.set('status', state.envioFilter.status);
      const { logs } = await api(`/api/reminders/logs?${params}`);
      state.logs = logs;
      const filtered = q ? logs.filter((l) => `${l.customer?.name} ${l.channel} ${l.appointment?.notes} ${l.error}`.toLowerCase().includes(q)) : logs;
      if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin envíos', 'Aún no hay recordatorios enviados. Procesa ahora o agenda citas confirmadas.', 'Procesar ahora', 'refresh', 'send')}</td></tr>`;
        bindEmptyActions(tbody);
        return;
      }
      tbody.innerHTML = filtered.map((l) => `<tr>
        <td><b>${esc(l.customer?.name || '—')}</b></td>
        <td data-label="Canal"><span class="tag ${l.channel === 'whatsapp' ? 'sent' : 'draft'}">${l.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}</span></td>
        <td data-label="Estado"><span class="tag ${l.status === 'sent' ? 'accepted' : 'rejected'}">${l.status === 'sent' ? 'Enviado' : 'Fallido'}</span></td>
        <td data-label="Para" class="muted">${esc(l.channel === 'email' ? l.customer?.email : l.customer?.phone) || '—'}</td>
        <td data-label="Fecha" class="muted">${esc(rowDate(l.sent_at))}</td>
        <td data-label="Detalle" class="muted">${esc((l.error || l.appointment?.notes || 'OK').slice(0, 40))}</td>
      </tr>`).join('');
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'reload-logs')}</td></tr>`;
      bindEmptyActions(tbody);
    }
  }

  /* ---------- Próximas citas ---------- */
  async function renderScheduled() {
    const tbody = $('#scheduled-tbody');
    try {
      const { items, reminderHours } = await api('/api/reminders/scheduled');
      state.scheduled = items;
      $('#hours-hint').textContent = `${reminderHours}`;
      if (!items.length) {
        tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin recordatorios pendientes', 'No hay citas confirmadas dentro de la ventana de anticipación.', 'Ver citas', 'new-appt', 'clock')}</td></tr>`;
        bindEmptyActions(tbody);
        return;
      }
      tbody.innerHTML = items.map((a) => `<tr>
        <td><b>${esc(a.customer?.name || '—')}</b></td>
        <td data-label="Cita" class="muted">${esc(rowDate(a.start_at))}</td>
        <td data-label="Servicio" class="muted">${esc(a.services.map((s) => s.name).join(', ') || a.notes || '—')}</td>
        <td data-label="Email"><span class="tag ${a.sent.email ? (a.sent.email === 'sent' ? 'accepted' : 'rejected') : 'draft'}">${a.sent.email ? (a.sent.email === 'sent' ? 'Enviado' : 'Falló') : 'Pendiente'}</span></td>
        <td data-label="WhatsApp"><span class="tag ${a.sent.whatsapp ? (a.sent.whatsapp === 'sent' ? 'accepted' : 'rejected') : 'draft'}">${a.sent.whatsapp ? (a.sent.whatsapp === 'sent' ? 'Enviado' : 'Falló') : 'Pendiente'}</span></td>
        <td data-label="Probar"><div class="row-actions">
          <button class="btn ghost sm" data-test="${a.id}" data-channel="email" type="button">${svg('mail', 15)} Email</button>
          <button class="btn ghost sm" data-test="${a.id}" data-channel="whatsapp" type="button">${svg('whatsapp', 15)} WhatsApp</button>
        </div></td>
      </tr>`).join('');
      $$('#scheduled-tbody [data-test]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        const label = b.dataset.channel === 'whatsapp' ? 'WhatsApp' : 'Email';
        try {
          const r = await api('/api/reminders/test', { method: 'POST', body: JSON.stringify({ appointmentId: b.dataset.test, channel: b.dataset.channel }) });
          toast(r.ok ? `${label}: envío exitoso` : `${label}: ${r.error}`, r.ok ? 'ok' : 'error');
          await renderScheduled(); renderEnvioLogs();
        } catch (e) {
          toast(e.message, 'error');
          b.disabled = false;
        }
      }));
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'refresh')}</td></tr>`;
      bindEmptyActions(tbody);
    }
  }
  $('#scheduled-refresh').addEventListener('click', () => { renderScheduled(); renderEnvioLogs(); renderDashboard(); });

  /* ---------- Citas ---------- */
  async function renderCitas() {
    const tbody = $('#citas-tbody');
    if (!state.loaded.appointments) tbody.innerHTML = skeletonRows(5);
    try {
      await loadAppointments();
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'refresh')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = $('#citas-search').value.trim().toLowerCase();
    const rows = q
      ? state.appointments.filter((a) => `${a.customer?.name ?? ''} ${a.services.map((s) => s.name).join(' ')} ` .toLowerCase().includes(q))
      : state.appointments;
    const sorted = [...rows].sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)).slice(0, 100);
    if (!sorted.length) {
      tbody.innerHTML = `<tr><td colspan="6">${emptyStateHtml('Sin citas', 'Agenda una cita para poder enviar recordatorios.', 'Nueva cita', 'new-appt', 'calendar')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    tbody.innerHTML = sorted.map((a) => `<tr>
      <td><b>${esc(a.customer?.name || '—')}</b></td>
      <td data-label="Cuándo" class="muted">${esc(rowDate(a.start_at))}</td>
      <td data-label="Servicio" class="muted">${esc(a.services.map((s) => s.name).join(', ') || '—')}</td>
      <td data-label="Quién" class="muted">${esc(staffName(a.staff_id))}</td>
      <td data-label="Estado"><span class="tag ${a.status === 'confirmed' ? 'sent' : a.status === 'done' ? 'accepted' : 'draft'}">${HUMAN_STATUS[a.status] || a.status}</span></td>
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

  const staffName = (id) => state.staff.find((s) => s.id === id)?.name || '—';

  function openCitaForm(c) {
    const customers = state.customers.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    const staff = state.staff.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    const services = state.services.map((x) => `<option value="${x.id}" data-min="${x.durationMin}">${esc(x.name)}</option>`).join('');
    const when = c ? new Date(c.start_at).toISOString().slice(0, 16) : new Date(Date.now() + 60 * 60_000).toISOString().slice(0, 16);
    const firstServiceId = state.services[0]?.id ?? '';
    openModal(c ? `Editar cita` : 'Nueva cita', `<form class="modal-form" id="cita-form" novalidate>
      <label class="field"><span>Cliente</span><select name="customerId">${customers}</select></label>
      <label class="field"><span>Fecha y hora</span><input name="startAt" type="datetime-local" value="${esc(when)}" required /></label>
      <div class="form-row">
        <label class="field"><span>Servicio</span><select name="serviceId" ${c ? `data-current="${esc(c.services[0]?.id ?? '')}"` : ''}>${services}</select></label>
        <label class="field"><span>Quién atiende</span><select name="staffId">${staff}</select></label>
      </div>
      <label class="field"><span>Notas</span><input name="notes" value="${esc(c?.notes || '')}" placeholder="Qué se le recuerda al cliente" /></label>
      <div class="row-actions">
        <button type="button" class="btn ghost" data-close>Cancelar</button>
        <button type="submit" class="btn primary">${c ? 'Guardar' : 'Agendar'}</button>
      </div>
    </form>`);
    const form = $('#cita-form');
    const svcSel = form.querySelector('[name=serviceId]');
    if (c && c.services[0]) svcSel.value = c.services[0].id;
    if (c && c.staff_id) form.querySelector('[name=staffId]').value = c.staff_id;
    const mapStatus = { pending: 'confirmed', confirmed: 'done' };
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
        status: c ? mapStatus[c.status] || c.status : 'pending',
      };
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        await api(c ? `/api/appointments/${c.id}` : '/api/appointments', { method: c ? 'PUT' : 'POST', body: JSON.stringify(input) });
        closeModal();
        toast(c ? 'Cita actualizada' : 'Cita agendada', 'ok');
        await loadAppointments(); renderCitas();
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
  }

  /* ---------- Clientes ---------- */
  async function renderClientes() {
    const tbody = $('#clientes-tbody');
    if (!state.loaded.customers) tbody.innerHTML = skeletonRows(5);
    try {
      const { customers } = await api('/api/customers');
      state.customers = customers;
      state.loaded.customers = true;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('No se pudo cargar', e.message, 'Reintentar', 'refresh')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    const q = $('#clientes-search').value.trim().toLowerCase();
    const rows = q ? state.customers.filter((c) => `${c.name} ${c.email}`.toLowerCase().includes(q)) : state.customers;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5">${emptyStateHtml('Sin clientes', 'Registra clientes con email y teléfono para recibir recordatorios.', 'Registrar cliente', 'new-customer', 'users')}</td></tr>`;
      bindEmptyActions(tbody);
      return;
    }
    tbody.innerHTML = rows.map((c) => `<tr>
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
      const ok = await confirmDialog({ title: 'Eliminar cliente', message: `¿Eliminar a "${c?.name}"? Sus citas quedan bloqueadas.`, danger: true });
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
      <div class="form-row">
        <label class="field"><span>Teléfono (WhatsApp)</span><input name="phone" value="${esc(c?.phone || '')}" placeholder="+52…" /></label>
        <label class="field"><span>Correo</span><input name="email" type="email" value="${esc(c?.email || '')}" /></label>
      </div>
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
        await refreshViews(); renderClientes();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---------- Config ---------- */
  function renderConfig() {
    const t = state.tenant;
    const form = $('#config-form').closest('section');
    $$('#config input, #config select').forEach((el) => {
      if (!el.name) return;
      if (el.type === 'checkbox') el.checked = Boolean(t[el.name]);
      else el.value = t[el.name] ?? '';
    });
  }
  $('#config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('[data-err]', e.target);
    err.textContent = '';
    const f = new FormData($('#config-form'));
    const input = {
      name: f.get('name'), phone: f.get('phone') || '', address: f.get('address') || '',
      currency: f.get('currency') || '$', timezone: f.get('timezone') || 'America/Mexico_City',
      emailEnabled: $('#config-form').querySelector('[name=emailEnabled]').checked,
      whatsappWebhook: f.get('whatsappWebhook') || '', whatsappToken: f.get('whatsappToken') || '',
      reminderHours: Number(f.get('reminderHours')) || 24,
    };
    try {
      const { tenant } = await api('/api/auth/settings', { method: 'PUT', body: JSON.stringify(input) });
      state.tenant = tenant;
      $('#user-tenant').textContent = tenant.name;
      toast('Configuración guardada', 'ok');
      await refreshViews(); renderDashboard();
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
  $('[data-go-config]').addEventListener('click', () => switchPane('config'));
  $('#logs-search').addEventListener('input', debounce((e) => { state.envioFilter.q = e.target.value; renderEnvioLogs(); }, 250));
  $('#logs-channel').addEventListener('change', (e) => { state.envioFilter.channel = e.target.value === 'email' || e.target.value === 'whatsapp' ? e.target.value : ''; renderEnvioLogs(); });
  $('#logs-status').addEventListener('change', (e) => { state.envioFilter.status = e.target.value === 'sent' || e.target.value === 'failed' ? e.target.value : ''; renderEnvioLogs(); });
  $('#citas-search').addEventListener('input', debounce((e) => { state.envioFilter.q = e.target.value; renderCitas(); }, 250));
  $('#clientes-search').addEventListener('input', debounce((e) => { state.envioFilter.q = e.target.value; renderClientes(); }, 250));

  /* ---------- Bootstrap ---------- */
  (async () => {
    try {
      const session = await api('/api/auth/me');
      if (session) { await enterApp(); return; }
    } catch { /* no sesión */ }
    $('#auth-view').classList.remove('hidden');
  })();
})();