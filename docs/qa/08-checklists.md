# Plan de pruebas - Checklists

> Producto `checklists` sobre el runtime compartido. Documento escrito para que alguien con
> Chrome DevTools pueda ejecutar cada caso sin volver a leer el código, y para que el
> resultado sea comparable con los planes de Pagos y de Activos.

## 1. Ficha técnica

| | |
|---|---|
| Producto | `checklists` |
| Nombre visible | `Checklists e Inspecciones` (`<title>Checklists e Inspecciones</title>`, `data-amigo="logo"` = `CI`, nombre que se pasa a `AMIGO.montar` = `Checklists`) |
| Descripción | Plantillas de inspección reutilizables (secciones + puntos con tipo de respuesta) y las **corridas** que las ejecutan. Cada corrida copia los puntos de su plantilla a un snapshot propio, se responde punto a punto, se le pueden adjuntar archivos y se cierra con un veredicto global. |
| Puerto | Desarrollo `PORT=3023` y `APP_URL=http://localhost:3023` (`products/checklists/.env.example:5,15`). Producción `127.0.0.1:3107:3000`, `APP_URL=https://checklists.amgdeveloper.cl`. El Core escucha en `3108`. |
| Ruta local | `products/checklists` · `npm run dev:checklists` · `npm test -w @amg/checklists` · `npm run typecheck -w @amg/checklists` |
| Base | `./data/checklists.sqlite`, `DB_SCHEMA_VERSION=2`. En tests, `:memory:` con una carpeta temporal para los adjuntos. La identidad **no** está acá: vive en el `core.sqlite` del Core. Sin fuente legacy: no hay `legacy_tenant_map` ni `migrate-legacy.ts`. |
| Schema | `templates`, `sections`, `template_items`, `runs`, `run_items`, `attachments`, `settings` (`products/checklists/src/schema.ts:83-389`; el mismo DDL en `src/ddl.ts`). `run_items.run_id` y `attachments.run_id` son `ON DELETE CASCADE`; `runs.template_id` es `ON DELETE SET NULL`. |
| Paneles | 4: `?panel=tablero` (por defecto), `?panel=plantillas`, `?panel=corridas`, `?panel=ajustes`. Grupos del canal: `Inspecciones` (Tablero, Plantillas, Corridas) y `Configuración` (Ajustes). |
| Rutas | `GET /health`, `POST /health`, `GET /api/meta`, `GET /api/me`, `GET /api/inicio`, `GET /api/dashboard` (545), `GET /api/templates` (687), `POST /api/templates` (736), `GET /api/templates/:id/estructura` (821), `GET /api/templates/:id/items` (840), `POST /api/templates/:id/items` (1017), `POST /api/templates/:id/sections` (858), `PATCH /api/templates/:id/sections/:sectionId` (897), `DELETE` de la misma (972), `POST /api/templates/sections/ordenar` (930), `PATCH /api/templates/:id/items/:itemId` (1103), `DELETE` de la misma (1178), `POST /api/templates/:id/duplicar` (1227), `GET /api/runs` (1314), `POST /api/runs` (1379), `GET /api/runs/:id/ficha` (1498), `POST /api/runs/:id/items/:position` (1574), `POST /api/runs/:id/completar` (1649), `PATCH /api/runs/:id` (1722), `POST /api/runs/:id/attachments` (1820), `GET /api/runs/:id/attachments/:attId/file` (1872), `DELETE /api/runs/:id/attachments/:attId` (1898), `DELETE /api/runs/:id` (1939), `GET /api/settings` (1967), `PUT /api/settings` (1986), y el `crudRouter` montado en `/api/templates` (2039) y `/api/runs` (2059). Todas las líneas son de `products/checklists/src/routes.ts` (2090 líneas). |
| Escrituras por el CRUD | Las **plantillas** escriben por el `crudRouter`: el `PATCH /api/templates/:id` (donde vive el toggle de `active`) y el `DELETE /api/templates/:id` (`deleteRole: 'admin'`, 2047) son los del CRUD, no rutas manuales. Las **corridas no**: su `DELETE` está escrito a mano en 1939, con limpieza de archivos en disco. |
| Identidad | SSO contra el Core. El producto **no** pide usuario ni clave, y sin sesión no se sirve ni el HTML. |
| Roles | Lectura: cualquiera con sesión. `requireRole('member')` en las 15 escrituras de la lista (737, 859, 898, 931, 973, 1018, 1104, 1179, 1228, 1380, 1575, 1650, 1723, 1821, 1899). `requireRole('admin')` en **solo dos** rutas: `DELETE /api/runs/:id` (1940) y `PUT /api/settings` (1987). |
| Convenciones | `docs/qa/00-CONVENCIONES.md`. Tipos `FUNC`, `E2E`, `REG`, `SIST`, `EXP`; prioridades `P0`, `P1`, `P2`. |
| Fuera de alcance | El Core y los otros productos, salvo `/health`, `/api/meta`, `/api/inicio` y `/api/me`. En particular `pagos`, que también lleva un selector de plantilla en la barra, pero es **cartera**: acá no hay un solo importe. |

Lo que este producto **no** tiene, y conviene fijar antes de empezar porque cambia lo que se
puede probar:

- **No hay dinero.** `settings.currency` existe y se guarda, pero no hay ningún importe que
  formatear: el propio HTML lo declara bajo el campo (`public/index.html:280`).
- **Los puntos que se ven en una ficha son los de la corrida, no los de la plantilla.** El
  snapshot se copia al empezar la corrida, así que editar la plantilla después no altera lo que
  ya se está respondiendo (`public/app.js:15-20`, y está cubierto por la suite).
- **Los números los pone el servidor.** Secciones y puntos se renumeran a `1..N` sin huecos
  después de cualquier borrado o reordenación; la pantalla no recalcula nada.
- **No hay paginación en la UI.** Las dos listas piden `limit=500` y no avisan que hay más
  (`R-05`).
- **El filtro de plantillas es del navegador**, aunque la API soporte y valide `active` como
  `0|1` (`R-05`).
- **No hay `seed`**: el producto arranca vacío y sin datos de ejemplo, a propósito
  (`src/app.ts:29-34`).

## 2. Datos de prueba

**Organización.** La propia, la de la sesión del Core. Nunca escribir el `organization_id` a
mano: sale de la identidad (`orgId(req)`), y mandarlo en el cuerpo es un `400 Campo desconocido`
(`routes.ts:239`).

**Plantillas.** Cuatro, con prefijo `QA-CK-` en el **nombre**. Las tres primeras se crean con el
formulario `Nueva plantilla`; la cuarta se crea en el paso 3 de las precondiciones pulsando
`Duplicar` sobre la primera, y no es un caso: `CHK-PLA-06` duplica otra plantilla justamente para
poder borrar la copia sin tocar el fixture.

| Nombre | Descripción | Activa | Estructura |
|---|---|---|---|
| `QA-CK-Apertura de faena` | `QA-CK revisa el frente antes de entrar` | sí | 2 secciones y 5 puntos (abajo) |
| `QA-CK-Recepcion de materiales` | `QA-CK entrada de bodega` | sí | 1 sección y 2 puntos |
| `QA-CK-Auditoria mensual` | (vacía) | no | 1 sección `General` **sin puntos**: es la plantilla vacía del plan |
| `QA-CK-Apertura de faena (copia)` | `QA-CK copia exacta de la primera` | sí | copia exacta de la primera |

La estructura de `QA-CK-Apertura de faena`, que es la que se usa en casi todos los casos:

| Sección | `position` | Texto del punto | Tipo | Obligatorio |
|---|---|---|---|---|
| `Condiciones de seguridad` | 1 | `Extintor con carga vigente` | `yes_no` | sí |
| `Condiciones de seguridad` | 2 | `Piso sin cables sueltos` | `yes_no` | sí |
| `Condiciones de seguridad` | 3 | `Equipo de proteccion completo` | `yes_no` | sí |
| `Equipo en sitio` | 1 | `Radio del jefe de turno` | `text` | sí |
| `Equipo en sitio` | 2 | `Cantidad de operarios en turno` | `number` | sí |

Son 5 puntos: tres `yes_no` y dos de valor, para que la ficha tenga los dos tipos de control y el
cálculo de cumplimiento tenga los tres `ok`/`fail`/`na` que necesita.

La `QA-CK-Recepcion de materiales` lleva los dos puntos que sirven para los otros dos tipos de
control, y uno de ellos sin marcar la obligatoriedad:

| `position` | Texto del punto | Tipo | Obligatorio |
|---|---|---|---|
| 1 | `Estado del material recibido` | `select` con `Bueno` / `Regular` / `Malo` | sí |
| 2 | `Etiqueta de bodega visible` | `yes_no` | **no** |

Ese punto 2 es el único opcional del plan: es el que se puede dejar sin responder al completar,
y el que `CHK-FIC-04` usa para comprobar que no bloquea el cierre.

La `QA-CK-Auditoria mensual` se crea con una sección `General` y **ningún** punto, a propósito:
sirve para el estado vacío del editor (`CHK-EDT-09`) y para el `400` de crear una corrida sin
puntos.

Se crean **una por una, con al menos un segundo entre cada una**, y en el orden de la tabla: el
listado ordena por `name` ascendente, y dos plantillas con el mismo `created_at` se ordenan por
nombre, no por fecha de creación.

**Corridas.** Cuatro, con `startedAt` fijo (por API), porque el tablero y el filtro de
`#fallos` ordenan por `startedAt` y no por `createdAt` (`routes.ts:608-640`).

| Plantilla | Lugar | Estado | `startedAt` | Respuestas | Para qué |
|---|---|---|---|---|---|
| `QA-CK-Apertura de faena` | `QA-CK Bodega 2` | en curso | `2026-08-10T15:00:00.000Z` | ninguna | el aviso `Faltan 5 punto(s) obligatorio(s)` y el `400` de completar |
| `QA-CK-Apertura de faena` | `QA-CK Faena norte` | completada | `2026-08-05T15:00:00.000Z` | 1 `Cumple`, 2 `Cumple`, 3 `No cumple`, 4 `Radio jefe: QA-CK Omar`, 5 `6` | cumplimiento `66.7`, veredicto derivado `observed`, y el único punto de `#fallos` |
| `QA-CK-Recepcion de materiales` | `QA-CK Patio central` | completada | `2026-07-20T15:00:00.000Z` | 1 `Bueno` (el `select`), 2 `Cumple` (el `yes_no` opcional) | cumplimiento `100`, veredicto `approved`, y el punto opcional sin responder no bloquea |
| (libre, sin plantilla) | `QA-CK Recinto chico` | en curso | `2026-07-01T15:00:00.000Z` | 3 puntos (2 obligatorios, 1 opcional), ninguna respondida | el título `Corrida libre` y la nota `plantilla borrada` (`R-03`) |

Las respuestas de la corrida `Faena norte` son: punto 1 `Cumple`, punto 2 `Cumple`, punto 3
`No cumple`, punto 4 (texto) `Radio jefe: QA-CK Omar`, punto 5 (número) `6`. Los puntos 4 y 5
**no** entran al cumplimiento: cuentan como respondidos, pero no son `ok` ni `fail`.

Los cálculos que deben salir:

- `/ficha` de la corrida `Bodega 2` -> `resumen` = `{total: 5, ok: 0, fail: 0, na: 0, respondidos: 0, pendientes: 5, pendientesRequeridos: 5, cumplimientoPct: null}`.
- `/ficha` de la corrida `Faena norte` -> `{total: 5, ok: 2, fail: 1, na: 0, respondidos: 5, pendientes: 0, pendientesRequeridos: 0, cumplimientoPct: 66.7}` y `run.result = "observed"` (derivado, no elegido: `veredictoDe` marca `observed` en cuanto hay un `fail`).
- `/ficha` de la corrida `Patio central` -> `{total: 2, ok: 1, fail: 0, na: 0, respondidos: 2, pendientes: 0, pendientesRequeridos: 0, cumplimientoPct: 100}` y `run.result = "approved"` (el punto `select` responde `Bueno`, que no cuenta para el cumplimiento; el único evaluado es el `yes_no`).
- `/ficha` de la corrida libre -> `{total: 3, ok: 0, fail: 0, na: 0, respondidos: 0, pendientes: 3, pendientesRequeridos: 2, cumplimientoPct: null}`.
- `GET /api/dashboard` con las cuatro corridas -> `{total: 4, porStatus: {in_progress: 2, done: 2, canceled: 0}, porResultado: {approved: 1, observed: 1, rejected: 0, sin: 2}, cumplimientoPromedioPct: 83.3, corridasCompletadasConsideradas: 2}` y `fallos` con **una** entrada.
- El `83,3` del promedio sale de promediar **por corrida**, no sobre los puntos: las dos cerradas dan `2/3 = 66,7` y `1/1 = 100`, y el promedio es `(66,6667 + 100) / 2 = 83,3` (`routes.ts:601-606`).

**Adjuntos.** Un archivo PDF chico, de menos de 750 KB, con nombre `QA-CK informe.pdf`, para
probar la subida, la descarga y el borrado. Se agrega a la corrida `Bodega 2` durante la vuelta.

**Ajustes.** Defaults del servidor: `currency = '$'` y `timezone = 'America/Santiago'`. Para
`CHK-AJU-01` se cambian a `CLP` y `Pacific/Kiritimati`, y **se restauran al final**.

Si alguno de estos números no cuadra, parar y anotarlo en la sección 9 antes de seguir: casi
siempre la causa es una corrida de una vuelta anterior que quedó sin borrar, o una plantilla
duplicada dos veces.
## 3. Precondiciones

1. **Sesión abierta en el Core** en `https://desarrollo.amgdeveloper.cl`, con el producto ya
   habilitado para la organización de pruebas. La sesión dura 15 minutos: si el producto
   redirige a `/api/sso/authorize`, hay que volver al Core y reintentar, no recargar la URL del
   producto.
2. **Dos identidades** para los casos de rol: una `member` (cualquiera de los usuarios de
   prueba) y una `admin`/`owner`. El rol llega por la cookie del Core y se lee en
   `GET /api/me`; el producto **no** lo guarda (`R-01`), así que para saber con qué rol se está
   probando hay que llamar a `/api/me` a mano y anotarlo en la sección 9.
3. **Datos sembrados** de la sección 2, en ese orden, y con las plantillas creadas primero: sin
   al menos una plantilla y una corrida, el tablero muestra ceros y los filtros no tienen nada
   que filtrar. La cuarta plantilla se obtiene aquí, y no durante los casos: pulsar `Duplicar` en
   la fila de `QA-CK-Apertura de faena` y comprobar que la fila nueva se llama
   `QA-CK-Apertura de faena (copia)`. A partir de acá hay **cuatro** plantillas y ese es el número
   que dan `CHK-PLA-01`, `CHK-PLA-02` y el filtro `#plantilla-filtro`.
4. **Sin datos de otra vuelta.** Todo lo que no empiece con `QA-CK-` en el nombre se considera
   ajeno: no se borra, no se cuenta y no se usa como referencia. Los `total` que usan los casos
   (`4` plantillas, `4` corridas) suponen el estado limpio de la sección 2: si un caso anterior
   dejó algo de más, los números se corren en la misma cantidad y hay que decirlo en la sección 9
   en vez de arreglar el caso.
5. **Limpieza al terminar cada vuelta**: borrar por API **todas** las plantillas y corridas cuyo
   nombre o lugar empiece con `QA-CK`, incluidas las que crean los casos (la copia de
   `CHK-PLA-06`, las corridas de `CHK-COR-03`, `CHK-FIC-04`, `CHK-E2E-01` y `CHK-E2E-03`), y
   después confirmar que `GET /api/templates` y `GET /api/runs` devuelven exactamente lo mismo que
   antes de sembrar. Borrar una plantilla es `DELETE /api/templates/:id` con rol `admin`; borrar
   una corrida, `DELETE /api/runs/:id`, que además borra `run_items` y los adjuntos en cascada.
   Los casos que dejan el fixture movido lo dicen al final de su bloque `Esperado`.
6. **Herramientas**: Chrome DevTools con Network abierto (filtro `api/`) y Console limpia. El
   producto no trae ni login ni seed: los datos entran por `fetch` desde la consola con la
   cookie de sesión.
7. **Límite conocido**: el filtro de plantillas y los desplegables de corrida filtran en el
   navegador, no en el servidor (`R-05`). Un caso que "pase" en la UI puede fallar si se
   comprueba la respuesta cruda de la API: son dos comportamientos distintos y se anotan por
   separado.

## 4. Casos por módulo

### 4.1 Tablero

| | |
|---|---|
| **ID** | CHK-TAB-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro corridas de la sección 2, con sus respuestas y sus `startedAt` fijos. |
| **Pasos** | 1. Abrir `/`.<br>2. Contar las tarjetas de `#resumen` y leerlas en orden.<br>3. Comparar con `GET /api/dashboard` en crudo.<br>4. Mirar qué tarjeta sale con el acento de color. |
| **Esperado** | `#resumen` lleva la clase `ui-rejilla ui-rejilla--4` y muestra **nueve** tarjetas, en este orden: `Corridas`, `En curso`, `Completadas`, `Canceladas`, `Aprobadas`, `Observadas`, `Rechazadas`, `Sin veredicto`, `Cumplimiento promedio`. Los valores son `total`, `porStatus.in_progress`, `porStatus.done`, `porStatus.canceled`, `porResultado.approved`, `porResultado.observed`, `porResultado.rejected`, `porResultado.sin` y `cumplimientoPromedioPct`. Con los datos de la sección 2: `4`, `2`, `2`, `0`, `1`, `1`, `0`, `2`, `83,3%`. **Solo la primera sale con acento de color**, porque es la única a la que `AMIGO_UI.kpis` recibe el tercer valor en `true` (`app.js:150`). El servidor arma **los cuatro estados y los cuatro veredictos aunque alguno dé cero**, para que la pantalla no encoja con la distribución del mes (`routes.ts:644-650`). |

| | |
|---|---|
| **ID** | CHK-TAB-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro corridas de la sección 2. |
| **Pasos** | 1. Leer la tarjeta `Cumplimiento promedio`.<br>2. Calcular a mano el promedio de las dos corridas completadas.<br>3. Repetir el cálculo sumando los puntos de todas las corridas, para ver si da lo mismo. |
| **Esperado** | La tarjeta vale **`83,3%`**, que es el promedio **por corrida** de las dos cerradas: `2/3 = 66,666…%` y `1/1 = 100%`, y `(66,6667 + 100) / 2 = 83,3` con un decimal (`routes.ts:601-606`). No vale `60%`, que es lo que sale de promediar los puntos sueltos (`3 ok / 5 evaluados`): una lista larga pesaría más que una corta y el número sería el promedio de una lista imaginaria. Las dos corridas **en curso no entran**: `cumplimientoPromedioPct` se arma solo con `status = 'done'`. En una organización sin corridas cerradas la tarjeta muestra **`-`**, no `0%`: `porcentaje(null)` devuelve el guion (`app.js:122-124`). |

| | |
|---|---|
| **ID** | CHK-TAB-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro corridas de la sección 2. |
| **Pasos** | 1. Leer la lista `#fallos`.<br>2. Anotar el título, la línea secundaria y cuántas entradas hay.<br>3. Comparar con `fallos` de `GET /api/dashboard`.<br>4. Abrir la ficha de la corrida del punto fallado y confirmar que el punto está marcado `No cumple`. |
| **Esperado** | Sale **una sola** entrada: `3. Equipo de proteccion completo`, con la línea `QA-CK-Apertura de faena · QA-CK Faena norte · <instante de 2026-08-05T15:00Z>`. El título se arma como `` `${f.position}. ${f.label}` `` (`app.js:177`) y la línea con plantilla, lugar e instante, **unidos por ` · ` y sin los vacíos** (`app.js:187`). Los puntos que son `ok`, `na`, los de texto/número/selección y los que no están respondidos **no aparecen**: la consulta filtra `run_items.result = 'fail'` (`routes.ts:619-629`). Las corridas se toman de las **10 más recientes por `startedAt`**, no por `createdAt` (`routes.ts:613-615`). El instante se imprime con `toLocaleString('es-CL')` **en la zona horaria del navegador**, sin aplicar `settings.timezone` (`app.js:115`, `R-04`), así que el texto exacto depende de la máquina: verificar solo el orden de la línea. Si `fallos` viene vacío, `#fallos` muestra el párrafo `No hay puntos fallados en las ultimas corridas` y **no** un guion (`app.js:165-168`). |

| | |
|---|---|
| **ID** | CHK-TAB-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Las cuatro corridas de la sección 2, y anotado el `runId` de `QA-CK Bodega 2`. |
| **Pasos** | 1. En `?panel=corridas`, responder `No cumple` al punto 1 de `QA-CK Bodega 2`.<br>2. Volver a `/`.<br>3. Leer `#fallos` y la tarjeta `En curso`. |
| **Esperado** | La corrida `Bodega 2` (que empezó el 10 de agosto) es la más reciente por `startedAt`, así que su punto 1 `No cumple` entra de cabeza a `#fallos`: salen **dos** entradas y la primera es `1. Extintor con carga vigente`, con línea `QA-CK-Apertura de faena · QA-CK Bodega 2 · …`. El orden de `fallos` es por `position` **dentro del conjunto de las 10 corridas**, no por fecha de corrida (`routes.ts:628`): el `position 1` de una corrida va antes que el `position 3` de otra, aunque la segunda sea más reciente. Las tarjetas no cambian: `En curso` sigue en `2`, porque responder no cambia el estado. Restaurar la respuesta a `Cumple` al terminar. |

| | |
|---|---|
| **ID** | CHK-TAB-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Las cuatro corridas de la sección 2. |
| **Pasos** | 1. En `?panel=corridas`, cancelar `QA-CK Bodega 2`.<br>2. Volver a `/` y leer las nueve tarjetas.<br>3. Cancelar también `QA-CK Recinto chico` y volver a `/`. |
| **Esperado** | Cancelar mueve la corrida de `in_progress` a `canceled`, sin tocar el veredicto: `En curso` baja de `2` a `1` y `Canceladas` sube de `0` a `1`, con `Corridas` siempre en `4`. `Aprobadas`, `Observadas`, `Rechazadas` y `Sin veredicto` **no se mueven**: `porResultado` cuenta por `runs.result`, y una corrida cancelada conserva el `result` que tuviera (`routes.ts:556-562`). Una corrida cancelada que nunca se completó sigue contando como `Sin veredicto`, porque `result` es `NULL` y eso es lo que cuenta `deResultado(null)`. Reabrir las dos corridas al terminar. |

| | |
|---|---|
| **ID** | CHK-TAB-06 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Una organización limpia, con el producto habilitado y sin ninguna corrida. |
| **Pasos** | 1. Abrir `/`.<br>2. Leer las nueve tarjetas y `#fallos`.<br>3. Registrar la primera corrida y volver a abrir `/`. |
| **Esperado** | Las nueve tarjetas muestran `0`, menos `Cumplimiento promedio`, que muestra **`-`**: `cumplimientoPromedioPct` es `null` cuando no hay corridas cerradas con algo evaluado (`routes.ts:605`), y la pantalla traduce ese `null` a guion en vez de imprimir `null%` (`app.js:123`). `#fallos` muestra `No hay puntos fallados en las ultimas corridas` en un `<p class="ui-vacio">` y **no** una tabla vacía ni un error: sin corridas, `recientes` viene vacío y la consulta de `fallos` ni siquiera se ejecuta (`routes.ts:617`). Con la primera corrida creada, `Corridas` pasa a `1` y `Cumplimiento promedio` **sigue en `-`**, porque una corrida en curso no tiene cumplimiento. |

### 4.2 Panel Plantillas

| | |
|---|---|
| **ID** | CHK-PLA-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro plantillas de la sección 2. |
| **Pasos** | 1. Abrir `?panel=plantillas`.<br>2. Contar las columnas y leer sus títulos.<br>3. Leer el orden de las filas.<br>4. Contar los botones de la última columna. |
| **Esperado** | La tabla tiene **4 columnas**: `Nombre`, `Descripcion`, `Estado` y una **última sin título** (la de acciones). El orden es **alfabético por nombre**, no por fecha de creación: sale `QA-CK-Apertura de faena`, `QA-CK-Apertura de faena (copia)`, `QA-CK-Auditoria mensual`, `QA-CK-Recepcion de materiales` (`orderBy asc(templates.name)`, `routes.ts:707`). La descripción vacía se rellena con **`—`**, no con hueco (`app.js:218`). La columna `Estado` lleva una etiqueta, no texto crudo: `Activa` en tono neutro y `Inactiva` igual, y el color lo pone `nota()`, que usa el tono `neutro` en los dos casos (`app.js:219`, `app.js:127`): **no hay forma de distinguir una plantilla inactiva de una activa por color**. La última columna trae **cinco** botones: `Puntos`, `Editar`, `Activar`/`Desactivar`, `Duplicar` y `Borrar` (`app.js:221-261`). |

| | |
|---|---|
| **ID** | CHK-PLA-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro plantillas de la sección 2. |
| **Pasos** | 1. Escribir `bodega` en `#plantilla-buscar`.<br>2. Contar las filas.<br>3. Vaciar el buscador y elegir `Solo activas` en `#plantilla-filtro`, y contar.<br>4. Elegir `Solo inactivas` y contar.<br>5. Repetir el paso 1 escribiendo `apertura` y contar.<br>6. Escribir `xyz-no-existe` y leer la tabla. |
| **Esperado** | 1: **0 filas** y la fila vacía `No hay plantillas que coincidan`, con `colspan` de 4 (`app.js:211`). Ninguna de las cuatro plantillas tiene `bodega` en el nombre ni en la descripción. 2: el buscador se filtra **en el navegador**, comparando en minúsculas contra `name` **y** `description` (`app.js:200-205`): con `Solo activas` salen `3` (las dos de apertura y `Recepcion de materiales`), con `Solo inactivas` sale `1` (`Auditoria mensual`), y con `Todas` `4`. 3: el filtro es de la pantalla, **no** de la API: la petición sigue siendo `GET /api/templates?limit=500` sin `active`, aunque la API sí soporte `?active=0|1` (`routes.ts:690-698`, `R-05`). 4: con `apertura` salen `2` filas (la original y la copia). 5: `xyz-no-existe` deja la fila vacía con el mismo texto, y **no** hay error ni aviso en `#aviso`. |

| | |
|---|---|
| **ID** | CHK-PLA-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`. |
| **Pasos** | 1. Pulsar `Nueva plantilla`.<br>2. Leer el título del diálogo, qué botón `Cancelar` hay y si `#plantilla-items` está habilitado.<br>3. Escribir `QA-CK Turno noche` en `#plantilla-nombre` y tres líneas en `#plantilla-items`: `Extintor cargado`, `Piso despejado*`, `Radio operativo`.<br>4. Enviar y esperar el aviso.<br>5. Abrir `Puntos` sobre la plantilla creada. |
| **Esperado** | El diálogo `#plantilla-dialog` abre con el título `Nueva plantilla`, `#plantilla-cancelar` **oculto** (solo existe editando, `app.js:298`) y `#plantilla-items` **habilitado**, porque en la creación los puntos iniciales sí se mandan en la misma llamada (`app.js:307`). 3: las tres líneas se convierten en tres puntos con `required = 1, 1, 0`, porque el `*` final marca el opcional (`puntosDesdeTexto`, `app.js:95-105`); las líneas vacías se descartan y el texto se recorta. 4: sale un `POST /api/templates` con `{name, description, items}`, el diálogo se cierra, el aviso verde dice `Plantilla creada` y la tabla muestra la fila nueva. El servidor escribe los tres puntos en **una sola sección `General`**, porque vinieron como `items` sueltos y no como `sections` (`routes.ts:748-762`). 5: el editor muestra **una** sección, `General`, con los tres puntos en orden y el `*` ya ausente del texto: `1. Extintor cargado`, `2. Piso despejado`, `3. Radio operativo`, con la línea `Si / No · obligatorio`, `Si / No · obligatorio`, `Si / No · opcional`. |

| | |
|---|---|
| **ID** | CHK-PLA-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | La plantilla `QA-CK-Apertura de faena`, con sus 2 secciones y 5 puntos. |
| **Pasos** | 1. En la fila de la plantilla, pulsar `Editar`.<br>2. Cambiar `#plantilla-nombre` a `QA-CK Apertura de faena v2` y `#plantilla-descripcion` a `QA-CK revisa el frente antes de entrar (v2)`.<br>3. Guardar y leer el aviso.<br>4. Pulsar `Puntos` y contar los puntos y las secciones.<br>5. Abrir el diálogo de nuevo y observar `#plantilla-items`. |
| **Esperado** | 1: el diálogo abre con el título `Editar plantilla`, `#plantilla-cancelar` **visible** y `#plantilla-items` **deshabilitado y vacío** (`app.js:299-307`): al editar no se reenvían los puntos, porque el editor de secciones es el que los maneja y reenviar el textarea pisaría lo que otra pestaña hubiera agregado. 3: sale un `PATCH /api/templates/:id` con `{name, description}` y el aviso verde `Plantilla actualizada`; el `PATCH` lo maneja el `crudRouter` del producto, no una ruta manual (`routes.ts:2039-2050`). 4: siguen siendo **2 secciones y 5 puntos**, con los mismos textos: cambiar el nombre no toca la estructura. 5: `#plantilla-items` sigue deshabilitado, para que no haya forma de mandar una lista de puntos desde la edición. Devolver el nombre a `QA-CK-Apertura de faena` al terminar. |

| | |
|---|---|
| **ID** | CHK-PLA-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | La plantilla `QA-CK-Apertura de faena`, activa. |
| **Pasos** | 1. Pulsar `Desactivar` en su fila.<br>2. Leer el aviso y la columna `Estado`.<br>3. Abrir `?panel=corridas` y leer `#corrida-plantilla` y `#corrida-plantilla-filtro`.<br>4. Volver a `?panel=plantillas` y pulsar `Activar`. |
| **Esperado** | 1: sale un `PATCH /api/templates/:id` con `{"active": 0}`, el aviso verde dice `Plantilla desactivada` y la columna `Estado` pasa a `Inactiva`. La plantilla **no desaparece** de la lista: desactivar es un filtro de uso, no un borrado (`app.js:227`). 3: **`#corrida-plantilla` pierde la plantilla** —solo llegan las activas, con la primera opción `Corrida libre (sin plantilla)`— mientras que `#corrida-plantilla-filtro` **la conserva**, porque ahí el filtro sí incluye las inactivas (`app.js:278-292`). Esa diferencia es deliberada: elegir una desactivada a propósito se hace filtrando la lista, no por accidente al empezar una corrida. 4: `Activar` la deja activa otra vez y vuelve a `#corrida-plantilla`. |

| | |
|---|---|
| **ID** | CHK-PLA-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La plantilla `QA-CK-Recepcion de materiales`, con 1 sección y 2 puntos, sin ninguna copia. La plantilla `QA-CK-Apertura de faena`, con sus 2 corridas. |
| **Pasos** | 1. Pulsar `Duplicar` en la fila de `QA-CK-Recepcion de materiales`.<br>2. Leer el aviso y el nombre de la fila nueva.<br>3. Pulsar `Puntos` en la copia y comparar secciones, puntos, textos, tipos y obligatorios.<br>4. Abrir `?panel=corridas` y contar las corridas de `QA-CK-Recepcion de materiales`.<br>5. En la consola, mandar `GET /api/runs?limit=500` y contar las que tienen `templateId` igual al de la original.<br>6. Pulsar `Duplicar` dos veces sobre la fila nueva y leer los nombres.<br>7. Borrar la copia y la doble copia por API. |
| **Esperado** | 2: sale un `POST /api/templates/:id/duplicar` con cuerpo `{}`, el aviso verde dice `Plantilla duplicada` y la fila nueva se llama **`QA-CK-Recepcion de materiales (copia)`**, con el sufijo exacto `' (copia)'` que agrega el servidor (`routes.ts:213,1241`) y que el cliente no elige. La copia nace **activa** aunque la original estuviera desactivada (`routes.ts:1243`). 3: la copia tiene la misma **1 sección** y los mismos **2 puntos** con idéntico `label`, `type`, `required` y `optionsJson`, pero con **ids nuevos** (`routes.ts:1250-1272`): el `position` de los dos puntos vuelve a ser `1` y `2`, aunque en la original el segundo sea el opcional. 4 y 5: las corridas **no se copian**. Siguen siendo **3** las que tienen `templateId` de `QA-CK-Apertura de faena` (Bodega 2, Faena norte y la de `CHK-COR-03`) y **1** la de `QA-CK-Recepcion de materiales`: clonar una corrida sería clonar un hecho que ocurrió (`routes.ts:1216-1224`). 6: la tercera sale **`QA-CK-Recepcion de materiales (copia) (copia)`**: el sufijo se **concatena** y no se cuenta ni se busca un nombre libre (`conSufijo`, `routes.ts:213-219`), así que dos duplicaciones sobre la misma base dan un nombre que parece un error de tipeo. 7: borrar la copia al terminar. |

| | |
|---|---|
| **ID** | CHK-PLA-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `admin`. La plantilla `QA-CK-Apertura de faena (copia)`, que no tiene ninguna corrida asociada. |
| **Pasos** | 1. Pulsar `Borrar` en su fila.<br>2. Leer el texto del `confirm`.<br>3. Confirmar y esperar el aviso.<br>4. Comprobar que la fila desapareció.<br>5. En la consola, mandar `GET /api/templates/<id>` y `GET /api/templates/<id>/estructura`.<br>6. Repetir los pasos 1 y 3 con `Cancelar` en el `confirm`. |
| **Esperado** | 2: el `confirm` dice exactamente **`Borrar la plantilla y sus puntos?`** (`app.js:250`). 3: sale un `DELETE /api/templates/:id`, el aviso verde dice `Plantilla borrada` y la fila desaparece. 5: `GET /api/templates/<id>` responde `404 {"error":"Esa plantilla no existe"}` y `/estructura` también: **borrar es borrar**, no archivar, así que a diferencia de Activos no queda forma de recuperarla (`routes.ts:381`, `2040-2050`). El mensaje dice `no existe` y no `es de otra empresa` a propósito: confirmar que el id existe en otra organización sería dar justo el dato que se le quiere negar (`routes.ts:379-381`). Los puntos de la plantilla se van con ella por `CASCADE` (`ddl.ts:70-73`). 6: con `Cancelar` no sale **ninguna** petición: el `return` ocurre antes del `api()` (`app.js:250`), y la plantilla sigue en la tabla. Al terminar hay que **volver a crearla** con `Duplicar` sobre `QA-CK-Apertura de faena`, como en el paso 3 de las precondiciones. |

| | |
|---|---|
| **ID** | CHK-PLA-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `member` y, en paralelo, una sesión de `admin`. La plantilla `QA-CK-Apertura de faena (copia)`. |
| **Pasos** | 1. Con `member`, abrir `?panel=plantillas` y contar los botones de `#plantillas-lista`.<br>2. Con `member`, pulsar `Borrar` sobre `QA-CK-Apertura de faena (copia)` y confirmar.<br>3. Leer la respuesta del `DELETE` en Network y el aviso en `#aviso`.<br>4. Comprobar que la plantilla sigue en la tabla.<br>5. Repetir el paso 2 con la sesión de `admin`. |
| **Esperado** | 1: el `member` ve los **cinco** botones, incluido `Borrar`: la pantalla nunca consulta `/api/me`, así que no sabe el rol (`app.js`, todo el archivo; `R-01`). 2 y 3: el `member` recibe **`403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`** y `#aviso` lo muestra en rojo con `necesito rol admin` o el texto del servidor; la plantilla **no** se borra. La garantía real es el `deleteRole: 'admin'` del `crudRouter` (`routes.ts:2047`), no la ausencia del botón. 4: la fila sigue ahí, con el aviso en rojo. 5: con `admin` el mismo `Borrar` sí funciona y desaparece la fila. Es el caso espejo de `R-01`: la UI promete y el servidor corrige. Recrear la copia con `Duplicar` al terminar. |

| | |
|---|---|
| **ID** | CHK-PLA-09 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Una organización limpia, sin ninguna plantilla. |
| **Pasos** | 1. Abrir `?panel=plantillas`.<br>2. Leer la tabla.<br>3. Escribir cualquier cosa en `#plantilla-buscar`.<br>4. Elegir `Solo inactivas` en `#plantilla-filtro`.<br>5. Pulsar `Nueva plantilla`, dejar `#plantilla-nombre` vacío y enviar el formulario. |
| **Esperado** | 2: la tabla muestra la fila vacía `No hay plantillas que coincidan` sobre 4 columnas. 3 y 4: el texto no cambia, porque sigue sin haber nada que coincida. 5: el navegador bloquea el envío por el `required` de `#plantilla-nombre` y aparece la validación nativa: **no sale ninguna petición**. Si se fuerza el envío con `novalidate`, el servidor responde `400` con el mensaje del `zod` sobre el nombre obligatorio (`parseCuerpo`, `routes.ts:224-243`). Un producto sin plantillas no muestra ninguna guía de "cómo crear la primera": solo el botón `Nueva plantilla` de la barra. |

### 4.3 Editor de plantilla

| | |
|---|---|
| **ID** | CHK-EDT-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro plantillas de la sección 2. |
| **Pasos** | 1. En `?panel=plantillas`, pulsar `Puntos` en `QA-CK-Apertura de faena`.<br>2. Leer `#plantilla-seleccionada`, el número y el nombre de cada sección.<br>3. Contar los puntos de cada sección y leer su línea de metadatos.<br>4. Leer las opciones de `#punto-seccion`.<br>5. Comprobar si `#punto-editar-form` está visible. |
| **Esperado** | 1: sale un `GET /api/templates/<id>/estructura`, `#plantilla-editor` se quita el `hidden` y la tarjeta hace `scrollIntoView` (`app.js:345-350`). 2: `#plantilla-seleccionada` dice `Puntos de QA-CK-Apertura de faena`, y las dos secciones salen numeradas **`1` `Condiciones de seguridad`** y **`2` `Equipo en sitio`**: los números los pone la API, ya renumerados `1..N` (`app.js:433-437`, `routes.ts:840-855`). 3: la primera tiene **3 puntos** (`1. Extintor con carga vigente`, `2. Piso sin cables sueltos`, `3. Equipo de proteccion completo`) y la segunda **2** (`1. Radio del jefe de turno`, `2. Cantidad de operarios en turno`). Los números **se reinician en cada sección**: hay dos `1` en pantalla, y no es un error. La línea de metadatos de cada punto es `Si / No · obligatorio`, `Texto · obligatorio` o `Numero · obligatorio`, con los textos de `TIPOS` (`app.js:59-64`). 4: `#punto-seccion` tiene **dos** opciones, `1. Condiciones de seguridad` y `2. Equipo en sitio`, con el formato `` `${i + 1}. ${s.name}` `` (`app.js:412-414`). 5: `#punto-editar-form` está **oculto**: los forms de edición arrancan ocultos y se abren con `Editar` (`app.js:467`). |

| | |
|---|---|
| **ID** | CHK-EDT-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Editor abierto en `QA-CK-Recepcion de materiales`, que tiene **1 sección y 2 puntos**. |
| **Pasos** | 1. Escribir `Equipo de emergencia` en `#seccion-nombre` y enviar `#seccion-form`.<br>2. Leer el aviso y contar las secciones.<br>3. Comprobar el número de la sección nueva y su nombre.<br>4. Comprobar `#punto-seccion`.<br>5. Intentar agregar un punto sin escribir nada en `#punto-label` y enviar. |
| **Esperado** | 1: sale un `POST /api/templates/<id>/sections` con `{"name":"Equipo de emergencia"}`, el aviso verde dice `Seccion agregada` y `#seccion-nombre` queda vacío (`app.js:532-539`). 2: la plantilla pasa de **1 a 2 secciones**: la nueva es la **última**, con `sort_order = max + 1` calculado dentro de la transacción (`routes.ts:866-871`). 3: sale numerada **`2`** y el número es el que el servidor devolvió, no un contador de la pantalla. 4: `#punto-seccion` suma `3. Equipo de emergencia` como tercera opción. 5: el `required` de `#punto-label` bloquea el envío y **no sale ninguna petición**; con `novalidate` el servidor responde `400` con el mensaje del `zod` para el `label` (`routes.ts:142-143`). Borrar la sección `Equipo de emergencia` al terminar (`CHK-EDT-05` usa el mismo botón) para dejar la plantilla con una sola sección. |

| | |
|---|---|
| **ID** | CHK-EDT-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Editor abierto en `QA-CK-Apertura de faena`. |
| **Pasos** | 1. Escribir un espacio en `#seccion-nombre` y enviar `#seccion-form`.<br>2. Escribir `  Equipo de emergencia  ` (con espacios) y enviar.<br>3. Escribir un nombre de 151 caracteres y enviar.<br>4. Renombrar la sección `Equipo en sitio` a `Equipo y comunicaciones` con `#seccion-renombrar-form`.<br>5. Recargar la página y comprobar si el nombre cambió.<br>6. Abrir la ficha de `QA-CK Bodega 2` y mirar el encabezado de la segunda sección de puntos. |
| **Esperado** | 1: el `trim()` del `zod` deja la cadena vacía y el servidor responde `400 Una seccion necesita un nombre` (`routes.ts:142`); el `#aviso` lo muestra en rojo y **no** se crea ninguna sección. 2: el nombre se guarda **recortado**: `Equipo de emergencia`. 3: 151 caracteres dan `400` por el `max(150)` de `sectionSchema` (`routes.ts:143`); el aviso lo muestra y la sección no se crea. 4: sale un `PATCH /api/templates/<id>/sections/<sectionId>` con `{"name":"Equipo y comunicaciones"}` y el aviso `Seccion renombrada`; solo se puede cambiar el nombre por esta vía, el orden tiene su propio endpoint (`routes.ts:893-896`). 5: tras recargar, el nombre nuevo **persiste** y las secciones conservan su orden. 6: la corrida `Bodega 2` **sigue mostrando `Equipo en sitio`**, no el nombre nuevo: la ficha agrupa por el `section` del **snapshot** guardado al crear la corrida (`app.js:876-887`), que es lo correcto: una plantilla que cambia hoy no puede reetiquetar lo que se estaba revisando ayer. |

| | |
|---|---|
| **ID** | CHK-EDT-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Editor abierto en `QA-CK-Apertura de faena`, con 2 secciones. |
| **Pasos** | 1. Pulsar `Bajar` en la sección `Condiciones de seguridad`.<br>2. Leer el aviso y el orden de las secciones.<br>3. Pulsar `Subir` en la que quedó segunda.<br>4. Pulsar `Subir` en la primera sección.<br>5. Pulsar `Bajar` en la última sección.<br>6. Comprobar si aparece algún aviso en `#aviso` en los pasos 4 y 5. |
| **Esperado** | 1 y 2: sale un `POST /api/templates/<id>/sections/ordenar` con el `order` **completo** y ya intercambiado (`[idEquipoEnSitio, idCondiciones]`, `app.js:476-491`); el aviso verde dice `Seccion movida` y las secciones quedan `1. Equipo en sitio`, `2. Condiciones de seguridad`. El cliente no mueve números en local: manda el orden nuevo entero y vuelve a preguntar, porque el servidor renumera en dos fases para no chocar con el `UNIQUE` de `sort_order` (`routes.ts:930-953`). 3: el orden vuelve al original. 4 y 5: **no sale ninguna petición y no hay aviso**: `moverSeccion` corta antes del `api()` cuando el destino está fuera de rango (`app.js:479-480`), así que en el borde ni hay error ni feedback; el botón `Subir` de la primera y el `Bajar` de la última no tienen `disabled`, así que se ven activos y no hacen nada. Es una deficiencia de UI, no un defecto de datos: el orden queda intacto. |

| | |
|---|---|
| **ID** | CHK-EDT-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Editor abierto en `QA-CK-Apertura de faena`. El `runId` de `QA-CK Bodega 2` anotado. |
| **Pasos** | 1. Pulsar `Borrar sección` en `Equipo en sitio`.<br>2. Leer el texto del `confirm`.<br>3. Cancelar y comprobar el estado.<br>4. Confirmar y leer el aviso.<br>5. Contar secciones y puntos de la sección 1.<br>6. Abrir la ficha de `QA-CK Bodega 2` y contar sus puntos y sus encabezados de sección. |
| **Esperado** | 2: el `confirm` dice **`Se borran la seccion y sus puntos de la plantilla. Las corridas quedan con su copia.`** (`app.js:504`). 3: con `Cancelar` no sale ninguna petición. 4: sale un `DELETE /api/templates/<id>/sections/<sectionId>` y el aviso verde dice **`Seccion borrada y renumerada`**. 5: queda **una** sección, la `1. Condiciones de seguridad`, con sus **3 puntos** intactos y numerados `1, 2, 3`: borrar una sección **no** renumera los puntos de las otras secciones, porque el `position` es por sección (`ddl.ts:70-73`). 6: la ficha de `Bodega 2` sigue mostrando **5 puntos** y los dos encabezados `Condiciones de seguridad` y `Equipo en sitio`: las corridas llevan su snapshot y no se tocan (`app.js:876-887`, `routes.ts:965-967`). Recrear la sección `Equipo en sitio` con sus dos puntos al terminar, o borrar la plantilla y volver a sembrarla. |

| | |
|---|---|
| **ID** | CHK-EDT-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Editor abierto en `QA-CK-Apertura de faena`. |
| **Pasos** | 1. En `#punto-seccion` elegir `2. Equipo en sitio`, escribir `Andamio certificate` en `#punto-label`, dejar `#punto-tipo` en `Si / No` y enviar `#punto-form`.<br>2. Leer el aviso y la posición del punto nuevo.<br>3. Cambiar `#punto-tipo` a `Seleccion` y observar `#punto-opciones-caja`.<br>4. Escribir `Bueno` y `Regular` en `#punto-opciones`, cambiar el texto a `Estado del andamio` y enviar.<br>5. Volver a elegir `Si / No` y observar `#punto-opciones-caja`.<br>6. Con el tipo `Seleccion` y `#punto-opciones` vacío, escribir un texto y enviar. |
| **Esperado** | 1: sale un `POST /api/templates/<id>/items` con `{label, required: 1, type: 'yes_no', sectionId}`, el aviso verde dice `Punto agregado` y `#punto-label` queda vacío (`app.js:587-592`). 2: el punto aparece como **`3. Andamio certificate`** en `Equipo en sitio`, con la línea `Si / No · obligatorio`; el `position` es el `max + 1` **de esa sección** calculado dentro de la transacción (`routes.ts:1020-1030`), así que la otra sección no se renumera. 3: `#punto-opciones-caja` se **descubre**: el `change` del selector lo muestra solo para `select` (`app.js:567-569`), porque en los demás tipos las opciones no significan nada. 4: sale el mismo `POST` con `options: ['Bueno','Regular']`, una opción por línea y sin líneas vacías (`opcionesDesdeTexto`, `app.js:108-113`); el punto queda `Seleccion · obligatorio` y `optionsJson` con el arreglo. 5: la caja se vuelve a **ocultar** al volver a `Si / No`, y lo que quedara escrito en `#punto-opciones` **no se manda**: el `cuerpo` solo incluye `options` si el tipo es `select` (`app.js:585`). 6: sale un `POST` con `type: 'select'` y **sin** `options`, y el servidor responde **`400 Un punto de seleccion necesita al menos una opcion`** (`routes.ts:151-156`); el aviso lo muestra en rojo y el punto **no** se crea. Un `select` sin opciones es un punto que no se puede responder, por eso se rechaza en vez de avisar. |

| | |
|---|---|
| **ID** | CHK-EDT-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Editor abierto en `QA-CK-Recepcion de materiales`, con su punto `select` de opciones `Bueno`, `Regular`, `Malo`. |
| **Pasos** | 1. Pulsar `Editar` en ese punto.<br>2. Cambiar `#punto-editar-label` a `Estado del equipo` y desmarcar `#punto-editar-required`.<br>3. Cambiar `#punto-editar-tipo` a `Texto` y observar `#punto-editar-opciones-caja`.<br>4. Guardar y leer el aviso.<br>5. Abrir de nuevo el `Editar` del punto y leer los cuatro campos.<br>6. Volver a poner el tipo en `Seleccion` y `#punto-editar-opciones` en `Bueno` solo, y guardar.<br>7. Con el punto ya en `Texto`, poner el tipo en `Seleccion` y `#punto-editar-opciones` vacío, y guardar. |
| **Esperado** | 1: `#punto-editar-form` se descubre precargado con el `label`, el `type`, el `required` marcado y las opciones una por línea (`app.js:387-398`); `#punto-editar-label` recibe el foco. 3: la caja de opciones se **oculta** al dejar de ser `select` (`app.js:571-573`). 4: sale un `PATCH /api/templates/<id>/items/<itemId>` con `{label, required: 0, type: 'text'}` — **sin** `options`, porque el tipo ya no es `select` (`app.js:606`) — y el aviso dice `Punto actualizado`. 5: el `label` es el nuevo, `required` está **desmarcado** y el tipo es `Texto`. 6: sale un `PATCH` con `options: ['Bueno']` y el punto queda `Seleccion · opcional` con **una** opción: el servidor acepta un arreglo de tamaño uno y solo rechaza el vacío, porque la validación es de longitud mínima y no de cantidad mínima de respuestas (`routes.ts:151-156`). 7: cambiar a `Seleccion` con el textarea vacío da **`400 Un punto de seleccion necesita al menos una opcion`**, y el punto **sigue siendo `Texto`** con sus opciones viejas **descartadas**: las opciones solo existen para un `select`, y guardarlas en otro tipo es ruido (`routes.ts:1140-1147`). Ojo con el paso 7: el `400` no revierte el `label` del paso 2, así que el punto queda con un texto que nunca se pidió. Al terminar hay que devolverlo a `Estado del material recibido`, `Si / No`, obligatorio y con `Bueno`/`Regular`/`Malo`, que es como quedó en la sección 2. |

| | |
|---|---|
| **ID** | CHK-EDT-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Editor abierto en `QA-CK-Apertura de faena`. La sección `Condiciones de seguridad` con los puntos 1, 2 y 3. |
| **Pasos** | 1. Pulsar `Quitar` en `2. Piso sin cables sueltos`.<br>2. Leer el `confirm` que aparece, o su ausencia.<br>3. Leer el aviso y los puntos que quedan.<br>4. Comprobar la numeración de los dos puntos supervivientes.<br>5. Comprobar si la otra sección cambió.<br>6. En la consola, mandar `GET /api/templates/<id>/estructura` y comparar `position`. |
| **Esperado** | 2: **no hay `confirm`**: `Quitar` va derecho al servidor. Borra un punto de una plantilla que todavía no se ejecutó, y no toca ninguna corrida ya inspeccionada, pero es la única de las tres acciones destructivas del editor que no pregunta (`app.js:377-381,515-526`). 3: sale un `DELETE /api/templates/<id>/items/<itemId>` y el aviso verde dice **`Punto quitado y renumerado`**. 4: quedan `1. Extintor con carga vigente` y **`2. Equipo de proteccion completo`**: el servidor renumera a `1..N` sin huecos dentro de la sección y devuelve la lista nueva (`routes.ts:1187-1196`, `app.js:518-522`). 5: la sección `Equipo en sitio` conserva sus `position` `1` y `2`: la renumeración es **por sección**, no global. 6: `GET /estructura` devuelve los mismos `position` que la pantalla, porque la pantalla repinta con la respuesta del servidor y no con un contador propio. Restaurar el punto `Piso sin cables sueltos` al terminar: al volver a agregarlo queda como `position 3` en vez de `2`, así que para dejar el fixture exactamente como estaba hay que borrarlo de nuevo. |

| | |
|---|---|
| **ID** | CHK-EDT-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Editor abierto en `QA-CK-Auditoria mensual`, con una sección y **cero** puntos. |
| **Pasos** | 1. Leer `#plantilla-secciones-lista`.<br>2. Leer el texto dentro de la sección.<br>3. Intentar `Quitar` un punto (no hay ninguno).<br>4. Ir a `?panel=corridas`, elegir esa plantilla en `#corrida-plantilla`, escribir un lugar y enviar `#corrida-form`.<br>5. Repetir el paso 4 en la consola con `POST /api/runs {"templateId":"<id>"}`. |
| **Esperado** | 1: la tarjeta de la sección se dibuja con su número, su nombre y sus cuatro botones. 2: dentro de `.ck-seccion__puntos` aparece el párrafo `Esta seccion no tiene puntos todavia` (`app.js:456`). 3: no hay ningún punto que quitar, ni ningún `Quitar` en pantalla. 5: la API responde **`400 Esa plantilla no tiene puntos: agregale al menos uno antes de inspeccionar`** (`routes.ts:1419-1421`) y **no** se crea ninguna corrida: el error sale antes de la transacción. La UI evita llegar ahí por otra vía: `#corrida-plantilla` solo trae plantillas activas, y esta está inactiva, así que el paso 4 no se puede ejecutar desde el formulario y hay que hacerlo por consola. Agregarle un punto con `CHK-EDT-06` solo si se quiere ver el estado vacío **con** puntos, y quitarlo al terminar. |

| | |
|---|---|
| **ID** | CHK-EDT-10 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `member`. Editor abierto en `QA-CK-Apertura de faena`, anotados el `templateId` y un `itemId` de la plantilla. |
| **Pasos** | 1. Con `member`, agregar un punto con `#punto-form`.<br>2. Con `member`, renombrar una sección con `#seccion-renombrar-form`.<br>3. Con `member`, `Subir` una sección.<br>4. Con `member`, `Quitar` un punto.<br>5. Con `member`, `Borrar sección`.<br>6. En la consola, con `member`, mandar `POST /api/templates/<id>/duplicar`.<br>7. En la consola, con `member`, mandar `DELETE /api/templates/<id>`. |
| **Esperado** | 1 a 6: **los seis funcionan con `member`**. Las 15 escrituras del producto exigen `member` y el rol mínimo del Core es ese (`routes.ts:737` y las 14 líneas siguientes), así que un usuario normal administra plantillas, secciones, puntos y duplicados sin restricción. 7: este es el único `DELETE` que exige `admin` (`deleteRole: 'admin'`, `routes.ts:2047`) y responde **`403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`**. El reparto real es: **`member` puede crear, editar, reordenar, duplicar y borrar puntos, secciones, corridas y adjuntos; solo el borrado de plantilla, el borrado de corrida y los ajustes son de `admin`** (`routes.ts:1940,1987`). La pantalla no refleja ninguna de esas tres restricciones (`R-01`). |

### 4.4 Panel Corridas

| | |
|---|---|
| **ID** | CHK-COR-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro corridas de la sección 2. |
| **Pasos** | 1. Abrir `?panel=corridas`.<br>2. Contar las columnas y leer sus títulos.<br>3. Leer el orden de las filas y las celdas de la primera.<br>4. Comparar con `GET /api/runs?limit=500` en crudo. |
| **Esperado** | La tabla tiene **8 columnas**: `Plantilla`, `Lugar`, `Estado`, `Responsable`, `Veredicto`, `Empezo`, `Cerrada` y una **última sin título** (la de acciones). El orden es **por `startedAt` descendente**, no por `createdAt`: sale `QA-CK Bodega 2` (10 de agosto), `QA-CK Faena norte` (5 de agosto), `QA-CK Patio central` (20 de julio), `QA-CK Recinto chico` (1 de julio) (`routes.ts:1336-1337`). La celda `Veredicto` muestra **`Aprobado`** u **`Observado`** como etiqueta de color, y **`—`** cuando la corrida no tiene veredicto (`app.js:674`); los valores son los de `VEREDICTO`, no los internos `approved`/`observed`. `Cerrada` muestra **`—`** para las dos que están en curso (`app.js:676`). La `Plantilla` lleva el nombre en negrita y, si no hay `templateId`, **debajo** el texto `plantilla borrada` (`app.js:655-660`, `R-03`). La última columna trae `Ficha` y, solo si la corrida está `in_progress`, también `Completar` (`app.js:662-665`). |

| | |
|---|---|
| **ID** | CHK-COR-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro corridas de la sección 2. |
| **Pasos** | 1. Escribir `bodega` en `#corrida-buscar` y contar las filas.<br>2. Escribir `apertura` en `#corrida-buscar` y contar.<br>3. Vaciar el buscador y elegir `En curso` en `#corrida-estado`; contar.<br>4. Elegir `Completada`; contar.<br>5. Elegir `Cancelada`; leer la tabla.<br>6. Elegir `QA-CK-Recepcion de materiales` en `#corrida-plantilla-filtro`; contar.<br>7. Escribir `xyz-no-existe` en `#corrida-buscar`. |
| **Esperado** | 1: **1 fila** (`Bodega 2`): el buscador compara en minúsculas contra `templateName` **y** `location` (`app.js:632-639`). 2: **1 fila** (`Faena norte`), porque el nombre de la plantilla es `QA-CK-Apertura de faena`. 3: `En curso` deja **2 filas**. 4: `Completada` deja **2 filas**. 5: `Cancelada` deja **0 filas** y la fila vacía `No hay corridas que coincidan` con `colspan` de 8 (`app.js:645`). 6: el filtro por plantilla deja **1 fila** (`Patio central`); el filtro compara `r.templateId`, así que una corrida **libre** nunca aparece con ninguna plantilla elegida, ni siquiera eligiendo la que se le borró, porque su `templateId` quedó en `NULL` (`app.js:636`). 7: vuelve a la fila vacía, sin error. Los cuatro filtros son **de la pantalla**: la petición sigue siendo `GET /api/runs?limit=500` sin `status` ni `template_id` (`app.js:134`), aunque la API los acepta (`routes.ts:1319-1330`, `R-05`). |

| | |
|---|---|
| **ID** | CHK-COR-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Las cuatro plantillas de la sección 2. |
| **Pasos** | 1. Leer las opciones de `#corrida-plantilla`.<br>2. Elegir `QA-CK-Apertura de faena`, escribir `QA-CK Bodega 3` en `#corrida-lugar` y `QA-CK frente norte, turno dia` en `#corrida-notas`.<br>3. Enviar `#corrida-form`.<br>4. Leer el aviso y lo que aparece en `#ficha-dialog`.<br>5. Cerrar el diálogo y volver a `?panel=corridas`.<br>6. En la consola, mandar `GET /api/runs/<id>/ficha` y leer `run.performedBy`, `run.templateItemsJson` y la cantidad de `items`. |
| **Esperado** | 1: la primera opción es `Corrida libre (sin plantilla)` y después vienen **solo las activas** (3 de las 4 plantillas): la `QA-CK-Auditoria mensual`, que está inactiva, **no** está (`app.js:278-283`). 3: sale un `POST /api/runs` con `{templateId, location, notes}` y **sin** `items`; el aviso verde dice exactamente **`Corrida empezada. Sus puntos quedaron copiados de la plantilla.`** (`app.js:717`) y la ficha se abre sola (`app.js:716`). 4: el diálogo muestra el `GET /ficha` de Network, y la ficha con los **5 puntos** ya numerados del `1` al `5`, **de forma global**, cruzando las dos secciones: `Condiciones de seguridad` con 1, 2, 3 y `Equipo en sitio` con **4** y **5** (no con 1 y 2, que es como están en la plantilla). Es la diferencia más importante del producto: en la plantilla el número es por sección, en la corrida es global (`routes.ts:1425-1432`). 5: la tabla suma una fila con `—` en `Cerrada`, `Sin veredicto` en `Veredicto` y `En curso` en `Estado`. 6: `performedBy` es el nombre del usuario de la sesión, no el que se escribió en un campo; `templateItemsJson` es el snapshot con 5 entradas; `items` trae 5 filas con `result: null` y `answeredAt: null`. Borrar la corrida al terminar. |

| | |
|---|---|
| **ID** | CHK-COR-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `#corrida-plantilla` en `Corrida libre (sin plantilla)`. |
| **Pasos** | 1. Escribir en `#corrida-items`: `Extintor cargado`, `Piso despejado*`, `Radio operativo`.<br>2. Escribir `QA-CK Recinto chico 2` en `#corrida-lugar` y enviar `#corrida-form`.<br>3. Leer la cabecera de la ficha que se abre.<br>4. En la consola, mandar `GET /api/runs/<id>/ficha` y leer `run.templateName`, `run.templateId` y los encabezados de sección de los puntos.<br>5. Cerrar la ficha y volver a `?panel=corridas`; mirar la celda `Plantilla` de la fila nueva.<br>6. Dejar `#corrida-items` vacío y enviar `#corrida-form` con la plantilla en `Corrida libre`. |
| **Esperado** | 3: la cabecera de la ficha dice **`Corrida libre`**, y los tres puntos salen **sin encabezado de sección**: en una corrida libre `snapshot[].section` es `null` (`routes.ts:1442`), y la ficha agrupa por eso sin pintar ningún `<h4>` (`app.js:903-905`). El `*` de `Piso despejado*` marca el punto como opcional, igual que en la creación de plantilla (`app.js:95-105`). 4: `run.templateName` = `Corrida libre` y `run.templateId` = `null`. 5: la fila muestra `Corrida libre` **y debajo `plantilla borrada`**, aunque esta corrida nunca tuvo plantilla y por lo tanto **nada se borró** (`app.js:655-660`, `R-03`): el aviso confunde "corrida libre" con "la plantilla que usaba ya no está". 6: la pantalla avisa en rojo **`Una corrida libre necesita al menos un punto`** y **no sale ninguna petición**, porque el `return` ocurre antes del `api()` (`app.js:705-708`); por consola el mismo caso da `400 Una corrida necesita una plantilla (templateId) o al menos un punto (items)` (`routes.ts:1387-1389`). |

| | |
|---|---|
| **ID** | CHK-COR-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso, con 5 puntos sin responder. |
| **Pasos** | 1. En `?panel=corridas`, pulsar `Completar` en la fila de `QA-CK Bodega 2`.<br>2. Leer el `#aviso`.<br>3. En la consola, mandar `POST /api/runs/<id>/completar` y leer el cuerpo de la respuesta.<br>4. Comprobar el estado de la corrida en la tabla y en el tablero. |
| **Esperado** | 1 y 2: el `Completar` de la tabla **no muestra `confirm`** y va directo al servidor (`app.js:664`); sale un `POST /api/runs/<id>/completar` y el `#aviso` muestra en rojo el mensaje **`Faltan 5 punto(s) obligatorio(s) por responder: 1 (Extintor con carga vigente), 2 (Piso sin cables sueltos), 3 (Equipo de proteccion completo), 4 (Radio del jefe de turno), 5 (Cantidad de operarios en turno)`**, que lista posición y texto de cada uno (`routes.ts:1674-1681`). 3: la respuesta es `400` con ese mismo texto en `error` y el `detalle` del `zod` aparte; no hay `run` ni `resumen` en el cuerpo. 4: la corrida sigue `En curso`, con `completedAt` en `null` y `result` en `null`: el error sale dentro de la transacción y no escribe nada. |

| | |
|---|---|
| **ID** | CHK-COR-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. Abrir su `Ficha`.<br>2. Escribir `Extintor QA` en `#corrida-editar-lugar` y guardar `#corrida-editar-form`.<br>3. Leer el aviso, el `Location` de la fila en la tabla y el `Lugar` de la ficha.<br>4. Escribir `QA-CK nota de prueba` en `#corrida-editar-notas` y guardar.<br>5. Mirar el bloque `Notas` de la ficha.<br>6. Vaciar `#corrida-editar-lugar` y `#corrida-editar-notas`, guardar, y comprobar la tabla y la ficha. |
| **Esperado** | 2: sale un `PATCH /api/runs/<id>` con `{"location":"QA-CK Bodega 3", "notes":null, "status":"in_progress", "result":null}` — el form manda **los cuatro** campos, no solo el que se editó, porque `#corrida-editar-form` se construye con los cuatro (`app.js:1043-1053`) — y la respuesta es **`400 El veredicto se escribe al cerrar la corrida. Cerrá la corrida para fijarlo, o editá una que ya esté cerrada.`** (`routes.ts:1756-1762`). El aviso sale en rojo y **nada se guarda**: el `Lugar` de la tabla y el de la ficha siguen siendo `QA-CK Bodega 2`. Es decir: **editar el lugar o las notas de una corrida en curso es imposible desde la pantalla**, y el motivo es el `result: null` que el propio form manda. El servidor trata `null` como "me están mandando el veredicto", porque en su `zod` `result` es `.nullable()` (`routes.ts:1732`), y el `PATCH` no distingue entre "no mandé veredicto" y "lo mandé en null" (`R-09`). 4: el segundo guardado falla con el mismo `400`, así que la ficha **sigue sin** bloque `Notas`. 6: tampoco se guarda el vaciado, por el mismo motivo. Para comprobar que la API sí sabe editar lugar y notas sin veredicto, mandar por consola `PATCH /api/runs/<id> {"location":"QA-CK Bodega 2","notes":null}`: responde `200`. Lo que hay que reportar es que la única pantalla de edición de una corrida está rota y no hay otra que la sustituya. Dejar el lugar en `QA-CK Bodega 2` al terminar. |

| | |
|---|---|
| **ID** | CHK-COR-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | La corrida `QA-CK Faena norte`, **completada** con veredicto derivado `observed`. |
| **Pasos** | 1. Abrir su `Ficha` y leer los botones `#ficha-completar`, `#ficha-cancelar`, `#ficha-reabrir`, `#ficha-borrar`, `#ficha-cerrar`.<br>2. Comprobar cuáles están `disabled`.<br>3. Pulsar `#ficha-reabrir` y leer el aviso.<br>4. Mirar el estado, el `Veredicto` y la columna `Cerrada` en la tabla.<br>5. Pulsar `Completar` en la fila de la tabla y leer el `#aviso`.<br>6. Reabrir de nuevo y volver a completar. |
| **Esperado** | 2: `#ficha-completar` **deshabilitado** porque la corrida está cerrada, y `#ficha-reabrir` **habilitado**; `#ficha-cancelar` y `#ficha-borrar` quedan habilitados (`app.js:970-972`). La máquina de estados se respeta en los botones: `Completar` solo en abierta, `Reabrir` solo en cerrada. 3: sale un `PATCH /api/runs/<id>` con `{"status":"in_progress"}` y el aviso `Corrida reabierta`; el diálogo se refresca con la ficha nueva. 4: la corrida pasa a `En curso`, la columna `Cerrada` vuelve a **`—`** y el `Veredicto` queda **vacío**: reabrir **desella** `completedAt` y **borra** el `result`, porque la corrida se firma de nuevo y el juicio viejo no vale para esta pasada (`routes.ts:1793-1798`). `#ficha-completar` vuelve a estar habilitado. 5: sale un `POST /completar` con `{}`, se vuelve a derivar `observed` (hay un `fail`) y la corrida queda `Completada` con `Cerrada` en **otra** fecha: `completedAt` es AHORA, no el valor anterior. 6: idempotente respecto al veredicto derivado, pero la fecha de cierre cambia. Anotar el cambio de fecha si hay que comparar corridas. |

| | |
|---|---|
| **ID** | CHK-COR-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `admin`, y la corrida `QA-CK Recinto chico` con un adjunto de `QA-CK informe.pdf`. |
| **Pasos** | 1. Con `member`, abrir la ficha de la corrida y pulsar `#ficha-borrar`.<br>2. Mirar si aparece un `confirm`.<br>3. Leer la respuesta del `DELETE` y el `#aviso`.<br>4. Comprobar que la corrida sigue en la tabla.<br>5. Con `admin`, pulsar `#ficha-borrar` y leer si aparece un `confirm`.<br>6. Confirmar y leer el aviso.<br>7. En la consola, mandar `GET /api/runs/<id>` y `GET /api/runs/<id>/ficha`. |
| **Esperado** | 2: **no hay ningún `confirm`**. Es el único borrado de todo el producto que no confirma, contra la plantilla y la sección, que sí preguntan (`R-02`, `app.js:1105-1111`). 3: el `member` recibe `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`, el aviso lo muestra en rojo y la corrida sigue ahí. 5: con `admin` tampoco hay `confirm`. 6: sale un `DELETE /api/runs/<id>` y el aviso verde dice `Corrida borrada`; la fila desaparece de la tabla. El borrado de corrida es **de `admin`** (`routes.ts:1940`) y limpia además los archivos del disco: los `run_items` y los `attachments` se van por `CASCADE` (`ddl.ts:97-98,116`). 7: `GET /api/runs/<id>/ficha` responde `404 {"error":"Esa corrida no existe"}` (`routes.ts:391`): una corrida borrada no deja rastro, ni respuestas ni adjuntos. Recrear la corrida `Recinto chico` desde la consola al terminar. |

### 4.5 Ficha de corrida

| | |
|---|---|
| **ID** | CHK-FIC-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso, sin ninguna respuesta. |
| **Pasos** | 1. En `?panel=corridas`, pulsar `Ficha` en su fila.<br>2. Leer el título, la línea de etiquetas y el `dl` de datos.<br>3. Contar los puntos y leer los encabezados de sección.<br>4. Contar los botones de cada tipo de control.<br>5. Leer el texto de `Cerrada`. |
| **Esperado** | 1: sale un `GET /api/runs/<id>/ficha` y `#ficha-dialog` abre en modal (`app.js:834-841,974`). 2: el título es `QA-CK-Apertura de faena`, la línea de etiquetas trae `En curso` (tono `acento`), `QA-CK Bodega 2` y `responsable: <nombre del usuario>` — el responsable sale de `run.performedBy`, que el servidor copió de la identidad (`routes.ts:1456`); **no** hay etiqueta `Veredicto` porque `result` es `null` (`app.js:849`). El `dl` tiene `Empezo`, `Cumplimiento`, `Puntos` y **no** `Cerrada`, porque `completedAt` es `null` y ese par solo se agrega si hay fecha (`app.js:856-857`). `Cumplimiento` muestra **`-`** (no `0%`) y `Puntos` muestra **`0 cumple · 0 no cumple · 0 no aplica`**. 3: aparecen **cinco** puntos bajo dos encabezados `<h4>`: `Condiciones de seguridad` con los puntos 1 a 3 y `Equipo en sitio` con los **4 y 5**. Justo debajo del `dl` hay un `p.ui-aviso--aviso` con **`Faltan 5 punto(s) obligatorio(s) por responder`**, que es el aviso que anticipa el `400` del cierre (`app.js:866-870`). 4: cada punto `yes_no` muestra **tres** botones (`Cumple`, `No cumple`, `No aplica`), y cada punto de valor muestra su campo más un botón `Guardar` (`app.js:745-780`). 5: en la ficha de una corrida en curso, `Cerrada` **no aparece**. |

| | |
|---|---|
| **ID** | CHK-FIC-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. Pulsar `No cumple` en el punto 1.<br>2. Leer el aviso y el aspecto del punto.<br>3. Pulsar `Cumple` en el punto 1.<br>4. Pulsar `No cumple` y después `Cumple` de nuevo en el punto 1.<br>5. Comprobar el `dl` y el texto de `Cumplimiento` y `Puntos`. |
| **Esperado** | 1: sale un `POST /api/runs/<id>/items/1` con `{"result":"fail","note":null}`, el aviso verde dice `Respuesta registrada` y la ficha **se vuelve a pintar entera** (`app.js:1001-1003`). El punto queda con la clase `ck-punto--fail`. 2 y 3: el botón elegido se marca con la clase `ui-btn--suave` y con `aria-pressed="true"`, y los otros dos quedan `ui-btn--fantasma` con `aria-pressed="false"` (`app.js:762-766`): el estado se marca **con `aria-pressed` y no solo con color**, para que se pueda leer sin distinguir tonos. 4: cambiar la respuesta de un punto **no pide confirmación** y **no borra nada**: la fila se actualiza tal cual, y `answeredAt` pasa al instante de la última respuesta. 5: `Cumplimiento` pasa a **`0%`** (ya hay algo evaluado, así que el guion desaparece) y `Puntos` a `1 cumple · 0 no cumple · 0 no aplica`. Dejar el punto 1 en `Cumple` al terminar. |

| | |
|---|---|
| **ID** | CHK-FIC-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. En el punto 4 (texto), escribir `Radio jefe: QA-CK Omar` en `#item-valor-4`.<br>2. Pulsar `Guardar`.<br>3. Escribir `QA-CK nota del punto 4` en `#item-nota-4` y volver a pulsar `Guardar` sin tocar el valor.<br>4. En el punto 5 (número), escribir `6` y guardar.<br>5. Escribir `siete` en el punto 5 y guardar.<br>6. Vaciar el campo del punto 5 y guardar.<br>7. Comprobar `Cumplimiento` y `Puntos`. |
| **Esperado** | 2: sale `POST /api/runs/<id>/items/4` con `{"valueText":"Radio jefe: QA-CK Omar","note":null}` y el aviso `Respuesta registrada`. El `maxlength` del campo es 4000 (`app.js:774`). 3: el `note` se manda **siempre**, y sale `null` si el campo de nota está vacío (`app.js:995-1000`): la nota del punto se escribe junto con la respuesta, no con otra llamada. 4: el `input type="number"` con `6` responde igual y **no** cuenta para el cumplimiento: un punto de valor es `respondido`, pero ni `ok` ni `fail` (`routes.ts:300-304`). 5: escribir `siete` en el campo `number` y guardar responde **`400 La respuesta tiene que ser un numero`** (`routes.ts:1549`), el aviso lo muestra en rojo y el punto **no** cambia; en el navegador el `input type="number"` ni siquiera deja escribir letras, así que este caso solo se reproduce por consola. 6: campo vacío da **`400 Este punto necesita una respuesta`** (`routes.ts:1545-1546`). 7: con los puntos 1, 2, 3, 4 y 5 respondidos, `Cumplimiento` sigue en el valor que le toque según los `yes_no` y `Puntos` cuenta los respondidos. |

| | |
|---|---|
| **ID** | CHK-FIC-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. En el punto 1, pulsar `No aplica`.<br>2. Leer `Cumplimiento` y `Puntos`.<br>3. Volver a `Cumple` y leerlos otra vez.<br>4. Responder el punto 1 con `Cumple` y los puntos 2 y 3 con `No cumple`, y leer `Cumplimiento`.<br>5. Dejar el punto 4 y el 5 sin responder. |
| **Esperado** | 1 y 2: `na` **no** cuenta como fallado: `Cumplimiento` sigue mostrando **`-`** (no `0%`) y `Puntos` pasa a `0 cumple · 0 no cumple · 1 no aplica`. El motivo está en `routes.ts:300-307`: dividir por el total haría que una inspección hecha en un sitio vacío saliera con 0% sin que nadie haya fallado nada. 3: al volver a `Cumple`, `Cumplimiento` pasa a **`100%`** y `Puntos` a `1 cumple · 0 no cumple · 0 no aplica`. 4: con 1 `ok` y 2 `fail`, `Cumplimiento` vale **`33.3%`** (`1 / 3` redondeado a un decimal, `routes.ts:335`) y `Puntos` a `1 cumple · 2 no cumple · 0 no aplica`. 5: los puntos de valor sin responder **no** son `pendientesRequeridos` por tipo, sino por la casilla `Hay que responderlo` del editor: como ambos son obligatorios, el aviso `Faltan 2 punto(s) obligatorio(s) por responder` sigue apareciendo. Restaurar las respuestas a `Cumple`, `Cumple`, `Cumple`, con el 4 en `QA-CK nota del punto 4` y el 5 en `6`, al terminar. |

| | |
|---|---|
| **ID** | CHK-FIC-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Una corrida creada desde la plantilla `QA-CK-Recepcion de materiales` (punto 1 `select` con opciones `Bueno`, `Regular`, `Malo`; punto 2 `yes_no` opcional), en curso. |
| **Pasos** | 1. Leer el desplegable del punto 1 y sus opciones.<br>2. Elegir `Regular` y pulsar `Guardar`.<br>3. En la consola, mandar `POST /api/runs/<id>/items/1` con `{"valueText":"Excelente"}`.<br>4. Elegir `Malo` y guardar.<br>5. Editar la plantilla: cambiar las opciones del punto a `Bueno` y `Malo`.<br>6. Volver a la ficha y leer las opciones del punto 1. |
| **Esperado** | 1: el `select` se pinta con una primera opción vacía, **`Elegir…`**, y después las del snapshot (`app.js:769-773`): el valor se pone como **propiedad** y no como atributo, porque un `<select>` no se deja preseleccionar con `value` en el HTML. 2: sale `POST …/items/1` con `{"valueText":"Regular","note":null}`; el `select` queda mostrando `Regular` al volver a pintar. 3: por consola, `400 Esa opcion no esta en la lista del punto` (`routes.ts:1551-1552`): la validación es contra las opciones **de esta corrida**, no contra las de la plantilla de hoy (`routes.ts:1531-1535`). 4: `Malo` se acepta. 5: el `PATCH` del punto con `options: ['Bueno','Malo']` responde `200` y la plantilla queda con esas dos. 6: la ficha **sigue mostrando las tres** opciones originales (`Bueno`, `Regular`, `Malo`): el `select` se construye con `p.options`, que viene del `run_items.options_json` del snapshot, no de la plantilla. Devolver las opciones de la plantilla a `Bueno`/`Regular`/`Malo` y borrar la corrida de prueba al terminar. |

| | |
|---|---|
| **ID** | CHK-FIC-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2` con los **5 puntos respondidos**, en curso. |
| **Pasos** | 1. Ir a `#ficha-cerrar` para cerrar el diálogo sin completar.<br>2. Volver a abrir la ficha y pulsar `#ficha-completar`.<br>3. Leer el aviso, el `Estado` y el `Veredicto` de la ficha.<br>4. Mirar `Cerrada` en la tabla de `?panel=corridas`.<br>5. Intentar responder un punto de la ficha ya cerrada.<br>6. Comprobar el estado de los cinco botones de acción. |
| **Esperado** | 1: `#ficha-cerrar` **solo cierra el diálogo**: no envía nada, la corrida sigue `in_progress` (`app.js:1120`). 2: sale `POST /api/runs/<id>/completar` con `{}` (el veredicto se manda solo si se eligió algo en `#corrida-editar-resultado`, `app.js:1068-1070`) y el aviso verde dice **`Corrida completada y sellada`**. 3: la ficha se repinta con `Completada` (tono `ok`), la etiqueta `Veredicto: …` y el par `Cerrada` **ahora sí presente**; `#ficha-completar` queda deshabilitado y `#ficha-reabrir` habilitado. 4: la columna `Cerrada` de la tabla muestra el instante de cierre. 5: los controles **desaparecen**: en una corrida cerrada cada punto muestra el texto de la respuesta y **no hay** `input`, `select` ni botones de respuesta (`app.js:740-744`), porque `editable` es `false`. No se puede responder una corrida cerrada desde la UI. 6: `#ficha-borrar` sigue habilitado si la sesión es `admin`, que es el único borrado que queda disponible. Reabrir y volver a responder para dejar el fixture como estaba. |

| | |
|---|---|
| **ID** | CHK-FIC-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso, con los 5 puntos respondidos y al menos un `fail`. |
| **Pasos** | 1. Elegir `Aprobado` en `#corrida-editar-resultado`.<br>2. Pulsar `#ficha-completar`.<br>3. Leer el `Veredicto` de la ficha y el aviso.<br>4. Repetir con `Rechazado`.<br>5. Dejar el desplegable en vacío y pulsar `#ficha-completar`.<br>6. Reabrir la corrida, desmarcar la obligatoriedad de un punto en la plantilla y volver a intentar completar. |
| **Esperado** | 2 y 3: sale `POST /api/runs/<id>/completar` con `{"result":"approved"}` y la corrida queda **`Veredicto: Aprobado`**, aunque haya un `fail` en los puntos: el veredicto explícito **gana** sobre el derivado (`routes.ts:1638-1642,1684`). Es deliberado: la máquina de estados garantiza que no se falten obligatorios, pero el juicio final es de quien firma. 4: con `rejected` el veredicto queda `Rechazado`. 5: con el desplegable vacío el cuerpo es `{}` y el servidor **deriva**: `veredictoDe` marca `observed` en cuanto hay un `fail` (`routes.ts:526-529`), así que la corrida queda `Observado` y no `Aprobado`. 6: reabrir borra el veredicto; si además se desmarca la obligatoriedad del punto 4 en la plantilla, la corrida **no** se ve afectada, porque su `required` viaja en el `run_items` del snapshot. Volver a `Completar` al terminar. |

| | |
|---|---|
| **ID** | CHK-FIC-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso, con **todos** los obligatorios respondidos. |
| **Pasos** | 1. En `#corrida-editar-estado`, elegir `Completada` y enviar `#corrida-editar-form`.<br>2. Leer el aviso, el `Estado` y el `Veredicto`.<br>3. En una corrida **en curso** con los obligatorios sin responder, elegir `Completada` en `#corrida-editar-estado` y enviar el form.<br>4. Leer el aviso.<br>5. En una corrida en curso, elegir un veredicto en `#corrida-editar-resultado` y enviar el form sin tocar el estado.<br>6. Repetir el paso 5 en una corrida ya cerrada, con el desplegable de veredicto en vacío.<br>7. En esa misma corrida cerrada, elegir `Observado` en `#corrida-editar-resultado` y enviar. |
| **Esperado** | 1: sale `PATCH /api/runs/<id>` con `{"status":"done", "result":null, …}` y el aviso verde dice `Corrida actualizada`. La corrida **se cierra**, pero **sin veredicto derivado**: el servidor solo deriva cuando el veredicto viene **ausente**, y el form lo manda siempre, en `null` aunque el desplegable esté en `(al completar, se deriva)` (`app.js:1050`, `routes.ts:1789-1791`). Ese es exactamente el segundo defecto de `R-09`: el texto del desplegable promete una derivación que la pantalla impide. 2: el estado pasa a `Completada`, `Cerrada` trae el instante, y el `Veredicto` queda en **`Sin veredicto`** aunque haya un `fail` en los puntos; el tablero suma la corrida en `Completadas` pero la cuenta en `Sin veredicto`. Contraste: el botón `Completar corrida` sí deriva, porque manda `{}` (`app.js:1069-1072`, `CHK-FIC-07`). 3 y 4: en este caso manda el `400` de los obligatorios, `No se puede completar: faltan 5 punto(s) obligatorio(s) por responder: …`, con ese texto en vez del `Faltan …` de `POST /completar` (`routes.ts:1770-1774`), y el `#aviso` lo muestra tal cual (`app.js:1054-1057`): el mensaje es la instrucción, no un error de programa. La corrida **no** cambia de estado. 5: en una corrida abierta, mandar `result` da el mismo **`400 El veredicto se escribe al cerrar la corrida. Cerrá la corrida para fijarlo, o editá una que ya esté cerrada.`** (`routes.ts:1756-1762`): no se puede firmar una inspección que sigue abierta, y tampoco guardar el lugar. 6: en una corrida `done`, el mismo form con el desplegable vacío **funciona** y **borra** el veredicto: `result: null` cae en `cambios.result = body.result` porque `fila.status === 'done'` y no hay excepción que lo impida (`routes.ts:1756-1764`). Una corrida cerrada firmada pasa a `Sin veredicto` por abrir el diálogo y guardar sin tocar nada, y el aviso dice `Corrida actualizada` como si estuviera bien. 7: elegir un veredicto explícito sí lo escribe, y es la única forma de corregir (o volver a poner) el veredicto de una corrida cerrada. Reabrir la corrida al terminar para dejar el fixture como estaba. |

| | |
|---|---|
| **ID** | CHK-FIC-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. Pulsar `#ficha-cancelar`.<br>2. Leer el `Estado`, el `Veredicto` y el par `Cerrada` de la ficha.<br>3. Intentar responder un punto.<br>4. Pulsar `#ficha-completar`.<br>5. En la consola, mandar `POST /api/runs/<id>/completar`.<br>6. En la consola, mandar `PATCH /api/runs/<id>` con `{"status":"in_progress"}`.<br>7. Comprobar `#ficha-reabrir` y `#ficha-cancelar`. |
| **Esperado** | 1: sale `PATCH /api/runs/<id>` con `{"status":"canceled"}` y el aviso verde dice `Corrida cancelada`. 2: el estado pasa a `Cancelada` (tono `neutro`), el veredicto **no aparece** y el par `Cerrada` **tampoco**: cancelar **no sella** `completedAt`, porque cancelada no es completada (`routes.ts:1790-1794`). 3: los controles de respuesta desaparecen, igual que en una corrida completada: `editable` solo es `true` con `status === 'in_progress'`. 4: `#ficha-completar` está **deshabilitado**, así que ni siquiera se puede intentar; por consola, `POST /completar` responde **`409 Esta corrida esta cancelada: reabrila con PATCH {"status": "in_progress"}`** (`routes.ts:1664-1666`), que además dice cómo arreglarlo. 6: el `PATCH` la reabre y **no** le pone veredicto: si venía de `done` lo borra, y de `canceled` directamente nunca lo tenía (`routes.ts:1794-1798`). 7: `#ficha-reabrir` queda deshabilitado y `#ficha-cancelar` habilitado otra vez. Volver a cancelar al terminar. |

| | |
|---|---|
| **ID** | CHK-FIC-10 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. En el editor de la plantilla `QA-CK-Apertura de faena`, cambiar el texto del punto 2 a `Piso sin cables sueltos (v2)` y el punto 4 a `Radio del jefe de turno (v2)`.<br>2. Volver a la ficha y leer los textos de los cinco puntos.<br>3. Editar el punto 2 de la ficha y responderlo.<br>4. Cambiar `#punto-tipo` del punto 2 de la plantilla a `Texto`.<br>5. Volver a la ficha y leer los controles del punto 2.<br>6. Restaurar la plantilla (volver a `Si / No` y a los textos originales) y comprobar la ficha. |
| **Esperado** | 2: los cinco puntos muestran **los textos originales**, no los `(v2)`: la ficha se arma con `ficha.items`, que son las filas de `run_items`, y los `section` del encabezado salen de `snapshot.items` (`app.js:876-910`). 3: el punto se responde con los botones `Cumple`/`No cumple`/`No aplica` porque el `type` del snapshot es `yes_no`. 4 y 5: aunque la plantilla diga `Texto`, la ficha **sigue mostrando tres botones**: `run_items.type` es una copia del día que se creó la corrida, así que cambiarla no altera lo que se está respondiendo. Solo una corrida **nueva** de esa plantilla vería el campo de texto. 6: al restaurar la plantilla, la ficha tampoco cambia: sigue con su snapshot. Es exactamente la garantía que da el producto, y por eso `run_items.item_id` apunta al punto de origen sin que nada dependa de él en el momento de responder (`routes.ts:1398-1399`). |

### 4.6 Adjuntos

| | |
|---|---|
| **ID** | CHK-ADJ-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso, sin adjuntos. |
| **Pasos** | 1. Abrir su `Ficha` y leer el encabezado `Adjuntos` y lo que hay debajo.<br>2. Comprobar si `#adjunto-form` está visible.<br>3. Elegir `QA-CK informe.pdf` en `#adjunto-archivo` y enviar `#adjunto-form`.<br>4. Leer el aviso y la fila del adjunto.<br>5. En la consola, mandar `GET /api/runs/<id>/ficha` y leer `attachments[0]`. |
| **Esperado** | 1: bajo el encabezado `Adjuntos` hay un `p.ui-vacio` con **`Sin adjuntos`** (`app.js:917-922`), no una tabla vacía. 2: `#adjunto-form` está **visible**, porque `#adjunto-form.hidden = !editable` y la corrida está en curso (`app.js:916`). 3: sale un `POST /api/runs/<id>/attachments` con `{filename, mimeType, data}`, donde `data` es el contenido en **base64 pelado**: el `FileReader` produce un `data:...;base64,` y la pantalla corta el prefijo antes de mandar (`app.js:1023-1033`). El aviso verde dice `Archivo adjuntado` y la ficha se repinta. 4: el adjunto sale como enlace de descarga con el texto **`QA-CK informe.pdf`** y, al lado, el tamaño y la fecha unidos por ` · ` (`app.js:928-937`); con `Quitar` a la derecha, porque la corrida es editable. 5: `attachments[0]` trae `filename: "QA-CK informe.pdf"`, `sizeBytes` con el tamaño real, `path: "attachments/<id>"` y `url: "/api/runs/<id>/attachments/<id>/file"`. El **nombre en disco es el `id` generado por el servidor**, nunca el que envió el cliente (`routes.ts:1847-1856`). |

| | |
|---|---|
| **ID** | CHK-ADJ-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, con el adjunto `QA-CK informe.pdf`. |
| **Pasos** | 1. Pulsar el enlace del adjunto.<br>2. Leer las cabeceras de la respuesta en Network.<br>3. Comprobar el nombre del archivo descargado y su contenido.<br>4. Intentar abrir la URL del adjunto con el método `GET` desde otra pestaña.<br>5. Cambiar el `id` de la URL por uno inventado y repetir. |
| **Esperado** | 2: la respuesta es `200` con `Content-Type: application/octet-stream` **fijo**, `Content-Disposition: attachment` con `filename*=UTF-8''…`, y `X-Content-Type-Options: nosniff`. El tipo real del archivo **no** se usa: siempre se sirve como descarga para que el navegador no lo interprete (`attachments.ts:184-191`). 3: el archivo baja con el nombre original **`QA-CK informe.pdf`**, no con el id del servidor, y el contenido es idéntico al subido. 4 y 5: sin sesión la API responde `401` y el navegador salta al login del Core; con un id inexistente, `404 {"error":"Ese adjunto no existe"}` (`routes.ts:1883-1885`). La ruta se reconstruye desde el id con `basename`, de modo que un `path` manipulado no sirve para leer archivos fuera de la carpeta (`routes.ts:1890-1891`). |

| | |
|---|---|
| **ID** | CHK-ADJ-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, con un adjunto. |
| **Pasos** | 1. Pulsar `Quitar` en el adjunto.<br>2. Leer si aparece un `confirm`.<br>3. Leer el aviso y la lista de adjuntos.<br>4. En la consola, mandar `GET /api/runs/<id>/attachments/<attId>/file` con el id anotado.<br>5. En la consola, mandar `DELETE /api/runs/<id>/attachments/<attId>` con el mismo id otra vez.<br>6. Intentar borrar un adjunto con el `attId` de otra corrida. |
| **Esperado** | 2: **no hay `confirm`**; el borrado de un adjunto es inmediato y sin pregunta (`app.js:941-957`). 3: sale un `DELETE /api/runs/<id>/attachments/<attId>`, el aviso verde dice `Adjunto quitado` y vuelve a aparecer `Sin adjuntos`. 4: la descarga responde `404 {"error":"Ese adjunto no existe"}`. 5: el segundo borrado responde el mismo `404`, porque la fila ya no está (`routes.ts:1905-1908`). 6: un `attId` de otra corrida de la misma organización **también** da `404`: la búsqueda filtra por `run_id` además de por `organization_id`, así que un adjunto no se puede mover ni borrar desde una corrida que no es la suya (`routes.ts:1880-1885`). |

| | |
|---|---|
| **ID** | CHK-ADJ-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso. Un PDF de 1 MB y un archivo `.exe` de 2 KB. |
| **Pasos** | 1. Elegir el PDF de 1 MB en `#adjunto-archivo` y enviar `#adjunto-form`.<br>2. Leer el aviso.<br>3. En la consola, mandar el mismo PDF a `POST /api/runs/<id>/attachments`.<br>4. Elegir el `.exe` y enviar el formulario.<br>5. Elegir un `.svg` y enviar el formulario.<br>6. Elegir un archivo de 0 bytes y enviar el formulario. |
| **Esperado** | 1 y 2: **la pantalla lo corta antes de enviar**: el aviso en rojo dice **`El archivo no puede superar 750 KB`** y **no sale ninguna petición** (`app.js:1016`). El límite es de 750 000 bytes, y el `accept` del `input` es una pista, no una garantía. 3: por consola el mismo archivo da **`413 El archivo no puede superar 750 KB.`** (`attachments.ts:174-180`): el cliente avisa con su propio texto y el servidor con el suyo, y ambos dicen `750 KB`, que es el número que el usuario ve. 4 y 5: **`415 Ese tipo de archivo no se admite (…)`**, y el `.svg` también, aunque el navegador lo ofrezca en el diálogo: SVG queda afuera a propósito porque es un documento con scripts (`attachments.ts:29-30,167-171`). 6: **`400 El archivo llegó vacío.`** (`attachments.ts:173`), con la misma validación en cliente y servidor. Ninguno de los cuatro casos crea fila: el control es previo a escribir el archivo. |

| | |
|---|---|
| **ID** | CHK-ADJ-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | La corrida `QA-CK Faena norte`, **completada**. Y la corrida `QA-CK Bodega 2`, en curso. |
| **Pasos** | 1. Abrir la ficha de `Faena norte` y comprobar `#adjunto-form`.<br>2. Comprobar si los adjuntos existentes muestran `Quitar`.<br>3. En la consola, mandar `POST /api/runs/<id>/attachments` con un PDF chico contra esa corrida cerrada.<br>4. Abrir la ficha de `Bodega 2` y comprobar que `#adjunto-form` volvió a estar visible.<br>5. En la consola, mandar `POST /api/runs/<no-existe>/attachments` con un PDF chico. |
| **Esperado** | 1: `#adjunto-form` está **oculto** (`app.js:916`), y por lo tanto no hay forma de adjuntar nada a una corrida cerrada. 2: los adjuntos que ya tiene **no** muestran `Quitar`, porque el botón se agrega solo cuando `editable` (`app.js:938-957`). Un cierre sella también los adjuntos, que es lo esperable en una inspección. 3: la API **sí acepta** el adjunto en una corrida cerrada: no hay ninguna comprobación de estado en `POST /api/runs/:id/attachments` (`routes.ts:1820-1824`). Es una diferencia real entre la API y la UI, y la anotación corresponde a la regla de alcance: la ausencia de UI es un hallazgo, no una excepción. 4: la ficha de `Bodega 2` muestra el formulario otra vez, porque el `hidden` se recalcula en cada `abrirFicha`. 5: **`404 Esa corrida no existe`**, porque `corridaVisible` corre antes de validar el cuerpo (`routes.ts:1823-1824,391`): no queda ni archivo en disco ni fila. Borrar por API el adjunto que se subió en el paso 3 al terminar, para dejar `Faena norte` como estaba. |

### 4.7 Ajustes

| | |
|---|---|
| **ID** | CHK-AJU-01 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `admin`. Ajustes con los valores por defecto: `currency = '$'`, `timezone = 'America/Santiago'`. |
| **Pasos** | 1. Abrir `?panel=ajustes`.<br>2. Leer los valores de `#cfg-moneda` y `#cfg-zona`.<br>3. Cambiar `#cfg-moneda` a `CLP` y `#cfg-zona` a `Pacific/Kiritimati`.<br>4. Enviar `#config-form` y leer el aviso.<br>5. Recargar la página y leer los dos campos.<br>6. En la consola, mandar `GET /api/settings`.<br>7. Volver a poner `$` y `America/Santiago`, guardar y comprobar. |
| **Esperado** | 2: los dos campos aparecen con los valores guardados, no con los del HTML: el form se llena recorriendo `form.elements` y usando el `name` de cada input (`app.js:1130-1138`), así que el `<input name="currency">` y el `<input name="timezone">` del `index.html` son el contrato. 4: sale un `PUT /api/settings` con `{"currency":"CLP","timezone":"Pacific/Kiritimati"}` y el aviso verde dice `Ajustes guardados`; la respuesta trae los valores ya guardados y la pantalla se rellena con ellos. 5 y 6: los valores **persisten** y `GET /api/settings` responde `{"settings":{"organizationId":"…","currency":"CLP","timezone":"Pacific/Kiritimati"}}`. Los ajustes son **de la organización**, no de la persona: por eso el `organizationId` no se puede cambiar desde la pantalla. 7: restaurados a `$` y `America/Santiago` para no arrastrar el cambio. |

| | |
|---|---|
| **ID** | CHK-AJU-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `admin` y, en paralelo, una sesión de `member`. |
| **Pasos** | 1. Con `member`, abrir `?panel=ajustes` y leer los dos campos.<br>2. Con `member`, cambiar la moneda y enviar `#config-form`.<br>3. Leer la respuesta del `PUT` y el `#aviso`.<br>4. Comprobar con `GET /api/settings` que el valor no cambió.<br>5. Con `member`, mandar `PUT /api/settings` con `{"timezone":"Zona/Falsa"}`.<br>6. Con `admin`, mandar el mismo `PUT`. |
| **Esperado** | 1: el `member` **lee** los ajustes sin problema: leer es libre. 2 y 3: el `PUT` responde **`403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`** y el `#aviso` lo muestra en rojo (`routes.ts:1986-1987`). 4: el valor sigue igual, y la pantalla **no** revierte lo que se escribió en el campo: el `renderConfig` solo se ejecuta cuando el `PUT` responde bien (`app.js:1163-1170`), así que el campo queda mostrando lo que el usuario puso, no lo que quedó guardado. Es una discrepancia entre lo que se ve y lo que está. 5: el rol se comprueba **antes** de validar la zona, así que el `member` recibe el `403` y no el `400`. 6: con `admin`, la zona inválida sí da **`400 Zona horaria desconocida: Zona/Falsa`** (`routes.ts:1247-1252`), porque la validación es contra `Intl` y no contra una lista escrita a mano: cualquier zona de la base de IANA sirve y una lista propia envejece. |

| | |
|---|---|
| **ID** | CHK-AJU-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `admin`. Las cuatro corridas de la sección 2, con sus `startedAt` fijos. |
| **Pasos** | 1. Con `timezone = America/Santiago`, abrir la ficha de `QA-CK Faena norte` y anotar el texto de `Empezo`.<br>2. Cambiar `timezone` a `Pacific/Kiritimati` y guardar los ajustes.<br>3. Recargar y volver a abrir esa ficha; anotar el texto de `Empezo`.<br>4. Buscar el texto `750` y `$` en el panel de Ajustes y en la ficha.<br>5. Restaurar `America/Santiago` y `$`. |
| **Esperado** | 3: el texto de `Empezo` **no cambia**: `instanteCorto` usa `toLocaleString('es-CL')` **sin zona**, o sea la del navegador, y `settings.timezone` no se consulta para formatear (`app.js:115`, `R-04`). Cambiar la zona de la empresa no mueve lo que ve nadie. 4: el símbolo de la moneda aparece en el label del campo y **en ningún otro lugar del producto**: no hay ningún importe en Checklists, y el HTML lo declara bajo `#cfg-moneda` (`index.html:280`). La zona se usa solo como dato guardado: ni las fechas de la ficha, ni las de la tabla de corridas, ni las de `#fallos` la consultan. Es el mismo hallazgo que en Pagos, y acá es aún más visible porque este producto no tiene cifras. 5: restaurado. |

### 4.8 API y contrato

| | |
|---|---|
| **ID** | CHK-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión abierta. Los cuatro datos de prueba de la sección 2. |
| **Pasos** | 1. Sin sesión, pedir `GET /api/templates`.<br>2. Sin sesión, pedir `GET /health`.<br>3. Con sesión, mandar `GET /api/templates?limit=500` y leer la forma de la respuesta.<br>4. Pedir `GET /api/templates?active=1` y `GET /api/templates?active=0`, contando `total`.<br>5. Pedir `GET /api/templates?active=si`.<br>6. Pedir `GET /api/templates?active=` (vacío). |
| **Esperado** | 1: `401 {"error":"sin-sesion","loginUrl":"…"}`, sin datos: sin sesión no se entra ni a la API ni al HTML (`routes.ts:1129-1131`). 2: **`200 {"ok":true,"product":"checklists","name":"Checklists"}` sin sesión**, porque `/health` se registra antes del auth. Ojo: esa ruta también consume presupuesto del rate limiter (`REG-01`). 3: `200 {"items":[…],"total":4,"limit":500,"offset":0}` con las cuatro plantillas ordenadas por `name` (`routes.ts:707-711`). 4: `active=1` da `total: 3` y `active=0` da `total: 1`: el filtro **sí** existe en la API. 5: **`400 El filtro active vale 1 (activas) u 0 (inactivas)`**, no se ignora en silencio: un `?active=si` que se tomara por "todas" mostraría plantillas inactivas sin avisar (`routes.ts:692-698`). 6: `active=` vacío **no** filtra y devuelve las 4: el valor en blanco se trata como "sin filtro" (`routes.ts:689`). |

| | |
|---|---|
| **ID** | CHK-API-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión abierta. El `templateId` de `QA-CK-Apertura de faena` anotado. |
| **Pasos** | 1. Mandar `POST /api/templates` con `{"name":"QA-CK API 1","organizationId":"otra-empresa"}`.<br>2. Repetir con `{"name":"QA-CK API 1","plantilla":"x"}`.<br>3. Repetir con `{"name":"  "}`.<br>4. Repetir con `{"name":"QA-CK API 1","sections":[{"name":"S","items":[{"label":"P","type":"select"}]}]}`.<br>5. Repetir con `{"name":"QA-CK API 1","sections":[{"name":"S","items":[{"label":"P"}]}],"items":[{"label":"Q"}]}`.<br>6. Comprobar con `GET /api/templates?limit=500` si alguna de las peticiones anteriores creó algo. |
| **Esperado** | 1: **`400 Campo desconocido: organizationId. Revisa el nombre; si esta bien escrito, no lo mandes.`** (`routes.ts:239-243`). Los schemas son **cerrados**: la identidad sale de la cookie, nunca del cuerpo, así que mandar la organización da un error que la nombra en vez de aceptarla y descartarla en silencio (`routes.ts:219-227`). 2: el mismo `400` con `Campo desconocido: plantilla`. 3: **`400`** con el mensaje del `zod` sobre el nombre vacío: `texto` exige 1 carácter después del `trim()`. 4: **`400 Un punto de seleccion necesita al menos una opcion`** (`routes.ts:151-156`). 5: **`400 Manda secciones (con sus puntos) o puntos sueltos, no los dos`** (`routes.ts:742-744`): los puntos de las secciones y los sueltos harían el mismo papel. 6: no queda ninguna plantilla nueva de esas cuatro peticiones, y el `total` sigue en 4. |

| | |
|---|---|
| **ID** | CHK-API-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión abierta. Los `templateId` de `QA-CK-Apertura de faena` y `QA-CK-Recepcion de materiales` anotados. |
| **Pasos** | 1. Mandar `GET /api/templates/<id>/estructura` y leer la forma de la respuesta.<br>2. Mandar `GET /api/templates/<id>/items` y comparar con `/estructura`.<br>3. Mandar `POST /api/templates/<id>/sections/ordenar` con `{"order":["id-falso"]}`.<br>4. Mandar el mismo `POST` con el orden correcto **repetido**: `["<idA>","<idA>"]`.<br>5. Mandar `POST /api/templates/<id>/sections` con `{"name":"S","items":[]}`.<br>6. Mandar `PATCH /api/templates/<id>/items/<itemId>` con `{"sectionId":"<id-de-otra-plantilla>"}`. |
| **Esperado** | 1: `200 {"template":{…},"sections":[{"id","name","sortOrder","items":[{…,"options":[…]}]}]}`, con las secciones en orden y cada punto con su `position` y su `options` ya parseado (`routes.ts:840-855`). Es el lado de lectura del par con los endpoints que mueven secciones y puntos. 2: `/items` devuelve la lista **plana** de los 5 puntos, en el mismo orden, con `sectionId` en vez del grupo: existe por compatibilidad con la UI sencilla, y el editor usa `/estructura` (`routes.ts:846-850`). 3: **`400 El orden tiene que listar todas las secciones de la plantilla, sin repetir`**, porque el `order` tiene que traer exactamente el conjunto de ids de la plantilla (`routes.ts:940-945`). 4: el mismo `400` por el `conjunto.size` desalineado con el largo: el chequeo cubre lista incompleta, ids repetidos y lista con ids de otro lado. 5: **`400 Campo desconocido: items`**: en `/sections` el cuerpo es estricto y solo acepta `name` (`routes.ts:863`). 6: **`400 Campo desconocido: sectionId`**: `PATCH /items/:itemId` no acepta sección, porque mover de sección no es una operación del producto (`routes.ts:1110-1116`). |

| | |
|---|---|
| **ID** | CHK-API-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión abierta. El `runId` de `QA-CK Bodega 2` anotado. |
| **Pasos** | 1. Mandar `POST /api/runs` con `{"templateId":"<id>","items":[{"label":"X"}]}`.<br>2. Mandar `POST /api/runs` con `{}`.<br>3. Mandar `POST /api/runs` con `{"templateId":"<id-de-otra-empresa>"}`.<br>4. Mandar `POST /api/runs` con `{"items":[{"label":"QA-CK punto","required":1}],"startedAt":"2026-13-45T99:00:00Z"}`.<br>5. Mandar `POST /api/runs` con `{"items":[{"label":"QA-CK punto ok","required":1}],"startedAt":"2026-08-20T15:00:00.000Z"}` y leer la respuesta.<br>6. Comprobar el `total` de `GET /api/runs?limit=500`. |
| **Esperado** | 1: **`400 Manda templateId (que se copia) o items (corrida libre), no los dos`**: si vienen las dos, el snapshot sería el de una o el de la otra según el orden de las líneas (`routes.ts:1384-1386`). 2: **`400 Una corrida necesita una plantilla (templateId) o al menos un punto (items)`**. 3: **`404 Esa plantilla no existe`**, no `403` ni `404` de empresa: el filtro es por `organization_id`, así que una plantilla de otra organización es indistinguible de una que no existe (`routes.ts:1402-1407`). 4: **`400 Instante invalido: va como ISO, por ejemplo 2026-09-27T15:00:00.000Z`**, del `refine` de `instante` (`routes.ts:161-163`). 5: `201 {"run":{…},"items":[…]}` con `status: "in_progress"`, `startedAt` igual al enviado y **cinco** puntos copiados de la plantilla. 6: el `total` sube a 5 y la corrida aparece **primera** en la lista, porque `startedAt` de agosto la pone antes que la de `Bodega 2` aunque se haya creado después. Borrar la corrida de prueba y la que dejó `CHK-COR-03` al terminar. |

| | |
|---|---|
| **ID** | CHK-API-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión abierta. El `runId` de `QA-CK Bodega 2` anotado, en curso. |
| **Pasos** | 1. Mandar `POST /api/runs/<id>/items/99`.<br>2. Mandar `POST /api/runs/<id>/items/1` con `{}`.<br>3. Mandar `POST /api/runs/<id>/items/1` con `{"result":"tal vez"}`.<br>4. Mandar `POST /api/runs/<id>/items/1` con `{"result":"ok","valueText":"x"}`.<br>5. Mandar `POST /api/runs/<id>/items/4` con `{"note":"QA-CK nota larga"}`.<br>6. Mandar `POST /api/runs/<id>/items/1` con `{"result":"ok","note":"x".repeat(2001)}`.<br>7. Mandar `POST /api/runs/<id>/items/1` con `{"result":"ok","answeredAt":"2026-01-01T00:00:00Z"}`. |
| **Esperado** | 1: **`404`**, con `Esa corrida` no: la respuesta es un `404` de posición inexistente (`routes.ts:1580-1586`). El punto se busca **por posición**, no por id interno, porque quien llena la corrida ve "2. Los cables están protegidos" y contesta "2"; si la posición no existe, se responde `404` en vez de escribir un resultado en el lugar equivocado (`routes.ts:1560-1570`). 2: **`400 Este punto se responde con ok, fail, na`**, con la lista de las tres respuestas válidas (`routes.ts:1540-1541`). 3: `400` del `z.enum(RESPUESTAS)`. 4: `200` — mandarlo no es un error; el `result` manda y el `valueText` se descarta en la normalización (`routes.ts:1539-1543`). 5: `200` y la nota queda escrita: se responde **por posición**, y `note` es parte de la respuesta. 6: **`400`** con el mensaje del `zod` por `max(2000)`. 7: **`400 Campo desconocido: answeredAt`**: `answered_at` lo pone el servidor y nunca el cliente, porque "el punto se respondió el jueves" no puede ser algo que alguien escriba a mano cuando le parezca (`routes.ts:1567-1572`). |

| | |
|---|---|
| **ID** | CHK-API-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión abierta. El `runId` de `QA-CK Faena norte` (completada) y el de `QA-CK Bodega 2` (en curso) anotados. |
| **Pasos** | 1. Mandar `POST /api/runs/<id-cerrada>/completar`.<br>2. Mandar `POST /api/runs/<id-cancelada>/completar` (con la corrida `Recinto chico` primero cancelada).<br>3. Mandar `PATCH /api/runs/<id-abierta>` con `{"status":"terminada"}`.<br>4. Mandar `GET /api/runs?status=terminada`.<br>5. Mandar `PATCH /api/runs/<id-abierta>` con `{"status":"canceled"}` y luego `{"status":"in_progress"}`.<br>6. Mandar `PATCH /api/runs/<id-abierta>` con `{"result":"approved"}`. |
| **Esperado** | 1: **`409 Esta corrida ya estaba completada`** (`routes.ts:1663`). 2: **`409 Esta corrida esta cancelada: reabrila con PATCH {"status": "in_progress"}`**, que además dice cómo arreglarlo (`routes.ts:1664-1666`). 3: **`400`** del `z.enum(ESTADOS)`: los tres estados son cerrados a propósito, porque un texto libre permitiría escribir "terminada" y la columna dejaría de poder filtrarse (`routes.ts:174-181`). 4: **`400 El estado "terminada" no existe; usa in_progress, done, canceled`**, y el filtro tampoco se ignora en silencio (`routes.ts:1319-1322`). 5: el `PATCH` a `canceled` no sella `completedAt`; volver a `in_progress` no cambia nada más. 6: **`400 El veredicto se escribe al cerrar la corrida. Cerrá la corrida para fijarlo, o editá una que ya esté cerrada.`** (`routes.ts:1743-1746`). La invariante es que no exista una fila con `result` y `status: in_progress`: el tablero contaría una inspección firmada que nadie cerró. Devolver `Recinto chico` a `in_progress` al terminar. |

| | |
|---|---|
| **ID** | CHK-API-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión abierta. El `runId` de `QA-CK Bodega 2`, en curso, anotado. |
| **Pasos** | 1. Mandar `PATCH /api/runs/<runId>` con `{"performedBy":"QA-CK alguien"}`.<br>2. Mandar `PATCH /api/runs/<runId>` con `{"templateItemsJson":"[]"}`.<br>3. Mandar `PATCH /api/runs/<runId>` con `{"completedAt":"2026-01-01T00:00:00Z"}`.<br>4. Mandar `PATCH /api/runs/<runId>` con `{"lugare":"QA-CK Bodega 4"}`.<br>5. Mandar `GET /api/runs/<runId>` y leer `performedBy`, `templateItemsJson`, `completedAt` y `location`. |
| **Esperado** | 1, 2 y 3: los tres campos **se descartan en silencio** y la respuesta es **`200`**: el `PATCH /api/runs/:id` es la **única** ruta del producto cuyo `z.object` **no es estricto** (`routes.ts:1723-1730`, contra el `estricto()` de `routes.ts:228-230` que usan todas las demás). Un campo mal escrito o uno de solo lectura no da error: desaparece. El snapshot, el responsable y el sello de cierre quedan como estaban, así que **la invariante se sostiene**, pero el que manda la petición se queda creyendo que los escribió (`R-06`). 4: igual que los anteriores: `lugare` no es un campo conocido, se descarta y el `200` dice que todo salió bien. 5: `performedBy` sigue siendo el del usuario que creó la corrida, `templateItemsJson` sigue con los 5 puntos, `completedAt` en `null` y `location` en `QA-CK Bodega 2`: ninguno de los cuatro cuerpos del caso cambió nada. |

| | |
|---|---|

## 5. Recorridos E2E

| | |
|---|---|
| **ID** | CHK-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión de `member`. Las plantillas de la sección 2. |
| **Pasos** | 1. `?panel=plantillas` -> `Nueva plantilla` -> nombre `QA-CK E2E checklist`, puntos `Extintor cargado` y `Piso despejado*` -> `Plantilla creada`.<br>2. `Puntos` sobre la nueva -> sección `Equipo de emergencia`.<br>3. Agregar el punto `Radio operativo` en esa sección.<br>4. Renombrar la sección a `Equipo en terreno`.<br>5. `Subir` la sección para que quede segunda.<br>6. `?panel=corridas` -> elegir la plantilla -> lugar `QA-CK E2E faena` -> `Empezar corrida`.<br>7. Responder los tres puntos: `Cumple`, `No cumple` y `Radio jefe: QA-CK Ana`.<br>8. Adjuntar `QA-CK informe.pdf`.<br>9. Pulsar `Completar corrida`.<br>10. Volver a `?panel=corridas` y a `/`, y leer la fila nueva y las tarjetas. |
| **Esperado** | 1: `201` y el aviso `Plantilla creada`; la plantilla queda con una sección `General` y 2 puntos, el segundo opcional. 2 y 3: la plantilla pasa a **2 secciones y 3 puntos**; el nuevo es `1. Radio operativo` dentro de `Equipo en emergencia`. 4: el nombre cambia y persiste. 5: las secciones quedan `1. General`, `2. Equipo en terreno`. 6: la ficha se abre sola con el aviso `Corrida empezada. Sus puntos quedaron copiados de la plantilla.` y los **3** puntos numerados de forma global: `1. Extintor cargado`, `2. Piso despejado`, `3. Radio operativo`, bajo dos encabezados. 7: el punto 2 queda `No cumple`, el 3 con su texto y su nota, y el `dl` marca `Cumplimiento 50%` y `Puntos 1 cumple · 1 no cumple · 0 no aplica`; el aviso `Faltan 1 punto(s) obligatorio(s) por responder` **desaparece** (el punto opcional ya no cuenta). 8: el adjunto sale con su enlace y su `Quitar`. 9: el aviso verde dice `Corrida completada y sellada`; la ficha muestra `Completada`, `Veredicto: Observado` (derivado, por el `fail`), `Cerrada` y `Cumplimiento 50%`. 10: la fila nueva aparece **primera** en la tabla, con `Observado` en `Veredicto` y `En curso` en `Estado` = 0; el tablero suma `1` en `Corridas` y `1` en `Observadas`, y `#fallos` muestra `2. Piso despejado`. Es el recorrido completo del producto, del punto en blanco a la inspección firmada. |

| | |
|---|---|
| **ID** | CHK-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | La corrida `QA-CK Bodega 2`, en curso, con 1 respuesta. Las plantillas de la sección 2. |
| **Pasos** | 1. Anotar los 5 textos y tipos de los puntos de la ficha de `Bodega 2`.<br>2. Editar la plantilla: cambiar `Piso sin cables sueltos` a `Piso sin cables sueltos (editada)`, desmarcar su obligatoriedad y borrar la sección `Equipo en sitio` con sus 2 puntos.<br>3. Volver a la ficha de `Bodega 2` y comparar punto por punto.<br>4. Intentar completar `Bodega 2` con el punto 5 sin responder.<br>5. Crear una corrida nueva de la plantilla editada y comparar sus puntos.<br>6. Intentar responder el punto `3. Equipo de proteccion completo` de la corrida nueva con un campo de texto. |
| **Esperado** | 3: la ficha **no cambia en nada**: los 5 textos, los 5 tipos y los dos encabezados de sección son los del día que se creó la corrida. La plantilla ya no tiene `Equipo en sitio` y eso no la afecta. 4: el `400` sigue listando **`5 (Cantidad de operarios en turno)`** como obligatorio pendiente, aunque en la plantilla ese punto ya **no exista**: la obligatoriedad viaja en `run_items.required`, que es una copia (`routes.ts:1469`). 5: la corrida nueva tiene **3** puntos (los que quedaron en la plantilla) y **sin** encabezado `Equipo en sitio`. 6: el punto 3 de la corrida nueva es `Si / No` porque en la plantilla ese punto no se tocó: solo cambió el punto 2. La garantía que hay que anotar es que **la corrida es una foto y la plantilla es el ahora**, y que la foto no se altera ni cuando la plantilla se vacía. Restaurar la plantilla al terminar. |

| | |
|---|---|
| **ID** | CHK-E2E-03 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión de `admin`. La plantilla `QA-CK-Apertura de faena (copia)`, que no tiene ninguna corrida. |
| **Pasos** | 1. Crear dos corridas de `QA-CK-Apertura de faena (copia)` con lugares `QA-CK E2E legacy` y `QA-CK E2E legacy 2`.<br>2. En `?panel=corridas`, comprobar si aparece `plantilla borrada` en esas dos filas.<br>3. Borrar la plantilla y confirmar.<br>4. Recargar `?panel=corridas` y leer las dos corridas.<br>5. Abrir la ficha de una de ellas.<br>6. En `?panel=corridas`, elegir la plantilla borrada en `#corrida-plantilla-filtro` si sigue en la lista.<br>7. En la consola, mandar `GET /api/runs?template_id=<id-borrada>`.<br>8. Volver a crear la copia con `Duplicar` y borrar las dos corridas. |
| **Esperado** | 2: **no** aparece `plantilla borrada` en ninguna: las dos filas muestran el nombre de la copia porque `templateName` viene del snapshot. 4: las dos siguen en la lista con su nombre, y **ahora sí** muestran `plantilla borrada` debajo, porque `runs.template_id` quedó en `NULL` por el `ON DELETE SET NULL` (`ddl.ts`, `routes.ts:2035-2036`): borrar la plantilla **no** borra sus corridas, porque una corrida es un hecho que ocurrió. 5: la ficha se abre **completa**, con sus 5 puntos, su resumen y su historial: el snapshot viaja en `runs.template_items_json` y los puntos están en `run_items`. 6: la plantilla borrada ya **no** está entre las opciones de `#corrida-plantilla-filtro`, porque el selector se arma con las plantillas existentes; con el selector en `Todas` (valor vacío) las dos corridas **sí** se ven, porque el filtro por plantilla solo compara cuando tiene algo elegido (`app.js:634-636`). Lo que se pierde es el filtro: ya no hay forma de agrupar por esa plantilla ni desde la pantalla ni por API, porque `runs.template_id` quedó en `NULL` y `eq` con `NULL` no devuelve filas. Lo que **no** se pierde es encontrarlas: `#corrida-buscar` compara contra `templateName` y `location` (`app.js:638`), los dos campos sobreviven en la fila, y `?q=` los busca igual (`routes.ts:1330-1334`). 7: el mismo filtro por API da `total: 0`, y `GET /api/runs` sin filtro las devuelve: borradas del filtro, vivas en los datos. 8: dejar las cuatro plantillas de nuevo. |

| | |
|---|---|
| **ID** | CHK-E2E-04 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Dos pestañas del navegador con sesión, en `?panel=plantillas`. La plantilla `QA-CK-Apertura de faena` abierta en el editor en la pestaña A. |
| **Pasos** | 1. En la pestaña A, agregar el punto `Andamio certificate` a `Equipo en sitio`.<br>2. En la pestaña B, editar la plantilla con `Editar` y cambiar el nombre a `QA-CK Apertura v3`.<br>3. En la pestaña B, pulsar `Puntos` sobre la plantilla y contar los puntos.<br>4. En la pestaña A, pulsar `Renombrar` en `Equipo en sitio`.<br>5. En la pestaña A, volver a abrir `Puntos` y contar los puntos y el nombre de la plantilla. |
| **Esperado** | 1: la pestaña A queda con **3** puntos en `Equipo en sitio`. 3: la pestaña B, que pidió `/estructura` después, ve los **3**: el `GET /estructura` se pide al abrir el editor, así que los ve. 4: sale un `PATCH /api/templates/<id>/sections/<sectionId>` y la sección se renombra en las dos pestañas. 5: la pestaña A ve `Puntos de QA-CK Apertura v3` y **3** puntos. Lo que **no** pasa: si en la pestaña B se hubiera guardado la plantilla con el textarea de puntos, se habrían pisado los puntos de la otra pestaña. El editor de puntos tiene sus propios endpoints, uno por punto, justamente para eso (`app.js:301-305`). El caso sirve para comprobar que la pantalla no pisa trabajo ajeno: cambiar el nombre de una plantilla **no** toca sus puntos, ni desde una pestaña ni desde otra. |

| | |
|---|---|
| **ID** | CHK-E2E-05 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión de `member` y, en paralelo, una de `admin`. Las plantillas y corridas de la sección 2. |
| **Pasos** | 1. Con `member`, recorrer los cuatro paneles y anotar qué botones destructivos se ven.<br>2. Con `member`, intentar cada uno: borrar plantilla, borrar sección, quitar punto, borrar corrida, borrar corrida y cambiar los ajustes.<br>3. Anotar para cada intento el código de respuesta y si el dato cambió.<br>4. Con `admin`, repetir los tres que fallaron.<br>5. Volver a `/` y comprobar que las tarjetas coinciden con la sección 2.<br>6. Cerrar la sesión y volver a entrar. |
| **Esperado** | 1: el `member` ve **todos** los botones: `Borrar` de plantilla, `Borrar sección`, `Quitar` de punto, `#ficha-borrar` y los campos de ajustes. 2 y 3: dos de los cinco le funcionan y tres le rebotan: **borrar plantilla** -> `403`, **borrar corrida** -> `403`, **ajustes** -> `403`; en cambio **borrar sección**, **quitar punto** y responder, mover y renumerar puntos **funcionan** con `member`. La garantía real son los `requireRole` del servidor, nunca la ausencia del botón (`R-01`). 4: los tres que fallaban funcionan con `admin`. 5: `4` corridas, `2` en curso, `2` completadas, `1` aprobada, `1` observada, `83,3%` de cumplimiento: si algo cambió, fue un borrado que el `member` no debería haber podido hacer. 6: al volver a entrar se ven los mismos datos y no queda ninguna corrida a medio crear: la creación de una corrida es de una transacción, así que no hay corridas sin puntos. |

## 6. Regresión compartida

Lo mismo que hay que comprobar en **cada** producto del monorepo, porque viene del shell y
no del producto: si algo de esta sección falla, se arregla en `packages/product-runtime` y se
avisa a los demás planes, no se parchea en Checklists.

| | |
|---|---|
| **ID** | CHK-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Producto arrancado, sin sesión en el navegador. |
| **Pasos** | 1. Pedir `GET /health` 601 veces seguidas desde la consola, con menos de 15 minutos entre la primera y la última.<br>2. En la petición 601, leer el código y el cuerpo.<br>3. Comparar el número de peticiones que el `GET /health` consumió con el de una petición normal.<br>4. Con sesión válida, pedir `GET /api/dashboard` y leer el código. |
| **Esperado** | 2: **`429`** con el mensaje del runtime, y **no** un `500`. El límite es de 600 peticiones por 15 minutos y por IP (`packages/product-runtime/src/app.ts:99-106`). 3: **`/health` consume presupuesto igual que cualquier otra ruta**, porque el limitador se registra **antes** de que `/health` exista en el router (`app.ts:99-106,117-118`): comprobar el arranque del producto consume el mismo presupuesto que usarlo. Es un defecto del shell, no del producto, y por eso se anota en `R-07`. 4: tras esperar a que venza la ventana, `GET /api/dashboard` vuelve a `200`. En una vuelta larga de este plan (más de 600 peticiones con los filtros y las recargas) el `429` es esperable: anotar en la sección 9 y esperar, no reportar. |

| | |
|---|---|
| **ID** | CHK-REG-02 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión abierta. |
| **Pasos** | 1. Mandar `POST /api/templates` con un cuerpo JSON malformado: `{"name": `.<br>2. Leer el código de respuesta.<br>3. Mandar `POST /api/templates` con un JSON válido.<br>4. Enviar por el `input type="file"` de `#adjunto-archivo` un archivo de 2 MB.<br>5. Leer el código de respuesta de la subida. |
| **Esperado** | 2: **`500` y no `400`**. El cuerpo malformado hace que `express.json()` lance un `SyntaxError`, que el manejador genérico de errores trata como error de programa (`app.ts:96`, `errors.ts:27-40`): un `400` con el mensaje del parser sería lo correcto, y con `500` cualquier alarma de errores del servidor se va a disparar por culpa de un cliente. Es un defecto del shell (`R-07`). 3: el `201` normal, así que el producto sigue funcionando. 4 y 5: **`413 La petición es demasiado grande`**, con el límite de 1 MB del parser de cuerpo. Ojo con la diferencia de los dos topes de tamaño: el parser corta a **1 MB** y el de adjuntos a **750 KB**, así que un archivo de 900 KB pasa el parser y lo rechaza la validación del adjunto (`CHK-ADJ-04`). Los dos mensajes son exactos: `1 MB` no redondeado y `750 KB` tal como lo ve el usuario (`attachments.ts:174-180`). |

| | |
|---|---|
| **ID** | CHK-REG-03 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión abierta. |
| **Pasos** | 1. Abrir DevTools, ir a Network, filtrar `JS` y hacer **dos** recargas de `/`.<br>2. Leer la cabecera `Cache-Control` de `/app.js` y de `/style.css`.<br>3. Editar `products/checklists/public/app.js` (un comentario) y recargar.<br>4. Comprobar si el navegador descarga el archivo otra vez.<br>5. Pedir `/favicon.ico` y `/api/me`. |
| **Esperado** | 2: `Cache-Control: public, max-age=31536000, immutable` en los dos estáticos (`app.ts:150-165`). 3 y 4: el archivo **no** se vuelve a descargar, aunque haya cambiado: `immutable` sin un `?v=` con huella hace que el navegador lo guarde para un año. Un cambio de JS o CSS no llega a los usuarios que ya visitaron el producto, y no hay forma de romper la caché desde la aplicación. Es un defecto del shell (`R-07`) y el modo de detectarlo en QA es precisamente este. 5: `/favicon.ico` responde **`200`** sin sesión: es el único recurso público del producto, y `/api/me` responde `200` **con** sesión y `401` sin ella. |

| | |
|---|---|
| **ID** | CHK-REG-04 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión de `member` en el navegador y, en paralelo, la misma sesión pero con la cookie borrada. |
| **Pasos** | 1. Con la sesión viva, pulsar cualquier acción de escritura.<br>2. En la segunda pestaña, borrar la cookie `app_session` y pulsar una acción de escritura.<br>3. Leer el `#aviso` de la primera y de la segunda.<br>4. Comprobar a qué URL terminó la segunda pestaña.<br>5. Volver a entrar y repetir la acción que se había perdido. |
| **Esperado** | 1: el `200` normal. 2: el `api()` del shell recibe `401` y guarda `error.loginUrl`; no escribe nada. 3 y 4: la segunda pestaña **navega al login del Core** con `return_to` apuntando a la URL del producto, en vez de mostrar el aviso en rojo (`amigo-ui.js:331-336`). Es el comportamiento correcto: el login es del Core y el producto no tiene ni un campo de usuario ni de clave (`index.html`, que no contiene ningún `type="password"`). 5: al volver, la acción hay que **repetirla**: la que se perdió no se reintenta sola, así que un formulario a medio llenar puede perder lo que se había escrito en los campos que no son parte del cuerpo. Anotar en la sección 9 si pasó. |

| | |
|---|---|
| **ID** | CHK-REG-05 |
| **Tipo / Prioridad** | REG / P2 |
| **Precondición** | Sesión abierta. |
| **Pasos** | 1. Provocar un error a propósito (por ejemplo `CHK-EDT-06` paso 6) y leer el `#aviso`.<br>2. Esperar 6 segundos sin hacer nada y volver a leer `#aviso`.<br>3. Provocar otro error y mirar el `#aviso` a los 3 segundos.<br>4. Provocar dos errores seguidos y contar cuántas veces se ve el aviso. |
| **Esperado** | 1: el aviso aparece **una sola vez**, con el texto del servidor y en rojo. 2: a los ~5 segundos desaparece solo, sin que haya que cerrarlo (`amigo-ui.js:270-278`): el aviso es transitorio y no hay forma de conservar un error para leerlo con calma, así que hay que copiarlo mientras está o mirarlo en Network. 3: a los 3 segundos sigue visible, así que el corte es a los 5 y no antes. 4: cada error **reemplaza** el aviso anterior en vez de apilarse: dos fallos seguidos dejan el último, y el primero se pierde. Con dos errores en la misma pantalla conviene leer los dos cuerpos de Network, no confiar en el `#aviso`. |

| | |
|---|---|
| **ID** | CHK-REG-06 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión abierta. Vista de red con **Preservar log** activado. |
| **Pasos** | 1. Abrir `/` y anotar todas las peticiones de la carga inicial.<br>2. En `?panel=corridas`, pulsar `Completar` en `Bodega 2` (que va a fallar) y contar las peticiones.<br>3. En el editor, agregar un punto a una plantilla y contar las peticiones.<br>4. Repetir el paso 3 mirando qué se vuelve a pedir y qué no. |
| **Esperado** | 1: la carga inicial pide `GET /api/templates?limit=500`, `GET /api/runs?limit=500` y `GET /api/settings`, en paralelo, y **no** pide `/api/dashboard`: el tablero no se pinta hasta que se elige el panel (`app.js:131-134,1189`). 2: **una** petición, el `POST /completar` que devuelve `400`. No hay reintento. 3: **cuatro** peticiones: el `POST` del punto, un `GET /estructura` nuevo, un `GET /api/templates?limit=500` y un `GET /api/runs?limit=500` (`app.js:590-591` llama a `abrirPuntos` y `recargar`). Agregar un punto vuelve a pedir **las dos listas enteras** de la organización, no solo la plantilla editada. 4: no hay peticiones duplicadas dentro de una misma acción, pero sí re-peticiones completas entre acciones seguidas: con 500 filas en cada lista, escribir diez puntos seguidos son diez recargas de las dos listas. Anotar el tiempo total de la vuelta, porque es el costo real de este diseño y no lo mide ningún caso individual. |

## 7. Riesgo conocido

Defectos confirmados **al leer el código**, antes de ejecutar nada. Los `REG` vienen del shell
compartido: si se confirman, se reportan una vez contra `packages/product-runtime`, no nueve
veces.

| ID | Qué pasa | Dónde | Cómo se confirma | Severidad |
|---|---|---|---|---|
| `R-01` | La pantalla nunca consulta `/api/me` ni guarda el rol, así que un `member` ve `Borrar` de plantilla, `Borrar sección`, `Quitar` de punto y `#ficha-borrar`, y los campos de Ajustes. Los tres primeros le funcionan; los otros dos le rebotan con `403`. La garantía real son los `requireRole` del servidor, no la ausencia del botón. Contraste directo con Pagos, que sí lee el rol (`app.js:94,170-171`). | `products/checklists/public/app.js`, todo el archivo; sin llamada a `/api/me` | `CHK-PLA-08`, `CHK-FIC-09` paso 3, `CHK-AJU-02`, `CHK-EDT-10` | HIGH |
| `R-02` | `#ficha-borrar` borra una corrida **sin `confirm`**, siendo la única acción destructiva del producto que no pregunta: `DELETE /api/runs/:id` se lleva en cascada los `run_items` y los `attachments`, y borra los archivos del disco. Plantilla y sección sí confirman. | `products/checklists/public/app.js:1105-1111`; borrado en cascada en `src/ddl.ts:97-98,116` | `CHK-COR-08` pasos 2 y 5 | HIGH |
| `R-03` | La celda `Plantilla` de `?panel=corridas` muestra `plantilla borrada` en **toda** corrida sin `templateId`, y el texto no distingue "corrida libre" de "la plantilla que usó ya no está": una corrida creada sin plantilla (`Corrida libre`) muestra las dos líneas, y una corrida cuya plantilla se borró muestra un mensaje que sugiere un problema donde no lo hay. | `products/checklists/public/app.js:655-660`; `templateName` de la corrida libre en `src/routes.ts:1434,196` | `CHK-COR-04` paso 5, `CHK-E2E-03` paso 4 | MEDIUM |
| `R-04` | `settings.timezone` y `settings.currency` no afectan la UI: `instanteCorto` usa `toLocaleString('es-CL')` sin zona, así que las fechas dependen de la máquina del cliente, y el símbolo de la moneda no aparece en ningún punto del producto porque no hay importes. Los ajustes se guardan y no se usan. | `products/checklists/public/app.js:115`; `public/index.html:280`; campos en `src/schema.ts:374` | `CHK-AJU-03` | MEDIUM |
| `R-05` | No hay paginación en la UI: las dos listas piden `limit=500` sin `offset`, sin aviso de que hay más, y con el tope real del servidor en 1000 filas. El filtro de plantillas es del navegador (`app.js:200-205`) aunque la API soporte y valide `?active=0|1`, así que con más de 500 plantillas se ven menos y el filtro se aplica sobre lo que llegó. | `products/checklists/public/app.js:133-134,200-205`; API en `src/routes.ts:689-711,703`; sin cobertura en `tests/checklists.test.ts` | `CHK-PLA-02` paso 3, `CHK-COR-02` paso 7; comparar `GET /api/templates?limit=1000&offset=0` con lo que muestra la pantalla | MEDIUM |
| `R-06` | `PATCH /api/runs/:id` es la **única** ruta del producto cuyo `z.object` no es estricto: los campos desconocidos **se descartan en silencio** y la respuesta es `200`. Mandar `performedBy`, `templateItemsJson`, `completedAt` o un nombre mal escrito no da error. La invariante se sostiene (el snapshot no se puede pisar), pero quien llama se queda creyendo que escribió. | `products/checklists/src/routes.ts:1723-1730`, contra el `estricto()` de `routes.ts:228-230` | `CHK-API-07` | MEDIUM |
| `R-07` | Defectos del shell, para reportar una vez a `packages/product-runtime`: (a) el limitador se registra **antes** de `/health`, así que comprobar el arranque consume presupuesto de los 600/15 min; (b) un JSON malformado responde `500` en vez de `400`; (c) los estáticos se sirven con `immutable` sin `?v=`, así que un cambio de JS o CSS no llega a quien ya Cargó la página; (d) la UI no refleja **ninguna** de las dos restricciones de `admin`, que en Pagos sí se respetan. | `packages/product-runtime/src/app.ts:96,99-106,117-118,150-165`; `packages/product-runtime/src/errors.ts:27-40` | `CHK-REG-01`, `CHK-REG-02`, `CHK-REG-03`, `CHK-AJU-02` | MEDIUM |
| `R-08` | Sin guía ni estado vacío útil en la lista de corridas y de plantillas: no hay contador, ni aviso de que el `limit=500` trunca, ni forma de pedir la página siguiente. En una organización con más de 500 corridas de plantilla, las más viejas desaparecen sin aviso y no hay forma de llegar a ellas desde la pantalla. | `products/checklists/public/app.js:133-134,641-685` | `CHK-PLA-02`, `CHK-COR-02`, `CHK-REG-06` | LOW |
| `R-09` | **El formulario de editar la corrida está roto en los tres estados.** `#corrida-editar-form` manda siempre los cuatro campos y `result` sale como `null` cuando el desplegable está en `(al completar, se deriva)`; el servidor trata ese `null` como "me mandaron veredicto" porque su `zod` es `.nullable()` y no distingue ausente de nulo. Consecuencias: (a) **guardar el lugar o las notas de una corrida en curso siempre da `400`** y no cambia nada; (b) cerrar la corrida desde el desplegable `Estado` la deja **sin veredicto**, aunque el propio desplegable prometa derivarlo y haya un `fail` en los puntos; (c) guardar el form en una corrida **cerrada con veredicto** **borra el veredicto** y responde `Corrida actualizada`. La ruta `POST /completar` y el `PATCH` sin `result` sí derivan: el defecto es del contrato implícito entre pantalla y API. | `products/checklists/public/app.js:1040-1052`; `products/checklists/src/routes.ts:1727-1734,1755-1764,1789-1791` | `CHK-COR-06`, `CHK-FIC-08` | HIGH |

Riesgos **de este plan**, no del producto: la suite tiene 74 casos automatizados y cubre los
cálculos del resumen, el snapshot, los `409` y el límite de adjuntos, pero **no** cubre el filtro
del navegador, la nota `plantilla borrada`, la falta de `confirm()` en `#ficha-borrar`, el
ocultamiento de botones por rol ni la forma en que el form de editar manda `result: null`. Los
cinco son de los que este documento tiene que encontrar a mano.

## 8. Checklist visual

Recorrer una vez por cada panel, en 1280 × 800 y en 390 × 844. Marcar cada ítem.

**Canal lateral y cabecera**

- [ ] `#tabs` tiene cuatro entradas en dos grupos: `Inspecciones` (Tablero, Plantillas, Corridas) y `Configuración` (Ajustes) (`index.html:35-39`).
- [ ] Solo una entrada está activa, distinguida con `aria-current="page"`, y los cuatro paneles usan `hidden`, no `display: none` (`amigo.js:96-103`).
- [ ] El logo del canal muestra `CI` y el nombre que se pasa a `AMIGO.montar` es `Checklists`; `data-amigo="empresa"`, `data-amigo="usuario"`, `data-amigo="correo"` y `data-amigo="avatar"` traen los datos de la sesión (`index.html:26-49`).
- [ ] `data-amigo="otras-titulo"` queda oculto y `data-amigo="otras"` vacía cuando la organización tiene una sola herramienta (`amigo.js:72-91`).
- [ ] `Salir` apunta a `/auth/logout`.
- [ ] El `<h1 data-amigo="titulo">` cambia con el panel (`Tablero`, `Plantillas`, `Corridas`, `Ajustes`) y la URL queda en `?panel=…` (`amigo.js:104-108`).
- [ ] Un `?panel=` que no existe cae en `tablero`, sin error y sin pantalla en blanco.
- [ ] **El canal lateral no desborda**: `document.documentElement.scrollWidth` es **390** a 390 × 844, con los cuatro enlaces y los dos títulos de grupo legibles en vertical.
- [ ] **Hay forma de llegar a todas las secciones**: un enlace por cada pestaña, en los cuatro paneles. El editor de puntos **no** es una pestaña: se abre con `Puntos` y se cierra volviendo a `Plantillas`.

**Panel Tablero**

- [ ] `#resumen` lleva `ui-rejilla ui-rejilla--4` y muestra **nueve** tarjetas: `Corridas`, `En curso`, `Completadas`, `Canceladas`, `Aprobadas`, `Observadas`, `Rechazadas`, `Sin veredicto` y `Cumplimiento promedio`.
- [ ] Solo `Corridas` sale destacado con `ui-kpi__cifra--acento`; los otros ocho números van neutros (`app.js:145-155`).
- [ ] Las nueve se reparten de **dos en dos** a 390 px (cinco filas) y en **dos filas de seis y tres** a 1280 px, sin huecos ni scroll horizontal: `.ui-rejilla--4` es `flex-wrap` con `flex: 1 1 9rem` (`amigo.css:325-329`), así que ninguna tarjeta baja de 9rem y la última fila se estira hasta el ancho disponible.
- [ ] La tabla `#fallos` muestra solo un punto, con su corrida, su lugar y su fecha; con `#fallos` vacío sale el aviso de la lista vacía, no una tabla sin filas.

**Panel Plantillas**

- [ ] La tabla tiene **cuatro** columnas y la fila vacía usa `colspan="4"` (`app.js:211`).
- [ ] `#plantilla-buscar` y `#plantilla-filtro` caben en 390 px y filtran **en el navegador**: escribir texto y elegir `Solo inactivas` no dispara ninguna petición (`R-05`).
- [ ] Los **cinco** botones de la última columna se leen en horizontal: `Editar`, `Puntos`, `Duplicar`, `Desactivar`/`Activar` y `Borrar`.
- [ ] `#plantilla-editor` y `#plantilla-dialog` abren con `showModal()`: el fondo no es interactuable y `Escape` los cierra.
- [ ] La sección vacía del editor dice `Esta seccion no tiene puntos todavia` y no muestra un `Quitar` imposible (`CHK-EDT-09`).
- [ ] **Ningún** campo de ninguno de los formularios tiene `scrollWidth` **mayor** que 390 (`CHK-REG-06`).

**Panel Corridas**

- [ ] La tabla tiene **ocho** columnas y **no** produce scroll horizontal a 1280 px; a 390 px cada celda baja de ancho en vez de empujar la tabla.
- [ ] Los filtros `#corrida-buscar`, `#corrida-estado` y `#corrida-plantilla-filtro` caben en móvil y no disparan peticiones al cambiar.
- [ ] `#ficha-dialog` lleva la clase `ui-ancho`: el `dl`, los puntos y los adjuntos caben sin barra propia.
- [ ] En la ficha, los tres botones de un punto `yes_no` llevan `aria-pressed`, así que la respuesta elegida se lee sin distinguir tonos (`app.js:762-766`).
- [ ] **La columna `Estado` de las dos tablas no distingue `Activa` de `Inactiva` más que con el texto**: las dos usan `nota()`, que es tono `neutro` (`app.js:127,219`).

**Panel Ajustes**

- [ ] `#cfg-moneda` y `#cfg-zona` aparecen con lo que está **guardado**, no con el `value` del HTML, y `Guardar` responde `Ajustes guardados`.
- [ ] El símbolo de la moneda aparece **solo** en el campo de Ajustes: este producto no tiene importes en ninguna pantalla (`R-04`).
- [ ] Los errores se leen enteros en 390 px y `#aviso` desaparece a los ~5 s (`CHK-REG-05`).

**Consola y red**

- [ ] Panel de consola con filtro `error`: **cero** errores y cero warnings propios del producto. Un `404` a `/favicon.ico` no se espera: responde `200` (`CHK-REG-03`).
- [ ] Panel de red: la carga inicial pide `/api/templates?limit=500`, `/api/runs?limit=500` y `/api/settings`, **no** `/api/dashboard`; y una acción produce **una** petición, sin reintentos (`CHK-REG-06`).
- [ ] Un error esperado (por ejemplo el `400` de `CHK-EDT-06` paso 6) aparece en `#aviso` **y** en el cuerpo de la respuesta de Network, con el mismo texto.

## 9. Registro

Vacía a propósito. Una fila por caso ejecutado, con lo observado y no lo esperado.

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados; el resto sigue vacío. Transversal: Doc 10 §9.

| ID | Resultado | Evidencia | Nota |
|---|---|---|---|
| CHK-API-01 | PARCIAL | Sin sesión: `GET /api/templates` → `401 {"error":"sin-sesion","loginUrl"}` ✅ (sin `message`); `GET /health` → `200 {"ok":true,"product":"checklists"}` sin sesión ✅. Con sesión: `GET /api/templates` → `{items,total,limit,offset}` ✅ | Filtros `active=1/0/si/vacío` no probados (datos demo, no los 4 seed). |
| CHK-API-02 | BLOQUEADO | Requiere plantillas seed `QA-CK-*` para los POST negativos | No ejecutado. |
| CHK-API-03 | BLOQUEADO | Requiere `templateId` de las plantillas seed | No ejecutado. |
| CHK-E2E-01 | BLOQUEADO | Requiere sesión `member` y plantillas de la sección 2 | No ejecutado. |
| CHK-E2E-02 | BLOQUEADO | Requiere corrida `QA-CK Bodega 2` en curso | No ejecutado. |
| CHK-NAV-01 | PARCIAL | Arranque: `inicio`, `templates`, `runs`, `settings` (prefetch); tablero con KPIs; clic en pestañas → 0 peticiones nuevas, paneles con datos | 3 pestañas; h1/aria-current/panel ✅. Consola limpia (solo favicon 404). |
| CHK-LST-01 | PARCIAL | `GET /api/templates` y `GET /api/runs` → envoltorio `{items,total,limit,offset}` | Filas no comparadas contra datos seed. |
