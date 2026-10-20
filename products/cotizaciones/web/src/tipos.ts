/** Formas de la API de cotizaciones (products/cotizaciones/src/routes.ts). */

export type Estado = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';

export interface LineaCotizacion {
  position: number;
  description: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface Cotizacion {
  id: string;
  organizationId: string;
  number: number;
  customerName: string;
  customerId: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  title: string | null;
  status: Estado;
  issueDate: string | null;
  validUntil: string | null;
  taxRateBp: number;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  sentAt: string | null;
  acceptedAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AjustesCotizaciones {
  currency: string;
  timezone: string;
  businessName: string | null;
  businessTaxId: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  defaultTaxRateBp: number;
  validityDays: number;
  nextNumber?: number;
}

