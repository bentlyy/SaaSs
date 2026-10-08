import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, useApp } from '@amg/ui';
import { AgendaPage } from './pages/AgendaPage';
import { ClientesPage } from './pages/ClientesPage';
import { ServiciosPage } from './pages/ServiciosPage';
import { ProfesionalesPage } from './pages/ProfesionalesPage';
import { HorariosPage } from './pages/HorariosPage';
import { AvisosPage } from './pages/AvisosPage';
import { ConfiguracionPage } from './pages/ConfiguracionPage';

const ICONO_AGENDA = 'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM9 14H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2zm-8 4H7v-2h2v2zm4 0h-2v-2h2v2zm4 0h-2v-2h2v2z';
const ICONO_CLIENTES = 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V20h14v-3.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V20h6v-3.5c0-2.33-4.67-3.5-7-3.5z';
const ICONO_SERVICIOS = 'M14 6V4h-4v2h4zM4 8v11c0 .55.45 1 1 1h14c.55 0 1-.45 1-1V8c0-.55-.45-1-1-1H5c-.55 0-1 .45-1 1zm16-2c1.11 0 2 .89 2 2v11c0 1.11-.89 2-2 2H4c-1.11 0-2-.89-2-2V8c0-1.11.89-2 2-2h3V4c0-1.11.89-2 2-2h4c1.11 0 2 .89 2 2v2h3z';
const ICONO_PROF = 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z';
const ICONO_HORARIOS = 'M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z';
const ICONO_AVISOS = 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z';
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
        <p className="text-sm text-slate-400">¿Está corriendo el servicio de citas en :3021?</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            nombre="Citas"
            subtitulo="Agenda y reservas"
            grupos={[
              {
                titulo: 'Trabajo',
                items: [
                  { to: '/', label: 'Agenda', icono: ICONO_AGENDA },
                  { to: '/clientes', label: 'Clientes', icono: ICONO_CLIENTES },
                ],
              },
              {
                titulo: 'Catálogo',
                items: [
                  { to: '/servicios', label: 'Servicios', icono: ICONO_SERVICIOS },
                  { to: '/profesionales', label: 'Profesionales', icono: ICONO_PROF },
                ],
              },
              {
                titulo: 'Operación',
                items: [
                  { to: '/horarios', label: 'Horarios', icono: ICONO_HORARIOS },
                  { to: '/avisos', label: 'Avisos', icono: ICONO_AVISOS },
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
        <Route path="/" element={<AgendaPage />} />
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/servicios" element={<ServiciosPage />} />
        <Route path="/profesionales" element={<ProfesionalesPage />} />
        <Route path="/horarios" element={<HorariosPage />} />
        <Route path="/avisos" element={<AvisosPage />} />
        <Route path="/configuracion" element={<ConfiguracionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}