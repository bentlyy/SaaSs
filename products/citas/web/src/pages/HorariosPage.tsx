import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonChico,
  BotonPrimario,
  BotonSecundario,
  Campo,
  Caja,
  EsqueletoTabla,
  Etiqueta,
  NotaError,
  PageHeader,
  Select,
  Tabla,
  Tarjeta,
  Vacio,
  api,
  fecha,
  useAviso,
  useApp,
} from '@amg/ui';
import { DIAS, aMinutos, instanteEnZona, minutosAHora, partesDeDateTime, zonaSegura } from '../horas';
import type { Bloqueo, Horario, Profesional } from '../tipos';

/**
 * Días y franjas de atención de cada profesional.
 *
 * Si un día no tiene horario, atiende en la jornada general que pida la
 * consulta de disponibilidad; los bloqueos valen sobre cualquier horario.
 */
export function HorariosPage() {
  const { zona } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const z = zonaSegura(zona);

  const [profesionales, setProfesionales] = useState<Profesional[]>([]);
  const [profesionalId, setProfesionalId] = useState('');
  const [horarios, setHorarios] = useState<Horario[] | null>(null);
  const [bloqueos, setBloqueos] = useState<Bloqueo[] | null>(null);

  const [editando, setEditando] = useState<Horario | null>(null);
  const [horario, setHorario] = useState({ weekday: '1', active: 'true', desde: '09:00', hasta: '17:00' });
  const [errorHorario, setErrorHorario] = useState<string | null>(null);
  const [bloqueo, setBloqueo] = useState({ inicio: '', fin: '', motivo: '' });
  const [errorBloqueo, setErrorBloqueo] = useState<string | null>(null);

  const atajar = useCallback(
    (e: unknown) => {
      if ((e as { vencida?: boolean }).vencida) return;
      avisar((e as Error).message, true);
    },
    [avisar],
  );

  async function cargarProfesionales() {
    const { items } = await api.get<{ items: Profesional[] }>('/staff?limit=200');
    const lista = items ?? [];
    setProfesionales(lista);
    setProfesionalId((actual) => actual || lista[0]?.id || '');
  }

  const refrescar = useCallback(async () => {
    if (!profesionalId) {
      setHorarios(null);
      setBloqueos(null);
      return;
    }
    const [h, b] = await Promise.all([
      api.get<{ items: Horario[] }>(`/schedules?staffId=${profesionalId}`),
      api.get<{ items: Bloqueo[] }>(`/blocks?staffId=${profesionalId}`),
    ]);
    setHorarios(h.items ?? []);
    setBloqueos(b.items ?? []);
  }, [profesionalId]);

  useEffect(() => {
    cargarProfesionales().catch(atajar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refrescar().catch(atajar);
  }, [refrescar, atajar]);

  const alHorario = (ev: ChangeEvent<HTMLInputElement>) =>
    setHorario((h) => ({ ...h, [ev.target.name]: ev.target.value }));

  const alBloqueo = (ev: ChangeEvent<HTMLInputElement>) =>
    setBloqueo((b) => ({ ...b, [ev.target.name]: ev.target.value }));

  function editarHorario(h: Horario) {
    setEditando(h);
    setErrorHorario(null);
    setHorario({
      weekday: String(h.weekday),
      active: String(h.active),
      desde: minutosAHora(h.startTime),
      hasta: minutosAHora(h.endTime),
    });
  }

  function cancelarEdicion() {
    setEditando(null);
    setErrorHorario(null);
    setHorario({ weekday: '1', active: 'true', desde: '09:00', hasta: '17:00' });
  }

  async function guardarHorario(ev: FormEvent) {
    ev.preventDefault();
    if (!profesionalId) {
      setErrorHorario('Elige un profesional.');
      return;
    }
    const id = editando?.id;
    const cuerpo = {
      staffId: profesionalId,
      weekday: Number(horario.weekday),
      startTime: aMinutos(horario.desde),
      endTime: aMinutos(horario.hasta),
      active: horario.active === 'true',
    };
    try {
      if (id) await api.patch(`/schedules/${id}`, cuerpo);
      else await api.post('/schedules', cuerpo);
      cancelarEdicion();
      await refrescar();
      avisar(id ? 'Horario actualizado' : 'Horario guardado');
    } catch (e) {
      setErrorHorario((e as Error).message || 'No se pudo guardar el horario');
    }
  }

  async function borrarHorario(h: Horario) {
    try {
      await api.delete(`/schedules/${h.id}`);
      if (editando?.id === h.id) cancelarEdicion();
      await refrescar();
      avisar('Horario eliminado');
    } catch (e) {
      atajar(e);
    }
  }

  async function guardarBloqueo(ev: FormEvent) {
    ev.preventDefault();
    if (!profesionalId) {
      setErrorBloqueo('Elige un profesional.');
      return;
    }
    try {
      // `datetime-local` da "2026-10-07T15:00" sin zona: se interpreta en la
      // del taller, no en la del navegador.
      const [iF, iH] = partesDeDateTime(bloqueo.inicio);
      const [fF, fH] = partesDeDateTime(bloqueo.fin);
      await api.post('/blocks', {
        staffId: profesionalId,
        startAt: instanteEnZona(iF, iH, z).toISOString(),
        endAt: instanteEnZona(fF, fH, z).toISOString(),
        reason: bloqueo.motivo || null,
      });
      setBloqueo({ inicio: '', fin: '', motivo: '' });
      setErrorBloqueo(null);
      await refrescar();
      avisar('Bloqueo agregado');
    } catch (e) {
      setErrorBloqueo((e as Error).message || 'No se pudo bloquear');
    }
  }

  async function quitarBloqueo(b: Bloqueo) {
    try {
      await api.delete(`/blocks/${b.id}`);
      await refrescar();
      avisar('Bloqueo quitado');
    } catch (e) {
      atajar(e);
    }
  }

  const profesional = profesionales.find((p) => p.id === profesionalId);

  return (
    <>
      <PageHeader
        titulo="Horarios y bloqueos"
        subtitulo="Días y franjas por profesional, y bloqueos que valen sobre cualquier horario."
        acciones={
          <Select
            etiqueta="Profesional"
            value={profesionalId}
            onChange={(e) => setProfesionalId(e.target.value)}
            className="w-full sm:w-64"
          >
            {profesionales.length === 0 ? (
              <option value="">— sin profesionales cargados —</option>
            ) : null}
            <option value="">— elige un profesional —</option>
            {profesionales.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        }
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Tarjeta
          titulo="Horario semanal"
          nota="El que no tenga días aquí atiende en la jornada general que pida la consulta de disponibilidad."
        >
          {!profesionalId ? (
            <Vacio texto="Elige un profesional para ver sus horarios." />
          ) : !horarios ? (
            <EsqueletoTabla columnas={['Día', 'Desde', 'Hasta', 'Estado', '']} filas={4} />
          ) : horarios.length === 0 ? (
            <Vacio
              texto={`${profesional?.name ?? 'Este profesional'} atiende en la jornada general. Agrega un horario para cambiarle el día a la semana.`}
            />
          ) : (
            <Tabla columnas={['Día', 'Desde', 'Hasta', 'Estado', '']}>
              {horarios.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{DIAS[h.weekday]}</td>
                  <td className="px-4 py-3 text-slate-500">{minutosAHora(h.startTime)}</td>
                  <td className="px-4 py-3 text-slate-500">{minutosAHora(h.endTime)}</td>
                  <td className="px-4 py-3">
                    <Etiqueta texto={h.active ? 'Activo' : 'Inactivo'} tono={h.active ? 'ok' : 'neutro'} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <BotonChico onClick={() => editarHorario(h)}>Editar</BotonChico>
                      <BotonChico peligro onClick={() => borrarHorario(h)}>
                        Borrar
                      </BotonChico>
                    </div>
                  </td>
                </tr>
              ))}
            </Tabla>
          )}
        </Tarjeta>

        <div className="space-y-6">
          <Caja className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              {editando ? 'Editar horario' : 'Añadir horario'}
            </h3>
            <form onSubmit={guardarHorario} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Select etiqueta="Día" value={horario.weekday} onChange={(e) => setHorario((h) => ({ ...h, weekday: e.target.value }))}>
                  {DIAS.map((d, i) => (
                    <option key={d} value={String(i)}>
                      {d}
                    </option>
                  ))}
                </Select>
                <Select etiqueta="Estado" value={horario.active} onChange={(e) => setHorario((h) => ({ ...h, active: e.target.value }))}>
                  <option value="true">Activo</option>
                  <option value="false">Inactivo</option>
                </Select>
                <Campo etiqueta="Desde" name="desde" type="time" required value={horario.desde} onChange={alHorario} />
                <Campo etiqueta="Hasta" name="hasta" type="time" required value={horario.hasta} onChange={alHorario} />
              </div>
              <NotaError mensaje={errorHorario} />
              <div className="flex justify-end gap-2">
                {editando ? (
                  <BotonSecundario type="button" onClick={cancelarEdicion}>
                    Cancelar edición
                  </BotonSecundario>
                ) : null}
                <BotonPrimario type="submit">{editando ? 'Guardar cambios' : 'Guardar horario'}</BotonPrimario>
              </div>
            </form>
          </Caja>

          <Caja className="p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-900">Bloqueo puntual</h3>
            <form onSubmit={guardarBloqueo} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Empieza" name="inicio" type="datetime-local" required value={bloqueo.inicio} onChange={alBloqueo} />
                <Campo etiqueta="Termina" name="fin" type="datetime-local" required value={bloqueo.fin} onChange={alBloqueo} />
              </div>
              <Campo etiqueta="Motivo" name="motivo" maxLength={300} value={bloqueo.motivo} onChange={alBloqueo} />
              <NotaError mensaje={errorBloqueo} />
              <div className="flex justify-end">
                <BotonPrimario type="submit">Bloquear</BotonPrimario>
              </div>
            </form>
          </Caja>
        </div>
      </div>

      <Tarjeta titulo="Bloqueos" nota="Un bloqueo deja el rato inutilizable aunque el horario semanal diga lo contrario." className="mt-6">
        {!profesionalId ? (
          <Vacio texto="Elige un profesional para ver sus bloqueos." />
        ) : !bloqueos ? (
          <EsqueletoTabla columnas={['Empieza', 'Termina', 'Motivo', '']} filas={2} />
        ) : bloqueos.length === 0 ? (
          <Vacio texto="Sin bloqueos: el profesional atiende según su horario." />
        ) : (
          <Tabla columnas={['Empieza', 'Termina', 'Motivo', '']}>
            {bloqueos.map((b) => (
              <tr key={b.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">{fecha(b.startAt, true, z)}</td>
                <td className="px-4 py-3 text-slate-600">{fecha(b.endAt, true, z)}</td>
                <td className="px-4 py-3 text-slate-500">{b.reason ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end">
                    <BotonChico peligro onClick={() => quitarBloqueo(b)}>
                      Quitar
                    </BotonChico>
                  </div>
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}