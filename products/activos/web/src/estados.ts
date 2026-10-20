import type { MapaEstados } from '@amg/ui';
import type { Estado, TipoMovimiento } from './tipos';

/**
 * Los cuatro estados del bien, con el texto del producto viejo.
 *
 * Los rótulos son los de la pantalla legacy tal cual: "En reparacion" y
 * "Perdido" van sin acentos porque así los leía esa pantalla, y un
 * cambio de texto es un cambio de producto, no de estilo.
 */
export const ESTADOS: MapaEstados = {
  active: { texto: 'En uso', tono: 'ok' },
  repair: { texto: 'En reparacion', tono: 'aviso' },
  retired: { texto: 'Dado de baja', tono: 'neutro' },
  lost: { texto: 'Perdido', tono: 'malo' },
};

/** El orden en que se eligen y se listan: el mismo del `<select>` legacy. */
export const ESTADOS_VALOR: Estado[] = ['active', 'repair', 'retired', 'lost'];

/**
 * Los cinco hechos que se registran sobre un bien.
 *
 * No es un picker de estado: el estado lo decide la API al aplicar el
 * movimiento, en la misma transacci��n en que lo escribe.
 */
export const MOVIMIENTOS: MapaEstados = {
  checkout: { texto: 'Salio', tono: 'acento' },
  checkin: { texto: 'Volvio', tono: 'ok' },
  transfer: { texto: 'Se traslado', tono: 'neutro' },
  maintenance: { texto: 'A reparacion', tono: 'aviso' },
  loss: { texto: 'Se perdio', tono: 'malo' },
};

/** R��tulos del select de "Que pas��", como los puso el legacy. */
export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  checkout: 'Salio (checkout)',
  checkin: 'Volvio (checkin)',
  transfer: 'Se traslado (transfer)',
  maintenance: 'A reparacion (maintenance)',
  loss: 'Se perdio (loss)',
};

/** El orden del select de movimientos: checkout, checkin, transfer, maintenance, loss. */
export const MOVIMIENTOS_VALOR: TipoMovimiento[] = [
  'checkout',
  'checkin',
  'transfer',
  'maintenance',
  'loss',
];