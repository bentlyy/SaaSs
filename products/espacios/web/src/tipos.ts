/** Formas que devuelve la API de espacios (`products/espacios/src/routes.ts`). */

/** Estados de una reserva, tal como los guarda el servidor. */
export type EstadoReserva = 'confirmed' | 'pending' | 'done' | 'cancelled' | 'no_show';

export interface Espacio {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  capacity: number;
  pricePerHourCents: number;
  color: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
  archivedAt: string | null;
}

export interface Cliente {
  id: string;
  organizationId: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  tags: string | null;
  createdAt: string;
  updatedAt: string | null;
  archivedAt: string | null;
}

export interface Extra {
  id: string;
  organizationId: string;
  name: string;
  durationMin: number;
  priceCents: number;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/** Horario semanal de un espacio: 0 = domingo, como `Date.getUTCDay`. */
export interface Horario {
  id: string;
  organizationId: string;
  spaceId: string;
  weekday: number;
  startTime: number;
  endTime: number;
  active: boolean;
  createdAt: string;
  updatedAt: string | null;
}

/** Bloqueo puntual: UN rato concreto en que no se puede reservar. */
export interface Bloqueo {
  id: string;
  organizationId: string;
  spaceId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
  createdAt: string;
}

export interface Reserva {
  id: string;
  organizationId: string;
  spaceId: string;
  customerId: string | null;
  startAt: string;
  endAt: string;
  status: EstadoReserva;
  notes: string | null;
  totalCents: number;
  createdAt: string;
  updatedAt: string | null;
  /** Nombres resueltos por `/api/agenda`, no por cada fila. */
  spaceName?: string | null;
  customerName?: string | null;
}

/** Los números de las cuatro tarjetas de la agenda (`/api/resumen`). */
export interface Resumen {
  date: string | null;
  hoy: number;
  confirmadas: number;
  porConfirmar: number;
  futuras: number;
  ingresos: number;
}

/** Franja libre que ofrece `/api/availability`. */
export interface Franja {
  startAt: string;
  endAt: string;
  totalCents: number;
}

/** Preferencias de la organización (`GET /api/settings`, envuelto en `{settings}`). */
export interface AjustesEspacios {
  currency: string;
  timezone: string;
  openingMinutes: number;
  closingMinutes: number;
  slotMinutes: number;
  minAdvanceMinutes: number;
}
