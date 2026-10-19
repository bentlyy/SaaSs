import { useMemo } from 'react';
import { fechaEnZona, hoyEnZona, diasDelMes, inicioDeLaSemana, inicioDelMes, sumarDias } from '../../horas';
import type { Cita, Profesional } from '../../tipos';

interface Props {
  citas: Cita[];
  ancla: string;
  z: string;
  profesionales: Profesional[];
  /** Clic en un día: se pasa a la vista diaria de esa fecha. */
  elegirDia: (fecha: string) => void;
}

const DIAS_CORTOS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];

/**
 * El mes como calendario-resumen: un punto por profesional de cada cita.
 *
 * No reemplaza a la vista semanal para trabajar: sirve para responder "¿cuándo
 * está libre el mes?" de un vistazo. Un clic en el día baja a la vista diaria,
 * que es donde se ve y se edita cada cita.
 */
export function VistaMensual({ citas, ancla, z, profesionales, elegirDia }: Props) {
  const primerDia = inicioDelMes(ancla);
  const totalDias = diasDelMes(ancla);
  const hoy = hoyEnZona(z);

  // La grilla arranca el lunes de la semana del día 1, con celdas fantasma
  // al principio y al final para cerrar las semanas completas.
  const celdas = useMemo(() => {
    const inicio = inicioDeLaSemana(primerDia);
    const cantidad = Math.ceil(((new Date(`${primerDia}T00:00:00Z`).getUTCDay() + 6) % 7 + totalDias) / 7) * 7;
    return Array.from({ length: cantidad }, (_, i) => sumarDias(inicio, i));
  }, [primerDia, totalDias]);

  const porFecha = useMemo(() => {
    const idx = new Map<string, Cita[]>();
    for (const c of citas) {
      const fecha = fechaEnZona(c.startAt, z);
      if (!idx.has(fecha)) idx.set(fecha, []);
      idx.get(fecha)!.push(c);
    }
    return idx;
  }, [citas, z]);

  const colorDe = (staffId: string | null) =>
    (staffId ? profesionales.find((p) => p.id === staffId)?.color : null) ?? '#94a3b8';

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-slate-200 pb-1">
        {DIAS_CORTOS.map((d) => (
          <div key={d} className="py-1 text-center text-xs uppercase tracking-wide text-slate-500">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {celdas.map((fecha) => {
          const [, , d] = fecha.split('-').map(Number);
          const esDelMes = fecha.slice(0, 7) === primerDia.slice(0, 7);
          const esHoy = fecha === hoy;
          const delDia = porFecha.get(fecha) ?? [];
          const visibles = delDia.filter((c) => c.status !== 'cancelled' && c.status !== 'no_show');
          return (
            <button
              key={fecha}
              type="button"
              onClick={() => elegirDia(fecha)}
              className={`min-h-20 border-b border-l border-slate-100 p-1.5 text-left align-top hover:bg-brand-50/60 ${
                esDelMes ? '' : 'bg-slate-50/60'
              }`}
            >
              <span
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-sm ${
                  esHoy
                    ? 'bg-brand-600 font-semibold text-white'
                    : esDelMes
                      ? 'text-slate-700'
                      : 'text-slate-400'
                }`}
              >
                {d}
              </span>
              {visibles.length > 0 ? (
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  {visibles.slice(0, 4).map((c) => (
                    <span
                      key={c.id}
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: colorDe(c.staffId) }}
                      title={`${c.customerName ?? 'Sin cliente'} · ${fechaEnZona(c.startAt, z)}`}
                    />
                  ))}
                  {visibles.length > 4 ? (
                    <span className="text-xs font-medium text-slate-500">+{visibles.length - 4}</span>
                  ) : null}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Cada punto es una cita, con el color de su profesional. Tocá un día para ver su agenda completa.
      </p>
    </div>
  );
}
