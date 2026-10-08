import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ESTA ES LA PRUEBA QUE HABRIA EVITADO LOS PRECIOS ROTOS.
 * ========================================================
 *
 * El bug de dinero no se manifesto como un error de calculo, sino como codigo
 * que se compensaba a si mismo: el backend dividia por 100 y el frontend
 * dividia OTRA vez, o multiplicaba por 100 "para arreglarlo". Cada pantalla se
 * compenso sola y el resultado Depends de donde miraras:
 *
 *   - inventario: $120 se veia como $1,20, y guardar sin tocar el precio lo
 *     dividia por 100 de verdad (dato destruido con un click);
 *   - documentos: el PDF de la factura salia con el total en centesimas;
 *   - talleres: un servicio de $50 aparecia como $5.000 en una tabla y el total
 *     de la orden decia otra cosa.
 *
 * Un test de montos no lo habria cazado, porque cada numero estaba "bien"
 * dentro de su propia capa. Lo que se rompe es la CONVENCION entre capas. Asi
 * que el test no mira montos: mira que no vuelva el codigo de compensacion.
 *
 * La regla (packages/core/src/money.ts):
 *   base = entero en unidades menores -> el backend convierte una vez -> el
 *   frontend solo pinta. En el JS del navegador no hay `* 100` ni `/ 100`
 *   sobre un monto.
 *
 * El escaneo mira las fuentes React de cada producto (`web/src`), que es donde
 * vive el frontend desde la migracion al design system. El formateo de display
 * (`dinero()` en @amg/ui) es la UNICA division sancionada, y vive en el paquete
 * compartido, no en cada producto.
 */

const RAIZ = join(import.meta.dirname, '..', '..', '..');

const PRODUCTOS = [
  'activos',
  'checklists',
  'citas',
  'cotizaciones',
  'crm',
  'espacios',
  'inventario',
  'pagos',
  'solicitudes',
];

/**
 * No toda operacion con 100 es una conversion de dinero: hay milisegundos,
 * dias, expiraciones de token y PORCENTAJES (un impuesto de 19% se divide por
 * 100 a proposito, y no tiene nada que ver con centavos). Solo nos interesan
 * las que tocan montos.
 */
function esOperacionDeDinero(linea: string): boolean {
  if (/por\s*cent|percent|%|\/\s*tax|\btaxP\b|\bivaP\b|\bimpuesto/i.test(linea)) return false;
  const esTiempoOCantidad =
    /60|1000|86_?400|Date\.now|setInterval|setTimeout|windowMs|maxAge|timeout|\bms\b|segundos|minutos|toFixed|slice|substring/i.test(
      linea,
    );
  if (esTiempoOCantidad) return false;
  return /\b(price|prices|total|subtotal|tax|pricePerHour|price_at|unit_price_at|amount|value|openValue|totalValue|totalEmitido)\b/.test(
    linea,
  );
}

/** Todos los `.ts`/`.tsx` con los que se arma el bundle del producto. */
function fuentesDe(producto: string): string[] {
  const raiz = join(RAIZ, 'products', producto, 'web', 'src');
  expect(existsSync(raiz), `no se encontro products/${producto}/web/src`).toBe(true);
  const archivos: string[] = [];
  const caminar = (dir: string) => {
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, entrada.name);
      if (entrada.isDirectory()) caminar(ruta);
      else if (/\.(ts|tsx)$/.test(entrada.name)) archivos.push(ruta);
    }
  };
  caminar(raiz);
  expect(archivos.length, `products/${producto}/web/src no tiene fuentes TS`).toBeGreaterThan(0);
  return archivos;
}

describe('el frontend no convierte dinero', () => {
  for (const producto of PRODUCTOS) {
    it(`${producto}: ningun monto se multiplica ni se divide por 100`, () => {
      const culpables: string[] = [];
      for (const archivo of fuentesDe(producto)) {
        readFileSync(archivo, 'utf8')
          .split(/\r?\n/)
          .forEach((linea, i) => {
            if (!esOperacionDeDinero(linea)) return;
            if (/\*\s*100\b/.test(linea) || /([*/])\s*100\b/.test(linea)) {
              culpables.push(`  ${basename(archivo)} L${i + 1}: ${linea.trim()}`);
            }
          });
      }

      expect(
        culpables.join('\n'),
        `products/${producto}/web/src vuelve a convertir dinero en el navegador.\n` +
          `La API ya entrega numero humano: aca solo se pinta. Mismo con el backend: ` +
          `la conversion va por money.ts (fromMinor/toMinor), no a mano.\n${culpables.join('\n')}`,
      ).toBe('');
    });
  }
});

describe('el backend convierte solo por money.ts', () => {
  const modulos = join(RAIZ, 'packages', 'core', 'src', 'modules');
  const rutas = readdirSync(modulos)
    .map((mod) => join(modulos, mod, 'routes.ts'))
    .filter((ruta) => existsSync(ruta));

  it('se encontraron las rutas de modulos', () => {
    expect(rutas.length).toBeGreaterThan(5);
  });

  for (const ruta of rutas) {
    const nombre = ruta.split(/[\\/]/).slice(-2).join('/');
    it(`${nombre}: no convierte montos a mano`, () => {
      const culpables: string[] = [];
      readFileSync(ruta, 'utf8')
        .split(/\r?\n/)
        .forEach((linea, i) => {
          if (/^\s*(\*|\/\/)/.test(linea)) return; // comentario: puede explicar la regla
          if (linea.includes('fromMinor') || linea.includes('toMinor')) return;
          if (!esOperacionDeDinero(linea)) return;
          if (/([*/])\s*100\b/.test(linea)) culpables.push(`  L${i + 1}: ${linea.trim()}`);
        });
      expect(culpables.join('\n'), `convierte dinero a mano en ${nombre}:\n${culpables.join('\n')}`).toBe('');
    });
  }
});
