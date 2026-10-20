/**
 * Monedas del inventario.
 *
 * El ajuste `currency` guarda el codigo ISO (CLP, USD, ...). Antes guardaba
 * solo el simbolo, asi que `monedaDe` tambien reconoce simbolos viejos
 * (`$`, `US$`) para no romper organizaciones existentes.
 */

export interface Moneda {
  code: string;
  nombre: string;
  simbolo: string;
}

export const MONEDAS: Moneda[] = [
  { code: 'CLP', nombre: 'Peso chileno', simbolo: '$' },
  { code: 'USD', nombre: 'Dólar estadounidense', simbolo: 'US$' },
  { code: 'EUR', nombre: 'Euro', simbolo: '€' },
  { code: 'ARS', nombre: 'Peso argentino', simbolo: '$' },
  { code: 'MXN', nombre: 'Peso mexicano', simbolo: '$' },
  { code: 'COP', nombre: 'Peso colombiano', simbolo: '$' },
  { code: 'PEN', nombre: 'Sol peruano', simbolo: 'S/' },
  { code: 'UYU', nombre: 'Peso uruguayo', simbolo: '$U' },
  { code: 'PYG', nombre: 'Guaraní', simbolo: '₲' },
  { code: 'BOB', nombre: 'Boliviano', simbolo: 'Bs' },
  { code: 'BRL', nombre: 'Real brasileño', simbolo: 'R$' },
  { code: 'CRC', nombre: 'Colón costarricense', simbolo: '₡' },
  { code: 'DOP', nombre: 'Peso dominicano', simbolo: 'RD$' },
  { code: 'GTQ', nombre: 'Quetzal', simbolo: 'Q' },
  { code: 'HNL', nombre: 'Lempira', simbolo: 'L' },
  { code: 'NIO', nombre: 'Córdoba', simbolo: 'C$' },
  { code: 'PAB', nombre: 'Balboa', simbolo: 'B/.' },
  { code: 'VES', nombre: 'Bolívar', simbolo: 'Bs.' },
];

export function monedaDe(valor: string | null | undefined): Moneda {
  const v = String(valor ?? '').trim();
  if (!v) return MONEDAS[0];
  const sinSigno = v.replace(/\$$/, '');
  return (
    MONEDAS.find((m) => m.code === v.toUpperCase()) ??
    MONEDAS.find((m) => m.code === sinSigno.toUpperCase()) ??
    MONEDAS.find((m) => m.simbolo === v) ?? {
      code: v.toUpperCase(),
      nombre: v,
      simbolo: v,
    }
  );
}

export function simboloMoneda(valor: string | null | undefined): string {
  return monedaDe(valor).simbolo;
}

/**
 * Texto que escribe la persona (en unidades de la moneda) -> centavos.
 * Acepta coma o punto como separador decimal.
 */
export function aCentavos(valor: string | number | null | undefined): number {
  const n = Number(String(valor ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Centavos -> texto editable en unidades, sin ceros de sobra. */
export function desdeCentavos(centavos: number | null | undefined): string {
  const n = Number(centavos ?? 0);
  return Number.isFinite(n) ? String(n / 100) : '0';
}
