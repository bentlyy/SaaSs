import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProductDefinition } from '@amg/product-runtime';
import { DDL } from './ddl.js';
import { MIGRACIONES } from './migrations.js';
import { buildRoutes } from './routes.js';
import { attachments, runItems, runs, sections, settings, templateItems, templates } from './schema.js';

const aqui = fileURLToPath(new URL('.', import.meta.url));

/**
 * Checklists e inspecciones sobre el runtime.
 *
 * Lo unico que declara este producto son sus tablas. La identidad, las
 * organizaciones y las suscripciones no se declaran aca: vienen del Core.
 *
 * No hay `legacy_tenant_map` en el esquema, y no es un olvido: este producto no
 * tiene fuente legacy. Ninguno de los productos viejos traia un modulo de
 * inspecciones, asi que no hay nada que migrar y una tabla de mapeo seria una que
 * nunca se llena.
 *
 * Las migraciones son las que le dan la forma actual a una base que ya tenia
 * datos de la epoca sin secciones ni adjuntos: la base nueva la construye el DDL
 * tal cual. `DB_SCHEMA_VERSION` del entorno es la que dice hasta que version
 * correr; sube con el despliegue.
 *
 * No hay `seed` en el arranque a proposito: los datos de ejemplo pertenecen a una
 * organizacion, y esa organizacion solo existe cuando hay una sesion real.
 * Sembrar al levantar el server obligaria a inventar un `organization_id`, que es
 * justo lo que esta arquitectura prohibe.
 */
export const definicion: ProductDefinition = {
  slug: 'checklists',
  name: 'Checklists e Inspecciones',
  schema: {
    templates,
    sections,
    templateItems,
    runs,
    runItems,
    attachments,
    settings,
  },
  ddl: DDL,
  migrations: MIGRACIONES,
  routes: buildRoutes,
  // El HTML tambien pide sesion: sin identidad no se sirve ni el shell.
  staticDir: join(aqui, '..', 'public'),
};