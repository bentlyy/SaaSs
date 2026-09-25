import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RAIZ = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const PRODUCTOS = join(RAIZ, 'products');

/** Productos con un dashboard propio (landing se queda fuera: es una pagina estatica). */
const dashboards = readdirSync(PRODUCTOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(PRODUCTOS, d.name, 'public', 'app.js')))
  .map((d) => d.name)
  .sort();

const leer = (producto: string, archivo: string) =>
  readFileSync(join(PRODUCTOS, producto, 'public', archivo), 'utf8');

/**
 * Ids que el JS puede usar porque existen en el HTML o porque el propio JS los
 * inyecta al vuelo (templates de modales). Sin esto, un id creado dinamicamente
 * aparece como "referenciado pero inexistente" y el test daria falsos positivos.
 */
const idsDefinidos = (html: string, js: string) => {
  const delHtml = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  const delJs = [...js.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  return new Set([...delHtml, ...delJs]);
};

const idsReferenciados = (js: string) =>
  [...new Set([...js.matchAll(/\$\(\s*['"]#([A-Za-z][\w-]*)['"]\s*\)/g)].map((m) => m[1]))];

describe.each(dashboards)('%s · contrato del frontend', (producto) => {
  const html = leer(producto, 'index.html');
  const js = leer(producto, 'app.js');
  const definidos = idsDefinidos(html, js);

  it('no referencia ids que ni el HTML ni el JS definen', () => {
    const huerfanos = idsReferenciados(js).filter((id) => !definidos.has(id));
    expect(
      huerfanos,
      `${producto}/app.js consulta #${huerfanos.join(', #')} pero nadie lo define. ` +
        'Si el listener es de nivel superior, el throw ocurre ANTES del bootstrap ' +
        'y la app entera se queda en blanco.',
    ).toEqual([]);
  });

  it('el panel de configuracion es un <form id="config-form"> real', () => {
    // El boton "Guardar cambios" es type=submit y el handler escucha el submit del
    // form. Sin este id, el script revienta al enlazar y el pane nunca guarda.
    expect(html, `${producto}: falta <form id="config-form">`).toMatch(/<form[^>]*\bid="config-form"/);
  });

  it('renderConfig rellena el form por form.elements, no por un id de section', () => {
    // El bug era $$('#config input'): el pane se llama data-view-pane="config",
    // no id="config", asi que el selector no matcheaba y el pane salia vacio.
    const fn = js.match(/function renderConfig\(\)\s*\{[\s\S]*?\n\s{2}\}/);
    expect(fn, `${producto}: no se encontro renderConfig()`).toBeTruthy();
    const cuerpo = fn![0];
    expect(cuerpo, `${producto}: renderConfig no usa form.elements`).toMatch(/form\.elements/);
    // "#config" a secas, sin el sufijo -form: el pane se llama data-view-pane="config".
    expect(cuerpo, `${producto}: renderConfig consulta un #config que no existe`).not.toMatch(/['"]#config(?!-)/);
  });
});
