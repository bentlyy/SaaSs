# Plan de pruebas — Inventario

Artículos, stock y movimientos. El sujeto que se bloquea es la **cantidad**: no se escribe
nunca, se deriva sumando los movimientos. La invariante del producto es que todo cambio de
stock deje un asiento con quién lo hizo y por qué; si se pudiera editar el número directo, el
stock dejaría de ser explicable.

El movimiento es un **`delta` con signo**. No existe tipo `entrada`/`salida`/`ajuste`, ni enum,
ni select de tipo: el campo se llama `Cantidad (negativa para salir)` y el signo es el tipo. Un
documento que pida «elegir tipo de movimiento» describe otro producto.

Este plan se **diseña**, no se ejecuta. Cada caso dice qué hacer y qué se espera, no qué se
observó. Las reglas de sesión, la anatomía del caso y el checklist visual están en
`00-CONVENCIONES.md`; los riesgos del shell común están en `10-regresion-compartida.md` y no se
repiten aquí.

---

## 1. Ficha técnica

| Qué | Valor |
|---|---|
| Slug | `inventario` |
| Nombre | Inventario |
| Dominio | `inventario.amgdeveloper.cl` |
| Puerto de desarrollo | `3023` (`PORT=3023` en `products/inventario/.env` y `.env.example`) |
| Puerto publicado detrás de nginx / Docker | `3103` (`README.md`, `ops/nginx.conf:39`, `docker-compose.yml:132`) |
| Script de desarrollo | `npm run dev:inventario` (raíz) → `npm run dev -w @amg/inventario` → `tsx watch src/index.ts` |
| Script de pruebas | `npm test -w @amg/inventario` (vitest, `products/inventario/tests/inventario.test.ts`) |
| Ruta local | `products/inventario` |
| Base de datos | `./data/inventario.sqlite` (`DB_PATH`), ignorada por git |
| Versión de esquema declarada | `DB_SCHEMA_VERSION=1` |
| Tablas | `items`, `movements`, `settings` + `amg_migrations` (`src/ddl.ts`) |
| Core (identidad) | `CORE_URL=http://localhost:3108`, `APP_URL=http://localhost:3023`, `CORE_DB_PATH=../../data/core/core.sqlite` |
| Credenciales SSO | `AMG_SSO_CLIENT_ID=inventario`; el secreto lo entrega el Core con `npm run sso:secret -w @amg/platform -- inventario` |
| Acento del producto | `--acento: #2f6fd0`, `--acento-fuerte: #24579f`, `--acento-tenue: #e6effb` (`public/style.css:19-24`) |
| Logo en el canal | `IN` (`data-amigo="logo"`, `public/index.html:25`) |
| Casos de prueba | 90 casos agrupados por bloque (`NAV`, `RES`, `ART`, `BUS`, `MOV`, `STK`, `CAT`, `AJUST`, `SEED`, `API`, `SIST`, `E2E`, `REG`) |

**Roles.** La identidad trae `member`, `admin` u `owner`
(`packages/product-runtime/src/auth.ts:29`). Inventario los usa así:

| Superficie | Rol mínimo | Dónde |
|---|---|---|
| Lecturas: `/api/items`, `/api/items/:id`, `/api/items/low-stock`, `/api/movements`, `/api/resumen`, `GET /api/settings`, `/api/me`, `/api/inicio` | cualquiera con sesión | — |
| `POST /api/items`, `PATCH /api/items/:id` | `member` | `src/routes.ts:313` (`writeRole`) |
| `DELETE /api/items/:id` | `admin` | `src/routes.ts:314` (`deleteRole`) |
| `POST /api/items/:id/movements` | `admin` | `src/routes.ts:180` |
| `PUT /api/settings` | `admin` | `src/routes.ts:262` |
| `POST /api/seed` | `admin`, y `403` en producción | `src/routes.ts:339,341` |

**Aviso sobre los ajustes.** `GET /api/settings` no exige rol, pero **`PUT /api/settings` sí
exige `admin`** (`requireRole('admin')`, `src/routes.ts:262`), igual que la interfaz
`data-requiere-admin` insinúa. Cualquier plan que dé por hecho que los ajustes los edita
cualquiera con sesión está equivocado: se comprueba en `INV-AJUST-09` y `INV-SIST-04`.

**Paneles.** `articulos`, `movimientos`, `configuracion`
(`AMIGO.montar({ paneles: [...] })`, `public/app.js:319-322`). El canal los declara en `#tabs`
con `data-tab="articulos|movimientos|configuracion"`, agrupados bajo los títulos `Almacén` y
`Configuración`. La sección activa viaja en la URL como `?panel=<clave>`. La clave de Ajustes es
`configuracion`, **sin tilde**, también en la URL.

**Nota sobre los ids del diálogo.** El formulario de artículo y el de movimiento **no existen en
`index.html`**: se arman en runtime, en `abrir()` (`public/app.js:206-228`), con el patrón
`` `c_${c.name}` ``. Buscar esos ids contra el HTML da falso negativo. Los que existen al abrir el
diálogo son `c_name`, `c_sku`, `c_minQuantity`, `c_unit`, `c_priceCents` (artículo) y `c_delta`,
`c_reason` (movimiento). Los ids que sí están en el HTML son `#buscar`, `#nuevo`, `#resumen`,
`#filas`, `#movimientos`, `#config-form`, `#defaultUnit`, `#defaultMinQuantity`, `#currency`,
`#sembrar`, `#dialogo`, `#titulo`, `#campos`, `#error`, `#guardar`.

**Rutas de API, todas bajo el runtime compartido salvo `/health`, `/api/meta` (públicas),
`/api/me` y `/api/inicio`:**

| Ruta | Método | Rol | Respuesta |
|---|---|---|---|
| `/health` | GET, POST | — sin sesión | `200 {"ok":true,"product":"inventario","name":"Inventario"}`; `503 {"ok":false,"product":"inventario"}` si la base no abre |
| `/api/meta` | GET | — sin sesión | `200 {"name":"Inventario","product":"inventario","version":2,"identity":"amg-central"}` |
| `/api/me` | GET | — | `{"user":{id,email,name},"organization":{id,slug},"role","product"}` |
| `/api/inicio` | GET | — | `{"usuario":{id,nombre,email},"organizacion":{id,slug,nombre},"rol","herramienta","herramientas":[…]}` |
| `/api/resumen` | GET | — | `{items, unidades, valorCents, stockBajo, movimientos}` |
| `/api/items/low-stock` | GET | — | `{"items":[…]}`. Se registra **antes** del `crudRouter` a propósito (`src/routes.ts:63-66`), porque el CRUD resuelve `/:id` |
| `/api/items` | GET | — | `{items, total, limit, offset}` (contrato de `crudRouter`) |
| `/api/items/:id` | GET | — | fila cruda, o `404 {"error":"No encontrado"}` |
| `/api/items` | POST | `member` | `201` con la fila cruda |
| `/api/items/:id` | PATCH | `member` | fila cruda, o `404` |
| `/api/items/:id` | DELETE | `admin` | `200 {"ok":true,"archived":true}` (baja lógica), o `404` |
| `/api/movements` | GET | — | `{"movements":[…]}` con `itemName` resuelto |
| `/api/items/:id/movements` | POST | `admin` | `201 {"movement":{…},"quantity":N}` |
| `/api/settings` | GET | — | fila plana, o defaults; siempre con `configured` y `seedAvailable` |
| `/api/settings` | PUT | `admin` | fila plana + `configured: true` (**sin** `seedAvailable`) |
| `/api/seed` | POST | `admin` | `{"creados":N,"nota":"La organización ya tenía artículos"}`; `403` si `NODE_ENV=production` |

---

## 2. Datos de prueba

**El producto no siembra nada al arrancar.** `products/inventario/src/app.ts` no declara `seed`
en la definición, y el comentario lo dice: los datos de ejemplo pertenecen a una organización, y
esa organización solo existe cuando hay una sesión real. Sembrar al levantar el server obligaría
a inventar un `organization_id`.

**Hay dos caminos para sembrar, y no son intercambiables.**

| Camino | Sirve para | Cómo |
|---|---|---|
| `POST /api/seed` (botón `Cargar datos de ejemplo`) | tener el catálogo de ejemplo con las cifras ya calculadas | **Solo en una organización vacía.** Es todo o nada por organización: si ya hay un solo artículo, responde `200 {"creados":0,"nota":"La organización ya tenía artículos"}` y no inserta ninguno (`src/seed.ts:27-32`). Nunca borra lo que hay |
| Alta a mano por la UI | probar el camino real del usuario, con control de los valores | `#nuevo` en `?panel=articulos`, prefijo `QA-INV-` |

**Base de trabajo.** Organización de QA propia, con una sesión `admin` y otra `member` (para los
casos de rol). Todo lo que se cree lleva el prefijo `QA-INV-` en los campos de texto, según la
convención 5.5. **Nunca por `INSERT` directo.**

**Catálogo de ejemplo** (lo que inserta `POST /api/seed`, de `src/seed.ts:15-22`), para tener de
referencia las cifras del resumen:

| Nombre | SKU | Cantidad | Mínimo | Unidad | `priceCents` |
|---|---|---|---|---|---|
| Aceite hidráulico 5W-30 1L | `ACE-530` | 52 | 10 | pieza | 18500 |
| Filtro de aire universal | `FIL-AIR` | 30 | 6 | pieza | 12000 |
| Filtro de aceite | `FIL-OIL` | 36 | 6 | pieza | 9800 |
| Bujía NGK | `BUJ-NGK` | 8 | 20 | pieza | 7900 |
| Guante de nitrilo (caja 100) | `GUA-NIT` | 14 | 5 | caja | 15900 |
| Refrigerante R134a | `REF-134` | 3 | 4 | botella | 22500 |

**Artículos para hacerlos a mano.** En la organización de trabajo, con estos valores el resumen
queda en cifras conocidas y el del sembrado sirve de contraste:

| Prefijo | Nombre | SKU | Mínimo | Unidad | `priceCents` | Para qué |
|---|---|---|---|---|---|---|
| `QA-INV-2026` | `QA-INV-2026 Filtro aire` | `QA-INV-FA` | 0 | pieza | 12000 | stock alto, base de los movimientos |
| `QA-INV-2026` | `QA-INV-2026 Bujía` | `QA-INV-BJ` | 20 | pieza | 7900 | arranca en stock bajo (0 ≤ 20) |
| `QA-INV-2026` | `QA-INV-2026 Guante` | `QA-INV-GN` | 5 | caja | 15900 | para probar `unit` distinto y el mensaje de stock insuficiente |
| `QA-INV-2026` | `QA-INV-2026 refrigerante` | `QA-INV-RF` | 4 | botella | 22500 | para agotar y ver el rechazo |

**Una segunda organización vacía** para `INV-SEED-03` y `INV-SIST-05`. El sembrado todo-o-nada
exige una organización sin un solo artículo, y la de trabajo ya no lo va a estar.

**Limpieza al terminar.** Dar de baja con el botón `Baja` (o `DELETE /api/items/:id`, que es
baja lógica y conserva el historial) todo lo que lleve `QA-INV-`. Los movimientos no se borran
por API: son la explicación del stock y no hay ruta para eso, a propósito. Si se tocó un ajuste
organizacional, restaurarlo y anotarlo en la sección 9.

---

## 3. Precondiciones

1. El Core está arriba: `npm run dev:core` (puerto `3108`) y responde `GET /health` con
   `200 {"ok":true}`.
2. El producto está arriba: `npm run dev:inventario`. Las dos primeras líneas del log dicen
   `Inventario (inventario) en <appUrl> -> puerto <port>` y
   `Identidad y suscripciones: <coreUrl>`; anotar los valores reales, porque `.env` puede no
   coincidir con `.env.example` (ver `INV-SIST-01`).
3. `NODE_ENV` tiene que ser `development` para todo lo que toque `#sembrar` y `POST /api/seed`.
   Con `NODE_ENV=production`, `seedAvailable` pasa a `false` y el botón desaparece (ver
   `INV-SEED-05`).
4. La organización de QA tiene la suscripción a `inventario` activa. Sin ella, el middleware
   responde `403` con `{ "error": "sin-acceso" }`
   (`packages/auth-client/src/middleware.ts:98`).
5. **No hay login local.** Este producto no pide usuario ni contraseña: la sesión vive en el
   Core. Se entra por `desarrollo.amgdeveloper.cl` (puerto `3108`) y el Core devuelve al
   producto. Que el producto redirija al login del Core es el flujo correcto, no un error de Auth
   (convención 5.3).
6. Tester tipea sus credenciales. Nunca se le piden ni se anotan (convención 5.2).
7. **La sesión dura 15 minutos.** Al expirar, cualquier `/api/*` responde
   `401 {"error":"sin-sesion","loginUrl":"…"}` y el navegador salta al login del Core. Volver a
   entrar y anotar el corte en la sección 9; no es un defecto del producto (convención 5.1).
8. **Límite de tasa: 600 peticiones / 15 min por IP**
   (`packages/product-runtime/src/app.ts:99-106`). Un `429` no es un defecto: se anota y se
   espera (convención 5.4). Cada alta, cada edición y cada baja disparan un `cargar()` completo
   de 5 peticiones, así que los casos de la §4.4 consumen presupuesto con facilidad.
9. Cada caso que dependa de otro lo referencia por ID en **Precondición**.
10. Para los casos de API: DevTools abierto, pestaña **Network**, filtro de fetch/XHR activado, y
    `Copy as fetch` para reproducir una petición desde la consola.
11. Tener a mano una sesión `member` además de la de `admin`: cinco rutas de escritura dependen
    del rol y cuatro de ellas devuelven `403` con un `member`.

---

## 4. Casos por módulo

### 4.1 Navegación y deep-link

Selectores: `#tabs a[data-tab="articulos"]`, `#tabs a[data-tab="movimientos"]`,
`#tabs a[data-tab="configuracion"]`, `h1[data-amigo="titulo"]`, y en la barra superior `#buscar`
(`input[type=search]`, placeholder `Buscar por nombre o SKU`) y `#nuevo` (`Nuevo artículo`).

| | |
|---|---|
| **ID** | INV-NAV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, organización con los datos de la §2. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/` y esperar la carga.<br>2. Enumerar los enlaces de `#tabs` con sus textos y el `<p class="ui-nav__titulo">` que los precede.<br>3. En Network, filtrar `/api/` en la primera carga. |
| **Esperado** | `#tabs` tiene exactamente 3 enlaces, en este orden y con este rótulo: `Artículos`, `Movimientos`, `Ajustes`, con los títulos de grupo `Almacén` (los dos primeros) y `Configuración` (el tercero). Sin `?panel=` se muestra `articulos`. El logo `data-amigo="logo"` muestra `IN`. Network muestra **exactamente 6** peticiones de datos: `/api/me`, `/api/resumen`, `/api/items?q=`, `/api/movements?limit=40` y `/api/settings` (las cinco del `Promise.all` de `cargar()`, `public/app.js:38-44`) más `/api/inicio` (`packages/product-runtime/public/amigo.js:166`). Todas `200`. Ninguna más: no hay peticiones por panel. |

| | |
|---|---|
| **ID** | INV-NAV-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | INV-NAV-01 ejecutado. |
| **Pasos** | 1. Pulsar `Movimientos` en el canal y contar las peticiones nuevas.<br>2. Pulsar `Ajustes` y contar.<br>3. Volver a `Artículos` y contar.<br>4. Leer el contenido de `#movimientos` y de `#config-form` en cada visita. |
| **Esperado** | **Cero** peticiones nuevas en los tres cambios: `AMIGO.montar` se llama sin `alEntrar` a propósito (`public/app.js:319-322`) porque `cargar()` ya trajo artículos, movimientos y ajustes de una vez. `#movimientos` y los tres campos de `#config-form` **ya tienen contenido** desde la primera carga: ningún panel aparece vacío. Es la diferencia con los productos que sí pasan `alEntrar`, donde este mismo recorrido sí dispara peticiones. |

| | |
|---|---|
| **ID** | INV-NAV-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `/?panel=movimientos`.<br>2. Recargar con F5.<br>3. Abrir `/?panel=configuracion`, recargar, y volver a `/?panel=articulos`. |
| **Esperado** | Cada URL entra directo a su panel, sin pantalla intermedia y **sin panel vacío**: los datos ya vienen de `cargar()` en la primera carga. `h1[data-amigo="titulo"]` muestra `Movimientos`, `Ajustes` y `Artículos` respectivamente (toma el texto del enlace activo, `amigo.js:104-108`). La URL no se reescribe al cargar: sigue diciendo `?panel=configuracion`. |

| | |
|---|---|
| **ID** | INV-NAV-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `/?panel=inventario`.<br>2. Abrir `/?panel=ARTICULOS`.<br>3. Abrir `/?panel=configuración` (con tilde). |
| **Esperado** | Los tres caen a `articulos`, que es el primer panel, y el canal marca `Artículos` como activo. La URL **no** se corrige: sigue mostrando el valor inválido, porque `panelDeUrl` solo decide qué pintar y no hace `pushState` (`amigo.js:40-43,142-151`). Un deep-link con tilde no funciona: la clave correcta es `configuracion`. |

| | |
|---|---|
| **ID** | INV-NAV-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | INV-NAV-03 ejecutado, la pestaña activa es `movimientos`. |
| **Pasos** | 1. Pulsar `Ajustes` y después el botón Atrás del navegador.<br>2. Pulsar Adelante.<br>3. Recargar con F5 y comprobar en qué panel queda. |
| **Esperado** | Atrás vuelve a `movimientos` y Adelante a `configuracion`, con `aria-current="page"` en el enlace correspondiente y `h1[data-amigo="titulo"]` actualizado. Todo por `popstate` (`amigo.js:150`), sin recargar la página ni volver a pedir datos. |

| | |
|---|---|
| **ID** | INV-NAV-06 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa, datos de prueba. |
| **Pasos** | 1. En `?panel=articulos`, recorrer con `Tab` los tres enlaces de `#tabs`.<br>2. Leer `hidden` de los tres `section[data-panel]`.<br>3. Comprobar el `aria-current` del enlace activo y de los otros dos. |
| **Esperado** | Solo `section[data-panel="articulos"]` es visible; los otros dos tienen `hidden` y no ocupan espacio (`[hidden] { display: none !important }` en `amigo.css`). Solo el enlace activo tiene `aria-current="page"`; los otros dos no tienen ese atributo. Los tres son alcanzables con teclado y el anillo de foco es visible. |

| | |
|---|---|
| **ID** | INV-NAV-07 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Ir a `?panel=movimientos` y pulsar `#nuevo`.<br>2. Cerrar el diálogo con `Esc`.<br>3. Ir a `?panel=configuracion` y escribir `QA-INV-2026` en `#buscar`, esperando 400 ms.<br>4. Leer Network y el contenido de `#movimientos`. |
| **Esperado** | `#buscar` y `#nuevo` viven en `.ui-topbar`, así que están visibles en los tres paneles. 1: se abre `#dialogo` con `#titulo` = `Nuevo artículo` desde el panel de Movimientos. 3: sale `GET /api/items?q=QA-INV-2026%202026` y se repinta `#filas`, que en ese momento está oculto; `#movimientos` **no cambia**. Es decir, el buscador filtra un panel que no se está viendo (ver `R-13`). |

### 4.2 Resumen y tarjetas — `GET /api/resumen`

Selectores: `#resumen` (`.ui-rejilla.ui-rejilla--4`) y las tarjetas `.ui-kpi` que pinta
`AMIGO_UI.kpis`. Las cifras salen de `estado.resumen` con `Intl.NumberFormat('es-CL')` para los
números y con `pesos()` para el dinero.

| | |
|---|---|
| **ID** | INV-RES-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Organización vacía (la de la §2 que se reserva para el sembrado). |
| **Pasos** | 1. `GET /api/resumen` en la organización vacía.<br>2. En la misma organización, pulsar `Cargar datos de ejemplo` en `?panel=configuracion`.<br>3. Releer `GET /api/resumen` y las tarjetas de `#resumen`, en orden. |
| **Esperado** | 1: `200 {"items":0,"unidades":0,"valorCents":0,"stockBajo":0,"movimientos":0}`. 2: `POST /api/seed` responde `200 {"creados":6}`. 3: `200 {"items":6,"unidades":143,"valorCents":2028100,"stockBajo":2,"movimientos":0}` — las seis cifras se derivan de la tabla de la §2 (`unidades` = 52+30+36+8+14+3; `valorCents` = `sum(quantity * priceCents)`; `stockBajo` = los dos con `quantity <= minQuantity`: `BUJ-NGK` 8≤20 y `REF-134` 3≤4). `#resumen` muestra **cinco** tarjetas en este orden: `Artículos` = 6, `Unidades` = 143, `Valor de stock` = `$ 20.281`, `Movimientos` = 0, y `2 artículos en stock bajo` con la cifra `Revisar`. Las cuatro primeras llevan la cifra en `Intl` plano; solo `Revisar` lleva `ui-kpi__cifra--acento`. |

| | |
|---|---|
| **ID** | INV-RES-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Crear por API un artículo con `priceCents: 18500` y otro con `priceCents: 18550`.<br>2. Leer la columna `Precio` de las dos filas de `#filas`.<br>3. Cambiar `currency` a `CLP$` en `?panel=configuracion`, guardar, y releer. |
| **Esperado** | 2: `$ 185` y `$ 186`. El formato es `pesos()` (`public/app.js:28-31`): símbolo de `settings.currency`, un espacio, `Intl.NumberFormat('es-CL')` y `Math.round(centavos / 100)` — sin decimales. El artículo de `18550` **pierde 50 centavos en pantalla**. 3: con `currency: "CLP$"` las dos celdas quedan `CLP$ 185` y `CLP$ 186`, y la tarjeta `Valor de stock` también cambia de símbolo. Notar que este producto **no** usa `AMIGO_UI.dinero`, que sí sabe decimals y separador (ver `R-07`). |

| | |
|---|---|
| **ID** | INV-RES-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Ajustes por defecto: `defaultMinQuantity: 0`. |
| **Pasos** | 1. Crear un artículo desde `#nuevo` con solo `Nombre`.<br>2. Leer `#resumen` y `GET /api/items/low-stock`.<br>3. Registrar un movimiento de `+5` y releer ambas cosas.<br>4. Registrar uno de `+1` y volver a leer. |
| **Esperado** | 1: el artículo nace con `quantity: 0` (`schema.ts:22`; el campo no es escribible y el default de la base es 0). 2: como el criterio de stock bajo es `quantity <= minQuantity` (`lte`, `src/routes.ts:108`), con `0 <= 0` el artículo **aparece en stock bajo desde el primer momento**: aparece la quinta tarjeta `1 artículo en stock bajo` y `GET /api/items/low-stock` lo lista. 3: con `quantity: 5` y `minQuantity: 0` sigue en stock bajo (`5 <= 0` es falso, así que **sale**), y la tarjeta desaparece. 4: confirmar el criterio `<=` con un artículo de `minQuantity: 5` y `quantity: 5`: ese sí sigue en stock bajo. Con los ajustes por defecto, todo artículo recién creado aparece en la quinta tarjeta hasta que se le carguen unidades (ver `R-04`). |

| | |
|---|---|
| **ID** | INV-RES-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un artículo con movimientos, y otro artículo aparte. |
| **Pasos** | 1. Dar de baja el primer artículo con el botón `Baja`.<br>2. Leer `GET /api/resumen`, `GET /api/items` y `GET /api/items/low-stock`.<br>3. Crear por API un artículo con `{"name":"QA-INV-2026 inactivo","active":false}` y repetir las tres lecturas, además de `?q=QA-INV-2026`. |
| **Esperado** | 2 (archivado): sale de las cinco tarjetas, de `GET /api/items` y de `low-stock`: los cuatro agregados del resumen filtran `isNull(archivedAt)` (`src/routes.ts:102,108`), igual que el `crudRouter`. 3 (inactivo): sale de `Artículos`, `Unidades`, `Valor de stock` y de `stockBajo`, porque también filtran `active = true`; pero **sigue en `GET /api/items`, en `?q=` y en la tabla**, porque el `crudRouter` solo filtra por `archived_at` y no mira `active` (`packages/product-runtime/src/crud.ts:199-203`). Un artículo que no cuenta en `Artículos` pero está en la lista. La interfaz no tiene ningún control de `active`: solo por API (ver `R-05`). |

| | |
|---|---|
| **ID** | INV-RES-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un artículo con 3 movimientos, que luego se da de baja. |
| **Pasos** | 1. Leer `GET /api/resumen` antes de dar de baja y anotar `items`, `movimientos`.<br>2. Dar de baja el artículo.<br>3. Releer las cinco cifras.<br>4. Leer `GET /api/movements?itemId=<id del artículo dado de baja>`. |
| **Esperado** | 3: `items`, `unidades`, `valorCents` y `stockBajo` bajan; **`movimientos` no baja**, queda en 3. La consulta de `movimientos` filtra solo por organización, sin mirar `active` ni `archived_at` (`src/routes.ts:111-115`), y eso es lo correcto: el historial de un artículo dado de baja tiene que seguir contando. 4: los 3 movimientos siguen ahí y `itemName` se resuelve con el nombre del artículo, porque la resolución de nombres usa `inArray(items.id, ids)` sin filtrar `archivedAt` (`src/routes.ts:150-159`). |

| | |
|---|---|
| **ID** | INV-RES-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Al menos un artículo en stock bajo. |
| **Pasos** | 1. Leer la quinta tarjeta de `#resumen`.<br>2. Pasar el cursor por encima y hacer clic en la cifra `Revisar`.<br>3. Leer Network.<br>4. Buscar en el código si algo llama a `low-stock`: `grep -r low-stock products/inventario/public`. |
| **Esperado** | La tarjeta se compone como `tarjetas.push([<rótulo>, 'Revisar', true])` (`public/app.js:83-86`): el rótulo largo `2 artículos en stock bajo` va en `ui-kpi__etiqueta` y la palabra `Revisar` es la cifra acentuada. No es un enlace, no tiene manejador y no dispara nada: `AMIGO_UI.kpis` no adjunta eventos (`amigo-ui.js:238-260`). `GET /api/items/low-stock` **no se pide nunca desde la interfaz** (el grep no devuelve nada en `public/`). La lista de stock bajo existe como API y no tiene UI (ver `R-10`). |

### 4.3 Artículos — listado y tabla

La tabla de `#filas` tiene las columnas de `public/index.html:78-86`: `Nombre`, `SKU`, `Stock`
(`.num`), `Unidad`, `Precio` (`.num`) y una celda de acciones con `Editar`, `Mover` y `Baja`.

| | |
|---|---|
| **ID** | INV-ART-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Organización sin ningún artículo. |
| **Pasos** | 1. Abrir `?panel=articulos`.<br>2. Leer la única fila de `#filas`.<br>3. Mirar también `#movimientos` desde `?panel=movimientos`. |
| **Esperado** | `#filas` tiene una fila con el texto `Todavía no hay artículos. Creá el primero.` ocupando el ancho de la tabla (`AMIGO_UI.filaVacia(6, …)`, `public/app.js:92`) y las seis columnas del encabezado siguen visibles. `#movimientos` muestra `Sin movimientos todavía.` (`filaVacia(5, …)`). `#resumen` muestra cuatro tarjetas en cero. No queda ninguna tabla sin filas ni con `colspan` equivocado. |

| | |
|---|---|
| **ID** | INV-ART-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los artículos `QA-INV-2026 Filtro aire`, `QA-INV-2026 Bujía` y `QA-INV-2026 refrigerante` de la §2. |
| **Pasos** | 1. Leer la fila de `QA-INV-2026 Filtro aire` en `#filas`, celda por celda.<br>2. Buscar la fila de un artículo creado con `sku` vacío.<br>3. Contar los botones de la celda de acciones. |
| **Esperado** | 1: `Nombre` = `QA-INV-2026 Filtro aire`; `SKU` = `QA-INV-FA`; `Stock` = el número con `Intl` (`0` mientras no se mueva nada, y con `(mín 0)` al lado si está en stock bajo, porque 0 ≤ 0); `Unidad` = `pieza`; `Precio` = `$ 120` (de `priceCents: 12000`); acciones = tres botones con los textos `Editar`, `Mover` y `Baja`, en ese orden, en la última celda alineada a la derecha. 2: `SKU` muestra `—` (el `a.sku || '—'` de `public/app.js:117`), no una celda vacía. 3: tres, y ninguno más. |

| | |
|---|---|
| **ID** | INV-ART-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Al menos 5 artículos con nombres que ordenen distinto del alta. |
| **Pasos** | 1. `GET /api/items` y enumerar las claves del cuerpo y de `items[0]`.<br>2. Comparar el orden de la respuesta con el orden de las filas de `#filas`.<br>3. Comparar `total` con la cantidad de filas. |
| **Esperado** | `200 {"items":[…],"total":N,"limit":200,"offset":0}`: el contrato de `crudRouter` (`crud.ts:248`). Cada artículo trae `id` con prefijo `item_`, `organizationId`, `name`, `sku`, `quantity`, `minQuantity`, `unit`, `priceCents`, `active`, `createdAt`, `updatedAt`, `archivedAt`. El orden es **ascendente por `name`** (`orderBy: items.name, orderDirection: 'asc'`, `src/routes.ts:304-305`), no por fecha de alta, y es el mismo orden que ve la tabla. `total` cuenta lo mismo que devuelve `items`, con el mismo filtro de organización y de archivados. |

| | |
|---|---|
| **ID** | INV-ART-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/items?limit=0`.<br>2. `GET /api/items?limit=9999`.<br>3. `GET /api/items?limit=5&offset=2`.<br>4. Con 201 artículos en la organización, abrir `?panel=articulos` y contar las filas de `#filas`. |
| **Esperado** | 1: `limit: 200` (el `defaultLimit`, porque `Math.min(Number('0') || 200, 1000)` y `0` es falsy). 2: `limit: 1000` (recortado, no `400`). 3: `200`-`{items}` con 5 elementos, `limit: 5`, `offset: 2`. 4: `#filas` muestra **200** filas y nada más, sin paginador, sin botón de «siguiente» y sin ningún texto que advierta que faltan filas; `GET /api/resumen` sí dice `Artículos: 201`. El tope efectivo de la interfaz es 200 de los 1000 que admite la ruta (ver `R-08`). |

| | |
|---|---|
| **ID** | INV-ART-05 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Un artículo con `minQuantity: 20` y `quantity: 30`, y otro con `minQuantity: 5` y `quantity: 0`. |
| **Pasos** | 1. Comparar la celda `Stock` de las dos filas.<br>2. Comparar la alineación de la celda `Stock` y `Precio` con la de sus encabezados.<br>3. Filtrar la tabla en escala de grises y ver si el artículo en stock bajo se distingue sin el color. |
| **Esperado** | 1: el primero muestra `30` pelado; el segundo muestra `0` seguido de ` (mín 5)` en un `<small class="tenue">` (`public/app.js:98-108`). El mínimo va al lado de la cantidad y no en otra columna, que es la decisión del producto: la pregunta «¿cuánto le falta?» se responde leyendo el mismo número. 2: los `<th>` de `Stock` y `Precio` llevan `.num` y salen alineados a la derecha, pero sus `<td>` **no** llevan `.num` y salen a la izquierda: `pintarArticulos` llama a `AMIGO_UI.fila([...], { className: 'acciones' })` sin `num` (`public/app.js:117`), y la propia documentación de `fila()`/`tabla()` exige que encabezado y celda coincidan (`amigo-ui.js:158-160`). Es una desalineación, no un criterio (ver `R-12`). 3: el `(mín 5)` se lee sin color, así que el estado es identificable por texto. |

### 4.4 Artículos — alta, edición y baja

Los campos del formulario de artículo son exactamente cinco, y **no hay campo de cantidad**
(`public/app.js:246-263`). Se arman en runtime: al abrir el diálogo existen `#c_name` (label
`Nombre`, `required`), `#c_sku` (`SKU`), `#c_minQuantity` (`Stock mínimo`, `number`, `min=0`),
`#c_unit` (`Unidad`) y `#c_priceCents` (`Precio en centavos`, `number`, `min=0`).

| | |
|---|---|
| **ID** | INV-ART-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=articulos`, sesión `admin`. |
| **Pasos** | 1. Pulsar `#nuevo` (`Nuevo artículo`).<br>2. Leer `#titulo` y enumerar los `input` de `#campos` con su `id`, `name`, `type`, `required` y `min`.<br>3. Escribir `QA-INV-2026 Filtro aire` en `#c_name`, `QA-INV-FA` en `#c_sku`, `6` en `#c_minQuantity`, `pieza` en `#c_unit`, `12000` en `#c_priceCents`.<br>4. Pulsar `Guardar`.<br>5. Leer Network, `#titulo` y la tabla. |
| **Esperado** | 2: exactamente cinco campos, con esos ids y esos rótulos; `#c_name` es el único `required`. `#c_minQuantity` y `#c_priceCents` nacen con `value` = `defaultMinQuantity` de los ajustes (0 por defecto) y `0` respectivamente; `#c_unit` nace con `defaultUnit` (`unidad` por defecto). `#titulo` = `Nuevo artículo`. 4: `POST /api/items` con cuerpo `{"name":"QA-INV-2026 Filtro aire","sku":"QA-INV-FA","minQuantity":"6","unit":"pieza","priceCents":"12000"}` — los números viajan como **cadenas**, porque `abrir()` arma el cuerpo con `Object.fromEntries([…input].map(i => [i.name, i.value]))` sin convertir, y los deja pasar por `z.coerce`. Respuesta `201` con la fila cruda. 5: el diálogo se cierra, la fila aparece en `#filas`, `#resumen` se actualiza y **no hay ningún aviso de éxito**: este producto no tiene `#aviso` (ver `R-02`). |

| | |
|---|---|
| **ID** | INV-ART-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#dialogo` abierto en modo `Nuevo artículo`. |
| **Pasos** | 1. Dejar `#c_name` vacío, completar el resto y pulsar `Guardar`.<br>2. Escribir un nombre de 151 caracteres en `#c_name` y volver a pulsar `Guardar`.<br>3. Repetir el paso 1 desde la API: `POST /api/items` con `{"name":"   "}`. |
| **Esperado** | 1: el navegador bloquea el envío por `required` en `#c_name`, enfoca ese campo y muestra la burbuja nativa; `#dialogo` **no** se cierra y no hay petición en Network. Ninguna `POST /api/items`. 2: la validación nativa de `required` no mira el largo: sale la `POST` y el `400` vuelve con `Datos inválidos` y `errors.fieldErrors.name` presente; `#error` lo muestra y el diálogo **vuelve a abrirse** con `#titulo` = `Nuevo artículo` y los valores escritos intactos (`public/app.js:231-243`). 3: `400 Datos inválidos`, porque el schema es `z.string().trim().min(1).max(150)`: el `trim()` va antes del `min`, así que solo espacios tampoco pasan. |

| | |
|---|---|
| **ID** | INV-ART-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#dialogo` abierto en modo `Nuevo artículo`. |
| **Pasos** | 1. Completar solo `#c_name` y borrar el contenido de `#c_minQuantity`.<br>2. Completar `#c_name`, `#c_unit` y `#c_priceCents`, y borrar `#c_priceCents`.<br>3. Repetir el paso 1 escribiendo `-5` en `#c_minQuantity`.<br>4. Comprobar por API: `POST /api/items` con `{"name":"X","priceCents":-1}` y con `{"name":"X","unit":"   "}`. |
| **Esperado** | 1 y 2: campo vacío → cadena `""` → `z.coerce.number()` la convierte en `0`. Se guardan `minQuantity: 0` y `priceCents: 0` sin error ni aviso, o sea que **borrar el precio deja el artículo a `$ 0` sin preguntar nada**. El `min="0"` del input evita el negativo desde la UI, no desde la API. 3: el `min=0` del input bloquea el envío antes de la petición. 4: `priceCents: -1` da `400 Datos inválidos` (`cantidad` es `min(0).max(1_000_000)`); `unit: "   "` da `201` con `unit: ""`, porque el schema de `unit` es `z.string().trim().max(30)` **sin `min(1)`** y el default solo entra si la clave está ausente (ver `INV-CAT-03`). |

| | |
|---|---|
| **ID** | INV-ART-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Un artículo existente con `quantity: 0`. |
| **Pasos** | 1. `PATCH /api/items/<id>` con cuerpo `{"quantity": 9999}`.<br>2. `GET /api/items/<id>` y leer `quantity`.<br>3. Repetir con `{"quantity": 0}` (cero, no nueve mil).<br>4. `POST /api/items` con `{"name":"QA-INV-2026 con cantidad","quantity": 5}`. |
| **Esperado** | 1: `400` con `{"error":"Campo desconocido: quantity. Revisa el nombre; si esta bien escrito, no lo mandes."}`. El campo `quantity` está declarado `{ readonly: true }` (`src/routes.ts:319`), así que `buildSchema` lo deja fuera del shape y el `.strict()` del `crudRouter` lo reporta como sobrante (`crud.ts:139-150,124-137`). **La cantidad no se escribe por `PATCH`: es la invariante del producto**, y hay un test que la vigila (`tests/inventario.test.ts:193-204`). 2: `quantity` sigue en `0`. 3: también `400`, aunque mande el valor «correcto»: el rechazo es por el nombre del campo, no por el valor. 4: también `400 Campo desconocido: quantity`. |

| | |
|---|---|
| **ID** | INV-ART-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un artículo `QA-INV-2026 Filtro aire`. |
| **Pasos** | 1. Pulsar `Editar` en su fila.<br>2. Leer `#titulo` y los cinco valores precargados.<br>3. Cambiar solo `#c_priceCents` a `13500` y pulsar `Guardar`.<br>4. Volver a abrir `Editar` y leer los cinco valores. |
| **Esperado** | 2: `#titulo` = `Editar QA-INV-2026 Filtro aire`; los cinco campos traen los valores del artículo, incluido `#c_sku` con `a.sku ?? ''`. 3: `PATCH /api/items/<id>` con **los cinco campos**, no solo el cambiado, porque `abrirEdicion` manda el formulario completo (`public/app.js:265-277`). `200` con la fila actualizada. 4: los valores del artículo, con `13500` crudo en `#c_priceCents` mientras la tabla muestra `$ 135`: el input muestra centavos y la tabla muestra pesos (ver `R-07`). No hay mensaje de éxito en ningún paso. |

| | |
|---|---|
| **ID** | INV-ART-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/items` con `{"name":"X","emial":"a@b.cl"}`.<br>2. `POST /api/items` con `{"name":"X","organizationId":"org_otra","organization_id":"org_otra"}`.<br>3. `POST /api/items` con `{"name":"X","createdAt":"2020-01-01T00:00:00.000Z","archivedAt":null}`.<br>4. `PATCH /api/items/<id>` con `{"name":"QA-INV-2026 ok","quantity":1,"createdAt":"2020-01-01T00:00:00.000Z"}`. |
| **Esperado** | 1: `400 {"error":"Campo desconocido: emial. Revisa el nombre; si esta bien escrito, no lo mandes."}` con el `flatten()` de Zod en `errors`: el `strict()` del `crudRouter` prefiere nombrar el campo sobrante antes que descartarlo en silencio. 2: `400` con el mensaje que nombra **`organization_`**: `organizationId` existe en el schema (es un campo declarado, así que no es «desconocido») pero `organization_id` es la clave real de la base y no existe en el shape. Confirmar que el artículo con trampa **no** aparece en la otra organización. 3: `400` por `createdAt` y `archivedAt`, que son de solo lectura por construcción (no están en `fields`) — el mensaje nombra la primera clave sobrante. 4: también `400`, y por dos motivos a la vez; el `400` es el mismo. Ninguno de los cuatro devuelve `201`. |

| | |
|---|---|
| **ID** | INV-ART-12 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Un artículo con movimientos y `quantity` distinto de 0. |
| **Pasos** | 1. Pulsar `Baja` en su fila y **cancelar** el `confirm`.<br>2. Volver a pulsar `Baja` y aceptar.<br>3. Leer Network, `#filas` y `GET /api/items`.<br>4. `GET /api/movements?itemId=<id dado de baja>`. |
| **Esperado** | 1: aparece el `confirm` con el texto `¿Dar de baja QA-INV-2026 Filtro aire? Se conserva el historial.`; al cancelar no sale ninguna petición. 2: `DELETE /api/items/<id>` `200 {"ok":true,"archived":true}` (`crud.ts:317`): **no borra, marca `archived_at`**. El diálogo nativo es `confirm`/`alert` del navegador, no `#error` ni un aviso propio (`public/app.js:294-302`). 3: la fila desaparece de `#filas` y `GET /api/items` deja de devolverlo, con `total` abajo en 1. No hay mensaje de confirmación. 4: los movimientos **siguen ahí**, con su `itemName` resuelto: si se perdieran, el stock dejaría de ser explicable. Un `DELETE` duro tiraría la cascada `movements.item_id ON DELETE CASCADE` y con ella toda la historia de las salidas (ver `INV-STK-06` para lo que sí sigue permitido hacer con un artículo dado de baja). |

| | |
|---|---|
| **ID** | INV-ART-13 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `member` y sesión `admin`. |
| **Pasos** | 1. Con `member`, abrir `?panel=articulos` y anotar qué botones quedan visibles en las filas.<br>2. Con `member`, pulsar el que quede y leer Network y `#error`.<br>3. Con `admin`, abrir `Editar` en un artículo y comprobar que `#c_name`, `#c_sku`, `#c_minQuantity`, `#c_unit` y `#c_priceCents` son editables.<br>4. Con `member`, `POST /api/items` y `PATCH /api/items/<id>`. |
| **Esperado** | 1: con `member`, `puedeMover` es falso (`public/app.js:64`), así que todos los `[data-requiere-admin]` se ocultan. Pero la marca se pone sobre `acciones.firstChild`, que es el botón **`Editar`**: el resultado esperado es que `Editar` desaparezca y **`Mover` y `Baja` sigan a la vista**, aunque las dos rutas que llaman exigen `admin` (ver `R-01`, que es la hipótesis a confirmar). 2: al pulsar `Mover`, `POST /api/items/<id>/movements` responde `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` (`packages/auth-client/src/middleware.ts:203`) y `#error` muestra `rol-insuficiente`, sin nombre de campo. Con `Baja` el `403` sale por `alert()`, no por `#error`. 3: con `admin` los cinco campos son editables. 4: `201` y `200`: cargar y editar artículos es de `member` (`writeRole: 'member'`). |

| | |
|---|---|
| **ID** | INV-ART-14 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, `#dialogo` abierto con datos escritos. |
| **Pasos** | 1. Pulsar `Cancelar` (`value="cancelar"`).<br>2. Repetir con `Esc`.<br>3. Volver a abrir con `#nuevo` y leer `#c_name`, `#c_sku`, `#c_minQuantity`, `#c_unit`, `#c_priceCents`.<br>4. Provocar un `400` (por ejemplo, nombre de 151 caracteres) y ver si el diálogo reabre con `#error` visible y con los valores. |
| **Esperado** | 1 y 2: el `<dialog>` se cierra por `#dialogo.close()` implícito de `method="dialog"`; no sale ninguna petición. 3: los cinco campos se reconstruyen desde cero con los valores por defecto de los ajustes, porque `abrir()` reemplaza `#campos` con nodos nuevos: no queda rastro del intento anterior (a diferencia de los productos cuyo formulario vive en el HTML y no se resetea). 4: el diálogo reabre con `showModal()` y `#error` con el mensaje del `400`; los valores escritos siguen en los cinco campos, lo que permite corregir sin volver a tipear. `#error` se oculta solo cuando se abre otro diálogo (`mostrarError('')`). |

### 4.5 Búsqueda — `#buscar`, `?q=`

| | |
|---|---|
| **ID** | INV-BUS-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Artículos de la §2. |
| **Pasos** | 1. Escribir un fragmento de nombre, carácter por carácter, y contar las peticiones con un filtro de `fetch` en Network.<br>2. Esperar 600 ms después de la última tecla.<br>3. Borrar el contenido y esperar 600 ms. |
| **Esperado** | 1: sale **una sola** petición, no una por tecla: `#buscar` usa un `debounce` de `250 ms` con `clearTimeout` (`public/app.js:306-312`). La URL es `/api/items?q=<término>` con el término codificado y recortado con `trim()`. 2: `200 {"items":[…],"total":N,"limit":200,"offset":0}` y solo se repinta `#filas`. 3: `GET /api/items?q=` con `q` vacío devuelve la lista completa sin filtro: `q` vacío es falsy y no agrega el `LIKE` (`crud.ts:205-210`). Es la misma URL que pide la carga inicial. |

| | |
|---|---|
| **ID** | INV-BUS-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Artículos de la §2, incluidos los del catálogo de ejemplo si se sembraron. |
| **Pasos** | 1. `GET /api/items?q=Filtro`.<br>2. `GET /api/items?q=QA-INV-FA` (buscar por SKU).<br>3. `GET /api/items?q=ACE-530`.<br>4. `GET /api/items?q=ACEITE` y luego `GET /api/items?q=articulo`. |
| **Esperado** | 1 y 2: la búsqueda cubre `name` **y** `sku` (`search: [items.name, items.sku]`, `src/routes.ts:306`), con `LIKE '%término%'`, así que `Filtro` encuentra tanto `Filtro de aire` como `Filtro de aceite`, y `QA-INV-FA` encuentra por SKU aunque el nombre no lo contenga. `total` baja al conteo filtrado. 3: encuentra el artículo por su SKU exacto. 4: `ACEITE` **sí** encuentra `Aceite hidráulico 5W-30 1L` y `articulo` **no** encuentra `Artículo`: el `LIKE` de SQLite ignora mayúsculas solo para ASCII, así que las tildes y ñ no se igualan (ver `R-17`). El `placeholder` de `#buscar` dice `Buscar por nombre o SKU`, que es exactamente el alcance. |

| | |
|---|---|
| **ID** | INV-BUS-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Al menos 6 artículos. |
| **Pasos** | 1. Escribir `QA-INV-2026 Guante` en `#buscar` y esperar el repintado.<br>2. Sin tocar `#buscar`, ir a `?panel=configuracion`, cambiar `defaultUnit` y pulsar `Guardar cambios`.<br>3. Volver a `?panel=articulos` y contar las filas de `#filas`.<br>4. Comparar `#resumen` con lo que hay en la tabla. |
| **Esperado** | 3: `#filas` **sigue mostrando solo el artículo que coincidía**: `cargar()` vuelve a pedir `/api/items?q=` con el valor que hay en `#buscar` (`public/app.js:41`), así que el filtro sobrevive a cualquier cambio. 4: `#resumen` cuenta **todos** los artículos de la organización, no los filtrados: el tablero dice `Artículos: 6` mientras la tabla muestra 1. No hay ningún aviso de que la vista esté filtrada, y la única pista es el texto del propio `#buscar`. Vaciar el campo y guardar de nuevo devuelve la lista completa (ver `R-13`). |

| | |
|---|---|
| **ID** | INV-BUS-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Artículos con `unit` distinta y con `active: false`. |
| **Pasos** | 1. `GET /api/items?unit=pieza`.<br>2. `GET /api/items?active=false`.<br>3. `GET /api/items?archived=true`.<br>4. `GET /api/items?precioCents=12000`. |
| **Esperado** | Los cuatro responden `200` con **todos** los artículos, sin error y sin filtrar. El `crudRouter` solo aplica los filtros que el producto declara en `filters`, e Inventario **no declara ninguno** (`src/routes.ts:299-326`), así que un parámetro desconocido se ignora en silencio: la pantalla parece filtrada mientras muestra todo. Es el peor tipo de fallo según el propio comentario de `crud.ts:88-95`, y acá se da por la puerta de atrás. `active` y `archived` tampoco filtran (ver `INV-RES-04` y `INV-STK-06`). |

### 4.6 Movimientos — `POST /api/items/:id/movements` y `GET /api/movements`

El diálogo se arma en runtime (`public/app.js:279-292`): `#titulo` = `Mover stock de <nombre>`,
`#c_delta` con el rótulo **exactamente** `Cantidad (negativa para salir)`, `type=number`,
`step=1`, `required`, **sin `min`** (por eso acepta negativos), y `#c_reason` con el rótulo
`Motivo`, `required`. No hay ningún select de tipo de movimiento.

| | |
|---|---|
| **ID** | INV-MOV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`, `QA-INV-2026 Filtro aire` con `quantity: 0`. |
| **Pasos** | 1. Pulsar `Mover` en su fila.<br>2. Enumerar los `input` de `#campos` con `id`, `name`, `type`, `required`, `step` y `min`.<br>3. Escribir `20` en `#c_delta` y `Recepción de proveedor` en `#c_reason`.<br>4. Pulsar `Guardar`.<br>5. Leer Network, la fila del artículo y `#movimientos` desde `?panel=movimientos`. |
| **Esperado** | 2: dos campos, `#c_delta` y `#c_reason`, ambos `required`; `#c_delta` es `number` con `step="1"` y **sin atributo `min`**, así que el navegador no bloquea los negativos. `#titulo` = `Mover stock de QA-INV-2026 Filtro aire`. 4: `POST /api/items/<id>/movements` con cuerpo `{"delta":20,"reason":"Recepción de proveedor"}` — el `delta` sí se convierte con `Number()` antes de mandarse (`public/app.js:289`), a diferencia de los campos del formulario de artículo. Respuesta `201 {"movement":{…},"quantity":20}`. El diálogo se cierra y `cargar()` repinta las tres cosas. 5: `Stock` pasa a `20`; en `#movimientos` aparece una fila con `Delta` = `+20` en etiqueta verde (`ui-etiqueta--ok`), `Artículo` = `QA-INV-2026 Filtro aire`, `Motivo` = `Recepción de proveedor`, `Quién` = el nombre de la sesión y `Cuándo` = fecha y hora. **No hay aviso de éxito**: no existe `#aviso` en el HTML. |

| | |
|---|---|
| **ID** | INV-MOV-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `QA-INV-2026 Filtro aire` con `quantity: 0`. |
| **Pasos** | 1. Desde el diálogo, mandar `delta: 30` con motivo `Compra`.<br>2. Repetir con `delta: -12` y motivo `Taller`.<br>3. Repetir con `delta: -8` y motivo `Venta al mostrador`.<br>4. Leer `GET /api/items/<id>` y `GET /api/movements?itemId=<id>` y sumar los `delta`. |
| **Esperado** | 1: `201`, `quantity: 30`. 2: `201`, `quantity: 18`. 3: `201`, `quantity: 10`. 4: **`quantity` es exactamente la suma de los `delta`**: 30 − 12 − 8 = 10. El signo del `delta` es el único tipo de movimiento que hay; no hay campo ni columna que diga entrada o salida. En `#movimientos` las tres filas salen en orden inverso al alta (la más reciente primero) con `+30` en verde y `−12` / `−8` en rojo, sin el `+` en los negativos. Hay un test que vigila esta igualdad (`tests/inventario.test.ts:370-386`). |

| | |
|---|---|
| **ID** | INV-MOV-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Un artículo con `quantity: 10`. |
| **Pasos** | 1. `POST /api/items/<id>/movements` con `{"delta": -50, "reason": "Error de tipeo"}`.<br>2. `GET /api/items/<id>` y leer `quantity`.<br>3. `GET /api/movements?itemId=<id>` y contar las filas.<br>4. Repetir el paso 1 desde el diálogo con `delta: -11` sobre el mismo artículo. |
| **Esperado** | 1: `400` con `{"error":"No hay stock suficiente: hay 10 <unidad> y el movimiento pide 50"}` (`src/routes.ts:196-201`), con el nombre de la unidad del artículo interpolado. 2: `quantity` sigue en `10`. 3: el historial **no** creció: la comprobación va antes de la transacción, así que no queda un movimiento sin efecto. 4: el mensaje sale en `#error` dentro del diálogo, que reabre con `showModal()` y el `delta` escrito; la cantidad no se toca. Este rejections es una decisión explícita del producto, distinta del legacy que recortaba en cero y dejaba la historia descuadrada. |

| | |
|---|---|
| **ID** | INV-MOV-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `QA-INV-2026 Bujía` (`minQuantity: 20`, `quantity: 0`). |
| **Pasos** | 1. `POST /api/items/<id>/movements` con `{"delta": 0, "reason": "Nada"}`.<br>2. Con `{"delta": "5", "reason": "Como texto"}`.<br>3. Con `{"delta": 1.5, "reason": "Fraccion"}`.<br>4. Con `{"delta": "abc", "reason": "No es numero"}`.<br>5. Con `{"delta": 5}` (sin `reason`).<br>6. Con `{"delta": 5, "reason": "   "}`.<br>7. Con `{"delta": 5, "reason": <201 caracteres>}`. |
| **Esperado** | Todos `400 Datos inválidos`, con `errors.fieldErrors` poblado. 1: `delta` = `El delta no puede ser cero: usá un motivo, no un movimiento nulo` (`src/routes.ts:42`). 2: `201`, el string se coercea a número. 3: `delta` con el error de entero. 4: `delta` con error de tipo. 5 y 6: `reason` = `El motivo es obligatorio: sin él el stock no se puede explicar`; en el 6 el `trim()` deja la cadena vacía. 7: `reason` con el error de largo (máximo 200). Los casos 5 a 7 los ejecuta la UI con `required`, pero el texto de `400` es el que ve quien lo intente por API. |

| | |
|---|---|
| **ID** | INV-MOV-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `member` y sesión `admin`. |
| **Pasos** | 1. Con `member`, `POST /api/items/<id>/movements` con `{"delta":1,"reason":"Me emocioné"}`.<br>2. Con `member`, comprobar qué botón queda visible en la fila y pulsarlo.<br>3. Con `admin`, `owner` si existe: repetir el paso 1 con `owner`. |
| **Esperado** | 1: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`. Mover stock es una decisión de negocio, no del día a día (`src/routes.ts:178-180`). 2: el `403` llega a `#error` con el texto crudo `rol-insuficiente`, que no dice quién falta ni cuál era el rol; y el botón sigue visible (ver `R-01`). 3: `owner` responde `201`: los tres roles pasan el mismo mínimo. La UI esconde los `[data-requiere-admin]` para todo lo que no sea `admin` u `owner`. |

| | |
|---|---|
| **ID** | INV-MOV-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. `POST /api/items/item_inexistente/movements` con `{"delta":1,"reason":"X"}`.<br>2. Con un id de artículo de **otra** organización (conseguido en `INV-SIST-05`), repetir.<br>3. Repetir con un artículo **archivado** de la propia organización. |
| **Esperado** | 1: `404 {"error":"Artículo no encontrado"}` — el mensaje del producto, distinto del `No encontrado` genérico del `crudRouter` (ver `R-16`). 2: también `404` con el mismo texto: la búsqueda es por `id` **y** organización, así que el 404 no confirma que el id exista en otra empresa. 3: **`201`**: la comprobación de existencia no mira `archived_at` (`src/routes.ts:185-190`), así que un artículo dado de baja sigue admitiendo movimientos que cambian su stock y el KPI `Movimientos` sin aparecer en la tabla (ver `R-03`). |

| | |
|---|---|
| **ID** | INV-MOV-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Al menos 3 movimientos en dos artículos distintos. |
| **Pasos** | 1. `GET /api/movements` y enumerar las claves del cuerpo y de `movements[0]`.<br>2. Comparar el orden con el de las altas.<br>3. `GET /api/movements?limit=0` y `?limit=9999`.<br>4. Comprobar si el cuerpo trae `total`. |
| **Esperado** | 1: `200 {"movements":[…]}`, **no** el contrato `{items,total,limit,offset}` del `crudRouter`: esta ruta es propia. Cada fila trae `id` con prefijo `mov_`, `organizationId`, `itemId`, `delta`, `reason`, `actorUserId`, `actorName`, `createdAt` y además **`itemName`**, que no está en la base: se resuelve en una segunda consulta con un `IN` sobre los ids de la página (`src/routes.ts:150-159`), no una consulta por movimiento. 2: descendente por `createdAt` y luego por `id`, o sea el más reciente primero. 3: `limit=0` cae a `100` y `limit=9999` se recorta a `500` (`Math.min(Math.max(n \|\| 100, 1), 500)`). 4: **no hay `total`**: la interfaz no puede saber si hay más de los que ve (ver `R-08`). |

| | |
|---|---|
| **ID** | INV-MOV-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un artículo con una entrada y una salida. |
| **Pasos** | 1. `GET /api/movements?itemId=<id>&type=in`.<br>2. `GET /api/movements?itemId=<id>&type=out`.<br>3. `GET /api/movements?type=IN` y `?type=salidas`.<br>4. `GET /api/movements?itemId=` (vacío). |
| **Esperado** | 1: solo los de `delta > 0`. 2: solo los de `delta < 0`. 3: ambos ignoran el filtro en silencio y devuelven la lista completa: la comparación es `req.query.type === 'in'` exacta, así que `IN` en mayúscula y `salidas` no filtran nada y no hay `400` que avise (mismo problema que `INV-BUS-04`). 4: sin filtro de `itemId`, porque la condición es `typeof … === 'string' && req.query.itemId`; devuelve los movimientos de todos los artículos. La UI **no usa ninguno de estos parámetros**: pide `/api/movements?limit=40` pelado, así que el filtro por artículo y por signo solo se alcanza por API. |

| | |
|---|---|
| **ID** | INV-MOV-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin` con nombre y correo conocidos. |
| **Pasos** | 1. Registrar un movimiento y leer `actorUserId` y `actorName` de la fila devuelta.<br>2. Comparar con `GET /api/me`.<br>3. Entrar con otra persona de la misma organización, mover stock y volver a leer las dos columnas.<br>4. Entrar con una persona de otra organización y comprobar si aparece algún movimiento de la anterior. |
| **Esperado** | 1: los dos campos vienen de `req.amg`: `actorUserId` es el id del Core y `actorName` una **foto** del nombre en el momento del movimiento (`src/routes.ts:203,216-221`). 2: coinciden con `user.id` y `user.name` de `/api/me`. 3: el segundo movimiento lleva el nombre del segundo usuario: el historial se lee sin llamar al Core en cada listado, y sigue legible si después se renombra o se da de baja la persona. 4: la lista no muestra movimientos de otra organización en ningún caso (ver `INV-SIST-05`). |

| | |
|---|---|
| **ID** | INV-MOV-10 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | `?panel=movimientos` con al menos un movimiento de entrada, uno de salida y uno sin autor. |
| **Pasos** | 1. Comparar los encabezados de `#movimientos` con el contenido de las celdas.<br>2. Leer la columna `Delta` de las tres filas.<br>3. Buscar una fila sin `actorName` y otra cuyo `itemName` no se resuelva.<br>4. Contar las filas con más de 40 movimientos en la organización. |
| **Esperado** | 1: los encabezados son `Delta` (`.num`), `Artículo`, `Motivo`, `Quién`, `Cuándo`. 2: los positivos llevan el `+` adelante y la clase `ui-etiqueta--ok`; los negativos llevan el signo menos, **sin** `+`, y la clase `ui-etiqueta--malo`. Un `delta` de 0 es imposible por el `refine`, así que la clase roja nunca aparece por un cero. 3: sin `actorName` la celda muestra `—`; sin `itemName` (artículo borrado de verdad) muestra `—` en `Artículo`. La columna `Cuándo` usa `AMIGO_UI.fecha(iso, true)` **sin el tercer argumento**, o sea en la zona horaria del navegador y sin indicar cuál es. 4: con más de 40 movimientos la tabla muestra 40 y no hay paginador ni aviso; el rótulo `Los 40 más recientes` (`public/index.html:98`) es lo único que lo delata. |

| | |
|---|---|
| **ID** | INV-MOV-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un artículo con `quantity: 5`. |
| **Pasos** | 1. Con la UI abierta en Network, mandar un movimiento válido y contar las peticiones que salen.<br>2. Identificar cuáles son y en qué orden.<br>3. Hacer lo mismo tras dar de baja un artículo desde `#nuevo`… no: desde el botón `Baja`. |
| **Esperado** | 1: de una acción salen **5 peticiones**, no una: al cerrar el diálogo con `returnValue === 'guardar'`, `abrir()` llama a `onGuardar(datos)` y después a `cargar()` (`public/app.js:231-243`), que rehace el `Promise.all` completo. 2: el `POST` del movimiento y luego `GET /api/me`, `/api/resumen`, `/api/items?q=`, `/api/movements?limit=40` y `/api/settings`. 3: lo mismo con el `DELETE`: 6 peticiones. Con una organización con muchos artículos y una sesión compartida, esta repetición es la que más rápido agota el límite de 600/15 min (convención 5.4). |

| | |
|---|---|
| **ID** | INV-MOV-12 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión `admin`, artículo con `quantity: 10`. |
| **Pasos** | 1. Mandar dos movimientos en paralelo desde la consola con dos `fetch` a la vez sobre el mismo artículo.<br>2. Repetir con `-6` y `-6` sobre un artículo con `quantity: 10`.<br>3. Leer `GET /api/items/<id>` y `GET /api/movements?itemId=<id>`. |
| **Esperado** | La actualización de `quantity` y el insert del movimiento están en la misma transacción de SQLite (`src/routes.ts:204-226`), así que nunca queda stock movido sin asiento. 2: el `400 No hay stock suficiente` que se espere depende del orden de confirmación: si ambos leen `quantity: 10` antes de que el otro escriba, los dos pasan el chequeo y uno termina con `quantity: -2`. Verificar si el `UPDATE` condicionado por el valor leído evita el negativo; si aparece `quantity` negativo, es un defecto de concurrencia y hay que anotarlo como hallazgo. *Sospechado por la forma de la transacción: el `UPDATE` va por `eq(items.id, item.id)` y no por el `quantity` esperado, así que la hipótesis más probable es que sí se pueda.* 3: en el caso correcto, `quantity` es 10 − 6 = 4 y hay un solo asiento nuevo. |

### 4.7 Stock derivado

| | |
|---|---|
| **ID** | INV-STK-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`, un artículo nuevo. |
| **Pasos** | 1. `POST /api/items` y leer `quantity`.<br>2. Intentar escribir la cantidad por cualquiera de las tres vías: `POST` con `quantity`, `PATCH` con `quantity`, y el formulario de la UI.<br>3. Enumerar los `input` de `#campos` al abrir `#nuevo` y al abrir `Editar`, y confirmar que ninguno es la cantidad. |
| **Esperado** | 1: `201` con `quantity: 0`, aunque el cuerpo no la mande: `quantity` es `{ readonly: true }` (`src/routes.ts:319`) y la base la inicializa en 0 (`ddl.ts:18`). 2: `POST` y `PATCH` con `quantity` dan `400 Campo desconocido: quantity` (ver `INV-ART-09`); por la UI **no hay forma**, porque el formulario de artículo tiene cinco campos y ninguno es la cantidad. 3: cinco ids (`c_name`, `c_sku`, `c_minQuantity`, `c_unit`, `c_priceCents`) en ambos diálogos. La cantidad de stock no es un campo: es la suma de los movimientos, y por eso no se edita. |

| | |
|---|---|
| **ID** | INV-STK-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. Crear un artículo y hacer tres movimientos: `+40`, `−15`, `−9`.<br>2. Leer `GET /api/items/<id>.quantity`.<br>3. Leer `GET /api/movements?itemId=<id>` y sumar los `delta` a mano.<br>4. Repetir la comparación con los artículos de la §2, que tienen `quantity` de salida y ningún movimiento. |
| **Esperado** | 3 = 2: 40 − 15 − 9 = 16, y `quantity` es exactamente eso. 4: los artículos con cantidad y sin movimientos **no** cuadran con esa suma, y no es un defecto: el stock inicial se escribe directo en la fila, como stock de apertura, sin asiento. Solo los cambios posteriores son explicables por movimientos. Esa asimetría es real y hay que comprobarla: es lo que hace que `INV-RES-05` (los movimientos de un artículo dado de baja sigan contando) tenga sentido. |

| | |
|---|---|
| **ID** | INV-STK-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`, artículo con `quantity: 3`. |
| **Pasos** | 1. Mandar `POST /api/items/<id>/movements` con `{"delta":-3,"reason":"Venta"}` y después uno con `{"delta":-1,"reason":"Otra venta"}`.<br>2. Entre medio, provocar un `400` mandando `delta: 0`.<br>3. Al final, leer `quantity`, el historial y `/api/resumen`. |
| **Esperado** | 1: el primer movimiento deja `quantity: 0` y se acepta (el cero es un resultado válido: `siguiente < 0` es la única condición de rechazo, `src/routes.ts:195-196`). El segundo da `400 No hay stock suficiente: hay 0 <unidad> y el movimiento pide 1`. 2: el `delta: 0` no deja rastro. 3: `quantity: 0`, un solo movimiento nuevo en el historial, y `GET /api/resumen` con `unidades` reducido en 3 y `valorCents` en `3 * priceCents`. Con `minQuantity` en 0 o más, el artículo pasa a estar en stock bajo y aparece la quinta tarjeta. |

| | |
|---|---|
| **ID** | INV-STK-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Un artículo con `quantity: 0` y `minQuantity: 0`. |
| **Pasos** | 1. `GET /api/items/low-stock` y enumerar las claves del cuerpo.<br>2. Comparar la lista con `#filas` y con la quinta tarjeta de `#resumen`.<br>3. Poner `minQuantity: 5` en el artículo y repetir la lectura.<br>4. Crear por API un artículo con `active: false` y `quantity: 0`, y repetir.<br>5. Intentar `GET /api/items/low-stock` con un `id` inexistente pegado al path: `GET /api/items/low-stock/x`. |
| **Esperado** | 1: `200 {"items":[…]}`, con la fila completa del artículo y su `quantity`. El criterio es `quantity <= minQuantity` **y** `active = true` **y** `archivedAt IS NULL`, ordenado por `name` (`src/routes.ts:70-84`). 2: la lista coincide con la quinta tarjeta en cantidad y en identidad. 3: con `quantity: 0 <= 5` el artículo entra; 4: el de `active: false` no aparece, aunque `quantity <= minQuantity`. 5: `404` con el texto del `notFound` del runtime, `No existe GET /api/items/low-stock/x`. Lo importante del caso es el paso 1: la ruta está registrada **antes** del `crudRouter` (`src/routes.ts:63-67`), así que `low-stock` no se interpreta como un `id`. Si alguien mueve ese registro después del `router.use('/api/items', …)`, esta ruta pasa a devolver `404 No encontrado` sin que nada más se rompa: es el modo de fallo silencioso que el comentario del propio código previene. |

| | |
|---|---|
| **ID** | INV-STK-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`, un artículo. |
| **Pasos** | 1. Mandar un movimiento que vaya a ser rechazado por stock insuficiente.<br>2. Inmediatamente, `GET /api/items/<id>` y `GET /api/movements?itemId=<id>`.<br>3. Con otro artículo, mandar un movimiento válido y comparar.<br>4. Forzar un fallo a mitad del `INSERT` (por ejemplo, con un `reason` de 201 caracteres en una versión anterior del código) y ver si el `quantity` queda cambiado. |
| **Esperado** | 2: `quantity` intacto y el historial sin la fila del movimiento rechazado. La comprobación de stock se hace **fuera** de la transacción, y la actualización y el `INSERT` van **dentro** (`src/routes.ts:195-226`): o se actualiza la cantidad y se guarda el movimiento, o no se toca nada. 3: en el caso válido, `quantity` cambia y aparece el asiento. 4: sin cambio de `quantity`, porque la transacción se revierte entera. Verificar también que el mensaje de rechazo no filtra la existencia de un artículo de otra organización: para eso está `INV-MOV-06`. |

| | |
|---|---|
| **ID** | INV-STK-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Un artículo con stock, y otro ya dado de baja. |
| **Pasos** | 1. `DELETE /api/items/<id>` del primero y anotar la respuesta.<br>2. `POST /api/items/<id>/movements` con `{"delta":5,"reason":"Entrada posterior a la baja"}`.<br>3. `GET /api/items` y `GET /api/items/<id>`.<br>4. `GET /api/resumen` y anotar `items`, `unidades` y `movimientos`. |
| **Esperado** | 1: `200 {"ok":true,"archived":true}`. 2: **`201`**: el artículo archivado sigue admitiendo movimientos, porque la comprobación de existencia filtra por `id` y organización y **no** excluye `archived_at` (`src/routes.ts:185-190`). 3: el artículo no está en la lista, pero `GET /api/items/<id>` sí lo devuelve, con el `quantity` ya aumentado. 4: `items` no lo cuenta, `unidades` tampoco, y `movimientos` **sí** cuenta el nuevo: una operación que no se ve en ninguna pantalla cambia una cifra del tablero (ver `R-03`). La comparación con `archived_at` como bandera de interfaz está en `INV-ART-12`. |

| | |
|---|---|
| **ID** | INV-STK-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`, un artículo con `priceCents: 12000`. |
| **Pasos** | 1. Ponerlo en `quantity: 4` con movimientos y leer `GET /api/resumen`.<br>2. Cambiar su `priceCents` a `15000` por `PATCH` y releer `GET /api/resumen`.<br>3. Dar de baja otro artículo con existencias y releer `GET /api/resumen`. |
| **Esperado** | 1: `valorCents` incluye `4 * 12000 = 48000` del artículo, y `unidades` suma 4. El valor se calcula con `sum(quantity * priceCents)` en SQL (`src/routes.ts:99`), no en JavaScript. 2: el valor del stock cambia **sin ningún movimiento**: revaluación, no entrada. Es la respuesta correcta para un cambio de precio, y conviene dejar constancia de que el tablero se mueve sin asiento. 3: `unidades` y `valorCents` bajan porque el resumen excluye archivados; `movimientos` no baja (ver `INV-RES-05`). |

### 4.8 Unidad y SKU — lo más parecido a una categoría

Inventario **no tiene categorías**: no hay tabla, ni columna, ni filtro. Los dos únicos atributos
que agrupan algo son `unit` (texto libre) y `sku` (texto libre, no único).

| | |
|---|---|
| **ID** | INV-CAT-01 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Enumerar las columnas de `GET /api/items` y de la tabla de `#filas`.<br>2. Buscar `categoria`, `category`, `familia`, `rubro` o `tipo` en `src/schema.ts`, `src/routes.ts` y `public/`.<br>3. Buscar en el `GET /api/items` un parámetro que las agrupe. |
| **Esperado** | 1: los atributos son exactamente `name`, `sku`, `quantity`, `minQuantity`, `unit`, `priceCents`, `active`. 2: **no existe nada parecido a una categoría** en ninguna capa: el esquema tiene tres tablas y ninguna columna de clasificación. 3: no hay ningún parámetro que agrupe ni que filtre por `unit`. La ausencia es una decisión de diseño del producto, no un hueco de la UI: se anota como alcance, no como defecto, pero significa que no hay forma de ver «todo lo que se mide en caja» ni de tener un conteo por familia. La ausencia de UI para algo que la API tampoco tiene no es un hallazgo; lo es que `unit` sea el sustituto improvisado (casos siguientes). |

| | |
|---|---|
| **ID** | INV-CAT-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. `POST /api/items` tres veces con la misma `unit` escrita como `pieza`, `Piezas` y `PZA`.<br>2. Leer `GET /api/items` y ver las tres filas.<br>3. `GET /api/items?q=PIEZAS`.<br>4. `POST /api/items` con `unit` de 31 caracteres y luego con `unit: ""`. |
| **Esperado** | 1: los tres `201`. 2: `GET /api/items` trae las tres filas con `unit` distinta, y la tabla muestra tres textos distintos en `Unidad`: no hay catálogo, ni normalización de mayúsculas, ni validación contra una lista, ni unicidad. `pieza` y `Piezas` son dos unidades a efectos de cualquier conteo manual. 3: **no** encuentra ninguna: `q` solo cubre `name` y `sku`, nunca `unit` (ver `INV-BUS-02`), así que no hay forma de buscar por unidad ni de contar por unidad. 4: 31 caracteres da `400 Datos inválidos` (`max(30)`); `unit: ""` da `201` con la unidad vacía, porque el schema es `z.string().trim().max(30).default('unidad')` y el default solo entra si la clave **está ausente** (`crud.ts:91-97`). Una unidad vacía es un valor legítimo en la base (ver `INV-CAT-03`). |

| | |
|---|---|
| **ID** | INV-CAT-03 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Un artículo con `unit: ""` y `quantity: 10`. |
| **Pasos** | 1. Crearlo por API con `unit: ""` y `#unit` vacío en el formulario.<br>2. Leer la celda `Unidad` de su fila en `#filas`.<br>3. `POST /api/items/<id>/movements` con `{"delta":-50,"reason":"Error"}`.<br>4. Repetir el alta desde la UI dejando `#c_unit` vacío y leer el `201`. |
| **Esperado** | 1: el `201` pasa por los dos caminos, porque `#c_unit` no es `required` y el schema no tiene `min(1)`. 2: la celda `Unidad` queda **vacía**, sin `—` como sí lo hace el `SKU` (`public/app.js:117`): la fila muestra `Nombre`, `SKU`, `Stock`, nada, `Precio`. 3: el mensaje queda con un doble espacio: `No hay stock suficiente: hay 10  y el movimiento pide 50`, porque la plantilla interpola `${item.unit}` sin condicional (`src/routes.ts:199`). 4: artículo guardado sin unidad. Un artículo sin unidad no se puede incluir en un informe de unidades ni detectar. |

| | |
|---|---|
| **ID** | INV-CAT-04 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. Crear dos artículos con el mismo `sku: "QA-INV-DUP"`.<br>2. `GET /api/items?q=QA-INV-DUP`.<br>3. Crear uno con `sku` de 61 caracteres y otro con `sku` vacío.<br>4. `GET /api/items?q=` con un `%` y con un `_`. |
| **Esperado** | 1: los dos `201`. 2: la búsqueda devuelve **los dos**: no hay índice único sobre `sku` en el DDL (`ddl.ts:13-29`), así que un SKU repetido es un hecho y no un error. Para un almacén eso es un problema de conteo físico, y el producto no lo avisa. 3: 61 caracteres da `400 Datos inválidos` (`max(60)`); `sku` vacío o ausente da `201`, y la tabla muestra `—`. O sea que el SKU es opcional en la base y único solo por convención. 4: `%` y `_` funcionan como comodines de `LIKE`: `?q=%` devuelve todos los artículos (incluidos los de otro `LIKE` encerrado en `%…%`) y `?q=_` devuelve todos los que tengan al menos un carácter. No hay escapado del comodín, así que buscar «50%» no encuentra lo que debería. |

### 4.9 Configuración — `?panel=configuracion`, `#config-form`

Los tres campos se leen por `name`, no por un objeto: `defaultUnit`, `defaultMinQuantity`,
`currency`. `renderConfig` recorre `form.elements` y solo copia los valores que existan en la
respuesta (`public/app.js:148-156`), así que agregar un campo al form lo guarda sin tocar código.

| | |
|---|---|
| **ID** | INV-AJUST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Organización sin fila en `settings`. |
| **Pasos** | 1. `GET /api/settings`.<br>2. Enumerar las claves del cuerpo.<br>3. Volver a pedirlo y comprobar que nada cambió.<br>4. Abrir `?panel=configuracion` y leer los tres campos. |
| **Esperado** | 1 y 2: `200` con un cuerpo **plano**, sin envoltorio: `{"defaultUnit":"unidad","defaultMinQuantity":0,"currency":"$","configured":false,"seedAvailable":true}`. Son los defaults de `defaultSettings()` (`src/routes.ts:53-57`), presentes aunque no haya fila guardada. `configured: false` dice que la organización nunca guardó nada. `seedAvailable` sale de `!ctx.config.isProd`, o sea `NODE_ENV !== 'production'`. 3: **leer no escribe**: repetir el `GET` no crea la fila, y eso es a propósito (`src/routes.ts:232-237`). 4: `#defaultUnit` = `unidad`, `#defaultMinQuantity` = `0`, `#currency` = `$`. Los tres son `required` en el HTML. |

| | |
|---|---|
| **ID** | INV-AJUST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`, `#config-form` visible. |
| **Pasos** | 1. Poner `#defaultUnit` = `caja`, `#defaultMinQuantity` = `5`, `#currency` = `US$`.<br>2. Pulsar `Guardar cambios`.<br>3. Leer Network y `GET /api/settings`.<br>4. Recargar la página y releer los tres campos. |
| **Esperado** | 2: `PUT /api/settings` con cuerpo `{"defaultUnit":"caja","defaultMinQuantity":5,"currency":"US$"}`, con el número ya convertido por `Number()` (`public/app.js:171`). Respuesta `200` con un cuerpo **plano** que es la fila completa: `id` con prefijo `set_`, `organizationId`, `defaultUnit`, `defaultMinQuantity`, `currency`, `createdAt`, `updatedAt` y `configured: true`. Ojo: la respuesta **no** incluye `seedAvailable`, a diferencia del `GET` (ver `R-14`). 3: los tres valores quedan guardados. 4: los tres campos muestran lo guardado, y la columna `Precio` y la tarjeta `Valor de stock` de `#resumen` ya salen con `US$`. El guardado se hace dentro de una transacción con un índice único por organización, así que guardar dos veces actualiza la fila y no agrega otra (`ddl.ts:55`, `src/routes.ts:268-292`). |

| | |
|---|---|
| **ID** | INV-AJUST-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=configuracion`, valores de INV-AJUST-02 guardados. |
| **Pasos** | 1. Ir a `?panel=articulos` y abrir `#nuevo`.<br>2. Leer `#c_unit` y `#c_minQuantity`.<br>3. Cambiar solo `#c_unit` a `unidad` en el diálogo y guardar el artículo.<br>4. Volver a abrir `#nuevo` y releer los dos valores. |
| **Esperado** | 2: `#c_unit` = `caja` y `#c_minQuantity` = `5`: los valores por defecto salen de `estado.settings` al abrir el diálogo (`public/app.js:253-259`), no de constantes. 3: el artículo se guarda con `unit: "unidad"`: los defaults solo prellenan el formulario, no se reescriben al guardar. 4: los defaults vuelven a ser los de los ajustes, no los del artículo anterior. `#c_priceCents` **siempre** nace en `0`, sin ningún ajuste que lo gobierne. Este caso es el que separa «los ajustes son del formulario» de «los ajustes son del modelo». |

| | |
|---|---|
| **ID** | INV-AJUST-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. `PUT /api/settings` con `{"defaultUnit": "", "defaultMinQuantity": 0, "currency": "$"}`.<br>2. Con `{"defaultUnit":"unidad","defaultMinQuantity": -1,"currency":"$"}`.<br>3. Con `{"defaultUnit":"unidad","defaultMinQuantity":0,"currency":""}`.<br>4. Con `defaultUnit` de 31 caracteres y `currency` de 6.<br>5. Con `{}`.<br>6. Repetir el 4 desde el formulario y leer `[data-err]`. |
| **Esperado** | Todos `400 Datos inválidos` con `errors.fieldErrors`: `defaultUnit` (mínimo 1, máximo 30), `defaultMinQuantity` (`z.coerce.number().int().min(0).max(1_000_000)`), `currency` (mínimo 1, máximo 5). 5: con `{}` aparecen los tres `fieldErrors` a la vez, porque los tres son obligatorios: `settingsSchema` no tiene `.optional()` ni defaults (`src/routes.ts:46-50`). **A diferencia del `crudRouter`, este schema no es `strict()`**: un campo desconocido se descarta en silencio en vez de dar `400 Campo desconocido`. 6: los `required` del HTML bloquean 1, 3 y 5 antes de la petición; el 4 sí sale, y el `400` se muestra en `[data-err]`, el `<p class="ui-error">` del propio form, **no** en `#error` (que es del diálogo de artículos). El botón `Guardar cambios` se rehabilita en el `finally` (`public/app.js:179-181`), así que no queda inutilizado tras un error. |

| | |
|---|---|
| **ID** | INV-AJUST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin` en la organización A, y sesión `admin` en la organización B sin configurar. |
| **Pasos** | 1. `PUT /api/settings` desde A con `{"organizationId":"<id de B>","defaultUnit":"caja","defaultMinQuantity":1,"currency":"$"}`.<br>2. Leer el `organizationId` de la respuesta.<br>3. `GET /api/settings` desde B.<br>4. `PUT /api/settings` desde B con sus propios valores y volver a pedir el de A. |
| **Esperado** | 1: `200`. 2: el `organizationId` devuelto es el de **A**, el de la sesión: el `PUT` no acepta `organizationId` en el cuerpo (el schema lo descarta) y siempre escribe en `orgId(req)`. Hay un test que lo fija (`tests/inventario.test.ts:141-152`). 3: B sigue con `configured: false` y los defaults, no con los que se quiso asignarle. 4: cada organización tiene las suyas y no se pisan: el índice único es por `organization_id`. Comprobado desde el `GET`, que filtra por organización. |

| | |
|---|---|
| **ID** | INV-AJUST-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `member` y sesión `admin`. |
| **Pasos** | 1. Con `member`, abrir `?panel=configuracion`.<br>2. Con `member`, `GET /api/settings`.<br>3. Con `member`, `PUT /api/settings` con `{"defaultUnit":"litro","defaultMinQuantity":0,"currency":"$"}`.<br>4. Con `member`, cambiar un valor en la UI y pulsar `Guardar cambios`.<br>5. Con `admin`, `GET /api/settings` después del paso 4. |
| **Esperado** | 1: `#sembrar` está oculto para `member` (lleva `data-requiere-admin`), pero los tres campos de `#config-form` se ven y se pueden escribir. 2: `200`, sin rol. 3: **`403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`**: `PUT /api/settings` es de `admin` (`src/routes.ts:262`). Un `member` lee la configuración pero no la cambia. 4: el `403` sale por `[data-err]` con el texto crudo `rol-insuficiente`, sin decir que es falta de permiso. 5: nada cambió. La UI no oculta los campos de `#config-form` por rol: los muestra a todo el mundo y deja que el `403` los reprima, que es el patrón que `10-regresion-compartida.md` §7 `R-S-05` señala como falta común de la suite. |

| | |
|---|---|
| **ID** | INV-AJUST-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`, `#config-form` con los valores de la §2. |
| **Pasos** | 1. Cambiar solo `#currency` a `€` y guardar.<br>2. Leer la columna `Precio` de `#filas` y la tarjeta `Valor de stock`.<br>3. Cambiar `#currency` a `123456` (6 caracteres) y guardar.<br>4. Cambiar `#defaultMinQuantity` a `1000001` por API y guardar. |
| **Esperado** | 2: **el símbolo de la moneda es organizacional y sale de los ajustes**, no de una constante: `pesos()` lee `estado.settings?.currency` con `$` por defecto (`public/app.js:28-31`). Todas las cifras de dinero del producto cambian, en la tabla y en el tablero. Ninguna otra vista muestra importes: no hay totales de venta ni de compra. 3: `400 Datos inválidos` en `currency` (`max(5)`); desde la UI el `maxlength="5"` del input lo impide antes de la petición. 4: `400` en `defaultMinQuantity` (`max(1_000_000`); el `max` del input no está declarado en el HTML, así que el navegador lo manda y el servidor lo rechaza. |

| | |
|---|---|
| **ID** | INV-AJUST-08 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión `admin`, `#config-form`. |
| **Pasos** | 1. Escribir un valor en `#defaultUnit` que no exista en el catálogo (por ejemplo `banana`) y guardar.<br>2. Abrir `#nuevo` y leer `#c_unit`.<br>3. Repetir el guardado sin tocar nada.<br>4. Cerrar y reabrir la pestaña de Ajustes. |
| **Esperado** | 2: `#c_unit` trae `banana`: la unidad por defecto es texto libre y no hay lista de unidades válidas en ninguna capa (ver `INV-CAT-02`). Es el mismo problema que `INV-CAT-02` visto desde la UI. 3: `PUT` `200` con los mismos valores y `configured: true`: guardar es idempotente y actualiza `updatedAt`. 4: los valores siguen, porque el `GET` los trae. No hay ningún mensaje de que se guardó: `[data-err]` solo se usa para errores y no hay aviso de éxito (ver `R-02`). |

| | |
|---|---|
| **ID** | INV-AJUST-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. Con los ajustes por defecto (`defaultUnit: 'unidad'`, `defaultMinQuantity: 0`, `currency: '$'`), `GET /api/settings`.<br>2. `PUT /api/settings` con `{"defaultUnit":"unidad","defaultMinQuantity":0,"currency":"$"}`.<br>3. `GET /api/settings` en una organización que nunca guardó nada.<br>4. Anotar qué tres campos gobiernan y qué no aparece en la API. |
| **Esperado** | 1: los defaults son exactamente esos tres, más `configured` y `seedAvailable`, y nada más. Inventario **no tiene ajustes de zona horaria, ni de formato, ni de umbral de stock bajo, ni de mensaje deReason**: el mínimo es por artículo. 2: los mismos valores devueltos con `configured: true`. 3: los defaults de nuevo, no los de la otra organización: el `GET` filtra por organización. 4: los únicos ajustes son `defaultUnit`, `defaultMinQuantity` y `currency`, más el indicador `configured` y el flag `seedAvailable`, que es de despliegue y no de configuración. Los tres formularios de ajustes de los nueve productos no tienen el mismo conjunto de campos, así que comparar de memoria entre productos no sirve: leer la API. |

### 4.10 Datos de ejemplo — `POST /api/seed`, `#sembrar`

| | |
|---|---|
| **ID** | INV-SEED-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Organización **vacía** (la segunda de la §2), `NODE_ENV=development`. |
| **Pasos** | 1. `GET /api/settings` y anotar `seedAvailable`.<br>2. Con `member`, `?panel=configuracion`: ¿está `#sembrar` a la vista?<br>3. Con `admin`, recargar `?panel=configuracion` y comprobar `#sembrar`.<br>4. Con `admin`, `POST /api/seed`.<br>5. Aceptar el `confirm` desde la UI en otra organización vacía. |
| **Esperado** | 1: `seedAvailable: true` con `NODE_ENV=development`. 2: oculto: `pintarMe` lo esconde porque `puedeMover` es falso. 3: visible, con el texto `Cargar datos de ejemplo`. 4: `200 {"creados":6}` (la clave `nota` **no** aparece: es `undefined` y `JSON.stringify` la omite). 5: aparece primero el `confirm` con el texto `Cargar artículos de ejemplo en esta organización?`; al cancelar no sale ninguna petición. Al aceptar, `cargar()` corre **antes** del `alert`, así que la tabla ya está repintada cuando aparece el mensaje `Se cargaron 6 artículos de ejemplo.` |

| | |
|---|---|
| **ID** | INV-SEED-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Organización vacía. |
| **Pasos** | 1. `POST /api/seed`.<br>2. `GET /api/items` y enumerar `name`, `sku`, `quantity`, `minQuantity`, `unit`, `priceCents` de cada fila.<br>3. Comparar el prefijo de los `id` con el de un artículo creado por la UI.<br>4. `GET /api/movements`. |
| **Esperado** | 2: los 6 artículos de la tabla de la §2, con esos SKU exactos (`ACE-530`, `FIL-AIR`, `FIL-OIL`, `BUJ-NGK`, `GUA-NIT`, `REF-134`), esas cantidades y esos precios; los 6 con `active: true` y sin `archivedAt`. Los nombres no llevan el prefijo `QA-INV-` y **no se pueden renombrar sin ensuciar la comparación**: si hay que limpiarlos, se da de baja con `DELETE /api/items/:id` y se anota. 3: **los ids del sembrado empiezan con `itm_` y los del `crudRouter` con `item_`** (`createId('itm')` en `src/seed.ts:38` contra `idPrefix: 'item'` en `src/routes.ts:303`). Cualquier caso que asuma el prefijo falla con los datos de ejemplo (ver `R-09`). 4: **vacío**: el sembrado escribe `quantity` directo en la fila, sin generar movimientos, así que el stock inicial es stock de apertura sin asiento (ver `INV-STK-02`). |

| | |
|---|---|
| **ID** | INV-SEED-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La organización del paso INV-SEED-02, ya con 6 artículos. |
| **Pasos** | 1. `POST /api/seed` otra vez.<br>2. `GET /api/items` y leer `total`.<br>3. Repetir el paso 1 desde la UI y leer el `alert`.<br>4. Dar de baja los 6 y volver a sembrar. |
| **Esperado** | 1: **`200 {"creados":0,"nota":"La organización ya tenía artículos"}`**, no `400` ni `409`. 2: `total` sigue en 6: **es todo o nada por organización**, la comprobación es un `count(*)` de artículos de esa organización y si hay uno solo no entra ninguno (`src/seed.ts:27-32`). No agrega, no completa, no pisa, no borra. 3: el `alert` muestra la `nota`, no un número: la UI elige entre el mensaje de éxito y la nota con `r.creados ? … : r.nota` (`public/app.js:189`). 4: como el conteo incluye los archivados, la baja **no** libera el sembrado: sigue necesitamos una organización sin un solo artículo, nunca usada. Es el motivo por el que `INV-SEED-01` pide una organización vacía y no la de trabajo. |

| | |
|---|---|
| **ID** | INV-SEED-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `member` y sesión `admin`; `NODE_ENV=development`. |
| **Pasos** | 1. Con `member`, `POST /api/seed`.<br>2. Con `member`, ¿aparece `#sembrar` en `?panel=configuracion`?<br>3. Con `owner`, `POST /api/seed`.<br>4. Con `admin`, `GET /api/settings` y anotar `seedAvailable` en los tres casos. |
| **Esperado** | 1: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` antes de mirar `isProd`: el chequeo de rol va primero (`src/routes.ts:337-343`). 2: oculto. 3: `owner` pasa (`201`… no, `200 {"creados":6}` o `{"creados":0,…}` según el estado). 4: `seedAvailable` **depende solo del entorno**, no del rol: es `true` para cualquier sesión. Es decir, el flag que la UI usa para esconder el botón no dice si la operación le va a ser permitida al usuario que la está mirando; eso lo resuelve el `[data-requiere-admin]`, y si ese falta, el `403` lo dice. |

| | |
|---|---|
| **ID** | INV-SEED-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Producto corriendo con `NODE_ENV=production` (copia aparte, no la de desarrollo) y sesión `admin`. |
| **Pasos** | 1. `GET /api/settings` y leer `seedAvailable`.<br>2. `?panel=configuracion`: ¿está `#sembrar`?<br>3. `POST /api/seed`.<br>4. Buscar una ruta que dé `404`: `POST /api/seed` con la RUTA bien escrita pero el método equivocado: `GET /api/seed`. |
| **Esperado** | 1: `seedAvailable: false`, porque es `!ctx.config.isProd` y `isProd` es `NODE_ENV === 'production'` (`packages/product-runtime/src/config.ts:38`). 2: oculto, y el botón no aparece ni deshabilitado. 3: `403 {"error":"Cargar artículos de ejemplo está disponible solo en desarrollo."}`. La ruta **está registrada igual** en producción y responde con un motivo, en vez de `404` (`src/routes.ts:328-336`): el `404` no diría si el botón andaba mal, si faltaban permisos o si la función estaba apagada a propósito. 4: `404` con el texto del `notFound` del runtime, `No existe GET /api/seed`. Es un `404` a propósito por método, no una ruta inexistente: marcarse como negativo explícito. |

| | |
|---|---|
| **ID** | INV-SEED-06 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Organización vacía, sesión `admin`. |
| **Pasos** | 1. Pulsar `#sembrar`, cancelar el `confirm`, y contar las peticiones.<br>2. Volver a pulsar y aceptar, mirando el orden de la respuesta y del `alert`.<br>3. Forzar un `403` (con `member` por API, o con el producto en producción) y ver cómo se lo cuenta la UI. |
| **Esperado** | 1: el `confirm` corta antes de cualquier `fetch`: cero peticiones. 2: `POST /api/seed`, después las 5 peticiones de `cargar()`, y recién entonces el `alert` con `Se cargaron 6 artículos de ejemplo.` — o sea que la tabla ya muestra los 6 cuando aparece el mensaje. 3: el error sale por `alert(e.message)` (`public/app.js:191`), o sea un `alert` del navegador y no el `[data-err]` del form ni `#error` del diálogo. El mismo producto muestra los errores de tres maneras distintas según la pantalla (ver `R-02`). |

### 4.11 Contrato de API y validaciones del `crudRouter`

| | |
|---|---|
| **ID** | INV-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/items` con `{"name":"QA-INV-2026 contrato","active":true}` y enumerar las claves de la respuesta.<br>2. Repetir con `active` ausente.<br>3. `PATCH /api/items/<id>` con `{"name":"QA-INV-2026 contrato 2"}` y enumerar las claves.<br>4. `GET /api/items/<id>`. |
| **Esperado** | 1 y 2: `201` con la fila **cruda, sin envoltorio** (`crud.ts:282`): `id`, `organizationId`, `name`, `sku`, `quantity`, `minQuantity`, `unit`, `priceCents`, `active`, `createdAt`, `updatedAt`, `archivedAt`. Con `active` ausente sale `true` por el default del campo; sin `sku` sale `null`; `quantity` en `0`; `unit` en `unidad`; `priceCents` en `0`; `updatedAt` en `null` y `archivedAt` en `null`. 3: `PATCH` es parcial: los campos que no se mandan no se tocan, aunque su schema tenga default — el default solo entra al crear (`crud.ts:107-114`). Los defaults no se reponen en un `PATCH`. 4: la misma forma. No hay `errors` en las respuestas exitosas. |

| | |
|---|---|
| **ID** | INV-API-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. `POST /api/items` con `{"name":"X","active":"false"}`.<br>2. Con `{"name":"X","active":"true"}`.<br>3. Con `{"name":"X","active":"1"}`.<br>4. Con `{"name":"X","active":"sí"}` y con `{"name":"X","active":"Si"}`.<br>5. Con `{"name":"X","active":"TRUE"}` y con `{"name":"X","active":"yes"}`.<br>6. Con `{"name":"X","active":1}` y con `{"name":"X","active":0}`. |
| **Esperado** | 1 y 2: `false` y `true`, porque el preprocesador traduce esas tres cadenas exactas. 3: `true`. 4 y 5: **`false`**, sin error: el preprocesador convierte en `false` cualquier cadena que no sea exactamente `"true"`, `"1"` o `"si"` (`src/routes.ts:31-34`), así que `"sí"` con tilde, `"Si"` y `"TRUE"` dejan el artículo desactivado en silencio. Quien mande `active` desde un formulario propio tiene tres formas de equivocarse sin ver un error (ver `R-06`). 6: **`400 Datos inválidos`**: el número no es string, así que el preprocesador lo deja pasar tal cual y `z.boolean()` lo rechaza. O sea que `active` acepta `"1"` pero no `1`: el comportamiento es el inverso de lo que espera cualquiera. En todos los casos, leer `active` en la respuesta para confirmar, no suponerlo. |

| | |
|---|---|
| **ID** | INV-API-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/items/item_inexistente`.<br>2. `PATCH /api/items/item_inexistente` con `{"name":"X"}`.<br>3. `DELETE /api/items/item_inexistente`.<br>4. `GET /api/items/low-stock`.<br>5. `POST /api/items` a un article inexistente… no: `POST /api/items/movements` sin `:id` de artículo. |
| **Esperado** | 1, 2 y 3: `404 {"error":"No encontrado"}` en los tres, y el mismo texto para un id que no existe y para uno de otra organización. **Es el mensaje genérico del `crudRouter`**, distinto del `Artículo no encontrado` de los movimientos (ver `R-16`). Nunca `403`: el `404` no confirma que el id exista en otra empresa. 4: `200 {"items":[…]}` y **no** `404 No encontrado`: la ruta está antes del `crudRouter` (ver `INV-STK-04`). 5: `404 No encontrado`, con el `movements` de `low-stock`… no aplica aquí: este caso sirve para confirmar que no hay `POST /api/items/:id` sin `movements`, y que un `PATCH` a un id ajeno devuelve `404` y no `200`. |

| | |
|---|---|
| **ID** | INV-API-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `member`. |
| **Pasos** | 1. `POST /api/items` con `{"name":"X"}`.<br>2. `PATCH /api/items/<id>` con `{"name":"Y"}`.<br>3. `DELETE /api/items/<id>`.<br>4. `GET /api/items`, `GET /api/items/:id`, `GET /api/movements`, `GET /api/resumen`, `GET /api/items/low-stock` y `GET /api/settings`. |
| **Esperado** | 1: `201`. 2: `200`. 3: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`. 4: las seis lecturas `200`: leer no exige rol. El corte está donde tiene que estar —crear y editar de `member`, dar de baja de `admin`— y es la política que la propia interfaz insinúa con `data-requiere-admin` (aunque la aplique al botón equivocado, ver `R-01`). |

| | |
|---|---|
| **ID** | INV-API-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión `admin`. |
| **Pasos** | 1. `POST /api/items` con `{"name":"X","sku":"   "}` y con `{"sku":"SIN-NOMBRE"}`.<br>2. Con `{"name":"X","sku":"  esp  "}`.<br>3. Con `{"name":"X","name":"Y"}` (clave repetida, solo puede venir de un `FormData` mal armado).<br>4. Con `{"name":"X","minQuantity":"6"}` y con `{"name":"X","minQuantity":"6.5"}`.<br>5. Con `{"name":"X","priceCents":"12000"}`.<br>6. Con un cuerpo que no es JSON válido. |
| **Esperado** | 1: `sku: "   "` da `201` con `sku: ""` (el `trim()`); sin `name` da `400`. 2: `201` con `sku: "esp"`: el `trim()` también se aplica a `sku`, y el valor guardado es el recortado, no lo enviado. 3: la segunda clave pisa a la primera y da `201` — es el comportamiento de `JSON.parse`, no del producto. 4: `"6"` da `201` con `minQuantity: 6` (el `z.coerce` acepta el string que manda la UI); `"6.5"` da `400` por el `.int()`. 5: `201`, por el mismo `coerce`. 6: **`500`**, no `400`: el error de parseo de `express.json` no llega al manejador de errores como `ZodError` ni como `AppError`. Es un riesgo compartido con los nueve y ya está cubierto en `10-regresion-compartida.md` §7 `R-S-03`; aquí solo se anota que Inventario lo hereda (ver `INV-SIST-01` para el resto). |

### 4.12 Sesión, arranque, aislamiento y límites

| | |
|---|---|
| **ID** | INV-SIST-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Producto arriba. |
| **Pasos** | 1. Anotar las dos primeras líneas del log de arranque.<br>2. `curl -s http://localhost:<puerto>/health`.<br>3. `curl -s -X POST http://localhost:<puerto>/health`.<br>4. `curl -s http://localhost:<puerto>/api/meta`.<br>5. Comprobar que `data/inventario.sqlite` existe y que las tablas son `items`, `movements`, `settings` y `amg_migrations`. |
| **Esperado** | 1: `Inventario (inventario) en http://localhost:3023 -> puerto 3023` y `Identidad y suscripciones: http://localhost:3108`; anotar los valores reales porque `.env` puede diferir de `.env.example` (aunque hoy los dos dicen `3023`). 2, 3: `200 {"ok":true,"product":"inventario","name":"Inventario"}` **sin sesión**, por `GET` y por `POST` (`packages/product-runtime/src/app.ts:117-118`). 4: `200 {"name":"Inventario","product":"inventario","version":2,"identity":"amg-central"}`, también sin sesión. 5: exactamente cuatro tablas. No hay tablas de usuarios, organizaciones, sesiones ni clientes: eso vive en el Core, y hay un test con una lista blanca estricta (`tests/inventario.test.ts:414-420`). Si aparece una quinta tabla, hay que pensarlo. |

| | |
|---|---|
| **ID** | INV-SIST-02 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Ventana de incógnito sin cookie de sesión. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/api/items`.<br>2. Abrir `http://localhost:<puerto>/` en el navegador.<br>3. Abrir `http://localhost:<puerto>/amigo.js` y `http://localhost:<puerto>/amigo.css`. |
| **Esperado** | 1: `401 {"error":"sin-sesion","loginUrl":"…"}`: todo camino que empieza con `/api/` es JSON, aunque el `Accept` del navegador sea HTML. 2: `302` hacia el login del Core con `return_to`; **el HTML también pide sesión**, o sea que sin identidad no se descarga ni el shell. No hay pantalla de login propia: el producto no pide usuario ni contraseña. 3: `200` con el archivo, porque `/amigo.js` y `/amigo.css` se resuelven del runtime antes que el guard de identidad… o `302`, si el orden de middlewares los deja detrás. Anotar cuál de las dos: el orden real es el de `app.ts:131-175`, donde el guard de identidad va **antes** del `express.static`, así que lo esperado es `302`. Si devuelve `200`, es una fuga del shell a cualquiera (comparable con `REG-SES-03`). |

| | |
|---|---|
| **ID** | INV-SIST-03 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/me`.<br>2. `GET /api/inicio`.<br>3. Comparar con lo pintado en el canal lateral.<br>4. Recargar y volver a leer `data-amigo="empresa"`, `data-amigo="usuario"`, `data-amigo="correo"` y `data-amigo="avatar"`. |
| **Esperado** | 1: `200 {"user":{"id","email","name"},"organization":{"id","slug"},"role":"member\|admin\|owner","product":"inventario"}`. 2: `200 {"usuario":{id,nombre,email},"organizacion":{id,slug,nombre},"rol":…,"herramienta":"inventario","herramientas":[…]}`. 3: `data-amigo="empresa"` = `organizacion.nombre`, `data-amigo="usuario"` = `usuario.nombre`, `data-amigo="correo"` = `usuario.email`, `data-amigo="avatar"` = las iniciales del nombre. 4: idem, y `data-amigo="otras"` lista las demás herramientas contratadas, con `data-amigo="otras-titulo"` oculto si no hay ninguna. Si el token no trae la lista, `herramientas` cae a un único elemento —la herramienta actual— y esa no se lista, así que el bloque queda vacío y bien. |

| | |
|---|---|
| **ID** | INV-SIST-04 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Tres sesiones: `member` de Org A, `admin` de Org A y `admin` de Org B. |
| **Pasos** | 1. Con `member` de A: `POST /api/items`, `PATCH /api/items/<propio>`, `DELETE /api/items/<propio>`, `POST /api/items/<propio>/movements`, `PUT /api/settings`, `POST /api/seed`.<br>2. Con `admin` de A: las mismas seis.<br>3. Con `admin` de B: `GET /api/items`, `GET /api/resumen`, `GET /api/items/low-stock`, `GET /api/movements`, `GET /api/settings`, `POST /api/seed`. |
| **Esperado** | 1: `201`, `200`, `403`, `403`, `403`, `403` — en ese orden. Cargar y editar artículos es de `member`; dar de baja, mover stock, cambiar los ajustes y sembrar son de `admin`. 2: `201`, `200`, `200`, `201`, `200`, `200` (el del seed depende del estado de la organización). 3: las cinco lecturas `200` y el seed según corresponda, **con los datos de B y ninguno de A**. La matriz de roles completa está en `INV-API-04`, `INV-AJUST-06`, `INV-MOV-05` y `INV-SEED-04`; este caso es el que la cierra en una sola pasada. Repetir con `owner`: se comporta como `admin` en las seis. |

| | |
|---|---|
| **ID** | INV-SIST-05 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Dos organizaciones distintas con suscripción a `inventario`: la propia (Org A, con `QA-INV-2026 AJENA` y movimientos) y Org B, vacía. |
| **Pasos** | 1. Con sesión de **Org A**, guardar el id de `QA-INV-2026 AJENA`.<br>2. Con sesión de **Org B**, pedir `GET /api/items`, `GET /api/items?q=AJENA`, `GET /api/items/<id de A>`, `PATCH /api/items/<id de A>`, `DELETE /api/items/<id de A>` (con `admin`), `POST /api/items/<id de A>/movements`, `GET /api/movements?itemId=<id de A>`, `GET /api/resumen` y `GET /api/items/low-stock`.<br>3. Con sesión de **Org B**, `POST /api/seed` y ver qué aparece en `GET /api/items`.<br>4. Volver a Org A y comprobar que el artículo sigue intacto. |
| **Esperado** | 2: ninguna lista de B contiene nada de A; `?q=AJENA` da `total: 0`; `GET /api/items/<id de A>` da `404 No encontrado`; `PATCH` da `404`; `DELETE` con `admin` da **`404`, no `403`** — el filtro de organización frena de verdad; `POST …/movements` da `404 Artículo no encontrado`; `GET /api/movements?itemId=<id de A>` devuelve `{"movements":[]}`; `GET /api/resumen` da los ceros de B; `low-stock` no lista nada de A. 3: el seed siembra **en B**, con los datos de ejemplo de B y `organizationId` de B: el `organization_id` sale de la sesión y nunca del cuerpo, la query ni un header. 4: el artículo de A sigue con su nombre y su stock. Ninguna respuesta filtra nombres, cantidades ni totales de la otra organización. Con `member` de B el `DELETE` da `403` porque el rol se evalúa antes que la pertenencia: por eso el caso pide `admin` en B. |

| | |
|---|---|
| **ID** | INV-SIST-06 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Recorrer los 3 paneles y las acciones de cada uno con DevTools en Network, contando peticiones.<br>2. Anotar cuántas supera 600 en 15 min, o usar `curl` en bucle para agotar el límite.<br>3. Observar la respuesta `429` y las cabeceras `RateLimit`. |
| **Esperado** | El límite es **600 peticiones por 15 min por IP** (`windowMs: 15 * 60 * 1000`, `limit: 600`, `packages/product-runtime/src/app.ts:99-106`). Agotado, las peticiones responden `429` con cabecera `RateLimit`. Un `429` **no** es un defecto del producto: anotar en la sección 9 y esperar la ventana. Inventario gasta presupuesto más rápido de lo que parece: cada alta, edición, movimiento o baja dispara un `cargar()` completo de 5 peticiones (ver `INV-MOV-11`), así que 100 movimientos son 500 peticiones. Recargar la página reiteradamente (`/api/inicio`, `app.js`, `amigo.js`, `amigo-ui.js`, `style.css`, `amigo.css` más las cinco de datos) también cuenta. |

| | |
|---|---|
| **ID** | INV-SIST-07 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Ventana de incógnito, sin cookie. |
| **Pasos** | 1. `POST /api/auth/login` con `{"email":"a@b.cl","password":"x"}`.<br>2. Con **sesión activa**, repetir `POST /api/auth/login`, `POST /api/auth/register` y `POST /api/auth/recuperar`.<br>3. Con sesión activa, `GET /` y buscar `type="password"` en el HTML servido.<br>4. Con sesión activa, pulsar `Salir` (`a[href="/auth/logout"]`) y observar la redirección. |
| **Esperado** | 1: `401` sin sesión: el guard de identidad responde antes que cualquier ruta. 2: con sesión, los tres dan **`404 {"error":"No existe POST /api/auth/login"}`** (y sus equivalentes), porque esas rutas **no existen**: no hay login, ni registro, ni recuperación de contraseña propios. **Marcado como `404` negativo explícito**: no es una función rota, es la ausencia deliberada de un segundo sistema de identidad, y hay un test que la fija (`tests/inventario.test.ts:406-412`). Si alguno respondiera `200` o `401` distinto, sería un defecto. 3: el HTML servido con sesión **no** contiene ningún `type="password"`, y sí contiene `/auth/logout` como enlace del shell. 4: `Salir` lleva a `/auth/logout`, que redirige al logout del Core (`302`) con `redirect` a la URL del producto: la salida es del Core, no del producto. Después, `/api/*` da `401` y la página `302` al login. |

---

## 5. Recorridos E2E

Recorridos completos, de principio a fin, con los datos de la §2. Cada uno cruza varios módulos y
termina con una comprobación que delata si algo se rompió por el camino.

| | |
|---|---|
| **ID** | INV-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión `admin`, organización con los artículos de la §2. |
| **Pasos** | 1. En `?panel=articulos`, pulsar `#nuevo` y crear `QA-INV-2026 E2E` con `minQuantity: 4`, `unit: caja`, `priceCents: 15000`.<br>2. Leer `#resumen` y la fila nueva.<br>3. Pulsar `Mover` en esa fila y mandar `+30` con motivo `Recepción inicial`.<br>4. Volver a `Mover` y mandar `−12` con motivo `Pedido taller`.<br>5. Ir a `?panel=movimientos` y leer las dos filas.<br>6. Volver a `?panel=articulos` y comparar `Stock`, `Precio` y las cuatro tarjetas de `#resumen`.<br>7. Repetir el paso 4 con `−99` para ver el rechazo. |
| **Esperado** | 1: `POST /api/items` `201` con `quantity: 0`. 2: `Stock` muestra `0 (mín 4)` — con `minQuantity: 4`, un artículo recién creado **no** está en stock bajo (`0 <= 4` sí, o sea que sí: está), y la quinta tarjeta dice `1 artículo en stock bajo`; hay que comprobar el rótulo exacto con un solo artículo. 3: `POST …/movements` `201 {"quantity":30}` y `Stock` pasa a `30`. 4: `201 {"quantity":18}`; la etiqueta `(mín 4)` desaparece de la celda porque 18 > 4. 5: dos filas, la más reciente primero, con `−12` en rojo arriba y `+30` en verde abajo, `Artículo` = `QA-INV-2026 E2E`, `Motivo` = `Pedido taller` y `Recepción inicial`, `Quién` = el nombre de la sesión, `Cuándo` = fecha y hora. 6: `Stock` = `18`, `Precio` = `$ 150`, y el resumen cuadra: `Artículos` subió en 1 al crear, `Unidades` bajó de 4 en 12, `Valor de stock` bajó en `12 * 15000 = 180000` centavos, `Movimientos` subió en 2 y la quinta tarjeta desapareció al salir de stock bajo. 7: `400 No hay stock suficiente: hay 18 caja y el movimiento pide 99`, el diálogo reabre con el `delta` escrito, `Stock` sigue en `18` y `#movimientos` sigue con 2 filas. Coherencia final: `quantity` = 30 − 12 = suma de los `delta`. |

| | |
|---|---|
| **ID** | INV-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Organización vacía (la segunda de la §2), sesión `admin`, `NODE_ENV=development`. |
| **Pasos** | 1. `GET /api/items` para confirmar que `total` es 0.<br>2. En `?panel=configuracion`, pulsar `#sembrar` y aceptar el `confirm`.<br>3. Leer el `alert`, `#resumen`, `#filas` y `GET /api/movements`.<br>4. Pulsar `#sembrar` otra vez y aceptar.<br>5. Leer el `alert` y `GET /api/items`.<br>6. Dar de baja `ACE-530` y volver a sembrar.<br>7. Registrar un movimiento sobre `BUJ-NGK` (`quantity: 8`, `minQuantity: 20`, o sea en stock bajo) de `−8` y luego `−1`. |
| **Esperado** | 1: `total: 0`. 2: `POST /api/seed` `200 {"creados":6}` y el `alert` `Se cargaron 6 artículos de ejemplo.`. 3: `#resumen` con las cinco tarjetas de `INV-RES-01` (`6`, `143`, `$ 20.281`, `0`, `2 artículos en stock bajo`); `#filas` con 6 filas y los SKU de la §2; `GET /api/movements` **vacío**, porque el sembrado escribe `quantity` directo en la fila y no inserta ningún movimiento (`src/seed.ts:35-50`): el stock de apertura no deja asiento, así que `#movimientos` muestra `Sin movimientos todavía.` bajo el rótulo `Los 40 más recientes` (`public/index.html:98`). Los ids de esas seis filas empiezan con `itm_` y no con `item_` (§7, `R-09`). 4 y 5: `POST /api/seed` responde `200 {"creados":0,"nota":"La organización ya tenía artículos"}` y el `alert` muestra **la nota y no un número**: `app.js:189` imprime `r.creados ? ... : r.nota`, y `creados` es 0. `#filas` sigue con 6 filas, `#resumen` con las mismas cinco cifras y `GET /api/items` con `total: 6`. 6: la baja de `ACE-530` responde `200 {"ok":true,"archived":true}`; `#filas` baja a 5 filas y `#resumen` a `5` artículos, `91` unidades (143 − 52) y `$ 10.661` (2028100 − 962000 centavos). La quinta tarjeta **no se mueve** y sigue en `2 artículos en stock bajo`, porque `ACE-530` no estaba en stock bajo (52 > 10) y los dos que estaban son `BUJ-NGK` y `REF-134`. El `POST /api/seed` posterior vuelve a responder `{"creados":0,…}`: el conteo que decide el sembrado no excluye los archivados (`src/seed.ts:26-32`), o sea que dar de baja no libera la siembra. 7: el `−8` (con un motivo cualquiera: `c_reason` es `required`) sobre `BUJ-NGK` responde `201 {"movement":{…},"quantity":0}` —el 0 es un resultado válido— y el `−1` da `400 {"error":"No hay stock suficiente: hay 0 pieza y el movimiento pide 1"}` (`src/routes.ts:196-201`). Al final `#resumen` queda en `5` artículos, `83` unidades (91 − 8), `$ 10.029` (1002900 centavos) y `1` movimiento; la quinta tarjeta **sigue** en `2 artículos en stock bajo`, porque `0 <= 20` no saca a `BUJ-NGK` de stock bajo (§7, `R-04`), y `#movimientos` muestra **una** fila. Coherencia final: los 6 artículos de ejemplo tienen stock de apertura sin asiento, el único movimiento del recorrido tiene su propio asiento, y la organización no se puede volver a sembrar. |

| | |
|---|---|
| **ID** | INV-E2E-03 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión `admin` en la organización de trabajo. Para el paso 4 hace falta una **segunda** persona `admin` de la misma organización; si no hay, repetirlo con la misma sesión y anotar que `actorUserId` no cambia. |
| **Pasos** | 1. Pulsar `#nuevo` y crear `QA-INV-2026 Trazable` con `minQuantity: 0`, `unit: caja` y `priceCents: 5000`.<br>2. Registrar cuatro movimientos desde `Mover`: `+50` `Recepción`, `−20` `Pedido`, `−5` `Merma` y `+2` `Devolución`.<br>3. Leer la celda `Stock` de esa fila y sumar a mano los cuatro `delta`.<br>4. Entrar con la segunda sesión `admin` y registrar `−7` `Ajuste de cierre`.<br>5. Ir a `?panel=movimientos` y leer las cinco filas en orden, con `Quién` y `Cuándo`.<br>6. Pulsar `Baja` en esa fila, confirmar, y leer `#filas`, `GET /api/items/<id>` y `GET /api/movements?itemId=<id>`.<br>7. Registrar `−3` `Reposo post baja` por API con `POST /api/items/<id>/movements` y leer `GET /api/resumen` y `#resumen`. |
| **Esperado** | 1: `POST /api/items` `201` con `quantity: 0`, `minQuantity: 0`, `unit: caja` y `priceCents: 5000`; el `Stock` muestra `0 (mín 0)`. 2: cuatro `201`, con `quantity` 50, 30, 25 y 27 en ese orden, y el `Stock` de la fila siguiendo la misma cuenta. 3: `Stock` = `27` = 50 − 20 − 5 + 2, y coincide con el `quantity` de `GET /api/items/<id>`. 4: `201` con `quantity: 20`, y `actorUserId` y `actorName` de la segunda persona: el nombre se copia al momento del movimiento (`src/routes.ts:217-221`) y el historial no consulta al Core nunca. 5: cinco filas, de la más reciente a la más vieja: `−7`, `+2`, `−5`, `−20`, `+50` (`orderBy desc(createdAt), desc(id)`, `src/routes.ts:146`). Solo la primera muestra el nombre de la segunda persona. **`Cuándo` sale como `5 oct 2026 14:03` y es la hora del navegador**, no la del servidor: `cuando()` llama a `AMIGO_UI.fecha(iso, true)` sin zona (`public/app.js:33`). Si dos movimientos caen en el mismo segundo, el desempate es `desc(id)` y puede no ser el orden real: anotar el `createdAt` de cada uno y reportar el empate si lo hay. 6: `DELETE` `200 {"ok":true,"archived":true}`; la fila sale de `#filas`; `GET /api/items/<id>` sigue `200` con `quantity: 27` y `archivedAt` con valor; las cinco filas de `GET /api/movements?itemId=<id>` siguen ahí, con `itemName` resuelto por la segunda consulta de la ruta (`src/routes.ts:150-159`). 7: `201` con `quantity: 17`, porque un artículo archivado **sigue admitiendo movimientos** (§7, `R-03`). `GET /api/resumen` no cambia `items` ni `unidades` (ya no lo contaban desde el paso 6) pero `movimientos` **sube en 1**, y `#resumen` lo muestra en la cuarta tarjeta. El `Stock` de 17 no se ve en ninguna pantalla: los dos únicos lugares donde queda escrito son `/api/items/<id>` y el `delta` del movimiento. Coherencia final: la suma de los cinco `delta` es 17 y ese es el `quantity` de la fila archivada. |

| | |
|---|---|
| **ID** | INV-E2E-04 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión `admin` en la organización de trabajo, con los ajustes de la §2 sin tocar y `NODE_ENV=development`. Al terminar, restaurar `$`, `unidad` y `0`. |
| **Pasos** | 1. Abrir `?panel=configuracion` y leer `#defaultUnit`, `#defaultMinQuantity` y `#currency`.<br>2. Poner `caja`, `4` y `€`, y pulsar `Guardar cambios`.<br>3. **Sin recargar**, ir a `?panel=articulos` con el canal y leer la columna `Precio` y la tarjeta `Valor de stock`.<br>4. Recargar con F5 y volver a leer las dos, más `#c_unit` y `#c_minQuantity` de `#nuevo`.<br>5. Crear `QA-INV-2026 E2E ajustes` desde `#nuevo` con `priceCents: 15000`, sin tocar unidad ni mínimo, y leer su fila.<br>6. Volver a `?panel=configuracion`, dejar `#defaultMinQuantity` en `0` y guardar.<br>7. Crear `QA-INV-2026 E2E ajustes 2` igual y comparar las dos filas y las cuatro primeras tarjetas de `#resumen`. |
| **Esperado** | 1: `unidad`, `0` y `$`, que son los defaults de `defaultSettings()` (`src/routes.ts:53-57`), con `configured: false` y `seedAvailable: true`. 2: `PUT /api/settings` `200` con la fila y `configured: true`; el botón se rehabilita y `[data-err]` queda vacío. **Ningún mensaje de éxito**: guardar un ajuste no dice nada (§7, `R-02`). La respuesta **no** trae `seedAvailable` (`src/routes.ts:294`), así que `estado.settings` queda con esa clave en `undefined` entre esta operación y la siguiente. 3: **`Precio` y `Valor de stock` no cambian**: el `submit` reemplaza `estado.settings` y no vuelve a pintar (`public/app.js:167-174`), y el enlace del panel tampoco repinta porque este producto llama a `AMIGO.montar` **sin `alEntrar`** (`public/app.js:319-322`). El símbolo nuevo se ve recién en el paso 4. Es el efecto visible de `R-14`. 4: tras el F5, `Precio` y `Valor de stock` salen con `€`, redondeados a pesos enteros y sin decimales (`Math.round(centavos / 100)`, `public/app.js:28-31`); `#c_unit` = `caja` y `#c_minQuantity` = `4`, y `#c_priceCents` = `0` siempre. 5: la fila muestra `4 caja`, `€ 150` y `Stock` = `0 (mín 4)`: el artículo recién creado entra en stock bajo (`0 <= 4`) y aparece la quinta tarjeta. 6: `200` y `#defaultMinQuantity` vuelve a `0`. 7: el segundo artículo nace con `minQuantity: 0` y **también** entra en stock bajo (`0 <= 0`), o sea que el umbral no se puede desactivar: con cualquier valor no negativo, todo artículo recién creado suma en la quinta tarjeta (§7, `R-04`). `#movimientos` no se mueve en ningún paso: los ajustes no gobiernan el historial. |

Los cuatro recorridos cubren las tres formas de cambiar el stock de este producto —sembrar un
catálogo, mover unidades a mano y dar de baja un artículo— y la regla que las ata: la cantidad
que muestra la tabla tiene que poder reconstruirse sumando los `delta` de `/api/movements`.
`INV-E2E-01` y `INV-E2E-02` la respetan; `INV-E2E-03` es el que la pone contra la evidencia, con un
artículo archivado al que se le sigue moviendo stock, y `INV-E2E-04` el que muestra que los
ajustes de la organización no llegan a la pantalla hasta que algo recarga.

---

## 6. Regresión compartida

Todo lo que toca código compartido: `amigo.js`, `amigo-ui.js`, `amigo.css`, el `crudRouter`, el
middleware de identidad, `express.json`, `rateLimit` y `helmet`. Los riesgos genéricos están en
`10-regresion-compartida.md` y **no se repiten** en la §7; desde acá se referencian con su clave
`R-S-xx` en el esperado del caso que los toca.

Estos cinco casos miran la capa compartida **por el contrato**, no por el resultado: §4 ya
comprueba qué ve la persona, y lo que queda por debajo es qué opciones declara el producto, qué
helper del runtime usa y cuál se reimplementó. La forma es distinta a propósito.

| | |
|---|---|
| **ID** | INV-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. Organización con una sola herramienta (_other_) y, en una segunda vuelta, con dos. |
| **Pasos** | 1. En la consola, `typeof window.AMIGO_alEntrar` y `AMIGO.mostrar('movimientos')` sin pulsar nada.<br>2. Con Network abierto, ejecutar de nuevo `AMIGO.mostrar('articulos')` y `AMIGO.montar({paneles:['articulos','movimientos','configuracion']})`.<br>3. Sin recargar, pulsar `[data-tab="configuracion"]`, `[data-tab="articulos"]` y `[data-tab="movimientos"]`.<br>4. Leer `aria-current` de los tres enlaces y `hidden` de los tres `section[data-panel]` en cada paso.<br>5. Leer `data-amigo="logo"`, `empresa`, `usuario`, `correo`, `avatar`, `otras` y `otras-titulo`.<br>6. Con una organización de una sola herramienta y luego de dos, releer `otras` y `otras-titulo`. |
| **Esperado** | 1: `typeof window.AMIGO_alEntrar` es `"undefined"` y `AMIGO.mostrar` existe: `grep -n "AMIGO_alEntrar\|alEntrar" products/inventario/public/*` **no devuelve nada**, y `public/app.js:319-322` llama a `montar` con solo `nombre` y `paneles`. La razón está escrita en el propio archivo (`public/app.js:314-318`): `cargar()` pide las cinco rutas de una (`public/app.js:37-53`) y se repite después de cada cambio, así que un refresco por panel sería la misma llamada dos veces. 2: **`mostrar` no pide nada**: con `alEntrar` en `null`, solo llama `marcar` (`amigo.js:123-127`), y volver a llamar `montar` vuelve a enlazar los clics y vuelve a pedir `/api/inicio`. Anotar que el segundo `montar` **duplica los listeners** de los tres enlaces: al pulsar un enlace se ejecutan los dos manejadores y `pushState` se llama dos veces. 3: **cero** peticiones nuevas, que es el resultado correcto acá y el contrario de `SOL-REG-01`. La lección del shell es que `alEntrar` es el que pinta; este producto se apoya en `cargar()` y por eso el panel ya está lleno antes de cambiar de sección. 4: solo el enlace activo lleva `aria-current="page"` y solo su `section[data-panel]` queda visible (`amigo.js:96-109`); `h1[data-amigo="titulo"]` copia el texto del enlace activo, o sea `Artículos`, `Ajustes` o `Movimientos`. 5: `logo` = `IN`, tomado de `document.title`, y `avatar` con las iniciales del nombre de la persona (`amigo.js:62-67`); `empresa`, `usuario` y `correo` salen de `/api/inicio`. **Ojo con el nombre de la clave**: `/api/me` devuelve `role` y `/api/inicio` devuelve `rol` (`auth.ts:121,146`). Este producto solo lee el primero (`public/app.js:64`) y el shell no lee ninguno de los dos: eso es `R-S-05`. 6: con una sola herramienta, `otras-titulo` queda oculto y `otras` vacío, porque la herramienta actual se filtra de la lista (`amigo.js:77-84`); con dos, aparece el enlace de la otra. Si el Core no trae `herramientas`, el runtime arma una sola entrada que es la actual (`auth.ts:139-142`), así que el bloque queda vacío igual. |

| | |
|---|---|
| **ID** | INV-REG-02 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. Organización vacía y organización con datos y stock bajo. |
| **Pasos** | 1. Correr `grep -n "AMIGO_UI\.\|cajaTabla\|tabla(\|dinero(\|avisar(\|esc(\|vacio(\|etiqueta(\|estadoDe(" products/inventario/public/app.js` y anotar qué helpers se usan y cuáles no.<br>2. Con lista vacía, abrir `?panel=articulos` y `?panel=movimientos` y leer las dos filas vacías.<br>3. Con stock bajo, contar los `.ui-kpi` de `#resumen` y leer `ui-kpi__cifra` y `ui-kpi__etiqueta` de cada tarjeta, en ese orden.<br>4. Provocar un `400` de validación en el diálogo de artículo (nombre de 151 caracteres) y leer `#error`.<br>5. Provocar un `400` en `#config-form` (unidad de 31 caracteres) y leer `[data-err]`.<br>6. Con `member`, pulsar `Mover` y leer `#error`; pulsar `Baja` y leer el `alert`.<br>7. Provocar el `401` de la convención 5.1 y mirar a dónde se va la pantalla y qué queda en `#resumen`. |
| **Esperado** | 1: se usan `$`, `api`, `esc`, `celda`, `fila`, `filaVacia`, `boton`, `kpis` y `fecha`, y **no** se usan `cajaTabla`, `tabla`, `cuerpoDe`, `etiqueta`, `estadoDe`, `vacio` (directamente), `avisar` ni `dinero`. Tres consecuencias, todas verificables en pantalla: **las tablas son las de `index.html` y no pasan por `tabla()`**, así que los `colspan` y los encabezados están escritos a mano (`public/index.html:76-88,100-111`); **no hay `cajaTabla`, y por lo tanto no hay `.ui-tabla-scroll` con `overflow-x: auto`** (`amigo-ui.js:138-147`, `amigo.css:536-544`); y **no hay `avisar`, y por lo tanto no hay `#aviso`** en el HTML. La tercera es `R-02` y la segunda es el riesgo propio de este producto en la §8. 2: `filaVacia(6, …)` y `filaVacia(5, …)` respetan su `colspan` y el texto va en un `.ui-vacio` (`amigo-ui.js:296-303`), o sea la pieza compartida y no un `<p>` escrito a mano. 3: `kpis` recibe **las cinco tarjetas en una sola llamada** (`public/app.js:86`), y `f[0]` es la etiqueta chica y `f[1]` la cifra grande (`amigo-ui.js:238-250`). Las cuatro primeras salen en orden normal: etiqueta `Artículos` con cifra `6`. **La quinta sale al revés**: su etiqueta es `2 artículos en stock bajo` (texto pequeño) y su cifra es la palabra `Revisar` (`public/app.js:83-85`). El número que pide una acción es el que quedó de subtítulo. Verificarlo con la quinta tarjeta a la vista y anotarlo como está (§7, `R-10`). Las cinco caben en `.ui-rejilla--4`, que es `flex-wrap` con `flex: 1 1 9rem` (`amigo.css:335-336`): tienen que envolver en dos filas y no desbordar. 4: `AMIGO_UI.api` aplana el `flatten()` de Zod a `campo: mensaje` unido por ` · ` (`amigo-ui.js:339-342`) y el `catch` de `abrir` lo pinta en `#error` (`public/app.js:239-242`). **Anotar el texto literal**: los mensajes propios del producto están en español (por ejemplo `El motivo es obligatorio: sin él el stock no se puede explicar`, `src/routes.ts:43`) y los de Zod por defecto, en inglés. El diálogo no se cierra y lo escrito se conserva. 5: `[data-err]` es el `<p class="ui-error">` del propio form (`public/index.html:142`), no `#error` del diálogo: el mismo papel con dos nombres y dos lugares. El `catch` del submit lo pinta y rehabilita el botón (`public/app.js:175-181`). 6: el `403` llega a `#error` con el texto crudo `rol-insuficiente`, porque `api` arma el mensaje con `datos.error` (`amigo-ui.js:343`) y `err.message` es exactamente eso; el de `Baja` sale por `alert` (`public/app.js:299-301`) y el de `#sembrar` también (`public/app.js:190-192`). 7: el `401` con `loginUrl` hace `window.location.href = loginUrl` y lanza un error con `vencida` (`amigo-ui.js:331-336`); el `catch` de arranque respeta esa marca y **no** pinta el aviso de error (`public/app.js:324-329`). La pantalla no queda mostrando datos vacíos ni un error que no es del producto. |

| | |
|---|---|
| **ID** | INV-REG-03 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión `admin`. Organización con los artículos de la §2. |
| **Pasos** | 1. Releer la declaración del `crudRouter` en `products/inventario/src/routes.ts:299-326` y anotar qué opciones declara y cuáles deja en su default.<br>2. `GET /api/items`, `GET /api/items?q=ace` y `GET /api/items?q=ACE`, y anotar `total`, `limit`, `offset` y el orden.<br>3. `GET /api/items?limit=0`, `?limit=9999`, `?limit=5&offset=2`, `?limit=-1` y `?offset=-1`.<br>4. `GET /api/items?activo=true`, `?archived=true` y `?stockBajo=1`.<br>5. `POST /api/items` con `{"name":"QA-INV-2026 W","emial":"a@b.cl"}` y `PATCH /api/items/<id>` con `{"nombre":"QA-INV-2026 X"}`.<br>6. `DELETE /api/items/<id>` con `member` y con `admin`.<br>7. `GET /api/movements` y `GET /api/items` y comparar las claves de los dos cuerpos. |
| **Esperado** | 1: declara `table`, `idPrefix: 'item'`, `orderBy: items.name` con `asc`, `search: [items.name, items.sku]`, `archive: true`, `writeRole: 'member'`, `deleteRole: 'admin'` y los siete `fields`. **No declara `filters`, `defaultLimit` ni `maxLimit`**, así que quedan en 200, 1000 y en un mapa vacío (`crud.ts:169-171`). 2: el contrato es `{items, total, limit, offset}` (`crud.ts:248`), o sea el del portfolio (`R-S-06`), y el orden es por nombre ascendente, no por `createdAt`: el CRUD usa el `orderBy` que le pasen. 3: `limit: 200` con `limit=0` (el 0 es falsy y cae al default), `limit: 1000` con `limit=9999`, `limit: 5` con `offset: 2`, y **`limit: -1` tal cual**: `Math.min(Number('-1') || 200, 1000)` da `-1` (`crud.ts:228`) y `Math.min` no acota por abajo. `offset: -1` también pasa. SQLite los lee como «sin límite» y «desde la última fila». El tope de 1000 se elude por la ruta (§7, `R-08`, y `R-S-13`). 4: los tres **se ignoran en silencio** y devuelven la lista completa: sin `filters` declarados no hay nada que los aplique (`crud.ts:212-226`). No hay `400`, o sea que la pantalla puede parecer filtrada mientras muestra todo, y ni el código ni la interfaz avisan. 5: los dos dan `400 Campo desconocido: …`, con el nombre de la clave sobrante (`crud.ts:124-137`); el `.strict()` es lo que lo fuerza (`crud.ts:148`). Es el comportamiento que `R-S-09` marca como el correcto de los dos que hay. 6: con `member`, `403` (el `deleteRole` se comprueba antes de tocar la fila); con `admin`, `200 {"ok":true,"archived":true}` (`crud.ts:304-318`). Que `writeRole` y `deleteRole` sean distintos es exactamente la separación que el producto quiere: el comentario de `crud.ts:71-78` la describe. 7: **`/api/items` envuelve y `/api/movements` no**: el segundo devuelve `{"movements":[…]}` y **no trae `total`** (`src/routes.ts:161-166`). Es una excepción consciente al contrato de lista, y hay que registrarla como tal en la §9, no como desviación a corregir desde el plan. |

| | |
|---|---|
| **ID** | INV-REG-04 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa y **otra** pestaña con la suscripción de `inventario` dada de baja en el Core (para el paso 5). |
| **Pasos** | 1. Correr `grep -n "publicPaths\|rateLimitPer15Min\|auth:" products/inventario/src/app.ts`.<br>2. Sin sesión, pedir `GET /favicon.ico`, `GET /health`, `GET /api/meta`, `GET /app.js` y `GET /api/inicio`.<br>3. Con sesión vencida (convención 5.1), pedir `GET /api/items` y anotar cuerpo y cabeceras.<br>4. Con la suscripción dada de baja, pedir `GET /api/items` y `GET /`.<br>5. Con la suscripción dada de baja, pulsar `Salir`.<br>6. Con el cupo de 600/15 min agotado, pedir `GET /health` y después `GET /api/items`, y leer las cabeceras `RateLimit`.<br>7. Recargar la página y contar cuántas peticiones van a `/api/`. |
| **Esperado** | 1: **no declara ninguno de los tres**. `publicPaths` queda en el default del runtime (`auth.ts:111`), el límite en 600/15 min (`app.ts:99-106`) y el montaje de identidad con el `productName` del producto. 2: `favicon.ico`, `/health` y `/api/meta` responden **sin sesión**: los dos primeros por `publicPaths`, el tercero porque está registrado antes del middleware de identidad (`app.ts:117-121`). `/favicon.ico` da **`404 {"error":"No existe GET /favicon.ico"}`** y no redirige al login, que es lo correcto para una ruta pública sin archivo (`errors.ts:19-21`). `GET /app.js` y `GET /api/inicio` sí piden sesión: los estáticos se sirven **después** de la identidad (`app.ts:139,161-165`). 3: `401 {"error":"sin-sesion","loginUrl":"…"}`, y `AMIGO_UI.api` manda el navegador al login central con el error `vencida` (`amigo-ui.js:331-336`). El `loginUrl` lo arma el runtime, no el producto. 4: **`403 {"error":"sin-acceso"}`**, no `404`: la suscripción la corta el middleware antes de que corra cualquier router del producto, así que no se ve ni `GET /api/items`. Anotarlo en la §9 con esa forma exacta, porque es la diferencia entre «no tenés acceso» y «no existe». 5: `Salir` va a `/auth/logout`, que redirige al logout del Core con `redirect` a la URL del producto: la salida la resuelve el Core, no este producto. 6: **`/health` responde `429` con el cupo agotado**, no `200`: el limitador se instala en `app.ts:99-106` y `/health` se registra después, en `app.ts:117-118`. Es `R-S-04` y no es un defecto de Inventario; anotar y esperar la ventana. El `RateLimit` viene en cabecera porque se pidió `standardHeaders: 'draft-8'` y `legacyHeaders: false`. 7: la carga inicial son **6 peticiones de datos**: `/api/inicio` (del shell), `/api/me`, `/api/resumen`, `/api/items?q=`, `/api/movements?limit=40` y `/api/settings`, todas en el `Promise.all` de `cargar()` (`public/app.js:37-44`). Con `?q=` vacío la URL es `GET /api/items?q=`. Suman a las de los estáticos, y esa es la unidad con la que hay que comparar el gasto de la ventana. |

| | |
|---|---|
| **ID** | INV-REG-05 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa. Para el punto 5 hace falta `NODE_ENV=production` o, en desarrollo, un producto equivalente con el `immutable` activo. |
| **Pasos** | 1. En Network, cargar `/` ignorando caché y abrir `/amigo.css`, `/amigo.js`, `/amigo-ui.js`, `/style.css` y `/app.js`.<br>2. Comparar el `?v=` de `/app.js` con el de `/amigo.js` y con el de `/amigo-ui.js`.<br>3. Leer el `Cache-Control` de los cinco y comprobar si aparece `immutable`.<br>4. En las cabeceras de `/`, buscar `X-Powered-By`, `Content-Security-Policy` y `ETag`.<br>5. Cambiar `amigo.css` en el runtime compartido, recargar y ver si el cambio aparece.<br>6. `POST /api/items` con un cuerpo de 2 MB, y `POST /api/items` con `{"name":` a medio escribir.<br>7. Verificar el `GET /` con la sesión y `GET /app.js?v=999` con una huella inventada. |
| **Esperado** | 1: `/amigo.css`, `/amigo.js` y `/amigo-ui.js` salen del runtime compartido y **ganan** a cualquier copia del producto, porque el `express.static` compartido va antes que el del producto (`app.ts:161-165`). Este producto **no** trae copias de esos tres archivos en su `public/`: `products/inventario/src/app.ts:28` solo declara el `staticDir` del producto. `style.css` entra por `@import url("/amigo.css")` y de ahí salen la forma y los cuatro tokens del acento (`public/style.css:17,19-24`). 2: **las tres huellas son iguales**, porque `version` es la suma de `assetVersion(sharedAssetsDir)` y `assetVersion(dirProducto)` (`app.ts:170`): `/amigo.js?v=abc` y `/app.js?v=abc` viajan siempre juntos, que es justo la mezcla que rompía la pantalla. 3: en desarrollo el `maxAge` es 0 y no hay `Cache-Control` de larga duración (`app.ts:159`); en producción va `immutable` con la huella en la URL (`app.ts:160,165`). Anotar el entorno en el registro, porque el resultado es distinto y sin `NODE_ENV` dicho el caso no se puede comparar entre productos (`R-S-07`). 4: sin `X-Powered-By` (`app.ts:91`) y **sin `Content-Security-Policy`**: `helmet` está instalado con `contentSecurityPolicy: false` (`app.ts:95`, `R-S-02`). No hay que esperar un `default-src` que rompa los estilos inline de `index.html`. 5: el cambio aparece solo tras recargar ignorando caché: en desarrollo no hay `immutable`, pero el navegador igual puede tener el archivo viejo. Anotar si hizo falta "vaciar caché". 6: `413 {"error":"La petición es demasiado grande"}` con el límite de 1 MB de `express.json` (`app.ts:96`, `errors.ts:36-38`), y **`500 {"error":"Error interno del servidor"}`** con el JSON a medias: el error de parseo no llega al manejador ni como `ZodError` ni como `AppError` (`errors.ts:40`, `R-S-03`). Los dos son del runtime y los nueve los heredan. 7: `GET /` devuelve el HTML con `no-cache` y la huella del punto 2 (`app.ts:171-175`); `/app.js?v=999` sirve el archivo igual, porque la huella no se valida: es una URL distinta, no una versión verificada. Anotarlo, porque significa que una huella vieja no rompe nada y solo se pierde cacheo. |

---

## 7. Riesgo conocido

Defectos y trampas **sospechados en el código**, no ejecutados. Cada uno dice dónde mirar y cómo
confirmarlo en el navegador o en Network. Los que son de la capa compartida y no de este producto
están en `10-regresion-compartida.md` y no se repiten aquí: se referencian con `R-S-xx` desde el
esperado de los casos de la §6. La columna `Estado` separa lo que el código dice de lo que hay que
ver con los ojos: `Confirmado` es que la línea está escrita y el caso la presencia en pantalla;
`Sospechado` es que la consecuencia se deduce del código pero depende de cómo se comporte el
navegador o el servidor.

| Riesgo | Dónde | Cómo se confirma | Estado | Severidad |
|---|---|---|---|---|
| **R-01** **`data-requiere-admin` se marca en el botón equivocado.** `pintarArticulos` mete los tres botones en una celda con `celda()` y marca `acciones.firstChild` (`public/app.js:110-115`), y `firstChild` es el botón `Editar`. Con `member` se esconde `Editar` —que es la operación que su rol sí puede hacer— y quedan a la vista `Mover` y `Baja`, las dos de `admin`. El `member` no ve el problema hasta que las pulsa y recibe un `403`; y `pintarMe` marca por `dataset`, así que el atributo sobrevive a cada repintado de la tabla. | `products/inventario/public/app.js:110-115,63-72`, `products/inventario/src/routes.ts:180,314` | Con `member`, abrir `?panel=articulos`: si `Editar` no está y `Mover` y `Baja` sí, está confirmado. Después pulsar `Mover` y leer el `403` en `#error`, y `Baja` y leer el `alert`. `INV-ART-13` e `INV-MOV-05`. | Confirmado | Media |
| **R-02** **No hay `#aviso` y cada pantalla reporta los errores de una forma distinta.** El producto no llama nunca a `AMIGO_UI.avisar` y no existe `#aviso` en el HTML, así que el único camino de salida de un error son `#error` (dentro del diálogo), `[data-err]` (dentro del form de ajustes) y `alert()` (en la baja y en el sembrado). Peor: **ninguno de los tres se usa para confirmar que algo salió bien**, así que crear un artículo, mover stock, dar de baja, sembrar o guardar ajustes termina en silencio. Un error por `alert` se escapa de una revisión visual rápida (`R-S-10` lo dice del lado compartido). | `products/inventario/public/app.js:184-193,239-242,299-302`, `products/inventario/public/index.html:142,164` | `grep -n "avisar(\|#aviso" products/inventario/public/index.html products/inventario/public/app.js` no devuelve nada: se comprueba como **ausencia**. En pantalla, provocar un error en cada uno de los tres caminos y comparar. Y después un alta y un movimiento correctos, para comprobar que no dicen nada. `INV-REG-02`. | Confirmado | Media |
| **R-03** **Un artículo dado de baja sigue admitiendo movimientos.** La comprobación de existencia busca por `id` y organización y **no excluye `archived_at`** (`src/routes.ts:185-189`), así que un `POST …/movements` sobre un artículo archivado responde `201`, le cambia `quantity` y suma en la cuarta tarjeta de `#resumen` sin que nada de eso aparezca en ninguna tabla: el tablero se mueve por una operación invisible. El `confirm` de la baja promete «Se conserva el historial» y eso es cierto, pero también lo es lo contrario: el historial sigue admitting entradas. | `products/inventario/src/routes.ts:185-190`, `products/inventario/public/app.js:295` | Archivar un artículo con stock, moverle `−1` por API y comparar `GET /api/resumen` antes y después: si `movimientos` sube y `items` no cambia, está confirmado. `INV-STK-06`, `INV-MOV-06` e `INV-E2E-03`. | Confirmado | Media |
| **R-04** **Con los ajustes por defecto, todo artículo recién creado aparece en stock bajo.** El criterio es `quantity <= minQuantity` (`src/routes.ts:76,108`) y el `defaultMinQuantity` por defecto es `0`, que es además lo que prellena `#c_minQuantity` (`public/app.js:257`). Con `0 <= 0` el artículo entra en `low-stock` y en la quinta tarjeta desde el momento en que se crea. Y como el mínimo no puede ser negativo, **ningún ajuste puede sacar de ahí a un artículo recién creado**: la quinta tarjeta solo baja cuando se le cargan unidades. | `products/inventario/src/routes.ts:53-57,76,108,320`, `products/inventario/public/app.js:257` | Crear dos artículos seguidos, uno con `minQuantity: 5` y otro con `0`, y comparar la quinta tarjeta y `GET /api/items/low-stock`. Si los dos aparecen, está confirmado. Ojo: `INV-E2E-01` ya lo dice con `minQuantity: 4`. `INV-RES-03`, `INV-E2E-04`. | Confirmado | Baja |
| **R-05** **`active` lo usan dos de tres caminos, y la interfaz no lo controla.** El resumen y `low-stock` filtran `active = true` (`src/routes.ts:102,108`) y el `crudRouter` **no**: su único filtro es `archived_at IS NULL` (`crud.ts:199-203`). Peor: la celda `Stock` calcula `quantity <= minQuantity` **sin mirar `active`** (`public/app.js:98`). O sea que un artículo creado por API con `active: false` sale de las tres primeras tarjetas y de `low-stock`, pero sigue en `#filas` con su `(mín N)` en rojo, y **no hay ningún control en la interfaz para volverlo a activar**: solo por API. | `products/inventario/src/routes.ts:102,108,323`, `packages/product-runtime/src/crud.ts:199-203`, `products/inventario/public/app.js:98` | Crear por API `{"name":"QA-INV-2026 inactivo","active":false,"quantity":0,"minQuantity":0}` y comparar `#resumen`, `#filas` y `GET /api/items/low-stock`: si aparece en la tabla con `(mín 0)` y no en las tarjetas ni en `low-stock`, está confirmado. `INV-RES-04`. | Confirmado | Media |
| **R-06** **`active` se coercea con una regla que lee tres cadenas exactas.** `z.preprocess` convierte en `false` cualquier string que no sea `"true"`, `"1"` o `"si"` (`src/routes.ts:31-34`), así que `"sí"` con tilde, `"Si"`, `"TRUE"` y `"yes"` desactivan el artículo **sin error**. Y al revés, `active: 1` numérico da `400`: el preprocesador lo deja pasar y el `z.boolean()` lo rechaza. Acepta el string `"1"` pero no el número `1`. | `products/inventario/src/routes.ts:31-34,323` | Los seis `POST` de `INV-API-02`, leyendo `active` en la respuesta de cada uno: cuatro `true`, el de `"sí"` en `false` y el del `1` numérico en `400`. `INV-API-02`. | Confirmado | Baja |
| **R-07** **El dinero se formatea con un `Math.round` propio y no con `AMIGO_UI.dinero`.** `pesos()` hace `Math.round(centavos / 100)` con `Intl.NumberFormat('es-CL')` (`public/app.js:28-31`), así que **se pierden los centavos**: `18550` se ve `$ 186` y el valor de stock puede diferir en varios centavos del dato guardado. El shell ya trae `dinero()`, que respeta el separador y los decimales (`amigo-ui.js:52-57`), y este producto no lo llama. Es uno de los dos formatos que hay en el portfolio (`R-S-08`). | `products/inventario/public/app.js:28-31,117`, `packages/product-runtime/public/amigo-ui.js:52-57` | Crear por API dos artículos con `priceCents: 18500` y `18550` y leer la columna `Precio`: si los dos se ven como `$ 185` y `$ 186`, está confirmado. Después cambiar `currency` y comprobar que el separador de miles es `.` y que **no** aparece ningún decimal. `INV-RES-02` e `INV-E2E-04`. | Sospechado | Media |
| **R-08** **Ninguna lista tiene paginador y dos de ellas no pueden saber si falta algo.** La interfaz pide `/api/items?q=` sin `limit`, o sea el default de 200 (`public/app.js:41`), mientras la ruta admite hasta 1000 y **acepta `limit` negativo** (`crud.ts:228`); y `/api/movements?limit=40` no trae `total` y la interfaz no lo pide (`src/routes.ts:141,161-166`). Con más de 200 artículos o más de 40 movimientos la pantalla muestra el recorte sin ningún aviso, y el rótulo `Los 40 más recientes` es lo único que lo delata. El `total` de `/api/items` sí viene y **tampoco se muestra en ninguna parte**. | `products/inventario/public/app.js:41-42`, `products/inventario/src/routes.ts:141`, `packages/product-runtime/src/crud.ts:228,248` | Con 201 artículos, comparar las filas de `#filas` con el `total` de `GET /api/items` y con la cifra `Artículos` de `#resumen`: si la tabla muestra 200 y las otras dos cifras dan 201, está confirmado. Lo mismo con 41 movimientos. `INV-ART-04`, `INV-MOV-07` e `INV-REG-03`. | Confirmado | Media |
| **R-09** **Los ids del sembrado y los del `crudRouter` tienen prefijos distintos.** `seedDemo` genera `createId('itm')` (`src/seed.ts:38`) y el CRUD `idPrefix: 'item'` (`src/routes.ts:303`). Cualquier caso, script o integración que asuma `item_` falla justo con los datos de ejemplo, que son los más usados para probar, y el `confirm` de la baja imprime el **nombre**, no el id, así que la diferencia no se ve en pantalla. | `products/inventario/src/seed.ts:38`, `products/inventario/src/routes.ts:303` | `GET /api/items` en la organización sembrada y comparar el prefijo con el de un artículo creado por la interfaz. Anotar los dos prefijos en la §9, porque los casos de la §6 los citan. `INV-SEED-02`. | Confirmado | Baja |
| **R-10** **La tarjeta que pide una acción está al revés y no es un enlace.** Las cuatro primeras se arman como `[etiqueta, cifra]`, pero la quinta se empuja como `[n artículos en stock bajo, 'Revisar', true]` (`public/app.js:83-85`) y `kpis` pone `f[1]` como cifra grande y `f[0]` como etiqueta chica (`amigo-ui.js:240-250`): en pantalla se ve **la palabra `Revisar` en grande y el número de stock bajo en pequeño**, al revés de las otras cuatro. Y `Revisar` no es un enlace: no hay `href`, no hay `onclick`, no hay `#aviso`, y `GET /api/items/low-stock` —que existe, filtra y ordena por nombre (`src/routes.ts:67-85`)— **no lo llama nadie**. El único camino para ver la lista de reposición es la API. | `products/inventario/public/app.js:83-86`, `packages/product-runtime/public/amigo-ui.js:238-250`, `products/inventario/src/routes.ts:67-85` | Contar los `.ui-kpi` de `#resumen` y leer cuál de los dos textos va en `ui-kpi__cifra` y cuál en `ui-kpi__etiqueta`. Después hacer clic en `Revisar` mirando Network: si no sale ninguna petición, está confirmado. `grep -r low-stock products/inventario/public` no devuelve nada. `INV-RES-06` e `INV-REG-02`. | Confirmado | Media |
| **R-11** **El buscador se traga los errores.** El `oninput` de `#buscar` encadena el `fetch` con un `.catch(() => {})` (`public/app.js:307-312`), así que un `401`, un `429` o un `500` en `/api/items?q=` deja la tabla con **la lista anterior**, sin mensaje, sin aviso y sin nada en la consola. El `catch` existe para que un error de sesión no tape la pantalla, pero también borra el `429` del límite de 600/15 min, que es justo el dato que hay que anotar en la §9, y deja la lista con la búsqueda a medias sin que nada diga que la búsqueda no terminó. | `products/inventario/public/app.js:306-312` | Escribir en `#buscar` con el cupo de la API agotado y ver que la tabla no cambia y que nada dice por qué. Después crear un artículo por API y esperar 400 ms sin tocar `#buscar`: tampoco aparece. `INV-BUS-01` e `INV-SIST-06`. | Confirmado | Baja |
| **R-12** **Los encabezados numéricos están alineados a la derecha y sus celdas a la izquierda.** `amigo.css` alinea a la derecha lo que tiene la clase `num`, y `fila()` la aplica solo si se le pasa `num` (`amigo-ui.js:113-128`). En `#filas` los `<th>` de `Stock` y `Precio` llevan `class="num"` (`public/index.html:81,83`) y la llamada a `fila()` pasa `{className: 'acciones'}` **sin `num`** (`public/app.js:117`), así que el número queda bajo su propio título desalignado. Lo mismo en `#movimientos`, donde `Delta` tiene `th.num` (`public/index.html:103`) y la `td` no. El propio `tabla()` avisa que encabezado y celda tienen que coincidir (`amigo-ui.js:156-159`). | `products/inventario/public/index.html:81,83,103`, `products/inventario/public/app.js:117,134`, `packages/product-runtime/public/amigo-ui.js:113-128` | Comparar la alineación del `<th> Stock` y `Precio` con la de sus `<td>`, y la del `<th> Delta` con la suya. Si el `th` está a la derecha y la celda a la izquierda, está confirmado. `INV-ART-05` e `INV-MOV-10`. | Confirmado | Baja |
| **R-13** **`#buscar` filtra un panel que puede no estar a la vista, y el resumen no se filtra nunca.** Los dos controles viven en `.ui-topbar`, o sea en los tres paneles (`public/index.html:54-62`), así que desde Movimientos o Ajustes se busca y lo que se repinta es `#filas`, que está oculto; y `/api/resumen` no acepta filtros, de modo que las tarjetas siguen contando la organización entera mientras la tabla muestra una fila. Ninguna de las dos cosas tiene aviso, y el `cargar()` completo que sigue a cada cambio tampoco repinta el panel de Movimientos. | `products/inventario/public/index.html:54-62`, `products/inventario/public/app.js:41,306-312`, `products/inventario/src/routes.ts:91-124` | Buscar desde `?panel=movimientos` y desde `?panel=configuracion`, y comparar `#resumen` con el número de filas de `#filas`. Si las cuatro tarjetas no se mueven, está confirmado. `INV-NAV-07` e `INV-BUS-03`. | Confirmado | Media |
| **R-14** **Guardar Ajustes no repinta nada, y la respuesta del `PUT` es más pobre que la del `GET`.** El `submit` del `#config-form` reemplaza `estado.settings` con la respuesta y no vuelve a pintar (`public/app.js:167-174`), así que cambiar el símbolo de moneda se ve recién en la tabla y en el tablero **después de un F5 o de la siguiente acción que dispare `cargar()`**. Además el `PUT` devuelve la fila sin `seedAvailable`, que el `GET` sí manda (`src/routes.ts:294` contra `:256`): entre esa operación y la siguiente, `estado.settings` tiene esa clave en `undefined`, y si en ese momento `pintarMe` llegara a correr, `#sembrar` quedaría **oculto para todos, admin incluido**, porque `!undefined` es `true` el `hidden` sale en `true` (`public/app.js:71`). | `products/inventario/public/app.js:167-174`, `products/inventario/src/routes.ts:256,294` | Cambiar `currency`, guardar y mirar `Precio` y `Valor de stock` sin recargar; después recargar y compararlos. Y comparar `Object.keys` de `GET /api/settings` con los del `PUT`. `INV-AJUST-02` e `INV-E2E-04`. | Sospechado | Media |
| **R-15** **La cascada de `movements` sigue armada en el DDL.** `item_id` es `REFERENCES items(id) ON DELETE CASCADE` (`src/ddl.ts:34`). Hoy ninguna ruta borra la fila de `items` de verdad —la baja es lógica (`crud.ts:309-318`)— así que el riesgo es **latente**, pero cualquier borrado directo en la base (una migración, una limpieza, una herramienta de administración) se lleva por delante **todo el historial** de ese artículo y deja su `quantity` sin explicación: exactamente la situación que este producto existe para evitar. El comentario de `crud.ts:307-309` razona justo sobre esto. | `products/inventario/src/ddl.ts:34`, `packages/product-runtime/src/crud.ts:307-318` | No hay camino por API, así que hay que comprobarlo en la base y **nunca sobre la de trabajo**: `SELECT count(*) FROM movements WHERE item_id = <id>` antes y después de un `DELETE FROM items WHERE id = <id>` sobre una copia. Si el historial desaparece, está confirmado. Anotarlo como riesgo de esquema, no como fallo de la interfaz. | Sospechado | Alta |
| **R-16** **El `404` dice dos cosas distintas según por dónde se pida.** La ruta propia de movimientos responde `Artículo no encontrado` (`src/routes.ts:190`) y el `crudRouter` responde el genérico `No encontrado` (`crud.ts:261,298,316,320`). Para quien integra las dos rutas, el mismo error llega con dos textos; para quien prueba, es la forma de distinguir de un vistazo si el `404` vino del CRUD o de la ruta del producto. Un `GET` a un id inexistente nunca devuelve `403`, a propósito (`crud.ts:252`). | `products/inventario/src/routes.ts:190`, `packages/product-runtime/src/crud.ts:252,261,298,316,320` | `GET /api/items/id_inexistente` y `POST /api/items/id_inexistente/movements`, y comparar los dos cuerpos. Con un id de otra organización, los dos dan `404` y no `403`. `INV-API-03` e `INV-MOV-06`. | Confirmado | Baja |
| **R-17** **El `LIKE` de la búsqueda no es insensible a mayúsculas con tilde.** El `crudRouter` arma `%término%` sin `COLLATE NOCASE` ni `lower()` (`crud.ts:205-210`), y el `LIKE` de SQLite solo iguala mayúsculas y minúsculas en el rango ASCII: `ACEITE` encuentra `Aceite hidráulico 5W-30 1L`, pero `articulo` **no** encuentra `Artículo` y `ano` no encuentra `Año`. El `placeholder` dice `Buscar por nombre o SKU` y no avisa de nada. | `packages/product-runtime/src/crud.ts:205-210`, `products/inventario/src/routes.ts:306` | Crear `QA-INV-2026 Artículo de prueba` y buscar `articulo`: si `total` es 0 y con `Artículo` es 1, está confirmado. El código está leído; que SQLite iguale solo ASCII es comportamiento documentado de `LIKE` y lo confirma el caso. `INV-BUS-02`. | Sospechado | Baja |

**Cómo se cierra cada uno.** `R-01`, `R-03`, `R-05`, `R-08`, `R-10`, `R-11`, `R-13` y `R-16` son
defectos o trampas que se anotan **con el caso que los confirma**. `R-02`, `R-04`, `R-06`, `R-07`,
`R-09`, `R-12`, `R-14` y `R-17` son comportamiento real que hay que registrar como tal, porque son
decisiones de este producto que no se explican en pantalla y de las que alguien se va a quejar. Los
tres `Sospechado` (`R-07`, `R-14`, `R-15`) dependen del comportamiento del navegador, del
momento del repintado o de una operación que **ninguna ruta permite**, así que su confirmación
puede quedar en `BLOQUEADO` y hay que decirlo en la §9 en vez de darlos por buenos. `R-15` es el
único de severidad `Alta` y el único que no se puede reproducir desde la interfaz. Ninguno de los
17 se corrige desde el plan: el plan los prueba.

---

## 8. Checklist visual

Recorrer una vez por cada panel, en 1280 × 800 y en 390 × 844. Marcar cada ítem. Los objetivos que
no existen en `public/index.html` (los que arma `app.js` al abrir el diálogo) solo se pueden mirar
con el diálogo abierto.

**Canal lateral y barra superior**

- [ ] `#tabs` tiene **3** entradas: `Artículos`, `Movimientos` y `Ajustes`, con los títulos de
      sección `Almacén` y `Configuración`, y el `data-tab` de cada una (`public/index.html:32-41`).
- [ ] Solo el enlace activo lleva `aria-current="page"`, los tres se alcanzan con teclado, y solo
      su `section[data-panel]` queda visible (`amigo.js:96-109`).
- [ ] El `h1[data-amigo="titulo"]` dice `Artículos`, `Movimientos` o `Ajustes` según el panel, y
      `data-amigo="empresa"`, `usuario`, `correo` y `avatar` traen los de `/api/inicio`, con
      iniciales en el avatar y `IN` en `data-amigo="logo"`.
- [ ] `data-amigo="otras"` y `data-amigo="otras-titulo"` quedan ocultos con una sola herramienta y
      muestran un enlace con la otra cuando hay dos (`amigo.js:72-92`).
- [ ] `#buscar` y `#nuevo` están en `.ui-topbar` y **no** dentro de ningún panel; `#buscar` es
      `type="search"` con placeholder `Buscar por nombre o SKU` y `#nuevo` dice `Nuevo artículo`.
- [ ] Cambiar de panel con el canal **no genera ninguna petición** y aun así el panel ya está
      pintado: es correcto acá, es el cero de `INV-REG-01`, y no el síntoma del defecto de
      `alEntrar`.
- [ ] `Salir` apunta a `/auth/logout` y la salida la resuelve el Core.

**Panel Artículos**

- [ ] `#resumen` muestra **4** `.ui-kpi` sin stock bajo y **5** con él, en el orden `Artículos`,
      `Unidades`, `Valor de stock`, `Movimientos` y la de stock bajo. Contarlas, no suponer.
- [ ] Las cuatro primeras tienen la etiqueta arriba y la cifra abajo, y **la quinta está al revés**:
      la cifra grande es la palabra `Revisar` y el texto `n artículos en stock bajo` va de etiqueta
      (riesgo `R-10`). Mirar las dos y anotarlo tal cual está.
- [ ] Solo la quinta cifra lleva `ui-kpi__cifra--acento`, y `Revisar` **no** es un enlace: hacer
      clic y comprobar en Network que no sale ninguna petición (riesgo `R-10`).
- [ ] Las cinco tarjetas caben en `.ui-rejilla--4`: envuelven en dos filas y ninguna desborda
      (`amigo.css:335-336`).
- [ ] `#filas` tiene 6 columnas en este orden: `Nombre`, `SKU`, `Stock`, `Unidad`, `Precio` y la de
      acciones, cuyo encabezado está vacío (`public/index.html:79-84`).
- [ ] `Stock` muestra el número con separador de miles y, si está en stock bajo, ` (mín N)` en un
      `<small class="tenue">` al lado; `SKU` vacío muestra `—`; `Unidad` vacía **no** muestra nada.
- [ ] `Stock` y `Precio` tienen el `<th>` alineado a la derecha y la celda a la izquierda: es el
      desajuste de `R-12`, marcarlo a propósito y no "arreglarlo" durante la prueba.
- [ ] Los importes salen con el símbolo de `settings.currency`, un espacio, separador de miles es-CL
      y **sin decimales** (`$ 120`, `€ 1.066`): comprobar que un precio con centavos no los muestra
      (riesgo `R-07`).
- [ ] La celda de acciones trae `Editar`, `Mover` y `Baja` en ese orden, con `Mover` chico y `Baja`
      chico fantasma. Con `member` falta `Editar` y sobran `Mover` y `Baja` (riesgo `R-01`).
- [ ] Con lista vacía, `#filas` muestra una fila con `colspan="6"` y el texto
      `Todavía no hay artículos. Creá el primero.` (`public/app.js:92`).
- [ ] **La tabla no está dentro de un `.ui-tabla-scroll`**: este producto no usa `cajaTabla`, así
      que el `overflow-x: auto` de `amigo.css:536-544` no existe. A 390 px la tabla se sale y el
      desplazamiento horizontal es **del documento**, no de la tabla. Medir y anotarlo.

**Panel Movimientos**

- [ ] `#movimientos` tiene 5 columnas: `Delta` (la única con `.num` en el encabezado), `Artículo`,
      `Motivo`, `Quién` y `Cuándo`; al lado, el rótulo `Los 40 más recientes`
      (`public/index.html:97-107`).
- [ ] `Delta` sale como etiqueta: `+20` con `ui-etiqueta--ok` y `−8` con `ui-etiqueta--malo`, con
      signo solo en los positivos.
- [ ] `Quién` trae el nombre de la sesión y `—` si no hay `actorName`; `Artículo` trae `—` si el
      nombre no se resolvió; `Cuándo` sale como `5 oct 2026 14:03`, **en la zona del navegador**, sin
      decir cuál es.
- [ ] Con lista vacía, `colspan="5"` y el texto `Sin movimientos todavía.` (`public/app.js:125`).
- [ ] La tabla de 5 columnas sí cabe a 390 px; es la de 6 la que no.

**Diálogo `#dialogo`**

- [ ] `#nuevo` y `Mover` abren el mismo `#dialogo` con `showModal()`: fondo atenuado, foco dentro y
      `Esc` cierra sin preguntar nada (`public/app.js:230`).
- [ ] `#titulo` dice `Nuevo artículo`, `Editar <nombre>` o `Mover stock de <nombre>` según el
      botón que lo abrió.
- [ ] El formulario de artículo tiene exactamente cinco campos —`c_name`, `c_sku`, `c_minQuantity`,
      `c_unit`, `c_priceCents`—, solo `c_name` es `required`, y **no hay ningún campo de cantidad**:
      esa ausencia es la invariante del producto (`public/app.js:249-261`).
- [ ] El de movimiento tiene dos: `c_delta` con el rótulo exacto
      `Cantidad (negativa para salir)`, `type="number"`, `step="1"`, `required` y **sin `min`**, que
      es lo que permite los negativos; y `c_reason` con `Motivo` y `required`. No hay ningún select
      de tipo de movimiento (`public/app.js:283-284`).
- [ ] `Cancelar` (`value="cancelar"`) y `Guardar` (`value="guardar"`, `#guardar`) están siempre, y
      al guardar bien **no** aparece ningún aviso (riesgo `R-02`).
- [ ] `#c_priceCents` muestra centavos en crudo (`12000`) mientras la tabla muestra pesos
      (`$ 120`): la diferencia tiene que notarse al mirar los dos (riesgo `R-07`).
- [ ] `#c_minQuantity` y `#c_unit` nacen con los defaults de los ajustes y `#c_priceCents` en `0`.
- [ ] `#error` aparece con el mensaje del `400` y el diálogo reabre con lo escrito; con un `400` de
      stock insuficiente, el texto trae la unidad del artículo.

**Panel Ajustes**

- [ ] `?panel=configuracion` muestra `#config-form` con el título `Ajustes del almacén`, el párrafo
      que manda la razón social a AMG, tres campos, `[data-err]`, `#sembrar` y `Guardar cambios`
      (`public/index.html:117-150`).
- [ ] Los tres campos son `required`: `#defaultUnit` con `maxlength="30"`, `#defaultMinQuantity` con
      `min="0" step="1"` y `#currency` con `maxlength="5"`. Traen los valores del `GET`, no
      constantes.
- [ ] Guardar deja `[data-err]` vacío y rehabilita el botón, y **no** repinta `Precio` ni
      `Valor de stock` hasta que algo dispare un `cargar()` (riesgo `R-14`).
- [ ] `#sembrar` se ve solo con `admin` u `owner` y con `seedAvailable: true`, y su texto es
      `Cargar datos de ejemplo`; con `member` queda oculto y **los tres campos siguen escribibles**
      (riesgo compartido `R-S-05`).

**Responsive, consola y peticiones**

- [ ] A 390 × 844, `document.documentElement.scrollWidth` es menor o igual a 390. Hoy **no** se
      cumple (`R-S-01` compartido): `.ui` no define el área `canal` por debajo de 900 px
      (`amigo.css:136-153`). Medir el valor exacto y anotarlo.
- [ ] A 390 × 844 se llega a los tres paneles por el canal y ninguno queda cortado.
- [ ] `#dialogo` entra entero a 390 px: ningún campo con `scrollWidth > 390`.
- [ ] A 640, 1000 y 1280 px no hay salto de layout ni tarjeta desbordada en `#resumen`.
- [ ] Consola limpia en el recorrido completo, con filtro `error` y también `warn`: en especial al
      provocar `400`, `403` y `500`, y al mover stock con el diálogo abierto.
- [ ] Network: **6** peticiones de datos en la carga inicial (`/api/inicio`, `/api/me`,
      `/api/resumen`, `/api/items?q=`, `/api/movements?limit=40`, `/api/settings`), **cero** por
      cambio de panel, **6** por cada alta, edición, movimiento o baja (una escritura más las cinco
      de `cargar()`, ver `INV-MOV-11`) y **1** por guardar ajustes, que no repinta (riesgo `R-14`).
- [ ] Una búsqueda terminada es **una** sola petición a `/api/items?q=`: el `oninput` espera 250 ms
      sin teclear (`public/app.js:307-312`). Escribir rápido tiene que dar menos peticiones que
      caracteres, y una búsqueda con error **no** puede dar cero peticiones visibles (riesgo `R-11`).
- [ ] `/health` y `/api/meta` responden sin sesión; `/favicon.ico` da `404` sin romper la página.

---

## 9. Registro

Una fila por caso ejecutado, en el orden en que se ejecutó. **Dejar vacía hasta la primera vuelta
real**: nada de esta §7 está verificado todavía. `Resultado` es `PASA`, `FALLA` o `BLOQUEADO`, y
`BLOQUEADO` es para el caso que no se pudo ejecutar por falta de una segunda organización, de una
segunda sesión `admin`, de `NODE_ENV=production` o por el límite de 600 peticiones; en ese caso la
`Nota` dice qué faltó. Cuando el caso sea el que confirma un riesgo, el `R-` va en `Nota`; cuando
haya corte de sesión o `429`, eso también va en `Nota` (convenciones 5.1 y 5.4). Anotar siempre el
entorno, porque los resultados de `INV-REG-05` cambian entre desarrollo y producción.

**Primera vuelta transversal · 2026-10-06 · producción `inventario.amgdeveloper.cl` · SSO owner.** Solo casos ejecutados; transversal en Doc 10 §9.

| ID | Resultado | Evidencia | Nota |
|---|---|---|---|
| INV-NAV-01 | PASA | Arranque: exactamente 6 peticiones `/api/` — `inicio`, `me`, `resumen`, `items?q=`, `movements?limit=40`, `settings` — todas 200 | Coincide con la expectativa del caso (6 exactas). |
| INV-NAV-02 | PASA | Tras el arranque, clic en Artículos/Stock/Movimientos/Ajustes → **0 peticiones nuevas**; paneles con contenido pintado desde `estado` | Diseño documentado: `montar` sin `alEntrar`; el contenido ya está en memoria. No es falla de shell en este producto. |
| INV-NAV-03 | PARCIAL | `?panel=movements` y demás deep-links cambian el panel y muestran datos | No se repitió el barrido completo de los 7 paneles por URL. |
| INV-NAV-06 | PASA | Tras cada clic: un `[aria-current="page"]`, un `[data-panel]` sin `hidden`, `h1` correcto | |
| INV-API-01 | PARCIAL | `GET /api/items` → `{items,total,limit,offset}`; `GET /api/movements` → `{movements}` (sin envoltorio, hallazgo nuevo) | Rutas propias de inventario (`/api/dashboard`, `/api/movements`) fuera de `crudRouter`. |
| INV-API-03 | PASA | `GET/PATCH/DELETE` inexistente → `404 {"error":"No encontrado"}` | El texto es "No encontrado" (como predice el plan), no "No existe" (como decía Doc 10). |
| INV-API-05 | PARCIAL | `limit=5000`→`1000` ✅; `limit=0`→default 200 ✅; `limit=-5`→ ecoa `limit:-5` con todas las filas; POST `{` → `500 {"error":"Error interno del servidor"}` (05.6 ✅ comportamiento) | El `-5` no se normaliza (R-S-05). El 500 confirma R-S-03 en producción. |
| INV-LST-01 | FALLA | KPI de tablero pinta `$ 14.530` (clase `ui-kpi__cifra`, con espacio); shared `dinero(1453000)` = `$14.530` sin espacio y con formato CLP uniforme | R-S-08: tres formatos de dinero en el portfolio (inventario/activos/pagos ≠ shared). |
| INV-SIST-02 | FALLA | Sin sesión: `/`,`/app.js`,`/style.css` → 302; **`/amigo.css` → 200 público** (cotizaciones/crm/activos); `/api/*` → 401 | 401 sin campo `message` (Doc 10 REG-SES-01). Fuga de `amigo.css` en 3 productos. |
| INV-SIST-06 | PARCIAL | Headers `RateLimit` draft-7 presentes; ráfaga en pagos: `429` + 23×`503` + episodio transitorio de `404` en todas las rutas API (recuperó al recargar) | Límite no uniforme (600 vs 1000 en ventanas distintas). |
| INV-SIST-07 | FALLA | Clic `Salir` → `302` `desarrollo.amgdeveloper.cl/api/logout?redirect=…` → **`404 {"error":"No existe GET /api/logout"}`**; sesión sigue viva | Core sin ruta de logout. Rompe REG-SES-07 y REG-UI-07 en los nueve productos. |
