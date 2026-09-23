import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, getDb, config } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
const app = createApp({
  name: 'Cotizaciones Pro',
  product: 'cotizaciones',
  routers: {
    documents: true,
    customers: true,
    inventory: false,
    services: false,
    staff: false,
    appointments: false,
    resources: false,
    workorders: false,
  },
  staticDir: join(__dirname, '..', 'public'),
});
app.listen(config.port, () => { logger.info(`Cotizaciones SaaS en http://localhost:${config.port}`); });