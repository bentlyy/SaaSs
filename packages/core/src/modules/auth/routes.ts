import { Router, type Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db/index.js';
import { asyncHandler, AppError } from '../../utils/http.js';
import { authRequired, requireRole, signSession } from '../../middleware/auth.js';
import { isClientActive } from '../../guards/clientsGuard.js';
import { config } from '../../config.js';

const CLIENT_PAUSED = 'Tu acceso está en pausa o aún no está activado. Realiza el depósito del plan y escríbenos para reactivarlo.';

export const authRouter = Router();

// Freno a fuerza bruta sobre login/register (solo en producción para no entorpecer tests/dev).
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

export function setCookie(res: Response, token: string) {
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 1000 * 30,
    path: '/',
  });
}

const registerSchema = z.object({
  businessName: z.string().min(2).max(80),
  slug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones'),
  ownerName: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(100),
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const { db, sqlite } = getDb();

    const existing = db.select({ id: schema.tenants.id }).from(schema.tenants)
      .where(eq(schema.tenants.slug, input.slug)).get();
    if (existing) throw new AppError(409, 'Ese nombre corto (slug) ya está en uso');

    const hash = await bcrypt.hash(input.password, 10);

    const defaultProduct = String(req.app.locals?.defaultProduct ?? 'peluqueria');

    const insert = sqlite.transaction(() => {
      const tenant = db.insert(schema.tenants).values({
        slug: input.slug,
        name: input.businessName,
        product: defaultProduct,
      }).returning().get();

      const user = db.insert(schema.users).values({
        tenant_id: tenant.id,
        email: input.email.toLowerCase(),
        password_hash: hash,
        name: input.ownerName,
        role: 'owner',
      }).returning().get();

      db.insert(schema.staffMembers).values({
        tenant_id: tenant.id,
        name: `${input.ownerName} (tú)`,
      }).run();

      return { tenant, user };
    });

    const { user } = insert();

    const product = String(req.app.locals?.defaultProduct ?? 'peluqueria');
    if (!isClientActive(product, input.slug)) {
      throw new AppError(
        403,
        'Cuenta creada y quedó en revisión. Para activarla haz el depósito del plan y avísanos por WhatsApp o correo.',
      );
    }

    const token = signSession({
      userId: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email,
      name: user.name,
    });
    setCookie(res, token);
    return res.status(201).json({ ok: true });
  }),
);

const loginSchema = z.object({
  slug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/login',
  config.isProd ? loginLimiter : (_req, _res, next) => next(),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const { db } = getDb();

    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.slug, input.slug)).get();
    if (!tenant) throw new AppError(401, 'Credenciales inválidas');

    const user = db.select().from(schema.users)
      .where(and(
        eq(schema.users.tenant_id, tenant.id),
        eq(schema.users.email, input.email.toLowerCase()),
      )).get();
    if (!user || !(await bcrypt.compare(input.password, user.password_hash))) {
      throw new AppError(401, 'Credenciales inválidas');
    }
    if (!user.active) throw new AppError(403, 'Usuario desactivado');

    const product = String(req.app.locals?.defaultProduct ?? 'peluqueria');
    if (!isClientActive(product, tenant.slug)) throw new AppError(403, CLIENT_PAUSED);

    const token = signSession({
      userId: user.id,
      tenantId: tenant.id,
      role: user.role,
      email: user.email,
      name: user.name,
    });
    setCookie(res, token);
    return res.json({ ok: true });
  }),
);

authRouter.post('/logout', authRequired, (_req, res) => {
  res.clearCookie('token');
  return res.json({ ok: true });
});

authRouter.get(
  '/me',
  authRequired,
  asyncHandler(async (req, res) => {
    const { db } = getDb();
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, req.session.tenantId)).get();
    if (!tenant) throw new AppError(404, 'Negocio no encontrado');
    const user = db.select().from(schema.users).where(eq(schema.users.id, req.session.userId)).get();
    return res.json({ session: req.session, tenant, user });
  }),
);

// ── configuración del negocio ──
const settingsSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  currency: z.string().min(1).max(5).optional(),
  timezone: z.string().min(1).max(60).optional(),
  reminderHours: z.number().int().min(1).max(168).optional(),
  whatsappWebhook: z.string().url().or(z.literal('')).optional(),
  whatsappToken: z.string().or(z.literal('')).optional(),
  emailEnabled: z.boolean().optional(),
  address: z.string().or(z.literal('')).optional(),
  phone: z.string().or(z.literal('')).optional(),
});

authRouter.put(
  '/settings',
  authRequired,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const input = settingsSchema.parse(req.body);
    const { db } = getDb();
    await db.update(schema.tenants).set(input).where(eq(schema.tenants.id, req.session.tenantId)).run();
    const tenant = db.select().from(schema.tenants).where(eq(schema.tenants.id, req.session.tenantId)).get();
    return res.json({ tenant });
  }),
);