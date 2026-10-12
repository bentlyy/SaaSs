import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const PRODUCTOS = join(RAIZ, 'products');

/**
 * Productos con el frontend construido (landing se queda fuera: es paginas
 * estaticas con su propio stack, sin bundle de Vite).
 *
 * El bundle es el sujeto del contrato desde la migracion al design system: el
 * HTML de Vite es solo el punto de montaje y todo el codigo vive en
 * `web/dist/assets/index-*.js`.
 */
const dashboards = readdirSync(PRODUCTOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PRODUCTOS, d.name, 'web', 'dist', 'index.html')))
  .map((d) => d.name)
  .sort();

describe('los nueve frontends construidos', () => {
  it('estan los nueve bundles (corre `npm run build:webs` antes que `npm test`)', () => {
    expect(dashboards.length).toBe(9);
  });
});

describe.each(dashboards)('%s · contrato del frontend', (producto) => {
  const dist = join(PRODUCTOS, producto, 'web', 'dist');
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const jsRel = /src="(\/assets\/[^"]+\.js[^"]*)"/.exec(html)?.[1];
  const js = jsRel ? readFileSync(join(dist, jsRel.replace(/^\//, '')), 'utf8') : '';

  it('el HTML no pide los estaticos viejos del legacy', () => {
    // Si un cache viejo o un link externo reclaman los archivos de antes, tienen
    // que caer a 404, no a un JS con bugs: ya no existen.
    expect(jsRel, `${producto}: el HTML no referencia el bundle`).toBeTruthy();
    for (const legacy of ['/app.js', '/style.css', '/amigo']) {
      expect(html, `${producto}: el HTML sigue pidiendo ${legacy}`).not.toContain(legacy);
    }
  });

  it('no consulta ids que ni el HTML ni el bundle definen', () => {
    // El bug que este test evita: un listener de nivel superior sobre un id que
    // no existe revienta ANTES del bootstrap y deja la app entera en blanco, sin
    // que se vea en ningun error de red. En React casi nadie consulta ids por
    // cadena (el principal es el punto de montaje), pero el que lo haga tiene que
    // apuntar a algo que exista.
    const definidos = new Set([
      ...[...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]),
      ...[...js.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]),
    ]);
    const consultados = [
      ...[...js.matchAll(/getElementById\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1]),
      ...[...js.matchAll(/\$\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g)].map((m) => m[1]),
    ];
    const huerfanos = consultados.filter((id) => !definidos.has(id));
    expect(
      huerfanos,
      `${producto} consulta #${huerfanos.join(', #')} pero nadie lo define. ` +
        'Si el listener es de nivel superior, el throw ocurre ANTES del bootstrap ' +
        'y la app entera se queda en blanco.',
    ).toEqual([]);
  });
});
