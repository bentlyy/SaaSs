import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, getDb, config } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
const app = createApp({
  name: 'Inventario Pro',
  product: 'inventario',
  routers: {
    inventory: true,
    customers: false,
    services: false,
    staff: false,
    appointments: false,
    documents: false,
    resources: false,
    workorders: false,
  },
  staticDir: join(__dirname, '..', 'public'),
});
app.listen(config.port, () => { logger.info(`Inventario SaaS en http://localhost:${config.port}`); });