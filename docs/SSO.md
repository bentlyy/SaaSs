# SSO: cómo entra un producto al Core

Un producto **no tiene usuarios**. No valida contraseñas, no guarda correos, no
tiene tabla de cuentas. Cuando alguien entra a `inventario.amgdeveloper.cl`, el
producto le pregunta al Core quién es y le cree la respuesta porque está
firmada con un secreto que solo ellos dos conocen.

La biblioteca que hace esto es `@amg/auth-client`. Un producto no importa
`@amg/platform`: se comunican por HTTP.

## El flujo

```
 Usuario        Producto (stock.amg…)        Core (desarrollador.amg…)
   │                    │                            │
   │ 1. entra           │                            │
   │───────────────────>│                            │
   │                    │ 2. no hay sesión local     │
   │                    │    redirect a /api/sso/    │
   │                    │    authorize?client_id=…   │
   │                    ├───────────────────────────>│
   │                    │                            │ 3. ¿hay sesión central?
   │                    │                            │    ¿la org tiene la suscripción?
   │ 4. login o SSO     │<───────────────────────────┤
   │<───────────────────┤  code + state              │
   │                    │                            │
   │ 5. redirect al     │                            │
   │    callback con    │                            │
   │    el código  ─────┼───────────────────────────>│
   │                    │ 6. POST /api/sso/token ─────┤
   │                    │<───────────────────────────┤
   │                    │    access_token (JWT)       │
   │                    │                            │
   │                    │ 7. valida el JWT con SU secreto,
   │                    │    crea su propia sesión    │
```

Los pasos 4 a 6 son el authorization code de OAuth 2.0, con una diferencia: el
`code` no se canjea en el navegador, lo canjea el producto desde el servidor. Por
eso el `state` se usa para el retorno, no para CSRF del canje.

## Los dos secretos

Cada producto tiene su propio par:

- `client_id`: por convención, el **slug** del producto (`inventario`).
- `client_secret`: lo deriva el Core desde `AMG_SSO_ROOT_SECRET` con HKDF.

Que el secreto sea **derivado** y no aleatorio importa: el Core no necesita
guardar un secreto por producto en un archivo aparte (ya lo tiene en
`core.sqlite`), y si se compromete el secreto de inventario, el de cotizaciones
sigue siendo useless para el atacante.

Y como cada producto firma con **su** secreto y valida `aud === su propio slug`,
un token emitido para inventario no abre cotizaciones, ni aunque alguien copie el
`.env` equivocado.

### Pedir el secreto de un producto

```bash
npm run sso:secret -w @amg/platform -- inventario
```

Imprime el secreto y su `client_id`. Rotarlo es lo mismo: el comando genera uno
nuevo. **Rotar un secreto invalida las sesiones de ese producto** (no las del
resto), así que conviene hacerlo cuando el producto está quieto.

## El token

JWT corto (15 min por defecto, `CORE_SSO_TOKEN_TTL`), firmado con el secreto del
producto:

```json
{
  "sub": "id_...",         // user_id del Core
  "aud": "inventario",     // DEBE ser el slug de quien valida
  "iss": "https://desarrollador.amgdeveloper.cl",
  "org_id": "id_...",
  "org_slug": "salon-aurora",
  "role": "owner",
  "email": "andrea@salonaurora.cl",
  "name": "Andrea González",
  "product": "inventario",
  "sid": "ses_...",        // sesión central de origen
  "scope": "product:access",
  "jti": "…",
  "iat": 1760000000,
  "exp": 1760000900
}
```

Al validar, `expectedProduct` es **obligatorio**: se compara `iss`, `aud`,
`product` y `scope`. Omitir `aud` en `jwt.verify` es exactamente el error que
hace que un token sirva en dos aplicaciones, y por eso la función de verificación
no tiene versión sin producto esperado.

`sid` está para que el producto pueda reportar y para que el Core pueda revocar
todo desde un solo lugar.

## Rutas

| Método | Ruta | Quién la llama | Sesión |
|---|---|---|---|
| `GET` | `/api/sso/authorize` | el navegador, por redirect | sí, redirecciona al login si no |
| `POST` | `/api/sso/token` | el producto, servidor a servidor | no, `client_secret` |
| `POST` | `/api/sso/introspect` | el producto, servidor a servidor | no, `client_secret` |

`redirect_uri` tiene que estar registrada para ese `client_id`. No es
configurable desde el request: si lo fuera, un atacante con un secreto robado
podría robar el código y canjearlo en su propio sitio.

`return_to` solo acepta rutas internas del Core o dominios de
`CORE_RETURN_URL_HOSTS`. Es la lista que cierra la redirección abierta.

## El código de autorización

Un uso, 60 segundos (`CORE_SSO_CODE_TTL`), guardado **hasheado**. Se marca
consumido en la misma transacción que locanjea: dos requests simultáneos con el
mismo código, uno gana.

## Sesión del producto

El producto **no** guarda el token del Core. Lo canjea por una sesión propia:

- `AMG_SSO_INTROSPECT=false` (default): valida el JWT localmente y usa su
  expiración como vida de la sesión.
- `AMG_SSO_INTROSPECT=true`: revalida contra el Core en cada request. Da para
  revocar de inmediato, a costa de una llamada por request.

Su cookie es propia (`AMG_SESSION_COOKIE`, default `app_session`), con los mismos
atributos de seguridad: `httpOnly`, `SameSite=Lax`, `secure` en producción, **sin
`Domain`**. El producto nunca recibe la cookie del Core.

## Migrar un producto

Son los mismos ocho pasos siempre. El orden importa: primero se verifica que el
producto sabe quién es el usuario, después se le deja entrar.

1. **Darse de alta.** El `client_id` ya existe (el seed crea un cliente SSO por
   producto). Copiar el `.env` que hoy tiene `JWT_SECRET` y reemplazarlo por:
   ```bash
   CORE_URL=https://desarrollador.amgdeveloper.cl
   APP_URL=https://inventario.amgdeveloper.cl
   AMG_SSO_CLIENT_ID=inventario
   AMG_SSO_CLIENT_SECRET=<npm run sso:secret -w @amg/platform -- inventario>
   ```
   `APP_URL` es la URL real del subdominio, y en la arquitectura final coincide
   con el slug: `inventario` vive en `inventario.amgdeveloper.cl`. Si alguna vez
   se separan, el que manda es `APP_URL`, porque es contra esa URL que el Core
   valida el `redirect_uri`.

   Opcionales, con su default: `AMG_CALLBACK_PATH` (`/auth/callback`),
   `AMG_SESSION_COOKIE` (`app_session`), `AMG_SESSION_DAYS` (30),
   `AMG_SSO_INTROSPECT` (false). `CORE_URL` también acepta `AMG_CORE_URL`, y
   `APP_URL` también `PUBLIC_URL`.

2. **Montar el middleware** antes de las rutas del producto:
   ```ts
   import { loadConfig, mountAmgAuth } from '@amg/auth-client';
   const amg = loadConfig(process.env, 'inventario');
   app.use(mountAmgAuth(amg, { publicPaths: ['/health', '/auth', '/webhooks'] }));
   ```
   Eso es todo lo que hay que escribir. El middleware se encarga de las cuatro
   cosas: canjear el código en `/auth/callback`, cerrar sesión en `/auth/logout`,
   validar la cookie en el resto de las rutas y redirigir al login del Core
   cuando no hay sesión. No hay que escribir ninguna de esas rutas a mano.

   Las rutas de `publicPaths` quedan sin sesión. Por defecto ya están
   `/health`, `/auth`, `/webhooks` y `/favicon.ico`.

3. **Usar la identidad.** Donde el producto guardaba `req.user`, ahora lee
   `req.amg`:
   ```ts
   app.get('/api/clientes', (req, res) => {
     const { organizationId, role } = req.amg!;   // ya verificados
     res.json(listarClientes(organizationId));
   });
   ```
   `req.amg` trae `userId`, `organizationId`, `organizationSlug`, `role`, `email`,
   `name`, `product` y `sessionId`. Viene del token firmado por el Core: el
   producto no lo/armó y no puede alterarlo.

4. **Cerrar permisos finos con `requireRole`.** `app.use('/api/facturacion',
   requireRole('admin'))` rechaza con 403 si el rol no alcanza. Los roles son de
   plataforma (`member` < `admin` < `owner`); las reglas del negocio ("un
   recepcionista no ve el margen") van dentro del producto.

5. **Adaptar las filas existentes.** Las tablas del producto tienen columnas de
   usuario. Hay que decidir si se dejan (y se reparan una vez) o se borran. Lo
   reasonable: añadir `owner_id` y `owner_email` como columnas de auditoría, y no
   romper las Foreign Keys que ya existen.

6. **Apagar el login propio.** Recién acá. Mientras siga vivo, hay dos puertas.

7. **Revisar `clientsGuard`.** Sigue siendo la activación técnica. Para que un
   cliente nuevo entre solo con Core, hay que hacer que la lista deje de ser
   obligatoria, o que el Core sea el que la consulte. Está pendiente (ver
   `BILLING.md`).

### Lo que hay que sacar del producto

- `users` / `sessions` propias y el login con contraseña.
- `JWT_SECRET`: lo reemplaza `AMG_SSO_CLIENT_SECRET`.
- El middleware de sesión propio. Si queda, conviven dos sesiones y el producto
  cree que el usuario está en `/login` cuando el Core ya lo tiene autenticado.

### Errores que devuelve

`describeReason()` traduce los motivos a castellano: `sin-config`, `sin-sesion`,
`expirada`, `audiencia`, `invalido`, `otro-producto`, `sin-acceso`.

`sin-acceso` merece atención: si el Core no responde, el producto **no** debe
dejar entrar a nadie. Decidir "si no puedo verificar, dejo pasar" es exactamente
como un producto termina abierto.
