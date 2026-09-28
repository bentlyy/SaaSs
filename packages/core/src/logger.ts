const ts = () => new Date().toISOString();

/**
 * Niveles de log, de mas a menos detail.
 *
 * `LOG_LEVEL=warn` (o `error`) SILENCIA `info`, y eso importa mas de lo que
 * parece: hay CLIs cuya salida se lee desde un shell, no por una persona.
 * `ops/deploy.sh` lee nueve secretos SSO de `sso:secret` y los escribe en el
 * `.env`; si `info` escribe en stdout, cada "Base central lista" se cuela en el
 * valor del secreto y el producto deja de validar las firmas de SSO. El sintoma
 * es un login que falla sin decir por que.
 *
 * Por defecto `info`: el comportamiento de siempre.
 */
const NIVELES = ['error', 'warn', 'info'] as const;
type Nivel = (typeof NIVELES)[number];

function nivelActivo(): Nivel {
  const bruto = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return (NIVELES as readonly string[]).includes(bruto) ? (bruto as Nivel) : 'info';
}

export const logger = {
  info: (...args: unknown[]) => {
    if (nivelActivo() === 'info') console.log(`[${ts()}] INFO `, ...args);
  },
  warn: (...args: unknown[]) => {
    if (nivelActivo() !== 'error') console.warn(`[${ts()}] WARN `, ...args);
  },
  error: (...args: unknown[]) => console.error(`[${ts()}] ERROR`, ...args),
};
