/** Formas de la API del inventario (`products/inventario/src/routes.ts`). */

export interface Articulo {
  id: string;
  name: string;
  sku: string | null;
  quantity: number;
  minQuantity: number;
  unit: string;
  priceCents: number;
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
  configured?: boolean;
  seedAvailable?: boolean;
}
