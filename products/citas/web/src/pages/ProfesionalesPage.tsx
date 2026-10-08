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
  useAviso,
} from '@amg/ui';
import type { Profesional } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; profesional?: Profesional } | null;

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

/** Quién atiende, con su color (el punto del calendario) y su estado. */
export function ProfesionalesPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [profesionales, setProfesionales] = useState<Profesional[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [activo, setActivo] = useState(true);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function cargar() {
    const lista = await api.get<{ items: Profesional[] }>('/staff?limit=200');
    setProfesionales(lista.items ?? []);
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
    setCampos({ name: '', phone: '', color: '#c2571a' });
    setActivo(true);
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(p: Profesional) {
    setErrorModal(null);
    setCampos({ name: p.name, phone: p.phone ?? '', color: p.color ?? '#c2571a' });
    setActivo(p.active);
    setModal({ modo: 'editar', profesional: p });
  }

  async function borrar(p: Profesional) {
    try {
      await api.delete(`/staff/${p.id}`);
      await cargar();
      avisar('Profesional eliminado');
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
        phone: campos.phone || null,
        color: campos.color || null,
        active: activo,
      };
      // El correo no se edita acá: para uno nuevo va vacío; al editar, sería
      // pisar lo que haya con un null.
      if (modal.modo === 'nuevo') await api.post('/staff', { ...datos, email: null });
      else await api.patch(`/staff/${modal.profesional!.id}`, datos);
      setModal(null);
      await cargar();
      avisar(modal.modo === 'nuevo' ? 'Profesional creado' : 'Profesional actualizado');
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Profesionales"
        subtitulo="Quién atiende, su color y si está activo."
        acciones={<BotonPrimario onClick={abrirNuevo}>Nuevo profesional</BotonPrimario>}
      />

      <Tarjeta titulo="Profesionales">
        {!profesionales ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', 'Teléfono', 'Color', 'Estado', 'Acciones']}>
            {profesionales.length === 0 ? (
              <FilaVacia columnas={5} texto="Todavía no hay profesionales. Creá el primero." />
            ) : (
              profesionales.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: p.color ?? '#999' }}
                      />
                      {p.name}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{p.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{p.color || '—'}</td>
                  <td className="px-4 py-3">
                    <Etiqueta texto={p.active ? 'Activo' : 'Inactivo'} tono={p.active ? 'ok' : 'neutro'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => abrirEdicion(p)}>Editar</BotonChico>
                      <BotonChico peligro onClick={() => borrar(p)}>
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
          titulo={modal.modo === 'nuevo' ? 'Nuevo profesional' : 'Editar profesional'}
          onCerrar={() => setModal(null)}
        >
          <form onSubmit={guardar} className="space-y-3">
            <Campo etiqueta="Nombre" name="name" required maxLength={150} value={campos.name ?? ''} onChange={alCambiar} autoFocus />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="Teléfono" name="phone" maxLength={40} value={campos.phone ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Color" name="color" type="color" value={campos.color ?? '#c2571a'} onChange={alCambiar} />
            </div>
            <div className="flex items-end">
              <Casilla etiqueta="Profesional activo" marcada={activo} onCambio={setActivo} />
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