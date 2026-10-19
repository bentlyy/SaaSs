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

// ──────────────────────────────────────── rangos de la vista (fechas locales)

/**
 * Fechas "YYYY-MM-DD" del taller: la vista semanal/mensual navega por FECHAS
 * locales, no por instantes. Recién al cargar la agenda la fecha se convierte
 * a un rango UTC con `inicioDelDia`/`finDelDia`.
 */

/** "2026-10-07" + n días -> "2026-10-08". */
export function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/** El lunes de la semana que contiene `fecha` (0 = domingo como JS). */
export function inicioDeLaSemana(fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number);
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return sumarDias(fecha, -((dow + 6) % 7));
}

/** El primer día del mes que contiene `fecha`. */
export function inicioDelMes(fecha: string): string {
  return `${fecha.slice(0, 7)}-01`;
}

/** Cuántos días tiene el mes de `fecha`. */
export function diasDelMes(fecha: string): number {
  const [a, m] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

/** El primer día del mes siguiente. */
export function mesSiguiente(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

/** El primer día del mes anterior. */
export function mesAnterior(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number);
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
}

/** "Octubre", en minúscula según el locale, para el título del mes. */
export function nombreDelMes(fecha: string): string {
  const [a, m] = fecha.split('-').map(Number);
  const nombre = new Date(Date.UTC(a, m - 1, 1)).toLocaleDateString('es-CL', {
    month: 'long',
    timeZone: 'UTC',
  });
  return nombre.charAt(0).toUpperCase() + nombre.slice(1);
}