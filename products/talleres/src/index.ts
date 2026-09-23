import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, getDb, startReminderScheduler, config } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
const app = createApp({
  name: 'Talleres Pro',
  product: 'talleres',
  routers: {
    workorders: true,
    appointments: false,
    resources: false,
    documents: false,
  },
  staticDir: join(__dirname, '..', 'public'),
});
app.listen(config.port, () => { logger.info(`Talleres SaaS en http://localhost:${config.port}`); });
startReminderScheduler();