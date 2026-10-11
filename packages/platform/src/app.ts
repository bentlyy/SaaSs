import express, { type Express } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import {
  errorHandler,
  notFound,
  logger,
  assetVersion,
  htmlPages,
  assetHeaders,
  AppError,
  ASSET_MAX_AGE_MS,
  HTML_CACHE_CONTROL,
} from '@saas-mini/core';
import { platformConfig } from './config.js';
import { clearSessionCookie, cookieParser, sessionFromRequest } from './http/middleware.js';
import { authRouter } from './http/auth-routes.js';
import { logout } from './auth/service.js';
import { safeReturnUrl } from './sso/service.js';
import { accountRouter } from './http/account-routes.js';
import { productsRouter } from './http/products-routes.js';
import { ssoRouter } from './http/sso-routes.js';
import { getCoreDb } from './db/init.js';
import { countOrganizations } from './domain/organizations.js';
import { countUsers } from './domain/users.js';
import { ensurePlatformSeed } from './seed.js';
import { confirmCheckout } from './billing/checkout.js';
import { obtenerProveedor } from './billing/index.js';
import { MercadoPagoProvider } from './billing/mercadopago.js';

/** Request con el cuerpo crudo que deja `express.json({ verify })`. */
type RequestWithRawBody = express.Request & { rawBody?: string };

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
  // `verify` deja el cuerpo crudo para el webhook de MercadoPago: la firma se
  // calcula sobre los bytes exactos que llegaron, no sobre una re-serialización.
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => { if (buf.length > 0) (req as RequestWithRawBody).rawBody = buf.toString('utf8'); },
  }));
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

  /**
   * WEBHOOK DE MERCADO PAGO
   *
   * La notificación solo dice "hubo un pago". La URL pública es un bocinazo:
   * cualquiera puede llamarla. Por eso este handler, antes de tocar base de
   * datos, (1) si hay `MERCADOPAGO_WEBHOOK_SECRET` verifica la firma HMAC y
   * (2) SIEMPRE re-consulta el pago a MP con nuestro token y comprueba que
   * `external_reference` sea la nuestra. Sin secreto no se confía en el cuerpo
   * del webhook: la garantía es la respuesta autenticada de MP.
   *
   * Respuestas: 2xx para MP = "procesado, no vuelvas a insistir". Un 5xx hace
   * que MP reintente (útil si la API de MP falló de forma transitoria); un 4xx
   * (firma inválida, pago no aprobado) también para el reenvío, porque repetir
   * no va a arreglar nada.
   */
  app.post('/api/billing/webhook/mercadopago', (req, res, next) => {
    (async () => {
      const provider = obtenerProveedor('mercadopago');
      if (!(provider instanceof MercadoPagoProvider)) {
        throw new AppError(503, 'La pasarela MercadoPago no está registrada');
      }
      const rawBody = (req as RequestWithRawBody).rawBody ?? '';
      const signature = req.get('x-signature') ?? undefined;
      const requestId = req.get('x-request-id') ?? undefined;

      try {
        const reference = await provider.referenceFromNotification(rawBody, signature, requestId);
        await confirmCheckout({ provider: 'mercadopago', providerReference: reference, rawBody, signature });
      } catch (error) {
        const status = error instanceof AppError ? error.status : 500;
        if (status >= 500) {
          // Error de infraestructura: MP reintentará en unos minutos.
          throw error;
        }
        logger.warn(`Webhook MP descartado: ${error instanceof Error ? error.message : 'desconocido'}`);
      }

      return res.json({ ok: true });
    })().catch(next);
  });

  /**
   * Alias `/api/logout`: los productos (auth-client) redirigen acá desde su
   * `auth/logout` para cerrar la sesión CENTRAL. Sin esta ruta el "Salir"
   * aterrizaba en `404 No existe GET /api/logout` y la sesión seguía viva.
   *
   * GET y POST: el navegador puede llegar por link o por formulario. No exige
   * sesión: cerrar una sesión que ya no existe debe responder igual de bien.
   * El destino se filtra con `safeReturnUrl` (solo hosts de la plataforma): un
   * `redirect` arbitrario convertiría el logout en un open-redirect.
   */
  app.use('/api/logout', (req, res) => {
    const session = sessionFromRequest(req);
    if (session) logout(session.sessionId);
    clearSessionCookie(res);
    const destino = typeof req.query.redirect === 'string' ? req.query.redirect : undefined;
    return res.redirect(302, safeReturnUrl(destino) ?? `${platformConfig.coreUrl}/`);
  });

  if (options.staticDir) {
    const dir = path.resolve(options.staticDir);
    // Con la huella en la URL, `immutable` es seguro: si el archivo cambia, la URL
    // cambia con el. Sin ella, un despliegue no llegaba al navegador hasta que
    // expiraba el TTL de Cloudflare, y peor: mezclaba un JS viejo con uno nuevo.
    const version = assetVersion(dir);
    app.use(
      express.static(dir, {
        index: false,
        // `maxAge` son MILISEGUNDOS, no un `Cache-Control` completo: pasarle el
        // header entero devuelve `undefined` y no escribe nada. El `immutable` va
        // en `setHeaders` abajo. Ver `assetHeaders`.
        maxAge: platformConfig.isProd ? ASSET_MAX_AGE_MS : 0,
        setHeaders(res, filePath) {
          // El HTML se pide siempre: es el que trae el `?v=` de esta entrega.
          if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
            return;
          }
          if (platformConfig.isProd) assetHeaders(res);
        },
      }),
    );

    const leer = htmlPages(dir, version);
    const page = (name: string) => (_req: express.Request, res: express.Response) => {
      res.setHeader('Cache-Control', HTML_CACHE_CONTROL);
      res.type('html').send(leer(name));
    };

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
    app.get('/contratar', page('contratar.html'));

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
