import { describe, expect, it } from 'vitest';
import { assetVersion, versionAssets, htmlPages } from '../src/utils/assets.js';

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