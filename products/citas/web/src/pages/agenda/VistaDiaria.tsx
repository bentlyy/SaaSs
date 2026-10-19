import { BotonChico, Etiqueta, FilaVacia, Tabla, dinero, estadoDe, type MapaEstados } from '@amg/ui';
import { horaEnZona } from '../../horas';
import type { Cita, EstadoCita } from '../../tipos';

interface Props {
  citas: Cita[];
  z: string;
  moneda: string;
  estados: MapaEstados;
  buscar: string;
  verDetalle: (citaId: string) => void;
  abrirReprogramar: (cita: Cita) => void;
  cambiarEstado: (cita: Cita, estado: EstadoCita, mensaje: string) => void;
}

/**
 * Las citas de un día: tabla en pantalla grande, tarjetas en el celular.
 *
 * La tabla con seis columnas en un teléfono queda apretada e ilegible, así que
 * en `sm` para abajo se lista en tarjetas con la misma información y las
 * mismas acciones. Es un solo componente porque duplicar la lógica de botones
 * en dos archivos es pedir que se desincronicen.
 */
export function VistaDiaria({
  citas,
  z,
  moneda,
  estados,
  buscar,
  verDetalle,
  abrirReprogramar,
  cambiarEstado,
}: Props) {
  function accionesDe(c: Cita) {
    return (
      <>
        <BotonChico onClick={() => verDetalle(c.id)}>Ver</BotonChico>
        <BotonChico onClick={() => abrirReprogramar(c)}>Reprogramar</BotonChico>
        {c.status !== 'done' ? (
          <BotonChico onClick={() => cambiarEstado(c, 'done', 'Cita realizada')}>Completar</BotonChico>
        ) : null}
        {c.status !== 'cancelled' && c.status !== 'no_show' ? (
          <BotonChico peligro onClick={() => cambiarEstado(c, 'cancelled', 'Cita cancelada')}>
            Cancelar
          </BotonChico>
        ) : null}
      </>
    );
  }

  if (citas.length === 0) {
    const texto = buscar ? 'Nadie coincide con la búsqueda' : 'No hay citas para este día.';
    return (
      <>
        <p className="py-6 text-center text-sm text-slate-500 sm:hidden">{texto}</p>
        <div className="hidden sm:block">
          <Tabla columnas={['Hora', 'Cliente', 'Profesional', 'Estado', { titulo: 'Total', num: true }, '']}>
            <FilaVacia columnas={6} texto={texto} />
          </Tabla>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Móvil: tarjetas. Cada una con hora, gente, estado y acciones. */}
      <ul className="space-y-2 sm:hidden">
        {citas.map((c) => {
          const e = estadoDe(c.status, estados);
          return (
            <li key={c.id} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-800">
                  {horaEnZona(c.startAt, z)}–{horaEnZona(c.endAt, z)}
                </span>
                <Etiqueta texto={e.texto} tono={e.tono} />
              </div>
              <p className="mt-1 text-sm text-slate-700">{c.customerName ?? 'Sin cliente'}</p>
              <p className="text-xs text-slate-500">
                {c.staffName ?? 'Sin profesional'} · {dinero(c.totalCents, moneda)}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">{accionesDe(c)}</div>
            </li>
          );
        })}
      </ul>

      {/* Escritorio: la tabla de siempre. */}
      <div className="hidden sm:block">
        <Tabla columnas={['Hora', 'Cliente', 'Profesional', 'Estado', { titulo: 'Total', num: true }, '']}>
          {citas.map((c) => {
            const e = estadoDe(c.status, estados);
            return (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {horaEnZona(c.startAt, z)}–{horaEnZona(c.endAt, z)}
                </td>
                <td className="px-4 py-3 text-slate-600">{c.customerName ?? 'Sin cliente'}</td>
                <td className="px-4 py-3 text-slate-600">{c.staffName ?? 'Sin profesional'}</td>
                <td className="px-4 py-3">
                  <Etiqueta texto={e.texto} tono={e.tono} />
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{dinero(c.totalCents, moneda)}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">{accionesDe(c)}</div>
                </td>
              </tr>
            );
          })}
        </Tabla>
      </div>
    </>
  );
}
