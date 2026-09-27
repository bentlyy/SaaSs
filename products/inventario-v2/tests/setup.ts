import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Entorno de los tests del inventario.
 *
 * Este archivo corre ANTES de que se importe cualquier módulo de `@amg/platform`,
 * y eso es lo importante: la config del Core lee `CORE_DB_PATH` una sola vez,
 * al cargarse el módulo. Si un test importara `@amg/platform` primero y fijara
 * la ruta después, el Core apuntaría al `data/core/core.sqlite` de desarrollo y
 * el test escribiría organizaciones y usuarios de mentira en la base real.
 *
 * Por eso la ruta se fija acá y no en un `beforeEach`, y por eso los tests
 * aíslan cada caso borrando el archivo entre tests en vez de cambiar la ruta.
 */
const dir = mkdtempSync(join(tmpdir(), 'amg-inventario-tests-'));

process.env.CORE_DB_PATH = join(dir, 'core.sqlite');
process.env.NODE_ENV = 'test';
// Secretos fijos: el Core en test no necesita secretos reales, y fijarlos
// evita el aviso de "se generó uno aleatorio" en cada corrida.
process.env.AMG_SESSION_SECRET ??= 'secreto-de-sesion-falso-para-tests-no-usar-en-produccion-01';
process.env.AMG_SSO_ROOT_SECRET ??= 'secreto-raiz-sso-falso-para-tests-no-usar-en-produccion-01';

process.on('exit', () => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Si algo quedó tomado, el sistema lo limpia solo: es una carpeta temporal.
  }
});
