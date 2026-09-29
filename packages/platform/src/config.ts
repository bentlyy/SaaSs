import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as loadDotenvFile } from 'dotenv';

/**
 * De dónde salen las variables de entorno del Core.
 *
 * `dotenv/config` (lo que se usaba antes) lee SOLO el `.env` del directorio de
 * trabajo, y `npm run -w` pone el cwd en el workspace: el mismo Core arrancado
 * desde `products/landing` y desde `packages/platform` leía dos archivos
 * distintos. Con eso, cada proceso se generaba sus propios secretos y —peor—
 * cada proceso abría SU core.sqlite, con otros clientes SSO: el producto
 * validaba contra una base y el Core firmaba contra otra, y el único síntoma
 * era un login que fallaba sin decir por qué.
 *
 * Ahora se leen los dos, en este orden y sin sobrescribir nada:
 *
 *   1. el `.env` del cwd, que gana (el override local del workspace);
 *   2. el `.env` de la RAÍZ del monorepo, que rellena lo que falte.
 *
 * En Docker el segundo simplemente no existe y no cambia nada.
 */
loadDotenvFile();
const envRaiz = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(envRaiz)) loadDotenvFile({ path: envRaiz });

/**
 * Configuracion del Core central (core.sqlite).
 *
 * Deliberadamente NO es la config de un mini-SaaS: aqui no hay tenants, ni
 * clientes, ni agenda. Solo la plataforma: quien es el usuario, a que
 * organizacion pertenece, que productos puede usar y por que.
 */
const isProd = process.env.NODE_ENV === 'production';

/** Para no repetir el mismo aviso dos veces cuando faltan los dos secretos. */
const avisados = new Set<string>();

// En produccion los secretos son obligatorios (fail-fast, sin valor por defecto).
// En desarrollo se genera uno aleatorio POR PROCESO: asi el repo nunca lleva un
// secreto conocido. Ojo con el costo: reiniciar el proceso cierra TODAS las
// sesiones y cambia el secreto de cada cliente SSO. Para desarrollar con
// reinicios frecuentes conviene tener el .env a mano.
const ephemeral = (name: string, bytes = 48) => {
  const value = randomBytes(bytes).toString('hex');
  // A proposito `console` y no el `logger` de @saas-mini/core: la config del Core
  // central no deberia depender del core de los mini-SaaS para arrancar.
  // Se avisa una sola vez, aunque falten los dos secretos.
  if (!avisados.has(name)) {
    avisados.add(name);
    console.warn(
      [
        '',
        `  AVISO: ${name} no esta en el entorno. Se genero uno aleatorio para este proceso.`,
        '  Reiniciar el servidor cerrara todas las sesiones y cambiara el secreto SSO',
        '  de cada producto. Es lo esperado en desarrollo, nunca en produccion.',
        '  dotenv busca el .env del directorio de trabajo y, despues, el de la raiz',
        '  del monorepo. Si no hay ninguno, copia el .env.example de la raiz.',
        '',
      ].join('\n'),
    );
  }
  return value;
};

/**
 * Un secreto del Core, o uno aleatorio de desarrollo.
 *
 * La comprobacion va DENTRO de la funcion y no como un argumento que se evalua
 * antes: con el fallback como valor ya calculado, `ephemeral()` corria siempre y
 * el aviso "no esta en el entorno" salia en cada arranque, con el .env delante.
 * Un aviso que miente entrena a ignorar avisos.
 */
function secretEnv(name: string): string {
  const value = process.env[name];
  if (value !== undefined && value !== '') return value;
  if (isProd) throw new Error(`Falta la variable de entorno ${name}`);
  return ephemeral(name);
}

export const platformConfig = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port: Number(process.env.CORE_PORT ?? process.env.PORT ?? 3000),

  /** Ruta de la base CENTRAL. Deliberadamente distinta de la de cada producto. */
  dbPath: process.env.CORE_DB_PATH ?? './data/core/core.sqlite',

  /**
   * URL publica del Core. Es la que aparece en los enlaces de SSO y en los
   * correos de recuperacion. En produccion DEBE ser la real
   * (https://desarrollo.amgdeveloper.cl) o los enlaces de retorno apuntan
   * a localhost y el usuario vuelve a la pagina equivocada.
   */
  coreUrl: (process.env.CORE_URL ?? `http://localhost:${process.env.CORE_PORT ?? process.env.PORT ?? 3000}`).replace(/\/+$/, ''),

  appName: process.env.APP_NAME ?? 'AMG',

  /** Vida de la sesion central del navegador, en dias. */
  sessionDays: Number(process.env.CORE_SESSION_DAYS ?? 30),
  /** Cookie de sesion: nombre. Host-only, nunca con Domain (evita cookies de padre). */
  sessionCookie: process.env.CORE_SESSION_COOKIE ?? 'amg_session',

  /**
   * Pepper para HMAC de los tokens de sesion y de los codigos SSO.
   * No es la unica defensa (los tokens son aleatorios de 256 bits), pero impide
   * que un dump de core.sqlite permita forjar una cookie valida.
   */
  sessionSecret: secretEnv('AMG_SESSION_SECRET'),

  /**
   * Raiz de derivacion de los secretos por producto (HKDF).
   * De aqui sale el secreto de cada cliente SSO: el Core lo guarda en
   * core.sqlite y el producto lo tiene en su .env. Un producto NO puede firmar
   * tokens de otro, ni aunque se comprometa su propio secreto.
   */
  ssoRootSecret: secretEnv('AMG_SSO_ROOT_SECRET'),
  /** Vida del codigo de autorizacion SSO (segundos). Corta a proposito. */
  ssoCodeTtlSeconds: Number(process.env.CORE_SSO_CODE_TTL ?? 60),
  /** Vida del access token que recibe el mini-SaaS (segundos). Corto: el producto lo canjea por su propia sesion. */
  ssoTokenTtlSeconds: Number(process.env.CORE_SSO_TOKEN_TTL ?? 900),

  /** Ventana de validez del enlace de recuperacion de contrasena. */
  passwordResetTtlMinutes: Number(process.env.CORE_PASSWORD_RESET_TTL_MIN ?? 60),
  /** Ventana de validez del enlace de verificacion de email. */
  emailVerificationTtlMinutes: Number(process.env.CORE_EMAIL_VERIFY_TTL_MIN ?? 1440),

  /** Dominios (o subdominios) permitidos como retorno tras el login del Core. */
  returnUrlHosts: (process.env.CORE_RETURN_URL_HOSTS ?? 'amgdeveloper.cl,localhost')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),

  /**
   * Callbacks SSO adicionales que SOLO existen en desarrollo.
   *
   * En produccion el unico callback valido de cada producto es el de su
   * subdominio, y sale del catalogo (`app_url`). En local los productos corren en
   * `http://localhost:<puerto>`, que no esta en ninguna lista: sin esto el Core
   * responde "La direccion de retorno no esta autorizada" y no hay forma de
   * entrar a ningun producto desde la maquina de desarrollo.
   *
   * Son URIs COMPLETAS y se comparan exactas, igual que las del catalogo: no se
   * aceptan comodines ni prefijos. En produccion la lista se ignora aunque se
   * declare, para que un despliegue no pueda abrirse a si mismo por descuido.
   */
  ssoLocalCallbacks: (
    isProd
      ? []
      : (process.env.CORE_SSO_LOCAL_CALLBACKS ?? '')
          .split(',')
          .map((u) => u.trim())
          .filter(Boolean)
  ),

  /**
   * URLs locales de cada herramienta, para la barra lateral.
   *
   * `CORE_SSO_LOCAL_CALLBACKS` responde "dejar entrar a este callback", que es
   * una pregunta de seguridad. Esta responde otra: "dónde está la herramienta",
   * que es de navegación, y la URL completa no alcanza para eso porque el slug
   * no viaja en ella. Se declara aparte y solo aplica en desarrollo, por la
   * misma razon: en produccion manda `products.app_url`.
   *
   * Formato: `slug=url,slug=url`.
   */
  localApps: (
    isProd
      ? {}
      : Object.fromEntries(
          (process.env.CORE_LOCAL_APPS ?? '')
            .split(',')
            .map((pair) => pair.split('='))
            .map(([slug, url]) => [slug?.trim() ?? '', (url ?? '').trim().replace(/\/+$/, '')])
            .filter(([slug, url]) => slug !== '' && url !== ''),
        )
  ),

  /** SMTP opcional. Sin configurar, los correos se registran en el log. */
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  mailFrom: process.env.MAIL_FROM ?? 'no-reply@amgdeveloper.cl',
  contactEmail: process.env.CONTACT_EMAIL ?? 'hola@amgdeveloper.cl',
} as const;

export type PlatformConfig = typeof platformConfig;
