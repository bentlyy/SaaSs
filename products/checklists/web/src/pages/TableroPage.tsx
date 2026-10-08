import { useEffect, useState } from 'react';
import { Aviso, Kpis, PageHeader, Spinner, Tarjeta, api, useAviso, type Kpi } from '@amg/ui';
import type { Tablero } from '../tipos';

export function TableroPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();
  const [tablero, setTablero] = useState<Tablero | null>(null);

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
        { etiqueta: 'Corridas', valor: tablero.total, acento: true },
        { etiqueta: 'En curso', valor: tablero.porStatus.in_progress },
        { etiqueta: 'Completadas', valor: tablero.porStatus.done },
        { etiqueta: 'Canceladas', valor: tablero.porStatus.canceled },
        { etiqueta: 'Aprobadas', valor: tablero.porResultado.approved },
        { etiqueta: 'Observadas', valor: tablero.porResultado.observed },
        { etiqueta: 'Rechazadas', valor: tablero.porResultado.rejected },
        { etiqueta: 'Sin veredicto', valor: tablero.porResultado.sin },
        { etiqueta: 'Cumplimiento promedio', valor: tablero.cumplimientoPromedioPct == null ? '-' : `${tablero.cumplimientoPromedioPct}%` },
      ]
    : [];

  return (
    <>
      <PageHeader titulo="Tablero" />

      {tablero ? <Kpis items={kpis} /> : <Spinner />}

      <Tarjeta titulo="Puntos fallados en las últimas corridas" className="mt-6">
        {!tablero ? (
          <Spinner />
        ) : tablero.fallos.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-400">No hay puntos fallados en las últimas corridas</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {tablero.fallos.map((f, i) => (
              <li key={`${f.runId}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">
                    {f.position}. {f.label}
                  </span>
                  {f.note ? <span className="block text-xs text-slate-400">{f.note}</span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-400">
                    {[f.templateName, f.location].filter(Boolean).join(' · ')}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
