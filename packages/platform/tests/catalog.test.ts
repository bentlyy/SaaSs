import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATALOG, EXPECTED_SLUGS, PLATFORM_URL, RETIRED_SLUGS, seedCatalog } from '../src/seed.js';
import { listProducts, findProductBySlug } from '../src/domain/products.js';

/**
 * slug -> subdominio real. Es la unica fuente de esta lista en el repo: el
 * compose, el nginx, la zona de Cloudflare y el catalogo tienen que decir lo
 * mismo, y el test de mas abajo lo verifica contra el compose.
 */
const ESPERADO: Record<string, string> = {
  espacios: 'canchas',
  citas: 'agenda',
  inventario: 'stock',
  solicitudes: 'ordenes',
  cotizaciones: 'presupuestos',
  clientes: 'clientes',
  activos: 'activos',
  checklists: 'checklists',
  pagos: 'pagos',
};

/**
 * El catálogo es un contrato con tres cosas a la vez: lo que se vende, lo que
 * tiene subdominio y lo que tiene base de datos propia. Si el número o los
 * nombres se desvían, el que se desvía es el despliegue, y acá se ve antes.
 */
describe('catálogo de productos', () => {
  it('son exactamente nueve', () => {
    expect(CATALOG).toHaveLength(9);
  });

  it('son los nueve acordados, sin repetidos', () => {
    const slugs = CATALOG.map((p) => p.slug);
    expect([...slugs].sort()).toEqual([...EXPECTED_SLUGS].sort());
    expect(new Set(slugs).size).toBe(9);
  });

  it('cada producto tiene su subdominio y todos cuelgan de amgdeveloper.cl', () => {
    for (const p of CATALOG) {
      expect(p.appUrl).toMatch(/^https:\/\/[a-z-]+\.amgdeveloper\.cl$/);
    }
  });

  it('el subdominio es el que ya vive en el servidor, no el slug', () => {
    // El slug identifica el producto en la base. El host lo eligio el cliente
    // hace aros y son los que estan en el nginx y en el certificado. No tienen
    // por que llamarse igual: `espacios` se abre en canchas, `citas` en agenda.
    // Asumir que si (y que el dominio nuevo se crea solo) rompe el login: el
    // Core manda al navegador a app_url despues de autenticar.
    for (const p of CATALOG) {
      expect(p.appUrl, `${p.slug} deberia abrir en ${ESPERADO[p.slug]}`).toBe(
        `https://${ESPERADO[p.slug]}.amgdeveloper.cl`,
      );
    }
  });

  it('ningún producto vendible es un subdominio viejo ni el de la plataforma', () => {
    // Nombres que NO existen en el nginx de produccion. `agenda`, `canchas`,
    // `ordenes`, `stock` y `presupuestos` NO van aca: son los vivos, y ponerlos
    // en esta lista prohibia justamente los hosts correctos.
    const nuncaExistieron = new Set([
      'espacios',
      'citas',
      'inventario',
      'solicitudes',
      'cotizaciones',
      'docs',
      'recordatorios',
      'inv-v2',
      'desarrollo',
    ]);
    for (const p of CATALOG) {
      const host = new URL(p.appUrl).hostname.split('.')[0];
      expect(nuncaExistieron.has(host), `${p.slug} apunta a ${host}, que no existe`).toBe(false);
    }
  });

  it('cada producto tiene nombre, precio y periodo', () => {
    for (const p of CATALOG) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.tagline.length).toBeGreaterThan(0);
      expect(p.price).toBeGreaterThan(0);
      expect(['monthly', 'yearly', 'one_time']).toContain(p.billingPeriod);
    }
  });

  it('lo retirado no vuelve al catálogo', () => {
    const vendibles = new Set(CATALOG.map((p) => p.slug));
    for (const gone of RETIRED_SLUGS) {
      expect(vendibles.has(gone.slug), `${gone.slug} sigue a la venta`).toBe(false);
    }
  });
});

describe('siembra del catálogo', () => {
  it('deja nueve productos activos en la base', () => {
    seedCatalog();
    const activos = listProducts();
    expect(activos).toHaveLength(9);
    expect(activos.map((p) => p.slug).sort()).toEqual([...EXPECTED_SLUGS].sort());
  });

  it('retira lo que ya no se vende, sin borrarlo', () => {
    seedCatalog();
    for (const gone of RETIRED_SLUGS) {
      const fila = findProductBySlug(gone.slug);
      if (!fila) continue; // nunca estuvo sembrado: no hay nada que retirar
      expect(fila.status, `${gone.slug} debería quedar inactivo`).toBe('inactive');
    }
  });

  it('los slugs nuevos quedan con su URL final', () => {
    seedCatalog();
    const citas = findProductBySlug('citas');
    expect(citas?.app_url).toBe('https://agenda.amgdeveloper.cl');
    const espacios = findProductBySlug('espacios');
    expect(espacios?.app_url).toBe('https://canchas.amgdeveloper.cl');
  });

  it('el catalogo y el compose dan el mismo host para los nueve', () => {
    // Este es el guard que hacia falta. El `app_url` del Core y el `APP_URL`
    // del compose son dos valores escritos a mano que tienen que coincidir, y
    // cuando no coinciden el sintoma es un login que manda a un host que no
    // existe: el producto responde, el navegador no muestra nada, y el
    // redirect_uri guardado en el Core no es el que el producto escucha.
    const compose = readFileSync(
      fileURLToPath(new URL('../../../docker-compose.yml', import.meta.url)),
      'utf8',
    );

    const appUrlDeCompose = new Map<string, string>();
    let servicio = '';
    for (const linea of compose.split('\n')) {
      const encajaServicio = /^ {2}([a-z]+):\s*$/.exec(linea);
      if (encajaServicio) servicio = encajaServicio[1];
      const encajaUrl = /APP_URL:\s*https:\/\/([a-z-]+)\.amgdeveloper\.cl/.exec(linea);
      if (encajaUrl && servicio) appUrlDeCompose.set(servicio, encajaUrl[1]);
    }

    for (const p of CATALOG) {
      expect(
        appUrlDeCompose.get(p.slug),
        `el compose no declara APP_URL para ${p.slug}`,
      ).toBeDefined();
      expect(
        new URL(p.appUrl).hostname.split('.')[0],
        `${p.slug}: el catalogo y el compose apuntan a hosts distintos`,
      ).toBe(appUrlDeCompose.get(p.slug));
    }
  });

  it('es idempotente: sembrar dos veces no duplica', () => {
    seedCatalog();
    seedCatalog();
    expect(listProducts()).toHaveLength(9);
  });

  it('guarda los precios en centavos, sin decimales', () => {
    seedCatalog();
    for (const p of listProducts()) {
      expect(Number.isInteger(p.price), `${p.slug} tiene precio con decimales`).toBe(true);
    }
  });
});
