import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPlatformApp, platformConfig, logger } from '@amg/platform';

/**
 * Punto de entrada de la plataforma central.
 *
 * Antes esto era solo la landing de marketing, servida por @saas-mini/core. Ahora
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

app.listen(platformConfig.port, () => {
  logger.info(`AMG central en ${platformConfig.coreUrl} (puerto ${platformConfig.port})`);
});
