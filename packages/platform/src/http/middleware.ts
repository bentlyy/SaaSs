import type { NextFunction, Request, Response } from 'express';
import { AppError, asyncHandler, cookieParser } from '@saas-mini/core';
import { platformConfig } from '../config.js';
import {
  switchOrganization,
} from '../auth/service.js';
import { touchSession, verifySessionToken, type VerifiedSession } from '../domain/sessions.js';
import { canManageOrganization, atLeast, type Role } from '../domain/roles.js';

export { cookieParser };

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Sesión central verificada contra core.sqlite. NUNCA se arma desde el cliente. */
      amg?: VerifiedSession;
    }
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: platformConfig.isProd,
    path: '/',
    // Sin `domain`: cookie host-only. Si se compartiera con `.amgdeveloper.cl`,
    // cualquier subdominio comprometido podría plantar una cookie para todos.
    maxAge: platformConfig.sessionDays * 86_400_000,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(platformConfig.sessionCookie, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(platformConfig.sessionCookie, { path: '/' });
}

/**
 * Exige sesión central.
 *
 * En una API JSON contesta 401. En una navegación de página redirige al login
 * del Core con `return_url`: es lo que hace que entrar a inventario.amgdeveloper.cl
 * sin sesión termine en el login y vuelva a donde el usuario quería.
 */
export const authRequired = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const token = (req.cookies?.[platformConfig.sessionCookie] as string | undefined) ?? bearerToken(req);
  const check = verifySessionToken(token);
  if (!check.ok) {
    if (wantsHtml(req)) {
      const back = encodeURIComponent(originalUrl(req));
      return res.redirect(302, `${platformConfig.coreUrl}/login?return_url=${back}`);
    }
    throw new AppError(401, 'No autenticado. Inicia sesión.');
  }
  req.amg = check;
  touchSession(check.sessionId);
  next();
});

/** Igual que authRequired pero sin redirigir: para /api que devuelven JSON. */
export const sessionFromRequest = (req: Request): VerifiedSession | null => {
  const token = (req.cookies?.[platformConfig.sessionCookie] as string | undefined) ?? bearerToken(req);
  const check = verifySessionToken(token);
  return check.ok ? check : null;
};

export function requireRole(...roles: Role[]) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.amg) throw new AppError(401, 'No autenticado. Inicia sesión.');
    if (!roles.some((role) => atLeast(req.amg!.role, role))) {
      throw new AppError(403, 'No tienes permiso para realizar esta acción');
    }
    next();
  });
}

export const requireOrgAdmin = requireRole('admin');
export const requireOwner = requireRole('owner');

/** Reexportado para que los routers no importen dos rutas distintas. */
export { canManageOrganization, switchOrganization };

function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

function wantsHtml(req: Request): boolean {
  if (req.path.startsWith('/api/')) return false;
  const accept = req.headers.accept ?? '';
  return accept.includes('text/html');
}

function originalUrl(req: Request): string {
  const full = req.originalUrl || req.url;
  return full.startsWith('/') ? full : '/';
}
