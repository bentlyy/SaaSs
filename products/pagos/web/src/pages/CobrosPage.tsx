import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Buscador,
  Campo,
  Etiqueta,
  FilaVacia,
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
  useApp,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import { FichaCargo } from '../components/FichaCargo';
import type { Cargo, Saldo } from '../tipos';

const ETIQUETA_ESTADO: MapaEstados = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  partial: { texto: 'Parcial', tono: 'acento' },
  paid: { texto: 'Pagado', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(iso?: string | null): string {
  if (!iso) return '';
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

type Modal_ = { modo: 'nuevo' | 'editar'; id?: string } | null;

const CAMPOS_VACIOS = {
  number: '',
  concept: '',
  customerName: '',
  customerId: '',
  customerEmail: '',
  amountCents: '',
  issuedDate: '',
  dueDate: '',
  notes: '',
};

/**
 * Cobros: la lista de cargos con su buscador, su ficha y su alta.
 *
 * La lista se pide completa (500) y el buscador y el filtro de estado trabajan
 * sobre esa lista, como el legacy: el `?q=` del servidor sigue existiendo para
 * otros clientes, pero la pantalla no va a la base en cada tecla.
 *
 * El saldo no viaja en la lista (no es una columna), así que se pide aparte con
 * `/charges/saldos`, que lo calcula con un solo GROUP BY. Y el total se escribe
 * en CENTAVOS: esta pantalla no multiplica por 100 en ningún lado.
 */
export function CobrosPage() {
  const { settings, cuenta } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [cargos, setCargos] = useState<Cargo[] | null>(null);
  const [saldos, setSaldos] = useState<Record<string, number>>({});
  const [q, setQ] = useState('');
  const [filtro, setFiltro] = useState('');
  const [modal, setModal] = useState<Modal_>(null);
  const [campos, setCampos] = useState<Record<string, string>>(CAMPOS_VACIOS);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [fichaId, setFichaId] = useState<string | null>(null);

  const simbolo = (settings?.currency as string | undefined) ?? '$';
  const monto = (centavos: number) => dinero(centavos, { simbolo });
  const saldoDe = (id: string) => saldos[id] ?? 0;
  const puedeBorrar = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';

  async function cargar() {
    const [lista, s] = await Promise.all([
      api.get<{ items: Cargo[] }>('/charges?limit=500'),
      api.get<{ saldos: Saldo[] }>('/charges/saldos'),
    ]);
    setCargos(lista.items);
    setSaldos(Object.fromEntries(s.saldos.map((x) => [x.id, x.saldoCents])));
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function cambiar<T extends object>(setter: Dispatch<SetStateAction<T>>) {
    return (ev: { target: { name: string; value: string } }) =>
      setter((c) => ({ ...c, [ev.target.name]: ev.target.value }) as T);
  }

  function abrirNuevo() {
    setCampos(CAMPOS_VACIOS);
    setErrorModal(null);
    setModal({ modo: 'nuevo' });
  }

  function abrirEditar(c: Cargo) {
    setCampos({
      number: String(c.number),
      concept: c.concept,
      customerName: c.customerName,
      customerId: c.customerId ?? '',
      customerEmail: c.customerEmail ?? '',
      amountCents: String(c.amountCents),
      issuedDate: c.issuedDate ?? '',
      dueDate: c.dueDate ?? '',
      notes: c.notes ?? '',
    });
    setErrorModal(null);
    setModal({ modo: 'editar', id: c.id });
  }

  async function proponerFolio() {
    try {
      const r = await api.get<{ number: number }>('/charges/next-number');
      setCampos((c) => ({ ...c, number: String(r.number) }));
    } catch (e) {
      setErrorModal((e as Error).message);
    }
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    try {
      // Los campos vacíos viajan como null y no como "": el servidor distingue
      // "no lo tengo" de "lo tengo en blanco".
      const cuerpo = {
        number: campos.number ? Number(campos.number) : null,
        concept: campos.concept,
        customerName: campos.customerName,
        customerId: campos.customerId || null,
        customerEmail: campos.customerEmail || null,
        issuedDate: campos.issuedDate || null,
        dueDate: campos.dueDate || null,
        amountCents: Number(campos.amountCents || 0),
        notes: campos.notes || null,
      };
      if (modal!.modo === 'nuevo') await api.post('/charges', cuerpo);
      else await api.patch(`/charges/${modal!.id}`, cuerpo);
      setModal(null);
      await cargar();
      avisar(modal!.modo === 'nuevo' ? 'Cargo creado' : 'Cargo actualizado');
    } catch (e) {
      // El 409 del folio repetido o del total que baja de lo cobrado llegan con
      // el texto que explica la regla: se muestra tal cual.
      setErrorModal((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  async function borrar(c: Cargo) {
    try {
      await api.delete(`/charges/${c.id}`);
      await cargar();
      avisar('Cargo borrado');
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  const busqueda = q.trim().toLowerCase();
  const lista = !cargos
    ? null
    : cargos.filter((c) => {
        if (filtro && c.status !== filtro) return false;
        if (!busqueda) return true;
        return [c.number, c.concept, c.customerName, c.customerEmail].some((v) =>
          String(v ?? '').toLowerCase().includes(busqueda),
        );
      });

  return (
    <>
      <PageHeader
        titulo="Cobros"
        subtitulo="Los cargos emitidos y lo que queda por cobrar."
        acciones={
          <>
            <Buscador valor={q} onChange={setQ} placeholder="Folio, concepto, cliente, correo…" />
            <BotonPrimario onClick={abrirNuevo}>Nuevo cargo</BotonPrimario>
          </>
        }
      />

      <Tarjeta className="mt-6">
        <div className="border-b border-slate-100 p-4">
          <div className="max-w-xs">
            <Select etiqueta="Estado" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
              <option value="">Todos</option>
              <option value="pending">Pendiente</option>
              <option value="partial">Parcial</option>
              <option value="paid">Pagado</option>
              <option value="canceled">Cancelado</option>
            </Select>
          </div>
        </div>

        {!lista ? (
          <Spinner />
        ) : (
          <Tabla
            columnas={['Folio', 'Cliente', 'Concepto', 'Emitido', 'Vence', 'Total', 'Saldo', 'Estado', '']}
          >
            {lista.length === 0 ? (
              <FilaVacia
                columnas={9}
                texto={cargos!.length === 0 ? 'Todavía no hay cargos. Creá el primero.' : 'No hay cargos que coincidan'}
              />
            ) : (
              lista.map((c) => {
                const saldo = saldoDe(c.id);
                const tieneCobrado = saldo < c.amountCents;
                return (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{c.number}</td>
                    <td className="px-4 py-3">
                      <span className="block font-medium text-slate-800">{c.customerName}</span>
                      {c.customerEmail ? <span className="block text-xs text-slate-400">{c.customerEmail}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{c.concept}</td>
                    <td className="px-4 py-3 text-slate-500">{fechaCorta(c.issuedDate) || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{fechaCorta(c.dueDate) || '—'}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{monto(c.amountCents)}</td>
                    <td className="px-4 py-3 text-right">
                      <Etiqueta texto={monto(saldoDe(c.id))} tono={saldoDe(c.id) > 0 ? 'malo' : 'ok'} />
                    </td>
                    <td className="px-4 py-3">
                      <Etiqueta {...estadoDe(c.status, ETIQUETA_ESTADO)} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <BotonChico onClick={() => setFichaId(c.id)}>Ficha</BotonChico>
                        <BotonChico onClick={() => abrirEditar(c)}>Editar</BotonChico>
                        {puedeBorrar && !tieneCobrado ? (
                          <BotonChico peligro onClick={() => borrar(c)}>
                            Borrar
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
          titulo={modal.modo === 'nuevo' ? 'Nuevo cargo' : 'Editar cargo'}
          onCerrar={() => setModal(null)}
          ancho="max-w-2xl"
        >
          <form onSubmit={guardar} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Campo
                    etiqueta="Folio"
                    name="number"
                    type="number"
                    min={1}
                    step={1}
                    value={campos.number ?? ''}
                    onChange={cambiar(setCampos)}
                  />
                </div>
                <BotonSecundario type="button" onClick={proponerFolio}>
                  Proponer
                </BotonSecundario>
              </div>
              <Campo
                etiqueta="Concepto"
                name="concept"
                required
                maxLength={150}
                value={campos.concept ?? ''}
                onChange={cambiar(setCampos)}
              />
            </div>

            <Campo
              etiqueta="Cliente"
              name="customerName"
              required
              maxLength={150}
              value={campos.customerName}
              onChange={cambiar(setCampos)}
              autoFocus
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Id del cliente (opcional)"
                name="customerId"
                maxLength={64}
                value={campos.customerId}
                onChange={cambiar(setCampos)}
              />
              <Campo
                etiqueta="Correo (opcional)"
                name="customerEmail"
                type="email"
                maxLength={200}
                value={campos.customerEmail}
                onChange={cambiar(setCampos)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Campo
                  etiqueta="Total (centavos)"
                  name="amountCents"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={campos.amountCents}
                  onChange={cambiar(setCampos)}
                />
                <span className="mt-1 block text-xs text-slate-400">
                  se ve como {monto(Number(campos.amountCents || 0))}
                </span>
              </div>
              <Campo etiqueta="Emitido el" name="issuedDate" type="date" value={campos.issuedDate} onChange={cambiar(setCampos)} />
              <Campo etiqueta="Vence el" name="dueDate" type="date" value={campos.dueDate} onChange={cambiar(setCampos)} />
            </div>
            <Campo etiqueta="Notas" name="notes" maxLength={2000} value={campos.notes} onChange={cambiar(setCampos)} />

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

      {fichaId ? (
        <FichaCargo id={fichaId} simbolo={simbolo} onCerrar={() => setFichaId(null)} onCambio={cargar} />
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}