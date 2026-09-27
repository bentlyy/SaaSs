import type { AmgConfig, AmgErrorReason } from './config.js';
import { appendQuery, errorPage } from './page.js';

/**
 * La URL pública del producto, con la que el Core valida el redirect_uri.
 * Sin esto no hay forma de construir la callback correcta.
 */
export function redirectUriFor(config: Pick<AmgConfig, 'productUrl'> & { callbackPath: string }): string {
  return `${config.productUrl.replace(/\/+$/, '')}${config.callbackPath}`;
}

/**
 * A dónde mandamos al usuario que todavía no tiene sesión en el Core.
 *
 * El `return_to` se limita a rutas internas del PRODUCTO: si aceptáramos URLs
 * completas, un atacante podría usar nuestro login como redirector para
 * phishing. Solo se permiten rutas relativas que empiecen por "/" y no por
 * "//" (que el navegador leería como protocolo-relativo, o sea, otro sitio).
 */
export function buildLoginUrl(
  config: Pick<AmgConfig, 'coreUrl' | 'clientId' | 'productUrl'> & { callbackPath: string },
  returnTo?: string,
  state?: string,
): string {
  const params: Record<string, string> = {
    client_id: config.clientId,
    redirect_uri: redirectUriFor(config),
    response_type: 'code',
  };
  if (returnTo && isSafeReturnTo(returnTo)) params.return_to = returnTo;
  if (state) params.state = state;
  // OJO: la ruta es /api/sso/authorize (el router está montado en /api/sso).
  // Con `/sso/authorize` el Core responde 404 y el usuario queda trabado.
  return appendQuery(`${config.coreUrl}/api/sso/authorize`, params);
}

/** ¿Es seguro mandar al usuario a `returnTo`? */
export function isSafeReturnTo(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value.startsWith('/')) return false;
  if (value.startsWith('//')) return false;
  if (value.includes('\\')) return false;
  return true;
}

const MESSAGES: Record<AmgErrorReason, string> = {
  'sin-config': 'Este producto no está configurado para usar el inicio de sesión de AMG.',
  'sin-sesion': 'Tu sesión no está iniciada.',
  expirada: 'Tu sesión venció. Volvé a entrar para seguir.',
  audiencia: 'El inicio de sesión no corresponde a este producto.',
  invalido: 'No pudimos validar tu sesión. Volvé a entrar.',
  'sin-acceso': 'Tu organización no tiene acceso a este producto.',
  'core-caido': 'No pudimos contactar al servidor de acceso. Probá en unos segundos.',
  'otro-producto': 'Ese inicio de sesión es de otro producto.',
};

export function describeReason(reason: AmgErrorReason): string {
  return MESSAGES[reason] ?? MESSAGES.invalido;
}

export { errorPage };
