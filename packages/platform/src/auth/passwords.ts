import bcrypt from 'bcryptjs';
import { z } from 'zod';

const ROUNDS = 10;

/** bcrypt nunca mas de 72 bytes: cortamos, igual que hacen los demas. */
function normalize(password: string): string {
  return Buffer.from(password, 'utf8').subarray(0, 72).toString('utf8');
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(normalize(password), ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(normalize(password), hash);
}

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres')
  .max(200, 'La contraseña es demasiado larga');

export const registerPasswordSchema = passwordSchema.refine(
  (v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v),
  'La contraseña debe combinar letras y números',
);
