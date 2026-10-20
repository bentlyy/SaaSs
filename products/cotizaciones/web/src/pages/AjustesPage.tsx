import { useEffect, useState, type FormEvent, type ChangeEvent } from 'react';
import { Aviso, BotonPrimario, Campo, NotaError, PageHeader, Spinner, Tarjeta, api, useApp, useAviso } from '@amg/ui';
import type { AjustesCotizaciones } from '../tipos';

export function AjustesPage() {
  const { cuenta, settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();
  const admin = cuenta?.rol === 'admin' || cuenta?.rol === 'owner';

  const ajustes = (settings ?? null) as AjustesCotizaciones | null;

  const [campos, setCampos] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (ajustes) {
      setCampos({
        currency: ajustes.currency ?? '$',
        timezone: ajustes.timezone ?? 'America/Santiago',
        businessName: ajustes.businessName ?? '',
        businessTaxId: ajustes.businessTaxId ?? '',
        businessAddress: ajustes.businessAddress ?? '',
        businessPhone: ajustes.businessPhone ?? '',
        businessEmail: ajustes.businessEmail ?? '',
        // En la base se guardan puntos basicos; aca se muestra el porcentaje que
        // la persona escribe en el papel: 1900 bp -> 19 %.
        taxRatePct: String((ajustes.defaultTaxRateBp ?? 0) / 100),
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
        businessName: campos.businessName || null,
        businessTaxId: campos.businessTaxId || null,
        businessAddress: campos.businessAddress || null,
        businessPhone: campos.businessPhone || null,
        businessEmail: campos.businessEmail || null,
        defaultTaxRateBp: Math.round((Number(campos.taxRatePct) || 0) * 100),
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
          <h3 className="text-sm font-medium text-slate-700">Datos de la empresa</h3>
          <p className="text-sm text-slate-500">
            Es lo que sale impreso en el PDF de cada cotización. Si no cargas la razón social, se usa el nombre de
            tu organización.
          </p>
          <Campo etiqueta="Razón social" name="businessName" value={campos.businessName} onChange={alCambiar} readOnly={!admin} />
          <Campo etiqueta="RUT / ID fiscal" name="businessTaxId" value={campos.businessTaxId} onChange={alCambiar} readOnly={!admin} />
          <Campo etiqueta="Dirección" name="businessAddress" value={campos.businessAddress} onChange={alCambiar} readOnly={!admin} />
          <Campo etiqueta="Teléfono" name="businessPhone" value={campos.businessPhone} onChange={alCambiar} readOnly={!admin} />
          <Campo etiqueta="Email" name="businessEmail" value={campos.businessEmail} onChange={alCambiar} type="email" readOnly={!admin} />

          <h3 className="pt-2 text-sm font-medium text-slate-700">Cotizaciones</h3>
          <Campo etiqueta="Moneda (código ISO o símbolo)" name="currency" value={campos.currency} onChange={alCambiar} readOnly={!admin} />
          <Campo etiqueta="Zona horaria" name="timezone" value={campos.timezone} onChange={alCambiar} readOnly={!admin} />
          <Campo
            etiqueta="Impuesto por defecto (%)"
            name="taxRatePct"
            value={campos.taxRatePct}
            onChange={alCambiar}
            type="number"
            step="0.01"
            min="0"
            max="100"
            readOnly={!admin}
          />
          <Campo
            etiqueta="Días de vigencia por defecto"
            name="validityDays"
            value={campos.validityDays}
            onChange={alCambiar}
            type="number"
            min="1"
            readOnly={!admin}
          />
          {error && <NotaError mensaje={error} />}
          {admin ? (
            <div className="flex gap-2">
              <BotonPrimario type="submit" disabled={guardando}>
                {guardando ? <Spinner /> : 'Guardar'}
              </BotonPrimario>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Solo un administrador puede cambiar estos ajustes.</p>
          )}
          <p className="text-sm text-slate-500">
            Siguiente folio: <span className="font-medium text-slate-700">#{ajustes?.nextNumber ?? 1}</span>
          </p>
        </form>
      </Tarjeta>
    </div>
  );
}
