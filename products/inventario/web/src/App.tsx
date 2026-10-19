import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, Spinner, useApp } from '@amg/ui';
import { ArticulosPage } from './pages/ArticulosPage';
import { MovimientosPage } from './pages/MovimientosPage';
import { CategoriasPage } from './pages/CategoriasPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';

// El escáner trae el decodificador de códigos de barras (~250 kB), que no hace
// falta para ver el catálogo. Cargándolo aparte, quien nunca escanea no lo baja.
const EscanerPage = lazy(() => import('./pages/EscanerPage').then((m) => ({ default: m.EscanerPage })));

const ICONO_ALMACEN = 'M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z';
const ICONO_ESCANER = 'M9.5 6.5v3h-3v-3h3M11 5H5v6h6V5zm-1.5 9.5v3h-3v-3h3M11 13H5v6h6v-6zm6.5-6.5v3h-3v-3h3M19 5h-6v6h6V5zm-6 8h1.5v1.5H13V13zm1.5 1.5H16V16h-1.5v-1.5zM16 13h1.5v1.5H16V13zm-3 3h1.5v1.5H13V16zm1.5 1.5H16V19h-1.5v-1.5zM16 16h1.5v1.5H16V16zm1.5-1.5H19V16h-1.5v-1.5zM19 19h-1.5v-1.5H19V19zM19 16h-1.5v-1.5H19V16z';
const ICONO_MOVIMIENTOS = 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z';
const ICONO_CATEGORIAS = 'M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z';
const ICONO_AJUSTES = 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';

export function App() {
  const { carga, error } = useApp();

  if (carga) {
    return <div className="flex h-screen items-center justify-center text-slate-500">Cargando…</div>;
  }

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-2 text-slate-600">
        <p className="text-lg font-medium">No se pudo conectar con el backend</p>
        <p className="text-sm text-slate-400">{error}</p>
        <p className="text-sm text-slate-400">¿Está corriendo el inventario en :3023?</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            nombre="Inventario"
            subtitulo="Panel de almacén"
            grupos={[
              {
                titulo: 'Almacén',
                items: [
                  { to: '/', label: 'Artículos', icono: ICONO_ALMACEN },
                  { to: '/escaner', label: 'Escáner', icono: ICONO_ESCANER },
                  { to: '/movimientos', label: 'Movimientos', icono: ICONO_MOVIMIENTOS },
                  { to: '/categorias', label: 'Categorías', icono: ICONO_CATEGORIAS },
                ],
              },
              {
                titulo: 'Configuración',
                items: [{ to: '/configuracion', label: 'Ajustes', icono: ICONO_AJUSTES }],
              },
            ]}
          />
        }
      >
        <Route path="/" element={<ArticulosPage />} />
        <Route
          path="/escaner"
          element={
            <Suspense fallback={<Spinner />}>
              <EscanerPage />
            </Suspense>
          }
        />
        <Route path="/movimientos" element={<MovimientosPage />} />
        <Route path="/categorias" element={<CategoriasPage />} />
        <Route path="/configuracion" element={<ConfiguracionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
