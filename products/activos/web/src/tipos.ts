/** Formas de la API de activos (`products/activos/src/routes.ts`). */

export type Estado = 'active' | 'repair' | 'retired' | 'lost';

export type TipoMovimiento = 'checkin' | 'checkout' | 'maintenance' | 'loss';

export interface Activo {
  id: string;
  code: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  serial: string | null;
  status: Estado;
  location: string | null;
  assignedTo: string | null;
  purchaseDate: string | null;
  costCents: number;
  notes: string | null;
  archivedAt: string | null;
}

export interface Reciente {
  id: string;
  code: string;
  name: string;
  category: string;
  status: Estado;
  location: string | null;
  assignedTo: string | null;
  costCents: number;
}

export interface Tablero {
  total: number;
  porStatus: Record<Estado, number>;
  valorEnUsoCents: number;
  recientes: Reciente[];
}

export interface Movimiento {
  id: string;
  kind: TipoMovimiento;
  note: string | null;
  happenedAt: string;
}

export interface Ficha {
  asset: Activo;
  movements: Movimiento[];
  resumen: { totalMovimientos: number; ultimoMovimientoAt: string | null };
}

export interface AjustesActivos {
  organizationId?: string;
  currency: string;
  timezone: string;
}