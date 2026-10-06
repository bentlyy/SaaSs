import type { Request, RequestHandler, Response } from 'express';
import type { AmgErrorReason, AmgResolvedConfig } from './config.js';
import { exchangeCode, introspect, verifyIdentity, type AmgIdentity } from './identity.js';
import { buildLoginUrl, describeReason, isSafeReturnTo, redirectUriFor } from './login.js';
import { errorPage } from './page.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identidad del usuario en ESTE producto, ya validada por el Core. */
      amg?: AmgIdentity;
    }
  }
}

const ROLE_RANK: Record<string, number> = { member: 1, admin: 2, owner: 3 };

export interface MountOptions {
  /** Rutas públicas del producto (health, /auth/*, webhooks). Sin sesión no entran. */
  publicPaths?: (string | RegExp)[];
  /** Páginas de error propias del producto, si el default no alcanza. */
  renderError?: (req: Request, res: Response, reason: AmgErrorReason) => void;
  /** Nombre para los títulos de error. */
  productName?: string;
}

const PREFIX = '[amg]';

function matches(patterns: (string | RegExp)[], path: string): boolean {
  return patterns.some((p) => (typeof p === 'string' ? path === p || path.startsWith(`${p}/`) : p.test(path)));
}

function readCookie(req: Request, name: string): string | undefined {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[name];
  if (typeof raw === 'string' && raw) return raw;
  // Respaldo para productos que no montan cookie-parser.
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function setSessionCookie(res: Response, config: AmgResolvedConfig, token: string): void {
  res.cookie?.(config.sessionCookie, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    path: '/',
    maxAge: config.sessionDays * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res: Response, config: AmgResolvedConfig): void {
  res.clearCookie?.(config.sessionCookie, { path: '/' });
}

/**
 * Monta la identidad de AMG en un producto.
 *
 * Qué hace, en orden:
 *  1. `GET /auth/callback` canjea el código del Core y abre la sesión local.
 *  2. `GET /auth/logout` cierra la sesión local.
 *  3. En el resto de las rutas, valida la cookie contra el secreto del producto
 *     y pone `req.amg` con user_id / organization_id / role.
 *  4. Si no hay sesión válida, redirige al login del Core y vuelve con
 *     `?return_to=` a donde el usuario estaba.
 *
 * Lo que NO hace, a propósito: no hay `users` ni contraseñas en el producto.
 * `tenant_id` en las tablas del producto = `req.amg!.organizationId`.
 */
export function mountAmgAuth(config: AmgResolvedConfig, options: MountOptions = {}): RequestHandler {
  const publicPaths = options.publicPaths ?? ['/health', '/auth', '/webhooks', '/favicon.ico'];

  /**
   * ¿Va una respuesta JSON o una redirección?
   *
   * Una API responde 401 con el loginUrl en el cuerpo; una pagina navega al
   * login. Lo decide el `Accept` y, sobre todo, que el camino sea de API: un
   * fetch del navegador manda un Accept comodin, que `accepts('html')` lo daria
   * por HTML, y el fetch se comeria un 302 con la pagina de login del Core en
   * lugar de un 401. Por eso `/api/` siempre es JSON.
   */
  const wantsJson = (req: Request): boolean => !req.accepts('html') || req.path.startsWith('/api/');

  const renderError =
    options.renderError ??
    ((req, res, reason) => {
      const loginUrl = buildLoginUrl(config, req.originalUrl, req.originalUrl);
      if (wantsJson(req)) {
        res.status(401).json({ error: reason, message: describeReason(reason), loginUrl });
        return;
      }
      res
        .status(reason === 'sin-acceso' ? 403 : 401)
        .type('html')
        .send(
          errorPage({
            title: reason === 'sin-acceso' ? 'Sin acceso' : 'Iniciá sesión',
            message: describeReason(reason),
            loginUrl,
            productName: options.productName,
          }),
        );
    });

  const requireAuth: RequestHandler = (req, res, next) => {
    if (matches(publicPaths, req.path)) return next();
    if (req.amg) return next();

    const token = readCookie(req, config.sessionCookie);
    if (!token) {
      if (req.method === 'GET' && !wantsJson(req)) {
        return res.redirect(302, buildLoginUrl(config, req.originalUrl));
      }
      return res.status(401).json({
        error: 'sin-sesion',
        message: 'Tu sesión expiró o no existe. Iniciá sesión para continuar.',
        loginUrl: buildLoginUrl(config, req.originalUrl),
      });
    }

    const verified = verifyIdentity(token, config);
    if (!verified.ok) {
      // Token viejo (emitido antes de un cambio de secreto), de otro producto o
      // manipulado: no es un error del usuario, así que limpiamos la cookie y
      // lo mandamos al login otra vez.
      clearSessionCookie(res, config);
      if (req.method === 'GET' && !wantsJson(req)) {
        return res.redirect(302, buildLoginUrl(config, req.originalUrl));
      }
      return res.status(401).json({
        error: verified.reason,
        message: describeReason(verified.reason),
        loginUrl: buildLoginUrl(config, req.originalUrl),
      });
    }

    req.amg = verified.identity;
    // Re-validación opcional contra el Core (ABMG_SSO_INTROSPECT=1): si el Core
    // dice que la sesión central o la suscripción ya no están, se corta acá.
    if (config.introspect) {
      introspect(token, config)
        .then((result) => {
          if (result.ok && result.active) return next();
          clearSessionCookie(res, config);
          renderError(req, res, result.ok ? 'sin-acceso' : 'core-caido');
        })
        .catch(() => next());
      return;
    }
    return next();
  };

  const callback: RequestHandler = (req, res) => {
    void (async () => {
      const code = typeof req.query.code === 'string' ? req.query.code : undefined;
      const state = typeof req.query.state === 'string' ? req.query.state : undefined;
      if (!code) return res.status(400).send(errorPage({ title: 'Falta el código', message: 'Volvé a iniciar sesión.', loginUrl: buildLoginUrl(config, '/'), productName: options.productName }));

      const exchanged = await exchangeCode(code, config, redirectUriFor(config));
      if (!exchanged.ok) {
        // Un límite de solicitudes (429) o un Core momentáneamente caído no son un
        // callejón sin salida: el código ya se gastó, así que el reintento tiene que
        // volver a arrancar el authorize completo, no repetir este callback.
        const transitorio = exchanged.status === 429 || exchanged.status === 503;
        return res.status(exchanged.status ?? 400).send(
          errorPage({
            title: 'No pudimos iniciar sesión',
            message: exchanged.reason,
            retryUrl: transitorio ? buildLoginUrl(config, isSafeReturnTo(state) ? state : '/') : undefined,
            retryAfterSeconds: exchanged.retryAfterSeconds,
            productName: options.productName,
          }),
        );
      }
      setSessionCookie(res, config, exchanged.accessToken);
      if (state && isSafeReturnTo(state)) return res.redirect(302, state);
      res.redirect(302, '/');
    })();
  };

  const logout: RequestHandler = (_req, res) => {
    clearSessionCookie(res, config);
    res.redirect(302, `${config.coreUrl}/api/logout?redirect=${encodeURIComponent(config.productUrl)}`);
  };

  // El callback y el logout se resuelven acá mismo, antes del guard: si no,
  // el guard los mandaría al login y nunca funcionarían.
  return (req, res, next) => {
    if (req.path === config.callbackPath) return callback(req, res, next);
    if (req.path === '/auth/logout') return logout(req, res, next);
    return requireAuth(req, res, next);
  };
}

/** Atajo para el patrón común: el producto pide la identidad y la usa. */
export function identity(req: Request): AmgIdentity {
  if (!req.amg) throw new Error('identity() se llamó en una ruta sin mountAmgAuth()');
  return req.amg;
}

/** Para rutas que necesitan como mínimo un rol. */
export function requireRole(minimum: 'member' | 'admin' | 'owner'): RequestHandler {
  return (req, res, next) => {
    if (!req.amg) {
      return res.status(401).json({
        error: 'sin-sesion',
        message: 'Necesitás iniciar sesión para continuar.',
        loginUrl: undefined,
      });
    }
    if ((ROLE_RANK[req.amg.role] ?? 0) < ROLE_RANK[minimum]) {
      return res.status(403).json({ error: 'rol-insuficiente', necesario: minimum, actual: req.amg.role });
    }
    return next();
  };
}
