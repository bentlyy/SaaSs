import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Clientes registrados / llaves de acceso de la suite.
 *
 * La "puerta" se apoya en el file ops/clients.json montado en /app/clients.json.
 * Se re-lee en CADA login para que editar el archivo en el servidor active o
 * pause a un cliente al instante, sin rebuild ni reinicio de servicios.
 */
export interface ClientsFile {
  /** true = puerta activa. Si falta o es false, todo queda abierto. */
  enabled?: boolean;
  /** slug por producto (cada app tiene su propio SQLite y sus propios slugs). */
  clients?: Record<string, string[]>;
}

function clientsFilePath(): string {
  return process.env.CLIENTS_FILE ?? resolve('/app/clients.json');
}

export function loadClientsFile(): ClientsFile {
  const file = clientsFilePath();
  try {
    if (!existsSync(file)) return {};
    return JSON.parse(readFileSync(file, 'utf8')) as ClientsFile;
  } catch {
    return {};
  }
}

/** true cuando la puerta está encendida. */
export function clientGateEnabled(): boolean {
  return loadClientsFile().enabled === true;
}

/**
 * true si (producto, slug) está autorizado. Si la puerta está apagada o el
 * archivo no existe, todo pasa.
 */
export function isClientActive(product: string, slug: string): boolean {
  const file = loadClientsFile();
  if (file.enabled !== true) return true;
  return (file.clients?.[product] ?? []).includes(slug);
}