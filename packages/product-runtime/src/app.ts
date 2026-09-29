import express, { type Express, type Router } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProductConfig, type ProductConfig } from './config.js';
import { openProductDb, type OpenOptions, type ProductDb, type ProductSchema } from './db.js';
import { mountAmgProductAuth, type MountAuthOptions } from './auth.js';
import { errorHandler, notFound } from './errors.js';
import { logger } from './logger.js';

export interface ProductContext {
  config: ProductConfig;
  db: ProductDb;
  /** `db.db` para abreviar en los routers del producto. */
  handle: { db: ProductDb['db'] };
}

export interface ProductDefinition {
  /** Slug en el Core: el client_id de SSO y el subdominio. */
  slug: string;
  name: string;
  /** Tablas de drizzle de ESTE producto. */
  schema: ProductSchema;
  /** CREATE TABLE / CREATE INDEX de ESTE producto. */
  ddl: string;
  migrations?: OpenOptions['migrations'];
  /** Routers del producto, montados bajo /api. */
  routes: (ctx: ProductContext) => Router[];
  /** Datos de ejemplo, con organization_id. */
  seed?: (ctx: ProductContext) => void;
  staticDir?: string;
  auth?: MountAuthOptions;
  /** Rutas publicas que no requieren sesion (ademas de /health). */
  publicPaths?: (string | RegExp)[];
  rateLimitPer15Min?: number;
}

export interface BuiltProduct {
  app: Express;
  config: ProductConfig;
  db: ProductDb;
}

/**
 * Donde vive la hoja de estilo compartida de los nueve productos.
 *
 * Va en el runtime y no en el `public` de cada producto por una razon concreta:
 * si cada uno trae su propia copia, nueve archivos se van a diferenciar en nueve
 * commits y un token nuevo llega a seis de nueve. Al montarlo desde aqui, el
 * producto lo pide por URL (`/amigo.css`) y todos toman el mismo archivo.
 *
 * Se resuelve desde este archivo con `import.meta.url`, asi que funciona igual
 * desde `src` con tsx que desde `dist`: no hay dos rutas que mantener.
 */
const sharedAssetsDir = fileURLToPath(new URL('../public', import.meta.url));

/**
 * Levanta una aplicacion AMG completa.
 *
 * El orden de los middleware es el que da las garantias:
 *
 *   1. `/health` y `/api/meta` antes de la identidad, para que el orquestador
 *      pueda preguntar si el contenedor vive sin tener sesion.
 *   2. la identidad del Core, que deja `req.amg` o manda al login central.
 *   3. los routers del producto, que solo ven peticiones con `req.amg`.
 *
 * Si alguien montara un router antes del paso 2, tendria `req.amg` undefined y
 * `orgId()` lo rechazaria con 401: es un fallo ruidoso, no una fuga.
 */
export function createProductApp(def: ProductDefinition, env: NodeJS.ProcessEnv = process.env): BuiltProduct {
  const config = loadProductConfig(def.slug, def.name, env);
  const handleDb = openProductDb(config, {
    ddl: def.ddl,
    schema: def.schema,
    migrations: def.migrations,
  });

  const ctx: ProductContext = { config, db: handleDb, handle: { db: handleDb.db } };
  if (def.seed) def.seed(ctx);

  const app = express();
  app.disable('x-powered-by');
  app.locals.product = def.slug;
  if (config.isProd) app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: def.rateLimitPer15Min ?? 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  // 1. Salud. Sin sesion y sin detalle del error: /health responde por internet.
  const health = (_req: express.Request, res: express.Response) => {
    try {
      handleDb.sqlite.prepare('SELECT 1').get();
      res.json({ ok: true, product: def.slug, name: def.name });
    } catch {
      res.status(503).json({ ok: false, product: def.slug });
    }
  };
  app.get('/health', health);
  app.post('/health', health);
  app.get('/api/meta', (_req, res) =>
    res.json({ name: def.name, product: def.slug, version: 2, identity: 'amg-central' }),
  );

  if (def.staticDir) {
    const dir = path.resolve(def.staticDir);
    // El shell se sirve DESPUES de la identidad (abajo), no antes: una pagina
    // de login o un alta interna no deberian ser descargables por cualquiera.
    app.locals.staticDir = dir;
  }

  // 2. Identidad central. A partir de acá, todo pide sesion AMG.
  const auth = mountAmgProductAuth(
    def.slug,
    {
      publicPaths: def.publicPaths ?? def.auth?.publicPaths,
      productName: def.name,
    },
    env,
  );
  app.use(auth.handler);
  app.use(auth.router);

  // 3. Routers del producto.
  for (const router of def.routes(ctx)) {
    app.use(router);
  }

  // 4. La UI, que tambien pide sesion: sin ella no hay ni el HTML.
  // La hoja compartida va antes que el `public` del producto: mismo nombre en
  // los dos, gana la de la plataforma para que el estilo no se pueda bifurcar.
  app.use(express.static(sharedAssetsDir, { index: false, fallthrough: true, maxAge: config.isProd ? '1h' : 0 }));
  if (app.locals.staticDir) {
    const dir = app.locals.staticDir as string;
    app.use(express.static(dir, { index: false }));
    app.get('/', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use(notFound);
  app.use(errorHandler);
  return { app, config, db: handleDb };
}

/** Arranque estandar de un producto. */
export function startProduct(def: ProductDefinition, staticDir?: string): void {
  const definition: ProductDefinition = staticDir ? { ...def, staticDir } : def;
  const { app, config } = createProductApp(definition);
  app.listen(config.port, () => {
    logger.info(`${definition.name} (${definition.slug}) en ${config.appUrl} -> puerto ${config.port}`);
    logger.info(`Identidad y suscripciones: ${config.coreUrl}`);
  });
}
