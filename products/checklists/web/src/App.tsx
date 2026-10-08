import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, useApp } from '@amg/ui';
import { TableroPage } from './pages/TableroPage';
import { PlantillasPage } from './pages/PlantillasPage';
import { CorridasPage } from './pages/CorridasPage';
import { AjustesPage } from './pages/AjustesPage';

const ICONO_TABLERO = 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z';
const ICONO_PLANTILLAS = 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 2l5 5h-5V4zm1 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V8h10v4z';
const ICONO_CORRIDAS = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
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
        <p className="text-sm text-slate-400">¿Está corriendo el servicio de checklists en :3023?</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            nombre="Checklists"
            grupos={[
              {
                titulo: 'Inspecciones',
                items: [
                  { to: '/', label: 'Tablero', icono: ICONO_TABLERO },
                  { to: '/plantillas', label: 'Plantillas', icono: ICONO_PLANTILLAS },
                  { to: '/corridas', label: 'Corridas', icono: ICONO_CORRIDAS },
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
        <Route path="/plantillas" element={<PlantillasPage />} />
        <Route path="/corridas" element={<CorridasPage />} />
        <Route path="/ajustes" element={<AjustesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
