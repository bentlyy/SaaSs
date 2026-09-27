import express, { type Express } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler, notFound, logger } from '@saas-mini/core';
import { platformConfig } from './config.js';
import { cookieParser } from './http/middleware.js';
import { authRouter } from './http/auth-routes.js';
import { accountRouter } from './http/account-routes.js';
import { productsRouter } from './http/products-routes.js';
import { ssoRouter } from './http/sso-routes.js';
import { getCoreDb } from './db/init.js';
import { countOrganizations } from './domain/organizations.js';
import { countUsers } from './domain/users.js';
import { ensurePlatformSeed } from './seed.js';

export interface PlatformAppOptions {
  /** Carpeta con la UI (landing, login, mi cuenta). Opcional: solo API. */
  staticDir?: string;
  /** Rutas de página que exigen sesión del Core. */
  protectedPages?: string[];
}

export function createPlatformApp(options: PlatformAppOptions = {}): Express {
  const app = express();
  getCoreDb();
  ensurePlatformSeed();

  app.disable('x-powered-by');
  if (platformConfig.isProd) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      // El SSO redirige entre el Core y los subdominios: sin esto el navegador
      // bloquea la respuesta por CORS en el canje del código.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser);
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  /**
   * /health responde por internet, así que NO incluye el detalle de los fallos:
   * con eso, un atacante sabría si el problema es el archivo de clientes o la
   * base. Solo dice "anda" o "no anda".
   */
  const health = (_req: express.Request, res: express.Response) => {
    try {
      getCoreDb();
      res.json({ ok: true, service: 'amg-platform', core: platformConfig.coreUrl });
    } catch {
      res.status(503).json({ ok: false, service: 'amg-platform' });
    }
  };
  app.get('/health', health);
  app.post('/health', health);

  app.get('/api/meta', (_req, res) =>
    res.json({
      name: platformConfig.appName,
      core: platformConfig.coreUrl,
      session_days: platformConfig.sessionDays,
      sso_code_ttl: platformConfig.ssoCodeTtlSeconds,
    }),
  );

  // Solo diagnóstico para ops, en local o por header. Jamás en producción.
  app.get('/api/_diagnostico', (req, res) => {
    if (platformConfig.isProd && req.get('x-amg-diagnostico') !== process.env.CORE_DIAGNOSTICO_KEY) {
      return res.status(404).json({ error: 'No existe' });
    }
    return res.json({
      db: platformConfig.dbPath,
      users: countUsers(),
      organizations: countOrganizations(),
    });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/sso', ssoRouter);

  if (options.staticDir) {
    const dir = path.resolve(options.staticDir);
    app.use(
      express.static(dir, {
        index: false,
        setHeaders(res, filePath) {
          // La UI de la plataforma cambia seguido; la API nunca se cachea.
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );

    const page = (name: string) => (_req: express.Request, res: express.Response) =>
      res.sendFile(path.join(dir, name));

    // Público
    app.get('/', page('index.html'));
    app.get('/productos', page('productos.html'));
    app.get('/precios', page('productos.html'));
    app.get('/demos', page('contacto.html'));
    app.get('/contacto', page('contacto.html'));
    app.get('/productos/:slug', page('producto.html'));

    // Autenticación
    app.get('/login', page('auth.html'));
    app.get('/registro', page('auth.html'));
    app.get('/recuperar', page('auth.html'));
    app.get('/reset', page('auth.html'));
    app.get('/verificar-email', page('auth.html'));
    app.get('/invitacion', page('auth.html'));

    // Cuenta (el JS de la página valida la sesión y redirige al login)
    app.get('/mi-cuenta', page('cuenta.html'));
    app.get('/mis-aplicaciones', page('aplicaciones.html'));
    app.get('/contratar', page('aplicaciones.html'));

    for (const protectedPage of options.protectedPages ?? []) {
      app.get(protectedPage, page('aplicaciones.html'));
    }
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export function startPlatform(): void {
  const app = createPlatformApp();
  app.listen(platformConfig.port, () => {
    logger.info(`AMG central en ${platformConfig.coreUrl} (puerto ${platformConfig.port})`);
  });
}
