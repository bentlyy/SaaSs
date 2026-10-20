/**
 * Moneda del producto.
 *
 * `settings.currency` puede venir como codigo ISO (`CLP`, `USD`) o como el
 * simbolo suelto que se guardaba antes (`$`, `US$`). El PDF no puede imprimir
 * "CLP1.500": necesita el simbolo, y esta es la unica traduccion.
 */

const SIMBOLOS: Record<string, string> = {
  CLP: '$',
  USD: 'US$',
  EUR: '€',
  ARS: '$',
  MXN: '$',
  COP: '$',
  PEN: 'S/',
  UYU: '$U',
  PYG: 'Gs. ',
  BOB: 'Bs ',
  BRL: 'R$',
  CRC: 'CRC ',
  DOP: 'RD$',
  GTQ: 'Q',
  HNL: 'L',
  NIO: 'C$',
  PAB: 'B/.',
  VES: 'Bs. ',
};

export function simboloMoneda(valor: string | null | undefined): string {
  const v = String(valor ?? '').trim();
  if (!v) return '$';
  const codigo = v.replace(/\$$/, '').toUpperCase();
  return SIMBOLOS[codigo] ?? v;
}

/** Centavos -> "$1.500" o "$1.500,50" si el monto tiene decimales. */
export function formatearDinero(centavos: number | null | undefined, moneda: string | null | undefined): string {
  const n = Number(centavos ?? 0);
  const signo = n < 0 ? '-' : '';
  const numero = (Math.abs(n) / 100).toLocaleString('es-CL', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${signo}${simboloMoneda(moneda)}${numero}`;
}

/** "2026-10-19" -> "19 oct 2026" (sin hora: una cotizacion es de un dia). */
export function formatearFecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const fecha = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
