/**
 * DINERO: UNA SOLA REGLA, UN SOLO LUGAR
 * =======================================
 *
 * El bug clasico de este repositorio era que cada capa decidia por su cuenta si
 * el numero que recibia eran centavos o pesos. El resultado eran tres fallas
 * distintas segun donde se mirara:
 *
 *   - doble division: el backend ya devidia pesos y el frontend dividia otra
 *     vez, asi que $120 se veia como $1,20;
 *   - compensaciones: donde se noto, el frontend multiplicaba por 100 para
 *     "arreglarlo", y quedo un `* 100` pegado en el codigo que hacia lo
 *     contrario si el backend se arreglaba;
 *   - y lo peor: el formulario de edicion dividia al MOSTRAR y multiplicaba al
 *     GUARDAR, asi que abrir y cerrar un articulo sin tocar el precio
 *     dividia el precio por 100. Dato destruido por un click.
 *
 * La regla, y no hay otra:
 *
 *   1. BASE DE DATOS -> entero en UNIDADES MENORES (centavos). Nunca float.
 *      Un float no sabe representar 0.1 + 0.2, y un saldo que no cuadra es un
 *      saldo que nadie puede explicar.
 *
 *   2. BACKEND -> convierte UNA vez, en el borde, y siempre por este modulo.
 *      Hacia adentro acepta numero humano; hacia afuera entrega numero humano.
 *      Quien llama a la API nunca ve centavos.
 *
 *   3. FRONTEND -> muestra el numero humano. NO multiplica, NO divide, no
 *      "compensa". Si necesita calcular, calcula en unidades menores explicitas.
 *
 * O sea: 25000 (centavos en la base) -> $250,00 en la API -> "$250,00" en la
 * pantalla. Nunca $2,50.
 *
 * CUIDADO CON LOS DOS CONTRATOS DISTINTOS (esta es la trampa de "arreglarlo"):
 * el dinero del NEGOCIO (inventario, facturas, ordenes) usa centavos, y en los
 * datos reales verificados 18500 es un aceite de $185,00, no $18.500. Pero el
 * CATALOGO de la plataforma usa CLP, cuya unidad menor es el peso entero: ahi
 * 25000 son $25.000 y NO 250,00. Los dos son correctos a la vez y por eso la
 * regla se apoya en `minorDecimals(moneda)` y no en un "/100" repartido: pasar
 * CLP por la regla de los centavos es el error de recreation.
 *
 * `decimals` sale de la DIVISA, no del gusto: el dollar tiene centavo, el peso
 * chileno no. Ver MINOR_UNITS.
 */

export type Currency = 'CLP' | 'USD' | 'EUR' | 'COP' | 'ARS' | 'MXN' | 'BRL' | 'PEN' | 'UYU';

/** Cuantos decimales muestra la moneda. El CLP no usa subdivision. */
export const MINOR_UNITS: Record<string, number> = {
  CLP: 0,
  COP: 0,
  ARS: 0,
  UYU: 0,
  USD: 2,
  EUR: 2,
  MXN: 2,
  BRL: 2,
  PEN: 2,
};

export function minorDecimals(currency: string): number {
  return MINOR_UNITS[currency?.toUpperCase?.() ?? ''] ?? 2;
}

/**
 * `Intl` revienta con un codigo de moneda que no exista, y el `currency` de los
 * tenants legacy es un SIMBOLO ("$"), no un ISO. Una fila sucia no puede
 * convertir un listado en un 500, asi que se valida una vez y se degrada.
 */
function isoAceptable(currency: string): boolean {
  try {
    new Intl.NumberFormat('es-CL', { style: 'currency', currency }).format(1);
    return true;
  } catch {
    return false;
  }
}

/**
 * Number humano -> entero de unidades menores, para GUARDAR.
 *
 * `toMinor(250)` con USD son 25000. Redondea porque un float puede llegar
 * como 19.999999999999996 desde el formulario.
 */
export function toMinor(amount: number, currency = 'CLP'): number {
  if (!Number.isFinite(amount)) throw new RangeError(`toMinor: monto invalido (${amount})`);
  const factor = 10 ** minorDecimals(currency);
  return Math.round(amount * factor);
}

/** Entero de unidades menores -> numero humano, para LEER de la base. */
export function fromMinor(minor: number, currency = 'CLP'): number {
  if (!Number.isFinite(minor)) throw new RangeError(`fromMinor: monto invalido (${minor})`);
  const factor = 10 ** minorDecimals(currency);
  return minor / factor;
}

/**
 * Multiplica unidades menores SIN pasar por float cuando se puede.
 *
 * Un total de linea es `precio * cantidad`, y si `precio` ya esta en
 * unidades menores el resultado tambien lo esta: no hace falta dividir y volver
 * a multiplicar, que es donde se cuelan los centavos perdidos.
 */
export function multiplyMinor(minor: number, quantity: number): number {
  if (!Number.isInteger(quantity)) throw new RangeError(`multiplyMinor: cantidad no entera (${quantity})`);
  return minor * quantity;
}

/**
 * Formatea un numero HUMANO para pintar. No hace conversiones: si le pasas
 * centavos, muestra centavos. La conversion es del backend.
 *
 * El `locale` por defecto es es-CL para no tener un "$1,20.00" mezclando punto
 * decimal con coma de miles en pantalla.
 */
export function formatMoney(amount: number, currency = 'CLP', locale = 'es-CL'): string {
  const decimals = minorDecimals(currency);
  const value = Number.isFinite(amount) ? amount : 0;
  if (isoAceptable(currency)) {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }
  // Moneda no reconocida (el simbolo "$" de los tenants legacy): se imprime el
  // simbolo tal cual. Es feo pero es lo que el cliente ya ve en su config.
  const numero = new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${currency === 'CLP' ? '$' : currency}${numero}`;
}

/**
 * Formatea ENTERO de unidades menores. Es el unico camino para pintar un
 * `price_cents` que salio de la base sin pasar por un endpoint.
 */
export function formatMinor(minor: number, currency = 'CLP', locale = 'es-CL'): string {
  return formatMoney(fromMinor(minor, currency), currency, locale);
}

/**
 * Lee un precio de un formulario y lo devuelve en unidades menores.
 *
 * Un input vacio es 0 y no NaN: "dejar el precio en blanco" tiene que ser una
 * decision, no un 500 con NaN en la base.
 */
export function parseMoneyToMinor(input: string | number | null | undefined, currency = 'CLP'): number {
  if (input === null || input === undefined || input === '') return 0;
  const value = typeof input === 'number' ? input : Number(String(input).replace(',', '.'));
  if (!Number.isFinite(value)) return 0;
  return toMinor(value, currency);
}
