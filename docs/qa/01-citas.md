# Plan de pruebas — Citas

## 1. Ficha técnica

| Dato | Valor |
|---|---|
| Slug | `citas` |
| Dominio | `citas.amgdeveloper.cl` |
| Puerto producción | `3100` (`docker-compose.yml`) |
| Puerto local | `3021` (`products/citas/.env`) |
| Core (SSO) | `desarrollo.amgdeveloper.cl`, puerto `3108`. Es el emisor de SSO por diseño, no un entorno de desarrollo. |
| Color de marca | `#c2571a` |
| Paneles | 7: `agenda`, `clientes`, `servicios`, `profesionales`, `horarios`, `avisos`, `config` |
| Diálogos | `#dlg` (cita), `#dlg-cli` (cliente), `#dlg-srv` (servicio), `#dlg-per` (profesional) |
| Roles con escritura | `member` agenda citas; `admin` `PUT /api/settings` |
| Zona horaria por defecto | `America/Santiago` (`routes.ts`, `defaultSettings`) |
| Seed automático | **No hay.** No existe `POST /api/seed`. La agenda arranca vacía salvo lo que haya. |
| Tests existentes | `products/citas/tests/ui.test.ts` (22), `resumen-contrato.test.ts` (9), más los previos. `npm test -w @amg/citas` → 68 casos. |

Scripts que se cargan, en este orden exacto (`index.html:423-425`):
`/amigo-ui.js` → `/amigo.js` → `/app.js`, los tres como scripts clásicos (sin `defer` ni `type="module"`).

> Nota sobre `#srv-precio`: la etiqueta dice **Precio** (línea 385), no "en centavos". La tabla de
> Servicios sí muestra el resultado en pesos. Es la misma trampa de unidad que se documenta en el
> resto de la suite; ver `R-04`.

---

## 2. Datos de prueba

Sembrar **antes** de empezar, con sufijo `QA` para poder limpiar sin ambigüedad. Todo vía API o UI,
nunca SQL directo.

| # | Qué sembrar | Por qué |
|---|---|---|
| D1 | 3 clientes: `QA Ana Ruiz`, `QA Bruno Díaz`, `QA Carla Soto` | Rellena el selector `#c-cliente` |
| D2 | 2 servicios: `QA Corte` (30 min, 12000 centavos), `QA Tinte` (45 min, 25000 centavos) | Rellena `#c-servicio` y prueba el precio heredado |
| D3 | 2 profesionales: `QA Diego Paz`, `QA Elena Mora` | Rellena `#c-profesional` y `#horario-profesional` |
| D4 | Franjas semanales para `QA Diego Paz`: lunes a viernes 09:00-14:00 y 16:00-20:00 | La agenda del día necesita un día con jornada |
| D5 | 1 bloqueo puntual el día de la agenda, de 12:00 a 13:00 | Verifica que el bloqueo pisa la franja |
| D6 | 4 citas: dos el día de hoy, una mañana, una **22:00** | La de las 22:00 es la que prueba la zona horaria |
| D7 | Zona horaria de la organización = la del taller real, distinta a la del navegador | Si coinciden, los casos de zona no dicen nada |

**La cita de las 22:00 (D6) es la prueba clave del producto.** Con el navegador en
`America/Santiago` (UTC−3) y el taller en `America/Mexico_City` (UTC−6), una cita creada a las
22:00 del día *N* se guarda como `N+1T04:00:00.000Z`. Si la UI la muestra el día *N+1* a la
01:00, la zona horaria está rota.

Todos los casos de zona horaria deben ejecutarse con **el huso del navegador distinto al del
taller**. Con dos navegadores en la misma zona, `CIT-AGEN-08` y `CIT-CFG-03` no tienen valor.

---

## 3. Precondiciones

1. Sesión iniciada en el Core. La sesión vive en el Core y dura **15 minutos**; cada subdominio
   tiene su propia cookie y la obtiene del SSO.
2. **Nunca pedir credenciales.** El tester las tipea.
3. Al expirar, `/api/*` responde `401 {"error":"sin-sesion","loginUrl":...}` y el navegador salta
   al login. No es un defecto del producto: anotar el corte en el registro y seguir.
4. Límite de tasa: 600 peticiones / 15 min por IP. Los cargadores piden 3 catálogos por entrada a
   panel; no recargar la página en bucle.
5. No usar la flecha atrás del navegador para moverse de panel: el caso `CIT-REG-02` mide
   precisamente ese camino.
6. Para los casos de rol hace falta una segunda cuenta con rol `member` y otra con `admin`.
   El producto no expone un selector de rol: hay que cambiar de sesión.

---

## 4. Casos por módulo

### 4.1 Agenda

#### `CIT-AGEN-01` — La agenda del día trae las citas del día

| | |
|---|---|
| **ID** | `CIT-AGEN-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D6 sembrada; panel Agenda abierto; `#fecha` con la fecha de hoy del taller |
| **Pasos** | 1. Abrir el panel **Agenda**.<br>2. No tocar nada más.<br>3. En Network, filtrar por `agenda`. |
| **Esperado** | `#dia` contiene una tabla con las columnas `Hora`, `Cliente`, `Profesional`, `Estado`, `Total`, y una fila por cada cita del día. `GET /api/agenda` devuelve `200` con `{ "appointments": [ … ] }` y `customerName`/`staffName` resueltos. |

#### `CIT-AGEN-02` — Sin citas, mensaje de vacío

| | |
|---|---|
| **ID** | `CIT-AGEN-02` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Un día sin citas, por ejemplo 3 meses adelante |
| **Pasos** | 1. Poner en `#fecha` una fecha sin citas.<br>2. Observar `#dia`. |
| **Esperado** | Una fila con el texto `No hay citas para este día.` No hay tabla vacía sin texto ni error en consola. |

#### `CIT-AGEN-03` — Cambiar de día recarga la agenda

| | |
|---|---|
| **ID** | `CIT-AGEN-03` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D6 sembrada |
| **Pasos** | 1. Anotar las filas de hoy.<br>2. Cambiar `#fecha` al día de la cita de las 22:00.<br>3. Volver a poner la fecha de hoy. |
| **Esperado** | Un `GET /api/agenda` por cambio de día, con `from`/`to` distintos cada vez. Al volver a hoy reaparece exactamente la lista original. |

#### `CIT-AGEN-04` — Los KPIs del resumen son correctos

| | |
|---|---|
| **ID** | `CIT-AGEN-04` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Contar a mano las citas de hoy, las futuras y las `pending` |
| **Pasos** | 1. Anotar las cuatro cifras de `#resumen`.<br>2. Comparar con el conteo manual.<br>3. En Network, abrir `GET /api/resumen`. |
| **Esperado** | Las tarjetas coinciden con el conteo. `hoy` cuenta solo las del día local del taller. `futuras` incluye las de hoy. `porConfirmar` cuenta **solo** las citas en estado `pending`; nunca cuenta las `confirmed`. Las citas `cancelled` y `no_show` quedan fuera de los tres. |

#### `CIT-AGEN-05` — Buscar filtra dentro del día cargado

| | |
|---|---|
| **ID** | `CIT-AGEN-05` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | D6 con al menos dos clientes distintos el mismo día |
| **Pasos** | 1. Escribir el nombre de un cliente en `#buscar`.<br>2. Escribir el nombre del profesional de otra cita.<br>3. Escribir un texto que no existe. |
| **Esperado** | 1. Filtra por nombre de cliente. 2. Filtra por nombre de profesional. 3. Muestra `No hay citas para este día.` El texto de `#buscar` es `Cliente o profesional`. |

#### `CIT-AGEN-06` — La búsqueda de la agenda es de un solo día

| | |
|---|---|
| **ID** | `CIT-AGEN-06` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | D6 con una cita hoy y otra dentro de tres meses |
| **Pasos** | 1. Buscar en `#buscar` el cliente de la cita lejana.<br>2. Observar la Network: contar peticiones a `/api/agenda`. |
| **Esperado** | No aparece: el filtro se aplica sobre lo ya cargado y **no** dispara peticiones. Es el comportamiento actual y es una trampa de usabilidad: el placeholder `Cliente o profesional` sugiere búsqueda global. Anotar como tal, no como fallo funcional. |

#### `CIT-AGEN-07` — Orden de la tabla

| | |
|---|---|
| **ID** | `CIT-AGEN-07` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | D6 con tres citas el mismo día a horas distintas |
| **Pasos** | 1. Abrir el día.<br>2. Leer la columna `Hora` de arriba a abajo. |
| **Esperado** | Las citas salen en orden cronológico ascendente, igual que el `ORDER BY startAt ASC` del servidor. La primera columna es la hora, que es el eje de lectura de una agenda. |

#### `CIT-AGEN-08` — La cita de las 22:00 aparece en su día local

| | |
|---|---|
| **ID** | `CIT-AGEN-08` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | D6 sembrada. **Huso del navegador distinto al del taller.** |
| **Pasos** | 1. En Network, localizar `GET /api/agenda` del día *N*.<br>2. Verificar los parámetros `from` y `to`.<br>3. En Network, abrir la cita y leer su `startAt`.<br>4. Cambiar `#fecha` al día *N* y comprobar la fila. |
| **Esperado** | La fila aparece el día *N* a las `10:00 p. m.` (22:00). El rango enviado es `00:00` de la zona del taller a `23:59` de ese mismo día, no `00:00Z`–`23:59Z`. Si aparece el día *N+1* a la 01:00, la zona horaria se está ignorando. |

#### `CIT-AGEN-09` — La primera petición no se hace en UTC

| | |
|---|---|
| **ID** | `CIT-AGEN-09` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Recargar la página desde cero |
| **Pasos** | 1. En Network, filtrar por `agenda`.<br>2. Contar las peticiones al cargar.<br>3. Mirar el `from`/`to` de la primera. |
| **Esperado** | **Una sola** petición a `/api/agenda`, ya con la zona del taller. No hay una petición previa `00:00Z`–`23:59Z` seguida de la correcta. Si hay dos, se está requesting la agenda antes de que `GET /api/settings` traiga la zona. |

#### `CIT-AGEN-10` — Cita sin cliente ni profesional

| | |
|---|---|
| **ID** | `CIT-AGEN-10` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | Crear por API una cita con `customerId: null` y `staffId: null` |
| **Pasos** | 1. Poner `#fecha` en el día de esa cita.<br>2. Leer la fila. |
| **Esperado** | La fila muestra `Sin cliente` y `Sin profesional` en lugar de celdas en blanco o `undefined`. |

#### `CIT-AGEN-11` — El estado se pinta con su etiqueta

| | |
|---|---|
| **ID** | `CIT-AGEN-11` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Una cita en cada estado: `confirmed`, `pending`, `done`, `cancelled`, `no_show` |
| **Pasos** | 1. Abrir el día.<br>2. Comparar la columna `Estado` con las etiquetas de `#c-estado`. |
| **Esperado** | `Confirmada`, `Por confirmar`, `Realizada`, `Cancelada`, `No asistió`. Ninguna muestra la clave cruda (`pending`, `no_show`). |

#### `CIT-AGEN-12` — No hay columna de acciones en la agenda

| | |
|---|---|
| **ID** | `CIT-AGEN-12` |
| **Tipo / Prioridad** | `EXP` · `P1` |
| **Precondición** | D6 sembrada |
| **Pasos** | 1. Abrir el día con citas.<br>2. En Network, intentar `PATCH /api/appointments/:id` con `{ "status": "cancelled" }` desde la consola.<br>3. Buscar cualquier botón de editar o cancelar en la fila. |
| **Esperado** | `PATCH` responde `200` con la cita actualizada: **la API puede, la interfaz no**. No hay columna de acciones. `DELETE /api/appointments/:id` responde `404`. Es una funcionalidad faltante, documentada como `R-01`. |

### 4.2 Clientes

#### `CIT-CLI-01` — El panel lista clientes

| | |
|---|---|
| **ID** | `CIT-CLI-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D1 sembrada |
| **Pasos** | 1. Clic en el canal en **Clientes** (`data-tab="clientes"`).<br>2. Observar `#clientes`. |
| **Esperado** | Tabla con `Nombre`, `Teléfono`, `Correo`, `Etiquetas` y 3 filas. Campos vacíos se muestran como `—`. Si el panel sale vacío sin texto de vacío, es una regresión del contrato `{ items }`. |

#### `CIT-CLI-02` — Crear cliente

| | |
|---|---|
| **ID** | `CIT-CLI-02` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Sesión con rol `member` |
| **Pasos** | 1. Clic en **Nuevo cliente** (`#nuevo-cli`).<br>2. Rellenar `#cli-nombre` con `QA Nuevo`, `#cli-telefono` con `+56 9 1234 5678`, `#cli-email` con `qa@citas.test`, `#cli-tags` con `vip,qa`.<br>3. Clic en **Guardar**.<br>4. Observar `#aviso` y `#clientes`. |
| **Esperado** | `POST /api/customers` responde `201`. Aparece el banner `Cliente creado`. El diálogo `#dlg-cli` se cierra. La lista incluye al cliente nuevo **antes** de cualquier recarga manual de página. |

#### `CIT-CLI-03` — El diálogo se abre y se cierra

| | |
|---|---|
| **ID** | `CIT-CLI-03` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. Clic en **Nuevo cliente**.<br>2. Clic en **Cancelar** (`#cli-cancelar`).<br>3. Repetir y clic en la **X** (`#cli-cerrar`). |
| **Esperado** | El diálogo abre con los campos vacíos. Ambas vías lo cierran sin crear nada y sin aviso de error. |

#### `CIT-CLI-04` — Campos obligatorios y formatos

| | |
|---|---|
| **ID** | `CIT-CLI-04` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. Con `#cli-nombre` vacío, clic en **Guardar**.<br>2. Escribir `no-es-un-correo` en `#cli-email` y un nombre válido, **Guardar**.<br>3. Escribir un nombre de 200 caracteres y **Guardar**. |
| **Esperado** | 1. El navegador bloquea el envío (`required`), no se manda nada. 2. El navegador bloquea por `type="email"`. 3. Si `#cli-nombre` tiene `maxlength="150"`, no se supera; si se manda, el servidor responde `400 Datos inválidos`. Nunca hay un `POST` con nombre vacío. |

#### `CIT-CLI-05` — Buscar clientes (búsqueda de servidor)

| | |
|---|---|
| **ID** | `CIT-CLI-05` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | D1 con nombres que no comparten substring |
| **Pasos** | 1. Escribir `Ana` en `#buscar-cli`.<br>2. Escribir un término inexistente.<br>3. En Network, mirar la petición. |
| **Esperado** | 1. Filtra a `QA Ana Ruiz`. 2. Fila vacía con texto. 3. `GET /api/customers?limit=200&q=Ana` — la búsqueda **sí** va al servidor. A diferencia de `#buscar` de la agenda, esta no es de cliente. |

#### `CIT-CLI-06` — Duplicados permitidos

| | |
|---|---|
| **ID** | `CIT-CLI-06` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | D1 sembrada |
| **Pasos** | 1. Crear un cliente con exactamente el mismo nombre y teléfono que uno existente.<br>2. Comparar con la respuesta. |
| **Esperado** | `201` y el duplicado se crea. No hay `409`. No hay advertencia en la UI. Es una decisión de diseño pendiente de dueño de producto; documentado como `R-05`. |

#### `CIT-CLI-07` — Archivar cliente no tiene interfaz

| | |
|---|---|
| **ID** | `CIT-CLI-07` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** — |
| **Pasos** | 1. Buscar en toda la interfaz alguna acción de archivar.<br>2. Por Network, mandar `DELETE /api/customers/:id`.<br>3. Recargar la lista. |
| **Esperado** | No hay acción de archivar en la UI. `crudRouter` está configurado con `archive: true`, así que el `DELETE` es lógico: responde `200` y el cliente queda con `archivedAt`. La tabla **no** distingue activo de archivado ni tiene columna `Estado`. Documentado como `R-06`. |

### 4.3 Servicios

#### `CIT-SRV-01` — El panel lista servicios

| | |
|---|---|
| **ID** | `CIT-SRV-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D2 sembrada |
| **Pasos** | 1. Clic en **Servicios**.<br>2. Observar `#servicios`. |
| **Esperado** | Tabla con `Nombre`, `Duración`, `Precio`, `Estado` y 2 filas. El precio se muestra en **pesos** (`$ 120`, no `12000`). |

#### `CIT-SRV-02` — Crear servicio

| | |
|---|---|
| **ID** | `CIT-SRV-02` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Sesión con rol `member` |
| **Pasos** | 1. Clic en **Nuevo servicio** (`#nuevo-srv`).<br>2. `#srv-nombre` = `QA Sueldo`, `#srv-duracion` = `45`, `#srv-precio` = `8000`.<br>3. **Guardar**. |
| **Esperado** | `201`. Banner de éxito, diálogo cerrado, lista actualizada. Fila con `45` minutos y `$ 80`. |

#### `CIT-SRV-03` — Duración fuera de rango

| | |
|---|---|
| **ID** | `CIT-SRV-03` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. `#srv-duracion` = `3`, guardar.<br>2. `#srv-duracion` = `2000`, guardar.<br>3. `#srv-duracion` vacía, guardar. |
| **Esperado** | 1 y 2. El navegador bloquea por `min="5" max="1440"`. 3. El campo es `required` con `value="30"`. Ningún caso llega a un `POST` inválido. Por API: `400` con `Datos inválidos`. |

#### `CIT-SRV-04` — El precio se guarda en centavos

| | |
|---|---|
| **ID** | `CIT-SRV-04` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | — |
| **Pasos** | 1. Crear un servicio con `#srv-precio` = `12000`.<br>2. En Network, leer el `priceCents` del `POST`.<br>3. Leer la fila en la tabla. |
| **Esperado** | El `POST` manda `priceCents: 12000` **sin Dividir ni multiplicar por 100**. La tabla muestra `$ 120`. Si la tabla mostrara `$ 12.000` o `$ 12000`, hay una conversión en el frontend que no debería estar. Ver `R-04`. |

#### `CIT-SRV-05` — Servicios inactivos

| | |
|---|---|
| **ID** | `CIT-SRV-05` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | — |
| **Pasos** | 1. Por Network, `PATCH /api/services/:id` con `{ "active": false }`.<br>2. Volver a la agenda y abrir **Nueva cita**.<br>3. Mirar `#c-servicio`. |
| **Esperado** | El servicio existe con `active: false`. El `crudRouter` acepta el campo. En `#c-servicio` hay que determinar si sigue apareciendo: el formulario permite agendar sin servicio, así que no es necesariamente un fallo, pero **no hay UI para activar o desactivar** un servicio. Documentado como `R-07`. |

### 4.4 Profesionales

#### `CIT-PER-01` — El panel lista profesionales

| | |
|---|---|
| **ID** | `CIT-PER-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D3 sembrada |
| **Pasos** | 1. Clic en **Profesionales**.<br>2. Observar `#profesionales`. |
| **Esperado** | 2 filas con `Nombre`, `Teléfono`, `Correo`, `Color`. |

#### `CIT-PER-02` — Crear profesional

| | |
|---|---|
| **ID** | `CIT-PER-02` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Sesión con rol `member` |
| **Pasos** | 1. Clic en **Nuevo profesional** (`#nuevo-per`).<br>2. `#per-nombre` = `QA Rosa Vidal`, `#per-telefono` = `+56 9 0000 1111`, `#per-color` = `#1a7f37`.<br>3. **Guardar**. |
| **Esperado** | `201`. El color se ve en la lista. Banner de éxito y diálogo cerrado. |

#### `CIT-PER-03` — El color se propaga a la agenda

| | |
|---|---|
| **ID** | `CIT-PER-03` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | `CIT-PER-02` ejecutado; una cita con ese profesional |
| **Pasos** | 1. Agendar una cita con el profesional nuevo.<br>2. Observar la fila en la agenda. |
| **Esperado** | Determinar si `staffName` se pinta con el `color` del profesional o en el color por defecto. Si el color no se usa en ningún sitio de la agenda, es configuración muerta: documentado como `R-08`. |

#### `CIT-PER-04` — Color inválido

| | |
|---|---|
| **ID** | `CIT-PER-04` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | — |
| **Pasos** | 1. Crear profesional con `color` vacío.<br>2. Por Network, `PATCH` con `{ "color": "rojo" }`. |
| **Esperado** | 1. El `input type="color"` no admite vacío; hay que elegir. 2. El esquema acepta hasta 9 caracteres sin validar el formato, así que `"rojo"` se guarda y produce un color inválido en CSS. Documentado como `R-09`. |

### 4.5 Horarios

#### `CIT-HOR-01` — El panel muestra el horario del profesional

| | |
|---|---|
| **ID** | `CIT-HOR-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D4 sembrada |
| **Pasos** | 1. Clic en **Horarios**.<br>2. Elegir un profesional en `#horario-profesional`.<br>3. Observar `#horarios`. |
| **Esperado** | `#horario-profesional` se rellena con D3. `#horarios` muestra una fila por franja, con día, hora de inicio y hora de fin, y una acción para editarla o desactivarla. |

#### `CIT-HOR-02` — Crear una franja

| | |
|---|---|
| **ID** | `CIT-HOR-02` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Profesional elegido en `#horario-profesional` |
| **Pasos** | 1. `#horario-dia` = un día sin franja.<br>2. `#horario-desde` = `08:00`, `#horario-hasta` = `12:00`, `#horario-activo` = `Activo`.<br>3. **Guardar horario**. |
| **Esperado** | `POST /api/schedules` responde `201`. La franja aparece en `#horarios`. El formulario se limpia para poder seguir agregando. |

#### `CIT-HOR-03` — Editar una franja existente

| | |
|---|---|
| **ID** | `CIT-HOR-03` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | D4 sembrada |
| **Pasos** | 1. Accionar **Editar** sobre una franja.<br>2. Cambiar `#horario-hasta`.<br>3. **Guardar horario**. |
| **Esperado** | El botón `#horario-cancelar` (`Cancelar edición`) aparece durante la edición. `PATCH /api/schedules/:id` responde `200` y la tabla refleja el cambio. Tras guardar, `#horario-cancelar` se oculta. |

#### `CIT-HOR-04` — Desactivar una franja

| | |
|---|---|
| **ID** | `CIT-HOR-04` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | D4 sembrada |
| **Pasos** | 1. Editar una franja.<br>2. Poner `#horario-activo` = `Inactivo`.<br>3. Guardar. |
| **Esperado** | La franja se marca inactiva y **no** se ofrece como horario válido. Determinar si permanece visible en la tabla (con marca) o desaparece. |

#### `CIT-HOR-05` — Franja al revés

| | |
|---|---|
| **ID** | `CIT-HOR-05` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. `#horario-desde` = `14:00`, `#horario-hasta` = `09:00`.<br>2. Guardar. |
| **Esperado** | Error visible en `#horario-err`. No se crea la franja. Si el servidor no lo rechaza, es un hallazgo: el solapamiento se calcula con horas y una franja invertida rompería el cálculo. |

#### `CIT-HOR-06` — Ambas horas obligatorias

| | |
|---|---|
| **ID** | `CIT-HOR-06` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | — |
| **Pasos** | 1. Dejar `#horario-desde` vacío y guardar.<br>2. Dejar `#horario-hasta` vacío y guardar. |
| **Esperado** | El navegador bloquea el envío: ambos son `required`. No hay petición al servidor. |

#### `CIT-HOR-07` — Las franjas se mandan en minutos

| | |
|---|---|
| **ID** | `CIT-HOR-07` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. Crear una franja de `09:00` a `14:00`.<br>2. En Network, leer el cuerpo del `POST`. |
| **Esperado** | `weekday` numérico y `startTime`/`endTime` en **minutos desde medianoche** (`540` y `840`). Si se mandan `"09:00"`, el contrato cambió y hay que actualizar el plan. |

#### `CIT-HOR-08` — Franjas de otro día no colisionan

| | |
|---|---|
| **ID** | `CIT-HOR-08` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. Crear `09:00`-`14:00` en lunes.<br>2. Crear `09:00`-`14:00` en martes para el mismo profesional.<br>3. Crear `09:00`-`14:00` en lunes para el **otro** profesional. |
| **Esperado** | Los tres se aceptan. El solapamiento de franjas solo importa dentro del mismo profesional y el mismo día. |

### 4.6 Bloqueos

#### `CIT-BLO-01` — Crear un bloqueo

| | |
|---|---|
| **ID** | `CIT-BLO-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Sesión con rol `member` |
| **Pasos** | 1. Clic en **Horarios**.<br>2. `#bloqueo-inicio` y `#bloqueo-fin` con fecha y hora del día de la agenda, 12:00 a 13:00.<br>3. `#bloqueo-motivo` = `QA almuerzo`.<br>4. Clic en **Bloquear**. |
| **Esperado** | `POST /api/blocks` responde `201`. El bloqueo aparece bajo el encabezado `Bloqueos`, con motivo e intervalo. |

#### `CIT-BLO-02` — El bloqueo pisa las franjas

| | |
|---|---|
| **ID** | `CIT-BLO-02` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | `CIT-BLO-01` ejecutado |
| **Pasos** | 1. Ir a la agenda del día bloqueado.<br>2. Abrir **Nueva cita**.<br>3. Intentar agendar de 12:30 a 13:30, solapado con el bloqueo. |
| **Esperado** | El servidor rechaza el solapamiento. La UI muestra el error en `#c-error`. La franja bloqueada no se puede ocupar por más de la mitad. |

#### `CIT-BLO-03` — Bloqueo al revés

| | |
|---|---|
| **ID** | `CIT-BLO-03` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. `#bloqueo-inicio` = 15:00, `#bloqueo-fin` = 11:00.<br>2. Bloquear. |
| **Esperado** | Error en `#bloqueo-err`, sin crear. Determinar si el mensaje es legible o un código crudo. |

#### `CIT-BLO-04` — Borrar un bloqueo

| | |
|---|---|
| **ID** | `CIT-BLO-04` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | `CIT-BLO-01` ejecutado |
| **Pasos** | 1. Accionar el borrado del bloqueo.<br>2. Confirmar si aparece un `confirm()`. |
| **Esperado** | `DELETE /api/blocks/:id` responde `200`. Desaparece de la lista. Si **no** hay confirmación y el borrado es inmediato, documentar: es la misma clase de fallo que `R-10`. |

### 4.7 Avisos

#### `CIT-AVI-01` — La bitácora lista avisos

| | |
|---|---|
| **ID** | `CIT-AVI-01` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Al menos un reminder en la organización; si no hay ninguno, fila vacía |
| **Pasos** | 1. Clic en **Avisos**.<br>2. Observar `#avisos`.<br>3. En Network, abrir `GET /api/reminders`. |
| **Esperado** | `200` con `{ "reminders": [ … ] }`. El panel lista los avisos con su estado y fecha. Si la lista está vacía, texto de vacío; no una tabla muda. |

#### `CIT-AVI-02` — Un aviso fallido y su reintento aparecen los dos

| | |
|---|---|
| **ID** | `CIT-AVI-02` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Un reminder fallido y su reintento |
| **Pasos** | 1. Observar la bitácora.<br>2. Identificar el par fallido/reintento. |
| **Esperado** | Aparecen **ambos** registros, no uno sobrescrito por el otro. Es lo que promete el texto del panel: `Un aviso fallido y su reintento aparecen los dos`. |

#### `CIT-AVI-03` — Reintentar un aviso

| | |
|---|---|
| **ID** | `CIT-AVI-03` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Un reminder con error |
| **Pasos** | 1. Buscar la acción de reintento en la fila.<br>2. Accionarla.<br>3. Observar Network y la bitácora. |
| **Esperado** | `POST /api/reminders/:id/retry` responde `200`. Aparece un registro nuevo en la bitácora con el resultado del reintento. Si la acción no existe en la UI, es API sin interfaz: documentado como `R-11`. |

#### `CIT-AVI-04` — Límite de la bitácora

| | |
|---|---|
| **ID** | `CIT-AVI-04` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | Más de 100 reminders |
| **Pasos** | 1. Observar cuántas filas pinta `#avisos`.<br>2. En Network, ver el `limit` solicitado. |
| **Esperado** | Pinta como máximo 100 filas (`limit=100`, tope del servidor 500). No hay paginador ni aviso de que hay más. Documentado como `R-12`. |

### 4.8 Configuración

#### `CIT-CFG-01` — Leer la configuración

| | |
|---|---|
| **ID** | `CIT-CFG-01` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Clic en **Configuración**.<br>2. Comparar los campos con `GET /api/settings`. |
| **Esperado** | `#timezone`, `#currency`, `#reminderHours` y `#emailEnabled` reflejan lo guardado. Si la organización no tiene fila propia, salen los valores por defecto: `America/Santiago`, `$`, `12`, sin marcar. |

#### `CIT-CFG-02` — Guardar la configuración

| | |
|---|---|
| **ID** | `CIT-CFG-02` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Sesión con rol **`admin`**. Con `member` se espera `403`. |
| **Pasos** | 1. Cambiar `#currency` a `€` y `#reminderHours` a `24`.<br>2. **Guardar cambios**.<br>3. En Network, leer la respuesta.<br>4. Recargar la página. |
| **Esperado** | `PUT /api/settings` responde `200` con `{ "settings": … }`. Tras recargar, los valores persisten **y** el símbolo de moneda nuevo se usa en la columna `Total` de la agenda. La propagación de la moneda es parte del contrato. |

#### `CIT-CFG-03` — La zona horaria cambia los cortes del día

| | |
|---|---|
| **ID** | `CIT-CFG-03` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Huso del navegador distinto al del taller. Con la cita de D6 a las 22:00. |
| **Pasos** | 1. Cambiar `#timezone` a una zona tres horas al oeste de la del navegador.<br>2. Guardar.<br>3. Volver a la agenda y mirar la cita de las 22:00.<br>4. Restaurar la zona original. |
| **Esperado** | La misma cita aparece en un día distinto y con una hora de pared distinta, coherentes con la zona nueva. Si no cambia nada, `settings.timezone` se está ignorando: es el bug `P0` que ya se corrigió y este caso lo vigila. |

#### `CIT-CFG-04` — Zona horaria inválida

| | |
|---|---|
| **ID** | `CIT-CFG-04` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Rol `admin` |
| **Pasos** | 1. Escribir `No/Existe/Zone` en `#timezone`.<br>2. Guardar.<br>3. Leer el error. |
| **Esperado** | `400` con un mensaje que diga qué está mal, no un error genérico. El mensaje debe ser legible por una persona, no el nombre de una excepción de `Intl`. La configuración anterior **no** se modifica. |

#### `CIT-CFG-05` — Campos de configuración fuera de rango

| | |
|---|---|
| **ID** | `CIT-CFG-05` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Rol `admin` |
| **Pasos** | 1. `#reminderHours` = `-1`.<br>2. `#reminderHours` = `1000`.<br>3. `#currency` vacío. |
| **Esperado** | El navegador bloquea 1 y 2 por `min="0" max="720"`. En 3, `required` y `minlength` impiden enviar. Si alguno llegara al servidor: `400`. El error se muestra en el `p` con `data-err`. |

#### `CIT-CFG-06` — Un member no puede guardar la configuración

| | |
|---|---|
| **ID** | `CIT-CFG-06` |
| **Tipo / Prioridad** | `SIST` · `P0` |
| **Precondición** | Sesión con rol `member` |
| **Pasos** | 1. Entrar a Configuración.<br>2. Cambiar `#currency` y guardar. |
| **Esperado** | `403` con `{ "error": "rol-insuficiente", "necesario": "admin", "actual": "member" }`. **La UI no oculta el formulario**: hay que anotar si el usuario ve un botón que siempre va a fallar. |

### 4.9 API

#### `CIT-API-01` — La agenda acepta filtros

| | |
|---|---|
| **ID** | `CIT-API-01` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. `GET /api/agenda?from=&to=&staffId=<id>`, luego con `status=confirmed`.<br>2. Con los dos filtros juntos.<br>3. Con `from` posterior a `to`. |
| **Esperado** | 1 y 2. `200` con solo las citas que cumplen los filtros. 3. `400` con `El rango de fechas está al revés`. |

#### `CIT-API-02` — La agenda sin filtros tiene un rango por defecto

| | |
|---|---|
| **ID** | `CIT-API-02` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. `GET /api/agenda` sin parámetros. |
| **Esperado** | `200` con el rango por defecto: desde ayer hasta dentro de 7 días. Ojo: ese rango se construye con `new Date()` del **servidor**, no con la zona de la organización (`routes.ts:473-474`). Es una inconsistencia frente a `CIT-AGEN-08`: documentado como `R-13`. |

#### `CIT-API-03` — El resumen respeta la zona

| | |
|---|---|
| **ID** | `CIT-API-03` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | `CIT-AGEN-08` |
| **Pasos** | 1. Con una cita a las 23:30 hora del taller, `GET /api/resumen`.<br>2. Comparar `hoy` con `futuras`. |
| **Esperado** | `hoy` incluye esa cita, `futuras` también. El corte de `hoy` es la medianoche de la **zona del taller**, no la de UTC. Es el criterio que se corrigió: `porConfirmar` cuenta `pending` y se excluyen `cancelled` y `no_show`. |

#### `CIT-API-04` — Crear cita devuelve 201 y el total calculado

| | |
|---|---|
| **ID** | `CIT-API-04` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | D1, D2, D3 |
| **Pasos** | 1. `POST /api/appointments` con cliente, profesional, `startAt`, `endAt` y `serviceId`.<br>2. Leer el cuerpo de la respuesta. |
| **Esperado** | `201` con la cita creada y `totalCents` calculado en el servidor a partir del precio del servicio. El total **no** lo manda el cliente. Determinar si mandarlo se ignora o se acepta: es un caso de manipulación de precio. |

#### `CIT-API-05` — Solapamiento rechazado

| | |
|---|---|
| **ID** | `CIT-API-05` |
| **Tipo / Prioridad** | `FUNC` · `P0` |
| **Precondición** | Una cita existente con profesional `X` de 10:00 a 11:00 |
| **Pasos** | 1. `POST` otra cita con el mismo profesional de 10:30 a 11:30.<br>2. Repetida con el mismo profesional pero **otro** cliente.<br>3. Repetida con el mismo horario pero **otro** profesional.<br>4. Repetida con el mismo profesional de 11:00 a 12:00. |
| **Esperado** | 1 y 2. Rechazada: el solapamiento no depende del cliente. 3. Aceptada: son profesionales distintos. 4. Aceptada: tocar el borde no es solaparse. El código de error es estable y el mensaje legible. |

#### `CIT-API-06` — Estados válidos e inválidos

| | |
|---|---|
| **ID** | `CIT-API-06` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Crear cita con cada estado de `#c-estado`.<br>2. `POST` con `status: "inventado"`. |
| **Esperado** | 1. Los cinco estados (`confirmed`, `pending`, `done`, `cancelled`, `no_show`) se aceptan. 2. `400` con `Datos inválidos`. |

#### `CIT-API-07` — Validación de la zona horaria en la API

| | |
|---|---|
| **ID** | `CIT-API-07` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Rol `admin` |
| **Pasos** | 1. `PUT /api/settings` con `timezone: "America/Nowhere"`.<br>2. Repetida con `timezone: ""`. |
| **Esperado** | Ambas `400`. El mensaje nombra el campo. Un `timezone` vacío borraría la configuración del taller si pasara: es el caso crítico. |

#### `CIT-API-08` — Aislamiento entre organizaciones

| | |
|---|---|
| **ID** | `CIT-API-08` |
| **Tipo / Prioridad** | `SIST` · `P0` |
| **Precondición** | Dos organizaciones distintas, con una cita propia cada una |
| **Pasos** | 1. Con sesión de la organización A, `GET /api/appointments`.<br>2. Con la de A, pedir el `id` de una cita de B.<br>3. Con la de A, `PATCH` esa cita de B. |
| **Esperado** | 1. Solo las citas de A. 2 y 3. `404`, nunca `200` con datos ajenos. `organizationId` sale del token verificado, nunca del cuerpo. |

#### `CIT-API-09` — `GET /api/availability` sin interfaz

| | |
|---|---|
| **ID** | `CIT-API-09` |
| **Tipo / Prioridad** | `EXP` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. `GET /api/availability` con los parámetros que el endpoint acepte.<br>2. Buscar en toda la UI una grilla de horarios disponibles.<br>3. Buscar en `app.js` la cadena `availability`. |
| **Esperado** | El endpoint responde `200` con horas disponibles. **La UI no lo llama en ningún momento**: no hay ninguna llamada a `/api/availability` en `app.js`. Es una funcionalidad construida y no expuesta: documentado como `R-14`. |

#### `CIT-API-10` — `/api/appointments/:id/servicios` sin interfaz

| | |
|---|---|
| **ID** | `CIT-API-10` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | Una cita con servicio asignado |
| **Pasos** | 1. `GET /api/appointments/:id/servicios`.<br>2. Buscar en la UI dónde se muestran los servicios de una cita. |
| **Esperado** | Responde con los servicios de la cita. La UI no lo llama y la tabla de agenda no tiene columna de servicios. Documentado como `R-15`. |

---

## 5. Recorridos E2E

#### `CIT-E2E-01` — Agendar una cita de punta a punta

| | |
|---|---|
| **ID** | `CIT-E2E-01` |
| **Tipo / Prioridad** | `E2E` · `P0` |
| **Precondición** | D1, D2, D3, D4. Sesión `member`. |
| **Pasos** | 1. Anotar los cuatro números de `#resumen`.<br>2. Clic en **Nueva cita** (`#nueva`).<br>3. Elegir cliente, profesional, fecha de hoy, `10:00`-`11:00`, y el servicio `QA Corte`.<br>4. Confirmar que `#c-precio` se rellenó solo.<br>5. Clic en **Agendar**.<br>6. Observar `#aviso`, `#dia` y `#resumen`. |
| **Esperado** | El diálogo abre con los tres selectores poblados. `#c-precio` vale `12000` sin que nadie lo escriba. `201`. Banner `Cita agendada`. La fila aparece en `#dia` con el total `$ 120` y **no** `$ 0`. `#resumen` sube `hoy` y `futuras` en 1. Si el precio aparece en `$ 0`, el campo no se heredó del catálogo. |

#### `CIT-E2E-02` — Crear cliente y usarlo de inmediato

| | |
|---|---|
| **ID** | `CIT-E2E-02` |
| **Tipo / Prioridad** | `E2E` · `P0` |
| **Precondición** | Sesión `member` |
| **Pasos** | 1. **Nuevo cliente** (`#nuevo-cli`) → crear `QA Inmediato` → **Guardar**.<br>2. Clic en **Nueva cita**.<br>3. Abrir `#c-cliente`. |
| **Esperado** | El cliente recién creado está en el selector sin recargar la página. Este recorrido es el que fallaba en producción: el alta se confirmaba pero el selector quedaba mudo. |

#### `CIT-E2E-03` — Un día completo de taller

| | |
|---|---|
| **ID** | `CIT-E2E-03` |
| **Tipo / Prioridad** | `E2E` · `P1` |
| **Precondición** | D4, D5, D6 |
| **Pasos** | 1. Abrir la agenda.<br>2. Recorrer las citas en orden horario.<br>3. Cambiar al día del bloqueo.<br>4. Intentar meter una cita dentro del bloqueo.<br>5. Intentar meter una cita que se pise con una existente. |
| **Esperado** | Las citas salen en orden. El bloqueo se respeta. Los dos intentos fallan con error visible en `#c-error` y **el formulario conserva lo que el usuario escribió** para corregir y reintentar. Verificar esto último: si el error borra los campos, el reintento obliga a reescribir todo. |

#### `CIT-E2E-04` — Agenda completa desde cero, sin catálogos

| | |
|---|---|
| **ID** | `CIT-E2E-04` |
| **Tipo / Prioridad** | `E2E` · `P0` |
| **Precondición** | Organización **sin** clientes, servicios ni profesionales. Sesión `member`. |
| **Pasos** | 1. Cargar la página.<br>2. Clic en **Nueva cita**.<br>3. Observar el diálogo. |
| **Esperado** | El diálogo **abre igual**. Los selectores muestran una fila explicando que no hay nada que elegir y quedan deshabilitados, en vez de estar mudos. El resto de la app es usable: se pueden crear catálogos desde cero. Este recorrido es el que fallaba en producción: la aplicación lanzaba antes de `showModal()` y el botón no hacía nada. |

#### `CIT-E2E-05` — Ciclo completo de configuración

| | |
|---|---|
| **ID** | `CIT-E2E-05` |
| **Tipo / Prioridad** | `E2E` · `P1` |
| **Precondición** | Rol `admin` |
| **Pasos** | 1. Cambiar la zona horaria y guardar.<br>2. Cambiar la moneda y guardar.<br>3. Recargar la página.<br>4. Agendar una cita.<br>5. Mirar el día, la hora y el total. |
| **Esperado** | La zona persiste y cambia los cortes del día. La moneda persiste y se ve en el total de la agenda. No hay que tocar nada más para que el cambio tenga efecto en toda la app. |

---

## 6. Regresión compartida

Cada caso se repite en los nueve productos. Los criterios concretos de Citas están aquí.

| | |
|---|---|
| **ID** | `CIT-REG-01` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Sesión iniciada, pestaña cerrada en `about:blank` |
| **Pasos** | 1. Navegar al producto por el subdominio, **no** por URL con `?panel=`.<br>2. Clic en cada pestaña del canal, una por una, esperando a que cada una cargue.<br>3. Contar en Network las peticiones por pestaña.<br>4. Repetir con la flecha **atrás** del navegador. |
| **Esperado** | Cada pestaña dispara **al menos una** petición a `/api/`. Ninguna queda en blanco. Con `?panel=` funciona, pero el clic tiene que funcionar también: el síntoma del bug era que el producto parecía sano si se entraba por URL. En Citas los siete paneles dan datos: agenda, clientes, servicios, profesionales, horarios, avisos, configuración. |

| | |
|---|---|
| **ID** | `CIT-REG-02` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Al menos dos paneles con datos |
| **Pasos** | 1. Ir a Clientes.<br>2. Ir a Servicios.<br>3. Volver a Clientes con la flecha atrás.<br>4. Adelante. |
| **Esperado** | Los cuatro pasos pintan datos. `popstate` recarga igual que el clic. Un panel vacío tras navegar es una regresión de `amigo.js`. |

| | |
|---|---|
| **ID** | `CIT-REG-03` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Al menos un catálogo con datos |
| **Pasos** | 1. Entrar a cada pestaña y leer la barra de errores del navegador.<br>2. Filtrar la consola por `error`. |
| **Esperado** | Cero errores. Un `Cannot read properties of undefined` al cambiar de panel es exactamente el defecto que ya se corrigió. |

| | |
|---|---|
| **ID** | `CIT-REG-04` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Abrir un panel cualquiera.<br>2. Mirar las cabeceras de `<script>` en `view-source`.<br>3. Comprobar el orden. |
| **Esperado** | `/amigo-ui.js` → `/amigo.js` → `/app.js`, en ese orden y como scripts clásicos. `app.js` depende de `AMIGO_UI` y de `AMIGO`; si se agrega `defer` a uno solo, `AMIGO.montar` no existe todavía. |

| | |
|---|---|
| **ID** | `CIT-REG-05` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Sesión iniciada hace más de 15 minutos |
| **Pasos** | 1. Dejar expirar la sesión.<br>2. Intentar usar un formulario.<br>3. Observar la respuesta y la barra de direcciones. |
| **Esperado** | `401 {"error":"sin-sesion"}` y redirección al login del Core. Al volver a entrar, la app funciona. **No** es un defecto del producto. Lo que sí es un defecto es que al volver no se repinte el panel: comprobarlo. |

| | |
|---|---|
| **ID** | `CIT-REG-06` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Ampliar el panel del canal.<br>2. Verificar que aparece la lista de las otras herramientas.<br>3. Confirmar que el nombre de la empresa y del usuario aparecen en el pie. |
| **Esperado** | El pie muestra usuario, correo y avatar. `Mis otras herramientas` se rellena con los productos a los que la organización tiene acceso. Ninguno de los dos falla en silencio si el Core no responde. |

---

## 7. Riesgo conocido

Defectos y candidatos a defecto detectados al leer el código. **No están confirmados en ejecución**:
esa es la razón de existir este plan.

| # | Severidad | Hallazgo | Dónde | Cómo se confirma |
|---|---|---|---|---|
| `R-01` | Alta | La agenda **no tiene columna de acciones**. `PATCH /api/appointments/:id` responde `200` pero nada en la UI lo llama; `DELETE` da `404`. Editar y cancelar una cita es imposible desde la interfaz. | `app.js:252-280` (tabla de 5 columnas) | `CIT-AGEN-12`, `CIT-E2E-03` |
| `R-02` | Media | Sin paginación en ningún panel: `limit=200` en catálogos (`app.js:211-213`) y `limit=100` en avisos (`app.js:351`). El `total` viene en la respuesta y se descarta. Pasado el registro, las filas desaparecen sin aviso. | `app.js` | Crear 201 clientes y contar filas |
| `R-03` | Media | La búsqueda de la agenda (`#buscar`) es de cliente y solo sobre el día cargado; no dispara peticiones. El texto del campo sugiere búsqueda global. | `app.js:242-248` | `CIT-AGEN-06` |
| `R-04` | Media | El campo `#srv-precio` se etiqueta `Precio` sin decir la unidad, mientras la tabla muestra pesos. Una persona que copie un precio mostrado a laeditor lo multiplica por 100. La tabla de agenda no tiene el mismo problema porque el total viene del servidor. | `index.html:385` | `CIT-SRV-04` |
| `R-05` | Baja | No hay deduplicación de clientes: crear uno idéntico devuelve `201`. | `crudRouter` de clientes | `CIT-CLI-06` |
| `R-06` | Baja | `crudRouter` de clientes se declara con `archive: true`, pero no hay UI para archivar y la tabla no distingue activo de archivado. Un cliente archivado sigue apareciendo y se puede seguir usando en una cita. | `routes.ts:984` | `CIT-CLI-07` |
| `R-07` | Baja | `services.active` existe en el esquema y el `PATCH` lo acepta, pero no hay UI para activar o desactivar. Igual para `staff.active`. | `routes.ts:1011,1031` | `CIT-SRV-05` |
| `R-08` | Baja | `staff.color` se guarda pero hay que determinar si se usa para pintar algo en la agenda. | `routes.ts:1030` | `CIT-PER-03` |
| `R-09` | Baja | `color` se valida con `max(9)` sin comprobar que sea un color, así que admite texto arbitrario. | `routes.ts:1030` | `CIT-PER-04` |
| `R-10` | Media | Los borrados de bloqueos y de clientes no pasan por `confirm()`, mientras que otras acciones destructivas del monorepo sí lo hacen. Hay que confirmar el caso de cada uno. | `app.js`, bloqueos | `CIT-BLO-04` |
| `R-11` | Media | `POST /api/reminders/:id/retry` existe y responde, pero hay que determinar si la bitácora ofrece la acción de reintentar. Si no, la API está sin interfaz. | `routes.ts:909` | `CIT-AVI-03` |
| `R-12` | Baja | La bitácora pide `limit=100` sin paginador; el servidor admite hasta 500. | `app.js:351` | `CIT-AVI-04` |
| `R-13` | Media | `GET /api/agenda` sin `from`/`to` construye el rango por defecto con `new Date()` del servidor, sin pasar por la zona de la organización. Es inconsistente con el resto del producto, que sí usa la zona del taller. | `routes.ts:473-474` | `CIT-API-02` |
| `R-14` | Media | `GET /api/availability` está implementado y responde, pero **ninguna** parte de la UI lo llama. Una función de disponibilidad completa, sin exponer. | `routes.ts:133`; `app.js` sin la cadena `availability` | `CIT-API-09` |
| `R-15` | Baja | `GET /api/appointments/:id/servicios` existe sin uso en la UI. La agenda no muestra qué servicios tiene cada cita. | `routes.ts:866` | `CIT-API-10` |
| `R-16` | Media | Responsive roto a 390 px: `.ui-canal` declara `grid-area: canal` pero las `grid-template-areas` móviles de `.ui` no definen `canal`, así que el item cae en la grilla implícita. Medido: `grid-template-columns: 350.4px 0px 132.137px` y `scrollWidth` 482 px en un viewport de 390 px. El canal queda cortado y sin hamburguesa. | `packages/product-runtime/public/amigo.css:139,153` | `CIT-VIS-01` |
| `R-17` | Media | Contraste 4.49:1 con el color de marca `#c2571a`, apenas bajo el mínimo 4.5:1. Afecta al logo y al botón **Nueva cita**. | `public/style.css` | `CIT-VIS-06` |
| `R-18` | Baja | Los `<dialog>` (`#dlg`, `#dlg-cli`, `#dlg-srv`, `#dlg-per`) no tienen `aria-label` ni `aria-labelledby`, y sus `<h2>` no tienen `id`. Sin nombre accesible. | `index.html:276,339,369,397` | `CIT-VIS-07` |
| `R-19` | Baja | Sin `meta description`, `favicon.ico` da `404`, sin CSP. HSTS, `nosniff`, `frame-options`, `referrer-policy` y cookie `HttpOnly` sí están. | `index.html:1-18` | `CIT-VIS-08` |
| `R-20` | Baja | El mensaje de solapamiento puede incluir el ISO crudo. Hay que confirmar que sea hora legible. | `routes.ts`, `guardarCita` | `CIT-E2E-03` paso 5 |
| `R-21` | Baja | La UI exige Cliente (`required`) pero la API acepta `customerId: null`. Un cliente sin agendar se crea por API y aparece como `Sin cliente`. | `index.html:287` vs esquema | `CIT-AGEN-10` |
| `R-22` | Baja | `PUT /api/settings` exige `admin` pero el formulario de Configuración **no se oculta** a un `member`: el usuario ve un botón que siempre responde `403`. | `routes.ts:943` | `CIT-CFG-06` |
| `R-23` | Media | Un fallo de refresco tras un alta exitoso se reportaba como alta fallida. Verificar que un `POST` exitoso seguido de un `GET` que falla muestra **éxito**, no error. | `app.js:724,747,769` | Probar con la red cortada tras el `POST` |

---

## 8. Checklist visual

| # | Qué | Cómo | Esperado |
|---|---|---|---|
| `CIT-VIS-01` | Sin desborde horizontal a 390 px | `document.documentElement.scrollWidth` con viewport 390 × 844 | `<= 390`. Hoy mide 482: **falla**. |
| `CIT-VIS-02` | Todas las secciones alcanzables en móvil | Recorrer el canal en 390 px | Hay forma de llegar a las 7; hoy el canal está cortado |
| `CIT-VIS-03` | Formularios dentro del viewport | Medir cada campo del diálogo a 390 px | Ninguno con `scrollWidth > 390` |
| `CIT-VIS-04` | La agenda no rompe el layout a 1280 px | Viewport 1280 × 800 | Sin scroll horizontal en la tarjeta de la agenda |
| `CIT-VIS-05` | Diálogos centrados y con foco | Abrir `#dlg` con teclado | El foco entra al abrir y vuelve al botón que lo abrió |
| `CIT-VIS-06` | Contraste de la marca | Medir `#c2571a` sobre el fondo de la página | `>= 4.5:1`. Hoy mide 4.49:1 |
| `CIT-VIS-07` | Los diálogos tienen nombre accesible | Inspeccionar `<dialog>` | `aria-label` o `aria-labelledby`. Hoy ninguno |
| `CIT-VIS-08` | Metadatos del documento | `<head>` y pestaña del navegador | `meta description` presente y pestaña con favicon |
| `CIT-VIS-09` | Consola limpia | Panel de consola, filtro `error` | Cero errores en todo el recorrido |
| `CIT-VIS-10` | Una petición por acción | Panel Network durante el recorrido | Una por cambio de pestaña, una por alta, una por guardado |

---

## 9. Registro

**Primera vuelta transversal · 2026-10-06 · producción `*.amgdeveloper.cl` · SSO `demo@talleres.com` (owner).** Solo casos ejecutados; el resto queda vacío. Transversal: `docs/qa/10-regresion-compartida.md` §9.

| ID | Resultado | Evidencia | Nota |
|---|---|---|---|
| CIT-CLI-01 | FALLA | Clic en pestaña Clientes → 0 peticiones `/api/`; `<div id="clientes"></div>` vacío, sin estado de vacío. `GET /api/customers` (fresh) devuelve 200 con 18 items y no se renderiza | Regresión original viva en producción (shell corre `app.js` distinto al local, que sí tiene `alEntrar`). `?panel=clientes` tampoco pinta. |
| CIT-CLI-02 | PASA | `POST /api/customers` → 201 fila completa (`id` `cicliente_03dcc3915d494e23a5dc`, `organizationId`, `archivedAt:null`); `GET /api/customers/<id>` devuelve la misma fila | Creado `QA Compartido` en esta vuelta. |
| CIT-CLI-03 | PARCIAL | `#dlg` (Nueva cita) abre centrado, foco en `button.ui-cerrar` (dentro), Esc cierra | **Body sin scroll-lock** (`overflow:visible`) → fondo desplazable bajo el diálogo. |
| CIT-CFG-01 | PASA | `GET /api/settings` → `timezone: "America/Mexico_City"`, `currency: "CLP"` | Resuelve D2: navegador `America/Santiago` ≠ org. |
| CIT-E2E-02 | PASA | Cliente creado en Citas (`201`); aparece en el listado al recargar el panel | Flujo crear → usar verificado a nivel de API/listado (no de UI por el defecto CIT-CLI-01). |
| CIT-API-03 | FALLA | `AMIGO_UI.fecha('2026-10-06T04:00:00Z', true, 'America/Mexico_City')` = "6 oct 2026 01:00 a. m." (zona del navegador); esperado "5 oct 22:00" | El tercer argumento de zona **no funciona** en el bundle desplegado. P0; equivale a REG-UI-04. |
| REG-NAV-01 | FALLA | Ver Doc 10 | 0 requests/clic; paneles vacíos. |
| REG-SES-07 | FALLA | Ver Doc 10 | `Salir` → core `/api/logout` 404; sesión sigue viva. |