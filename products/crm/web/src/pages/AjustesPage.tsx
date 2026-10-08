import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Aviso, BotonPrimario, Campo, PageHeader, Tarjeta, api, useApp, useAviso } from '@amg/ui';
import type { AjustesCrm } from '../tipos';

/**
 * Ajustes de la organización: moneda y zona horaria.
 *
 * La zona horaria no es cosmética: el "hoy" del tablero la usa, así que el
 * PUT es de admin en la API. Acá no se filtra nada en el navegador: se manda y
 * el error del servidor (403 para un miembro) es el que se muestra.
 */
export function AjustesPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesCrm | null;

  const [campos, setCampos] = useState({ currency: '', timezone: '' });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!ajustes) return;
    setCampos({
      currency: ajustes.currency ?? '$',
      timezone: ajustes.timezone ?? 'America/Santiago',
    });
  }, [ajustes]);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    try {
      await api.put('/settings', {
        currency: campos.currency,
        timezone: campos.timezone,
      });
      await recargarSettings();
      avisar('Ajustes guardados');
    } catch (e) {
      avisar((e as Error).message, true);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader titulo="Ajustes" />

      <Tarjeta titulo="Ajustes" className="max-w-xl">
        <form onSubmit={guardar} className="space-y-4 p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Campo
              etiqueta="Moneda"
              name="currency"
              maxLength={5}
              value={campos.currency}
              onChange={alCambiar}
            />
            <Campo
              etiqueta="Zona horaria"
              name="timezone"
              maxLength={64}
              value={campos.timezone}
              onChange={alCambiar}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">
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
