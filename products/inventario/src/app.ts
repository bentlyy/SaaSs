import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDefinition } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { buildRoutes } from './routes.js';
import { items, movements, settings } from './schema.js';

const aqui = fileURLToPath(new URL('.', import.meta.url));

/**
 * Inventario sobre el runtime.
 *
 * Lo único que declara este producto son sus tres tablas. La identidad, las
 * organizaciones y las suscripciones no se declaran acá: vienen del Core.
 *
 * No hay `seed` en el arranque a propósito: los datos de ejemplo pertenecen a
 * una organización, y esa organización solo existe cuando hay una sesión real.
 * Sembrar al levantar el server obligaría a inventar un `organization_id`, que
 * es justo lo que esta arquitectura prohíbe.
 */
export const definicion: ProductDefinition = {
  slug: 'inventario',
  name: 'Inventario',
  schema: { items, movements, settings },
  ddl: DDL,
  routes: buildRoutes,
  // El HTML tambien pide sesión: sin identidad no se sirve ni el shell. El
  // frontend es una SPA de Vite compilada a web/dist.
  staticDir: join(aqui, '..', 'web', 'dist'),
};
