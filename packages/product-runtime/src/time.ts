import { z } from 'zod';

/**
 * Zona horaria y hora local.
 *
 * Casi todos los productos de AMG cubren citas, con `settings.timezone` decides
 * en que zona vive la agenda. Dos cosas se necesitan para que eso sea cierto:
 *
 *   - que la zona sea REAL. Un `z.string().max(60)` acepta "Marte/Olympus", y
 *     una agenda con una zona que no existe no lanza error al guardarla: falla
 *     despues, cuando algo la usa para formatear una hora, y el mensaje dice
 *     "Invalid time zone" en vez de decir cual campo esta mal.
 *   - traducir un instante a la hora local de esa zona, para decidir si una
 *     reserva cae dentro del horario de atencion. Comparar contra la hora UTC es
 *     el error clasico: una cancha que abre a las 09:00 en Santiago abre a las
 *     14:00 UTC, y un dia de horario se vuelve indistinguible de otro.
 */

/** ¿Es un nombre de zona IANA que la plataforma sabe resolver? */
export function esZonaValida(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !valor.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: valor });
    return true;
  } catch {
    return false;
  }
}

/**
 * Schema de `settings.timezone` para todos los productos.
 *
 * El mensaje dice que la zona no existe, no "formato invalido": el usuario que
 * escribe "America/Santiago" bien escrito no lo va a escribir, y el que escribe
 * "Chile" necesita saber cual de las dos formas se acepta.
 */
export const zonaHoraria = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine(esZonaValida, { message: 'No es una zona horaria válida (usá una como America/Santiago)' });

const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Como se ve un instante en una zona, en piezas sueltas. */
export interface Local {
  year: number;
  month: number;
  day: number;
  /** 0 = domingo, como `weekday` en las tablas de disponibilidad. */
  weekday: number;
  /** Minutos desde la medianoche LOCAL. */
  minutes: number;
}

/**
 * Las piezas locales de un instante en una zona.
 *
 * `hour12: false` con `hour: '2-digit'` es el unico combo que no produce "24"
 * para medianoche en algunos runtimes, asi que se pide `hourCycle: 'h23'`.
 */
export function localDe(iso: string, zona: string): Local {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date(iso));

  const get = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((p) => p.type === tipo)?.value ?? '0';

  const weekday = Math.max(0, (DIAS as readonly string[]).indexOf(get('weekday')));
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** "14:30", para los mensajes de error que se leen en la pantalla. */
export function hhmm(minutos: number): string {
  const h = Math.floor(minutos / 60) % 24;
  const m = minutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}