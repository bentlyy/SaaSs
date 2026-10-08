import { useEffect, useState } from 'react';
import {
  Aviso,
  EsqueletoKpis,
  Vacio,
  Kpis,
  PageHeader,
  Spinner,
  Tarjeta,
  api,
  fecha,
  numero,
  useAviso,
} from '@amg/ui';
import type { Cliente, Contacto, Seguimiento } from '../tipos';

interface TableroData {
  hoy: string;
  seguimientos: {
    vencidos: Seguimiento[];
    hoy: Seguimiento[];
    proximos: Seguimiento[];
  };
  cumpleanos: Array<{ id: string; name: string; birthday: string | null }>;
  contactos: Contacto[];
}

interface ResumenData {
  total: number;
  activos: number;
  archivados: number;
  seguimientos: {
    total: number;
    porEstado: Record<string, number>;
    vencidos: number;
    paraHoy: number;
  };
  contactos30d: number;
}

const ETIQUETA_CONTACTO: Record<string, string> = {
  llamada: 'Llamada',
  correo: 'Correo',
  visita: 'Visita',
  nota: 'Nota',
};

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
function fechaCorta(fechaIso?: string | null): string {
  if (!fechaIso) return '';
  const [, mes, dia] = fechaIso.split('-');
  return `${dia}/${mes}`;
}

/** La nota de una fila del tablero: `Cliente · DD/MM`, sin huecos. */
function notaSeguimiento(s: Seguimiento): string {
  return [s.customerName ?? '', fechaCorta(s.dueDate)].filter(Boolean).join(' · ');
}

/**
 * El tablero: los números de arriba y lo que hay que hacer.
 *
 * El "hoy" lo calcula el servidor en la zona horaria de la empresa; la pantalla
 * solo pinta las fechas que llegan (`dueDate`, `birthday`) y nunca el `hoy` de
 * esta maquina.
 */
export function TableroPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [tablero, setTablero] = useState<TableroData | null>(null);
  const [clientes, setClientes] = useState<Cliente[] | null>(null);
  const [clienteSel, setClienteSel] = useState<string>('');

  useEffect(() => {
    const t = setTimeout(() => {
      Promise.all([
        api.get<ResumenData>('/resumen'),
        api.get<TableroData>(clienteSel ? `/tablero?customerId=${encodeURIComponent(clienteSel)}` : '/tablero'),
        api.get<{ items: Cliente[] }>('/customers?limit=500'),
      ])
        .then(([r, t2, cl]) => {
          setResumen(r);
          setTablero(t2);
          setClientes(cl.items);
        })
        .catch((e) => {
          if ((e as any).vencida) return;
          avisar((e as Error).message, true);
        });
    }, clienteSel ? 150 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSel]);

  const kpis = resumen
    ? [
        { etiqueta: 'Clientes activos', valor: numero(resumen.activos), acento: true },
        { etiqueta: 'Archivados', valor: numero(resumen.archivados) },
        { etiqueta: 'Pendientes', valor: numero(resumen.seguimientos.porEstado.pending) },
        { etiqueta: 'Vencidos', valor: numero(resumen.seguimientos.vencidos) },
        { etiqueta: 'Para hoy', valor: numero(resumen.seguimientos.paraHoy) },
        { etiqueta: 'Contactos (30 días)', valor: numero(resumen.contactos30d) },
      ]
    : [];

  const nada = 'Nada por acá';

  const lista = (items: Seguimiento[]) =>
    items.length === 0 ? (
      <Vacio texto={nada} />
    ) : (
      <ul className="divide-y divide-slate-100">
        {items.map((s) => (
          <li key={s.id} className="flex flex-col gap-0.5 px-4 py-2.5">
            <span className="text-sm font-medium text-slate-800">{s.title}</span>
            <span className="text-xs text-slate-400">{notaSeguimiento(s)}</span>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader titulo="Tablero" />

      {resumen ? <Kpis items={kpis} /> : <EsqueletoKpis cuantos={6} />}

      <Tarjeta titulo="Filtrar por cliente" className="mt-6">
        <div className="p-4">
          <select
            className="w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            value={clienteSel}
            onChange={(e) => setClienteSel(e.target.value)}
          >
            <option value="">Todos los clientes</option>
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </Tarjeta>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Tarjeta titulo="Vencidos">{!tablero ? <Spinner /> : lista(tablero.seguimientos.vencidos)}</Tarjeta>
        <Tarjeta titulo="Para hoy">{!tablero ? <Spinner /> : lista(tablero.seguimientos.hoy)}</Tarjeta>
        <Tarjeta titulo="Próximos">{!tablero ? <Spinner /> : lista(tablero.seguimientos.proximos)}</Tarjeta>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Tarjeta titulo="Cumpleaños del mes">
          {!tablero ? (
            <Spinner />
          ) : tablero.cumpleanos.length === 0 ? (
            <Vacio texto={nada} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {tablero.cumpleanos.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm font-medium text-slate-800">{c.name}</span>
                  <span className="text-xs text-slate-400">{fechaCorta(c.birthday)}</span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Últimos contactos">
          {!tablero ? (
            <Spinner />
          ) : tablero.contactos.length === 0 ? (
            <Vacio texto={nada} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {tablero.contactos.map((c) => (
                <li key={c.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <span className="text-sm font-medium text-slate-800">{c.customerName ?? ''}</span>
                  <span className="text-xs text-slate-400">
                    {ETIQUETA_CONTACTO[c.kind] ?? c.kind}: {c.summary} · {fecha(c.happenedAt, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
