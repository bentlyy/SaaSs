# Plan de pruebas — Espacios

Reserva de salones, canchas y salas por hora. El sujeto que se bloquea es el **espacio**,
no una persona: dos clientes pueden usar la misma franja en canchas distintas sin
interferirse, y lo que no puede pasar es que dos reservas se pidan en la misma cancha.

Este plan se **diseña**, no se ejecuta. Cada caso dice qué hacer y qué se espera, no qué se
observó. Las reglas de sesión, la anatomía del caso y el checklist visual están en
`00-CONVENCIONES.md`.

---

## 1. Ficha técnica

| Qué | Valor |
|---|---|
| Slug | `espacios` |
| Nombre | Espacios |
| Dominio | `espacios.amgdeveloper.cl` |
| Puerto de desarrollo | `3022` (`PORT=3022` en `products/espacios/.env.example`) |
| Puerto publicado detrás de nginx / Docker | `3101` (`README.md`, `ops/nginx.conf`, `docker-compose.yml`) |
| Script de desarrollo | `npm run dev:espacios` (raíz) → `npm run dev -w @amg/espacios` → `tsx watch src/index.ts` |
| Script de pruebas | `npm test -w @amg/espacios` (vitest, `products/espacios/tests/espacios.test.ts`) |
| Ruta local | `products/espacios` |
| Base de datos | `./data/espacios.sqlite` (`DB_PATH`), ignorada por git |
| Versión de esquema declarada | `DB_SCHEMA_VERSION=2` en `.env.example` |
| Core (identidad) | `CORE_URL=http://localhost:3108`, `APP_URL=http://localhost:3022` |
| Credenciales SSO | `AMG_SSO_CLIENT_ID=espacios`; el secreto lo entrega el Core con `npm run sso:secret -w @amg/platform -- espacios` |
| Acento del producto | `--acento: #1a7f5a` (`products/espacios/public/style.css`) |
| Logo en el canal | `ES` (`data-amigo="logo"`, `public/index.html`) |
| Casos de prueba | 70 casos agrupados por bloque (`AGENDA`, `RESV`, `DISP`, `HOR`, `BLOQ`, `API`, `AGAPI`, `CAT`, `AJUST`, `SIST`, `E2E`, `REG`) |

**Roles.** La identidad trae `member`, `admin` u `owner` (`packages/product-runtime/src/auth.ts:29`).
Espacios los usa así:

| Superficie | Rol mínimo |
|---|---|
| Lecturas (`/api/spaces`, `/api/customers`, `/api/addons`, agenda, disponibilidad, resumen) | cualquiera con sesión |
| Escrituras de catálogo (`POST`/`PATCH`/`DELETE` de espacios, clientes, extras) | `member` (por defecto de `crudRouter`, `crud.ts:173-175`) |
| Horarios y bloqueos (`POST`/`PATCH`/`DELETE`) | `member` explícito (`routes.ts:371, 401, 441, 492, 517`) |
| Reservas (`POST`/`PATCH`/`DELETE /api/bookings`) | **sin chequeo de rol** |
| Ajustes (`PUT /api/settings`) | **sin chequeo de rol** |

**Paneles.** `agenda`, `espacios`, `horarios`, `clientes`, `extras`, `ajustes`
(`AMIGO.montar({ paneles: [...] })`, `public/app.js:607-611`). El canal los declara en
`#tabs` con `data-tab="agenda|espacios|horarios|clientes|extras|ajustes"` y la sección activa
viaja en la URL como `?panel=<clave>`.

**Rutas de API, todas bajo el runtime compartido salvo `/health`, `/api/meta`, `/api/me`,
`/api/inicio`:**

| Ruta | Método | Rol | Respuesta |
|---|---|---|---|
| `/api/availability` | GET | — | `{ space, date, slotMinutes, slots: [{ startAt, endAt, totalCents }] }` |
| `/api/schedules` | GET, POST | POST: `member` | `{ items }` / `201` fila cruda |
| `/api/schedules/:id` | PATCH, DELETE | `member` | fila cruda / `{ ok: true, deleted: true }` |
| `/api/blocks` | GET, POST | POST: `member` | `{ items }` / `201` fila cruda |
| `/api/blocks/:id` | DELETE | `member` | `{ ok: true, deleted: true }` |
| `/api/agenda` | GET | — | `{ bookings: [...] }` (con `spaceName`, `customerName`) |
| `/api/resumen` | GET | — | `{ date, hoy, confirmadas, porConfirmar, futuras, ingresos }` |
| `/api/bookings` | GET | — | `{ bookings: [...] }` |
| `/api/bookings/:id` | GET, PATCH, DELETE | PATCH/DELETE: ninguno | `{ booking, addons, space, customer }` / `{ booking }` / `{ booking }` |
| `/api/settings` | GET, PUT | ninguno | `{ settings }` |
| `/api/customers` | CRUD `crudRouter` | escritura: `member` | `{ items, total, limit, offset }` y filas crudas |
| `/api/spaces` | CRUD `crudRouter` | escritura: `member` | ídem; `DELETE` archiva |
| `/api/addons` | CRUD `crudRouter` | escritura: `member` | ídem; `DELETE` borra |

**Nota sobre los ID.** La numeración conserva el borrador inicial: algunos ID se plegaron
en las secciones 7 y 8 porque su verificación ya estaba cubierta allí, para no repetir el mismo
resultado esperado dos veces. No es una pérdida de cobertura:

| ID plegado | Dónde quedó su verificación |
|---|---|
| `ESP-DISP-03` | `ESP-DISP-01` (parámetro `spaceId` obligatorio) |
| `ESP-DISP-09` | Riesgo `R-11` |
| `ESP-HOR-06` | `ESP-HOR-05` (validación de la franja) |
| `ESP-HOR-10` | `ESP-SIST-04` (404 por id inexistente) |
| `ESP-API-03`, `ESP-API-04` | `ESP-API-02` (solape) y `ESP-SIST-04` (aislamiento) |
| `ESP-AGAPI-04` | `ESP-AGAPI-02` (validación de fecha) |
| `ESP-CAT-07` | Riesgo `R-03` |
| `ESP-AJUST-04` | `ESP-AJUST-03` (rangos de la configuración) |
| `ESP-AGENDA-03`, `ESP-AGENDA-04` | `ESP-AGENDA-01` y checklist de la sección 8 |
| `ESP-AGENDA-09` | `ESP-REG-01` (pestaña agenda) |
| `ESP-SIST-06` | Riesgo `R-04` |
| `ESP-REG-05`, `ESP-REG-06` | Checklist de la sección 8 |
| `ESP-REG-08` | `ESP-SIST-05` (límite de peticiones) y checklist de la sección 8 |

---

## 2. Datos de prueba

**El producto no siembra nada.** `products/espacios/src/app.ts` no declara `seed`: los datos de
ejemplo pertenecen a una organización, y esa organización solo existe cuando hay una sesión
real. En una base recién creada la pantalla arranca vacía y hay que crear todo a mano.

**Base de trabajo.** Usar una organización de pruebas del Core propia de QA, para no ensuciar
datos reales. Todo lo que se cree debe llevar el sufijo `QA-espacios-<fecha>` en los campos de
texto (`Nombre`, `Motivo`, `Notas`, `Cliente`), según la convención 5.5.

**Catálogo mínimo para que los flujos tengan sentido.** Crear con la interfaz (secciones 4.7 y 4.1):

| Dato | Dónde | Valor sugerido |
|---|---|---|
| Espacio | `?panel=espacios` | `QA-espacios-2026 Cancha 1`, tipo `cancha`, aforo `10`, tarifa `30000` |
| Espacio libre | `?panel=espacios` | `QA-espacios-2026 Sala A`, tipo `sala`, aforo `20`, tarifa `45000` |
| Cliente | `?panel=clientes` | `QA-espacios-2026 Cliente`, teléfono `900000001`, correo `qa@example.com` |
| Extra | `?panel=extras` | `QA-espacios-2026 Instructor`, precio `15000` |
| Horario | `?panel=horarios` | Lunes a viernes `09:00`–`18:00`, activo |

**Fecha de trabajo.** Elegir un día de la semana que tenga el horario creado, o el
procedimiento `ESP-HOR-08` deja la lista en «Sin horario propio» y la disponibilidad cae a la
jornada general de Ajustes (`08:00`–`22:00` por defecto).

**Limpieza al terminar.** Archivar los espacios y clientes creados con el botón `Archivar`, y
borrar los extras y horarios que no se usen. Las reservas se pueden borrar con
`DELETE /api/bookings/:id`.

---

## 3. Precondiciones

1. El Core está arriba: `npm run dev:core` (puerto `3108`) y responde `GET /health` con
   `200 {"ok":true}`.
2. El producto está arriba: `npm run dev:espacios`. La primera línea del log dice
   `Espacios (espacios) en <appUrl> -> puerto <port>`; anotar ese puerto y esa URL, porque
   `.env` puede no coincidir con `.env.example` (ver `ESP-SIST-01`).
3. La organización de QA tiene la suscripción a `espacios` activa. Sin ella, el middleware
   responde `403` con `{ "error": "sin-acceso" }` (`packages/auth-client/src/middleware.ts:98`).
4. **No hay login local.** Este producto no pide usuario ni contraseña: la sesión vive en el
   Core. Se entra por `desarrollo.amgdeveloper.cl` (puerto `3108`) y el Core devuelve al
   producto. Que el producto redirija al login del Core es el flujo correcto, no un error de
   Auth (convención 5.3).
5. Tester tipea sus credenciales. Nunca se le piden ni se anotan (convención 5.2).
6. **La sesión dura 15 minutos.** Al expirar, cualquier `/api/*` responde
   `401 {"error":"sin-sesion","loginUrl":"..."}` y el navegador salta al login del Core. Volver
   a entrar y anotar el corte en la sección 9; no es un defecto del producto (convención 5.1).
7. **Límite de tasa: 600 peticiones / 15 min por IP** (`packages/product-runtime/src/app.ts:99-106`).
   Un `429` no es un defecto: se anota y se espera (convención 5.4). Los casos de la sección 6
   consumen presupuesto, así que conviene hacerlos una vez y reutilizar la sesión.
8. Cada caso que dependa de otro lo referencia por ID en **Precondición**.
9. Para los casos de API: DevTools abierto, pestaña **Network**, filtro de fetch/XHR activado,
   y `Copy as fetch` para reproducir una petición desde la consola.

---

## 4. Casos por módulo

### 4.1 Agenda — panel `agenda`

Selectores de esta sección: `#resumen` (las cuatro tarjetas KPI), `#agenda-espacio`,
`#agenda-fecha`, `#agenda-lista` (tabla «Reservas del día»), `#agenda-disponibles` (las
franjas libres) y el botón `#agenda-nueva` de la barra superior, cuyo texto es
**«Nueva reserva»**.

| | |
|---|---|
| **ID** | ESP-AGENDA-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, datos de prueba de la sección 2 creados, `#agenda-fecha` con la fecha de trabajo. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/` y esperar la carga.<br>2. Leer las cuatro tarjetas dentro de `#resumen`.<br>3. En Network, filtrar `/api/` en la primera carga. |
| **Esperado** | 4 tarjetas KPI con los rótulos, en orden: `Hoy` (o `Ese día` si `#agenda-fecha` no es hoy) = `resumen.hoy`; `Confirmadas` = `resumen.confirmadas` y con cifra acentuada; `Por confirmar` = `resumen.porConfirmar`; y la cuarta `Ingresos de hoy` (o `Ingresos del <día mes>`) = `dinero(resumen.ingresos)`. Network muestra 1 llamada a `/api/inicio`, 1 a `/api/spaces`, 1 a `/api/customers`, 1 a `/api/addons`, 1 a `/api/settings`, 1 a `/api/agenda?from=…&to=…`, 1 a `/api/resumen?date=YYYY-MM-DD` y 1 a `/api/availability?spaceId=…&date=YYYY-MM-DD` solo si hay espacio elegido. Todas `200`. |

| | |
|---|---|
| **ID** | ESP-AGENDA-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | ESP-AGENDA-01 ejecutado. |
| **Pasos** | 1. En `#agenda-espacio` elegir `QA-espacios-2026 Cancha 1`.<br>2. Volver a dejarlo en `Todos los espacios`.<br>3. Contar las peticiones a `/api/agenda` y `/api/availability` en Network. |
| **Esperado** | Al elegir espacio, `GET /api/agenda` incluye `&spaceId=<id>` y la tabla queda filtrada a ese espacio. Al volver a `Todos los espacios`, `spaceId` desaparece del query. `/api/availability` solo se pide cuando hay espacio: sin espacio, la petición no ocurre. |
| | |
|---|---|
| **ID** | ESP-AGENDA-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Fecha sin reservas en `#agenda-fecha`. |
| **Pasos** | 1. Leer la única fila de `#agenda-lista`. |
| **Esperado** | Una fila con el texto `Nada reservado para este día` y, debajo, `Toca una franja libre de abajo para abrir la primera reserva.` |

| | |
|---|---|
| **ID** | ESP-AGENDA-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una reserva `pending` y una `confirmed` en la fecha visible de `#agenda-fecha`. |
| **Pasos** | 1. En la fila `pending`, leer los botones de la última celda y anotar sus textos.<br>2. Pulsar el que avanza.<br>3. En Network, leer método, URL y cuerpo de la petición.<br>4. Repetir sobre la fila que quedó `confirmed`. |
| **Esperado** | La fila `pending` ofrece un botón `Confirmar` (el único de avance: `SIGUIENTE` solo mapea `pending→confirmed` y `confirmed→done`) y un botón `Cancelar`. Al pulsarlo: `PATCH /api/bookings/<id>` con cuerpo `{"status":"confirmed"}`, `200 {"booking":{…,"status":"confirmed"}}`, y la etiqueta de estado pasa a `Confirmada` con tono verde (`ui-etiqueta--ok`). En la fila que estaba `confirmed`, el botón de avance dice `Marcar hecha` y el `PATCH` lleva `{"status":"done"}`. |

| | |
|---|---|
| **ID** | ESP-AGENDA-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Una reserva `cancelled` y una `done` visibles en `#agenda-lista`. |
| **Pasos** | 1. Leer los botones de acción de esas dos filas. |
| **Esperado** | Ninguna de las dos tiene botón `Cancelar` ni botón de avance: la condición de `app.js:419` es `status !== 'cancelled' && status !== 'done'`, y `SIGUIENTE` no tiene entrada para esos dos estados. La celda de acciones queda vacía. |

| | |
|---|---|
| **ID** | ESP-AGENDA-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Espacio elegido en `#agenda-espacio`, con al menos una franja libre en `#agenda-disponibles`. |
| **Pasos** | 1. Anotar el texto de la primera franja (etiqueta `HH:MM · $importe`).<br>2. Pulsarla.<br>3. Leer `#reserva-dialog`: `#reserva-espacio`, `#reserva-inicio`, `#reserva-fin`, `#reserva-total`. |
| **Esperado** | Se abre el `<dialog>` `#reserva-dialog` con `showModal()`. `#reserva-espacio` queda con el espacio que se estaba mirando. `#reserva-inicio` y `#reserva-fin` quedan con `HH:MM` derivados de la franja, y `#reserva-total` con el importe de la misma. |
### 4.2 Diálogo de reserva — `#reserva-dialog`

| | |
|---|---|
| **ID** | ESP-RESV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#reserva-dialog` abierto con `#reserva-espacio` y el cliente de prueba elegidos. |
| **Pasos** | 1. Poner en `#reserva-inicio` y `#reserva-fin` una franja libre.<br>2. Escribir en `#reserva-notas` `QA-espacios-2026 nota`.<br>3. Pulsar el botón `Reservar`.<br>4. Leer Network y `#aviso`. |
| **Esperado** | `POST /api/bookings` `201` con cuerpo `{ "booking": { …, "status": "pending", "notes": "QA-espacios-2026 nota" } }`. El diálogo se cierra, `#aviso` muestra `Reserva creada`, y la fila aparece en `#agenda-lista`. El `customerId` enviado es el de `#reserva-cliente` o `null`. |

| | |
|---|---|
| **ID** | ESP-RESV-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#reserva-dialog` abierto con un espacio de tarifa `30000`. |
| **Pasos** | 1. Elegir el espacio en `#reserva-espacio` y leer `#reserva-total`.<br>2. Poner `#reserva-inicio` = `09:00` y `#reserva-fin` = `12:00`.<br>3. Leer `#reserva-total` otra vez. |
| **Esperado** | `#reserva-total` se recalcula en el evento `change`: pasa de `$0` a `$90.000` (3 horas × $30.000). El cálculo es una estimación de pantalla; el valor que vale es el `totalCents` que devuelve el servidor. |

| | |
|---|---|
| **ID** | ESP-RESV-03 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | `#reserva-dialog` abierto. |
| **Pasos** | 1. Cambiar `#reserva-extra` a `Sin extra` y luego a un extra con precio `15000`.<br>2. Leer `#reserva-total` en los tres momentos. |
| **Esperado** | Con `Sin extra`, el total es el de horas pelado. Al elegir el extra, se suman `15000` centavos, es decir `$150`. Un solo extra por reserva: `#reserva-extra` es un `<select>` simple, no un multiselección. |

| | |
|---|---|
| **ID** | ESP-RESV-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#reserva-dialog` abierto. |
| **Pasos** | 1. Dejar `#reserva-cliente` en la primera opción, `Sin cliente`.<br>2. Completar horas y pulsar `Reservar`.<br>3. En Network, leer el `customerId` del cuerpo. |
| **Esperado** | El cuerpo lleva `"customerId": null`. La fila resultante en `#agenda-lista` muestra `Sin cliente` en la columna Cliente (de `customerName ?? 'Sin cliente'`). |

| | |
|---|---|
| **ID** | ESP-RESV-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#reserva-dialog` abierto. |
| **Pasos** | 1. Dejar `#reserva-espacio` sin elegir (la opción es `Elige un espacio`).<br>2. Pulsar `Reservar`. |
| **Esperado** | El navegador bloquea el envío por `required` en `#reserva-espacio` y enfoca el select. No hay petición en Network. Lo mismo con `#reserva-inicio` o `#reserva-fin` vacíos. |

| | |
|---|---|
| **ID** | ESP-RESV-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#reserva-dialog` abierto con datos escritos. |
| **Pasos** | 1. Pulsar `#reserva-cancelar` («Cancelar»).<br>2. Repetir con `#reserva-cerrar` (la `×`, `aria-label="Cerrar"`).<br>3. Contar las peticiones `POST /api/bookings` en Network. |
| **Esperado** | El diálogo se cierra en ambos casos y no sale ninguna `POST`. Los valores escritos se pierden; al reabrir con `#agenda-nueva` el formulario está limpio. |

### 4.3 Disponibilidad — `GET /api/availability`

Se llama «sin UI» salvo por las franjas de `#agenda-disponibles`, que son su consumidor. Es
una ruta de API: se prueba desde la consola con `fetch` o desde Network con «Copy as fetch».

| | |
|---|---|
| **ID** | ESP-DISP-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | ID del espacio Cancha 1 de la sección 2. |
| **Pasos** | 1. En la consola: `await (await fetch('/api/availability?spaceId=<id>&date=2026-06-15')).json()`.<br>2. Enumerar las claves del objeto y las de `slots[0]`. |
| **Esperado** | `200`. Cuerpo con exactamente estas claves: `space` (la fila completa del espacio), `date` (ISO), `slotMinutes` (número, por defecto el `slotMinutes` de Ajustes) y `slots`, un arreglo de `{ startAt, endAt, totalCents }`. Con la jornada por defecto son 14 franjas de 60 min (`08:00`–`22:00`). |

| | |
|---|---|
| **ID** | ESP-DISP-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `fetch('/api/availability?spaceId=noexiste&date=2026-06-15')`. |
| **Esperado** | `404` con cuerpo `{"error":"Ese espacio no existe"}`. El mensaje es indistinguible del de un espacio de otra organización: esa es la decisión de diseño. |
| | |
|---|---|
| **ID** | ESP-DISP-04 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `fetch('/api/availability?spaceId=<id>&date=2026-06-15&step=10')`.<br>2. Repetir con `&step=481`. |
| **Esperado** | Ambos `400` con `Datos inválidos`. El rango admitido es entero de 15 a 480. Con `step=15` el mismo espacio devuelve 56 franjas de 15 min. |

| | |
|---|---|
| **ID** | ESP-DISP-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Espacio con tarifa `30000`. |
| **Pasos** | 1. `fetch('/api/availability?spaceId=<id>&date=2026-06-15&step=90')`.<br>2. Leer `totalCents` de cada elemento de `slots`. |
| **Esperado** | Todas las franjas traen `totalCents: 450000`, es decir `30000 × 90/60 = 45000` centavos por hora por 1,5 h. `slotMinutes` del cuerpo es `90`. |

| | |
|---|---|
| **ID** | ESP-DISP-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Una reserva confirmada que tape de 10:00 a 12:00 UTC en el espacio. |
| **Pasos** | 1. `fetch('/api/availability?spaceId=<id>&date=<día de esa reserva>')`.<br>2. Comparar `slots` con la respuesta anterior a la reserva. |
| **Esperado** | Desaparecen las franjas que se pisan con 10:00–12:00. Las franjas que terminan exactamente a las 10:00 y que empiezan exactamente a las 12:00 **siguen apareciendo**: el solapamiento es semiabierto (`start_at < fin AND end_at > inicio`). Una reserva `cancelled` o `no_show` no cuenta como ocupada. |

| | |
|---|---|
| **ID** | ESP-DISP-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un bloqueo que tape de 14:00 a 16:00 UTC en el espacio. |
| **Pasos** | 1. `fetch('/api/availability?spaceId=<id>&date=<día del bloqueo>')`. |
| **Esperado** | Las franjas dentro del bloqueo desaparecen aunque el calendario semanal diga que se atiende. El bloqueo manda sobre el horario: una franja libre no se muestra si la toca un bloqueo. |

| | |
|---|---|
| **ID** | ESP-DISP-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un espacio **sin** filas en `availability`, y otro **con** filas para el mismo día de la semana. |
| **Pasos** | 1. `fetch('/api/availability?spaceId=<sin horarios>&date=<día de la semana de esos horarios>')`.<br>2. Repetir con el espacio que sí tiene horario propio. |
| **Esperado** | El primero devuelve franjas según la jornada general de Ajustes (por defecto `08:00`–`22:00`): un espacio sin agenda propia no desaparece de la disponibilidad. El segundo devuelve franjas solo dentro de su rango propio, por ejemplo `09:00`–`18:00`. |
| | |
|---|---|
| **ID** | ESP-DISP-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#cfg-anticipacion` = `120` (2 horas) en `?panel=ajustes`, guardado con `Guardar ajustes`. |
| **Pasos** | 1. Pedir `/api/availability?spaceId=<id>&date=<hoy>`.<br>2. Comparar la primera franja con la hora actual del reloj. |
| **Esperado** | Ninguna franja empieza antes de «ahora + 120 minutos»: la anticipación se aplica al calcular la disponibilidad, no al insertar, para no ofrecer una franja que el servidor va a rechazar. Al volver `#cfg-anticipacion` a `0`, las franjas cercanas vuelven a aparecer. |
### 4.4 Horarios semanales — panel `horarios`

Formularios: `#horario-form` (con `#horario-id` oculto, `#horario-dia`, `#horario-desde`,
`#horario-hasta`, `#horario-activo`, botones `Guardar` y `#horario-cancelar` «Cancelar») y
`#bloqueo-form`. Listas: `#horarios-lista` y `#bloqueos-lista`. `#horario-dia` se llena solo
con `Domingo`, `Lunes`, `Martes`, `Miércoles`, `Jueves`, `Viernes`, `Sábado` (0 = domingo).

| | |
|---|---|
| **ID** | ESP-HOR-01 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `fetch('/api/schedules')` sin `spaceId`.<br>2. Contar las filas y leer sus claves. |
| **Esperado** | `200` con `{"items":[…]}`: **todos** los horarios de la organización, no los de un espacio. Cada fila tiene `id` con prefijo `esphor`, `organizationId`, `spaceId`, `weekday` (0–6), `startTime` y `endTime` en minutos desde medianoche, `active`, `createdAt`. Orden ascendente por `weekday` y luego `startTime`. |

| | |
|---|---|
| **ID** | ESP-HOR-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#horario-espacio` con un espacio elegido y `#horario-dia` = `Lunes`. |
| **Pasos** | 1. Poner `#horario-desde` = `09:00` y `#horario-hasta` = `13:00`.<br>2. Dejar `#horario-activo` marcado.<br>3. Pulsar `Guardar`.<br>4. Leer `#aviso`, `#horarios-lista` y Network. |
| **Esperado** | `POST /api/schedules` `201` con la fila cruda (`weekday: 1`, `startTime: 540`, `endTime: 780`, `active: true`). `#aviso` muestra `Horario agregado`. Aparece una fila con `Lunes`, `09:00`, `13:00`, `Activo` y los botones `Desactivar`, `Editar`, `Borrar`. |

| | |
|---|---|
| **ID** | ESP-HOR-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `#horario-espacio` en su primera opción, `Elige un espacio`. |
| **Pasos** | 1. Completar `#horario-dia`, `#horario-desde` y `#horario-hasta`.<br>2. Pulsar `Guardar`. |
| **Esperado** | `#aviso` en rojo con `Elige un espacio` y no sale ninguna petición. El mismo guardia existe en `#bloqueo-form` (`Elige un espacio`) y bloquea el `POST /api/blocks`. |

| | |
|---|---|
| **ID** | ESP-HOR-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | El horario de lunes `09:00`–`13:00` de ESP-HOR-02 existe. |
| **Pasos** | 1. Crear en el mismo espacio y día un horario `12:00`–`16:00`.<br>2. Leer el aviso y Network.<br>3. Crear también `13:00`–`17:00`, exactamente pegado. |
| **Esperado** | El primero recibe `409` con `{"error":"Ese espacio ya tiene un horario que se pisa ese día"}`. El tercero, que empieza justo cuando termina el anterior, se acepta con `201`: el solapamiento es `start_time < endTime AND end_time > startTime`. Un horario por espacio y día que se contradigan es un error; dos rangos contiguos no. |

| | |
|---|---|
| **ID** | ESP-HOR-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Espacio elegido. |
| **Pasos** | 1. Poner `#horario-desde` = `14:00` y `#horario-hasta` = `14:00`.<br>2. Guardar.<br>3. Repetir con `#horario-hasta` = `10:00` (termina antes). |
| **Esperado** | Ambos `400` con `{"error":"Datos inválidos"}` y, en `errors.fieldErrors.endTime`, el texto `El horario tiene que terminar después de empezar`. |
| | |
|---|---|
| **ID** | ESP-HOR-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un horario activo visible en `#horarios-lista`. |
| **Pasos** | 1. Pulsar `Desactivar` en su fila.<br>2. Leer `#aviso`, Network y la columna `Estado`.<br>3. Pulsar `Activar` en la misma fila. |
| **Esperado** | `PATCH /api/schedules/<id>` con cuerpo `{"active": false}` y `200` con la fila actualizada. `#aviso` muestra `Horario desactivado` y la columna `Estado` pasa a `Inactivo`. Al repetir, el aviso es `Horario activado` y el botón vuelve a ser `Desactivar`. El id no se manda: el PATCH parte del horario existente, así que basta el flag. |

| | |
|---|---|
| **ID** | ESP-HOR-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un espacio **sin** filas en `availability`. |
| **Pasos** | 1. Elegirlo en `#horario-espacio`.<br>2. Leer `#horarios-lista` y `#bloqueos-lista`. |
| **Esperado** | `#horarios-lista` muestra la fila `Sin horario propio` y, en la columna Estado, `cae a la jornada general`. `#bloqueos-lista` muestra la fila `Sin bloqueos`. Ninguna de las dos dispara una petición de detalle: `cargarHorarios` pide las dos listas de una vez con `Promise.all`. |

| | |
|---|---|
| **ID** | ESP-HOR-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un horario visible en `#horarios-lista`. |
| **Pasos** | 1. Pulsar `Editar` en su fila.<br>2. Leer `#horario-form-titulo`, `#horario-dia`, `#horario-desde`, `#horario-hasta`, `#horario-activo` y si `#horario-cancelar` está visible.<br>3. Cambiar `#horario-hasta` y pulsar `Guardar`.<br>4. Pulsar `#horario-cancelar`. |
| **Esperado** | El título pasa a `Editar horario`, los cuatro campos quedan precargados y `#horario-cancelar` se hace visible. Al guardar sale `PATCH /api/schedules/<id>` con `200` y el aviso `Horario actualizado`; el título y el botón vuelven a su estado de creación (`Nuevo horario`, botón oculto). Es el mismo formulario para crear y editar; lo que lo distingue es `#horario-id`. |
### 4.5 Bloqueos puntuales — `#bloqueo-form`

| | |
|---|---|
| **ID** | ESP-BLOQ-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Espacio elegido en `#horario-espacio`. |
| **Pasos** | 1. Poner `#bloqueo-inicio` y `#bloqueo-fin` con un rango futuro dentro de la jornada.<br>2. Escribir `QA-espacios-2026 mantención` en `#bloqueo-motivo`.<br>3. Pulsar `Bloquear`.<br>4. Leer `#aviso`, `#bloqueos-lista` y Network. |
| **Esperado** | `POST /api/blocks` `201` con la fila cruda (id con prefijo `espblq`, `reason: "QA-espacios-2026 mantención"`). `#aviso` muestra `Espacio bloqueado`, el formulario se limpia y el bloqueo aparece en `#bloqueos-lista` con su `Empieza`, `Termina` y `Motivo`. `#bloqueo-motivo` es opcional: vacío se envía como `null`. |

| | |
|---|---|
| **ID** | ESP-BLOQ-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Espacio elegido. |
| **Pasos** | 1. Poner `#bloqueo-inicio` = `18:00` y `#bloqueo-fin` = `17:00`.<br>2. Pulsar `Bloquear`. |
| **Esperado** | `400` con `{"error":"Datos inválidos"}` y `errors.fieldErrors.endAt` = `El bloqueo tiene que terminar después de empezar`. Mismo texto que en reservas, con la palabra cambiada. |

| | |
|---|---|
| **ID** | ESP-BLOQ-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un bloqueo visible en `#bloqueos-lista`. |
| **Pasos** | 1. Pulsar `Quitar` en su fila.<br>2. Leer `#aviso` y Network. |
| **Esperado** | `DELETE /api/blocks/<id>` `200` con `{"ok":true,"deleted":true}`. `#aviso` muestra `Bloqueo quitado` y la fila desaparece. No hay diálogo de confirmación: quitar un bloqueo es reversible recreándolo, a diferencia de `Archivar` un espacio, que tampoco lo tiene. |

| | |
|---|---|
| **ID** | ESP-BLOQ-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | El bloqueo de ESP-BLOQ-01 vigente, y una franja libre visible en `#agenda-disponibles` que cae dentro de él. |
| **Pasos** | 1. Volver a `?panel=agenda`, elegir el espacio y **forzar** una reserva dentro del bloqueo: escribir en `#reserva-inicio` y `#reserva-fin` horas dentro del rango bloqueado.<br>2. Pulsar `Reservar`. |
| **Esperado** | `POST /api/bookings` responde `409` con un mensaje de la forma `<Espacio> está bloqueado de HH:MM a HH:MM UTC (QA-espacios-2026 mantención). No se puede reservar ese rato.` La UI lo muestra como `Ese horario ya no está libre: <mensaje>`. El bloqueo se comprueba dentro de la misma transacción que el insert, así que no hay ventana entre el chequeo y la escritura. |
### 4.6 Reservas — API

Las reservas **no** usan el `crudRouter`: validan solapamiento y calculan total, y eso no se
puede expresar declarando campos. Todas estas rutas aceptan cualquier rol con sesión.

Cuerpo válido mínimo para `POST /api/bookings`:

```json
{
  "spaceId": "espespacio_...",
  "customerId": null,
  "startAt": "2026-06-15T14:00:00.000Z",
  "endAt": "2026-06-15T15:00:00.000Z",
  "status": "pending",
  "notes": null,
  "addons": []
}
```

| | |
|---|---|
| **ID** | ESP-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Espacio de la sección 2, franja libre, dentro de la jornada y en el futuro. |
| **Pasos** | 1. `POST /api/bookings` con el cuerpo de ejemplo y `"addons": [{ "addonId": "<id extra>", "priceCents": 15000 }]`.<br>2. Enumerar las claves de `booking` y leer `totalCents`. |
| **Esperado** | `201` con `{"booking": {…}}`. La fila trae `id` con prefijo `esp`, `organizationId`, `spaceId`, `customerId`, `startAt`, `endAt`, `status`, `notes`, `totalCents`, `createdAt`. Para 1 hora a `30000` más un extra de `15000`, `totalCents` es `45000`. El total se materializa al escribir: es el valor congelado, no una fórmula que se recalcule al leer. |

| | |
|---|---|
| **ID** | ESP-API-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Reserva de ESP-API-01 vigente en el espacio. |
| **Pasos** | 1. `POST /api/bookings` en el **mismo** espacio solapándose por 30 minutos (`startAt` 15 min antes del inicio de la anterior). |
| **Esperado** | `409` con `{"error":"<Espacio> ya está reservado de HH:MM a HH:MM UTC. Las reservas no se pueden pisar."}`. No se escribe nada. El chequeo ocurre dentro de la transacción que inserta, no antes. |
| | |
|---|---|
| **ID** | ESP-API-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/bookings` con `"endAt"` anterior a `"startAt"`.<br>2. Repetir con `"endAt"` igual a `"startAt"`.<br>3. Repetir con `"startAt": "no-es-fecha"`. |
| **Esperado** | Los tres `400` con `Datos inválidos`. En los dos primeros, `errors.fieldErrors.endAt` = `La reserva tiene que terminar después de empezar`. En el tercero, `errors.fieldErrors.startAt` = `Fecha inválida`. |

| | |
|---|---|
| **ID** | ESP-API-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Ajustes con apertura `08:00` y cierre `22:00`, zona `America/Santiago`. |
| **Pasos** | 1. `POST /api/bookings` con inicio `03:00` y fin `04:00` UTC (que en Santiago son las 23:00 y 00:00 del día anterior).<br>2. Leer el mensaje exacto. |
| **Esperado** | `400` con un mensaje de la forma `<Espacio> se atiende de 08:00 a 22:00. La reserva pide de HH:MM a HH:MM.` La comparación se hace en **hora local de la organización**, con `localDe(instante, pref.timezone)`, no en UTC: por eso el mensaje trae las horas locales mientras el 409 de solapamiento trae horas UTC. Anotar la incoherencia de husos en los dos mensajes (sección 7, `R-05`). |

| | |
|---|---|
| **ID** | ESP-API-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Misma precondición que ESP-API-06. |
| **Pasos** | 1. `POST /api/bookings` con inicio `23:00` y fin `01:00` del día siguiente (UTC). |
| **Esperado** | `400` con `{"error":"La reserva no puede terminar el día siguiente."}`. Una franja que cruza la medianoche no cabe en una jornada que cierra antes de medianoche y no se podría facturar por horas. |

| | |
|---|---|
| **ID** | ESP-API-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#cfg-anticipacion` en `0`. |
| **Pasos** | 1. `POST /api/bookings` con un `startAt` en el pasado y dentro de la jornada.<br>2. Poner `#cfg-anticipacion` = `120`, guardar, y repetir con un `startAt` dentro de las próximas 2 horas. |
| **Esperado** | Con anticipación `0`: `400 {"error":"No se puede reservar una fecha que ya pasó."}`. Con anticipación `120`: `400 {"error":"Hay que reservar con al menos 120 minutos de anticipación."}`. La comprobación es solo al **crear**: editar una reserva ya pasada es lícito y es la forma de corregirle las notas a un turno de ayer. |

| | |
|---|---|
| **ID** | ESP-API-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Reserva de ESP-API-01. |
| **Pasos** | 1. `PATCH /api/bookings/<id>` con cuerpo `{"status": "done"}` y nada más.<br>2. Leer el `booking` devuelto completo. |
| **Esperado** | `200` con `{"booking":{…}}`. El PATCH parte de la reserva existente, así que `spaceId`, `customerId`, `startAt`, `endAt`, `notes` y `addons` se conservan sin volver a mandarlos. El `totalCents` se **recalcula** y se vuelve a materializar. Si el cambio de horario movió la franja, la validación de jornada y de solapamiento se repite. |

| | |
|---|---|
| **ID** | ESP-API-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un cliente de la organización A con id `espcliente_…`. |
| **Pasos** | 1. `POST /api/bookings` con `"customerId": "espcliente_noexiste"`.<br>2. Repetir con un id de cliente **de otra organización** (conseguido en `ESP-SIST-04`).<br>3. `POST /api/bookings` con `"addons": [{"addonId": "espextra_de_otra_org", "priceCents": 1}]`. |
| **Esperado** | 1 y 2 responden `400 {"error":"Ese cliente no existe"}`; 3 responde `400 {"error":"El extra espextra_de_otra_org no existe"}`. El extra se valida contra esta organización antes de sumar su precio: sin eso, un cliente colaría el id de un extra ajeno y vería su precio. Nota: un `spaceId` ajeno, en cambio, da `404 Ese espacio no existe` (ESP-DISP-02), no `400`. |

| | |
|---|---|
| **ID** | ESP-API-11 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Reserva de ESP-API-01. |
| **Pasos** | 1. `GET /api/bookings/<id>`.<br>2. Enumerar las cuatro claves del cuerpo.<br>3. `DELETE /api/bookings/<id>`. |
| **Esperado** | El GET responde `200 {"booking":{…},"addons":[…],"space":{…},"customer":{…}}`: la reserva, sus líneas de extra, el espacio y el cliente resueltos en una sola llamada. El DELETE responde `200 {"booking":{…}}` con la fila borrada, y un segundo GET da `404 {"error":"Esa reserva no existe"}`. **Sin interfaz**: no hay ningún botón que borre una reserva en `#agenda-lista`. |

| | |
|---|---|
| **ID** | ESP-API-12 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Al menos 3 reservas con estados y fechas distintos, y al menos un espacio archivado y un cliente archivado. |
| **Pasos** | 1. `GET /api/bookings` sin query.<br>2. `GET /api/bookings?spaceId=<id>&status=pending`.<br>3. `GET /api/bookings?from=<ISO>&to=<ISO>`.<br>4. `GET /api/bookings?limit=0` y luego `?limit=9999`. |
| **Esperado** | Todos `200` con `{"bookings":[…]}`. Orden descendente por `startAt`. `limit=0` cae al valor por defecto `100` y `limit=9999` se recorta a `500` (`Math.min(Math.max(Number(limit) \|\| 100, 1), 500)`). El filtro `to` es **inclusivo**: una reserva que empieza exactamente a medianoche del día `to` aparece en el rango que termina ese día y en el siguiente. Cancelar una reserva no la borra: sigue en el listado con `status: "cancelled"`. |
### 4.7 Agenda y resumen — `GET /api/agenda`, `GET /api/resumen`

| | |
|---|---|
| **ID** | ESP-AGAPI-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Al menos 2 reservas el mismo día, en dos espacios distintos, una con cliente y otra sin él. |
| **Pasos** | 1. `GET /api/agenda?from=<medianoche UTC del día>&to=<medianoche UTC del día siguiente>&spaceId=<id>`.<br>2. Enumerar las claves de `bookings[0]`. |
| **Esperado** | `200 {"bookings":[…]}`, orden ascendente por `startAt`, tope de 500 filas. Cada fila trae la reserva más dos campos resueltos: `spaceName` (o `null`) y `customerName` (o `null`). Los nombres se resuelven con un `IN` sobre la lista de ids, no con una consulta por reserva. La UI traduce `customerName ?? 'Sin cliente'` y `spaceName ?? '-'` al pintar. |

| | |
|---|---|
| **ID** | ESP-AGAPI-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/agenda?from=2026-06-16T00:00:00.000Z&to=2026-06-15T00:00:00.000Z`.<br>2. `GET /api/agenda?from=basura`. |
| **Esperado** | El primero `400 {"error":"El rango termina antes de empezar"}`. El segundo `400 {"error":"Datos inválidos"}` con `errors.fieldErrors.from` = `Fecha inválida`. Los dos `from` y `to` son opcionales: sin ellos, `from` es ahora y `to` es ahora + 24 h. |

| | |
|---|---|
| **ID** | ESP-AGAPI-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | En la fecha de trabajo: 1 reserva `pending`, 2 `confirmed`, 1 `cancelled` y 1 `done`. |
| **Pasos** | 1. `GET /api/resumen?date=<YYYY-MM-DD de esas reservas>`.<br>2. Comparar las seis claves con el conteo real. |
| **Esperado** | `200` con `{"date":"<YYYY-MM-DD>","hoy":5,"confirmadas":2,"porConfirmar":1,"futuras":N,"ingresos":X}`. `hoy` cuenta todas las del día. `porConfirmar` cuenta **las del día**, no las que hay desde ese día en adelante. `ingresos` suma `totalCents` de las del día **excluyendo las `cancelled`**: una reserva cancelada no es ingreso. `futuras` cuenta desde el inicio del día en adelante las que no están `cancelled` ni `no_show`, e incluye el propio día. La UI solo pinta cuatro de las seis: `hoy`, `confirmadas`, `porConfirmar` e `ingresos`. **`futuras` no tiene UI**: verificar su valor contra un conteo manual. |
### 4.8 Catálogo — `crudRouter` sobre espacios, clientes y extras

Los tres catálogos comparten la misma API genérica (`packages/product-runtime/src/crud.ts`).
La lista responde `{"items":[…],"total":N,"limit":L,"offset":O}` con `limit` por defecto 200,
tope 1000 y orden **descendente** por el `orderBy` declarado. El POST y el PATCH responden la
fila cruda, sin envoltorio.

| | |
|---|---|
| **ID** | ESP-CAT-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los 2 espacios y el cliente de la sección 2. |
| **Pasos** | 1. `GET /api/spaces`.<br>2. Enumerar las claves de la respuesta y de `items[0]`.<br>3. `GET /api/spaces?q=Cancha`. |
| **Esperado** | `200 {"items":[…],"total":2,"limit":200,"offset":0}`. Cada espacio trae `id` con prefijo `espespacio`, `organizationId`, `name`, `type`, `capacity`, `pricePerHourCents`, `color`, `active`, `archivedAt`, `createdAt`, `updatedAt`. Con `?q=Cancha` solo `total: 1`: la búsqueda cubre `name` y `type`. Clientes buscables: `name`, `email`, `phone`. Extras: solo `name`. |

| | |
|---|---|
| **ID** | ESP-CAT-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=espacios`. |
| **Pasos** | 1. Completar `#espacio-nombre` = `QA-espacios-2026 Cancha 2`, `#espacio-tipo` = `cancha`, `#espacio-aforo` = `12`, `#espacio-tarifa` = `36000`.<br>2. Pulsar `Guardar`.<br>3. Leer Network y la fila nueva en `#espacios-lista`. |
| **Esperado** | `POST /api/spaces` `201` con la fila cruda. `#aviso` muestra `Espacio creado`. La fila aparece con columnas `Nombre`, `Tipo`, `Aforo`, `Tarifa hora` y `Tarifa hora` se formatea con `dinero(pricePerHourCents)`, es decir **$360.00** a partir de `36000` centavos. **Ojo**: `#espacio-tarifa` pide el valor en **centavos** (36000 = $360), no en pesos, aunque la etiqueta diga «Tarifa por hora» sin indicarlo (ver sección 7, `R-08`). |

| | |
|---|---|
| **ID** | ESP-CAT-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un espacio existente. |
| **Pasos** | 1. Pulsar `Editar` en su fila.<br>2. Cambiar solo `#espacio-aforo`.<br>3. Pulsar `Guardar`.<br>4. Pulsar `#espacio-cancelar`. |
| **Esperado** | El título pasa a `Editar <nombre>`, `#espacio-nombre` recibe foco y `#espacio-cancelar` se hace visible. Guardar sale `PATCH /api/spaces/<id>` `200`, el aviso es `Espacio actualizado` y el formulario vuelve a `Nuevo espacio` con el botón oculto. Los campos que no se tocan conservan su valor porque el PATCH es parcial. Cancelar descarta los cambios sin enviar nada. |

| | |
|---|---|
| **ID** | ESP-CAT-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Un espacio de la sección 2 **sin** reservas que lo referencien. |
| **Pasos** | 1. Pulsar `Archivar` en su fila.<br>2. Leer Network, `#aviso` y la tabla.<br>3. `GET /api/spaces`. |
| **Esperado** | `DELETE /api/spaces/<id>` `200 {"ok":true,"archived":true}`: no borra, marca `archived_at`. El aviso es `Espacio "<nombre>" archivado`. El espacio desaparece de `#espacios-lista`, de `#agenda-espacio`, de `#horario-espacio` y de `#reserva-espacio`, y `GET /api/spaces` deja de devolverlo (`total` baja en 1). Nota: `DELETE /api/spaces/<id>` **no** devuelve la fila, a diferencia de `DELETE /api/bookings/<id>`. |

| | |
|---|---|
| **ID** | ESP-CAT-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=clientes`. |
| **Pasos** | 1. Completar `#cliente-nombre` = `QA-espacios-2026 Cliente 2`, `#cliente-telefono` = `900000002`, `#cliente-correo` = `qa2@example.com`.<br>2. Pulsar `Guardar`.<br>3. Repetir dejando `#cliente-telefono` y `#cliente-correo` vacíos.<br>4. Repetir con `#cliente-correo` = `no-es-correo`. |
| **Esperado** | 2: `POST /api/customers` `201`, aviso `Cliente creado`, la fila muestra nombre, teléfono y correo. 3: `201` también, con `"phone": null, "email": null`: la interfaz convierte vacío en `null` explícitamente. 4: `400 {"error":"Datos inválidos"}` con `errors.fieldErrors.email` = `Correo inválido`. El correo vacío (`""`) también se acepta: el schema es unión de email, cadena vacía y `null`. |

| | |
|---|---|
| **ID** | ESP-CAT-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=extras`. |
| **Pasos** | 1. Completar `#extra-nombre` = `QA-espacios-2026 Instructor`, `#extra-precio` = `15000`.<br>2. Pulsar `Guardar`.<br>3. Leer la fila en `#extras-lista`. |
| **Esperado** | `POST /api/addons` `201`, aviso `Extra creado`. La columna `Precio` muestra `dinero(priceCents)` = **$150.00** a partir de `15000` centavos. Igual que la tarifa, el input pide centavos aunque la etiqueta diga «Precio». **Sin interfaz**: la tabla de extras no tiene columna de acciones, así que `PATCH /api/addons/<id>` (cambiar precio, `durationMin`, `description`, `active`) y `DELETE /api/addons/<id>` solo se alcanzan por API. Un extra no tiene `archivedAt`: `DELETE` es borrado duro, a diferencia de espacios y clientes. |
| | |
|---|---|
| **ID** | ESP-CAT-08 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `POST /api/spaces` con `{"name":"X","capacity":0}`.<br>2. `POST /api/spaces` con `{"name":"X","pricePerHourCents":-1}`.<br>3. `POST /api/spaces` con `{"name":"   "}`.<br>4. `POST /api/spaces` con `{"name":"X","emial":"a@b.com"}`. |
| **Esperado** | 1 y 2: `400 Datos inválidos` (`capacity` mínimo 1, `pricePerHourCents` mínimo 0). 3: `400 Datos inválidos` — `name` exige `min(1)` después de `trim()`. 4: `400` con `{"error":"Campo desconocido: emial. Revisa el nombre; si esta bien escrito, no lo mandes."}` y `errors` con el `flatten()` del Zod: los schemas del `crudRouter` son `strict()`, así que una clave mal escrita se reporta en vez de descartarse en silencio. `createdAt`, `updatedAt` y `archivedAt` son de solo lectura y no se pueden escribir. |

### 4.9 Ajustes — `?panel=ajustes`, `#config-form`

Los seis campos se leen por `name`, no por `id`: `currency`, `timezone`, `openingMinutes`,
`closingMinutes`, `slotMinutes`, `minAdvanceMinutes`. `#cfg-apertura` y `#cfg-cierre` llevan
`data-horas`, lo que hace que la interfaz convierta `HH:MM` a minutos al enviar y a la inversa al
pintar.

| | |
|---|---|
| **ID** | ESP-AJUST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, base recién creada o sin fila en `settings`. |
| **Pasos** | 1. `GET /api/settings`.<br>2. Enumerar las claves de `settings`. |
| **Esperado** | `200 {"settings":{"currency":"$","timezone":"America/Santiago","openingMinutes":480,"closingMinutes":1320,"slotMinutes":60,"minAdvanceMinutes":0}}`. Son los valores por defecto del servidor, presentes aunque no haya fila guardada: `leerPreferencias` devuelve los defaults campo por campo. En `#config-form`, `#cfg-apertura` muestra `08:00` y `#cfg-cierre` `22:00` (480 y 1320 minutos). A diferencia de Solicitudes, aquí `GET /api/settings` **no** incluye `nextNumber`. |

| | |
|---|---|
| **ID** | ESP-AJUST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Poner `#cfg-moneda` = `CLP`, `#cfg-zona` = `America/Santiago`, `#cfg-apertura` = `09:00`, `#cfg-cierre` = `20:00`, `#cfg-franja` = `90`, `#cfg-anticipacion` = `30`.<br>2. Pulsar `Guardar ajustes`.<br>3. Leer Network, `#aviso`, las cuatro tarjetas de `#resumen` y una franja de `#agenda-disponibles`. |
| **Esperado** | `PUT /api/settings` `200 {"settings":{…}}` con `"openingMinutes": 540, "closingMinutes": 1200, "slotMinutes": 90, "minAdvanceMinutes": 30`. El aviso es `Ajustes guardados`. Después de guardar, `cargar()` y `pintarAgenda()` se vuelven a ejecutar: las franjas de `#agenda-disponibles` pasan a medir 90 minutos y las de menos de 30 minutos de anticipación desaparecen. Verificar que el total de las franjas se recalcula con `slotMinutes` (sección ESP-DISP-05). |

| | |
|---|---|
| **ID** | ESP-AJUST-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `?panel=ajustes`. |
| **Pasos** | 1. Poner `#cfg-zona` = `Chile/Continental` (no es IANA) y `#cfg-moneda` = `$`. Guardar.<br>2. Poner `#cfg-zona` = `America/Santiago` y `#cfg-franja` = `7`. Guardar.<br>3. Poner `#cfg-apertura` = `20:00` y `#cfg-cierre` = `09:00`. Guardar.<br>4. Restaurar los valores de ESP-AJUST-02. |
| **Esperado** | 1: `400 {"error":"Datos inválidos"}` con mensaje `No es una zona horaria válida (usá una como America/Santiago)`. Una zona inválida se rechaza al guardar, no después al formatear. 2: `400 Datos inválidos` — `slotMinutes` es entero de 15 a 480. 3: `400 Datos inválidos` con `errors.fieldErrors.closingMinutes` = `La jornada termina antes de empezar`. Restaurar: los tres leaves devuelven `200`. |
### 4.10 Sesión, arranque y límites

| | |
|---|---|
| **ID** | ESP-SIST-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Producto arriba. |
| **Pasos** | 1. Anotar la primera línea del log de arranque.<br>2. `curl -s http://localhost:<puerto>/health`.<br>3. Repetir con `POST`.<br>4. `curl -s http://localhost:<puerto>/api/meta`. |
| **Esperado** | El log dice `Espacios (espacios) en <APP_URL> -> puerto <PORT>`; anotar los valores reales porque `.env` puede diferir de `.env.example` (3022). `GET /health` y `POST /health` responden `200 {"ok":true,"product":"espacios","name":"Espacios"}` **sin sesión**. `GET /api/meta` responde `200 {"name":"Espacios","product":"espacios","version":2,"identity":"amg-central"}`, también sin sesión. Si la base no se puede abrir, `/health` responde `503 {"ok":false,"product":"espacios"}`. |

| | |
|---|---|
| **ID** | ESP-SIST-02 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Ventana de incógnito sin cookie de sesión. |
| **Pasos** | 1. Abrir `http://localhost:<puerto>/api/bookings`.<br>2. Abrir `http://localhost:<puerto>/` en el navegador. |
| **Esperado** | La API responde `401 {"error":"sin-sesion","loginUrl":"…"}`: todo camino que empieza con `/api/` es JSON, aunque el `Accept` del navegador sea HTML. La página responde `302` hacia el login del Core con `return_to`. No hay pantalla de login propia: el producto no pide usuario ni contraseña. |

| | |
|---|---|
| **ID** | ESP-SIST-03 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/me`.<br>2. `GET /api/inicio`.<br>3. Comparar con lo pintado en el canal lateral. |
| **Esperado** | `/api/me` responde `200 {"user":{"id","email","name"},"organization":{"id","slug"},"role":"member\|admin\|owner","product":"espacios"}`. `/api/inicio` responde `200 {"usuario":{id,nombre,email},"organizacion":{id,slug,nombre},"rol":"…","herramienta":"espacios","herramientas":[…]}`. `data-amigo="empresa"` muestra `organizacion.nombre`, `data-amigo="usuario"` muestra `usuario.nombre`, `data-amigo="correo"` muestra `usuario.email` y `data-amigo="avatar"` muestra las iniciales del nombre. Si el token no trae la lista de herramientas, `herramientas` cae a un único elemento con la herramienta actual y `data-amigo="otras"` queda vacío con su título oculto. |

| | |
|---|---|
| **ID** | ESP-SIST-04 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | Dos organizaciones distintas con suscripción a `espacios`: la propia (Org A) y una segunda (Org B), con un espacio `QA-espacios-2026 AJENA` y una reserva en Org B. |
| **Pasos** | 1. Con sesión de **Org A**, pedir `GET /api/spaces`, `GET /api/bookings`, `GET /api/agenda`, `GET /api/availability?spaceId=<id de Org B>&date=<fecha de esa reserva>` y `POST /api/bookings` con `spaceId` de Org B.<br>2. Repetir pidiendo `GET /api/bookings/<id de Org B>` y `DELETE /api/bookings/<id de Org B>`.<br>3. Intentar `PUT /api/settings` y `POST /api/schedules` con `spaceId` de Org B. |
| **Esperado** | 1: las listas no contienen ninguna fila de Org B; `GET /api/availability` responde `404 {"error":"Ese espacio no existe"}`; el `POST /api/bookings` responde `404 {"error":"Ese espacio no existe"}`. 2: `404 {"error":"Esa reserva no existe"}` en ambos casos, nunca `403`: el 404 no confirma que el id exista en otra empresa. 3: `POST /api/schedules` responde `404 Ese espacio no existe`. Ninguna respuesta filtra datos, nombres ni totales de la otra organización. `organizationId` sale siempre de la sesión y nunca del cuerpo, la query ni un header. Repetir la misma comprobación en Solicitudes. |

| | |
|---|---|
| **ID** | ESP-SIST-05 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Con DevTools en Network, recorrer las 6 pestañas y las acciones de cada una, contando peticiones.<br>2. Anotar cuántas peticiones supera 600 en 15 min, o usar `curl` en bucle para agotar el límite.<br>3. Observar la respuesta `429`. |
| **Esperado** | El límite es **600 peticiones por 15 min por IP** (`windowMs: 15 * 60 * 1000`, `limit: 600`). Agotado, las peticiones responden `429` con la cabecera `RateLimit`. Un `429` **no** es un defecto del producto: anotar en la sección 9 y esperar la ventana. Recargar la página reiteradamente (`/api/inicio`, `app.js`, `amigo.js`, `amigo.css`, `style.css` más las de datos) agota el presupuesto más rápido de lo que parece. |
---

## 5. Recorridos E2E

Recorridos completos, de principio a fin, con los datos de la sección 2. Cada uno cruza varios
módulos y termina con una comprobación que delata si algo se rompió por el camino.

| | |
|---|---|
| **ID** | ESP-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión activa. Espacio `QA-espacios-2026 Cancha 1` sin horario propio, cliente y extra de la sección 2. |
| **Pasos** | 1. Crear el espacio en `?panel=espacios`.<br>2. Crear el cliente en `?panel=clientes` y el extra en `?panel=extras`.<br>3. En `?panel=horarios`, elegir el espacio y crear un horario `Lunes` `09:00`–`18:00` activo.<br>4. Ir a `?panel=agenda`, elegir el espacio y una fecha que sea lunes.<br>5. Pulsar la primera franja de `#agenda-disponibles`.<br>6. Elegir el cliente y el extra, escribir `QA-espacios-2026 e2e` en `#reserva-notas`, y pulsar `Reservar`.<br>7. En la fila nueva, pulsar `Confirmar`.<br>8. Cambiar `#agenda-fecha` a un día distinto y volver.<br>9. Leer las cuatro tarjetas de `#resumen`. |
| **Esperado** | El paso 3 responde `201` y el aviso `Horario agregado`. El paso 5 abre el diálogo con horas ya escritas. El paso 6 responde `POST /api/bookings` `201 {"booking":{…,"status":"pending"}}`, cierra el diálogo y muestra `Reserva creada`; el total es horas × tarifa + extra. El paso 7 responde `PATCH /api/bookings/<id>` `200` y la etiqueta pasa a `Confirmada`. Al volver a la fecha, la reserva sigue en la tabla con `Confirmada` y `Confirmadas` sube en 1. Las franjas del paso 5 que coincidían con la nueva reserva ya no se ofrecen. Coherencia de las cuatro tarjetas con las filas de la tabla. |

| | |
|---|---|
| **ID** | ESP-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | ESP-E2E-01 ejecutado: existe una reserva `confirmed` en `Cancha 1`, lunes `09:00`–`18:00`. |
| **Pasos** | 1. Copiar las horas de esa reserva.<br>2. Abrir `#reserva-dialog` con `#agenda-nueva` y copiar **las mismas** horas y el mismo espacio.<br>3. Pulsar `Reservar`.<br>4. Leer `#aviso` y Network.<br>5. Repetir con el inicio un minuto antes del final de la reserva.<br>6. Repetir en `Sala A`, el otro espacio, con las mismas horas. |
| **Esperado** | 3: `POST /api/bookings` responde `409` con `<Espacio> ya está reservado de HH:MM a HH:MM UTC. Las reservas no se pueden pisar.` y `#aviso` muestra `Ese horario ya no está libre: <mensaje>`; no se crea nada y el diálogo **no** se cierra, para que el usuario corrija. 5: también `409`, porque un minuto de solapamiento sí pisa. 6: `201`, porque el solapamiento es por espacio. La franja que empieza exactamente cuando termina la reserva anterior sí se habría aceptado (`201`): verificar esa variante. |

| | |
|---|---|
| **ID** | ESP-E2E-03 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Espacio de la sección 2, jornada `08:00`–`22:00`, `minAdvanceMinutes` 0. |
| **Pasos** | 1. `POST /api/bookings` con inicio `03:00` UTC y fin `04:00` UTC.<br>2. `POST /api/bookings` con inicio `23:00` UTC y fin `01:00` UTC del día siguiente.<br>3. `POST /api/bookings` con inicio en el pasado.<br>4. `POST /api/bookings` con inicio mañana a las `09:00` local y fin a las `10:00`.<br>5. En `?panel=agenda`, elegir ese espacio y la fecha del paso 4, y comparar las franjas ofrecidas con la reserva creada.<br>6. Poner `#cfg-anticipacion` = `2880` (48 h) y guardar; pedir de nuevo la disponibilidad del mismo día. |
| **Esperado** | 1: `400` con `<Espacio> se atiende de 08:00 a 22:00. La reserva pide de HH:MM a HH:MM.` (horas **locales** de la organización). 2: `400 {"error":"La reserva no puede terminar el día siguiente."}`. 3: `400 {"error":"No se puede reservar una fecha que ya pasó."}`. 4: `201`. 5: la franja de las 9:00 ya no aparece en `#agenda-disponibles` y las anteriores y posteriores sí, pero el rótulo de hora de cada franja es el de UTC mientras el mensaje del paso 1 habla en hora local (sección 7, `R-01`). 6: con anticipación de 48 h, un día que no está a 48 h no ofrece ninguna franja. Al restaurar `0`, vuelven. |

| | |
|---|---|
| **ID** | ESP-E2E-04 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Espacio `Cancha 1` con un horario `Lunes` `09:00`–`18:00` y una reserva `confirmed` el martes siguiente de `10:00` a `11:00`. |
| **Pasos** | 1. En `?panel=horarios`, elegir el espacio y pulsar `Quitar` en el bloqueo de ESP-BLOQ-01.<br>2. Confirmar que el bloqueo ya no está en `#bloqueos-lista`.<br>3. Crear otro bloqueo que cubra `12:00`–`14:00` del martes, con motivo `QA-espacios-2026 evento`.<br>4. En `?panel=agenda`, elegir el espacio y el martes; comprobar qué franjas desaparecen.<br>5. Intentar reservar `12:30`–`13:30` desde la interfaz.<br>6. Volver a `?panel=horarios` y pulsar `Desactivar` en el horario del lunes.<br>7. Pedir la disponibilidad del lunes. |
| **Esperado** | 2: `DELETE /api/blocks/<id>` `200 {"ok":true,"deleted":true}` y aviso `Bloqueo quitado`. 3: `POST /api/blocks` `201` y aviso `Espacio bloqueado`. 4: desaparecen las franjas de 12:00 a 14:00 y **solo** esas; las de 10:00–11:00 tampoco, pero por la reserva, no por el bloqueo — comprobar `#agenda-lista` para distinguir las dos causas. 5: `409` con `<Espacio> está bloqueado de 12:00 a 14:00 UTC (QA-espacios-2026 evento). No se puede reservar ese rato.` 6: `PATCH /api/schedules/<id>` `200` con `{"active": false}` y aviso `Horario desactivado`. 7: el lunes cae a la jornada general `08:00`–`22:00`, porque `availability` filtra por `active = true` y sin filas propias se usa la general. |

| | |
|---|---|
| **ID** | ESP-E2E-05 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Dos reservas `confirmed` el mismo día en el mismo espacio: una `pending` creada y otra `confirmed`. |
| **Pasos** | 1. En `?panel=ajustes`, anotar el total de la cuarta tarjeta (`Ingresos de hoy`).<br>2. En `#agenda-lista`, pulsar `Cancelar` en la fila `confirmed`.<br>3. Releer la cuarta tarjeta.<br>4. Volver a pulsar el botón de avance de la fila `pending` dos veces: `Confirmar` y luego `Marcar hecha`.<br>5. Releer las cuatro tarjetas y las etiquetas de estado. |
| **Esperado** | 2: `PATCH /api/bookings/<id>` `200 {"booking":{…,"status":"cancelled"}}`; la etiqueta pasa a `Cancelada` (tono rojo) y el botón `Cancelar` desaparece de esa fila. 3: `ingresos` baja en el `totalCents` de esa reserva, porque `ingresos` excluye las `cancelled`; `hoy` no baja, porque `hoy` cuenta filas sin importar el estado; `Confirmadas` baja en 1. 4: `PATCH` con `{"status":"confirmed"}` y luego `{"status":"done"}`; la etiqueta final es `Completada` (tono neutro) y la fila se queda sin botón de avance ni `Cancelar`. 5: las cifras de las cuatro tarjetas son coherentes con las etiquetas de la tabla para ese mismo día. |

---

## 6. Regresión compartida

Todo lo que toca código compartido: `amigo.js`, `amigo-ui.js`, `amigo.css`, `crudRouter`, SSO,
`express.json`, `rateLimit`, `helmet`.

| | |
|---|---|
| **ID** | ESP-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Cargar `/` y mirar el orden de las peticiones en Network.<br>2. Comprobar que `?panel=<clave>` queda en la URL al pulsar cada enlace de `#tabs`.<br>3. Navegar con los botones Atrás/Adelante del navegador.<br>4. Recargar con `?panel=horarios` en la URL. |
| **Esperado** | Las pestañas las monta `AMIGO.montar({ paneles: ['agenda','espacios','horarios','clientes','extras','ajustes'], alEntrar })`. Al pulsar un `data-tab`, la URL pasa a `?panel=<clave>` con `history.pushState`, sin recargar, y el panel se muestra u oculta por `hidden`. Atrás/Adelante repintan por `popstate`. `?panel=` con una clave inexistente cae al primer panel (`agenda`). Recargar con `?panel=horarios` entra directo ahí y `alEntrar('horarios')` dispara `cargarHorarios()`, así que `#horarios-lista` **no** queda vacío: ese fue un defecto histórico del shell. El `h1[data-amigo="titulo"]` toma el texto de la pestaña activa. |

| | |
|---|---|
| **ID** | ESP-REG-02 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. Abrir `#reserva-dialog`, elegir espacio y horas.<br>2. Cerrar el diálogo sin guardar.<br>3. Volver a abrirlo con `#agenda-nueva` y leer todos los campos. |
| **Esperado** | Al cerrar con `#reserva-cerrar` o `#reserva-cancelar` el `<dialog>` se cierra con `.close()`. Al reabrir con `#agenda-nueva`, `#reserva-form` **no** se resetea (el `.reset()` solo corre tras un POST exitoso), así que los valores anteriores siguen ahí: registrar si se considera defecto de estado (sección 7, `R-09`). En cambio, tras un `Reservar` exitoso sí se resetea y `#reserva-total` vuelve a `$0`. |

| | |
|---|---|
| **ID** | ESP-REG-03 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión activa y datos de prueba. |
| **Pasos** | 1. Provocar un `409` al reservar sobre una franja ocupada.<br>2. Provocar un `400` con `#espacio-aforo` = `0`.<br>3. Provocar un `404` pidiendo un id inexistente.<br>4. Provocar un `500` con el borrado de un extra en uso (riesgo `R-03`). |
| **Esperado** | Todos los errores salen en `#aviso`, que toma la clase `ui-aviso--malo` y se oculta a los 5000 ms. Un `ZodError` se muestra como `Datos inválidos` o, si trae `errors.fieldErrors`, como `campo: mensaje` unido por ` · `. Un `AppError` muestra su `error`. Un 401 con `loginUrl` provoca navegación al login del Core y lanza `sesion vencida`, sin pintar datos vacíos. Un `500` muestra `Error interno del servidor` y **nunca** una traza. `catch` obligatorio en cada manejador: un rechazo sin capturar tumba la petición y el spinner se queda. |

| | |
|---|---|
| **ID** | ESP-REG-04 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. En Network, revisar las cabeceras de respuesta de `/`, `/app.js` y `/style.css`.<br>2. Comprobar la presencia de `/amigo.js`, `/amigo-ui.js` y `/amigo.css`.<br>3. Recargar y comparar los `?v=` de `app.js` y `amigo.js`. |
| **Esperado** | El shell se sirve **después** de la identidad: sin sesión no se descarga ni el HTML. `/amigo.css`, `/amigo.js` y `/amigo-ui.js` se resuelven desde el runtime compartido y **ganan** sobre cualquier copia del producto: los tokens son los mismos en los nueve. En desarrollo no hay `Cache-Control` de larga duraci (`maxAge: 0`); en producción, `immutable` con huella `?v=`. La huella de `app.js` y la de `amigo.js` se calculan juntas, de modo que `/app.js?v=X` y `/amigo.js?v=X` viajan con la misma versión. Helmet está activo (`contentSecurityPolicy: false` a propósito, por los estilos inline). `x-powered-by` deshabilitado. |
| | |
|---|---|
| **ID** | ESP-REG-07 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión activa, datos de prueba en varios paneles. |
| **Pasos** | 1. Crear un espacio en `?panel=espacios` y comprobar que `cargar()` repinta agenda, horarios, clientes y extras.<br>2. Crear un cliente y repetir.<br>3. Cambiar `#agenda-espacio` mientras un espacio queda archivado.<br>4. Cambiar `#horario-espacio` con el formulario de horario a medio llenar. |
| **Esperado** | Cada alta dispara `cargar()`, que rehace `Promise.all` de `/api/spaces`, `/api/customers`, `/api/addons` y `/api/settings` y luego `pintar()`. Los cuatro `<select>` se reconstruyen **conservando la selección previa** (`nodo.value = previo`), y `#horario-dia` solo se puebla una vez (`if (selDia.options.length === 0)`) para no perder lo elegido. Al cambiar `#horario-espacio`, `limpiarFormHorario()` corre antes de `cargarHorarios()`: el formulario de horario se reinicia para que un horario no quede con el `spaceId` del espacio anterior. Un select con la selección previa ya archivada vuelve a la primera opción. |
---

## 7. Riesgo conocido

Defectos y trampas **sospechados en el código**, no ejecutados. Cada uno dice dónde mirar y cómo
confirmarlo en el navegador o en Network. Todos están marcados `POR CONFIRMAR` en la sección 9.

| Riesgo | Dónde | Cómo se confirma | Severidad |
|---|---|---|---|
| **R-01** Las franjas se arman con `setUTCHours`, o sea que el horario del espacio se interpreta en **UTC** y no en la zona de la organización. Un horario `Lunes 09:00`–`18:00` en `America/Santiago` se materializa como 09:00–18:00 **UTC**, es decir 05:00–14:00 hora local en invierno. Todo lo demás (mensajes de jornada, `resumen`) razona en hora local, así que la agenda quedaría corrida y el `weekday` se sacaría del `date` en UTC. | `products/espacios/src/routes.ts:243`, `products/espacios/src/routes.ts:245`, `products/espacios/src/routes.ts:289`, `products/espacios/src/routes.ts:291`, `products/espacios/src/routes.ts:220` | Crear un horario `09:00`–`18:00` y pedir `GET /api/availability?spaceId=<id>&date=<lunes>`. Los `startAt` de los `slots` deben empezar a las `09:00Z`. Si empiezan a otra hora, o si el `weekday` de la fila creada corresponde a otro día de la semana local, el desplazamiento está confirmado. Contraste con ESP-DISP-01 y ESP-DISP-05. | Alta |
| **R-02** Los mensajes de rechazo mezclan husos: el de jornada habla en **hora local** (`hhmm(pref.openingMinutes)` y `localDe`) mientras el de solapamiento y el de bloqueo cortan la cadena ISO con `.slice(11, 16)`, que es **UTC**. Dos mensajes de la misma pantalla dan horas distintas para el mismo problema. | `products/espacios/src/routes.ts:725`, `products/espacios/src/routes.ts:790`, `products/espacios/src/routes.ts:815` | Provocar los tres rechazos con el mismo espacio y anotar la hora de cada mensaje junto a la hora real de la franja. Si el 409 de «ya está reservado» no coincide con la de la franja que ofrece la interfaz, está confirmado. | Media |
| **R-03** Borrar un extra en uso revienta la FK `RESTRICT` de `booking_addons`, y como no es `AppError` ni `ZodError` el manejador lo traduce a **500** en vez de a un 409 explicable. | `packages/product-runtime/src/errors.ts:40`, tabla `booking_addons` en el esquema de `espacios` | Crear una reserva con el extra de la sección 2 y luego `DELETE /api/addons/<id>`. Si la respuesta es `500 {"error":"Error interno del servidor"}` en vez de `400`, está confirmado. Contrastar con el paso 4 de ESP-SIST-03. | Media |
| **R-04** `espacioDe` busca por `id` y organización, pero **no** excluye los archivados: un espacio archivado sigue reservable, porque `archived_at` es una bandera de la interfaz y no una condición de negocio. | `products/espacios/src/routes.ts:148` | Archivar el espacio de la sección 2 y hacer `POST /api/bookings` con ese `spaceId`. Si responde `201`, está confirmado. Contrastar con ESP-CAT-04, donde el mismo espacio sí desaparece de todos los select. | Alta |
| **R-05** `no_show` es un estado válido de la API (`estados` en `routes.ts:65`) pero **no está en el mapa `ESTADOS`** de la interfaz, así que `AMIGO_UI.estadoDe` cae al texto crudo. Una reserva `no_show` se ve como el texto `no_show` en vez de una etiqueta traducida. | `products/espacios/public/app.js:149`, `products/espacios/public/app.js:428`, `products/espacios/src/routes.ts:65` | Crear una reserva por API con `"status": "no_show"` y abrir `#agenda-lista` en esa fecha. Si la etiqueta muestra `no_show` literal y no una clase `ui-etiqueta--*`, está confirmado. | Baja |
| **R-06** Los campos de dinero (`#espacio-tarifa`, `#extra-precio`) se rellenan con el valor crudo en **centavos** (`e.pricePerHourCents`, `x.priceCents`) y la etiqueta no lo dice: un usuario que escriba `36000` pensando en pesos crea un espacio a $36.000 la hora. La lista sí formatea con `dinero()`, lo que hace que el mismo número se vea de dos formas. | `products/espacios/public/app.js:469`, `products/espacios/public/app.js:488`, `products/espacios/public/app.js:208`, `products/espacios/public/index.html` (`#espacio-tarifa`, `#extra-precio`) | Editar el espacio de prueba y comparar el valor precargado de `#espacio-tarifa` con `Tarifa hora` de la tabla para el mismo espacio. Si la tabla dice `$360.00` y el input muestra `36000`, la trampa está confirmada. | Media |
| **R-07** Los chequeos de rol no son homogéneos: horarios y bloqueos exigen `member`, el `crudRouter` genérico exige `writeRole`/`deleteRole`, y **las reservas y `PUT /api/settings` no exigen nada**. Un `viewer` autenticado puede crear, confirmar, cancelar y borrar reservas, y cambiar la jornada y la moneda de la organización. | `products/espacios/src/routes.ts:371`, `products/espacios/src/routes.ts:492`, `products/espacios/src/routes.ts:874`, `products/espacios/src/routes.ts:943`, `packages/product-runtime/src/crud.ts:185` | Con una sesión de rol `viewer`, hacer `POST /api/schedules` (esperado 403), `POST /api/bookings` (esperado 403) y `PUT /api/settings` (esperado 403). Los dos últimos `201`/`200` confirman la inconsistencia. | Alta |
| **R-08** `#reserva-form` solo se resetea **después** de un `POST` exitoso, así que al reabrir el diálogo con `#agenda-nueva` conserva espacio, horas, cliente, extra y notas de la reserva anterior. Si la franja se cubre mientras tanto, el `409` es lo único que evita el alta equivocada. | `products/espacios/public/app.js:578`, `products/espacios/public/app.js:442` | Crear una reserva, cerrar el diálogo sin guardar, abrir otra franja y revisar los seis campos. Si arrastran los valores viejos, está confirmado. | Baja |
| **R-09** El recorte de `limit` no es el mismo en las dos capas: las reservas usan `Math.min(Math.max(n \|\| 100, 1), 500)` y el `crudRouter` usa `Math.min(n \|\| 200, 1000)` sin piso. `limit=0` da 100 en reservas y 200 en el catálogo, y ningún listado acepta `offset` salvo el `crudRouter`. | `products/espacios/src/routes.ts:658`, `packages/product-runtime/src/crud.ts:228` | Pedir `?limit=0` en `/api/bookings` y en `/api/spaces` y comparar con `limit` de la respuesta; luego `?offset=10` en `/api/bookings`. | Baja |
| **R-10** El `404` del `crudRouter` es genérico (`No encontrado`) mientras que las rutas propias nombran el recurso (`Ese espacio no existe`, `Esa reserva no existe`). El mismo error llega con dos textos según por dónde se pida. | `packages/product-runtime/src/crud.ts:316`, `packages/product-runtime/src/crud.ts:320`, `products/espacios/src/routes.ts:148` | `DELETE /api/spaces/espespacio_inexistente` y `GET /api/spaces/espespacio_inexistente`: comparar ambos cuerpos. | Baja |
| **R-11** La caída a la jornada general solo aborta con `400` si **no** hay horarios propios del día: un espacio con un horario propio que invierta el orden (`hasta` menor que `desde`) pasa el filtro `active = true` y produce `jornadas` con `desde > hasta`, así que el bucle de franjas no produce ninguna y el espacio desaparece de la disponibilidad sin explicación. | `products/espacios/src/routes.ts:238`, `products/espacios/src/routes.ts:293` | Crear por API un horario del lunes con `startTime: 1080` y `endTime: 540` (el `crudRouter` no valida el orden; `POST /api/schedules` sí) y pedir la disponibilidad de ese lunes. `slots: []` sin error confirma el riesgo. | Media |
| **R-12** `futuras` de `/api/resumen` no tiene contraparte en la interfaz y su definición difiere de `hoy`: cuenta desde el inicio del día, excluye `cancelled` y `no_show`, e incluye el propio día. El nombre sugiere «a futuro» y el valor incluye lo que ya pasó hoy. | `products/espacios/src/routes.ts:613`, `products/espacios/src/routes.ts:627`, `products/espacios/public/app.js:397` | En una fecha con reservas pasadas y futuras, comparar `hoy` y `futuras` contra conteos manuales y ver que el panel de la interfaz solo enseña cuatro de las seis cifras. | Baja |

---

## 8. Checklist visual

Recorrer una vez por cada pestaña, en 1280 × 800 y en 390 × 844. Marcar cada ítem.

**Barra lateral y cabecera**

- [ ] El canal lateral tiene exactamente las 6 entradas en este orden: Agenda, Espacios, Horarios, Clientes, Extras, Ajustes.
- [ ] La entrada activa se distingue por fondo y por el indicador de la izquierda; solo una está activa.
- [ ] `#tabs` marca la pestaña activa con `aria-current` y todas son alcanzables con teclado.
- [ ] El `h1[data-amigo="titulo"]` cambia al título de la pestaña activa, no al nombre del producto.
- [ ] `data-amigo="empresa"`, `data-amigo="usuario"`, `data-amigo="correo"` y `data-amigo="avatar"` muestran los datos de la sesión, con iniciales en el avatar.
- [ ] `data-amigo="otras"` está oculto cuando el token no trae lista de herramientas.

**Agenda**

- [ ] `#resumen` muestra cuatro KPI con etiqueta y cifra; solo `Confirmadas` lleva cifra de acento, y el de `Ingresos de hoy` va con `dinero()`.
- [ ] `#agenda-fecha` es un `input[type=date]` con la fecha de hoy precargada.
- [ ] `#agenda-espacio` mantiene la selección al cambiar de pestaña y vuelve a la primera opción si el espacio se archivó.
- [ ] `#agenda-disponibles` pinta un botón por franja con `hora → $importe`; con espacio sin elegir muestra `Elige un espacio para ver sus franjas libres.` y con día lleno muestra `No quedan franjas libres ese día.`
- [ ] `#agenda-lista` tiene `Hora`, `Espacio`, `Cliente`, `Total`, `Estado`, `Acciones`; la columna `Hora` queda fija al desplazar horizontalmente.
- [ ] Las cinco clases de estado se distinguen sin depender solo del color: `Confirmada` (ok), `Por confirmar` (aviso), `Completada` (neutro), `Cancelada` (malo).
- [ ] Los botones de la fila usan tamaño chico; el de avanzar va `--suave` y los de `Editar`/`Archivar` `--fantasma`.
- [ ] `#agenda-lista` se puede desplazar en horizontal sin que la página entera se desplace.

**Diálogo de reserva**

- [ ] El `<dialog>` abre con `showModal()`: fondo atenuado, foco dentro, `Esc` cierra.
- [ ] `#reserva-espacio` y `#reserva-cliente` traen la opción `Elige un espacio` / `Elige un cliente` como primera.
- [ ] `#reserva-inicio` y `#reserva-fin` son `datetime-local` con paso de 15 minutos.
- [ ] `#reserva-total` se recalcula al cambiar espacio, inicio, fin o extra, y arranca en `$0` sin espacio elegido.
- [ ] `#reserva-cerrar` (×) y `#reserva-cancelar` cierran sin enviar nada.

**Espacios, Horarios, Clientes, Extras**

- [ ] Los cuatro formularios usan la misma retícula de dos columnas y colapsan a una en móvil.
- [ ] `#horario-dia` se rellena solo con los siete días en español, empezando por `Domingo`.
- [ ] `#cfg-apertura` y `#cfg-cierre` muestran `HH:MM` y no minutos, aunque el servidor guarde minutos.
- [ ] Los botones `Nuevo espacio`, `Nuevo cliente`, `Nuevo extra` limpian el formulario y ocultan el botón de cancelar.
- [ ] Las tablas `Nombre`/`Tipo`/`Aforo`/`Tarifa hora` y `Precio` alinean a la derecha los importes y los números.
- [ ] `#extras-lista` **no** tiene columna de acciones; comprobar que la ausencia es deliberada.

**Avisos y estados vacíos**

- [ ] `#aviso` es un único elemento reutilizado: verde para lo que salió bien, rojo para lo que falló, y se oculta solo a los 5000 ms.
- [ ] Los mensajes de error nombran el campo cuando el fallo es de validación.
- [ ] Cada lista vacía explica por qué está vacía y qué hacer, sin dejar una tabla sin filas.
- [ ] El spinner o estado de carga no queda colgado si una petición falla.

---

## 9. Registro

Una fila por caso ejecutado. **Dejar vacía hasta la primera vuelta real**: nada aquí está
verificado todavía. `Resultado` es `PASA`, `FALLA` o `BLOQUEADO`.

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados. Transversal: Doc 10 §9.

| ID | Resultado (PASA/FALLA/BLOQUEADO) | Evidencia | Nota |
|---|---|---|---|
| ESP-SIST-05 | PARCIAL | Headers `RateLimit` presentes en la ráfaga de pagos: `"600-in-15min"; r=0; t=335` y, en otra ventana, `"1000-in-15min"`; `429` con cuerpo **plain text** "Too many requests, please try again later." (no JSON) | Límite no uniforme entre productos/ventanas (citas 600, pagos 1000→600). `R-04` confirma header; el cuerpo y la uniformidad fallan. En espacios no se agotó el límite propio. |
| ESP-API-01 | BLOQUEADO | Requiere crear una reserva vigente con addons (`POST /api/bookings`) | No ejecutado en esta vuelta. |
| ESP-CAT-07 | BLOQUEADO | Requiere datos seed de la sección 2 | No ejecutado. |
| ESP-NAV-01 | PARCIAL | 6 pestañas; clic → 0 peticiones `/api/`; paneles con datos (prefetch `spaces`/`customers`/`addons` al cargar) | Sin síntoma de panel vacío (diferente a Citas). h1, aria-current y panel visible ✅. |
| ESP-SIST-02 | FALLA | `/amigo.css` sin sesión → **200 público** en cotizaciones/crm/activos (`cf-cache-status:HIT`); en espacios `/`,`/app.js`,`/style.css` → 302 | Fuga del shell compartido vía CDN en 3 productos. Equivale a REG-SES-03. |
