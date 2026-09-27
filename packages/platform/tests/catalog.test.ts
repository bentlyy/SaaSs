import { describe, expect, it } from 'vitest';
import { CATALOG, EXPECTED_SLUGS, PLATFORM_URL, RETIRED_SLUGS, seedCatalog } from '../src/seed.js';
import { listProducts, findProductBySlug } from '../src/domain/products.js';

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
      expect(p.appUrl).toMatch(/^https:\/\/[a-z]+\.amgdeveloper\.cl$/);
      expect(p.appUrl).toBe(`https://${p.slug}.amgdeveloper.cl`);
    }
  });

  it('ningún producto vendible es un subdominio viejo ni el de la plataforma', () => {
    const retired = new Set([
      'agenda',
      'canchas',
      'ordenes',
      'stock',
      'presupuestos',
      'docs',
      'recordatorios',
      'inv-v2',
    ]);
    for (const p of CATALOG) {
      const host = new URL(p.appUrl).hostname.split('.')[0];
      expect(retired.has(host), `${p.slug} apunta al subdominio retirado ${host}`).toBe(false);
      expect(host).not.toBe(new URL(PLATFORM_URL).hostname.split('.')[0]);
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
    expect(citas?.app_url).toBe('https://citas.amgdeveloper.cl');
    const espacios = findProductBySlug('espacios');
    expect(espacios?.app_url).toBe('https://espacios.amgdeveloper.cl');
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
