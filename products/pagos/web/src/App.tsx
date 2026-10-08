import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, useApp } from '@amg/ui';
import { TableroPage } from './pages/TableroPage';
import { CobrosPage } from './pages/CobrosPage';
import { AntiguedadPage } from './pages/AntiguedadPage';
import { AjustesPage } from './pages/AjustesPage';

const ICONO_TABLERO = 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z';
const ICONO_COBROS = 'M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 0 1 6 12c0-3.31 2.69-6 6-6zm6.76 1.74L17.3 9.2c.44.84.7 1.8.7 2.8 0 3.31-2.69 6-6 6v-3l-4 4 4 4v-3c4.42 0 8-3.58 8-8 0-1.57-.46-3.03-1.24-4.26z';
const ICONO_REPORTE = 'M3 5h2V3H3v2zm0 4h2V3H3v2zm0 4h2V3H3v2zm0 4h2v-2H3v2zm4-8h14V3H7v2zm0 4h14V3H7v2zm0 4h14V3H7v2zm0 4h14v-2H7v2z';
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
        <p className="text-sm text-slate-400">¿Está corriendo el servicio de pagos en :3024?</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            nombre="Control de Pagos"
            subtitulo="Cartera por cobrar"
            grupos={[
              {
                titulo: 'Cartera',
                items: [
                  { to: '/', label: 'Tablero', icono: ICONO_TABLERO },
                  { to: '/cobros', label: 'Cobros', icono: ICONO_COBROS },
                  { to: '/reporte', label: 'Antigüedad', icono: ICONO_REPORTE },
                ],
              },
              {
                titulo: 'Configuración',
                items: [{ to: '/ajustes', label: 'Ajustes', icono: ICONO_AJUSTES }],
              },
            ]}
          />
        }
      >
        <Route path="/" element={<TableroPage />} />
        <Route path="/cobros" element={<CobrosPage />} />
        <Route path="/reporte" element={<AntiguedadPage />} />
        <Route path="/ajustes" element={<AjustesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}