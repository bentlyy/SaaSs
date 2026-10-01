import type { Response } from 'express';
import { AppError } from './errors.js';

/**
 * Adjuntos: que se puede subir y como se sirve.
 *
 * Los adjuntos de SOLICITUDES, CHECKLISTS y COTIZACIONES llegan como base64
 * dentro del JSON, se escriben en disco con un nombre derivado del id del
 * servidor, y se vuelven a servir en una ruta del propio producto. Ese ultimo
 * paso es el que obliga a esto: si el `content-type` sale de lo que dijo el
 * cliente, un archivo HTML subido se abre en el ORIGEN del producto y ejecuta
 * su JavaScript con la sesion de quien lo abre.
 *
 * Por eso el `content-type` que se sirve nunca es el que subio el cliente, y
 * todos los adjuntos se descargan con `Content-Disposition: attachment` y
 * `X-Content-Type-Options: nosniff`: el navegador no lo interpreta, lo guarda.
 */

/**
 * Tipos que un producto de gestion acepta.
 *
 * Es una lista, no un veto: lo que no esta aca se rechaza al subir, con un
 * mensaje que dice cual es el problema. La UI ya declara
 * `image/*, video/*, application/pdf, application/*`, asi que el recorte es
 * sobre todo para dejar afuera lo que el navegador clasifica como ejecutable o
 * activo: HTML, SVG (que es un XML con <script> adentro) y scripts.
 */
export const TIPOS_ADJUNTO: ReadonlySet<string> = new Set([
  // Imagenes. SVG queda afuera a proposito: es un documento con scripts.
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/heic',
  // Documentos.
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'application/json',
  // Texto plano: se sirve como descarga, nunca se pinta en la pagina.
  'text/plain',
  'text/csv',
  // Imagenes de video, que es lo que un checklist de obra sube.
  'video/mp4',
  'video/webm',
  'video/quicktime',
  // Comprimidos.
  'application/zip',
  'application/x-zip-compressed',
  // El tipo generico de un archivo del que el navegador no sabe nada. Se acepta
  // porque no abre ningun riesgo: al servirlo siempre es octet-stream con
  // `nosniff`, asi que el navegador no lo mira por dentro.
  'application/octet-stream',
]);

/**
 * Extension -> tipo, para cuando el navegador no mando ninguno.
 *
 * Un `<input type="file">` deja `File.type` vacio cuando no reconoce la
 * extension, y muchos `.txt` o `.log` viajan sin tipo en algunos navegadores.
 * Antes no hacia falta: no habia lista. Ahora que hay una, adivinar por
 * extension evita rechazar un archivo legitimo y mantiene el control, porque la
 * lista sigue cerrada: lo que no este aca se rechaza.
 */
const POR_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  odp: 'application/vnd.oasis.opendocument.presentation',
  rtf: 'application/rtf',
  json: 'application/json',
  txt: 'text/plain',
  log: 'text/plain',
  csv: 'text/csv',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  zip: 'application/zip',
};

/**
 * El tipo con el que se decide si el archivo se admite.
 *
 * Se normaliza (sin parametros, en minuscula) y, si el cliente no mando nada,
 * se deduce de la extension. Lo que NO se hace es confiar en el nombre para
 * saltarse la lista: la extension solo rellena un dato que falta.
 */
export function tipoDeAdjunto(filename: string, declarado?: string | null): string {
  const bruto = (declarado ?? '').split(';')[0]!.trim().toLowerCase();
  if (bruto) return bruto;
  const extension = (filename.split('.').pop() ?? '').toLowerCase();
  return POR_EXTENSION[extension] ?? 'application/octet-stream';
}

/**
 * Tope por defecto de un adjunto.
 *
 * El cuerpo en base64 pesa 4/3 del archivo, asi que el limite del JSON tiene
 * que estar por debajo de este o el 413 llega del proxy y no de la API.
 */
export const MAX_ADJUNTO_BYTES = 10 * 1024 * 1024;

export interface DatosAdjunto {
  filename: string;
  mimeType?: string | null;
  bytes: number;
}

/**
 * El nombre que se muestra y se descarga, limpio.
 *
 * El nombre en disco lo pone el servidor (el id), asi que esto no evita un
 * escape de rutas: evita que el nombre ROMPA la cabecera `Content-Disposition`.
 * Un nombre con comillas o un salto de linea ahi permite inyectar cabeceras,
 * y uno con `/` o `..` hace que el archivo se baje con un nombre que no es el
 * que la persona espera.
 */
export function nombreSeguro(original: string, respaldo = 'archivo'): string {
  const base = original.split(/[\\/]/).pop() ?? '';
  const limpio = base
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\]/g, '')
    .replace(/[^\p{L}\p{N}._() -]/gu, '_')
    .replace(/\.{2,}/g, '.')
    .trim()
    .replace(/^\.+/, '');
  if (!limpio || limpio === '.' || limpio === '..') return respaldo;
  // El nombre entero, con la extension incluida, tiene que caber en un nombre de
  // archivo en la mayoria de los sistemas: 180 caracteres deja margen de sobra.
  return limpio.length > 180 ? `${limpio.slice(0, 176)}…` : limpio;
}

/**
 * Valida un adjunto antes de escribirlo en disco.
 *
 * Lanza 415 si el tipo no esta permitido y 413 si excede el tope. Son dos
 * problemas distintos y el usuario los resuelve distinto: uno cambia el archivo,
 * el otro lo achica.
 */
export function revisarAdjunto(datos: DatosAdjunto, maxBytes = MAX_ADJUNTO_BYTES): void {
  const mime = tipoDeAdjunto(datos.filename, datos.mimeType);
  if (!TIPOS_ADJUNTO.has(mime)) {
    throw new AppError(
      415,
      `Ese tipo de archivo no se admite (${mime}). Se aceptan imágenes, PDF, documentos de Office, texto, video y ZIP.`,
    );
  }
  if (datos.bytes < 1) throw new AppError(400, 'El archivo llegó vacío.');
  if (datos.bytes > maxBytes) {
    // El mensaje tiene que decir el numero que el usuario ve en la UI, no uno
    // redondeado: "1 MB" cuando el tope real es 750 KB hace que el usuario no
    // entienda por que le rebotó un archivo de 800 KB.
    const enKilos = Math.round(maxBytes / 1000);
    const tope = enKilos >= 1000 ? `${Math.round(enKilos / 1000)} MB` : `${enKilos} KB`;
    throw new AppError(413, `El archivo no puede superar ${tope}.`);
  }
}

/**
 * Sirve un adjunto como descarga, sin dejar que el navegador lo interprete.
 *
 * El `content-type` va fijo a `application/octet-stream` y no al que subio el
 * cliente. Con `attachment` y `nosniff` el navegador no lo mira, asi que el tipo
 * real deja de importar para el riesgo; y `filename*` en UTF-8 es lo que hace
 * que un nombre con tilde se vea bien en vez de mutilado.
 */
export function enviarAdjunto(
  res: Response,
  ruta: string,
  adjunto: { filename: string; mimeType?: string | null },
): void {
  const nombre = nombreSeguro(adjunto.filename);
  res.setHeader('content-type', 'application/octet-stream');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'none'; sandbox");
  res.download(ruta, nombre);
}