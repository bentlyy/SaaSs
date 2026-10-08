import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Ajustes, Inicio } from './tipos';

interface CtxApp {
  /** Quién entró, de qué empresa y a qué herramientas puede saltar. */
  cuenta: Inicio | null;
  settings: Ajustes | null;
  /** Zona IANA de la organización, si la tiene configurada. */
  zona?: string;
  carga: boolean;
  error: string | null;
  recargarSettings: () => Promise<void>;
  recargarCuenta: () => Promise<void>;
}

const Ctx = createContext<CtxApp>({
  cuenta: null,
  settings: null,
  zona: undefined,
  carga: true,
  error: null,
  recargarSettings: async () => {},
  recargarCuenta: async () => {},
});

/** `GET /api/settings`: algunos productos lo devuelven envuelto, otros no. */
async function ajustesPorDefecto(): Promise<Ajustes> {
  const r = await api.get<unknown>('/settings');
  if (r && typeof r === 'object' && 'settings' in r) {
    const adentro = (r as { settings?: unknown }).settings;
    if (adentro && typeof adentro === 'object') return adentro as Ajustes;
  }
  return r as Ajustes;
}

export interface PropsAppProvider {
  children: ReactNode;
  /**
   * Cómo cargar la cuenta. Por defecto: `GET /api/inicio` del runtime, que
   * trae usuario, organización, rol y herramientas en una sola llamada. La app
   * de citas no tiene ese endpoint y pasa su propio cargador (`desdeMe`).
   */
  cargarCuenta?: () => Promise<Inicio>;
  /** Cómo cargar los ajustes. Por defecto: `GET /api/settings`. */
  cargarAjustes?: () => Promise<Ajustes>;
}

export function AppProvider({ children, cargarCuenta, cargarAjustes }: PropsAppProvider) {
  const [cuenta, setCuenta] = useState<Inicio | null>(null);
  const [settings, setSettings] = useState<Ajustes | null>(null);
  const [carga, setCarga] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Los cargadores viven en un ref y no en las dependencias del efecto: un
  // producto puede pasar `cargarCuenta` inline en el JSX, y esa identidad nueva
  // en cada render re-dispararia la carga en bucle. El ref toma el ultimo valor
  // y el efecto de arranque corre una sola vez.
  const cargadores = useRef({ cargarCuenta, cargarAjustes });
  cargadores.current = { cargarCuenta, cargarAjustes };

  const cuentaPorDefecto = useCallback(() => api.get<Inicio>('/inicio'), []);

  const recargarCuenta = useCallback(async () => {
    try {
      const cargaCuenta = cargadores.current.cargarCuenta ?? cuentaPorDefecto;
      setCuenta(await cargaCuenta());
    } catch (e) {
      // Sesión vencida: ya hubo salto al login, pintar un error encima solo
      // mete ruido en una página que se está cerrando.
      if (e instanceof ApiError && e.vencida) return;
      setError(e instanceof Error ? e.message : 'No se pudo cargar la cuenta');
    }
  }, [cuentaPorDefecto]);

  const recargarSettings = useCallback(async () => {
    try {
      const cargaAjustes = cargadores.current.cargarAjustes ?? ajustesPorDefecto;
      setSettings(await cargaAjustes());
    } catch (e) {
      if (e instanceof ApiError && e.vencida) return;
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los ajustes');
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    (async () => {
      await Promise.all([recargarCuenta(), recargarSettings()]);
      if (vivo) setCarga(false);
    })();
    return () => {
      vivo = false;
    };
  }, [recargarCuenta, recargarSettings]);

  return (
    <Ctx.Provider
      value={{
        cuenta,
        settings,
        zona: settings?.timezone,
        carga,
        error,
        recargarSettings,
        recargarCuenta,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp(): CtxApp {
  return useContext(Ctx);
}

/**
 * Normaliza `GET /api/me` del runtime a la forma del shell.
 *
 * Existe para la app de citas aislada, que no monta el `inicio` del monorepo:
 * su `/api/me` trae la misma información con otros nombres de campo, y acá se
 * traduce una sola vez en vez de en cada página.
 */
export function desdeMe(me: {
  user: { id?: string; email: string; name: string };
  organization: { id?: string; slug: string };
  role?: string;
  product?: string;
}): Inicio {
  return {
    usuario: { id: me.user.id, nombre: me.user.name, email: me.user.email },
    organizacion: { id: me.organization.id, slug: me.organization.slug },
    rol: me.role,
    herramienta: me.product,
    herramientas: [],
  };
}
