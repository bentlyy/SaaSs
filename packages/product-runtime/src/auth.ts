import { eq } from 'drizzle-orm';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import {
  loadConfig,
  mountAmgAuth,
  requireRole as amgRequireRole,
  type AmgIdentity,
  type AmgResolvedConfig,
} from '@amg/auth-client';
import { AppError } from './errors.js';

/**
 * Identidad y organizacion.
 *
 * `req.amg` lo pone `@amg/auth-client` despues de validar la cookie contra el
 * secreto del producto. A partir de ahi, TODO lo que el producto lee o escribe
 * se filtra por `organizationId`.
 *
 * La regla que hace que esto no se rompa en seis meses: `organizationId` sale
 * SIEMPRE de la sesion y NUNCA del cuerpo, de la query o de un header. Si un
 * endpoint lo aceptara del cliente, bastaria cambiar un id en la URL para leer
 * los datos de otra empresa.
 */
export interface Identity {
  userId: string;
  organizationId: string;
  organizationSlug: string;
  role: 'member' | 'admin' | 'owner';
  email: string;
  name: string;
  product: string;
  sessionId: string;
}

export function identity(req: Request): Identity {
  const amg = req.amg as AmgIdentity | undefined;
  if (!amg) {
    throw new AppError(401, 'No autenticado. Entra por el login de AMG.');
  }
  return amg as unknown as Identity;
}

/** El id de organizacion de la sesion. Es el unico que se usa para filtrar. */
export function orgId(req: Request): string {
  return identity(req).organizationId;
}

/**
 * Filtro obligatorio de organizacion, para usar en el `where` de TODA consulta.
 *
 * `column` es la columna `organization_id` de la tabla, pasada por el producto:
 * `orgFilter(req, inventoryItems.organizationId)`.
 */
export function orgFilter(req: Request, column: any) {
  return eq(column, orgId(req));
}

export interface MountAuthOptions {
  /** Rutas publicas del producto: health, /auth/*, webhooks, favicon. */
  publicPaths?: (string | RegExp)[];
  productName?: string;
}

export interface MountedAuth {
  config: AmgResolvedConfig;
  /** Middleware: valida la cookie, canjea el callback y redirige al login central. */
  handler: RequestHandler;
  /** `GET /api/me`: quien es el usuario y de que organizacion. */
  router: Router;
}

/**
 * Monta la identidad del Core y expone `GET /api/me`.
 *
 * No hay mas login aca: si el producto no tiene sesion, el middleware manda al
 * login central con `return_to` para que el usuario vuelva donde estaba.
 */
export function mountAmgProductAuth(
  slug: string,
  options: MountAuthOptions = {},
  env: NodeJS.ProcessEnv = process.env,
): MountedAuth {
  const config = loadConfig(env, slug);
  const handler = mountAmgAuth(config, {
    publicPaths: options.publicPaths ?? ['/health', '/auth', '/webhooks', '/favicon.ico'],
    productName: options.productName ?? slug,
  });

  const router = Router();
  router.get('/api/me', (req: Request, res: Response) => {
    const me = identity(req);
    res.json({
      user: { id: me.userId, email: me.email, name: me.name },
      organization: { id: me.organizationId, slug: me.organizationSlug },
      role: me.role,
      product: me.product,
    });
  });

  return { config, handler, router };
}

/** Minimo `admin` para escribir. Los tres roles de plataforma. */
export function requireRole(minimum: 'member' | 'admin' | 'owner'): RequestHandler {
  return amgRequireRole(minimum);
}
