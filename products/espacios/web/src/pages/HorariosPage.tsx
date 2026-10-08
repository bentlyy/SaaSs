import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Campo,
  Etiqueta,
  FilaVacia,
  NotaError,
  PageHeader,
  Select,
  Spinner,
  Tabla,
  Tarjeta,
  Vacio,
  api,
  fecha,
  useAviso,
} from '@amg/ui';
import { DIAS, aMinutos, minutosAHora } from '../horas';
import type { Bloqueo, Espacio, Horario } from '../tipos';

interface FormHorario {
  id: string;
  weekday: string;
  desde: string;
  hasta: string;
  activo: boolean;
}

const HORARIO_VACIO: FormHorario = { id: '', weekday: '1', desde: '09:00', hasta: '12:00', activo: true };

/**
 * Horario semanal de cada espacio y bloqueos puntuales.
 *
 * Sin horario propio el día cae a la jornada general de la organización, así
 * que "no hay fila" no es un vacío que haya que cubrir: la tabla lo dice con
 * una fila propia en vez de dejar la celda muda.
 */
export function HorariosPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [espacios, setEspacios] = useState<Espacio[] | null>(null);
  const [espacioSel, setEspacioSel] = useState('');
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [bloqueos, setBloqueos] = useState<Bloqueo[] | null>(null);

  const [form, setForm] = useState<FormHorario>(HORARIO_VACIO);
  const [errorHorario, setErrorHorario] = useState<string | null>(null);
  const [bloqueo, setBloqueo] = useState({ inicio: '', fin: '', motivo: '' });
  const [errorBloqueo, setErrorBloqueo] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ items: Espacio[] }>('/spaces?limit=500')
      .then((l) => setEspacios(l.items))
      .catch((e) => {
        if ((e as { vencida?: boolean }).vencida) return;
        avisar((e as Error).message, true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cargarHorarios() {
    if (!espacioSel) {
      setHorarios([]);
      setBloqueos([]);
      return;
    }
    const [h, b] = await Promise.all([
      api.get<{ items: Horario[] }>(`/schedules?spaceId=${espacioSel}`),
      api.get<{ items: Bloqueo[] }>(`/blocks?spaceId=${espacioSel}`),
    ]);
    setHorarios(h.items);
    setBloqueos(b.items);
  }

  useEffect(() => {
    setForm(HORARIO_VACIO);
    setErrorHorario(null);
    cargarHorarios().catch((e) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [espacioSel]);

  const alCambiarHorario = (ev: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [ev.target.name]: ev.target.value }));

  const alCambiarBloqueo = (ev: ChangeEvent<HTMLInputElement>) =>
    setBloqueo((b) => ({ ...b, [ev.target.name]: ev.target.value }));

  async function guardarHorario(ev: FormEvent) {
    ev.preventDefault();
    if (!espacioSel) {
      avisar('Elige un espacio', true);
      return;
    }
    setErrorHorario(null);
    const cuerpo = {
      spaceId: espacioSel,
      weekday: Number(form.weekday),
      startTime: aMinutos(form.desde),
      endTime: aMinutos(form.hasta),
      active: form.activo,
    };
    try {
      if (form.id) {
        await api.patch(`/schedules/${form.id}`, cuerpo);
        avisar('Horario actualizado');
      } else {
        await api.post('/schedules', cuerpo);
        avisar('Horario agregado');
      }
      setForm(HORARIO_VACIO);
      await cargarHorarios();
    } catch (e) {
      // El 409 del servidor es el de dos rangos que se pisan el mismo día: la
      // pantalla no vuelve a calcular la superposición, lo dice el backend.
      setErrorHorario((e as Error).message);
    }
  }

  async function alternarActivo(h: Horario) {
    try {
      await api.patch(`/schedules/${h.id}`, { active: !h.active });
      avisar(`Horario ${h.active ? 'desactivado' : 'activado'}`);
      await cargarHorarios();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function borrarHorario(h: Horario) {
    try {
      await api.delete(`/schedules/${h.id}`);
      avisar('Horario borrado');
      if (form.id === h.id) setForm(HORARIO_VACIO);
      await cargarHorarios();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  async function guardarBloqueo(ev: FormEvent) {
    ev.preventDefault();
    if (!espacioSel) {
      avisar('Elige un espacio', true);
      return;
    }
    setErrorBloqueo(null);
    try {
      await api.post('/blocks', {
        spaceId: espacioSel,
        startAt: new Date(bloqueo.inicio).toISOString(),
        endAt: new Date(bloqueo.fin).toISOString(),
        reason: bloqueo.motivo || null,
      });
      setBloqueo({ inicio: '', fin: '', motivo: '' });
      avisar('Espacio bloqueado');
      await cargarHorarios();
    } catch (e) {
      setErrorBloqueo((e as Error).message);
    }
  }

  async function quitarBloqueo(b: Bloqueo) {
    try {
      await api.delete(`/blocks/${b.id}`);
      avisar('Bloqueo quitado');
      await cargarHorarios();
    } catch (e) {
      avisar((e as Error).message, true);
    }
  }

  return (
    <>
      <PageHeader
        titulo="Horarios"
        subtitulo="La semana de cada espacio; sin horario propio manda la jornada general."
      />

      <Tarjeta titulo="Espacio">
        <div className="p-4">
          <Select
            etiqueta="Elegí un espacio"
            value={espacioSel}
            onChange={(e) => setEspacioSel(e.target.value)}
          >
            <option value="">Elige un espacio</option>
            {(espacios ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </div>
      </Tarjeta>

      {!espacioSel ? (
        <Tarjeta className="mt-6">
          <Vacio texto="Elige un espacio para ver sus horarios." />
        </Tarjeta>
      ) : horarios === null || bloqueos === null ? (
        <Spinner />
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Tarjeta titulo="Horarios de la semana">
              <Tabla columnas={['Día', 'Desde', 'Hasta', 'Estado', 'Acciones']}>
                {horarios.length === 0 ? (
                  <FilaVacia columnas={5} texto="Sin horario propio ese espacio: cae a la jornada general." />
                ) : (
                  horarios.map((h) => (
                    <tr key={h.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{DIAS[h.weekday]}</td>
                      <td className="px-4 py-3 text-slate-500">{minutosAHora(h.startTime)}</td>
                      <td className="px-4 py-3 text-slate-500">{minutosAHora(h.endTime)}</td>
                      <td className="px-4 py-3">
                        <Etiqueta texto={h.active ? 'Activo' : 'Inactivo'} tono={h.active ? 'ok' : 'neutro'} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <BotonChico onClick={() => alternarActivo(h)}>
                            {h.active ? 'Desactivar' : 'Activar'}
                          </BotonChico>
                          <BotonChico
                            onClick={() => {
                              setErrorHorario(null);
                              setForm({
                                id: h.id,
                                weekday: String(h.weekday),
                                desde: minutosAHora(h.startTime),
                                hasta: minutosAHora(h.endTime),
                                activo: h.active,
                              });
                            }}
                          >
                            Editar
                          </BotonChico>
                          <BotonChico peligro onClick={() => borrarHorario(h)}>
                            Borrar
                          </BotonChico>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </Tabla>
            </Tarjeta>

            <div className="space-y-6">
              <Tarjeta titulo={form.id ? 'Editar horario' : 'Nuevo horario'}>
                <form onSubmit={guardarHorario} className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Select etiqueta="Día" name="weekday" value={form.weekday} onChange={alCambiarHorario}>
                      {DIAS.map((d, i) => (
                        <option key={d} value={String(i)}>
                          {d}
                        </option>
                      ))}
                    </Select>
                    <Campo etiqueta="Desde" name="desde" type="time" value={form.desde} onChange={alCambiarHorario} />
                    <Campo etiqueta="Hasta" name="hasta" type="time" value={form.hasta} onChange={alCambiarHorario} />
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={form.activo}
                      onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                    />
                    Activo
                  </label>
                  <NotaError mensaje={errorHorario} />
                  <div className="flex justify-end gap-2">
                    {form.id ? (
                      <BotonSecundario type="button" onClick={() => setForm(HORARIO_VACIO)}>
                        Cancelar
                      </BotonSecundario>
                    ) : null}
                    <BotonPrimario type="submit">Guardar</BotonPrimario>
                  </div>
                </form>
              </Tarjeta>

              <Tarjeta titulo="Bloqueo puntual" nota="Un rato concreto en que no se puede reservar">
                <form onSubmit={guardarBloqueo} className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Campo
                      etiqueta="Empieza"
                      name="inicio"
                      type="datetime-local"
                      required
                      value={bloqueo.inicio}
                      onChange={alCambiarBloqueo}
                    />
                    <Campo
                      etiqueta="Termina"
                      name="fin"
                      type="datetime-local"
                      required
                      value={bloqueo.fin}
                      onChange={alCambiarBloqueo}
                    />
                  </div>
                  <Campo
                    etiqueta="Motivo"
                    name="motivo"
                    maxLength={300}
                    placeholder="Mantención, reunión…"
                    value={bloqueo.motivo}
                    onChange={alCambiarBloqueo}
                  />
                  <NotaError mensaje={errorBloqueo} />
                  <div className="flex justify-end">
                    <BotonPrimario type="submit">Bloquear</BotonPrimario>
                  </div>
                </form>
              </Tarjeta>
            </div>
          </div>

          <Tarjeta titulo="Bloqueos" className="mt-6">
            <Tabla columnas={['Empieza', 'Termina', 'Motivo', 'Acciones']}>
              {bloqueos.length === 0 ? (
                <FilaVacia columnas={4} texto="Sin bloqueos." />
              ) : (
                bloqueos.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-800">{fecha(b.startAt, true)}</td>
                    <td className="px-4 py-3 text-slate-800">{fecha(b.endAt, true)}</td>
                    <td className="px-4 py-3 text-slate-500">{b.reason ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <BotonChico peligro onClick={() => quitarBloqueo(b)}>
                          Quitar
                        </BotonChico>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </Tabla>
          </Tarjeta>
        </>
      )}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
