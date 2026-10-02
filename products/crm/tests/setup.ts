import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Entorno de los tests de clientes.
 *
 * Este archivo corre ANTES de que se importe cualquier modulo de `@amg/platform`,
 * y eso es lo que importa: la config del Core lee `CORE_DB_PATH` una sola vez, al
 * cargarse el modulo. Si un test importara `@amg/platform` primero y fijara la
 * ruta despues, el Core apuntaria al `data/core/core.sqlite` de desarrollo y el
 * test escribiria organizaciones de mentira en la base real.
 */
const dir = mkdtempSync(join(tmpdir(), 'amg-crm-tests-'));

process.env.CORE_DB_PATH = join(dir, 'core.sqlite');
process.env.NODE_ENV = 'test';
// Secretos fijos: el Core en test no necesita secretos reales, y fijarlos evita
// el aviso de "se genero uno aleatorio" en cada corrida.
process.env.AMG_SESSION_SECRET ??= 'secreto-de-sesion-falso-para-tests-no-usar-en-produccion-01';
process.env.AMG_SSO_ROOT_SECRET ??= 'secreto-raiz-sso-falso-para-tests-no-usar-en-produccion-01';

process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Si algo quedo tomado, el sistema lo limpia solo: es una carpeta temporal.
  }
});
