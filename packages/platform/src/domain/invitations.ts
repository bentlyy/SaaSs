import { eq } from 'drizzle-orm';
import { getCoreDb, createId } from '../db/index.js';
import { schema } from '../db/schema.js';
import { randomToken, tokenFingerprint } from '../security/tokens.js';
import { recordAudit } from '../domain/audit.js';
import { createMembership, findMembership, listMembers } from '../domain/memberships.js';
import { findUserByEmail } from '../domain/users.js';
import { findOrganizationById } from '../domain/organizations.js';
import { sendMail } from '../auth/mailer.js';
import { platformConfig } from '../config.js';
import { appendQuery } from '../sso/service.js';
import { isRole, type Role } from '../domain/roles.js';

export interface InviteResult {
  status: 'creado' | 'ya-era-miembro' | 'ya-habia-invitacion';
  invitationId: string;
  /** Solo en desarrollo: sin SMTP el enlace se registra en el log, no se envía. */
  inviteUrl?: string;
}

/**
 * Invitar a alguien a la organización.
 *
 * Un correo que ya tiene cuenta en la plataforma entra DIRECTO como miembro (no
 * tiene por qué inventar otra contraseña: es el mismo sistema). Un correo
 * nuevo recibe un enlace de un solo uso para crear su cuenta y entrar solo.
 */
export async function inviteMember(input: {
  organizationId: string;
  invitedBy: string;
  email: string;
  role: Role;
  ttlHours?: number;
}): Promise<InviteResult> {
  if (!isRole(input.role) || input.role === 'owner') {
    // Solo un owner puede ceder la propiedad. Dar de alta otro owner se hace
    // ascendiendo a un miembro que ya está adentro, no por invitación.
    throw new Error('rol de invitación inválido');
  }
  const organization = findOrganizationById(input.organizationId);
  if (!organization) throw new Error('organización no encontrada');

  const email = input.email.trim().toLowerCase();
  const existingUser = findUserByEmail(email);
  if (existingUser) {
    const already = findMembership(existingUser.id, input.organizationId);
    if (already) return { status: 'ya-era-miembro', invitationId: '' };
    createMembership({ userId: existingUser.id, organizationId: input.organizationId, role: input.role });
    recordAudit({
      actorUserId: input.invitedBy,
      organizationId: input.organizationId,
      action: 'membresia.agregada',
      target: email,
    });
    return { status: 'creado', invitationId: '' };
  }

  const { db } = getCoreDb();
  const pending = db
    .select()
    .from(schema.organizationInvitations)
    .where(
      eq(schema.organizationInvitations.organization_id, input.organizationId),
    )
    .all()
    .find((row) => row.email === email && row.status === 'pending');
  if (pending) return { status: 'ya-habia-invitacion', invitationId: pending.id };

  const token = randomToken(32);
  const now = Date.now();
  const id = createId('inv');
  db.insert(schema.organizationInvitations)
    .values({
      id,
      organization_id: input.organizationId,
      email,
      role: input.role,
      token_hash: tokenFingerprint(token),
      status: 'pending',
      invited_by: input.invitedBy,
      created_at: new Date(now).toISOString(),
      expires_at: new Date(now + (input.ttlHours ?? 72) * 3_600_000).toISOString(),
      accepted_at: null,
    })
    .run();

  const inviteUrl = appendQuery(`${platformConfig.coreUrl}/invitacion`, { token });
  await sendMail({
    to: email,
    subject: `${input.invitedBy} te invitó a ${organization.name}`,
    text: [
      'Hola,',
      '',
      `Te invitaron a la organización ${organization.name} en AMG.`,
      'Crea tu cuenta y entras con este enlace:',
      inviteUrl,
      '',
      'Si no esperabas esta invitación, ignora este correo.',
    ].join('\n'),
  });

  recordAudit({
    actorUserId: input.invitedBy,
    organizationId: input.organizationId,
    action: 'membresia.invitacion_creada',
    target: email,
  });

  return { status: 'creado', invitationId: id, inviteUrl };
}

export interface AcceptInviteResult {
  userId: string;
  organizationId: string;
  role: Role;
}

/**
 * Acepta la invitación: crea la cuenta del invitado y lo mete a la organización
 * en la MISMA transacción, para no dejar invitaciones colgadas.
 */
export async function acceptInvitation(input: {
  token: string;
  name: string;
  password: string;
  hashPassword: (password: string) => Promise<string>;
}): Promise<AcceptInviteResult> {
  const { db, sqlite } = getCoreDb();
  const row = db
    .select()
    .from(schema.organizationInvitations)
    .where(eq(schema.organizationInvitations.token_hash, tokenFingerprint(input.token)))
    .get();
  if (!row) throw new Error('El enlace de invitación no sirve.');
  if (row.status === 'used') throw new Error('Esa invitación ya se usó.');
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.update(schema.organizationInvitations)
      .set({ status: 'expired' })
      .where(eq(schema.organizationInvitations.id, row.id))
      .run();
    throw new Error('El enlace de invitación venció. Pide uno nuevo.');
  }

  const email = row.email;
  const existing = findUserByEmail(email);
  const passwordHash = existing ? null : await input.hashPassword(input.password);

  const result = sqlite.transaction(() => {
    const user = existing ?? createUserInTx({ name: input.name, email, passwordHash: passwordHash as string });
    createMembership({ userId: user.id, organizationId: row.organization_id, role: row.role });
    db.update(schema.organizationInvitations)
      .set({ status: 'used', accepted_at: new Date().toISOString() })
      .where(eq(schema.organizationInvitations.id, row.id))
      .run();
    return { user, role: row.role as Role };
  })();

  recordAudit({
    actorUserId: result.user.id,
    organizationId: row.organization_id,
    action: 'membresia.invitacion_aceptada',
    target: email,
  });

  return { userId: result.user.id, organizationId: row.organization_id, role: result.role };
}

/** Inserción directa para poder correr dentro de una transacción abierta. */
function createUserInTx(input: { name: string; email: string; passwordHash: string }) {
  const { db } = getCoreDb();
  const now = new Date().toISOString();
  return db
    .insert(schema.users)
    .values({
      name: input.name,
      email: input.email,
      password_hash: input.passwordHash,
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    .returning()
    .get();
}

export { listMembers };
