import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { Aviso, BotonPrimario, Campo, NotaError, PageHeader, Spinner, Tarjeta, api, useApp, useAviso } from '@amg/ui';
import type { AjustesCotizaciones } from '../tipos';

export function AjustesPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesCotizaciones | null;

  const [campos, setCampos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ajustes) {
      setCampos({
        currency: ajustes.currency ?? '$',
        timezone: ajustes.timezone ?? 'America/Santiago',
        defaultTaxRateBp: String(ajustes.defaultTaxRateBp ?? 0),
        validityDays: String(ajustes.validityDays ?? 30),
      });
    }
  }, [ajustes]);

  function alCambiar(ev: ChangeEvent<HTMLInputElement>) {
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));
  }

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.put('/settings', {
        currency: campos.currency || '$',
        timezone: campos.timezone || 'America/Santiago',
        defaultTaxRateBp: Number(campos.defaultTaxRateBp) || 0,
        validityDays: Number(campos.validityDays) || 30,
      });
      await recargarSettings();
      avisar('Ajustes guardados.');
    } catch (e: any) {
      if (e.vencida) return;
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {aviso && <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />}
      <PageHeader titulo="Ajustes" subtitulo="Preferencias de cotizaciones" />
      <Tarjeta>
        <form onSubmit={guardar} className="flex flex-col gap-6 max-w-lg">
          <Campo etiqueta="Moneda" name="currency" value={campos.currency} onChange={alCambiar} />
          <Campo etiqueta="Zona horaria" name="timezone" value={campos.timezone} onChange={alCambiar} />
          <Campo etiqueta="Impuesto por defecto (bp)" name="defaultTaxRateBp" value={campos.defaultTaxRateBp} onChange={alCambiar} type="number" />
          <Campo etiqueta="Días de vigencia por defecto" name="validityDays" value={campos.validityDays} onChange={alCambiar} type="number" />
          {error && <NotaError mensaje={error} />}
          <div className="flex gap-2">
            <BotonPrimario type="submit" disabled={guardando}>{guardando ? <Spinner /> : 'Guardar'}</BotonPrimario>
          </div>
          <p className="text-sm text-slate-500">
            Siguiente folio:{' '}
            <span className="font-medium text-slate-700">#{ajustes?.nextNumber ?? 1}</span>
          </p>
        </form>
      </Tarjeta>
    </div>
  );
}
