import { logger } from '@saas-mini/core';
import {
  findProductBySlug,
  listProducts,
  setProductStatus,
  upsertProduct,
  type Product,
} from './domain/products.js';
import { ensureSsoClient } from './sso/registry.js';
import { platformConfig } from './config.js';

/**
 * Catálogo de productos de la plataforma: NUEVE, ni uno más.
 *
 * Este archivo es la lista comercial y a la vez el contrato de despliegue. Si un
 * producto no está acá, no se vende, no tiene subdominio y no tiene base de
 * datos propia; si está acá, los tres existen. Por eso el catálogo y el
 * `docker-compose.yml` tienen que moverse juntos.
 *
 * `app_url` es el subdominio real: es a donde apunta el SSO del producto.
 *
 * PRECIOS: son los que ya están publicados en la landing (tabla "PLANES AMG"), no
 * una estimación interna. Si cambia un precio, se cambia acá Y en la landing: con
 * dos fuentes de verdad el cliente ve dos cifras distintas. Ver docs/BILLING.md.
 */

/** Dominio central. Todos los productos vuelven acá para entrar y para cobrar. */
export const PLATFORM_URL = 'https://desarrollador.amgdeveloper.cl';

export interface CatalogProduct {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly' | 'one_time';
  appUrl: string;
  sortOrder: number;
}

export const CATALOG: CatalogProduct[] = [
  {
    slug: 'espacios',
    name: 'Reserva de Espacios',
    tagline: 'Salones, cabinas, canchas y salas por hora',
    description:
      'Reserva de espacios por franjas-horarias: disponibilidad real, solapamientos bloqueados y cobros por bloque. Pensado para peluquerías, clubes, coworkings y centros de eventos.',
    price: 18000,
    billingPeriod: 'monthly',
    appUrl: 'https://espacios.amgdeveloper.cl',
    sortOrder: 10,
  },
  {
    slug: 'citas',
    name: 'Reserva de Citas',
    tagline: 'Agenda por profesional, con recordatorios',
    description:
      'Agenda de citas por profesional y servicio, con duración real, bloqueos y recordatorios automáticos por correo y WhatsApp. El reemplazo natural de la agenda de peluquerías.',
    price: 12000,
    billingPeriod: 'monthly',
    appUrl: 'https://citas.amgdeveloper.cl',
    sortOrder: 20,
  },
  {
    slug: 'inventario',
    name: 'Inventario',
    tagline: 'Stock, mínimos y movimientos con trazabilidad',
    description:
      'Control de almacén: artículos, códigos, stock mínimo, entradas y salidas con motivo. Avisa qué se está por acabar antes de que se acabe.',
    price: 9000,
    billingPeriod: 'monthly',
    appUrl: 'https://inventario.amgdeveloper.cl',
    sortOrder: 30,
  },
  {
    slug: 'solicitudes',
    name: 'Solicitudes y Órdenes',
    tagline: 'Recepción, estado y entrega de cada trabajo',
    description:
      'Órdenes de trabajo genéricas: recepción, diagnóstico, materiales, mano de obra y estado hasta la entrega. Para servicios técnicos, mantenimiento y talleres de cualquier rubro.',
    price: 18000,
    billingPeriod: 'monthly',
    appUrl: 'https://solicitudes.amgdeveloper.cl',
    sortOrder: 40,
  },
  {
    slug: 'cotizaciones',
    name: 'Cotizaciones',
    tagline: 'Presupuestos que el cliente acepta en un clic',
    description:
      'Cotizaciones con líneas, impuestos y totales, versionadas y enviables. Cuando el cliente acepta, queda el respaldo de qué se cotizó.',
    price: 8000,
    billingPeriod: 'monthly',
    appUrl: 'https://cotizaciones.amgdeveloper.cl',
    sortOrder: 50,
  },
  {
    slug: 'clientes',
    name: 'Gestión de Clientes',
    tagline: 'Ficha única por cliente, con historial',
    description:
      'CRM mínimo: ficha del cliente, historial, notas y seguimientos pendientes. Sin CRM gigante, solo lo que un negocio chico usa de verdad.',
    price: 7000,
    billingPeriod: 'monthly',
    appUrl: 'https://clientes.amgdeveloper.cl',
    sortOrder: 60,
  },
  {
    slug: 'activos',
    name: 'Control de Activos',
    tagline: 'Equipos, llaves y herramientas con responsable',
    description:
      'Inventario de activos: herramientas, equipos y llaves, con responsable, estado y mantenimientos preventivos.',
    price: 16900,
    billingPeriod: 'monthly',
    appUrl: 'https://activos.amgdeveloper.cl',
    sortOrder: 70,
  },
  {
    slug: 'checklists',
    name: 'Checklists e Inspecciones',
    tagline: 'Listas de verificación que se firman',
    description:
      'Checklists de apertura, cierre e inspecciones, con responsable por tarea, evidencia y bitácora. Para locales que rinden cuentas.',
    price: 14900,
    billingPeriod: 'monthly',
    appUrl: 'https://checklists.amgdeveloper.cl',
    sortOrder: 80,
  },
  {
    slug: 'pagos',
    name: 'Control de Pagos',
    tagline: 'Cuotas, morosidad y comprobantes',
    description:
      'Control de pagos de tus clientes: cuotas, fechas, morosidad y comprobante. El dinero entra por tu pasarela, AMG solo lo ordena.',
    price: 15900,
    billingPeriod: 'monthly',
    appUrl: 'https://pagos.amgdeveloper.cl',
    sortOrder: 90,
  },
];

/**
 * Productos que se dejaron de vender y que hay que retirar del catálogo.
 *
 * No se borran de la tabla: las suscripciones y los pagos ya apuntan a su
 * `product_id`, y borrar la fila los dejaría colgando. Se marcan `inactive`, con
 * lo que `listProducts()` deja de mostrarlos y `/api/products` deja de
 * ofrecerlos, pero el historial sigue siendo legible.
 */
export const RETIRED_SLUGS: Array<{ slug: string; becomes: string | null; note: string }> = [
  { slug: 'documentos', becomes: 'cotizaciones', note: 'El PDF se emite dentro de cada producto que lo necesita.' },
  { slug: 'recordatorios', becomes: 'citas', note: 'Los avisos son infraestructura, no un producto vendible.' },
  { slug: 'crm', becomes: 'clientes', note: 'Mismo producto, nombre nuevo.' },
  { slug: 'talleres', becomes: 'solicitudes', note: 'Mismo producto, sin vehículos.' },
  { slug: 'peluqueria', becomes: 'citas', note: 'Servicio anterior; nunca estuvo en el catálogo público.' },
  { slug: 'deportes', becomes: 'espacios', note: 'Servicio anterior; nunca estuvo en el catálogo público.' },
  { slug: 'inventario-v2', becomes: 'inventario', note: 'Nombre de carpeta interno, no de producto.' },
];

/** Los nueve, ni uno más. Si esto cambia, el compose también. */
export const EXPECTED_SLUGS = [
  'espacios',
  'citas',
  'inventario',
  'solicitudes',
  'cotizaciones',
  'clientes',
  'activos',
  'checklists',
  'pagos',
] as const;

/**
 * Siembra el catálogo y da de alta un cliente SSO por producto.
 *
 * Es idempotente: se puede llamar en cada arranque. `upsertProduct` actualiza
 * nombre, precio y estado sin tocar los `id`, así que las suscripciones que ya
 * apuntan a un producto siguen apuntando al mismo.
 *
 * Además deja `inactive` lo retirado. Borrarlo sería peor: hay suscripciones y
 * pagos apuntando a esos `id`, y sin fila quedan huérfanos.
 */
export function seedCatalog(): Product[] {
  const seeded: Product[] = [];
  for (const item of CATALOG) {
    const product = upsertProduct({
      slug: item.slug,
      name: item.name,
      description: item.description,
      tagline: item.tagline,
      price: item.price,
      billingPeriod: item.billingPeriod,
      appUrl: item.appUrl,
      sortOrder: item.sortOrder,
      status: 'active',
    });
    seeded.push(product);
    ensureSsoClient(item.slug, { name: item.name });
  }
  for (const gone of RETIRED_SLUGS) {
    // `upsertProduct` crearía la fila si no existiera; acá sólo se marca.
    const existing = findProductBySlug(gone.slug);
    if (existing && existing.status === 'active') setProductStatus(gone.slug, 'inactive');
  }
  return seeded;
}

let sembrado = false;

/** Variante de arranque: una sola vez por proceso. */
export function ensurePlatformSeed(): void {
  if (sembrado) return;
  sembrado = true;
  try {
    const seeded = seedCatalog();
    logger.info(`Catálogo de ${seeded.length} productos listo en ${platformConfig.dbPath}`);
  } catch (e) {
    logger.error('No se pudo sembrar el catálogo de productos', (e as Error).message);
  }
}

/** Solo para tests: permite volver a sembrar. */
export function resetPlatformSeed(): void {
  sembrado = false;
}

export function catalogSummary(): Array<{ slug: string; active: boolean }> {
  return listProducts().map((p) => ({ slug: p.slug, active: p.status === 'active' }));
}
