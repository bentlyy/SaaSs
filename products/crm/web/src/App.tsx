import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout, useApp } from '@amg/ui';
import { TableroPage } from './pages/TableroPage';
import { ClientesPage } from './pages/ClientesPage';
import { SeguimientosPage } from './pages/SeguimientosPage';
import { ContactosPage } from './pages/ContactosPage';
import { AjustesPage } from './pages/AjustesPage';

const ICONO_TABLERO = 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z';
const ICONO_CLIENTES = 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 1.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z';
const ICONO_SEGUIMIENTOS = 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z';
const ICONO_CONTACTOS = 'M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z';
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
        <p className="text-sm text-slate-400">¿Está corriendo el crm en :3020?</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        element={
          <Layout
            nombre="Clientes"
            subtitulo="Cartera y seguimiento"
            grupos={[
              {
                titulo: 'Cartera',
                items: [
                  { to: '/', label: 'Tablero', icono: ICONO_TABLERO },
                  { to: '/clientes', label: 'Clientes', icono: ICONO_CLIENTES },
                ],
              },
              {
                titulo: 'Seguimiento',
                items: [
                  { to: '/seguimientos', label: 'Seguimientos', icono: ICONO_SEGUIMIENTOS },
                  { to: '/contactos', label: 'Contactos', icono: ICONO_CONTACTOS },
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
        <Route path="/clientes" element={<ClientesPage />} />
        <Route path="/seguimientos" element={<SeguimientosPage />} />
        <Route path="/contactos" element={<ContactosPage />} />
        <Route path="/ajustes" element={<AjustesPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
