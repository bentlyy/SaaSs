import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  ApiError,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Campo,
  EsqueletoKpis,
  EsqueletoTabla,
  Etiqueta,
  FilaVacia,
  Kpis,
  Modal,
  NotaError,
  PageHeader,
  Select,
  Tabla,
  Tarjeta,
  api,
  dinero,
  estadoDe,
  useApp,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import { aDatetimeLocal } from '../horas';
import type { Cliente, Espacio, EstadoReserva, Extra, Franja, Reserva, Resumen } from '../tipos';

/**
 * La agenda del día: tarjetas, reservas y las franjas libres del espacio.
 *
 * Dos reglas que no son de estilo sino de arquitectura:
 *
 *   1. No hay datos escritos en el navegador. La página se sirve vacía y todo
 *      entra por la API, que es la que filtra por organización.
 *
 *   2. La pantalla NO decide si dos reservas se pisan. No sabe ni puede
 *      saberlo: entre que se ve el horario libre y se presiona "Reservar" puede
 *      entrar otra reserva. La decisión es del servidor, y esta UI solo muestra
 *      el 409.
 */
const ESTADOS: MapaEstados = {
  pending: { texto: 'Por confirmar', tono: 'aviso' },
  confirmed: { texto: 'Confirmada', tono: 'ok' },
  done: { texto: 'Completada', tono: 'neutro' },
  cancelled: { texto: 'Cancelada', tono: 'malo' },
  no_show: { texto: 'No presentado', tono: 'malo' },
};

/**
 * El siguiente paso de una reserva, para no llenar la fila de botones.
 *
 * Tres botones por renglón esconde la información: el que sirve casi siempre es
 * uno, el de avanzar. Cancelar queda siempre, porque es la única acción
 * destructiva y tiene que estar a la mano. Los estados de la API no se tocan;
 * esto solo decide cuál se ofrece.
 */
const SIGUIENTE: Record<string, { estado: EstadoReserva; accion: string }> = {
  pending: { estado: 'confirmed', accion: 'Confirmar' },
  confirmed: { estado: 'done', accion: 'Marcar hecha' },
};

/** `AAAA-MM-DD` de hoy en esta máquina, para saber si la agenda mira hoy. */
function claveDeHoy(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}

interface FormReserva {
  spaceId: string;
  customerId: string;
  inicio: string;
  fin: string;
  extraId: string;
  notas: string;
}

/** El total se estima en pantalla para dar una idea; el que vale es el del servidor. */
function estimarTotal(form: FormReserva, espacios: Espacio[], extras: Extra[]): number {
  const espacio = espacios.find((e) => e.id === form.spaceId);
  const extra = extras.find((x) => x.id === form.extraId);
  if (!espacio) return 0;
  const ini = new Date(form.inicio).getTime();
  const fin = new Date(form.fin).getTime();
  const horas = Number.isNaN(ini) || Number.isNaN(fin) ? 0 : (fin - ini) / 3_600_000;
  return Math.round(horas * espacio.pricePerHourCents) + (extra?.priceCents ?? 0);
}

export function AgendaPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const moneda = typeof settings?.currency === 'string' ? settings.currency : '$';

  const [espacios, setEspacios] = useState<Espacio[] | null>(null);
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [extras, setExtras] = useState<Extra[] | null>(null);

  const [dia, setDia] = useState(() => new Date().toISOString().slice(0, 10));
  const [espacioSel, setEspacioSel] = useState('');
  const [estadoSel, setEstadoSel] = useState('');

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [reservas, setReservas] = useState<Reserva[] | null>(null);
  /** `null` = todavía no se pidió o no hay espacio elegido; `[]` = sin franjas. */
  const [franjas, setFranjas] = useState<Franja[] | null>(null);

  const [form, setForm] = useState<FormReserva | null>(null);
  const [errorForm, setErrorForm] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargarCatalogo() {
    const [e, c, x] = await Promise.all([
      api.get<{ items: Espacio[] }>('/spaces?limit=500'),
      api.get<{ items: Cliente[] }>('/customers?limit=500'),
      api.get<{ items: Extra[] }>('/addons?limit=500'),
    ]);
    setEspacios(e.items);
    setClientes(c.items);
    setExtras(x.items);
  }

  async function cargarAgenda() {
    const base = new Date(`${dia}T00:00:00.000Z`);
    const desde = base.toISOString();
    const hasta = new Date(base.getTime() + 86_400_000).toISOString();
    const espacio = espacioSel ? `&spaceId=${espacioSel}` : '';
    const [a, r, d] = await Promise.all([
      api.get<{ bookings: Reserva[] }>(`/agenda?from=${desde}&to=${hasta}${espacio}`),
      api.get<Resumen>(`/resumen?date=${dia}`),
      espacioSel
        ? api.get<{ slots: Franja[] }>(`/availability?spaceId=${espacioSel}&date=${dia}`)
        : Promise.resolve(null),
    ]);
    setReservas(a.bookings);
    setResumen(r);
    setFranjas(d ? d.slots : null);
  }

  useEffect(() => {
    cargarCatalogo().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cargarAgenda().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dia, espacioSel]);

  async function cambiarEstado(r: Reserva, estado: EstadoReserva) {
    try {
      await api.patch(`/bookings/${r.id}`, { status: estado });
      await cargarAgenda();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  function abrirNueva() {
    setErrorForm(null);
    setForm({ spaceId: espacioSel, customerId: '', inicio: '', fin: '', extraId: '', notas: '' });
  }

  function abrirFranja(s: Franja) {
    setErrorForm(null);
    setForm({
      spaceId: espacioSel,
      customerId: '',
      inicio: aDatetimeLocal(s.startAt),
      fin: aDatetimeLocal(s.endAt),
      extraId: '',
      notas: '',
    });
  }

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => (f ? { ...f, [ev.target.name]: ev.target.value } : f));

  async function guardarReserva(ev: FormEvent) {
    ev.preventDefault();
    if (!form) return;
    setGuardando(true);
    setErrorForm(null);
    try {
      await api.post('/bookings', {
        spaceId: form.spaceId,
        customerId: form.customerId || null,
        startAt: new Date(form.inicio).toISOString(),
        endAt: new Date(form.fin).toISOString(),
        notes: form.notas || null,
        addons: form.extraId
          ? [
              {
                addonId: form.extraId,
                priceCents: extras?.find((x) => x.id === form.extraId)?.priceCents ?? 0,
              },
            ]
          : [],
      });
      setForm(null);
      avisar('Reserva creada');
      await cargarAgenda();
    } catch (e) {
      // El 409 es el del servidor: dos personas presionaron "Reservar" a la vez,
      // o el horario se ocupó mientras la pantalla estaba abierta. La UI no lo
      // adivina, lo muestra.
      const mensaje =
        e instanceof ApiError && e.status === 409 ? `Ese horario ya no está libre: ${e.message}` : (e as Error).message;
      setErrorForm(mensaje);
      avisar(mensaje, true);
    } finally {
      setGuardando(false);
    }
  }

  const esHoy = dia === claveDeHoy();
  const cuando = esHoy
    ? 'Ingresos de hoy'
    : `Ingresos del ${new Date(`${dia}T00:00:00.000Z`).toLocaleDateString('es', { day: 'numeric', month: 'short' })}`;

  const visibles = (reservas ?? []).filter((r) => !estadoSel || r.status === estadoSel);

  return (
    <>
      <PageHeader
        titulo="Agenda"
        subtitulo="Las reservas del día y las franjas libres para cerrar una nueva."
        acciones={<BotonPrimario onClick={abrirNueva}>Nueva reserva</BotonPrimario>}
      />

      {resumen === null ? (
        <EsqueletoKpis />
      ) : (
        <Kpis
          items={[
            { etiqueta: esHoy ? 'Hoy' : 'Ese día', valor: resumen.hoy },
            { etiqueta: 'Confirmadas', valor: resumen.confirmadas, acento: true },
            { etiqueta: 'Por confirmar', valor: resumen.porConfirmar },
            { etiqueta: cuando, valor: dinero(resumen.ingresos, moneda) },
          ]}
        />
      )}

      <Tarjeta titulo="Filtros" className="mt-6">
        <div className="grid gap-3 p-4 sm:grid-cols-3">
          <Campo etiqueta="Fecha" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          <Select etiqueta="Espacio" value={espacioSel} onChange={(e) => setEspacioSel(e.target.value)}>
            <option value="">Todos los espacios</option>
            {(espacios ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
          <Select etiqueta="Estado" value={estadoSel} onChange={(e) => setEstadoSel(e.target.value)}>
            <option value="">Todos los estados</option>
            {Object.keys(ESTADOS).map((clave) => (
              <option key={clave} value={clave}>
                {estadoDe(clave, ESTADOS).texto}
              </option>
            ))}
          </Select>
        </div>
      </Tarjeta>

      <Tarjeta titulo="Reservas del día" className="mt-6">
        {reservas === null ? (
          <EsqueletoTabla columnas={['Hora', 'Espacio', 'Cliente', 'Estado', 'Total', 'Acciones']} />
        ) : (
          <Tabla columnas={['Hora', 'Espacio', 'Cliente', 'Estado', { titulo: 'Total', num: true }, 'Acciones']}>
            {visibles.length === 0 ? (
              <FilaVacia
                columnas={6}
                texto={
                  reservas.length === 0
                    ? 'Nada reservado para este día. Toca una franja libre de abajo para abrir la primera reserva.'
                    : 'No hay reservas con ese estado'
                }
              />
            ) : (
              visibles.map((b) => {
                const e = estadoDe(b.status, ESTADOS);
                const avanza = SIGUIENTE[b.status];
                return (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {b.startAt.slice(11, 16)} - {b.endAt.slice(11, 16)}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{b.spaceName ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{b.customerName ?? 'Sin cliente'}</td>
                    <td className="px-4 py-3">
                      <Etiqueta texto={e.texto} tono={e.tono} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-800">{dinero(b.totalCents, moneda)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {avanza ? (
                          <BotonChico onClick={() => cambiarEstado(b, avanza.estado)}>{avanza.accion}</BotonChico>
                        ) : null}
                        {b.status !== 'cancelled' && b.status !== 'done' ? (
                          <BotonChico peligro onClick={() => cambiarEstado(b, 'cancelled')}>
                            Cancelar
                          </BotonChico>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </Tabla>
        )}
      </Tarjeta>

      <Tarjeta titulo="Franjas libres" nota="Toca una hora para abrir la reserva" className="mt-6">
        {!espacioSel ? (
          <p className="p-4 text-sm text-slate-400">Elige un espacio para ver sus franjas libres.</p>
        ) : franjas === null ? (
          <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
            Cargando franjas…
          </div>
        ) : franjas.length === 0 ? (
          <p className="p-4 text-sm text-slate-400">No quedan franjas libres ese día.</p>
        ) : (
          <div className="flex flex-wrap gap-2 p-4">
            {franjas.map((s) => (
              <BotonSecundario key={s.startAt} type="button" onClick={() => abrirFranja(s)}>
                {s.startAt.slice(11, 16)} · {dinero(s.totalCents, moneda)}
              </BotonSecundario>
            ))}
          </div>
        )}
      </Tarjeta>

      {form ? (
        <Modal titulo="Nueva reserva" onCerrar={() => setForm(null)}>
          <form onSubmit={guardarReserva} className="space-y-3">
            <Select etiqueta="Espacio" name="spaceId" required value={form.spaceId} onChange={alCambiar} autoFocus>
              <option value="">Elige un espacio</option>
              {(espacios ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </Select>
            <Select etiqueta="Cliente" name="customerId" value={form.customerId} onChange={alCambiar}>
              <option value="">Sin cliente</option>
              {(clientes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <div className="grid gap-3 md:grid-cols-2">
              <Campo
                etiqueta="Empieza"
                name="inicio"
                type="datetime-local"
                required
                value={form.inicio}
                onChange={alCambiar}
              />
              <Campo etiqueta="Termina" name="fin" type="datetime-local" required value={form.fin} onChange={alCambiar} />
            </div>
            <Select etiqueta="Extra" name="extraId" value={form.extraId} onChange={alCambiar}>
              <option value="">Sin extra</option>
              {(extras ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
            <Campo etiqueta="Notas" name="notas" maxLength={2000} value={form.notas} onChange={alCambiar} />
            <p className="text-sm text-slate-500">
              Total estimado:{' '}
              <span className="font-semibold text-slate-800">
                {dinero(estimarTotal(form, espacios ?? [], extras ?? []), moneda)}
              </span>
            </p>
            <NotaError mensaje={errorForm} />
            <div className="flex justify-end gap-2 pt-2">
              <BotonSecundario type="button" onClick={() => setForm(null)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando ? 'Reservando…' : 'Reservar'}
              </BotonPrimario>
            </div>
          </form>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
