# Arquitectura de la plataforma AMG

Documento de referencia del Core central y de los 8 mini-SaaS. Si algo de acá
contradice al código, el código manda: este documento explica por qué está así.

## La idea en una línea

Hay **una sola base de usuarios** (`core.sqlite`) y **ocho bases de negocio**, una
por producto. El Core sabe quién eres y qué compraste; cada producto sigue
sabiendo todo de su propio dominio.

Antes de esto, cada producto tenía su propia lista de usuarios. Eso obligaba a
crear la misma cuenta ocho veces, ocho contraseñas que se olvidan y ocho lugares
donde una contraseña se filtra. Ahora la contraseña existe en un solo lado.

## Los dos niveles

| | Core (plataforma) | Producto (mini-SaaS) |
|---|---|---|
| Package | `@amg/platform` | `@saas-mini/core` + `products/<x>` |
| Base | `core.sqlite` | `data/<x>/app.db` |
| Guarda | usuarios, organizaciones, membresías, sesiones, catálogo, suscripciones, pagos, SSO | lo de su dominio: citas, stock, órdenes... |
| Puerto | `3108` (host) | `3100`–`3107` (host) |
| Dominio | `desarrollador.amgdeveloper.cl` | un subdominio por producto |
| Contraseñas | sí, es el único | **no tiene** |
| `clients.json` | no lo usa | sí, lo usa (`clientsGuard`) |

### Paquetes

- **`packages/core`** (`@saas-mini/core`): lo que comparten los productos. `createApp`, config por producto, `clientsGuard`, helpers HTTP. **No sabe nada de la plataforma.**
- **`packages/platform`** (`@amg/platform`): el Core. Depende de `@saas-mini/core` solo por utilidades de HTTP y logger. No se importa desde un producto.
- **`packages/auth-client`** (`@amg/auth-client`): lo único que un producto importa para validar usuarios. Habla con el Core por HTTP; no depende del package del Core.
- **`products/landing`**: el servicio del Core. Sirve la API **y** la web (landing de marketing, catálogo, login, mi cuenta, mis aplicaciones). Es el único lugar donde se ejecuta `@amg/platform`.

## Rutas

El Core sirve dos cosas en el mismo puerto:

```
/                       landing de marketing (HTML estático existente)
/productos, /precios    catálogo, con precios desde la base
/productos/:slug        detalle de una herramienta
/contacto, /demos       contacto y demos
/login /registro        acceso (la misma página, modo según la ruta)
/recuperar /reset       recuperación de contraseña
/verificar-email        confirmación de correo
/invitacion             aceptar invitación a una organización
/mi-cuenta              perfil, organización, equipo, sesiones, pagos
/mis-aplicaciones       (/contratar) suscripciones y Contracting
/health                 sonda: {"ok":true} o 503, sin detalle

/api/auth/*             registro, login, sesiones, perfil, invitaciones
/api/account/*          resumen, aplicaciones, suscripciones, pagos, auditoría
/api/products           catálogo público (no pide sesión)
/api/sso/*              authorize, token, introspect
```

La UI es HTML + CSS + JS planos, sin framework ni build: el Core los sirve tal
cual. El texto que viene de la base se siempre inserta con `textContent`, nunca
con `innerHTML`.

## Despliegue

Una imagen, nueve servicios. `Dockerfile` compila todos los workspaces y cada
contenedor corre el indicado por `PRODUCT`.

```bash
# .env del servidor (NO se commitea)
AMG_SESSION_SECRET=<48 bytes hex>     # firma sesiones y códigos SSO
AMG_SSO_ROOT_SECRET=<48 bytes hex>    # raíz HKDF de los secretos por producto
```

```bash
docker compose build
docker compose up -d
docker compose logs -f landing
```

Lo que necesita atención al desplegar:

1. **El `.env` que lee `docker compose` es el de la raíz del repo**, no el de
   `products/landing`. Ahí van los dos secretos del Core y los `*_JWT` de cada
   producto (`PELU_JWT`, `INV_JWT`, `COTI_JWT`, `ALER_JWT`, `CRM_JWT`,
   `DOCU_JWT`, `DEPO_JWT`, `TALLE_JWT`). `docker compose config` lo dice antes de
   que nada, sin tocar un contenedor:

   ```bash
   docker compose config --quiet
   ```

2. **`AMG_SSO_ROOT_SECRET` es la raíz de todos los secretos SSO.** Si cambia, deja de validar el secreto de cada producto y hay que volver a pedir los 13. No se rota por debajo de la mesa.
3. **`CORE_URL` tiene que ser la URL real** (`https://desarrollador.amgdeveloper.cl`). Es la que va en los enlaces de recuperación y en el `iss` de los tokens SSO. Con `localhost` los correos mandan al lugar equivocado y los productos rechazan el token por `issuer`.
4. **El Core escucha en `127.0.0.1:3108`.** El binding a loopback es a propósito: nadie entra al Core desde internet sin pasar por el reverse proxy, que es el único que debe terminar TLS.
5. **El volumen del Core es `saasmini_data_core`**, en `/app/data/core/core.sqlite`. El `Dockerfile` crea ese directorio con `node` como dueño antes de montar: si no, `better-sqlite3` no puede crear el archivo y el arranque falla.
6. **Sin `CORE_DIAGNOSTICO_KEY`, `/api/_diagnostico` no existe** en producción (404). Con la clave, se puede consultar por header.

El volumen viejo `saasmini_data_landing` quedó sin uso: el Core no usa la base de
la landing. Se puede borrar con `docker volume rm saasmini_data_landing` una vez
confirmado que no se necesita el backup.

## Variables del Core

Las obligatorias en producción son dos, y el proceso **no arranca** si faltan
(`fail-fast`, sin valores por defecto conocidos):

| Variable | Para qué |
|---|---|
| `AMG_SESSION_SECRET` | HMAC de los tokens de sesión y de los códigos SSO |
| `AMG_SSO_ROOT_SECRET` | raíz HKDF de la que sale el secreto de cada producto |

El resto tiene defaults sensatos y están documentadas en
`products/landing/.env.example`. Las que más importan: `CORE_DB_PATH`,
`CORE_URL`, `CORE_SESSION_DAYS`, `CORE_RETURN_URL_HOSTS`, `CORE_SSO_CODE_TTL`,
`CORE_SSO_TOKEN_TTL`, `SMTP_*`.

## Desarrollo

```bash
npm install
npm run dev            # solo la API del Core, en :3008
npm run dev -w landing # el Core con la web, en :3008
npm run seed           # siembra catálogo y clientes SSO (idempotente)
npm run sso:secret -w @amg/platform -- citas   # imprime el secreto de un producto
npm test               # todos los workspaces
npm run typecheck
npm run build
```

`npm run typecheck` y `npm run build` asumen que `@saas-mini/core` y
`@amg/platform` ya compilaron: los tipos se resuelven desde `dist/`. Si cambiaste
un package del que depende otro, compilá primero.

En desarrollo, si no definís los dos secretos, se generan al azar **por proceso**:
el repo nunca lleva un secreto conocido. El costo es que reiniciar cierra las
sesiones y cambia el secreto SSO de cada producto, así que el proceso lo avisa por
stdout. Para no perder la sesión en cada reinicio, creá `products/landing/.env`
(a partir de `.env.example`) y **arrancá desde esa carpeta**: `dotenv` busca el
`.env` en el directorio de trabajo. En producción no hay atajo: o están o no
arranca.

### Estado actual

La plataforma está completa en su parte de identidad, catálogo y suscripciones.
Los productos **siguen con su login propio**: `@amg/auth-client` está listo y
probado, pero migrar un producto es un trabajo por producto (ver `SSO.md`). Hasta
que se migren, `clients.json` sigue siendo la activación técnica y el Core la
comercial.

## Documentos relacionados

- `AUTH.md` — usuarios, sesiones, roles, recuperación.
- `SSO.md` — el flujo entre el Core y cada subdominio, y cómo migrar uno.
- `BILLING.md` — catálogo, precios, suscripciones, pagos, y lo que falta.
- `DATA_ISOLATION.md` — las reglas de separación y cómo se hacen cumplir.
