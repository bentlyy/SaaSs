import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Aviso, BotonPrimario, Campo, PageHeader, Tarjeta, api, useApp, useAviso } from '@amg/ui';
import type { AjustesSolicitudes } from '../tipos';

/**
 * Ajustes de solicitudes: moneda y zona horaria.
 *
 * La razón social y los contactos se editan en AMG, no acá: están en el Core, y
 * duplicarlos sería garantizar que se desincronicen.
 *
 * El folio no es un ajuste editable: lo propone el servidor en cada consulta,
 * porque solo él ve las solicitudes de las otras organizaciones.
 */
export function AjustesPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesSolicitudes | null;

  const [campos, setCampos] = useState({ currency: '', timezone: '' });
  const [guardando, setGuardando] = useState(false);

  // Se rellena desde la API en cada recarga; el form es controlado para que un
  // error de guardado no borre lo que se escribió.
  useEffect(() => {
    if (!ajustes) return;
    setCampos({
      currency: ajustes.currency ?? '$',
      timezone: ajustes.timezone ?? '',
    });
  }, [ajustes]);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    try {
      await api.put('/settings', {
        currency: campos.currency.trim() || '$',
        timezone: campos.timezone.trim(),
      });
      await recargarSettings();
      avisar('Ajustes guardados');
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron guardar los ajustes', true);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader titulo="Ajustes" subtitulo="Preferencias de solicitudes" />

      <Tarjeta titulo="Ajustes" className="max-w-xl">
        <form onSubmit={guardar} className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Moneda"
              name="currency"
              maxLength={5}
              required
              value={campos.currency}
              onChange={alCambiar}
            />
            <Campo
              etiqueta="Zona horaria"
              name="timezone"
              maxLength={60}
              required
              value={campos.timezone}
              onChange={alCambiar}
            />
          </div>

          <div className="flex justify-end pt-2">
            <BotonPrimario type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar ajustes'}
            </BotonPrimario>
          </div>
        </form>
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
