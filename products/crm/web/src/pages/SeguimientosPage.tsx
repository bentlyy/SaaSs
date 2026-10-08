import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Campo,
  Etiqueta,
  FilaVacia,
  Modal,
  NotaError,
  PageHeader,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  estadoDe,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import type { Cliente, Seguimiento } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; seguimiento?: Seguimiento } | null;

const ETIQUETA_ESTADO: MapaEstados = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  done: { texto: 'Hecho', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fechaIso?: string | null): string {
  if (!fechaIso) return '';
  const [, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}`;
}

/**
 * Seguimientos: lo que hay que hacer, con su fecha y su estado.
 *
 * El estado solo se manda (`pending`/`done`/`canceled`): la fecha de completado
 * la pone el servidor, porque "se terminó ahora" es un hecho, no algo que se
 * escriba a mano.
 */
export function SeguimientosPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [seguimientos, setSeguimientos] = useState<Seguimiento[] | null>(null);
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [clienteFiltro, setClienteFiltro] = useState('');
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api
      .get<{ items: Cliente[] }>('/customers?limit=500')
      .then((c) => setClientes(c.items))
      .catch((e) => {
        if ((e as any).vencida) return;
        avisar((e as Error).message, true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const filtro = clienteFiltro ? `&customerId=${encodeURIComponent(clienteFiltro)}` : '';
    api
      .get<{ followups: Seguimiento[] }>(`/followups?limit=300${filtro}`)
      .then((s) => setSeguimientos(s.followups))
      .catch((e) => {
        if ((e as any).vencida) return;
        avisar((e as Error).message, true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteFiltro]);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNuevo() {
    setErrorModal(null);
    setCampos({ customerId: '', title: '', body: '', dueDate: '', status: 'pending' });
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(s: Seguimiento) {
    setErrorModal(null);
    setCampos({
      customerId: s.customerId,
      title: s.title,
      body: s.body ?? '',
      dueDate: s.dueDate ?? '',
      status: s.status,
    });
    setModal({ modo: 'editar', seguimiento: s });
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    if (!modal) return;
    setGuardando(true);
    setErrorModal(null);
    try {
      const datos = {
        customerId: campos.customerId,
        title: campos.title,
        body: campos.body || null,
        dueDate: campos.dueDate || null,
        status: campos.status,
      };
      const eraNuevo = modal.modo === 'nuevo';
      if (eraNuevo) await api.post('/followups', datos);
      else await api.patch(`/followups/${modal.seguimiento!.id}`, datos);
      setModal(null);
      await recargar();
      avisar(eraNuevo ? 'Seguimiento creado' : 'Seguimiento actualizado');
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  async function alternarEstado(s: Seguimiento) {
    try {
      // Solo se manda el estado: la fecha de completado la pone el servidor.
      await api.patch(`/followups/${s.id}`, { status: s.status === 'done' ? 'pending' : 'done' });
      await recargar();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function recargar() {
    const filtro = clienteFiltro ? `&customerId=${encodeURIComponent(clienteFiltro)}` : '';
    const s = await api.get<{ followups: Seguimiento[] }>(`/followups?limit=300${filtro}`);
    setSeguimientos(s.followups);
  }

  const nombreCliente = (id: string) => clientes?.find((c) => c.id === id)?.name || '—';

  return (
    <>
      <PageHeader
        titulo="Seguimientos"
        subtitulo="Lo que hay que hacer y cuándo vence"
        acciones={<BotonPrimario onClick={abrirNuevo}>Nuevo seguimiento</BotonPrimario>}
      />

      <Tarjeta
        titulo="Seguimientos"
        acciones={
          <select
            aria-label="Filtrar por cliente"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            value={clienteFiltro}
            onChange={(e) => setClienteFiltro(e.target.value)}
          >
            <option value="">Todos los clientes</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        }
      >
        {!seguimientos ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Cliente', 'Qué hay que hacer', 'Para el día', 'Estado', 'Acciones']}>
            {seguimientos.length === 0 ? (
              <FilaVacia columnas={5} texto="No hay seguimientos" />
            ) : (
              seguimientos.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{nombreCliente(s.customerId)}</td>
                  <td className="px-4 py-3">
                    <span className="block font-medium text-slate-800">{s.title}</span>
                    {s.body ? <span className="block text-xs text-slate-400">{s.body}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{fechaCorta(s.dueDate) || '—'}</td>
                  <td className="px-4 py-3">
                    <Etiqueta {...estadoDe(s.status, ETIQUETA_ESTADO)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => abrirEdicion(s)}>Editar</BotonChico>
                      <BotonChico onClick={() => alternarEstado(s)}>
                        {s.status === 'done' ? 'Reabrir' : 'Marcar hecho'}
                      </BotonChico>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </Tabla>
        )}
      </Tarjeta>

      {modal ? (
        <Modal
          titulo={modal.modo === 'nuevo' ? 'Nuevo seguimiento' : 'Editar seguimiento'}
          onCerrar={() => setModal(null)}
        >
          <form onSubmit={guardar} className="space-y-3">
            <Campo etiqueta="Cliente" name="customerId" required value={campos.customerId ?? ''} onChange={alCambiar}>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                name="customerId"
                value={campos.customerId ?? ''}
                onChange={alCambiar}
                required
              >
                <option value="">Elegí un cliente</option>
                {(clientes ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo
              etiqueta="Qué hay que hacer"
              name="title"
              required
              maxLength={150}
              value={campos.title ?? ''}
              onChange={alCambiar}
              autoFocus
            />
            <Campo etiqueta="Detalle" name="body" maxLength={2000} value={campos.body ?? ''} onChange={alCambiar} />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="Para el día" name="dueDate" type="date" value={campos.dueDate ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Estado" name="status" required value={campos.status ?? 'pending'} onChange={alCambiar}>
                <select
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  name="status"
                  value={campos.status ?? 'pending'}
                  onChange={alCambiar}
                >
                  <option value="pending">Pendiente</option>
                  <option value="done">Hecho</option>
                  <option value="canceled">Cancelado</option>
                </select>
              </Campo>
            </div>
            <NotaError mensaje={errorModal} />
            <div className="flex justify-end gap-2 pt-2">
              <BotonSecundario type="button" onClick={() => setModal(null)}>
                Cancelar
              </BotonSecundario>
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </BotonPrimario>
            </div>
          </form>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
