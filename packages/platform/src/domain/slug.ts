import { randomBytes } from 'node:crypto';

/**
 * Convierte un nombre de negocio en un slug legible y estable.
 * "Mi Empresa" -> "mi-empresa". Sin acentos, sin simbolos, max 40 caracteres.
 */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'org';
}

/**
 * Sufijo corto y aleatorio para resolver colisiones de slug.
 * Se usa crypto y no un contador: no revela cuantos clientes hay.
 */
export function slugSuffix(): string {
  return randomBytes(3).toString('hex');
}
