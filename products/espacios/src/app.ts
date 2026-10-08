import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDefinition } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { MIGRACIONES } from './migrations.js';
import { buildRoutes } from './routes.js';
import { addons, availability, blocks, bookingAddons, bookings, customers, settings, spaces } from './schema.js';

const aqui = fileURLToPath(new URL('.', import.meta.url));

/**
 * Espacios sobre el runtime.
 *
 * Lo único que declara este producto son sus tablas. La identidad, las
 * organizaciones y las suscripciones no se declaran acá: vienen del Core.
 *
 * No hay `seed` en el arranque a propósito: los datos de ejemplo pertenecen a
 * una organización, y esa organización solo existe cuando hay una sesión real.
 * Sembrar al levantar el server obligaría a inventar un `organization_id`, que
 * es justo lo que esta arquitectura prohíbe.
 */
export const definicion: ProductDefinition = {
  slug: 'espacios',
  name: 'Espacios',
  schema: {
    customers,
    spaces,
    addons,
    availability,
    blocks,
    bookings,
    bookingAddons,
    settings,
  },
  ddl: DDL,
  migrations: MIGRACIONES,
  routes: buildRoutes,
  // El HTML tambien pide sesión: sin identidad no se sirve ni el shell. El
  // frontend es una SPA de Vite compilada a web/dist.
  staticDir: join(aqui, '..', 'web', 'dist'),
};
