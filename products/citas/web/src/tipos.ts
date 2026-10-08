/** Formas que devuelve la API de citas, para tipar las páginas. */

export type EstadoCita = 'confirmed' | 'pending' | 'done' | 'cancelled' | 'no_show';

export interface Resumen {
  hoy?: number;
  futuras?: number;
  porConfirmar?: number;
}

export interface Cita {
  id: string;
  customerId: string | null;
  staffId: string | null;
  startAt: string;
  endAt: string;
  status: EstadoCita;
  notes: string | null;
  customerName?: string | null;
  staffName?: string | null;
  totalCents?: number | null;
}

export interface Cliente {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  tags?: string | null;
}

export interface Servicio {
  id: string;
  name: string;
  durationMin: number;
  priceCents: number;
  active: boolean;
}

export interface Profesional {
  id: string;
  name: string;
  phone: string | null;
  color?: string | null;
  active: boolean;
}

export interface Horario {
  id: string;
  staffId: string;
  weekday: number;
  startTime: number;
  endTime: number;
  active: boolean;
}

export interface Bloqueo {
  id: string;
  staffId: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

export type EstadoAviso = 'sent' | 'failed' | 'pending';

export interface Recordatorio {
  id: string;
  appointmentId: string | null;
  channel: string;
  to: string | null;
  status: EstadoAviso;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface LineaServicio {
  id: string;
  appointmentId: string;
  serviceId: string | null;
  priceCents: number;
}

export interface DetalleCita {
  appointment: Cita;
  services: LineaServicio[];
  reminders: Recordatorio[];
  customer: Cliente | null;
  staff: Profesional | null;
}

/** Los ajustes propios de citas, que viven en los globales del shell. */
export interface AjustesCitas {
  timezone: string;
  currency: string;
  reminderHours: number;
  emailEnabled: boolean;
}