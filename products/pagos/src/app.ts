import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDefinition } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { MIGRACIONES } from './migrations.js';
import { buildRoutes } from './routes.js';
import { chargePayments, chargeRefunds, charges, settings } from './schema.js';

const aqui = fileURLToPath(new URL('.', import.meta.url));

/**
 * Control de Pagos sobre el runtime.
 *
 * Lo que este producto registra es lo que la empresa le tiene que COBRAR a sus
 * clientes: cargos, abonos y saldo. Lo que la empresa le paga a AMG por la
 * suscripcion lo cobra el Core en su propia tabla `payments`, y no se toca desde
 * aca: son dos pagos distintos, en dos bases distintas.
 *
 * Lo unico que declara este producto son sus tablas. La identidad, las
 * organizaciones y las suscripciones no se declaran aca: vienen del Core. No hay
 * tabla `users`, no hay contrasenas y no hay `JWT_SECRET`: la sesion es del Core.
 *
 * NO hay `legacy_tenant_map` en el esquema, y no es un olvido: este producto no
 * tiene fuente legacy. Ninguno de los productos viejos traia un control de
 * cartera de clientes, asi que no hay nada que migrar, una tabla de mapeo seria
 * una que nunca se llena y un `migrate-legacy.ts` seria un migrador sin datos de
 * los que leer.
 *
 * No hay `seed` en el arranque a proposito: los datos de ejemplo pertenecen a una
 * organizacion, y esa organizacion solo existe cuando hay una sesion real.
 * Sembrar al levantar el server obligaria a inventar un `organization_id`, que
 * es justo lo que esta arquitectura prohibe.
 */
export const definicion: ProductDefinition = {
  slug: 'pagos',
  name: 'Control de Pagos',
  schema: {
    charges,
    chargePayments,
    chargeRefunds,
    settings,
  },
  ddl: DDL,
  migrations: MIGRACIONES,
routes: buildRoutes,
  // El HTML tambien pide sesion: sin identidad no se sirve ni el shell. El
  // frontend es una SPA de Vite compilada a web/dist.
  staticDir: join(aqui, '..', 'web', 'dist'),
};
