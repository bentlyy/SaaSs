import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  Aviso,
  BotonPrimario,
  Campo,
  NotaError,
  PageHeader,
  Tarjeta,
  api,
  useAviso,
  useApp,
} from '@amg/ui';
import type { AjustesCitas } from '../tipos';

/**
 * La zona (y la moneda) del taller.
 *
 * La razón social y los contactos se editan en AMG, no acá: están en el Core,
 * y duplicarlos sería garantizar que se desincronicen.
 */
export function ConfiguracionPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const [campos, setCampos] = useState<Record<string, string>>({});
  const [email, setEmail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const alCambiar = (ev: ChangeEvent<HTMLInputElement>) =>
    setCampos((c) => ({ ...c, [ev.target.name]: ev.target.value }));

  useEffect(() => {
    const s = settings as Partial<AjustesCitas> | null | undefined;
    setCampos({
      timezone: String(s?.timezone ?? ''),
      currency: String(s?.currency ?? ''),
      reminderHours: String(s?.reminderHours ?? 12),
    });
    setEmail(Boolean(s?.emailEnabled));
  }, [settings]);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      await api.put('/settings', {
        timezone: campos.timezone,
        currency: campos.currency,
        reminderHours: Number(campos.reminderHours || 0),
        emailEnabled: email,
      });
      await recargarSettings();
      avisar('Ajustes guardados');
    } catch (e) {
      setError((e as Error).message || 'No se pudieron guardar los ajustes');
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <PageHeader titulo="Configuración" subtitulo="La agenda vive en la zona horaria y la moneda del taller." />

      <Tarjeta titulo="Preferencias" className="max-w-2xl">
        <form onSubmit={guardar} className="space-y-3 p-4">
          <p className="text-xs text-slate-500">
            La razón social y los contactos se editan en AMG, no acá: están en el Core, y duplicarlos
            sería garantizar que se desincronicen.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Zona horaria" name="timezone" maxLength={60} required value={campos.timezone ?? ''} onChange={alCambiar} />
            <Campo etiqueta="Símbolo de moneda" name="currency" maxLength={5} required value={campos.currency ?? ''} onChange={alCambiar} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Avisar con cuántas horas de anticipación" name="reminderHours" type="number" min={0} max={720} required value={campos.reminderHours ?? ''} onChange={alCambiar} />
            <label className="flex cursor-pointer items-center gap-2 pt-6 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={email}
                onChange={(e) => setEmail(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 accent-brand-600"
              />
              Enviar avisos por correo
            </label>
          </div>
          <NotaError mensaje={error} />
          <div className="flex justify-end pt-1">
            <BotonPrimario type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </BotonPrimario>
          </div>
        </form>
      </Tarjeta>

      <Aviso mensaje={aviso?.mensaje ?? null} tono={aviso?.tono} onLimpiar={limpiarAviso} />
    </>
  );
}