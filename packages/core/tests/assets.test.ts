import { describe, expect, it } from 'vitest';
import {
  assetVersion,
  versionAssets,
  htmlPages,
  assetHeaders,
  ASSET_MAX_AGE_MS,
  ASSET_CACHE_CONTROL,
  HTML_CACHE_CONTROL,
} from '../src/utils/assets.js';

describe('assetVersion', () => {
  it('devuelve una huella corta y estable', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'assets-'));
    writeFileSync(join(dir, 'app.js'), 'uno');
    const primera = assetVersion(dir);
    expect(primera).toMatch(/^[0-9a-f]{10}$/);
    expect(assetVersion(dir)).toBe(primera);
  });

  it('cambia cuando cambia un archivo de la carpeta', async () => {
    const { mkdtempSync, writeFileSync, utimesSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'assets-'));
    const archivo = join(dir, 'app.js');
    writeFileSync(archivo, 'uno');
    const antes = assetVersion(dir);
    // Un despliegue copia los archivos: la fecha cambia aunque el contenido no.
    // Por eso la huella mira tambien la fecha, no solo los bytes.
    const futuro = new Date(Date.now() + 60_000);
    utimesSync(archivo, futuro, futuro);
    expect(assetVersion(dir)).not.toBe(antes);
  });

  it('no tira cuando la carpeta no existe', () => {
    expect(assetVersion('/ruta/que/no/existe/de/verdad')).toBe('0');
  });
});

describe('versionAssets', () => {
  const shell = `<!doctype html>
<link rel="stylesheet" href="/style.css">
<script src="/amigo-ui.js"></script>
<script src="/amigo.js"></script>
<script src="/app.js"></script>
<script src="https://cdn.tailwindcss.com?plugins=forms"></script>
<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet"/>
<a href="/productos">otra pagina</a>`;

  it('pone la huella en todos los assets locales', () => {
    const salida = versionAssets(shell, 'abc123');
    for (const archivo of ['style.css', 'amigo-ui.js', 'amigo.js', 'app.js']) {
      expect(salida).toContain(`/${archivo}?v=abc123`);
    }
  });

  it('deja intacto lo externo y las rutas sin extension', () => {
    const salida = versionAssets(shell, 'abc123');
    expect(salida).toContain('src="https://cdn.tailwindcss.com?plugins=forms"');
    expect(salida).toContain('href="https://fonts.googleapis.com/css2?family=X"');
    // `/productos` es una pagina, no un asset: versionarla rompe el link.
    expect(salida).toContain('href="/productos"');
  });

  it('no duplica la huella si el HTML ya venia con query', () => {
    const una = versionAssets('<script src="/app.js?v=zzz"></script>', 'abc123');
    expect(una).toBe('<script src="/app.js?v=zzz"></script>');
  });
});

/**
 * El `Cache-Control` de los assets.
 *
 * Estos tests existen por un fallo que no se ve en el codigo: `maxAge` de
 * `express.static` NO es un `Cache-Control`, son milisegundos, y el header lo arma
 * `send` despues de pasarlo por `ms()`. Entregarle el header completo se ve bien,
 * compila, y no escribe NADA en la respuesta.
 */
describe('la cache de los assets', () => {
  it('ASSET_MAX_AGE_MS es un numero, que es lo que maxAge sabe leer', () => {
    expect(typeof ASSET_MAX_AGE_MS).toBe('number');
    expect(Number.isFinite(ASSET_MAX_AGE_MS)).toBe(true);
  });

  it('el header completo NO es un maxAge valido: por eso son dos constantes', () => {
    // Este es el fallo. `maxAge` se pasa por `ms()`, que solo entiende numeros o
    // textos de duracion. El header completo no es ninguna de las dos cosas, asi
    // que la Asercion lo documenta: si alguien los vuelve a unir, esto falla.
    expect(Number.isNaN(Number(ASSET_CACHE_CONTROL))).toBe(true);
    expect(ASSET_CACHE_CONTROL).not.toBe(String(ASSET_MAX_AGE_MS));
  });

  it('el TTL son los mismos 365 dias que dice el header', () => {
    expect(ASSET_MAX_AGE_MS).toBe(365 * 24 * 60 * 60 * 1000);
  });

  it('assetHeaders escribe el Cache-Control completo, con su immutable', () => {
    const escrito: Record<string, string> = {};
    assetHeaders({ setHeader: (k, v) => { escrito[k] = v; } });
    expect(escrito['cache-control']).toBe(ASSET_CACHE_CONTROL);
    expect(escrito['cache-control']).toContain('immutable');
  });

  it('el HTML se pide siempre', () => {
    expect(HTML_CACHE_CONTROL).toBe('no-cache');
  });
});

describe('htmlPages', () => {
  it('lee una pagina y la versiona, sin releer el disco', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'pages-'));
    writeFileSync(join(dir, 'index.html'), '<script src="/app.js"></script>');
    const leer = htmlPages(dir, 'v9');
    expect(leer('index.html')).toBe('<script src="/app.js?v=v9"></script>');
    // Cambiar el archivo en caliente no cambia lo ya servido: el despliegue
    // levanta el proceso de nuevo, y cachear aqui no puede quedar viejo.
    writeFileSync(join(dir, 'index.html'), '<script src="/otro.js"></script>');
    expect(leer('index.html')).toBe('<script src="/app.js?v=v9"></script>');
  });
});