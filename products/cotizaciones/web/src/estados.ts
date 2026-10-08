import type { MapaEstados } from '@amg/ui';
import type { Estado } from './tipos';

/** Los estados del negocio, con su tono. Que el color ayude a barrer la tabla. */
export const ESTADOS = {
  draft: { texto: 'Borrador', tono: 'neutro' },
  sent: { texto: 'Enviada', tono: 'acento' },
  accepted: { texto: 'Aceptada', tono: 'ok' },
  rejected: { texto: 'Rechazada', tono: 'malo' },
  expired: { texto: 'Vencida', tono: 'neutro' },
} as const satisfies MapaEstados;

/**
 * A donde se puede ir desde cada estado.
 *
 * Es la misma tabla que valida el servidor (`src/routes.ts`): acá solo decide
 * qué botones se pintan. De `accepted` y de `rejected` no se vuelve a `draft`.
 */
export const TRANSICIONES: Record<Estado, Estado[]> = {
  draft: ['sent', 'expired'],
  sent: ['accepted', 'rejected', 'expired'],
  accepted: [],
  rejected: [],
  expired: ['sent'],
};
