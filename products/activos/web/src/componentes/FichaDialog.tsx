import { useEffect, useState, type FormEvent } from 'react';
import {
  BotonPrimario,
  BotonSecundario,
  Campo,
  Etiqueta,
  Modal,
  Select,
  Spinner,
  Vacio,
  api,
  estadoDe,
  fecha,
  useApp,
} from '@amg/ui';
import { ETIQUETA_MOVIMIENTO, ESTADOS, MOVIMIENTOS, MOVIMIENTOS_VALOR } from '../estados';
import { fechaCorta, monto } from '../formato';
import type { AjustesActivos, Ficha, TipoMovimiento } from '../tipos';

/** Un par etiqueta/valor: la ficha es una lista de datos, no filas que comparar. */
function Dato({ termino, valor }: { termino: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-50 py-2 text-sm">
      <dt className="shrink-0 text-slate-500">{termino}</dt>
      <dd className="text-right text-slate-800">{valor}</dd>
    </div>
  );
}

interface Props {
  activoId: string;
  avisar: (mensaje: string, malo?: boolean) => void;
  onCerrar: () => void;
  /** Refresca la lista o el tablero del padre tras registrar un movimiento. */
  alMover: () => Promise<void>;
}

/**
 * La ficha de un activo: sus datos y todo lo que se le hizo.
 *
 * El historial se ve y no se edita: una fila que dice "el jueves se perdió en
 * obra" deja de ser verdad si se puede corregir en silencio.
 */
export function FichaDialog({ activoId, avisar, onCerrar, alMover }: Props) {
  const { zona, settings } = useApp();
  const ajustes = (settings ?? null) as AjustesActivos | null;
  const simbolo = ajustes?.currency ?? '$';

  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [tipo, setTipo] = useState<TipoMovimiento>('checkout');
  const [responsable, setResponsable] = useState('');
  const [nota, setNota] = useState('');
  const [registrando, setRegistrando] = useState(false);

  async function recargar() {
    setFicha(await api.get<Ficha>(`/assets/${activoId}/ficha`));
  }

  // La ficha cambia solo cuando cambia el activo que se mira (el id se elige
  // arriba); `recargar` y `avisar` no cambian de identidad.
  useEffect(() => {
    recargar().catch((e) => {
      if (e.vencida) return;
      avisar(e.message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activoId]);

  async function registrar(ev: FormEvent) {
    ev.preventDefault();
    setRegistrando(true);
    try {
      // El responsable se manda SOLO en un checkout, y vacío se manda `null`
      // para que la API lo exija con su mensaje en vez de dejar un movimiento
      // huérfano. No se manda `happenedAt`: un movimiento se registra mientras
      // pasa, y anotarlo a mano solo abre la puerta al día equivocado.
      const cuerpo: Record<string, unknown> = { kind: tipo, note: nota || null };
      if (tipo === 'checkout') cuerpo.assignedTo = responsable || null;
      await api.post(`/assets/${activoId}/movimientos`, cuerpo);
      setNota('');
      setResponsable('');
      await alMover();
      await recargar();
      avisar('Movimiento registrado');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo registrar el movimiento', true);
    } finally {
      setRegistrando(false);
    }
  }

  const a = ficha?.asset;

  return (
    <Modal
      titulo={a ? `${a.code} · ${a.name}` : 'Ficha del activo'}
      onCerrar={onCerrar}
      ancho="max-w-2xl"
    >
      {!ficha || !a ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Etiqueta texto={estadoDe(a.status, ESTADOS).texto} tono={estadoDe(a.status, ESTADOS).tono} />
            <Etiqueta texto={a.category} />
            {a.assignedTo ? <Etiqueta texto={`Lo tiene ${a.assignedTo}`} /> : null}
            {a.archivedAt ? <Etiqueta texto="Archivado" /> : null}
          </div>

          <dl className="grid gap-x-6 sm:grid-cols-2">
            <Dato termino="Marca" valor={a.brand ?? 'Sin marca'} />
            <Dato termino="Modelo" valor={a.model ?? 'Sin modelo'} />
            <Dato termino="Serie" valor={a.serial ?? 'Sin serie'} />
            <Dato termino="Ubicacion" valor={a.location ?? 'Sin ubicacion'} />
            {a.purchaseDate ? <Dato termino="Comprado" valor={fechaCorta(a.purchaseDate)} /> : null}
            <Dato termino="Costo" valor={monto(a.costCents, simbolo)} />
            {a.notes ? <Dato termino="Notas" valor={a.notes} /> : null}
          </dl>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Historial</h3>
            {ficha.movements.length === 0 ? (
              <Vacio texto="Sin movimientos registrados" />
            ) : (
              <ul className="mt-2 divide-y divide-slate-100">
                {ficha.movements.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-slate-800">{estadoDe(m.kind, MOVIMIENTOS).texto}</span>
                      {m.note ? <p className="text-xs text-slate-500">{m.note}</p> : null}
                    </div>
                    <Etiqueta texto={fecha(m.happenedAt, true, zona)} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-400">{ficha.resumen.totalMovimientos} movimiento(s) en el historial</p>
          </div>

          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-900">Registrar un movimiento</h3>
            <form onSubmit={registrar} className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select etiqueta="Que pasó" name="kind" value={tipo} onChange={(e) => setTipo(e.target.value as TipoMovimiento)}>
                  {MOVIMIENTOS_VALOR.map((k) => (
                    <option key={k} value={k}>
                      {ETIQUETA_MOVIMIENTO[k]}
                    </option>
                  ))}
                </Select>
                {tipo === 'checkout' ? (
                  <Campo
                    etiqueta="A quien se entrega (solo en checkout)"
                    name="assignedTo"
                    maxLength={120}
                    value={responsable}
                    onChange={(e) => setResponsable(e.target.value)}
                  />
                ) : null}
              </div>
              <Campo etiqueta="Nota" name="note" maxLength={2000} value={nota} onChange={(e) => setNota(e.target.value)} />
              <div className="flex justify-end gap-2 pt-2">
                <BotonSecundario type="button" onClick={onCerrar}>
                  Cerrar
                </BotonSecundario>
                <BotonPrimario type="submit" disabled={registrando}>
                  {registrando ? 'Registrando…' : 'Registrar movimiento'}
                </BotonPrimario>
              </div>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
}