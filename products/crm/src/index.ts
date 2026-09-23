import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, getDb, config } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
const app = createApp({
  name: 'CRM Pro',
  product: 'crm',
  routers: {
    customers: true,
    services: true,
    staff: true,
    appointments: true,
    followups: true,
    documents: false,
    inventory: false,
    resources: false,
    workorders: false,
    reminders: false,
  },
  staticDir: join(__dirname, '..', 'public'),
});
app.listen(config.port, () => { logger.info(`CRM Pro (gestión de clientes) en http://localhost:${config.port}`); });