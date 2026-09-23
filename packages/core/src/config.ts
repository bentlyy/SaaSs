import 'dotenv/config';

function requireEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? './data/app.db',
  // SECRETO de firma de JWT. En producción usa una clave larga y aleatoria.
  jwtSecret: requireEnv('JWT_SECRET', 'dev-secret-cambiar-por-favor'),
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