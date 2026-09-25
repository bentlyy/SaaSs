import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Clientes registrados / llaves de acceso de la suite.
 *
 * La "puerta" se apoya en el file ops/clients.json montado en /app/clients.json.
 * Se re-lee en CADA login para que editar el archivo en el servidor active o
 * pause a un cliente al instante, sin rebuild ni reinicio de servicios.
 *
 * En produccion la puerta falla CERRADA. Antes era al reves: si el archivo
 * faltaba o estaba corrupto, la puerta se abia y cualquiera podía registrarse
 * gratis. Con clientes pagando, un archivo borrado por error o un despliegue a
 * medias no puede significar "entra todo el mundo": significa "no entra nadie" y
 * un aviso claro en el log. En desarrollo sigue abierta si no hay archivo, para
 * no tener que crear un clients.json cada vez que se levanta en local.
 */
export interface ClientsFile {
  /**
   * true = puerta activa y se exige estar en la lista.
   * En produccion cualquier otro valor deja la puerta cerrada.
   */
  enabled?: boolean;
  /** slug por producto (cada app tiene su propio SQLite y sus propios slugs). */
  clients?: Record<string, string[]>;
}

/** Por qué la puerta quedó como quedó. Se loguea y se expone en /health. */
export type GateSource = 'archivo' | 'desactivado' | 'faltante' | 'invalido';

export interface GateState {
  /** true = la puerta exige estar en la lista para entrar. */
  cerrada: boolean;
  source: GateSource;
  /** Lista cargada. Vacia cuando la configuracion no es utilizable. */
  clients: Record<string, string[]>;
  /** Detalle del problema, para logs. Nunca se expone por HTTP. */
  detalle?: string;
}

function clientsFilePath(): string {
  return process.env.CLIENTS_FILE ?? resolve('/app/clients.json');
}

function esProduccion(): boolean {
  return process.env.NODE_ENV === 'production';
}

const ABIERTA: GateState = { cerrada: false, source: 'faltante', clients: {} };

/**
 * Lee la configuracion y decide si la puerta queda abierta o cerrada.
 * En produccion solo `enabled: true` la deja operativa.
 */
export function loadGate(): GateState {
  const file = clientsFilePath();

  if (!existsSync(file)) {
    return esProduccion()
      ? { cerrada: true, source: 'faltante', clients: {}, detalle: `no existe ${file}` }
      : ABIERTA;
  }

  let parsed: ClientsFile;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as ClientsFile;
  } catch (e) {
    return esProduccion()
      ? { cerrada: true, source: 'invalido', clients: {}, detalle: (e as Error).message }
      : ABIERTA;
  }

  if (parsed.enabled === true) {
    return { cerrada: true, source: 'archivo', clients: parsed.clients ?? {} };
  }
  if (!esProduccion()) {
    return { cerrada: false, source: 'desactivado', clients: parsed.clients ?? {} };
  }

  // Produccion con enabled:false, ausente o de otro tipo: la puerta queda
  // cerrada. Agregar o quitar clientes se hace en la lista, no apagandola.
  return {
    cerrada: true,
    source: 'desactivado',
    clients: {},
    detalle: 'enabled no es true; en produccion la puerta queda cerrada',
  };
}

let avisado = false;

/**
 * Igual que loadGate(), pero avisa por consola UNA vez si la configuracion esta
 * rota. Sin esto el operador se entera del problema cuando un cliente dice que
 * no puede entrar, y no cuando ocurre.
 */
export function gate(): GateState {
  const estado = loadGate();
  if (estado.cerrada && estado.source !== 'archivo' && !avisado) {
    avisado = true;
    console.error(
      `[clientsGuard] PUERTA CERRADA (${estado.source}): ${estado.detalle ?? 'sin detalle'}. ` +
        'Nadie puede registrarse ni entrar hasta corregir ops/clients.json.',
    );
  }
  return estado;
}

/** Solo para tests: vuelve a permitir el aviso. */
export function resetAvisoPuerta(): void {
  avisado = false;
}

/** true cuando la puerta exige estar en la lista para entrar. */
export function clientGateEnabled(): boolean {
  return gate().cerrada;
}

/**
 * true si (producto, slug) está autorizado.
 *
 * Cuando la configuración no es utilizable la lista llega vacía, así que no
 * entra nadie: ese es el fail-closed de producción.
 */
export function isClientActive(product: string, slug: string): boolean {
  const estado = gate();
  if (!estado.cerrada) return true;
  if (estado.source !== 'archivo') return false;
  return (estado.clients[product] ?? []).includes(slug);
}

/** Resumen para /health. No incluye `detalle` a proposito: /health es publico. */
export function gateResumen(): { cerrada: boolean; source: GateSource } {
  const estado = loadGate();
  return { cerrada: estado.cerrada, source: estado.source };
}
