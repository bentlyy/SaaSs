/**
 * @amg/product-runtime
 *
 * Lo que TODA aplicacion de AMG tiene en comun:
 *
 *   - su propia SQLite, declarada por el producto (nada de un schema comun);
 *   - la identidad del Core montada, sin usuarios ni contrasenas propios;
 *   - CRUD con `organization_id` puesto por el servidor, para que ningun
 *     endpoint pueda quedarse sin filtro de organizacion.
 *
 * Lo que NO tiene: usuarios, passwords, tenants, registro ni login. Eso vive
 * en el Core (`@amg/platform`) o no existe.
 */

export { loadProductConfig, type ProductConfig } from './config.js';
export {
  openProductDb,
  hasTable,
  tableColumns,
  copyTable,
  type ProductDb,
  type ProductSchema,
  type Migration,
  type OpenOptions,
} from './db.js';
export {
  identity,
  orgId,
  orgFilter,
  mountAmgProductAuth,
  requireRole,
  type Identity,
  type Inicio,
  type Tool,
  type MountedAuth,
  type MountAuthOptions,
} from './auth.js';
export { crudRouter, type CrudOptions, type FieldSpec, type Fields } from './crud.js';
export { createProductApp, startProduct, type ProductContext, type ProductDefinition, type BuiltProduct } from './app.js';
export { AppError, asyncHandler, errorHandler, notFound } from './errors.js';
export { createId, nowIso } from './ids.js';
export {
  enviarAdjunto,
  nombreSeguro,
  revisarAdjunto,
  tipoDeAdjunto,
  MAX_ADJUNTO_BYTES,
  TIPOS_ADJUNTO,
  type DatosAdjunto,
} from './attachments.js';
export {
  esZonaValida,
  hhmm,
  localDe,
  offsetMinutos,
  inicioDelDiaEnZona,
  diaEnZona,
  minutosEnZona,
  zonaHoraria,
  type Local,
} from './time.js';
export { logger } from './logger.js';
