# Plan de pruebas — Cotizaciones

Presupuestos que se leen solos: cada línea tiene su importe congelado, el total se materializa
al escribir y no se recalcula al leer, y el estado avanza por una sola puerta que además sella
cuándo se mandó y cuándo se aceptó. El sujeto que se bloquea es el **folio**, y es por
organización, no global: dos empresas pueden tener cada una su cotización número 1.

Este plan se **diseña**, no se ejecuta. Cada caso dice qué hacer y qué se espera, no qué se
observó. Las reglas de sesión, la anatomía del caso y el checklist visual están en
`00-CONVENCIONES.md`.

Todo lo afirmado aquí sale de leer el código: `products/cotizaciones/src/routes.ts`,
`src/schema.ts`, `src/ddl.ts`, `public/index.html`, `public/app.js` y
`products/cotizaciones/tests/cotizaciones.test.ts`. Cuando algo no se pudo confirmar leyendo,
está marcado *sospechado* y se dice dónde mirar.

---

## 1. Ficha técnica

| Qué | Valor |
|---|---|
| Slug | `cotizaciones` |
| Nombre | Cotizaciones |
| Dominio | `cotizaciones.amgdeveloper.cl` |
| Puerto de desarrollo | `PORT=3021` en `products/cotizaciones/.env.example`, pero el `.env` local de esta máquina dice `PORT=3004` (ver `COT-SIST-02`) |
| Puerto publicado detrás de nginx / Docker | `3104` (`README.md:45`, `ops/nginx.conf:40`, `docker-compose.yml:29`) |
| Script de desarrollo | `npm run dev:cotizaciones` (raíz) → `npm run dev -w @amg/cotizaciones` → `tsx watch src/index.ts` |
| Script de pruebas | `npm test -w @amg/cotizaciones` (`vitest run`, `products/cotizaciones/tests/cotizaciones.test.ts`, 54 casos) |
| Ruta local | `products/cotizaciones` |
| Base de datos | `DB_PATH=./data/cotizaciones.sqlite` en `.env.example`; el `.env` local apunta a `./data/app.db`. `data/` está en `.gitignore` |
| Versión de esquema declarada | `DB_SCHEMA_VERSION=1` en `.env.example` |
| Core (identidad) | `CORE_URL=http://localhost:3108`, `APP_URL=http://localhost:3023` (los dos valores del `.env.example` son distintos entre sí) |
| Credenciales SSO | `AMG_SSO_CLIENT_ID=cotizaciones`; el secreto lo entrega el Core con `npm run sso:secret -w @amg/platform -- cotizaciones` |
| Acento del producto | `--acento: #b0403a`, `--acento-fuerte: #8b2f2a`, `--acento-tenue: #fbedec` (`public/style.css:19-24`) |
| Logo en el canal | `CQ` en el HTML, pero se ve `CO` (ver `COT-NAV-07` y `R-12`) |
| Tablas propias | `quotes`, `quote_lines`, `settings`. **No** hay `customers`: el cliente es del producto `crm` y aquí solo se copia el nombre |
| Casos de prueba | 97 casos agrupados por bloque (`NAV`, `INICIO`, `LIST`, `ALTA`, `LINE`, `EDIT`, `EST`, `AJUST`, `AUS`, `SIST`, `E2E`, `REG`) |

**Los tres paneles.** `AMIGO.montar({ nombre: 'Cotizaciones', paneles: ['inicio','cotizaciones','ajustes'], alEntrar: () => conAviso(pintar) })` (`public/app.js:424`). El canal los declara en `#tabs` con
`data-tab="inicio"`, `data-tab="cotizaciones"` y `data-tab="ajustes"`, y la sección activa viaja
en la URL como `?panel=<clave>`.

Qué repinta cada panel (`public/app.js:406-410`):

| Panel | Al entrar |
|---|---|
| `inicio` | pide `GET /api/dashboard` y pinta `#resumen` y `#abiertas` |
| `cotizaciones` | pinta la tabla desde la lista en memoria, **sin ninguna petición** |
| `ajustes` | no hace nada: el formulario ya lo llenó `renderConfig()` dentro de `cargar()` |

**Roles.** La identidad trae `owner`, `admin` o `member`, y nada más
(`packages/auth-client/src/identity.ts:4`). Como `requireRole('member')` es el mínimo que
exige el producto y `member` es el rol más bajo, en la práctica **toda escritura de
Cotizaciones la puede hacer cualquier usuario con sesión**:

| Superficie | Rol mínimo |
|---|---|
| Lecturas (`/api/dashboard`, `/api/quotes`, `/api/quotes/:id`, `/api/quotes/:id/lineas`, `/api/quotes/next-number`, `/api/settings`) | ninguno: cualquiera con sesión |
| `POST /api/quotes`, `PATCH /api/quotes/:id`, `POST /api/quotes/:id/estado` | `member` explícito (`src/routes.ts:308, 477, 491`) |
| `DELETE /api/quotes/:id` | `member`, por defecto del `crudRouter` (`packages/product-runtime/src/crud.ts:174, 185`) |
| `PUT /api/settings` | **sin chequeo de rol** (`src/routes.ts:548`) |

**Rutas de API.** Todas bajo el runtime compartido salvo `/health`, `/api/meta`, `/api/me` y
`/api/inicio`. El orden importa: el `POST`, el `PATCH` y el cambio de estado se declaran **antes**
del `crudRouter` y por eso son los que atienden (`src/routes.ts:266-271`).

| Ruta | Método | Rol | Respuesta |
|---|---|---|---|
| `/api/dashboard` | GET | — | `{ total, porEstado, totalCents, mesCents, mes }` |
| `/api/quotes/next-number` | GET | — | `{ number }` (entero) |
| `/api/quotes/:id/lineas` | GET | — | `{ lines: [...] }` |
| `/api/quotes/:id/estado` | POST | `member` | `{ quote }` |
| `/api/quotes` | POST | `member` | `201 { quote, lines }` — **acepta `status` en el cuerpo** |
| `/api/quotes/:id` | PATCH | `member` | `200 { quote, lines }` — **`status` se descarta a mano** |
| `/api/settings` | GET | — | `{ settings: { currency, timezone, defaultTaxRateBp, validityDays, nextNumber } }` |
| `/api/settings` | PUT | ninguno | `{ settings }` — **sin `nextNumber`** |
| `/api/quotes` | GET (`crudRouter`) | — | `{ items, total, limit, offset }`, busca con `?q=`, orden descendente por `number` |
| `/api/quotes/:id` | GET (`crudRouter`) | — | fila cruda, o `404 {"error":"No encontrado"}` |
| `/api/quotes/:id` | DELETE (`crudRouter`) | `member` | `{ ok: true, deleted: true }` |

**Los sobres no son todos iguales** y por eso confunden (`tests/cotizaciones.test.ts:27-30`):
el listado y la lectura los resuelve el `crudRouter` (`{ items }` al listar, la fila pelada al
leer); las rutas propias van envueltas en `{ quote }`, `{ lines }`, `{ quote, lines }` y
`{ settings }`.

**El folio es un entero.** El campo se llama `number`, es un entero entre 1 y `9_999_999`
(`src/routes.ts:135`) y es único **por organización** (`uniqueIndex` sobre
`(organization_id, number)`, `src/schema.ts:101`). No lleva prefijo ni relleno de ceros en
ningún lado. Lo que el usuario ve es el entero con un `#` adelante, y nada más:

| Dónde | Texto visible | Código |
|---|---|---|
| Tabla de `?panel=cotizaciones`, columna `Folio` | `#12` | `public/app.js:173` |
| Ficha de `#abiertas` | `#12 · QA-COT-2026 Ana Torres` | `public/app.js:132` |
| Título del diálogo | `Cotizacion #12` | `public/app.js:292` |
| `#cfg-folio` de Ajustes | `13` (a secas) | `public/app.js:453` |
| Valor real en la API | `12` (número, no texto) | `src/schema.ts:60` |

Un documento que diga que el número visible es `COT-000123` está describiendo otro producto.

**`nextNumber` no es un ajuste guardado.** Es el **mayor folio que existe más uno** de esa
organización (`folioSiguiente`, `src/routes.ts:196-203`), calculado al vuelo y agregado a la
respuesta de `GET /api/settings` (`src/routes.ts:544`). En una organización sin cotizaciones
arranca en `1`. No se puede escribir: el `PUT /api/settings` no lo acepta entre sus campos
(`src/routes.ts:552-558`) y la nota de `index.html:127-129` lo dice en pantalla. No es «contar
filas y sumar uno»: si se borra la última cotización, contar daría un folio que ya existe.

**Puntos básicos.** `taxRateBp` y `defaultTaxRateBp` están en **puntos básicos**: 1600 = 16%,
10000 = 100%. El impuesto es `Math.round(subtotalCents * taxRateBp / 10_000)` sobre el subtotal
**ya redondeado**, una sola vez (`src/routes.ts:376-379`). Los dos inputs de la interfaz
(`#cfg-impuesto` y `#cot-impuesto`) van de `min="0"` a `max="10000"` con `step="1"`
(`index.html:119, 192`) y las dos etiquetas dicen literalmente
`Impuesto ... (puntos basicos, 1600 = 16%)`. **La interfaz muestra el número crudo de puntos
básicos, nunca el porcentaje dividido**: entrar `16` no es 16%, es 0,16%. El único sitio donde
el número aparece dividido por 100 es la fórmula del cálculo.

**Estados.** Cinco, en el orden en que se avanzan (`src/routes.ts:79`): `draft`, `sent`,
`accepted`, `rejected`, `expired`. Traducción de la interfaz (`public/app.js:31-37`): `Borrador`
(neutro), `Enviada` (acento), `Aceptada` (ok), `Rechazada` (malo), `Vencida` (neutro).

| Desde | Destinos permitidos |
|---|---|
| `draft` | `sent`, `expired` |
| `sent` | `accepted`, `rejected`, `expired` |
| `accepted` | ninguno: terminal |
| `rejected` | ninguno: terminal |
| `expired` | `sent` |

La tabla está duplicada literalmente en `public/app.js:40-46`, y el servidor valida contra la
suya (`src/routes.ts:94-100`). El único camino para mover el estado es
`POST /api/quotes/:id/estado`.

**Lo que este producto NO tiene.** No hay PDF, ni enlace público, ni plantillas, ni secciones de
plantilla, ni endpoint de reordenamiento de secciones, ni CRUD de clientes, ni pantalla de
clientes, ni búsqueda de un cliente contra el producto `crm`. Ninguna tabla ni ninguna ruta de
`src/routes.ts`, `src/schema.ts` o `src/ddl.ts` las menciona. La sección 4.9 lo prueba con
casos negativos `404` explícitos, y la sección 7 lo lista como riesgo de alcance.

---

## 2. Datos de prueba

**El producto no siembra nada.** `products/cotizaciones/src/app.ts` no declara `seed`, y el
comentario explica por qué: los datos de ejemplo pertenecen a una organización, y esa
organización solo existe cuando hay una sesión real. En una base recién creada la pantalla
arranca vacía y hay que crear todo a mano.

**Base de trabajo.** Usar una organización de pruebas del Core propia de QA, para no ensuciar
datos reales. Todo lo que se cree lleva el prefijo `QA-COT-<fecha>` en los campos de texto
(`customerName`, `title`, `notes`), según la convención 5.5. **Nunca sembrar con `INSERT`
directo**: la numeración de folios, los importes materializados y los sellos de estado se
calculan en el servidor, y una fila insertada a mano no los tiene.

**Catálogo mínimo para que los flujos tengan sentido.** Crear con la interfaz (secciones 4.4 y
4.8), en este orden:

| Dato | Dónde | Valor sugerido |
|---|---|---|
| Ajustes | `?panel=ajustes` | moneda `$`, zona `America/Santiago`, impuesto `1600`, vigencia `30` |
| Cotización base | `#cotizacion-nueva` | cliente `QA-COT-2026 Ana Torres`, emisión hoy, 2 líneas |
| Línea 1 | dentro del diálogo | `QA-COT-2026 Logo y tarjetas`, cantidad `2`, precio `25000` |
| Línea 2 | dentro del diálogo | `QA-COT-2026 Traslado`, cantidad `3`, precio `1234` |
| Cotización vacía | `#cotizacion-nueva` | cliente `QA-COT-2026 Sin detalle`, sin líneas |
| Cotización fraccionaria | `#cotizacion-nueva` | cliente `QA-COT-2026 Media hora`, línea cantidad `0.5`, precio `3333` (solo por API: ver `COT-LINE-06`) |

**Cartera para los cinco estados.** Con la misma sesión, mover la cotización base por
`draft → sent → rejected` y crear las otras con `POST /api/quotes` (sección 4.7). Con eso el
panel de Inicio tiene las cinco columnas pobladas y la lista tiene una fila de cada estado.

**Contraparte en otra organización.** Para `COT-SIST-05` hace falta una **segunda organización**
con suscripción a `cotizaciones`, con una cotización `QA-COT-2026 AJENA` de importe alto
(línea `999999` centavos) para que se note si se filtra.

**Limpieza al terminar.** Borrar las cotizaciones `QA-COT-*` con el botón `Borrar` de la tabla
y restaurar los ajustes a moneda `$`, zona `America/Santiago`, impuesto `0`, vigencia `30`.

---

## 3. Precondiciones

1. El Core está arriba: `npm run dev:core` (puerto `3108`) y responde `GET /health` con
   `200 {"ok":true}`.
2. El producto está arriba: `npm run dev:cotizaciones`. La primera línea del log dice
   `Cotizaciones (cotizaciones) en <APP_URL> -> puerto <PORT>`; **anotar ese puerto**, porque
   el `.env` local de esta máquina dice `3004` y el `.env.example` dice `3021` (ver
   `COT-SIST-02`).
3. La organización de QA tiene la suscripción a `cotizaciones` activa. Sin ella, el middleware
   responde `403` con `{ "error": "sin-acceso" }` y mensaje `Tu organización no tiene acceso a
   este producto.` (`packages/auth-client/src/middleware.ts:98`,
   `packages/auth-client/src/login.ts:52`).
4. **No hay login local.** Este producto no pide usuario ni contraseña: la sesión vive en el
   Core. Se entra por `desarrollo.amgdeveloper.cl` (puerto `3108`) y el Core devuelve al
   producto. Que el producto redirija al login del Core es el flujo correcto, no un error de
   Auth (convención 5.3). El HTML se sirve **después** de la identidad: sin sesión no baja ni el
   documento (`tests/cotizaciones.test.ts:79-83`).
5. Tester tipea sus credenciales. Nunca se le piden ni se anotan (convención 5.2).
6. **La sesión dura 15 minutos.** Al expirar, cualquier `/api/*` responde
   `401 {"error":"sin-sesion","message":"Tu sesión no está iniciada.","loginUrl":"…"}` y el
   navegador salta al login del Core. Volver a entrar y anotar el corte en la sección 9; no es
   un defecto del producto (convención 5.1).
7. **Límite de tasa: 600 peticiones / 15 min por IP**
   (`packages/product-runtime/src/app.ts:100-106`, `windowMs: 15 * 60 * 1000`, cabeceras
   `draft-8`). Un `429` no es un defecto: se anota y se espera (convención 5.4). Este producto
   es barato: la primera carga son 4 peticiones y cambiar de pestaña, ninguna o una.
8. Cada caso que dependa de otro lo referencia por ID en **Precondición**.
9. Para los casos de API: DevTools abierto, pestaña **Network**, filtro de fetch/XHR activado,
   y `Copy as fetch` para reproducir una petición desde la consola. Todos los cuerpos de
   ejemplo de este documento están en **centavos**: `unitPriceCents: 25000` es $250.

---

## 4. Casos por módulo

### 4.1 Navegación, paneles y deep-link — `#tabs`, `?panel=`

| | |
|---|---|
| **ID** | COT-NAV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/` y esperar la carga.<br>2. En Network, filtrar `/api/` y ordenar por tiempo.<br>3. Leer `h1[data-amigo="titulo"]`, la entrada activa de `#tabs` y las tres secciones `[data-panel]`. |
| **Esperado** | Sin `?panel=`, entra el panel `inicio`. Salen, en este orden: 1 `GET /api/inicio`, 1 `GET /api/dashboard` (del `mostrar()` de `montar`), 1 `GET /api/quotes?limit=500` y 1 `GET /api/settings` (del `cargar()` del final de `app.js`), y un **segundo** `GET /api/dashboard` al terminar `cargar()`. Todas `200`. `#resumen` y `#abiertas` quedan visibles; `[data-panel="cotizaciones"]` y `[data-panel="ajustes"]` quedan con `hidden`. `h1` dice `Inicio`. Ver `R-13` sobre el doble pintado de Inicio. |

| | |
|---|---|
| **ID** | COT-NAV-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Cargar `/?panel=cotizaciones`.<br>2. Cargar `/?panel=ajustes`.<br>3. En cada una, leer `h1` y qué sección quedó sin `hidden`. |
| **Esperado** | `?panel=cotizaciones` entra directo a la tabla, con `h1` = `Cotizaciones`, sin recargar. `?panel=ajustes` entra al formulario, con `h1` = `Ajustes`, y `#cfg-moneda`, `#cfg-zona`, `#cfg-impuesto` y `#cfg-vigencia` ya traen los valores de `GET /api/settings`. El deep-link funciona porque `panelDeUrl` lee el query antes de la primera pintura (`packages/product-runtime/public/amigo.js:40-43, 141-163`). |

| | |
|---|---|
| **ID** | COT-NAV-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Cargar `/?panel=inventario`.<br>2. Cargar `/?panel=` (vacío).<br>3. Cargar `/?panel=COTIZACIONES` (mayúsculas). |
| **Esperado** | Las tres caen al **primer** panel declarado, `inicio`. `panelDeUrl` solo acepta claves que estén en el arreglo `paneles`; cualquier otra cae a `paneles[0]`. No hay mensaje de error ni panel en blanco: es el comportamiento correcto del shell, no un defecto. |

| | |
|---|---|
| **ID** | COT-NAV-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con cotizaciones de prueba. |
| **Pasos** | 1. Pulsar la entrada `Cotizaciones` de `#tabs`.<br>2. Pulsar `Ajustes`.<br>3. Pulsar `Inicio`.<br>4. Usar Atrás y Adelante del navegador.<br>5. Mirar la URL y la lista de peticiones en cada paso. |
| **Esperado** | La URL pasa a `?panel=cotizaciones`, `?panel=ajustes`, `?panel=inicio` con `history.pushState`, **sin recargar la página**: `app.js`, `amigo.js` y `style.css` no se vuelven a pedir. Solo la entrada activa lleva `aria-current="page"`. Atrás y Adelante repintan por `popstate`. Volver a Inicio pide `GET /api/dashboard` otra vez; ir a Cotizaciones o Ajustes **no pide ninguna**. |

| | |
|---|---|
| **ID** | COT-NAV-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Con `#filtro-estado` = `Aceptada`, escribir `QA` en `#buscar`.<br>2. Ir a `?panel=ajustes` y guardar los ajustes sin cambiar nada.<br>3. Volver a `?panel=cotizaciones` y leer `#filtro-estado`. |
| **Esperado** | El filtro por estado **sobrevive** al guardado de ajustes. El arreglo de opciones se arma una sola vez, con el flag `filtroArmado` (`public/app.js:414-422`): si se rearmara en cada `cargar()`, el `replaceChildren` borraría la selección del usuario sin avisar. La búsqueda en `#buscar` **tampoco** se borra: `renderConfig()` solo recorre `#config-form`. |

| | |
|---|---|
| **ID** | COT-NAV-06 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Recorrer los tres paneles y verificar dónde aparece `#cotizacion-nueva`.<br>2. En móvil, comprobar si tapa algo. |
| **Esperado** | El botón `#cotizacion-nueva`, con el texto `Nueva cotización`, vive en `ui-topbar__acciones` (`index.html:62-64`), o sea **fuera** de las tres secciones: está visible en los tres paneles. Es el mismo botón para crear y no depende de la pestaña. Anotar si en 390 px el botón y el `h1` se pisan. |

| | |
|---|---|
| **ID** | COT-NAV-07 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Leer el texto de `.ui-logo[data-amigo="logo"]` en el HTML servido.<br>2. Leer el mismo elemento en pantalla, después de que termine la carga.<br>3. Repetir con `document.title`. |
| **Esperado** | El HTML trae `CQ` (`index.html:29`), pero en pantalla se ve **`CO`**: `pintarCuenta` sobreescribe el texto con las iniciales de `document.title`, que es `Cotizaciones` (`packages/product-runtime/public/amigo.js:65-67`). El `CQ` del markup nunca llega a verse. Registrar si se considera defecto cosmético (`R-12`). |

### 4.2 Inicio — panel `inicio`

Selectores: `#resumen` (las tarjetas KPI) y `#abiertas` (la lista «Pendientes de respuesta»).

| | |
|---|---|
| **ID** | COT-INICIO-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cartera con al menos una de cada estado de la sección 2. |
| **Pasos** | 1. Abrir `?panel=inicio`.<br>2. Leer las cinco tarjetas de `#resumen`, en orden: qué texto va en `.ui-kpi__cifra` y qué texto en `.ui-kpi__etiqueta`.<br>3. Comparar con `GET /api/dashboard`. |
| **Esperado** | Se pintan **cinco** tarjetas, en este orden de origen: `d.total`, `d.porEstado.sent`, `d.porEstado.accepted`, `d.mesCents`, `d.totalCents`. **Con los textos invertidos**: `.ui-kpi__cifra` (la cifra grande) recibe el **segundo** elemento de cada fila y `.ui-kpi__etiqueta` el primero (`public/app.js:106-112` contra `packages/product-runtime/public/amigo-ui.js:238-259`, que documenta `[etiqueta, valor, esAcento]` y hace `cifra.textContent = f[1]`). O sea que la tarjeta grande muestra la palabra `Cotizaciones` y la chica el número. Es un defecto de este producto, no del shell: Espacios y CRM llaman a `kpis` con el orden correcto. Además `d.mesCents` se pasa **crudo**, sin `dinero()`, así que la cuarta tarjeta muestra `1234567` en vez de `$12.346,57`. Ver `R-08`. |

| | |
|---|---|
| **ID** | COT-INICIO-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/dashboard`.<br>2. Enumerar las claves del cuerpo y las de `porEstado`.<br>3. Contar a mano las cotizaciones por estado en la base de la organización de QA. |
| **Esperado** | `200` con `{ total, porEstado, totalCents, mesCents, mes }`. `porEstado` trae **las cinco claves siempre**, aunque valgan `0`: `draft`, `sent`, `accepted`, `rejected`, `expired` (`src/routes.ts:247`). `total` cuenta todas las filas de la organización. `mes` es el prefijo `AAAA-MM-DD` de la fecha del servidor en UTC. Los conteos coinciden con el conteo manual. |

| | |
|---|---|
| **ID** | COT-INICIO-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cotización `QA-COT-2026 Sin detalle` (0 líneas, total `0`) en estado `draft`. |
| **Pasos** | 1. Leer la primera fila de `#abiertas`.<br>2. Contar sus botones y anotar el texto de cada uno. |
| **Esperado** | Una `.ui-ficha` con dos textos: `.ui-ficha__titulo` = `#<n> · QA-COT-2026 Sin detalle` y `.ui-ficha__nota` = `Sin titulo` (de `c.title ?? 'Sin titulo'`). Dos botones: `Ver`, que abre el diálogo, y una etiqueta con `dinero(0)` = `$0`. Una cotización sin importe aparece igual: la lista de pendientes no filtra por total. |

| | |
|---|---|
| **ID** | COT-INICIO-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cartera con una cotización en cada uno de los cinco estados. |
| **Pasos** | 1. Leer los títulos de todas las fichas de `#abiertas`.<br>2. Contar cuántas hay y compararlo con `GET /api/dashboard`. |
| **Esperado** | `#abiertas` lista **solo** las `sent` y las `draft` (`public/app.js:116`): son las que no tienen veredicto del cliente. Las `accepted`, `rejected` y `expired` **no** aparecen, ni con `$0` de importe. El total de fichas es `porEstado.sent + porEstado.draft`. |

| | |
|---|---|
| **ID** | COT-INICIO-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, filtro `Todos los estados`. |
| **Pasos** | 1. Poner `#filtro-estado` en un estado sin ninguna cotización, por ejemplo `Aceptada`.<br>2. Volver a `?panel=inicio` y contar las fichas. |
| **Esperado** | `#abiertas` **ignora el filtro**: sigue mostrando las `draft` y las `sent`. El filtro solo existe en `pintarCotizaciones`, que es la tabla del panel `cotizaciones`; el panel Inicio no lo consulta. Registrar si se considera incoherencia de navegación. |

| | |
|---|---|
| **ID** | COT-INICIO-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una cotización `sent` con total `58000` y una `rejected` con total `42000`, ambas del mes en curso. |
| **Pasos** | 1. Leer `totalCents` y `mesCents` de `GET /api/dashboard`.<br>2. Pasar la `rejected` de `accepted`… no: crearla por API con `status: 'rejected'` es imposible; pasarla por `sent → rejected` con `POST /api/quotes/:id/estado`.<br>3. Releer `totalCents` y `mesCents`. |
| **Esperado** | Antes: `totalCents` incluye las dos. Después de rechazar: `totalCents` baja exactamente en `42000` y `mesCents` también, porque las dos sumas excluyen las `rejected` (`src/routes.ts:252-260`). Pero `total` **no** baja: la cotización sigue existiendo y `porEstado.rejected` sube en 1. Rechazar no es borrar ni es dejar de contar. |

| | |
|---|---|
| **ID** | COT-INICIO-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Una cotización emitida en el mes anterior y otra emitida hoy, ambas `sent` y del mismo importe. |
| **Pasos** | 1. Anotar `mesCents` y `mes`.<br>2. Cambiar `#cot-emision` de la cotización de hoy al día 1 del mes anterior y guardar.<br>3. Releer `mesCents`. |
| **Esperado** | `mesCents` baja en el importe de esa cotización. El corte es **por prefijo de texto**, no por zona horaria: `(q.issueDate ?? '').startsWith(mes)` con `mes` en UTC (`src/routes.ts:253-254`). Por eso una cotización con `issueDate` en `null` nunca cuenta para el mes, aunque su total esté en `totalCents`. |

| | |
|---|---|
| **ID** | COT-INICIO-08 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Crear por API una cotización con `"issueDate": null`.<br>2. Comparar su aporte a `totalCents` y a `mesCents`. |
| **Esperado** | Aporta a `totalCents` y **no** a `mesCents`. En pantalla, `#abiertas` la muestra con la fecha que no aparece en ninguna columna, porque el panel Inicio no pinta `issueDate`. Sin fecha no hay forma de saber desde cuándo cotiza. Sin caso propio: se registra en la lista de observación de la sección 8. |

### 4.3 Listado — panel `cotizaciones`

Selectores: `#buscar` (`input[type=search]`, `maxlength="150"`, placeholder
`Folio, cliente o titulo`), `#filtro-estado` (`<select>` **sin opciones en el HTML**: se llenan
en runtime, `public/app.js:415-422`) y `#cotizaciones-lista`.

| | |
|---|---|
| **ID** | COT-LIST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cartera de la sección 2. |
| **Pasos** | 1. Abrir `?panel=cotizaciones`.<br>2. Leer los encabezados de la tabla y una fila completa.<br>3. Comparar el orden de las filas con los folios. |
| **Esperado** | Seis columnas: `Folio`, `Cliente`, `Emision`, `Estado`, `Total`, y una vacía de acciones. Cada fila trae `#<n>`, el nombre del cliente tal cual, `issueDate ?? '—'` **en crudo `AAAA-MM-DD`** (sin pasar por `AMIGO_UI.fecha`), la etiqueta de estado, `dinero(totalCents)` y dos botones: `Ver` y `Borrar`. El folio va alineado a la izquierda y el `Total` a la derecha (`{ num: [4] }`). Orden descendente por folio, que es el `orderBy` del `crudRouter`. |

| | |
|---|---|
| **ID** | COT-LIST-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, `#filtro-estado` = `Todos los estados`, `#buscar` vacío. |
| **Pasos** | 1. Escribir `zzzzz` en `#buscar`. |
| **Esperado** | Una fila de ancho completo con el texto `Todavia no hay cotizaciones.` (`public/app.js:167`), con el `colspan` de las 6 columnas. Es el mismo texto que se usa cuando la lista está realmente vacía: **no** distingue «no hay ninguna» de «el filtro no deja pasar ninguna». Registrar si se considera defecto de redacción. |

| | |
|---|---|
| **ID** | COT-LIST-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cartera con folios 1 a 6 y distintos clientes y títulos. |
| **Pasos** | 1. Escribir en `#buscar` el número de folio de una del medio, por ejemplo `3`.<br>2. Escribir parte del nombre de un cliente.<br>3. Escribir parte de un título.<br>4. Escribir una palabra que solo aparezca en el `customerId`.<br>5. Contar las peticiones a `/api/quotes` en cada paso. |
| **Esperado** | 1: aparece la del folio 3 y solo esa. La búsqueda arma `[String(number), customerName, title]`, lo **une con espacio** y compara con `includes` en minúsculas (`public/app.js:154-161`). 2 y 3: filtran por cliente y por título. 4: **no** filtra nada: `customerId` no participa, y `notes` tampoco. En los cuatro pasos **no sale ninguna petición**: el filtro es 100 % en memoria sobre la lista ya descargada. |

| | |
|---|---|
| **ID** | COT-LIST-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#filtro-estado` con sus opciones ya cargadas. |
| **Pasos** | 1. Enumerar las opciones de `#filtro-estado` con su texto y su `value`.<br>2. Elegir `Rechazada` y contar las filas.<br>3. Elegir `Todos los estados`. |
| **Esperado** | Seis opciones: `Todos los estados` con `value=""`, y luego `Borrador`, `Enviada`, `Aceptada`, `Rechazada`, `Vencida` con `value` `draft`, `sent`, `accepted`, `rejected`, `expired`. El texto es el del mapa `ESTADOS` de `public/app.js:31-37`; el `value` es la clave cruda que va al servidor. Con `Rechazada` solo salen las `rejected`. Sin peticiones: también es en memoria. |

| | |
|---|---|
| **ID** | COT-LIST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cartera con los cinco estados y un cliente cuyo nombre contiene `QA-COT`. |
| **Pasos** | 1. Poner `#filtro-estado` = `Enviada`.<br>2. Escribir `QA-COT` en `#buscar`.<br>3. Leer `#filtro-estado` y `#buscar`. |
| **Esperado** | Los dos filtros se combinan con Y: sale la intersección de `sent` y las que matchean el texto. Los controles no se limpian entre sí: cada uno conserva lo suyo. Es el comportamiento correcto y merece quedar anotado porque no hay ningún botón de «limpiar filtros». |

| | |
|---|---|
| **ID** | COT-LIST-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, cartera de prueba. |
| **Pasos** | 1. `GET /api/quotes?q=QA-COT`.<br>2. `GET /api/quotes?status=sent`.<br>3. `GET /api/quotes?q=3`.<br>4. `GET /api/quotes?limit=0` y `GET /api/quotes?limit=9999`.<br>5. `GET /api/quotes?offset=2`. |
| **Esperado** | 1: `200 {"items":[…],"total":N,"limit":200,"offset":0}` y `N` es el número de coincidencias, no el total de la cartera: **el servidor sí filtra** con `?q=` sobre `customerName`, `title` y `number` (`src/routes.ts:598`). 2: devuelve **todo**, con `total` igual al de `GET /api/quotes` sin query: `status` **se ignora en silencio**, porque el `crudRouter` de Cotizaciones no declara `filters` y lo que no se declara no filtra (`src/routes.ts:592-624` contra `packages/product-runtime/src/crud.ts:212-226`). Es el peor tipo de fallo de filtro: la pantalla parece filtrada y muestra todo. Ver `R-10`. 3: `q=3` busca también dentro de otros folios, porque el `LIKE` es `%3%`: no es una búsqueda de folio exacto. 4: `limit=0` cae al defecto `200` y `limit=9999` se recorta a `1000` (`Math.min(n \|\| 200, 1000)`, sin piso). 5: `offset=2` corre la lista dos filas y `total` **no** cambia: `total` es el total de la organización, no el de la página. |

| | |
|---|---|
| **ID** | COT-LIST-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Más de 500 cotizaciones en la organización. |
| **Pasos** | 1. Anotar `total` de `GET /api/quotes`.<br>2. Anotar `items.length` y el folio más bajo de la respuesta.<br>3. Contar las filas de `#cotizaciones-lista`.<br>4. Buscar en `#buscar` el folio de una cotización que quedó fuera de la página. |
| **Esperado** | La interfaz pide `/api/quotes?limit=500` (`public/app.js:74`), así que con 600 cotizaciones la tabla muestra **500** y las 100 más antiguas no aparecen. No hay paginación, ni contador, ni aviso: la lista se truncó en silencio. En el paso 4, la búsqueda en memoria **no encuentra** la cotización que no está en la lista, aunque exista y `?q=` en el servidor la devolvería. Ver `R-11`. Para reproducir sin sembrar 600 filas a mano, `POST /api/quotes` en bucle desde la consola. |

| | |
|---|---|
| **ID** | COT-LIST-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cartera con una cotización cuyo `customerName` contenga `<script>` y otro con `&`. |
| **Pasos** | 1. Crear por API una cotización con `"customerName": "QA-COT <b>x</b> & y"`.<br>2. Leer esa fila de `#cotizaciones-lista`.<br>3. Abrir su diálogo con `Ver` y leer `#cot-cliente`. |
| **Esperado** | El texto se muestra **literal**, como texto y no como HTML: el cliente y el título de las fichas de `#abiertas` y de las celdas se arman con `textContent` (`public/app.js:132-135, 173-175`). Ninguna celda se construye con `innerHTML` en este producto. |

| | |
|---|---|
| **ID** | COT-LIST-09 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa, cartera con importes grandes. |
| **Pasos** | 1. Crear una cotización de `1234567` centavos y otra de `150` centavos.<br>2. Leer la columna `Total` de ambas filas. |
| **Esperado** | `$12.346,57` y `$1,5`. `dinero()` usa `toLocaleString('es-CL')` con `minimumFractionDigits: 0` y sin `maximumFractionDigits`, así que **no** muestra `,00` en los importes redondos y **no** rellena a dos decimales los que no lo son (`packages/product-runtime/public/amigo-ui.js:52-57`). Un total de `0` se ve `$0`, no `$0,00`. Ver `R-07`. |

| | |
|---|---|
| **ID** | COT-LIST-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, cartera de prueba. |
| **Pasos** | 1. Pulsar `Ver` en una fila.<br>2. Cerrar el diálogo con `#cotizacion-cerrar`.<br>3. Pulsar `Ver` en la misma fila otra vez.<br>4. Repetir desde `#abiertas` en el panel Inicio. |
| **Esperado** | `Ver` pide `GET /api/quotes/:id/lineas` y abre `#cotizacion-dialog` con `showModal()`. El paso 2 **no** manda ninguna petición. Los dos caminos resuelven el id **en la lista en memoria** (`public/app.js:280`): si el id no está en `estado.cotizaciones`, `avisar` muestra `La cotizacion no esta en la lista` en rojo y no abre nada. Con más de 500 cotizaciones (ver `COT-LIST-07`) ese es el modo de fallo real de `Ver`. |

### 4.4 Alta de cotización — `#cotizacion-dialog`, `#cotizacion-nueva`

| | |
|---|---|
| **ID** | COT-ALTA-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, ajustes de la sección 2. |
| **Pasos** | 1. Pulsar `#cotizacion-nueva`.<br>2. Leer `#cotizacion-form-titulo`, `#cotizacion-id`, `#cot-folio`, `#cot-cliente`, `#cot-cliente-id`, `#cot-correo`, `#cot-titulo`, `#cot-emision`, `#cot-vigencia`, `#cot-impuesto`, `#cot-notas`, `#cot-total`, `#cot-estados`. |
| **Esperado** | El `<dialog>` abre con `showModal()`. Título `Nueva cotizacion`. `#cotizacion-id` vacío (es lo que distingue crear de editar). `#cot-folio` = `estado.cfg.nextNumber` tal cual, un entero, sin texto. `#cot-cliente`, `#cot-cliente-id`, `#cot-correo`, `#cot-titulo` y `#cot-notas` vacíos. `#cot-emision` = hoy en `AAAA-MM-DD`. `#cot-vigencia` = hoy + `validityDays` días. `#cot-impuesto` = `defaultTaxRateBp` de Ajustes (con `1600`, muestra `1600`, no `16`). `#cot-total` = `$0`. `#cot-estados` muestra los dos botones de `draft`: `Pasar a Enviada` y `Pasar a Vencida`. |

| | |
|---|---|
| **ID** | COT-ALTA-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto en modo creación. |
| **Pasos** | 1. Escribir solo el cliente y pulsar `Guardar`.<br>2. Escribir el cliente y borrar `#cot-folio`; pulsar `Guardar`.<br>3. Poner `#cot-folio` en `0`; pulsar `Guardar`.<br>4. Poner `#cot-correo` en `no-es-correo`; pulsar `Guardar`. |
| **Esperado** | 1: el navegador bloquea por `required` en `#cot-folio` y no sale ninguna petición. 2: idem, foco en `#cot-folio`. 3: el navegador bloquea por `min="1"` de `#cot-folio`; y aunque pasara, el `Number(...) \|\| null` de `public/app.js:351` mandaría `null` y el servidor propondría el folio siguiente. 4: el navegador bloquea por `type="email"` y **tampoco** sale petición. Los cuatro bloqueos son del navegador, antes de tocar la red. |

| | |
|---|---|
| **ID** | COT-ALTA-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto. |
| **Pasos** | 1. Escribir `QA-COT-2026 Sin detalle` en `#cot-cliente`.<br>2. Pulsar `Guardar` sin tocar `#linea-*`.<br>3. Leer Network, `#aviso` y `#cotizaciones-lista`. |
| **Esperado** | `POST /api/quotes` `201` con `"lines": []`. `quote.subtotalCents`, `quote.taxCents` y `quote.totalCents` vienen en `0`. El aviso es `Cotizacion creada`, el diálogo se cierra y la fila aparece con `$0` en la columna `Total`. **Una cotización sin líneas es válida**: el servidor no exige detalle. |

| | |
|---|---|
| **ID** | COT-ALTA-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto con cliente y dos líneas. |
| **Pasos** | 1. Pulsar `Guardar`.<br>2. Leer el cuerpo exacto de la petición en Network.<br>3. Enumerar sus claves. |
| **Esperado** | `201`. El cuerpo tiene exactamente: `number`, `customerName`, `customerId`, `customerEmail`, `title`, `issueDate`, `validUntil`, `taxRateBp`, `notes`, `lines`. **`status` no está**, y eso es deliberado (`public/app.js:348-361`): el estado tiene su propia ruta. `lines` trae solo `description`, `qty` y `unitPriceCents`, sin `lineTotalCents`: el importe de la línea lo calcula el servidor. Los vacíos viajan como `null`, no como `""`. |

| | |
|---|---|
| **ID** | COT-ALTA-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto con las dos líneas de la sección 2 y `#cot-impuesto` = `1600`. |
| **Pasos** | 1. Pulsar `Guardar`.<br>2. Leer `quote.subtotalCents`, `quote.taxCents`, `quote.totalCents` en la respuesta.<br>3. Leer las dos filas de `lines`.<br>4. Comparar con lo que mostraba `#cot-total` antes de guardar. |
| **Esperado** | Línea 1: `qty: 2`, `unitPriceCents: 25000`, `lineTotalCents: 50000`, `position: 1`. Línea 2: `qty: 3`, `unitPriceCents: 1234`, `lineTotalCents: 3702`, `position: 2`. `subtotalCents: 5369`. `taxCents: 859`, que es `Math.round(5369 × 1600 / 10 000)` = `Math.round(859.04)`. `totalCents: 6228`. Todos enteros. Y `#cot-total` mostraba exactamente `$62,28`: la estimación de pantalla y el valor guardado coinciden con esta fórmula. |

| | |
|---|---|
| **ID** | COT-ALTA-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Anotar el valor de `#cfg-folio` en `?panel=ajustes`.<br>2. `GET /api/settings` y anotar `settings.nextNumber`.<br>3. `GET /api/quotes/next-number` y anotar `number`.<br>4. Borrar la cotización de folio más alto.<br>5. Repetir 1, 2 y 3. |
| **Esperado** | 1, 2 y 3 coinciden: `#cfg-folio` pinta `String(cfg.nextNumber ?? 1)` (`public/app.js:453`) y las dos rutas devuelven el mismo entero. 5: el número **no baja** al borrar la última: es `MAX(number) + 1` por organización (`src/routes.ts:196-203`), así que borrar la de folio 12 con la 11 presente sigue proponiendo 12… salvo que la 12 fuera la única. Para ver el efecto hay que borrar **todas** las cotizaciones: entonces `nextNumber` vuelve a `1`. Con una sola cotización, borrarla y volver a abrir `Nueva cotización` propone `1` otra vez. |

| | |
|---|---|
| **ID** | COT-ALTA-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una cotización `draft` en pantalla. |
| **Pasos** | 1. Con la sesión abierta, `POST /api/quotes` desde la consola con `"number"` igual al folio existente.<br>2. Leer el código y el mensaje.<br>3. Crear una segunda cotización con `#cotizacion-nueva` sin recargar la página. |
| **Esperado** | 1: `409` con `{"error":"Ya existe la cotizacion numero <n> en esta empresa"}`, que nombra el número en conflicto (`src/routes.ts:402-404`). No se escribe nada y el chequeo ocurre **dentro** de la transacción, junto al insert. 3: el formulario venía con el folio viejo precargado, así que también recibe `409` y `#aviso` muestra el mismo mensaje en rojo, sin cerrarse el diálogo. Es el comportamiento previsto: el folio es una propuesta, no una reserva. |

| | |
|---|---|
| **ID** | COT-ALTA-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `"number": 0`.<br>2. Con `"number": 10000000`.<br>3. Con `"number": 3.5`.<br>4. Con `"number": "12"` (texto). |
| **Esperado** | 1: `400 {"error":"Datos inválidos"}` (mínimo 1). 2: `400` (tope `9_999_999`). 3: `400` porque el folio es entero. 4: `201` y el folio queda en `12`: el esquema usa `z.coerce.number()`, así que un texto numérico se acepta. Un folio es un **número**, no un texto: es el mismo `coerce` el que hace que `"12"` funcione y `"COT-12"` no. |

| | |
|---|---|
| **ID** | COT-ALTA-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto con datos escritos. |
| **Pasos** | 1. Pulsar `#cotizacion-cancelar`.<br>2. Pulsar `#cotizacion-nueva` otra vez y leer `#cot-cliente`, `#cot-titulo`, `#cot-notas`, `#cot-impuesto`.<br>3. Repetir cerrando con `#cotizacion-cerrar` (la `×`, `aria-label="Cerrar"`) y con la tecla `Esc`.<br>4. Contar las peticiones `POST /api/quotes`. |
| **Esperado** | Los tres cierres funcionan con `.close()` y **no** sale ninguna `POST`. En el paso 2 el formulario **sí** se reinicia, porque `abrirNueva()` escribe cada campo a mano (`public/app.js:309-328`): `#cot-cliente` queda vacío y `#cot-impuesto` vuelve al `defaultTaxRateBp` de Ajustes. Es un caso a favor: a diferencia de otros productos, aquí el diálogo de alta no arrastra datos de la cotización anterior. Verificar también `#cot-lineas` vacío y `#cot-total` en `$0`. |

| | |
|---|---|
| **ID** | COT-ALTA-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` sin `customerName`.<br>2. Con `"customerName": "   "` (solo espacios).<br>3. Con `"customerName"` de 151 caracteres.<br>4. Con `"customerName": "QA-COT"` y `"issueDate": "proximo martes"`. |
| **Esperado** | Los cuatro `400 {"error":"Datos inválidos"}`. 2: el `trim()` del esquema deja la cadena vacía y `min(1)` la rechaza (`src/routes.ts:47`). 3: tope 150. 4: el mensaje de `issueDate` en `errors.fieldErrors` es `La fecha va como AAAA-MM-DD`: las fechas se validan con una expresión regular propia y **no** con `Date.parse`, que aceptaría `2026-9-4` y también `42` (`src/routes.ts:63-69`). |

| | |
|---|---|
| **ID** | COT-ALTA-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `"customerEmail": ""`.<br>2. Con `"customerEmail": null`.<br>3. Con `"customerEmail": "QA-COT-2026 Ana <ana@example.com>"`.<br>4. Con `"customerEmail": "ana@example.com"` y sin campo en pantalla. |
| **Esperado** | 1 y 2: `201`, y el valor se guarda como `null` (`body.customerEmail \|\| null`, `src/routes.ts:411`). El correo es opcional de verdad, y vacío no es un correo inválido: el esquema es unión de email, cadena vacía y `null`. 3: `400` con `errors.fieldErrors.customerEmail` = `Correo invalido`. 4: `201`. |

### 4.5 Ítems de línea, totales e impuesto — `#cot-lineas`, `#linea-*`, `#cot-total`

| | |
|---|---|
| **ID** | COT-LINE-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto. |
| **Pasos** | 1. Poner `#linea-descripcion` = `QA-COT-2026 Logo`, `#linea-cantidad` = `2`, `#linea-precio` = `25000`.<br>2. Pulsar `#linea-agregar`.<br>3. Leer la ficha de `#cot-lineas` y los tres inputs de línea.<br>4. Leer `#cot-total`. |
| **Esperado** | Aparece una `.ui-ficha` con `.ui-ficha__titulo` = `QA-COT-2026 Logo` y `.ui-ficha__nota` = `2 × $250` (la cantidad **cruda**, sin formatear: por eso una cantidad `2.5` se ve `2.5` y no `2,5`). Dos botones: una etiqueta con `dinero(50000)` = `$500`, y `Quitar`. Los tres inputs se reinician a Descripción vacío, Cantidad `1` y Precio `0` (`public/app.js:337-340`). `#cot-total` pasa de `$0` a `$500`. |

| | |
|---|---|
| **ID** | COT-LINE-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cotizacion-dialog` abierto. |
| **Pasos** | 1. Dejar `#linea-descripcion` vacío, poner cantidad y precio, y pulsar `#linea-agregar`.<br>2. Poner `#linea-descripcion` = `   ` (solo espacios) y repetir. |
| **Esperado** | 1 y 2: `#aviso` en rojo con `La linea necesita una descripcion`, **no** se agrega ninguna ficha y **no** sale ninguna petición: el guardia es del navegador, en el manejador del clic (`public/app.js:333-334`). `#cot-total` no cambia. La descripción es obligatoria en pantalla y en el servidor (`texto` = `min(1).max(150)`), pero la interfaz avisa antes de gastar la llamada. |

| | |
|---|---|
| **ID** | COT-LINE-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Diálogo abierto con dos líneas y `#cot-impuesto` en `0`. |
| **Pasos** | 1. Anotar `#cot-total`.<br>2. Poner `#cot-impuesto` = `1600` sin sacar el foco.<br>3. Poner `#cot-impuesto` = `0`.<br>4. Vaciar `#cot-impuesto` por completo. |
| **Esperado** | El total se recalcula en cada `input`, sin esperar al `change` (`public/app.js:344`): pasa a `$61,94` con 1600 bp sobre el subtotal `5369` (`5369 + 859`), y vuelve a `$53,69` con `0`. En el paso 4 queda en `$53,69`, porque `Number('') \|\| 0` da `0`: **borrar el campo equivale a poner 0%**, y no avisa. La fórmula de pantalla es idéntica a la del servidor (`Math.round(subtotal × bp / 10 000)`, una sola vez), así que lo que se lee antes de guardar es lo que queda. |

| | |
|---|---|
| **ID** | COT-LINE-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cot-lineas` con tres líneas. |
| **Pasos** | 1. Pulsar `Quitar` en la primera.<br>2. Pulsar `Quitar` en la que quedó primera.<br>3. Quitar las tres. |
| **Esperado** | Cada `Quitar` quita **solo esa** ficha de la lista en memoria y vuelve a pintar (`public/app.js:229-236`): no hay `DELETE` ni `PATCH`, la cotización todavía no está guardada. Al quitar todas, `#cot-lineas` muestra el texto `Sin lineas.` (`AMIGO_UI.vacio`) y `#cot-total` vuelve a `$0`. Un `Quitar` accidental **no se puede deshacer** dentro del diálogo: hay que volver a escribir la línea. |

| | |
|---|---|
| **ID** | COT-LINE-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cotizacion-dialog` abierto. |
| **Pasos** | 1. Poner `#linea-cantidad` = `0.5`, `#linea-descripcion` = `QA-COT-2026 Media hora`, `#linea-precio` = `3333`, y pulsar `#linea-agregar`.<br>2. Intentar lo mismo con `1.25`.<br>3. Intentar lo mismo con `2.5`.<br>4. Leer en cada paso si el navegador bloquea y qué texto muestra. |
| **Esperado** | 1 y 2: el navegador **rechaza** el valor por las restricciones del input (`min="1" step="0.5"`, `index.html:209`), con el globo de validación, y `#linea-agregar` no agrega nada. Los valores válidos son `1` y sus medios a partir de ahí: `1`, `1.5`, `2`, `2.5`… 3: `2.5` sí se acepta y `#cot-total` muestra `Math.round(2.5 × 3333) = 8333` centavos = `$83,33`. **La interfaz no puede crear la media unidad que el servidor sí admite** (`qty` es `REAL` a propósito, `src/schema.ts:136`). Ver `R-04`: para probar la línea fraccionaria hay que hacerlo por API. |

| | |
|---|---|
| **ID** | COT-LINE-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `lines: [{ "description": "QA-COT-2026 Media hora", "qty": 0.5, "unitPriceCents": 3333 }]` y `taxRateBp: 1600`.<br>2. Leer `quote.subtotalCents`, `quote.taxCents`, `quote.totalCents`.<br>3. `GET /api/quotes/<id>/lineas` y leer `lineTotalCents`.<br>4. Comprobar que los tres importes son enteros. |
| **Esperado** | `subtotalCents: 1667`, que es `Math.round(0.5 × 3333)` = `Math.round(1666.5)`: **el redondeo ocurre una vez, en la línea**, no al final. `taxCents: 267` = `Math.round(1667 × 1600 / 10 000)` = `Math.round(266.72)`, es decir el impuesto se calcula **sobre el subtotal ya redondeado**, no sobre el producto sin redondear. `totalCents: 1934`. El mismo caso con dos líneas (`0.5 × 3333` y `3 × 1234`) da `1667` y `3702`, y `subtotalCents: 5369`. Es exactamente lo que cubre `tests/cotizaciones.test.ts:185-216`. |

| | |
|---|---|
| **ID** | COT-LINE-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `lines: [{ "description": "QA-COT-2026 Alias", "quantity": 3, "unitPriceCents": 25000 }]`.<br>2. `GET /api/quotes/<id>/lineas`.<br>3. Enumerar las claves de `lines[0]`. |
| **Esperado** | `201`. `lines[0].qty` es `3` y `lineTotalCents` es `75000`, `quote.subtotalCents` es `75000`. `quantity` se traduce a `qty` **antes** de validar, con un `z.preprocess` (`src/routes.ts:118-131`), y **no aparece** en la forma de salida: el paso 3 no lista `quantity`. Sin ese alias, `quantity` sería descartado por Zod en silencio, `qty` caería a su default de `1` y la cotización saldría por una unidad de algo que se pidieron tres, con un total plausible y ningún error. Es el commit `a3ec78c`. |

| | |
|---|---|
| **ID** | COT-LINE-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `lines: [{ "description": "QA-COT-2026 Ambos", "qty": 2, "quantity": 99, "unitPriceCents": 25000 }]`.<br>2. Leer `qty` y `lineTotalCents`.<br>3. Repetir con `"quantity": 0`.<br>4. Repetir con `"quantity": "3"` (texto). |
| **Esperado** | 1 y 2: `qty: 2` y `lineTotalCents: 50000`. **Gana `qty`**, que es el nombre del modelo; el alias solo entra si `qty` no vino (`src/routes.ts:121-124`). 3: `400` — el alias no es un atajo para meter ceros, `qty` sigue siendo `positive()`. 4: `201` con `qty: 3`, porque el campo es `z.coerce.number()`. |

| | |
|---|---|
| **ID** | COT-LINE-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `lines: [{ "description": "x", "qty": 0, "unitPriceCents": 100 }]`.<br>2. Con `"qty": -2`.<br>3. Con `"qty": 1000001`.<br>4. Con `"unitPriceCents": -1`.<br>5. Con `"unitPriceCents": 100000001`.<br>6. Con `"description": ""`.<br>7. Sin el campo `lines`. |
| **Esperado** | 1 y 2: `400`, con `La cantidad tiene que ser mayor que cero` en `errors.fieldErrors`. 3: `400` por el tope de `1_000_000`. 4: `400`, el precio no puede ser negativo. 5: `400` por el tope de `100_000_000` centavos, que es $1.000.000 (`src/routes.ts:52`). 6: `400`. 7: `201`, `lines` tiene default `[]` y la cotización sale en cero. |

| | |
|---|---|
| **ID** | COT-LINE-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `lines: [{ "description": "x", "qty": 2, "unitPriceCents": 100, "lineTotalCents": 999999 }]`.<br>2. Leer `subtotalCents`.<br>3. Repetir mandando `"subtotalCents": 1`, `"totalCents": 1`, `"taxCents": 1` en el cuerpo. |
| **Esperado** | 1: `subtotalCents` es `200`, no `999999`: `lineTotalCents` es de solo lectura en la práctica y el servidor lo descarta al calcular. 3: los tres se ignoran en silencio, no hay error: `quoteSchema` es un `z.object` normal, que descarta las claves que no conoce (`src/routes.ts:133-148`). El dinero se **materializa** en el servidor; mandarlo no cambia nada. Contraste con el `crudRouter`, que sí es `strict()` y responde `Campo desconocido: …`. |

| | |
|---|---|
| **ID** | COT-LINE-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cotizacion-dialog` abierto con una línea agregada y `#cot-impuesto` en `1600`. |
| **Pasos** | 1. Anotar `#cot-total`.<br>2. Cambiar `#linea-cantidad` a `5` **sin** pulsar `#linea-agregar`.<br>3. Cambiar `#linea-precio` a `99999` sin pulsar `#linea-agregar`.<br>4. Leer `#cot-total` y la lista de `#cot-lineas`. |
| **Esperado** | `#cot-total` **no se mueve** en ninguno de los dos pasos, y la lista sigue con la línea vieja. Los tres inputs de línea no tienen ningún listener: `pintarLineas()` solo se llama al agregar, al quitar y en el `input` de `#cot-impuesto` (`public/app.js:332-344`). Es correcto — la línea se agrega con un botón — pero el rótulo `#cot-total` dice «Total estimado» y hay un campo `Cantidad` a la vista que no lo mueve: anotar si se considera confuso (`R-17`). |

| | |
|---|---|
| **ID** | COT-LINE-12 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `"taxRateBp": 10001`.<br>2. Con `"taxRateBp": -1`.<br>3. Con `"taxRateBp": 10.5`.<br>4. Con `"taxRateBp": 1600` y una línea de `100` centavos.<br>5. Repetir el paso 4 en la interfaz, escribiendo `10001` en `#cot-impuesto` y luego `1600`. |
| **Esperado** | 1 y 2: `400` (rango `0` a `10_000`). 3: `400`, la tasa es **entera** en puntos básicos. 4: `taxCents: 16`, que es `Math.round(100 × 1600 / 10 000)`: 1600 bp es 16%, y el cálculo divide entre `10 000`, no entre `100`. 5: el navegador bloquea `10001` por `max="10000"` antes de la red, y `1600` pasa. Las dos capas coinciden: el tope es `10_000` y `10_000` = 100%. |

| | |
|---|---|
| **ID** | COT-LINE-13 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una cotización `draft` con `taxRateBp: 1600` y total `6228`. |
| **Pasos** | 1. Anotar `totalCents`.<br>2. En `?panel=ajustes`, poner `#cfg-impuesto` = `1900` y guardar.<br>3. Volver a `?panel=cotizaciones`, abrir esa cotización con `Ver` y leer `#cot-impuesto` y `#cot-total`.<br>4. `GET /api/quotes/<id>` y leer `taxRateBp` y `totalCents`. |
| **Esperado** | 3 y 4: `taxRateBp` sigue en `1600` y `totalCents` sigue en `6228`. El importe está **materializado** en la fila: una cotización aceptada tiene que seguir valiendo lo que valía el día que se aceptó, aunque mañana cambien los precios o la tasa de los ajustes (`src/schema.ts:35-38`). `#cfg-impuesto` solo afecta a las cotizaciones **nuevas**, porque `abrirNueva()` lo precarga. Este es el invariante económico del producto: si falla, es `P0`. |

### 4.6 Cotización: edición y baja — `Ver`, `Guardar`, `Borrar`

| | |
|---|---|
| **ID** | COT-EDIT-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una cotización con dos líneas, correo, `customerId` y notas. |
| **Pasos** | 1. Pulsar `Ver` en su fila.<br>2. Leer `#cotizacion-form-titulo`, `#cotizacion-id`, `#cot-folio` y las nueve fechas/campos.<br>3. Contar las peticiones. |
| **Esperado** | Sale `GET /api/quotes/<id>/lineas` y **nada más**: la cabecera de la fila ya estaba en la lista. Título `Cotizacion #<n>`. `#cotizacion-id` con el id, que es lo que hace que el `submit` siga por `PATCH` en vez de `POST`. `#cot-folio` trae el folio real. `#cot-emision` trae `issueDate` y, si es `null`, la fecha de hoy (`c.issueDate ?? hoy()`, `public/app.js:299`): **editar no cambia la fecha de una cotización que no tiene fecha**. `#cot-vigencia` trae `validUntil` o queda vacío. `#cot-impuesto` trae `taxRateBp`. |

| | |
|---|---|
| **ID** | COT-EDIT-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La cotización de `COT-EDIT-01`. |
| **Pasos** | 1. Cambiar solo `#cot-cliente` a `QA-COT-2026 Ana Torres Editada`.<br>2. Pulsar `Guardar`.<br>3. Leer Network, `#aviso` y la respuesta completa. |
| **Esperado** | `PATCH /api/quotes/<id>` `200` con `{"quote": {…}, "lines": [...]}`. El aviso es `Cotizacion actualizada`. `lines` sigue con las dos líneas y `totalCents` no se mueve: un `PATCH` **sin** `lines` conserva el detalle (`src/routes.ts:518-526`), porque el `PATCH` parte de la fila existente y solo se sobreescribe lo que viene. El `PATCH` manda el `lines` que ya había, no un `lines: []`; quien se traga ese caso es el cliente, no el servidor. |

| | |
|---|---|
| **ID** | COT-EDIT-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La cotización de `COT-EDIT-01`. |
| **Pasos** | 1. Quitar las dos líneas con `Quitar` y agregar una sola: `QA-COT-2026 Cambio`, cantidad `4`, precio `1000`.<br>2. Pulsar `Guardar`.<br>3. Leer `quote.subtotalCents`, `quote.taxCents`, `quote.totalCents` y `lines`. |
| **Esperado** | `200`. `lines` trae **una** línea con `position: 1` y las dos viejas desaparecieron: el detalle se **reemplaza entero**, no se fusiona (`src/routes.ts:431-434`, `tx.delete(quoteLines)` antes de insertar). El id de la línea es `<idCotizacion>_l<posición>`, derivado y no aleatorio, así que la segunda pasada de una edición no deja líneas huérfanas. `subtotalCents: 4000`, y el impuesto y el total salen de `taxRateBp` con la misma fórmula de siempre. |

| | |
|---|---|
| **ID** | COT-EDIT-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La cotización de `COT-EDIT-01`, con `totalCents` distinto de `0`. |
| **Pasos** | 1. Quitar todas las líneas y pulsar `Guardar`.<br>2. Leer `quote.subtotalCents`, `quote.taxCents`, `quote.totalCents` y `lines`.<br>3. Reabrir con `Ver` y leer `#cot-total` y `#cot-lineas`. |
| **Esperado** | Los tres importes en `0` y `lines: []`. Sacar la última línea deja la cotización **en cero**, no con el total viejo: un `PATCH` con `lines: []` borra todas y recalcula desde cero (`src/routes.ts:518-521`). En pantalla, `#cot-lineas` muestra `Sin lineas.` y `#cot-total` vuelve a `$0`. Una cotización en cero sigue siendo una cotización: no hay estado «borrada». |

| | |
|---|---|
| **ID** | COT-EDIT-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Dos cotizaciones, la segunda con el folio siguiente. |
| **Pasos** | 1. Abrir la **primera** con `Ver`.<br>2. Cambiar solo el cliente y guardar.<br>3. Leer `quote.number` en la respuesta.<br>4. Repetir con un `PATCH` por API que no mande `number`. |
| **Esperado** | El folio **no se mueve** en ninguno de los dos casos. El `PATCH` parte de la fila existente y pone `number: existente.number` por defecto (`src/routes.ts:510`), así que editar el cliente no puede reasignar el papel: el documento con el folio impreso tiene que seguir siendo el mismo. El `PATCH` tampoco mueve los sellos: `sentAt` y `acceptedAt` quedan como estaban. |

| | |
|---|---|
| **ID** | COT-EDIT-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una cotización `draft`. |
| **Pasos** | 1. `PATCH /api/quotes/<id>` con `{"status":"accepted","customerName":"QA-COT-2026 X"}`.<br>2. Leer `quote.status` y `quote.acceptedAt`.<br>3. `GET /api/quotes/<id>` y confirmar lo mismo. |
| **Esperado** | `200`, `quote.status` sigue en `draft` y `acceptedAt` en `null`. El `PATCH` **saca `status` a mano**, no por el esquema: `const { status: _estadoPorPatch, ...cambios } = req.body` (`src/routes.ts:508`). Sin esa línea, el `...cambios` de abajo lo volvería a colar y el `PATCH` sería una segunda puerta para aceptar una cotización sin dejar rastro de cuándo. Por eso el estado tiene ruta propia. |

| | |
|---|---|
| **ID** | COT-EDIT-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de la organización A. |
| **Pasos** | 1. `POST /api/quotes` con `{"customerName":"QA-COT-2026 Invasión","organizationId":"<id de la organización B>","lines":[]}`.<br>2. Leer `quote.organizationId`.<br>3. `PATCH /api/quotes/<id>` con `{"organizationId":"<id de B>"}`.<br>4. `GET /api/quotes?limit=500` con la sesión de B y buscar `Invasión`. |
| **Esperado** | 1: `201`, y `quote.organizationId` es el de **A**, no el que se mandó. 3: el `PATCH` ignora la clave. 4: `items` **no** contiene ninguna cotización llamada `Invasión`. La organización sale siempre del token: `orgId(req)`, y el campo ni siquiera existe en el esquema de entrada, así que ni siquiera llega a procesarse. La escalada horizontal es imposible por construcción, no por un chequeo. |

| | |
|---|---|
| **ID** | COT-EDIT-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una cotización con dos líneas. |
| **Pasos** | 1. Pulsar `Borrar` en su fila.<br>2. Leer el texto del `confirm()`.<br>3. Cancelar.<br>4. Volver a pulsar `Borrar` y confirmar.<br>5. Leer Network, `#aviso` y la tabla. |
| **Esperado** | El `confirm()` dice exactamente `Borrar la cotizacion y sus lineas?` (`public/app.js:183`). Cancelando no sale ninguna petición y la fila sigue. Confirmando: `DELETE /api/quotes/<id>` `200` con `{"ok":true,"deleted":true}`, el aviso es `Cotizacion borrada` y la fila desaparece de la tabla **y** de `#abiertas`. Las líneas se van con ella por el `ON DELETE CASCADE` del DDL: una línea sin cotización no significa nada. No hay archivado: `DELETE` es borrado duro y no hay forma de recuperar la fila. |

| | |
|---|---|
| **ID** | COT-EDIT-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `DELETE /api/quotes/cot_noexiste`.<br>2. `PATCH /api/quotes/cot_noexiste` con `{"customerName":"x"}`.<br>3. `GET /api/quotes/cot_noexiste`.<br>4. `GET /api/quotes/cot_noexiste/lineas`.<br>5. `POST /api/quotes/cot_noexiste/estado` con `{"status":"sent"}`. |
| **Esperado** | Los cinco `404`, pero con **dos textos distintos**: el `crudRouter` responde `{"error":"No encontrado"}` (pasos 1 y 3) y las rutas propias responden `{"error":"Esa cotizacion no existe"}` (pasos 2, 4 y 5, vía `leerQuote`). El mismo «no existe» llega con dos mensajes según por dónde se pida (`R-13`). Ninguno dice `403`: el `404` no confirma que el id exista en otra empresa. |

| | |
|---|---|
| **ID** | COT-EDIT-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Una cotización de la organización A. |
| **Pasos** | 1. Con la sesión de **B**, `GET /api/quotes/<id de A>`.<br>2. `PATCH`, `DELETE` y `POST /api/quotes/<id de A>/estado` con `{"status":"accepted"}`.<br>3. `GET /api/quotes/<id de A>/lineas`.<br>4. Con la sesión de A, releer la cotización. |
| **Esperado** | Los cuatro `404` con `Esa cotizacion no existe` (o `No encontrado` en el `GET`), nunca `403`. La fila de A sigue intacta: mismo nombre, mismo `status`, mismos importes. Ninguna de las cinco rutas filtra nombre, folio ni total de la otra organización. Es la repetición de `COT-SIST-05` por la vía de escritura. |

### 4.7 Máquina de estados — `POST /api/quotes/:id/estado`, `#cot-estados`

| | |
|---|---|
| **ID** | COT-EST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cotizacion-dialog` abierto en una cotización `draft`. |
| **Pasos** | 1. Enumerar los botones de `#cot-estados` y anotar sus textos.<br>2. En Network, leer método, URL y cuerpo al pulsar el primero. |
| **Esperado** | Dos botones, `Pasar a Enviada` y `Pasar a Vencida`, que son exactamente los destinos de `TRANSICIONES.draft` en `public/app.js:40-46`. Al pulsar: `POST /api/quotes/<id>/estado` con cuerpo `{"status":"sent"}`, `200 {"quote":{…}}`, el aviso `Estado actualizado` y el diálogo **sigue abierto** con los botones recalculados. El `estado` **no** va en el formulario de la cotización: vive solo en este botón. |

| | |
|---|---|
| **ID** | COT-EST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cotización `draft` con `sentAt: null`. |
| **Pasos** | 1. `POST /api/quotes/<id>/estado` con `{"status":"sent"}`.<br>2. Leer `quote.status`, `quote.sentAt` y `quote.acceptedAt`.<br>3. Anotar `sentAt` y repetir el `POST` con `{"status":"sent"}` más adelante, después de un ciclo. |
| **Esperado** | 2: `status: "sent"`, `sentAt` con una ISO reciente, `acceptedAt: null`. 3: el sello se escribe **una sola vez**: reenviar una cotización vencida no borra la fecha en que se mandó la primera vez (`actual.sentAt ?? ahora`, `src/routes.ts:342`). Anotar la hora exacta del primer `sentAt` y confirmar que no cambia. |

| | |
|---|---|
| **ID** | COT-EST-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cotización `sent`. |
| **Pasos** | 1. Enumerar los botones de `#cot-estados`.<br>2. Pulsar `Pasar a Aceptada`.<br>3. Leer `quote.status`, `quote.acceptedAt` y `quote.sentAt`. |
| **Esperado** | Tres botones: `Pasar a Aceptada`, `Pasar a Rechazada` y `Pasar a Vencida`. 2 y 3: `status: "accepted"`, `acceptedAt` con ISO reciente y `sentAt` **conservado**. Volver a abrir la cotización con `Ver` muestra la etiqueta `Aceptada` con tono verde (`ui-etiqueta--ok`) en la tabla. |

| | |
|---|---|
| **ID** | COT-EST-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cotización `sent`. |
| **Pasos** | 1. Pulsar `Pasar a Rechazada`.<br>2. Leer `status`, `acceptedAt` y el texto de `#cot-estados`.<br>3. Reabrir con `Ver` y leer la etiqueta de la tabla. |
| **Esperado** | 2: `status: "rejected"`, `acceptedAt` en `null`. `#cot-estados` pasa a mostrar un único `<p>` con el texto `Una cotizacion Rechazada ya no cambia de estado.` y **ningún** botón. 3: etiqueta `Rechazada` con tono rojo (`ui-etiqueta--malo`). Un rechazo es una decisión del cliente y queda registrada; no se puede reconsiderar desde la misma fila. |

| | |
|---|---|
| **ID** | COT-EST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cotización `draft`. |
| **Pasos** | 1. `POST /api/quotes/<id>/estado` con `{"status":"expired"}`.<br>2. Leer `status`, `sentAt` y `acceptedAt`.<br>3. Volver a `sent` y anotar `sentAt`. |
| **Esperado** | 2: `status: "expired"`, `acceptedAt` en `null`, y **`sentAt` con valor**: una oferta puede vencer sin haberse mandado nunca (el cliente no contestó, el plazo pasó). En pantalla la etiqueta es `Vencida`, tono neutro. La tabla y `#abiertas` la excluyen de las pendientes: `Vencida` no es «esperando respuesta». |

| | |
|---|---|
| **ID** | COT-EST-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cotización `expired`, con `sentAt` anotado de cuando estuvo en `sent`. |
| **Pasos** | 1. `POST /api/quotes/<id>/estado` con `{"status":"sent"}`.<br>2. Comparar `quote.number`, `quote.sentAt` y `quote.createdAt`. |
| **Esperado** | `status: "sent"` otra vez, con el **mismo folio** y el **mismo `sentAt`**. `expired` es la única puerta de ida y vuelta de la máquina: una oferta vencida la conoce el cliente, así que reenviarla con el mismo folio es lo correcto y el sello de la primera vez no se pisa. Sin folio nuevo: no se crea una segunda cotización, no queda huérfana la primera. |

| | |
|---|---|
| **ID** | COT-EST-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cotización `accepted` y otra `rejected`. |
| **Pasos** | 1. `POST /api/quotes/<id>/estado` con `{"status":"draft"}` en cada una.<br>2. Con `{"status":"sent"}` en cada una.<br>3. Con `{"status":"rejected"}` en la `accepted`.<br>4. Leer los cuatro mensajes exactos. |
| **Esperado** | Todos `400`. En el paso 1 el mensaje es `Una cotizacion accepted no vuelve a borrador: cotiza una nueva.` y para la `rejected`, `Una cotizacion rejected no vuelve a borrador: cotiza una nueva.` (`src/routes.ts:328-333`): el mensaje nombra el estado y da la instrucción. En los pasos 2 y 3 el mensaje es genérico: `No se puede pasar de accepted a sent` y `No se puede pasar de accepted a rejected`. `accepted` y `rejected` son terminales en el servidor **y** en la tabla de la interfaz: los dos bloques de la UI coinciden, así que un estado terminal muestra siempre el texto de «ya no cambia de estado» y nunca un botón inútil. |

| | |
|---|---|
| **ID** | COT-EST-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes/<id>/estado` con `{"status":"sent"}` en una cotización que ya está `sent`.<br>2. Repetir con `{"status":"draft"}` en una que ya está `draft`.<br>3. Repetir con `{}`.<br>4. Repetir con `{"status":"hold"}`.<br>5. Repetir con `{"status":"pendiente"}`. |
| **Esperado** | 1 y 2: `200` con la fila tal como estaba. **No es un error**: el cliente puede reintentar un `POST` que ya llegó y no hay nada que hacer; un `400` lo haría parecer un fallo (`src/routes.ts:316-319`). 3 y 4 y 5: `400 {"error":"Datos inválidos"}`, porque `status` se valida contra un `z.enum` de los cinco estados y `hold` no está. Un estado desconocido se rechaza en la puerta, no se guarda: además la fila se comprueba contra la tabla antes de escribir, con un mensaje propio para el caso de una cotización migrada con un estado que este producto no conoce (`src/routes.ts:323-326`). |

| | |
|---|---|
| **ID** | COT-EST-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `{"customerName":"QA-COT-2026 Salto","status":"accepted","lines":[]}`.<br>2. Leer `status`, `sentAt`, `acceptedAt` y `createdAt`.<br>3. `POST /api/quotes/<id>/estado` con `{"status":"draft"}`.<br>4. `PATCH /api/quotes/<id>` con `{"status":"draft","customerName":"QA-COT-2026 Salto 2"}`.<br>5. Reabrir la fila en la tabla y leer la etiqueta y `#cot-estados`. |
| **Esperado** | **El salto se demuestra**: `201` y la cotización nace `accepted`, sin pasar por `sent`. 2: `sentAt` y `acceptedAt` **valen lo mismo que `createdAt`**, porque `escribirQuote` sella con la hora de creación cuando el estado de naciente es `sent`, `accepted` o `expired` (`src/routes.ts:442-445`). El sello queda, pero es **sintético**: fabricó una hora de aceptación que nadie negoció. 3: `400`, `accepted` es terminal. 4: `200` pero el estado sigue `accepted`, porque el `PATCH` descarta `status`. **Combinando 3 y 4, la fila es insanable por API**: no hay ninguna ruta que la devuelva a `draft`. La única salida es `DELETE` y recrear, con folio nuevo. 5: etiqueta `Aceptada` y `#cot-estados` con el texto de terminal. Ver `R-01`: es el hallazgo de mayor severidad de este producto. |

| | |
|---|---|
| **ID** | COT-EST-10 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/quotes` con `{"customerName":"QA-COT-2026 Rechazada de Birth","status":"rejected","lines":[]}`.<br>2. `POST /api/quotes` con `"status":"expired"`.<br>3. `POST /api/quotes` con `"status":"sent"`.<br>4. En cada caso, leer `sentAt` y `acceptedAt`. |
| **Esperado** | Los tres `201`. 1: nace `rejected` con `sentAt`sellado y `acceptedAt` en `null`, aunque **`draft → rejected` no está en la tabla de transiciones**: hay que dar dos pasos por `sent`. O sea que hay un estado que la máquina de estados prohíbe en un salto y la API permite en uno solo. 2: nace `expired` con `sentAt` sellado, aunque nunca se mandó (igual que `COT-EST-05`). 3: nace `sent` con el sello coherente. En la interfaz, las tres se pueden crear solo con `POST`: el formulario no manda estado. |

| | |
|---|---|
| **ID** | COT-EST-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Una cotización `accepted` creada por `COT-EST-09`. |
| **Pasos** | 1. En `?panel=cotizaciones`, filtrar por `Aceptada`.<br>2. Abrirla con `Ver` y tratar de cambiar algo: cliente, líneas, notas.<br>3. Guardar.<br>4. Releer la fila. |
| **Esperado** | Editar una cotización aceptada **funciona**: el `PATCH` no mira el estado y recalcula importes si cambian las líneas. No hay bloqueo por estado terminal en la edición, solo en la transición. El contenido puede cambiar y el `acceptedAt` **no se toca**: queda la fecha de la aceptación original con un detalle distinto al que se aceptó. Anotar si el negocio lo tolerate; es una decisión de diseño que este producto no documenta en la UI. |

| | |
|---|---|
| **ID** | COT-EST-12 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de la organización A. |
| **Pasos** | 1. Con la sesión de **B**, `POST /api/quotes/<id de A>/estado` con `{"status":"accepted"}`.<br>2. Con la sesión de A, leer `status`.<br>3. Con la sesión de B, `POST /api/quotes/noexiste/estado` con `{"status":"sent"}`. |
| **Esperado** | 1: `404 {"error":"Esa cotizacion no existe"}`. 2: la cotización de A sigue `draft`. 3: `404` con el mismo mensaje. El `404` no distingue «no existe» de «es de otra empresa», y esa indistinguibilidad es deliberada: un `403` confirmaría que el id existe. Un cambio de estado es la escritura más sensible del producto y no puede hacerse sobre datos ajenos. |

### 4.8 Ajustes — `?panel=ajustes`, `#config-form`

Los cuatro campos se leen por `name`, no por id: `currency`, `timezone`,
`defaultTaxRateBp`, `validityDays`. El `id` es `#cfg-moneda`, `#cfg-zona`, `#cfg-impuesto`,
`#cfg-vigencia`: son dos cosas distintas y el formulario se llena recorriendo `form.elements`
(`public/app.js:444-453`), así que agregar un ajuste es agregar un `<input name="...">` en el
HTML sin tocar el JS.

| | |
|---|---|
| **ID** | COT-AJUST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, sin fila en `settings` para esa organización. |
| **Pasos** | 1. `GET /api/settings`.<br>2. Enumerar las claves de `settings`.<br>3. Recorrer `?panel=ajustes` y leer los cuatro campos y `#cfg-folio`. |
| **Esperado** | `200 {"settings":{"currency":"$","timezone":"America/Santiago","defaultTaxRateBp":0,"validityDays":30,"nextNumber":1}}`. Son los defaults del servidor, presentes aunque no haya fila guardada: `leerPreferencias` devuelve campo por campo (`src/routes.ts:153-161`). En pantalla los inputs muestran `$`, `America/Santiago`, `0` y `30`, y `#cfg-folio` muestra `1`. **Las claves son exactamente estas cinco**: `nextNumber` entra solo en el `GET`, es el quinto valor, y no es un ajuste guardable. |

| | |
|---|---|
| **ID** | COT-AJUST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Poner `#cfg-moneda` = `CLP`, `#cfg-zona` = `America/Santiago`, `#cfg-impuesto` = `1600`, `#cfg-vigencia` = `15`.<br>2. Pulsar `Guardar ajustes`.<br>3. Leer Network, `#aviso` y la respuesta.<br>4. Recargar la página y leer los cuatro campos. |
| **Esperado** | `PUT /api/settings` `200` con `{"settings":{"currency":"CLP","timezone":"America/Santiago","defaultTaxRateBp":1600,"validityDays":15}}` — **sin `nextNumber`**, porque la respuesta del `PUT` es `leerPreferencias` y no el agregado del `GET` (`src/routes.ts:572`). El aviso es `Ajustes guardados`. 4: los cuatro valores persisten. Si no había fila, el `PUT` la inserta con id `cfg_<organizationId>`; si la había, la actualiza. Nunca hay dos filas: el índice único por `organization_id` lo impide. |

| | |
|---|---|
| **ID** | COT-AJUST-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`, con `#cfg-impuesto` = `1600`. |
| **Pasos** | 1. Pulsar `#cotizacion-nueva` y leer `#cot-impuesto`.<br>2. Volver a Ajustes, poner `#cfg-impuesto` = `10000`, guardar, y abrir una cotización nueva.<br>3. Poner `#cfg-impuesto` = `0`, guardar, y abrir una cotización nueva. |
| **Esperado** | `#cot-impuesto` recibe **el número crudo de puntos básicos**: `1600`, `10000`, `0`. En ningún momento aparece `16`, `100` ni `0`. El cálculo divide entre `10 000`: `10000` es 100% y `1600` es 16%. Con `10000` y una línea de `25000` centavos, `#cot-total` muestra `$500` (subtotal `25000` + impuesto `25000`). La etiqueta de los dos campos, `Impuesto por defecto (puntos basicos, 1600 = 16%)` e `Impuesto (puntos basicos, 1600 = 16%)`, es la **única** explicación de la unidad en toda la pantalla. Ver `R-02`. |

| | |
|---|---|
| **ID** | COT-AJUST-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Poner `#cfg-vigencia` = `0` y guardar.<br>2. Poner `#cfg-vigencia` = `3651` y guardar.<br>3. Poner `#cfg-vigencia` = `1` y `#cfg-moneda` = `123456` (6 caracteres) y guardar.<br>4. Poner `#cfg-moneda` vacío y `#cfg-vigencia` vacío y guardar.<br>5. Restaurar los valores de la sección 2. |
| **Esperado** | 1 y 2: el navegador bloquea por `min="1"` y `max="3650"` antes de la red; por API, `400 {"error":"Datos inválidos"}`. 3: el navegador bloquea por `maxlength="5"` de `#cfg-moneda`. 4: `200`, y se guarda `currency: "$"` y `validityDays: 30`, porque el `submit` traduce vacío con `\|\| '$'` y `\|\| 30` (`public/app.js:390-393`): **borrar un campo no lo deja en blanco, lo vuelve default**. Verificar que el aviso sea `Ajustes guardados` y no un error. 5: los tres devuelven `200`. |

| | |
|---|---|
| **ID** | COT-AJUST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Poner `#cfg-zona` = `Chile/Continental` (no es una zona IANA) y `#cfg-moneda` = `$`, y guardar.<br>2. Poner `#cfg-zona` = `America/Madrid` y `#cfg-vigencia` = `45`, guardar.<br>3. Con la zona en `America/Madrid`, abrir una cotización nueva y leer `#cot-emision` y `#cot-vigencia`.<br>4. Restaurar `America/Santiago`. |
| **Esperado** | 1: `400 {"error":"Datos inválidos"}` con el mensaje `No es una zona horaria válida (usá una como America/Santiago)`. Una zona inválida se rechaza **al guardar**, no después al formatear. 2 y 3: `200`, y la zona **no cambia nada visible** en esta pantalla: las fechas de `#cot-emision` y `#cot-vigencia` las arma el navegador con `toLocaleDateString('en-CA')` en su huso local, y no hay ningún `AMIGO_UI.fecha(..., zona)` en este producto. El ajuste `timezone` se guarda y no lo usa nadie: es un dato de la fila `settings` sin consumidor. Ver `R-15`. |

| | |
|---|---|
| **ID** | COT-AJUST-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`, con moneda `CLP` guardada. |
| **Pasos** | 1. Ir a `?panel=cotizaciones` y leer la columna `Total`.<br>2. Ir a `?panel=inicio` y leer `#abiertas`.<br>3. Abrir una cotización con `Ver` y leer `#cot-total` y la etiqueta de importe de `#cot-lineas`.<br>4. Restaurar la moneda a `$`. |
| **Esperado** | **Todas** las cifras cambian de símbolo: `CLP500` en la tabla, `CLP500` en la etiqueta de la ficha, `CLP500` en `#cot-total` y `CLP250` en la línea. La moneda se resuelve en un solo punto, `dinero()` de `public/app.js:57`, que pasa `estado.cfg.currency` a `AMIGO_UI.dinero`. Ninguna cifra está hardcodeada con `$`, salvo los defaults de la propia tabla `settings`. Con `currency` de 5 caracteres como `CLP$ ` el símbolo se imprime entero, sin recortar. |

| | |
|---|---|
| **ID** | COT-AJUST-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Leer el texto completo de la nota que contiene `#cfg-folio`.<br>2. Intentar escribir en `#cfg-folio`.<br>3. `PUT /api/settings` por API con `"nextNumber": 500`.<br>4. `PUT /api/settings` por API sin `nextNumber` y leer la respuesta. |
| **Esperado** | 1: la nota dice que el folio siguiente **no** se ajusta desde ahí, que es el último número de la empresa más uno, que se calcula en el servidor, y que reservarlo desde Ajustes dejaría huecos en la numeración; después `Ahora es <n>` con el valor en `#cfg-folio`. 2: `#cfg-folio` es un `<strong>`, no un input: no es editable ni enfocable. 3: `200` y `nextNumber` **se ignora en silencio**, porque el `PUT` valida contra un `z.object` de cuatro campos y no es `strict()`: se acepta la petición y el número no cambia. 4: la respuesta **no** trae `nextNumber`. La nota de pantalla y el comportamiento coinciden; la laxitud del `PUT` con claves desconocidas, no (ver `COT-AJUST-08`). |

| | |
|---|---|
| **ID** | COT-AJUST-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `PUT /api/settings` con `{"currency":"$","defaultTaxRateBp":10000,"nextNumber":1,"campoInventado":true}`.<br>2. `PUT /api/settings` con `{}`.<br>3. `PUT /api/settings` con `{"currency":""}`.<br>4. `PUT /api/settings` con `{"defaultTaxRateBp":"1900"}` (texto). |
| **Esperado** | 1 y 3: `200`, y las claves desconocidas o el currency vacío se descartan en silencio — `currency` vacío es un `default('$')`, no un error. **Contraste deliberado con `COT-AJUST-07`**: el `crudRouter` de otros productos usa `.strict()` y responde `Campo desconocido: …`, mientras que las rutas propias de Cotizaciones usan `z.object` normal. Una clave mal escrita en un ajuste se ignora y la pantalla parece guardada. 2: `200` con los cuatro defaults. 4: `200` con `1900`, porque el campo es `z.coerce.number()`. |

| | |
|---|---|
| **ID** | COT-AJUST-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Dos organizaciones con suscripción a `cotizaciones`. |
| **Pasos** | 1. Con la sesión de **A**, `PUT /api/settings` con `{"currency":"EUR","timezone":"America/Madrid","validityDays":45}`.<br>2. Con la sesión de **B**, `GET /api/settings`.<br>3. Con la sesión de B, `GET /api/dashboard`. |
| **Esperado** | 2: los ajustes de A **no** aparecen: B sigue con su moneda, su zona y su vigencia. Una fila por organización, guaranteed por el `uniqueIndex` de `settings.organizationId`. 3: los totales de A tampoco. Los ajustes son el dato más global del producto y es el que más fácil sería filtrar. Restaurar los ajustes de A al terminar. |

### 4.9 Funciones que este producto no tiene — casos negativos `404`

Esta sección existe porque el alcance esperado de una herramienta de cotizaciones incluye
plantillas, PDF y enlace público, y **este producto no los tiene**. No hay tabla, ni ruta, ni
botón, ni selector para nada de eso: `src/routes.ts` no los menciona, `src/schema.ts` solo
declara `quotes`, `quote_lines` y `settings`, y `public/index.html` no tiene ni un campo que
los referencia. Cada caso verifica el `404` explícito para que la ausencia quede documentada y
no se confunda con un fallo de la sesión.

| | |
|---|---|
| **ID** | COT-AUS-01 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, una cotización `draft` con líneas. |
| **Pasos** | 1. `GET /api/quotes/<id>/pdf`.<br>2. `GET /api/quotes/<id>/pdf?formato=A4`.<br>3. `GET /api/quotes/<id>/imprimir`.<br>4. Buscar en `index.html` y en `public/app.js` las palabras `pdf`, `imprimir`, `descargar` y `print`. |
| **Esperado** | **404 negativo en los tres pasos**, con `{"error":"No existe GET /api/quotes/<id>/pdf"}`: cae en el `notFound` del runtime, que compone el mensaje con el método y el path (`packages/product-runtime/src/errors.ts:17`). No hay descarga, no hay vista de impresión, no hay botón de PDF en el diálogo ni en la fila. Una cotización de este producto solo se puede leer en pantalla y exportar a mano. Ver `R-05`. |

| | |
|---|---|
| **ID** | COT-AUS-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, una cotización `sent`. |
| **Pasos** | 1. `GET /api/quotes/<id>/publico`.<br>2. `GET /api/p/<id>`.<br>3. `GET /api/quotes/<id>/enlace`.<br>4. `GET /api/public/<id>`.<br>5. Recorrer la interfaz buscando un botón de compartir, y revisar `index.html` en busca de un `token` o un `slug`. |
| **Esperado** | Los cuatro `404` negativos con `No existe GET <path>`. No hay enlace público: **tampoco hay ruta sin sesión**, así que no es que «no se haya probado desde el navegador», es que la superficie no existe. Ningún campo de la fila guarda un token ni un slug compartible. `customerEmail` se guarda pero **no se usa para nada**: este producto no envía correo. Ver `R-06`. |

| | |
|---|---|
| **ID** | COT-AUS-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/plantillas`.<br>2. `POST /api/plantillas` con `{"name":"QA-COT-2026 Plantilla"}`.<br>3. `GET /api/templates`.<br>4. `GET /api/quotes/<id>/plantilla`.<br>5. Revisar el panel `?panel=ajustes` buscando un selector de plantilla. |
| **Esperado** | 1, 2, 3 y 4: **404 negativo** cada uno, con `No existe <MÉTODO> <path>`. No hay plantillas: ni tabla, ni ruta, ni pantalla, ni selector. `#cotizacion-dialog` no tiene ningún campo de plantilla. Cada cotización se escribe de cero, línea por línea. Registrar la ausencia en la sección 7 (`R-05`). |

| | |
|---|---|
| **ID** | COT-AUS-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/quotes/<id>/secciones`.<br>2. `POST /api/quotes/<id>/secciones/ordenar` con `{"ids":["a","b"]}`.<br>3. `POST /api/secciones/ordenar`.<br>4. `PATCH /api/quotes/<id>/secciones`.<br>5. Revisar `#cotizacion-dialog` buscando un bloque de secciones o de encabezados. |
| **Esperado** | Los cuatro **404 negativos**. **No existe endpoint de reordenamiento de secciones en este producto**: no hay tabla de secciones, ni campo `sections`, ni ruta que contenga la palabra `ordenar` en todo `src/`. El detalle de una cotización es una lista plana de líneas con un `position` que sale del índice, y su orden se fija por el **orden del arreglo** del `PATCH`: `position = i + 1` (`src/routes.ts:173-179`). La única forma de reordenar es mandar las líneas en el orden nuevo. Verificar eso con `COT-EDIT-03`. |

| | |
|---|---|
| **ID** | COT-AUS-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/customers`.<br>2. `POST /api/customers` con `{"name":"QA-COT-2026 Cliente"}`.<br>3. `GET /api/quotes/<id>/cliente`.<br>4. Buscar `#clientes-lista` y cualquier `<input type="tel">` en la página. |
| **Esperado** | 1, 2 y 3: **404 negativo**. Cotizaciones **no** es dueño del cliente: vive en el producto `crm`, en otra base de datos. Aquí el cliente es un **snapshot** — `customerName` es `NOT NULL` y `customerId` es una referencia suelta sin llave foránea, precisamente porque SQLite no valida referencias entre bases (`src/schema.ts:70-78`). La propia etiqueta lo dice: `Los clientes viven en el producto Clientes. Acá va el nombre.` Y `#cot-cliente` es un `<input>` de texto libre, sin lista desplegable ni validación contra el otro producto: se puede cotizar a un cliente que no existe. No hay forma de saber, desde este producto, si el nombre escrito corresponde a alguien real. Ver `R-14`. |

| | |
|---|---|
| **ID** | COT-AUS-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa, una cotización con dos líneas. |
| **Pasos** | 1. `POST /api/quotes/<id>` con `{"description":"QA-COT-2026 Linea suelta","qty":1,"unitPriceCents":100}`.<br>2. `PATCH /api/quotes/<id>/lineas` con `{"lines":[]}`.<br>3. `DELETE /api/quotes/<id>/lineas/<lineId>`.<br>4. `GET /api/quotes/<id>/lineas/<lineId>`. |
| **Esperado** | Los cuatro **404 negativos**. Las líneas **no** son un recurso independiente: no hay ruta para crearlas, editarlas ni borrarlas por separado. Se reemplazan enteras con el `PATCH /api/quotes/:id` que las manda en el arreglo `lines`, y se borran en cascada al borrar la cotización. La razón está escrita en el archivo: editar una línea suelta dejaría números que no cuadran con el total (`src/routes.ts:44`). El único endpoint de líneas es **de lectura**: `GET /api/quotes/:id/lineas`. |

| | |
|---|---|
| **ID** | COT-AUS-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `PATCH /api/quotes/<id>` con `{"lines":[{"description":"QA-COT-2026 Reordenada","qty":1,"unitPriceCents":100}]}` sobre una cotización cuyas líneas, en orden, son `A` y `B`.<br>2. Leer las `lines` de la respuesta, en orden.<br>3. Mandar el arreglo invertido: `B` y luego `A`.<br>4. Leer las `lines` otra vez. |
| **Esperado** | En el paso 2 el orden es `[A, B]` con `position` 1 y 2; en el paso 4 es `[B, A]`. El orden no es un campo que se mande: sale del **índice del arreglo**, y `position` se recalcula en cada escritura (`src/routes.ts:173-179`). Por eso no hace falta un endpoint de reordenamiento: reordenar es mandar el arreglo en el orden nuevo. Es la respuesta positiva a `COT-AUS-04`. |

| | |
|---|---|
| **ID** | COT-AUS-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/quotes/<id>` y enumerar las claves de la respuesta.<br>2. `GET /api/quotes/<id>/lineas` y enumerar las claves.<br>3. `POST /api/quotes` y enumerar las claves de la respuesta.<br>4. `PATCH /api/quotes/<id>` y enumerar las claves.<br>5. `GET /api/quotes` y enumerar las claves. |
| **Esperado** | 1: **la fila pelada**, sin envoltorio — la resuelve el `crudRouter`. 2: `{"lines":[…]}`. 3: `{"quote":{…},"lines":[…]}`. 4: `{"quote":{…},"lines":[…]}`. 5: `{"items":[…],"total":N,"limit":L,"offset":O}`. **Cinco sobres distintos para cinco rutas de la misma tabla.** Un cliente que normalize mal una de ellas obtiene `undefined` donde esperaba la fila. La nota del archivo de tests (líneas 27-30) dice exactamente esto. |

### 4.10 Sesión, arranque, aislamiento y límites

| | |
|---|---|
| **ID** | COT-SIST-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Producto arriba. |
| **Pasos** | 1. Anotar la primera línea del log de arranque.<br>2. `curl -s http://localhost:<puerto>/health`.<br>3. Repetir con `POST`.<br>4. `curl -s http://localhost:<puerto>/api/meta`. |
| **Esperado** | El log dice `Cotizaciones (cotizaciones) en <APP_URL> -> puerto <PORT>`. `GET /health` y `POST /health` responden `200 {"ok":true,"product":"cotizaciones","name":"Cotizaciones"}` **sin sesión**. `GET /api/meta` responde `200 {"name":"Cotizaciones","product":"cotizaciones","version":2,"identity":"amg-central"}`, también sin sesión. Si la base no se puede abrir, `/health` responde `503 {"ok":false,"product":"cotizaciones"}` sin nombre ni detalle. |

| | |
|---|---|
| **ID** | COT-SIST-02 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Producto arriba. |
| **Pasos** | 1. Leer `products/cotizaciones/.env.example`.<br>2. Leer `products/cotizaciones/.env`.<br>3. Comparar `PORT`, `DB_PATH`, `CORE_URL` y `APP_URL` entre los dos.<br>4. Anotar el puerto real del log de `COT-SIST-01` y contra qué valor corresponde. |
| **Esperado** | `.env.example`: `PORT=3021`, `DB_PATH=./data/cotizaciones.sqlite`, `CORE_URL=http://localhost:3108`, `APP_URL=http://localhost:3023`, `DB_SCHEMA_VERSION=1`. `.env` (ignorado por git, así que es de esta máquina): `PORT=3004`, `DB_PATH=./data/app.db`, `APP_URL=http://localhost:3004`, y además `JWT_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` y `MAIL_FROM`, que son campos **del producto legacy** que este producto no lee en ningún lado. Tres cosas a anotar: (a) `PORT` y `APP_URL` **no coinciden entre sí ni en el `.env.example`** (`3021` contra `3023`); (b) el `.env` real va a `3004`; (c) `AMG_SSO_CLIENT_ID` no está en el `.env` local, solo en el ejemplo. El puerto que vale es el del log. Ver `R-16`. |

| | |
|---|---|
| **ID** | COT-SIST-03 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Ventana de incógnito sin cookie de sesión. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/api/quotes`.<br>2. Abrir `http://localhost:<puerto>/api/dashboard`.<br>3. Abrir `http://localhost:<puerto>/` en el navegador.<br>4. Abrir `http://localhost:<puerto>/app.js`. |
| **Esperado** | 1 y 2: `401 {"error":"sin-sesion","message":"Tu sesión no está iniciada.","loginUrl":"…"}`: todo lo que empieza con `/api/` es JSON, aunque el `Accept` del navegador sea HTML. 3: `302` hacia el login del Core con `return_to`. 4: también redirige, porque los estáticos se sirven **después** de la identidad (`packages/product-runtime/src/app.ts:147`): sin sesión no baja ni el JavaScript. No hay pantalla de login propia ni campo de contraseña en el HTML. |

| | |
|---|---|
| **ID** | COT-SIST-04 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/me`.<br>2. `GET /api/inicio`.<br>3. Comparar con lo pintado en el canal lateral.<br>4. Contar las llamadas de `COT-NAV-01` otra vez. |
| **Esperado** | `/api/me` responde `200 {"user":{"id","email","name"},"organization":{"id","slug"},"role":"owner\|admin\|member","product":"cotizaciones"}`. `/api/inicio` responde `200 {"usuario":{id,nombre,email},"organizacion":{id,slug,nombre},"rol":"…","herramienta":"cotizaciones","herramientas":[…]}`. `data-amigo="empresa"` muestra `organizacion.nombre`, `data-amigo="usuario"` muestra `usuario.nombre`, `data-amigo="correo"` muestra `usuario.email` y `data-amigo="avatar"` muestra las iniciales del nombre. `/api/inicio` se pide **una sola vez** al montar, y todo sale del token, sin llamada al Core por request. Si el token no trae lista de herramientas, `data-amigo="otras"` queda vacío con su título oculto. |

| | |
|---|---|
| **ID** | COT-SIST-05 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Dos organizaciones con suscripción a `cotizaciones`: la propia (Org A) y una segunda (Org B), con una cotización `QA-COT-2026 AJENA` de `999999` centavos. |
| **Pasos** | 1. Con sesión de **Org A**, pedir `GET /api/quotes`, `GET /api/dashboard` y `GET /api/settings`.<br>2. Pedir `GET /api/quotes/<id de B>`, `GET /api/quotes/<id de B>/lineas`.<br>3. `PATCH`, `DELETE` y `POST /api/quotes/<id de B>/estado` con `{"status":"accepted"}`.<br>4. Con sesión de **Org B**, releer su cotización y su `/api/dashboard`. |
| **Esperado** | 1: `items` no trae ninguna fila de B, `totalCents` **no** cambia al crear la de B y los ajustes de B no aparecen. 2: los dos `404` con `Esa cotizacion no existe` / `No encontrado`. 3: los tres `404`, y la cotización de B sigue `draft` y con sus importes intactos. Nunca `403`: el `404` no confirma que el id exista en otra empresa. Ninguna respuesta filtra nombre, folio ni total de la otra organización. `organizationId` sale siempre de `orgId(req)`, nunca del cuerpo ni de un header. Es la prueba de que la escalada horizontal es imposible por construcción y no por un chequeo. |

| | |
|---|---|
| **ID** | COT-SIST-06 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa, con datos de prueba en los tres paneles. |
| **Pasos** | 1. En Network, recorrer los tres paneles y las acciones de cada uno, contando peticiones.<br>2. Anotar cuántas peticiones por minuto consume el producto.<br>3. Crear una cotización con diez líneas, una por una.<br>4. Forzar el `429` con un bucle de `fetch` desde la consola y observar la respuesta. |
| **Esperado** | El límite es **600 peticiones por 15 min por IP** (`windowMs: 15 * 60 * 1000`, `limit: 600`, cabeceras `draft-8`). Consumo real: **4** en la primera carga, **0 o 1** por cambio de pestaña, **2** por crear una cotización (`GET` de ajustes y de lista al recargar, más la `POST`), **1** por `Ver`, **1** por cada cambio de estado. Agregar diez líneas **no** genera peticiones: son de memoria. Agotado el límite, las peticiones responden `429` y la interfaz muestra el mensaje de error en `#aviso` sin romperse. Un `429` **no** es un defecto del producto: anotar en la sección 9 y esperar la ventana. |

| | |
|---|---|
| **ID** | COT-SIST-07 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Base recién creada, sin cotizaciones. |
| **Pasos** | 1. Entrar y leer `?panel=inicio`.<br>2. Leer `?panel=cotizaciones`.<br>3. `GET /api/quotes`, `GET /api/dashboard`, `GET /api/quotes/next-number` y `GET /api/settings`. |
| **Esperado** | 1: las cinco tarjetas KPI con `0` y `#abiertas` con el texto `No hay cotizaciones esperando respuesta.` 2: la fila `Todavia no hay cotizaciones.`. 3: `{"items":[],"total":0,"limit":500,"offset":0}`; `{"total":0,"porEstado":{"draft":0,"sent":0,"accepted":0,"rejected":0,"expired":0},"totalCents":0,"mesCents":0,"mes":"AAAA-MM"}`; `{"number":1}`; y los cuatro defaults de `settings` con `nextNumber: 1`. **Los cinco estados están en `porEstado` aunque valgan cero**: es deliberado, para que la pantalla no «salte» cuando aparece una columna. Ningún estado vacío es un error: el producto no siembra datos. |

| | |
|---|---|
| **ID** | COT-SIST-08 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Repetir `npm test -w @amg/cotizaciones` y anotar el resultado.<br>2. Buscar en `tests/cotizaciones.test.ts` los casos de aislamiento entre organizaciones.<br>3. Comprobar que las tablas del producto son solo tres. |
| **Esperado** | La suite pasa en verde. Los casos de aislamiento verifican las cinco rutas contra la otra organización (`GET`, `PATCH`, `DELETE`, `POST /estado` y `GET /lineas`) y esperan `[403, 404]`: el test acepta cualquiera de los dos, así que un cambio de `404` a `403` no lo detectaría. Las tablas son `quotes`, `quote_lines` y `settings`, y el test afirma que **no** existan `customers`, `services`, `users` ni `tenants`: este producto no es dueño del cliente. Cada tabla de negocio lleva `organization_id` y al menos un índice por esa columna, y el índice único del folio es `(organization_id, number)`. |

---

## 5. Recorridos E2E

Recorridos completos, de principio a fin, con los datos de la sección 2. Cada uno cruza varios
módulos y termina con una comprobación que delata si algo se rompió por el camino.

| | |
|---|---|
| **ID** | COT-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión activa, base vacía, ajustes en `$` / `America/Santiago` / `1600` / `30`. |
| **Pasos** | 1. En `?panel=ajustes`, confirmar que `#cfg-folio` dice `1`.<br>2. Pulsar `#cotizacion-nueva` y anotar `#cot-folio`, `#cot-emision` y `#cot-vigencia`.<br>3. Escribir `QA-COT-2026 Ana Torres` en `#cot-cliente` y `Diseno de identidad` en `#cot-titulo`.<br>4. Agregar dos líneas: `QA-COT-2026 Logo y tarjetas` `2` × `25000`, y `QA-COT-2026 Traslado` `3` × `1234`.<br>5. Leer `#cot-total`.<br>6. Pulsar `Guardar`.<br>7. Ir a `?panel=cotizaciones` y leer la fila.<br>8. Ir a `?panel=inicio` y leer `#abiertas` y `#cfg-folio` de Ajustes. |
| **Esperado** | 1: `1`. 2: `#cot-folio` = `1`, `#cot-emision` = hoy, `#cot-vigencia` = hoy + 30 días, `#cot-impuesto` = `1600`. 5: `$62,28`. 6: `POST /api/quotes` `201 {"quote":{…,"number":1,"status":"draft"},"lines":[…]}`, `subtotalCents: 5369`, `taxCents: 859`, `totalCents: 6228`, aviso `Cotizacion creada`, diálogo cerrado. 7: la fila muestra `#1`, `QA-COT-2026 Ana Torres`, la fecha de emisión en crudo, la etiqueta `Borrador` y `$62,28`. 8: `#abiertas` muestra `#1 · QA-COT-2026 Ana Torres` con la nota `Diseno de identidad` y `$62,28`; `#cfg-folio` ahora dice `2`. La numeración avanzó una vez y solo una. |

| | |
|---|---|
| **ID** | COT-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | COT-E2E-01 ejecutado. |
| **Pasos** | 1. Con la fila de `#1` en pantalla, pulsar `Ver`.<br>2. Pulsar `Pasar a Enviada`.<br>3. Pulsar `Pasar a Aceptada`.<br>4. Cerrar y volver a abrir con `Ver`.<br>5. Ir a `?panel=cotizaciones`, filtrar por `Aceptada`.<br>6. Ir a `?panel=inicio` y comparar `#abiertas` y `#resumen`.<br>7. `GET /api/quotes/<id>` y leer `sentAt`, `acceptedAt` y `totalCents`. |
| **Esperado** | 2: `POST /api/quotes/<id>/estado` `200 {"quote":{…,"status":"sent"}}`, `sentAt` con ISO, aviso `Estado actualizado`, y el diálogo **sigue abierto** con los botones recalculados a `Pasar a Aceptada`, `Pasar a Rechazada`, `Pasar a Vencida`. 3: `200`, `acceptedAt` con ISO, `sentAt` **conservado**, botones reducidos al texto `Una cotizacion Aceptada ya no cambia de estado.`. 5: `#filtro-estado` = `Aceptada` deja solo esa fila, sin peticiones. 6: `#abiertas` **ya no** la lista (exige `sent` o `draft`) y la tarjeta `Aceptadas` del resumen sube en 1. 7: los dos sellos con valor y `totalCents: 6228` intacto. La máquina de estados, los sellos y las cifras del tablero son coherentes entre sí. |

| | |
|---|---|
| **ID** | COT-E2E-03 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | COT-E2E-01 ejecutado; ajustes con impuesto `0` y vigencia `1`. |
| **Pasos** | 1. Crear una cotización con una sola línea de `3333` centavos y cantidad `0.5` **por API**.<br>2. En `?panel=cotizaciones`, abrirla con `Ver` y leer `#cot-total` y la nota de `#cot-lineas`.<br>3. Poner `#cfg-impuesto` = `1600` en Ajustes y guardar.<br>4. Reabrir esa misma cotización con `Ver` y leer `#cot-impuesto` y `#cot-total`.<br>5. Volver a abrir una cotización **nueva** y leer `#cot-impuesto` y `#cot-total`.<br>6. Repetir el paso 3 con `#cfg-impuesto` = `1900` y volver al paso 4. |
| **Esperado** | 2: la nota dice `0.5 × $33,33` — cantidad **cruda**, sin coma decimal — y `#cot-total` dice `$16,67`, que es `Math.round(0.5 × 3333)`. 4: `#cot-impuesto` sigue en `0` y `#cot-total` en `$16,67`: cambiar el default de Ajustes **no** toca una cotización existente, en ninguna dirección. 5: `#cot-impuesto` = `1600` y `#cot-total` = `$19,34`, que es `1667 + Math.round(1667 × 0,16) = 1667 + 267`. 6: tampoco cambia la vieja. Es el recorrido del invariante del producto: **el total se materializa al escribir y no se recalcula al leer**. Si el paso 4 o el 6 movieran `#cot-total`, el histórico de la empresa cambiaría de un día para otro. |

| | |
|---|---|
| **ID** | COT-E2E-04 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | COT-E2E-01 ejecutado; cartera con la cotización `#1` en `draft`. |
| **Pasos** | 1. Abrir `#1` con `Ver` y anotar `#cot-folio`.<br>2. Guardar sin cambiar nada.<br>3. Crear una segunda cotización y anotar su folio.<br>4. Volver a `#1` con `Ver`, cambiar `#cot-cliente`, guardar, y releer el folio.<br>5. Intentar que dos navegaciones usen el mismo folio: en `#1`, cambiar `#cot-folio` a `3` y guardar.<br>6. Borrar la cotización de folio más alto y abrir `Nueva cotización`.<br>7. Borrar **todas** las cotizaciones y abrir `Nueva cotización`. |
| **Esperado** | 2 y 4: el folio de `#1` **no se mueve** ni al guardar sin cambios ni al editar el cliente. 3: la nueva recibe el folio siguiente. 5: `409 {"error":"Ya existe la cotizacion numero 3 en esta empresa"}`, que nombra el número, y `#aviso` lo muestra en rojo sin cerrar el diálogo. Ojo con este paso: `#cot-folio` es un input editable, así que **la interfaz permite fijar el folio a mano** y abrir huecos en la numeración — la única defensa es el índice único por organización. Registrar si se considera defecto (`R-16`). 6: `nextNumber` no baja: sigue siendo el máximo más uno. 7: con cero cotizaciones, `nextNumber` vuelve a `1`. Es `MAX + 1`, no `CONT + 1`. |

| | |
|---|---|
| **ID** | COT-E2E-05 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Por API, `POST /api/quotes` con `"status":"accepted"` y una línea de `25000` centavos.<br>2. En `?panel=cotizaciones`, buscarla por folio en `#buscar` y abrirla con `Ver`.<br>3. Intentar devolverla a borrador desde la interfaz.<br>4. Intentar lo mismo por API con `POST /api/quotes/<id>/estado` y luego con `PATCH`.<br>5. Cambiar el cliente y las líneas y guardar.<br>6. Borrarla con `Borrar` y volver a crearla. |
| **Esperado** | 2: la fila aparece con la etiqueta `Aceptada` y `#cot-estados` con el texto de terminal: **nunca bornó `Borrador`**. 3 y 4: no hay ningún camino. `POST /estado` da `400` y el `PATCH` descarta `status`. 5: el `PATCH` sí funciona y recalcula importes, pero `acceptedAt` no se toca: queda la fecha de una aceptación que nadie negoció. 6: es la única salida, y deja un hueco en la numeración. El recorrido entero demuestra que el salto de estado por `POST` no es una prueba de laboratorio: desde la interfaz no hay vuelta atrás. Ver `R-01`. |

| | |
|---|---|
| **ID** | COT-E2E-06 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión activa, cartera con los cinco estados y una cotización de `0` centavos. |
| **Pasos** | 1. En `?panel=cotizaciones`, escribir `QA-COT-2026` en `#buscar` y contar filas y peticiones.<br>2. Poner `#filtro-estado` = `Vencida` y volver a contar.<br>3. Volver a `Todos los estados`, abrir con `Ver` la cotización de `0` centavos y leer `#cot-total` y `#cot-lineas`.<br>4. Agregar la línea `QA-COT-2026 Relleno` `1` × `100` con `#cot-impuesto` en `0`.<br>5. Poner `#cot-impuesto` en `1900` sin tocar la línea.<br>6. Pulsar `Guardar` y releer `GET /api/quotes/<id>`.<br>7. Ir a `?panel=inicio` y comparar `#abiertas` con la columna `Estado`.<br>8. Volver a `?panel=cotizaciones`, borrar las cinco de la cartera con `Borrar` y abrir `Nueva cotización`. |
| **Esperado** | 1: las cinco filas de la cartera y **ninguna** petición de red —`#buscar` filtra en memoria sobre `estado.cotizaciones` y su `input` solo llama `pintarCotizaciones()`. 2: solo las `expired`, y tampoco hay petición: `#filtro-estado` se arma una vez (`pintarFiltroEstado`) y filtra en memoria. 3: `#cot-total` = `$0` y `#cot-lineas` con el texto `Sin lineas.`. 4: `$1`. 5: `#cot-total` pasa a `$1,19` sin que se vuelva a agregar la línea: `#cot-impuesto` tiene su propio `input` a `pintarLineas()` (`public/app.js:344`) y el recuadro se recalcula en vivo con la misma fórmula del servidor, `subtotal + Math.round(subtotal × bp / 10 000)`. 6: `PATCH` `200` con `subtotalCents: 100`, `taxCents: 19`, `totalCents: 119`: lo que se leía antes de guardar es exactamente lo que queda escrito. 7: `#abiertas` lista las `draft` y las `sent`; la `accepted`, la `rejected` y la `expired` no aparecen, y la que valía `0` tampoco es un caso especial. 8: cada `Borrar` pregunta `Borrar la cotizacion y sus lineas?`, responde `DELETE /api/quotes/<id>` `200 {"ok":true,"deleted":true}` y avisa `Cotizacion borrada`; las líneas se van solas por el `ON DELETE CASCADE`, sin una sola llamada a `/lineas`. Al terminar, la tabla dice `Todavia no hay cotizaciones.`, `#abiertas` dice `No hay cotizaciones esperando respuesta.` y `#cfg-folio` de Ajustes vuelve a `1`. |

**COT-E2E-05** es el recorrido del salto de estado por `POST /api/quotes`: la cita nace
`Aceptada` sin pasar por `draft` y no hay vuelta atrás. Los tres siguientes son los tramos que ese
recorrido deja abiertos.

| | |
|---|---|
| **ID** | COT-E2E-07 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | COT-E2E-02 ejecutado: la cotización `#1` está `Aceptada`. |
| **Pasos** | 1. Abrir `#1` con `Ver` y recorrer `#cotizacion-dialog` de arriba abajo.<br>2. Buscar en el diálogo un botón de descargar, imprimir o compartir.<br>3. Cerrar el diálogo, pulsar `Ctrl+P` y mirar la vista previa.<br>4. Copiar la URL del navegador y abrirla en una ventana de incógnito.<br>5. Pedir `GET /api/quotes/<id>/pdf`, `GET /api/quotes/<id>/publico` y `GET /api/publico/<token>`. |
| **Esperado** | 1: `#cotizacion-form-titulo`, los campos, `#cot-lineas`, `#cot-estados` con el texto de terminal y el pie con `#cot-total`. **Ningún control de salida**: no hay descarga, ni impresión, ni compartir, ni enlace. 2: no existe ninguno. 3: la vista previa imprime el formulario crudo —el `dialog` con los `input` y sus valores, y el botón `Guardar`— porque ni `style.css` ni `amigo.css` tienen una regla `@media print`. No es un documento: es la pantalla. 4: la misma pantalla con sesión; no hay token, ni ruta pública, ni lectura sin sesión. 5: los tres `404 {"error":"No encontrado"}`. El recorrido termina en un hueco y **no es un error de la suite**: es alcance ausente. Registrar `R-05` y `R-06` en la §7 y anotar en la §9 que esta etapa no existe. |

| | |
|---|---|
| **ID** | COT-E2E-08 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Dos organizaciones con suscripción (`Org A` y `Org B`), las dos sin cotizaciones. |
| **Pasos** | 1. Con **Org A**, ir a `?panel=ajustes` y leer `#cfg-folio`.<br>2. Crear una cotización y anotar el folio que propose `#cot-folio`.<br>3. Con **Org B**, leer `#cfg-folio` y crear otra cotización.<br>4. Volver a **Org A** y releer `#cfg-folio`; después a **Org B**.<br>5. `GET /api/quotes` en las dos organizaciones y comparar `items[].number`.<br>6. Borrar la `#1` de **Org B** y releer `#cfg-folio` de **Org B** y de **Org A**. |
| **Esperado** | 1: `1`. 2: la primera de A es `#1` y `#cfg-folio` pasa a `2`. 3: la primera de B **también** es `#1`: el folio se cuenta por organización (`SELECT MAX(number) … WHERE organization_id = ?`), no con un contador global, y eso es lo correcto para un documento que se numera por empresa. 4: `2` en A y `2` en B, sin saltos ni Huecos en ninguna. 5: `number: 1` en las dos. 6: en B vuelve a `1` (`MAX + 1`, no «el menor libre») y la de A sigue intacta. El recorrido demuestra que `nextNumber` viaja en `GET /api/settings` y que el índice único es `(organization_id, number)`: dos empresas pueden tener un `#1` y una sola de ellas puede tener dos `#1`. |

| | |
|---|---|
| **ID** | COT-E2E-09 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión en una organización cuyo producto de clientes **no** conoce a `QA-COT-2026 Nuevo`. |
| **Pasos** | 1. Escribir `QA-COT-2026 Nuevo` en `#cot-cliente` y guardar, sin tocar nada más.<br>2. Repetir escribiendo `cliente_inexistente_2026` en `#cot-cliente-id`.<br>3. Por API, `GET /api/customers/cliente_inexistente_2026` y guardar la cita con ese `customerId`.<br>4. Buscar `QA-COT-2026 Nuevo` en `#buscar` y abrir la fila con `Ver`. |
| **Esperado** | 1: `POST /api/quotes` `201` y la cita guardada con el nombre tal cual, sin aviso ni sugerencia. **No hay paso de «crear cliente» en este producto**: el cliente se escribe a mano, y la pista del campo lo dice (`Los clientes viven en el producto Clientes. Acá va el nombre.`). 2 y 3: la referencia no se valida en ningún punto —ni `#cot-cliente`, ni `#cot-cliente-id`, ni el `PATCH`—, y `customer_id` es texto sin llave foránea: un id que no existe entra igual y la cita queda apuntando al vacío. `GET /api/customers/...` da `404`, pero **no lo consulta nadie**: el `404` de ese paso es del módulo de Clientes, no de Cotizaciones. 4: la fila aparece con el nombre tal cual y `#cot-cliente-id` con el id inventado. Registrar `R-14`: que no exista la tabla `customers` es deliberado (`COT-SIST-08`), pero no hay ni un aviso de que el cliente no exista. |

---

## 6. Regresión compartida

Todo lo que toca código compartido: `amigo.js`, `amigo-ui.js`, `amigo.css`, el middleware de
identidad, `crudRouter`, `express.json`, `rateLimit`, `helmet`. Los riesgos genéricos están en
`10-regresion-compartida.md`; aquí solo lo que este producto debe cumplir del shell.

| | |
|---|---|
| **ID** | COT-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa y `Network` abierto desde antes de cargar la página. |
| **Pasos** | 1. Abrir `/?panel=cotizaciones` en una pestaña nueva.<br>2. Recorrer Inicio → Cotizaciones → Ajustes → Inicio contando peticiones por paso.<br>3. Leer `h1[data-amigo="titulo"]`, `data-amigo="empresa"`, `data-amigo="usuario"`, `data-amigo="correo"` y `data-amigo="avatar"`.<br>4. Ir atrás y adelante con el navegador.<br>5. Mirar `data-amigo="otras"`.<br>6. Mirar el logo del canal. |
| **Esperado** | 1: visible solo Cotizaciones; las otras dos secciones con `hidden`. La URL manda, no el orden del HTML. 2: la primera entrada a Inicio pide `/api/dashboard` **dos veces** (`AMIGO.montar` corre `alEntrar` en el primer pintado y otra vez al guardar la URL, y `pintarInicio` no tiene guardia); volver a Inicio pide **una**; Cotizaciones y Ajustes piden **cero**, porque la lista ya está en memoria y `pintar('ajustes')` corta antes de hacer nada. Ese `+1` es `R-13`. 3: el nombre de la sección activa, la organización y el usuario, con iniciales en el avatar; salen de `GET /api/inicio`, no de un dato escrito en el HTML. 4: atrás y adelante repintan la sección correcta sin recargar. 5: oculto: el token trae una sola herramienta, así que no hay «otras». 6: el logo muestra `CO`, no el `CQ` del HTML (`R-12`). |

| | |
|---|---|
| **ID** | COT-REG-02 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Cartera con al menos tres cotizaciones de clientes, títulos y folios distintos. |
| **Pasos** | 1. `GET /api/quotes` sin parámetros.<br>2. `GET /api/quotes?limit=500&offset=0`.<br>3. `GET /api/quotes?q=<cliente>`, `?q=<palabra del titulo>` y `?q=<folio>`.<br>4. `GET /api/quotes?q=%`.<br>5. `GET /api/quotes?status=expired` y `?status=no-existe`.<br>6. `GET /api/quotes?sort=number` y `?sort=totalCents`. |
| **Esperado** | 1: `{"items":[…],"total":N,"limit":200,"offset":0}` — `defaultLimit` es 200 y `maxLimit` 1000 (`crud.ts:170-171,228`). El orden es siempre folio descendente. 2: `limit: 500`; el tope de 1000 nunca entra y **el `total` sigue siendo el conteo real**, no el de la página (es lo que hace visible `R-11`). 3: las tres búsquedas devuelven filas y el folio funciona porque `number` entra en `search` (`routes.ts:598`). 4: `q=%` devuelve **todas** y `total` es el de todas: el patrón `%${q}%` no escapa el comodín (`R-10` lo cuenta como riesgo compartido). 5: `?status=expired` devuelve la lista **completa**: este producto no pasa `filters` al `crudRouter`, así que el parámetro se ignora en silencio, sin `400` y sin aviso (`R-10`). 6: `?sort=` también se ignora: el `orderBy` es fijo (`number desc`) y no hay forma de cambiarlo desde la query. Ninguno de los dos rechazos es un error visible: la pantalla deja de filtrar sin avisar. |

| | |
|---|---|
| **ID** | COT-REG-03 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa, con `#aviso` visible y una cotización abierta en otra pestaña. |
| **Pasos** | 1. Provocar un `400` de validación: `POST /api/quotes` con `customerName` de 200 caracteres.<br>2. Provocar el `409` del folio desde el diálogo.<br>3. Provocar un `404`: `GET /api/quotes/cot_no_existe`.<br>4. Provocar un `413`: un cuerpo mayor a 1 MB.<br>5. Esperar más de 5000 ms sin hacer nada. |
| **Esperado** | 1: `400 {"error":"Datos inválidos","errors":{"fieldErrors":{…}}}` y `#aviso` en rojo con el mensaje. 2: `409 {"error":"Ya existe la cotizacion numero N en esta empresa"}`, también en rojo y **sin cerrar el diálogo**. 3: `404 {"error":"Esa cotizacion no existe"}` — el producto intercepta el `404` para nombrarlo, en vez del `No existe GET …` del comodín. 4: `413 {"error":"La petición es demasiado grande"}`: el límite de `express.json` es 1 MB (`app.ts:96`). 5: `#aviso` se oculta solo a los 5000 ms. **Un solo elemento para todos los mensajes**: `AMIGO_UI.avisar` reutiliza `#aviso`, lo marca y programa el `hidden` (`amigo-ui.js:266-277`). Ojo con `R-03`: los errores que ocurren **con el diálogo abierto** (descripción vacía, `409`, cambio de estado) caen en un `#aviso` que vive fuera del `dialog`, así que quedan detrás del fondo atenuado y fuera de la vista. |

| | |
|---|---|
| **ID** | COT-REG-04 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Ventana de incógnito sin cookie de sesión. |
| **Pasos** | 1. Abrir la raíz del producto.<br>2. Pedir `GET /api/quotes` sin cookie.<br>3. Pedir `GET /health` y `GET /api/meta` sin cookie.<br>4. Con sesión, pedir `GET /api/me` y `GET /api/inicio`.<br>5. Invalidar la cookie y pulsar `Guardar` en el diálogo abierto.<br>6. Mirar la cabecera `Cookie` de cualquier petición. |
| **Esperado** | 1: el middleware redirige al Core y la pantalla nunca se sirve a ciegas: **el producto no tiene login propio**. 2: `401 {"error":"sin-sesion","loginUrl":…}` — y para un `fetch` sin sesión lo que llega es ese JSON, no un `302`. 3: `200` en las dos: `/health` y `/api/meta` son públicas. 4: `200` con `user`, `organization`, `role` y `product`; `rol` es uno de `owner`, `admin`, `member`. 5: el `401` se muestra en `#aviso` y el formulario no se envía. 6: la cookie de sesión es `HttpOnly`: no aparece en `document.cookie`. Anotar en la §9 la diferencia entre lo que ve el usuario (redirección) y lo que ve una llamada suelta (`401` con `loginUrl`). |

| | |
|---|---|
| **ID** | COT-REG-05 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa, `Network` con la casilla «Disable cache». |
| **Pasos** | 1. Pedir `/`, `/style.css`, `/app.js`, `/amigo.js`, `/amigo-ui.js` y `/amigo.css`.<br>2. Comparar la URL de `amigo.js` y `amigo-ui.js` con la del HTML.<br>3. Leer `Cache-Control` de `app.js` en desarrollo y con `NODE_ENV=production`.<br>4. Leer `Content-Security-Policy` y `X-Powered-By`.<br>5. Pedir `/favicon.ico`. |
| **Esperado** | 1: los cinco `200`. `amigo.css` lo importa `/style.css`, no al revés, así que los estilos del producto llegan después de los compartidos. 2: los dos archivos compartidos llevan `?v=` con la huella de la versión; si el dedo no cambia, el navegador los toma de caché. 3: `no-store` en desarrollo y `max-age` largo con `immutable` en producción (`app.ts:159-165`): sin `immutable` en desarrollo, para recargar hay que recargar de verdad. 4: **`no` hay CSP** y `X-Powered-By` **no** aparece. Es decisión de plataforma y está en `10-regresion-compartida.md` como `R-S-02`: aquí solo se comprueba que el producto no la rompe. 5: `404`. Este producto no trae favicon (`R-S-11`). |

| | |
|---|---|
| **ID** | COT-REG-06 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa y los tres paneles con datos. |
| **Pasos** | 1. Contar las columnas de `#cotizaciones-lista` y las celdas de la primera fila.<br>2. Forzar la lista vacía y volver a forzarla con `q` sin resultados.<br>3. Cambiar de estado hasta ver las cinco etiquetas de `#cot-estados` y las de la columna `Estado`.<br>4. Mirar la alineación de las cifras de `#resumen`.<br>5. Comparar `#aviso` verde y rojo. |
| **Esperado** | 1: **6** columnas (`#cotizaciones-tabla` es de 6 y `#abiertas` usa `celda(4, 'num')`) y 6 celdas por fila; si el `th` y el `td` no coinciden, el `colspan` del vacío queda corrido. 2: una fila con `colspan="6"` y `Todavia no hay cotizaciones.` / `Sin resultados para la busqueda.` —nunca un `tbody` vacío. 3: los mismos cinco textos y los mismos cinco tonos en el diálogo y en la tabla; los tres terminales (`accepted`, `rejected`, `expired`) usan tono neutro. Es la comprobación de que `estadoDe()` y `ESTADOS` siguen de acuerdo en cliente y servidor. 4: los importes de `#resumen` salen alineados a la derecha (`num`); los enteros como `Cotizaciones` y `Enviadas`, también. 5: `ui-aviso--ok` verde y `ui-aviso--malo` rojo. El aviso de `Ajustes guardados` no es una clase distinta: es el mismo elemento con otro tono. |

| | |
|---|---|
| **ID** | COT-REG-07 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | `Network` limpio, con la primera carga ya hecha. |
| **Pasos** | 1. Escribir diez caracteres en `#buscar`, uno por uno.<br>2. Mover `#filtro-estado` tres veces.<br>3. Pulsar `Guardar` en el diálogo de una cotización nueva.<br>4. Pulsar `Ver` en una fila.<br>5. Cambiar el estado dos veces y pulsar `Borrar`.<br>6. Guardar los ajustes de Ajustes. |
| **Esperado** | 1 y 2: **cero** peticiones: el buscador y el filtro son de memoria en este producto, al revés que en Solicitudes, y por eso no pueden agotar la ventana de 600. 3: `POST /api/quotes` y, detrás, el `recargar()` completo —`GET /api/quotes?limit=500`, `GET /api/settings` y `GET /api/dashboard`—: **cuatro** peticiones para un alta. 4: **una**: `GET /api/quotes/<id>/lineas`. 5: **una** por cambio de estado (`POST /api/quotes/<id>/estado`) y **una** por el borrado; las líneas no se van a borrar de una en una. 6: `PUT /api/settings` y el mismo `recargar()` de tres. El total por sesión debe quedarse muy por debajo de 600; si se dispara, es que algo se está pidiendo en bucle (`R-13` es el sospechoso). |

| | |
|---|---|
| **ID** | COT-REG-08 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Tres sesiones: una `owner`, una `admin` y una `member` de la misma organización. |
| **Pasos** | 1. Con cada sesión, leer `GET /api/me` y anotar `role`.<br>2. Crear y borrar una cotización con las tres.<br>3. Cambiar el estado de una cotización con las tres.<br>4. `PUT /api/settings` con las tres.<br>5. Comparar las tres pantallas. |
| **Esperado** | 1: `owner`, `admin` y `member`. 2 y 3: las tres dan `200`: **el piso de escritura es `member`**, porque las rutas de escritura no piden más rol que `requireRole('member')`. 4: **`200` con las tres**: `PUT /api/settings` es la única ruta sin control de rol de todo el producto, así que un `member` cambia la moneda, la zona, el impuesto por defecto y la vigencia de su organización. 5: las tres pantallas son idénticas: el shell no lee el rol para ocultar nada, así que **no hay ninguna diferencia visual** entre un `member` y un `owner`. Un `403 rol-insuficiente` (`middleware.ts:203`) es imposible desde el Core, porque no emite un rol por debajo de `member`: es una ruta que no se puede probar desde la interfaz, solo por API con un token falso. |

| | |
|---|---|
| **ID** | COT-REG-09 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa, ancho 1280. |
| **Pasos** | 1. Recorrer los tres paneles mirando `hidden` y `data-panel`.<br>2. Abrir y cerrar el diálogo con `Ver`, con `Cancelar`, con la × y con `Esc`.<br>3. Con el diálogo abierto, tabular hasta `#cotizacion-cerrar` y hasta `Guardar`.<br>4. Pulsar el fondo atenuado.<br>5. Comparar el `h1` de la página con el `h2` del diálogo. |
| **Esperado** | 1: cada sección tiene `data-panel` con su nombre y solo una visible; `hidden` es real, no `display: none` escrito a mano. 2: los cuatro cierres funcionan y ninguno envía nada. 3: el foco entra al diálogo y se mueve dentro: el `dialog` modal lo hace por sí mismo, pero hay que confirmarlo. 4: **no** cierra (comportamiento estándar del `dialog`). 5: son distintos: el `h1` es el nombre de la sección y el `h2` (`#cotizacion-form-titulo`) es el de la cotización. Ojo: el `dialog` no tiene `aria-label` ni `aria-labelledby`, aunque el `h2` tenga id — es el mismo hueco de accesibilidad que se vio en el producto de Tickets, y aquí es propio de este HTML (`R-18`). |

| | |
|---|---|
| **ID** | COT-REG-10 |
| **Tipo / Prioridad** | REG / P2 |
| **Precondición** | Sesión activa y consola con el filtro `error` limpio. |
| **Pasos** | 1. `POST /api/quotes` con un cuerpo JSON mal formado (una llave de menos).<br>2. Repetir con un arreglo donde se espera un objeto.<br>3. Forzar el `429` con un bucle de `fetch`.<br>4. Recorrer de nuevo los tres paneles con la consola abierta.<br>5. Pedir `/favicon.ico`. |
| **Esperado** | 1 y 2: `500 {"error":"Error interno del servidor"}`: **el JSON mal formado es un error interno** y no un `400`, porque `express.json` lanza antes de que el producto mire el cuerpo (`errors.ts:40`). Es genérico de la plataforma (`R-S-03`) y hay que anotarlo cada vez que salga, no es un defecto de Cotizaciones. 3: `429` con las cabeceras de la ventana; la interfaz lo muestra en `#aviso` sin romperse, y no es un defecto: esperar la ventana. 4: consola limpia salvo lo que dipan `R-19` y `R-20`. 5: `404`, como en los otros productos (`R-S-11`). |

---

## 7. Riesgo conocido

Defectos y trampas **sospechados en el código**, no ejecutados: cada uno dice dónde mirar y
cómo confirmarlo en el navegador o en Network. Los que son de la capa compartida y no de
este producto están en `10-regresion-compartida.md` y no se repiten aquí. La columna `Estado`
distingue lo que se lee **confirmado** en el código de lo que hay que **sospechar** porque
depende del navegador.

| Riesgo | Dónde | Cómo se confirma | Estado | Severidad |
|---|---|---|---|---|
| **R-01** **Una cotización puede nacer en `accepted`, `sent` o `expired` sin pasar por `draft`, y no hay vuelta atrás.** El `POST /api/quotes` acepta `status` en el cuerpo y lo usa tal cual (`schema.ts:141` tiene `.default('draft')`, pero el valor que llegue gana), y sella los campos en el mismo paso: `sentAt` para `sent`, `accepted` **y** `expired`, `acceptedAt` para `accepted`. Después `POST /estado` rechaza volver a `draft` con `400 Una cotizacion accepted no vuelve a borrador: cotiza una nueva.`, y el `PATCH` ni siquiera acepta `status`. Una cita aceptada sin negociación es indistinguible de una aceptada de verdad: los dos `acceptedAt` se escriben con el mismo `ahora`. | `products/cotizaciones/src/schema.ts:141`, `products/cotizaciones/src/routes.ts:441-445`, `products/cotizaciones/src/routes.ts:316-336`, `products/cotizaciones/src/routes.ts:508` | Crear por API con `"status":"accepted"` y comparar `acceptedAt` con el de una creada en `draft` y pasada por `sent`: si los dos tienen sello sin que nadie haya respondido, está confirmado. Desde la interfaz no hay vuelta atrás: `POST /estado` da `400` y `PATCH /api/quotes/<id>` con `"status":"draft"` da `200` sin tocar el estado. `COT-E2E-05`, `COT-EST-01`. | Confirmado | Alta |
| **R-02** **`defaultTaxRateBp` se pide en puntos básicos y la interfaz lo enseña crudo.** El `input` es `min="0" max="10000"` con la pista `(1600 = 16%)` (`index.html:191-192`), y en Ajustes el `<label>` dice `Impuesto (%)` mientras el valor es `1600`. Quien lea la etiqueta —y no la pista— escribe `16` y guarda un 0,16 %. No hay conversión en ninguna parte: `1600` son 1600 puntos y el cálculo es `subtotal × bp / 10 000`. | `products/cotizaciones/public/index.html:118,191`, `products/cotizaciones/public/app.js:247-248,323`, `products/cotizaciones/src/routes.ts:418-424` | Poner `#cfg-impuesto` = `16` en Ajustes, guardar, abrir `Nueva cotización` y crear una cita de `10000` centavos: si el total es `10016` en vez de `11600`, está confirmado. Al revés también: dejar `1600` y una cita de `10000` da `11600`. `COT-EDIT-02`. | Confirmado | Media |
| **R-03** **Los errores que pasan con el diálogo abierto se pintan detrás del fondo atenuado.** `#aviso` es un hermano de `#cotizacion-dialog`, no un hijo (`index.html:236`), y un `dialog` modal se pinta en el *top layer*, por encima de cualquier elemento normal de la página. Todos los fallos de validación de línea, el `409` del folio y el fallo del cambio de estado pasan por el mismo `#aviso` (`app.js:334,270,373`), así que el usuario ve el formulario intacto y ninguna explicación de por qué no se guardó. | `products/cotizaciones/public/index.html:141,236`, `products/cotizaciones/public/app.js:270,334,373`, `packages/product-runtime/public/amigo.css:677-685` | Con el diálogo abierto, agregar una línea sin descripción y mirar si `#aviso` se ve: si el texto aparece tapado, atenuado, o si hay que cerrar el diálogo para leerlo, está confirmado. El efecto visual hay que verlo en Chrome; lo que el código sí confirma es que `#aviso` está fuera del `dialog`. `COT-LINE-02`, `COT-ALTA-07`. | Sospechado (la posición, confirmada) | Alta |
| **R-04** **La interfaz no puede escribir la media unidad que el servidor acepta.** `#linea-cantidad` es `type="number" min="1" step="0.5"` (`index.html:209`) y el servidor valida `qty > 0` sin cota inferior entera (`routes.ts:129`), así que `0.5` es legal en la API y llega a la base, pero el input frena al teclado en `1`. Además `#linea-precio` es `step="1"`: los centavos no se pueden escribir de a uno. | `products/cotizaciones/public/index.html:209,213`, `products/cotizaciones/src/routes.ts:129,133` | Escribir `0.5` en `#linea-cantidad`: si el navegador lo rechaza o lo deja en `1`, está confirmado. Por API, `POST /api/quotes/<id>/lineas` con `qty: 0.5`: si acepta `201`, la diferencia está confirmada. `COT-LINE-04`. | Confirmado | Media |
| **R-05** **No hay PDF, ni plantilla, ni impresión.** No hay ruta, ni botón, ni `window.print`, ni una regla `@media print` en `style.css` ni en `amigo.css`. Una cotización aceptada no tiene ninguna forma de salir del producto como documento: lo único que hay es el formulario abierto en la pantalla. | `products/cotizaciones/src/routes.ts` (sin ruta de pdf), `products/cotizaciones/public/app.js` (sin `print`), `products/cotizaciones/public/style.css` (sin `@media print`) | `Ctrl+P` sobre el diálogo abierto: si la vista previa muestra los `input` con sus valores y el botón `Guardar`, está confirmado. `GET /api/quotes/<id>/pdf` da `404`. `COT-E2E-07`. | Confirmado | Media |
| **R-06** **No hay enlace público, ni token, ni correo.** `#cot-correo` se guarda y no lo usa nadie; no hay ruta pública, ni `share`, ni envío. La cita solo se ve con sesión y desde la organización que la creó: el «enviar la presupuesto al cliente» no existe. | `products/cotizaciones/public/index.html:168`, `products/cotizaciones/src/schema.ts:139`, `products/cotizaciones/src/routes.ts:475-487` | Llenar `#cot-correo`, guardar y buscar `noreply` o `sendMail` en todo el producto: si no aparece nada, está confirmado. Abrir la cita en incógnito: da el login, no la cita. `COT-E2E-07`. | Confirmado | Media |
| **R-07** **El formato de moneda no es de dinero.** `AMIGO_UI.dinero()` divide por 100 y fija `minimumFractionDigits: 0` **sin** `maximumFractionDigits`, así que un entero se ve `$62` en vez de `$62,28` y la coma queda como separador decimal. Además `#resumen` pinta `mesCents` con `formatearNumero`, sin el símbolo. | `packages/product-runtime/public/amigo-ui.js:52-57`, `packages/product-runtime/public/amigo-ui.js:238-259`, `products/cotizaciones/public/app.js:110` | Crear una cita de `6228` centavos y leer la fila: si dice `$62` y no `$62,28`, está confirmado. Es una convención compartida con los nueve productos (`10-regresion-compartida.md`), pero en Cotizaciones es donde más se nota: los importes son el producto. `COT-EDIT-01`. | Confirmado | Media |
| **R-08** **Las tarjetas del resumen no coinciden con lo que cuentan.** `#resumen` pinta cinco KPIs: `Cotizaciones` = `d.total`, `Enviadas` = `porEstado.sent`, `Aceptadas` = `porEstado.accepted`, `Del mes (AAAA-MM)` = `mesCents` **sin formatear como dinero** y `En la mesa` = `totalCents`. El servidor excluye las `rejected` de `totalCents` y de `mesCents`, pero **no** de `total`, así que «Cotizaciones» cuenta las rechazadas y «En la mesa» no. Además `mesCents` es un entero de centavos desnudo junto a dos cifras de dinero. | `products/cotizaciones/public/app.js:106-112`, `products/cotizaciones/src/routes.ts:249,252-260` | Crear una cita `rejected` de `999999` centavos y comparar `Cotizaciones` con `En la mesa`: si la primera sube y la segunda no, está confirmado. Comparar también `Del mes (AAAA-MM)` con el formato del resto. `COT-INICIO-01`, `COT-INICIO-02`. | Confirmado | Alta |
| **R-09** **El dinero que manda el cliente se descarta en silencio.** El `POST`/`PATCH` own construye el cuerpo con `z.object({ … }).strict()` para el estado inicial, pero las líneas y el sobre se validan con `z.object` sin `.strict()`: mandar `lineTotalCents`, `subtotalCents`, `totalCents`, `nextNumber` u `organizationId` no da `400`, da `201`/`200` **con los valores calculados por el servidor**. El `crudRouter` también los ignora en silencio, salvo `status`, que además da `422`. | `products/cotizaciones/src/routes.ts:133-148,489-528,552-559`, `packages/product-runtime/src/crud.ts:148` | `POST /api/quotes` mandando `"totalCents": 1`: si responde `201` con `totalCents` calculado y no `1`, está confirmado. Lo mismo con `"lineTotalCents": 1` en una línea, y con `"organizationId"` de otra organización: la respuesta nunca acepta nada de eso. | Confirmado | Media |
| **R-10** **El filtro de estado de la URL se ignora en silencio.** `crudRouter` solo lee los `filters` que se le pasaron, y Cotizaciones no pasa ninguno (`routes.ts:592-623`), así que `GET /api/quotes?status=expired` devuelve la lista completa: ni `400`, ni lista vacía, ni aviso. Un `?status` sin valor sí se ignora por diseño del runtime. El buscador tampoco escapa `%` ni `_`. | `products/cotizaciones/src/routes.ts:592-623`, `packages/product-runtime/src/crud.ts:205-226` | `GET /api/quotes?status=expired` y comparar `total` con el de `GET /api/quotes`: si son iguales, está confirmado. Escribir `%` en `#buscar` y ver la lista completa. `COT-BUS-02`. | Confirmado | Media |
| **R-11** **La lista se trunca en 500 y la pantalla no lo avisa.** `app.js` pide `limit=500`, lee solo `lista.items` y tira `total` a la basura; el servidor lo devuelve bien (`{ items, total, limit, offset }`) y `total` es el conteo real. Con más de 500 cotizaciones, las más viejas son inalcanzables desde la interfaz y no hay paginador ni aviso. | `products/cotizaciones/public/app.js:74-75`, `packages/product-runtime/src/crud.ts:228,248` | Sembrar 520 cotizaciones por API y comparar `GET /api/quotes?limit=500` con `total` y con `items.length`: si `total` es 520 y `items.length` es 500, está confirmado. En pantalla, la tabla muestra 500 filas y nada más. `COT-LST-01`. | Confirmado | Alta |
| **R-12** **El logo dice `CO` y el HTML dice `CQ`.** `pintarCuenta` parte del `CQ` del `index.html` y lo reemplaza por las iniciales del nombre del producto; si el token no trae `nombre`, deja `CO` porque `nombre[0]` es `undefined`. El `CO` es correcto (Cotizaciones), el `CQ` del HTML es un typo que nadie ve. | `products/cotizaciones/public/index.html:29`, `packages/product-runtime/public/amigo.js:65-67` | Mirar el logo en pantalla: `CO` y no `CQ`, está confirmado. Es cosmético. | Confirmado | Baja |
| **R-13** **`GET /api/dashboard` se pide dos veces en la primera carga y `#resumen` se pinta dos veces.** `AMIGO.montar` corre `alEntrar` en el primer pintado y otra vez cuando fija la URL; `pintarInicio` no tiene guardia, así que la primera entrada a Inicio hace la llamada, la tabla y el `innerHTML` de `#resumen` dos veces. Es una wasted request y un parpadeo, no un error. | `packages/product-runtime/public/amigo.js:157-163`, `products/cotizaciones/public/app.js:73-82,97-100,105-112,424` | Entrar en `?panel=inicio` con `Network` abierto: si hay dos `GET /api/dashboard`, está confirmado. Con la consola, un `MutationObserver` sobre `#resumen` registra dos escrituras. `COT-REG-01`. **Nota de numeración:** `COT-EDIT-09` también cita `R-13`, y lo usa para los dos mensajes `404` de `GET /api/quotes/<id>` y `GET /api/quotes/<id>/lineas`. Son dos cosas distintas; el caso de los `404` se confirma con `COT-AUS-01`. | Confirmado | Media |
| **R-14** **El cliente es texto libre y no se valida contra el producto de clientes.** `#cot-cliente` es obligatorio pero no se comprueba contra nada, y `#cot-cliente-id` acepta cualquier cadena de hasta 64 caracteres que se guarda en `customer_id` sin llave foránea: se puede cotizar a alguien que no existe, o a nadie. No hay aviso ni sugerencia. | `products/cotizaciones/public/index.html:156-165`, `products/cotizaciones/src/schema.ts:132-136`, `products/cotizaciones/src/ddl.ts` (sin `FOREIGN KEY` a clientes) | Escribir `cliente_inexistente_2026` en `#cot-cliente-id`, guardar y abrir la cita: si el id queda tal cual, está confirmado. `GET /api/customers/<id>` da `404`, pero **este producto no lo llama nunca**. `COT-E2E-09`, `COT-AUS-05`. | Confirmado | Media |
| **R-15** **`settings.timezone` se valida, se guarda y no lo usa nadie.** El `PUT /api/settings` acepta la zona y `GET /api/settings` la devuelve, pero el «mes» de `/api/dashboard` se arma con `new Date()` en la zona **local del proceso**, y las fechas de emisión y vigencia las pone el navegador. Con el navegador, el servidor y `#cfg-zona` en tres zonas distintas, `Del mes (AAAA-MM)` puede no ser el mes que el usuario cree. | `products/cotizaciones/src/routes.ts:153-161,552-559`, `products/cotizaciones/src/routes.ts:244-248`, `products/cotizaciones/public/app.js:344-352` | Poner `#cfg-zona` en `Asia/Tokyo`, el navegador en `America/Santiago`, y esperar al cambio de día. Si `Del mes` no se mueve con el navegador, está confirmado. También sirve la cita de medianoche: con `America/Santiago` y el navegador en UTC, una cita emitida «hoy» puede quedar con `issueDate` de ayer. `COT-E2E-06`. | Confirmado | Media |
| **R-16** **`.env` y `.env.example` no cuentan lo mismo.** El `.env` del producto trae `PORT=3004`, `DB_PATH=./data/app.db`, `APP_URL=http://localhost:3004`, `JWT_SECRET` y cuatro variables SMTP; el `.env.example` trae `PORT=3021`, `DB_PATH=./data/cotizaciones.sqlite`, `APP_URL=http://localhost:3023` (que no corresponde al `PORT` del propio ejemplo), `CORE_URL`, `AMG_SSO_CLIENT_ID` y `AMG_SSO_INTROSPECT`. Este producto no lee ni `JWT_SECRET` ni SMTP: su identidad vive en el Core. | `products/cotizaciones/.env:3-19`, `products/cotizaciones/.env.example:4-25` | `Select-String -Path products/cotizaciones/.env,products/cotizaciones/.env.example -Pattern "PORT\|DB_PATH\|APP_URL"`: si los pares no coinciden, está confirmado. Solo documentar los **nombres** de las claves, nunca sus valores. **Nota de numeración:** `COT-E2E-04` también cita `R-16` para el folio editable a mano; ese caso es `R-18`. | Confirmado | Baja |
| **R-17** **Los tres inputs de línea no mueven `#cot-total`.** `#linea-descripcion`, `#linea-cantidad` y `#linea-precio` no tienen ningún listener: `pintarLineas()` solo se llama al pulsar `#linea-agregar`, al quitar una línea y en el `input` de `#cot-impuesto` (`public/app.js:332-344`). Es correcto —la línea se agrega con un botón, no al vuelo— pero hay un campo `Cantidad` y un `Precio unitario` a la vista, `#cot-total` dice «Total estimado», y ninguno de los dos lo mueve: quien los cambie ve un total viejo y no tiene por qué saber que hay que volver a agregar la línea. | `products/cotizaciones/public/app.js:210-249,332-344`, `products/cotizaciones/public/index.html:202-222` | Con una línea agregada, anotar `#cot-total`, cambiar `#linea-cantidad` a `5` sin pulsar `#linea-agregar` y releer: si el total no se mueve, está confirmado. Con `#cot-impuesto` en `1600` sí se mueve, y ese contraste es el que lo hace confuso. `COT-LINE-11`. | Confirmado | Baja |
| **R-18** **`#cot-folio` es editable a mano y por eso la numeración admite huecos.** El `input` es `type="number" min="1"` con la pista `Lo propone el servidor`, pero el `value` se puede cambiar y el `POST`/`PATCH` lo acepta (`routes.ts:139` es un número, no una constante): crear una `#1` y después una `#3` deja la `#2` sin existir. La única defensa es el índice único `(organization_id, number)`. Para un documento numerado, un hueco es un problema; para esta interfaz, es una puerta abierta. | `products/cotizaciones/public/index.html:151-153`, `products/cotizaciones/public/app.js:341-352`, `products/cotizaciones/src/routes.ts:139` | Crear una cita con `#cot-folio` = `3` en una base vacía, guardar, y comprobar que queda `#3` y que `#cfg-folio` pasa a `4`. Si acepta, está confirmado. `COT-E2E-04`. | Confirmado | Media |
| **R-19** **Cambiar el estado con el diálogo abierto vuelve a llamar `showModal()`.** `abrirCotizacion` llama `dialog.showModal()` al final, y el manejador del cambio de estado vuelve a llamar `abrirCotizacion`: si el `dialog` ya es modal, `showModal()` lanza `InvalidStateError` y el `catch` lo convierte en un `avisar` rojo con el texto de la excepción del navegador, **encima** del `Estado actualizado` en verde. El `POST` sí se ejecutó: la pantalla dice que falló algo que funcionó. | `products/cotizaciones/public/app.js:262-276`, `products/cotizaciones/public/app.js:292-306`, `packages/product-runtime/public/app.js` (`showModal`) | Con el diálogo abierto, pulsar `Pasar a Enviada` y mirar `#aviso` y la consola: si aparece un aviso rojo con un mensaje del tipo «The element already has an 'open' attribute», está confirmado. El botón se repinta igual y el estado sí cambia. `COT-EST-02`. | Sospechado | Media |
| **R-20** **El botón del importe de `#abiertas` abre el diálogo sin capturar el fallo.** En la lista de «esperando respuesta» el botón `Ver` llama `abrirCotizacion(c.id).catch(...)`, pero el botón del importe se construye con `() => abrirCotizacion(c.id)` sin `catch` (`app.js:141` contra `:140` y `:179`): si `/api/quotes/<id>/lineas` falla, la promesa queda rechazada sin manejar y el error sale en la consola, sin aviso y sin explicación en pantalla. | `products/cotizaciones/public/app.js:140-141`, `products/cotizaciones/public/app.js:179` | Con la consola en modo `error`, simular el fallo de `/lineas` (por ejemplo, borrando la fila entre el click y la respuesta) y pulsar el botón del importe: si aparece un `Unhandled promise rejection` y `#aviso` queda vacío, está confirmado. | Confirmado | Baja |
| **R-21** **`#cot-vigencia` no sigue a `#cot-emision`, y la ventana se propone desde hoy y no desde la fecha de emisión.** `abrirNueva` escribe `#cot-vigencia = dentroDe(estado.cfg.validityDays)`, que es «hoy + N días» (`public/app.js:322`), y no hay ningún listener en `#cot-emision`: los únicos de la página son `#linea-agregar` y `#cot-impuesto` (`public/app.js:332,344`). Quien mueve la fecha de emisión deja la vigencia donde estaba, y el documento termina diciendo «válida 30 días» sobre otra fecha. Además `#cot-vigencia` no es `required` y en el servidor `validUntil` es texto nullable: una cita puede quedar sin ventana sin que nada avise. | `products/cotizaciones/public/app.js:309-328`, `products/cotizaciones/public/app.js:332,344`, `products/cotizaciones/public/index.html:180-186`, `products/cotizaciones/src/schema.ts:82-83` | Abrir `Nueva cotización`, mover `#cot-emision` treinta días atrás y mirar `#cot-vigencia`: si la fecha de vigencia no se mueve con ella, está confirmado. Guardar con `#cot-vigencia` vacío y releer `GET /api/quotes/<id>`: si `validUntil` queda en `null` sin error, está confirmado. `COT-E2E-01`. | Confirmado | Media |

**Cómo se cierra cada uno.** `R-01`, `R-04`, `R-06`, `R-12` y `R-14` son decisiones de producto con
efecto visible en pantalla y se anotan en la §9 aunque el código las lea como intencionadas.
`R-02`, `R-05`, `R-07`, `R-08`, `R-09`, `R-10`, `R-11`, `R-13`, `R-15`, `R-16`, `R-17`, `R-18`,
`R-20` y `R-21` son defectos o trampas que se anotan **con el caso que los confirma**. `R-03` y
`R-19` son sospechas que dependen de cómo pinta el navegador: se anotan solo si se ven, y si no se
ven se cierran. Ninguno de los 21 se corrige desde el plan: el plan los prueba.

**Numeración.** `R-13` y `R-16` están citados dos veces cada uno por casos escritos antes de que
esta tabla cerrara. No se renumera nada para no romper las referencias ya escritas: `R-13` es el
doble pintado de Inicio y los dos `404` de `COT-AUS-01` quedan como una segunda confirmación de
ese mismo bloque, y `R-16` es `.env` contra `.env.example` y el folio editable queda en `R-18`.
`R-17` conserva el significado que le dio `COT-LINE-11` —los inputs de línea no mueven el total—
y el hallazgo de `#cot-vigencia` que no sigue a `#cot-emision` quedó en `R-21`.

---

## 8. Checklist visual

Recorrer una vez por cada panel, en 1280 × 800 y en 390 × 844. Marcar cada ítem. Los
elementos que arma `app.js` (tarjetas, filas, fichas) solo se pueden mirar con la lista ya
pintada o con el diálogo abierto.

**Canal lateral y cabecera**

- [ ] `#tabs` tiene **3** entradas y solo 3: Inicio, Cotizaciones y Ajustes, con los títulos
      `Resumen`, `Cotizaciones` y `Configuración` (`public/index.html:33-36`).
- [ ] La entrada activa se distingue por fondo y por el indicador izquierdo, y solo una lo está;
      lleva `aria-current="page"`.
- [ ] El `h1[data-amigo="titulo"]` dice el nombre de la sección activa, y `data-amigo="empresa"`,
      `data-amigo="usuario"`, `data-amigo="correo"` y `data-amigo="avatar"` traen los datos de la
      sesión, con iniciales en el avatar.
- [ ] `data-amigo="otras"` y `data-amigo="otras-titulo"` están ocultos (una sola herramienta).
- [ ] El logo del canal dice `CO` (`R-12`).
- [ ] `Nueva cotización` (`#cotizacion-nueva`) está en la barra superior de la sección
      Cotizaciones y **no** dentro del panel.

**Panel Inicio (`?panel=inicio`)**

- [ ] `#resumen` muestra **5** `.ui-kpi`: `Cotizaciones`, `Enviadas`, `Aceptadas`,
      `Del mes (AAAA-MM)` y `En la mesa` (`public/app.js:106-112`). Solo el primero lleva la cifra
      de acento. Comprobar que son 5, no 6.
- [ ] `Del mes (AAAA-MM)` viene sin símbolo y sin decimales, junto a dos cifras de dinero (`R-08`).
- [ ] `#abiertas` muestra una `.ui-ficha` por cita `draft` o `sent`, con `#N · Cliente`, el título
      como nota y el importe a la derecha (`public/app.js:115-146`).
- [ ] Con la cartera vacía, `#abiertas` dice `No hay cotizaciones esperando respuesta.`; con lista
      filtrada en Cotizaciones, `#abiertas` **no** cambia (`R-08`).
- [ ] En el botón de cada ficha, el que trae el importe está alineado a la derecha y el `Ver` es
      chico; comprobar que `Ver` siempre abre con `catch` (riesgo `R-20`).

**Panel Cotizaciones (`?panel=cotizaciones`)**

- [ ] `#buscar` y `#filtro-estado` están en la misma fila: el buscador con su placeholder y el
      filtro con `Todos los estados` primero, luego `Borrador`, `Enviada`, `Aceptada`, `Rechazada`,
      `Vencida`.
- [ ] `#cotizaciones-lista` trae una tabla de **6** columnas en este orden: `#Folio`, `Cliente`,
      `Título`, `Emitida`, `Vence`, `Estado` y la de acciones — comprobar el conteo real en el DOM.
- [ ] La columna del folio muestra `<span class="mono">#12</span>`; `Emitida` y `Vence` son texto
      plano de la fecha en crudo, sin formato regional.
- [ ] `Estado` es un `.ui-etiqueta` con el tono del estado; los tres terminales van neutros.
- [ ] Con lista vacía, una fila con `colspan` y el texto `Todavia no hay cotizaciones.`; con la
      búsqueda sin resultados, `Sin resultados para la busqueda.`
- [ ] Los botones de la fila son chicos: `Ver` y `Borrar` (`--fantasma`); `Borrar` pide
      `Borrar la cotizacion y sus lineas?`
- [ ] La tabla se desplaza en horizontal dentro de su caja sin que la página entera se desplace, y
      en 390 × 844 `document.documentElement.scrollWidth` ≤ 390.
- [ ] Con más de 500 filas, la tabla muestra 500 y no avisa de que hay más (`R-11`).
- [ ] Escribir en `#buscar` y mover `#filtro-estado` no genera **ninguna** petición.

**Diálogo `#cotizacion-dialog`**

- [ ] Abre con `showModal()`: fondo atenuado, foco dentro, `Esc` cierra, el fondo no cierra.
- [ ] `#cotizacion-form-titulo` dice `Nueva cotizacion` al abrir y `Cotizacion #N` al abrir con
      `Ver`.
- [ ] `#cotizacion-dialog` es `class="ui-ancho"`: mide `min(46rem, 100vw - 2rem)` y trae su propio
      scroll (`amigo.css:801-805`), así que con muchas líneas el botón `Guardar` sigue alcanzable.
- [ ] Las dos primeras filas van en pares: `#cot-folio`/`#cot-cliente` y
      `#cot-cliente-id`/`#cot-correo`. `#cot-folio` es `type="number" min="1"` con la pista
      `Lo propone el servidor` y trae el `nextNumber` de `GET /api/settings`.
- [ ] `#cot-cliente` es `required` con la pista `Los clientes viven en el producto Clientes. Acá va
      el nombre.`; `#cot-correo` es `type="email"` `maxlength="200"`; `#cot-titulo` `maxlength="200"`.
- [ ] Los `maxlength` del HTML coinciden con los del servidor: 150 en cliente y línea, 200 en
      título y correo, 2000 en notas (`public/index.html:157-196`).
- [ ] `#cot-emision` y `#cot-vigencia` son `type="date"`; `#cot-vigencia` trae hoy + `validityDays`
      y **no** se mueve si se cambia `#cot-emision` (`R-21`). `#cot-impuesto` es `number` con
      `min="0" max="10000"` y la pista `(1600 = 16%)` (`R-02`).
- [ ] `#cot-lineas` pinta una fila por línea con descripción, cantidad y precio, más la nota
      `2 × $250,00`; vacía, `AMIGO_UI.vacio` con `Sin lineas.`
- [ ] `#linea-cantidad` es `min="1" step="0.5"` y `#linea-precio` `min="0" step="1"` (`R-04`).
- [ ] El pie muestra `Total estimado` con `#cot-total` en `.mono`, y debajo la pista `El total que
      queda guardado lo calcula el servidor.` Mover `#cot-impuesto` **sí** recalcula `#cot-total`;
      mover `#linea-cantidad` o `#linea-precio` **no** (`R-17`): marcar el contraste.
- [ ] `#cot-estados` muestra los botones que apliquen: en `draft`, `Pasar a Enviada`, `Pasar a
      Rechazada` y `Pasar a Vencida`; en terminal, solo el texto `Una cotizacion Aceptada ya no
      cambia de estado.`
- [ ] `#cotizacion-cerrar` (×, `aria-label="Cerrar"`) y `#cotizacion-cancelar` cierran sin guardar.
- [ ] El `dialog` no tiene `aria-label` ni `aria-labelledby`, aunque `#cotizacion-form-titulo` tenga
      id (`R-18`): un lector de pantalla anuncia «diálogo» sin nombre.

**Panel Ajustes y avisos**

- [ ] `?panel=ajustes` muestra `#config-form` con cuatro campos: moneda, zona, impuesto y vigencia, y
      un botón `Guardar ajustes`.
- [ ] `#cfg-folio` dice el `nextNumber` de `GET /api/settings` y **no** es un input: es el único
      dato de Ajustes que no se puede escribir, y por eso está fuera del formulario
      (`public/app.js:444-453`). Comprobar que no se pueda editar.
- [ ] Guardar Ajustes avisa `Ajustes guardados` y **no** cambia `#resumen` ni `#cotizaciones-lista`:
      moneda y zona no entran en ningún cálculo (`R-15`).
- [ ] `#cfg-vigencia` en `0` no se puede guardar: el `|| 30` del `submit` lo convierte en 30 sin
      avisar.
- [ ] `#aviso` es un único elemento reutilizado: verde con `Cotizacion creada`, `Estado
      actualizado`, `Cotizacion actualizada`, `Cotizacion borrada` y `Ajustes guardados`; rojo con el
      texto del servidor; y se oculta solo a los 5000 ms.
- [ ] Con el diálogo abierto, un error se ve: si `#aviso` queda detrás del fondo atenuado, marcar
      `R-03` en la §9.
- [ ] Consola con el filtro `error` limpio en los tres paneles y con el diálogo abierto (ojo con
      `R-19` y `R-20`).
- [ ] Network: una petición por acción y ninguna de más; el detalle está en `COT-REG-07`.

---

## 9. Registro

Una fila por caso ejecutado. **Dejar vacía hasta la primera vuelta real**: nada de esta §7
está verificado todavía. `Resultado` es `PASA`, `FALLA` o `BLOQUEADO`. Cuando un caso sea el
que confirma un riesgo, anotar el `R-` en la columna `Nota`.

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados. Transversal: Doc 10 §9.

| ID | Resultado (PASA/FALLA/BLOQUEADO) | Evidencia | Nota |
|---|---|---|---|
| COT-NAV-01 | PARCIAL | Raíz entra en `inicio`, `h1`="Inicio", `#resumen`/`#abiertas` visibles, `[data-panel="cotizaciones"]` y `ajustes` con `hidden`; peticiones vistas: `inicio`, `dashboard`, `quotes?limit=500`, `settings` | El segundo `GET /api/dashboard` documentado (doble pintado, R-13) no se confirmó al milisegundo; se vio `dashboard` en el arranque. |
| COT-NAV-02 | PARCIAL | Clic en pestañas → 0 peticiones nuevas; paneles con datos (prefetch `quotes`+`dashboard`) | h1/aria-current/panel visible ✅. |
| COT-SIST-01 | PASA | Sin sesión: `GET /health` y `POST /health` → `200 {"ok":true,"product":"cotizaciones","name":"Cotizaciones"}`; `GET /api/meta` → `200 {"name","product","version":2,"identity":"amg-central"}` | |
| COT-SIST-02 | BLOQUEADO | Caso de desarrollo local (`.env` vs `.env.example`) | No aplica a producción; pendiente en local. |
| COT-SIST-03 | FALLA | Sin sesión: `/api/quotes` y `/api/dashboard` → `401` ✅ (JSON); `/` → `302` al SSO del Core ✅; `/app.js` → `302` ✅; **`/amigo.css` → `200` público** | 401 sin campo `message`; fuga de `amigo.css` vía CDN en cotizaciones. |
| COT-SIST-04 | PASA | `/api/me` y `/api/inicio` concuerdan con el canal (usuario/organización/herramientas) | `/api/inicio` incluye `rol` y `organizacion`; el shell no pinta el rol (comportamiento descrito en el plan de pagos R-05, aplica al runtime). |
| COT-E2E-01 | BLOQUEADO | Requiere base vacía y ajustes seed (`$`, `America/Santiago`, `1600`, `30`) | No ejecutado. |
| COT-API-01 | PARCIAL | `GET /api/quotes` → `{items,total,limit,offset}` ✅. `PATCH /api/quotes/<id>` con `status:"approved"` → `200` y status sigue `draft` (`updatedAt` cambia) | Descarte documentado (no rechazo) ✅. Campos desconocidos en quotes se descartan en silencio (R-S-09), a diferencia de customers que da 400. |
| COT-UI-01 | FALLA | KPI "En la mesa" pinta `totalCents` crudo (`4959600`) | No pasa por `dinero`. Clases `ui-kpi__cifra`=etiqueta / `ui-kpi__etiqueta`=valor (invertidas respecto al resto). |