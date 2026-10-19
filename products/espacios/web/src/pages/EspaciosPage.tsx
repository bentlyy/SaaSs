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
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  Textarea,
  api,
  dinero,
  useApp,
  useAviso,
} from '@amg/ui';
import type { Espacio, ModoPrecio } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; espacio?: Espacio } | null;

/** Cómo se cobra cada modo, para los selectores y la columna de la tabla. */
const MODOS: Array<{ id: ModoPrecio; texto: string }> = [
  { id: 'hour', texto: 'Por hora' },
  { id: 'block', texto: 'Por bloque' },
  { id: 'day', texto: 'Por jornada' },
];

/** La tarifa ya formateada según el modo, que es lo que se muestra en la fila. */
function tarifaDe(e: Espacio, moneda: string): string {
  if (e.pricingMode === 'day') return `${dinero(e.pricePerDayCents, moneda)} / jornada`;
  if (e.pricingMode === 'block') return `${dinero(e.pricePerBlockCents, moneda)} / ${e.blockMinutes} min`;
  return `${dinero(e.pricePerHourCents, moneda)} / hora`;
}

/**
 * Los espacios reservables: sus características y cómo se cobran.
 *
 * Un espacio cobra por hora, por bloque de minutos o por jornada completa, y
 * `pricingMode` elige cuál. Las tres tarifas se guardan aunque solo una esté
 * activa: cambiar de modo no obliga a reescribir las otras.
 *
 * El total de cada reserva se materializa al escribirla con la tarifa de ESE
 * momento: cambiarla acá no toca las reservas viejas, que siguen valiendo lo
 * que valieron el día que se hicieron.
 */
export function EspaciosPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const moneda = typeof settings?.currency === 'string' ? settings.currency : '$';

  const [espacios, setEspacios] = useState<Espacio[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const lista = await api.get<{ items: Espacio[] }>('/spaces?limit=500');
    setEspacios(lista.items);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNuevo() {
    setErrorModal(null);
    // Los mismos valores por defecto del form legacy: un espacio recién creado
    // nace como cancha para 10 a $300.000 la hora, y se ajusta después.
    setCampos({
      name: '',
      description: '',
      type: 'cancha',
      capacity: '10',
      pricingMode: 'hour',
      pricePerHourCents: '30000',
      pricePerBlockCents: '0',
      blockMinutes: '60',
      pricePerDayCents: '0',
    });
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(e: Espacio) {
    setErrorModal(null);
    setCampos({
      name: e.name,
      description: e.description ?? '',
      type: e.type,
      capacity: String(e.capacity),
      pricingMode: e.pricingMode,
      pricePerHourCents: String(e.pricePerHourCents),
      pricePerBlockCents: String(e.pricePerBlockCents),
      blockMinutes: String(e.blockMinutes),
      pricePerDayCents: String(e.pricePerDayCents),
    });
    setModal({ modo: 'editar', espacio: e });
  }

  async function archivar(e: Espacio) {
    try {
      await api.delete(`/spaces/${e.id}`);
      await cargar();
      avisar(`Espacio "${e.name}" archivado`);
    } catch (err) {
      avisar((err as Error).message, true);
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
        description: campos.description || null,
        type: campos.type,
        capacity: Number(campos.capacity),
        pricingMode: campos.pricingMode,
        pricePerHourCents: Number(campos.pricePerHourCents),
        pricePerBlockCents: Number(campos.pricePerBlockCents),
        blockMinutes: Number(campos.blockMinutes),
        pricePerDayCents: Number(campos.pricePerDayCents),
      };
      if (modal.modo === 'nuevo') await api.post('/spaces', datos);
      else await api.patch(`/spaces/${modal.espacio!.id}`, datos);
      setModal(null);
      await cargar();
      avisar(modal.modo === 'nuevo' ? 'Espacio creado' : 'Espacio actualizado');
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Espacios"
        subtitulo="Canchas, salas y todo lo que se reserva por hora."
        acciones={<BotonPrimario onClick={abrirNuevo}>Nuevo espacio</BotonPrimario>}
      />

      <Tarjeta titulo="Tus espacios">
        {!espacios ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Nombre', 'Tipo', { titulo: 'Aforo', num: true }, { titulo: 'Tarifa', num: true }, 'Acciones']}
          >
            {espacios.length === 0 ? (
              <FilaVacia columnas={5} texto="Todavía no hay espacios. Creá el primero." />
            ) : (
              espacios.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {e.name}
                    {e.description ? (
                      <span className="block text-xs font-normal text-slate-400">{e.description}</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{e.type}</td>
                  <td className="px-4 py-3 text-right text-slate-500">{e.capacity}</td>
                  <td className="px-4 py-3 text-right text-slate-800">{tarifaDe(e, moneda)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => abrirEdicion(e)}>Editar</BotonChico>
                      <BotonChico peligro onClick={() => archivar(e)}>
                        Archivar
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
          titulo={modal.modo === 'nuevo' ? 'Nuevo espacio' : `Editar ${modal.espacio!.name}`}
          onCerrar={() => setModal(null)}
          ancho="max-w-xl"
        >
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
            <Textarea
              etiqueta="Descripción"
              name="description"
              rows={2}
              maxLength={2000}
              placeholder="Qué tiene el espacio: proyector, pizarra, techo, iluminación…"
              value={campos.description ?? ''}
              onChange={alCambiar}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo
                etiqueta="Tipo"
                name="type"
                required
                maxLength={40}
                placeholder="cancha, sala, gym…"
                value={campos.type ?? ''}
                onChange={alCambiar}
              />
              <Campo
                etiqueta="Aforo"
                name="capacity"
                type="number"
                min={1}
                step={1}
                required
                value={campos.capacity ?? ''}
                onChange={alCambiar}
              />
            </div>
            <Select etiqueta="Cómo se cobra" name="pricingMode" value={campos.pricingMode ?? 'hour'} onChange={alCambiar}>
              {MODOS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.texto}
                </option>
              ))}
            </Select>
            {campos.pricingMode === 'day' ? (
              <Campo
                etiqueta="Tarifa por jornada (centavos)"
                name="pricePerDayCents"
                type="number"
                min={0}
                step={100}
                required
                value={campos.pricePerDayCents ?? ''}
                onChange={alCambiar}
              />
            ) : campos.pricingMode === 'block' ? (
              <div className="grid gap-3 md:grid-cols-2">
                <Campo
                  etiqueta="Tarifa por bloque (centavos)"
                  name="pricePerBlockCents"
                  type="number"
                  min={0}
                  step={100}
                  required
                  value={campos.pricePerBlockCents ?? ''}
                  onChange={alCambiar}
                />
                <Campo
                  etiqueta="Duración del bloque (minutos)"
                  name="blockMinutes"
                  type="number"
                  min={15}
                  max={1440}
                  step={15}
                  required
                  value={campos.blockMinutes ?? ''}
                  onChange={alCambiar}
                />
              </div>
            ) : (
              <Campo
                etiqueta="Tarifa por hora (centavos)"
                name="pricePerHourCents"
                type="number"
                min={0}
                step={100}
                required
                value={campos.pricePerHourCents ?? ''}
                onChange={alCambiar}
              />
            )}
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
