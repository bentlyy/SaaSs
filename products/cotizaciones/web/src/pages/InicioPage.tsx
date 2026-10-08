import { useEffect, useState } from 'react';
import { EsqueletoKpis, Kpis, Tabla, Tarjeta, api, dinero, numero, useApp } from '@amg/ui';
import type { AjustesCotizaciones, Cotizacion } from '../tipos';

interface Dashboard {
  total: number;
  porEstado: Record<string, number>;
  totalCents: number;
  mesCents: number;
  mes: string;
}

export function InicioPage() {
  const { settings } = useApp();
  const ajustes = (settings ?? null) as AjustesCotizaciones | null;
  const simbolo = ajustes?.currency ?? '$';

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[] | null>(null);

  async function cargar() {
    const [d, lista] = await Promise.all([
      api.get<Dashboard>('/dashboard'),
      api.get<{ items: Cotizacion[] }>('/quotes?limit=500'),
    ]);
    setDash(d);
    setCotizaciones(lista.items);
  }

  useEffect(() => {
    cargar().catch((e) => {
      if (e.vencida) return;
      console.error(e);
    });
  }, []);

  const abiertas = (cotizaciones ?? []).filter((c) => c.status === 'sent' || c.status === 'draft');

  const kpis = dash
    ? [
        { etiqueta: 'Cotizaciones', valor: numero(dash.total) },
        { etiqueta: 'Enviadas', valor: numero(dash.porEstado.sent ?? 0) },
        { etiqueta: 'Aceptadas', valor: numero(dash.porEstado.accepted ?? 0) },
        { etiqueta: `Del mes (${dash.mes})`, valor: dinero(dash.mesCents, { simbolo }), acento: true },
        { etiqueta: 'En la mesa', valor: dinero(dash.totalCents, { simbolo }) },
      ]
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Tarjeta>
        {!dash ? <EsqueletoKpis /> : <Kpis items={kpis} />}
      </Tarjeta>

      <Tarjeta titulo="Pendientes de respuesta">
        {cotizaciones === null && <div className="p-4 text-sm text-slate-500">Cargando...</div>}
        {cotizaciones !== null && abiertas.length === 0 && (
          <div className="p-4 text-sm text-slate-500">No hay cotizaciones pendientes.</div>
        )}
        {cotizaciones !== null && abiertas.length > 0 && (
          <Tabla
            columnas={[
              { titulo: '#', num: true },
              { titulo: 'Cliente' },
              { titulo: 'Estado' },
              { titulo: 'Total', num: true },
            ]}
          >
            {abiertas.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-600">#{c.number}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{c.customerName}</td>
                <td className="px-4 py-3 text-slate-600">{c.status === 'sent' ? 'Enviada' : 'Borrador'}</td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  {dinero(c.totalCents, { simbolo })}
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </div>
  );
}
