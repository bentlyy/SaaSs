import express, { type Express } from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { cookieParser } from './middleware/auth.js';
import { errorHandler, notFound } from './utils/http.js';
import { authRouter } from './modules/auth/routes.js';
import { gateResumen } from './guards/clientsGuard.js';
import { customersRouter } from './modules/customers/routes.js';
import { servicesRouter } from './modules/services/routes.js';
import { staffRouter } from './modules/staff/routes.js';
import { appointmentsRouter } from './modules/appointments/routes.js';
import { documentsRouter } from './modules/documents/routes.js';
import { inventoryRouter } from './modules/inventory/routes.js';
import { resourcesRouter } from './modules/resources/routes.js';
import { workordersRouter } from './modules/workorders/routes.js';
import { dashboardRouter } from './modules/dashboard/routes.js';
import { remindersRouter } from './modules/reminders/routes.js';
import { followupsRouter } from './modules/followups/routes.js';

export interface ProductConfig {
  name: string;
  product: string;
  /** Carpeta pública estática (UI del producto). Se sirve en `/`. */
  staticDir?: string;
  routers?: Partial<Record<'customers' | 'services' | 'staff' | 'appointments' | 'documents' | 'inventory' | 'resources' | 'workorders' | 'reminders' | 'followups' | 'dashboard', boolean>>;
}

const defaultRouters: Required<NonNullable<ProductConfig['routers']>> = {
  customers: true,
  services: true,
  staff: true,
  appointments: true,
  documents: true,
  inventory: true,
  resources: false,
  workorders: false,
  reminders: false,
  followups: false,
  dashboard: true,
};

export function createApp(product: ProductConfig): Express {
  const routers = { ...defaultRouters, ...product.routers };
  const app = express();

  // producto por defecto al registrar tenants (lo lee auth/register)
  app.locals.defaultProduct = product.product;

  app.disable('x-powered-by');

  // En producción hay 1 salto de proxy (nginx) delante. Sin esto, req.ip vale
  // siempre la IP de nginx y express-rate-limit lumpa a todos los usuarios en un
  // mismo contador, avisando con ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
  if (config.isProd) app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: config.appUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser);
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  // La puerta va en /health a proposito: si ops/clients.json se corrompe en
  // produccion, el un sintoma es que todos los logins fallan, y hay que poder
  // distinguir "config rota" de "base caida" sin entrar por ssh. No incluye el
  // detalle del error porque /health responde por internet.
  const health = (_req: express.Request, res: express.Response) =>
    res.json({ ok: true, product: product.product, name: product.name, puerta: gateResumen() });
  app.post('/health', health);
  app.get('/health', health);
  app.get('/api/meta', (_req, res) => res.json({ name: product.name, product: product.product }));

  if (product.staticDir) {
    const dir = path.resolve(product.staticDir);
    app.use(express.static(dir));
    app.get('/', (_req, res) => res.sendFile(path.join(dir, 'index.html')));
  }

  app.use('/api/auth', authRouter);
  if (routers.customers) app.use('/api/customers', customersRouter);
  if (routers.services) app.use('/api/services', servicesRouter);
  if (routers.staff) app.use('/api/staff', staffRouter);
  if (routers.appointments) app.use('/api/appointments', appointmentsRouter);
  if (routers.documents) app.use('/api/documents', documentsRouter);
  if (routers.inventory) app.use('/api/inventory', inventoryRouter);
  if (routers.resources) app.use('/api/resources', resourcesRouter);
  if (routers.workorders) app.use('/api/workorders', workordersRouter);
  if (routers.dashboard) app.use('/api/dashboard', dashboardRouter);
  if (routers.reminders) app.use('/api/reminders', remindersRouter);
  if (routers.followups) app.use('/api/followups', followupsRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}