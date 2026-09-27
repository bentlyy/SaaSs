import { AppError } from '@saas-mini/core';
import { TransferProvider } from './transfer.js';
import { StripeProvider } from './stripe.js';
import type { BillingProvider, BillingProviderName } from './types.js';

export * from './types.js';
export { TransferProvider } from './transfer.js';
export { StripeProvider } from './stripe.js';

/**
 * DATO BANCARIO DE EJEMPLO. Esta cadena se cambia al desplegar.
 *
 * Aparece aca y no en el .env a proposito: si el dato falta, el checkout igual
 * genera referencia y el usuario recibe un texto sin destino donde transferir,
 * que es un cobro que no se puede completar y nadie sabe por que. Con un valor
 * explicito y visible, el que configura lo ve.
 */
const DATOS_BANCARIOS_POR_DEFECTO =
  'Banco: Banco Estado\nCuenta: 123456789\nTitular: AMG SpA\nEmail: pagos@amgdeveloper.cl';

const proveedores = new Map<BillingProviderName, () => BillingProvider>();

/**
 * Registrar un proveedor es lo unico que hay que hacer para que el dominio lo
 * use. Si un proveedor nuevo necesita logica propia, se escribe aca y no dentro
 * de las rutas: las rutas no deben saber como cobrar.
 */
export function registrarProveedor(name: BillingProviderName, fabrica: () => BillingProvider): void {
  proveedores.set(name, fabrica);
}

registrarProveedor('transfer', () => new TransferProvider(DATOS_BANCARIOS_POR_DEFECTO));
registrarProveedor('stripe', () => new StripeProvider({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
}));

export function obtenerProveedor(name: BillingProviderName): BillingProvider {
  const fabrica = proveedores.get(name);
  if (!fabrica) {
    throw new AppError(
      501,
      `No hay pasarela registrada para "${name}". Registrala con registrarProveedor().`,
    );
  }
  return fabrica();
}

/** Los proveedores con los que este despliegue puede cobrar de verdad. */
export function proveedoresRegistrados(): BillingProviderName[] {
  return [...proveedores.keys()];
}
