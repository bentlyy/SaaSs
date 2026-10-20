/**
 * Moneda de cotizaciones.
 *
 * `settings.currency` guarda el codigo ISO (`CLP`, `USD`) o, en organizaciones
 * viejas, el simbolo suelto. La UI necesita el simbolo para pintar importes, no
 * el codigo: `dinero()` no traduce `CLP`.
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
  PYG: 'Gs.',
  BOB: 'Bs',
  BRL: 'R$',
  CRC: '₡',
  DOP: 'RD$',
  GTQ: 'Q',
  HNL: 'L',
  NIO: 'C$',
  PAB: 'B/.',
  VES: 'Bs.',
};

export function simboloMoneda(valor: string | null | undefined): string {
  const v = String(valor ?? '').trim();
  if (!v) return '$';
  const codigo = v.replace(/\$$/, '').toUpperCase();
  return SIMBOLOS[codigo] ?? v;
}

/** Texto en unidades -> centavos, aceptando coma decimal. */
export function aCentavos(valor: string | number | null | undefined): number {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centavos -> texto editable en unidades, sin ceros de sobra. */
export function desdeCentavos(centavos: number | null | undefined): string {
  const n = Number(centavos ?? 0);
  return Number.isFinite(n) ? String(n / 100) : '0';
}

/** "2026-10-19" -> "19-10-2026", sin pasar por la zona del navegador. */
export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [anio, mes, dia] = iso.split('-');
  return anio && mes && dia ? `${dia}-${mes}-${anio}` : iso;
}

/** Puntos basicos -> "19%" (o "19,5%"), sin decimales de sobra. */
export function porcentaje(bp: number | null | undefined): string {
  const valor = Number(bp ?? 0) / 100;
  return `${Number.isInteger(valor) ? valor : valor.toFixed(2).replace('.', ',')}%`;
}
