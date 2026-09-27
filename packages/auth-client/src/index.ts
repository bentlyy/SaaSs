/**
 * @amg/auth-client — identidad de AMG para los subdominios.
 *
 * Un mini-SaaS NO tiene usuarios: no hay passwords, no hay tabla de cuentas,
 * no hay "¿te acordás de tu email?". La identidad vive en el Core y el
 * producto la recibe por SSO.
 *
 * Uso típico en el server de un producto:
 *
 *   import express from 'express';
 *   import cookieParser from 'cookie-parser';
 *   import { loadConfig, mountAmgAuth, identity } from '@amg/auth-client';
 *
 *   const app = express();
 *   const amg = loadConfig(process.env, 'inventario');
 *   app.use(cookieParser());
 *   app.use(mountAmgAuth(amg, { productName: 'Inventario' }));
 *
 *   app.get('/api/items', (req, res) => {
 *     const me = identity(req);
 *     // me.organizationId es el tenant_id de TODAS las filas de este producto
 *     res.json({ tenant: me.organizationId, user: me.userId, role: me.role });
 *   });
 */
export { loadConfig, type AmgConfig, type AmgResolvedConfig, type AmgErrorReason } from './config.js';
export {
  verifyIdentity,
  introspect,
  exchangeCode,
  type AmgIdentity,
  type Role,
  type VerifyResult,
  type IntrospectionResponse,
} from './identity.js';
export { mountAmgAuth, identity, requireRole, type MountOptions } from './middleware.js';
export { buildLoginUrl, redirectUriFor, isSafeReturnTo, describeReason } from './login.js';
export { appendQuery, escapeHtml, errorPage } from './page.js';
export { decodeIdentityCookie, encodeIdentityCookie, type LocalSession } from './session.js';
