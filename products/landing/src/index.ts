import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPlatformApp, platformConfig, logger, pruneExpiredSessions } from '@amg/platform';

/**
 * Punto de entrada de la plataforma central.
 *
 * Antes esto era solo la landing de marketing, servida por @amg/core. Ahora
 * el mismo proceso es el Core: sirve la API de identidad y suscripciones y la UI
 * (catálogo, acceso, mi cuenta, mis aplicaciones). El HTML de marketing se sigue
 * sirviendo en `/`, así que la web pública no cambia.
 *
 * `staticDir` es opcional: si no se pasa, el Core queda solo con la API (que es
 * lo que hace `npm run dev` en la raíz, para trabajar contra la API).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = createPlatformApp({
  staticDir: join(__dirname, '..', 'public'),
});

/**
 * LIMPIEZA PERIODICA DE SESIONES. El arranque ya poda una vez (lo hace
 * `createPlatformApp`); esto mantiene la tabla acotada mientras el proceso lleva
 * dias arriba. `unref()` deja que el proceso termine sin esperar el timer.
 */
if (platformConfig.sessionPruneMinutes > 0) {
  const timer = setInterval(() => {
    try {
      const { expired, deleted } = pruneExpiredSessions();
      if (expired > 0 || deleted > 0) {
        logger.info(`Sesiones limpiadas: ${expired} vencidas, ${deleted} eliminadas`);
      }
    } catch (e) {
      logger.error('No se pudieron limpiar las sesiones vencidas', (e as Error).message);
    }
  }, platformConfig.sessionPruneMinutes * 60_000);
  timer.unref();
}

app.listen(platformConfig.port, () => {
  logger.info(`AMG central en ${platformConfig.coreUrl} (puerto ${platformConfig.port})`);
});
