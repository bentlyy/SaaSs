import { useMemo } from 'react';
import { estadoDe, type MapaEstados } from '@amg/ui';
import { DIAS, sumarDias } from '../../horas';
import type { Espacio, Reserva } from '../../tipos';

interface Props {
  reservas: Reserva[];
  /** El lunes de la semana visible, como `AAAA-MM-DD`. */
  lunes: string;
  espacios: Espacio[];
  estados: MapaEstados;
  /** Clic en una celda vacía: abre "Nueva reserva" con ese día y esa hora. */
  abrirEnHora: (fecha: string, hora: string) => void;
}

/**
 * La semana como cuadrícula: 7 columnas (de lunes a domingo) por horas.
 *
 * Cada fila es una hora y dentro van las reservas que EMPIEZAN en esa hora, como
 * fichas pintadas con el color del espacio. No es posicionamiento absoluto por
 * minuto: en celular es más simple de leer y alcanza para ver quién ocupa qué
 * espacio y en qué días hay huecos.
 *
 * Las fechas y las horas se leen del ISO en UTC, igual que la tabla del día: si
 * acá se usara la zona del navegador, una reserva caería en un día distinto
 * según dónde esté abierto el taller.
 */
export function VistaSemanal({ reservas, lunes, espacios, estados, abrirEnHora }: Props) {
  const dias = useMemo(() => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i)), [lunes]);

  // El rango de horas sale de las reservas de la semana; sin reservas, 8:00–19:00.
  const { horaPrimera, horaUltima } = useMemo(() => {
    if (reservas.length === 0) return { horaPrimera: 8, horaUltima: 19 };
    const horas = reservas.map((r) => Number(r.startAt.slice(11, 13)));
    return {
      horaPrimera: Math.max(0, Math.min(...horas) - 1),
      horaUltima: Math.min(23, Math.max(...horas) + 1),
    };
  }, [reservas]);

  const horas = useMemo(() => {
    const lista: number[] = [];
    for (let h = horaPrimera; h <= horaUltima; h++) lista.push(h);
    return lista;
  }, [horaPrimera, horaUltima]);

  // índice: fecha -> hora -> reservas que empiezan esa hora.
  const porDiaHora = useMemo(() => {
    const idx = new Map<string, Map<number, Reserva[]>>();
    for (const r of reservas) {
      const fecha = r.startAt.slice(0, 10);
      const hora = Number(r.startAt.slice(11, 13));
      if (!idx.has(fecha)) idx.set(fecha, new Map());
      const delDia = idx.get(fecha)!;
      if (!delDia.has(hora)) delDia.set(hora, []);
      delDia.get(hora)!.push(r);
    }
    return idx;
  }, [reservas]);

  const colorDe = (spaceId: string) => espacios.find((e) => e.id === spaceId)?.color ?? '#94a3b8';

  return (
    <div className="tabla-scroll" tabIndex={0} aria-label="Agenda semanal, deslizá para ver todos los días">
      <div className="min-w-[70rem]">
        <div className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b border-slate-200">
          <div className="sticky left-0 z-10 bg-white" />
          {dias.map((fecha, i) => {
            const [, m, d] = fecha.split('-').map(Number);
            return (
              <div key={fecha} className="px-2 py-2 text-center">
                <p className="text-xs uppercase tracking-wide text-slate-500">{DIAS[(i + 1) % 7]}</p>
                <p className="text-sm font-semibold text-slate-800">
                  {d}/{m}
                </p>
              </div>
            );
          })}
        </div>

        {horas.map((hora) => (
          <div key={hora} className="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b border-slate-100">
            <div className="sticky left-0 z-10 bg-white px-2 py-1 text-right text-xs font-medium text-slate-400">
              {String(hora).padStart(2, '0')}:00
            </div>
            {dias.map((fecha) => {
              const deLaCelda = porDiaHora.get(fecha)?.get(hora) ?? [];
              const vacia = deLaCelda.length === 0;
              const reservar = () => abrirEnHora(fecha, `${String(hora).padStart(2, '0')}:00`);
              return (
                // Un div y no un botón: la celda puede contener fichas, y una
                // ficha dentro de un botón sería HTML inválido.
                <div
                  key={fecha}
                  role={vacia ? 'button' : undefined}
                  tabIndex={vacia ? 0 : undefined}
                  onClick={vacia ? reservar : undefined}
                  onKeyDown={
                    vacia
                      ? (ev) => {
                          if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            reservar();
                          }
                        }
                      : undefined
                  }
                  className={`min-h-10 border-l border-slate-100 p-1 text-left align-top ${
                    vacia ? 'cursor-pointer hover:bg-brand-50/60' : ''
                  }`}
                >
                  {deLaCelda.map((r) => {
                    const e = estadoDe(r.status, estados);
                    const cancelada = r.status === 'cancelled' || r.status === 'no_show';
                    return (
                      <span
                        key={r.id}
                        title={`${r.startAt.slice(11, 16)} · ${r.spaceName ?? 'Espacio'} · ${r.customerName ?? 'Sin cliente'} · ${e.texto}`}
                        className={`mb-0.5 block rounded px-1.5 py-0.5 text-xs text-white ${
                          cancelada ? 'opacity-50 line-through' : ''
                        }`}
                        style={{ background: colorDe(r.spaceId) }}
                      >
                        {r.startAt.slice(11, 16)} {r.spaceName ?? 'Espacio'}
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
        Deslizá para ver la semana completa. Tocá un hueco vacío para reservar a esa hora. El color de
        cada ficha es del espacio.
      </p>
    </div>
  );
}
