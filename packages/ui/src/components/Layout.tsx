import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../lib/app';
import { iniciales } from '../lib/format';

export interface ItemNav {
  to: string;
  label: string;
  /** Path de un ícono Material (fill). Si falta, va un cuadrícula genérica. */
  icono?: string;
}

export interface GrupoNav {
  /** Rótulo sobre el grupo. Sin rótulo, los items van seguidos. */
  titulo?: string;
  items: ItemNav[];
}

const ICONO_DEFECTO = 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z';

export interface PropsLayout {
  /** Nombre del producto: "Inventario". */
  nombre: string;
  /** Línea corta bajo el nombre en la marca. */
  subtitulo?: string;
  /** Iniciales del logo. Si faltan, salen del nombre. */
  logo?: string;
  grupos: GrupoNav[];
  /** Oculta el enlace de salida (apps sin sesión central). */
  sinSalir?: boolean;
  /** Lo que el producto quiera agregar al pie del canal. */
  extrasPie?: ReactNode;
}

/**
 * El canal lateral y el marco de la página: lo que era el shell compartido de
 * los productos + el esqueleto de los `index.html`, ahora como componente.
 *
 * El canal trae la marca del producto, la navegación que declara cada pantalla,
 * las otras herramientas (desde `/api/inicio`) y el pie con la persona que
 * entró. En pantallas chicas se convierte en cajón con hamburguesa.
 */
export function Layout({ nombre, subtitulo, logo, grupos, sinSalir, extrasPie }: PropsLayout) {
  const { cuenta, zona, error } = useApp();
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    if (!abierto) return;
    const alEscapar = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', alEscapar);
    return () => document.removeEventListener('keydown', alEscapar);
  }, [abierto]);

  const usuario = cuenta?.usuario.nombre || cuenta?.usuario.email || '';
  const empresa = cuenta?.organizacion.nombre || cuenta?.organizacion.slug || '';
  const otras = (cuenta?.herramientas ?? []).filter((h) => h.slug !== cuenta?.herramienta);

  const cerrar = () => setAbierto(false);

  const navItem = (n: ItemNav) => (
    <NavLink
      key={n.to}
      to={n.to}
      onClick={cerrar}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`
      }
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
        <path d={n.icono ?? ICONO_DEFECTO} />
      </svg>
      {n.label}
    </NavLink>
  );

  return (
    <div className="min-h-screen">
      {abierto ? (
        <div className="fixed inset-0 z-20 bg-slate-900/40 lg:hidden" onClick={cerrar} aria-hidden="true" />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform lg:translate-x-0 ${
          abierto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-5 py-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            {logo ?? iniciales(nombre)}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-sm font-semibold text-slate-800">{nombre}</div>
            <div className="truncate text-[11px] text-slate-400">{subtitulo ?? empresa}</div>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label={`Secciones de ${nombre}`}>
          {grupos.map((g, i) => (
            <div key={g.titulo ?? i}>
              {g.titulo ? (
                <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  {g.titulo}
                </p>
              ) : (
                <div className="h-3" />
              )}
              {g.items.map(navItem)}
            </div>
          ))}

          {otras.length > 0 ? (
            <div>
              <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Mis otras herramientas
              </p>
              <div className="space-y-0.5">
                {otras.map((h) =>
                  h.url ? (
                    <a
                      key={h.slug}
                      href={h.url}
                      className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900"
                    >
                      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
                        <path d={ICONO_DEFECTO} />
                      </svg>
                      {h.name}
                    </a>
                  ) : (
                    <span key={h.slug} className="flex items-center gap-3 px-3 py-2 text-sm font-medium text-slate-400">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-current">
                        <path d={ICONO_DEFECTO} />
                      </svg>
                      {h.name}
                    </span>
                  ),
                )}
              </div>
            </div>
          ) : null}
        </nav>

        <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
              {cuenta ? iniciales(usuario) : '–'}
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-medium text-slate-600">{cuenta ? usuario : 'Cargando…'}</div>
              <div className="truncate">{cuenta?.usuario.email ?? ''}</div>
            </div>
          </div>
          {zona ? <div className="mt-1.5 text-[11px]">Zona: {zona}</div> : null}
          {extrasPie}
          {!sinSalir ? (
            <a href="/auth/logout" className="mt-2 inline-flex font-medium text-slate-500 hover:text-slate-700">
              Cerrar sesión
            </a>
          ) : null}
        </div>
      </aside>

      <main className="lg:pl-60">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 lg:hidden">
          <button
            type="button"
            onClick={() => setAbierto(true)}
            aria-label="Abrir navegación"
            aria-expanded={abierto}
            className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-slate-800">{nombre}</span>
        </header>

        <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
          {error && !cuenta ? (
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              No se pudo cargar la cuenta: {error}
            </div>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
