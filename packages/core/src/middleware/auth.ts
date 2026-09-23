import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { AppError, asyncHandler } from '../utils/http.js';

export interface Session {
  userId: string;
  tenantId: string;
  role: 'owner' | 'admin' | 'staff';
  email: string;
  name: string;
  sessionDays: number;
}

declare global {
  namespace Express {
    interface Request {
      session: Session;
      cookies?: Record<string, string>;
    }
  }
}

export function signSession(session: Omit<Session, 'sessionDays'>): string {
  return jwt.sign(session, config.jwtSecret, {
    expiresIn: `${config.sessionDays}d`,
  });
}

export function verifyToken(token: string): Session | null {
  try {
    return jwt.verify(token, config.jwtSecret) as Session;
  } catch {
    return null;
  }
}

export const authRequired = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const token = (req.cookies?.token as string | undefined) ?? authHeaderToken(req);
  const session = token ? verifyToken(token) : null;
  if (!session) throw new AppError(401, 'No autenticado. Inicia sesión.');
  req.session = session;
  next();
});

export function requireRole(...roles: Array<'owner' | 'admin' | 'staff'>) {
  return asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!roles.includes(req.session.role)) {
      throw new AppError(403, 'No tienes permiso para realizar esta acción');
    }
    next();
  });
}

function authHeaderToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}

// helper mínimo para leer cookies sin dependencia extra
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    out[key] = value;
  }
  return out;
}

export const cookieParser = (req: Request, _res: Response, next: NextFunction) => {
  req.cookies = req.cookies ?? parseCookies(req.headers.cookie);
  next();
};