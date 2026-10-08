/** Minutos desde medianoche, el idioma de la jornada, y sus formatos de pantalla. */

/** `Date.getUTCDay` y el servidor usan 0 = domingo. */
export const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Minutos desde medianoche -> "HH:MM", que es lo que acepta un
 * `<input type="time">`.
 *
 * El nombre no dice "ms" aunque parezca: no hay milisegundos en juego, y leer
 * `ms` y pensar en tiempo Unix es justo el error que hace que alguien escriba
 * `new Date(minutosAMs(...))` después.
 */
export const minutosAHora = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Una hora local "14:30" son los minutos desde medianoche. */
export function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/**
 * ISO -> valor de `<input type="datetime-local">`, que no entiende la "Z".
 *
 * Es el mismo truco del legacy: se pinta la hora tal cual viene del servidor y
 * al enviar vuelve a `new Date(valor).toISOString()`, redondeo completo.
 */
export const aDatetimeLocal = (iso: string) => iso.slice(0, 16);
