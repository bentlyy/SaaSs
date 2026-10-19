/** Formas de la API del inventario (`products/inventario/src/routes.ts`). */

export interface Articulo {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  categoryId: string | null;
  quantity: number;
  minQuantity: number;
  unit: string;
  priceCents: number;
}

export interface Categoria {
  id: string;
  name: string;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface Resumen {
  items: number;
  unidades: number;
  valorCents: number;
  stockBajo: number;
  movimientos: number;
}

export interface Movimiento {
  id: string;
  delta: number;
  reason: string;
  actorName: string | null;
  createdAt: string;
  itemName: string | null;
}

export interface AjustesInventario {
  defaultUnit: string;
  defaultMinQuantity: number;
  currency: string;
  allowNegativeStock?: boolean;
  configured?: boolean;
  seedAvailable?: boolean;
}

/** Modo de la sesión de escaneo. `adjust` deja el stock en la cantidad contada. */
export type ModoEscaneo = 'in' | 'out' | 'adjust';

export interface ResultadoEscaneo {
  code: string;
  found: boolean;
  item: Articulo | null;
}

export interface LineaConfirmada {
  itemId: string;
  name: string;
  quantity: number;
  delta: number;
  unit: string;
}

export interface ResultadoConfirmacion {
  mode: ModoEscaneo;
  reason: string;
  lines: LineaConfirmada[];
  movimientos: number;
}

export interface IncidenciaEscaneo {
  id: string;
  barcode: string;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}
