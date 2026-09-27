import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Cada corrida usa un directorio nuevo: la base del Core se crea de cero y no
// queda rastro. Además evita ":memory:", que en SQLite con varias conexiones
// son bases distintas y el test miente.
const dir = mkdtempSync(join(tmpdir(), 'amg-platform-test-'));

process.env.NODE_ENV = 'test';
// OJO: la variable del Core central es CORE_DB_PATH, no DB_PATH (que es de los
// productos). Con DB_PATH los tests escribían en packages/platform/data/core.
process.env.CORE_DB_PATH = join(dir, 'core.sqlite');
process.env.CORE_URL = 'http://localhost:3008';
process.env.APP_NAME = 'AMG';
process.env.CORE_PORT = '3008';
process.env.CORE_SESSION_COOKIE = 'amg_session';
process.env.CORE_SESSION_DAYS = '30';
process.env.CORE_SSO_CODE_TTL = '60';
process.env.CORE_SSO_TOKEN_TTL = '300';
process.env.CORE_RETURN_URL_HOSTS = 'amgdeveloper.cl,localhost';
process.env.SMTP_HOST = '';
// Secretos fijos para que los tokens sean reproducibles dentro del test.
process.env.AMG_SESSION_SECRET = 'session-secret-de-prueba-para-tests';
process.env.AMG_SSO_ROOT_SECRET = 'sso-root-secret-de-prueba-para-tests';

process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});
