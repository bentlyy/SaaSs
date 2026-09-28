import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDefinition } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { buildRoutes } from './routes.js';
import { customers, followups, interactions, legacyTenantMap, settings } from './schema.js';

const aqui = fileURLToPath(new URL('.', import.meta.url));

/**
 * Clientes sobre el runtime.
 *
 * Lo unico que declara este producto son sus tablas. La identidad, las
 * organizaciones y las suscripciones no se declaran aca: vienen del Core.
 *
 * No hay `seed` en el arranque a proposito: los datos de ejemplo pertenecen a una
 * organizacion, y esa organizacion solo existe cuando hay una sesion real.
 * Sembrar al levantar el server obligaria a inventar un `organization_id`, que
 * es justo lo que esta arquitectura prohibe.
 */
export const definicion: ProductDefinition = {
  slug: 'clientes',
  name: 'Clientes',
  schema: {
    customers,
    followups,
    interactions,
    settings,
    legacyTenantMap,
  },
  ddl: DDL,
  routes: buildRoutes,
  // El HTML tambien pide sesion: sin identidad no se sirve ni el shell.
  staticDir: join(aqui, '..', 'public'),
};
