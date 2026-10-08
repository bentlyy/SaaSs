import { useEffect, useState, type ChangeEvent } from 'react';
import { Aviso, BotonPrimario, Campo, PageHeader, Spinner, Tabla, Tarjeta, api, dinero, useApp, useAviso } from '@amg/ui';
import type { Reporte } from '../tipos';

/** Los cuatro tramos del reporte, en el orden en que se leen. */
const TRAMOS: { clave: string; texto: string }[] = [
  { clave: '0-30', texto: '0 a 30 días' },
  { clave: '31-60', texto: '31 a 60 días' },
  { clave: '61-90', texto: '61 a 90 días' },
  { clave: 'mas-90', texto: 'Más de 90 días' },
];

/**
 * Antigüedad: cuánto se debe y desde cuándo.
 *
 * Los días de atraso se miden contra la fecha de corte (`to`): reproducir el
 * reporte de un mes pasado tiene que dar los mismos números hoy que entonces, y
 * contra "hoy" daría cuatro cifras distintas según el día en que se abra.
 *
 * Los montos viajan en centavos y se formatean con `dinero`, que es quien
 * divide; esta pantalla no multiplica por 100 en ningún lado.
 */
export function AntiguedadPage() {
  const { settings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reporte, setReporte] = useState<Reporte | null>(null);

  const simbolo = (settings?.currency as string | undefined) ?? '$';
  const monto = (centavos: number) => dinero(centavos, { simbolo });

  async function calcular() {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const qs = params.toString();
    setReporte(await api.get<Reporte>(`/reporte${qs ? `?${qs}` : ''}`));
  }

  useEffect(() => {
    calcular().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alCambiar = (setter: (v: string) => void) => (ev: ChangeEvent<HTMLInputElement>) =>
    setter(ev.target.value);

  return (
    <>
      <PageHeader
        titulo="Antigüedad"
        subtitulo="Cuánto se debe a cada tramo de atraso, contra la fecha de corte."
      />

      <Tarjeta titulo="Antigüedad de la cartera" className="mt-6">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <div className="w-44">
            <Campo etiqueta="Emitidos desde" type="date" value={from} onChange={alCambiar(setFrom)} />
          </div>
          <div className="w-44">
            <Campo etiqueta="Emitidos hasta" type="date" value={to} onChange={alCambiar(setTo)} />
          </div>
          <BotonPrimario type="button" onClick={calcular}>
            Calcular
          </BotonPrimario>
        </div>

        {!reporte ? (
          <Spinner />
        ) : (
          <>
            <Tabla columnas={['Tramo', 'Cargos', 'Saldo']}>
              {TRAMOS.map((t) => {
                const tramo = reporte.buckets[t.clave] ?? { cargos: 0, saldoCents: 0 };
                return (
                  <tr key={t.clave} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{t.texto}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{tramo.cargos}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{monto(tramo.saldoCents)}</td>
                  </tr>
                );
              })}
            </Tabla>

            <p className="p-4 text-sm text-slate-500">
              {reporte.totalCargos} cargo(s) con saldo · Total pendiente{' '}
              <span className="font-medium text-slate-800">{monto(reporte.totalPendienteCents)}</span> · Corte al{' '}
              {reporte.referencia}
            </p>
          </>
        )}
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}