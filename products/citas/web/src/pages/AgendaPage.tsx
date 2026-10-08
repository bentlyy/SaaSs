import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
  EsqueletoKpis,
  Etiqueta,
  FilaVacia,
  Kpis,
  Modal,
  NotaError,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  dinero,
  estadoDe,
  fecha,
  useAviso,
  useApp,
  type MapaEstados,
} from '@amg/ui';
import { finDelDia, fechaEnZona, hoyEnZona, horaEnZona, inicioDelDia, instanteEnZona, zonaSegura } from '../horas';
import type { Cita, Cliente, DetalleCita, EstadoCita, Profesional, Resumen, Servicio } from '../tipos';

/** Los estados de una cita y su tono: la forma la pone el módulo compartido. */
const ESTADOS: MapaEstados = {
  confirmed: { texto: 'Confirmada', tono: 'ok' },
  pending: { texto: 'Por confirmar', tono: 'aviso' },
  done: { texto: 'Realizada', tono: 'acento' },
  cancelled: { texto: 'Cancelada', tono: 'neutro' },
  no_show: { texto: 'No asistió', tono: 'malo' },
};

type ModalCita = { modo: 'nueva' } | { modo: 'reprogramar'; cita: Cita } | null;

/**
 * La agenda del día.
 *
 * El rango se manda en UTC armado desde la zona del taller, no desde la del
 * navegador: un taller en Mexico City abierto desde Santiago no puede ver las
 * citas corridas tres horas. Y el chequeo de si dos citas se pisan es del
 * servidor: acá a lo sumo se muestra el error que devuelve.
 */
export function AgendaPage() {
  const { zona, settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const z = zonaSegura(zona);
  const moneda = String(settings?.currency ?? '$');
  const hoy = hoyEnZona(z);

  const [fechaDia, setFechaDia] = useState(hoy);
  const [buscar, setBuscar] = useState('');
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [citas, setCitas] = useState<Cita[] | null>(null);

  // Los catálogos llenan el formulario de cita; se piden con la pantalla para
  // que el botón "Nueva cita" nunca abra con los selectores vacíos.
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [profesionales, setProfesionales] = useState<Profesional[]>([]);

  const [modal, setModal] = useState<ModalCita>(null);
  const [detalle, setDetalle] = useState<DetalleCita | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const poner = useCallback((clave: string, valor: string) => {
    setCampos((c) => ({ ...c, [clave]: valor }));
  }, []);
  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) => poner(ev.target.name, ev.target.value);

  const atajar = useCallback(
    (e: unknown) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    },
    [avisar],
  );

  const cargarResumenAgenda = useCallback(async () => {
    const desde = inicioDelDia(fechaDia, z).toISOString();
    const hasta = finDelDia(fechaDia, z).toISOString();
    const [r, a] = await Promise.all([
      api.get<Resumen>('/resumen'),
      api.get<{ appointments: Cita[] }>(`/agenda?from=${desde}&to=${hasta}`),
    ]);
    setResumen(r);
    setCitas(a.appointments ?? []);
  }, [fechaDia, z]);

  const cargarCatalogos = useCallback(async () => {
    const [c, s, p] = await Promise.all([
      api.get<{ items: Cliente[] }>('/customers?limit=200'),
      api.get<{ items: Servicio[] }>('/services?limit=200'),
      api.get<{ items: Profesional[] }>('/staff?limit=200'),
    ]);
    setClientes(c.items ?? []);
    setServicios(s.items ?? []);
    setProfesionales(p.items ?? []);
  }, []);

  useEffect(() => {
    const cargar = async () => {
      try {
        await Promise.all([cargarResumenAgenda(), cargarCatalogos()]);
      } catch (e) {
        atajar(e);
      }
    };
    void cargar();
  }, [cargarResumenAgenda, cargarCatalogos, atajar]);

  function abrirNueva() {
    setErrorModal(null);
    setCampos({
      customerId: '',
      staffId: '',
      serviceId: '',
      fecha: hoy,
      hora: '10:00',
      horaFin: '10:30',
      priceCents: '0',
      status: 'confirmed',
      notes: '',
    });
    setModal({ modo: 'nueva' });
  }

  function abrirReprogramar(cita: Cita) {
    setErrorModal(null);
    setCampos({
      fecha: fechaEnZona(cita.startAt, z),
      hora: horaEnZona(cita.startAt, z),
      horaFin: horaEnZona(cita.endAt, z),
    });
    setModal({ modo: 'reprogramar', cita });
  }

  async function verDetalle(citaId: string) {
    try {
      setDetalle(await api.get<DetalleCita>(`/appointments/${citaId}`));
    } catch (e) {
      atajar(e);
    }
  }

  async function cambiarEstado(cita: Cita, estadoNuevo: EstadoCita, mensaje: string) {
    try {
      await api.patch(`/appointments/${cita.id}`, { status: estadoNuevo });
      await cargarResumenAgenda();
      avisar(mensaje);
    } catch (e) {
      atajar(e);
    }
  }

  async function guardarCita(ev: FormEvent) {
    ev.preventDefault();
    if (!modal) return;
    setGuardando(true);
    setErrorModal(null);
    try {
      const cuerpo = {
        startAt: instanteEnZona(campos.fecha, campos.hora, z).toISOString(),
        endAt: instanteEnZona(campos.fecha, campos.horaFin, z).toISOString(),
      };
      if (modal.modo === 'nueva') {
        const servicio = campos.serviceId;
        await api.post('/appointments', {
          ...cuerpo,
          customerId: campos.customerId || null,
          staffId: campos.staffId,
          status: campos.status,
          notes: campos.notes || null,
          services: servicio
            ? [{ serviceId: servicio, priceCents: Number(campos.priceCents || 0) }]
            : [],
        });
        setFechaDia(campos.fecha);
        avisar('Cita agendada');
      } else {
        await api.patch(`/appointments/${modal.cita.id}`, cuerpo);
        avisar('Cita reprogramada');
      }
      setModal(null);
      await cargarResumenAgenda();
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  const q = buscar.trim().toLowerCase();
  const filtradas = !citas
    ? null
    : q
      ? citas.filter(
          (c) =>
            (c.customerName ?? '').toLowerCase().includes(q) ||
            (c.staffName ?? '').toLowerCase().includes(q),
        )
      : citas;

  const detalleEst = detalle ? estadoDe(detalle.appointment.status, ESTADOS) : null;
  const nombreServicios = detalle
    ? detalle.services
        .map((l) => {
          const s = servicios.find((x) => x.id === l.serviceId);
          return s ? `${s.name} · ${dinero(l.priceCents, moneda)}` : dinero(l.priceCents, moneda);
        })
        .join(', ')
    : '';

  return (
    <>
      <PageHeader
        titulo="Agenda"
        subtitulo="Las citas del día en la zona del taller."
        acciones={
          <>
            <input
              type="date"
              value={fechaDia}
              onChange={(e) => setFechaDia(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-44"
            />
            <Buscador valor={buscar} onChange={setBuscar} placeholder="Cliente o profesional" />
            <BotonPrimario onClick={abrirNueva}>Nueva cita</BotonPrimario>
          </>
        }
      />

      {resumen === null ? (
        <EsqueletoKpis cuantos={3} />
      ) : (
        <Kpis
          items={[
            { etiqueta: 'Hoy', valor: resumen.hoy ?? 0, acento: true },
            { etiqueta: 'Futuras', valor: resumen.futuras ?? 0 },
            { etiqueta: 'Por confirmar', valor: resumen.porConfirmar ?? 0 },
          ]}
        />
      )}

      <Tarjeta titulo="Citas del día" className="mt-6">
        {!filtradas ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Hora', 'Cliente', 'Profesional', 'Estado', { titulo: 'Total', num: true }, '']}>
            {filtradas.length === 0 ? (
              <FilaVacia
                columnas={6}
                texto={q ? 'Nadie coincide con la búsqueda' : 'No hay citas para este día.'}
              />
            ) : (
              filtradas.map((c) => {
                const e = estadoDe(c.status, ESTADOS);
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{horaEnZona(c.startAt, z)}</td>
                    <td className="px-4 py-3 text-slate-600">{c.customerName ?? 'Sin cliente'}</td>
                    <td className="px-4 py-3 text-slate-600">{c.staffName ?? 'Sin profesional'}</td>
                    <td className="px-4 py-3">
                      <Etiqueta texto={e.texto} tono={e.tono} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{dinero(c.totalCents, moneda)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <BotonChico onClick={() => verDetalle(c.id)}>Ver</BotonChico>
                        <BotonChico onClick={() => abrirReprogramar(c)}>Reprogramar</BotonChico>
                        {c.status !== 'done' ? (
                          <BotonChico onClick={() => cambiarEstado(c, 'done', 'Cita realizada')}>
                            Completar
                          </BotonChico>
                        ) : null}
                        {c.status !== 'cancelled' && c.status !== 'no_show' ? (
                          <BotonChico peligro onClick={() => cambiarEstado(c, 'cancelled', 'Cita cancelada')}>
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

      {modal ? (
        <Modal
          titulo={modal.modo === 'nueva' ? 'Nueva cita' : 'Reprogramar cita'}
          onCerrar={() => setModal(null)}
          ancho="max-w-xl"
        >
          <form onSubmit={guardarCita} className="space-y-3">
            {modal.modo === 'nueva' ? (
              <>
                <Select etiqueta="Cliente" value={campos.customerId ?? ''} onChange={(e) => poner('customerId', e.target.value)}>
                  <option value="">— sin cliente —</option>
                  {clientes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select etiqueta="Profesional" required value={campos.staffId ?? ''} onChange={(e) => poner('staffId', e.target.value)}>
                  {profesionales.length === 0 ? (
                    <option value="">— sin profesionales cargados —</option>
                  ) : null}
                  {profesionales.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
              </>
            ) : null}

            <div className="grid gap-3 md:grid-cols-3">
              <Campo etiqueta="Fecha" name="fecha" type="date" required value={campos.fecha ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Desde" name="hora" type="time" required value={campos.hora ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Hasta" name="horaFin" type="time" required value={campos.horaFin ?? ''} onChange={alCambiar} />
            </div>

            {modal.modo === 'nueva' ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Select
                    etiqueta="Servicio"
                    value={campos.serviceId ?? ''}
                    onChange={(e) => {
                      poner('serviceId', e.target.value);
                      const s = servicios.find((x) => x.id === e.target.value);
                      poner('priceCents', s ? String(s.priceCents) : '0');
                    }}
                  >
                    <option value="">— sin servicio —</option>
                    {servicios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} · {dinero(s.priceCents, moneda)}
                      </option>
                    ))}
                  </Select>
                  <Campo etiqueta="Precio en centavos" name="priceCents" type="number" min={0} step={1} value={campos.priceCents ?? ''} onChange={alCambiar} />
                </div>
                <Select etiqueta="Estado" value={campos.status ?? 'confirmed'} onChange={(e) => poner('status', e.target.value)}>
                  <option value="confirmed">Confirmada</option>
                  <option value="pending">Por confirmar</option>
                  <option value="done">Realizada</option>
                  <option value="cancelled">Cancelada</option>
                  <option value="no_show">No asistió</option>
                </Select>
                <Campo etiqueta="Notas" name="notes" maxLength={2000} value={campos.notes ?? ''} onChange={alCambiar} />
              </>
            ) : null}

            <NotaError mensaje={errorModal} />
            <div className="flex justify-end gap-2 pt-2">
              <BotonSecundario type="button" onClick={() => setModal(null)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : modal.modo === 'nueva' ? 'Agendar' : 'Guardar'}
              </BotonPrimario>
            </div>
          </form>
        </Modal>
      ) : null}

      {detalle ? (
        <Modal titulo="Detalle de la cita" onCerrar={() => setDetalle(null)}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Cliente</dt>
              <dd className="text-right text-slate-800">
                {detalle.customer?.name ?? detalle.appointment.customerName ?? 'Sin cliente'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Profesional</dt>
              <dd className="text-right text-slate-800">
                {detalle.staff?.name ?? detalle.appointment.staffName ?? 'Sin profesional'}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Estado</dt>
              <dd>
                {detalleEst ? <Etiqueta texto={detalleEst.texto} tono={detalleEst.tono} /> : null}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Horario</dt>
              <dd className="text-right text-slate-800">
                {fecha(detalle.appointment.startAt, true, z)} · {horaEnZona(detalle.appointment.startAt, z)}–
                {horaEnZona(detalle.appointment.endAt, z)}
              </dd>
            </div>
            {detalle.services.length > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-slate-500">Servicios</dt>
                <dd className="text-right text-slate-800">{nombreServicios}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Total</dt>
              <dd className="text-right text-slate-800">{dinero(detalle.appointment.totalCents, moneda)}</dd>
            </div>
            {detalle.appointment.notes ? (
              <div className="flex gap-4">
                <dt className="shrink-0 text-slate-500">Notas</dt>
                <dd className="text-right text-slate-800">{detalle.appointment.notes}</dd>
              </div>
            ) : null}
          </dl>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}