import type { NextFunction, Request, Response } from 'express';
import type { ZodError } from 'zod';

export class AppError extends Error {
  status: number;
  errors?: unknown;
  constructor(status: number, message: string, errors?: unknown) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

type Handler = (req: Request, res: Response, next: NextFunction) => unknown;

export const asyncHandler = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFound(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, `No existe ${req.method} ${req.path}`));
}

/**
 * Un error de red (SSO caido, base bloqueada) no puede volcar una traza al
 * cliente: /health responde por internet. El detalle va al log del contenedor.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, errors: err.errors });
  }
  if (isZodError(err)) {
    return res.status(400).json({ error: 'Datos inválidos', errors: err.flatten() });
  }
  // Un body que excede el limite de JSON del runtime no es un error interno:
  // es una peticion mal armada que se responde con su codigo de verdad.
  if (isEntityTooLarge(err)) {
    return res.status(413).json({ error: 'La petición es demasiado grande' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

function isZodError(e: unknown): e is ZodError {
  return typeof (e as { name?: string })?.name === 'string' && (e as { name: string }).name === 'ZodError';
}

function isEntityTooLarge(e: unknown): boolean {
  return (e as { type?: string })?.type === 'entity.too.large';
}
