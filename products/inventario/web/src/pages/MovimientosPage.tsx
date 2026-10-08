import { useEffect, useState } from 'react';
import { Aviso, Etiqueta, FilaVacia, PageHeader, Spinner, Tabla, Tarjeta, api, fecha, numero, useAviso } from '@amg/ui';
import type { Movimiento } from '../tipos';

/** Los últimos 40 movimientos: quién movió qué, cuándo y por qué. */
export function MovimientosPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();
  const [movimientos, setMovimientos] = useState<Movimiento[] | null>(null);

  useEffect(() => {
    api
      .get<{ movements: Movimiento[] }>('/movements?limit=40')
      .then((r) => setMovimientos(r.movements))
      .catch((e) => {
        if (!e.vencida) avisar(e.message, true);
      });
  }, [avisar]);

  return (
    <>
      <PageHeader titulo="Movimientos" subtitulo="Historial de cambios de stock" />

      <Tarjeta titulo="Movimientos" nota="Los 40 más recientes">
        {!movimientos ? (
          <Spinner />
        ) : (
          <Tabla columnas={[{ titulo: 'Delta', num: true }, 'Artículo', 'Motivo', 'Quién', 'Cuándo']}>
            {movimientos.length === 0 ? (
              <FilaVacia columnas={5} texto="Sin movimientos todavía." />
            ) : (
              movimientos.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-right">
                    <Etiqueta
                      texto={`${m.delta > 0 ? '+' : ''}${numero(m.delta)}`}
                      tono={m.delta > 0 ? 'ok' : 'malo'}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-800">{m.itemName || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{m.reason}</td>
                  <td className="px-4 py-3 text-slate-500">{m.actorName || '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{fecha(m.createdAt, true)}</td>
                </tr>
              ))
            )}
          </Tabla>
        )}
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
