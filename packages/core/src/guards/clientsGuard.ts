import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * QUIEN DECIDE SI UN PRODUCTO SE ABRE, Y CUAL DE LOS DOS MECANISMOS MANDA
 * ======================================================================
 *
 * Hay dos listas distintas y antes se confundian:
 *
 *  1. `core.sqlite` -> `subscriptions`. Es la fuente de verdad COMERCIAL.
 *     La paga el cliente, la renueva, la cancela. Vive en el Core y la
 *     consultan el SSO y las rutas del producto.
 *
 *  2. `ops/clients.json`. Es control TECNICO: apagar un producto con una
 *     linea, sin deploy y sin esperar un ciclo de facturacion. Es una
 *     llave de emergencia, no un negocio.
 *
 * La confusion era que `enabled: false` significaba dos cosas opuestas
 * segun quien lo mirara. Para el operador era "no moleste, todo abierto";
 * para el codigo en produccion era "cerrada, no entra nadie". Un archivo
 * con `enabled:false` y una lista de clientes llenisima al lado dejaba a
 * production con la puerta cerrada y sin explicar por que.
 *
 * Ahora el archivo dice QUE MODO ES y no hay lectura ambigua:
 *
 *   mode: "allowlist"     la lista manda. Alta/baja de clientes a mano.
 *                         Es el unico modo que sirve para un producto que
 *                         todavia no consulta suscripciones.
 *   mode: "subscriptions" la lista NO manda: decide `subscriptions` en el
 *                         Core. Exige que el contenedor lo confirme con
 *                         CLIENTS_GATE=subscriptions, porque un producto que
 *                         no mira suscripciones no puede quedar abierto
 *                         por un archivo.
 *
 * Y el mas restrictivo gana: si el archivo pide "subscriptions" pero el
 * contenedor no lo confirmó, se usa la lista. Jamas se abre una puerta que
 * nadie esta vigilando.
 *
 * `enabled` se sigue aceptando por compatibilidad, pero `enabled:false` sin
 * `mode` es una configuracion INVALIDA: en produccion cierra igual que antes
 * (fail-closed, no se regala acceso), pero avisando que el problema es el
 * archivo y no la base.
 *
 * En produccion la puerta falla CERRADA. Antes era al reves: si el archivo
 * faltaba o estaba corrupto, la puerta se abia y cualquiera podia registrarse
 * gratis. Con clientes pagando, un archivo borrado por error o un despliegue a
 * medias no puede significar "entra todo el mundo": significa "no entra nadie" y
 * un aviso claro en el log. En desarrollo sigue abierta si no hay archivo, para
 * no tener que crear un clients.json cada vez que se levanta en local.
 */
export interface ClientsFile {
  /**
   * Como decide el acceso este producto. Es lo unico que la implementacion
   * mira; sin `mode` el archivo no es utilizable en produccion.
   */
  mode?: 'allowlist' | 'subscriptions';
  /**
   * @deprecated Ambiguo por diseno. `true` equivale a `mode: "allowlist"`.
   * `false` sin `mode` es configuracion invalida y cierra la puerta avisando.
   */
  enabled?: boolean;
  /** slug por producto (cada app tiene su propio SQLite y sus propios slugs). */
  clients?: Record<string, string[]>;
}

/** Por que la puerta quedo como quedo. Se loguea y se expone en /health. */
export type GateSource = 'archivo' | 'suscripciones' | 'desactivado' | 'faltante' | 'invalido';

export type GateMode = 'allowlist' | 'subscriptions' | 'ninguno';

export interface GateState {
  /** true = la puerta exige estar en la lista para entrar. */
  cerrada: boolean;
  source: GateSource;
  /** Modo efectivo, ya resuelto contra la confirmacion del contenedor. */
  mode: GateMode;
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

/**
 * El contenedor dice si este producto REALLY consulta suscripciones.
 *
 * Sin esta confirmacion, `mode:"subscriptions"` se ignora: el archivo podria
 * abrirle el producto a internet a un producto que nunca mira el Core, y ahi
 * no hay nadie que lo vuelva a cerrar.
 */
function contenedorConfirmaSuscripciones(): boolean {
  return process.env.CLIENTS_GATE === 'subscriptions';
}

const ABIERTA: GateState = { cerrada: false, source: 'faltante', mode: 'ninguno', clients: {} };

/** Traduce el archivo (posiblemente viejo) a un modo, o null si no es usable. */
function modoDeclarado(parsed: ClientsFile): GateMode | null {
  if (parsed.mode === 'allowlist' || parsed.mode === 'subscriptions') return parsed.mode;
  // `enabled` solo: vale para abrir la lista. `false` a secas no declara nada.
  if (parsed.enabled === true) return 'allowlist';
  if (parsed.enabled === false) return null;
  return null;
}

/**
 * Lee la configuracion y decide si la puerta queda abierta o cerrada.
 * En produccion hace falta un `mode` explicito (o `enabled:true` de legacy).
 */
export function loadGate(): GateState {
  const file = clientsFilePath();

  if (!existsSync(file)) {
    return esProduccion()
      ? {
          cerrada: true,
          source: 'faltante',
          mode: 'ninguno',
          clients: {},
          detalle: `no existe ${file}`,
        }
      : ABIERTA;
  }

  let parsed: ClientsFile;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8')) as ClientsFile;
  } catch (e) {
    return esProduccion()
      ? {
          cerrada: true,
          source: 'invalido',
          mode: 'ninguno',
          clients: {},
          detalle: (e as Error).message,
        }
      : ABIERTA;
  }

  const modo = modoDeclarado(parsed);

  if (modo === null) {
    // No es produccion: la puerta no molesta, como antes.
    if (!esProduccion()) {
      return { cerrada: false, source: 'desactivado', mode: 'ninguno', clients: parsed.clients ?? {} };
    }
    return {
      cerrada: true,
      source: 'invalido',
      mode: 'ninguno',
      clients: {},
      detalle:
        parsed.enabled === false
          ? 'enabled:false no significa nada: define mode ("allowlist" o "subscriptions")'
          : 'falta mode (y enabled no es true)',
    };
  }

  // Pide decidir el Core. Solo vale si el contenedor lo confirma.
  if (modo === 'subscriptions') {
    if (contenedorConfirmaSuscripciones()) {
      return { cerrada: false, source: 'suscripciones', mode: 'subscriptions', clients: {} };
    }
    // En desarrollo no hay nada que proteger: la puerta no molesta.
    if (!esProduccion()) {
      return { cerrada: false, source: 'desactivado', mode: 'ninguno', clients: {} };
    }
    // El archivo se equivoco de fe. Mandamos la lista, que es lo mas cerrado.
    return {
      cerrada: true,
      source: 'archivo',
      mode: 'allowlist',
      clients: parsed.clients ?? {},
      detalle:
        'mode:"subscriptions" ignorado: el contenedor no viene con CLIENTS_GATE=subscriptions, ' +
        'asi que este producto no consulta el Core y se usa la lista',
    };
  }

  return { cerrada: true, source: 'archivo', mode: 'allowlist', clients: parsed.clients ?? {} };
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
  if (estado.detalle && !avisado) {
    avisado = true;
    console.warn(`[clientsGuard] ${estado.detalle}`);
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
 * En modo "subscriptions" esto devuelve true siempre: no es esta lista la que
 * dice. Quien decide es `subscriptions` en el Core, que consulta el SSO al
 * entrar y las rutas en cada request.
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
export function gateResumen(): { cerrada: boolean; source: GateSource; mode: GateMode } {
  const estado = loadGate();
  return { cerrada: estado.cerrada, source: estado.source, mode: estado.mode };
}
