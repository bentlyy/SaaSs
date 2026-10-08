import { dinero } from '@amg/ui';

/**
 * Centavos a texto legible, con el centavo SIEMPRE a la vista.
 *
 * Se le pide a `dinero` con dos decimales: el helper ya sabe formatear y el
 * símbolo lo elige la organización; solo hay que no redondear. Un costo de
 * $45,01 mostrado como $45 hace pensar que el activo costó menos. El monto
 * entra en centavos y sale pintado: esta pantalla no multiplica ni divide.
 */
export function monto(centavos: number, simbolo = '$'): string {
  return dinero(centavos, { simbolo, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `AAAA-MM-DD` a `DD/MM`: como lo lee una persona, sin cambiar el dato. */
export function fechaCorta(fecha: string | null): string {
  if (!fecha) return '';
  const [, mes, dia] = fecha.split('-');
  return `${dia}/${mes}`;
}