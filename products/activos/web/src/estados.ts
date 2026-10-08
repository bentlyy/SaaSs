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
 * Los cuatro hechos que se registran sobre un bien.
 *
 * No es un picker de estado: el estado lo decide la API al aplicar el
 * movimiento, en la misma transacción en que lo escribe.
 */
export const MOVIMIENTOS: MapaEstados = {
  checkout: { texto: 'Salio', tono: 'acento' },
  checkin: { texto: 'Volvio', tono: 'ok' },
  maintenance: { texto: 'A reparacion', tono: 'aviso' },
  loss: { texto: 'Se perdio', tono: 'malo' },
};

/** Rótulos del select de "Que pasó", como los puso el legacy. */
export const ETIQUETA_MOVIMIENTO: Record<TipoMovimiento, string> = {
  checkout: 'Salio (checkout)',
  checkin: 'Volvio (checkin)',
  maintenance: 'A reparacion (maintenance)',
  loss: 'Se perdio (loss)',
};

/** El orden del select de movimientos: checkout, checkin, maintenance, loss. */
export const MOVIMIENTOS_VALOR: TipoMovimiento[] = ['checkout', 'checkin', 'maintenance', 'loss'];