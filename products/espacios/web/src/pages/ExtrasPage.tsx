import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Campo,
  FilaVacia,
  Modal,
  NotaError,
  PageHeader,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  dinero,
  useApp,
  useAviso,
} from '@amg/ui';
import type { Extra } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; extra?: Extra } | null;

/**
 * Extras: lo que se agrega a una reserva y se suma a su total
 * (alquiler de equipo, instructor, toalla…).
 */
export function ExtrasPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const moneda = typeof settings?.currency === 'string' ? settings.currency : '$';

  const [extras, setExtras] = useState<Extra[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const lista = await api.get<{ items: Extra[] }>('/addons?limit=500');
    setExtras(lista.items);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNuevo() {
    setErrorModal(null);
    setCampos({ name: '', priceCents: '0', durationMin: '0' });
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(x: Extra) {
    setErrorModal(null);
    setCampos({ name: x.name, priceCents: String(x.priceCents), durationMin: String(x.durationMin) });
    setModal({ modo: 'editar', extra: x });
  }

  async function borrar(x: Extra) {
    try {
      await api.delete(`/addons/${x.id}`);
      await cargar();
      avisar(`Extra "${x.name}" borrado`);
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
        priceCents: Number(campos.priceCents),
        durationMin: Number(campos.durationMin),
      };
      if (modal.modo === 'nuevo') await api.post('/addons', datos);
      else await api.patch(`/addons/${modal.extra!.id}`, datos);
      setModal(null);
      await cargar();
      avisar(modal.modo === 'nuevo' ? 'Extra creado' : 'Extra actualizado');
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Extras"
        subtitulo="Se suman al total de la reserva."
        acciones={<BotonPrimario onClick={abrirNuevo}>Nuevo extra</BotonPrimario>}
      />

      <Tarjeta titulo="Extras" nota="Adicionales que se cobran junto al turno">
        {!extras ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', { titulo: 'Precio', num: true }, 'Acciones']}>
            {extras.length === 0 ? (
              <FilaVacia columnas={3} texto="Todavía no hay extras. Creá el primero." />
            ) : (
              extras.map((x) => (
                <tr key={x.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {x.name}
                    {x.durationMin > 0 ? (
                      <span className="block text-xs font-normal text-slate-400">{x.durationMin} min</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-800">{dinero(x.priceCents, moneda)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => abrirEdicion(x)}>Editar</BotonChico>
                      <BotonChico peligro onClick={() => borrar(x)}>
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
        <Modal titulo={modal.modo === 'nuevo' ? 'Nuevo extra' : 'Editar extra'} onCerrar={() => setModal(null)}>
          <form onSubmit={guardar} className="space-y-3">
            <Campo
              etiqueta="Nombre"
              name="name"
              required
              maxLength={150}
              value={campos.name ?? ''}
              onChange={alCambiar}
              autoFocus
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo
                etiqueta="Precio (centavos)"
                name="priceCents"
                type="number"
                min={0}
                step={100}
                required
                value={campos.priceCents ?? ''}
                onChange={alCambiar}
              />
              <Campo
                etiqueta="Duración (minutos)"
                name="durationMin"
                type="number"
                min={0}
                step={1}
                value={campos.durationMin ?? ''}
                onChange={alCambiar}
              />
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
