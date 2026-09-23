import { randomUUID } from 'node:crypto';

export function createId(prefix = 'id'): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}