import { AppError } from '@saas-mini/core';
import { platformConfig } from '../config.js';
import { getCoreDb } from '../db/index.js';
import { hashPassword, verifyPassword, registerPasswordSchema } from './passwords.js';
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
} from './one-time-tokens.js';
import { sendMail } from './mailer.js';
import {
  createUser,
  emailExists,
  findUserByEmail,
  findUserById,
  markEmailVerified,
  normalizeEmail,
  publicUser,
  setUserPasswordHash,
  updateUserProfile,
  type PublicUser,
} from '../domain/users.js';
import { createOrganization, findOrganizationById, slugTaken, type Organization } from '../domain/organizations.js';
import {
  createMembership,
  findMembership,
  listOrganizationsForUser,
  roleIn,
  type OrganizationWithRole,
} from '../domain/memberships.js';
import {
  createSession,
  revokeAllSessionsForUser,
  revokeSession,
  switchSessionOrganization,
  type Session,
  type VerifiedSession,
} from '../domain/sessions.js';
import { recordAudit } from '../domain/audit.js';
import { appendQuery } from '../sso/service.js';
import type { Role } from '../domain/roles.js';

const LOGIN_GENERICO = 'Credenciales inválidas';

/**
 * Hash señuelo de bcrypt. Se compara contra él cuando el correo no existe, para
 * que "usuario inexistente" y "contraseña incorrecta" tarden lo mismo. Sin esto
 * el endpoint sirve para enumerar qué correos tienen cuenta.
 */
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface AuthResult {
  token: string;
  session: Session;
  user: PublicUser;
  organization: Organization;
  role: Role;
}

/**
 * REGISTRO CENTRAL: usuario + organización + membresía(owner) en UNA transacción.
 *
 * Todo o nada: si la organización se creara y la membresía fallara, el usuario
 * quedaría sin negocio y sin forma de entrar. Con el `transaction()` de
 * better-sqlite3 eso no puede pasar.
 *
 * OJO: acá NO se crea `staff` ni ningún dato de negocio. Que la primera persona
 * que agende, facture o cargue inventario es responsabilidad del producto, no
 * del Core (ver docs/DATA_ISOLATION.md).
 */
export async function register(input: {
  name: string;
  email: string;
  password: string;
  organizationName: string;
  organizationSlug?: string;
  meta?: RequestMeta;
}): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (findUserByEmail(email)) {
    throw new AppError(409, 'Ya existe una cuenta con ese correo. Inicia sesión.');
  }
  if (input.organizationSlug && slugTaken(input.organizationSlug)) {
    throw new AppError(409, 'Ese nombre corto (slug) ya está en uso');
  }
  const passwordHash = await hashPassword(registerPasswordSchema.parse(input.password));

  const { sqlite } = getCoreDb();
  const created = sqlite.transaction(() => {
    const user = createUser({ name: input.name, email, passwordHash });
    const organization = createOrganization({
      name: input.organizationName,
      slug: input.organizationSlug,
    });
    createMembership({ userId: user.id, organizationId: organization.id, role: 'owner' });
    return { user, organization };
  })();

  recordAudit({
    actorUserId: created.user.id,
    organizationId: created.organization.id,
    action: 'auth.registro',
    target: created.organization.slug,
    ip: input.meta?.ip,
  });

  // El correo de verificación es un extra, no una condición: si el alta de la
  // suscripción dependiera de verificarlo, un SMTP caído dejaría al cliente sin
  // poder trabajar.
  const verification = createEmailVerificationToken(
    created.user.id,
    created.user.email,
    platformConfig.emailVerificationTtlMinutes,
  );
  void sendVerificationEmail(created.user.email, verification.token);

  const session = createSession({
    userId: created.user.id,
    organizationId: created.organization.id,
    ip: input.meta?.ip,
    userAgent: input.meta?.userAgent,
  });

  return {
    token: session.token,
    session: session.session,
    user: publicUser(created.user),
    organization: created.organization,
    role: 'owner',
  };
}

/** LOGIN CENTRAL. Sin slug: el correo identifica a la persona en toda la plataforma. */
export async function login(input: {
  email: string;
  password: string;
  organizationId?: string;
  meta?: RequestMeta;
}): Promise<AuthResult> {
  const user = findUserByEmail(input.email);
  const hash = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(input.password, hash);
  if (!user || !passwordOk) throw new AppError(401, LOGIN_GENERICO);
  if (user.status === 'suspended') throw new AppError(403, 'Tu cuenta está suspendida. Escríbenos para reactivarla.');
  if (user.status === 'pending') throw new AppError(403, 'Tu cuenta está pendiente de activación.');

  const organizations = listOrganizationsForUser(user.id);
  if (organizations.length === 0) throw new AppError(403, 'Tu usuario no pertenece a ninguna organización');

  const target = input.organizationId ? organizations.find((o) => o.id === input.organizationId) : organizations[0];
  if (!target) throw new AppError(403, 'No perteneces a esa organización');
  if (target.status !== 'active') throw new AppError(403, 'Tu organización está suspendida. Escríbenos para reactivarla.');

  const organization = findOrganizationById(target.id);
  if (!organization) throw new AppError(403, 'Tu organización no está disponible');

  const session = createSession({
    userId: user.id,
    organizationId: organization.id,
    ip: input.meta?.ip,
    userAgent: input.meta?.userAgent,
  });
  recordAudit({ actorUserId: user.id, organizationId: organization.id, action: 'auth.login', ip: input.meta?.ip });

  return {
    token: session.token,
    session: session.session,
    user: publicUser(user),
    organization,
    role: target.role,
  };
}

/** Cierra la sesión indicada. Idempotente: cerrar dos veces no es error. */
export function logout(sessionId: string): void {
  revokeSession(sessionId);
}

/** Cierra todas las sesiones del usuario menos la actual ("salir de todos lados"). */
export function logoutEverywhere(userId: string, exceptSessionId?: string): number {
  const count = revokeAllSessionsForUser(userId, exceptSessionId);
  recordAudit({ actorUserId: userId, action: 'auth.logout_todo', metadata: { count } });
  return count;
}

/**
 * Recuperación de contraseña.
 *
 * Responde SIEMPRE igual, exista o no el correo: distinguir "no existe" le
 * regala al atacante la lista de correos con cuenta.
 */
export async function requestPasswordReset(email: string, meta?: RequestMeta): Promise<void> {
  const user = findUserByEmail(email);
  if (!user || user.status === 'suspended') return;

  const token = createPasswordResetToken(user.id, platformConfig.passwordResetTtlMinutes, meta?.ip);
  const link = appendQuery(`${platformConfig.coreUrl}/reset`, { token: token.token });
  recordAudit({ actorUserId: user.id, action: 'auth.reset_solicitado', ip: meta?.ip });
  await sendMail({
    to: user.email,
    subject: 'Recuperar tu contraseña de AMG',
    text: [
      'Hola,',
      '',
      'Alguien pidió recuperar la contraseña de tu cuenta AMG.',
      `Abre este enlace dentro de ${platformConfig.passwordResetTtlMinutes} minutos:`,
      link,
      '',
      'Si no fuiste tú, ignora este correo: tu contraseña sigue igual.',
    ].join('\n'),
  });
}

export async function resetPassword(input: { token: string; password: string; meta?: RequestMeta }): Promise<void> {
  registerPasswordSchema.parse(input.password);
  const consumed = consumePasswordResetToken(input.token);
  if (consumed.status !== 'ok') {
    throw new AppError(400, 'El enlace no sirve o ya venció. Pide uno nuevo.');
  }
  const user = findUserById(consumed.userId);
  if (!user) throw new AppError(400, 'El enlace no sirve o ya venció. Pide uno nuevo.');

  setUserPasswordHash(user.id, await hashPassword(input.password));
  // Cambiar la contraseña cierra TODAS las sesiones: si el enlace se robó, el
  // atacante pierde el acceso que ya tenía.
  revokeAllSessionsForUser(user.id);
  recordAudit({ actorUserId: user.id, action: 'auth.reset_completado', ip: input.meta?.ip });
}

/** Cambio de contraseña desde la sesión activa: exige la actual. */
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  sessionId?: string;
  meta?: RequestMeta;
}): Promise<void> {
  registerPasswordSchema.parse(input.newPassword);
  const user = findUserById(input.userId);
  if (!user) throw new AppError(404, 'Usuario no encontrado');
  if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
    throw new AppError(401, 'La contraseña actual no es correcta');
  }
  if (await verifyPassword(input.newPassword, user.password_hash)) {
    throw new AppError(400, 'La contraseña nueva debe ser distinta de la actual');
  }
  setUserPasswordHash(user.id, await hashPassword(input.newPassword));
  revokeAllSessionsForUser(user.id, input.sessionId);
  recordAudit({ actorUserId: user.id, action: 'auth.password_cambiada', ip: input.meta?.ip });
}

export function verifyEmail(token: string): { userId: string; alreadyVerified: boolean } {
  const consumed = consumeEmailVerificationToken(token);
  if (consumed.status !== 'ok') throw new AppError(400, 'El enlace no sirve o ya venció.');
  const row = findUserById(consumed.userId);
  const alreadyVerified = !!row?.email_verified_at;
  if (!alreadyVerified) markEmailVerified(consumed.userId);
  recordAudit({ actorUserId: consumed.userId, action: 'auth.email_verificado' });
  return { userId: consumed.userId, alreadyVerified };
}

export function updateProfile(input: { userId: string; name?: string; email?: string }): PublicUser {
  if (input.email && emailExists(input.email, input.userId)) {
    throw new AppError(409, 'Ese correo ya está en uso');
  }
  const updated = updateUserProfile(input.userId, { name: input.name, email: input.email });
  if (!updated) throw new AppError(404, 'Usuario no encontrado');
  return publicUser(updated);
}

/** Resumen para /api/auth/me: quién eres y en qué organización estás operando. */
export interface MePayload {
  user: PublicUser;
  organization: Organization;
  organizations: OrganizationWithRole[];
  role: Role;
  session: { id: string; created_at: string; last_seen_at: string; expires_at: string };
}

export function me(session: VerifiedSession): MePayload {
  return {
    user: publicUser(session.user),
    organization: session.organization,
    organizations: listOrganizationsForUser(session.userId),
    role: session.role,
    session: {
      id: session.sessionId,
      created_at: session.session.created_at,
      last_seen_at: session.session.last_seen_at,
      expires_at: session.expiresAt,
    },
  };
}

export function switchOrganization(session: VerifiedSession, organizationId: string): { role: Role } {
  const membership = findMembership(session.userId, organizationId);
  if (!membership) throw new AppError(403, 'No perteneces a esa organización');
  const organization = findOrganizationById(organizationId);
  if (!organization || organization.status !== 'active') throw new AppError(403, 'Esa organización no está disponible');
  const role = roleIn(session.userId, organizationId);
  if (!role) throw new AppError(403, 'No perteneces a esa organización');
  switchSessionOrganization(session.sessionId, organizationId);
  return { role };
}

async function sendVerificationEmail(email: string, token: string): Promise<void> {
  const link = appendQuery(`${platformConfig.coreUrl}/verificar-email`, { token });
  await sendMail({
    to: email,
    subject: 'Confirma tu correo de AMG',
    text: [
      'Hola,',
      '',
      'Confirma este correo para activar tu cuenta:',
      link,
      '',
      'Si no creaste la cuenta, ignora este mensaje.',
    ].join('\n'),
  });
}
