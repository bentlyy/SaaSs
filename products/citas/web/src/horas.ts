/**
 * La hora de la organización: la agenda vive en `settings.timezone`, no en la
 * del navegador. El servidor guarda UTC, así que "las 10:00 del jueves" son un
 * instante, y hay que armarlo en la zona del taller y no en la de quien está
 * mirando, o las citas se corren horas en pantalla.
 */

/** `Date.getUTCDay` y el servidor usan 0 = domingo. */
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Minutos desde medianoche -> "HH:MM", la forma de un `<input type="time">`. */
export const minutosAHora = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Una hora local "14:30" son los minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** ISO -> valor de `<input type="datetime-local">`, que no entiende la "Z". */
export const aDatetimeLocal = (iso: string) => iso.slice(0, 16);

/** La zona configurada, o UTC si todavía no llegó (o si alguien la dejó mala). */
export function zonaSegura(z?: string): string {
  if (!z) return 'UTC';
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: z });
    return z;
  } catch {
    return 'UTC';
  }
}

function numeroDe(tipo: Intl.DateTimeFormatPartTypes, partes: Intl.DateTimeFormatPart[]): number {
  return Number(partes.find((p) => p.type === tipo)?.value ?? 0);
}

/** Cuánto le falta a UTC para que en `z` sean las de `fecha`. En minutos. */
export function offsetZona(z: string, fecha: Date): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: z,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(fecha);
  const comoUtc = Date.UTC(
    numeroDe('year', partes),
    numeroDe('month', partes) - 1,
    numeroDe('day', partes),
    numeroDe('hour', partes) % 24,
    numeroDe('minute', partes),
    numeroDe('second', partes),
  );
  return (comoUtc - fecha.getTime()) / 60000;
}

/**
 * "2026-10-07" + "10:00" en la zona `z` -> `Date` del instante que corresponde.
 *
 * Se corrige dos veces porque el offset depende del propio instante que se está
 * calculando: en el cambio de hora de verano la primera cuenta se pasa por una
 * hora y la segunda ya cae del lado correcto.
 */
export function instanteEnZona(fecha: string, hora: string, z: string): Date {
  const [a, m, d] = fecha.split('-').map(Number);
  const [h, min] = hora.split(':').map(Number);
  const naive = Date.UTC(a, m - 1, d, h, min, 0);
  const primera = new Date(naive - offsetZona(z, new Date(naive)) * 60000);
  return new Date(naive - offsetZona(z, primera) * 60000);
}

/** Las 00:00 del `fecha` en la zona `z`. */
export const inicioDelDia = (fecha: string, z: string) => instanteEnZona(fecha, '00:00', z);

/** Las 23:59 del `fecha` en la zona `z`. */
export const finDelDia = (fecha: string, z: string) => instanteEnZona(fecha, '23:59', z);

/** La hora de un instante vista desde la zona `z`, para el eje de la agenda. */
export function horaEnZona(iso: string, z: string): string {
  return new Date(iso).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', timeZone: z });
}

/** La fecha de un instante vista desde la zona `z` ("2026-10-07"). */
export function fechaEnZona(iso: string, z: string): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: z,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  return `${numeroDe('year', p)}-${numeroDe('month', p)}-${numeroDe('day', p)}`;
}

/** El `fecha` de hoy en la zona `z`, que no siempre es el del navegador. */
export function hoyEnZona(z: string): string {
  return fechaEnZona(new Date().toISOString(), z);
}

/** "2026-10-07T15:00" de un `<input type="datetime-local">` -> ["2026-10-07", "15:00"]. */
export function partesDeDateTime(valor: string): [string, string] {
  const [fecha, hora = '00:00'] = String(valor).split('T');
  return [fecha, hora.slice(0, 5)];
}