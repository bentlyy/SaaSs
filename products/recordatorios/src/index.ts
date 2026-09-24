import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, getDb, config, startReminderScheduler } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
const app = createApp({
  name: 'Recordatorios',
  product: 'recordatorios',
  routers: {
    customers: true,
    services: true,
    staff: true,
    appointments: true,
    reminders: true,
    documents: false,
    inventory: false,
    resources: false,
    workorders: false,
  },
  staticDir: join(__dirname, '..', 'public'),
});
app.listen(config.port, () => { logger.info(`Alertas Pro (recordatorios) en http://localhost:${config.port}`); });
startReminderScheduler();