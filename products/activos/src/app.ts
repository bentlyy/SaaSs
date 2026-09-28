import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDefinition } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { buildRoutes } from './routes.js';
import { assetMovements, assets, settings } from './schema.js';

const aqui = fileURLToPath(new URL('.', import.meta.url));

/**
 * Activos sobre el runtime.
 *
 * Lo unico que declara este producto son sus tablas. La identidad, las
 * organizaciones y las suscripciones no se declaran aca: vienen del Core.
 *
 * No hay `legacy_tenant_map` en el esquema, y no es un olvido: este producto no
 * tiene fuente legacy. Ninguno de los productos viejos traia un inventario de
 * equipos y herramientas, asi que no hay nada que migrar y una tabla de mapeo
 * seria una que nunca se llena.
 *
 * No hay `seed` en el arranque a proposito: los datos de ejemplo pertenecen a una
 * organizacion, y esa organizacion solo existe cuando hay una sesion real.
 * Sembrar al levantar el server obligaria a inventar un `organization_id`, que
 * es justo lo que esta arquitectura prohibe.
 */
export const definicion: ProductDefinition = {
  slug: 'activos',
  name: 'Activos',
  schema: {
    assets,
    assetMovements,
    settings,
  },
  ddl: DDL,
  routes: buildRoutes,
  // El HTML tambien pide sesion: sin identidad no se sirve ni el shell.
  staticDir: join(aqui, '..', 'public'),
};
