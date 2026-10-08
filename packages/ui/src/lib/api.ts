/**
 * Cliente HTTP mínimo contra la API del server.
 *
 * Todo lo que sale de acá va con `credentials: 'same-origin'`, que es lo que
 * hace que el navegador mande la cookie de sesión: sin eso la API responde 401
 * aunque la persona esté adentro, el error clásico de "entra y dice que no".
 *
 * Cuando la sesión central vence, el server responde 401 con `loginUrl` y acá
 * se salta a ese login: sin el salto, quien usa la herramienta ve un error en
 * vez de volver a iniciar sesión. El `throw` posterior evita que la pantalla
 * siga pintando con datos vacíos.
 */

const BASE = '/api';

export class ApiError extends Error {
  status: number;
  detalle?: unknown;
  /** true cuando hubo salto al login central: no conviene pintar el error. */
  vencida?: boolean;

  constructor(status: number, mensaje: string, detalle?: unknown) {
    super(mensaje);
    this.status = status;
    this.detalle = detalle;
  }
}

type Cuerpo = unknown;

async function pedir<T>(method: string, path: string, cuerpo?: Cuerpo): Promise<T> {
  // String y FormData van sin tocar (es lo que usan la subida de archivos y
  // las pocas llamadas que serializan a mano); cualquier objeto se manda JSON.
  const esTexto =
    typeof cuerpo === 'string' || (typeof FormData !== 'undefined' && cuerpo instanceof FormData);
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'same-origin',
    headers: cuerpo === undefined || esTexto ? undefined : { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : esTexto ? (cuerpo as BodyInit) : JSON.stringify(cuerpo),
  });
  const datos = (await res.json().catch(() => ({}))) as Record<string, any>;

  if (res.status === 401 && typeof datos?.loginUrl === 'string') {
    window.location.href = datos.loginUrl;
    const vencida = new ApiError(401, 'Sesión vencida', datos);
    vencida.vencida = true;
    throw vencida;
  }

  if (!res.ok) {
    let mensaje = typeof datos?.error === 'string' ? datos.error : `Algo salió mal (${res.status})`;
    const campos = datos?.errors?.fieldErrors as Record<string, string[]> | undefined;
    if (campos) {
      const partes = Object.entries(campos)
        .filter(([, v]) => Array.isArray(v) && v.length > 0)
        .map(([campo, v]) => `${campo}: ${v.join(' ')}`);
      if (partes.length > 0) mensaje = `${mensaje}: ${partes.join(' · ')}`;
    }
    throw new ApiError(res.status, mensaje, datos);
  }

  return datos as T;
}

export const api = {
  get: <T>(path: string) => pedir<T>('GET', path),
  post: <T>(path: string, cuerpo?: unknown) => pedir<T>('POST', path, cuerpo),
  put: <T>(path: string, cuerpo?: unknown) => pedir<T>('PUT', path, cuerpo),
  patch: <T>(path: string, cuerpo?: unknown) => pedir<T>('PATCH', path, cuerpo),
  delete: <T>(path: string) => pedir<T>('DELETE', path),
};
