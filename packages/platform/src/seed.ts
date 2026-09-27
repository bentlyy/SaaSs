import { logger } from '@saas-mini/core';
import { upsertProduct, listProducts, type Product } from './domain/products.js';
import { ensureSsoClient } from './sso/registry.js';
import { platformConfig } from './config.js';

/**
 * Catálogo de productos de la plataforma.
 *
 * Son DOS grupos y la diferencia importa:
 *
 *  1. Los NUEVOS (espacios, citas, solicitudes, activos, checklists, pagos...)
 *     son la nomenclatura que AMG quiere para su catálogo comercial. Todavía
 *     no son los que corren en los subdominios.
 *
 *  2. Los EN TRANSICIÓN (documentos, recordatorios, crm, talleres) SÍ están
 *     desplegados hoy con su propio login. Se conservan para que la Parte 2
 *     pueda mapearlos sin romper nada; no se borran solos.
 *
 * `app_url` es el subdominio real: es a donde apunta el SSO del producto.
 *
 * PRECIOS: son los que ya están publicados en la landing (tabla "PLANES AMG"), no
 * una estimación interna. Si cambia un precio, se cambia acá Y en la landing: con
 * dos fuentes de verdad el cliente ve dos cifras distintas. Ver docs/BILLING.md.
 *
 * Los productos en transición (`legacy`) repiten el precio de su equivalente
 * canónico a propósito: un cliente que ya paga $7.000 por Gestión de Clientes no
 * puede ver $11.900 el día que se migra su acceso.
 */
export interface CatalogProduct {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  price: number;
  billingPeriod: 'monthly' | 'yearly' | 'one_time';
  appUrl?: string;
  sortOrder: number;
  /** Productos que hoy corren con login propio y quedan en transición. */
  legacy?: boolean;
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
    appUrl: 'https://canchas.amgdeveloper.cl',
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
    appUrl: 'https://agenda.amgdeveloper.cl',
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
    appUrl: 'https://stock.amgdeveloper.cl',
    sortOrder: 30,
  },
  {
    slug: 'solicitudes',
    name: 'Solicitudes y Órdenes',
    tagline: 'Recepción, taller y estado de cada trabajo',
    description:
      'Órdenes de trabajo: recepción, diagnóstico, piezas, mano de obra y estado hasta la entrega. Para talleres mecánicos, chapa y servicios técnicos.',
    price: 18000,
    billingPeriod: 'monthly',
    appUrl: 'https://ordenes.amgdeveloper.cl',
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
    appUrl: 'https://presupuestos.amgdeveloper.cl',
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
      'Inventario de activos: herramientas, equipos, llaves y vehículos, con responsable, estado y mantenimientos preventivos.',
    price: 16900,
    billingPeriod: 'monthly',
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
    sortOrder: 90,
  },
  // ── En transición: hoy corren con login propio en su subdominio ─────────────
  {
    slug: 'documentos',
    name: 'Documentos y Comprobantes',
    tagline: 'Emisión de documentos en PDF (en transición)',
    description:
      'Emisión de cotizaciones, recibos y facturas en PDF. Sigue funcionando con su acceso propio mientras se migra al acceso central.',
    price: 10000,
    billingPeriod: 'monthly',
    appUrl: 'https://docs.amgdeveloper.cl',
    sortOrder: 100,
    legacy: true,
  },
  {
    slug: 'recordatorios',
    name: 'Recordatorios',
    tagline: 'Avisos automáticos por correo y WhatsApp (en transición)',
    description:
      'Recordatorios automáticos de citas y vencimientos. Sigue funcionando con su acceso propio mientras se migra.',
    price: 12000,
    billingPeriod: 'monthly',
    appUrl: 'https://recordatorios.amgdeveloper.cl',
    sortOrder: 110,
    legacy: true,
  },
  {
    slug: 'crm',
    name: 'CRM',
    tagline: 'Clientes y seguimientos (en transición)',
    description:
      'Gestión de clientes y seguimientos. Sigue funcionando con su acceso propio mientras se migra al nuevo catálogo de clientes.',
    price: 7000,
    billingPeriod: 'monthly',
    appUrl: 'https://clientes.amgdeveloper.cl',
    sortOrder: 120,
    legacy: true,
  },
  {
    slug: 'talleres',
    name: 'Órdenes de Trabajo',
    tagline: 'Taller mecánico (en transición)',
    description:
      'Órdenes de trabajo para mecánicos. Sigue funcionando con su acceso propio mientras se migra a Solicitudes y Órdenes.',
    price: 18000,
    billingPeriod: 'monthly',
    appUrl: 'https://ordenes.amgdeveloper.cl',
    sortOrder: 130,
    legacy: true,
  },
];

/**
 * Siembra el catálogo y da de alta un cliente SSO por producto.
 *
 * Es idempotente: se puede llamar en cada arranque. `upsertProduct` actualiza
 * nombre, precio y estado sin tocar los `id`, así que las suscripciones que ya
 * apuntan a un producto siguen apuntando al mismo.
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
      appUrl: item.appUrl ?? null,
      sortOrder: item.sortOrder,
      status: 'active',
    });
    seeded.push(product);
    // El cliente SSO existe aunque el producto todavía no tenga subdominio:
    // sirve igual para emissions de prueba y para que la Parte 2 no tenga que
    // crear nada antes de migrar.
    ensureSsoClient(item.slug, { name: item.name });
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
