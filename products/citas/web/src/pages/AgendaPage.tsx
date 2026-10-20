import { useCallback, useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
  EsqueletoKpis,
  Etiqueta,
  Kpis,
  Modal,
  NotaError,
  PageHeader,
  Select,
  Spinner,
  Tarjeta,
  api,
  dinero,
  estadoDe,
  fecha,
  useAviso,
  useApp,
  type MapaEstados,
} from '@amg/ui';
import {
  aMinutos,
  diasDelMes,
  fechaEnZona,
  finDelDia,
  hoyEnZona,
  horaEnZona,
  inicioDeLaSemana,
  inicioDelDia,
  inicioDelMes,
  instanteEnZona,
  mesAnterior,
  mesSiguiente,
  minutosAHora,
  nombreDelMes,
  sumarDias,
  zonaSegura,
} from '../horas';
import type { Cita, Cliente, DetalleCita, EstadoCita, Profesional, Resumen, Servicio } from '../tipos';
import { VistaDiaria } from './agenda/VistaDiaria';
import { VistaSemanal } from './agenda/VistaSemanal';
import { VistaMensual } from './agenda/VistaMensual';

/** Los estados de una cita y su tono: la forma la pone el módulo compartido. */
const ESTADOS: MapaEstados = {
  confirmed: { texto: 'Confirmada', tono: 'ok' },
  pending: { texto: 'Por confirmar', tono: 'aviso' },
  done: { texto: 'Realizada', tono: 'acento' },
  cancelled: { texto: 'Cancelada', tono: 'neutro' },
  no_show: { texto: 'No asistió', tono: 'malo' },
};

type Vista = 'dia' | 'semana' | 'mes';
type ModalCita = { modo: 'nueva' } | { modo: 'reprogramar'; cita: Cita } | null;

const VISTAS: Array<{ id: Vista; texto: string }> = [
  { id: 'dia', texto: 'Día' },
  { id: 'semana', texto: 'Semana' },
  { id: 'mes', texto: 'Mes' },
];

/**
 * La agenda: día, semana y mes sobre el mismo endpoint.
 *
 * `fechaDia` es el áncora de las tres vistas: en "día" es el día mostrado, en
 * "semana" cualquier día de la semana visible, en "mes" cualquier día del mes.
 * Según la vista se calcula el rango a pedir y la etiqueta de navegación, y
 * `/api/agenda?from&to` ya acepta cualquier franja, así que no hay endpoints
 * nuevos.
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

  const [vista, setVista] = useState<Vista>('dia');
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

  // El rango visible, como instantes UTC, según la vista.
  const lunes = inicioDeLaSemana(fechaDia);
  const primerDiaMes = inicioDelMes(fechaDia);
  const rango = useMemo(() => {
    if (vista === 'semana') {
      return {
        desde: inicioDelDia(lunes, z).toISOString(),
        hasta: finDelDia(sumarDias(lunes, 6), z).toISOString(),
      };
    }
    if (vista === 'mes') {
      const ultimo = sumarDias(primerDiaMes, diasDelMes(fechaDia) - 1);
      return {
        desde: inicioDelDia(primerDiaMes, z).toISOString(),
        hasta: finDelDia(ultimo, z).toISOString(),
      };
    }
    return {
      desde: inicioDelDia(fechaDia, z).toISOString(),
      hasta: finDelDia(fechaDia, z).toISOString(),
    };
  }, [vista, fechaDia, lunes, primerDiaMes, z]);

  const cargarResumenAgenda = useCallback(async () => {
    const [r, a] = await Promise.all([
      api.get<Resumen>('/resumen'),
      api.get<{ appointments: Cita[] }>(`/agenda?from=${rango.desde}&to=${rango.hasta}`),
    ]);
    setResumen(r);
    setCitas(a.appointments ?? []);
  }, [rango]);

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

  /** La hora de fin que dicta la duración del servicio, si se puede calcular. */
  function conFin(hora: string, serviceId: string, finActual: string): string {
    const s = servicios.find((x) => x.id === serviceId);
    if (!s) return finActual;
    const total = aMinutos(hora) + s.durationMin;
    return total < 24 * 60 ? minutosAHora(total) : finActual;
  }

  function abrirNueva(prefill?: { fecha?: string; hora?: string }) {
    setErrorModal(null);
    const horaIni = prefill?.hora ?? '10:00';
    setCampos({
      customerId: '',
      staffId: '',
      serviceId: '',
      fecha: prefill?.fecha ?? fechaDia,
      hora: horaIni,
      horaFin: minutosAHora(aMinutos(horaIni) + 30),
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

  function mover(delta: number) {
    if (vista === 'semana') setFechaDia((f) => sumarDias(f, delta * 7));
    else if (vista === 'mes') setFechaDia((f) => (delta > 0 ? mesSiguiente(f) : mesAnterior(f)));
    else setFechaDia((f) => sumarDias(f, delta));
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
        // Al agendar, la vista salta al día de la cita para verla colocada.
        setFechaDia(campos.fecha);
        setVista('dia');
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

  const etiquetaRango = useMemo(() => {
    if (vista === 'semana') {
      const fin = sumarDias(lunes, 6);
      const [, m1, d1] = lunes.split('-').map(Number);
      const [, m2, d2] = fin.split('-').map(Number);
      return `${d1}/${m1} – ${d2}/${m2}`;
    }
    if (vista === 'mes') return `${nombreDelMes(fechaDia)} ${fechaDia.slice(0, 4)}`;
    return '';
  }, [vista, lunes, fechaDia]);

  const tituloTarjeta = vista === 'dia' ? 'Citas del día' : vista === 'semana' ? 'Agenda semanal' : 'Agenda mensual';

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
        subtitulo="Las citas de tu taller, en su zona horaria."
        acciones={
          <>
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              {VISTAS.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setVista(v.id)}
                  className={`min-h-11 px-3 py-2 text-sm font-medium transition-colors sm:min-h-0 ${
                    vista === v.id ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {v.texto}
                </button>
              ))}
            </div>
            {vista === 'dia' ? (
              <input
                type="date"
                value={fechaDia}
                onChange={(e) => setFechaDia(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-44"
              />
            ) : (
              <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-1 shadow-sm">
                <BotonChico type="button" onClick={() => mover(-1)} aria-label="Anterior">
                  ‹
                </BotonChico>
                <span className="min-w-28 text-center text-sm font-medium text-slate-700">{etiquetaRango}</span>
                <BotonChico type="button" onClick={() => mover(1)} aria-label="Siguiente">
                  ›
                </BotonChico>
              </div>
            )}
            <Buscador valor={buscar} onChange={setBuscar} placeholder="Cliente o profesional" />
            <BotonPrimario onClick={() => abrirNueva()}>Nueva cita</BotonPrimario>
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

      <Tarjeta titulo={tituloTarjeta} className="mt-6">
        {!filtradas ? (
          <Spinner />
        ) : vista === 'dia' ? (
          <VistaDiaria
            citas={filtradas}
            z={z}
            moneda={moneda}
            estados={ESTADOS}
            buscar={q}
            verDetalle={verDetalle}
            abrirReprogramar={abrirReprogramar}
            cambiarEstado={cambiarEstado}
          />
        ) : vista === 'semana' ? (
          <VistaSemanal
            citas={filtradas}
            lunes={lunes}
            z={z}
            estados={ESTADOS}
            profesionales={profesionales}
            verDetalle={verDetalle}
            abrirEnHora={(fecha, hora) => abrirNueva({ fecha, hora })}
          />
        ) : (
          <VistaMensual
            citas={filtradas}
            ancla={fechaDia}
            z={z}
            profesionales={profesionales}
            elegirDia={(fecha) => {
              setFechaDia(fecha);
              setVista('dia');
            }}
          />
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
              <Campo
                etiqueta="Desde"
                name="hora"
                type="time"
                required
                value={campos.hora ?? ''}
                onChange={(e) =>
                  setCampos((c) => ({ ...c, hora: e.target.value, horaFin: conFin(e.target.value, c.serviceId ?? '', c.horaFin ?? e.target.value) }))
                }
              />
              <Campo etiqueta="Hasta" name="horaFin" type="time" required value={campos.horaFin ?? ''} onChange={alCambiar} />
            </div>

            {modal.modo === 'nueva' ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <Select
                    etiqueta="Servicio"
                    value={campos.serviceId ?? ''}
                    onChange={(e) => {
                      const serviceId = e.target.value;
                      setCampos((c) => {
                        const s = servicios.find((x) => x.id === serviceId);
                        return {
                          ...c,
                          serviceId,
                          priceCents: s ? String(s.priceCents) : '0',
                          // Elegir el servicio ajusta la hora de fin sola: la
                          // duración ya está cargada, no hace falta escribirla.
                          horaFin: conFin(c.hora ?? '10:00', serviceId, c.horaFin ?? ''),
                        };
                      });
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
