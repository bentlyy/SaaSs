import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { logger } from '../logger.js';

/**
 * Huella corta de los archivos de una carpeta, para romper la cache del navegador.
 *
 * El problema que resuelve: los assets se sirven con `max-age=14400` (el Browser
 * Cache TTL por defecto de Cloudflare) y sin version en la URL, asi que un
 * despliegue NO llega a quien ya tiene la pagina abierta. Peor: como cada archivo
 * se cachea por separado, el navegador puede juntar un bundle viejo con un HTML
 * nuevo, y esa mezcla no es un error visible sino una pantalla en blanco
 * con un `TypeError` en consola. Pasa siempre en la primera carga despues de un
 * deploy, que es justo cuando el usuario mira.
 *
 * La huella se arma con nombre, tamano y fecha de los archivos. Cambia un byte de
 * `app.js` y cambia la URL: el navegador pide de nuevo y recibe el archivo nuevo.
 */
export function assetVersion(dir: string): string {
  const hash = createHash('sha1');
  let entradas: string[];
  try {
    entradas = readdirSync(dir).sort();
  } catch {
    return '0';
  }
  for (const nombre of entradas) {
    try {
      const info = statSync(path.join(dir, nombre));
      if (!info.isFile()) continue;
      hash.update(`${nombre}:${info.size}:${Math.floor(info.mtimeMs)}`);
    } catch {
      // Un archivo que no se puede leer no debe tumbar el arranque: se omite y el
      // resto de la huella sigue valiendo.
    }
  }
  return hash.digest('hex').slice(0, 10);
}

/**
 * Anade la huella a las referencias locales de un HTML, para que cada despliegue
 * se descargue entero y nunca se mezcle con el anterior.
 *
 * Solo toca lo que cuelga de la raiz (`/app.js`, `/style.css`): lo externo
 * (Google Fonts, el CDN de Tailwind) se deja como esta, porque versionarlo no
 * cambiaria nada del lado de Cloudflare.
 */
export function versionAssets(html: string, version: string): string {
  // Se captures el query y el fragmento aparte para no volver a versionar un URL
  // que ya lo trae: `/app.js?v=abc` tiene que quedar como `/app.js?v=abc`.
  return html.replace(
    /(\s(?:src|href))="\/(?!\/)([^"?#]+\.(?:js|css|woff2?|svg|png|jpe?g|webp|gif|ico))((?:\?[^"#]*)?)(#[^"]*)?"/g,
    (todo, attr: string, archivo: string, query: string | undefined, fragmento: string | undefined) =>
      // Un grupo opcional que no participa llega como `undefined`, no como cadena
      // vacia: por eso el `?? ''` y no solo interpolar.
      query ? todo : `${attr}="/${archivo}?v=${version}${fragmento ?? ''}"`,
  );
}

/**
 * El `Cache-Control` de los assets con version y el del HTML que los referencia.
 *
 * `immutable` es correcto solo porque la URL lleva la huella: si el archivo cambia,
 * la URL cambia con el. El HTML va `no-cache` para que en la primera carga de cada
 * despliegue aparezca el `?v=` nuevo y no el de ayer.
 */
export const HTML_CACHE_CONTROL = 'no-cache';

/**
 * Un AÑO en milisegundos, que es lo que espera el `maxAge` de Express.
 *
 * OJO, y esta es la razon de que sean dos constantes y no una: `express.static`
 * NO acepta un `Cache-Control` completo en `maxAge`. Pasa el valor por `ms()`, que
 * solo entiende numeros y textos de duracion (`'1y'`), asi que
 * `maxAge: 'public, max-age=31536000, immutable'` devuelve `undefined` y el header
 * no se escribe nunca. Se ve bien en el codigo y en la respuesta no hay ni una linea
 * de `cache-control`, que es justo el fallo que esta pareja de constantes vino a
 * arreglar.
 *
 * Por eso el `immutable` lo pone `setHeaders`, que si escribe el header completo.
 */
export const ASSET_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** El header final del asset: el TTL de arriba, mas el `immutable` que lo justifica. */
export const ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * El `setHeaders` que aplica a los assets: escribe el `Cache-Control` completo.
 *
 * Vive aqui y no en cada producto porque el `immutable` depende de que la URL
 * tenga la huella, y la huella la pone este mismo modulo. Un producto que sirva
 * sus assets con `express.static` no tiene que acordarse de la regla.
 */
export function assetHeaders(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader('cache-control', ASSET_CACHE_CONTROL);
}

/**
 * Sirve las paginas de `dir` con la huella puesta, sin releer el disco en cada
 * peticion.
 *
 * El HTML no cambia dentro del proceso: un despliegue levanta el contenedor de
 * nuevo, asi que cachearlo en memoria por nombre no puede quedar viejo. Si el
 * archivo no esta, se avisa en vez de reventar: una pagina que falta es un error de
 * despliegue, y quererse enterar por el log es mas util que un 500 opaco.
 */
export function htmlPages(dir: string, version: string): (nombre: string) => string {
  const cache = new Map<string, string>();
  return (nombre) => {
    const guardado = cache.get(nombre);
    if (guardado !== undefined) return guardado;
    let crudo: string;
    try {
      crudo = readFileSync(path.join(dir, nombre), 'utf8');
    } catch (err) {
      logger.error(`No se pudo leer ${nombre} de ${dir}`, err);
      throw err;
    }
    const conVersion = versionAssets(crudo, version);
    cache.set(nombre, conVersion);
    return conVersion;
  };
}