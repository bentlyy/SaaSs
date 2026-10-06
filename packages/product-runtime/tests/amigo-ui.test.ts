import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

/**
 * `amigo-ui.js` contra un DOM de verdad.
 *
 * Estos helpers los cargan los nueve productos en cada pantalla. Un cambio de
 * `fecha`, `dinero` o `kpis` no revienta un test de backend: se ve como una
 * hora corrida, una cifra sin formato o una tarjeta con el número donde iba la
 * etiqueta. El test existe para que esa regresión falle acá y no en producción.
 */

const PUBLICO = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CODIGO = readFileSync(join(PUBLICO, 'amigo-ui.js'), 'utf8');

type Ui = {
  fecha: (iso: string, conHora?: boolean, zona?: string) => string;
  dinero: (centavos: number, op?: { minimumFractionDigits?: number; simbolo?: string }) => string;
  kpis: (contenedor: Element, filas: unknown[][]) => unknown;
};

let ui: Ui;
let doc: Document;

beforeAll(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://citas.amgdeveloper.cl/',
    runScripts: 'outside-only',
  });
  dom.window.eval(CODIGO);
  ui = (dom.window as unknown as { AMIGO_UI: Ui }).AMIGO_UI;
  doc = dom.window.document;
});

describe('AMIGO_UI.fecha', () => {
  it('pinta el dia en la zona del taller, no la del navegador', () => {
    // 2026-10-06T04:00Z: en Mexico City son las 22:00 del 5.
    const enCdmx = ui.fecha('2026-10-06T04:00:00.000Z', true, 'America/Mexico_City');
    expect(enCdmx).toContain('5');
    expect(enCdmx).toContain('10:00');
    expect(enCdmx).not.toContain('04');
  });

  it('sin zona usa la del runtime y devuelve solo la fecha', () => {
    const soloDia = ui.fecha('2026-10-06T04:00:00.000Z', false);
    expect(soloDia).toContain('2026');
    expect(soloDia).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('AMIGO_UI.dinero', () => {
  it('formatea centavos enteros sin decimales de mas', () => {
    expect(ui.dinero(1453000)).toBe('$14.530');
    expect(ui.dinero(12000, { minimumFractionDigits: 2 })).toBe('$120,00');
  });

  it('respeta el simbolo de la organización', () => {
    expect(ui.dinero(50000, { simbolo: 'CLP$' })).toBe('CLP$500');
  });

  it('negativos salen con el signo delante', () => {
    expect(ui.dinero(-50000)).toBe('-$500');
  });
});

describe('AMIGO_UI.kpis', () => {
  it('el valor va en la cifra grande y la etiqueta arriba', () => {
    const contenedor = doc.createElement('div');
    ui.kpis(contenedor, [['Cotizaciones', 12], ['En la mesa', '$49.596']]);
    const cifra = contenedor.querySelector('.ui-kpi__cifra')?.textContent;
    const etiqueta = contenedor.querySelector('.ui-kpi__etiqueta')?.textContent;
    expect(cifra).toBe('12');
    expect(etiqueta).toBe('Cotizaciones');
  });
});
