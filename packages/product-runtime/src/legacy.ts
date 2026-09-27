import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { createOrganization, findOrganizationBySlug, findUserByEmail } from '@amg/platform';

/**
 * Migración desde las bases legacy.
 *
 * Esto vive en el runtime y no en cada producto porque los nueve necesitan lo
 * mismo, y nueve copias de la misma lógica divergen: una corrige un bug y las
 * otras ocho no.
 *
 * Los productos legacy eran clones de las mismas 18 tablas, así que los datos de
 * un producto están repartidos en varias bases y una base tiene datos de varios
 * productos. Por eso una migración NO es "una base vieja -> un producto nuevo":
 * es "N bases viejas -> un producto, tomando de cada una las tablas que le
 * corresponden".
 *
 * Reglas que no se negocian, en ningún producto:
 *
 *   - La base legacy se abre en SOLO LECTURA. Si algo sale mal, el legacy sigue
 *     sirviendo el producto viejo.
 *   - No se inventa nada. Un usuario que no existe en el Core se reporta, no se
 *     crea con una contraseña inventada.
 *   - No se adivina el dinero. Si dos fuentes legítimas dicen cosas distintas,
 *     se deja el valor sin convertir y se reporta.
 *   - Todo va en una transacción del destino, y el mapa legacy->organización se
 *     escribe primero, para que una corrida cortada no deje filas apuntando a
 *     una organización que no existe.
 */

export class ErrorMigracion extends Error {}

/** Un tenant legacy, tal como estaba en su base. */
export interface LegacyTenant {
  id: string;
  name: string;
  slug: string;
  product?: string | null;
  currency?: string | null;
  timezone?: string | null;
  address?: string | null;
  phone?: string | null;
  reminder_hours?: number | null;
  email_enabled?: number | null;
}

export interface LegacyUser {
  id: string;
  name: string;
  email: string;
}

/**
 * Lectura de una base legacy en solo lectura.
 *
 * Se envuelve en una clase y no se sueltan los `prepare` por todos lados para
 * que sea obvio que es de solo lectura: no hay forma de escribir a través de
 * esta API, y `cerrar()` es explícito.
 */
export class LegacyReader {
  private readonly db: Database.Database;
  readonly path: string;

  constructor(path: string) {
    if (!existsSync(path)) throw new ErrorMigracion(`No existe la base legacy en ${path}`);
    this.path = path;
    try {
      this.db = new Database(path, { readonly: true, fileMustExist: true });
    } catch (e) {
      throw new ErrorMigracion(`No se pudo abrir ${path} en solo lectura: ${(e as Error).message}`);
    }
  }

  /** ¿Existe la tabla? Permite migrar productos legacy con esquemas distintos. */
  tiene(tabla: string): boolean {
    return this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tabla) !== undefined;
  }

  /** Las tablas que el producto espera, para fallar con un mensaje útil. */
  exigir(tablas: string[]): void {
    const faltan = tablas.filter((t) => !this.tiene(t));
    if (faltan.length) {
      throw new ErrorMigracion(
        `${this.path} no tiene ${faltan.join(', ')}: no parece una base legacy de este producto.`,
      );
    }
  }

  /** Todas las columnas de una tabla, en el orden del esquema. */
  filas<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  contar(sql: string, ...params: unknown[]): number {
    const fila = this.db.prepare(sql).get(...params) as { n?: number } | undefined;
    return fila?.n ?? 0;
  }

  tenants(): LegacyTenant[] {
    if (!this.tiene('tenants')) return [];
    return this.filas<LegacyTenant>('SELECT * FROM tenants');
  }

  users(): LegacyUser[] {
    if (!this.tiene('users')) return [];
    return this.filas<LegacyUser>('SELECT id, name, email FROM users');
  }

  cerrar(): void {
    this.db.close();
  }
}

/** Cómo terminó de resolverse una organización, para el informe. */
export type AccionOrganizacion = 'ya migrada' | 'encontrada en el Core' | 'creada en el Core';

export interface ResolucionOrganizacion {
  legacyTenantId: string;
  legacySlug: string;
  legacyName: string;
  organizationId: string;
  accion: AccionOrganizacion;
}

export interface OpcionesOrganizacion {
  /** `id_tenant=slug` para mapear a mano cuando el slug legacy no sirve. */
  overrides?: Map<string, string>;
  /**
   * Tabla `legacy_tenant_map` del producto destino, ya pasada por el esquema de
   * drizzle. Todos los productos la declaran igual, así que alcanza con la forma
   * de la columna que se consulta; no hace falta el tipo exacto.
   */
  mapa: any;
  db: any;
  /** Se llama una vez por tenant ANTES de tocar el destino, para poder reportar. */
  alResolver?: (r: ResolucionOrganizacion) => void;
}

/**
 * Resuelve (o crea) la organización del Core para un tenant legacy.
 *
 * El orden importa y está escrito así a propósito: primero se anota en el Core
 * y después en el mapa del destino. Una corrida que se corta en el medio deja
 * una organización huérfana pero reutilizable —la próxima corrida la encuentra
 * por slug— en vez de una fila apuntando a una organización que no existe.
 */
export function resolverOrganizacion(
  readerTenant: LegacyTenant,
  opciones: OpcionesOrganizacion,
): ResolucionOrganizacion {
  const { overrides = new Map(), mapa, db } = opciones;

  const yaMapeado = db
    .select()
    .from(mapa)
    .where(eq(mapa.legacyTenantId, readerTenant.id))
    .get();

  let organizationId: string | undefined = yaMapeado?.organizationId;
  let accion: AccionOrganizacion = 'ya migrada';

  if (!organizationId) {
    const slug = overrides.get(readerTenant.id) ?? readerTenant.slug;
    const existente = findOrganizationBySlug(slug);
    if (existente) {
      organizationId = existente.id;
      accion = 'encontrada en el Core';
    } else {
      const creada = createOrganization({ name: readerTenant.name, slug });
      organizationId = creada.id;
      accion = 'creada en el Core';
    }
    db.insert(mapa)
      .values({
        legacyTenantId: readerTenant.id,
        legacySlug: readerTenant.slug,
        legacyName: readerTenant.name,
        organizationId,
        migratedAt: new Date().toISOString(),
      })
      .run();
  }

  const r: ResolucionOrganizacion = {
    legacyTenantId: readerTenant.id,
    legacySlug: readerTenant.slug,
    legacyName: readerTenant.name,
    organizationId: organizationId!,
    accion,
  };
  opciones.alResolver?.(r);
  return r;
}

/** Un autor legacy y su equivalente en el Core, si existe. */
export interface AutorLegacy {
  legacyUserId: string;
  name: string;
  email: string;
  coreUserId: string | null;
}

/**
 * Resuelve los usuarios legacy contra el Core POR EMAIL.
 *
 * El id legacy y el id del Core no tienen relación, así que el email es lo único
 * que se puede comparar. Cuando no hay coincidencia, el autor queda con su
 * nombre legacy como foto histórica y el informe pide crear el usuario a mano:
 * inventarle una contraseña sería peor que no migrar.
 */
export function mapearAutores(usuarios: LegacyUser[]): Map<string, AutorLegacy> {
  const salida = new Map<string, AutorLegacy>();
  for (const u of usuarios) {
    const core = findUserByEmail(u.email);
    salida.set(u.id, {
      legacyUserId: u.id,
      name: u.name,
      email: u.email,
      coreUserId: core?.id ?? null,
    });
  }
  return salida;
}

/** Autores que el informe tiene que señalar para que se creen a mano en el Core. */
export function autoresSinCore(autores: Iterable<AutorLegacy>): string[] {
  const salida: string[] = [];
  for (const a of autores) {
    if (a.coreUserId) continue;
    const etiqueta = `${a.email} (${a.name})`;
    if (!salida.includes(etiqueta)) salida.push(etiqueta);
  }
  return salida;
}

// ─────────────────────────────────────────────────────────────────────── dinero

/**
 * El dinero legacy NO tiene una convención única, y por eso no hay un factor
 * global:
 *
 *   - en peluqueria, `services.price` está en UNIDADES (120 → 12000 centavos)
 *   - en crm y recordatorios, `services.price` ya está en CENTAVOS (980 → 980)
 *   - un mismo servicio de 180 aparece con `price_at` de 12000
 *
 * Aplicar un `×100` a ciegas multiplica por 100 los precios que ya estaban bien.
 * Por eso el factor se DEDUCE de los totales, que sí son autoritativos, y cuando
 * las fuentes no coinciden se deja el valor sin convertir y se reporta.
 */
export interface DiscrepanciaPrecio {
  /** Qué se estaba mirando, para que el informe sea legible. */
  donde: string;
  legacyTenantId: string;
  unidades: number;
  centavos: number;
  /** 100, 1, o NaN si la proporción no es un entero limpio. */
  factor: number;
  motivo: string;
}

/**
 * Deduce el factor unidades->centavos a partir de pares (unidades, centavos).
 *
 * Sólo acepta un factor si hay AL MENOS DOS muestras que coinciden y el factor es
 * un entero limpio. Con una sola muestra no hay con qué contrastar, y devolver
 * 100 "porque encaja" sería inventar una conversión con apariencia de dato
 * medido. Con una muestra, o con fuentes que no coinciden, devuelve 1 y
 * `ambiguo`: el llamador copia el valor tal cual y lo reporta.
 */
export function detectarFactor(
  pares: Array<{ unidades: number; centavos: number }>,
): { factor: number; ambiguo: boolean } {
  const utiles = pares.filter((p) => p.unidades !== 0 && p.centavos !== 0);
  if (utiles.length < 2) return { factor: 1, ambiguo: true };

  const factores = utiles.map((p) => p.centavos / p.unidades);
  const unicos = new Set(factores.map((f) => (Number.isInteger(f) ? String(f) : f.toFixed(6))));

  if (unicos.size === 1) {
    const f = factores[0];
    return Number.isInteger(f) && f > 0 ? { factor: f, ambiguo: false } : { factor: 1, ambiguo: true };
  }
  return { factor: 1, ambiguo: true };
}

/**
 * Calcula las unidades de una línea para deducir el factor contra un total.
 * Devuelve 0 si las líneas no se pueden leer, para que el llamante la reporte
 * en vez de convertir a la fuerza.
 */
export function unidadesDeLineas(lineasJson: unknown): number {
  if (typeof lineasJson !== 'string') return 0;
  let lineas: unknown;
  try {
    lineas = JSON.parse(lineasJson);
  } catch {
    return 0;
  }
  if (!Array.isArray(lineas)) return 0;
  return lineas.reduce((suma: number, l: any) => {
    const precio = Number(l?.price ?? 0);
    const cant = Number(l?.qty ?? 0);
    if (!Number.isFinite(precio) || !Number.isFinite(cant)) return suma;
    return suma + precio * cant;
  }, 0);
}

/** Registra una discrepancia sin repetirla: el informe sale legible. */
export function anotarDiscrepancia(lista: DiscrepanciaPrecio[], d: DiscrepanciaPrecio): void {
  if (lista.some((x) => x.donde === d.donde && x.legacyTenantId === d.legacyTenantId)) return;
  lista.push(d);
}

/** Lo que un migrador tiene que devolver siempre, para poder auditarlo. */
export interface InformeMigracion {
  organizaciones: ResolucionOrganizacion[];
  /** Filas escritas por tabla, para comparar contra el legacy. */
  escritas: Record<string, number>;
  /** Filas que ya estaban y se saltaron. */
  omitidas: number;
  /** Usuarios legacy que hay que crear a mano en el Core. */
  autoresSinCore: string[];
  /** Precios que no se pudieron convertir con confianza. */
  discrepancias: DiscrepanciaPrecio[];
  /** Totales por tabla en el legacy, para que nadie tenga que contarlos a mano. */
  leidas: Record<string, number>;
}
