import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Aviso, BotonPrimario, Campo, PageHeader, Tarjeta, api, useApp, useAviso } from '@amg/ui';
import { aMinutos, minutosAHora } from '../horas';
import type { AjustesEspacios } from '../tipos';

/**
 * Ajustes de la organización: la jornada, la franja y la anticipación mínima.
 *
 * Los minutos del servidor se pintan como "HH:MM" y vuelven como minutos: el
 * input habla horas, la base guarda minutos desde medianoche, y esa traducción
 * ocurre acá y en ningún otro lado. El error del servidor (una jornada al
 * revés, una franja de cero) se muestra tal cual llega.
 */
export function AjustesPage() {
  const { settings, recargarSettings } = useApp();
  const { aviso, avisar, limpiarAviso } = useAviso();

  const ajustes = (settings ?? null) as AjustesEspacios | null;

  const [campos, setCampos] = useState({
    currency: '',
    timezone: '',
    apertura: '08:00',
    cierre: '22:00',
    franja: '60',
    anticipacion: '0',
  });
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!ajustes) return;
    setCampos({
      currency: ajustes.currency ?? '$',
      timezone: ajustes.timezone ?? 'America/Santiago',
      apertura: minutosAHora(ajustes.openingMinutes ?? 480),
      cierre: minutosAHora(ajustes.closingMinutes ?? 1320),
      franja: String(ajustes.slotMinutes ?? 60),
      anticipacion: String(ajustes.minAdvanceMinutes ?? 0),
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
        openingMinutes: aMinutos(campos.apertura),
        closingMinutes: aMinutos(campos.cierre),
        slotMinutes: Number(campos.franja),
        minAdvanceMinutes: Number(campos.anticipacion),
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
      <PageHeader titulo="Ajustes" subtitulo="Jornada y preferencias de la organización." />

      <Tarjeta titulo="Jornada" className="max-w-xl">
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
              placeholder="America/Santiago"
              value={campos.timezone}
              onChange={alCambiar}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Campo etiqueta="Abre" name="apertura" type="time" value={campos.apertura} onChange={alCambiar} />
            <Campo etiqueta="Cierra" name="cierre" type="time" value={campos.cierre} onChange={alCambiar} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Campo
              etiqueta="Franja de reserva (minutos)"
              name="franja"
              type="number"
              min={15}
              max={480}
              step={1}
              value={campos.franja}
              onChange={alCambiar}
            />
            <Campo
              etiqueta="Anticipación mínima (minutos)"
              name="anticipacion"
              type="number"
              min={0}
              max={43200}
              step={1}
              value={campos.anticipacion}
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
