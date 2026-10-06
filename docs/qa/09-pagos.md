# Plan de pruebas — Pagos

Cartera por cobrar: lo que la empresa le tiene que **cobrar a sus clientes**. Cargos con folio,
cuentas por cobrar, abonos recibidos y devoluciones. El sujeto que se bloquea no es una persona
sino el **saldo de un cargo**: la regla que gobierna todo el producto es que el saldo nunca puede
quedar en negativo y que el estado de un cargo nunca se elige, se recalcula desde el saldo.

Este plan se **diseña**, no se ejecuta. Cada caso dice qué hacer y qué se espera, no qué se
observó. Las reglas de sesión, la anatomía del caso y el checklist visual están en
`00-CONVENCIONES.md`.

**Advertencia previa.** Varias afirmaciones de este plan se leyeron en el código y se marcan como
afirmadas; otras dependen del comportamiento del navegador o de SQLite y van marcadas
**sospechado**. Las sospechadas también tienen caso: se comprueban en Chrome, y si se confirma,
pasan a la sección 7 como defecto.

---

## 1. Ficha técnica

| Qué | Valor |
|---|---|
| Slug | `pagos` |
| Nombre | Control de Pagos |
| Dominio | `pagos.amgdeveloper.cl` |
| Puerto de desarrollo | `3024` (`PORT=3024` en `products/pagos/.env.example`) |
| Puerto publicado detrás de nginx / Docker | `3109` (`ops/nginx.conf:47`, `README.md`, `docker-compose.yml:34`) |
| Script de desarrollo | `npm run dev:pagos` (raíz) → `npm run dev -w @amg/pagos` → `tsx watch src/index.ts` |
| Script de pruebas | `npm test -w @amg/pagos` (vitest, `products/pagos/tests/pagos.test.ts`, 1056 líneas) |
| Ruta local | `products/pagos` |
| Base de datos | `./data/pagos.sqlite` (`DB_PATH`), ignorada por git |
| Versión de esquema declarada | `DB_SCHEMA_VERSION=2` en `.env.example` (v2 = tabla `charge_refunds`) |
| Core (identidad) | `CORE_URL=http://localhost:3108` |
| Credenciales SSO | `AMG_SSO_CLIENT_ID=pagos`; el secreto lo entrega el Core con `npm run sso:secret -w @amg/platform -- pagos` |
| Acento del producto | `--acento: #b02a72`, `--acento-fuerte: #861f56`, `--acento-tenue: #fceaf3` (`products/pagos/public/style.css:22-26`) |
| Logo en el canal | se calcula del `<title>` (`Control de Pagos` → `CP`), no hay `data-amigo="logo"` fijo con texto |
| Casos de prueba | 90 casos agrupados por bloque (`NAV`, `TAB`, `COB`, `ALTA`, `ABO`, `DEV`, `ANU`, `REP`, `AJU`, `API`, `SIST`, `E2E`, `REG`) |

**Aviso de puerto.** `products/pagos/.env.example` declara `PORT=3024` pero `APP_URL=http://localhost:3023`.
Coincide con lo que hacen `activos`, `cotizaciones`, `crm` e `inventario`, así que es un descuido
repetido del monorepo y no algo de este producto. **Anotar el puerto real del log de arranque** y
no asumir el del `.env.example` (ver `PAG-SIST-01`).

**Roles.** La identidad trae `member`, `admin` u `owner` (`packages/product-runtime/src/auth.ts:29`).
No existe un rol `viewer`, así que aquí no hay el caso de "un lector que escribe" que sí aparece en
otros productos.

| Superficie | Rol mínimo | Dónde se declara |
|---|---|---|
| Lecturas (`/api/dashboard`, `/api/charges`, `/api/charges/saldos`, `/api/charges/next-number`, `/api/charges/:id/ficha`, `/api/reporte`, `/api/settings`) | cualquiera con sesión | sin `requireRole` |
| `POST /api/charges` (alta de cargo) | `member` | `routes.ts:937` |
| `PATCH /api/charges/:id` (editar cargo) | `member` | `routes.ts:995` |
| `POST /api/charges/:id/abonos` | `member` | `routes.ts:674` |
| `POST /api/charges/:id/devoluciones` | `member` | `routes.ts:779` |
| `POST /api/charges/:id/cancelar` | `member` | `routes.ts:875` |
| `DELETE /api/charges/:id` (borrar cargo) | **`admin`** | `routes.ts:1106` |
| `PUT /api/settings` | **`admin`** | `routes.ts:1238` |

Los cinco `GET` del `crudRouter` no tienen chequeo de rol: leer es libre para cualquier sesión.

**Paneles.** Se seleccionan **por atributo, no por id**. En Pagos no existe ningún `id="panel-*"`:
las cuatro secciones son `[data-panel="tablero"]`, `[data-panel="cobros"]`, `[data-panel="reporte"]`
y `[data-panel="ajustes"]` (`public/index.html:73, 85, 108, 136`), y el canal las declara en `#tabs`
con `data-tab="tablero|cobros|reporte|ajustes"`. El shell activa una y oculta las otras con
`n.hidden = n.dataset.panel !== clave` (`packages/product-runtime/public/amigo.js:101-103`), y el
panel activo viaja en la URL como `?panel=<clave>`.

`AMIGO.montar` se llama así (`public/app.js:717`):

```js
AMIGO.montar({
  nombre: 'Control de Pagos',
  paneles: ['tablero', 'cobros', 'reporte', 'ajustes'],
  alEntrar: () => conAviso(repintar),
});
```

El rótulo del canal es **Antiguedad** (sin tilde, `index.html:40`) y su clave es `reporte`. El `h1`
de la barra superior toma ese mismo texto.

**Rutas de API.** Todas exigen sesión salvo `/health` y `/api/meta`:

| Ruta | Método | Rol | Respuesta |
|---|---|---|---|
| `/api/dashboard` | GET | — | `{ total, porStatus, pendienteCents, cobradoMesCents, devueltoMesCents, vencidoCents, recientes }` |
| `/api/charges/next-number` | GET | — | `{ number }` |
| `/api/charges/saldos` | GET | — | `{ saldos: [{ id, pagadoCents, saldoCents }] }`, uno por cargo |
| `/api/charges/:id/ficha` | GET | — | `{ charge, payments, refunds, abonadoCents, devueltoCents, pagadoCents, saldoCents }` |
| `/api/charges` | GET | — | `{ items, total, limit, offset }` (el `crudRouter`) |
| `/api/charges/:id` | GET | — | fila cruda (el `crudRouter`), `404 {"error":"No encontrado"}` |
| `/api/charges` | POST | `member` | `201 { charge }` (ruta propia, no el `crudRouter`) |
| `/api/charges/:id` | PATCH | `member` | `200 { charge }` (ruta propia) |
| `/api/charges/:id` | DELETE | `admin` | `200 { charge, deleted: true }` (ruta propia) |
| `/api/charges/:id/abonos` | POST | `member` | `201 { charge, payment, pagadoCents, saldoCents }` |
| `/api/charges/:id/devoluciones` | POST | `member` | `201 { charge, refund, pagadoCents, saldoCents }` |
| `/api/charges/:id/cancelar` | POST | `member` | `200 { charge }` |
| `/api/reporte` | GET | — | `{ from, to, referencia, buckets, totalPendienteCents, totalCargos }` |
| `/api/settings` | GET | — | `{ settings: { organizationId, currency, timezone } }` |
| `/api/settings` | PUT | `admin` | `200 { settings: {…} }` |

**Rutas del `crudRouter` que quedan tapadas.** El `router.use('/api/charges', crudRouter(…))` se
registra al final (`routes.ts:1286`), después de las rutas escritas a mano, así que **el `POST`, el
`PATCH` y el `DELETE` del `crudRouter` nunca se ejecutan**: Express resuelve en orden de registro y
gana la primera coincidencia. Solo quedan vivos sus dos `GET` (lista y lectura puntual). Los `POST`/`PATCH`/`DELETE`
del `crudRouter` devuelven la fila cruda; los de este producto devuelven un envoltorio `{ charge }`.
Es una diferencia observable al llamar la API a mano (`PAG-API-05`, `PAG-API-08`).

**Unidades de dinero.** `amount_cents` es `INTEGER` con `CHECK (amount_cents > 0)` en las tres
tablas de dinero (`src/ddl.ts:52, 70, 88`). La API habla **centavos enteros de punta a punta**: no
hay ningún `* 100` en el producto, y la pantalla solo **divide** para pintar (`monto()`, `app.js:71-74`),
con `Intl.NumberFormat('es-CL')` y `minimumFractionDigits: 2`, de modo que el centavo siempre se ve.
Este producto **no** usa `AMIGO_UI.dinero`, que redondea al peso: el formateo es propio y uniforme
dentro del producto. Los dos inputs de dinero se llaman **Total (centavos)** y **Monto (centavos)**
(`index.html:232, 273`), con la etiqueta a la vista, y cada uno lleva su vista previa
(`#cargo-monto-vista`, `#abono-monto-vista`). La asimetría de formateo entre productos es un riesgo
transversal y está en `10-regresion-compartida.md`, no acá.

**Prefijos de id.** `pagcargo` (cargos), `pagabono` (abonos), `pagref` (devoluciones) y `cfg_<org>`
(fila de ajustes). `createId` los genera el servidor; el `id` nunca viene del cliente.

**Lo que no existe, y es decisión.** No hay `paid_cents` ni `saldo_cents`: el saldo se **deriva**
sumando abonos menos devoluciones (`pagadoDe`, `routes.ts:215-222`). No hay tabla `payments` (la
del Core es la suscripción; esta se llama `charge_payments`). No hay `seed` en el arranque. No hay
`migrate-legacy.ts`. No hay clientes: `customer_name` es un snapshot y `customer_id` es una
referencia suelta al producto `crm`, sin FK.

---

## 2. Datos de prueba

**El producto no siembra nada.** `products/pagos/src/app.ts` no declara `seed`: los datos de ejemplo
pertenecen a una organización, y esa organización solo existe cuando hay una sesión real. En una base
recién creada el tablero arranca en ceros y hay que crear todo a mano.

**Base de trabajo.** Organización de QA propia, con suscripción a `pagos` activa. Todo lo que se
cree lleva el prefijo **`QA-PAG-`** en los campos de texto (`customerName`, `concept`, `notes`,
`reference`, `reason`), nunca un `INSERT` directo: se siembra por la API o por la UI, que es la
única forma de que el estado derivado y las invariantes queden correctos.

**Conjunto base.** Siete cargos, con la fecha de trabajo **2026-06-15** y la zona de la empresa en
`America/Santiago`. Todos se crean por `POST /api/charges` (o por el diálogo `#cargo-dialog`) y los
abonos por `POST /api/charges/:id/abonos`.

| # | `customerName` | `concept` | `amountCents` | `issuedDate` | `dueDate` | Abonos | Estado final |
|---|---|---|---|---|---|---|---|
| 1 | `QA-PAG Alfa` | `QA-PAG contrato mensual` | `45055` | `2026-06-01` | `2026-07-15` | — | `pending`, saldo `45055` |
| 2 | `QA-PAG Alfa` | `QA-PAG deuda de enero` | `30000` | `2026-01-10` | `2026-02-01` | — | `pending`, saldo `30000`, vencido |
| 3 | `QA-PAG Beta` | `QA-PAG deuda de febrero` | `50000` | `2026-02-10` | `2026-03-01` | `20000` | `partial`, saldo `30000`, vencido |
| 4 | `QA-PAG Gamma` | `QA-PAG ya cobrado` | `10000` | `2026-05-01` | `2026-05-31` | `10000` | `paid`, saldo `0` |
| 5 | `QA-PAG Delta` | `QA-PAG no se cobra` | `70000` | `2026-06-02` | `null` | — | `canceled` |
| 6 | `QA-PAG Epsilon` | `QA-PAG sin fecha de emision` | `45000` | `null` | `null` | — | `pending`, saldo `45000` |
| 7 | `QA-PAG Zeta` | `QA-PAG abono devuelto` | `80000` | `2026-06-05` | `2026-07-05` | `60000` + devolución `60000` | `pending`, saldo `80000`, 1 devolución |

**Las cifras que deben salir de este conjunto** (con `hoy` = `2026-06-15`; si se ejecuta otro día,
recalcular con esa fecha):

| Cifra | Valor | De dónde sale |
|---|---|---|
| `dashboard.total` | `7` | todos los cargos |
| `dashboard.porStatus` | `{pending:4, partial:1, paid:1, canceled:1}` | 1, 2, 6 y 7 pendientes |
| `dashboard.pendienteCents` | `230055` | `45055 + 30000 + 30000 + 45000 + 80000`: **saldos**, no totales |
| `dashboard.vencidoCents` | `60000` | solo 2 (`30000`) y 3 (`30000`), cuyo `dueDate` ya pasó |
| `dashboard.cobradoMesCents` | `90000` | `20000 + 10000 + 60000`, contados por `received_at`; **no** descuenta la devolución |
| `dashboard.devueltoMesCents` | `60000` | la devolución del cargo 7, por `refunded_at` |
| `dashboard.recientes` | 5 filas | los 5 cargos más recientes por `created_at`, en `DESC` |
| `reporte` (sin fechas) | `totalCargos: 5`, `totalPendienteCents: 230055` | 1, 2, 3, 6 y 7; el 4 no tiene saldo y el 5 está cancelado |
| `reporte` (con `to=2026-06-15`) | `totalCargos: 4`, `totalPendienteCents: 185055` | el 6 se cae: sin `issued_date` no entra en un rango |

Tramos del reporte con `referencia = 2026-06-15`:

| Tramo | Cargos | Saldo | Quién |
|---|---|---|---|
| `0-30` | `3` | `170055` | 1 (`-30` días), 6 (sin vencimiento → `0`), 7 (`-20` días) |
| `31-60` | `0` | `0` | — |
| `61-90` | `0` | `0` | — |
| `mas-90` | `2` | `60000` | 2 (`134` días) y 3 (`106` días) |

**Datos auxiliares.**

- Un segundo **folio** para probar el `409`: crear el cargo 9 con `number: 1` después de que el 1
  exista.
- Una **devolución vía API** en el cargo 7 (paso 5 de la tabla), porque por interfaz **no** se puede
  hacer la primera (ver `PAG-ABO-10` y riesgo `R-03`).
- Un **cargo de la organización B** para el aislamiento (`PAG-SIST-04`), con su propio abono.

**Limpieza al terminar.** El orden importa: primero devolver la plata, después cancelar, y solo
borrar lo que no tuvo nunca un centimo. `DELETE /api/charges/:id` es borrado duro y se lleva sus
abonos en cascada (`ON DELETE CASCADE`, `src/ddl.ts:69`), así que borrar el conjunto base **no**
es una limpieza: es borrar el historial de caja de QA. Para limpiar de verdad, usar una organización
de QA descartable y dejar los cargos con prefijo `QA-PAG-`.

---

## 3. Precondiciones

1. El Core está arriba: `npm run dev:core` (puerto `3108`) y responde `GET /health` con `200`.
2. El producto está arriba: `npm run dev:pagos`. La primera línea del log dice
   `Control de Pagos (pagos) en <appUrl> -> puerto <port>`; anotar ese puerto y esa URL, porque
   `.env` puede no coincidir con `.env.example` (`PORT=3024`, `APP_URL=…:3023`).
3. La organización de QA tiene la suscripción a `pagos` activa. Sin ella el middleware responde
   `403` con `{ "error": "sin-acceso" }` (`packages/auth-client/src/middleware.ts:98`).
4. **No hay login local.** Este producto no pide usuario ni contraseña: la sesión vive en el Core.
   Se entra por `desarrollo.amgdeveloper.cl` (puerto `3108`). Que el producto redirija al login del
   Core es el flujo correcto, no un error de Auth (convención 5.3).
5. Tester tipea sus credenciales. Nunca se le piden ni se anotan (convención 5.2).
6. **La sesión dura 15 minutos.** Al expirar, cualquier `/api/*` responde
   `401 {"error":"sin-sesion","loginUrl":"…"}` y `AMIGO_UI.api` salta al login del Core
   (`amigo-ui.js:331-336`). Volver a entrar y anotar el corte en la sección 9; no es un defecto del
   producto (convención 5.1).
7. **Límite de tasa: 600 peticiones / 15 min por IP** (`packages/product-runtime/src/app.ts:100-106`).
   Un `429` no es un defecto: se anota y se espera (convención 5.4). Los casos de la sección 6
   consumen presupuesto, así que conviene hacerlos una vez y reutilizar la sesión.
8. Cada caso que dependa de otro lo referencia por ID en **Precondición**.
9. Zona horaria de la organización en `America/Santiago` y moneda en `$`, salvo que el caso diga
   otra cosa. La zona **no** es decorativa: decide qué día es hoy para el tablero y el reporte.
10. Para los casos de API: DevTools abierto, pestaña **Network**, filtro de fetch/XHR activado, y
    `Copy as fetch` para reproducir una petición desde la consola.

---

## 4. Casos por módulo

### 4.1 Navegación y deep-link

| | |
|---|---|
| **ID** | PAG-NAV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, datos de prueba de la sección 2 creados. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/` con la red en modo lento y esperar la carga.<br>2. En Network, filtrar `/api/` y contar las peticiones.<br>3. En la consola: `document.querySelectorAll('[data-panel]').length` y `document.querySelectorAll('[id^="panel-"]').length`. |
| **Esperado** | Siete peticiones, todas `200`: 1 a `/api/inicio`, 2 a `/api/dashboard`, y 1 cada una a `/api/charges?limit=500`, `/api/settings`, `/api/charges/saldos`, `/api/me`. **El tablero se pide dos veces**: una por `alEntrar` de `AMIGO.montar` (que dispara `repintar` con `estado.cargos` todavía vacío) y otra por `cargar().then(repintar)` del final de `app.js`. En la consola: `4` paneles y **`0`** elementos con id `panel-*`: los paneles se activan por atributo, no por id. |

| | |
|---|---|
| **ID** | PAG-NAV-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Datos de prueba creados; sesión activa. |
| **Pasos** | 1. Abrir directamente `/?panel=cobros`.<br>2. Con la red en modo lento, observar `#cobros-lista` antes de que responda `/api/charges`.<br>3. Dejar cargar y contar las filas. |
| **Esperado** | `[data-panel="cobros"]` queda visible y los otros tres con `hidden`. `#cobros-lista` muestra brevemente la fila `No hay cargos que coincidan` antes de que lleguen los datos, y después las 7 filas: el mensaje de vacío **parpadea** en la primera carga de este panel. Comparar con `?panel=tablero`, donde las dos llamadas a `/api/dashboard` llegan juntas y no se nota. Si el parpadeo molesta, es `R-06`. |

| | |
|---|---|
| **ID** | PAG-NAV-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `/?panel=reporte`.<br>2. Contar las peticiones a `/api/reporte` en la primera carga.<br>3. Repetir con `/?panel=tablero` y contar `/api/dashboard`.<br>4. Con los 4 paneles ya cargados, ir y volver entre ellos y volver a contar. |
| **Esperado** | En la primera carga de `?panel=reporte` salen **dos** `GET /api/reporte` (con query vacío: `/api/reporte?`), y en `?panel=tablero` dos `GET /api/dashboard`: `montar` pinta el panel antes de que termine `cargar()`, y `cargar().then(repintar)` lo repinta. Al cambiar de pestaña con el canal, **una** petición por entrada. Los otros dos paneles (`ajustes`, y el `Vacio` de `repintar`) no piden nada: `repintar` no tiene rama para ellos y los ajustes se llenan en `cargar()`. |

| | |
|---|---|
| **ID** | PAG-NAV-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `/?panel=noexiste`.<br>2. Abrir `/?panel=ajustes`.<br>3. Recargar con `?panel=cobros` en la barra de direcciones. |
| **Esperado** | 1: `panelDeUrl` cae al primer panel declarado (`tablero`) porque la clave no está en la lista; la URL sigue diciendo `?panel=noexiste` pero lo visible es el tablero. 2: `[data-panel="ajustes"]` visible, `#cfg-moneda` y `#cfg-zona` con `$` y `America/Santiago`. 3: entra directo en Cobros y `#cobros-lista` **no** queda vacío: el `alEntrar` de `montar` y el `cargar().then(repintar)` pintan los dos. |

| | |
|---|---|
| **ID** | PAG-NAV-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. En `#tabs`, pulsar `Cobros`.<br>2. Leer la barra de direcciones.<br>3. Pulsar el botón Atrás del navegador y luego Adelante.<br>4. Leer el `h1[data-amigo="titulo"]` en cada paso. |
| **Esperado** | Cada clic hace `history.pushState` y deja `?panel=<clave>` en la URL **sin recargar** (no aparece `document` en Network). Atrás y Adelante repintan por `popstate`. El `h1` toma el texto de la pestaña activa, incluido `Antiguedad` para el panel `reporte`. Solo una entrada de `#tabs` tiene `aria-current="page"` en cada momento. |

| | |
|---|---|
| **ID** | PAG-NAV-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Ir a `?panel=ajustes` y pulsar `#cargo-nuevo`.<br>2. Cerrar `#cargo-dialog` con `#cargo-cerrar`.<br>3. Abrir la ficha de un cargo desde `#recientes` y cerrarla con `#ficha-cerrar`.<br>4. Volver a abrir la ficha del mismo cargo. |
| **Esperado** | 1: el botón de la barra superior (`Nuevo cargo`) **está en los cuatro paneles**, incluido Ajustes, y abre `#cargo-dialog` con `#cargo-form-titulo` = `Nuevo cargo`, `#cargo-id` vacío, `#cargo-monto` = `0` y todas las fechas vacías. 2 y 4: cerrar no borra nada de `#ficha`, pero `abrirFicha` reconstruye el contenido desde cero en cada apertura, así que no quedan datos del cargo anterior. |

### 4.2 Tablero — panel `tablero`

Selectores: `#resumen` (las tarjetas KPI), `#recientes` (los últimos cargos) y la barra superior con
`#cargo-nuevo`. Las siete tarjetas son las que pinta `AMIGO_UI.kpis` en `app.js:111-119`.

| | |
|---|---|
| **ID** | PAG-TAB-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, **cartera vacía** (base recién creada o conjunto de la sección 2 sin sembrar todavía). |
| **Pasos** | 1. `GET /api/dashboard` desde la consola.<br>2. Enumerar las claves del cuerpo.<br>3. Leer las tarjetas de `#resumen` y el texto de `#recientes`. |
| **Esperado** | `200` con estas ocho claves: `total: 0`, `porStatus: {pending:0, partial:0, paid:0, canceled:0}`, `pendienteCents: 0`, `cobradoMesCents: 0`, `devueltoMesCents: 0`, `vencidoCents: 0`, `recientes: []`. Los **cuatro** estados se responden siempre. `#resumen` muestra siete tarjetas y `#recientes` el texto `Todavia no hay cargos emitidos` (`AMIGO_UI.vacio`), no una lista vacía sin explicación. |

| | |
|---|---|
| **ID** | PAG-TAB-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2 sembrado, `hoy` = `2026-06-15`. |
| **Pasos** | 1. `GET /api/dashboard`.<br>2. Comparar las siete claves con la tabla de cifras de la sección 2.<br>3. Abrir `?panel=tablero` y leer las siete tarjetas de `#resumen`. |
| **Esperado** | `200` con `total: 7`, `porStatus: {pending:4, partial:1, paid:1, canceled:1}`, `pendienteCents: 230055`, `vencidoCents: 60000`, `cobradoMesCents: 90000`, `devueltoMesCents: 60000`, `recientes` con 5 filas. Las cifras de la pantalla coinciden con las de la API. `pendienteCents` suma **saldos**: el cargo 4 (pagado) y el 5 (cancelado) no aportan nada, y el 3 aporta `30000` y no `50000`. |

| | |
|---|---|
| **ID** | PAG-TAB-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. En `#resumen`, leer las siete tarjetas en orden, anotando qué va en el número grande y qué va en el rótulo pequeño.<br>2. Repetir con el resto de productos del monorepo y comparar el orden de los argumentos. |
| **Esperado** | **Sospechado,contradice la lectura del código.** `AMIGO_UI.kpis` pinta `cifra.textContent = f[1]` y `etiquetaTexto.textContent = f[0]` (`amigo-ui.js:245-250`), es decir espera `[rótulo, cifra, acento]`, que es lo que pasa Espacios. Pagos pasa `[monto(...), 'Cobrado este mes', true]`, o sea `[cifra, rótulo]`: el resultado esperado es que **el número grande muestre el rótulo** (`Cobrado este mes`) y el texto chico muestre el importe (`$ 900,00`), invertido en las siete tarjetas, y que la clase `ui-kpi__cifra--acento` caiga sobre el rótulo y no sobre la cifra. Si al mirarlo las tarjetas salen al revés, queda confirmado como `R-01`. |

| | |
|---|---|
| **ID** | PAG-TAB-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Al menos 6 cargos, con estados distintos. |
| **Pasos** | 1. `GET /api/dashboard` y leer `recientes`.<br>2. Enumerar las claves de `recientes[0]`.<br>3. Leer `#recientes` en pantalla. |
| **Esperado** | `recientes` trae **exactamente 5** elementos, orden descendente por `created_at` (no por folio), y cada uno es la fila del cargo más `pagadoCents` y `saldoCents` derivados. En pantalla, cada ficha muestra `<folio> · <cliente>` en el título y `<concepto> · saldo <saldo>` en la nota, más una etiqueta de estado y un botón `Ficha`. Un cargo cancelado puede aparecer en esta lista: no se filtran, porque `recientes` sale de `todos` sin mirar el estado. |

| | |
|---|---|
| **ID** | PAG-TAB-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. Leer el valor de la tarjeta `Vencido` en `#resumen`.<br>2. Ir a `?panel=cobros`, abrir `#cargo-filtro` y contar sus opciones.<br>3. Elegir cada opción y anotar cuántos cargos son vencidos según el conjunto (`2` y `3`). |
| **Esperado** | La tarjeta dice `$ 600,00` y `#cargo-filtro` tiene **cinco** opciones: `Todos`, `Pendiente`, `Parcial`, `Pagado`, `Cancelado`. **Ninguna** filtra por vencimiento: con el conjunto de la sección 2, los dos cargos vencidos (2 y 3) sólo se ven eligiendo `Pendiente` (el 2) o `Parcial` (el 3), y si el 3 estuviera pagado no habría forma de llegar a él por filtro. La asimetría es real: el tablero mide lo vencido y la lista no lo puede filtrar (riesgo `R-07`). |

| | |
|---|---|
| **ID** | PAG-TAB-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Enumerar las claves de `GET /api/dashboard`.<br>2. Comparar con las que pinta `#resumen`. |
| **Esperado** | La API devuelve **nueve** datos y la pantalla usa siete: se pintan `cobradoMesCents`, `pendienteCents`, `vencidoCents` y los cuatro `porStatus`. **`total` y `devueltoMesCents` no tienen ninguna UI**: el total de cargos que nunca se muestra como cifra propia (solo descompuesto en cuatro contadores) y el «devuelto este mes», que el propio código de `routes.ts:516-530` justifica separando del cobrado para que se lean distinto, se quedan sin lectura en pantalla. Anotar como hallazgo de cobertura (`R-09`). |

| | |
|---|---|
| **ID** | PAG-TAB-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo con saldo, y un abono registrado a mano el día 5 del mes a las `00:00` UTC con `POST /api/charges/:id/abonos` y `receivedAt: '<mes actual>-05T00:00:00.000Z'`. |
| **Pasos** | 1. `GET /api/dashboard` y anotar `cobradoMesCents`.<br>2. Repetir con el mismo abono pero `receivedAt: '<mes actual>-05T12:00:00.000Z'`. |
| **Esperado** | El tablero cuenta el abono **por `received_at`, no por `created_at`**, así que las dos respuestas lo incluyen. Pero el corte del mes es la medianoche **local** de la empresa (`mesEnCurso`, `routes.ts:308-317`): un abono del día 1 a las `00:00` UTC es del día **31 del mes anterior** a las 20:00 en Santiago y **no** cuenta. Comprobación: el mismo abono con la fecha puesta por la interfaz (`#abono-fecha`) viaja como `T00:00:00.000Z` (`app.js:606`) y por eso puede caer en el mes anterior al que el usuario quiso escribir. Ver `PAG-ABO-06` y riesgo `R-04`. |

| | |
|---|---|
| **ID** | PAG-TAB-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#recientes` con al menos una ficha. |
| **Pasos** | 1. Pulsar el botón `Ficha` de la primera ficha de `#recientes`.<br>2. Leer `#ficha-dialog`.<br>3. Cerrar con `#ficha-cerrar`. |
| **Esperado** | Se abre `#ficha-dialog` con `showModal()` y el título `<folio> · <cliente>` del cargo 1. `#ficha-dialog` **no** tiene formulario de abono visible todavía en este primer render de una ficha recién abierta desde el tablero: se calcula al final de `abrirFicha`. Al cerrar, `#abono-monto` conserva el saldo que se precargó. Verificar que el botón manda `GET /api/charges/<id>/ficha` y no un `PATCH`. |

### 4.3 Cobros — listado, búsqueda y filtro, panel `cobros`

Selectores: `#cargo-buscar` (placeholder `Folio, concepto, cliente, correo`), `#cargo-filtro` (cinco
opciones) y `#cobros-lista`. La tabla la arma `pintarCobros` con nueve columnas:
`Folio`, `Cliente`, `Concepto`, `Emitido`, `Vence`, `Total`, `Saldo`, `Estado` y una sin título para
las acciones (`app.js:173-176`).

| | |
|---|---|
| **ID** | PAG-COB-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. Ir a `?panel=cobros`.<br>2. Contar filas y leer los encabezados de `#cobros-lista`.<br>3. Leer la celda de un cliente con correo y la de uno sin correo.<br>4. Inspeccionar las clases de `th` y de `td` de `Total` y `Saldo`. |
| **Esperado** | 7 filas en orden **descendente por folio** (7, 6, 5, 4, 3, 2, 1), con los 9 encabezados en el orden declarado y la última celda vacía salvo por los botones. El correo va **debajo** del nombre del cliente en la misma celda (no hay columna propia) y las filas sin correo muestran solo el nombre. `Total` y `Saldo` están alineados a la derecha por `num: [5, 6]`; `Saldo` es una etiqueta de color, no texto plano. |

| | |
|---|---|
| **ID** | PAG-COB-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. En `#cargo-filtro`, elegir `Pendiente`, `Parcial`, `Pagado` y `Cancelado`, uno por uno.<br>2. Anotar el número de filas de cada elección contra el conjunto. |
| **Esperado** | `Todos` → 7 filas. `Pendiente` → 4 (cargos 1, 2, 6 y 7). `Parcial` → 1 (el 3). `Pagado` → 1 (el 4). `Cancelado` → 1 (el 5). El filtro **no** llama a la API: `pintarCobros` filtra `estado.cargos` en el navegador (`app.js:161-167`), así que Network **no** muestra ninguna petición al cambiar la opción. La API sí soporta el equivalente (`?status=`, `PAG-API-02`). |

| | |
|---|---|
| **ID** | PAG-COB-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. Escribir `QA-PAG Beta` en `#cargo-buscar`.<br>2. Cambiar `#cargo-filtro` a `Pagado` sin tocar la búsqueda.<br>3. Limpiar `#cargo-buscar`. |
| **Esperado** | 1: 1 fila (el cargo 3), sin peticiones en Network. 2: **0 filas**, aunque el cargo 3 sea el único con ese cliente: filtro y búsqueda se combinan con un `&&` lógico y no hay atajo para que un filtro contradiga la búsqueda. 3: `#cargo-filtro` conserva `Pagado`, o sea el filtro **no** se reinicia al limpiar la búsqueda. |

| | |
|---|---|
| **ID** | PAG-COB-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. Escribir `4` en `#cargo-buscar`.<br>2. Escribir `04`.<br>3. Escribir `QA-PAG deuda`.<br>4. Escribir `qa-pag` (minúsculas). |
| **Esperado** | La búsqueda compara con `String(valor).toLowerCase().includes()`, así que 1 devuelve todos los cargos cuyo folio, concepto, cliente o correo **contenga** el texto: `4` devuelve el cargo 4 y también cualquier otro que lo contenga (aquí el 4). `04` **no** devuelve el folio 4, porque el número se convierte a texto sin ceros a la izquierda. 3 devuelve 1 fila. 4 devuelve las 7 filas, porque la comparación no distingue mayúsculas. No hay peticiones en Network en ningún paso. |

| | |
|---|---|
| **ID** | PAG-COB-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | El cargo 1 con `notes` = `QA-PAG nota con acentos: ñ á é` y `customerEmail` = `qa-pag@ejemplo.cl`. |
| **Pasos** | 1. Escribir `qa-pag@ejemplo` en `#cargo-buscar`.<br>2. Escribir `nota` en `#cargo-buscar`.<br>3. Escribir `nota con acentos`.<br>4. Escribir `NOTA CON ACENTOS`. |
| **Esperado** | 1: 1 fila, porque el correo es una de las cuatro columnas buscables. 2: **0 filas**: las notas **no** se buscan, aunque el placeholder diga `Folio, concepto, cliente, correo` (el placeholder es correcto; la limitación es que no se busca por notas y no hay forma de filtrar por ellas). 3 y 4: la comparación es `toLowerCase()` sin normalizar, así que `nota con acentos` sí encuentra `nota con acentos` (mismo texto) pero un texto con `Ñ` escrito como `n` no lo encuentra. Anotar el caso sin acentos como cobertura faltante si molesta (`R-10`). |

| | |
|---|---|
| **ID** | PAG-COB-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. Escribir `zzzz` en `#cargo-buscar`.<br>2. Leer `#cobros-lista` en pantalla y contar las celdas de la fila vacía.<br>3. En la consola, leer `document.querySelectorAll('#cobros-lista td').length` para la fila de vacío. |
| **Esperado** | 1 fila con el texto `No hay cargos que coincidan` y `colspan: 9` (`AMIGO_UI.filaVacia(9, …)`), que ocupa el ancho de la tabla y no una celda angosta. La fila vacía **no** es una cabecera ni un mensaje genérico de error. |

| | |
|---|---|
| **ID** | PAG-COB-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2 sembrado. |
| **Pasos** | 1. Leer la celda `Saldo` de los cargos 1 (saldo `45055`), 3 (saldo `30000`) y 4 (saldo `0`).<br>2. Inspeccionar las clases de las tres celdas. |
| **Esperado** | El cargo 1 muestra `$ 450,55` con clase `ui-etiqueta--malo`, el 3 muestra `$ 300,00` también en `malo`, y el 4 muestra `$ 0,00` con `ui-etiqueta--ok`. La regla es `saldo > 0 ? malo : ok` (`app.js:202-203`), así que **un saldo de cero es verde**: el verde significa «no se debe nada», no «está bien». El cargo 5 cancelado también muestra `$ 0,00` en verde, con la etiqueta de estado `Cancelado` al lado. |

| | |
|---|---|
| **ID** | PAG-COB-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de rol `admin` y de rol `member`, en sesiones separadas. |
| **Pasos** | 1. Con sesión `member`, ir a `?panel=cobros` y leer los botones de la fila del cargo 1 (sin cobrado).<br>2. Con sesión `admin`, repetir.<br>3. Con sesión `admin`, leer los botones de la fila del cargo 3 (con abono). |
| **Esperado** | 1: solo `Ficha` y `Editar`. **No** hay `Borrar`, porque `puedeBorrar` sale de `estado.rol`, que viene de `/api/me` (`app.js:171, 217`). 2: aparece `Borrar` con clase `ui-btn--peligro`. 3: en el cargo 3 **no** aparece `Borrar` aunque la sesión sea admin: la condición es `puedeBorrar && !tieneCobrado`, y «tiene cobrado» se deduce con `saldoDe(c.id) < c.amountCents` (`app.js:216`). Un control que siempre devolvería `409` no se ofrece. |

| | |
|---|---|
| **ID** | PAG-COB-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `admin`; cargo 1 sin abonos. |
| **Pasos** | 1. Pulsar `Borrar` en la fila del cargo 1, sin confirmación intermedia.<br>2. Leer Network, `#aviso` y `#cobros-lista`.<br>3. `GET /api/charges/next-number`. |
| **Esperado** | Un solo clic borra: `DELETE /api/charges/<id>` `200 {"charge":{…},"deleted":true}` (no `{"ok":true,"deleted":true}`: esta ruta es la propia, no la del `crudRouter`). `#aviso` muestra `Cargo borrado`, la fila desaparece y la lista se repinta. **El folio no se recicla**: `next-number` sigue proposeindo el máximo + 1, así que el folio del cargo borrado queda libre para siempre y el siguiente número **sube**, no vuelve atrás. No hay diálogo de confirmación: comparar con `Cancelar el cargo`, que tampoco lo tiene (`PAG-ANU-01`). |

| | |
|---|---|
| **ID** | PAG-COB-10 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. En Network, con la pestaña Cobros abierta, escribir en `#cargo-buscar` y cambiar `#cargo-filtro`.<br>2. Registrar `/api/charges` en el primer render y anotar su query.<br>3. Con la sesión `admin`, editar un cargo y volver a la lista; repetir tras registrar un abono. |
| **Esperado** | La pantalla pide **`/api/charges?limit=500`** una sola vez por `cargar()` y filtra en el navegador. Consecuencias a comprobar: (a) una empresa con más de 500 cargos ve una lista **truncada sin aviso**, porque el `crudRouter` limita a `maxLimit: 1000` pero la UI pide 500 y no hay paginación ni botón de «ver más»; (b) al borrar, al crear y al cobrar se llama `recargar()`, que repite las cuatro peticiones de `cargar()` (charges, settings, saldos, me) **más** la del panel, así que cada acción de la ficha consume cinco peticiones del presupuesto de 600/15 min. |

| | |
|---|---|
| **ID** | PAG-COB-11 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Un cargo emitido en `2025-11-30` y otro en `2026-11-30`. |
| **Pasos** | 1. Leer la columna `Emitido` de las dos filas.<br>2. Leer la columna `Vence`.<br>3. Buscar `2025` en `#cargo-buscar`. |
| **Esperado** | `fechaCorta` pinta `DD/MM` **sin año** (`app.js:77-81`), así que las dos filas muestran `30/11` y son indistinguibles a simple vista en una cartera que cruza diciembre. Los cargos sin fecha muestran el guion `—`. Y la búsqueda **no** encuentra ninguno de los dos escribiendo `2025`, porque ni `issuedDate` ni `dueDate` son columnas buscables: no hay forma de acotar la cartera a un año desde la pantalla. |

### 4.4 Alta y edición de cargo — `#cargo-dialog`

Formulario: `#cargo-form` con `#cargo-id` (oculto), `#cargo-numero`, `#cargo-proponer-numero`,
`#cargo-concepto`, `#cargo-cliente-nombre`, `#cargo-cliente-id`, `#cargo-cliente-email`, `#cargo-monto`,
`#cargo-monto-vista`, `#cargo-emision`, `#cargo-vencimiento`, `#cargo-notas`, `#cargo-cerrar`,
`#cargo-cancelar`, y el encabezado `#cargo-form-titulo`. El botón `#cargo-nuevo` de la barra superior
lo abre. **No hay `<select>` de estado**, y no es un olvido (`app.js:11-16`).

| | |
|---|---|
| **ID** | PAG-ALTA-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=cobros`, sesión `member`. |
| **Pasos** | 1. Pulsar `#cargo-nuevo`.<br>2. Escribir `QA-PAG Nuevo` en `#cargo-cliente-nombre`, `QA-PAG prueba alta` en `#cargo-concepto`, `45055` en `#cargo-monto`, `2026-06-10` en `#cargo-emision`, `2026-07-10` en `#cargo-vencimiento`, `QA-PAG nota de alta` en `#cargo-notas`.<br>3. Dejar `#cargo-numero` vacío.<br>4. Pulsar `Guardar`. |
| **Esperado** | `POST /api/charges` `201 {"charge":{…}}` con el folio propuesto por el servidor, `organizationId` de la sesión, **`status: "pending"`** siempre (nunca pagado, nunca pagado a medias) y `amountCents: 45055`. El cuerpo que manda el formulario es `{number: null, concept, customerName, customerId: null, customerEmail: null, issuedDate: "2026-06-10", dueDate: "2026-07-10", amountCents: 45055, notes}`: los vacíos viajan como `null`, nunca como `""`. `#aviso` muestra `Cargo creado`, el diálogo se cierra y la fila aparece en `#cobros-lista`. |

| | |
|---|---|
| **ID** | PAG-ALTA-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con el cargo de folio `1` ya creado. |
| **Pasos** | 1. Abrir `#cargo-nuevo` y leer `#cargo-numero`.<br>2. Pulsar `Proponer` (`#cargo-proponer-numero`) y leer `#cargo-numero` y Network.<br>3. Cerrar y volver a abrir; pulsar `Proponer` otra vez. |
| **Esperado** | Al abrir, `#cargo-numero` está **vacío**: la pantalla no propone nada sola. Al pulsar `Proponer` sale `GET /api/charges/next-number` `200 {"number": 2}` y el input se completa con `2`. Dos `Proponer` seguidos devuelven `2` los dos: la propuesta es «el máximo + 1» en el momento de la llamada, y la pantalla **no** lo calcula (hay un test que lo verifica). Si entre medio alguien crea un cargo, el siguiente `Proponer` da `3`. |

| | |
|---|---|
| **ID** | PAG-ALTA-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Existe el cargo de folio `1`. |
| **Pasos** | 1. Abrir `#cargo-nuevo`, poner `#cargo-numero` = `1` y completar cliente, concepto y monto.<br>2. Pulsar `Guardar`.<br>3. Cambiar `#cargo-numero` a `9000000` y repetir el guardado. |
| **Esperado** | 2: `POST /api/charges` responde `409` con `{"error":"Ya existe el cargo numero 1 en esta empresa"}`, `#aviso` muestra ese texto tal cual y **el diálogo no se cierra**. 3: `9000000` es el máximo que acepta `number` (`z.coerce.number().int().min(1).max(9_999_999)`); `9000001` daría `400 Datos inválidos` con `errors.fieldErrors.number`. El índice único real es `(organization_id, number)`: dos empresas pueden tener cada una su folio `1`. |

| | |
|---|---|
| **ID** | PAG-ALTA-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cargo-dialog` abierto. |
| **Pasos** | 1. Poner `#cargo-monto` = `0` (ya es su valor inicial) y completar los campos obligatorios.<br>2. Pulsar `Guardar`.<br>3. Repetir vaciando `#cargo-monto` por completo y con `-5`. |
| **Esperado** | En los tres casos el **navegador bloquea el envío** por `required` y `min="1"`, y enfoca `#cargo-monto`; **no sale ninguna petición** en Network. Si el bloqueo no llegara a dispararse, el servidor responde `400 Datos inválidos` con `errors.fieldErrors.amountCents` = `El monto tiene que ser mayor que cero: un abono de cero o negativo dejaria la cartera al reves`, y la UI lo muestra como `amountCents: …` en `#aviso` (`AMIGO_UI.api` arma `campo: mensaje`). |

| | |
|---|---|
| **ID** | PAG-ALTA-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cargo-dialog` abierto. |
| **Pasos** | 1. Escribir `45055` en `#cargo-monto` y leer `#cargo-monto-vista`.<br>2. Cambiar a `45055` con `step` decimal si el navegador lo permite (por ejemplo `45055.4`) y leer de nuevo la vista previa.<br>3. Guardar y `GET /api/charges/<id>`. |
| **Esperado** | 1: `#cargo-monto-vista` dice `se ve como $ 450,55`. La vista previa se recalcula en cada evento `input` de `#cargo-monto`, sin botón. 2: la vista previa muestra el **número tal cual se escribiría**, truncado, mientras el valor que se manda es el que el servidor redondea: `centavos` aplica `Math.round` una sola vez, al escribir (`routes.ts:136-143`), así que `45055.4` se guarda como `45055` y `45055.5` como `45056`. 3: `amountCents` en la base es un entero. No hay conversión en la pantalla: `app.js` no multiplica por 100 en ninguna parte. |

| | |
|---|---|
| **ID** | PAG-ALTA-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Existe el cargo 1 (`45055`, sin abonos). |
| **Pasos** | 1. En su fila, pulsar `Editar`.<br>2. Leer `#cargo-form-titulo` y los nueve campos.<br>3. Cambiar solo `#cargo-concepto` a `QA-PAG concepto corregido` y pulsar `Guardar`.<br>4. Repetir `Editar` y pulsar `#cargo-cancelar` sin guardar. |
| **Esperado** | 1: `#cargo-form-titulo` pasa a `Editar cargo` y todos los campos quedan precargados con la fila del listado: `#cargo-monto` muestra **`45055` en crudo**, no `$ 450,55`, y `#cargo-monto-vista` muestra `se ve como $ 450,55` debajo, que es la ayuda. 3: `PATCH /api/charges/<id>` `200 {"charge":{…}}` con solo el concepto cambiado; el resto se conserva porque el PATCH es parcial (`routes.ts:1016-1027`), `#aviso` dice `Cargo actualizado` y el título vuelve a `Nuevo cargo`. 4: cerrar no envía nada y los valores escritos se pierden. El botón `Nuevo cargo` **siempre** abre el formulario limpio, porque `abrirCargo(null)` reescribe los once campos. |

| | |
|---|---|
| **ID** | PAG-ALTA-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 3 con `amountCents: 50000` y `20000` cobrado (saldo `30000`). |
| **Pasos** | 1. `PATCH /api/charges/<id>` con `{"amountCents": 30000}`.<br>2. Con `{"amountCents": 20000}`.<br>3. Con `{"amountCents": 20001}`. |
| **Esperado** | 1: `409` con `{"error":"El total no puede bajar de los 20000 centavos ya cobrados: dejaria el saldo en negativo"}`. 2: también `409`, por la misma razón: el límite es lo cobrado, no el saldo. 3: `200 {"charge":{…}}` y el estado **se recalcula**: `partial` (20001 cobrado de un total de 20001 es igual → `paid`, y de un total de 20001 con 20000 cobraría `partial`). Verificar contra la fila devuelta, no contra el cálculo mental: el caso interesante es que **subir** el total de un cargo `paid` lo vuelve `partial` sin que nadie escriba el estado (`estadoDesdeSaldo` se corre en el mismo PATCH). Ese es el precio de que el estado sea derivado. |

| | |
|---|---|
| **ID** | PAG-ALTA-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Existe el cargo 1. |
| **Pasos** | 1. `PATCH /api/charges/<id>` con `{"status": "paid"}`.<br>2. Con `{"status": "canceled"}`.<br>3. Con `{"statuss": "paid"}`. |
| **Esperado** | 1 y 2: `400` con `{"error":"El estado de un cargo no se edita: se cambia registrando un abono (POST /api/charges/:id/abonos) o cancelando (POST /api/charges/:id/cancelar)"}`. El estado se **rechaza**, no se ignora: si se aceptara y no se aplicara, quien lo mandó quedaría creyendo que el cargo quedó pagado. 3: también `400`, pero por `ZodError` (`Datos inválidos`), porque `cargoSchema` **no** es `strict()`: un campo mal escrito se descarta en silencio. El `strict()` y el mensaje `Campo desconocido: …` solo existen en el `crudRouter` (`crud.ts:124-150`), que aquí está tapado (`R-08`). |

| | |
|---|---|
| **ID** | PAG-ALTA-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cargo-dialog` abierto para un cargo nuevo. |
| **Pasos** | 1. Escribir `27-09-2026` en `#cargo-emision` y `2026/09/27` en `#cargo-vencimiento`.<br>2. Repetir con `2026-02-31` en `#cargo-vencimiento`.<br>3. Repetir con `2026-13-01`.<br>4. Escribir `2026-09-27` en los dos y guardar. |
| **Esperado** | 1: el `input[type=date]` del navegador ni siquiera deja escribir `27-09-2026`; si se fuerza por API, `400 Datos inválidos` con `issuedDate: La fecha va como AAAA-MM-DD`. 2: `400` con `dueDate: Fecha invalida: ese dia no existe en el calendario` — el `refine` rearma la fecha y descarta `2026-02-31`, que `Date.parse` normalizaría en silencio a `2 de marzo`. 3: igual que 2, con `2026-13-01`. 4: `201`. La fecha es **texto** `AAAA-MM-DD`, no un instante, y el servidor la interpreta en UTC: por eso el mismo código no se comporta distinto en Santiago y en Madrid. |

| | |
|---|---|
| **ID** | PAG-ALTA-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Existe el cargo 1. |
| **Pasos** | 1. En la interfaz, `Editar` el cargo 1 y **borrar** `#cargo-numero`.<br>2. Guardar y leer `GET /api/charges/<id>`.<br>3. Comparar con lo que hace `POST` cuando el folio viene `null`. |
| **Esperado** | 2: el folio **no cambia**: sigue siendo el que tenía. La razón está en el código y conviene entenderla antes de «arreglarlo»: el PATCH compara `body.number !== existente.number`, busca un choque con `number = NULL`, que en SQL nunca es verdadero, así que no hay `409`; después escribe `number: body.number ?? existente.number`, o sea vuelve al folio anterior. Un folio vacío al editar es «no tocar el folio», no «quitarlo». 3: en el `POST`, `null` significa «propón el siguiente». El mismo `null` significa dos cosas distintas según la operación, y eso no está escrito en ninguna parte de la interfaz. |

| | |
|---|---|
| **ID** | PAG-ALTA-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cargo-dialog` abierto. |
| **Pasos** | 1. Completar cliente, concepto y monto y pulsar `#cargo-cancelar` («Cancelar»).<br>2. Repetir cerrando con `#cargo-cerrar` (la `×`, `aria-label="Cerrar"`).<br>3. Contar las peticiones `POST` en Network en los dos casos.<br>4. Cerrar por `Esc` y repetir el paso 3. |
| **Esperado** | Los tres cierres (botón, `×` y `Esc`, que usa el comportamiento nativo del `<dialog>`) cierran el diálogo **sin enviar nada**. La única diferencia es que `Esc` no pasa por los manejadores de `app.js`, así que cualquier estado sucio queda igual: al reabrir con `#cargo-nuevo`, `abrirCargo(null)` reescribe los once campos, así que en este producto el formulario **no** arrastra valores de un intento anterior (a diferencia de otros productos de la suite, donde el `.reset()` solo corría tras un `POST` exitoso). |

### 4.5 Abonos y saldos — `#abono-form` y la ficha

`#abono-form` vive en el HTML (dentro de `#ficha-dialog`, junto a `#ficha`), y sus campos son
`#abono-monto`, `#abono-monto-vista`, `#abono-metodo` (`Efectivo`, `Tarjeta`, `Transferencia`,
`Otro`), `#abono-referencia`, `#abono-fecha`, más `#ficha-cancelar-cargo` y `#ficha-cerrar`.

| | |
|---|---|
| **ID** | PAG-ABO-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 1 abierto en la ficha (`saldo 45055`). |
| **Pasos** | 1. Abrir la ficha con `Ficha` desde la fila del cargo 1.<br>2. Leer el `dl` de `#ficha`: `Concepto`, `Total`, `Cobrado`, `Saldo`.<br>3. Poner `#abono-monto` = `20000`, `#abono-metodo` = `Transferencia`, `#abono-referencia` = `QA-PAG transf 12345`, dejar `#abono-fecha` vacío.<br>4. Pulsar `Registrar abono`. |
| **Esperado** | El `dl` muestra `Total $ 450,55`, `Cobrado $ 0,00` y `Saldo $ 450,55`; **no** aparece la fila `Devuelto`, que solo se pinta si `devueltoCents > 0`. `#abono-monto` llega precargado con el saldo. 4: `POST /api/charges/<id>/abonos` `201 {"charge":{…,"status":"partial"},"payment":{…},"pagadoCents":20000,"saldoCents":25055}`. **El estado no viaja en el cuerpo**: el formulario no tiene campo de estado y el servidor lo recalcula en la misma transacción. La etiqueta de estado de `#ficha` pasa a `Parcial`, `Cobrado` a `$ 200,00` y `Saldo` a `$ 250,55`. Sin `#abono-fecha`, el abono se registra con la hora real de ahora. |

| | |
|---|---|
| **ID** | PAG-ABO-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | El cargo 1 en `partial`, saldo `25055`. |
| **Pasos** | 1. En `#abono-monto`, que llega precargado con `25055`, pulsar `Registrar abono` sin cambiar nada.<br>2. Leer Network, `#ficha` y los botones del pie de `#ficha-dialog`. |
| **Esperado** | `201` con `pagadoCents: 45055` y **`saldoCents: 0`**, y el cargo queda en `status: "paid"`. El estado se recalcula a `paid` porque el abono igualó exactamente el saldo. Después de repintar, la etiqueta pasa a `Pagado`, `Cobrado` y `Saldo` quedan en `$ 450,55` y `$ 0,00`, y **`#abono-form` desaparece**: la condición es `cancelado || ficha.saldoCents <= 0` (`app.js:470`). Con `#abono-form` oculto también se oculta `#ficha-cancelar-cargo`, que vive en su pie: el diálogo de un cargo pagado queda sin ninguna acción más que `Cerrar`. |

| | |
|---|---|
| **ID** | PAG-ABO-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | El cargo 1 con saldo `25055`. |
| **Pasos** | 1. Poner `#abono-monto` = `25056` y registrar.<br>2. Leer `#aviso` y Network.<br>3. `GET /api/charges/<id>/ficha` y contar los abonos. |
| **Esperado** | `409` con `{"error":"El abono de 25056 centavos supera el saldo de 25055 centavos: un abono no puede dejar la cartera al reves"}`, mostrado en `#aviso` tal cual (es la regla del producto explicada, no un error de programa). El `409` **no escribe nada**: la ficha sigue con los mismos abonos, el mismo saldo y el mismo estado, porque el chequeo del saldo va **dentro** de la transacción que inserta. Comprobar que no aparece ni un abono de más ni un cambio de estado. |

| | |
|---|---|
| **ID** | PAG-ABO-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Ficha de un cargo con saldo. |
| **Pasos** | 1. `POST /api/charges/<id>/abonos` con `{"amountCents": 0}`.<br>2. Con `{"amountCents": -1000}`.<br>3. Con `{"amountCents": 0.4}`.<br>4. Con `{"amountCents": 45055.6}` (el saldo es `45055`). |
| **Esperado** | 1 y 2: `400 Datos inválidos` con `amountCents: El monto tiene que ser mayor que cero: un abono de cero o negativo dejaria la cartera al reves`. 3: `400` con `amountCents: El monto tiene que ser mayor que cero…` (el `> 0` va **después** del redondeo, a propósito: si fuera antes, `-0.4` pasaría el chequeo, se redondearía a `0` y llegaría al `CHECK (amount_cents > 0)` de SQLite, que responde `500`). 4: `45055.6` se redondea a `45056`, que supera el saldo, así que `409`: el redondeo ocurre una sola vez, al escribir. Con `45055.4` → `45055`, y ese sí se acepta (`201`). |

| | |
|---|---|
| **ID** | PAG-ABO-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Ficha de un cargo con saldo, sesión `member`. |
| **Pasos** | 1. Registrar cuatro abonos, uno por cada valor de `#abono-metodo`.<br>2. Leer las cuatro filas de la lista `Abonos` de `#ficha`.<br>3. Registrar un abono sin `#abono-referencia`. |
| **Esperado** | Cada abono sale con `method` (`cash`, `card`, `transfer`, `other`) y el `POST` lo manda siempre, porque `#abono-metodo` tiene valor por defecto. En la ficha cada fila muestra el método como título (`Efectivo`, `Tarjeta`, `Transferencia`, `Otro`), la referencia como nota si la hay, y a la derecha dos etiquetas: el instante (`toLocaleString('es-CL')`) y el importe en `ok`. Los abonos van en `DESC` de `received_at`: el más nuevo primero. Sin referencia, la nota simplemente no aparece. `#abono-referencia` es opcional y vacío viaja como `null`. |

| | |
|---|---|
| **ID** | PAG-ABO-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Ficha de un cargo con saldo, y día 1 del mes a las 00:00 disponible. |
| **Pasos** | 1. Poner `#abono-fecha` = `2026-06-01` y registrar un abono de `10000`.<br>2. Leer el `receivedAt` del abono en Network y el instante que muestra la ficha.<br>3. `GET /api/dashboard` y anotar `cobradoMesCents`.<br>4. Repetir con `#abono-fecha` = `2026-05-31`. |
| **Esperado** | El campo manda `receivedAt: "2026-06-01T00:00:00.000Z"` (`app.js:606`): medianoche **UTC**, que es el único instante que se puede afirmar sin inventar la hora, y el `dl` lo muestra como un instante completo con zona del navegador. Consecuencia: en `America/Santiago` ese abono es del **31 de mayo a las 20:00**, así que `GET /api/dashboard` **no** lo suma en `cobradoMesCents` (el corte del mes es la medianoche local). Es un abono de junio escrito en junio que el tablero no cuenta. Ver `PAG-TAB-07` y riesgo `R-04`. |

| | |
|---|---|
| **ID** | PAG-ABO-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 5 (`canceled`) y un cargo inexistente. |
| **Pasos** | 1. `POST /api/charges/<id del cargo 5>/abonos` con `{"amountCents": 1000}`.<br>2. Lo mismo contra `pagcargo_noexiste`. |
| **Esperado** | 1: `409 {"error":"Este cargo esta cancelado y no admite abonos"}`. Cancelar es una decisión y no un hecho de caja: si el estado se recalculara desde el saldo, el siguiente abono resucitaría solo un cargo que la empresa dio por perdido. 2: `404 {"error":"Ese cargo no existe"}`. En la interfaz el caso 1 **no es alcanzable**: en un cargo cancelado `#abono-form` está oculto desde el mismo `hidden` que la ficha pinta, así que el `409` hay que provocarlo por API. |

| | |
|---|---|
| **ID** | PAG-ABO-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Un cargo recién creado, sin ningún abono. |
| **Pasos** | 1. Abrir su ficha desde `?panel=cobros`.<br>2. En la consola: `document.querySelector('#abono-form').hidden` y leer el texto de la lista de abonos.<br>3. Registrar el primer abono desde `#abono-form`. |
| **Esperado** | `hidden` es **`false`**: el formulario de abono **sí** está visible con la lista de abonos vacía, y la lista muestra `Sin abonos registrados` (`AMIGO_UI.vacio`). El primer abono es perfectamente posible por la interfaz. Esto **corrige** la creencia de que hay un botón que se esconde mientras la lista de abonos está vacía: la condición real es `cancelado || saldoCents <= 0` (`app.js:470`), que depende del **saldo**, no de la cantidad de abonos. 3: `201` y el cargo queda `partial` o `paid` según el monto. Lo que sí es inalcanzable es la primera **devolución**: `PAG-ABO-10`. |

| | |
|---|---|
| **ID** | PAG-ABO-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Ficha de un cargo con saldo, DevTools abierto en la pestaña Console. |
| **Pasos** | 1. Registrar un abono y observar `#aviso` y la consola.<br>2. Esperar 5 segundos y volver a leer `#aviso`.<br>3. Cerrar y reabrir la ficha del mismo cargo. |
| **Esperado** | **Sospechado, a confirmar en el navegador.** El `dl` y las listas de `#ficha` **sí** se actualizan, pero `#aviso` **no** muestra `Abono registrado`: el manejador de `submit` llama `await abrirFicha(estado.fichaId)` (`app.js:613`), y `abrirFicha` termina con `$('#ficha-dialog').showModal()` sobre un `<dialog>` que **ya está abierto**, lo que según la especificación lanza `InvalidStateError`. Si lanza, la promesa de `abrirFicha` se rechaza y el `avisar('Abono registrado')` de la línea siguiente nunca se ejecuta; el error queda como rechazo no capturado en la consola, no como error de red. Si no lanza (por implementación del navegador), el aviso aparece con normalidad. El mismo camino se repite en la devolución y en la cancelación (`PAG-DEV-06`, `PAG-ANU-01`). |

| | |
|---|---|
| **ID** | PAG-ABO-10 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo con al menos un abono. |
| **Pasos** | 1. En la consola: `await (await fetch('/api/charges/saldos')).json()` y buscar el id del cargo.<br>2. `GET /api/charges/<id>` y enumerar las claves de la fila.<br>3. Comparar `saldoCents` de `/api/charges/saldos` con `saldoCents` de `GET /api/charges/<id>/ficha` y con `amountCents - abonadoCents + devueltoCents`.<br>4. Con un abono de `60000` y una devolución de `60000` sobre el mismo cargo, repetir. |
| **Esperado** | 1: `/api/charges/saldos` trae **una** entrada por cargo de la organización, con `pagadoCents` y `saldoCents`, y ninguna columna `paidCents` en ninguna parte: **el saldo no es una columna**, se deriva sumando `charge_payments` menos `charge_refunds` (`pagadoDe`, `routes.ts:215-222`). 2: la fila de `/api/charges/<id>` trae `id`, `organizationId`, `number`, `customerName`, `customerId`, `customerEmail`, `concept`, `amountCents`, `status`, `issuedDate`, `dueDate`, `notes`, `createdAt`, `updatedAt` — sin saldo ni cobrado. 3: las tres cifras coinciden para un cargo sin devoluciones. 4: con la devolución completa, `saldoCents` vuelve a ser `amountCents` y el estado del cargo vuelve a `pending`, **sin que nadie escriba el estado**: el mismo `estadoDesdeSaldo` corre en la transacción de la devolución. Un cargo `canceled` devuelve `saldoCents: 0` y no `total - cobrado`, que es la razón de que `saldoDe` reciba el estado como argumento. |

### 4.6 Devoluciones — `#devolucion-form` (creado en `app.js`)

**El formulario de devolución no está en el HTML.** Lo arma `formDevolucion()` en
`products/pagos/public/app.js:488-592` con `form.id = 'devolucion-form'`, y sus campos se piden por
`name` (`reason`, `amountCents`, `method`, `reference`, `refundedAt`), no por id. Existe **solo**
dentro de `seccionDevoluciones`, que se oculta mientras no haya devoluciones
(`seccionDevoluciones.hidden = ficha.refunds.length === 0`, `app.js:423`). Por eso, para que haya
algo que registrar hay que **abrir la ficha de un cargo que ya tenga al menos una devolución**
—hecha por API—; en un cargo recién cobrado la sección no existe en el DOM.

| | |
|---|---|
| **ID** | PAG-DEV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `member`; cargo 3 (`50000`, `20000` cobrado, saldo `30000`). |
| **Pasos** | 1. `POST /api/charges/<id>/devoluciones` con `{"amountCents": 20000, "reason": "QA-PAG abono cargado por error", "method": "transfer", "reference": "QA-PAG recip 77"}`.<br>2. Enumerar las cuatro claves de la respuesta.<br>3. `GET /api/charges/<id>/ficha`. |
| **Esperado** | `201` con `{ charge, refund, pagadoCents, saldoCents }`. La `refund` trae `id` con prefijo `pagref`, `reason` obligatorio, `method`, `reference`, `refundedAt` (ahora, porque no se mandó `refundedAt`) y `createdAt`. 3: `pagadoCents` cae a `0`, el estado del cargo vuelve a **`pending`**, `devueltoCents` es `20000`, `abonadoCents` sigue siendo `20000` y `saldoCents` vuelve a `50000`. La ficha **suma** las dos cifras: `Cobrado` muestra el **neto** (`pagadoCents`, `$ 0,00`) y aparece una fila `Devuelto $ 200,00` que antes no estaba. Es lo que hace auditable la operación: `abonadoCents` es lo que entró y `pagadoCents` lo que quedó. |

| | |
|---|---|
| **ID** | PAG-DEV-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | El cargo 3 tras `PAG-DEV-01`: neto `0`. |
| **Pasos** | 1. `POST /api/charges/<id>/devoluciones` con `{"amountCents": 1, "reason": "QA-PAG exceso"}`.<br>2. `GET /api/charges/<id>/ficha` y contar `refunds` y `payments`. |
| **Esperado** | `409` con `{"error":"Ese cargo tiene 0 centavos cobrados y la devolucion es de 1: no se devuelve mas de lo que entro"}`. Nada se escribe: `refunds` sigue con 1 elemento y el estado del cargo no cambia. El límite es el **neto cobrado** (`pagadoDe`), no la suma bruta de abonos: con un abono de `60000` y una devolución de `20000`, devolver `50000` es `409`. |

| | |
|---|---|
| **ID** | PAG-DEV-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un cargo con plata cobrada. |
| **Pasos** | 1. `POST /api/charges/<id>/devoluciones` con `{"amountCents": 1000}` (sin `reason`).<br>2. Con `{"amountCents": 1000, "reason": "   "}`.<br>3. Con `{"amountCents": -1000, "reason": "QA-PAG negativo"}`.<br>4. Con `{"amountCents": 1000, "reason": "QA-PAG ok", "method": "bitcoin"}`. |
| **Esperado** | 1 y 2: `400 Datos inválidos` con `reason: Deci por que se devuelve` (`min(1)` después del `trim`). Una devolución sin motivo es exactamente el movimiento que después nadie sabe explicar, y por eso es obligatorio mientras que la `reference` del abono es opcional. 3: `400` con `amountCents: El monto tiene que ser mayor que cero…`: la devolución es un documento que dice «salieron 5000», no un abono con signo menos, y lo defiende el `CHECK (amount_cents > 0)` de `charge_refunds`. 4: `400 Datos inválidos` con `method: …`: los cuatro métodos son cerrados (`cash`, `card`, `transfer`, `other`) porque la pregunta que se le hace a un abono es «cómo llegó». |

| | |
|---|---|
| **ID** | PAG-DEV-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | El cargo 1, sin abonos. |
| **Pasos** | 1. `POST /api/charges/<id>/devoluciones` con `{"amountCents": 1000, "reason": "QA-PAG no hay plata"}`.<br>2. Con el cargo 5 (`canceled`, sin abonos). |
| **Esperado** | 1: `409 {"error":"Ese cargo no tiene plata cobrada que devolver: se borra o se cancela nomas"}`. 2: `409 {"error":"Ese cargo esta cancelado: no se devuelve nada de un cargo que ya no se cobra"}`. En los dos casos el mensaje dice qué hacer, que es la diferencia entre un rechazo y una puerta cerrada en falso. Por API los dos son alcanzables; por interfaz ninguno (ver `PAG-ABO-10`). |

| | |
|---|---|
| **ID** | PAG-DEV-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cargo 7: `80000`, abono `60000`, una devolución de `60000` hecha por API (`PAG-DEV-01`). |
| **Pasos** | 1. En la consola: `document.querySelector('#ficha-dialog').open` y `document.querySelectorAll('#devolucion-form').length`.<br>2. Leer el texto de la sección `Devoluciones` de `#ficha`.<br>3. En `#devolucion-form`, leer el valor precargado del input `[name=amountCents]` y el texto del `span.ui-pista`. |
| **Esperado** | 1: **1** formulario `devolucion-form` en el DOM y el diálogo abierto: es el único camino por el que la interfaz registra una devolución, y exige que el cargo **ya tenga** al menos una. 2: se ve el encabezado `Devoluciones` con la fila de la devolución anterior: motivo como título, `método · comprobante` como nota, y a la derecha el instante y el importe en tono `malo`. 3: el monto llega precargado con **todo lo cobrado** (`pagadoCents`), no con el saldo, y la ayuda dice `de $ 600,00 cobrados`. Devolver todo es lo que casi siempre se quiere (el abono estaba mal) y es lo que habilita el `cancelar` que la API exige. |

| | |
|---|---|
| **ID** | PAG-DEV-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 7 abierto en la ficha con `#devolucion-form` visible. |
| **Pasos** | 1. Escribir `QA-PAG devolucion de prueba` en `[name=reason]` y dejar el monto precargado.<br>2. Elegir `[name=method]` = `Transferencia`.<br>3. Poner `[name=refundedAt]` = `2026-06-10`.<br>4. Pulsar `Registrar devolucion`.<br>5. Leer Network, `#aviso` y la sección `Devoluciones`. |
| **Esperado** | `POST /api/charges/<id>/devoluciones` `201` con `refundedAt: "2026-06-10T12:00:00.000Z"`: **mediodía UTC**, no medianoche como en `#abono-fecha` (`app.js:579`). Los dos campos son el mismo concepto —«el día de la caja»— escritos con dos convenciones distintas, y solo uno de los dos sobrevive al corte de mes en horario local (`R-05`). `#aviso` muestra `Devolucion registrada` (este aviso **sí** se pinta: va antes del repintado, `app.js:586`), la sección suma la fila nueva y el `dl` actualiza `Cobrado`, `Devuelto` y `Saldo`. Si aparece un `InvalidStateError` en la consola, es `PAG-ABO-09`. |

### 4.7 Anulación y borrado

| | |
|---|---|
| **ID** | PAG-ANU-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 6 (`45000`, sin abonos) abierto en la ficha. |
| **Pasos** | 1. En `#ficha`, leer si `#ficha-cancelar-cargo` está oculto.<br>2. Pulsarlo una vez, sin confirmar nada.<br>3. Leer Network, `#aviso` y el pie de `#ficha-dialog`. |
| **Esperado** | 1: `#ficha-cancelar-cargo` está **visible**: su condición es `cancelado || ficha.pagadoCents > 0` negada (`app.js:474`), o sea aparece justo cuando no hay plata cobrada. 2: `POST /api/charges/<id>/cancelar` con cuerpo `{}` responde **`200 {"charge":{…,"status":"canceled"}}`** (no `201`: no crea nada). `#aviso` dice `Cargo cancelado`, la etiqueta pasa a `Cancelado` (tono neutro) y **`#abono-form` y `#ficha-cancelar-cargo` desaparecen a la vez**. No hay diálogo de confirmación: un clic anula. |

| | |
|---|---|
| **ID** | PAG-ANU-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 6 ya cancelado. |
| **Pasos** | 1. `POST /api/charges/<id>/cancelar` con `{}`.<br>2. Con `{"notes": "QA-PAG nota de anulacion"}`.<br>3. `GET /api/charges/<id>` y leer `notes` y `status`. |
| **Esperado** | 1: `200 {"charge":{…}}` con el cargo **sin cambios**: cancelar dos veces es idempotente, para que un doble clic no deje un error en pantalla después de que el cargo ya quedó cancelado. 2: la `notes` **sí** se escribe cuando viene, y cuando no viene la anterior se conserva (`notes: body.notes ?? cargo.notes`, `routes.ts:912`): reemplazar unas notas que hablaban del trabajo por un «cancelado» perdería el motivo por el que se emitió. En la interfaz `#ficha-cancelar-cargo` ya no está, así que el paso 2 solo es alcanzable por API. |

| | |
|---|---|
| **ID** | PAG-ANU-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 3, con `20000` cobrados. |
| **Pasos** | 1. `POST /api/charges/<id>/cancelar` con `{}`.<br>2. Leer el botón `#ficha-cancelar-cargo` de esa misma ficha.<br>3. Devolver los `20000` y volver a intentar cancelar. |
| **Esperado** | 1: `409` con un mensaje largo que empieza `No se cancela un cargo con 20000 centavos ya cobrados: primero hay que devolver esa plata.` y termina explicando que cancelar significa «no se va a cobrar», no «se borró la historia». El chequeo es sobre el **dinero cobrado**, no sobre el estado, que es la pregunta real. 2: el botón **no está**: la interfaz esconde lo que la API va a rechazar igual. 3: con el neto a `0`, `POST .../cancelar` responde `200` y el cargo queda `canceled`. Ese es el único camino: devolver y después anular. |

| | |
|---|---|
| **ID** | PAG-ANU-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 3 con `20000` cobrados y saldo `30000`. |
| **Pasos** | 1. `POST /api/charges/<id>/cancelar` (esperado `409`, ver `PAG-ANU-03`).<br>2. `DELETE /api/charges/<id>` como `admin`.<br>3. Devolver los `20000` con `POST .../devoluciones`.<br>4. `POST .../cancelar` de nuevo.<br>5. `DELETE /api/charges/<id>` como `admin` otra vez. |
| **Esperado** | 1: `409`. 2: `409` con `Este cargo tiene 20000 centavos ya cobrados y no se borra: se devuelve la plata y se cancela.` El `CASCADE` del DDL sigue existiendo, pero ya no es una puerta. 3: `201`, el cargo vuelve a `pending` con saldo `50000`. 4: `200`, queda `canceled`. 5: **`200 {"charge":{…},"deleted":true}`**: sin plata cobrada, borrar sigue siendo lo de siempre y se lleva sus abonos y devoluciones en cascada. Los dos rechazos son deliberados y sus mensajes son la instrucción de cómo salir de ellos. |

| | |
|---|---|
| **ID** | PAG-ANU-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cargo 5 (`canceled`, `70000`). |
| **Pasos** | 1. `PATCH /api/charges/<id>` con `{"amountCents": 90000}`.<br>2. Con `{"concept": "QA-PAG concepto nuevo"}`.<br>3. Con `{"number": 77}`.<br>4. `GET /api/charges/<id>` y leer `status`. |
| **Esperado** | Los tres `PATCH` responden `200`, pero el `status` sigue siendo **`canceled`** en los cuatro casos: el PATCH lo deriva del saldo salvo que el cargo ya estuviera cancelado, en cuyo caso `existente.status === 'canceled'` gana (`routes.ts:1072`). Editar un cancelado **no lo resucita**, que es la garantía de que «no se va a cobrar» no se deshaga por corregir un número. Un abono posterior sí lo resucitaría… salvo que está prohibido (`PAG-ABO-07`). |

| | |
|---|---|
| **ID** | PAG-ANU-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Cargo 6 sin abonos, con sesión `member` y sesión `admin`. |
| **Pasos** | 1. Con `member`, `DELETE /api/charges/<id>`.<br>2. Con `member`, `PUT /api/settings` con `{"currency":"UF","timezone":"America/Santiago"}`.<br>3. Con `admin`, repetir el paso 2.<br>4. Con `member`, `POST /api/charges/<id>/abonos` de `1000`. |
| **Esperado** | 1 y 2: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`. Borrar un cargo borra el registro de la cartera y cambiar la zona o la moneda mueve la lectura de **toda** la empresa, así que los dos son de `admin`; por eso son las dos únicas escrituras del producto con ese rol. 3: `200 {"settings":{…}}` con una sola fila en `settings` para la organización (índice único), no una por persona. 4: `201`, porque `member` sí puede cobrar. Es un contraste que hay que probar de las dos partes: el mismo rol escribe y no borra. |

| | |
|---|---|
| **ID** | PAG-ANU-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cargo con abono y sesión `admin`. |
| **Pasos** | 1. `PATCH /api/charges/<id>` subiendo `amountCents` por encima de lo cobrado (`200000` sobre un total de `100000`).<br>2. `DELETE /api/charges/<id>`.<br>3. Devolver toda la plata y volver a intentar el `DELETE`. |
| **Esperado** | 2: `409`, aunque el cargo **no** tenga nada cobrado visible en el botón `Borrar` de la lista: el botón usa `saldo < total` y el servidor usa el saldo neto real, y subir el total por la API no actualiza la lista. Es la comprobación de que el chequeo mira el dinero y no la etiqueta. 3: `200`, ya sin plata. La conclusión de la prueba es que **subir el total por API sí cambia cuándo un cargo deja de ser borrable**, un efecto secundario que ningún texto de la interfaz anuncia. |

| | |
|---|---|
| **ID** | PAG-ANU-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Cargo cancelado. |
| **Pasos** | 1. Con el cargo 5 cancelado, `GET /api/charges?status=canceled`.<br>2. `GET /api/reporte`.<br>3. `GET /api/dashboard` y comparar `pendienteCents` con la suma manual de saldos.<br>4. Buscar en toda la API una ruta que devuelva `canceled` a otro estado. |
| **Esperado** | 1: el cargo sigue en la lista con su folio. 2: **no** aparece: el reporte excluye `status = 'canceled'` antes de agrupar, porque contar lo que no se va a cobrar haría ver una cartera más grande que la real. 3: `pendienteCents` **no** lo suma, y tampoco lo suma aunque su `amountCents` sea de `70000`. 4: **no existe**. No hay `POST /api/charges/:id/reactivar` ni un `PATCH` que acepte `status`, y `POST .../abonos` sobre un cancelado es `409`. La anulación de un cargo sin plata cobrada es, por API y por interfaz, **irreversible**; la única válvula es el `Borrar`, que también es irreversible y no pide confirmación (`R-02`). |

### 4.8 Reporte de antigüedad — panel `reporte`

Selectores: `#reporte-desde`, `#reporte-hasta`, `#reporte-filtrar` (texto **Calcular**),
`#reporte-tabla` y el pie `#reporte-total`. El panel muestra el texto de ayuda
«Cuanto se le debe a cada cliente y desde cuando. Los dias de atraso se miden contra la fecha de
corte; si no se pone una, se miden contra hoy».

| | |
|---|---|
| **ID** | PAG-REP-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2, `hoy` = `2026-06-15`. |
| **Pasos** | 1. En `#reporte-desde` y `#reporte-hasta` dejar los dos campos vacíos.<br>2. Pulsar `Calcular`.<br>3. Leer Network, las cuatro filas de `#reporte-tabla` y `#reporte-total`. |
| **Esperado** | `GET /api/reporte?` `200` con `from: null`, `to: null`, `referencia: "2026-06-15"` (el día de hoy **en la zona de la empresa**, no en UTC), `totalCargos: 5`, `totalPendienteCents: 230055`. `#reporte-tabla` muestra **las cuatro filas siempre**, aunque estén en cero: `0-30` con 3 cargos y `$ 1.700,55`, `31-60` con 0 y `$ 0,00`, `61-90` con 0 y `$ 0,00`, `mas-90` con 2 y `$ 600,00`. Los rótulos son las **claves crudas** (`0-30`, `31-60`, `61-90`, `mas-90`), sin traducir. `#reporte-total` dice `5 cargo(s) con saldo al 2026-06-15: $ 2.300,55 pendientes.` |

| | |
|---|---|
| **ID** | PAG-REP-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. `GET /api/reporte?to=2026-03-31` y anotar `referencia` y `buckets`.<br>2. Repetir la misma llamada dos veces, en días distintos si se puede.<br>3. Poner `#reporte-hasta` = `2026-03-31` y pulsar `Calcular`. |
| **Esperado** | 1: `referencia: "2026-03-31"` y los tramos miden **contra esa fecha**, no contra hoy. Con el cargo 2 emitido en enero, la lectura cambia de `mas-90` a un tramo distinto según el corte, sin que cambie un solo byte de la cartera. 2: el mismo archivo da los mismos números el día que sea: esa es la diferencia entre un reporte y una foto. 3: `#reporte-total` usa `reporte.referencia`, que es el `to` que se envió, y la fecha se muestra en `AAAA-MM-DD` mientras el importe va en `es-CL`: los dos formatos conviven en la misma línea. |

| | |
|---|---|
| **ID** | PAG-REP-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. `GET /api/reporte?from=2026-06-01&to=2026-06-15`.<br>2. `GET /api/reporte?from=2026-06-01` (sin `to`).<br>3. Comparar con el reporte sin rango. |
| **Esperado** | 1: `totalCargos: 2` (cargos 1 y 7; el 6 se cae), `totalPendienteCents: 125055`. El rango filtra por **`issued_date`**, no por vencimiento: un reporte de cartera se pregunta sobre lo que se emitió en un período. Un cargo **sin `issued_date` no entra** en un rango, porque sin fecha no se puede saber si se emitió dentro o fuera. 2: sin `to`, la referencia de los días de atraso pasa a ser hoy (`referencia` = `2026-06-15`), pero el filtro de emisión queda abierto hacia el futuro, así que el mismo archivo abierto dentro de tres meses seguirá trayendo cargos de junio con días de atraso medidos contra otro día. Comprobar que las dos cifras no se contradicen: el filtro y la referencia son dos cosas distintas con el mismo campo. |

| | |
|---|---|
| **ID** | PAG-REP-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. Anotar `buckets` y `totalCargos` de `GET /api/reporte`.<br>2. Sumar a mano los saldos de los cargos con saldo y comparar.<br>3. Repetir con el cargo 5 cancelado y con el cargo 4 pagado. |
| **Esperado** | Cada tramo suma **saldos**, no totales: el cargo 3 entra en `mas-90` con `30000` y no con `50000`. Los cancelados **no** aparecen y los pagados **no** aportan (el filtro es `saldo > 0`). La suma de los cuatro tramos es exactamente `totalPendienteCents`, y `totalCargos` es el número de cargos con saldo, no el número de cargos emitidos. |

| | |
|---|---|
| **ID** | PAG-REP-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. Con el corte en `2026-06-15`, identificar qué cargos caen en `0-30`.<br>2. Crear un cargo con `dueDate: "2026-06-01"` y `amountCents: 10000`, y repetir el reporte.<br>3. Crear un cargo **sin** `dueDate` y repetir. |
| **Esperado** | 1: en `0-30` caen el cargo 1 (vence en `-30` días, o sea **aún no vence**), el cargo 6 (sin vencimiento) y el cargo 7 (vence en `-20`). 2 y 3: los nuevos también caen en `0-30`. El tramo `0-30` **mezcla** lo que todavía no vence, lo que vence dentro de 30 días, lo que lleva hasta 30 días vencido y lo que no tiene fecha de vencimiento: `tramoDe` devuelve `0-30` para cualquier `dias <= 0` y `diasDeAtraso` devuelve `0` cuando no hay `dueDate` (`routes.ts:320-341`). Es una decisión —una cartera que esconde lo que no tiene vencimiento se ve menor de lo que es— pero el rótulo `0-30` no dice ninguna de las tres cosas que agrupa. Anotarlo como riesgo de lectura (`R-07`). |

| | |
|---|---|
| **ID** | PAG-REP-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/reporte?from=hoy`.<br>2. `GET /api/reporte?to=27-09-2026`.<br>3. `GET /api/reporte?from=2026-06-01&from=2026-07-01` (parámetro repetido).<br>4. `GET /api/reporte?from=&to=`. |
| **Esperado** | 1 y 2: `400` con un mensaje que nombra el parámetro y el formato, del tipo `from va como AAAA-MM-DD (from=2026-09-27)`: es un `AppError`, no un `ZodError`. Un rango inválido es un **error y no un reporte sin filtro**, que es la diferencia entre enterarse y creerse que filtró. 3: `queryUnValor` descarta el array y se queda con el primer valor, así que responde `200` con `from: "2026-06-01"`. 4: `200` con `from: null` y `to: null`, equivalente a no mandar nada. |

| | |
|---|---|
| **ID** | PAG-REP-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. Poner `#reporte-desde` = `2099-01-01` y pulsar `Calcular`.<br>2. Leer las cuatro filas y `#reporte-total`.<br>3. Cambiar `#cfg-zona` a `Asia/Tokyo` (como admin), guardar y pulsar `Calcular` otra vez. |
| **Esperado** | 1: los cuatro tramos se pintan con `0` cargos y `$ 0,00`, y `#reporte-total` dice `0 cargo(s) con saldo al <referencia>: $ 0,00 pendientes.` **La tabla no desaparece**: los cuatro tramos se arman siempre para que la pantalla no «salte» al cambiar los datos. 3: con la zona en Tokio, `referencia` cambia al día de Tokio (después de las 21:00 hora de Santiago ya es mañana allá), que es exactamente lo que la zona decide y por eso es de la empresa y no de la persona. La moneda del pie sigue viniendo de `#cfg-moneda` (`monto()` usa `estado.cfg.currency`). |

| | |
|---|---|
| **ID** | PAG-REP-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. En `?panel=tablero`, anotar `Vencido`.<br>2. En `?panel=reporte`, anotar el total de `mas-90` y el de `61-90`.<br>3. En `?panel=cobros`, abrir `#cargo-filtro` y elegir cada opción. |
| **Esperado** | `Vencido` (`60000`) son los saldos de cargos con `dueDate < hoy`. `mas-90` (`60000`) es otra definición: **cualquier** saldo con más de 90 días de atraso, más los que no tienen vencimiento (`0` días) que caen en `0-30`. Las dos cifras coinciden en este conjunto por casualidad, no por construcción: un cargo de hace 40 días entra en `31-60` y **no** está vencido; un cargo sin vencimiento nunca está vencido y **sí** aparece en `0-30`. `#cargo-filtro` no tiene forma de filtrar por vencido ni por tramo, así que para pasar de la cifra a las filas hay que cruzar las dos pantallas a mano. |

### 4.9 Ajustes — panel `ajustes`, `#config-form`

El formulario se lee por `name`, no por id: `renderConfig` recorre `form.elements` y empareja cada
`name` con la clave del objeto de ajustes (`app.js:669-676`). Los dos campos son `#cfg-moneda`
(`name="currency"`, `maxlength="5"`) y `#cfg-zona` (`name="timezone"`, `maxlength="64"`).

| | |
|---|---|
| **ID** | PAG-AJU-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, empresa que nunca guardó ajustes (base nueva). |
| **Pasos** | 1. `GET /api/settings`.<br>2. Enumerar las claves de `settings`.<br>3. Abrir `?panel=ajustes` y leer `#cfg-moneda` y `#cfg-zona`. |
| **Esperado** | `200 {"settings":{"organizationId":"<org>","currency":"$","timezone":"America/Santiago"}}`. Los valores por defecto del servidor están presentes **aunque no exista fila**: `leerPreferencias` devuelve los defaults campo por campo (`routes.ts:399-405`). `#cfg-moneda` muestra `$` y `#cfg-zona` `America/Santiago`. No hay más ajustes que estos dos: no hay jornada, ni anticipación, ni formato de folio, ni numeración de página. |

| | |
|---|---|
| **ID** | PAG-AJU-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`, sesión `admin`. |
| **Pasos** | 1. Poner `#cfg-moneda` = `UF` y `#cfg-zona` = `America/Mexico_City`.<br>2. Pulsar `Guardar ajustes`.<br>3. Leer Network y `#aviso`.<br>4. Ir a `?panel=cobros` y leer la columna `Total` de la fila del cargo 1.<br>5. Ir a `?panel=reporte`, pulsar `Calcular` y leer `referencia` en `#reporte-total`. |
| **Esperado** | `PUT /api/settings` `200 {"settings":{…}}` con `"currency":"UF","timezone":"America/Mexico_City"`, y `#aviso` muestra `Ajustes guardados`. 4: **todos** los importes de la pantalla pasan a `UF 450.55` (el separador y el símbolo los pone `Intl.NumberFormat('es-CL')` con el prefijo que le da la empresa: no es un cambio de conversión, es un cambio de rótulo, porque el número de centavos es el mismo). 5: `referencia` cambia al día de Ciudad de México. El formulario no pide confirmación para un cambio que mueve la lectura de la cartera de **toda** la organización. |

| | |
|---|---|
| **ID** | PAG-AJU-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=ajustes`, sesión `admin`. |
| **Pasos** | 1. Poner `#cfg-zona` = `Chile/Continental` y guardar.<br>2. Poner `#cfg-zona` = `America/Santiago`, `#cfg-moneda` = `` (vacío) y guardar.<br>3. Poner `#cfg-moneda` = `ABCDEFG` y guardar.<br>4. Restaurar `$` y `America/Santiago`. |
| **Esperado** | 1: `400 {"error":"Zona horaria desconocida: Chile/Continental"}`: la zona se valida contra `Intl`, no contra una lista escrita a mano, así que cualquier zona de la base IANA sirve y una lista propia envejece. El rechazo es al **guardar**, no después al formatear. 2: `400 Datos inválidos` — `currency` es `min(1)`. 3: el `maxlength="5"` del input lo impide en la interfaz; por API, `400 Datos inválidos`. 4: `200`. |

| | |
|---|---|
| **ID** | PAG-AJU-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`, sesión `member`. |
| **Pasos** | 1. Leer `#config-form`: ¿está oculto o deshabilitado?<br>2. Cambiar `#cfg-moneda` y pulsar `Guardar ajustes`.<br>3. Leer Network y `#aviso`.<br>4. `GET /api/settings` y confirmar que no cambió nada. |
| **Esperado** | 1: el formulario está **visible y habilitado** para un `member`: la pantalla no condiciona nada por rol en el panel de ajustes. 2: `PUT /api/settings` responde `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` y `#aviso` lo muestra tal cual. 4: los ajustes siguen como estaban. Es el caso de UI que intenta lo que la API prohíbe, y la pantalla deja que se intente: el botón `Borrar` sí se esconde (`PAG-COB-08`) pero el de guardar ajustes no, y la asimetría no tiene explicación visible. Anotar como riesgo de permisos (`R-11`). |

| | |
|---|---|
| **ID** | PAG-AJU-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Guardar ajustes y volver a abrir `?panel=ajustes`.<br>2. En la consola, agregar un `<input name="currency">` suelto a `#config-form` y recargar.<br>3. `PUT /api/settings` con `{"currency":"$","timezone":"America/Santiago","extra":1}`.<br>4. `PUT /api/settings` con `{"currency":"$"}` solamente. |
| **Esperado** | 1: los dos campos vienen con el valor guardado. 2: el input extra queda sin rellenar y **no** rompe nada: `renderConfig` salta los elementos cuyo `name` no está en el objeto de ajustes. Agregar un ajuste nuevo es poner un `<input name="…">` sin tocar el JS. 3: el `z.object` de `PUT /api/settings` **no** es `strict()`, así que `extra` se descarta en silencio y responde `200` (mismo criterio que `PAG-ALTA-08`: el mensaje «Campo desconocido» es del `crudRouter`, que aquí está tapado). 4: `200`, porque los dos campos tienen `default` y la zona sin mandar se vuelve a escribir. |

### 4.10 API de cargos — folio, contrato de lista y sus datos

| | |
|---|---|
| **ID** | PAG-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2 (7 cargos). |
| **Pasos** | 1. `GET /api/charges`.<br>2. Enumerar las cuatro claves de la respuesta y las de `items[0]`.<br>3. Ordenar los folios que devuelve. |
| **Esperado** | `200 {"items":[…],"total":7,"limit":200,"offset":0}`. `limit` por defecto `200`, tope `1000`, `offset` por defecto `0` (`crudRouter`, `defaultLimit`/`maxLimit`). Orden **descendente por folio** (`orderBy: charges.number`, `orderDirection: 'desc'`), no por fecha de creación: por eso el cargo 1 aparece al final aunque sea el más antiguo. Cada fila trae `id` con prefijo `pagcargo`, `organizationId`, `number`, `customerName`, `customerId`, `customerEmail`, `concept`, `amountCents`, `status`, `issuedDate`, `dueDate`, `notes`, `createdAt`, `updatedAt`. **No** trae `paidCents` ni `saldoCents`. |

| | |
|---|---|
| **ID** | PAG-API-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Conjunto de la sección 2. |
| **Pasos** | 1. `GET /api/charges?status=pending`.<br>2. `GET /api/charges?status=borrado`.<br>3. `GET /api/charges?status=` (vacío).<br>4. `GET /api/charges?status=pending&status=paid`. |
| **Esperado** | 1: `total: 4`. 2: `400 {"error":"El filtro status no es valido","errors":{"fields":["status: …"]}}`: un valor que no existe es un error y no un «sin filtro», porque devolver todo y dejar que el usuario crea que filtró es peor que un error. 3: `200` con los 7: un filtro sin valor se ignora a propósito (quien lo mandó quiere todos, no una lista vacía). 4: se toma el primer valor (`Array.isArray(raw) ? raw[0] : raw`). La pantalla **nunca** usa este filtro: `pintarCobros` filtra en el navegador (`PAG-COB-02`), así que este caso es de API pura. |

| | |
|---|---|
| **ID** | PAG-API-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | El cargo 1 con folio `42` y correo `qa-pag@ejemplo.cl`; el cargo 2 con folio `142`. |
| **Pasos** | 1. `GET /api/charges?q=42`.<br>2. `GET /api/charges?q=0042`.<br>3. `GET /api/charges?q=QA-PAG`.<br>4. `GET /api/charges?q=ejemplo`.<br>5. `GET /api/charges?q=QA-PAG nota de alta` (texto de `notes`). |
| **Esperado** | 1: los cargos cuyo folio contiene `42`, o sea los folios `42` y `142` (no es una búsqueda de folio exacto). 2: **sospechado, verificar**: el comentario de `routes.ts:1276-1278` afirma que `?q=0042` encuentra el folio `42` porque SQLite convierte el número a texto, pero el `LIKE` se aplica sobre una columna `INTEGER`: lo esperable es que el patrón `%0042%` se compare contra `42` y **no** coincida, mientras `%42%` sí. Si `?q=0042` devuelve `total: 0`, el comentario está equivocado (`R-12`). 3: los cargos cuyo cliente o concepto contenga el texto. 4: el cargo 1, por correo. 5: `total: 0`: `notes` no es una columna buscable, igual que en la pantalla (`PAG-COB-05`). |

| | |
|---|---|
| **ID** | PAG-API-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | 7 cargos. |
| **Pasos** | 1. `GET /api/charges?limit=3`.<br>2. `GET /api/charges?limit=3&offset=3`.<br>3. `GET /api/charges?limit=0`.<br>4. `GET /api/charges?limit=9999`.<br>5. `GET /api/charges?offset=99`. |
| **Esperado** | 1: `limit: 3` y 3 filas. 2: 3 filas **distintas**, las siguientes en el orden descendente por folio. 3: `limit: 0` cae al valor por defecto (`Number(0) || 200` = `200`). 4: `limit: 1000`, el tope. 5: `items: []` y `total: 7` (el `total` es independiente de la página). La pantalla pide `limit=500` y no usa `offset` en ningún lado (`PAG-COB-10`). |

| | |
|---|---|
| **ID** | PAG-API-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Existe el cargo 1. |
| **Pasos** | 1. `GET /api/charges/<id>`.<br>2. `GET /api/charges/<id>/ficha` y enumerar las siete claves.<br>3. `GET /api/charges/pagcargo_noexiste`.<br>4. `GET /api/charges/pagcargo_noexiste/ficha`.<br>5. `GET /api/no-existe`. |
| **Esperado** | 1: la fila **cruda**, sin envoltorio (este `GET` sí viene del `crudRouter`). 2: `{ charge, payments, refunds, abonadoCents, devueltoCents, pagadoCents, saldoCents }` — siete claves. 3: `404 {"error":"No encontrado"}`: es el mensaje genérico del `crudRouter`. 4: `404 {"error":"Ese cargo no existe"}`: es el de las rutas propias, que nombra el recurso. **El mismo error llega con dos textos según por dónde se pida**, y la ficha no acepta `?q=` ni `?limit=` (no los lee). 5: `404 {"error":"No existe GET /api/no-existe"}`, del `notFound` del runtime: es el caso negativo explícito de esta ruta. |

| | |
|---|---|
| **ID** | PAG-API-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `member`; existe el cargo de folio `9`. |
| **Pasos** | 1. `GET /api/charges/next-number`.<br>2. `POST /api/charges` con `{"customerName":"QA-PAG","concept":"QA-PAG","amountCents":1000,"number":9}`.<br>3. Repetir el paso 1.<br>4. `DELETE /api/charges/<id>` del cargo borrado en el paso 2 y repetir el paso 1. |
| **Esperado** | 1: `200 {"number":10}`. 2: `409 Ya existe el cargo numero 9 en esta empresa`, y nada se escribe. 3: sigue dando `10`: el folio repetido **no** consume número. 4: tras el borrado, `next-number` sigue dando `10`, porque se calcula como `MAX(number) + 1` y no como «cantidad de cargos + 1»: un folio dado no vuelve a usarse y el máximo más uno nunca repite. Esa es también la razón de que el índice único sea `(organization_id, number)`. |

| | |
|---|---|
| **ID** | PAG-API-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión `member`. |
| **Pasos** | 1. `POST /api/charges` con `{"customerName":"QA-PAG","concept":"QA-PAG","amountCents":1000,"organizationId":"<org ajena>"}`.<br>2. `POST /api/charges` con `{"customerName":"QA-PAG","concept":"QA-PAG","amountCents":1000,"amountCents2":1}`.<br>3. `POST /api/charges` sin `concept`.<br>4. `POST /api/charges` con `{"customerName":"   ","concept":"QA-PAG","amountCents":1000}`.<br>5. `POST /api/charges` con `{"customerName":"QA-PAG","concept":"QA-PAG","amountCents":1000,"issuedDate":"2026-02-31"}`.<br>6. `POST /api/charges` con `{"customerName":"QA-PAG","concept":"QA-PAG","amountCents":1000,"customerEmail":"no-es-correo"}`. |
| **Esperado** | 1: `201` y el `organizationId` de la **sesión**: el cuerpo no puede mover los datos de una empresa a otra. 2: `201` y `amountCents2` se descarta **en silencio** (`cargoSchema` no es `strict()`), lo que es justo el fallo que `parseCuerpo` del `crudRouter` evita con el mensaje `Campo desconocido: …`. 3: `400 Datos inválidos` (`concept` es obligatorio). 4: `400 Datos inválidos`: `customerName` exige `min(1)` después del `trim()`. 5: `400` con `issuedDate: Fecha invalida: ese dia no existe en el calendario`. 6: `400` con `customerEmail: Correo invalido`. El correo vacío (`""`) sí se acepta: el esquema es unión de email, cadena vacía y `null`. |

| | |
|---|---|
| **ID** | PAG-API-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Existe el cargo 1. |
| **Pasos** | 1. `POST /api/charges` con `{"customerName":"QA-PAG","concept":"QA-PAG","amountCents":1000,"createdAt":"2020-01-01T00:00:00.000Z"}`.<br>2. `PATCH /api/charges/<id>` con `{"status":"paid","concept":"QA-PAG nuevo"}`.<br>3. `PATCH /api/charges/pagcargo_noexiste` con `{"concept":"x","customerName":"y","amountCents":1}`.<br>4. `DELETE /api/charges/pagcargo_noexiste` como `admin`. |
| **Esperado** | 1: `201` con `createdAt` del servidor, no el enviado: los campos `status`, `createdAt` y `updatedAt` son de solo lectura en el `crudRouter`, y la ruta propia ni los mira. 2: `400` con el mensaje que remite a `/abonos` o `/cancelar`: el chequeo de `status` va **antes** del `parse` del cuerpo, así que un `PATCH` que mezcle estado y otro campo no se aplica parcialmente. 3 y 4: `404 {"error":"Ese cargo no existe"}` (el mensaje de las rutas propias, no el `No encontrado` del `crudRouter`). En la interfaz ninguna de estas cuatro se alcanza: no hay forma de escribir `createdAt` ni `status` desde el formulario. |

### 4.11 Sesión, arranque y aislamiento

| | |
|---|---|
| **ID** | PAG-SIST-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Producto arriba. |
| **Pasos** | 1. Anotar la primera línea del log de arranque.<br>2. `curl -s http://localhost:<puerto>/health`.<br>3. Repetir con `POST`.<br>4. `curl -s http://localhost:<puerto>/api/meta`. |
| **Esperado** | El log dice `Control de Pagos (pagos) en <APP_URL> -> puerto <PORT>` y `Identidad y suscripciones: <CORE_URL>`; **anotar los valores reales**, porque `.env.example` dice `PORT=3024` con `APP_URL=…:3023` y esa incoherencia es del monorepo, no del producto. `GET /health` y `POST /health` responden `200 {"ok":true,"product":"pagos","name":"Control de Pagos"}` **sin sesión**. `GET /api/meta` responde `200 {"name":"Control de Pagos","product":"pagos","version":2,"identity":"amg-central"}`, también sin sesión. Si la base no se puede abrir, `/health` responde `503 {"ok":false,"product":"pagos"}`. |

| | |
|---|---|
| **ID** | PAG-SIST-02 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Ventana de incógnito sin cookie de sesión. |
| **Pasos** | 1. En incógnito, abrir `http://localhost:<puerto>/api/charges`.<br>2. Abrir `http://localhost:<puerto>/api/dashboard`.<br>3. Abrir `http://localhost:<puerto>/` en el navegador.<br>4. Abrir `/app.js`. |
| **Esperado** | 1 y 2: `401 {"error":"sin-sesion","loginUrl":"…","message":"…"}`: todo camino que empieza con `/api/` es JSON, aunque el `Accept` del navegador sea HTML. 3: `302` al login del Core con `return_to`. 4: el shell se sirve **después** de la identidad, así que sin sesión tampoco se descarga `/app.js`. No hay pantalla de login propia: el producto no pide usuario ni contraseña. Un `401` con `loginUrl` en `AMIGO_UI.api` provoca navegación al login y lanza `sesion vencida`, sin pintar datos vacíos. |

| | |
|---|---|
| **ID** | PAG-SIST-03 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/me`.<br>2. `GET /api/inicio`.<br>3. Comparar con lo pintado en el canal lateral. |
| **Esperado** | `/api/me` responde `200 {"user":{"id","email","name"},"organization":{"id","slug"},"role":"member\|admin\|owner","product":"pagos"}`. `/api/inicio` responde `200 {"usuario":{id,nombre,email},"organizacion":{id,slug,nombre},"rol":"…","herramienta":"pagos","herramientas":[…]}`. `data-amigo="empresa"` muestra `organizacion.nombre` muestra `usuario.nombre`, `data-amigo="correo"` muestra `usuario.email`, `data-amigo="avatar"` muestra las iniciales, y `data-amigo="otras"` lista las demas herramientas de la organizacion. **No hay ninguna clave de rol**: el shell no lo recibe. Ver `R-05`. |

### 4.11 Sesion, arranque y aislamiento (continuacion)

| | |
|---|---|
| **ID** | PAG-SIST-04 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondici?n** | Dos organizaciones con suscripci?n a pagos activas, sesiones en ventanas separadas. |
| **Pasos** | 1. En org A, crear cargo QA-PAG Org A con mountCents: 10000.<br>2. En org B, crear cargo QA-PAG Org B con mountCents: 5000.<br>3. GET /api/charges en org B y contar filas.<br>4. GET /api/dashboard en org B y GET /api/dashboard en org A. |
| **Esperado** | 1 y 2: creados con sus organizationId propios. 3: solo ve el cargo de org B (	otal: 1). 4: los totales son independientes entre organizaciones. charges.id lleva pagcargo_ y todos los SELECT llevan organization_id = @orgId por el middleware del producto (outes.ts usa el contexto de sesi?n). No hay fuga entre organizaciones. |

---

## 5. Recorridos E2E

### 5.1 Recorrido 1: Emitir un cargo y llegar a su ficha (desde tablero)

**ID:** PAG-E2E-01 | **Tipo:** E2E | **Prioridad:** P0

**Precondici?n:** Sesi?n activa, base vac?a o limpia.

**Pasos:**
1. Ir a /?panel=tablero. Comprobar que #recientes muestra Todavia no hay cargos emitidos.
2. Pulsar #cargo-nuevo (visible en todos los paneles). Completar: Cliente = QA-PAG E2E1, Concepto = QA-PAG cuota 1, Monto (centavos) = 15000, Emision = 2026-06-15, Vencimiento = 2026-07-15.
3. Pulsar Guardar. POST /api/charges responde 201.
4. En #recientes (tablero) aparece el cargo reci?n creado. Pulsar Ficha.
5. En #ficha-dialog: leer Concepto, Total $ 150,00, Cobrado $ 0,00, Saldo $ 150,00. El estado es Pendiente. #abono-form est? visible (saldo > 0).

**Esperado:** El flujo va de tablero ? crear cargo ? vuelve a tablero con el nuevo elemento ? abre ficha con saldos correctos. El formulario de devoluci?n **no existe** todav?a (se crea s?lo cuando pagadoCents > 0, l?nea pp.js:488+).

### 5.2 Recorrido 2: Registrar un abono completo y cerrar el cargo

**ID:** PAG-E2E-02 | **Tipo:** E2E | **Prioridad:** P0

**Precondici?n:** PAG-E2E-01 completado (cargo con saldo 15000).

**Pasos:**
1. Desde la ficha abierta, dejar #abono-monto = 15000, Metodo = Efectivo, Referencia vac?a, Fecha vac?a. Pulsar Registrar abono.
2. POST /api/charges/<id>/abonos responde 201 con saldoCents: 0, status: "paid".
3. La ficha se repinta: Cobrado $ 150,00, Saldo $ 0,00, etiqueta Pagado. #abono-form pasa a hidden (pp.js:470) y #ficha-cancelar-cargo tambi?n queda oculto.
4. Cerrar la ficha con #ficha-cerrar. Ir a ?panel=cobros, filtrar Pagado: aparece el cargo con saldo $ 0,00 en verde (ui-etiqueta--ok).

**Esperado:** El estado se recalcula desde el saldo (no elegido). Al llegar a saldoCents <= 0, el formulario de abonos desaparece. No hay forma de seguir cobrando desde la UI.

### 5.3 Recorrido 3: Cargo parcial con dos abonos y devoluci?n (luego de cobrar)

**ID:** PAG-E2E-03 | **Tipo:** E2E | **Prioridad:** P0

**Precondici?n:** Cargo nuevo QA-PAG E2E3, total 50000, saldo 50000.

**Pasos:**
1. Abrir ficha. Registrar abono 20000 (Transferencia, referencia QA-PAG T1). Estado pasa a Parcial, saldo 30000, #abono-form sigue visible.
2. Registrar segundo abono 30000. Estado pasa a Pagado, saldo  , #abono-form se oculta.
3. Reabrir la ficha (o recargarla). Como pagadoCents > 0, el formulario de devoluci?n (#devolucion-form) **se crea en JS** (pp.js:488-571) y la secci?n de devoluciones se muestra (hidden = ficha.refunds.length === 0 pasa a alse cuando hay devoluciones, pero al crear por primera vez no hay devoluciones: el formulario aparece siempre que haya cobrado mientras no est? cancelado). Leer: debajo de Abonos aparece Devoluciones con su formulario Devolver plata.
4. **Importante (no alcanzable desde UI para el primer abono en la forma esperada):** La particularidad documentada es que el formulario de devoluci?n existe s?lo cuando pagadoCents > 0, pero para registrar la **primera devoluci?n** no hay barrera desde UI; sin embargo, el caso del primer abono inalcanzable desde UI corresponde a otro escenario (ver PAG-ABO-10 en riesgos). Para este recorrido E2E, registrar una devoluci?n parcial: Monto (centavos) 10000, Motivo QA-PAG devolucion parcial, M?todo Efectivo, Comprobante vac?o. Pulsar Registrar devolucion.
5. POST /api/charges/<id>/devoluciones responde 201 con pagadoCents: 40000, saldoCents: 10000. La ficha se repinta: Cobrado $ 400,00, Devuelto aparece en el dl (devueltoCents > 0), Saldo $ 100,00. El estado vuelve a Parcial. La lista de devoluciones muestra la fila con motivo, m?todo, etiqueta de fecha y $ 100,00 en rojo (malo). El formulario de devoluci?n sigue visible (hay cobrado restante).

**Esperado:** La devoluci?n revierte parte del cobrado: el saldo aumenta nuevamente y el estado se recalcula. La secci?n de devoluciones aparece s?lo cuando hay devoluciones o cuando hay cobrado (el formulario se arma si hay plata cobrada). El orden y etiquetas de devoluciones coinciden con pp.js:430-461.

### 5.4 Recorrido 4: Llegar al reporte de antig?edad de cartera

**ID:** PAG-E2E-04 | **Tipo:** E2E | **Prioridad:** P0

**Precondici?n:** Conjunto de la secci?n 2 sembrado, hoy = 2026-06-15, zona America/Santiago.

**Pasos:**
1. Ir a /?panel=reporte (clave eporte, r?tulo Antiguedad).
2. En Network: observar dos GET /api/reporte en la primera carga (con query vac?o). Esperar a que cargue la tabla #reporte-tabla.
3. Leer los totales: #reporte-total-cargos y #reporte-total-pendiente. Comparar con 	otalCargos: 5, 	otalPendienteCents: 230055 (sin filtros de fecha).
4. Usar los filtros #reporte-desde, #reporte-hasta, #reporte-ref. Poner hasta = 2026-06-15 (sin desde). Pulsar Aplicar o esperar el submit del formulario #reporte-filtrar.
5. Leer los tramos  -30, 31-60, 61-90, mas-90: con eferencia = 2026-06-15, deben coincidir con la tabla de la secci?n 2:  -30 tiene 3 cargos por $ 1.700,55, mas-90 tiene 2 por $ 600,00.
6. Cambiar eferencia a otro d?a y verificar que los d?as de vencimiento se recalculan respecto a esa fecha.

**Esperado:** El reporte pide /api/reporte al entrar y con cada cambio de filtros. Los cargos sin issued_date no entran cuando hay rango con 	o (cargo 6 cae con 	o=2026-06-15), lo que queda reflejado en 	otalCargos. Los tramos se calculan con la referencia indicada.

### 5.5 Recorrido 5: El caso particular del primer abono (alcance documentado)

**ID:** PAG-E2E-05 | **Tipo:** E2E | **Prioridad:** P0

**Precondici?n:** Cargo QA-PAG SinAbonoUI creado con saldo > 0. Ficha abierta, sin abonos todav?a.

**Pasos:**
1. Observar #abono-form visible (hay saldo). Registrar un abono de todo el saldo: funciona desde UI (PAG-E2E-02).
2. Crear otro cargo nuevo QA-PAG DevSoloAPI, con saldo 30000. **No registrar abono desde UI**.
3. Desde DevTools/Consola (o curl con sesi?n), hacer POST /api/charges/<id>/abonos con {"amountCents": 30000, "method": "cash"} para dejarlo pagado.
4. Abrir la ficha de ese cargo. Ver que #abono-form est? oculto (saldoCents <= 0), y que #devolucion-form existe (hay cobrado). Intentar registrar una devoluci?n desde UI: funciona.

**Esperado (documentado):** El enunciado pide documentar que el "primer abono no se puede hacer desde la interfaz" en un escenario concreto. La lectura del c?digo muestra que #devolucion-form se crea en JS (pp.js:488+) y la secci?n de abonos est? oculta mientras la lista est? vac?a **no es el caso**: la secci?n de abonos siempre se pinta (lista vac?a muestra nada o s?lo el t?tulo), pero #abono-form se oculta cuando cancelado || ficha.saldoCents <= 0 (pp.js:470). La **particularidad** relevante aqu? es otra: la secci?n de devoluciones y su formulario se generan din?micamente cuando hay plata cobrada (ormDevolucion se llama en brirFicha y se a?ade a seccionDevoluciones), mientras que #abono-form vive en el HTML fijo. El "recorrido que s? existe" para el caso planteado es **empezar registrando el pago por API** (o dejando el cargo con cobrado) para que la UI muestre el formulario de devoluci?n. Este E2E documenta ese camino alternativo.

---

## 6. Regresi?n compartida

Casos que dependen del shell com?n (migo.js, migo-ui.js, crudRouter, sesi?n/SSO, contrato de lista { items, total, limit, offset }, data-panel). Paneles de Pagos: [data-panel="tablero"], [data-panel="cobros"], [data-panel="reporte"], [data-panel="ajustes"]. **No existen** ids panel-*.

| ID | ?rea | Tipo/Prioridad | Precondici?n | Pasos | Esperado | Referencia a riesgo transversal |
|---|---|---|---|---|---|---|
| PAG-REG-01 | Shell (data-panel) | REG/P0 | Sesi?n activa | 1. Abrir /?panel=cobros ? contar document.querySelectorAll('[data-panel]') y document.querySelectorAll('[id^="panel-"]'). 2. Cambiar entre los 4 tabs. 3. Ir a /?panel=noexiste. | 4 paneles con atributo data-panel, **0** con id^="panel-". Al cambiar pesta?a solo cambia visibilidad con hidden (sin recargar). Clave inv?lida cae al primer panel (	ablero). | R-05 (convenciones de paneles) |
| PAG-REG-02 | Navegaci?n deep-link + history | REG/P0 | Sesi?n activa | 1. Pulsar cada tab de #tabs (data-tab). 2. Atr?s/Adelante. 3. Recargar con cada ?panel= v?lido. | URL cambia a ?panel=<clave> sin recargar. popstate repinta. Solo 1 tab con ria-current="page". | Transversal (amigo.js) |
| PAG-REG-03 | AMIGO_UI.api + sesi?n 401 | REG/P0 | Inc?gnito, sin sesi?n | 1. etch('/api/charges?limit=1') desde consola. 2. Abrir / en inc?gnito. | Respuesta 401 {"error":"sin-sesion","loginUrl":"..."}. Al abrir /, redirecci?n al login del Core (flujo correcto). pp.js no se sirve sin sesi?n. | Convenci?n 5.1-5.3 |
| PAG-REG-04 | L?mite de tasa 600/15m | REG/P1 | Sesi?n activa | 1. Hacer 20 peticiones GET /api/charges?limit=1 en r?faga (desde consola). 2. Anotar c?digos. | Puede aparecer 429 si ya hubo consumo previo. No es defecto: anotar en registro. | Convenci?n 5.4 (R-11 si se confunde con error) |
| PAG-REG-05 | Contrato de lista {items,total,limit,offset} | REG/P0 | Conjunto de la secci?n 2 | 1. GET /api/charges?limit=3. 2. GET /api/charges?limit=3&offset=3. 3. GET /api/charges?limit=9999. | Respuestas cumplen contrato: items array, 	otal num?rico independiente del offset, limit aplicado con tope (1000). Orden descendente por folio en lista por defecto (crudRouter + orden aplicado). | R-13 (paginaci?n truncada en UI) |
| PAG-REG-06 | crudRouter tapado (POST/PATCH/DELETE) | REG/P0 | Sesi?n member/dmin | 1. Comparar POST /api/charges (propio) vs comportamiento esperado del crudRouter. 2. DELETE /api/charges/<id> devuelve {charge, deleted:true} (propio). | Rutas propias ganan (registradas antes). Solo GETs del crudRouter quedan vivos. Diferencia de envoltorio observable. | R-08 (strict vs no-strict) |
| PAG-REG-07 | Aislamiento org + SSO | REG/P0 | 2 orgs activas | 1. Crear datos en org A. 2. Consultar en org B. | Resultados aislados por organization_id. organizationId del cuerpo nunca se acepta para cambiar org. | Transversal (auth) |
| PAG-REG-08 | AMIGO.montar + alEntrar (doble petici?n) | REG/P1 | Sesi?n activa | 1. Network con /?panel=tablero: contar /api/dashboard. 2. Cambiar a eporte: contar /api/reporte. | Primera carga del panel solicita dos veces (montar pinta antes de cargar().then(repintar)). Al cambiar tab, una por entrada. Comportamiento conocido del shell+producto. | R-02, R-06 (parpadeo) |
| PAG-REG-09 | data-amigo y t?tulo del canal | REG/P1 | Sesi?n activa | 1. Leer h1[data-amigo="titulo"]. 2. Leer texto del tab eporte. | T?tulo toma texto de pesta?a activa; tab eporte se llama Antiguedad (sin tilde) en HTML (index.html:40). | Consistencia UI |
| PAG-REG-10 | Avisos reutilizables (#aviso) | REG/P1 | Sesi?n activa | 1. Provocar 409 (folio duplicado). 2. Crear cargo exitoso. 3. Provocar 400. | Verde para ?xito, rojo para error. Se oculta a los 5000ms. Mensaje del servidor se muestra tal cual (incluye texto espec?fico). | Transversal (amigo-ui.js) |

---

## 7. Riesgo conocido

Riesgos **propios** de Pagos. Los del shell com?n ya est?n en 10-regresion-compartida.md, no se duplican. Cada uno con: ID, t?tulo, en qu? consiste, c?mo se comprueba, y si est? **confirmado por lectura del c?digo** o **sospechado**.

| ID | T?tulo | En qu? consiste | C?mo se comprueba | Estado (confirmado/sospechado) |
|---|---|---|---|---|
| R-01 | Inversi?n de par?metros en AMIGO_UI.kpis (tablero) | AMIGO_UI.kpis espera [rotulo, cifra, acento] (migo-ui.js:245-250) pero Pagos pasa [monto(...), 'Cobrado este mes', true] etc (array invertido). El n?mero grande mostrar?a el r?tulo y el texto chico el importe. | PAG-TAB-03: leer las 7 tarjetas y ver qu? elemento lleva la clase ui-kpi__cifra--acento y qu? es el n?mero grande. | **Sospechado** (contradice lectura directa del c?digo compartido; requiere verificaci?n visual en Chrome). |
| R-02 | Doble petici?n en primer render del tablero | montar llama lEntrar (epintar con estado vac?o) y despu?s cargar().then(repintar), por eso /api/dashboard aparece **2 veces** al cargar ?panel=tablero. | PAG-NAV-01, PAG-REG-08: contar peticiones a /api/dashboard en Network con carga lenta. | **Confirmado por lectura del c?digo** (pp.js:717-725, cargar() llama a 4 endpoints y luego epintar()). |
| R-03 | Primer abono inalcanzable desde UI / formulario de devoluci?n din?mico | #devolucion-form se crea en JS (pp.js:488+) y se a?ade s?lo cuando hay plata cobrada. La secci?n de abonos est? siempre pintada; lo que oculta acciones es #abono-form.hidden = cancelado || ficha.saldoCents <= 0. Documentado en E2E-05: para mostrar devoluciones con cargo ya cobrado por API, el camino es ese. No es un bug, es una elecci?n de UX (evitar botones que siempre fallan). | PAG-E2E-05, revisar pp.js:419-477, 488-571. | **Confirmado por lectura del c?digo**. |
| R-04 | Corte de mes por zona horaria (UTC vs America/Santiago) | mesEnCurso usa medianoche local de la zona (outes.ts:308-317) para decidir si un eceived_at cae en el mes. La UI env?a eceivedAt como AAAA-MM-DDT00:00:00.000Z cuando se elige fecha (pp.js:606), por lo que un abono puesto como d?a 1 a las 00:00Z puede caer en el mes anterior en Santiago. | PAG-TAB-07: probar con fechas cruzando UTC/Santiago. | **Confirmado por lectura del c?digo** (dependencia de zona horaria). |
| R-05 | Paneles por atributo, sin ids panel-* (regresi?n de convenci?n) | Pagos usa [data-panel] exclusivamente. Cualquier c?digo que busque #panel-* fallar?a. Ya est? corregido en el c?digo; se documenta para evitar regresiones. | PAG-NAV-01, PAG-REG-01: contar elementos con id^="panel-" = 0. | **Confirmado por lectura del c?digo** (index.html:73,85,108,136). |
| R-06 | Parpadeo del mensaje "vac?o" en Cobros | Al cambiar a ?panel=cobros con carga lenta, #cobros-lista muestra brevemente No hay cargos que coincidan antes de que lleguen los datos (se pinta con estado inicial vac?o y luego se repinta con datos). | PAG-NAV-02: observar con Network throttling Slow 3G. | **Sospechado** (comportamiento observable; depende de timing). |
| R-07 | Asimetr?a filtro vencido vs KPI Vencido | Tablero muestra encidoCents (cargos con dueDate pasado respecto a hoy). El filtro de lista tiene 5 opciones (Todos, Pendiente, Parcial, Pagado, Cancelado) y **no existe** filtro por "Vencido". No hay forma de filtrar solo los vencidos desde la UI. | PAG-TAB-05: comparar tarjeta Vencido con opciones de #cargo-filtro. | **Confirmado por lectura del c?digo** (pp.js:161-167 define filtro por status; no hay rama para vencido). |
| R-08 | Diferencia strict() entre rutas propias y crudRouter | cargoSchema de rutas propias **no es strict()** (campos extra se descartan en silencio), mientras que parseCuerpo del crudRouter rechaza campos desconocidos con Campo desconocido: .... Esto crea comportamiento distinto seg?n la ruta (y aqu? POST/PATCH/DELETE propios ganan). | PAG-ALTA-08, PAG-API-07 (paso 2): enviar mountCents2 y comprobar si se rechaza o se ignora. | **Confirmado por lectura del c?digo** (outes.ts usa Zod sin .strict() en esquemas de cargo propios; crud.ts s? lo aplica). |
| R-09 | Cobertura UI incompleta (datos sin pintar) | GET /api/dashboard devuelve 	otal y devueltoMesCents, pero la UI no los pinta en ninguna tarjeta (s?lo 7 de 9). devueltoMesCents est? separado intencionalmente en API, pero no tiene lectura visible. | PAG-TAB-06: enumerar claves de API vs tarjetas pintadas. | **Confirmado por lectura del c?digo** (pp.js:111-119 pinta 7 KPIs; no usa 	otal ni devueltoMesCents). |
| R-10 | B?squeda sin normalizaci?n de acentos/Unicode | B?squeda compara 	oLowerCase() sin ormalize('NFD'), y s?lo busca en 4 campos (folio, concepto, cliente, correo), **no** en otes. No encuentra folio con ceros a izquierda ( 4 vs 4). | PAG-COB-04, PAG-COB-05: probar NOTA CON ACENTOS, Ñ,  4, b?squeda por otes. | **Confirmado por lectura del c?digo** (pp.js:161-167: usa .toLowerCase().includes() sin normalizar; campos buscables limitados). |
| R-11 | L?mite de 500 cargos en UI sin paginaci?n/aviso | UI pide limit=500 (cargar() ? /api/charges?limit=500) y filtra en navegador. Con >500 cargos la lista queda **truncada sin aviso** al usuario. | PAG-COB-10: verificar petici?n y ausencia de controles de paginaci?n. | **Confirmado por lectura del c?digo** (pp.js:640: GET('/api/charges?limit=500'), no hay offset/paginaci?n). |
| R-12 | Comentario potencialmente incorrecto sobre b?squeda con ceros a izquierda (folio INTEGER) | En API, buscar ?q=0042 sobre columna INTEGER con LIKE '%0042%' comparado contra valor num?rico: SQLite convierte n?mero a texto en ciertos casos, pero el comportamiento esperado documentado necesita verificaci?n. Si devuelve 0 cuando existe folio 42, el comentario est? equivocado. | PAG-API-03 paso 2: probar GET /api/charges?q=0042 con folio 42 existente. | **Sospechado** (requiere verificaci?n contra outes.ts:1276-1278 en ejecuci?n). |
| R-13 | Gasto de presupuesto de peticiones al recargar tras acciones | Cada ecargar() repite las 4 peticiones de cargar() (charges, settings, saldos, me) **m?s** la del panel activo. Crear/editar/borrar/registrar abono dispara ecargar() y puede consumir r?pidamente el l?mite 600/15min. | PAG-COB-10 paso 3: contar peticiones tras cada acci?n. | **Confirmado por lectura del c?digo** (ecargar() definido en pp.js:636-648, llamado tras mutaciones). |

---

## 8. Checklist visual

Lista concreta de lo que hay que mirar en pantalla.

| ?tem | Viewport | C?mo se comprueba | Resultado (OK/NO) | Nota |
|---|---|---|---|---|
| **Canal lateral y tabs** | 390×844 | 4 tabs (Tablero, Cobros, Reporte = Antiguedad, Ajustes). Cada uno clicable. Solo 1 con ria-current="page". | | |
| **Paneles por atributo** | Cualquiera | document.querySelectorAll('[data-panel]').length === 4, document.querySelectorAll('[id^="panel-"]').length === 0. | | |
| **Tablero KPIs** | 1280×800 | 7 tarjetas en #resumen. Orden y lectura: verificar si cifras/r?tulos aparecen invertidos (R-01). #recientes muestra 5 ?ltimos o mensaje vac?o. | | |
| **Cobros - tabla** | 1280×800 | 9 columnas (Folio, Cliente, Concepto, Emitido, Vence, Total, Saldo, Estado, acciones). Cliente con correo debajo del nombre. Total/Saldo alineados a derecha. Sin scroll horizontal innecesario. | | |
| **Cobros - filtros/b?squeda** | 1280×800 | #cargo-filtro con 5 opciones. B?squeda case-insensitive. Filtro+b?squeda combinados. Fila vac?a con colspan: 9. | | |
| **Di?logo Nuevo cargo** | 390×844 | #cargo-dialog modal. Campos obligatorios: cliente, concepto, monto. Vista previa #cargo-monto-vista actualiza en input. Botones Proponer, Cancelar, × cierran sin enviar. | | |
| **Ficha de cargo** | 390×844 | T?tulo <folio> · <cliente>. DL con Concepto, Total, Cobrado, Saldo (+ Devuelto si > 0). Lista Abonos (DESC por fecha). Lista Devoluciones (si existe). | | |
| **Abono - formulario** | 390×844 | #abono-form aparece s?lo con saldo>0 y no cancelado. Precarga monto = saldo. M?todo por defecto. Vista previa de monto. Al llegar a saldo 0, formulario desaparece. | | |
| **Devoluci?n - formulario din?mico** | 390×844 | Aparece cuando pagadoCents>0 (creado en JS). Monto por defecto = todo lo cobrado. Motivo obligatorio. Campos m?todo/referencia/fecha. | | |
| **Reporte Antig?edad** | 1280×800 | #reporte-filtrar con desde/hasta/referencia. Tabla de tramos 0-30/31-60/61-90/mas-90. Totales #reporte-total-cargos y #reporte-total-pendiente. | | |
| **Ajustes** | 1280×800 | #config-form con moneda y zona. Valores actuales desde API. Guardar muestra aviso verde. | | |
| **Responsive m?vil** | 390×844 | Formularios no se salen (ning?n scrollWidth > 390). Botones legibles. Di?logos centrados. Sin desborde horizontal. | | |
| **Consola limpia** | Cualquiera | Panel Console, filtro error: **sin errores** durante carga, navegaci?n, abrir/cerrar di?logos, env?os exitosos y fallidos (409/400). | | |
| **Network - comportamiento esperado** | Cualquiera | Tablero: 2 /api/dashboard en primera carga (conocido). Cobros pide limit=500 una vez. Cambios de filtro/b?squeda **no** generan peticiones. Cada mutaci?n dispara ecargar() (contar peticiones). | | |
| **Accesibilidad b?sica** | Cualquiera | Botones con texto visible. Di?logos con ria-label en cierres (×). ria-current="page" en tab activo. Inputs con <label> asociado. | | |

---

## 9. Registro

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados. Transversal: Doc 10 §9.

| ID | Resultado (PASA/FALLA/BLOQUEADO) | Evidencia | Nota |
|---|---|---|---|
| PAG-NAV-01 | PARCIAL | Arranque visto: `/api/inicio`, `/api/dashboard`, `/api/charges?limit=500`, `/api/settings`, `/api/charges/saldos`, `/api/me` — todas 200. En consola: 4 `[data-panel]`, 0 `id^="panel-"` | El doble `GET /api/dashboard` documentado (alEntrar + cargar) no se confirmó al milisegundo; se vio `dashboard` en el arranque. Datos de la sección 2 no existen en prod. |
| PAG-NAV-02 | PARCIAL | Clic en pestañas → 0 peticiones; paneles con datos (prefetch `charges`+`dashboard`+`saldos`) | h1/aria-current/panel ✅. |
| PAG-API-01 | PARCIAL | `GET /api/charges` → `{items,total,limit,offset}`; filas sin `paidCents` ni `saldoCents` | Orden descendente por folio no verificado con los 7 cargos seed; datos demo. |
| PAG-API-02 | BLOQUEADO | Requiere los 7 cargos de la sección 2 | No ejecutado. |
| PAG-API-03 | BLOQUEADO | Requiere cargos con folios 42/142 y notas | No ejecutado. |
| PAG-API-04 | PARCIAL | `limit=5000`→`1000` (mismo `crudRouter` que customers) | `limit=0`/`offset` de pagos no probados directamente; probados en customers. |
| PAG-SIST-01 | PASA | Sin sesión: `GET /health` y `POST /health` → `200 {"ok":true,"product":"pagos","name":"Pagos"}`; `GET /api/meta` → `200` con `name/product/version/identity` | |
| PAG-SIST-02 | FALLA | Sin sesión: `/api/charges` y `/api/dashboard` → `401 {"error":"sin-sesion","loginUrl"}` **sin campo `message`**; `/` → `302` al SSO; `/app.js` → `302` | El caso exige `message` en el 401. `/amigo.css` no probado aquí (200 público en 3 productos). |
| PAG-SIST-03 | PASA | `/api/me` → `200` con `user`/`organization`/`role`/`product`; `/api/inicio` → `usuario`/`organizacion`/`rol`/`herramienta`/`herramientas`; canal pinta empresa/correo/avatar/otras | La API trae `rol`; el shell no lo pinta (comportamiento descrito, R-05). |
| PAG-CRUD-01 | PARCIAL | `POST /api/charges` → `200 {charge}` (no 201 plano). `DELETE /api/charges/<id>` → hard delete (`deleted:true`; GET posterior → 404) | Contrato distinto a customers (`201` plano + borrado archivado). |
| PAG-CRUD-02 | FALLA | `PATCH /api/charges/<id>` con `totalCents`/`paidCents` → `200` y los campos **descartados**; `amountCents` bajo lo cobrado → `409` con mensaje de negocio | R-S-09: descarte silencioso inconsistente con customers (400 "Campo desconocido"). |
| REG-SES-07 | FALLA | Clic `Salir` → `302` `https://desarrollo.amgdeveloper.cl/api/logout?redirect=<producto>` → **`404 {"error":"No existe GET /api/logout"}`**; GET y POST no existen; sesión sigue viva | Core sin ruta de logout. Productos sin poder cerrar sesión. |
| REG-SES-08 | FALLA | Ráfaga de ~650 peticiones: `429` con `ratelimit:"600-in-15min"; r=0; t=335` y cuerpo plain text "Too many requests, please try again later."; 23×`503`; episodio transitorio: **todas las rutas API 404** hasta recargar (solo `/health` vivo) | Cuerpo del 429 no es JSON. Límite no uniforme: ventana previa mostró `"1000-in-15min"`. 503 y el episodio 404 no están en el plan. |

