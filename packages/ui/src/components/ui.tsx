import { useCallback, useEffect, useState, type ReactNode } from 'react';

/* ── encabezado ──────────────────────────────────────────────────────── */

export function PageHeader({ titulo, subtitulo, acciones }: { titulo: string; subtitulo?: string; acciones?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{titulo}</h1>
        {subtitulo ? <p className="mt-1 text-sm text-slate-500">{subtitulo}</p> : null}
      </div>
      {acciones ? <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div> : null}
    </div>
  );
}

/* ── botones ─────────────────────────────────────────────────────────── */

export function BotonPrimario({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function BotonSecundario({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function BotonPeligro({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3.5 py-2 text-sm font-medium text-red-600 shadow-sm transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * Botón de fila: chico y discreto a propósito. En una tabla el botón compite
 * con el dato de al lado, y si grita la tabla deja de leerse como tabla.
 */
export function BotonChico({
  children,
  peligro = false,
  ...rest
}: { peligro?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        peligro ? 'text-red-600 hover:bg-red-50' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

/** Buscador de barra superior. El filtrado lo hace quien lo usa. */
export function Buscador({
  valor,
  onChange,
  placeholder,
  className = '',
}: {
  valor: string;
  onChange: (valor: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="search"
      value={valor}
      placeholder={placeholder}
      autoComplete="off"
      onChange={(e) => onChange(e.target.value)}
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 sm:w-60 ${className}`}
    />
  );
}

/* ── contenedores ────────────────────────────────────────────────────── */

export function Caja({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

/** Caja con cabecera (título + nota opcional + acciones a la derecha). */
export function Tarjeta({
  titulo,
  nota,
  acciones,
  children,
  className = '',
}: {
  titulo?: string;
  nota?: ReactNode;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Caja className={className}>
      {titulo ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{titulo}</h2>
            {nota ? <span className="text-xs text-slate-400">{nota}</span> : null}
          </div>
          {acciones ? <div className="flex items-center gap-2">{acciones}</div> : null}
        </div>
      ) : null}
      {children}
    </Caja>
  );
}

/* ── tablas ──────────────────────────────────────────────────────────── */

/** Texto de columna, o texto con `num` para alinearlo a la derecha. */
export type Columna = string | { titulo: string; num?: boolean };

export function Tabla({ columnas, children }: { columnas: Columna[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            {columnas.map((c, i) => {
              const titulo = typeof c === 'string' ? c : c.titulo;
              const num = typeof c === 'string' ? false : !!c.num;
              return (
                <th key={`${titulo}-${i}`} className={`px-4 py-2.5 font-semibold ${num ? 'text-right' : ''}`}>
                  {titulo}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/** La fila de una tabla sin resultados, con el texto centrado en todo el ancho. */
export function FilaVacia({ columnas, texto }: { columnas: number; texto: string }) {
  return (
    <tr>
      <td colSpan={columnas}>
        <Vacio texto={texto} />
      </td>
    </tr>
  );
}

export function Vacio({ icono, texto }: { icono?: string; texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icono ? (
        <svg viewBox="0 0 24 24" className="h-8 w-8 text-slate-300">
          <path fill="currentColor" d={icono} />
        </svg>
      ) : null}
      <p className="text-sm text-slate-400">{texto}</p>
    </div>
  );
}

/* ── indicadores ─────────────────────────────────────────────────────── */

export interface Kpi {
  /** Rótulo de la tarjeta. */
  etiqueta: string;
  /** La cifra grande. `null`/`undefined` pinta "—". */
  valor?: string | number | null;
  /** Pinta la cifra en el color de marca: es lo único que pide acción. */
  acento?: boolean;
  nota?: string;
}

/** Las tarjetas de arriba. Antes eran `[etiqueta, valor, acento, nota]`. */
export function Kpis({ items }: { items: Kpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((k, i) => (
        <div key={`${k.etiqueta}-${i}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className={`text-2xl font-semibold tracking-tight ${k.acento ? 'text-brand-600' : 'text-slate-900'}`}>
            {k.valor ?? '—'}
          </div>
          <div className="mt-1 text-xs font-medium uppercase tracking-wide text-slate-400">{k.etiqueta}</div>
          {k.nota ? <div className="mt-1 text-xs text-slate-400">{k.nota}</div> : null}
        </div>
      ))}
    </div>
  );
}

export function Spinner({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      {texto}
    </div>
  );
}

/** Esqueleto de las tarjetas de arriba: da la altura desde el primer segundo. */
export function EsqueletoKpis({ cuantos = 4 }: { cuantos?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: cuantos }, (_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="h-7 w-20 animate-pulse rounded bg-slate-100" />
          <div className="mt-2 h-3 w-28 animate-pulse rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

/** Esqueleto de tabla completa, con la misma forma que la tabla real. */
export function EsqueletoTabla({ columnas, filas = 3 }: { columnas: Columna[]; filas?: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            {columnas.map((c, i) => (
              <th key={i} className="px-4 py-2.5 font-semibold">
                {typeof c === 'string' ? c : c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {Array.from({ length: filas }, (_, f) => (
            <tr key={f}>
              {columnas.map((_, c) => (
                <td key={c} className="px-4 py-3">
                  <div className="h-3.5 animate-pulse rounded bg-slate-100" style={{ width: c % 3 === 1 ? '4rem' : '7rem' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── estados ─────────────────────────────────────────────────────────── */

export type Tono = 'ok' | 'aviso' | 'malo' | 'acento' | 'neutro';

const TONOS: Record<Tono, string> = {
  ok: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  aviso: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  malo: 'bg-red-50 text-red-600 ring-red-600/20',
  acento: 'bg-brand-50 text-brand-700 ring-brand-600/20',
  neutro: 'bg-slate-50 text-slate-600 ring-slate-500/20',
};

export function Etiqueta({ texto, tono = 'neutro' }: { texto: string; tono?: Tono }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${TONOS[tono]}`}
    >
      {texto}
    </span>
  );
}

/** Mapa de estados de un producto: `{ pago: 'Pagado', borrador: {…} }`. */
export type MapaEstados = Record<string, string | { texto: string; tono: Tono }>;

/**
 * Traduce el estado crudo del servidor a la etiqueta que se ve. El mapa es del
 * producto (sus estados son suyos); lo que es de todos es la forma.
 */
export function estadoDe(clave: string, mapa: MapaEstados): { texto: string; tono: Tono } {
  const info = mapa[clave];
  if (info == null) return { texto: clave, tono: 'neutro' };
  return typeof info === 'string' ? { texto: info, tono: 'neutro' } : info;
}

/* ── avisos ──────────────────────────────────────────────────────────── */

/**
 * El aviso de una operación: mensaje breve arriba, que se va solo a los 5
 * segundos. Se empareja con `useAviso`, que es quien lo apaga.
 */
export function Aviso({
  mensaje,
  tono = 'ok',
  onLimpiar,
}: {
  mensaje: string | null;
  tono?: 'ok' | 'malo';
  onLimpiar?: () => void;
}) {
  if (!mensaje) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-50 flex justify-center sm:inset-x-auto sm:right-4">
      <div
        className={`pointer-events-auto flex max-w-md items-start gap-3 rounded-lg px-4 py-2.5 text-sm shadow-lg ring-1 ${
          tono === 'malo' ? 'bg-red-50 text-red-700 ring-red-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
        }`}
      >
        <span>{mensaje}</span>
        {onLimpiar ? (
          <button onClick={onLimpiar} aria-label="Cerrar aviso" className="shrink-0 opacity-60 hover:opacity-100">
            ✕
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Estado del aviso, con auto-apagado a los 5 segundos (como el legacy). */
export function useAviso() {
  const [aviso, setAviso] = useState<{ mensaje: string; tono: 'ok' | 'malo' } | null>(null);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const avisar = useCallback((mensaje: string, malo = false) => {
    setAviso({ mensaje, tono: malo ? 'malo' : 'ok' });
  }, []);

  return { aviso, avisar, limpiarAviso: useCallback(() => setAviso(null), []) };
}

/* ── formularios ─────────────────────────────────────────────────────── */

export function Campo({ etiqueta, ...rest }: { etiqueta: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <input
        {...rest}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </label>
  );
}

export function Textarea({ etiqueta, ...rest }: { etiqueta: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <textarea
        {...rest}
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </label>
  );
}

export function Select({ etiqueta, children, ...rest }: { etiqueta: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{etiqueta}</span>
      <select
        {...rest}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      >
        {children}
      </select>
    </label>
  );
}

export function NotaError({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{mensaje}</div>;
}

export function Alerta({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{mensaje}</div>
  );
}

/* ── modal ───────────────────────────────────────────────────────────── */

export function Modal({
  titulo,
  cerrable = true,
  onCerrar,
  children,
  ancho = 'max-w-lg',
}: {
  titulo: string;
  cerrable?: boolean;
  onCerrar: () => void;
  children: ReactNode;
  ancho?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center">
      <div className={`my-8 w-full ${ancho} rounded-xl bg-white shadow-2xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
          <h3 className="text-base font-semibold text-slate-900">{titulo}</h3>
          {cerrable ? (
            <button
              onClick={onCerrar}
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="Cerrar"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
