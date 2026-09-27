# Autenticación y sesiones

Todo lo que tiene que ver con **quién es el usuario**. Acá vive la única
contraseña de AMG.

## Modelo

```
users ──< memberships >── organizations ──< subscriptions >── products
  │                                                      │
  └──< sessions                                          └── payments
```

- Un **usuario** es una persona: nombre, correo, hash de contraseña.
- Una **organización** es el negocio: lo que paga y lo que contrata.
- Una **membresía** une usuario y organización con un **rol**. La misma persona
  puede estar en varias organizaciones con roles distintos.
- Una **sesión** es un inicio de sesión concreto, con suorganization activa.

### Roles

Tres, y a propósito. Los permisos finos (qué puede hacer una recepcionista) viven
en el producto, no acá: el Core no debería saber qué hace un peluquero.

| Rol | Puede |
|---|---|
| `member` | usar los productos que la organización contrató |
| `admin` | lo anterior + invitar gente, editar la organización, ver la auditoría |
| `owner` | lo anterior + **activar y cancelar suscripciones** (es quien paga) |

`owner` no se puede transferir a la ligera: solo un `owner` puede crear o quitar
otro `owner`, y no se puede dejar la organización sin ninguno.

## Contraseñas

- **bcrypt**, con salt por usuario. Nunca se guarda ni se registra la contraseña.
- Mínimo 8 caracteres, máximo 200 (bcrypt no corta de todas formas, pero el
  límite evita que alguien mande un libro entero).
- Comparación en tiempo constante.
- Al cambiar la contraseña se **cierran las otras sesiones** de esa persona. Es lo
  que hace alguien que cree que le robaron la cuenta.

### Recuperación

1. `POST /api/auth/password/forgot` genera un token de un solo uso (HMAC del
   token aleatorio, 60 min por defecto) y envía el enlace
   `{CORE_URL}/reset?token=...`.
2. `POST /api/auth/password/reset` lo consume y cambia la contraseña.

La respuesta del `forgot` es **siempre la misma**, exista el correo o no:
"si el correo existe, te enviamos un enlace". Si dijera "ese correo no existe",
sería un formulario para enumerar cuentas.

Sin `SMTP_HOST` los correos se registran en el log del servidor. Sirve para
desarrollar; en producción el usuario nunca recibe el enlace.

### Verificación de correo

Mismo mecanismo que la recuperación, con su propia tabla y su propia ventana
(24 h por defecto). Verificar el correo **no** es obligatorio para entrar: es un
estado informativo que se muestra en la interfaz. Blocking por correo sin
verificar sería una decisión de producto, no de infraestructura.

## Sesiones

La cookie es `amg_session` y su valor es `<id>.<secreto>`:

- `id` sirve para encontrar la fila (índice).
- `secreto` son 32 bytes aleatorios. En la base solo queda su **HMAC**, con
  `AMG_SESSION_SECRET` como pepper. Leer `core.sqlite` no sirve para suplantar a
  nadie.
- La comparación es en tiempo constante.

Por qué no un JWT de sesión: una sesión **se puede revocar**. Un JWT no. Y "cerrar
todas mis sesiones" es una función que la gente usa de verdad cuando cree que le
robaron la cuenta.

Atributos de la cookie:

| Atributo | Valor | Por qué |
|---|---|---|
| `httpOnly` | sí | el JavaScript de la página no la puede leer |
| `sameSite` | `Lax` | el navegador no la manda en peticiones de otro sitio: es la protección CSRF del sistema |
| `secure` | en producción | por HTTP plano la cookie viaja visible |
| `domain` | **ninguno** | host-only. Con `Domain=.amgdeveloper.cl` cualquier subdominio comprometido podría plantar una cookie para todos |
| `path` | `/` | |
| `maxAge` | 30 días | `CORE_SESSION_DAYS` |

`CSRF`: la protección es `SameSite=Lax` más el hecho de que las rutas que mutan
estado son JSON. Si alguna vez se acepta un formulario de otro sitio, hay que
agregar un token double-submit: la cookie sola no alcanza contra un `form POST`.

### Sesiones activas

`GET /api/auth/sessions` lista las sesiones vivas con IP, user agent y última
actividad. Se puede cerrar una en particular (`DELETE /api/auth/sessions/:id`) o
todas (`DELETE /api/auth/sessions`). El Core **verifica que la sesión sea del
dueño** antes de revocarla: sin ese chequeo, alguien que probara ids podría
cerrarle las sesiones a otro.

## Autorización

`authRequired` hace dos cosas: verifica la sesión y, si no hay, contesta 401 en la
API o **redirige al login** en una navegación de página, con `return_url` para
volver a donde el usuario quería.

`requireRole('admin')` es jerárquico: pasa `owner`, `admin` y `member` según el
mínimo pedido.

`req.amg` es la identidad verificada de la sesión. **Nunca se arma desde el
cliente**: si algo necesita la organización o el rol, sale de `req.amg`, nunca de
un `organizationId` que venga en el cuerpo o en la query. Es la regla que hace
imposible que una organización vea a otra.

## API

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/auth/register` | crea usuario + organización, deja sesión abierta |
| `POST` | `/api/auth/login` | autentica; devuelve `return_url` ya saneado |
| `POST` | `/api/auth/logout` | revoca la sesión actual |
| `GET` | `/api/auth/me` | quién eres y dónde (`401` si no) |
| `POST` | `/api/auth/switch-organization` | cambia la organización activa |
| `PATCH` | `/api/auth/profile` | nombre y correo |
| `POST` | `/api/auth/password` | cambia la contraseña, cierra las otras sesiones |
| `POST` | `/api/auth/password/forgot` | pide enlace de recuperación |
| `POST` | `/api/auth/password/reset` | consume el enlace |
| `POST` | `/api/auth/verify-email` | confirma el correo |
| `GET` | `/api/auth/sessions` | sesiones vivas |
| `DELETE` | `/api/auth/sessions` | cierra todas |
| `DELETE` | `/api/auth/sessions/:id` | cierra una |
| `GET` | `/api/auth/organizations/:id/members` | miembros (debe pertenecer) |
| `POST` | `/api/auth/organizations/:id/invitations` | invita (`admin`+) |
| `PUT` | `/api/auth/organizations/:id/members/:userId` | cambia el rol |
| `DELETE` | `/api/auth/organizations/:id/members/:userId` | saca a alguien |
| `POST` | `/api/auth/invitations/accept` | acepta y queda con sesión abierta |

Los errores siempre son `{ error: "mensaje en castellano", errors?: ... }`. Los
errores de validación de Zod vienen con `errors.fieldErrors`, que es lo que
permite marcar el campo exacto en el formulario.

## Freno a fuerza bruta

Tres `express-rate-limit`:

| Alcance | Límite |
|---|---|
| login (`/api/auth/login`) | 15 cada 5 min |
| recuperación (`/api/auth/password/*`) | 10 cada 15 min |
| toda la API | 1000 cada 15 min |

Los dos primeros **solo corren en producción**. En desarrollo y en tests estorban
más de lo que protegen: un test de "cerrar todas las sesiones" hace varios `POST`
y se comería el cupo. El global sí corre siempre, porque 1000 requests en 15
minutos es un techo que ningún uso legítimo toca.

Un rate limit por IP sola no es suficiente detrás de un proxy: por eso en
producción se activa `trust proxy`, para que `req.ip` sea la IP real del cliente y
no la del reverse proxy.
