import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Aviso, BotonPrimario, Campo, PageHeader, Tarjeta, api, useApp, useAviso } from '@amg/ui';
import { ActivoDialog } from '../componentes/ActivoDialog';
import type { AjustesActivos } from '../tipos';

/**
 * Ajustes: moneda y zona horaria de la organización.
 *
 * La zona y la moneda son de la EMPRESA, no de la persona: leer es libre,
 * cambiar la configuración compartida es de admin, y si un member lo intenta
 * la API responde 403 con el que el aviso muestra tal cual. La pantalla no
 * esconde los campos por rol, igual que el legacy.
 */
export function AjustesPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesActivos | null;

  const [campos, setCampos] = useState({ currency: '', timezone: '' });
  const [dialogo, setDialogo] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Se rellena desde la API en cada recarga; el form es controlado para que un
  // error de guardado no borre lo que se escribió.
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
      <PageHeader
        titulo="Ajustes"
        subtitulo="Preferencias de activos"
        acciones={<BotonPrimario onClick={() => setDialogo(true)}>Nuevo activo</BotonPrimario>}
      />

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
              maxLength={64}
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

      {dialogo ? (
        <ActivoDialog activo={null} avisar={avisar} onCerrar={() => setDialogo(false)} onGuardado={() => {}} />
      ) : null}

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}
