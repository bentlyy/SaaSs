import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, logger, getDb, config } from '@saas-mini/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
getDb();
const app = createApp({
  name: 'Documentos y Comprobantes',
  product: 'documentos',
  routers: {
    documents: true,
    customers: true,
    inventory: true, // catálogo de conceptos con precio
    services: false,
    staff: false,
    appointments: false,
    resources: false,
    workorders: false,
  },
  staticDir: join(__dirname, '..', 'public'),
});
app.listen(config.port, () => { logger.info(`DocuPro (documentos) en http://localhost:${config.port}`); });