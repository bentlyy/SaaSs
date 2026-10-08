/** Formas de la API del crm (`products/crm/src/routes.ts`). */

export interface Cliente {
  id: string;
  organizationId: string;
  name: string;
  company: string | null;
  kind: 'persona' | 'empresa';
  email: string | null;
  phone: string | null;
  taxId: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  tags: string | null;
  birthday: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

export interface Seguimiento {
  id: string;
  organizationId: string;
  customerId: string;
  title: string;
  body: string | null;
  dueDate: string | null;
  status: 'pending' | 'done' | 'canceled';
  completedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
  customerName?: string | null;
}

export interface Contacto {
  id: string;
  organizationId: string;
  customerId: string;
  kind: 'llamada' | 'correo' | 'visita' | 'nota';
  summary: string;
  happenedAt: string;
  createdAt: string;
  customerName?: string | null;
}

export interface AjustesCrm {
  currency: string;
  timezone: string;
  organizationId?: string;
  [clave: string]: unknown;
}
