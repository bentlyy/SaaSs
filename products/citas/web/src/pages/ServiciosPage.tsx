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
  dinero,
  useAviso,
  useApp,
} from '@amg/ui';
import type { Servicio } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; servicio?: Servicio } | null;

function Casilla({
  etiqueta,
  marcada,
  onCambio,
}: {
  etiqueta: string;
  marcada: boolean;
  onCambio: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={marcada}
        onChange={(e) => onCambio(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 accent-brand-600"
      />
      {etiqueta}
    </label>
  );
}

/** Lo que se cobra: nombre, cuánto dura y en cuánto. El precio va en centavos. */
export function ServiciosPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const moneda = String(settings?.currency ?? '$');

  const [servicios, setServicios] = useState<Servicio[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [activo, setActivo] = useState(true);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function cargar() {
    const lista = await api.get<{ items: Servicio[] }>('/services?limit=200');
    setServicios(lista.items ?? []);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function abrirNuevo() {
    setErrorModal(null);
    setCampos({ name: '', durationMin: '30', priceCents: '0' });
    setActivo(true);
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(s: Servicio) {
    setErrorModal(null);
    setCampos({ name: s.name, durationMin: String(s.durationMin), priceCents: String(s.priceCents) });
    setActivo(s.active);
    setModal({ modo: 'editar', servicio: s });
  }

  async function borrar(s: Servicio) {
    try {
      await api.delete(`/services/${s.id}`);
      await cargar();
      avisar('Servicio eliminado');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    if (!modal) return;
    setGuardando(true);
    setErrorModal(null);
    try {
      const datos = {
        name: campos.name,
        durationMin: Number(campos.durationMin || 30),
        priceCents: Number(campos.priceCents || 0),
        active: activo,
      };
      if (modal.modo === 'nuevo') await api.post('/services', datos);
      else await api.patch(`/services/${modal.servicio!.id}`, datos);
      setModal(null);
      await cargar();
      avisar(modal.modo === 'nuevo' ? 'Servicio creado' : 'Servicio actualizado');
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Servicios"
        subtitulo="Lo que se cobra y cuánto dura cada trabajo."
        acciones={<BotonPrimario onClick={abrirNuevo}>Nuevo servicio</BotonPrimario>}
      />

      <Tarjeta titulo="Servicios">
        {!servicios ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', { titulo: 'Duración', num: true }, { titulo: 'Precio', num: true }, 'Estado', 'Acciones']}>
            {servicios.length === 0 ? (
              <FilaVacia columnas={5} texto="Todavía no hay servicios. Creá el primero." />
            ) : (
              servicios.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{s.durationMin} min</td>
                  <td className="px-4 py-3 text-right text-slate-600">{dinero(s.priceCents, moneda)}</td>
                  <td className="px-4 py-3">
                    <Etiqueta texto={s.active ? 'Activo' : 'Inactivo'} tono={s.active ? 'ok' : 'neutro'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => abrirEdicion(s)}>Editar</BotonChico>
                      <BotonChico peligro onClick={() => borrar(s)}>
                        Borrar
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
          titulo={modal.modo === 'nuevo' ? 'Nuevo servicio' : 'Editar servicio'}
          onCerrar={() => setModal(null)}
        >
          <form onSubmit={guardar} className="space-y-3">
            <Campo etiqueta="Nombre" name="name" required maxLength={150} value={campos.name ?? ''} onChange={alCambiar} autoFocus />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="Duración (min)" name="durationMin" type="number" min={5} max={1440} required value={campos.durationMin ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Precio (centavos)" name="priceCents" type="number" min={0} step={1} required value={campos.priceCents ?? ''} onChange={alCambiar} />
            </div>
            <div className="flex items-end">
              <Casilla etiqueta="Servicio activo" marcada={activo} onCambio={setActivo} />
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