/** Tipos del producto pagos, como los devuelve la API. */

export type Estado = 'pending' | 'partial' | 'paid' | 'canceled';

export type Metodo = 'cash' | 'transfer' | 'card' | 'check' | 'other';

/** Un cargo de la cartera: lo que un cliente debe. */
export interface Cargo {
  id: string;
  number: number;
  customerName: string;
  customerId: string | null;
  customerEmail: string | null;
  concept: string;
  amountCents: number;
  status: Estado;
  issuedDate: string | null;
  dueDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Abono {
  id: string;
  amountCents: number;
  method: Metodo;
  reference: string | null;
  receivedAt: string;
  createdAt: string;
}

/** Un cargo que además trae su saldo calculado, como los del tablero. */
export interface CargoReciente extends Cargo {
  pagadoCents: number;
  saldoCents: number;
}

export interface Devolucion {
  id: string;
  amountCents: number;
  reason: string;
  method: Metodo;
  reference: string | null;
  refundedAt: string;
  createdAt: string;
}

/** La ficha de un cargo: sus datos y todos sus movimientos. */
export interface Ficha {
  charge: Cargo;
  payments: Abono[];
  refunds: Devolucion[];
  /** Lo que entró por abonos, sin descontar devoluciones. */
  abonadoCents: number;
  devueltoCents: number;
  /** El cobrado NETO, que es el que decide el saldo. */
  pagadoCents: number;
  saldoCents: number;
}

/** El saldo de un cargo, como lo entrega `/api/charges/saldos`. */
export interface Saldo {
  id: string;
  pagadoCents: number;
  saldoCents: number;
}

/** Las cifras del tablero. */
export interface Tablero {
  total: number;
  porStatus: Record<Estado, number>;
  pendienteCents: number;
  cobradoMesCents: number;
  devueltoMesCents: number;
  vencidoCents: number;
  recientes: CargoReciente[];
}

export interface Tramo {
  cargos: number;
  saldoCents: number;
}

/** La antigüedad de la cartera por tramos de atraso. */
export interface Reporte {
  from: string | null;
  to: string | null;
  referencia: string;
  buckets: Record<string, Tramo>;
  totalPendienteCents: number;
  totalCargos: number;
}

/** Los ajustes de la empresa (moneda y zona horaria). */
export interface AjustesPagos {
  organizationId?: string;
  currency: string;
  timezone: string;
}