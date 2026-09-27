import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { AppError, asyncHandler } from '@saas-mini/core';
import { platformConfig } from '../config.js';
import {
  changePassword,
  login,
  logout,
  logoutEverywhere,
  me,
  register,
  requestPasswordReset,
  resetPassword,
  switchOrganization,
  updateProfile,
  verifyEmail,
} from '../auth/service.js';
import { hashPassword } from '../auth/passwords.js';
import { acceptInvitation, inviteMember } from '../domain/invitations.js';
import {
  authRequired,
  clearSessionCookie,
  requireRole,
  sessionFromRequest,
  setSessionCookie,
} from './middleware.js';
import { createSession, listActiveSessions, revokeSession } from '../domain/sessions.js';
import {
  findMembership,
  listMembers,
  removeMembership,
  setMembershipRole,
} from '../domain/memberships.js';
import { safeReturnUrl } from '../sso/service.js';

export const authRouter = Router();

/**
 * Freno a fuerza bruta. Solo en producción: en desarrollo y en tests el límite
 * solo estorba, y tests como "cerrar todas las sesiones" pegan varios POST.
 */
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Espera unos minutos.' },
});
type Limiter = ReturnType<typeof rateLimit>;
type NextFn = (err?: unknown) => void;
const passThrough = (_req: Request, _res: Response, next: NextFn) => next();
const guard = (limiter: Limiter) => (platformConfig.isProd ? limiter : passThrough);

function meta(req: Request) {
  return { ip: req.ip, userAgent: req.get('user-agent') };
}

/** Toda organización que se toca por id debe coincidir con la de la sesión. */
function assertOwnOrganization(req: Request): string {
  const session = req.amg!;
  const target = req.params.organizationId;
  if (target !== session.organizationId) {
    // 403 y no 404: el usuario ya sabe que la organización existe, es la suya.
    throw new AppError(403, 'No puedes modificar otra organización');
  }
  return target;
}

// ── registro y login ─────────────────────────────────────────────────────────

const registerSchema = z.object({
  name: z.string().min(2, 'Escribe tu nombre').max(80),
  email: z.string().email('Correo inválido'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
  organizationName: z.string().min(2, 'Escribe el nombre del negocio').max(80),
  organizationSlug: z
    .string()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9-]+$/, 'Solo minúsculas, números y guiones')
    .optional(),
});

authRouter.post(
  '/register',
  guard(loginLimiter),
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await register({ ...input, meta: meta(req) });
    setSessionCookie(res, result.token);
    return res.status(201).json({
      ok: true,
      user: result.user,
      organization: result.organization,
      role: result.role,
    });
  }),
);

const loginSchema = z.object({
  email: z.string().email('Correo inválido'),
  password: z.string().min(1, 'Escribe tu contraseña'),
  organizationId: z.string().optional(),
  returnUrl: z.string().optional(),
});

authRouter.post(
  '/login',
  guard(loginLimiter),
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await login({ ...input, meta: meta(req) });
    setSessionCookie(res, result.token);
    return res.json({
      ok: true,
      user: result.user,
      organization: result.organization,
      role: result.role,
      // `returnUrl` solo se devuelve si es de un dominio permitido: nunca se
      // redirige a ciegas (open redirect).
      return_url: safeReturnUrl(input.returnUrl),
    });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const session = sessionFromRequest(req);
    if (session) logout(session.sessionId);
    clearSessionCookie(res);
    return res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const session = sessionFromRequest(req);
    if (!session) return res.status(401).json({ error: 'No autenticado. Inicia sesión.' });
    return res.json(me(session));
  }),
);

const switchSchema = z.object({ organizationId: z.string().min(1) });

authRouter.post(
  '/switch-organization',
  authRequired,
  asyncHandler(async (req, res) => {
    const { organizationId } = switchSchema.parse(req.body);
    return res.json({ ok: true, ...switchOrganization(req.amg!, organizationId) });
  }),
);

// ── perfil y contraseña ──────────────────────────────────────────────────────

const profileSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  email: z.string().email('Correo inválido').optional(),
});

authRouter.patch(
  '/profile',
  authRequired,
  asyncHandler(async (req, res) => {
    const input = profileSchema.parse(req.body);
    return res.json({ user: updateProfile({ userId: req.amg!.userId, ...input }) });
  }),
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Escribe tu contraseña actual'),
  newPassword: z.string().min(8, 'Mínimo 8 caracteres').max(200),
});

authRouter.post(
  '/password',
  authRequired,
  guard(loginLimiter),
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    const input = changePasswordSchema.parse(req.body);
    await changePassword({ userId: session.userId, sessionId: session.sessionId, meta: meta(req), ...input });
    return res.json({ ok: true, message: 'Contraseña actualizada. Se cerraron tus otras sesiones.' });
  }),
);

const forgotSchema = z.object({ email: z.string().email('Correo inválido') });

authRouter.post(
  '/password/forgot',
  guard(resetLimiter),
  asyncHandler(async (req, res) => {
    const { email } = forgotSchema.parse(req.body);
    await requestPasswordReset(email, meta(req));
    return res.json({
      ok: true,
      message: 'Si el correo existe, te enviamos un enlace para recuperarla.',
    });
  }),
);

const resetSchema = z.object({
  token: z.string().min(10, 'Enlace incompleto'),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
});

authRouter.post(
  '/password/reset',
  guard(resetLimiter),
  asyncHandler(async (req, res) => {
    const input = resetSchema.parse(req.body);
    await resetPassword({ ...input, meta: meta(req) });
    return res.json({ ok: true, message: 'Contraseña cambiada. Ya puedes iniciar sesión.' });
  }),
);

const verifyEmailSchema = z.object({ token: z.string().min(10) });

authRouter.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const { token } = verifyEmailSchema.parse(req.body);
    return res.json({ ok: true, ...verifyEmail(token) });
  }),
);

// ── sesiones activas ─────────────────────────────────────────────────────────

authRouter.get(
  '/sessions',
  authRequired,
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    return res.json({ sessions: listActiveSessions(session.userId, session.sessionId) });
  }),
);

authRouter.delete(
  '/sessions',
  guard(loginLimiter),
  asyncHandler(async (req, res) => {
    const session = sessionFromRequest(req);
    if (!session) throw new AppError(401, 'No autenticado. Inicia sesión.');
    return res.json({ ok: true, revoked: logoutEverywhere(session.userId) });
  }),
);

authRouter.delete(
  '/sessions/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    // Revisar que la sesión es SUYA antes de tocar nada: sin este chequeo, un
    // atacante que pruebe ids podría cerrar las sesiones de otro usuario.
    if (!listActiveSessions(session.userId).some((row) => row.id === req.params.id)) {
      throw new AppError(404, 'Esa sesión no existe');
    }
    return res.json({ ok: true, revoked: revokeSession(req.params.id) });
  }),
);

// ── miembros de la organización ──────────────────────────────────────────────

authRouter.get(
  '/organizations/:organizationId/members',
  authRequired,
  asyncHandler(async (req, res) => {
    const session = req.amg!;
    const target = req.params.organizationId;
    if (!findMembership(session.userId, target)) {
      throw new AppError(403, 'No perteneces a esa organización');
    }
    return res.json({ members: listMembers(target) });
  }),
);

const inviteSchema = z.object({
  email: z.string().email('Correo inválido'),
  role: z.enum(['admin', 'member']).default('member'),
});

authRouter.post(
  '/organizations/:organizationId/invitations',
  authRequired,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const target = assertOwnOrganization(req);
    const input = inviteSchema.parse(req.body);
    const result = await inviteMember({
      organizationId: target,
      invitedBy: req.amg!.userId,
      email: input.email,
      role: input.role,
    });
    return res.status(201).json(result);
  }),
);

const roleSchema = z.object({ role: z.enum(['owner', 'admin', 'member']) });

authRouter.put(
  '/organizations/:organizationId/members/:userId',
  authRequired,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const target = assertOwnOrganization(req);
    const { role } = roleSchema.parse(req.body);
    // Solo un owner puede crear o quitar owners; un admin no.
    if (role === 'owner' && req.amg!.role !== 'owner') {
      throw new AppError(403, 'Solo el owner puede transferir la propiedad');
    }
    if (req.params.userId !== req.amg!.userId && req.amg!.role !== 'owner') {
      throw new AppError(403, 'Solo el owner puede cambiar el rol de otra persona');
    }
    const membership = setMembershipRole(req.params.userId, target, role);
    return res.json({ ok: true, membership });
  }),
);

authRouter.delete(
  '/organizations/:organizationId/members/:userId',
  authRequired,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const target = assertOwnOrganization(req);
    if (req.params.userId !== req.amg!.userId && req.amg!.role !== 'owner') {
      throw new AppError(403, 'Solo el owner puede sacar a otra persona');
    }
    removeMembership(req.params.userId, target);
    return res.json({ ok: true });
  }),
);

const acceptSchema = z.object({
  token: z.string().min(10, 'Enlace incompleto'),
  name: z.string().min(2).max(80),
  password: z.string().min(8, 'Mínimo 8 caracteres').max(200),
});

authRouter.post(
  '/invitations/accept',
  guard(loginLimiter),
  asyncHandler(async (req, res) => {
    const input = acceptSchema.parse(req.body);
    const result = await acceptInvitation({ ...input, hashPassword });
    // Se abre sesión para el recién llegado: era lo único que le faltaba y
    // obligarlo a escribir la contraseña otra vez sería absurdo.
    const session = createSession({
      userId: result.userId,
      organizationId: result.organizationId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });
    setSessionCookie(res, session.token);
    return res.status(201).json({ ok: true, ...result });
  }),
);

/** Redirección de retorno saneada: si la URL no es de un dominio permitido, se ignora. */
authRouter.get(
  '/return-url',
  asyncHandler(async (req, res) => {
    const raw = typeof req.query.url === 'string' ? req.query.url : undefined;
    const safe = safeReturnUrl(raw);
    return res.redirect(302, safe ?? `${platformConfig.coreUrl}/mi-cuenta`);
  }),
);
