import { describe, expect, it } from 'vitest';
import { AppError } from '@saas-mini/core';
import { register, login, logout, logoutEverywhere, requestPasswordReset, resetPassword, changePassword, verifyEmail, switchOrganization, updateProfile } from '../src/auth/service.js';
import { getCoreDb } from '../src/db/init.js';
import { createId } from '../src/db/id.js';
import { verifySessionToken, listActiveSessions } from '../src/domain/sessions.js';
import { findUserByEmail } from '../src/domain/users.js';
import { createOrganization } from '../src/domain/organizations.js';
import { createMembership } from '../src/domain/memberships.js';
import { schema } from '../src/db/schema.js';
import { randomToken, tokenFingerprint } from '../src/security/tokens.js';
import { eq } from 'drizzle-orm';

const PASSWORD = 'UnaClaveLarga1';

async function nuevoDueño(
  overrides: Partial<{ name: string; email: string; org: string; slug: string; password: string }> = {},
) {
  return register({
    name: overrides.name ?? 'Ana Pérez',
    email: overrides.email ?? 'ana@ejemplo.cl',
    password: overrides.password ?? PASSWORD,
    organizationName: overrides.org ?? 'Clínica Norte',
    organizationSlug: overrides.slug,
  });
}

describe('registro central', () => {
  it('crea usuario, organización y membresía owner en una sola operación', async () => {
    const r = await nuevoDueño({ email: 'alta1@ejemplo.cl', org: 'Clínica Uno', slug: 'clinica-uno' });

    expect(r.role).toBe('owner');
    expect(r.user.email).toBe('alta1@ejemplo.cl');
    expect(r.organization.slug).toBe('clinica-uno');
    expect(r.user).not.toHaveProperty('password_hash');

    const check = verifySessionToken(r.token);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.userId).toBe(r.user.id);
    expect(check.organizationId).toBe(r.organization.id);
    expect(check.role).toBe('owner');
  });

  it('no deja registrar dos veces el mismo correo', async () => {
    await nuevoDueño({ email: 'dup@ejemplo.cl', org: 'Org A', slug: 'org-a' });
    await expect(nuevoDueño({ email: 'dup@ejemplo.cl', org: 'Org B', slug: 'org-b' })).rejects.toBeInstanceOf(AppError);
  });

  it('no deja registrar dos organizaciones con el mismo slug', async () => {
    await nuevoDueño({ email: 's1@ejemplo.cl', org: 'Repetida', slug: 'repetida' });
    await expect(nuevoDueño({ email: 's2@ejemplo.cl', org: 'Otra', slug: 'repetida' })).rejects.toBeInstanceOf(AppError);
  });

  it('normaliza el correo', async () => {
    const r = await nuevoDueño({ email: '  Mayusculas@EJEMPLO.CL ', org: 'Mayus', slug: 'mayus' });
    expect(r.user.email).toBe('mayusculas@ejemplo.cl');
    expect(findUserByEmail('MAYUSCULAS@ejemplo.cl')?.id).toBe(r.user.id);
  });

  it('rechaza contraseñas cortas o solo de un tipo', async () => {
    await expect(nuevoDueño({ email: 'corta@ejemplo.cl', password: '123' })).rejects.toBeTruthy();
    await expect(nuevoDueño({ email: 'letras@ejemplo.cl', password: 'soloLetrasLargas' })).rejects.toBeTruthy();
    await expect(nuevoDueño({ email: 'numeros@ejemplo.cl', password: '12345678901' })).rejects.toBeTruthy();
  });
});

describe('login', () => {
  it('acepta la contraseña correcta y abre sesión', async () => {
    const alta = await nuevoDueño({ email: 'login@ejemplo.cl', org: 'Login', slug: 'login' });
    const r = await login({ email: 'login@ejemplo.cl', password: PASSWORD });
    expect(r.organization.id).toBe(alta.organization.id);
    expect(verifySessionToken(r.token).ok).toBe(true);
  });

  it('da el mismo error con contraseña incorrecta y con correo inexistente', async () => {
    await nuevoDueño({ email: 'existe@ejemplo.cl', org: 'Existe', slug: 'existe' });
    const malaClave = await login({ email: 'existe@ejemplo.cl', password: 'OtraClaveLarga1' }).catch((e) => e);
    const sinUsuario = await login({ email: 'nadie@ejemplo.cl', password: 'OtraClaveLarga1' }).catch((e) => e);
    expect(malaClave).toBeInstanceOf(AppError);
    expect(sinUsuario).toBeInstanceOf(AppError);
    // Mismo status y mismo texto: no se puede enumerar qué correos existen.
    expect(malaClave.status).toBe(sinUsuario.status);
    expect(malaClave.message).toBe(sinUsuario.message);
  });

  it('rechaza una organización suspendida', async () => {
    await nuevoDueño({ email: 'susp@ejemplo.cl', org: 'Suspendida', slug: 'suspendida' });
    getCoreDb()
      .db.update(schema.organizations)
      .set({ status: 'suspended' })
      .where(eq(schema.organizations.slug, 'suspendida'))
      .run();
    await expect(login({ email: 'susp@ejemplo.cl', password: PASSWORD })).rejects.toBeInstanceOf(AppError);
  });
});

describe('sesiones', () => {
  it('el token es opaco: no parece un JWT y no se puede alterar para cambiar de organización', async () => {
    const r = await nuevoDueño({ email: 'opaco@ejemplo.cl', org: 'Opaca', slug: 'opaca' });
    // Formato id.firma: NO es un JWT. No lleva datos legibles ni se puede
    // decodificar para ver la organización, a diferencia de un token de estado.
    expect(r.token.split('.')).toHaveLength(2);
    expect(r.token).not.toMatch(/^ey[A-Za-z0-9_-]+\./);
    expect(Buffer.from(r.token.split('.')[0], 'base64url').toString('utf8')).not.toContain('org');
    // Alterar la firma no produce otra identidad: se rechaza.
    expect(verifySessionToken(`${r.token.split('.')[0]}.invalida`).ok).toBe(false);
    const adulterado = `${r.token.slice(0, -2)}aa`;
    expect(verifySessionToken(adulterado).ok).toBe(false);
  });

  it('logout deja el token sin efecto y es idempotente', async () => {
    const r = await nuevoDueño({ email: 'salir@ejemplo.cl', org: 'Salir', slug: 'salir' });
    expect(verifySessionToken(r.token).ok).toBe(true);
    logout(r.session.id);
    expect(verifySessionToken(r.token).ok).toBe(false);
    expect(() => logout(r.session.id)).not.toThrow();
  });

  it('logoutEverywhere cierra las otras sesiones pero deja la actual', async () => {
    const r = await nuevoDueño({ email: 'multi@ejemplo.cl', org: 'Multi', slug: 'multi' });
    const otra = await login({ email: 'multi@ejemplo.cl', password: PASSWORD });
    expect(verifySessionToken(otra.token).ok).toBe(true);

    const cerradas = logoutEverywhere(r.user.id, r.session.id);
    expect(cerradas).toBe(1);
    expect(verifySessionToken(otra.token).ok).toBe(false);
    expect(verifySessionToken(r.token).ok).toBe(true);
  });

  it('lista las sesiones activas marcando cuál es la actual', async () => {
    const r = await nuevoDueño({ email: 'lista@ejemplo.cl', org: 'Lista', slug: 'lista' });
    await login({ email: 'lista@ejemplo.cl', password: PASSWORD });
    const sesiones = listActiveSessions(r.user.id, r.session.id);
    expect(sesiones).toHaveLength(2);
    expect(sesiones.filter((s) => s.current).length).toBe(1);
  });

  it('rechaza un token vacío o inventado sin lanzar', () => {
    expect(verifySessionToken(undefined).ok).toBe(false);
    expect(verifySessionToken('cualquiera').ok).toBe(false);
    expect(verifySessionToken('').ok).toBe(false);
  });

  it('el token no queda en la base: solo su huella', async () => {
    const r = await nuevoDueño({ email: 'huella@ejemplo.cl', org: 'Huella', slug: 'huella' });
    const fila = getCoreDb()
      .db.select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, r.session.id))
      .get();
    expect(fila?.token_hash).toBeTruthy();
    expect(fila?.token_hash).not.toBe(r.token);
  });
});

describe('recuperación de contraseña', () => {
  it('responde igual exista o no el correo', async () => {
    await nuevoDueño({ email: 'reset@ejemplo.cl', org: 'Reset', slug: 'reset' });
    await expect(requestPasswordReset('reset@ejemplo.cl')).resolves.toBeUndefined();
    await expect(requestPasswordReset('noexiste@ejemplo.cl')).resolves.toBeUndefined();
  });

  it('cambia la contraseña, cierra las sesiones y valida la nueva', async () => {
    const r = await nuevoDueño({ email: 'reset2@ejemplo.cl', org: 'Reset2', slug: 'reset2' });
    const token = knownResetToken(r.user.id);

    await resetPassword({ token, password: 'NuevaClaveLarga1' });

    // Todas las sesiones caen: si el enlace se robó, el atacante pierde lo que ya tenía.
    expect(verifySessionToken(r.token).ok).toBe(false);
    await expect(login({ email: 'reset2@ejemplo.cl', password: PASSWORD })).rejects.toBeInstanceOf(AppError);
    await expect(login({ email: 'reset2@ejemplo.cl', password: 'NuevaClaveLarga1' })).resolves.toBeTruthy();
  });

  it('el token de reset sirve una sola vez', async () => {
    const r = await nuevoDueño({ email: 'reset3@ejemplo.cl', org: 'Reset3', slug: 'reset3' });
    const token = knownResetToken(r.user.id);
    await resetPassword({ token, password: 'NuevaClaveLarga1' });
    await expect(resetPassword({ token, password: 'OtraClaveLarga1' })).rejects.toBeInstanceOf(AppError);
  });

  it('no acepta un token inválido', async () => {
    await expect(resetPassword({ token: 'x'.repeat(40), password: 'NuevaClaveLarga1' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('cambio de contraseña', () => {
  it('exige la contraseña actual', async () => {
    const r = await nuevoDueño({ email: 'cambio@ejemplo.cl', org: 'Cambio', slug: 'cambio' });
    await expect(
      changePassword({ userId: r.user.id, currentPassword: 'Incorrecta12345', newPassword: 'NuevaClaveLarga1' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('no permite repetir la misma contraseña', async () => {
    const r = await nuevoDueño({ email: 'repetida@ejemplo.cl', org: 'Repetida', slug: 'repetida-pass' });
    await expect(
      changePassword({ userId: r.user.id, currentPassword: PASSWORD, newPassword: PASSWORD }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('cierra las otras sesiones al cambiar la contraseña', async () => {
    const r = await nuevoDueño({ email: 'cierra@ejemplo.cl', org: 'Cierra', slug: 'cierra' });
    const otra = await login({ email: 'cierra@ejemplo.cl', password: PASSWORD });
    await changePassword({
      userId: r.user.id,
      currentPassword: PASSWORD,
      newPassword: 'NuevaClaveLarga1',
      sessionId: r.session.id,
    });
    expect(verifySessionToken(otra.token).ok).toBe(false);
    await expect(login({ email: 'cierra@ejemplo.cl', password: 'NuevaClaveLarga1' })).resolves.toBeTruthy();
  });
});

describe('verificación de email', () => {
  it('marca el correo como verificado y no se puede repetir', async () => {
    const r = await nuevoDueño({ email: 'verifica@ejemplo.cl', org: 'Verifica', slug: 'verifica' });
    const token = knownVerificationToken(r.user.id);
    const resultado = verifyEmail(token);
    expect(resultado.alreadyVerified).toBe(false);
    expect(findUserByEmail('verifica@ejemplo.cl')?.email_verified_at).toBeTruthy();
    // Segundo uso del mismo token: rechazado.
    expect(() => verifyEmail(token)).toThrow();
  });
});

describe('organizaciones y roles', () => {
  it('un miembro no puede cambiar de organización a una que no es suya', async () => {
    const r = await nuevoDueño({ email: 'orgs@ejemplo.cl', org: 'Mia', slug: 'mia' });
    const ajena = createOrganization({ name: 'Ajena', slug: 'ajena' });
    const check = verifySessionToken(r.token);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(() => switchOrganization(check, ajena.id)).toThrow();
  });

  it('puede cambiar a una organización donde es miembro', async () => {
    const r = await nuevoDueño({ email: 'dos@ejemplo.cl', org: 'Primera', slug: 'primera' });
    const segunda = createOrganization({ name: 'Segunda', slug: 'segunda' });
    createMembership({ userId: r.user.id, organizationId: segunda.id, role: 'admin' });

    const check = verifySessionToken(r.token);
    if (!check.ok) return;
    const switched = switchOrganization(check, segunda.id);
    expect(switched.role).toBe('admin');

    const nuevo = verifySessionToken(r.token);
    if (!nuevo.ok) return;
    expect(nuevo.organizationId).toBe(segunda.id);
    expect(nuevo.role).toBe('admin');
  });
});

describe('perfil', () => {
  it('no deja tomar un correo que ya usa otra cuenta', async () => {
    await nuevoDueño({ email: 'ocupado@ejemplo.cl', org: 'Ocupado', slug: 'ocupado' });
    const otro = await nuevoDueño({ email: 'libre@ejemplo.cl', org: 'Libre', slug: 'libre' });
    expect(() => updateProfile({ userId: otro.user.id, email: 'ocupado@ejemplo.cl' })).toThrow();
  });

  it('actualiza el nombre', async () => {
    const r = await nuevoDueño({ email: 'nombre@ejemplo.cl', org: 'Nombre', slug: 'nombre' });
    expect(updateProfile({ userId: r.user.id, name: 'Ana P.' }).name).toBe('Ana P.');
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

import { eq } from 'drizzle-orm';
import { schema } from '../src/db/schema.js';
import { tokenFingerprint } from '../src/security/tokens.js';

/**
 * Los tokens de un solo uso se guardan hasheados, así que no se pueden recuperar
 * desde la base: en un caso real llegan por correo. Para testear el canje
 * completo insertamos una fila cuyo hash sí conocemos, que es exactamente lo
 * que vería el producto cuando el usuario hace clic en el enlace.
 */
function knownResetToken(userId: string): string {
  const token = randomToken(32);
  getCoreDb()
    .db.insert(schema.passwordResetTokens)
    .values({
      id: createId('tok'),
      user_id: userId,
      token_hash: tokenFingerprint(token),
      status: 'pending',
      requested_ip: null,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      used_at: null,
    })
    .run();
  return token;
}

function knownVerificationToken(userId: string): string {
  const token = randomToken(32);
  getCoreDb()
    .db.insert(schema.emailVerificationTokens)
    .values({
      id: createId('tok'),
      user_id: userId,
      email: 'verifica@ejemplo.cl',
      token_hash: tokenFingerprint(token),
      status: 'pending',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      used_at: null,
    })
    .run();
  return token;
}

function expiredResetToken(userId: string): string {
  const token = randomToken(32);
  getCoreDb()
    .db.insert(schema.passwordResetTokens)
    .values({
      id: createId('tok'),
      user_id: userId,
      token_hash: tokenFingerprint(token),
      status: 'pending',
      requested_ip: null,
      created_at: new Date(Date.now() - 7_200_000).toISOString(),
      expires_at: new Date(Date.now() - 3_600_000).toISOString(),
      used_at: null,
    })
    .run();
  return token;
}

void expiredResetToken;
