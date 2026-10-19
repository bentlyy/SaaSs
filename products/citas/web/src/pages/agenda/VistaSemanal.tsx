import { useMemo } from 'react';
import { estadoDe, type MapaEstados } from '@amg/ui';
import { DIAS, fechaEnZona, horaEnZona, sumarDias } from '../../horas';
import type { Cita, Profesional } from '../../tipos';

interface Props {
  citas: Cita[];
  lunes: string;
  z: string;
  estados: MapaEstados;
  profesionales: Profesional[];
  verDetalle: (citaId: string) => void;
  /** Clic en una celda vacía: abre "Nueva cita" con esa fecha y hora. */
  abrirEnHora: (fecha: string, hora: string) => void;
}

/**
 * La semana como cuadrícula: 7 columnas (de lunes a domingo) por horas.
 *
 * No es un calendario de posicionamiento absoluto: cada fila es una hora y
 * dentro van las citas que empiezan en esa hora, como fichas. Es más simple de
 * leer en celular (scroll horizontal) y de mantener que calcular píxeles por
 * minuto, y para coordinar la semana alcanza: se ve quién atiende cuándo y en
 * qué días hay huecos.
 */
export function VistaSemanal({ citas, lunes, z, estados, profesionales, verDetalle, abrirEnHora }: Props) {
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes]);

  // El rango de horas sale de las citas de la semana; sin citas, 8:00–19:00.
  const { horaPrimera, horaUltima } = useMemo(() => {
    if (citas.length === 0) return { horaPrimera: 8, horaUltima: 19 };
    const horas = citas.map((c) => Number(horaEnZona(c.startAt, z).slice(0, 2)));
    return {
      horaPrimera: Math.max(0, Math.min(...horas) - 1),
      horaUltima: Math.min(23, Math.max(...horas) + 1),
    };
  }, [citas, z]);

  const horas = useMemo(() => {
    const lista: number[] = [];
    for (let h = horaPrimera; h <= horaUltima; h++) lista.push(h);
    return lista;
  }, [horaPrimera, horaUltima]);

  // índice: fecha -> hora -> citas que empiezan esa hora
  const porDiaHora = useMemo(() => {
    const idx = new Map<string, Map<number, Cita[]>>();
    for (const c of citas) {
      const fecha = fechaEnZona(c.startAt, z);
      const hora = Number(horaEnZona(c.startAt, z).slice(0, 2));
      if (!idx.has(fecha)) idx.set(fecha, new Map());
      const delDia = idx.get(fecha)!;
      if (!delDia.has(hora)) delDia.set(hora, []);
      delDia.get(hora)!.push(c);
    }
    return idx;
  }, [citas, z]);

  const colorDe = (staffId: string | null) =>
    (staffId ? profesionales.find((p) => p.id === staffId)?.color : null) ?? '#94a3b8';

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[70rem]">
        {/* Encabezado: día de la semana + fecha */}
        <div className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b border-slate-200">
          <div />
          {dias.map((fecha, i) => {
            const [, m, d] = fecha.split('-').map(Number);
            return (
              <div key={fecha} className="px-2 py-2 text-center">
                <p className="text-xs uppercase tracking-wide text-slate-500">{DIAS[i]}</p>
                <p className="text-sm font-semibold text-slate-800">
                  {d}/{m}
                </p>
              </div>
            );
          })}
        </div>

        {/* Filas: una por hora */}
        {horas.map((hora) => (
          <div key={hora} className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b border-slate-100">
            <div className="px-2 py-1 text-right text-xs font-medium text-slate-400">
              {String(hora).padStart(2, '0')}:00
            </div>
            {dias.map((fecha) => {
              const citasDeLaCelda = porDiaHora.get(fecha)?.get(hora) ?? [];
              const vacia = citasDeLaCelda.length === 0;
              const agendar = () => abrirEnHora(fecha, `${String(hora).padStart(2, '0')}:00`);
              return (
                // Un div y no un botón: la celda contiene fichas que ya son
                // botones, y un botón dentro de otro botón es HTML inválido.
                <div
                  key={fecha}
                  role={vacia ? 'button' : undefined}
                  tabIndex={vacia ? 0 : undefined}
                  onClick={vacia ? agendar : undefined}
                  onKeyDown={
                    vacia
                      ? (ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            agendar();
                          }
                        }
                      : undefined
                  }
                  className={`min-h-10 border-l border-slate-100 p-1 text-left align-top ${
                    vacia ? 'cursor-pointer hover:bg-brand-50/60' : ''
                  }`}
                >
                  {citasDeLaCelda.map((c) => {
                    const e = estadoDe(c.status, estados);
                    const cancelada = c.status === 'cancelled' || c.status === 'no_show';
                    return (
                      <span
                        key={c.id}
                        role="button"
                        tabIndex={0}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          verDetalle(c.id);
                        }}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.stopPropagation();
                            verDetalle(c.id);
                          }
                        }}
                        title={`${c.customerName ?? 'Sin cliente'} · ${e.texto}`}
                        className={`mb-0.5 block cursor-pointer rounded px-1.5 py-0.5 text-xs text-white ${
                          cancelada ? 'opacity-50 line-through' : ''
                        }`}
                        style={{ background: colorDe(c.staffId) }}
                      >
                        {horaEnZona(c.startAt, z)} {c.customerName ?? 'Sin cliente'}
                      </span>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Tocá un hueco vacío para agendar a esa hora; tocá una cita para ver su detalle.
      </p>
    </div>
  );
}
