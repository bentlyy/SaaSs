import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, config } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = createApp({
  name: 'AMG',
  product: 'landing',
  staticDir: join(__dirname, '..', 'public'),
  routers: {
    customers: false,
    services: false,
    staff: false,
    appointments: false,
    documents: false,
    inventory: false,
    resources: false,
    workorders: false,
    reminders: false,
    followups: false,
    dashboard: false,
  },
});

app.listen(config.port, () => {
  logger.info(`AMG landing en http://localhost:${config.port}`);
});