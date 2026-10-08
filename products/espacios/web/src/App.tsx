import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, useApp } from '@amg/ui';
import { AgendaPage } from './pages/AgendaPage';
import { EspaciosPage } from './pages/EspaciosPage';
import { HorariosPage } from './pages/HorariosPage';
import { ClientesPage } from './pages/ClientesPage';
import { ExtrasPage } from './pages/ExtrasPage';
import { AjustesPage } from './pages/AjustesPage';

const ICONO_AGENDA = 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z';
const ICONO_ESPACIOS = 'M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z';
const ICONO_HORARIOS = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z';
const ICONO_CLIENTES = 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
const ICONO_EXTRAS = 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4H7v-2h4V7h2v4h4v2z';
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
        <p className="text-sm text-slate-400">¿Está corriendo espacios en :3022?</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            nombre="Espacios"
            subtitulo="Reservas por hora"
            grupos={[
              {
                titulo: 'Reservas',
                items: [
                  { to: '/', label: 'Agenda', icono: ICONO_AGENDA },
                  { to: '/espacios', label: 'Espacios', icono: ICONO_ESPACIOS },
                  { to: '/horarios', label: 'Horarios', icono: ICONO_HORARIOS },
                ],
              },
              {
                titulo: 'Catálogo',
                items: [
                  { to: '/clientes', label: 'Clientes', icono: ICONO_CLIENTES },
                  { to: '/extras', label: 'Extras', icono: ICONO_EXTRAS },
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
        <Route path="/" element={<AgendaPage />} />
        <Route path="/espacios" element={<EspaciosPage />} />
        <Route path="/horarios" element={<HorariosPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/extras" element={<ExtrasPage />} />
        <Route path="/ajustes" element={<AjustesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
