import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import {
  Aviso,
  BotonPeligro,
  BotonPrimario,
  BotonSecundario,
  Campo,
  Etiqueta,
  Modal,
  NotaError,
  Select,
  api,
  dinero,
  estadoDe,
  fecha,
  useAviso,
  type MapaEstados,
} from '@amg/ui';
import type { Ficha, Metodo } from '../tipos';

const ETIQUETA_ESTADO: MapaEstados = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  partial: { texto: 'Parcial', tono: 'acento' },
  paid: { texto: 'Pagado', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

const METODOS: Record<Metodo, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  check: 'Cheque',
  other: 'Otro',
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(iso?: string | null): string {
  if (!iso) return '';
  const [, mes, dia] = iso.split('-');
  return `${dia}/${mes}`;
}

/**
 * La ficha de un cargo: sus datos, sus abonos, sus devoluciones y las acciones
 * de cobrar, devolver y cancelar.
 *
 * Es un modal y no otra página porque se abre encima del listado: se mira el
 * saldo y se vuelve a lo que se estaba viendo, sin perder el filtro. El estado
 * no se edita acá: se cambia registrando el abono o la devolución, y lo deriva
 * el servidor en la misma transacción.
 */
export function FichaCargo({
  id,
  simbolo,
  onCerrar,
  onCambio,
}: {
  id: string;
  simbolo: string;
  onCerrar: () => void;
  onCambio: () => void;
}) {
  const { aviso, limpiarAviso } = useAviso();
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [abono, setAbono] = useState({ amountCents: '', method: 'transfer', reference: '', receivedAt: '' });
  const [devolucion, setDevolucion] = useState({ amountCents: '', reason: '', method: 'transfer', reference: '', refundedAt: '' });

  const monto = (centavos: number) =>
    dinero(centavos, { simbolo, minimumFractionDigits: 2, maximumFractionDigits: 2 });

  useEffect(() => {
    let vivo = true;
    api
      .get<Ficha>(`/charges/${id}/ficha`)
      .then((f) => {
        if (!vivo) return;
        setFicha(f);
        setAbono((a) => ({ ...a, amountCents: String(f.saldoCents) }));
      })
      .catch((e) => {
        if (vivo) setError((e as Error).message);
      });
    return () => {
      vivo = false;
    };
  }, [id]);

  async function recargar() {
    setFicha(await api.get<Ficha>(`/charges/${id}/ficha`));
    onCambio();
  }

  function cambiar<T extends object>(setter: Dispatch<SetStateAction<T>>) {
    return (ev: { target: { name: string; value: string } }) =>
      setter((c) => ({ ...c, [ev.target.name]: ev.target.value }) as T);
  }

  async function registrarAbono(ev: FormEvent) {
    ev.preventDefault();
    setAbono((a) => ({ ...a }));
    try {
      await api.post(`/charges/${id}/abonos`, {
        amountCents: Number(abono.amountCents || 0),
        method: abono.method,
        reference: abono.reference || null,
        receivedAt: abono.receivedAt || undefined,
      });
      await recargar();
      setAbono((a) => ({ ...a, reference: '', receivedAt: '' }));
    } catch (e) {
      // El 409 de "el abono pasa el saldo" trae el texto que explica la regla.
      setError((e as Error).message);
    }
  }

  async function registrarDevolucion(ev: FormEvent) {
    ev.preventDefault();
    try {
      await api.post(`/charges/${id}/devoluciones`, {
        amountCents: Number(abono.amountCents && devolucion.amountCents ? devolucion.amountCents : 0),
        reason: devolucion.reason,
        method: devolucion.method,
        reference: devolucion.reference || null,
        refundedAt: devolucion.refundedAt || undefined,
      });
      await recargar();
      setDevolucion((d) => ({ ...d, reason: '', reference: '' }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function cancelar() {
    try {
      await api.post(`/charges/${id}/cancelar`, {});
      await recargar();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const c = ficha?.charge;
  const cerrado = c?.status === 'canceled';

  return (
    <Modal titulo={c ? `${c.number} · ${c.customerName}` : 'Ficha del cargo'} onCerrar={onCerrar} ancho="max-w-2xl">
      {!ficha ? (
        <p className="text-sm text-slate-400">{error ?? 'Cargando ficha…'}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta {...estadoDe(ficha.charge.status, ETIQUETA_ESTADO)} />
            {ficha.charge.dueDate ? <Etiqueta texto={`Vence ${fechaCorta(ficha.charge.dueDate)}`} /> : null}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="font-medium text-slate-500">Concepto</dt>
            <dd className="text-slate-800">{ficha.charge.concept}</dd>
            <dt className="font-medium text-slate-500">Total</dt>
            <dd className="text-slate-800">{monto(ficha.charge.amountCents)}</dd>
            <dt className="font-medium text-slate-500">Cobrado</dt>
            <dd className="text-slate-800">{monto(ficha.pagadoCents)}</dd>
            {ficha.devueltoCents > 0 ? (
              <>
                <dt className="font-medium text-slate-500">Devuelto</dt>
                <dd className="text-slate-800">{monto(ficha.devueltoCents)}</dd>
              </>
            ) : null}
            <dt className="font-medium text-slate-500">Saldo</dt>
            <dd className="font-medium text-slate-900">{monto(ficha.saldoCents)}</dd>
            {ficha.charge.customerEmail ? (
              <>
                <dt className="font-medium text-slate-500">Correo</dt>
                <dd className="text-slate-800">{ficha.charge.customerEmail}</dd>
              </>
            ) : null}
            {ficha.charge.notes ? (
              <>
                <dt className="font-medium text-slate-500">Notas</dt>
                <dd className="text-slate-800">{ficha.charge.notes}</dd>
              </>
            ) : null}
          </dl>

          <section>
            <h4 className="text-sm font-semibold text-slate-900">Abonos</h4>
            {ficha.payments.length === 0 ? (
              <p className="py-3 text-sm text-slate-400">Sin abonos registrados</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {ficha.payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-slate-800">{METODOS[p.method]}</span>
                      {p.reference ? <span className="block text-xs text-slate-400">{p.reference}</span> : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Etiqueta texto={fecha(p.receivedAt, true)} tono="neutro" />
                      <Etiqueta texto={monto(p.amountCents)} tono="ok" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {ficha.refunds.length > 0 ? (
            <section>
              <h4 className="text-sm font-semibold text-slate-900">Devoluciones</h4>
              <ul className="divide-y divide-slate-100">
                {ficha.refunds.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="block text-sm font-medium text-slate-800">{d.reason}</span>
                      <span className="block text-xs text-slate-400">
                        {METODOS[d.method]}
                        {d.reference ? ` · ${d.reference}` : ''}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Etiqueta texto={fecha(d.refundedAt, true)} tono="neutro" />
                      <Etiqueta texto={monto(d.amountCents)} tono="malo" />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!cerrado && ficha.saldoCents > 0 ? (
            <form onSubmit={registrarAbono} className="space-y-3 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-900">Registrar un abono</h4>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Monto (centavos)"
                  name="amountCents"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={abono.amountCents}
                  onChange={cambiar(setAbono)}
                />
                <Select etiqueta="Cómo entró" name="method" value={abono.method} onChange={cambiar(setAbono)}>
                  {Object.entries(METODOS).map(([clave, texto]) => (
                    <option key={clave} value={clave}>
                      {texto}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Referencia"
                  name="reference"
                  maxLength={120}
                  value={abono.reference}
                  onChange={cambiar(setAbono)}
                />
                <Campo
                  etiqueta="Recibido el"
                  name="receivedAt"
                  type="date"
                  value={abono.receivedAt}
                  onChange={cambiar(setAbono)}
                />
              </div>
              <div className="flex justify-end">
                <BotonPrimario type="submit">Registrar abono</BotonPrimario>
              </div>
            </form>
          ) : null}

          {!cerrado && ficha.pagadoCents > 0 ? (
            <form onSubmit={registrarDevolucion} className="space-y-3 border-t border-slate-100 pt-4">
              <h4 className="text-sm font-semibold text-slate-900">Devolver plata</h4>
              <p className="text-xs text-slate-400">
                El motivo es obligatorio: una devolución sin explicación es el movimiento que después nadie sabe defender.
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Monto (centavos)"
                  name="amountCents"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={devolucion.amountCents}
                  onChange={cambiar(setDevolucion)}
                />
                <Select etiqueta="Cómo salió" name="method" value={devolucion.method} onChange={cambiar(setDevolucion)}>
                  {Object.entries(METODOS).map(([clave, texto]) => (
                    <option key={clave} value={clave}>
                      {texto}
                    </option>
                  ))}
                </Select>
              </div>
              <Campo
                etiqueta="Motivo"
                name="reason"
                required
                maxLength={2000}
                value={devolucion.reason}
                onChange={cambiar(setDevolucion)}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Referencia"
                  name="reference"
                  maxLength={120}
                  value={devolucion.reference}
                  onChange={cambiar(setDevolucion)}
                />
                <Campo
                  etiqueta="Devuelto el"
                  name="refundedAt"
                  type="date"
                  value={devolucion.refundedAt}
                  onChange={cambiar(setDevolucion)}
                />
              </div>
              <div className="flex justify-end">
                <BotonPeligro type="submit">Registrar devolución</BotonPeligro>
              </div>
            </form>
          ) : null}

          <NotaError mensaje={error} />

          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
            {!cerrado && ficha.pagadoCents === 0 ? (
              <BotonSecundario type="button" onClick={cancelar}>
                Cancelar cargo
              </BotonSecundario>
            ) : null}
            <BotonPrimario type="button" onClick={onCerrar}>
              Cerrar
            </BotonPrimario>
          </div>
        </div>
      )}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </Modal>
  );
}