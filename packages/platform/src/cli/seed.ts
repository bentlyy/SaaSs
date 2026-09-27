import { logger } from '@saas-mini/core';
import { getCoreDb } from '../db/init.js';
import { seedCatalog } from '../seed.js';
import { listSsoClients } from '../sso/registry.js';
import { platformConfig } from '../config.js';

/**
 * Siembra el catálogo y los clientes SSO.
 * Idempotente: se puede correr las veces que haga falta.
 */
function main(): void {
  getCoreDb();
  const productos = seedCatalog();
  logger.info(`Catálogo: ${productos.length} productos en ${platformConfig.dbPath}`);
  const clients = listSsoClients();
  logger.info(`Clientes SSO: ${clients.length} (${clients.map((c) => c.clientId).join(', ')})`);
}

main();
