import { useEffect, useState } from 'react';
import { Aviso, BotonPrimario, Campo, PageHeader, Spinner, Tarjeta, api, useAviso, useApp } from '@amg/ui';

export function AjustesPage() {
  const { aviso, avisar, limpiarAviso } = useAviso();
  const { settings, recargarSettings } = useApp();
  const [carga, setCarga] = useState(true);
  const [currency, setCurrency] = useState('$');
  const [timezone, setTimezone] = useState('America/Santiago');

  useEffect(() => {
    if (settings) {
      setCurrency(String(settings.currency ?? '$'));
      setTimezone(String(settings.timezone ?? 'America/Santiago'));
      setCarga(false);
    }
  }, [settings]);

  async function guardar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    try {
      await api.put('/settings', { currency, timezone });
      await recargarSettings();
      avisar('Ajustes guardados');
    } catch (err) {
      avisar((err as Error).message, true);
    }
  }

  if (carga && !settings) return <Spinner />;

  return (
    <>
      <PageHeader titulo="Ajustes" />

      <Tarjeta titulo="Configuración">
        <form id="config-form" onSubmit={guardar} className="max-w-md space-y-4 p-4">
          <Campo etiqueta="Moneda" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
          <Campo etiqueta="Zona horaria" name="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          <div>
            <BotonPrimario type="submit">Guardar ajustes</BotonPrimario>
          </div>
        </form>
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
