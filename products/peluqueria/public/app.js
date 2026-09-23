/* Peluquería · frontend SPA minimalista (sin frameworks) */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => [...document.querySelectorAll(sel)];
  const money = (v) => `$${Number(v ?? 0).toLocaleString('es')}`;
  const moneyCents = (cents) => `$${(Number(cents ?? 0) / 100).toLocaleString('es', { minimumFractionDigits: 2 })}`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    session: null,
    tenant: null,
    year: 0,
    month: 0,
    monday: null,
    customers: [],
    services: [],
    staff: [],
    appointments: [],
    items: [],
    documents: [],
  };

  const STATUS_LABEL = {
    pending: 'Pendiente', confirmed: 'Confirmada', done: 'Completada',
    cancelled: 'Cancelada', noshow: 'No asistió',
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

  function toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  /* ---------- MODAL ---------- */
  function openModal(title, html) {
    $('#modal-title').textContent = title;
    $('#modal-body').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal-body').innerHTML = ''; }
  $('#modal').addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]') || e.target === $('#modal');
    if (close) closeModal();
  });

  /* ---------- AUTH ---------- */
  $$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
    $('#login-form').classList.toggle('hidden', btn.dataset.tab !== 'login');
    $('#register-form').classList.toggle('hidden', btn.dataset.tab !== 'register');
  }));

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
      enterApp();
    } catch (err) { $('[data-err]', $('#login-form')).textContent = err.message; }
  });

  $('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await api('/api/auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) });
      toast('Cuenta creada. Bienvenido/a', 'ok');
      enterApp();
    } catch (err) { $('[data-err]', $('#register-form')).textContent = err.message; }
  });

  $('#logout-btn').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    location.reload();
  });

  async function enterApp() {
    const { session, tenant, user } = await api('/api/auth/me');
    state.session = session;
    state.tenant = tenant;
    $('#auth-view').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#user-chip').textContent = `${user.name} · ${session.role}`;
    document.title = `${tenant.name} · Peluquería`;
    await refreshAll();
  }

  /* ---------- NAVEGACIÓN ---------- */
  $$('.nav-btn').forEach((btn) => btn.addEventListener('click', () => {
    $$('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
    const view = btn.dataset.view;
    $$('[data-view-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.viewPane !== view));
  }));

  /* ---------- AGENDA ---------- */
  function startOfWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = (d.getDay() + 6) % 7; // lunes = 0
    d.setDate(d.getDate() - day);
    return d;
  }
  function setWeekFromDate(date) {
    const monday = startOfWeek(date);
    state.year = monday.getFullYear();
    state.month = monday.getMonth();
    state.monday = monday;
    renderAgenda();
  }
  const DAY_NAMES = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  async function renderAgenda() {
    const monday = state.monday;
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    $('#agenda-range').textContent = `${fmt(monday)} → ${fmt(sunday)}`;

    const today = new Date();
    const todayKey = today.toDateString();
    state.appointments = [];
    try {
      const { appointments } = await api(`/api/appointments?from=${fmt(monday)}&to=${fmt(sunday)}`);
      state.appointments = appointments;
    } catch (e) { toast(e.message, 'error'); return; }

    const staffMap = new Map(state.staff.map((s) => [s.id, s]));
    const custMap = new Map(state.customers.map((c) => [c.id, c]));

    const START_HOUR = 8;
    const END_HOUR = 20;
    const SLOT_H = 44;

    // cabecera
    let head = `<div class="agenda-head" style="grid-template-columns:56px repeat(7,1fr)">`;
    head += `<div></div>`;
    for (let i = 0; i < 7; i++) {
      const day = new Date(monday); day.setDate(monday.getDate() + i);
      const isToday = day.toDateString() === todayKey;
      head += `<div class="${isToday ? 'today' : ''}">${DAY_NAMES[i]} ${day.getDate()}</div>`;
    }
    head += `</div>`;

    // cuerpo
    let body = '';
    for (let h = START_HOUR; h < END_HOUR; h++) {
      for (const [mm, min] of [[0, 0], [30, 1]]) {
        const dayMs = (h * 60 + min * 30) * 60000;
        body += `<div class="agenda-body-row">`;
        const label = `${String(h).padStart(2, '0')}:${min === 0 ? '00' : '30'}`;
        if (min === 0) body += `<div class="agenda-cell hour-label">${label}</div>`;
        else body += `<div class="agenda-cell hour-label"></div>`;

        for (let i = 0; i < 7; i++) {
          const day = new Date(monday); day.setDate(monday.getDate() + i);
          const cellDate = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, min * 30);
          const cellStart = cellDate.getTime();
          const isToday = day.toDateString() === todayKey;
          body += `<div class="agenda-cell${isToday ? ' today' : ''}" data-day="${i}" data-time="${cellStart}">`;

          const dayApps = state.appointments.filter((a) => {
            const st = Date.parse(a.start_at);
            return st >= cellStart && st < cellStart + 30 * 60000;
          });
          for (const a of dayApps) {
            const cust = custMap.get(a.customer_id);
            const staff = staffMap.get(a.staff_id);
            const start = Date.parse(a.start_at);
            const dur = Math.max(30, (Date.parse(a.end_at) - start) / 60000);
            const top = ((start - cellStart) / 60000) * (SLOT_H / 30);
            const height = Math.max(((dur) / 30) * SLOT_H - 4, 24);
            const color = staff?.color || '#6d28d9';
            body += `<div class="agenda-slot ${a.status}" data-appt="${a.id}" style="top:${top}px;height:${height}px;background:${color}cc">`;
            body += `<b>${esc(cust?.name || '?')}</b>`;
            body += `<span class="meta">${a.services?.map((s) => s.name).join(', ') || ''} ${staff ? '· ' + esc(staff.name) : ''}</span>`;
            body += `</div>`;
          }
          body += `</div>`;
        }
        body += `</div>`;
      }
    }

    const hoyCount = state.appointments.filter((a) => {
      const d = new Date(Date.parse(a.start_at));
      return d.toDateString() === todayKey && ['pending', 'confirmed'].includes(a.status);
    }).length;

    $('#agenda-grid').innerHTML =
      `<div class="agenda-row">${head}${body}<div class="agenda-caption">Citas de hoy: <b>${hoyCount}</b></div></div>`;

    $('#agenda-grid').querySelectorAll('.agenda-cell[data-time]').forEach((cell) => {
      cell.addEventListener('click', () => openNewAppointment(Number(cell.dataset.time)));
    });
    $$('.agenda-slot[data-appt]').forEach((slot) => {
      slot.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditAppointment(slot.dataset.appt);
      });
    });
  }

  $('#agenda-today').addEventListener('click', () => setWeekFromDate(new Date()));
  $('#agenda-prev').addEventListener('click', () => setWeekFromDate(new Date(state.monday).setDate(state.monday.getDate() - 7)));
  $('#agenda-next').addEventListener('click', () => setWeekFromDate(new Date(state.monday).setDate(state.monday.getDate() + 7)));
  $('#agenda-new').addEventListener('click', () => openNewAppointment(Date.now()));

  function pickHtml() {
    const cust = state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const staff = state.staff.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    const serv = state.services.filter((s) => s.active).map((s) =>
      `<option value="${s.id}" data-dur="${s.durationMin}">${esc(s.name)} · ${s.durationMin} min · ${money(s.price)}</option>`).join('');
    return { cust, staff, serv };
  }

  function appointmentFormHtml(a) {
    const { cust, staff, serv } = pickHtml();
    const sel = (list, id) => list.replace(`value="${id}"`, `value="${id}" selected`);
    const startLocal = a ? localInput(new Date(Date.parse(a.start_at))) : '';
    const services = a ? (a.services || []).map((s) => s.id).join(',') : '';

    const staffOpts = a && a.staff_id ? sel(staff, a.staff_id) : staff;
    const statusOpts = Object.entries(STATUS_LABEL)
      .map(([k, v]) => `<option value="${k}" ${a && a.status === k ? 'selected' : ''}>${v}</option>`).join('');

    return `
      <form class="modal-form">
        <div class="form-row">
          <label>Cliente <select name="customerId">${sel(cust + `<option value="">Selecciona…</option>`, a ? a.customer_id : '')}</select></label>
          <label>Empleado <select name="staffId">${`<option value="">Sin asignar</option>`}${staffOpts}</select></label>
        </div>
        <label>Servicios (Ctrl+clic para varios)
          <select name="serviceIds" multiple size="4">${services ? markMulti(serv, services) : serv}</select>
        </label>
        <div class="form-row">
          <label>Fecha y hora <input type="datetime-local" name="startAt" value="${startLocal}" required /></label>
          <label>Duración (min) <input type="number" name="durationMin" value="${a ? durMinutes(a) : 30}" min="5" max="600" required /></label>
        </div>
        <label>Notas <textarea name="notes" rows="2">${esc(a?.notes || '')}</textarea></label>
        <div class="form-row">
          <label>Estado <select name="status">${statusOpts}</select></label>
        </div>
        <div class="row-actions" style="justify-content:flex-end">
          ${a ? `<button type="button" class="btn danger" data-delete>Eliminar</button>` : ''}
          <button type="submit" class="btn primary">${a ? 'Guardar' : 'Agendar'}</button>
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
  function durMinutes(a) {
    return Math.round((Date.parse(a.end_at) - Date.parse(a.start_at)) / 60000);
  }
  function localInput(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function openNewAppointment(atMs) {
    if (!state.services.length) { toast('Crea primero un servicio', 'error'); return; }
    if (!state.customers.length) { toast('Crea primero un cliente', 'error'); return; }
    const dt = new Date(atMs);
    dt.setMinutes(Math.round(dt.getMinutes() / 30) * 30, 0, 0);
    openModal('Nueva cita', appointmentFormHtml(null)
      .replace('name="startAt"', `name="startAt" value="${localInput(dt)}"`));
    bindAppointmentForm(null, dt);
  }

  function openEditAppointment(id) {
    const a = state.appointments.find((x) => x.id === id);
    if (!a) return;
    openModal(`Cita ${STATUS_LABEL[a.status]?.toLowerCase()}`, appointmentFormHtml(a));
    bindAppointmentForm(a);
    $('#modal').querySelector('[data-delete]').addEventListener('click', async () => {
      if (!confirm('¿Eliminar esta cita?')) return;
      await api(`/api/appointments/${a.id}`, { method: 'DELETE' });
      closeModal(); toast('Cita eliminada', 'ok'); await renderAgenda();
    });
  }

  function bindAppointmentForm(existing, defaultDate) {
    const form = $('#modal').querySelector('.modal-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const input = {
        customerId: f.get('customerId'),
        staffId: f.get('staffId') || null,
        startAt: new Date(f.get('startAt')).toISOString(),
        durationMin: Number(f.get('durationMin')),
        serviceIds: f.getAll('serviceIds'),
        notes: f.get('notes') || '',
        status: f.get('status'),
      };
      if (!input.serviceIds.length) { toast('Selecciona al menos un servicio', 'error'); return; }
      try {
        if (existing) await api(`/api/appointments/${existing.id}`, { method: 'PUT', body: JSON.stringify(input) });
        else await api('/api/appointments', { method: 'POST', body: JSON.stringify(input) });
        closeModal(); toast(existing ? 'Cita actualizada' : 'Cita agendada', 'ok');
        await renderAgenda();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  /* ---------- CLIENTES ---------- */
  async function renderClientes() {
    try {
      const { customers } = await api('/api/customers');
      state.customers = customers;
    } catch (e) { toast(e.message, 'error'); return; }
    const rows = state.customers.map((c) => `<tr>
      <td><b>${esc(c.name)}</b></td>
      <td>${esc(c.phone)}</td>
      <td>${esc(c.email)}</td>
      <td class="muted">${esc(c.notes || '')}</td>
      <td><div class="row-actions">
        <button class="btn ghost small" data-edit="${c.id}">Editar</button>
        <button class="btn danger small" data-del="${c.id}">✕</button>
      </div></td>
    </tr>`).join('');
    $('#clientes-tbody').innerHTML = rows || `<tr><td colspan="5" class="empty">Sin clientes todavía</td></tr>`;
    $('#clientes-count').textContent = `${state.customers.length} clientes`;
    bindTable('#clientes-tbody', 'customers');
  }

  function customerFormHtml(c) {
    return `<form class="modal-form">
      <label>Nombre <input name="name" value="${esc(c?.name || '')}" required /></label>
      <div class="form-row">
        <label>Teléfono <input name="phone" value="${esc(c?.phone || '')}" /></label>
        <label>Correo <input name="email" value="${esc(c?.email || '')}" /></label>
      </div>
      <div class="form-row">
        <label>Cumpleaños <input name="birthdate" type="date" value="${esc(c?.birthdate || '')}" /></label>
        <label>Etiquetas <input name="tags" value="${esc(c?.tags || '')}" /></label>
      </div>
      <label>Notas <textarea name="notes" rows="3">${esc(c?.notes || '')}</textarea></label>
      <button type="submit" class="btn primary">${c ? 'Guardar' : 'Agregar'}</button>
    </form>`;
  }

  $('#clientes-new').addEventListener('click', () => {
    openModal('Nuevo cliente', customerFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/customers', null, renderClientes);
  });
  $('#clientes-search').addEventListener('input', debounce(async (e) => {
    const q = e.target.value.trim();
    const { customers } = await api(`/api/customers?q=${encodeURIComponent(q)}`);
    state.customers = customers;
    $('#clientes-tbody').innerHTML = customers.map(customerRow).join('') || `<tr><td colspan="5" class="empty">Sin resultados</td></tr>`;
    bindTable('#clientes-tbody', 'customers');
  }, 250));

  function customerRow(c) {
    return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.phone)}</td><td>${esc(c.email)}</td><td class="muted">${esc(c.notes || '')}</td>
      <td><div class="row-actions"><button class="btn ghost small" data-edit="${c.id}">Editar</button><button class="btn danger small" data-del="${c.id}">✕</button></div></td></tr>`;
  }

  /* ---------- SERVICIOS ---------- */
  async function renderServicios() {
    const { services } = await api('/api/services');
    state.services = services;
    $('#servicios-tbody').innerHTML = services.map((s) => `<tr>
      <td><b>${esc(s.name)}</b></td>
      <td>${s.durationMin} min</td>
      <td>${money(s.price)}</td>
      <td><span class="tag ${s.active ? 'confirmed' : 'cancelled'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="row-actions"><button class="btn ghost small" data-edit="${s.id}">Editar</button><button class="btn danger small" data-del="${s.id}">✕</button></div></td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">Sin servicios. ¡Agrega tu primer corte!</td></tr>`;
    bindTable('#servicios-tbody', 'services');
  }

  function serviceFormHtml(s) {
    return `<form class="modal-form">
      <label>Nombre <input name="name" value="${esc(s?.name || '')}" required /></label>
      <div class="form-row">
        <label>Duración (min) <input name="durationMin" type="number" value="${s?.durationMin ?? 30}" min="5" required /></label>
        <label>Precio <input name="price" type="number" step="0.01" value="${s?.price ?? 0}" min="0" required /></label>
      </div>
      <label>Descripción <input name="description" value="${esc(s?.description || '')}" /></label>
      <label>Estado <select name="active"><option value="true" ${s?.active === false ? '' : 'selected'}>Activo</option><option value="false" ${s?.active === false ? 'selected' : ''}>Inactivo</option></select></label>
      <button type="submit" class="btn primary">${s ? 'Guardar' : 'Agregar'}</button>
    </form>`;
  }

  $('#servicios-new').addEventListener('click', () => {
    openModal('Nuevo servicio', serviceFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/services', null, renderServicios, (f) => ({
      name: f.get('name'), durationMin: Number(f.get('durationMin')),
      price: Number(f.get('price')), description: f.get('description') || '',
      active: f.get('active') === 'true',
    }));
  });

  /* ---------- EMPLEADOS ---------- */
  async function renderEmpleados() {
    const { staff } = await api('/api/staff');
    state.staff = staff;
    const svcMap = new Map(state.services.map((s) => [s.id, s.name]));
    $('#empleados-tbody').innerHTML = staff.map((s) => `<tr>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color};margin-right:6px"></span><b>${esc(s.name)}</b></td>
      <td>${esc(s.phone)}</td>
      <td class="muted">${s.skillIds.map((id) => svcMap.get(id)).filter(Boolean).join(', ')}</td>
      <td><span class="tag ${s.active ? 'confirmed' : 'cancelled'}">${s.active ? 'Activo' : 'Inactivo'}</span></td>
      <td><div class="row-actions"><button class="btn ghost small" data-edit="${s.id}">Editar</button><button class="btn danger small" data-del="${s.id}">✕</button></div></td>
    </tr>`).join('') || `<tr><td colspan="5" class="empty">Sin empleados</td></tr>`;
    bindTable('#empleados-tbody', 'staff');
  }

  function staffFormHtml(s) {
    const skills = state.services.filter((x) => x.active).map((x) =>
      `<label class="check"><input type="checkbox" name="skillIds" value="${x.id}" ${s?.skillIds?.includes(x.id) ? 'checked' : ''}/> ${esc(x.name)}</label>`).join('');
    return `<form class="modal-form">
      <label>Nombre <input name="name" value="${esc(s?.name || '')}" required /></label>
      <div class="form-row">
        <label>Teléfono <input name="phone" value="${esc(s?.phone || '')}" /></label>
        <label>Color en agenda <input name="color" type="color" value="${s?.color || '#6d28d9'}" /></label>
      </div>
      <fieldset><legend>Servicios que realiza</legend>${skills || '<span class="muted">Crea servicios primero</span>'}</fieldset>
      <label>Estado <select name="active"><option value="true" ${s?.active === false ? '' : 'selected'}>Activo</option><option value="false" ${s?.active === false ? 'selected' : ''}>Inactivo</option></select></label>
      <button type="submit" class="btn primary">${s ? 'Guardar' : 'Agregar'}</button>
    </form>`;
  }

  $('#empleados-new').addEventListener('click', () => {
    openModal('Nuevo empleado', staffFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/staff', null, renderEmpleados);
  });

  /* ---------- INVENTARIO ---------- */
  async function renderInventario() {
    const { items } = await api('/api/inventory');
    state.items = items;
    const low = items.filter((i) => i.quantity <= i.minQty).length;
    $('#inventario-low').textContent = low;
    $('#inventario-tbody').innerHTML = items.map((i) => `<tr class="${i.quantity <= i.minQty ? 'row-low' : ''}">
      <td><b>${esc(i.name)}</b></td>
      <td class="muted">${esc(i.sku || '')}</td>
      <td><b>${i.quantity}</b> ${i.quantity <= i.minQty ? '⚠️' : ''}</td>
      <td>${i.minQty}</td>
      <td>${esc(i.unit)}</td>
      <td>${moneyCents(i.price * 100)}</td>
      <td><div class="row-actions">
        <button class="btn ghost small" data-move="${i.id}">+/-</button>
        <button class="btn ghost small" data-edit="${i.id}">Editar</button>
        <button class="btn danger small" data-del="${i.id}">✕</button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="7" class="empty">Sin artículos</td></tr>`;
    document.querySelectorAll('#inventario-tbody [data-move]').forEach((b) =>
      b.addEventListener('click', () => openMovement(b.dataset.move)));
    bindTable('#inventario-tbody', 'inventory', (btn) => btn.dataset.move);
  }

  function itemFormHtml(i) {
    return `<form class="modal-form">
      <label>Nombre <input name="name" value="${esc(i?.name || '')}" required /></label>
      <div class="form-row">
        <label>SKU <input name="sku" value="${esc(i?.sku || '')}" /></label>
        <label>Unidad <input name="unit" value="${esc(i?.unit || 'unidad')}" /></label>
      </div>
      <div class="form-row">
        <label>Cantidad <input name="quantity" type="number" value="${i?.quantity ?? 0}" min="0" /></label>
        <label>Mínimo <input name="minQty" type="number" value="${i?.minQty ?? 0}" min="0" /></label>
      </div>
      <label>Precio unitario <input name="price" type="number" step="0.01" value="${i ? (i.price).toFixed(2) : '0.00'}" min="0" /></label>
      <button type="submit" class="btn primary">${i ? 'Guardar' : 'Agregar'}</button>
    </form>`;
  }

  function openMovement(id) {
    const item = state.items.find((x) => x.id === id);
    openModal(`Ajustar stock · ${item.name}`, `<form class="modal-form">
      <div class="form-row">
        <label>Entrada (+)<button type="button" class="btn ghost" data-sign="1">+ Agregar</button></label>
        <label>Salida (−)<button type="button" class="btn ghost" data-sign="-1">− Retirar</button></label>
      </div>
      <input type="text" readonly value="Cantidad actual: ${item.quantity}" />
      <label>Cantidad <input name="delta" type="number" min="1" required /></label>
      <label>Motivo <input name="reason" placeholder="reposición, venta, merma…" required /></label>
      <button type="submit" class="btn primary">Registrar</button>
    </form>`);
    bindMovementForm(id);
  }

  function bindMovementForm(id) {
    const form = $('#modal').querySelector('.modal-form');
    let sign = 1;
    form.querySelectorAll('[data-sign]').forEach((b) => b.addEventListener('click', () => {
      sign = Number(b.dataset.sign);
      form.querySelectorAll('[data-sign]').forEach((x) => x.classList.toggle('primary', x === b));
    }));
    form.querySelectorAll('[data-sign]').forEach((x) => x.classList.remove('primary'));
    form.querySelector('[data-sign="1"]').classList.add('primary');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      await api(`/api/inventory/${id}/movements`, {
        method: 'POST',
        body: JSON.stringify({ delta: sign * Number(f.get('delta')), reason: f.get('reason') }),
      });
      closeModal(); toast('Stock actualizado', 'ok'); await renderInventario();
    });
  }

  $('#inventario-new').addEventListener('click', () => {
    openModal('Nuevo artículo', itemFormHtml(null));
    bindSimpleForm('#modal .modal-form', '/api/inventory', null, renderInventario, (f) => ({
      name: f.get('name'), sku: f.get('sku') || '', unit: f.get('unit'),
      quantity: Number(f.get('quantity')), minQty: Number(f.get('minQty')), price: Number(f.get('price')),
    }));
  });

  /* ---------- DOCUMENTOS ---------- */
  async function renderDocumentos() {
    const { documents } = await api('/api/documents');
    state.documents = documents;
    $('#documentos-tbody').innerHTML = documents.map((d) => `<tr>
      <td><b>${esc(d.number)}</b></td>
      <td>${d.type === 'recibo' ? 'Recibo' : 'Cotización'}</td>
      <td>${esc(d.customer?.name || '')}</td>
      <td>${moneyCents(d.total * 100)}</td>
      <td><span class="tag ${d.status}">${d.status}</span></td>
      <td><div class="row-actions">
        <button class="btn ghost small" data-pdf="${d.id}">PDF</button>
        <button class="btn ghost small" data-status="${d.id}" data-to="accepted">Aceptar</button>
        <button class="btn ghost small" data-status="${d.id}" data-to="sent">Enviar</button>
        <button class="btn danger small" data-del="${d.id}">✕</button>
      </div></td>
    </tr>`).join('') || `<tr><td colspan="6" class="empty">Sin documentos</td></tr>`;
    document.querySelectorAll('#documentos-tbody [data-pdf]').forEach((b) =>
      b.addEventListener('click', () => window.open(`/api/documents/${b.dataset.pdf}/pdf`, '_blank')));
    document.querySelectorAll('#documentos-tbody [data-status]').forEach((b) =>
      b.addEventListener('click', async () => {
        try {
          await api(`/api/documents/${b.dataset.status}/status`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.to }) });
          toast('Estado actualizado', 'ok'); await renderDocumentos();
        } catch (e) { toast(e.message, 'error'); }
      }));
    bindTable('#documentos-tbody', 'documents');
  }

  $('#documentos-new').addEventListener('click', () => {
    const cust = state.customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('') || '<option value="">Crea clientes primero</option>';
    openModal('Nueva cotización', `<form class="modal-form" id="doc-form">
      <div class="form-row">
        <label>Tipo <select name="type"><option value="cotizacion">Cotización</option><option value="recibo">Recibo</option></select></label>
        <label>Cliente <select name="customerId">${cust}</select></label>
      </div>
      <label>Título <input name="title" placeholder="Corte + tratamiento" /></label>
      <div id="doc-lines">
        <div class="form-row" data-line>
          <label>Descripción<input name="desc" /></label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label>Cant.<input name="qty" type="number" min="1" value="1" /></label>
            <label>Precio<input name="price" type="number" step="0.01" value="0" /></label>
          </div>
        </div>
      </div>
      <button type="button" class="btn ghost" id="add-line">+ Línea</button>
      <div class="form-row">
        <label>Impuesto % <input name="taxPercent" type="number" value="0" min="0" max="100" /></label>
      </div>
      <button type="submit" class="btn primary">Generar documento</button>
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
      try {
        const { document: doc } = await api('/api/documents', {
          method: 'POST',
          body: JSON.stringify({ type: f.get('type'), customerId: f.get('customerId'), title: f.get('title') || undefined, lines, taxPercent: Number(f.get('taxPercent')) }),
        });
        closeModal();
        window.open(`/api/documents/${doc.id}/pdf`, '_blank');
        toast('Documento generado', 'ok');
        await renderDocumentos();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  /* ---------- CONFIG ---------- */
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
      toast('Configuración guardada', 'ok');
    } catch (err) { $('[data-err]', e.target).textContent = err.message; }
  });

  /* ---------- BINDINGS REUSABLES ---------- */
  function bindTable(tbodySel, resource) {
    const tbody = $(tbodySel);
    tbody.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.edit;
      const formMap = {
        customers: () => openModal('Editar cliente', customerFormHtml(state.customers.find((x) => x.id === id))),
        services: () => openModal('Editar servicio', serviceFormHtml(state.services.find((x) => x.id === id))),
        staff: () => openModal('Editar empleado', staffFormHtml(state.staff.find((x) => x.id === id))),
        inventory: () => openModal('Editar artículo', itemFormHtml(state.items.find((x) => x.id === id))),
      };
      formMap[resource]();
      const editMap = {
        customers: () => bindSimpleForm('#modal .modal-form', `/api/customers/${id}`, 'PUT', renderClientes),
        services: () => bindSimpleForm('#modal .modal-form', `/api/services/${id}`, 'PUT', renderServicios, (f) => ({
          name: f.get('name'), durationMin: Number(f.get('durationMin')), price: Number(f.get('price')),
          description: f.get('description') || '', active: f.get('active') === 'true',
        })),
        staff: () => bindSimpleForm('#modal .modal-form', `/api/staff/${id}`, 'PUT', renderEmpleados),
        inventory: () => bindSimpleForm('#modal .modal-form', `/api/inventory/${id}`, 'PUT', renderInventario, (f) => ({
          name: f.get('name'), sku: f.get('sku') || '', unit: f.get('unit'),
          quantity: Number(f.get('quantity')), minQty: Number(f.get('minQty')), price: Number(f.get('price')),
        })),
      };
      editMap[resource]();
    }));

    tbody.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('¿Eliminar? Esta acción no se puede deshacer.')) return;
      const id = b.dataset.del;
      const path = { customers: '/api/customers', services: '/api/services', staff: '/api/staff', inventory: '/api/inventory', documents: '/api/documents' }[resource];
      await api(`${path}/${id}`, { method: 'DELETE' });
      toast('Eliminado', 'ok');
      if (resource === 'services') await renderServicios(), await renderEmpleados();
      else if (resource === 'staff') await renderEmpleados();
      else await renderPanel(resource);
    }));
  }

  async function renderPanel(resource) {
    if (resource === 'customers') await renderClientes();
    if (resource === 'services') await renderServicios();
    if (resource === 'staff') await renderEmpleados();
    if (resource === 'inventory') await renderInventario();
    if (resource === 'documents') await renderDocumentos();
  }

  function bindSimpleForm(formSel, path, method, after, mapFn) {
    const form = $(formSel);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      let payload = Object.fromEntries(f);
      if (mapFn) payload = mapFn(f);
      try {
        await api(path, { method: method || (formSel.includes(':id') ? 'PUT' : 'POST'), body: JSON.stringify(payload) });
        closeModal(); toast('Guardado', 'ok'); await after();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  function debounce(fn, ms) {
    let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  /* ---------- REFRESH TODO + START ---------- */
  async function refreshAll() {
    await renderConfig();
    await Promise.all([renderClientes(), renderServicios(), renderEmpleados(), renderInventario(), renderDocumentos()]);
    setWeekFromDate(new Date());
  }

  (async () => {
    try {
      const { session, tenant } = await api('/api/auth/me');
      state.session = session;
      state.tenant = tenant;
      $('#auth-view').classList.add('hidden');
      $('#app').classList.remove('hidden');
      $('#user-chip').textContent = session.email;
      document.title = `${tenant.name} · Peluquería`;
      await refreshAll();
    } catch {
      $('#auth-view').classList.remove('hidden');
    }
  })();
})();