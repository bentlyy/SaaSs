import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
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
import type { Cliente } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; cliente?: Cliente } | null;

/**
 * Quién reserva. El listado se pide una sola vez y el filtro lo hace la
 * pantalla, como el legacy: teclear no vuelve a tocar el servidor.
 */
export function ClientesPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [q, setQ] = useState('');
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function cargar() {
    const lista = await api.get<{ items: Cliente[] }>('/customers?limit=200');
    setClientes(lista.items ?? []);
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
    setCampos({ name: '', phone: '', email: '', tags: '' });
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(c: Cliente) {
    setErrorModal(null);
    setCampos({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', tags: c.tags ?? '' });
    setModal({ modo: 'editar', cliente: c });
  }

  async function archivar(c: Cliente) {
    try {
      await api.delete(`/customers/${c.id}`);
      await cargar();
      avisar('Cliente archivado');
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
      // Los campos vacíos viajan como null: el servidor distingue "no lo tengo"
      // de "lo tengo en blanco".
      const datos = {
        name: campos.name,
        phone: campos.phone || null,
        email: campos.email || null,
        tags: campos.tags || null,
      };
      if (modal.modo === 'nuevo') await api.post('/customers', datos);
      else await api.patch(`/customers/${modal.cliente!.id}`, datos);
      setModal(null);
      await cargar();
      avisar(modal.modo === 'nuevo' ? 'Cliente creado' : 'Cliente actualizado');
    } catch (e) {
      setErrorModal((e as Error).message || 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  }

  const busqueda = q.trim().toLowerCase();
  const lista = !clientes
    ? null
    : busqueda
      ? clientes.filter((c) =>
          [c.name, c.phone, c.email, c.tags].some((v) => String(v ?? '').toLowerCase().includes(busqueda)),
        )
      : clientes;

  return (
    <>
      <PageHeader
        titulo="Clientes"
        subtitulo="Quienes reservan: nombre, teléfono, correo y etiquetas."
        acciones={
          <>
            <Buscador valor={q} onChange={setQ} placeholder="Buscar cliente…" />
            <BotonPrimario onClick={abrirNuevo}>Nuevo cliente</BotonPrimario>
          </>
        }
      />

      <Tarjeta titulo="Clientes">
        {!lista ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', 'Teléfono', 'Correo', 'Etiquetas', 'Acciones']}>
            {lista.length === 0 ? (
              <FilaVacia
                columnas={5}
                texto={
                  clientes!.length === 0
                    ? 'Todavía no hay clientes. Creá el primero.'
                    : 'Nadie coincide con la búsqueda'
                }
              />
            ) : (
              lista.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.tags || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => abrirEdicion(c)}>Editar</BotonChico>
                      <BotonChico peligro onClick={() => archivar(c)}>
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
          titulo={modal.modo === 'nuevo' ? 'Nuevo cliente' : 'Editar cliente'}
          onCerrar={() => setModal(null)}
        >
          <form onSubmit={guardar} className="space-y-3">
            <Campo etiqueta="Nombre" name="name" required maxLength={150} value={campos.name ?? ''} onChange={alCambiar} autoFocus />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="Teléfono" name="phone" maxLength={40} value={campos.phone ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Correo" name="email" type="email" maxLength={200} value={campos.email ?? ''} onChange={alCambiar} />
            </div>
            <Campo etiqueta="Etiquetas" name="tags" maxLength={500} placeholder="vip, recurrente" value={campos.tags ?? ''} onChange={alCambiar} />
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