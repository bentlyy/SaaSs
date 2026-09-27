import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError, asyncHandler } from '@saas-mini/core';
import { platformConfig } from '../config.js';
import { sessionFromRequest } from './middleware.js';
import { authorize, exchangeCode, introspectToken } from '../sso/service.js';
import { findSsoClient } from '../sso/registry.js';

/**
 * SSO. Tres endpoints y nada más:
 *
 *   GET  /api/sso/authorize   → el subdominio manda al usuario al Core
 *   POST /api/sso/token       → el subdominio canjea el código por un token
 *   POST /api/sso/introspect  → el subdominio pregunta si el token sigue vivo
 *
 * El subdominio nunca recibe la contraseña ni la cookie del Core.
 */
export const ssoRouter = Router();

const ssoLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de acceso. Espera un momento.' },
});
const guard = platformConfig.isProd
  ? ssoLimiter
  : (_req: Request, _res: Response, next: (err?: unknown) => void) => next();

const authorizeSchema = z.object({
  client_id: z.string().min(1, 'Falta la aplicación'),
  redirect_uri: z.string().url().optional(),
  return_url: z.string().optional(),
  state: z.string().max(500).optional(),
});

/**
 * Paso 1. Contesta con una redirección, nunca con JSON: lo que llama acá es el
 * navegador del usuario, no un backend.
 *
 * - sin sesión del Core → 302 al login del Core con return_url
 * - con sesión, pero sin suscripción → 302 a la página de contratación
 * - con sesión y suscripción → 302 al redirect_uri con `code`
 */
ssoRouter.get(
  '/authorize',
  guard,
  asyncHandler(async (req, res) => {
    const input = authorizeSchema.parse(req.query);
    const outcome = authorize({
      clientId: input.client_id,
      redirectUri: input.redirect_uri,
      returnUrl: input.return_url,
      state: input.state,
      session: sessionFromRequest(req),
    });

    switch (outcome.kind) {
      case 'redirect':
        return res.redirect(302, outcome.location);
      case 'login':
      case 'suspendido':
        return res.redirect(302, outcome.loginUrl);
      case 'sin-acceso':
        return res.redirect(302, appendReason(outcome.location, outcome.reason));
      default:
        res.status(outcome.status);
        return res.type('html').send(errorPage(outcome.status, outcome.message));
    }
  }),
);

const tokenSchema = z.object({
  code: z.string().min(10, 'Falta el código'),
  client_id: z.string().min(1, 'Falta la aplicación'),
  client_secret: z.string().min(8, 'Falta el secreto de la aplicación'),
  redirect_uri: z.string().url().optional(),
});

/** Paso 2. Autenticación de la aplicación con su secreto + canje del código. */
ssoRouter.post(
  '/token',
  guard,
  asyncHandler(async (req, res) => {
    const input = tokenSchema.parse(req.body);
    return res.json(
      exchangeCode({
        code: input.code,
        clientId: input.client_id,
        clientSecret: input.client_secret,
        redirectUri: input.redirect_uri,
      }),
    );
  }),
);

const introspectSchema = z.object({
  token: z.string().min(10),
  client_id: z.string().min(1),
  client_secret: z.string().min(8),
});

/**
 * Paso 3 (opcional). El subdominio puede validar el token solo con su secreto,
 * sin red. Esto es para cuando quiere la autoridad del Core: confirmar que la
 * sesión central sigue viva y que la suscripción no se cayó.
 */
ssoRouter.post(
  '/introspect',
  guard,
  asyncHandler(async (req, res) => {
    const input = introspectSchema.parse(req.body);
    return res.json(introspectToken(input.token, input.client_id, input.client_secret));
  }),
);

/** Configuración pública del cliente: qué redirect_uri acepta el Core. */
ssoRouter.get(
  '/clients/:clientId',
  asyncHandler(async (req, res) => {
    const client = findSsoClient(req.params.clientId);
    if (!client) throw new AppError(404, 'Aplicación no registrada');
    // Sin el secreto: acá solo interesa saber a dónde puede volver el Core.
    return res.json({
      client_id: client.clientId,
      name: client.name,
      status: client.status,
      redirect_uris: client.redirectUris,
    });
  }),
);

function appendReason(location: string, reason: string): string {
  const url = new URL(location);
  url.searchParams.set('aviso', reason.slice(0, 200));
  return url.toString();
}

function errorPage(status: number, message: string): string {
  const escaped = message.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] as string);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>AMG</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#fbf9f6;color:#1b1c1a;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:32rem;padding:2rem;text-align:center}h1{font-size:1.25rem;margin:0 0 .5rem}
p{color:#44474a;line-height:1.5}a{color:#994703}</style></head>
<body><main><h1>No pudimos abrir la aplicación</h1><p>${escaped}</p>
<p><a href="${platformConfig.coreUrl}/mis-aplicaciones">Volver a Mis aplicaciones</a></p></main></body></html>`;
}
