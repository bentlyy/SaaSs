import 'dotenv/config';
import { randomBytes } from 'node:crypto';

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

// En producción JWT_SECRET es OBLIGATORIO (fail-fast, sin valor por defecto).
// En desarrollo, si no está definido, generamos una clave aleatoria por proceso.
// Nada de secretos conocidos en el repo: cada app firma con un valor distinto,
// así que un token de un producto no sirve en otro. Trade-off: al reiniciar
// una app sin JWT_SECRET en su .env, la sesión actual se cierra.
const fallbackJwtSecret =
  process.env.NODE_ENV === 'production' ? undefined : randomBytes(48).toString('hex');

// El secreto se resuelve LAZOSAMENTE, no al importar el módulo. Razón: el Core
// central (@amg/platform) reutiliza de este paquete solo utilidades que no
// firman nada (AppError, cookieParser, logger) y no tiene por qué exigir un
// JWT_SECRET que no va a usar. Si se resolviera al importar, importar
// `@saas-mini/core` sin esa variable explotaría en producción sin motivo.
let resolvedJwtSecret: string | undefined;
function jwtSecret(): string {
  if (resolvedJwtSecret === undefined) {
    resolvedJwtSecret = requireEnv('JWT_SECRET', fallbackJwtSecret);
  }
  return resolvedJwtSecret;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? './data/app.db',
  get jwtSecret() {
    return jwtSecret();
  },
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  sessionDays: Number(process.env.SESSION_DAYS ?? 30),
  // SMTP opcional. Si no se configura, los emails se registran en el log.
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'no-reply@saas-mini.local',
  appName: process.env.APP_NAME ?? 'SaaS Mini',
  appUrl: process.env.APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`,
};

export type AppConfig = typeof config;