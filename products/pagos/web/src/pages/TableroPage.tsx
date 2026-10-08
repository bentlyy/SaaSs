import { useEffect, useState } from 'react';
import {
  Aviso,
  BotonChico,
  Etiqueta,
  Kpis,
  PageHeader,
  Spinner,
  Tarjeta,
  api,
  dinero,
  estadoDe,
  useApp,
  useAviso,
  type Kpi,
  type MapaEstados,
} from '@amg/ui';
import { FichaCargo } from '../components/FichaCargo';
import type { Tablero } from '../tipos';

const ETIQUETA_ESTADO: MapaEstados = {
  pending: { texto: 'Pendiente', tono: 'aviso' },
  partial: { texto: 'Parcial', tono: 'acento' },
  paid: { texto: 'Pagado', tono: 'ok' },
  canceled: { texto: 'Cancelado', tono: 'neutro' },
};

/**
 * El tablero: las cifras de la cartera y los últimos cargos emitidos.
 *
 * El KPI se arma `[etiqueta, valor]` y no al revés: el legacy pasaba el valor
 * primero y el helper lo mostraba como rótulo, con lo que la cifra grande era la
 * palabra "Cobrado este mes". Acá el rótulo es la palabra y el número el valor.
 */
export function TableroPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const [tablero, setTablero] = useState<Tablero | null>(null);
  const [fichaId, setFichaId] = useState<string | null>(null);

  const simbolo = (settings?.currency as string | undefined) ?? '$';
  const monto = (centavos: number) => dinero(centavos, { simbolo });

  async function cargar() {
    setTablero(await api.get<Tablero>('/dashboard'));
  }

  useEffect(() => {
    cargar().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const kpis: Kpi[] = tablero
    ? [
        { etiqueta: 'Cobrado este mes', valor: monto(tablero.cobradoMesCents), acento: true },
        { etiqueta: 'Por cobrar', valor: monto(tablero.pendienteCents) },
        { etiqueta: 'Vencido', valor: monto(tablero.vencidoCents) },
        { etiqueta: 'Cargos pendientes', valor: tablero.porStatus.pending },
        { etiqueta: 'Cargos parciales', valor: tablero.porStatus.partial },
        { etiqueta: 'Cargos pagados', valor: tablero.porStatus.paid },
        { etiqueta: 'Cargos cancelados', valor: tablero.porStatus.canceled },
      ]
    : [];

  return (
    <>
      <PageHeader titulo="Tablero" subtitulo="Cartera por cobrar" />

      {tablero ? <Kpis items={kpis} /> : <Spinner />}

      <Tarjeta titulo="Últimos cargos emitidos" className="mt-6">
        {!tablero ? (
          <Spinner />
        ) : tablero.recientes.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">Todavía no hay cargos emitidos</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tablero.recientes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">
                    {c.number} · {c.customerName}
                  </span>
                  <span className="block text-xs text-slate-400">
                    {c.concept} · saldo {monto(c.saldoCents)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Etiqueta {...estadoDe(c.status, ETIQUETA_ESTADO)} />
                  <BotonChico onClick={() => setFichaId(c.id)}>Ficha</BotonChico>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      {fichaId ? (
        <FichaCargo id={fichaId} simbolo={simbolo} onCerrar={() => setFichaId(null)} onCambio={cargar} />
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}