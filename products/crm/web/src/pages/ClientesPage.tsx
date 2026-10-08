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
  estadoDe,
  fecha,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import type { Cliente, Contacto, Seguimiento } from '../tipos';

type Modal_ = { modo: 'nuevo' | 'editar'; cliente?: Cliente } | null;

interface FichaData {
  customer: Cliente;
  followups: Seguimiento[];
  interactions: Contacto[];
  resumen: {
    seguimientosAbiertos: number;
    seguimientosVencidos: number;
    contactos: number;
    ultimoContacto: string | null;
  };
}

const ETIQUETA_ESTADO: MapaEstados = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  done: { texto: 'Hecho', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

const ETIQUETA_CONTACTO: Record<string, string> = {
  llamada: 'Llamada',
  correo: 'Correo',
  visita: 'Visita',
  nota: 'Nota',
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fechaIso?: string | null): string {
  if (!fechaIso) return '';
  const [, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}`;
}

/**
 * Clientes: la cartera con su ficha.
 *
 * La lista se pide una sola vez (500) y la búsqueda la hace la pantalla sobre
 * esa lista, como el legacy: filtra nombre, empresa, teléfono, correo, documento
 * y ciudad sin volver a tocar el servidor en cada tecla.
 */
export function ClientesPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [q, setQ] = useState('');
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [modal, setModal] = useState<Modal_>(null);
  const [ficha, setFicha] = useState<FichaData | null>(null);
  const [campos, setCampos] = useState<Record<string, string>>({});
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function cargar() {
    const items = await api.get<{ items: Cliente[] }>('/customers?limit=500');
    setClientes(items.items);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as any).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  function abrirNuevo() {
    setErrorModal(null);
    setCampos({
      name: '',
      company: '',
      kind: 'persona',
      email: '',
      phone: '',
      taxId: '',
      address: '',
      city: '',
      notes: '',
      tags: '',
      birthday: '',
    });
    setModal({ modo: 'nuevo' });
  }

  function abrirEdicion(c: Cliente) {
    setErrorModal(null);
    setCampos({
      name: c.name,
      company: c.company ?? '',
      kind: c.kind,
      email: c.email ?? '',
      phone: c.phone ?? '',
      taxId: c.taxId ?? '',
      address: c.address ?? '',
      city: c.city ?? '',
      notes: c.notes ?? '',
      tags: c.tags ?? '',
      birthday: c.birthday ?? '',
    });
    setModal({ modo: 'editar', cliente: c });
  }

  async function verFicha(c: Cliente) {
    try {
      const datos = await api.get<FichaData>(`/customers/${c.id}/ficha`);
      setFicha(datos);
    } catch (e) {
      avisar((e as Error).message, true);
    }
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
      // Los campos vacíos viajan como null y no como "": el servidor distingue
      // "no lo tengo" de "lo tengo en blanco", y la ficha muestra distinto.
      const datos = {
        name: campos.name,
        company: campos.company || null,
        kind: campos.kind,
        email: campos.email || null,
        phone: campos.phone || null,
        taxId: campos.taxId || null,
        address: campos.address || null,
        city: campos.city || null,
        notes: campos.notes || null,
        tags: campos.tags || null,
        birthday: campos.birthday || null,
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
          [c.name, c.company, c.phone, c.email, c.taxId, c.city].some((v) =>
            String(v ?? '').toLowerCase().includes(busqueda),
          ),
        )
      : clientes;

  const tipo = (c: Cliente) => (c.kind === 'empresa' ? 'Empresa' : 'Persona');

  return (
    <>
      <PageHeader
        titulo="Clientes"
        subtitulo="Buscar por nombre, teléfono, documento o ciudad."
        acciones={
          <>
            <Buscador valor={q} onChange={setQ} placeholder="Nombre, teléfono, documento…" />
            <BotonPrimario onClick={abrirNuevo}>Nuevo cliente</BotonPrimario>
          </>
        }
      />

      <Tarjeta titulo="Clientes" className="mt-6">
        {!lista ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Nombre', 'Tipo', 'Teléfono', 'Correo', 'Ciudad', 'Acciones']}>
            {lista.length === 0 ? (
              <FilaVacia
                columnas={6}
                texto={
                  clientes!.length === 0
                    ? 'Todavía no hay clientes. Creá el primero.'
                    : 'No hay clientes que coincidan'
                }
              />
            ) : (
              lista.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {c.name}
                    {c.taxId ? <span className="block text-xs font-normal text-slate-400">{c.taxId}</span> : null}
                  </td>
                  <td className="px-4 py-3 text-slate-500">{tipo(c)}</td>
                  <td className="px-4 py-3 text-slate-500">{c.phone || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.email || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{c.city || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => verFicha(c)}>Ficha</BotonChico>
                      <BotonChico onClick={() => abrirEdicion(c)}>Editar</BotonChico>
                      <BotonChico onClick={() => archivar(c)}>Archivar</BotonChico>
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
            <Campo etiqueta="Tipo de ficha" name="kind" required value={campos.kind ?? 'persona'} onChange={alCambiar}>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                name="kind"
                value={campos.kind ?? 'persona'}
                onChange={alCambiar}
              >
                <option value="persona">Persona</option>
                <option value="empresa">Empresa</option>
              </select>
            </Campo>
            <Campo etiqueta="Razón social" name="company" maxLength={200} value={campos.company ?? ''} onChange={alCambiar} />
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="Teléfono" name="phone" maxLength={40} value={campos.phone ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Correo" name="email" type="email" maxLength={200} value={campos.email ?? ''} onChange={alCambiar} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Campo etiqueta="RUT / RUC / NIT" name="taxId" maxLength={32} value={campos.taxId ?? ''} onChange={alCambiar} />
              <Campo etiqueta="Cumpleaños" name="birthday" type="date" value={campos.birthday ?? ''} onChange={alCambiar} />
            </div>
            <Campo etiqueta="Dirección" name="address" maxLength={300} value={campos.address ?? ''} onChange={alCambiar} />
            <Campo etiqueta="Ciudad" name="city" maxLength={120} value={campos.city ?? ''} onChange={alCambiar} />
            <Campo etiqueta="Notas" name="notes" maxLength={2000} value={campos.notes ?? ''} onChange={alCambiar} />
            <Campo
              etiqueta="Etiquetas (separadas por comas)"
              name="tags"
              maxLength={500}
              value={campos.tags ?? ''}
              onChange={alCambiar}
            />
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

      {ficha ? (
        <Modal titulo={`Ficha de ${ficha.customer.name}`} onCerrar={() => setFicha(null)}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-medium text-slate-500">Teléfono</dt>
            <dd className="text-slate-800">{ficha.customer.phone || 'Sin teléfono'}</dd>
            <dt className="font-medium text-slate-500">Correo</dt>
            <dd className="text-slate-800">{ficha.customer.email || 'Sin correo'}</dd>
            {fechaCorta(ficha.customer.birthday) ? (
              <>
                <dt className="font-medium text-slate-500">Cumpleaños</dt>
                <dd className="text-slate-800">{fechaCorta(ficha.customer.birthday)}</dd>
              </>
            ) : null}
            {ficha.customer.address ? (
              <>
                <dt className="font-medium text-slate-500">Dirección</dt>
                <dd className="text-slate-800">{ficha.customer.address}</dd>
              </>
            ) : null}
            {ficha.customer.city ? (
              <>
                <dt className="font-medium text-slate-500">Ciudad</dt>
                <dd className="text-slate-800">{ficha.customer.city}</dd>
              </>
            ) : null}
            {ficha.customer.tags ? (
              <>
                <dt className="font-medium text-slate-500">Etiquetas</dt>
                <dd className="text-slate-800">{ficha.customer.tags}</dd>
              </>
            ) : null}
            {ficha.customer.notes ? (
              <>
                <dt className="font-medium text-slate-500">Notas</dt>
                <dd className="text-slate-800">{ficha.customer.notes}</dd>
              </>
            ) : null}
          </dl>

          <p className="mt-3 text-xs text-slate-400">
            {ficha.resumen.seguimientosAbiertos} pendiente(s), {ficha.resumen.seguimientosVencidos} vencido(s),{' '}
            {ficha.resumen.contactos} contacto(s)
          </p>

          <section className="mt-4">
            <h4 className="text-sm font-semibold text-slate-900">Seguimientos</h4>
            {ficha.followups.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">Sin seguimientos</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {ficha.followups.map((f) => {
                  const estado = estadoDe(f.status, ETIQUETA_ESTADO);
                  return (
                    <li key={f.id} className="flex flex-col gap-0.5 py-2">
                      <span className="text-sm font-medium text-slate-800">{f.title}</span>
                      <span className="text-xs text-slate-400">
                        {[estado.texto, fechaCorta(f.dueDate)].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="mt-4">
            <h4 className="text-sm font-semibold text-slate-900">Historial de contacto</h4>
            {ficha.interactions.length === 0 ? (
              <p className="py-4 text-sm text-slate-400">Sin contactos registrados</p>
            ) : (
              <ul className="mt-1 divide-y divide-slate-100">
                {ficha.interactions.map((i) => (
                  <li key={i.id} className="flex flex-col gap-0.5 py-2">
                    <span className="text-sm font-medium text-slate-800">{i.summary}</span>
                    <span className="text-xs text-slate-400">
                      {ETIQUETA_CONTACTO[i.kind] ?? i.kind} · {fecha(i.happenedAt, true)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="mt-4 flex justify-end">
            <BotonPrimario onClick={() => setFicha(null)}>Cerrar</BotonPrimario>
          </div>
        </Modal>
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
