/**
 * Config del cliente de identidad de AMG, tal como la ve un subdominio.
 *
 * Estas tres variables son TODO lo que un mini-SaaS necesita saber del Core.
 * Notar lo que NO está: ninguna contraseña, ningún usuario, ninguna tabla de
 * cuentas. El producto no tiene usuarios propios.
 */
export interface AmgConfig {
  /** URL pública del Core: https://desarrollo.amgdeveloper.cl */
  coreUrl: string;
  /** URL pública de ESTE producto: https://inventario.amgdeveloper.cl */
  productUrl: string;
  /** Identificador de esta aplicación. Por convención = slug del producto. */
  clientId: string;
  /** Secreto de SSO DERIVADO por el Core para ESTE producto. */
  clientSecret: string;
}

export interface AmgResolvedConfig extends AmgConfig {
  isProd: boolean;
  /** Callback local donde el producto recibe el código: /auth/callback */
  callbackPath: string;
  /** Cookie de sesión propia del producto (httpOnly). */
  sessionCookie: string;
  /** Cuánto vive la sesión de aplicación, en días. */
  sessionDays: number;
  /** Si el token del Core se revalida contra el Core en cada request. */
  introspect: boolean;
}

const DEFAULTS = {
  callbackPath: '/auth/callback',
  sessionCookie: 'app_session',
  sessionDays: 30,
  introspect: false,
};

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, productSlug?: string): AmgResolvedConfig {
  const coreUrl = (env.CORE_URL ?? env.AMG_CORE_URL ?? 'http://localhost:3008').replace(/\/+$/, '');
  const clientId = env.AMG_SSO_CLIENT_ID ?? productSlug ?? '';
  const clientSecret = env.AMG_SSO_CLIENT_SECRET ?? '';
  const productUrl = (env.APP_URL ?? env.PUBLIC_URL ?? '').replace(/\/+$/, '');

  // Fail-fast: un producto sin secreto no puede validar a nadie, y es mejor que
  // no levante en lugar de levantar y dejar entrar a todo el mundo.
  if (!clientId) {
    throw new Error('Falta AMG_SSO_CLIENT_ID: identificá la aplicación (slug del producto)');
  }
  if (!clientSecret) {
    throw new Error(
      `Falta AMG_SSO_CLIENT_SECRET: pedilo con "npm run sso:secret -w @amg/platform -- ${clientId}" y ponelo en el .env de ${clientId}`,
    );
  }
  if (!productUrl) {
    throw new Error(`Falta APP_URL: la URL pública de ${clientId} (ej. https://${clientId}.amgdeveloper.cl)`);
  }

  return {
    coreUrl,
    clientId,
    clientSecret,
    productUrl,
    isProd: env.NODE_ENV === 'production',
    callbackPath: env.AMG_CALLBACK_PATH ?? DEFAULTS.callbackPath,
    sessionCookie: env.AMG_SESSION_COOKIE ?? DEFAULTS.sessionCookie,
    sessionDays: Number(env.AMG_SESSION_DAYS ?? DEFAULTS.sessionDays),
    introspect: bool(env.AMG_SSO_INTROSPECT, DEFAULTS.introspect),
  };
}

/** Scopes de error, para que el producto sepa qué hacer y no inventar. */
export type AmgErrorReason =
  | 'sin-config'
  | 'sin-sesion'
  | 'expirada'
  | 'audiencia'
  | 'invalido'
  | 'sin-acceso'
  | 'core-caido'
  | 'otro-producto';
