/** Formato de dinero, fechas e iniciales: el mismo camino en los productos. */

export interface OpcionesDinero {
  /** La moneda la elige la organización, no una constante. */
  simbolo?: string;
  /** Locale con que se leen los separadores. Por defecto es-CL (como el legacy). */
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Centavos -> "$1.500" o "$1.500,50" si se le piden decimales.
 *
 * El separador lo pone el navegador según el locale; los negativos salen con el
 * signo adelante (`-$500`), que es como se leen de un vistazo. Acepta el símbolo
 * como segundo argumento (`dinero(c, '$')`) o las opciones completas.
 */
export function dinero(centavos: number | null | undefined, opciones: string | OpcionesDinero = {}): string {
  const op: OpcionesDinero = typeof opciones === 'string' ? { simbolo: opciones } : opciones;
  const simbolo = op.simbolo ?? '$';
  const n = Number(centavos ?? 0);
  const signo = n < 0 ? '-' : '';
  const formato: Intl.NumberFormatOptions = { minimumFractionDigits: op.minimumFractionDigits ?? 0 };
  if (op.maximumFractionDigits !== undefined) formato.maximumFractionDigits = op.maximumFractionDigits;
  return `${signo}${simbolo}${(Math.abs(n) / 100).toLocaleString(op.locale ?? 'es-CL', formato)}`;
}

/**
 * Fecha ISO -> "12 oct 2026", con hora opcional ("12 oct 2026 13:30").
 *
 * `zona` es la zona IANA en que se quiere VER el instante, que no siempre es la
 * del navegador: un taller en Ciudad de México abre la agenda desde Santiago y
 * las 09:00 del taller no pueden aparecer como las 12:00. Sin `zona` manda la
 * del navegador.
 */
export function fecha(iso: string | null | undefined, conHora = false, zona?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const base: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  if (zona) base.timeZone = zona;
  const dia = d.toLocaleDateString('es-CL', base);
  if (!conHora) return dia;
  const reloj: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (zona) reloj.timeZone = zona;
  return `${dia} ${d.toLocaleTimeString('es-CL', reloj)}`;
}

/** Contador formateado: `numero(1500)` -> "1.500". */
export function numero(n: number | null | undefined, locale = 'es-CL'): string {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat(locale).format(n);
}

const RELLENO = /^(de|del|la|el|los|las|y|para|con)$/i;

/** "Deportes y Salud" -> "DS". Las palabras de relleno no cuentan. */
export function iniciales(nombre: string | null | undefined): string {
  const palabras = String(nombre ?? '')
    .trim()
    .split(/\s+/)
    .filter((p) => p && !RELLENO.test(p));
  if (palabras.length === 0) return '?';
  if (palabras.length === 1) return palabras[0].slice(0, 2).toUpperCase();
  return (palabras[0].charAt(0) + palabras[1].charAt(0)).toUpperCase();
}
