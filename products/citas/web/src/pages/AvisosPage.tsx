import { useEffect, useState } from 'react';
import {
  Aviso,
  Etiqueta,
  FilaVacia,
  PageHeader,
  Spinner,
  Tabla,
  Tarjeta,
  api,
  estadoDe,
  fecha,
  useAviso,
  useApp,
  type MapaEstados,
} from '@amg/ui';
import { zonaSegura } from '../horas';
import type { Recordatorio } from '../tipos';

const ESTADOS_AVISO: MapaEstados = {
  sent: { texto: 'Enviado', tono: 'ok' },
  failed: { texto: 'Falló', tono: 'malo' },
  pending: { texto: 'Pendiente', tono: 'aviso' },
};

/** Bitácora de intentos: un aviso fallido y su reintento aparecen los dos. */
export function AvisosPage() {
  const { zona } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const z = zonaSegura(zona);

  const [avisos, setAvisos] = useState<Recordatorio[] | null>(null);

  useEffect(() => {
    api
      .get<{ reminders: Recordatorio[] }>('/reminders?limit=100')
      .then((r) => setAvisos(r.reminders ?? []))
      .catch((e: unknown) => {
        if ((e as { vencida?: boolean }).vencida) return;
        avisar((e as Error).message, true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHeader
        titulo="Bitácora de avisos"
        subtitulo="Un aviso fallido y su reintento aparecen los dos."
      />

      <Tarjeta titulo="Avisos">
        {!avisos ? (
          <Spinner />
        ) : (
          <Tabla columnas={['Cuándo', 'Canal', 'Destino', 'Estado', 'Error']}>
            {avisos.length === 0 ? (
              <FilaVacia columnas={5} texto="Todavía no se mandó ningún aviso." />
            ) : (
              avisos.map((r) => {
                const e = estadoDe(r.status, ESTADOS_AVISO);
                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-600">{fecha(r.sentAt ?? r.createdAt, true, z)}</td>
                    <td className="px-4 py-3 text-slate-600">{r.channel}</td>
                    <td className="px-4 py-3 text-slate-600">{r.to ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Etiqueta texto={e.texto} tono={e.tono} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">{r.error ?? '—'}</td>
                  </tr>
                );
              })
            )}
          </Tabla>
        )}
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}