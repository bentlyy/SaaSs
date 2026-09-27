import { join } from 'node:path';

export interface ProductConfig {
  /** Slug del producto en el Core. Es el client_id de SSO. */
  slug: string;
  /** Nombre para los titulos y /api/meta. */
  name: string;
  port: number;
  /** Ruta de SU base. Cada producto tiene la suya; nunca se comparte. */
  dbPath: string;
  isProd: boolean;
  appUrl: string;
  coreUrl: string;
  /** Version del esquema de ESTA base, para migrar sin adivinar. */
  schemaVersion: number;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Config del producto, desde el entorno.
 *
 * `DB_PATH` es lo unico que define donde estan SUS datos. Un valor relativo se
 * resuelve contra el directorio de trabajo, asi que en Docker va absoluto
 * (`/app/data/<slug>/app.db`) y en local basta `./data/app.db`. Cada producto
 * tiene el suyo: no hay ningun default que apunte a otro archivo.
 */
export function loadProductConfig(slug: string, name: string, env: NodeJS.ProcessEnv = process.env): ProductConfig {
  const appUrl = (env.APP_URL ?? env.PUBLIC_URL ?? `http://localhost:${int(env.PORT, 3000)}`).replace(/\/+$/, '');
  return {
    slug,
    name,
    port: int(env.PORT, 3000),
    dbPath: env.DB_PATH ?? join('data', `${slug}.sqlite`),
    isProd: env.NODE_ENV === 'production',
    appUrl,
    coreUrl: (env.CORE_URL ?? 'http://localhost:3008').replace(/\/+$/, ''),
    schemaVersion: int(env.DB_SCHEMA_VERSION, 1),
  };
}
