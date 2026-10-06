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

/**
 * Cuanto le falta a UTC para que en `zona` sean las `instante`.
 *
 * Positivo si la zona va adelante de UTC. Se calcula pasando el instante por
 * `localDe` y restando: el horario de verano hace que esto NO sea constante, y
 * por eso hay que recalcular sobre el resultado (ver `inicioDelDiaEnZona`).
 */
export function offsetMinutos(zona: string, instante: number | string): number {
  const ms = typeof instante === 'number' ? instante : Date.parse(instante);
  const l = localDe(new Date(ms).toISOString(), zona);
  const comoUtc = Date.UTC(l.year, l.month - 1, l.day, 0, l.minutes);
  return Math.round((comoUtc - ms) / 60000);
}

/**
 * Las 00:00 de un día, en una zona, como instante UTC.
 *
 * Un día de la agenda son 24 horas que empiezan a una hora distinta según la
 * zona: la medianoche de Mexico City es las 06:00 UTC. Comparar contra la
 * medianoche UTC mete las citas de la madrugada del taller en el día anterior.
 *
 * El offset se calcula dos veces porque depende del propio instante que se está
 * resolviendo: en el cambio de horario de verano la primera cuenta cae del lado
 * equivocado y la segunda ya acierta.
 */
export function inicioDelDiaEnZona(zona: string, dias = 0, desde?: string): string {
  const hoy = desde ? localDe(desde, zona) : localDe(new Date().toISOString(), zona);
  const falso = Date.UTC(hoy.year, hoy.month - 1, hoy.day + dias);
  const primera = new Date(falso - offsetMinutos(zona, falso) * 60000);
  return new Date(falso - offsetMinutos(zona, primera.getTime()) * 60000).toISOString();
}

/** El día de la agenda, en una zona, desde un instante. "YYYY-MM-DD". */
export function diaEnZona(zona: string, instante: string): string {
  const l = localDe(instante, zona);
  return `${l.year}-${String(l.month).padStart(2, '0')}-${String(l.day).padStart(2, '0')}`;
}

/** La hora de un instante en una zona, en minutos desde la medianoche. */
export function minutosEnZona(zona: string, instante: string): number {
  return localDe(instante, zona).minutes;
}