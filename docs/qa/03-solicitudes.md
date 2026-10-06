# Plan de pruebas — Solicitudes

Mesa de ayuda (helpdesk). El sujeto es el **folio**: una solicitud entra por un canal, la
atiende alguien, se le escriben comentarios, se le adjuntan archivos y termina en
`Resuelta`, `Cerrada` o `Cancelada`. Lo que no puede pasar es que dos solicitudes de la
misma empresa compartan folio, ni que un cambio de estado deje de quedar escrito en el
historial.

Este plan se **diseña**, no se ejecuta. Cada caso dice qué hacer y qué se espera, no qué se
observó. Las reglas de sesión, la anatomía del caso y el checklist visual están en
`00-CONVENCIONES.md`.

---

## 1. Ficha técnica

| Qué | Valor |
|---|---|
| Slug | `solicitudes` |
| Nombre | Solicitudes (en Docker, `APP_NAME: Solicitudes y Ordenes`, `docker-compose.yml:114`) |
| Dominio | `solicitudes.amgdeveloper.cl` |
| Puerto de desarrollo | `3023` (`PORT=3023` en `products/solicitudes/.env.example`) |
| Puerto publicado detrás de nginx / Docker | `3102` (`README.md:43`, `ops/nginx.conf:38`, `docker-compose.yml:27`) |
| Script de desarrollo | `npm run dev:solicitudes` (raíz) → `npm run dev -w @amg/solicitudes` → `tsx watch src/index.ts` |
| Script de pruebas | `npm test -w @amg/solicitudes` (vitest, `products/solicitudes/tests/solicitudes.test.ts`) |
| Script de tipos | `npm run typecheck -w @amg/solicitudes` |
| Ruta local | `products/solicitudes` |
| Base de datos | `./data/solicitudes.sqlite` (`DB_PATH`); en Docker `/app/data/solicitudes.sqlite` sobre el volumen `saasmini_data_solicitudes` |
| Carpeta de adjuntos | `dirname(DB_PATH)/attachments` (`src/routes.ts:136-145`). El contenido **no** va a la base: en la tabla `attachments` solo queda la referencia `path`, que es siempre `attachments/<id del servidor>` |
| Versión de esquema declarada | `DB_SCHEMA_VERSION=1` en `.env.example` |
| Core (identidad) | `CORE_URL=http://localhost:3108`, `APP_URL=http://localhost:3023` |
| Credenciales SSO | `AMG_SSO_CLIENT_ID=solicitudes`; el secreto lo entrega el Core con `npm run sso:secret -w @amg/platform -- solicitudes` |
| Acento del producto | `--acento: #4f46e5`, `--acento-fuerte: #3d35b3`, `--acento-tenue: #eae9fc` (`public/style.css:20-23`). El color **no** se pasa por `AMIGO.montar({ color })`: sale de `style.css` |
| Logo en el canal | `SO` (`data-amigo="logo"`, `public/index.html:25`) |
| Casos de prueba | 79 casos agrupados por bloque (`NAV`, `CAT`, `LST`, `BUS`, `ALT`, `EDB`, `ADJ`, `COM`, `EST`, `AJUST`, `API`, `SIST`, `E2E`, `REG`) |

### Roles

La identidad trae `member`, `admin` u `owner` (`packages/product-runtime/src/auth.ts:29`).
**Solicitudes no consulta el rol en ninguna parte**: `src/routes.ts` no importa ni usa
`requireRole`, y `grep -n "role\|requireRole\|requireAdmin" products/solicitudes/src/*.ts`
no devuelve una sola coincidencia. `requireRole` sí existe y está exportado en el runtime
(`packages/product-runtime/src/auth.ts:156`), pero ningún producto de esta familia lo usa
en sus rutas propias cuando no monta el `crudRouter`.

| Superficie | Rol mínimo real |
|---|---|
| Lecturas (`/api/requests`, `/api/requests/:id`, `/api/resumen`, `/api/settings`, descarga de adjuntos) | cualquiera con sesión, incluido el rol más bajo |
| Escrituras (`POST`/`PATCH`/`DELETE /api/requests`, `POST .../comments`, `POST`/`DELETE .../attachments`) | **ninguno**: cualquier `member` borra solicitudes y adjuntos |
| `PUT /api/settings` | **ninguno**: cualquier `member` cambia moneda y zona horaria de la organización |

Verificar el Impacto en la §7, riesgo `R-04`.

### Paneles

`solicitudes` y `ajustes` (`AMIGO.montar({ nombre: 'Solicitudes', paneles: ['solicitudes',
'ajustes'], alEntrar })`, `public/app.js:422-426`). El canal los declara en `#tabs` con
`data-tab="solicitudes"` y `data-tab="ajustes"` (`public/index.html:34,36`), y la sección
activa viaja en la URL como `?panel=<clave>`. `nombre` no es una opción que `montar` lea
(`packages/product-runtime/public/amigo.js:131-141`): es inocuo.

**El producto tiene 2 paneles, no 8 como el índice del portfolio sugiere.** Todo lo que hay
en `#tabs` son dos enlaces: Solicitudes y Ajustes.

### Rutas de API

Todas bajo el runtime compartido salvo `/health` y `/api/meta`, que se montan antes de la
identidad y responden sin sesión (`packages/product-runtime/src/app.ts:109-121`), y
`/api/me` y `/api/inicio`, que las monta el propio runtime y ya exigen sesión
(`packages/product-runtime/src/auth.ts:116-150`). Este producto **no** usa `crudRouter`.

| Ruta | Método | Rol | Respuesta |
|---|---|---|---|
| `/api/requests` | GET | — | **`{ requests, total }`** — no `{ items, total }` |
| `/api/requests/:id` | GET | — | `{ request, comments, attachments, history }` |
| `/api/requests` | POST | — | `201 {"request": {…}}` |
| `/api/requests/:id` | PATCH | — | `200 {"request": {…}}` |
| `/api/requests/:id` | DELETE | — | `200 {"request": {…}}` (fila borrada) |
| `/api/requests/:id/comments` | POST | — | `201 {"comment": {…}}` |
| `/api/requests/:id/attachments` | POST | — | `201 {"attachment": {…}, "url": "/api/requests/<id>/attachments/<attId>/file"}` |
| `/api/requests/:id/attachments/:attId/file` | GET | — | descarga, `200` binario |
| `/api/requests/:id/attachments/:attId` | DELETE | — | `200 {"ok": true, "deleted": true}` |
| `/api/resumen` | GET | — | `{ total, abiertas, vencidas, resueltas, alta }` |
| `/api/settings` | GET | — | `{"settings": {"currency", "timezone", "nextNumber"}}` |
| `/api/settings` | PUT | — | `200 {"settings": {"currency", "timezone"}}` — **sin `nextNumber`** |

**Desviación deliberada del contrato compartido.** `GET /api/requests` devuelve
`{ requests, total }` (`src/routes.ts:392`) en vez del `{ items, total, limit, offset }` del
`crudRouter` (`packages/product-runtime/src/crud.ts`). No es un error: este producto
necesita un `LIKE` sobre cuatro columnas y un orden por folio, y el `crudRouter` no lo
expresa. Pero significa que **el contrato de lista de este producto NO es el del resto del
portfolio**, así que no se puede reutilizar ningún helper pensado para `{ items }`. Está
documentado como riesgo compartido `R-S-06` en `10-regresion-compartida.md`; aquí se prueba
como contrato propio en `SOL-LST-01` y `SOL-API-02`.

### Selectores: los que existen en el HTML y los que se arman en runtime

Mitad de los objetivos de esta pantalla **no aparecen en `index.html`**. Se crean desde JS
justo antes de que se pueda hacer clic en ellos, así que un caso que los cite tiene que
decir que hay que abrir el diálogo o esperar la lista primero.

| Selector u objeto | Dónde vive |
|---|---|
| `.ui-kpi` (las 4 tarjetas de `#resumen`) | `AMIGO_UI.kpis`, `packages/product-runtime/public/amigo-ui.js:238-260` |
| `<table>` con `Folio, Título, Solicitante, Responsable, Prioridad, Estado, Vence, ''` dentro de `#solicitudes-lista` | `AMIGO_UI.tabla`, `public/app.js:98-107` |
| `<span class="mono">` con el texto `#<folio>` | `public/app.js:114-116` |
| `.ui-etiqueta` de Prioridad y de Estado | `AMIGO_UI.estadoDe`, `public/app.js:132-133` |
| `.ui-etiqueta--malo` con el texto `<DD/MM/AAAA> · vencida` | `public/app.js:121-123` |
| Botón `Ver` | `AMIGO_UI.boton`, `public/app.js:136` |
| Botón `Borrar` (`ui-btn ui-btn--chico ui-btn--fantasma`) | `public/app.js:137-151` |
| `<tr>` vacío con `colspan="8"` y el texto `Todavía no hay solicitudes.` | `public/app.js:111` |
| `.ui-comentario` (`__cabeza`, `__autor`, `__fecha`, `__texto`) dentro de `#hilo` | `public/app.js:186-203` |
| `.ui-ficha` (`__cuerpo`, `__nota`, `__acciones`) con el `<a download>` y el botón `Quitar` dentro de `#adjuntos` | `public/app.js:213-244` |
| `.ui-evento` (`__cambio`, `__meta`) dentro de `#historial` | `public/app.js:254-267` |
| `.ui-vacio` (`<p>`) en `#hilo`, `#adjuntos`, `#historial` | `public/app.js:183, 209, 250` |

Los selectores que **sí** están en `public/index.html` y se pueden verificar leyendo el
archivo: `#tabs`, `[data-tab="solicitudes"]`, `[data-tab="ajustes"]`,
`[data-panel="solicitudes"]`, `[data-panel="ajustes"]`, `[data-amigo="logo|empresa|usuario|correo|avatar|otras|otras-titulo|titulo"]`,
`#solicitud-nueva`, `#resumen`, `#filtro-q`, `#filtro-estado`, `#filtro-prioridad`,
`#solicitudes-lista`, `#config-form`, `#cfg-moneda`, `#cfg-zona`, `#solicitud-dialog`,
`#solicitud-form`, `#solicitud-form-titulo`, `#solicitud-cerrar`, `#solicitud-guardar`,
`#solicitud-cancelar`, `#sol-folio`, `#sol-prioridad`, `#sol-estado`, `#sol-titulo`,
`#sol-descripcion`, `#sol-solicitante`, `#sol-correo`, `#sol-responsable`,
`#sol-vencimiento`, `#sol-resolucion`, `#hilo-seccion`, `#hilo`, `#comentario-texto`,
`#comentario-agregar`, `#adjuntos`, `#adjunto-archivo`, `#adjunto-agregar`, `#historial`,
`#aviso`.

### Cobertura por bloque

| Bloque | Qué cubre | Casos |
|---|---|---|
| `SOL-NAV` | Navegación entre paneles y deep-link | 5 |
| `SOL-CAT` | Tarjetas de resumen | 4 |
| `SOL-LST` | Tabla de solicitudes | 6 |
| `SOL-BUS` | `#filtro-q`, `#filtro-estado`, `#filtro-prioridad` y la búsqueda del servidor | 6 |
| `SOL-ALT` | Alta y folio | 7 |
| `SOL-EDB` | Edición y baja | 5 |
| `SOL-ADJ` | Adjuntos | 8 |
| `SOL-COM` | Comentarios | 5 |
| `SOL-EST` | Estados, transiciones e historial | 6 |
| `SOL-AJUST` | Ajustes de organización | 3 |
| `SOL-API` | Contratos, validaciones y rutas que no existen | 8 |
| `SOL-SIST` | Sesión, aislamiento, roles y límites | 5 |
| `SOL-E2E` | Recorridos completos | 6 |
| `SOL-REG` | Regresión del shell compartido | 5 |

---

## 2. Datos de prueba

**El producto no siembra nada.** `products/solicitudes/src/app.ts` no declara `seed`: los
datos de ejemplo pertenecerían a una organización, y esa organización solo existe cuando
hay una sesión real. En una base recién creada la pantalla arranca con `#resumen` en cero y
`#solicitudes-lista` con la fila `Todavía no hay solicitudes.`

**Base de trabajo.** Organización de QA propia del Core, para no ensuciar datos reales. Todo
lo que se cree lleva el prefijo `QA-SOL-2026` en los campos de texto (`Título`,
`Descripción`, `Solicitante`, `Responsable`, `Resolución`, nombre de archivo), según la
convención 5.5. **Ningún `INSERT` directo a la base**: todo se siembra por `POST /api/requests`
o por la interfaz.

**Catálogo mínimo para que los flujos tengan sentido.** Son 5 solicitudes y 1 caso especial,
creadas por API para llegar rápido a los estados que la interfaz tarda en producir:

| Dato | Cómo | Valores | Para qué |
|---|---|---|---|
| Abierta, prioridad alta | `POST /api/requests` | `title: "QA-SOL-2026 Impresora sin toner"`, `requesterName: "QA-SOL-2026 Ana Torres"`, `priority: "high"`, `status: "open"` | Base de `SOL-EST-01` |
| Abierta y vencida | `POST /api/requests` | `title: "QA-SOL-2026 Urge revisar servidor"`, `requesterName: "QA-SOL-2026 Pablo Ríos"`, `dueAt: "2026-01-15"`, `status: "open"` | Alimenta `Vencidas` y la etiqueta `· vencida` |
| En curso, con responsable | `POST /api/requests` | `title: "QA-SOL-2026 Migrar portal"`, `requesterName: "QA-SOL-2026 Carla Núñez"`, `responsibleName: "QA-SOL-2026 Equipo plataforma"`, `status: "in_progress"` | Hilo, responsable en la lista y búsqueda |
| Resuelta con resolución | `POST /api/requests` con `status: "resolved"`, `resolution: "QA-SOL-2026 Se reinició el equipo"` | — | `Resueltas`, historial con 1 entrada |
| Cerrada | `POST /api/requests` con `status: "closed"` | — | `closed_at` marcado |
| Cancelada | `POST /api/requests` con `status: "cancelled"` | — | Cuenta como `Resueltas` (riesgo `R-06`) |

**Fechas.** `dueAt` es una **fecha**, no un instante: se compara como cadena `YYYY-MM-DD`
contra un «hoy» calculado por el servidor con su hora local (`src/routes.ts:328-334`). Por
eso la única fecha que hay que elegir con cuidado es la del caso «vencida»: cualquier fecha
anterior a hoy sirve, y `2026-01-15` es cómodamente anterior.

**Adjuntos.** Tres archivos, guardados fuera del repo antes de empezar y subidos por
`#adjunto-archivo`:

| Archivo | Tamaño | Para qué |
|---|---|---|
| `QA-SOL-2026 captura.png` | ~40 KB | El camino feliz de `SOL-ADJ-01` |
| `QA-SOL-2026 informe.txt` | ~2 KB, `text/plain` | Descarga y nombre con espacios |
| `QA-SOL-2026 enorme.pdf` | **751 KB** | El tope de 750 KB, por debajo y por encima |

**Limpieza al terminar.** Borrar por `DELETE /api/requests/<id>` las 5 solicitudes `QA-SOL-`
(el cascade se lleva comentarios, adjuntos e historial, y el borrado también borra los
archivos de disco, `src/routes.ts:498-504`), y restaurar `#cfg-moneda` = `$` y
`#cfg-zona` = `America/Santiago` si se tocaron. Si se probó aislamiento, verificar que la
segunda organización no tiene nada con prefijo `QA-SOL-`.

---

## 3. Precondiciones

1. El Core está arriba: `npm run dev:core` (puerto `3108`) y responde `GET /health` con
   `200 {"ok":true}`.
2. El producto está arriba: `npm run dev:solicitudes`. La primera línea del log dice
   `Solicitudes (solicitudes) en <APP_URL> -> puerto <PORT>`; anotar ese puerto y esa URL,
   porque `.env` puede no coincidir con `.env.example` (ver `SOL-SIST-01`).
3. La organización de QA tiene la suscripción a `solicitudes` activa. Sin ella el middleware
   responde `403 {"error":"sin-acceso","message":"Tu organización no tiene acceso a este
   producto.","loginUrl":…}` (`packages/auth-client/src/middleware.ts:98`).
4. **No hay login local.** Este producto no pide usuario ni contraseña: la sesión vive en el
   Core. Se entra por `desarrollo.amgdeveloper.cl` (puerto `3108`) y el Core devuelve al
   producto. Que el producto redirija al login del Core es el flujo correcto, no un error de
   Auth (convención 5.3). `public/index.html` no tiene ningún `input[type=password]`.
5. Tester tipea sus credenciales. Nunca se le piden ni se anotan (convención 5.2).
6. **La sesión dura 15 minutos.** Al expirar, cualquier `/api/*` responde
   `401 {"error":"sin-sesion","loginUrl":"…"}` y el navegador salta al login del Core
   (`packages/auth-client/src/middleware.ts:119`). Volver a entrar y anotar el corte en la §9;
   no es un defecto del producto (convención 5.1).
7. **Límite de tasa: 600 peticiones / 15 min por IP**
   (`packages/product-runtime/src/app.ts:99-106`). Un `429` no es un defecto: se anota y se
   espera (convención 5.4). Los casos que tecleen en `#filtro-q` son los que más gastan:
   cada tecla dispara una petición (§7, `R-07`).
8. Cada caso que dependa de otro lo referencia por ID en **Precondición**.
9. Para los casos de API: DevTools abierto, pestaña **Network**, filtro de fetch/XHR
   activado, y `Copy as fetch` para reproducir una petición desde la consola.
10. Para todo lo que toque `dueAt`: **anotar en qué zona horaria está el navegador**
    (`Intl.DateTimeFormat().resolvedOptions().timeZone`). No tiene que coincidir con la de la
    organización, pero hay que saber cuál es: la §7 (`R-02`) dice que el servidor y el
    navegador pueden no coincidir en cuál es «hoy».

---

## 4. Casos por módulo

### 4.1 Navegación y deep-link

| | |
|---|---|
| **ID** | SOL-NAV-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/` y esperar la carga.<br>2. En Network, ordenar por tiempo y anotar la secuencia de las primeras peticiones.<br>3. Pulsar `[data-tab="ajustes"]` y volver a `[data-tab="solicitudes"]`. |
| **Esperado** | `#tabs` contiene exactamente dos enlaces, en este orden: `Solicitudes` (con el rótulo de grupo `Mesa de trabajo` arriba) y `Ajustes` (con `Configuración` arriba), más el bloque `Mis otras herramientas` que el shell rellena. Al cambiar de pestaña la URL pasa a `?panel=<clave>` con `history.pushState`, sin recargar, y el panel se muestra u oculta por `hidden`. El `h1[data-amigo="titulo"]` toma el texto de la pestaña activa. La secuencia de la primera carga es `GET /api/inicio` (`amigo.js:166`), `GET /api/settings`, `GET /api/resumen`, `GET /api/requests?limit=500`. |

| | |
|---|---|
| **ID** | SOL-NAV-02 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. En Network, filtrar `requests` en la primera carga.<br>2. Contar cuántas veces aparece `GET /api/requests`.<br>3. Repetir entrando por `?panel=ajustes` y contar. |
| **Esperado** | Entrando por la raíz hay **dos** peticiones `GET /api/requests?limit=500`: una desde `alEntrar('solicitudes')` (`public/app.js:419`, disparado por `AMIGO.montar` → `mostrar` → `alEntrar`) y otra desde la cadena de arranque `cargar().then(… pintarLista())` (`public/app.js:428-434`). Entrando por `?panel=ajustes` hay **una**: `alEntrar('ajustes')` solo llama `renderConfig()` (`public/app.js:418`) y no pide nada, pero la cadena de arranque igual pide el resumen y la lista. Las dos peticiones del primer caso devuelven lo mismo; verificar que la tabla no queda parpadeando ni muestra filas duplicadas. |

| | |
|---|---|
| **ID** | SOL-NAV-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/?panel=ajustes`.<br>2. Recargar con esa URL.<br>3. Abrir `?panel=basura`.<br>4. Navegar con los botones Atrás / Adelante después de cambiar de pestaña. |
| **Esperado** | 1 y 2: entra directo a Ajustes, `#cfg-moneda` y `#cfg-zona` quedan con los valores de `GET /api/settings` (recorren `form.elements`, no ids sueltos: `public/app.js:405-412`). 3: `?panel=basura` **cae al primer panel**, `solicitudes`, sin error en consola (`panelDeUrl` solo acepta claves declaradas, `amigo.js:40-43`). 4: Atrás y Adelante repintan por `popstate` y vuelven a pedir la lista. |

| | |
|---|---|
| **ID** | SOL-NAV-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=solicitudes`, con `#filtro-estado` = `open` y `#filtro-q` = `QA-SOL-2026`. |
| **Pasos** | 1. Ir a `?panel=ajustes` con el enlace del canal.<br>2. Volver a `?panel=solicitudes`.<br>3. Leer `#filtro-estado`, `#filtro-prioridad` y `#filtro-q` al volver. |
| **Esperado** | Los tres filtros conservan su valor al cambiar de panel: los controles viven en la sección `data-panel="solicitudes"`, que solo se oculta, y `alEntrar` no los toca. Al volver se vuelve a emitir `GET /api/requests?limit=500&status=open&q=QA-SOL-2026`, con los tres parámetros. La tabla que aparece ya viene filtrada, no vacía. |

| | |
|---|---|
| **ID** | SOL-NAV-05 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa, datos de la §2. |
| **Pasos** | 1. Leer `[data-amigo="empresa"]`, `[data-amigo="usuario"]`, `[data-amigo="correo"]` y `[data-amigo="avatar"]`.<br>2. Comparar con `GET /api/inicio`.<br>3. Mirar `[data-amigo="otras"]` y `[data-amigo="otras-titulo"]`. |
| **Esperado** | Los cuatro salen de la **única** llamada a `GET /api/inicio`: empresa = `organizacion.nombre`, usuario = `usuario.nombre`, correo = `usuario.email`, avatar = iniciales del nombre. `GET /api/inicio` devuelve `{"usuario":{id,nombre,email},"organizacion":{id,slug,nombre},"rol":"…","herramienta":"solicitudes","herramientas":[…]}`. `[data-amigo="otras-titulo"]` («Mis otras herramientas») queda `hidden` si el token no trae lista de herramientas o si solo trae esta. El logo conserva el texto fijo `SO` del HTML: `data-amigo="logo"` no se toca porque el código del shell lo escribe con `document.title` y este producto pasa `nombre`, no `color` (`amigo.js:65-67`). |

### 4.2 Tarjetas de resumen — `#resumen`

Las cuatro cifras salen de `GET /api/resumen`, que trae cinco claves y la interfaz solo
pinta cuatro. En la tabla de la §1, `total` no tiene contraparte en pantalla.

| | |
|---|---|
| **ID** | SOL-CAT-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. Base recién creada, o con solo la solicitud `Abierta, prioridad alta` de la §2. |
| **Pasos** | 1. Abrir `/` y leer las cuatro tarjetas dentro de `#resumen`.<br>2. Enumerar las claves de `GET /api/resumen`.<br>3. Comparar contra un conteo manual de `GET /api/requests?limit=500`. |
| **Esperado** | Cuatro `.ui-kpi`, en orden: `Abiertas`, `Vencidas`, `Resueltas`, `Prioridad alta`; solo `Abiertas` lleva la clase `ui-kpi__cifra--acento`. La API responde `200` con `{"total":N,"abiertas":N,"vencidas":N,"resueltas":N,"alta":N}`. `total` coincide con el número de filas del listado; las otras cuatro coinciden con el conteo manual. **`total` no se pinta en ninguna parte**: verificar su valor contra la tabla (riesgo `R-08`). |

| | |
|---|---|
| **ID** | SOL-CAT-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Con las 5 solicitudes de la §2: 2 `open`, 1 `in_progress`, 1 `resolved`, 1 `closed`, 1 `cancelled` (contar la `cancelled` como incluida). |
| **Pasos** | 1. Leer `GET /api/resumen`.<br>2. Contar a mano `abiertas`, `vencidas`, `resueltas` y `alta` sobre `GET /api/requests?limit=500`. |
| **Esperado** | `abiertas` cuenta **solo** las que están en `open` o `in_progress` (`ABIERTOS`, `src/routes.ts:67`): la `in_progress` sí cuenta. `resueltas` cuenta las que están en `resolved`, `closed` **o `cancelled`** (`src/routes.ts:335-337`): una cancelada suma como resuelta (riesgo `R-06`). `alta` cuenta **solo** las abiertas con prioridad `high` o `urgent`: una urgente ya resuelta no suma (riesgo `R-09`). `vencidas` son las **abiertas** con `dueAt` anterior a hoy; una resuelta con fecha pasada no cuenta (riesgo `R-10`). |

| | |
|---|---|
| **ID** | SOL-CAT-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=solicitudes`, con `#filtro-estado` = `cancelled`. |
| **Pasos** | 1. Leer las cuatro cifras de `#resumen`.<br>2. Contar las filas de `#solicitudes-lista`. |
| **Esperado** | Las cuatro cifras **no cambian**: los filtros llaman solo a `pintarLista()` (`public/app.js:377-379`) y nunca a `pintarResumen()`. Las tarjetas son globales y la tabla está filtrada, sin ningún texto que diga que las cifras no respetan el filtro (riesgo `R-11`). Anotar si se considera defecto de coherencia. |

| | |
|---|---|
| **ID** | SOL-CAT-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con `#filtro-q` = `QA-SOL-2026`. |
| **Pasos** | 1. Teclear una letra más en `#filtro-q`.<br>2. En Network, contar las peticiones `GET /api/requests`.<br>3. Escribí despacio, 6 caracteres, uno por segundo. |
| **Esperado** | Una petición por tecla: el evento `input` llama `pintarLista()` sin debounce ni cancelación (`public/app.js:377`). Con 6 caracteres salen 6 peticiones `GET /api/requests?limit=500&q=…`. Verificar que la tabla que queda al final corresponde a la **última** cadena escrita y no a una respuesta que llegó tarde (riesgo `R-07`). Contra la convención 5.4: 6 teclas son 6 de las 600 peticiones de la ventana. |

### 4.3 Tabla de solicitudes — `#solicitudes-lista`

| | |
|---|---|
| **ID** | SOL-LST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con las 5 solicitudes de la §2. |
| **Pasos** | 1. En Network, abrir la petición `GET /api/requests?limit=500`.<br>2. Enumerar las claves del cuerpo y las de `requests[0]`.<br>3. Contar las filas de `#solicitudes-lista` y leer los encabezados. |
| **Esperado** | `200` con el cuerpo **`{"requests":[…],"total":N}`**: la clave es `requests`, no `items`, y **no** hay `limit` ni `offset` en el sobre (`src/routes.ts:392`). Cada fila trae `id`, `organizationId`, `number`, `title`, `description`, `requesterName`, `requesterEmail`, `responsibleName`, `priority`, `status`, `dueAt`, `resolution`, `closedAt`, `createdAt`, `updatedAt`. El `id` lleva prefijo `sol`. La tabla tiene 8 columnas: `Folio`, `Título`, `Solicitante`, `Responsable`, `Prioridad`, `Estado`, `Vence`, y una octava sin título que contiene los botones. |

| | |
|---|---|
| **ID** | SOL-LST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Con 3 solicitudes con folios 3, 7 y 12. |
| **Pasos** | 1. Leer la columna `Folio` de arriba abajo.<br>2. Crear por API una solicitud con `"number": 900` y recargar la lista. |
| **Esperado** | Orden **descendente por folio**, no por fecha de creación: `desc(requests.number)` (`src/routes.ts:388`). La primera fila es `#12`. Con `number: 900` la nueva pasa a ser la primera, aunque sea la más reciente en el tiempo pero la más alta en número. El folio se pinta como `#<número>` dentro de un `<span class="mono">` (`public/app.js:114-116`). |

| | |
|---|---|
| **ID** | SOL-LST-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una solicitud sin `responsibleName`, otra sin `dueAt`, otra sin `description`. |
| **Pasos** | 1. Leer la fila de cada una de las tres.<br>2. En `#solicitudes-lista`, mirar la columna `Responsable` y la columna `Vence`. |
| **Esperado** | `Responsable` muestra `—` cuando el campo es `null` (`r.responsibleName ?? '—'`, `public/app.js:131`). `Vence` muestra `—` cuando `dueAt` es `null`, porque `fecha(null)` devuelve `—` (`public/app.js:55-60`). La fecha se muestra como `DD/MM/AAAA`, no ISO ni con mes abreviado. Ninguna de las tres celdas queda en blanco. |

| | |
|---|---|
| **ID** | SOL-LST-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Una solicitud `open` con `dueAt` = una fecha anterior a hoy, y otra `open` con `dueAt` = hoy. |
| **Pasos** | 1. Leer las dos celdas de `Vence`.<br>2. Cambiar el estado de la primera a `resolved` desde el diálogo y volver a leer. |
| **Esperado** | La primera muestra una `.ui-etiqueta--malo` con el texto `<DD/MM/AAAA> · vencida` (con el punto medio pegado, `public/app.js:123`). La segunda muestra la fecha como texto plano, sin etiqueta. **Solo** se marca `· vencida` la que está en `open` o `in_progress`: al pasar la primera a `resolved`, la celda deja de ser etiqueta y vuelve a ser texto con la misma fecha, aunque la fecha siga en el pasado (`vencida()`, `public/app.js:85-86`). |

| | |
|---|---|
| **ID** | SOL-LST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Base sin ninguna solicitud de esta organización. |
| **Pasos** | 1. Abrir `/`.<br>2. Leer la única fila de `#solicitudes-lista`. |
| **Esperado** | Un `<tr>` con **una sola celda** de `colspan="8"` y el texto `Todavía no hay solicitudes.` dentro de un `.ui-vacio` (`public/app.js:111`). La tabla conserva su encabezado de 8 columnas; la fila vacía no empuja las columnas. En `#resumen`, las cuatro cifras son `0`. |

| | |
|---|---|
| **ID** | SOL-LST-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con más de 500 solicitudes de esta organización (sembradas por API en lote). |
| **Pasos** | 1. Cargar `/` y contar las filas de `#solicitudes-lista`.<br>2. En Network, leer `total` de la respuesta.<br>3. Comparar las dos cifras con las cuatro de `#resumen`. |
| **Esperado** | La lista trae `requests.length` = **500 filas** y `total: 500`, aunque haya más. El tope es `Math.min(Math.max(Number(limit) || 200, 1), 500)` (`src/routes.ts:382`); la interfaz siempre pide `limit=500` (`public/app.js:92`). **`total` es el conteo después del recorte, no el total real**: las cuatro tarjetas de `#resumen` muestran el número verdadero y la tabla muestra la mitad, sin ningún aviso de truncamiento (riesgo `R-12`). No hay paginador ni forma de llegar a las filas que faltan. |

### 4.4 Búsqueda y filtros

La búsqueda del servidor cubre **cuatro columnas**: `title`, `description`, `requesterName`
y `responsibleName` (`src/routes.ts:370-381`). No cubre `requesterEmail`, `resolution`,
`number`, `priority`, `status` ni `dueAt`. Es una desviación que hay que probar como tal.

| | |
|---|---|
| **ID** | SOL-BUS-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Con las 5 solicitudes de la §2. |
| **Pasos** | 1. Escribir `Impresora` en `#filtro-q`.<br>2. En Network, leer la URL exacta.<br>3. Leer `total` y las filas. |
| **Esperado** | `GET /api/requests?limit=500&q=Impresora` con `200`, `total: 1`, y una fila cuyo `Título` es `QA-SOL-2026 Impresora sin toner`. El texto se va por `encodeURIComponent` tras un `trim()` (`public/app.js:89,95`). La tabla se repinta sin recargar la página. |

| | |
|---|---|
| **ID** | SOL-BUS-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Con las 5 solicitudes de la §2. |
| **Pasos** | 1. Escribir `plataforma` en `#filtro-q` (aparece solo en `responsibleName` de «Migrar portal»).<br>2. Borrar y escribir `MIGRAR` en mayúsculas.<br>3. Repetir con `QA-SOL-2026 Ana` (espacio en medio). |
| **Esperado** | 1: `total: 1`, la de `responsibleName: "QA-SOL-2026 Equipo plataforma"` — el buscador **sí** cubre el responsable. 2: `total: 1` también: el `LIKE` de SQLite no distingue mayúsculas de minúsculas para ASCII. 3: `total: 1`, la de `requesterName: "QA-SOL-2026 Ana Torres"` — el patrón es `%Ana%`, así que el espacio no es un separador ni un comodín. |

| | |
|---|---|
| **ID** | SOL-BUS-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Con una solicitud cuyo `requesterEmail` sea `qa.buscador@example.com` y otra con `resolution: "QA-SOL-2026 Se reinició el equipo"`. |
| **Pasos** | 1. Escribir `example.com` en `#filtro-q`.<br>2. Escribir `reinició` en `#filtro-q`.<br>3. Escribir el número de folio de una solicitud en `#filtro-q`. |
| **Esperado** | Los tres devuelven `total: 0`. El buscador **no** cubre `requesterEmail` ni `resolution` ni `number`, aunque el placeholder diga `Título, solicitante, responsable…` (`public/index.html:74`) y no advierta que la descripción sí se cubre. Con `#filtro-q` con texto y `total: 0`, `#solicitudes-lista` muestra la fila vacía de `SOL-LST-05`. Registrar como diferencia funcional frente a lo que el placeholder sugiere (riesgo `R-13`). |

| | |
|---|---|
| **ID** | SOL-BUS-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Con las 5 solicitudes de la §2. |
| **Pasos** | 1. Poner `#filtro-estado` en `resolved`.<br>2. En Network, leer la URL.<br>3. Poner además `#filtro-prioridad` en `high`.<br>4. Leer la URL y las filas.<br>5. Reponer `#filtro-estado` en `Todos` (valor `""`). |
| **Esperado** | 2: `GET /api/requests?limit=500&status=resolved`. 4: `GET /api/requests?limit=500&status=resolved&priority=high` y `total: 0` si no hay nada con las dos condiciones: los filtros se acumulan con `and`, no se reemplazan. 5: con el valor `""` el parámetro **desaparece** de la URL, no se manda `status=` (solo se agrega si el valor es distinto de vacío, `public/app.js:93-94`). Cada cambio de `#filtro-estado` o `#filtro-prioridad` emite una sola petición; no hay botón de «limpiar filtros», hay que poner los dos selects en su primera opción. |

| | |
|---|---|
| **ID** | SOL-BUS-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Escribir `%` en `#filtro-q`.<br>2. Escribir `_` en `#filtro-q`.<br>3. Escribir `QA-SOL-2026` (contiene guiones) y leer `total`. |
| **Esperado** | 1 y 2: el patrón se arma como `%${q}%` y no escapa nada, así que `%` se interpreta como comodín de `LIKE` y devuelve **todas** las solicitudes (`total` = todas), y `_` devuelve todas las que tengan al menos un carácter en la posición. La pantalla muestra la lista completa mientras el usuario cree que filtró (riesgo `R-14`). 3: los guiones no son comodines en `LIKE`, así que `QA-SOL-2026` devuelve solo las 5 de la §2. |

| | |
|---|---|
| **ID** | SOL-BUS-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `fetch('/api/requests?status=basura')`.<br>2. `fetch('/api/requests?priority=99')`.<br>3. `fetch('/api/requests?status=open&status=closed')`.<br>4. `fetch('/api/requests?q=')`. |
| **Esperado** | Los cuatro `200`. 1 y 2: un valor de filtro desconocido **no** da `400`: se compara tal cual contra la columna de texto y sale `requests: []`, `total: 0`. No hay validación de enum en los filtros de query (a diferencia de los del cuerpo, que sí usan `z.enum`). 3: con el parámetro repetido, `req.query.status` es un arreglo, `typeof … === 'string'` es falso y **el filtro se ignora en silencio**: devuelve la lista completa. 4: `q` vacío equivale a no enviarlo. |

### 4.5 Alta de solicitud y folio

El folio lo propone el servidor y la interfaz lo puede cambiar (`public/app.js:170,297`). El
propuesto es el **máximo que existe más uno**, no el conteo (`src/routes.ts:170-177`).

| | |
|---|---|
| **ID** | SOL-ALT-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, base con las 5 solicitudes de la §2 (folios 1 a 5). |
| **Pasos** | 1. Pulsar `#solicitud-nueva`.<br>2. Leer `#solicitud-dialog`, `#solicitud-form-titulo`, `#solicitud-guardar`, `#sol-folio`, `#sol-prioridad`, `#sol-estado`.<br>3. Comprobar si `#hilo-seccion` está visible. |
| **Esperado** | El `<dialog>` abre con `showModal()`: fondo atenuado, foco dentro, `Esc` cierra. `#solicitud-form-titulo` dice `Nueva solicitud` y `#solicitud-guardar` dice `Guardar solicitud`. `#sol-folio` trae **6**, el `nextNumber` de `GET /api/settings`. `#sol-prioridad` vale `medium` y `#sol-estado` vale `open`. `#hilo-seccion` está **oculto**: los comentarios, los adjuntos y el historial solo existen al editar una solicitud existente. Los otros once campos (`#sol-titulo`, `#sol-descripcion`, `#sol-solicitante`, `#sol-correo`, `#sol-responsable`, `#sol-vencimiento`, `#sol-resolucion`) están vacíos. |

| | |
|---|---|
| **ID** | SOL-ALT-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#solicitud-dialog` abierto en modo «nueva». |
| **Pasos** | 1. Escribir en `#sol-titulo` `QA-SOL-2026 No abre la impresora`, en `#sol-descripcion` `QA-SOL-2026 Imprime en blanco`, en `#sol-solicitante` `QA-SOL-2026 Ana Torres`, en `#sol-correo` `ana.torres@example.com`, en `#sol-responsable` `QA-SOL-2026 Equipo plataforma`, en `#sol-vencimiento` `2026-12-31`, en `#sol-resolucion` `QA-SOL-2026 Se cambió el tóner`.<br>2. Dejar `#sol-prioridad` en `urgent` y `#sol-estado` en `in_progress`.<br>3. Pulsar `#solicitud-guardar`.<br>4. Leer Network, `#aviso` y la primera fila de `#solicitudes-lista`. |
| **Esperado** | `POST /api/requests` `201` con `{"request":{…}}`. El cuerpo enviado lleva `number`, `title`, `description`, `requesterName`, `requesterEmail`, `responsibleName`, `priority`, `status`, `dueAt` y `resolution`, con los vacíos convertidos a `null` (`|| null`, `public/app.js:299-306`). El aviso dice `Solicitud creada`, el diálogo se cierra, y la fila aparece con `Urgente` en `Prioridad` y `En curso` en `Estado`. La columna `Vence` muestra `31/12/2026`. |

| | |
|---|---|
| **ID** | SOL-ALT-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#solicitud-dialog` abierto en modo «nueva». |
| **Pasos** | 1. Dejar `#sol-titulo` vacío y llenar el resto.<br>2. Pulsar `#solicitud-guardar`.<br>3. Llenar `#sol-titulo` y borrar `#sol-solicitante`.<br>4. Pulsar `#solicitud-guardar`.<br>5. Repetir el alta por API con `{"requesterName":"X"}` (sin `title`) y después con `{"title":"X"}` (sin `requesterName`). |
| **Esperado** | 1 y 2: el navegador **bloquea** el envío por `required` en `#sol-titulo` y enfoca el campo; no hay ninguna petición en Network. 3 y 4: lo mismo por `required` en `#sol-solicitante`. 5: ambos `POST` dan `400 {"error":"Datos inválidos"}` con `errors.fieldErrors.title` o `.requesterName`. Son los dos únicos campos obligatorios: `description`, `requesterEmail`, `responsibleName`, `dueAt` y `resolution` son opcionales. |

| | |
|---|---|
| **ID** | SOL-ALT-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con una solicitud de folio `1`. |
| **Pasos** | 1. Poner `#sol-folio` = `1` y guardar una solicitud nueva.<br>2. Repetir con `#sol-folio` = `99`.<br>3. Repetir con `#sol-folio` = `0` y luego con `-5`. |
| **Esperado** | 1: `POST /api/requests` `409` con `{"error":"Ya existe la solicitud numero 1 en esta empresa"}` — sin tilde en «numero», es el texto literal de `src/routes.ts:226`. El aviso lo muestra en rojo y **el diálogo no se cierra**, para poder corregir. 2: `201`: el folio es único por empresa pero no hay un rango de negocio, así que un folio alto se acepta y queda primero en la lista. 3: `#sol-folio` es `<input type="number" min="1">`, así que el navegador bloquea el envío por `min` sin dejar salir la petición; por API, `0` y `-5` dan `400 Datos inválidos` (`number` es entero de 1 a 9 999 999, `src/routes.ts:115`). |

| | |
|---|---|
| **ID** | SOL-ALT-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con las 5 solicitudes de la §2 (folios 1 a 5). |
| **Pasos** | 1. Por API, `POST /api/requests` con `"number": 900`.<br>2. `GET /api/settings` y leer `nextNumber`.<br>3. Crear y borrar una solicitud normal desde la interfaz.<br>4. `GET /api/settings` otra vez. |
| **Esperado** | 1: `201` con folio `900`. 2: `nextNumber` = **901**: es el máximo más uno, no el conteo más uno (`MAX(number) + 1`, `src/routes.ts:170-177`). 3: si se borra la solicitud de folio máximo, el folio se vuelve a proponer: `nextNumber` vuelve a ser ese número. El comentario del código justifica no usar «contar + 1» para no chocar contra el índice único, pero borrar una fila sí libera su folio (riesgo `R-15`). 4: confirmar el valor. |

| | |
|---|---|
| **ID** | SOL-ALT-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#solicitud-dialog` abierto, con datos escritos, en una página que acaba de cargar. |
| **Pasos** | 1. Pulsar `#solicitud-guardar` y esperar a que aparezca el aviso `Solicitud creada`.<br>2. **Sin recargar la página**, pulsar `#solicitud-nueva` otra vez.<br>3. Leer `#sol-folio`.<br>4. Llenar título y solicitante y pulsar `#solicitud-guardar`. |
| **Esperado** | 3: `#sol-folio` trae **el mismo número que se acaba de usar**. Tras guardar, el código recarga la lista y el resumen (`public/app.js:321-322`) pero **no vuelve a pedir `/api/settings`**, así que `estado.cfg.nextNumber` sigue con el valor viejo y `limpiaFormulario()` lo vuelve a poner en el campo (`public/app.js:170`). 4: el `POST` responde `409 Ya existe la solicitud numero N en esta empresa` y el aviso sale en rojo. El segundo alta de una sesión de navegador requiere cambiar el folio a mano o recargar. Confirmar si es defecto (riesgo `R-16`). |

| | |
|---|---|
| **ID** | SOL-ALT-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/requests` con `"dueAt": "2026-9-4"`.<br>2. Con `"dueAt": "2026-02-31"`.<br>3. Con `"dueAt": "2026-13-01"`.<br>4. Con `"dueAt": "después de la reunión"`.<br>5. Con `"dueAt": "2026-09-04"` (el formato correcto). |
| **Esperado** | 1 y 4: `400 Datos inválidos` con `errors.fieldErrors.dueAt` = `La fecha limite va como AAAA-MM-DD`. 2 y 3: el formato pasa pero la fecha no existe: `400 Datos inválidos` con `errors.fieldErrors.dueAt` = `Fecha invalida`. 5: `201`, y `dueAt` se guarda exactamente como `2026-09-04`. La validación es una expresión regular más un `Date.parse` de `<valor>T00:00:00Z`, no `Date.parse` sobre el valor crudo: `2026-9-4` se rechaza aunque `Date.parse` la entendiera (`src/routes.ts:97-103`). `#sol-vencimiento` es `<input type="date">`, así que el navegador no puede producir nada fuera del formato. |

### 4.6 Edición y baja

| | |
|---|---|
| **ID** | SOL-EDB-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con una solicitud de la §2. |
| **Pasos** | 1. En su fila de `#solicitudes-lista`, pulsar `Ver`.<br>2. Leer `#solicitud-form-titulo`, `#solicitud-guardar`, `#hilo-seccion`.<br>3. Comprobar que los once campos trae el valor de la fila.<br>4. En Network, leer la petición que se hizo al abrir. |
| **Esperado** | 4: `GET /api/requests/<id>` `200` con `{"request":{…},"comments":[…],"attachments":[…],"history":[…]}`. El diálogo abre con `#solicitud-form-titulo` = `Solicitud #<número>` y `#solicitud-guardar` = `Guardar cambios` (`public/app.js:276,287`). `#hilo-seccion` pasa a visible y los tres bloques aparecen. Es la **única** forma de leer el hilo: no hay pantalla de comentarios aparte. |

| | |
|---|---|
| **ID** | SOL-EDB-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#solicitud-dialog` abierto en modo edición, con la solicitud `QA-SOL-2026 Migrar portal`. |
| **Pasos** | 1. Cambiar solo `#sol-responsable` a `QA-SOL-2026-turno-noche`.<br>2. Pulsar `#solicitud-guardar`.<br>3. En Network, leer el cuerpo del `PATCH`.<br>4. Repetir cambiando solo `#sol-estado` a `in_progress`, y volver a abrir con `Ver`. |
| **Esperado** | 2: `PATCH /api/requests/<id>` `200` con `{"request":{…}}` y el aviso `Solicitud actualizada`. 3: la interfaz manda **los once campos**, no solo el que cambió (`cuerpoDelFormulario()` no mira qué se tocó, `public/app.js:295-308`). 4: como los otros campos vienen precargados, no se pierde nada; el `PATCH` del servidor además **parte de la fila existente** y mezcla el cuerpo encima (`src/routes.ts:456-468`), así que un `PATCH` por API con un solo campo tampoco borra el resto. |

| | |
|---|---|
| **ID** | SOL-EDB-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#solicitud-dialog` abierto en modo edición, con datos escritos y cambios sin guardar. |
| **Pasos** | 1. Pulsar `#solicitud-cancelar`.<br>2. Repetir con `#solicitud-cerrar` (la `×`, `aria-label="Cerrar"`).<br>3. Repetir con la tecla `Esc`.<br>4. Volver a abrir con `Ver` y leer los campos. |
| **Esperado** | Los tres cierran el `<dialog>` con `.close()` (`public/app.js:328-329` y el comportamiento nativo de `Esc` en un `dialog` modal). No sale ninguna petición en ninguno de los tres casos, ni un `PATCH` de guardado automático. Al reabrir con `Ver`, los campos traen los valores **guardados**, no los escritos antes de cancelar: los cambios se pierden sin aviso y sin diálogo de confirmación. |

| | |
|---|---|
| **ID** | SOL-EDB-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con la solicitud `QA-SOL-2026 Migrar portal`, un comentario y un adjunto. |
| **Pasos** | 1. En su fila, pulsar `Borrar`.<br>2. Cancelar el `confirm` del navegador.<br>3. Volver a pulsar `Borrar` y **confirmar**.<br>4. Leer Network, `#aviso`, las cuatro cifras de `#resumen` y la tabla.<br>5. `GET /api/requests/<id>` con el id borrado. |
| **Esperado** | 2: el `confirm` dice `¿Borrar la solicitud con su hilo y sus adjuntos?`; al cancelar no sale ninguna petición. 3: `DELETE /api/requests/<id>` `200` con `{"request":{…}}` (**la fila borrada**, no `{ok:true}`), el aviso dice `Solicitud borrada`, la fila desaparece de la tabla y `#resumen` se recalcula. 5: `404 {"error":"Esa solicitud no existe"}`. El `cascade` de la base se lleva comentarios, adjuntos e historial, y el handler borra además los archivos de disco leyendo las filas de `attachments` **antes** de borrar la solicitud (`src/routes.ts:485-504`). |

| | |
|---|---|
| **ID** | SOL-EDB-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `PATCH /api/requests/sol_inexistente` con `{"status":"resolved"}`.<br>2. `DELETE /api/requests/sol_inexistente`.<br>3. `POST /api/requests/sol_inexistente/comments` con `{"content":"x"}`.<br>4. `POST /api/requests/sol_inexistente/attachments` con `{"filename":"a.txt","data":"eA=="}`. |
| **Esperado** | Los cuatro `404` con `{"error":"Esa solicitud no existe"}`. **Ninguna escritura de la pantalla o de la API crea nada en otra organización ni acepta un id inventado**: `solicitudDe` filtra por `id` **y** por `organization_id` de la sesión (`src/routes.ts:153-161`). Un `404`, nunca un `403`: el 404 no confirma que el id exista en otra empresa. |

### 4.7 Adjuntos

El tope es **750 000 bytes**, pasado explícitamente por el producto a `revisarAdjunto`
(`src/routes.ts:566-570`). El cuerpo en base64 pesa 4/3, así que un archivo de 750 KB ocupa
cerca de 1 MB de JSON: el límite justo queda por debajo del `express.json({ limit: '1mb' })`
del runtime, que responde `413 {"error":"La petición es demasiado grande"}`
(`packages/product-runtime/src/errors.ts:36-38`).

| | |
|---|---|
| **ID** | SOL-ADJ-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `Ver` abierto sobre `QA-SOL-2026 Migrar portal`. |
| **Pasos** | 1. Elegir `QA-SOL-2026 captura.png` en `#adjunto-archivo`.<br>2. Pulsar `#adjunto-agregar`.<br>3. En Network, leer el `POST` y su cuerpo.<br>4. Leer `#adjuntos`. |
| **Esperado** | `POST /api/requests/<id>/attachments` `201` con `{"attachment":{…},"url":"/api/requests/<id>/attachments/<attId>/file"}`. El `attachment` trae `id` con prefijo `soladj`, `organizationId`, `requestId`, `filename`, `path` con el formato `attachments/<id>`, `mimeType`, `sizeBytes` y `createdAt`. El navegador manda `data` como **data URI completo** (`data:image/png;base64,…`), no base64 pelado, porque usa `FileReader.readAsDataURL` (`public/app.js:359-364`); el servidor acepta las dos formas (`src/routes.ts:564`). En `#adjuntos` aparece una `.ui-ficha` con el nombre del archivo como enlace de descarga, el peso como `40.0 KB` y un botón `Quitar`. |

| | |
|---|---|
| **ID** | SOL-ADJ-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#adjuntos` con `QA-SOL-2026 captura.png` visible. |
| **Pasos** | 1. Leer el peso que muestra la `.ui-ficha__nota`.<br>2. Comparar con `sizeBytes` de la fila en `GET /api/requests/<id>`.<br>3. Con `QA-SOL-2026 enorme.pdf` (751 KB) de la §2, elegirlo en `#adjunto-archivo` y pulsar `#adjunto-agregar`. |
| **Esperado** | 2: la nota se calcula como `(sizeBytes / 1024).toFixed(1)` y se rotula `KB` (`public/app.js:223`). Para 40 960 bytes muestra `40.0 KB`: la operación es KiB (1024) y la unidad dice KB (1000). Es un desajuste menor pero visible en archivos de tamaño redondo. 3: la interfaz **rechaza antes de salir**: `#aviso` en rojo con `El archivo no puede superar 750 KB` — sin punto final, que es el texto del cliente (`public/app.js:355`) — y **no** hay ninguna petición en Network. Para ver el mensaje del servidor hay que subirlo por API (ver `SOL-ADJ-03`). |

| | |
|---|---|
| **ID** | SOL-ADJ-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con una solicitud abierta. |
| **Pasos** | 1. `POST /api/requests/<id>/attachments` con `filename: "grande.pdf"`, `mimeType: "application/pdf"` y `data` = base64 de 760 000 bytes.<br>2. Repetir con 750 000 bytes.<br>3. Repetir con 750 001 bytes.<br>4. Repetir con `data: "eA=="` (1 byte). |
| **Esperado** | 1: `413 {"error":"El archivo no puede superar 750 KB."}` — **con punto final**, y este es el mensaje del servidor, distinto del de la interfaz. 2: `201`. 3: `413`. 4: `400 {"error":"El archivo llegó vacío."}` solo si el buffer decodificado queda en 0 bytes; con `data: "eA=="` hay 1 byte y debería dar `201`. Verificar ambos, porque `data` tiene un mínimo de 4 caracteres (`src/routes.ts:560`) y `"eA=="` los cumple. Un archivo de 750 KB sí cabe en el `express.json` de 1 MB: base64 son ~1 000 000 bytes, por debajo de 1 048 576. Confirmar que un archivo de 786 KB sí revienta con el mensaje del parser y no con el del producto. |

| | |
|---|---|
| **ID** | SOL-ADJ-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con una solicitud abierta. |
| **Pasos** | 1. `POST …/attachments` con `filename: "engano.html"`, `mimeType: "text/html"` y `data` = base64 de `<script>alert(1)</script>`.<br>2. Repetir con el mismo contenido pero `mimeType: "application/octet-stream"`.<br>3. Repetir con `mimeType` ausente y `filename: "engano.html"`. |
| **Esperado** | 1: `415 {"error":"Ese tipo de archivo no se admite (text/html). Se aceptan imágenes, PDF, documentos de Office, texto, video y ZIP."}`. 2: `201` — `application/octet-stream` está en la lista. 3: **`201`, no `415`**: sin `mimeType` el tipo se deduce de la extensión, y `html` no está en `POR_EXTENSION`, así que cae al tipo genérico `application/octet-stream`, que **sí** está en la lista (`packages/product-runtime/src/attachments.ts:63,113-118`). El mismo `.html` con `text/html` declarado se rechaza y sin declarar se guarda, según lo que mande el cliente (riesgo `R-17`). El `attachment` guardado trae `mimeType: null`. Descargar el archivo del paso 2 y revisar las cabeceras de respuesta: `content-type: application/octet-stream`, `x-content-type-options: nosniff`, `content-security-policy: default-src 'none'; sandbox` y `content-disposition` empezando por `attachment` (`packages/product-runtime/src/attachments.ts:192-201`). Nunca se sirve como página del producto. |

| | |
|---|---|
| **ID** | SOL-ADJ-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#adjuntos` con un archivo visible. |
| **Pasos** | 1. Pulsar el enlace del nombre de archivo.<br>2. En Network, leer la petición de descarga y sus cabeceras de respuesta.<br>3. Cancelar el `confirm` del botón `Quitar`.<br>4. Volver a pulsar `Quitar` y confirmar.<br>5. Leer Network, `#adjuntos` y `GET /api/requests/<id>`. |
| **Esperado** | 2: `GET /api/requests/<id>/attachments/<attId>/file` `200`, y la descarga usa el nombre con el que se subió. 3: el `confirm` dice `¿Quitar este adjunto?`; al cancelar no hay petición. 4: `DELETE /api/requests/<id>/attachments/<attId>` `200` con `{"ok":true,"deleted":true}`, la `.ui-ficha` desaparece de `#adjuntos` y `attachments` queda con longitud 0. El `confirm` aparece en Quitar y en Borrar solicitud, pero **no** al cerrar o guardar el diálogo. |

| | |
|---|---|
| **ID** | SOL-ADJ-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con una solicitud de esta organización. |
| **Pasos** | 1. `POST …/attachments` con `filename: "../../etc/passwd\".txt"`, `mimeType: "text/plain"`, `data: "eA=="`, y leer el `attachment.filename` devuelto.<br>2. Descargar el archivo y leer la cabecera `content-disposition` completa.<br>3. `POST …/attachments` con `filename: "informe.pdf"` y un nombre de 300 caracteres. |
| **Esperado** | 1: `201`, y el `filename` guardado **no** contiene `/`, `\`, ni `"`, ni empieza con `..` (`nombreSeguro`, `packages/product-runtime/src/attachments.ts:143-156`). El archivo en disco se llama por el **id del servidor**, nunca por el nombre recibido: `path` es `attachments/soladj_…` y al servir se reconstruye con `basename` (`src/routes.ts:578,619`). 2: la cabecera `content-disposition` no puede inyectar comillas ni saltos de línea; comprobar que no aparece `filename=` con barras. 3: el nombre se recorta a 176 caracteres más `…`. Anotar que un archivo con un nombre Larguísimo es indistinguible de otro en la lista, porque solo se muestra `filename`. |

| | |
|---|---|
| **ID** | SOL-ADJ-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/requests/<id>/attachments` con `filename` de 201 caracteres.<br>2. Repetir con `filename: "   "`.<br>3. Repetir con `mimeType` de 121 caracteres.<br>4. Repetir con `data: "x"` (1 carácter).<br>5. Repetir con `data: "data:text/plain;base64,aG9sYQ=="` y leer `sizeBytes`. |
| **Esperado** | Los cuatro `400 Datos inválidos` con `errors.fieldErrors.filename`, `.mimeType` o `.data` según el caso: `filename` es de 1 a 200, `mimeType` de hasta 120 y `data` de al menos 4 caracteres (`src/routes.ts:555-562`). 5: `201` con `sizeBytes: 4` — el prefijo se parte por `;base64,` y solo se decodifica lo que sigue, así que el `data:` no cuenta para el tamaño (`src/routes.ts:564-565`). |

| | |
|---|---|
| **ID** | SOL-ADJ-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con una solicitud con un adjunto cargado. |
| **Pasos** | 1. Borrar manualmente, en el sistema de archivos, el archivo de `dirname(DB_PATH)/attachments/` que corresponde al `path` del `attachment`.<br>2. En la interfaz, pulsar el enlace de descarga del adjunto.<br>3. En Network, leer la respuesta.<br>4. Restaurar el archivo. |
| **Esperado** | 3: `404 {"error":"El archivo ya no existe"}` (`src/routes.ts:620`). La fila sigue en `attachments` y `#adjuntos` la sigue mostrando: la lista se construye desde la base, no desde el disco, así que un adjunto cuyo archivo falta se ve descargable y no lo es. Es el estado inverso del que resuelve `SOL-ADJ-05`: quitar el adjunto borra la fila y el archivo, pero perder el archivo no borra la fila. |

### 4.8 Comentarios e hilo

Los comentarios **solo se crean**. La ruta real es `POST /api/requests/:id/comments`. No hay
`GET` de comentarios suelto, ni edición, ni borrado: leer el hilo obliga a pasar por
`GET /api/requests/:id`.

| | |
|---|---|
| **ID** | SOL-COM-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `Ver` abierto sobre una solicitud sin comentarios. |
| **Pasos** | 1. Leer `#hilo`.<br>2. Escribir `QA-SOL-2026 Ya lo estoy viendo` en `#comentario-texto`.<br>3. Pulsar `#comentario-agregar`.<br>4. Leer Network, `#hilo`, `#comentario-texto` y `#aviso`. |
| **Esperado** | 1: `#hilo` muestra el `.ui-vacio` con `Sin comentarios todavía.` 3: `POST /api/requests/<id>/comments` `201` con `{"comment":{…}}`; el cuerpo lleva solo `content`. `#comentario-texto` queda vacío. `#hilo` muestra una `.ui-comentario` con el autor (el nombre de la identidad del Core, congelado al escribir), la fecha como `DD/MM/AAAA` en `.ui-comentario__fecha` y el texto en `.ui-comentario__texto`. **Revisar `#aviso`**: ver riesgo `R-03` sobre un `showModal()` repetido. |

| | |
|---|---|
| **ID** | SOL-COM-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `Ver` abierto, con el hilo ya repintado tras `SOL-COM-01`. |
| **Pasos** | 1. En Network, contar las peticiones `GET /api/requests/<id>` desde que se abrió el diálogo.<br>2. Agregar un segundo comentario y volver a contar.<br>3. Adjuntar un archivo y volver a contar. |
| **Esperado** | 1: hay **dos** peticiones, no una: `abrirSolicitud` pide el detalle, y después de escribir el comentario la vuelve a llamar para repintar (`public/app.js:345`). El hilo se lee entero otra vez en lugar de agregar el comentario devuelto. 2: **tres** en total. 3: **cuatro** en total. Cada operación de hilo cuesta un `GET /api/requests/<id>` completo (solicitud + comentarios + adjuntos + historial) para mostrar un renglón. Con el tope de 600 peticiones / 15 min, escribir diez comentarios son diez lecturas completas de más: anotar el costo (riesgo `R-07`). |

| | |
|---|---|
| **ID** | SOL-COM-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con una solicitud abierta. |
| **Pasos** | 1. `POST /api/requests/<id>/comments` con `{"content": "   "}`.<br>2. Con `{"content": ""}`.<br>3. Con un texto de 4 001 caracteres.<br>4. Con `{"cuerpo": "x"}` en vez de `content`.<br>5. Desde la interfaz, pulsar `#comentario-agregar` con `#comentario-texto` vacío. |
| **Esperado** | 1 y 2: `400 Datos inválidos` con `errors.fieldErrors.content` — `min(1)` **después** del `trim()`, así que solo espacios tampoco pasa (`src/routes.ts:520`). 3: `400 Datos inválidos` por `max(4000)`; el `maxlength="4000"` de `#comentario-texto` lo evita desde la interfaz. 4: **`400`**, no un descarte silencioso: `content` es un campo obligatorio de un `z.object` y la unión de `AppError` y `ZodError` no entra. Comprobar el texto exacto del `fieldErrors`. 5: `#aviso` en rojo con `Escribí un comentario primero` y **no** hay petición: el cliente valida antes de salir (`public/app.js:337`). |

| | |
|---|---|
| **ID** | SOL-COM-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con `GET /api/requests/<id>` devuelto. |
| **Pasos** | 1. `GET /api/requests/<id>/comments`.<br>2. `GET /api/requests/comments`.<br>3. `PATCH /api/requests/<id>/comments/<commentId>`.<br>4. `DELETE /api/requests/<id>/comments/<commentId>`.<br>5. `DELETE /api/requests/comments`. |
| **Esperado** | **Cinco casos negativos.** 1: `404 {"error":"No existe GET /api/requests/sol_…/comments"}` (regla `notFound` del runtime, `packages/product-runtime/src/errors.ts:19-21`). 2: `404 {"error":"Esa solicitud no existe"}`, **no** el mensaje de ruta inexistente: `comments` cae en el comodín `/api/requests/:id`, pasa la validación del `id` y muere en `solicitudDe`. 3 y 4: `404 No existe PATCH …` / `No existe DELETE …`. 5: `404 {"error":"Esa solicitud no existe"}` por la misma razón que el 2. Ninguna ruta de lectura, edición o borrado de comentarios existe: un comentario es historia y no se puede tocar (riesgo `R-18`). |

| | |
|---|---|
| **ID** | SOL-COM-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Con sesión de **Org A**, crear una solicitud en Org A y anotar su id.<br>2. Con sesión de **Org A**, `POST /api/requests/<id de Org B>/comments`.<br>3. Con sesión de **Org A**, `GET /api/requests/<id de Org B>`.<br>4. Con sesión de **Org A**, `GET /api/requests?limit=500` y buscar en `requests` el título de la solicitud de Org B.<br>5. Con sesión de **Org A**, `POST /api/requests` con `"organizationId": "<id de Org B>"` en el cuerpo. |
| **Esperado** | 2 y 3: `404 {"error":"Esa solicitud no existe"}`, nunca `403`. 4: `requests` no contiene ninguna fila de Org B. 5: `201`, y la fila creada trae `organizationId` **de la sesión**, no el del cuerpo: el `organizationId` del cliente se descarta sin error (el `z.object` no es `strict()`), tal como cubre `products/solicitudes/tests/solicitudes.test.ts:119-129`. Ninguna respuesta filtra datos, nombres ni totales de la otra organización. |

### 4.9 Estados, transiciones e historial

`closed` y `cancelled` son terminales: marcan `closed_at` y cuentan como cerradas. `resolved`
no cierra, y por eso el hilo se puede reabrir (`src/routes.ts:63-70`).

| | |
|---|---|
| **ID** | SOL-EST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `Ver` abierto sobre una solicitud recién creada. |
| **Pasos** | 1. Leer `#historial`.<br>2. En Network, leer `history` de `GET /api/requests/<id>`.<br>3. Enumerar las claves de `history[0]`. |
| **Esperado** | `#historial` muestra **una** `.ui-evento`: el texto de `.ui-evento__cambio` es `Creada en estado Abierta` (el caso `oldStatus: null`, `public/app.js:260`) y `.ui-evento__meta` es `<nombre del usuario> · <DD/MM/AAAA>`. La fila trae `id` con prefijo `solhist`, `organizationId`, `requestId`, `oldStatus` (`null`), `newStatus`, `changedBy` y `createdAt`. El `changedBy` es el nombre de la identidad del Core, no un campo del cuerpo: **no se puede escribir el autor del historial**. |

| | |
|---|---|
| **ID** | SOL-EST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La solicitud de `SOL-EST-01`, con 1 entrada de historial. |
| **Pasos** | 1. Cambiar `#sol-estado` a `in_progress` y pulsar `#solicitud-guardar`.<br>2. Volver a abrir con `Ver` y leer `#historial`.<br>3. Cambiar solo `#sol-descripcion` y guardar.<br>4. Volver a leer `#historial`. |
| **Esperado** | 2: `#historial` tiene **dos** `.ui-evento`. La segunda muestra `Abierta → En curso` en `.ui-evento__cambio`, con los rótulos traducidos desde los estados internos (`open` → `Abierta`). 3 y 4: el historial **sigue con dos entradas**: un `PATCH` que no cambia el estado no escribe historial, porque una edición de texto no es un acontecimiento de estado (`src/routes.ts:259-271`). Anotar que tampoco queda rastro de *quién* editó el texto ni de cuándo se cambió `updatedAt`. |

| | |
|---|---|
| **ID** | SOL-EST-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/requests` con `"status": "closed"` y leer `closedAt`.<br>2. `PATCH /api/requests/<id>` con `{"status":"closed"}` otra vez y comparar el `closedAt`.<br>3. `PATCH /api/requests/<id>` con `{"status":"open"}` y leer `closedAt` y `resolution`.<br>4. `PATCH /api/requests/<id>` con `{"status":"cancelled"}` y leer `closedAt`.<br>5. Repetir el 3 desde `cancelled`. |
| **Esperado** | 1: `closedAt` con valor, no `null`. 2: el `closedAt` **no cambia**: `closedAtDe` devuelve `previo ?? ahora`, así que la fecha de cierre original se conserva (`src/routes.ts:180-182`). 3: `closedAt` vuelve a `null` al reabrir, y `resolution` **se conserva**: reabrir no borra cómo se resolvió. 4: `cancelled` también marca `closedAt`, igual que `closed`; el servidor no distingue una cancelación de un cierre. 5: vuelve a `null`. En ningún momento la interfaz muestra `closed_at`: no hay columna ni campo para él. |

| | |
|---|---|
| **ID** | SOL-EST-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con una solicitud `resolved` con resolución. |
| **Pasos** | 1. En `#historial`, comparar el texto de la última `.ui-evento__cambio` con los rótulos de la columna `Estado` de `#solicitudes-lista`.<br>2. Crear por API una solicitud con `"status": "REVISAR"` y abrirla con `Ver`. |
| **Esperado** | 1: los rótulos del historial (`Abierta`, `En curso`, `Resuelta`, `Cerrada`, `Cancelada`) son los del mapa `ESTADOS` de `public/app.js:39-45`, y coinciden con los de la columna `Estado`. **Verificar que no haya una tercera fuente de verdad**: `src/routes.ts:75-88` exporta `ETIQUETAS_ESTADO` y `ETIQUETAS_PRIORIDAD`, y `grep` confirma que nadie los importa (riesgo `R-19`). 2: el `POST` da `400 Datos inválidos` con `errors.fieldErrors.status`, porque el cuerpo sí valida el enum. Un estado desconocido solo puede entrar por una escritura directa en la base. Si llegara, `estadoDe` cae al texto crudo y el historial mostraría `Creada en estado REVISAR` sin tono. |

| | |
|---|---|
| **ID** | SOL-EST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con una solicitud en cada estado. |
| **Pasos** | 1. Para cada estado (`open`, `in_progress`, `resolved`, `closed`, `cancelled`), abrir la solicitud con `Ver` y anotar el `tono` de la `.ui-etiqueta` de la columna `Estado`.<br>2. Lo mismo con las cuatro prioridades. |
| **Esperado** | Estados: `Abierta` con tono `acento`, `En curso` con `aviso`, `Resuelta` con `ok`, `Cerrada` y `Cancelada` con `neutro` (sin clase de tono). Prioridades: `Baja` y `Media` con `neutro`, `Alta` con `aviso`, `Urgente` con `malo`. **Cerrada y Cancelada se ven iguales**: no hay tono que las distinga, y las dos son terminales (riesgo `R-20`). La barra se distingue por el color, no por el texto: un barrido de la columna `Estado` no permite separar `Cerrada` de `Cancelada` de un vistazo. |

| | |
|---|---|
| **ID** | SOL-EST-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Crear una solicitud con `status: "resolved"` y sin `resolution`.<br>2. Cambiar su estado a `closed` con `#sol-resolucion` vacío.<br>3. Guardar y leer `resolution`.<br>4. Crear otra con `status: "cancelled"` y `resolution: "QA-SOL-2026 Se cierra porque no aplica"`. |
| **Esperado** | Los cuatro `201` / `200`: **no hay ninguna regla que exija resolución para cerrar ni para resolver**. El campo `#sol-resolucion` está visible y editable también al crear, no solo al cerrar, y es opcional en los cinco estados. Una solicitud se puede cerrar en blanco y el historial lo registra igual, sin dejar constancia de por qué (`src/routes.ts:113-125`). Registrar si el negocio espera lo contrario; el código no lo impone. |

### 4.10 Ajustes — `?panel=ajustes`, `#config-form`

Solo dos campos, y ninguno de los dos tiene efecto en nada: `currency` no se usa para
formatear (este producto no muestra importes) y `timezone` no se usa para calcular nada.

| | |
|---|---|
| **ID** | SOL-AJUST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, base recién creada o sin fila en `settings`. |
| **Pasos** | 1. `GET /api/settings` y enumerar las claves de `settings`.<br>2. Abrir `?panel=ajustes` y leer `#cfg-moneda` y `#cfg-zona`. |
| **Esperado** | `200` con `{"settings":{"currency":"$","timezone":"America/Santiago","nextNumber":<n>}}`. Los dos primeros son los valores por defecto del servidor, presentes aunque no haya fila guardada (`leerPreferencias` devuelve el default campo por campo, `src/routes.ts:105-111`). `nextNumber` **solo** viene en el GET: es el folio propuesto, calculado con la misma función `MAX+1` que usa el alta. En el formulario, `#cfg-moneda` muestra `$` y `#cfg-zona` muestra `America/Santiago`. Los dos se rellenan recorriendo `form.elements` por su `name` (`currency`, `timezone`), no por id (`public/app.js:405-412`). |

| | |
|---|---|
| **ID** | SOL-AJUST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Poner `#cfg-zona` = `Chile/Continental` y `#cfg-moneda` = `CLP`. Pulsar `Guardar ajustes`.<br>2. Repetir con `#cfg-zona` = `America/Santiago` y `#cfg-moneda` vacío.<br>3. Repetir mandando por API `{"currency":"CLP","moneda":"X"}`.<br>4. Restaurar `#cfg-moneda` = `$` y `#cfg-zona` = `America/Santiago` y guardar. |
| **Esperado** | 1: `400 {"error":"Datos inválidos"}` con `No es una zona horaria válida (usá una como America/Santiago)` — el mensaje viene del refinamiento de `zonaHoraria`, que valida contra `Intl.DateTimeFormat` (`packages/product-runtime/src/time.ts:37-42`), no contra una lista. 2: `#cfg-moneda` vacío se envía como `$` (`|| '$'`, `public/app.js:387`), `200` con el aviso `Ajustes guardados`. 3: **`200`, no `400`**: el `z.object` de Ajustes no es `strict()`, así que la clave mal escrita `moneda` se descarta en silencio y el usuario cree que guardó (riesgo compartido `R-S-09`, y asimétrico con el `crudRouter`, que sí responde `400 Campo desconocido`). 4: `200`, deja los valores originales. |

| | |
|---|---|
| **ID** | SOL-AJUST-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `PUT /api/settings` con `{"currency":"CLP","timezone":"America/Santiago"}`.<br>2. Enumerar las claves de `settings` en la respuesta.<br>3. `GET /api/settings` otra vez.<br>4. Guardar desde la interfaz y volver a leer `GET /api/settings`. |
| **Esperado** | 2: la respuesta del `PUT` trae **solo** `currency` y `timezone`, **sin `nextNumber`** (`src/routes.ts:692` llama a `leerPreferencias`, que no lo calcula; el GET sí lo agrega en `src/routes.ts:665`). No es un fallo observable porque el `submit` de Ajustes vuelve a pedir `/api/settings` con `await cargar()` (`public/app.js:392`), pero sí rompe el contraste con el resto del portfolio, donde el GET y el PUT devuelven la misma forma. 4: tras guardar desde la interfaz, `nextNumber` vuelve a estar. Verificar que el aviso `Ajustes guardados` aparece y que **las cuatro tarjetas de `#resumen` no cambian**: moneda y zona horaria no entran en ningún cálculo de este producto. |

### 4.11 Contratos de API y rutas que no existen

| | |
|---|---|
| **ID** | SOL-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/requests` sin query.<br>2. `GET /api/requests?limit=0`, luego `?limit=-5`, luego `?limit=9999`, luego `?limit=abc`.<br>3. Comparar `requests.length` con `total` en cada respuesta. |
| **Esperado** | Todos `200`. El recorte es `Math.min(Math.max(Number(limit) || 200, 1), 500)` (`src/routes.ts:382`): sin `limit` son **200** filas; `limit=0` cae al default **200** (porque `0 || 200` es 200); `limit=-5` da **1** (el piso); `limit=9999` se recorta a **500**; `limit=abc` da **200** (`NaN \|\| 200`). En todos los casos `total` es igual a `requests.length`, o sea **el conteo posterior al recorte**: nunca dice cuántas hay. No hay `offset`, así que no hay forma de pedir la página siguiente. |

| | |
|---|---|
| **ID** | SOL-API-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/requests` y `GET /api/requests?limit=500`.<br>2. Comprobar con `Object.keys` si el sobre tiene `items`, `limit` u `offset`.<br>3. Pasar el cuerpo por un helper del shell que espere `{ items }` y ver qué muestra. |
| **Esperado** | 1: el sobre es **`{ requests, total }`**, sin `items`, sin `limit`, sin `offset`. 2: `Object.keys(cuerpo)` da exactamente `["requests","total"]`. 3: cualquier código que lea `cuerpo.items` recibe `undefined` y pinta una lista vacía: es el modo de falla del defecto crítico del portfolio, y aquí es **correcto por diseño** porque este producto no monta el `crudRouter` (`src/routes.ts:359-394`). Marcarlo en el registro como contrato propio del producto, no como desviación que corregir aquí. Ver el riesgo compartido `R-S-06` en `10-regresion-compartida.md`. |

| | |
|---|---|
| **ID** | SOL-API-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con una solicitud con comentarios, adjuntos e historial. |
| **Pasos** | 1. `GET /api/requests/<id>`.<br>2. Enumerar las cuatro claves del cuerpo y las de `attachments[0]`.<br>3. Comparar `comments[0]` y `history[0]` con lo esperado. |
| **Esperado** | `200` con exactamente `{"request":{…},"comments":[…],"attachments":[…],"history":[…]}` (`src/routes.ts:423-431`). Los comentarios vienen en orden ascendente por `createdAt`, los adjuntos por `createdAt` y el historial por `createdAt`. Cada adjunto llega con un campo `url` agregado que **no** existe en la base: `/api/requests/<id>/attachments/<attId>/file`. Verificar también que el adjunto expone `path` (`attachments/soladj_…`), que es una ruta interna de disco y no debería viajar al cliente (riesgo `R-21`). |

| | |
|---|---|
| **ID** | SOL-API-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `PATCH /api/requests/<id>` con `{"status":"in_progress"}` y nada más.<br>2. Enumerar las claves de `request` en la respuesta.<br>3. `GET /api/requests/<id>` y comparar `title`, `requesterName`, `description`, `responsibleName`, `dueAt` y `resolution` con los valores previos. |
| **Esperado** | `200` con `{"request":{…}}` y el `status` cambiado. Los campos que **no** se mandaron conservan su valor: el `PATCH` parsea el cuerpo mezclado sobre la fila existente (`src/routes.ts:456-468`), así que un cliente parcial no borra nada. Esta es la diferencia entre este `PATCH` y uno que validara el cuerpo pelado, que obligaría a mandar los once campos siempre. Coherente con el caso de la suite automatizada `products/solicitudes/tests/solicitudes.test.ts:191-210`. |

| | |
|---|---|
| **ID** | SOL-API-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/requests` con `{"title":"   ","requesterName":"X"}`.<br>2. Con `{"title":"X","requesterName":"Y","number":0}`.<br>3. Con `{"title":"X","requesterName":"Y","requesterEmail":"no-es-correo"}`.<br>4. Con `{"title":"X","requesterName":"Y","requesterEmail":""}`.<br>5. Con `{"title":"X","requesterName":"Y","title2":"Z"}`.<br>6. Con `{"title":"<201 caracteres>","requesterName":"Y"}` y con `#sol-responsable` de 151 caracteres por API. |
| **Esperado** | 1: `400 Datos inválidos` — `title` exige `min(1)` **después** del `trim()`. 2: `400 Datos inválidos` por `number: z.coerce.number().int().min(1)`. 3: `400 Datos inválidos` con `errors.fieldErrors.requesterEmail` = `Correo invalido` (sin tilde, es el texto del schema). 4: `201` con `"requesterEmail": ""`: el esquema es la unión de email, cadena vacía y `null`. 5: `201` y `title2` se descarta sin aviso (el `z.object` no es `strict()`, a diferencia del del `crudRouter`). 6: `400 Datos inválidos` por `max(200)` en `title` y `max(150)` en `responsibleName`. Ojo: `responsibleName` **no** tiene `min(1)`, así que `""` se guarda como cadena vacía, no como `null`, y la columna `Responsable` se ve en blanco en vez de `—` (riesgo `R-22`). |

| | |
|---|---|
| **ID** | SOL-API-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/requests/sol_inexistente`.<br>2. `GET /api/requests/comments`.<br>3. `GET /api/requests/12345`.<br>4. `GET /api/requests/<id>/comments`.<br>5. `GET /api/requests/<id>/attachments/<attId>` (sin `/file`).<br>6. `POST /api/requests/<id>/attachments/<attId>`.<br>7. `GET /api/rutas-que-no-existen`. |
| **Esperado** | **Siete casos negativos**, y el motivo de cada 404 es distinto: 1 y 3: `{"error":"Esa solicitud no existe"}` (vienen de `solicitudDe`). 2: también `Esa solicitud no existe`, porque `comments` cae en el comodín `/api/requests/:id` y muere allí, **no** en la regla de ruta inexistente. 4, 5, 6: `{"error":"No existe <MÉTODO> <ruta>"}` de la regla `notFound` del runtime (`packages/product-runtime/src/errors.ts:19-21`). 7: `{"error":"No existe GET /api/rutas-que-no-existen"}`. Lo que se verifica es que **estas rutas no existen en este producto**: que den 404 es lo que hace correcto al caso, no un defecto del plan. |

| | |
|---|---|
| **ID** | SOL-API-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, con una solicitud con un adjunto. |
| **Pasos** | 1. `GET /api/requests/<id>/attachments/soladj_inexistente/file`.<br>2. Con sesión de **Org B**, pedir el mismo archivo del id de Org A.<br>3. `DELETE /api/requests/<id>/attachments/soladj_inexistente`.<br>4. `POST /api/requests/<id>/attachments` con `filename: "nota.txt"`, `data: "data:text/plain;base64,aG9sYQ=="` y `mimeType` ausente, y leer el `filename` y el `sizeBytes` guardados. |
| **Esperado** | 1 y 3: `404 {"error":"Ese adjunto no existe"}` (`src/routes.ts:615,641`). 2: `404 {"error":"Esa solicitud no existe"}`: primero se resuelve la solicitud, y el filtro del adjunto incluye `organization_id` **y** `request_id` (`src/routes.ts:608-614`), así que no hay forma de pedir el archivo de otra empresa aunque se conozca el id del adjunto. 4: `201` con `filename: "nota.txt"` y `sizeBytes: 4`: sin `mimeType`, el tipo se deduce de la extensión (`txt` → `text/plain`, `packages/product-runtime/src/attachments.ts:113-118`) y el archivo se acepta. |

| | |
|---|---|
| **ID** | SOL-API-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Con el navegador en una zona **distinta** de `America/Santiago` (por ejemplo `Asia/Tokyo`), crear una solicitud con `dueAt` = la fecha de ayer **en la zona del navegador**.<br>2. Leer las cuatro cifras de `#resumen`.<br>3. Cambiar `#cfg-zona` a `Asia/Tokyo`, guardar, y releer `/api/resumen`.<br>4. Comparar `vencidas` antes y después del cambio de zona. |
| **Esperado** | `settings.timezone` **no cambia nada**. El «hoy» del servidor se arma con `new Date()` más `getFullYear`/`getMonth`/`getDate`, que es la zona **local del proceso**, no la de la organización (`src/routes.ts:328-331`). Y el «hoy» del navegador se arma igual en `public/app.js:62-65`. Con el navegador en Tokio y el servidor en otra zona, la etiqueta `· vencida` de la columna `Vence` y la cifra `Vencidas` pueden discrepar: una fecha que el navegador considera vencida, el servidor no la cuenta (riesgo `R-02`). 4: `vencidas` es idéntico antes y después: `zonaHoraria` se usa como validador y `leerPreferencias` devuelve el valor, pero **ningún cálculo lo lee**. Confirmarlo y anotarlo como hallazgo, no como error de ejecución. |

### 4.12 Sesión, aislamiento, roles y límites

| | |
|---|---|
| **ID** | SOL-SIST-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Producto arriba. |
| **Pasos** | 1. Anotar la primera línea del log de arranque.<br>2. `curl -s http://localhost:<puerto>/health`.<br>3. Repetir con `POST`.<br>4. `curl -s http://localhost:<puerto>/api/meta`.<br>5. `curl -s -o /dev/null -w "%{http_code}" http://localhost:<puerto>/`. |
| **Esperado** | 1: el log dice `Solicitudes (solicitudes) en <APP_URL> -> puerto <PORT>` y la línea siguiente `Identidad y suscripciones: <CORE_URL>`; anotar los valores reales porque `.env` puede diferir de `.env.example` (3023). 2 y 3: `200 {"ok":true,"product":"solicitudes","name":"Solicitudes"}` **sin sesión**. 4: `200 {"name":"Solicitudes","product":"solicitudes","version":2,"identity":"amg-central"}`, también sin sesión. 5: sin cookie de sesión, `302` hacia el login del Core con `return_to`; no se sirve ni el HTML del shell. |

| | |
|---|---|
| **ID** | SOL-SIST-02 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Ventana de incógnito sin cookie de sesión. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/api/requests`.<br>2. Abrir `http://localhost:<puerto>/api/resumen`.<br>3. Abrir `http://localhost:<puerto>/` en el navegador.<br>4. Hacer un `POST /api/requests` sin sesión. |
| **Esperado** | 1 y 2: `401 {"error":"sin-sesion","loginUrl":"…"}`: todo camino que empieza con `/api/` es JSON, aunque el `Accept` del navegador sea HTML (`packages/auth-client/src/middleware.ts:87,119`). 3: `302` al login del Core. 4: `401` con el mismo cuerpo. **No hay pantalla de login propia**: `public/index.html` no tiene ningún campo de contraseña, y el único enlace de salida es `/auth/logout` (`public/index.html:48`). |

| | |
|---|---|
| **ID** | SOL-SIST-03 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Dos organizaciones distintas con suscripción a `solicitudes`: la propia (Org A) y una segunda (Org B), cada una con una solicitud `QA-SOL-2026 AJENA` con comentario y adjunto. |
| **Pasos** | 1. Con sesión de **Org A**, pedir `GET /api/requests?limit=500`, `GET /api/resumen`, `GET /api/requests/<id de Org B>`, `POST /api/requests/<id de Org B>/comments`, `POST /api/requests/<id de Org B>/attachments`, `GET /api/requests/<id de Org B>/attachments/<attId de Org B>/file`.<br>2. Con sesión de **Org A**, `PATCH /api/requests/<id de Org B>` y `DELETE /api/requests/<id de Org B>`.<br>3. Con sesión de **Org A**, `GET /api/settings` y `PUT /api/settings`.<br>4. Repetir todo mirando el panel de Network en busca de alguna respuesta `200`. |
| **Esperado** | 1: las listas y el resumen de Org A no contienen nada de Org B; el `GET` del detalle, el `POST` del comentario, el `POST` del adjunto y la descarga del archivo responden `404 {"error":"Esa solicitud no existe"}`. 2: `404` en ambos, y después de intentarlo la solicitud de Org B **sigue existiendo** con su título original. 3: `GET /api/settings` devuelve la fila de Org A (`currency` y `timezone` de Org A, y el `nextNumber` de Org A); el `PUT` solo escribe en Org A. 4: ninguna. `organizationId` sale siempre de `orgId(req)` (`packages/product-runtime/src/auth.ts:70-72`) y nunca del cuerpo, la query ni un header; el `DELETE` de Org A **no** toca los archivos de disco de Org B porque ni siquiera lee sus filas. |

| | |
|---|---|
| **ID** | SOL-SIST-04 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Sesión de la organización de QA con el **rol más bajo** que el Core emita para esa organización, anotado en pantalla (`rol` de `GET /api/inicio`). |
| **Pasos** | 1. Con ese rol, desde la interfaz: crear una solicitud, editar su estado, agregar un comentario, adjuntar un archivo y **borrar** la solicitud.<br>2. Con ese rol, por API: `DELETE /api/requests/<id>` y `PUT /api/settings`.<br>3. Comparar los botones de `#solicitudes-lista` con los de una sesión `admin`.<br>4. Buscar en el HTML y en `app.js` cualquier lectura de `rol` o de `role`. |
| **Esperado** | Todo responde `2xx`: `grep -n "role\|requireRole\|requireAdmin" products/solicitudes/src/*.ts` **no devuelve nada**, y `app.js` nunca lee `rol`. Cualquier usuario con sesión —incluido el rol más bajo— puede **borrar** solicitudes con su hilo y sus adjuntos, y cambiar la moneda y la zona horaria de la organización. Ni siquiera la UI esconde los botones: los cuatro están siempre visibles, y `Borrar` solo pide un `confirm`. Documentado como riesgo `R-04`. Registrar también que el shell no tiene un mecanismo común por rol (riesgo compartido `R-S-05`). |

| | |
|---|---|
| **ID** | SOL-SIST-05 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Recorrer los 2 paneles y todas las acciones de cada uno en DevTools → Network, contando peticiones.<br>2. Teclear 40 caracteres en `#filtro-q`.<br>3. Con `curl` en bucle, agotar el límite.<br>4. Observar la respuesta `429` y su cabecera. |
| **Esperado** | 1: el recorrido completo está muy por debajo de 600. 2: **40 peticiones** de las cuales 39 son «de más»: una por tecla, sin debounce (§7, `R-07`). Con eso, escribir dos párrafos en el buscador puede gastar una parte apreciable de la ventana. 3 y 4: el límite es **600 peticiones por 15 min por IP** (`packages/product-runtime/src/app.ts:99-106`, `windowMs: 15 * 60 * 1000`, `limit: 600`, `standardHeaders: 'draft-8'`). Agotado, responde `429` con cabecera `RateLimit`. Un `429` **no** es un defecto del producto: anotar en la §9 y esperar la ventana. Ojo: el límite se instala **antes** de `/health` (riesgo compartido `R-S-04`), así que una sonda de salud cada segundo agota el presupuesto sin que nadie esté usando el producto. |

---

## 5. Recorridos E2E

Recorridos completos, de principio a fin, con los datos de la §2. Cada uno cruza varios
módulos y termina con una comprobación que delata si algo se rompió por el camino.

| | |
|---|---|
| **ID** | SOL-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión activa, base con las 5 solicitudes de la §2. Folio máximo = 5. |
| **Pasos** | 1. Pulsar `#solicitud-nueva` y confirmar que `#sol-folio` trae `6`.<br>2. Llenar `#sol-titulo` = `QA-SOL-2026 Bomba de agua'),` #sol-solicitante` = `QA-SOL-2026 Diego Sáez`, `#sol-prioridad` = `urgent`, `#sol-vencimiento` = mañana, y `#sol-descripcion` = `QA-SOL-2026 Gotea en el pasillo`.<br>3. Pulsar `#solicitud-guardar`.<br>4. Sin recargar, pulsar `#solicitud-nueva` otra vez, llenar solo título y solicitante, y guardar.<br>5. Volver a pulsar `#solicitud-nueva` y cambiar `#sol-folio` a `7`. Guardar.<br>6. Leer Network en los pasos 3, 4 y 5, y las cuatro cifras de `#resumen`. |
| **Esperado** | 1: `#sol-folio` = 6, el `nextNumber` de `GET /api/settings`, que es el máximo existente más uno. 3: `POST /api/requests` `201`, aviso `Solicitud creada`, el diálogo se cierra y la fila entra **primera** en la tabla (orden descendente por folio). 4: **`409 {"error":"Ya existe la solicitud numero 6 en esta empresa"}`**: la página no recarga `/api/settings` después de guardar, así que propone el folio que ya se usó (§7, `R-16`). El aviso sale en rojo y el diálogo **no** se cierra. 5: `201`, y las dos solicitudes nuevas quedan con folio 6 y 7. 6: `total` de `/api/resumen` sube en 2, `abiertas` sube en 2 y `alta` sube en 2 (ambas `urgent` y `open`), `vencidas` no cambia (ninguna tiene fecha pasada) y `resueltas` no cambia. |

| | |
|---|---|
| **ID** | SOL-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | La solicitud `QA-SOL-2026 Migrar portal` de la §2, `in_progress`, con `responsibleName` `QA-SOL-2026 Equipo plataforma`. |
| **Pasos** | 1. Abrirla con `Ver`.<br>2. Agregar tres comentarios: `QA-SOL-2026 1`, `QA-SOL-2026 2`, `QA-SOL-2026 3`.<br>3. Adjuntar `QA-SOL-2026 captura.png`.<br>4. Cambiar `#sol-estado` a `resolved` y `#sol-resolucion` a `QA-SOL-2026 Se migró el portal`. Guardar.<br>5. Volver a abrir con `Ver` y leer `#hilo`, `#adjuntos` y `#historial`.<br>6. Volver a la lista y leer la fila y las cuatro cifras de `#resumen`. |
| **Esperado** | 2: tres `POST /api/requests/<id>/comments` `201`, con el autor igual al nombre de la sesión y `createdAt` ascendente. 3: `POST …/attachments` `201`. 4: `PATCH` `200` con el aviso `Solicitud actualizada`. 5: `#hilo` muestra los tres comentarios en orden cronológico, `#adjuntos` muestra la `.ui-ficha` con `40.0 KB`, y `#historial` muestra **dos** entradas: `Creada en estado En curso` y `En curso → Resuelta`. **`closedAt` sigue siendo `null`**: `resolved` no es terminal. 6: la columna `Estado` pasa a `Resuelta` con tono `ok`, `Resueltas` de `#resumen` sube en 1, `Abiertas` baja en 1, `Prioridad alta` no cambia (esta era `medium`) y `Vencidas` baja en 1 si tenía fecha. Toda la tabla y las cuatro cifras quedan coherentes entre sí. |

| | |
|---|---|
| **ID** | SOL-E2E-03 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | La solicitud `QA-SOL-2026 Migrar portal` con un comentario y un adjunto. |
| **Pasos** | 1. Pulsar `Borrar` en su fila y **cancelar** el `confirm`.<br>2. Escribir `QA-SOL-2026 temporal` en `#filtro-q` y verificar que la fila sigue.<br>3. Borrar `#filtro-q` y pulsar `Borrar`, confirmando.<br>4. `GET /api/requests?limit=500&q=QA-SOL-2026%20temporal`.<br>5. Ir al sistema de archivos y comprobar que el archivo con el nombre `soladj_…` de esa solicitud ya no está en `dirname(DB_PATH)/attachments/`. |
| **Esperado** | 1 y 2: nada cambia, no hay petición de borrado. 3: `DELETE /api/requests/<id>` `200 {"request":{…}}`, aviso `Solicitud borrada`, la fila desaparece y `#resumen` se recalcula. 4: `200` con `requests: []` y `total: 0`: el buscador ya no la encuentra. 5: **el archivo no está**. El handler lee las filas de `attachments` **antes** de borrar la solicitud y luego hace `unlinkSync` de cada una (`src/routes.ts:485-504`); el `cascade` de la base se lleva las filas por su cuenta. Un archivo que ya no estuviera en disco tampoco impide el borrado: el `unlinkSync` va dentro de un `try/catch` que se traga el error. |

| | |
|---|---|
| **ID** | SOL-E2E-04 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión activa. La solicitud `QA-SOL-2026 Impresora sin toner`, `open`, `high`, sin fecha. |
| **Pasos** | 1. Escribir `QA-SOL-2026` en `#filtro-q` y anotar `total`.<br>2. Poner `#filtro-estado` en `closed` y anotar `total`.<br>3. Poner `#filtro-prioridad` en `urgent` y anotar `total`.<br>4. Quitar `#filtro-q` y `#filtro-estado`.<br>5. Buscar `plataforma`, que solo está en `responsibleName`.<br>6. Buscar `example.com`, que solo está en `requesterEmail`.<br>7. Buscar `Se reinició`, que solo está en `resolution`. |
| **Esperado** | 1: `total` = 5 (las de la §2). 2: `total` = 1, solo la cerrada. 3: `total` = 0: los filtros se acumulan con `and` y no hay nada `closed` **y** `urgent`. 4: la lista vuelve a las 5. 5: `total` = 1, la de `responsibleName`. 6 y 7: **`total` = 0** en los dos: el buscador no cubre `requesterEmail` ni `resolution` (§7, `R-13`). Un usuario que busca por correo no encuentra nada y no hay ninguna pista en pantalla de que el correo no se busque; el `placeholder` de `#filtro-q` es `Título, solicitante, responsable…` y tampoco menciona la descripción, que sí se cubre. |

| | |
|---|---|
| **ID** | SOL-E2E-05 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión activa, con una solicitud `open` con `dueAt` = hoy y otra `open` con `dueAt` = ayer. Navegador en una zona distinta de la del proceso. |
| **Pasos** | 1. Abrir `/` y leer la cifra `Vencidas` y las dos celdas de `Vence`.<br>2. Cambiar `#cfg-zona` a una zona 14 horas atrás, guardar, y releer las cuatro cifras.<br>3. Esperar a que la fecha del navegador cambie de día (o simularlo con `#sol-vencimiento`), y releer `Vencidas` y las etiquetas `· vencida`.<br>4. Anotar la zona horaria del navegador, la del proceso y `#cfg-zona` en el registro. |
| **Esperado** | 1: solo la de ayer muestra `· vencida`; la de hoy no, porque la comparación es estricta (`dueAt < hoy`, no `<=`, `public/app.js:85-86`). 2: las cuatro cifras **no cambian**, y las etiquetas tampoco: `settings.timezone` no participa en ningún cálculo (§7, `R-02`). 3: el cambio de día en el navegador desplaza las etiquetas `· vencida` de la columna `Vence` en cuanto recarga, pero la cifra `Vencidas` del servidor se mueve **a su propio ritmo**, con la zona local del proceso. Con los tres relojes distintos, las dos señales pueden discrepar y nada en pantalla explica por qué. Es el caso que hay que dejar por escrito, porque «Vencidas» y la columna `Vence` deberían contar lo mismo. |

| | |
|---|---|
| **ID** | SOL-E2E-06 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión de Org A. Org B tiene una solicitud con el mismo folio que una de Org A. |
| **Pasos** | 1. Crear en Org A una solicitud con `number` = 1 y anotar que responde `201`.<br>2. Con sesión de Org B, crear otra con `number` = 1 y anotar que responde `201`.<br>3. Crear en Org A otra con `number` = 1.<br>4. En Org B, `GET /api/settings` y leer `nextNumber`.<br>5. En Org A, `GET /api/requests?limit=500` y en Org B lo mismo; comparar títulos y folios.<br>6. En Org B, `DELETE /api/requests/<id de Org A>`. |
| **Esperado** | 1 y 2: los dos `201`. El folio **no** es global: el índice único es `(organization_id, number)` (`src/ddl.ts:42`, `src/schema.ts:59`), así que las dos empresas pueden tener su solicitud `1`. Es la razón de diseño del folio y hay que probarla. 3: `409 Ya existe la solicitud numero 1 en esta empresa`, solo dentro de Org A. 4: el `nextNumber` de cada organización se calcula sobre sus propias filas. 5: ninguna lista muestra filas de la otra. 6: `404 {"error":"Esa solicitud no existe"}`, y la solicitud de Org A sigue intacta: el `organizationId` del `where` es el de la sesión. |

---

## 6. Regresión compartida

Todo lo que toca código compartido: `amigo.js`, `amigo-ui.js`, `amigo.css`, el middleware de
identidad, `express.json`, `rateLimit`, `helmet`. Los riesgos genéricos están en
`10-regresion-compartida.md`; aquí solo lo que este producto debe cumplir del shell.

| | |
|---|---|
| **ID** | SOL-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Cargar `/` y pulsar `[data-tab="ajustes"]` con el canal, **sin** escribir `?panel=` en la URL.<br>2. Volver a `[data-tab="solicitudes"]` con el canal.<br>3. Recargar con `?panel=ajustes`.<br>4. Escribir `?panel=inventario` y `?panel=basura`. |
| **Esperado** | 1: el canal cambia de sección y **`alEntrar` corre**: la pantalla no queda muda. Este es el punto: `montar` guarda el callback que le pasan y lo llama en cada `mostrar`, incluido el primer pintado (`amigo.js:121-127,157-163`). 2: `#solicitudes-lista` se vuelve a pedir y se repinta. 3: entrar por `?panel=ajustes` carga Ajustes y, además, la cadena de arranque pide `/api/resumen` y `/api/requests?limit=500`. 4: ambas claves caen al primer panel (`solicitudes`), sin error. **Nunca entrar por `?panel=` como prueba de que un panel funciona**: ese camino no ejercita `alEntrar` al cambiar de sección, que es donde se rompía. |

| | |
|---|---|
| **ID** | SOL-REG-02 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa y datos de prueba. |
| **Pasos** | 1. Provocar un `409` guardando un folio repetido (`SOL-ALT-04`).<br>2. Provocar un `400` mandando por API un `requesterEmail` inválido a la interfaz y capturando el mensaje con Network.<br>3. Provocar un `404` pidiendo `/api/requests/sol_inexistente`.<br>4. Provocar un `413` subiendo por API un adjunto de 760 KB.<br>5. Provocar un `415` subiendo un `.html`.<br>6. Provocar un `401` renewing la sesión (convención 5.1).<br>7. Mirar `#aviso` en cada caso, con su clase y su texto. |
| **Esperado** | Todos los errores salen en `#aviso`, que toma `ui-aviso--malo` y **se oculta solo a los 5000 ms** (`amigo-ui.js:270-278`). Un `ZodError` se muestra como `Datos inválidos` o, si trae `errors.fieldErrors`, como `campo: mensaje` unido por ` · `. Un `AppError` muestra su `error`: el `409` y el `404` salen con su texto completo. Un `401` con `loginUrl` provoca navegación al login del Core y lanza `sesion vencida` por dentro, sin pintar datos vacíos (`amigo-ui.js:331-336`). Un `500` muestra `Error interno del servidor` y nunca una traza. Cada manejador de `app.js` tiene su `catch` con `avisar(e.message, true)`: comprobar que ningún rechazo queda sin capturar y deja la pantalla a medias. Los 5000 ms son un riesgo compartido (`R-S-10`): mirar consola y Network, no solo la barra. |

| | |
|---|---|
| **ID** | SOL-REG-03 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. En Network, revisar las cabeceras de respuesta de `/`, `/app.js` y `/style.css`.<br>2. Comprobar la presencia de `/amigo.js`, `/amigo-ui.js` y `/amigo.css`.<br>3. Recargar ignorando caché y comparar los `?v=` de `/app.js` y `/amigo.js`.<br>4. Comprobar que `/` **no** se sirve antes que la identidad. |
| **Esperado** | `/amigo.css`, `/amigo.js` y `/amigo-ui.js` se resuelven desde el runtime compartido (`packages/product-runtime/public/`) y **ganan** sobre cualquier copia del producto: el orden de los `express.static` pone el compartido primero (`packages/product-runtime/src/app.ts:161-165`). `style.css` del producto hace `@import url("/amigo.css")`, así que el acento sale de `style.css:20` y la forma de `/amigo.css`. En desarrollo no hay `Cache-Control` de larga duración; en producción, `immutable` con huella `?v=`. La huella de `/app.js` y la de `/amigo.js` se calculan **juntas**, así que viajan con la misma versión. Helmet está activo con `contentSecurityPolicy: false` a propósito, por los estilos inline de `index.html`. `x-powered-by` deshabilitado. Sin `favicon.ico` en el producto (`R-S-11` compartido): el icono de la pestaña queda roto. |

| | |
|---|---|
| **ID** | SOL-REG-04 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa, `#solicitud-dialog` abierto en modo edición con la solicitud de la §2. |
| **Pasos** | 1. Escribir en `#comentario-texto` y pulsar `#comentario-agregar`.<br>2. Adjuntar un archivo con `#adjunto-agregar`.<br>3. Pulsar `Quitar` en un adjunto y confirmar.<br>4. En cada caso, leer `#hilo`, `#adjuntos` y `#aviso`, y mirar la consola. |
| **Esperado** | Las tres operaciones repintan su bloque con `AMIGO_UI.vacio` o con los nodos nuevos, sin recargar la página. En las tres, `abrirSolicitud` se vuelve a llamar y termina llamando a `showModal()` sobre un diálogo **ya modal**, lo que según la especificación lanza `InvalidStateError`; el `catch` lo convierte en un `avisar(e.message, true)`. Si aparece un aviso rojo con el mensaje de esa excepción en cualquiera de los tres casos, el riesgo `R-03` queda confirmado; si no aparece y la consola está limpia, anotarlo como no reproducido. En cualquier versión, la consecuencia a medir es que el `POST` **sí** tuvo efecto aunque la pantalla sugiera un error. |

| | |
|---|---|
| **ID** | SOL-REG-05 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa, con datos de prueba en los dos paneles. |
| **Pasos** | 1. Crear una solicitud desde la interfaz y contar las peticiones que salen.<br>2. Borrarla y contar.<br>3. Cambiar `#filtro-estado` y `#filtro-prioridad`, y contar.<br>4. Cambiar a Ajustes y volver.<br>5. Guardar ajustes y contar. |
| **Esperado** | 1: `POST`, `GET /api/requests` y `GET /api/resumen`: el `submit` recarga lista y resumen (`public/app.js:321-322`) pero **no** `/api/settings`. 2: `DELETE`, `GET /api/requests` y `GET /api/resumen`. 3: una petición por cada cambio de select. 4: volver a Solicitudes pide la lista otra vez; ir a Ajustes no pide nada. 5: `PUT /api/settings` y un `GET /api/settings` (por `await cargar()` en `public/app.js:392`), y **nada más**: guardar la moneda y la zona no repinta `#resumen` ni `#solicitudes-lista`, lo cual es correcto mientras esas preferencias no afecten a nada (§7, `R-02`). |

---

## 7. Riesgo conocido

Defectos y trampas **sospechados en el código**, no ejecutados. Cada uno dice dónde mirar y
cómo confirmarlo en el navegador o en Network. Los que son de la capa compartida y no de
este producto están en `10-regresion-compartida.md` y no se repiten aquí.

| Riesgo | Dónde | Cómo se confirma | Severidad |
|---|---|---|---|
| **R-01** **`GET /api/requests` no sigue el contrato de lista del portfolio**: devuelve `{ requests, total }` en vez de `{ items, total, limit, offset }`. Este producto no monta el `crudRouter`, así que es deliberado, pero cualquier helper del shell o script que espere `{ items }` recibe `undefined` y pinta una lista vacía sin error. | `products/solicitudes/src/routes.ts:359-394` | `GET /api/requests` y correr `Object.keys(cuerpo)`: debe dar `["requests","total"]`. Confirmar con `SOL-LST-01` y `SOL-API-02`. Si algún consumidor común lee `items`, la pantalla queda muda. | Media |
| **R-02** **`settings.timezone` se valida, se guarda y no se usa para nada.** `zonaHoraria` solo valida; `leerPreferencias` lo devuelve; y el «hoy» del resumen se arma con `new Date()` más `getFullYear`/`getMonth`/`getDate`, o sea la zona **local del proceso**, no la de la organización. Lo mismo en el cliente. Con el navegador, el servidor y `#cfg-zona` en tres zonas distintas, la cifra `Vencidas` y la etiqueta `· vencida` de la columna `Vence` pueden discrepar. | `products/solicitudes/src/routes.ts:328-334`, `products/solicitudes/src/routes.ts:105-111`, `products/solicitudes/public/app.js:62-65`, `packages/product-runtime/src/time.ts:37-42` | Poner el navegador en `Asia/Tokyo`, `#cfg-zona` en `America/Santiago` y esperar al cambio de día. Si `Vencidas` no se mueve con la etiqueta `· vencida`, está confirmado. Cambiar `#cfg-zona` y releer `/api/resumen`: si las cifras son idénticas, la zona no influye. `SOL-E2E-05`. | Alta |
| **R-03** **`showModal()` sobre un diálogo ya modal lanza `InvalidStateError`**, y `abrirSolicitud` lo llama al final sin guardar el caso «ya abierto». El camino afectado es cada vez que el hilo se repinta con el diálogo abierto: agregar comentario, adjuntar archivo y quitar adjunto. El `POST`/`DELETE` **sí** se ejecuta; lo que falla es la pintura final, y el `catch` lo convierte en un `avisar` rojo con el texto de la excepción del navegador. | `products/solicitudes/public/app.js:290`, `products/solicitudes/public/app.js:345`, `products/solicitudes/public/app.js:371`, `products/solicitudes/public/app.js:234` | Con el diálogo abierto sobre una solicitud con historial, agregar un comentario y leer `#aviso` y la consola. Si aparece un aviso rojo con un mensaje del tipo «The element already has an 'open' attribute», está confirmado. `SOL-REG-04`. | Alta |
| **R-04** **No hay control de acceso por rol en ninguna ruta.** `grep -n "role\|requireRole\|requireAdmin" products/solicitudes/src/*.ts` no devuelve nada. Cualquier usuario con sesión, del rol más bajo que emita el Core, puede crear, editar, **borrar** solicitudes con su hilo y sus adjuntos, y cambiar la moneda y la zona horaria de la organización. `requireRole` existe y está exportado en el runtime pero no se usa. La UI tampoco esconde nada: los botones siempre están, y `Borrar` solo pide un `confirm`. | `products/solicitudes/src/routes.ts` (todo el archivo), `packages/product-runtime/src/auth.ts:156` | Entrar con el rol más bajo y hacer `DELETE /api/requests/<id>` y `PUT /api/settings`. Si los dos `2xx`, está confirmado. Comparar los botones con una sesión `admin`: si son los mismos, no hay ni una diferencia visual. `SOL-SIST-04`. | Alta |
| **R-05** **`currency` tampoco se usa.** Este producto no muestra importes, así que la moneda es un ajuste que no tiene efecto visible: se guarda, se devuelve en `GET /api/settings` y no aparece en ninguna parte de la pantalla. Junto con `timezone`, los dos campos de Ajustes son decorativos. | `products/solicitudes/src/routes.ts:105-111`, `products/solicitudes/public/app.js:405-412` | Poner `#cfg-moneda` = `CLP`, guardar y recorrer las dos pantallas buscando una diferencia. Si no la hay, está confirmado. Anotar junto con `R-02` como un solo hallazgo: **los Ajustes de este producto no hacen nada**. | Baja |
| **R-06** **`Resueltas` cuenta también las `cancelled`.** `resueltas` filtra por `resolved`, `closed` **o** `cancelled` (`src/routes.ts:335-337`), así que una solicitud que se canceló suma como resuelta. Para un helpdesk, una cancelación y una resolución son cosas distintas y la tarjeta las junta. | `products/solicitudes/src/routes.ts:335-337` | Crear una solicitud `cancelled` y comprobar que `Resueltas` sube en 1 mientras `Abiertas` no cambia. Si sube, está confirmado. `SOL-CAT-02`. | Media |
| **R-07** **`#filtro-q` dispara una petición por tecla, sin debounce y sin cancelación.** Cada `input` llama `pintarLista()` (`public/app.js:377`), así que escribir una palabra de 8 letras son 8 `GET /api/requests`. Además no se cancela la petición anterior: si dos respuestas llegan en orden inverso, la tabla que queda puede no corresponder a lo escrito. | `products/solicitudes/public/app.js:377-379`, `packages/product-runtime/src/app.ts:99-106` | Escribir 40 caracteres lentamente en `#filtro-q` contando peticiones en Network, y después escribir `QA-SOL-` rápido para intentar que la tabla quede con un resultado viejo. 40 teclas son 40 de las 600 peticiones de la ventana. `SOL-CAT-04` y `SOL-SIST-05`. | Media |
| **R-08** **`total` de `/api/resumen` no tiene ninguna tarjeta.** La API devuelve cinco claves y la pantalla pinta cuatro (`public/app.js:76-81`). `total` es el único número que se podría contrastar con la cantidad de filas de la tabla, y es justamente el que no se ve. | `products/solicitudes/public/app.js:74-82`, `products/solicitudes/src/routes.ts:340-346` | `GET /api/resumen` y contar los `.ui-kpi` de `#resumen`. Si son 4 y la API trae 5, está confirmado. | Baja |
| **R-09** **`Prioridad alta` solo cuenta las abiertas.** `alta` es `abiertas.filter(priority high|urgent)` (`src/routes.ts:338`), así que una solicitud `urgent` ya resuelta no cuenta. La etiqueta `Prioridad alta` se lee como «cuántas hay de prioridad alta», no «cuántas están abiertas y son de prioridad alta». | `products/solicitudes/src/routes.ts:338` | Crear una `urgent` abierta, leer `Prioridad alta`, resolverla, y releer. Si la cifra baja a 0 con la solicitud todavía `urgent`, está confirmado. | Media |
| **R-10** **Vencida solo cuenta si sigue abierta, pero el rótulo no lo dice.** Una `resolved` con `dueAt` en el pasado no cuenta ni en `vencidas` ni en la etiqueta `· vencida`. Es la decisión correcta (`public/app.js:84-86`), pero el usuario que ve una fecha roja desaparecer al resolver no tiene explicación en pantalla. | `products/solicitudes/src/routes.ts:333-334`, `products/solicitudes/public/app.js:84-86` | Resolver la solicitud `QA-SOL-2026 Urge revisar servidor` y ver cómo la etiqueta `· vencida` de la columna `Vence` desaparece mientras la fecha sigue en rojo en la cabeza. Si desaparece, está confirmado (y es la conducta esperada). `SOL-LST-04`. | Baja |
| **R-11** **Las tarjetas de `#resumen` no responden a los filtros.** `#filtro-estado`, `#filtro-prioridad` y `#filtro-q` solo llaman `pintarLista()`; las cuatro cifras son globales. Con la tabla filtrada a `Cancelada` y las tarjetas mostrando `Abiertas: 12`, la pantalla presenta dos verdades sin explicar ninguna. | `products/solicitudes/public/app.js:377-379` | Filtrar por `cancelled` y comparar `Abiertas` con el número de filas no canceladas de la tabla. Si no cuadran, está confirmado. `SOL-CAT-03`. | Media |
| **R-12** **`total` es el conteo posterior al recorte y no hay paginador.** Con más de 500 solicitudes, `GET /api/requests?limit=500` devuelve `total: 500` aunque haya más, y la interfaz siempre pide `limit=500`. Las cuatro tarjetas de `#resumen` muestran el número verdadero, así que la pantalla se contradice a sí misma sin avisar, y las solicitudes más viejas son inalcanzables desde la interfaz. | `products/solicitudes/src/routes.ts:382,392`, `products/solicitudes/public/app.js:92` | Sembrar 520 solicitudes por API y comparar `total` con el conteo real y con `total` de `/api/resumen`. Si `total` = 500 y las tarjetas dicen 520, está confirmado. `SOL-LST-06`. | Alta |
| **R-13** **El buscador no cubre `requesterEmail` ni `resolution` ni `number`, y el `placeholder` no dice qué cubre.** Solo busca en `title`, `description`, `requesterName` y `responsibleName` (`src/routes.ts:370-381`). Buscar el correo de quien pidió devuelve cero resultados sin ninguna explicación: el usuario concluye que la solicitud no existe. | `products/solicitudes/src/routes.ts:370-381`, `products/solicitudes/public/index.html:74` | Buscar un correo que esté en `requesterEmail` y una palabra que solo esté en `resolution`. Si ambos dan `total: 0` con la fila existiendo, está confirmado. `SOL-BUS-03` y `SOL-E2E-04`. | Media |
| **R-14** **El patrón de búsqueda no escapa `%` ni `_`.** El `LIKE` se arma como `%${q}%` con lo que escribió el usuario, así que `%` devuelve la lista completa y `_` funciona como comodín de un carácter. Con `q = %` el usuario ve todo y cree que filtró. | `products/solicitudes/src/routes.ts:371-381` | Escribir `%` y luego `_` en `#filtro-q` y comparar `total` con el total real. Si `%` devuelve todas, está confirmado. `SOL-BUS-05`. | Media |
| **R-15** **Borrar la solicitud de folio más alto libera su folio.** `nextNumber` es `MAX(number) + 1`, no «el menor libre»: el comentario del código justifica no usar «contar + 1», pero el borrado sí devuelve el número al conjunto. | `products/solicitudes/src/routes.ts:170-177` | Crear con folio 900, `GET /api/settings`, borrar la 900, volver a pedir `/api/settings`. Si `nextNumber` vuelve a 900, está confirmado. `SOL-ALT-05`. | Media |
| **R-16** **La segunda alta de la misma sesión choca con `409` porque el folio propuesto nunca se refresca.** Tras un `POST` o `PATCH` exitoso el código recarga la lista y el resumen pero **no** `/api/settings` (`public/app.js:320-322`), así que `estado.cfg.nextNumber` conserva el valor de arranque; `limpiaFormulario()` vuelve a copiar ese valor viejo en `#sol-folio` (`public/app.js:170`) y `cuerpoDelFormulario()` lo manda siempre (`:297`). El efecto no es cosmético: el segundo `Nueva solicitud` de la sesión propone el folio que ya se usó, el servidor responde `409 Ya existe la solicitud numero N en esta empresa` y el diálogo no se cierra. Solo se salva recargando la página o corrigiendo el folio a mano. | `products/solicitudes/public/app.js:170,297,320-322`, `products/solicitudes/src/routes.ts:205-227` | Crear una solicitud, **sin recargar**, pulsar `Nueva solicitud` otra vez y leer `#sol-folio`: si trae el folio recién usado, el `POST` siguiente da `409` y el aviso sale en rojo con el diálogo abierto, está confirmado. `SOL-ALT-06`. | Alta |
| **R-17** **Lo que se admite como adjunto depende de lo que declare el cliente, no de lo que es el archivo.** Con `mimeType: "text/html"` (o `image/svg+xml`) el archivo se rechaza con `415`; **sin** `mimeType` el tipo se deduce de la extensión, `html` y `svg` no están en `POR_EXTENSION` y el archivo cae al tipo genérico `application/octet-stream`, que está en la lista: se acepta con `201` y queda con `mimeType: null`. El `#adjunto-archivo` del HTML no tiene `accept`, así que la interfaz ofrece cualquier archivo y el filtro queda solo del lado del servidor. No es XSS —la descarga va siempre como `attachment`, `octet-stream`, `nosniff` y `sandbox`— pero el inventario de «qué se puede subir» depende del navegador que subló el archivo. | `packages/product-runtime/src/attachments.ts:28-64,113-118`, `products/solicitudes/public/index.html:213`, `products/solicitudes/public/app.js:367` | Subir el mismo `engano.html` por API con `mimeType: "text/html"` y después sin `mimeType`. Si el primero da `415` y el segundo `201`, está confirmado. Repetir desde el `<input type="file">` con un `.svg`: depende de qué `File.type` reporte el navegador, así que anotar el valor real. `SOL-ADJ-04`. | Media |
| **R-18** **Un comentario no se puede editar ni borrar: la única ruta es el `POST`.** No hay `GET` suelto de comentarios, ni `PATCH`, ni `DELETE`, y la UI no ofrece ningún control sobre un `.ui-comentario` que ya está escrito (`public/app.js:186-203`). En una mesa de ayuda eso significa que un comentario con el dato equivocado —un correo, un número de teléfono, el nombre de otra persona— se queda para siempre, y la única corrección es responder con otro comentario. `GET /api/requests/<id>/comments` tampoco existe: cae en el comodín y responde `404 {"error":"Esa solicitud no existe"}`, no `No existe GET …`. | `products/solicitudes/src/routes.ts:487-501`, `products/solicitudes/public/app.js:186-203`, `products/solicitudes/public/app.js:335-349` | Escribir un comentario, recargar y tratar de editarlo o borrarlo: no hay control en `#hilo`. Por API, `DELETE /api/requests/<id>/comments/<id>` y `PATCH` al mismo path: los dos dan `404 {"error":"No existe <MÉTODO> /api/requests/<id>/comments/<id>"}`. `SOL-COM-04`. | Media |
| **R-19** **Hay tres fuentes de verdad para los rótulos de estado y prioridad, y solo una está viva.** `src/routes.ts:75-88` exporta `ETIQUETAS_ESTADO` y `ETIQUETAS_PRIORIDAD` con los mismos cinco y cuatro textos que tiene el mapa `ESTADOS` del cliente (`public/app.js:39-45`), pero `grep -n 'ETIQUETAS_' products/solicitudes/src/*.ts products/solicitudes/public/*.js` no encuentra ningún import: son código muerto. Basta con que alguien cambie un rótulo en un archivo y la columna `Estado` y el texto del historial acaben con rótulos distintos. | `products/solicitudes/src/routes.ts:75-88`, `products/solicitudes/public/app.js:39-45,258-260` | `Select-String -Path products/solicitudes/**/*.ts,products/solicitudes/public/*.js -Pattern 'ETIQUETAS_'`: si solo aparecen las dos declaraciones y ningún uso, está confirmado. En pantalla, comparar la columna `Estado` de `#solicitudes-lista` con el texto de `.ui-evento__cambio`: hoy coinciden, y eso es lo frágil. `SOL-EST-04`. | Baja |
| **R-20** **`Cerrada` y `Cancelada` se ven igual.** En el mapa `ESTADOS` del cliente las dos van con tono neutro, sin clase de color (`public/app.js:39-45`), y las dos son terminales en el servidor (`TERMINALES`, `src/routes.ts:70`). Una solicitud cancelada y una cerrada se distinguen solo por la palabra del rótulo, que es de 8 y 7 caracteres en una columna estrecha. En un helpdesk, «la canceló el cliente» y «la cerró quien la atendía» son dos hechos distintos con el mismo aspecto. | `products/solicitudes/public/app.js:39-45`, `products/solicitudes/src/routes.ts:70` | Filtrar por `Cancelada` y por `Cerrada` y comparar las etiquetas de la columna `Estado`: si ambas son texto neutro sin color, está confirmado. Revisar también que no se confían solo en el color para distinguishirlas: la diferencia real es el texto, que es lo único que las separa. `SOL-EST-05`. | Baja |
| **R-21** **La API devuelve `path`, que es una ruta interna de disco.** Cada adjunto sale con `path: "attachments/<id>"` porque el `SELECT` es de fila completa (`src/routes.ts:423-431,578-587`) y no hay una proyección que lo saque del sobre. No es una fuga grave —el nombre del archivo en disco es el id, no el del cliente, y la descarga se reconstruye con `basename`— pero es un detalle de implementación que viaja al navegador y que cualquier consumidor puede empezar a usar por error. | `products/solicitudes/src/routes.ts:423-431,578-587`, `products/solicitudes/public/app.js:213-218` | `GET /api/requests/<id>` y leer `attachments[0].path`: si es `attachments/soladj_…`, está confirmado. La UI no lo muestra (solo usa `url`, `filename` y `sizeBytes`, `public/app.js:213-223`), así que el efecto es de contrato, no visual. `SOL-API-03`. | Baja |
| **R-22** **`responsibleName: ""` se guarda como cadena vacía y la columna `Responsable` se ve en blanco.** El esquema es `z.string().trim().max(150).nullable().optional()` (`src/routes.ts:120`) y la escritura usa `body.responsibleName ?? null`, que solo convierte `null`/`undefined`: una cadena vacía pasa intacta. La lista usa `r.responsibleName ?? '—'` (`public/app.js:131`), y `??` no alcanza a `""`, así que la celda queda vacía en vez de mostrar el guion. La interfaz nunca produce ese estado —manda `|| null` (`public/app.js:302`)— así que solo se ve cuando el dato entra por API, pero el `POST` acepta `" "` y lo guarda como `""`. | `products/solicitudes/src/routes.ts:120,244,285`, `products/solicitudes/public/app.js:131,302` | `POST /api/requests` con `"responsibleName": "   "` y abrir la fila en `#solicitudes-lista`: si la celda está en blanco y no dice `—`, está confirmado. Comparar con una solicitud creada desde el formulario, donde el campo vacío sí sale `—`. `SOL-API-05`. | Baja |

**Cómo se cierra cada uno.** Los cinco primeros (`R-01`, `R-02`, `R-04`, `R-07`, `R-12`) son
decisiones de producto con efecto visible en pantalla y se anotan en la §9 aunque el código
las lea como intencionadas. `R-03`, `R-05`, `R-08`, `R-15`, `R-16`, `R-17`, `R-18`, `R-19`,
`R-21` y `R-22` son defectos o trampas que se anotan **con el caso que los confirma**. `R-06`,
`R-09`, `R-10`, `R-11`, `R-13`, `R-14` y `R-20` son comportamiento real que hay que registrar
como tal, porque son decisiones de negocio que este producto no explica en pantalla. Ninguno
de los 22 se corrige desde el plan: el plan los prueba.

---

## 8. Checklist visual

Recorrer una vez por cada panel, en 1280 × 800 y en 390 × 844. Marcar cada ítem. Los
objetivos que no existen en `public/index.html` (los que arma `app.js`) solo se pueden mirar
con la lista ya pintada o con el diálogo abierto.

**Canal lateral y cabecera**

- [ ] `#tabs` tiene **2** entradas y solo 2: Solicitudes y Ajustes, con los títulos de sección
      `Mesa de trabajo` y `Configuración` (`public/index.html:33-36`).
- [ ] La entrada activa se distingue por fondo y por el indicador izquierdo, y solo una lo está.
- [ ] `#tabs` marca la activa con `aria-current` y las dos se alcanzan con teclado.
- [ ] El `h1[data-amigo="titulo"]` dice el nombre de la sección, y `data-amigo="empresa"`,
      `data-amigo="usuario"`, `data-amigo="correo"` y `data-amigo="avatar"` traen los datos de la
      sesión, con iniciales en el avatar.
- [ ] `data-amigo="otras"` está oculto cuando el token no trae lista de herramientas, y
      `data-amigo="otras-titulo"` también.
- [ ] `Nueva solicitud` (`#solicitud-nueva`) está en la barra superior y **no** dentro del panel.

**Panel Solicitudes**

- [ ] `#resumen` muestra **4** `.ui-kpi`: `Abiertas` (la única con cifra de acento), `Vencidas`,
      `Resueltas` y `Prioridad alta` (`public/app.js:76-81`). Comprobar que son 4, no 5.
- [ ] Los tres filtros están en la misma fila de tres columnas: `#filtro-q` con el placeholder
      `Título, solicitante, responsable…`, `#filtro-estado` con `Todos` primero y `#filtro-prioridad`
      con `Todas` primera.
- [ ] `#solicitudes-lista` trae una tabla de 8 columnas en este orden: `Folio`, `Título`,
      `Solicitante`, `Responsable`, `Prioridad`, `Estado`, `Vence` y la de acciones.
- [ ] La columna `Folio` muestra el texto con `#` y clase `mono` (`<span class="mono">#12</span>`).
- [ ] `Prioridad` y `Estado` son `.ui-etiqueta` con los tonos de `SOL-EST-05`; comprobar que
      `Cerrada` y `Cancelada` no tienen tono (riesgo `R-20`).
- [ ] `Vence` es texto plano cuando no hay problema y `.ui-etiqueta--malo` con `DD/MM/AAAA · vencida`
      cuando la fecha pasó y la solicitud sigue abierta (`public/app.js:121-123`).
- [ ] Los botones de la fila son chicos: `Ver` y `Borrar` (este último `--fantasma`); comprobar
      que `Borrar` pide `confirm` y que `Ver` abre el diálogo.
- [ ] Con lista vacía, `#solicitudes-lista` muestra una fila con `colspan="8"` y el texto
      `Todavía no hay solicitudes.` (`public/app.js:111`).
- [ ] La tabla se puede desplazar en horizontal sin que la página entera se desplace, y en
      390 × 844 `document.documentElement.scrollWidth` ≤ 390.
- [ ] Los `.ui-kpi` no cambian al filtrar: es el defecto de `R-11`, se marca a propósito.

**Diálogo `#solicitud-dialog`**

- [ ] Abre con `showModal()`: fondo atenuado, foco dentro, `Esc` cierra.
- [ ] `#solicitud-form-titulo` dice `Nueva solicitud` al abrir y `Solicitud #N` al abrir con `Ver`;
      `#solicitud-guardar` alterna entre `Guardar solicitud` y `Guardar cambios`.
- [ ] `#hilo-seccion` está oculto al crear y visible al editar: los comentarios, los adjuntos y
      el historial no existen en una solicitud que aún no está guardada.
- [ ] La retícula de arriba es de tres columnas (`#sol-folio`, `#sol-prioridad`, `#sol-estado`) y
      colapsa a una en móvil; los pares de abajo (`#sol-solicitante`/`#sol-correo` y
      `#sol-responsable`/`#sol-vencimiento`) son de dos columnas.
- [ ] `#sol-folio` es `type="number" min="1"` con la pista `Lo propone el servidor`, y trae el
      `nextNumber` de `GET /api/settings`.
- [ ] `#sol-titulo` y `#sol-solicitante` son los únicos `required`; `#sol-correo` es `type="email"`,
      `#sol-vencimiento` es `type="date"`, y `#sol-descripcion` y `#sol-resolucion` son `textarea`.
- [ ] Los `maxlength` del HTML coinciden con los del servidor: 200 en título, 4000 en descripción y
      resolución, 150 en solicitante y responsable, 200 en correo (`public/index.html:167-197`).
- [ ] `#hilo` pinta un `.ui-comentario` por comentario con autor, fecha y texto, y
      `AMIGO_UI.vacio` con `Sin comentarios todavía.` cuando no hay ninguno.
- [ ] `#adjuntos` pinta una `.ui-ficha` por archivo con el nombre como enlace de descarga, el peso
      como `NN.N KB` y un botón `Quitar`; `#historial` pinta un `.ui-evento` por cambio de estado
      con `Abierta → En curso` o `Creada en estado Abierta`, y `changedBy · DD/MM/AAAA`.
- [ ] `#adjunto-archivo` es `type="file"` con su `aria-label` y **sin** `accept`: comprobar que el
      diálogo de archivos ofrece todo y que el filtro real es el del servidor (riesgo `R-17`).
- [ ] `#solicitud-cerrar` (×, `aria-label="Cerrar"`) y `#solicitud-cancelar` cierran sin enviar nada.
- [ ] Ningún campo del diálogo se sale en 390 × 844: ningún `scrollWidth > 390`.

**Panel Ajustes y avisos**

- [ ] `?panel=ajustes` muestra `#config-form` con `Ajustes` de título, `#cfg-moneda` y `#cfg-zona`
      en dos columnas, y un botón `Guardar ajustes`.
- [ ] `#cfg-moneda` y `#cfg-zona` traen los valores de `GET /api/settings` (`$` y
      `America/Santiago` en una base nueva) y sus `maxlength` son 5 y 60.
- [ ] Guardar Ajustes muestra `Ajustes guardados` en verde y **no** cambia `#resumen` ni
      `#solicitudes-lista`: moneda y zona no entran en ningún cálculo (§7, `R-05`).
- [ ] `#aviso` es un único elemento reutilizado: verde para lo que salió bien, rojo para lo que
      falló, y se oculta solo a los 5000 ms.
- [ ] Los mensajes de error nombran el campo cuando el fallo es de validación (`Datos inválidos`
      con `errors.fieldErrors`), y el aviso del `409` de folio duplicado es el texto del servidor,
      sin tilde en «numero».
- [ ] Consola sin errores en las dos pestañas, en una sesión normal y con el diálogo abierto: el
      filtro `error` debe quedar limpio (ojo con `R-03`, que ensucia justo al agregar comentario).
- [ ] Network: una petición por acción, y **ninguna** de más al escribir en `#filtro-q` más de
      una vez seguidas (riesgo `R-07`).

---

## 9. Registro

Una fila por caso ejecutado. **Dejar vacía hasta la primera vuelta real**: nada de esta §7
está verificado todavía. `Resultado` es `PASA`, `FALLA` o `BLOQUEADO`. Cuando un caso sea el
que confirma un riesgo, anotar el `R-` en la columna `Nota`.

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados. Transversal: Doc 10 §9.

| ID | Resultado (PASA/FALLA/BLOQUEADO) | Evidencia | Nota |
|---|---|---|---|
| SOL-NAV-01 | PARCIAL | 2 pestañas (solicitudes, ajustes); `pushState` al cambiar; `h1` = texto de la pestaña; datos en el panel al entrar | Secuencia exacta de peticiones de arranque (2× `GET /api/requests?limit=500`) no contada al milisegundo en esta vuelta. |
| SOL-NAV-03 | PASA | `?panel=inventado`, `?panel=` y valor con comillas → caen al primer panel, sin XSS ni error | Comportamiento de `panelDeUrl` del shell compartido. |
| SOL-NAV-05 | PASA | Footer con `usuario`/`correo`/`empresa`/`avatar` de `/api/inicio`; `Salir` → `/auth/logout` → Core | `/api/inicio` de solicitudes incluye `rol` y `organizacion` (forma descrita en el plan). |
| SOL-LST-01 | PASA | `GET /api/requests` → `{requests,total}` (sin `limit`/`offset`) | Contrato propio, distinto de `crudRouter`; confirmado en Doc 10 REG-CRUD-01. |
| SOL-NAV-02 | PARCIAL | Tablero con KPIs 5/5/5 y tabla de solicitudes al cargar | Clic en pestañas no dispara red (prefetch); paneles OK. |
| SOL-API-01 | BLOQUEADO | Requiere datos seed de la sección 2 (QA-SOL-2026) | No ejecutado. |
| REG-NAV-01 | FALLA (shell) / PARCIAL (producto) | Ver Doc 10 | 0 requests/clic; aquí no hay panel vacío por prefetch. |