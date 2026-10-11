/**
 * PERIODO CONTRATADO: MENSUAL O ANUAL
 * ===================================
 *
 * Antes `billing_period` vivia solo en el PRODUCTO: un producto era mensual o
 * anual para todos. Eso no es lo que se vende: el cliente elige si paga el mes o
 * el ano. Esta funcion pura define, en un solo lugar, cuanto dura y cuanto cuesta
 * cada opcion, para que el Core, la landing y los tests no tengan tres copias del
 * mismo numero (dos fuentes de verdad para un precio es un bug esperando).
 *
 * EL ANUAL REGALA DOS MESES: se cobran DIEZ y se entregan doce. `yearlySavings`
 * es ese regalo, y existe para que la web lo muestre con el mismo numero que se
 * cobra, no con uno inventado en el HTML.
 *
 * No importa nada a proposito: asi cualquier modulo (dominio, billing, HTTP) lo
 * usa sin ciclos.
 */

export const PERIOD_CHOICES = ['monthly', 'yearly'] as const;
export type PeriodChoice = (typeof PERIOD_CHOICES)[number];

/** Dias que dura cada periodo. El ano se cuenta en dias, no en calendario. */
export const PERIOD_DAYS: Record<PeriodChoice, number> = { monthly: 30, yearly: 365 };

/** Meses incluidos en el pago anual: el cliente recibe un ano completo. */
export const YEARLY_MONTHS_INCLUDED = 12;

/** Meses que se COBRAN en el plan anual: diez. Los otros dos son el ahorro. */
export const YEARLY_MONTHS_CHARGED = 10;

export function isPeriodChoice(value: unknown): value is PeriodChoice {
  return value === 'monthly' || value === 'yearly';
}

export function periodDays(choice: PeriodChoice): number {
  return PERIOD_DAYS[choice];
}

/** Precio de un periodo a partir del precio mensual del producto. */
export function periodPrice(monthlyPrice: number, choice: PeriodChoice): number {
  return choice === 'yearly' ? monthlyPrice * YEARLY_MONTHS_CHARGED : monthlyPrice;
}

/** Lo que el cliente deja de pagar al elegir el ano en vez de doce meses sueltos. */
export function yearlySavings(monthlyPrice: number): number {
  return monthlyPrice * YEARLY_MONTHS_INCLUDED - periodPrice(monthlyPrice, 'yearly');
}

/** Etiqueta corta para el comprobante y las instrucciones de transferencia. */
export function periodLabel(choice: PeriodChoice): string {
  return choice === 'yearly' ? 'anual (12 meses, pagas 10)' : 'mensual (30 dias)';
}
