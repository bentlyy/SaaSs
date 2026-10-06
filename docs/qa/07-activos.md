# Plan de pruebas - Activos

> Producto `activos` sobre el runtime compartido. Documento escrito para que alguien con
> Chrome DevTools pueda ejecutar cada caso sin volver a leer el código, y para que el resultado
> sea comparable con los planes de Inventario y de Clientes.

## 1. Ficha técnica

| | |
|---|---|
| Producto | `activos` |
| Nombre visible | Activos (`<title>Activos</title>`, `data-amigo="logo"` = `AC`) |
| Descripción | Patrimonio de la empresa: qué se tiene (`assets`) y qué le pasó (`asset_movements`, historial de solo lectura). Un activo es un equipo, una herramienta o un vehículo, con código, nombre, categoría, marca, modelo, serie, estado, ubicación, responsable, costo en centavos y notas. |
| Puerto | `.env.example`: `PORT=3022` (el `APP_URL` del mismo archivo dice `3023`, que es el de Inventario: sección 7, `R-19`). Producción: `127.0.0.1:3106:3000`, `APP_URL=https://activos.amgdeveloper.cl`. El Core escucha en `3108`. |
| Ruta local | `products/activos` · `npm run dev:activos` · `npm test -w @amg/activos` · `npm run typecheck -w @amg/activos` |
| Base | `./data/activos.sqlite`, `DB_SCHEMA_VERSION=1`. En tests, `:memory:`. La identidad **no** está acá: vive en el `core.sqlite` del Core. Sin fuente legacy: no hay `legacy_tenant_map` ni `migrate-legacy.ts` (`app.ts:15-24`). |
| Schema | `assets`, `asset_movements`, `settings` (`products/activos/src/schema.ts:68-178`; el mismo DDL en `products/activos/src/ddl.ts:17-60`). |
| Entrada | `GET /` -> `public/index.html`, `public/app.js`, `public/style.css`, y del runtime `/amigo-ui.js`, `/amigo.js`, `/amigo.css`. |
| Paneles | 3: `?panel=tablero` (por defecto), `?panel=activos`, `?panel=ajustes`. Grupos del canal: `Inventario` (Tablero, Activos) y `Configuración` (Ajustes). |
| Rutas | `GET /health`, `POST /health`, `GET /api/meta`, `GET /api/me`, `GET /api/inicio`, `GET /api/dashboard`, `GET /api/assets/next-code`, `GET /api/assets/:id/ficha`, `POST /api/assets/:id/movimientos`, `POST /api/assets`, `PATCH /api/assets/:id`, `DELETE /api/assets/:id`, `GET /api/settings`, `PUT /api/settings`, y las de `crudRouter` sobre `/api/assets` (sección 4.7). **No** existen `/api/tablero` ni `/api/resumen`: en este producto el tablero es `/api/dashboard`. |
| Identidad | SSO contra el Core. El producto **no** pide usuario ni clave: sin sesión no se sirve ni el HTML. |
| Roles | Lectura: cualquiera con sesión. `POST /api/assets`, `PATCH /api/assets/:id` y `POST /api/assets/:id/movimientos`: `member`. `DELETE /api/assets/:id` (borrado real) y `PUT /api/settings`: `admin`. Un `member` **ve** el botón `Borrar` y recibe `403` al pulsarlo (sección 7, `R-01`). |
| Convenciones | `docs/qa/00-CONVENCIONES.md`. Tipos `FUNC`, `E2E`, `REG`, `SIST`, `EXP`; prioridades `P0`, `P1`, `P2`. |
| Fuera de alcance | El Core y los otros productos, salvo `/health`, `/api/meta`, `/api/inicio` y `/api/me`. En particular `inventario`, que también tiene un `code` y un precio, pero es de **stock y ventas**: acá no hay cantidad, ni precio de venta, ni reposición. |

Lo que este producto **no** tiene, y conviene fijar antes de empezar porque cambia lo que se
puede probar:

- **No hay stock ni venta.** El precio de un bien no existe: lo único es `cost_cents`, el costo
  con que se compró, que es un dato del activo y no una venta.
- **El responsable no es una ficha de nadie.** `assigned_to` es texto libre de 120 caracteres
  (`schema.ts:90-94`): el equipo se le puede entregar a un proveedor, a un técnico o al socio, y
  ninguno tiene cuenta en el sistema. No hay selector de personal.
- **El historial no se edita ni se borra**, por API ni por pantalla (`routes.ts:36-38`). Es lo
  correcto para un historial y está cubierto por un test
  (`products/activos/tests/activos.test.ts:90`, «la UI no borra el historial desde la pantalla»).
- **La lista no se pagina**: la UI pide `limit=500` y no hay segunda página (`R-07`).
- **La API no declara ningún filtro** sobre `/api/assets`, así que `?status=repair` o
  `?category=herramienta` se ignoran en silencio; el filtro de la pantalla es del navegador
  (`R-05`).
- **No hay forma de desarchivar desde la pantalla** ni de listar los archivados: archivar es
  puerta de ida en la UI (`R-02`).
- **`category` es texto libre de 150 caracteres** y no es ni filtro ni campo de búsqueda
  (`R-12`).
- **No hay `seed`**: el producto arranca vacío y sin datos de ejemplo, a propósito (`app.ts:21-24`).

## 2. Datos de prueba

**Organización.** La propia, la de la sesión del Core. Nunca escribir el `organization_id` a mano:
sale de la identidad (`orgId(req)`), y mandarlo en el cuerpo se ignora en silencio.

**Convención de fechas.** Este producto **no tiene un `hoy`**: ni el tablero ni la lista ni la
ficha comparan fechas contra el día, así que los datos de esta sección dan lo mismo se corran
cuando se corran (`R-17`). No hace falta leer ningún `H` antes de empezar. Lo único que sí cambia
con el día es la hora que se ve de los movimientos registrados en el momento; por eso el
historial de la sección 2 se carga **por API con `happenedAt` fijo**, para que el texto del
historial sea siempre el mismo. La pantalla **no** manda `happenedAt` (`R-14`), y por eso la
carga por API no es opcional para tener un historial reproducible.

**Activos.** Cinco, con prefijo `QA-ACT-` en el **código** (que es el identificador que ve la
gente) y en el nombre. Los costos van **siempre en centavos**, tal como los guarda la API.

| Código | Nombre | Categoría | Estado | Responsable | Ubicación | Costo (centavos) | Marca | Modelo | Serie | Comprado | Notas |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `QA-ACT-001` | Portátil QA de terreno | equipo de computo | En uso | `QA-ACT Ana` | Bodega central | `45055` | Lenovo | ThinkPad T14 | `SN-QA-001` | `2026-03-09` | `QA-ACT notebook de terreno` |
| `QA-ACT-002` | Taladro QA percutor | herramienta | En uso | `QA-ACT Bruno` | Obra norte | `19990` | Bosch | GBH 2-26 | `SN-QA-002` | `2026-07-14` | (vacío) |
| `QA-ACT-003` | Notebook QA de repuestos | equipo de computo | En reparación | `QA-ACT Diego` | Taller | `65045` | (vacío) | (vacío) | (vacío) | `2026-01-20` | (vacío) |
| `QA-ACT-004` | Camioneta QA inservible | vehiculo | Dado de baja | (vacío) | (vacío) | `120000` | (vacío) | (vacío) | (vacío) | `2019-05-02` | `QA-ACT dada de baja por el estado del motor` |
| `QA-ACT-005` | Celular QA extraviado | equipo de computo | Perdido | `QA-ACT Carla` | (vacío) | `45055` | (vacío) | (vacío) | (vacío) | (vacío) | (vacío) |

Cada uno existe por un caso distinto: `#001` es el que tiene marca, modelo, serie, fecha y notas
completos y un solo movimiento; `#002` es el que **no** tiene notas; `#003` es el que no tiene ni
marca ni modelo ni serie y el único con dos movimientos; `#004` es el **único sin movimientos**
(el que sirve para el borrado real) y el único sin responsable ni ubicación; `#005` es el que no
tiene fecha de compra y el único con estado `lost`. El costo de `120000` existe a propósito, para
ver el separador de miles (`$ 1.200,00`) en la tabla, en la ficha y en el tablero.

`#003` se deja en `En reparación` **por movimiento**, no por el formulario: así se verifica que la
invariante la cumple la API. Para probar lo contrario (`R-04`) hay que cambiarlo a mano en
`ACT-FRM-07` y devolverlo a `En reparación` después.

Los cinco se crean **uno por uno, con al menos un segundo entre cada uno**, para que los
`created_at` no emparden: `Últimos activos registrados` ordena por `created_at` descendente y con
empates el orden deja de ser inequívoco.

**Movimientos.** Cinco, todos por API con `happenedAt` fijo, y cada uno con su efecto. Los cuatro
tipos (`checkout`, `checkin`, `maintenance`, `loss`) están representados: `checkout` dos veces,
`maintenance` una y `loss` una. **No hay ningún `checkin` en el fixture** porque es el único tipo
que se confunde con `checkout` (los dos dejan `active`), y se prueba aparte en `ACT-MOV-03`.

| Activo | Tipo | Quién (solo `checkout`) | Nota | `happenedAt` | Efecto esperado |
|---|---|---|---|---|---|
| `QA-ACT-001` | `checkout` | `QA-ACT Ana` | `QA-ACT salida a terreno` | `2026-06-01T15:00:00.000Z` | queda `active`, `assignedTo = QA-ACT Ana` |
| `QA-ACT-002` | `checkout` | `QA-ACT Bruno` | (vacío) | `2026-06-02T12:00:00.000Z` | queda `active`, `assignedTo = QA-ACT Bruno` |
| `QA-ACT-003` | `checkout` | `QA-ACT Diego` | (vacío) | `2026-05-04T10:00:00.000Z` | queda `active`, `assignedTo = QA-ACT Diego` |
| `QA-ACT-003` | `maintenance` | (no se manda) | `QA-ACT cambio de fuente` | `2026-09-18T09:30:00.000Z` | queda `repair`, **`assignedTo` sigue** `QA-ACT Diego` |
| `QA-ACT-005` | `loss` | (no se manda) | `QA-ACT perdido en obra` | `2026-08-11T18:45:00.000Z` | queda `lost`, **`assignedTo` sigue** `QA-ACT Carla` |

Los movimientos de `#003` se registran **en ese orden** (el `checkout` antes del `maintenance`) y
el fixture es coherente solo si se respeta: si se mandan al revés, el `assignedTo` queda puesto
por el movimiento posterior y el estado que queda es el del último movimiento cargado. Como el
historial se ordena por `happened_at`, el orden de la ficha no depende del orden de carga.

**El quinto movimiento, el `checkin`, se agrega y se quita durante la vuelta** (casos
`ACT-MOV-03` y `ACT-E2E-04`), y hay que dejar el fixture como estaba al terminar.

**Ajustes.** Los defaults del servidor: `currency = '$'` y `timezone = 'America/Santiago'`. Para
`ACT-AJU-02` y `ACT-AJU-03` se cambian a `MXN` y `America/Mexico_City`, y **se restauran al
final**. El `organizationId` de los ajustes no se puede cambiar desde la pantalla.

**Con los datos de arriba, los números que deben aparecer son:**

- `GET /api/dashboard` -> `200 {"total":5,"porStatus":{"active":2,"repair":1,"retired":1,"lost":1},"valorEnUsoCents":65045,"recientes":[…5 filas…]}`
- `GET /api/assets?limit=500` -> `200 {"items":[…5, en orden `code` ascendente…],"total":5,"limit":500,"offset":0}`
- `GET /api/assets/next-code` -> `200 {"code":"QA-ACT-006","prefijo":"QA-ACT-"}`
- `#resumen` -> seis tarjetas: `5 Activos en libros` (con acento), `2 En uso`, `1 En reparacion`,
  `1 Dados de baja`, `1 Perdidos`, `$ 650,45 Valor en uso`
- `#recientes` -> cinco fichas, en este orden: `QA-ACT-005`, `QA-ACT-004`, `QA-ACT-003`,
  `QA-ACT-002`, `QA-ACT-001`
- Los totales del patrimonio, que **no** aparecen en ninguna tarjeta, son `45055+19990+65045+120000+45055 = 295145` centavos, o sea `$ 2.951,45`. Si alguien ve `$ 2.951,45` en la tarjeta de valor, está sumando todo en vez de solo lo que está en uso (`ACT-TAB-02`).

Si alguno de estos números no cuadra, parar y anotarlo en la sección 9 antes de seguir: casi
siempre la causa es un activo archivado de una vuelta anterior, un movimiento duplicado o una
moneda que quedó en `MXN`.
## 3. Precondiciones

- El Core arriba en `CORE_URL=http://localhost:3108` y el producto con una sesión válida.
  `GET /health` responde `200 {"ok":true,"product":"activos","name":"Activos"}` **sin** sesión,
  así que sirve de comprobación de arranque.
- La sesión dura lo que el token del Core (15 minutos por defecto). Al expirar, `/api/*` responde
  `401 {"error":"expirado","loginUrl":…}` y el navegador salta al login del Core: no es un
  defecto del producto. Volver a entrar y anotarlo en el registro.
- `AMG_SSO_INTROSPECT=0` en desarrollo significa que una baja de suscripción en el Core **no** se
  nota en el acto; en producción el compose lo deja en `1` y corta al instante.
- Para `ACT-API-01`, `ACT-API-08` y `ACT-REG-07` hace falta **una segunda organización** con
  suscripción a Activos y al menos un activo propio, para comprobar que nada se mezcla y que el
  mismo código sí se puede repetir en otra empresa.
- Herramientas: DevTools con Network y **Preservar log**, y `curl` con la cookie `app_session`
  para los casos de API. Todos los comandos de `curl` de este documento son con la sesión puesta:
  sin ella todo responde `401`.
- Cargar los datos de la sección 2 **antes** de empezar y **anotar los ids** que devuelve el
  servidor: no se pueden fijar a mano. Guardarlos en una nota con la forma `activoId`.
- Anotar también los `created_at` de los cinco activos: los usa `ACT-TAB-03` para el orden de
  `Últimos activos registrados`.
- Restar el estado del fixture antes de una vuelta nueva: nada de archivados, nada de movimientos
  de más, moneda `$`, zona `America/Santiago`, y los cinco activos con los estados de la tabla.

---
## 4. Casos por módulo

### 4.1 Panel Tablero — tarjetas y últimos activos

| | |
|---|---|
| **ID** | ACT-TAB-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con los cinco activos de la sección 2. |
| **Pasos** | 1. Abrir `/`.<br>2. Contar las tarjetas de `#resumen` y leerlas en orden.<br>3. Comparar con `GET /api/dashboard` en crudo.<br>4. Mirar la clase del contenedor y cuál tarjeta sale con color. |
| **Esperado** | `#resumen` lleva la clase `ui-rejilla ui-rejilla--4` y muestra **seis** tarjetas, en este orden: `Activos en libros`, `En uso`, `En reparacion`, `Dados de baja`, `Perdidos`, `Valor en uso`. Los valores son `total`, `porStatus.active`, `porStatus.repair`, `porStatus.retired`, `porStatus.lost` y `valorEnUsoCents` de la respuesta. Con los datos de la sección 2: `5`, `2`, `1`, `1`, `1` y `$ 650,45`. **Solo la primera sale con el acento de color** (`ui-kpi__cifra--acento`): es el único elemento del arreglo que se pasa a `AMIGO_UI.kpis` con el tercer valor en `true`. La rejilla dice `--4` aunque haya seis tarjetas, porque el grid es `flex-wrap` y a 1280 px las seis caben en una fila. El servidor arma **los cuatro estados aunque alguno dé cero**, para que la pantalla no encoja con los datos del mes. |

| | |
|---|---|
| **ID** | ACT-TAB-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2, y anotado el total del patrimonio: `295145` centavos. |
| **Pasos** | 1. Leer la tarjeta `Valor en uso`.<br>2. Sumar a mano el costo de los activos `En uso` (`45055` + `19990`).<br>3. Sumar los cinco costos.<br>4. Cambiar un activo de estado y volver a mirar la tarjeta. |
| **Esperado** | La tarjeta vale **`$ 650,45`**, que es solo la suma de los **dos** activos `active` (`#001` + `#002`): el `valorEnUsoCents` se arma con `coalesce(sum(cost_cents), 0)` del grupo `active` y nada más. **No** vale `$ 2.951,45` (todo el patrimonio) ni `$ 650,45` más lo del taller: un bien en el taller, dado de baja o perdido sigue en el inventario pero no es capital trabajando, y por eso la tarjeta se llama `Valor en uso`. Al pasar `#002` a `En reparacion` la tarjeta baja a `$ 450,55`; al pasarlo a `Perdido`, a `$ 0,00`. Con `coalesce` el cero nunca es `null`, así que en una organización sin activos `active` la tarjeta muestra `$ 0,00` y no un hueco. |

| | |
|---|---|
| **ID** | ACT-TAB-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos con `created_at` distintos y anotados. |
| **Pasos** | 1. Leer la tarjeta `Últimos activos registrados`.<br>2. Anotar el orden, el título y la línea secundaria de las cinco fichas.<br>3. Comparar con `recientes` de `GET /api/dashboard`.<br>4. Registrar un activo nuevo y volver al tablero. |
| **Esperado** | Salen **los cinco**, del más nuevo al más viejo por `created_at`: `QA-ACT-005`, `QA-ACT-004`, `QA-ACT-003`, `QA-ACT-002`, `QA-ACT-001`. El servidor corta en `limit 5`, así que un sexto activo nuevo **entra primero y el último se cae** de la tarjeta (pero no de la tabla). El título es `código · nombre` y la línea secundaria son los datos que vienen, unidos con ` · ` y **sin los vacíos**: `Perdido · QA-ACT Carla · $ 450,55`, `Dado de baja · $ 1.200,00` (sin responsable ni ubicación, y con el separador de miles), `En reparacion · QA-ACT Diego · Taller · $ 650,45`, `En uso · QA-ACT Bruno · Obra norte · $ 199,90`, `En uso · QA-ACT Ana · Bodega central · $ 450,55`. No hay columna de categoría ni de serie. Cada ficha trae un botón `Ficha` que abre la ficha de ese activo. Los archivados **no** salen: la consulta filtra `archived_at IS NULL`. |

| | |
|---|---|
| **ID** | ACT-TAB-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2 y el `activoId` de `QA-ACT-004` anotado (es el único sin movimientos y el único que se puede archivar sin ensuciar los números). |
| **Pasos** | 1. En `?panel=activos`, pulsar `Archivar` en la fila de `QA-ACT-004`.<br>2. Volver al tablero y leer las seis tarjetas y `Últimos activos registrados`.<br>3. Pedir `GET /api/assets/QA-ACT-004` y `GET /api/assets/<id>/ficha`.<br>4. Restaurar con `PATCH /api/assets/<id>` y cuerpo `{"archived":false}`. |
| **Esperado** | 1: sale un `PATCH /api/assets/<id>` con `{"archived":true}`, un aviso verde `Activo archivado`, y la fila desaparece de la tabla (la pantalla se recarga entera antes de avisar). 2: el tablero pasa a `total 4` y `Dados de baja 0`, y `QA-ACT-004` desaparece de `Últimos activos registrados`. 3: las dos rutas siguen respondiendo `200`: archivar **esconde, no borra**, así que el activo y su ficha se siguen leyendo por id (aunque `#004` no tenga movimientos, su ficha responde `Sin movimientos registrados`). 4: el `PATCH` con `archived:false` deja `archivedAt` en `null` y el activo vuelve a la tabla y a las tarjetas. En la pantalla **no** hay forma de hacer ese paso 4: archivar es puerta de ida (`R-02`). |

| | |
|---|---|
| **ID** | ACT-TAB-05 |
| **Tipo / Prioridad** | FUNC / P2 |
| **Precondición** | Una organización limpia, con suscripción a Activos y sin ningún activo. |
| **Pasos** | 1. Abrir `/`.<br>2. Leer las seis tarjetas y la tarjeta de últimos activos.<br>3. Registrar el primer activo y volver a abrir `/`. |
| **Esperado** | Las seis tarjetas muestran `0`, y la de `Valor en uso` muestra **`$ 0,00`** (con `coalesce(sum(...), 0)` y el formato `es-CL` de dos decimales, no un guion ni un hueco). `#recientes` muestra el texto **`Todavia no hay activos registrados`** en un `<p class="ui-vacio">`, y es el único texto de esa lista. Con el primer activo cargado, `#recientes` trae esa ficha sola y las tarjetas quedan en `1`, `1`, `0`, `0`, `0` y el costo de ese activo. |

### 4.2 Panel Activos — tabla, buscador y filtro

| | |
|---|---|
| **ID** | ACT-LST-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. Abrir `?panel=activos`.<br>2. Contar las columnas y leer los títulos.<br>3. Leer el orden de las filas.<br>4. Ver dónde quedó la serie de cada activo y en qué columna se alinean los costos. |
| **Esperado** | La tabla tiene **8 columnas**: `Codigo`, `Nombre`, `Categoria`, `Estado`, `Lo tiene`, `Ubicacion`, `Costo` y una **última sin título** (la de acciones). El `Costo` va con `class="num"` en el `<th>` y en la celda, y es la única columna alineada a la derecha. El orden es **por código ascendente** (`QA-ACT-001` a `QA-ACT-005`), no por nombre ni por fecha: lo declara el `orderBy` del `crudRouter`. El **número de serie va debajo del nombre**, dentro de la misma celda y con salto de línea, sin columna propia. El estado sale como etiqueta de color (`En uso` en ok, `En reparacion` en aviso, `Dado de baja` en neutro, `Perdido` en malo), nunca el valor crudo. |

| | |
|---|---|
| **ID** | ACT-LST-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `admin` y, en paralelo, una sesión de `member`. |
| **Pasos** | 1. En `?panel=activos`, contar los botones de la celda de acciones de una fila.<br>2. Repetir con la sesión de `member`.<br>3. Con `member`, pulsar `Borrar` sobre un activo **sin** movimientos.<br>4. Mirar la petición y el `#aviso`. |
| **Esperado** | 1: **cuatro** botones, en este orden: `Ficha`, `Editar`, `Archivar` (fantasma) y `Borrar` (fantasma y peligro), y **ninguno de los dos pide confirmación**: van derecho al servidor (`R-03`). No hay botón de «ver archivados» ni de desarchivar. 2: un `member` ve **los cuatro**, porque la pantalla no consulta el rol en ningún momento: `GET /api/inicio` sí lo devuelve y `app.js` no lo usa. 3: el `member` recibe `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` y el `#aviso` lo muestra en rojo, **sin** que el activo se borre: la garantía real es el `requireRole('admin')` del `DELETE` (`R-01`). 4: el `Borrar` de un `member` es un botón que no puede hacer nada, y el `Archivar` sí le funciona (el `PATCH` es de `member`). |

| | |
|---|---|
| **ID** | ACT-LST-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2 y **Preservar log** en Network. |
| **Pasos** | 1. Mirar el desplegable `#activo-filtro` y sus opciones.<br>2. Elegir `En reparacion`.<br>3. Contar las filas y mirar si sale alguna petición nueva.<br>4. Elegir `Perdido`, luego `Dado de baja`, luego `Todos`. |
| **Esperado** | El desplegable tiene **cinco** opciones: `Todos` (vacía), `En uso`, `En reparacion`, `Dado de baja` y `Perdido`; los cuatro valores son los del enum de la API. Al elegir `En reparacion` queda **una sola** fila, la de `QA-ACT-003`, y **no sale ninguna petición a la red**: el filtro se aplica sobre `estado.activos`, que ya está en el navegador. Por eso la API ni siquiera tiene un filtro por estado declarado (`R-05`): `GET /api/assets?status=repair` devuelve los cinco. Al volver a `Todos` vuelven las cinco filas, también sin peticiones. La búsqueda por texto y el filtro se combinan (`ACT-LST-05`). |

| | |
|---|---|
| **ID** | ACT-LST-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. Escribir `  QA-ACT Ana  ` en `#activo-buscar` (con espacios al principio y al final).<br>2. Escribir `lenovo` en minúsculas.<br>3. Escribir `SN-QA-003`.<br>4. Escribir `gbh`.<br>5. Escribir `herramienta` y después `Taller`.<br>6. Escribir `%`. |
| **Esperado** | El buscador **recorta los espacios** y compara **sin distinguir mayúsculas**, así que `  QA-ACT Ana  ` y `ana` dan lo mismo. Busca en **seis** columnas: `code`, `name`, `brand`, `model`, `serial` y `assignedTo` — las mismas que el `search` del `crudRouter`. `lenovo` encuentra `#001` por la marca, `SN-QA-003` también (el `LIKE` de SQLite no distingue mayúsculas para ASCII), y `gbh` encuentra `#002` por el modelo. **`herramienta` y `Taller` no encuentran nada**, porque la categoría y la ubicación no son campo de búsqueda ni en la pantalla ni en la API, aunque el texto del `placeholder` (`Codigo, nombre, serie, quien lo tiene`) sugiera que sí. El `%` **no** funciona como comodín en pantalla: `includes` lo trata como un carácter literal y no aparece ninguna fila (`R-06`). |

| | |
|---|---|
| **ID** | ACT-LST-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. Poner `#activo-buscar` en `QA-ACT` y `#activo-filtro` en `Todos`.<br>2. Poner el filtro en `En uso`.<br>3. Escribir `Ana` con el filtro en `Perdido`.<br>4. Borrar el texto dejando solo el filtro en `En uso` y contar las celdas del mensaje vacío. |
| **Esperado** | Con `QA-ACT` salen las cinco filas (el prefijo está en los cinco códigos). Con `En uso` quedan dos, `#001` y `#002`. **`Ana` con `Perdido` da tabla vacía**, aunque `QA-ACT Ana` existe: el filtro de estado y el buscador se aplican los dos, y el que no cumple se queda fuera. El mensaje es **`No hay activos que coincidan`**, en un `<p class="ui-vacio">` dentro de una **única celda con `colspan="8"`** que toma el ancho de la tabla, no en ocho celdas ni en una columna angosta. No hay distinción entre «no hay activos» y «no hay coincidencias»: el texto es el mismo. |

| | |
|---|---|
| **ID** | ACT-LST-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2, con `#003` y `#004` sin marca, modelo ni serie, y `#004` y `#005` sin ubicación. |
| **Pasos** | 1. Leer las columnas `Lo tiene` y `Ubicacion` de las cinco filas.<br>2. Abrir la ficha de `QA-ACT-004` y `QA-ACT-005`.<br>3. Buscar el guion largo `—` en el código de la pantalla. |
| **Esperado** | En la tabla los datos que faltan salen como **guion corto `-`** (un solo carácter), en `Lo tiene` de `#004` y en `Ubicacion` de `#004` y `#005`. En la ficha los mismos datos salen como **`Sin marca`, `Sin modelo`, `Sin serie`, `Sin ubicacion`**, y los pares `Comprado` y `Notas` **desaparecen** si no hay valor (`R-16`). El guion largo `—` no aparece en ninguna parte de este producto: es el guion de la tabla del CRM y acá se usa el corto a propósito. Ningún campo vacío se muestra como `null` ni como hueco en blanco. |

| | |
|---|---|
| **ID** | ACT-LST-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2, con un filtro y un buscador puestos. |
| **Pasos** | 1. Poner `Ana` en `#activo-buscar` y `En uso` en `#activo-filtro`.<br>2. Pulsar `F5`.<br>3. Mirar el buscador, el filtro y la URL.<br>4. Navegar a `?panel=tablero` y volver a `?panel=activos`. |
| **Esperado** | El buscador y el filtro **se pierden al recargar**: la pantalla no guarda nada en la URL ni en `sessionStorage`, así que después del `F5` `#activo-buscar` queda vacío, `#activo-filtro` vuelve a `Todos` y salen las cinco filas. La URL tampoco los lleva (`?panel=activos`, sin más parámetros). Es el mismo comportamiento que el filtro de cliente del CRM y está anotado acá porque quien prueba un listado con filtro y recarga sin querer se AGRETA que el buscador «se come» los datos. |

| | |
|---|---|
| **ID** | ACT-LST-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. Comparar la columna `Costo` de las cinco filas con `costCents` de la API.<br>2. Mirar `#001` (`45055`), `#004` (`120000`) y un activo creado con costo `0`.<br>3. Mirar la pista `se ve como …` del formulario con `45055` y con `120000` escritos. |
| **Esperado** | La columna muestra el costo **dividido por 100 y con dos decimales fijos**, en formato `es-CL`: `45055` -> `$ 450,55`, `19990` -> `$ 199,90`, `120000` -> `$ 1.200,00` (con punto de miles), `65045` -> `$ 650,45`, `0` -> `$ 0,00`. El símbolo sale de los ajustes (`currency`), así que con `MXN` cambia en las cinco filas. La conversión ocurre **al pintar**, con `Math.trunc(valor) / 100` y un `Intl.NumberFormat('es-CL')`: en pantalla no hay ningún `* 100`, y la API tampoco (guarda y devuelve centavos). La pista del formulario (`#activo-costo-vista`) dice `se ve como $ 450,55` mientras se escribe, con el mismo criterio. Ojo: la pista **trunca** y la API **redondea**, así que con un decimal la vista y lo guardado no coinciden (`ACT-FRM-08`, `R-13`). |
### 4.3 Formulario de alta y de edición

| | |
|---|---|
| **ID** | ACT-FRM-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión activa, con los datos de la sección 2. |
| **Pasos** | 1. Pulsar `#activo-nuevo` en la barra superior.<br>2. Leer el título del diálogo, `#activo-id`, `#activo-estado` y `#activo-costo`.<br>3. Mirar en qué panel se está y qué muestra la barra de direcciones.<br>4. Cerrar el diálogo con `Cancelar` y con la `×`, y volver a abrirlo. |
| **Esperado** | Abre `#activo-dialog` como modal sobre lo que se estaba viendo, con el título **`Nuevo activo`** y `#activo-id` **vacío** (es lo que decide entre `POST` y `PATCH`). El estado por defecto es **`En uso`** (`active`) y el costo es `0`, con la pista `se ve como $ 0,00`. El botón está en `.ui-topbar__acciones` y se ve **en los tres paneles**, incluso en Ajustes, y **no** cambia el `?panel=` de la URL: se abre el formulario encima, sin navegar (el mismo detalle que en el CRM). `Cancelar` y la `×` cierran los dos sin preguntar nada y sin escribir en el servidor; al reabrir, el formulario vuelve a estar vacío, porque `abrirActivo(null)` limpia los once campos. `Esc` también lo cierra, porque es un `dialog` nativo. |

| | |
|---|---|
| **ID** | ACT-FRM-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member` o de `admin`. |
| **Pasos** | 1. Abrir el formulario y contar los campos en el orden del DOM.<br>2. Contar los `maxlength` y los tipos de cada `input`.<br>3. Comprobar qué campos están marcados como requeridos.<br>4. Comprobar que cada `label` apunta a su campo y leer el texto de la pista del costo. |
| **Esperado** | Hay **once** campos visibles y un `#activo-id` oculto: `Codigo` (`name="code"`, requerido, 40, con botón `Proponer` al lado), `Nombre` (`name`, requerido, 150), `Categoria` (`category`, requerido, 150, con placeholder `herramienta, equipo de computo, vehiculo`), `Marca` (`brand`, 80), `Modelo` (`model`, 80), `Numero de serie` (`serial`, 80), `Estado` (`status`, `select` con cuatro valores), `Ubicacion` (`location`, 150), `Lo tiene` (`assignedTo`, 120), `Comprado el` (`purchaseDate`, `date`), `Costo (centavos)` (`costCents`, `number`, `min="0"`, `step="1"`, valor `0`) y `Notas` (`notes`, 2000). Son **doce** filas de formulario contando la pista. Todos los `label` tienen `for` apuntando a su `input`, y solo tres están marcados como requeridos: código, nombre y categoría. El rótulo del costo dice **centavos** a propósito (`R-13`). Abajo están `Guardar` y `Cancelar`. |

| | |
|---|---|
| **ID** | ACT-FRM-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2, con `QA-ACT-005` como el código más alto de la empresa. |
| **Pasos** | 1. Abrir el formulario y pulsar `Proponer`.<br>2. Leer `#activo-codigo` y la respuesta de `GET /api/assets/next-code`.<br>3. Escribir un código propio y volver a pulsar `Proponer`.<br>4. Guardar el activo propuesto y guardar **otro** activo con el mismo código. |
| **Esperado** | `Proponer` pide `GET /api/assets/next-code` y escribe **`QA-ACT-006`** en `#activo-codigo`, que es el siguiente del más alto de la empresa con el **mismo ancho** (tres dígitos, porque el código más alto es de tres). La respuesta trae también `prefijo: "QA-ACT-"`, que la pantalla **no** muestra: la propuesta es solo el código, y quien lo quiera cambiar lo escribe. El botón es una **propuesta, no una reserva**: dos `Proponer` seguidos devuelven `QA-ACT-006` los dos, y el segundo alta con ese mismo código recibe `409 Ya existe un activo con el codigo QA-ACT-006 en esta empresa` (`R-10`). Es lo contrario de Inventario y del CRM: acá el que propone el número es el servidor y no el formulario, para que dos personas de la misma empresa no propongan el mismo número a la vez. |

| | |
|---|---|
| **ID** | ACT-FRM-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`, con los cinco activos de la sección 2. |
| **Pasos** | 1. Abrir el formulario, `Proponer` el código, y llenar solo código, nombre y categoría.<br>2. Guardar sin tocar los demás campos.<br>3. Mirar el cuerpo de la petición en Network y la fila nueva en la tabla.<br>4. Mirar el `#aviso` y cuánto tiempo dura. |
| **Esperado** | Sale `POST /api/assets` con `201` y un cuerpo de **doce** claves: los tres rellenados más `status:"active"`, `costCents:0`, y **los ocho campos vacíos como `null`, no como `""`** (`brand`, `model`, `serial`, `location`, `assignedTo`, `purchaseDate`, `notes`), porque el servidor distingue «no lo tengo» de «lo tengo en blanco`. El `id` lo pone el servidor (`createId('act')`), y la respuesta trae la fila completa con `organizationId`, `createdAt` y `archivedAt: null`. El diálogo se cierra, la tabla se repinta **con la fila nueva** y el `#aviso` muestra **`Activo creado`** en verde (`ui-aviso--ok`) durante **5 segundos**, y después se esconde solo. En la tabla la fila nueva sale con `-` en `Lo tiene` y `Ubicacion`, `En uso` de etiqueta y `$ 0,00` en el costo. |

| | |
|---|---|
| **ID** | ACT-FRM-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`, con `QA-ACT-001` ya creado. |
| **Pasos** | 1. Abrir el formulario, escribir `QA-ACT-001` como código, con nombre y categoría nuevos, y guardar.<br>2. Mirar el `#aviso` y si el diálogo se cerró.<br>3. Repetir con el código `qa-act-001` en minúsculas.<br>4. Repetir con ` QA-ACT-001 ` con espacios al principio y al final. |
| **Esperado** | 1: `409` con el texto **`Ya existe un activo con el codigo QA-ACT-001 en esta empresa`** en el `#aviso` en rojo, y **el diálogo no se cierra**: los tres campos quedan con lo que se escribió, para poder corregir sin volver a abrir. El `409` se decide **dentro de la transacción**, no antes, así que dos altas simultáneas del mismo código dan un `409` y no un error de SQLite. 2: la tabla no cambia. 3: `qa-act-001` **se crea sin problema**: el código se compara tal cual, sin pasar a mayúsculas, así que `EQ-004` y `eq-004` son dos bienes distintos y el índice único los acepta. 4: los espacios se **recortan** (`trim`) antes de comparar, así que ` QA-ACT-001 ` choca con `QA-ACT-001` y también da `409`. El `422` de la API es un `400 {"error":"Datos inválidos", …}` con el detalle por campo. |

| | |
|---|---|
| **ID** | ACT-FRM-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2 y el `activoId` de `QA-ACT-001` anotado. |
| **Pasos** | 1. En la fila de `QA-ACT-001`, pulsar `Editar`.<br>2. Leer el título, `#activo-id` y los once campos.<br>3. Cambiar solo la ubicación, guardar, y mirar la petición.<br>4. Abrir la edición otra vez y pulsar `Cancelar` y la `×`, y comprobar que el `updatedAt` no cambió. |
| **Esperado** | 1: el título pasa a **`Editar activo`** y `#activo-id` trae el id. 2: los once campos vienen **rellenos** desde la fila, incluido `#activo-estado` con el estado actual, y la pista del costo ya muestra el valor convertido (`se ve como $ 450,55`). El número de serie aparece en su campo aunque en la tabla esté debajo del nombre. 3: sale `PATCH /api/assets/<id>` con `200` y **el cuerpo completo** (los doce campos), no un `PATCH` parcial: el formulario siempre manda todo, y la API lo parte de la fila existente para que quien manda solo el estado no borre el resto (`routes.ts:549-567`). El aviso dice `Activo actualizado`. 4: `Cancelar` y la `×` cierran **sin preguntar y sin escribir**, y `updatedAt` sigue igual: no hay ningún aviso de «cambios sin guardar». |

| | |
|---|---|
| **ID** | ACT-FRM-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2. Se usa `QA-ACT-004`, que está `Dado de baja` y **sin movimientos**, para que se vea que el cambio de estado no deja historial. |
| **Pasos** | 1. Pulsar `Editar` en `QA-ACT-004` y cambiar `#activo-estado` a `En reparacion`.<br>2. Guardar y mirar la petición.<br>3. Abrir la ficha de `QA-ACT-004` y leer el historial.<br>4. Volver a dejar el estado en `Dado de baja`.<br>5. Repetir el paso 1 con `Perdido` en un activo en uso y mirar el tablero. |
| **Esperado** | El formulario **deja elegir cualquiera de los cuatro estados** y lo escribe con un `PATCH`/`POST` normal, **sin registrar ningún movimiento**: el estado pasa a `En reparacion` con el `updated_at` cambiado y el historial sigue en **`Sin movimientos registrados`**. Es exactamente lo contrario de lo que declaran los comentarios del propio producto (`app.js:11-18` y `routes.ts:30-34`: el único que debería escribir estados es la API de movimientos, para que no queden activos en reparación sin un movimiento que lo explique). El mismo camino sirve para poner `Perdido` por formulario, saltándose el `loss` que documenta la pérdida. El código es deliberado en `retired` (es una decisión de negocio y no un hecho físico, `routes.ts:122-131`) y **por eso `retired` es el único estado que debe poder elegirse**; los otros tres deberían venir de un movimiento (`R-04`). Al devolverlo a `Dado de baja`, la tabla y el tablero vuelven a `1 Dados de baja`. |

| | |
|---|---|
| **ID** | ACT-FRM-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`, con los ajustes en `$` (para no confundir símbolo con problema). |
| **Pasos** | 1. Abrir el formulario y escribir `45055` en `#activo-costo`, mirando la pista.<br>2. Escribir `0` y mirar la pista.<br>3. Escribir `450,55` (con **coma** decimal) y mirar el campo y la pista.<br>4. Guardar y leer `costCents` en la respuesta y en la fila.<br>5. Borrar el activo del paso 4 y escribir `450.55` (con punto), y observar si el navegador deja enviar. |
| **Esperado** | 1: la pista se actualiza en cada tecla (`input`) y dice **`se ve como $ 450,55`**. 2: `se ve como $ 0,00`. 3: **el campo se queda vacío**: un `input type="number"` no acepta la coma, así que el valor se sanea a `""` y la pista vuelve a `se ve como $ 0,00`. El campo **no es requerido**, así que la validación nativa lo deja pasar y el alta **se guarda con `costCents: 0`**, sin aviso de nada: quien escriba el monto como se escribe en Chile (`450,55`) registra un bien de `$ 0,00` (`R-13`). 4: la fila muestra `$ 0,00`. 5: con punto, el navegador marca el campo como no válido para `step="1"` y **bloquea el envío** con su propio mensaje, así que el decimal nunca sale por la pantalla (por API sí, y ahí la API redondea: `450.55` se guarda como `451`, mientras la pista truncaba a `$ 4,50`, `ACT-API-06`). |

| | |
|---|---|
| **ID** | ACT-FRM-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `member`. |
| **Pasos** | 1. Abrir el formulario y guardar con todo vacío.<br>2. Escribir 41 caracteres en `#activo-codigo` y 151 en `#activo-nombre`.<br>3. Escribir una fecha en `#activo-compra` y guardar.<br>4. Escribir texto con acentos, ñ y un `<script>` en `#activo-nombre`, y `#activo-notas`.<br>5. Comprobar con `curl` qué acepta la API en `purchaseDate`. |
| **Esperado** | 1: el navegador bloquea el envío con su propio mensaje en los tres campos requeridos y **no sale ninguna petición** a la red: la validación nativa viene primero que el `submit`. 2: los `maxlength` impiden escribir de más, así que tampoco sale ninguna petición. 3: `#activo-compra` es `date`, así que solo acepta el formato del navegador y guarda `AAAA-MM-DD` tal cual; al reabrir la edición se ve el mismo día, sin corrimiento de zona (es una fecha, no un instante). 4: los acentos y la `ñ` se guardan bien, y el `<script>` sale **literal** en la tabla y en la ficha, sin ejecutarse: la ficha se arma con `document.createElement` y `textContent`, nunca con `innerHTML`. 5: por API, `2026-9-4` da `400 La fecha de compra va como AAAA-MM-DD` y `2026-02-31` da `400 Fecha invalida`, porque el formato se valida a mano contra un `Date.parse` estricto y no con `Date.parse` a secas (`routes.ts:78-84`). |

### 4.4 Ficha de un activo

| | |
|---|---|
| **ID** | ACT-FIC-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. Pulsar `Ficha` en la fila de `QA-ACT-001`.<br>2. Leer el título y las etiquetas de la cabecera.<br>3. Mirar la barra de direcciones.<br>4. Cerrar con `Cerrar`, con la `×` y con `Esc`, y volver a abrir. |
| **Esperado** | Sale `GET /api/assets/<id>/ficha` y se abre `#ficha-dialog` como modal **encima de la lista**, sin cambiar de panel. El título es **`QA-ACT-001 · Portátil QA de terreno`** (`código · nombre`). Debajo hay una línea de etiquetas: el estado con su color (`En uso` en ok), la categoría (`equipo de computo`, neutra), y **`Lo tiene QA-ACT Ana`** porque hay responsable. Si el activo está archivado, se suma la etiqueta **`Archivado`**. La ficha **no cambia la URL** y no hay forma de abrirla por enlace ni de marcarla: un `F5` la cierra. Abajo del `<dl>` está el formulario `Registrar un movimiento`, dentro del mismo diálogo. La respuesta trae `asset`, `movements` y `resumen`. |

| | |
|---|---|
| **ID** | ACT-FIC-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2; en particular `#003`, `#004` y `#005` sin marca, modelo ni serie, y `#005` sin fecha de compra ni notas. |
| **Pasos** | 1. Abrir la ficha de `QA-ACT-001` y leer todos los pares del `<dl>`.<br>2. Abrir la de `QA-ACT-002`.<br>3. Abrir la de `QA-ACT-003`.<br>4. Abrir la de `QA-ACT-005`.<br>5. Comparar con la fila de la tabla. |
| **Esperado** | Siempre salen **cinco** pares: `Marca`, `Modelo`, `Serie`, `Ubicacion` y `Costo`. `Comprado` sale **solo** si hay fecha, y en formato `DD/MM` sin cambiar el dato guardado (`2026-03-09` se ve `09/03`). `Notas` sale **solo** si hay texto. Los vacíos **no** se esconden: se muestran como `Sin marca`, `Sin modelo`, `Sin serie` y `Sin ubicacion`. Con los datos de la sección 2: `#001` muestra `Lenovo`, `ThinkPad T14`, `SN-QA-001`, `Bodega central`, `09/03`, `$ 450,55` y `QA-ACT notebook de terreno`; `#002` no muestra `Notas`; `#003` muestra los cuatro `Sin …` y `20/01`; `#005` no muestra ni `Comprado` ni `Notas`. Lo que **no** sale nunca, aunque la API lo devuelva: `createdAt`, `updatedAt`, `archivedAt` (como fecha) y `resumen.ultimoMovimientoAt` (`R-16`). |

| | |
|---|---|
| **ID** | ACT-FIC-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos con los cinco movimientos de la sección 2. |
| **Pasos** | 1. Abrir la ficha de `QA-ACT-003` y leer el historial.<br>2. Abrir la de `QA-ACT-001` y la de `QA-ACT-004`.<br>3. Comparar el texto de cada movimiento con `happenedAt` de la API.<br>4. Comparar el pie con `resumen` de la respuesta. |
| **Esperado** | El historial va **del movimiento más nuevo al más viejo** por `happened_at`: en `QA-ACT-003` sale primero **`A reparacion`** (nota `QA-ACT cambio de fuente`, `18-09-2026, 09:30`) y después **`Salio`**. En `QA-ACT-001` sale un solo `Salio`. Los rótulos son los de la API traducidos: `Salio` (checkout), `Volvio` (checkin), `A reparacion` (maintenance), `Se perdio` (loss), cada uno con su color. Debajo de la lista hay una línea de resumen: **`2 movimiento(s) en el historial`** para `#003`, **`0 movimiento(s) en el historial`** para `#004`. El texto del instante lo pone `new Date(happenedAt).toLocaleString('es-CL')`, o sea **en la zona horaria del navegador y con un formato que depende de la versión de ICU**: con la red y el navegador del equipo de pruebas, `2026-09-18T09:30:00.000Z` se ve como la hora local del equipo, no como `09:30` UTC (`R-16`). Cuando no hay movimientos, la lista muestra **`Sin movimientos registrados`**. |

| | |
|---|---|
| **ID** | ACT-FIC-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `activoId` de `QA-ACT-004` (sin movimientos) y de `QA-ACT-001` (con uno) anotados. |
| **Pasos** | 1. Con la ficha de `QA-ACT-001` abierta, archivar el activo por API y volver a abrir la ficha.<br>2. Leer las etiquetas y el historial.<br>3. Desarchivar por API y volver a abrir la ficha.<br>4. Repetir el archivado en la pantalla (`Archivar`) y comprobar que la ficha no se puede abrir desde la lista. |
| **Esperado** | Archivado, la ficha **sigue abriendo y se sigue viendo igual**, con la etiqueta `Archivado` sumada a la línea de estado, el mismo historial y el mismo `resumen`: archivar saca el bien de la lista, no de la historia. Por eso `archivedAt` se pinta como etiqueta y no como fecha en el `<dl>`. Al desarchivar por API, la etiqueta desaparece. Desde la pantalla, archivar hace que el activo **no aparezca en la tabla ni en `Últimos activos registrados`**, así que no hay forma de llegar a la ficha desde la UI (se puede por API, y `GET /api/assets/<id>` también responde `200` con `archivedAt` con valor). Volver a desarchivar desde la pantalla es imposible (`R-02`). |

| | |
|---|---|
| **ID** | ACT-FIC-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de la organización A, con `activoId` de un activo de A y de un `activoId` de la organización B. |
| **Pasos** | 1. Pedir `GET /api/assets/<id-de-B>/ficha`.<br>2. Pedir `GET /api/assets/<id-que-no-existe>/ficha`.<br>3. Con la sesión de B, pedir `GET /api/assets/<id-de-A>/ficha`.<br>4. Mirar el `#aviso` y si se abre algún diálogo. |
| **Esperado** | 1 y 2: `404 {"error":"Ese activo no existe"}`, el mismo mensaje para un id de otra empresa y para uno inventado. **Nunca `403`**: decir «es de otra empresa» confirmaría que ese id existe, que es justo lo que se le quiere negar. 3: también `404`, nunca datos ajenos. 4: el mensaje va al `#aviso` en rojo y **no se abre la ficha**: si había una ficha abierta de antes, se queda la anterior en pantalla (el `replaceChildren` solo corre cuando la respuesta es `200`), así que hay que comprobar el texto del título para saber cuál se está viendo. Ojo con el mismo hecho leído por otra ruta: `GET /api/assets/<id>` (la del `crudRouter`) responde `404 {"error":"No encontrado"}`, un texto distinto para el mismo activo ausente (`R-24`). |
### 4.5 Movimientos — la invariante de estado

| | |
|---|---|
| **ID** | ACT-MOV-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de `QA-ACT-001` anotado. Con los datos de la sección 2 tiene `active`, responsable `QA-ACT Ana` y **un** movimiento. |
| **Pasos** | 1. Abrir su ficha y registrar un `checkout` con responsable `QA-ACT Daniela` y nota `QA-ACT segundo retiro`.<br>2. Mirar la petición y la respuesta.<br>3. Mirar la etiqueta de estado y el responsable en la cabecera de la ficha.<br>4. Mirar el historial y el resumen.<br>5. Comprobar que los campos del formulario se limpian y que la ficha se repinta sola. |
| **Esperado** | 1: sale `POST /api/assets/<id>/movimientos` con `{"kind":"checkout","note":"QA-ACT segundo retiro","assignedTo":"QA-ACT Daniela"}` y **`201`**. El cuerpo **no** lleva `happenedAt`: lo pone el servidor. 2: la respuesta trae **`asset` y `movement`** (las dos cosas en el mismo `POST`), con `movement.id` de prefijo `actmov`, y el `asset` ya con el estado y el responsable nuevos. 3: la etiqueta sigue siendo **`En uso`**: un retiro **no** cambia el estado, porque el bien sale pero sigue siendo del patrimonio y lo único que cambia es quién lo tiene (`routes.ts:136-149`). El responsable pasa a `QA-ACT Daniela` y la etiqueta dice `Lo tiene QA-ACT Daniela`. 4: el historial suma el `Salio` **primero**, con la nota y la hora del servidor, y el resumen pasa a `2 movimiento(s) en el historial`. 5: `#movimiento-nota` y `#movimiento-responsable` quedan vacíos y el aviso verde dice `Movimiento registrado`. |

| | |
|---|---|
| **ID** | ACT-MOV-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de `QA-ACT-002` anotado, con `QA-ACT Bruno` como responsable. |
| **Pasos** | 1. En la ficha, elegir `Salio (checkout)` y **dejar vacío** el responsable, con una nota.<br>2. Guardar y leer el `400` y el mensaje.<br>3. Repetir escribiendo solo espacios en el responsable.<br>4. Repetir por API con `{"kind":"checkout","note":"x","assignedTo":null}`.<br>5. Comprobar que no se escribió nada: leer `assignedTo`, el estado y el historial. |
| **Esperado** | 1 y 2: `400 {"error":"Un retiro (checkout) necesita saber a quien se entrega: manda assignedTo"}` en el `#aviso` en rojo. El campo vacío viaja como `null` (el `|| null` del JS), así que el error es el de la API y no un aviso de la pantalla. 3: con solo espacios, el `trim` del schema los convierte en `""`, y `!""` es verdadero, así que **también** da `400`: la validación es del servidor y no depende de la pantalla. 4: el mismo `400` por API, y con `{"kind":"checkout"}` sin la clave también. 5: el chequeo es **antes de tocar la base** (`routes.ts:423-425`), así que no queda un movimiento huérfano ni cambia el estado: `assignedTo` sigue siendo `QA-ACT Bruno`, el estado sigue `active` y el historial sigue con un movimiento. Los otros tres tipos **no** exigen responsable y no mandan la clave en la pantalla. |

| | |
|---|---|
| **ID** | ACT-MOV-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de `QA-ACT-003` (en `repair`, responsable `QA-ACT Diego`, dos movimientos) y `activoId` de `QA-ACT-001` anotados. |
| **Pasos** | 1. Registrar un `checkin` en `QA-ACT-003` con una nota.<br>2. Mirar el estado, el responsable y el historial.<br>3. Volver a mandar `maintenance` en el mismo activo.<br>4. Mirar otra vez el estado y el responsable.<br>5. Comprobar por API qué columnas cambiaron con un `checkin` y con un `maintenance`. |
| **Esperado** | 1: `201`, y el estado pasa de `repair` a **`active`** (un bien que vuelve del taller vuelve a estar operativo). 2: el responsable **sigue siendo `QA-ACT Diego`**: un `checkin` **no borra** el responsable, porque «la última persona que lo tuvo» es información y se reemplaza en el próximo `checkout` en vez de desaparecer (`routes.ts:456-460`). La pantalla no manda `assignedTo` en un `checkin`, así que ni siquiera puede pedirlo. 3: un `maintenance` vuelve a dejar el activo en `repair` y **tampoco** toca el responsable. 4: el historial queda con cuatro movimientos, y el orden se lee `A reparacion`, `Volvio`, `A reparacion`, `Salio`. 5: en el `PATCH` interno solo se escriben `status`, `updated_at` y, **únicamente en un `checkout` con responsable**, `assigned_to`; en los otros tres tipos el `assigned_to` no aparece en el `set`. Es la diferencia clave con un `checkout`, que es el único que cambia de manos. Al terminar el caso, devolver `QA-ACT-003` a `repair` con un `maintenance` y dejar el historial con los dos movimientos de la sección 2. |

| | |
|---|---|
| **ID** | ACT-MOV-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de `QA-ACT-005` (en `lost`, con `QA-ACT Carla` y un movimiento) anotado. |
| **Pasos** | 1. Registrar un `loss` con la nota `QA-ACT segunda perdida`, sin responsable.<br>2. Mirar el estado, el responsable y el historial.<br>3. Registrar un `checkout` con `QA-ACT Esteban` sobre el mismo activo.<br>4. Mirar los tres estados por los que pasó y el tablero.<br>5. Volver a dejarlo en `lost` con un `loss`. |
| **Esperado** | 1: `201`, el estado sigue **`lost`** y el responsable **sigue siendo `QA-ACT Carla`**: `loss` documenta que se perdió, no quién lo tenía antes, y no cambia de manos. 2: el historial suma un `Se perdio` primero. 3: un `checkout` **sí** lo devuelve a `active` y le pone el responsable nuevo: un bien perdido que aparece en manos de alguien está en uso otra vez (y el test «retirar un bien dado de baja lo vuelve a poner en uso» cubre el mismo camino). 4: los estados son una cadena, no un estado por activo: `lost` -> `active`, y en el tablero el bien pasa de `Perdidos` a `En uso` y su costo entra a `Valor en uso`. 5: al volver a `loss`, la tarjeta `Perdidos` vuelve a `1`. Un `loss` no necesita responsable y la pantalla no se lo pide (el campo se ve, pero se ignora, `R-23`). |

| | |
|---|---|
| **ID** | ACT-MOV-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de un activo nuevo sin movimientos (crear `QA-ACT-007 temporal` con costo `0`). |
| **Pasos** | 1. Registrar un `checkout` y anotar el `happenedAt` del movimiento, el `updatedAt` del activo y la hora del `#aviso`.<br>2. Buscar en el producto alguna ruta que escriba en `asset_movements` sin tocar `assets`.<br>3. Registrar un `checkout` con el mismo responsable dos veces seguidas.<br>4. Con la red en `Slow 3G`, registrar un movimiento y pulsar el botón dos veces rápido.<br>5. Intentar borrar el activo temporal con `DELETE`. |
| **Esperado** | 1: el `happenedAt` del movimiento y el `updatedAt` del activo son **el mismo instante**, porque las dos escrituras van en **una transacción**: `better-sqlite3` es síncrono, así que si el `INSERT` se escribiera y el `UPDATE` fallara, no habría forma de dejar el movimiento solo. El `400` del responsable faltante, en cambio, se comprueba **antes** de abrir la transacción. 2: no hay ninguna: el único `INSERT` en `asset_movements` está dentro del `POST` de movimientos, y no hay un endpoint de escritura directa de la tabla. 3: los dos movimientos quedan escritos (no hay deduplicación) y el estado y el responsable quedan igual, así que el historial muestra dos `Salio` con el mismo responsable. 4: si el doble clic llega a mandar dos peticiones, quedan **dos** movimientos: el formulario no se deshabilita al guardar y no hay clave de idempotencia, así que un doble clic rápido duplica la fila. Anotarlo si aparece. 5: el activo temporal se borra con `DELETE` (tiene movimientos, así que **no**: hay que usar el `DELETE` solo si no tiene movimientos, o archivar). El `DELETE` con movimientos da `409`. |

| | |
|---|---|
| **ID** | ACT-MOV-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `activoId` de `QA-ACT-004` anotado (está `retired` con cero movimientos). |
| **Pasos** | 1. Registrar un movimiento desde la ficha con Network abierto y copiar el cuerpo de la petición.<br>2. Buscar `happenedAt` en `app.js` y en `index.html`.<br>3. Registrar por API un movimiento con `happenedAt` del mes pasado.<br>4. Abrir la ficha y mirar el orden y el texto de la hora.<br>5. Comparar con `resumen.ultimoMovimientoAt`. |
| **Esperado** | 1: el cuerpo es solo `{kind, note}` más `assignedTo` cuando el tipo es `checkout`. **No** hay ningún campo de fecha en el formulario ni en el JS. 2: `happenedAt` no aparece en `index.html` y en `app.js` solo aparece en un comentario; el instante lo pone el servidor con `nowIso()`, porque un movimiento se escribe mientras pasa. 3: la API **sí** lo acepta, y con un `happenedAt` del mes pasado el movimiento se guarda con esa fecha (es el mecanismo que usa la sección 2 para tener un historial reproducible). 4: el historial se ordena por `happened_at` descendente, así que un movimiento retroactivo **queda en su fecha** y no primero, y el texto que se ve sale de esa fecha en la zona del navegador (`R-14`, `R-16`). 5: `resumen.ultimoMovimientoAt` sigue siendo la del movimiento más nuevo por `happened_at`, que puede ser uno escrito a mano en el pasado; ese campo no se muestra en la ficha, así que la inconsistencia no se ve en la pantalla. Dejar `QA-ACT-004` como estaba al terminar (queda con dos movimientos). |

| | |
|---|---|
| **ID** | ACT-MOV-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `activoId` de `QA-ACT-004` y un `activoId` inexistente anotados. |
| **Pasos** | 1. `POST /api/assets/<id>/movimientos` con `{"kind":"prestamo"}`.<br>2. Con `{"kind":"checkin","note":"…"}` y una nota de 2001 caracteres.<br>3. Con `{"kind":"checkin","happenedAt":"ayer"}`.<br>4. Con `{"kind":"checkin","assetId":"otro","organizationId":"otra","id":"mio"}`.<br>5. Con `{"kind":"checkin"}` sobre el `activoId` inexistente.<br>6. Mirar los cuatro `400` y el `404` en el `#aviso`. |
| **Esperado** | 1: `400 {"error":"Datos inválidos", …}` con `kind: …` y el enum de los cuatro valores, en formato `name: message` unido con ` · `. 2: lo mismo con `note: …`, y el detalle dice que el máximo es 2000. 3: `400` con `happenedAt: Instante invalido: va como ISO, por ejemplo 2026-09-27T15:00:00.000Z`: la fecha del movimiento **sí** es un instante ISO, a diferencia de la de compra. 4: **`201`, no `400`**: el `movimientoSchema` **no** es estricto, así que `assetId`, `organizationId` e `id` se descartan en silencio y el movimiento se escribe sobre el activo de la URL, en la organización de la sesión, con el id del servidor (`R-08`). Esto es distinto del `crudRouter` de clientes, que sí responde `400 Campo desconocido`. 5: `404 {"error":"Ese activo no existe"}`, y como el chequeo está **dentro** de la transacción, no queda ningún movimiento escrito. 6: los cinco mensajes van al `#aviso` en rojo, con el nombre del campo adelante, y ninguno muestra una traza ni un texto interno. |

| | |
|---|---|
| **ID** | ACT-MOV-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `activoId` de `QA-ACT-001` y el `movementId` de su movimiento anotados. |
| **Pasos** | 1. `PATCH /api/assets/<id>/movimientos/<movementId>` con `{"note":"corregido"}`.<br>2. `DELETE /api/assets/<id>/movimientos/<movementId>`.<br>3. `GET /api/assets/<id>/movimientos`.<br>4. `POST /api/assets/<id>/movimientos/<movementId>`.<br>5. Buscar botones de editar o de borrar movimiento en la ficha. |
| **Esperado** | 1, 2 y 4: `404 {"error":"No existe PATCH /api/assets/…"}`, `No existe DELETE /api/assets/…` y `No existe POST /api/assets/…`: **la ruta no existe**, no es un `403` ni un `405`. El historial es de solo lectura por diseño (`routes.ts:36-38`) y por eso tampoco hay un `GET` de la lista de movimientos: el historial solo sale dentro de `GET /api/assets/:id/ficha`. 3: `404 No existe GET /api/assets/<id>/movimientos`, porque `crudRouter` no tiene GET `/:id/movimientos` y su `GET /:id` no matchea dos segmentos. 5: en la ficha hay **un solo** formulario, el de **registrar** un movimiento, y ningún botón de editar ni de borrar ninguno de los existentes. Un movimiento equivocado se corrige registrando el contrario, y queda para siempre al lado (`R-15`). |

| | |
|---|---|
| **ID** | ACT-MOV-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | `activoId` de `QA-ACT-004` anotado. |
| **Pasos** | 1. Abrir el formulario de movimiento de la ficha y mirar los dos campos.<br>2. Escribir un responsable, elegir `Volvio (checkin)` y registrar.<br>3. Leer la respuesta cruda de la API y ver si `assignedTo` cambió.<br>4. Mirar el `#movimiento-responsable` después de registrar. |
| **Esperado** | 1: los dos campos están **siempre visibles**: `#movimiento-tipo` con cuatro opciones (`Salio (checkout)`, `Volvio (checkin)`, `A reparacion (maintenance)`, `Se perdio (loss)`) y `#movimiento-responsable`, cuyo `label` dice **`A quien se entrega (solo en checkout)`**. La pantalla **no** oculta el campo ni lo deshabilita según el tipo: es el rótulo el que avisa, y el servidor es el que exige. 2: el movimiento se registra igual y sin aviso, aunque lo que se haya escrito en el responsable. 3: el cuerpo **no** incluye `assignedTo` cuando el tipo no es `checkout` (el JS solo lo agrega en ese caso), así que lo escrito se pierde en silencio y el responsable del activo no cambia. 4: los dos campos se limpian igual, así que no queda señal de que hubo un texto ignorado (`R-23`). |

### 4.6 Panel Ajustes

| | |
|---|---|
| **ID** | ACT-AJU-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `admin`, con los datos de la sección 2. |
| **Pasos** | 1. Abrir `?panel=ajustes` y leer los dos campos.<br>2. Guardar sin cambiar nada.<br>3. Cambiar `Moneda` a `MXN` y `Zona horaria` a `America/Mexico_City`, y guardar.<br>4. Pedir `GET /api/settings`.<br>5. Comprobar que hay **una sola** fila de preferencias para la organización. |
| **Esperado** | 1: el formulario tiene **dos** campos y nada más: `Moneda` (`name="currency"`, 5 caracteres) y `Zona horaria` (`name="timezone"`, 64). Se llenan recorriendo `form.elements` y usando el **`name`** de cada input, así que el `id` (`cfg-moneda`, `cfg-zona`) no importa: un ajuste nuevo se agrega poniendo un `<input name="…">` en el HTML, sin tocar el JS. 2: sale `PUT /api/settings` con `{"currency":"$","timezone":"America/Santiago"}` y `200`, con el aviso verde `Ajustes guardados`. 3: el `PUT` es de `admin`; la respuesta trae `organizationId` y los dos valores ya guardados. 4: `GET /api/settings` responde `{settings:{organizationId,…}}`, con el **`organizationId` dentro** y no en la raíz. 5: el `idx_activos_settings_org` es UNIQUE, así que dos personas guardando a la vez no dejan dos filas compitiendo: la segunda hace `UPDATE` de la primera, y el id de la fila es `cfg_<organizationId>`. Restaurar `$` y `America/Santiago` al final. |

| | |
|---|---|
| **ID** | ACT-AJU-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `admin`, con los datos de la sección 2 y el costo de `#001` en `$ 450,55`. |
| **Pasos** | 1. Poner la moneda en `MXN` y guardar.<br>2. Ir al tablero y leer las seis tarjetas.<br>3. Ir a `?panel=activos` y leer la columna `Costo`.<br>4. Abrir la ficha de `QA-ACT-001` y leer el par `Costo`.<br>5. Poner la zona horaria en `Pacific/Kiritimati` y guardar, y recorrer el tablero, la lista y la ficha.<br>6. Restaurar los dos valores. |
| **Esperado** | 1 y 2: el símbolo **sí** cambia en todas partes: `MXN 650,45` en `Valor en uso` y en la ficha de `Valor en uso`. La cifra no cambia, porque la moneda solo se pinta: el número que llega de la API ya está en centavos y en pantalla no hay ningún `* 100` ni `/ 100` aparte de la división al pintar (`app.js:54-67`). 3: las cinco filas de la tabla cambian a `MXN 450,55`, `MXN 199,90`, `MXN 650,45`, `MXN 1.200,00`, `MXN 450,55`. 4: el par `Costo` de la ficha también. Ojo: la moneda de la ficha de un activo **no** se guarda con el activo, es la de los ajustes de la empresa, así que cambiar la moneda reescribe el pasado de todas las fichas. 5: **no cambia absolutamente nada**: no hay un solo `hoy` ni una fecha relativa en este producto, así que el tablero, la tabla y la ficha dan exactamente lo mismo con `Pacific/Kiritimati` que con `America/Santiago`. El ajuste se guarda y se valida, pero es un dato muerto acá (`R-17`). |

| | |
|---|---|
| **ID** | ACT-AJU-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `admin` y, en paralelo, una sesión de `member`. |
| **Pasos** | 1. Poner `Zona horaria` en `NoExiste/Pepe` y guardar.<br>2. Poner `Moneda` en seis caracteres y guardar.<br>3. Con `member`, cambiar los dos campos y pulsar `Guardar ajustes`.<br>4. Recargar y leer lo que quedó guardado y lo que muestra el formulario.<br>5. Restaurar los valores originales. |
| **Esperado** | 1: `400 {"error":"Zona horaria desconocida: NoExiste/Pepe"}`, en rojo, y el valor escrito **se queda en el campo**. La validación es contra `Intl` (`new Intl.DateTimeFormat('en-CA', {timeZone})`), no contra una lista escrita a mano: cualquier zona de la base IANA sirve (`Pacific/Kiritimati`, `America/Mexico_City`) y una lista propia envejece. 2: `400 {"error":"Datos inválidos", …}` con `currency: …` y el máximo de 5 caracteres, lo que deja una moneda de hasta 5 letras o un símbolo. 3: un `member` **puede escribir en los dos campos** (el formulario no se deshabilita) y el `PUT` responde `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`, en rojo. 4: al recargar, lo guardado es lo viejo y el formulario vuelve a mostrar lo viejo, así que el texto que el `member` había escrito **desaparece**: la pantalla no queda mostrando un valor falso en este caso, porque el JS solo reescribe los campos con la respuesta del servidor, que en el `403` no llega (`R-20`). 5: restaurar `$` y `America/Santiago`. |

| | |
|---|---|
| **ID** | ACT-AJU-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión de `admin`, con la moneda en `$` y al menos cinco activos. |
| **Pasos** | 1. Abrir `?panel=activos`, anotar el símbolo de la columna `Costo`.<br>2. Ir a `?panel=ajustes`, cambiar la moneda a `MXN` y guardar.<br>3. Volver a `?panel=activos` **con el enlace del canal**, sin recargar.<br>4. Recargar con `F5`.<br>5. Con la ficha de un activo abierta, cambiar la moneda y volver a mirarla. |
| **Esperado** | 1: `$`. 2: el aviso dice `Ajustes guardados` y el formulario queda con `MXN`. 3: la columna `Costo` **sigue con `$`**: tras el `PUT` el JS solo llama a `renderConfig()` y a `pintarCosto()`, y **no** a `repintar()`, así que la tabla no se vuelve a pintar y los símbolos quedan viejos hasta el siguiente repintado. Se nota porque el estado en memoria (`estado.cfg`) sí es el nuevo, así que cualquier texto que se pinte **después** (una pista del formulario, un aviso) ya sale con `MXN`, y conviven los dos en la misma pantalla (`R-18`). 4: con `F5` la tabla ya sale con `MXN`, porque `cargar()` pide los ajustes antes de pintar. 5: la ficha tampoco se repinta sola tras el `PUT`, así que su par `Costo` conserva el símbolo viejo mientras la ficha siga abierta. |
### 4.7 API

Los once casos de esta sección van con `curl` y la cookie de sesión. Todos los ejemplos usan la
base de la sección 2.

| | |
|---|---|
| **ID** | ACT-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de la organización A y de la organización B, con un activo en cada una y sus `id` anotados. |
| **Pasos** | 1. Con la sesión de A, pedir `GET /api/assets/<id-de-B>`.<br>2. Con la sesión de A, pedir `GET /api/assets/<id-de-B>/ficha`.<br>3. Con la sesión de A, `PATCH /api/assets/<id-de-B>` con `{"name":"secuestrado"}`.<br>4. Con la sesión de A, `DELETE /api/assets/<id-de-B>`.<br>5. Con la sesión de A, `POST /api/assets/<id-de-B>/movimientos` con `{"kind":"checkin"}`.<br>6. Con la sesión de A, `POST /api/assets` con `organizationId` de B en el cuerpo.<br>7. Con la sesión de A, `GET /api/assets` y contar. |
| **Esperado** | 1 a 5: **`404`**, nunca `403` ni datos ajenos: 1 responde `No encontrado` (es la lectura del `crudRouter`) y los otros cuatro `Ese activo no existe` (son las rutas escritas a mano). El mensaje no distingue «es de otra empresa» de «no existe», porque esa distinción confirmaría que el id existe (`routes.ts:219-221`). Ninguna de las cinco escrituras deja nada escrito en B: el `404` sale **dentro de la transacción** y la fila de B queda intacta. 6: `201` con el **`organizationId` de A** en la respuesta: el `organizationId` del cuerpo se descarta (el schema no lo declara) y la fila se crea en la organización de la sesión. 7: la lista trae solo los activos de A. Este es el caso que hace obligatorio el filtro por organización en cada consulta: el `CASCADE` de `asset_movements` apunta a `assets(id)` **sin** columna de organización, así que un movimiento mal colgado cruzaría empresas (`routes.ts:25-28`). |

| | |
|---|---|
| **ID** | ACT-API-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. `GET /api/assets?limit=500` y leer `items`, `total`, `limit` y `offset`.<br>2. Verificar el orden de `items`.<br>3. `GET /api/assets` sin parámetros.<br>4. `GET /api/assets?offset=2&limit=2`.<br>5. `GET /api/assets?limit=-1` y `GET /api/assets?limit=99999`.<br>6. Archivar `QA-ACT-004` por API y repetir el paso 1. |
| **Esperado** | 1: `200` con las cuatro claves de la respuesta del `crudRouter`: `items` (los cinco, con `organizationId`, `archivedAt` y `updatedAt` incluidos, porque `readRow` copia la fila entera antes de convertir), `total: 5`, `limit: 500` y `offset: 0`. 2: por **`code` ascendente** (`orderBy: assets.code`), que es el `orderBy` declarado y no el `created_at` por defecto del runtime. 3: sin `limit` sale `limit: 200` (`defaultLimit`), con los mismos cinco. 4: `offset` funciona: `items` con los dos últimos y `total: 5` (el total **no** descuenta el offset, es el total del filtro), así que un paginador cuenta la misma cosa que la tabla muestra. 5: `?limit=-1` devuelve **los cinco y más** sin recorte, porque el recorte es `Math.min(Number(limit) || 200, 1000)` y `Math.min(-1, 1000)` es `-1`, que SQLite lee como «sin límite»; `?limit=99999` sí se recorta a `1000`. Ninguno de los dos da `400` (`R-07`). 6: con `QA-ACT-004` archivado, `items` trae cuatro y `total: 4`: el filtro `archived_at IS NULL` se aplica **también al total**, no solo a las filas. El tablero cuenta los mismos cuatro (`ACT-TAB-04`). |

| | |
|---|---|
| **ID** | ACT-API-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Los cinco activos de la sección 2. |
| **Pasos** | 1. `GET /api/assets?limit=500&q=Ana`.<br>2. Con `q=herramienta`, `q=Taller` y `q=Lenovo`.<br>3. Con `q=sn-qa-003` y con `q=%`.<br>4. Con `q=%25`.<br>5. Con `status=repair`, `category=herramienta` y `inventario=1`, uno por uno. |
| **Esperado** | 1: `items` con uno solo, `#001`, que lo tiene; el `LIKE` de SQLite no distingue mayúsculas para ASCII. 2: `herramienta` **no** encuentra `#002` (la categoría no es campo de búsqueda, a propósito: `routes.ts:719-723`) y `Taller` tampoco lo encuentra (la ubicación tampoco); `Lenovo` sí, por la marca. 3: `sn-qa-003` encuentra `#003`; `%` devuelve **los cinco**, porque el texto se mete en un `LIKE '%<q>%'` sin escapar y `%` es comodín — en la pantalla el mismo `%` no encuentra nada, porque ahí se compara con `includes` (`R-06`). 4: `%25` (el `%` escapado a mano) sí busca el signo literal y devuelve `items: []`. 5: los tres parámetros se **ignoran en silencio** y devuelven los cinco, con `200`: el `crudRouter` de activos se declara **sin `filters`**, así que no hay filtro por estado ni por categoría que la API pueda aplicar (`R-05`). Un parámetro inventado tampoco da `400`. |

| | |
|---|---|
| **ID** | ACT-API-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`. |
| **Pasos** | 1. `POST /api/assets` con un cuerpo válido más `id`, `organizationId`, `createdAt`, `updatedAt`, `archivedAt` y una clave inventada (`foo`).<br>2. Leer la fila devuelta.<br>3. `PATCH /api/assets/<id>` con `{"name":"otro nombre","id":"mio","createdAt":"2000-01-01"}`.<br>4. Leer la fila.<br>5. Repetir el paso 3 con `{"archivado":true}` (mal escrito). |
| **Esperado** | 1: **`201`, no `400`**, y la respuesta es la fila real: `id` con prefijo `act` y no el enviado, `organizationId` de la sesión, `createdAt` y `updatedAt` del servidor (`updatedAt` en `null` al crear) y `archivedAt: null`. Todas las claves que no están en el `activoSchema` se **descartan en silencio**, incluidas las que alguien intentaría forzar (`organizationId`, `createdAt`) y la inventada. 2: el `GET` posterior trae lo mismo, así que el `id` y la organización forzados no quedaron. 3: `200` y el `name` cambia, el `id` y el `createdAt` siguen siendo los del servidor: el `PATCH` es un **merge sobre la fila existente** (se arma el objeto con lo que ya había y se le pisa encima `req.body`), así que un `PATCH` parcial no borra lo que no se manda. 4: confirmado en el `GET`. 5: `archivado` mal escrito se descarta como cualquier otra clave desconocida y el activo **no** se archiva, sin error: un `200` que parece haber guardado algo que no guardó (`R-08`). Contraste: en el CRM el mismo `POST` contra el `crudRouter` responde `400 Campo desconocido: …`. |

| | |
|---|---|
| **ID** | ACT-API-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de `QA-ACT-004` anotado, sin movimientos. |
| **Pasos** | 1. `POST /api/assets` con `{"code":"QA-ACT-008", …,"archived":true}`.<br>2. Leer `archivedAt` y `createdAt` de la respuesta.<br>3. `GET /api/assets?limit=500&q=QA-ACT-008`.<br>4. `PATCH /api/assets/<id-de-008>` con `{"archived":false}`.<br>5. `PATCH` con `{"archived":"si"}`, luego con `{"archived":"no"}` y luego con `{"archived":"cualquiera"}`.<br>6. `PATCH` con `{"archivedAt":"9999-01-01"}`.<br>7. `PATCH` con `{"archived":"1"}`. |
| **Esperado** | 1: `201` con `archivedAt` **igual a `createdAt`** (el servidor pone las dos con el mismo `nowIso()`): se puede crear ya archivado, y el `archived_at` no lo elige el cliente. 2: es un `PATCH` reversible y la fecha la pone el servidor, que es la razón de que `archived` sea booleano y no `archivedAt`. 3: el activo archivado **no** sale de la lista (`archived_at IS NULL`). 4: `200` con `archivedAt: null` y vuelve a salir en la lista. 5: `"si"` y `"1"` archivan; **`"no"` y `"cualquiera"` desarchivan**, porque el preprocesado solo reconoce `"true"`, `"1"` y `"si"` como verdadero y cualquier otro texto se convierte en `false`, que es un booleano válido: no hay `400` y el bien sale de la lista por un `PATCH` que parecía no hacer nada (`R-09`). 6: la clave se descarta (schema no estricto) y el activo sigue como estaba: mandarle la fecha directamente no archiva nada. 7: `"1"` archiva. Borrar `QA-ACT-008` con `DELETE` al terminar (no tiene movimientos). |

| | |
|---|---|
| **ID** | ACT-API-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`. |
| **Pasos** | 1. `POST /api/assets` con `"costCents":"45055"` (string).<br>2. Con `45055.4`, con `45055.5` y con `0.4`.<br>3. Con `-1`, con `"abc"` y con `1e5`.<br>4. Sin la clave.<br>5. Con `costCents` mayor a `100000000000`.<br>6. Leer el `typeof` y el `Number.isInteger` de lo guardado. |
| **Esperado** | 1: `201` con `costCents: 45055`: el schema usa `z.coerce.number()`, así que el `"45055"` de un formulario y el `45055` de un cliente son lo mismo. 2: `45055.4` -> `45055` y `45055.5` -> `45056`, porque hay **un solo** `Math.round` y es **al escribir** (`routes.ts:102-109`): una columna de patrimonio que guarde `45055.4` tiene un valor que no es un centavo y al sumarlo con otros la diferencia aparece en el total, que es el número que nadie puede explicar. `0.4` -> `0`. 3: `-1` -> `400 El costo no puede ser negativo`; `"abc"` -> `400 El costo tiene que ser un numero`; `1e5` -> `100000` (la notación científica también entra). 4: sin la clave, `costCents` vale `0` (tiene `default`), y no `null`. 5: el máximo es `100000000000` centavos, y lo que se pase da `400`. 6: lo guardado **siempre** es un entero: `typeof costCents === "number"` y `Number.isInteger(costCents)` dan `true` para los cinco casos. Para leer no hace falta transformar nada, porque lo que se guardó ya es entero. Ojo con la pantalla: la pista **trunca** (`Math.trunc(valor/100)`) mientras la API **redondea**, así que con un decimal la vista y lo guardado no coinciden (`R-13`). |

| | |
|---|---|
| **ID** | ACT-API-07 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`. |
| **Pasos** | 1. `POST /api/assets` con `purchaseDate: "2026-03-09"`.<br>2. Con `"2026-9-4"`, `"2026-02-31"`, `"2026-13-01"` y `"septiembre de 2026"`.<br>3. Con `null` y con la clave ausente.<br>4. Leer el `purchaseDate` guardado y el texto que muestra la ficha.<br>5. Crear un activo con `purchaseDate` y abrir su ficha. |
| **Esperado** | 1: `201` con `purchaseDate: "2026-03-09"`, **tal cual**, sin hora ni conversión. 2: los cuatro dan `400`: `La fecha de compra va como AAAA-MM-DD` para los tres con formato distinto y `Fecha invalida` para el día 31 de febrero, porque el `refine` usa `Date.parse('<v>T00:00:00Z')` sobre un formato ISO estricto. El código **no** usa `Date.parse` a secas justamente porque ése acepta `2026-9-4`, `septiembre de 2026` y también `42`. 3: `null` y ausente dan `purchaseDate: null`. 4: el dato guardado es una **fecha**, no un instante: la ficha lo muestra como `DD/MM` (`09/03`) y no se corre un día al convertir de huso, que es el motivo de que se guarde sin hora (`schema.ts:64-66`). 5: el `<input type="date">` del navegador solo produce `AAAA-MM-DD`, así que desde la pantalla no se puede provocar el `400`. |

| | |
|---|---|
| **ID** | ACT-API-08 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | Sesión de `member`, con `QA-ACT-001` creado y el `id` de una segunda organización con un activo. |
| **Pasos** | 1. `POST /api/assets` con `"code":"   "` y luego con 41 caracteres.<br>2. Con `"code":" eq-007 "`.<br>3. Con `"code":"qa-act-001"`.<br>4. En la organización B, `POST /api/assets` con `"code":"QA-ACT-001"`.<br>5. `PATCH /api/assets/<id>` de un activo con `"code":"QA-ACT-002"` (el de otro) y luego con `"code":"QA-ACT-004"`.<br>6. Repetir el alta de `QA-ACT-001` desde la pantalla. |
| **Esperado** | 1: `"   "` da `400 El codigo no puede ir vacio` (el `trim` deja la cadena vacía) y 41 caracteres da `400 … demasiado largo` / `String must contain at most 40 character(s)`: un código es una etiqueta, y una de 40 caracteres no se dicta por radio. 2: se guarda **`eq-007`**: los espacios se recortan y el resto se respeta tal cual, **sin pasar a mayúsculas**. 3: `qa-act-001` se crea sin conflicto, porque el índice único es `(organization_id, code)` y SQLite compara el texto tal cual: `QA-ACT-001` y `qa-act-001` son **dos activos distintos** con dos códigos que la gente pronunciaría igual (`routes.ts:56-60`). 4: el mismo código en la organización B se crea sin problema: la numeración es por empresa y un índice global obligaría a la segunda a inventar otro prefijo. 5: `409 Ya existe un activo con el codigo QA-ACT-002 en esta empresa` en ambos casos, y **tampoco** cambia nada más del activo: el `409` se decide dentro de la transacción y sale antes del `UPDATE`. 6: la pantalla da el mismo `409` con el mismo texto (`ACT-FRM-05`). |

| | |
|---|---|
| **ID** | ACT-API-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Los cinco activos de la sección 2, más un caso alterno: `EQ-001` y `MAQ-010` en la misma organización. |
| **Pasos** | 1. `GET /api/assets/next-code` con los datos de la sección 2, dos veces seguidas.<br>2. Crear `EQ-001` y `MAQ-010` y volver a pedirlo.<br>3. Escribir a mano `QA-ACT-050` y volver a pedirlo.<br>4. Archivar `QA-ACT-005` y pedir el código.<br>5. En una organización nueva, crear `LAPTOP-ANA` y `PROY-A`, y pedir el código.<br>6. Adivinar y usar el código propuesto, dos veces. |
| **Esperado** | 1: `{"code":"QA-ACT-006","prefijo":"QA-ACT-"}`, y **las dos veces igual**: la propuesta no reserva nada, así que dos personas pueden proponer el mismo número y la segunda recibe `409` al guardar (`R-10`). 2: propone **`MAQ-011`**, no `EQ-002`: el prefijo es el del código con el **número más alto de toda la empresa**, no el del último creado ni el del que esa persona venía usando. Es la misma lógica del folio de solicitudes, y es lo que evita que alguien que escriba `EQ-999` a mano haga retroceder la serie (`routes.ts:304-310`). 3: con `QA-ACT-050` escrito a mano, propone `QA-ACT-051`: la serie no vuelve atrás. 4: un código **archivado sigue contando**, porque se mira `TODOS` los activos de la empresa (`archived_at` incluido): un bien archivado se puede volver a sacar, y reciclar su código termina con dos equipos con el mismo número en el taller. 5: con dos códigos que **no** terminan en número, propone **`{"code":"EQ-1","prefijo":"EQ-"}`**: el prefijo por defecto desde 1, **sin ceros**, aunque el resto de la serie de esa empresa use `EQ-004` (`R-11`). 6: el código propuesto se puede guardar tal cual. |

| | |
|---|---|
| **ID** | ACT-API-10 |
| **Tipo / Prioridad** | FUNC / P0 |
| **Precondición** | `activoId` de `QA-ACT-001` (con un movimiento) y de `QA-ACT-004` (sin movimientos) anotados, y `activoId` inexistente. |
| **Pasos** | 1. `DELETE /api/assets/<id-de-001>`.<br>2. Leer el mensaje completo del `409`.<br>3. Verificar que el activo sigue ahí y que el movimiento sigue en su ficha.<br>4. `DELETE /api/assets/<id-de-004>`.<br>5. Verificar la fila en la base por API (`GET /api/assets/<id>`, `GET /api/assets?limit=500`, `/ficha` y `/movimientos`).<br>6. `DELETE` con un `id` inexistente y con un `id` de otra organización.<br>7. Repetir el paso 1 con una sesión de `member`. |
| **Esperado** | 1 y 2: **`409`** con un texto largo que nombra la alternativa exacta: `Este activo tiene movimientos en su historial y no se borra en cascada: archivalo (PATCH {"archived": true}) en su lugar, que sale de la lista sin perder la historia.` Es el único `409` de borrado y es una instrucción, no un error de programa: la pantalla lo muestra **tal cual** en el `#aviso`. 3: el activo sigue en la lista y en el tablero, y su historial sigue completo. 4: `200 {"asset":{…},"deleted":true}` — la respuesta trae la fila borrada y un `deleted: true` explícito. 5: `GET /api/assets/<id>` da **`404 No encontrado`** y la lista y el tablero lo pierden: un activo sin movimientos **se borra de verdad**, sin fila ni rastro, y no queda archivado. El `CASCADE` del DDL existe (`ddl.ts:43`) para la baja definitiva, pero la API no lo usa nunca. 6: `404 Ese activo no existe` en los dos casos, nunca `403`. 7: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` y nada se borra (`R-01`). Con `QA-ACT-004` borrado, reconstruirlo antes de seguir con los casos de ficha. |

| | |
|---|---|
| **ID** | ACT-API-11 |
| **Tipo / Prioridad** | FUNC / P1 |
| **Precondición** | Sesión activa. |
| **Pasos** | 1. `GET /api/tablero` y `GET /api/resumen`.<br>2. `GET /api/equipos` y `GET /api/inventario`.<br>3. `GET /api/assets/next-code` con `POST`.<br>4. `POST /api/settings` con `{"currency":"$"}`.<br>5. `GET /api/assets/next-code`.<br>6. `GET /api/assets/ficha` (sin id) y `GET /api/assets/<id>/ficha/` (con barra final).<br>7. `POST /health` y `GET /health`. |
| **Esperado** | 1: **`404 No existe GET /api/tablero`**, y lo mismo con `/api/resumen`: en este producto el tablero se llama `/api/dashboard`. Quien reuse un guion del CRM contra Activos se lleva dos `404` y cree que está roto. 2: `404` también: no hay `inventario` ni `equipos` en este producto (el stock es del producto `inventario`, con su propia base). 3: `404 No existe POST /api/assets/next-code`; la ruta existe **solo** como `GET`. 4: `404 No existe POST /api/settings`, porque las preferencias se guardan con `PUT` (`ACT-AJU-01`). 5: `200 {"code":"QA-ACT-006","prefijo":"QA-ACT-"}`: la ruta va **antes** que el `crudRouter` de `/api/assets`, y sin eso `next-code` se leería como un `id` y el alta recibiría un `404` en vez de una propuesta. 6: `GET /api/assets/ficha` da `404 No encontrado` (trata `ficha` como id) y con la barra final la ruta no matchea: `404 No existe GET …`. 7: `200 {"ok":true,"product":"activos","name":"Activos"}` en los dos, **sin sesión**, y el `POST` ejecuta un `SELECT 1` contra la base, así que también sirve de prueba de que el archivo abre. Y el paso 5 es la prueba de que el `crudRouter` no manda en las escrituras: si su `DELETE` fuera el que respondiera, contestaría `{"ok":true,"archived":true}` en lugar de `{"asset":…,"deleted":true}` (`R-26`). |

### 4.8 Sesión, identidad y sistema

| | |
|---|---|
| **ID** | ACT-SIS-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **Precondición** | El producto serviéndose, y DevTools con la sesión cerrada (o `curl` sin cookie). |
| **Pasos** | 1. Pedir `/` con `Accept: text/html` y sin cookie.<br>2. Pedir `/` con `curl` sin `Accept`.<br>3. Pedir `/api/assets?limit=500`, `/api/dashboard`, `/api/settings` y `/api/assets/next-code` sin cookie.<br>4. Con la sesión cerrada, abrir `/` en el navegador.<br>5. Cerrar y dejar vencer la sesión, y repetir el paso 3. |
| **Esperado** | 1: **`302`** al login del Core (el `return_to` vuelve a este producto). 2: **`401 {"error":"expirado","loginUrl":…}`**: sin `Accept: text/html` el runtime no redirige, y `curl` muestra el JSON, que es lo que hay que usar para distinguir «no hay sesión» de «el producto está caído». 3: los cuatro dan `401` con el `loginUrl`; ni siquiera `next-code`, que es de solo lectura. 4: el navegador aterriza en el login del Core, y **este producto no tiene pantalla de login**: no hay campo de usuario ni de clave en ningún lado, y el HTML no se sirve sin sesión. 5: con el token vencido pasa lo mismo, y el cliente HTTP de la pantalla salta al `loginUrl` en vez de pintar una tabla vacía con un error (`amigo-ui.js:331-336`); el `throw` posterior evita que siga pintando con `activos: []`. Volver a entrar y anotarlo en el registro. |

| | |
|---|---|
| **ID** | ACT-SIS-02 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | Sesión activa, con **Preservar log**, y los datos de la sección 2. |
| **Pasos** | 1. Abrir `/` y contar las peticiones.<br>2. Abrir `/?panel=activos` y contar.<br>3. Abrir `/?panel=ajustes` y contar.<br>4. Registrar un movimiento con la ficha abierta y contar de nuevo.<br>5. Comparar el `organizationId` de `/api/inicio`, `/api/settings` y de `GET /api/assets`. |
| **Esperado** | 1: **5 peticiones**: `/api/inicio`, `/api/dashboard` **×2**, `/api/assets?limit=500` y `/api/settings`. El tablero se pide dos veces porque `AMIGO.montar` llama a `alEntrar` de inmediato y el arranque llama otra vez a `cargar().then(repintar)`, y `cargar()` no vuelve a pintar el tablero (`R-22`). 2 y 3: **3 peticiones**: `/api/inicio`, `/api/assets?limit=500` y `/api/settings`. El panel de activos **no pide nada** al pintarse (el filtro y el buscador son del navegador), y el de ajustes solo se llena con lo que ya trajo `cargar()`. 4: el `recargar()` posterior a un movimiento pide `/api/assets?limit=500` y `/api/settings` otra vez, **más** el `GET /ficha` de la ficha que se está mirando: el tablero no se vuelve a pedir porque no está a la vista, así que sus números quedan viejo mientras se edita en otra pestaña. 5: los tres `organizationId` son el mismo y ninguno se puede cambiar desde la pantalla. |

| | |
|---|---|
| **ID** | ACT-SIS-03 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | El producto serviéndose, con y sin sesión. |
| **Pasos** | 1. `GET /health` y `POST /health` sin cookie.<br>2. Repetir los dos con la sesión puesta.<br>3. Agotar el cupo (700 peticiones en 15 minutos) y pedir `/health`.<br>4. Esperar la ventana y repetir. |
| **Esperado** | 1 y 2: `200 {"ok":true,"product":"activos","name":"Activos"}` en los cuatro casos, con y sin sesión, y con el `SELECT 1` contra la base hecho de verdad: si el archivo está corrupto, el `/health` lo dice. El limitador de la aplicación son **600 peticiones cada 15 minutos por IP**, y está montado **antes** de `/health`, así que el chequeo de salud del producto **consume cupo**: con el cupo agotado, `/health` responde `429` en vez de `200`, y un balanceador que lo use como sonda puede sacar el contenedor de rotación por una ráfaga de la propia aplicación. Además el corte es por IP, así que dos organizaciones detrás de la misma salida comparten el mismo cupo (`R-25`). En Docker el compose pone `AMG_SSO_INTROSPECT=1`, así que una baja de suscripción en el Core corta el acceso al instante, no 15 minutos después. |

| | |
|---|---|
| **ID** | ACT-SIS-04 |
| **Tipo / Prioridad** | SIST / P1 |
| **Precondición** | El producto serviéndose **como en despliegue** (`NODE_ENV=production`), porque en desarrollo los TTL de caché son 0. |
| **Pasos** | 1. Pedir `/` y mirar `Cache-Control`, `X-Powered-By` y `Content-Security-Policy`.<br>2. Pedir `/app.js` sin `?v=` y con `?v=1`.<br>3. Pedir `/favicon.ico`.<br>4. Pedir `/index.html?v=abc123`.<br>5. Mandar un cuerpo de 2 MB a `POST /api/assets`.<br>6. Mandar un cuerpo de 2 MB a `POST /api/assets/<id>/movimientos`. |
| **Esperado** | 1: `Cache-Control: no-cache` en el HTML (que se sirve **sin sesión** o con `302`, nunca cacheado con datos), y **sin** `X-Powered-By`. La CSP viene **deshabilitada** en el runtime (`app.ts:95`), así que no hay que esperar un `default-src` que rompa los scripts del shell. 2: los recursos versionados (`/app.js?v=…`, `/style.css?v=…`, `/amigo-ui.js?v=…`) salen con `public, max-age=31536000, immutable` y **también sin `?v=`**: el `setHeaders` se aplica a la carpeta entera, así que el `immutable` no distingue la URL con huella de la que no la tiene (`R-27`). En desarrollo el TTL es 0 y solo sale `public, max-age=0`. 3: `/favicon.ico` es **público**, así que sin sesión no redirige: `404` con el mensaje `No existe GET /favicon.ico`, porque el producto no declara favicon; el error tampoco rompe la página. 4: el HTML es el mismo, con el `?v=` ignorado. 5 y 6: `413 La petición es demasiado grande` en los dos, con el límite de 1 MB, y el cuerpo llega entero al `express.json()` porque el limitador va antes que él. |

| | |
|---|---|
| **ID** | ACT-SIS-05 |
| **Tipo / Prioridad** | SIST / P2 |
| **Precondición** | Sesión de `member` y `curl`. |
| **Pasos** | 1. `POST /api/assets` con `Content-Type: application/json` y cuerpo `{"code":`.<br>2. Con el mismo cuerpo mal formado en `POST /api/assets/<id>/movimientos`.<br>3. Con `Content-Type: text/plain` y un JSON válido.<br>4. Sin `Content-Type`.<br>5. Mirar el log del contenedor en los pasos 1 y 2. |
| **Esperado** | 1 y 2: **`500 {"error":"Error interno del servidor"}`** en los dos, no `400`: `express.json()` lanza un `SyntaxError` con `type: "entity.parse.failed"` y el manejador de errores solo distingue `AppError`, error de Zod y `entity.too.large`, así que lo demás cae en el `500` genérico. En el log aparece el `SyntaxError` con la posición del carácter, o sea la traza entera. 3 y 4: los dos dan `400` con `Datos inválidos` y el detalle de que faltan `code`, `name` y `category`, porque sin `application/json` el cuerpo llega como texto y el schema no encuentra los campos. El `500` de los pasos 1 y 2 ensucia cualquier panel que mire códigos 5xx y no es un defecto de este producto: afecta a los nueve (`R-28`). |
---
## 5. Recorridos E2E

Cinco recorridos completos, para probar el producto como lo usaría una persona y no como una
tabla de endpoints. Cada uno empieza en `/` con la sesión puesta y termina dejando la base como
la describe la sección 2.

| | |
|---|---|
| **ID** | ACT-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión de `admin`, organización limpia (sin activos) o con los de la sección 2. |
| **Pasos** | 1. Abrir `/` y anotar las seis tarjetas.<br>2. Ir a `?panel=activos`, pulsar `Nuevo activo`, `Proponer` el código, llenar los once campos y guardar.<br>3. Comprobar la fila nueva, el aviso y el diálogo cerrado.<br>4. Volver al tablero y comparar `Activos en libros` y `Valor en uso`.<br>5. Abrir la ficha del activo nuevo, registrar un `checkout` con responsable y volver a la ficha.<br>6. Volver al tablero y leer las seis tarjetas y `Últimos activos registrados`.<br>7. Volver a `?panel=activos` y comprobar que la fila y el responsable son los nuevos. |
| **Esperado** | 2: `POST /api/assets` con `201`, el código es el que propuso el servidor, el diálogo se cierra y el aviso dice `Activo creado`. 4: `Activos en libros` sube en uno y `Valor en uso` sube **con el costo del activo nuevo**: el total es la suma de todos los no archivados y el valor en uso solo de los `active`. Si el activo nuevo se creó en `En uso`, entra en las dos. 5: `POST …/movimientos` con `201`; la ficha se repinta sola sin recargar la página y la etiqueta de responsable cambia a `Lo tiene <nombre>`. 6: `En uso` sube en uno, `Valor en uso` **no cambia** (un `checkout` no cambia el estado: el bien sale pero sigue en uso), y el activo aparece **primero** en `Últimos registrados` por `created_at`. 7: la fila única con el nuevo activo, su código, su categoría, `En uso` y el costo convertido a pesos. Al terminar, borrar el activo nuevo por API **si** no tiene movimientos, o dejarlo con el movimiento y archivarlo. |

| | |
|---|---|
| **ID** | ACT-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Sesión de `admin`, con un activo nuevo `QA-ACT-009 ciclo` (sin movimientos) y la sección 2 completa. |
| **Pasos** | 1. Crear `QA-ACT-009 ciclo` en `active`, sin responsable, y anotar el `id`.<br>2. Registrar `checkout` a `QA-ACT Ana`.<br>3. Registrar `maintenance` y anotar el estado y el responsable.<br>4. Registrar `checkin` y anotar lo mismo.<br>5. Registrar `loss` y anotar lo mismo.<br>6. Editar el activo y pasarlo a `retired` desde el formulario.<br>7. Archivar el activo desde la fila.<br>8. Intentar borrarlo y leer el `409`.<br>9. Recorrer el tablero y anotar las seis tarjetas.<br>10. Verificar en la ficha que el historial tiene los cuatro movimientos y que el estado final es `retired`. |
| **Esperado** | Es el recorrido que fija la invariante del producto, y el orden importa: **estado y responsable los decide el tipo de movimiento**, salvo el paso 6. 2: `active`, responsable `QA-ACT Ana`. 3: `repair`, **responsable `QA-ACT Ana` (se conserva)**. 4: `active`, responsable **sigue `QA-ACT Ana`**: un `checkin` devuelve el bien a operativo y no borra el responsable. 5: `lost`, responsable **sigue `QA-ACT Ana`**. 6: `retired` — y este es el **único** estado que se puede elegir a mano, porque es una decisión de negocio y no un hecho físico: el `PATCH` no registra movimiento y el historial sigue en cuatro. Si en el paso 6 se hubiera puesto `repair` o `lost` a mano, el historial también quedaría en cuatro y el activo sería «en reparación sin movimiento que lo explique» (`R-04`, y es justo lo que el caso `ACT-FRM-07` comprueba). 7: sale de la tabla y de `Últimos registrados`, y el `archived_at` lo pone el servidor. 8: `409` con el texto que ofrece `PATCH {"archived": true}`: borrado de verdad **no** es posible con historial. 9: `Activos en libros` baja en uno (los archivados no se cuentan) y `Valor en uso` **no** cuenta el asset archivado. 10: cuatro movimientos en el orden `Se perdio`, `Volvio`, `A reparacion`, `Salio`, y la etiqueta de estado `Dado de baja` con la de `Archivado` al lado. Desarchivar por API al terminar y devolver el activo a `retired`. |

| | |
|---|---|
| **ID** | ACT-E2E-03 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión de `admin`, dos pestañas del mismo navegador, con los cinco activos de la sección 2. |
| **Pasos** | 1. En la pestaña A, abrir `Nuevo activo` y pulsar `Proponer`.<br>2. En la pestaña B, abrir `Nuevo activo` y pulsar `Proponer`.<br>3. Comparar los dos códigos propuestos.<br>4. En A, llenar y guardar.<br>5. En B, llenar y guardar el mismo código.<br>6. Guardar dos veces seguido en A con doble clic. |
| **Esperado** | 3: **los dos códigos son iguales**: la propuesta no reserva el número, así que dos personas de la misma empresa pueden proponer `QA-ACT-006` al mismo tiempo. Es la razón de que el código lo proponga el servidor y no el formulario. 5: el segundo alta recibe `409 Ya existe un activo con el codigo QA-ACT-006 en esta empresa`, en rojo, y el diálogo **no** se cierra: se queda abierto con lo escrito para poder corregir el código. Ninguna de las dos quedan con un activo a medias. 6: el botón `Guardar` **no se deshabilita** mientras corre la petición, así que un doble clic rápido puede llegar a mandar dos `POST`: el primero `201` y el segundo `409` (o dos `201` con códigos distintos si se cambió el código entre medio). Anotarlo si aparece. Con `EQ-004` y `EQ-005` de dos personas distintas, el `409` se decide **dentro** de la transacción, así que nunca se ve un error de SQLite ni una traza. |

| | |
|---|---|
| **ID** | ACT-E2E-04 |
| **Tipo / Prioridad** | E2E / P1 |
| **Precondición** | Sesión de `admin`, con los cinco activos de la sección 2 y los ajustes en `$`. |
| **Pasos** | 1. Anotar el valor de `Valor en uso` en el tablero.<br>2. Editar `QA-ACT-001` y cambiarle el costo a `120055`.<br>3. Volver al tablero y leer las seis tarjetas.<br>4. Editar `QA-ACT-002` y cambiarle el estado a `En reparacion`.<br>5. Volver al tablero y leer las seis tarjetas otra vez.<br>6. Ir a `?panel=activos` y leer la columna `Costo` de las dos filas.<br>7. Abrir la ficha de `QA-ACT-001` y leer el par `Costo`.<br>8. Cambiar la moneda a `MXN` en Ajustes y recorrer tablero, tabla y ficha.<br>9. Restaurar moneda `$`, costo `45055` y estado `En uso` de `QA-ACT-002`. |
| **Esperado** | 1: `$ 650,45`. 3: sube a **`$ 1.400,45`**, que es `120055` de `QA-ACT-001` más `19990` de `QA-ACT-002`: los dos siguen `active`, y **solo** cambia esa tarjeta, porque los totales por estado no se mueven mientras el estado no cambie. 5: `Valor en uso` baja a **`$ 1.200,55`** (solo `120055`) y `En reparacion` sube a `2`, mientras `En uso` baja a `1`: el costo del bien que va al taller **desaparece** del patrimonio en uso aunque el activo siga en la lista y en `Activos en libros`. Es el comportamiento correcto según el nombre de la tarjeta, y es la prueba de que el tablero no muestra el patrimonio completo. 6: en la tabla, `$ 1.200,55` en `#001` y `$ 199,90` en `#002`, con separador de miles y dos decimales. 7: en la ficha de `#001`, el par `Costo` dice `1.200,55`. 8: el tablero se repinta con `MXN 1.200,55`, pero la tabla abierta conserva el `$` viejo hasta que se navega o se recarga, y la ficha también (`R-18`). 9: al restaurar, los números vuelven a `$ 650,45`, `2 En uso` y `1 En reparacion`; anotar eso en el registro. |

| | |
|---|---|
| **ID** | ACT-E2E-05 |
| **Tipo / Prioridad** | E2E / P0 |
| **Precondición** | Dos sesiones: una de `admin` y una de `member`, en dos navegadores o perfiles distintos. |
| **Pasos** | 1. Con `member`, crear un activo, editarlo, registrar un movimiento y archivarlo.<br>2. Con `member`, intentar borrar un activo sin movimientos y después uno con movimientos.<br>3. Con `member`, abrir `?panel=ajustes`, cambiar la moneda y guardar.<br>4. Repetir los cuatro pasos con `admin`.<br>5. Comparar lo que ve cada rol en `?panel=activos` y en `?panel=ajustes`. |
| **Esperado** | 1: el `member` **puede** crear, editar, mover y archivar: `POST /api/assets`, `PATCH /api/assets/:id` y `POST /api/assets/:id/movimientos` son de `member`. 2: **no puede borrar**: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` en los dos casos, con y sin movimientos, y nada se borra. 3: **no puede guardar los ajustes**: `403 rol-insuficiente`, y los campos conservan lo escrito hasta que se recarga (el `403` no trae los ajustes de vuelta). 4: el `admin` puede las cinco cosas. 5: **las dos sesiones ven exactamente la misma pantalla**: los cuatro botones por fila (`Ficha`, `Editar`, `Archivar`, `Borrar`) y los dos campos de Ajustes editables, sin ninguna diferencia visible por rol. La garantía real está en la API, no en la pantalla, así que un `member` descubre el `403` **después** de apretar (`R-01`, `R-20`). Es el mismo comportamiento del CRM, y por eso el caso se anota acá: es una decisión del shell compartido, no de este producto. |

---
## 6. Regresión

Lo que hay que volver a mirar cuando se toque el runtime compartido, el shell o la base, porque
este producto los usa y no los tiene. No son pruebas de Activos: son las que se repiten en cada
producto y dan el mismo resultado en los nueve.

| | |
|---|---|
| **ID** | ACT-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión iniciada y base con los datos de la sección 2. El caso recorre el canal lateral y los tres paneles, incluido un `?panel=` que no existe. |
| **Pasos** | 1. Abrir `/`.<br>2. Recorrer los tres enlaces de `?panel=` y volver al tablero.<br>3. Abrir `/?panel=inventario`.<br>4. Comprobar el pie del canal y `Salir`. |
| **Esperado** | El canal tiene **3** entradas en **2** grupos: `Inventario` (Tablero, Activos) y `Configuración` (Ajustes). Solo el panel activo queda marcado (`aria-current="page"`). El título de la barra superior cambia con el panel (`Tablero`, `Activos`, `Ajustes`) y la URL queda en `?panel=…`. 3: un panel que no existe **cae en `tablero`**, sin error y sin pantalla en blanco. El pie trae el avatar, el nombre, el correo y `Salir` apuntando a `/auth/logout`. El logo dice `AC` y `Activos`, y `data-amigo="empresa"`, `data-amigo="usuario"` y `data-amigo="correo"` traen los datos de la sesión. Cuando la organización tiene una sola herramienta, `data-amigo="otras-titulo"` queda oculto y `data-amigo="otras"` vacío; con más de una, aparece el grupo `Mis otras herramientas` con los enlaces de los otros productos. |

| | |
|---|---|
| **ID** | ACT-REG-02 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión de `admin`, con los datos de la sección 2. El caso recorre los dos diálogos y su cancelación. |
| **Pasos** | 1. Abrir `#activo-dialog` con `Nuevo activo` y cerrarlo con `Cancelar`, con la `×` y con `Esc`.<br>2. Abrirlo en modo edición y hacer lo mismo.<br>3. Abrir `#ficha-dialog` desde la tabla y cerrarlo con `Cerrar` y con `Esc`.<br>4. Comprobar si algún diálogo se abre por URL.<br>5. Con un formulario a medio llenar, mirar la barra de direcciones y pulsar `F5`.<br>6. Con el teclado, recorrer los dos diálogos. |
| **Esperado** | Los dos son `<dialog>` nativos con `showModal()`, así que el fondo queda inert y `Esc` los cierra; hacer clic **en el fondo no** los cierra. Ninguno de los dos cambia la URL: no hay `?id=` ni enlace a una ficha, así que **no se puede compartir por enlace, ni guardar en marcadores, ni sobrevive a un `F5`**, y para volver a ver una ficha hay que ir a la lista y volver a pulsar `Ficha` (`R-21`). Los dos formularios llaman `e.preventDefault()`, así que ninguno recarga la página. Al reabrir el formulario tras cancelar, los once campos están limpios y el título vuelve a `Nuevo activo`. `Cancelar` y la `×` cierran **sin preguntar y sin escribir**: comprobar que `updatedAt` no cambia. Con `Tab` se llega a todos los botones en orden y el foco se ve; los tres campos requeridos (`code`, `name`, `category`) están marcados como tales y el navegador los valida antes de que salga la petición. |

| | |
|---|---|
| **ID** | ACT-REG-03 |
| **Tipo / Prioridad** | REG / P0 |
| **Precondición** | Sesión de `admin`, los datos de la sección 2, y en paralelo una sesión `member` y otra que se pueda dejar vencer. El caso comprueba cómo se muestran los errores. |
| **Pasos** | 1. Provocar un `400` de validación desde la pantalla (código repetido) y uno desde Network (campo obligatorio vacío por `curl`).<br>2. Provocar un `403` con `member`.<br>3. Provocar un `404` con un `id` inexistente.<br>4. Provocar un `409` (borrar con historial).<br>5. Provocar un `401` dejando vencer la sesión.<br>6. Mirar `#aviso` en los cinco casos y cuánto tarda en irse. |
| **Esperado** | Hay **un solo** contenedor de avisos (`#aviso.ui-aviso`), no uno por panel, con el mismo formato siempre: el texto del error y el color según el tipo (verde el éxito, rojo el error), y **desaparece solo a los 5 segundos**. El cliente HTTP compartido arma el mensaje de un `Datos inválidos` juntando los mensajes de campo con ` · ` y pone el nombre del campo adelante (`code: …`), y un `409` o un `403` se muestran **tal cual** los escribió el servidor: el texto del `409` del borrado es una instrucción para la persona, no un error de programa. Un `401` **no** se pinta en el `#aviso`: el cliente detecta el código, navega al `loginUrl` del cuerpo y lanza el error, así que no queda una pantalla a medias con datos vacíos. Ningún error muestra una traza ni un texto interno del servidor. Los avisos **no se acumulan**: el último reemplaza al anterior, con el mismo temporizador reiniciado. |

| | |
|---|---|
| **ID** | ACT-REG-04 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | El producto serviéndose como en despliegue (`NODE_ENV=production`), porque en desarrollo los TTL de caché son 0. |
| **Pasos** | 1. Pedir `/style.css`, `/amigo-ui.js`, `/amigo.js`, `/amigo.css` y `/app.js`, con y sin `?v=`.<br>2. Pedir `/app.js?v=1` con `Cache-Control` y `ETag`.<br>3. Pedir `/favicon.ico`.<br>4. Mandar un cuerpo de 2 MB a `POST /api/assets`.<br>5. Mandar JSON mal formado.<br>6. Comprobar que el HTML no trae datos de ninguna empresa. |
| **Esperado** | 1: los cuatro del shell (`/amigo.css`, `/amigo-ui.js`, `/amigo.js`) y el del producto (`/style.css`, `/app.js`) se sirven, y los cinco salen con `public, max-age=31536000, immutable` **con y sin `?v=`**, porque el `setHeaders` se aplica a la carpeta entera (`R-27`). En desarrollo el TTL es 0 y solo sale `public, max-age=0`. 2: el `?v=` no cambia el contenido ni la política de caché: es la huella que el HTML pone para invalidar, no un parámetro que el servidor entienda. 3: `404 No existe GET /favicon.ico`, y `/favicon.ico` es **público** (no redirige al login) porque el runtime lo pone en `publicPaths` por defecto. 4: `413 La petición es demasiado grande`, límite de 1 MB. 5: **`500 {"error":"Error interno del servidor"}`** y no `400`, con un `SyntaxError` completo en el log del contenedor (`R-28`). 6: el HTML servido **no trae ni un dato**: la página se sirve vacía y todo entra por la API, que es la que filtra por organización. Es lo primero que hay que comprobar si alguna vez se ve el nombre de una empresa en el HTML. |

| | |
|---|---|
| **ID** | ACT-REG-05 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión iniciada, base con los cinco activos de la sección 2 y, en una segunda vuelta, una organización limpia. El caso revisa la pantalla en cuatro anchuras. |
| **Pasos** | 1. Mirar la pantalla a 1280 px.<br>2. Bajar a 900 px.<br>3. Bajar a 560 px.<br>4. Bajar a 390 px.<br>5. Con el teclado, recorrer los botones y leer los textos pequeños.<br>6. Abrir los dos diálogos a 390 px. |
| **Esperado** | 1: el canal lateral y el contenido van en dos columnas, y las **seis** tarjetas del resumen caben en una fila a 1280 px (`flex: 1 1 9rem` con `flex-wrap`), aunque el contenedor diga `ui-rejilla--4`. 2: por debajo de 900 px el shell pasa a **una** columna y el canal queda arriba; las rejillas dejan de ser columnas fijas porque son `flex-wrap`, así que las seis tarjetas se reparten en varias filas en vez de dejar huecos. 3: por debajo de 560 px los formularios de dos y de tres columnas (`#activo-form`, `#config-form`, `#movimiento-form`) pasan a una columna y las parejas de campos se apilan. 4: las tablas no se parten: van dentro de `.ui-tabla-caja > .ui-tabla-scroll` con `overflow-x: auto`, así que el scroll es **de la tabla**, la barra del navegador no se mueve y el canal ni el título se desplazan. 5: el foco es visible, los botones se alcanzan con `Tab` y las etiquetas de estado (`En uso`, `En reparacion`, `Dado de baja`, `Perdido`) se distinguen sin depender solo del color. Con `prefers-reduced-motion` no hay transiciones. 6: los dos diálogos se adaptan a 390 px y sus botones quedan alcanzables sin scroll horizontal. |

| | |
|---|---|
| **ID** | ACT-REG-06 |
| **Tipo / Prioridad** | REG / P1 |
| **Precondición** | Sesión de `admin`, con los datos de la sección 2 y, en una segunda vuelta, una organización limpia sin filas. El caso revisa los textos de listas vacías y los guiones de los datos faltantes. |
| **Pasos** | 1. En una organización limpia, abrir cada uno de los tres paneles.<br>2. Escribir algo que no coincida en `#activo-buscar`.<br>3. Con datos, abrir la ficha de `QA-ACT-005` (sin marca, modelo, serie, ubicación, fecha ni notas).<br>4. Mirar la fila de `QA-ACT-004` en la tabla.<br>5. Buscar `—` y `-` en el código de la pantalla. |
| **Esperado** | Cada lista vacía tiene **su propio** texto y ninguno se repite por accidente: el tablero usa `Todavia no hay activos registrados`, la tabla `No hay activos que coincidan` y la ficha `Sin movimientos registrados`. En una organización limpia las seis tarjetas muestran `0` y `$ 0,00`, no guiones. En la ficha de `#005` los pares vacíos se muestran como `Sin marca`, `Sin modelo`, `Sin serie` y `Sin ubicacion`, y **`Comprado` y `Notas` desaparecen** de la lista. En la tabla los datos que faltan son un **guion corto `-`** en `Lo tiene` y `Ubicacion`. El guion largo `—`, que es el de la tabla del CRM, **no aparece en ninguna parte** de este producto. Ningún campo vacío se muestra como texto en blanco ni como `null`, y los estados desconocidos (si los hubiera) saldrían con el valor crudo en una etiqueta neutra, no traducidos. |
---
## 7. Riesgo conocido

Defectos y trampas **sospechados en el código**, no ejecutados. Cada uno dice dónde mirar y cómo
confirmarlo en el navegador o en Network. Todos están `POR CONFIRMAR` en la sección 9.

| Riesgo | Dónde | Cómo se confirma | Severidad |
|---|---|---|---|
| **R-01** El botón `Borrar` se le muestra a cualquiera, incluido un `member`. La pantalla no consulta el rol en ningún momento: `GET /api/inicio` sí lo devuelve y `app.js` no lo usa. La garantía real es el `requireRole('admin')` de la ruta manual del `DELETE`, así que el `403` existe, pero un `member` ve cuatro botones por fila y descubre el `403` al pulsarlo. Lo mismo con el formulario de Ajustes (ver `R-20`). | `products/activos/public/app.js:205-220`, `products/activos/src/routes.ts:628`, `packages/product-runtime/src/crud.ts:185` | Entrar con sesión `member`, abrir `?panel=activos` y contar los botones de la celda de acciones: si `Borrar` está a la vista, está confirmado. Pulsarlo sobre un activo sin movimientos y leer el `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`. Contrastar con `ACT-LST-02` y `ACT-E2E-05`. | Media |
| **R-02** Archivar es una puerta de ida **en la pantalla**: no hay botón de desarchivar ni forma de listar los archivados, y como la lista y el tablero filtran por `archived_at IS NULL`, el bien desaparece de toda la UI. La API sí lo revierte (`archived: false`) y el activo archivado se sigue leyendo por id y por ficha, así que un archivado por error es recuperable solo por API. | `products/activos/public/app.js:189-204`, `products/activos/src/routes.ts:573`, `packages/product-runtime/src/crud.ts:199-203` | Archivar un activo y después `GET /api/assets/<id>`: si responde `200` con `archivedAt` con valor, y `GET /api/assets` no lo lista, está confirmado. Luego `PATCH` con `{"archived":false}` y ver que vuelve. En la pantalla, buscar el botón de desarchivar: no existe. Contrastar con `ACT-TAB-04`, `ACT-FIC-04` y `ACT-API-05`. | Media |
| **R-03** `Archivar` y `Borrar` van directo al servidor, **sin `confirm()` en ninguna parte**. Y `Borrar` es el borrado de verdad: un activo **sin movimientos** desaparece de la fila, de la tabla y del tablero sin dejar ni una fila, ni un movimiento, ni una fecha de baja, ni un aviso en ningún historial. Con el `CASCADE` del DDL, un borrado hecho desde la base sí se lleva los movimientos; la API es la que no lo hace nunca. | `products/activos/public/app.js:189-220`, `products/activos/src/routes.ts:626-654`, `products/activos/src/ddl.ts:43` | Buscar `confirm(` en `app.js`: no aparece. Crear un activo sin movimientos y pulsar `Borrar` una vez: si desaparece y `GET /api/assets/<id>` da `404 No encontrado`, está confirmado, y no queda rastro de que existió. Contrastar con `ACT-API-10`. | Alta |
| **R-04** El formulario deja elegir **`repair` y `lost` directamente**, y el `PATCH` los escribe sin registrar ningún movimiento. Es exactamente lo contrario de la invariante que el propio producto declara en dos comentarios («el único que escribe estados es la API de movimientos, para que no queden activos en reparación sin un movimiento que lo explique»). El resultado es un activo «En reparación» sin ninguna línea en el historial, y un bien «Perdido» sin el `loss` que documenta la pérdida. `retired` sí debe poder elegirse a mano: es una decisión de negocio, no un hecho físico. | `products/activos/public/index.html:187-193`, `products/activos/public/app.js:284-299`, `products/activos/src/routes.ts:144-149`, `products/activos/src/routes.ts:160-170` | Editar `QA-ACT-004` (sin movimientos), ponerlo en `En reparacion` y guardar: si el estado cambia con un `PATCH` y la ficha sigue mostrando `Sin movimientos registrados`, está confirmado. Lo mismo con `Perdido`. Contrastar con `ACT-FRM-07` y `ACT-E2E-02`. | Alta |
| **R-05** La API **no declara ningún filtro** en el `crudRouter` de `/api/assets`: no hay `filters`, así que `?status=repair`, `?category=herramienta` o un parámetro inventado se **ignoran en silencio** y devuelven `200` con todo. El filtro de estado de la pantalla es del navegador, sobre los 500 activos ya cargados. Quien migra datos o arma un reporte tiene que filtrar en el cliente. | `products/activos/src/routes.ts:725-753`, `packages/product-runtime/src/crud.ts:212-226`, `products/activos/public/app.js:143-149` | `GET /api/assets?status=repair`: si devuelve los cinco con `200`, el parámetro se ignora y está confirmado. En la pantalla, elegir `En reparacion`: una sola fila y **ninguna** petición nueva en Network, lo que prueba que el filtro no pasa por la API. Contrastar con `ACT-LST-03` y `ACT-API-03`. | Media |
| **R-06** La búsqueda de la pantalla y el `?q=` de la API **no coinciden con `%` ni con `_`**: la pantalla compara con `includes` (carácter literal) y la API mete el texto en un `LIKE '%q%'` sin escapar (comodín). `?q=%` devuelve la tabla entera mientras el mismo `%` en pantalla dice `No hay activos que coincidan`. Además el `placeholder` promete cuatro columnas («Codigo, nombre, serie, quien lo tiene») y las dos buscar también por marca y modelo, y **la categoría y la ubicación no se buscan ni por un lado ni por el otro**, aunque el `placeholder` invite a pensar que el filtro es más ancho. | `packages/product-runtime/src/crud.ts:205-210`, `products/activos/public/app.js:146-148`, `products/activos/public/index.html:85`, `products/activos/src/routes.ts:731` | `GET /api/assets?q=%` y contar: si vienen los cinco, está confirmado. Después escribir `%` en `#activo-buscar`: cero resultados. Y buscar `herramienta` y `Taller` por los dos lados: ninguno encuentra nada. Contrastar con `ACT-LST-04` y `ACT-API-03`. | Media |
| **R-07** No hay paginación y el límite se puede eludir. La pantalla carga hasta **500** activos, sin paginar y sin avisar que hay más (si una empresa tiene más de 500, el resto no aparece en la lista, ni en la búsqueda, ni en el filtro). Y el `crudRouter` recorta el límite con `Math.min`, usando `defaultLimit` (200) cuando `?limit` no es un número y con un tope de `maxLimit` (1000): un `?limit=-1` **sí** es un número, así que pasa el recorte sin tocarlo y SQLite lo lee como «sin límite». | `products/activos/public/app.js:81`, `packages/product-runtime/src/crud.ts:228`, `packages/product-runtime/src/crud.ts:170-171` | `GET /api/assets?limit=-1` y contar: si vienen todas, el recorte está eludido. `?limit=99999` sí se recorta a `1000`. Y con más de 500 activos en la base, ver que la lista se corta sin ningún aviso. Contrastar con `ACT-API-02`. | Media |
| **R-08** Los schemas de activos y de movimientos **no son estrictos**: las claves que no conocen se **descartan en silencio**. Mandar `organizationId`, `id`, `createdAt` o `archivedAt` en un `POST /api/assets` devuelve `201` y lo enviado se ignora, sin error ni aviso; mandar `assetId` en un movimiento lo escribe sobre el activo de la URL. Es distinto del `crudRouter` de clientes, que sí usa `.strict()` y responde `400 Campo desconocido`: **toda** la escritura de `/api/assets` de este producto es manual, así que ese `400` no existe nunca acá. Quien migra datos tiene que saber que el cuerpo se reescribe sin avisar. | `products/activos/src/routes.ts:171-185`, `products/activos/src/routes.ts:187-193`, `products/activos/src/routes.ts:500`, `products/activos/src/routes.ts:553-567`, `packages/product-runtime/src/crud.ts:148` | `POST /api/assets` con `organizationId`, `id`, `createdAt` y `foo`: si responde `201` y la fila devuelta trae el `organizationId` de la sesión y el `createdAt` del servidor, está confirmado. Lo mismo con `{"archivado":true}` mal escrito: `200` y sin archivar. Contrastar con `ACT-API-04` y `ACT-MOV-07`. | Media |
| **R-09** `archived` tiene un preprocesado propio que convierte **cualquier texto no reconocido en `false`**, y `false` es un desarchivado. `{"archived":"no"}` y `{"archived":"cualquiera"}` no dan `400`: devuelven `200` y **sacan el bien de la lista**, que es justo lo contrario de lo que el cliente pedía. La fecha la pone el servidor, así que `{"archivedAt":"9999-01-01"}` no hace nada (esa clave se descarta). | `products/activos/src/routes.ts:64-68`, `products/activos/src/routes.ts:573` | Archivar un activo y luego `PATCH {"archived":"no"}`: si el `200` trae `archivedAt: null` y el activo vuelve a la lista, está confirmado. Después `PATCH {"archived":"cualquiera"}` sobre otro archivado: mismo resultado. Con `{"archived":"si"}` y `{"archived":"1"}`, archivan. Contrastar con `ACT-API-05`. | Media |
| **R-10** `next-code` elige el prefijo del código con el **número más alto de toda la empresa**, no del último creado ni del que la persona viene usando: con `EQ-001` y `MAQ-010` propone `MAQ-011` aunque se vaya a registrar un equipo. Es deliberado (es lo que evita retroceder la serie si alguien escribe `EQ-999` a mano), pero se lee como un bug. Y la propuesta **no reserva**: dos personas de la misma empresa reciben el mismo código y la segunda se lleva el `409`; el `while` final garantiza que el código esté libre **en ese momento**, no que lo siga estando. | `products/activos/src/routes.ts:304-310`, `products/activos/src/routes.ts:327-346`, `products/activos/src/routes.ts:349-355`, `products/activos/public/app.js:266-273` | Crear `EQ-001` y `MAQ-010` y pedir el código: si propone `MAQ-011`, está confirmado. Dos `Proponer` seguidos en la pantalla: el mismo código las dos veces. Con `QA-ACT-050` escrito a mano: propone `QA-ACT-051`. Contrastar con `ACT-FRM-03`, `ACT-API-09` y `ACT-E2E-03`. | Media |
| **R-11** En una empresa cuyos códigos **no terminan en número** (`LAPTOP-ANA`, `PROY-A`) se propone `EQ-1`, **sin ceros**, aunque el resto de la serie de esa empresa numere con ceros. El ancho se toma del código con el número más alto y ahí no hay ninguno, así que el primer número propuesto sale con otro formato que todos los demás, y queda `EQ-1` en la lista. Conviene anotarlo en el caso de alta. | `products/activos/src/routes.ts:343-345`, `products/activos/src/routes.ts:338` | En una organización nueva, crear `LAPTOP-ANA` y `PROY-A`, y pedir `GET /api/assets/next-code`: si responde `{"code":"EQ-1","prefijo":"EQ-"}` sin padding, está confirmado. Contrastar con `ACT-API-09`. | Baja |
| **R-12** **`category` es la única columna del activo sin ningún camino de filtro ni de búsqueda**: es texto libre de 150 caracteres, sin catálogo, y no está en el `search` del `crudRouter` ni en el filtro de la pantalla (que es de estado). Buscar «todas las herramientas» no funciona, ni en pantalla ni por API, y `?category=herramienta` se ignora en silencio. Es una decisión documentada (nadie busca por categoría escribiendo la categoría), pero conviene tenerla presente porque el índice `idx_activos_assets_org_status_category` sugiere que la categoría se filtra. | `products/activos/src/schema.ts:77-83`, `products/activos/src/routes.ts:719-723`, `products/activos/src/routes.ts:731`, `products/activos/public/app.js:143-149` | Escribir `herramienta` en `#activo-buscar` y pedir `GET /api/assets?q=herramienta`: si ninguno encuentra `QA-ACT-002`, está confirmado. Después `GET /api/assets?category=herramienta`: si devuelve los cinco, el filtro no existe. Contrastar con `ACT-LST-04` y `ACT-API-03`. | Baja |
| **R-13** El costo se pide en **centavos** y el campo se llama `Costo (centavos)`, con un `input type="number"` en el que **la coma decimal se come el valor**: escribir `450,55` (que es como se escribe en Chile) deja el campo vacío, la pista vuelve a `se ve como $ 0,00` y, como el campo no es requerido, el alta **se guarda con `costCents: 0`** sin ningún aviso. Además la vista previa **trunca** (`Math.trunc`) mientras la API **redondea** (`Math.round`), así que con un decimal lo que se ve y lo que se guarda no coinciden. Quien escriba `450.55` pensando en pesos registra un bien de `$ 4,51` en vez de `$ 450,55`. | `products/activos/public/index.html:211-213`, `products/activos/public/app.js:64-67`, `products/activos/public/app.js:252-254`, `products/activos/public/app.js:295-297`, `products/activos/src/routes.ts:102-109` | Escribir `450,55` en `#activo-costo`, mirar la pista (`se ve como $ 0,00`) y guardar: si el `201` trae `costCents: 0`, está confirmado. Por API, mandar `450.55`: si se guarda `451`, la parte del redondeo está confirmada. Contrastar con `ACT-FRM-08`, `ACT-LST-08` y `ACT-API-06`. | Alta |
| **R-14** La API **acepta `happenedAt`** en un movimiento, así que un hecho se puede registrar en cualquier fecha y en cualquier zona, pero la pantalla **no lo manda** y no hay campo para anotarlo. Un movimiento escrito por API con fecha pasada queda ordenado en su fecha, pero `resumen.ultimoMovimientoAt` lo toma como «el último» y, si algún día se muestra, va a mentir. La asimetría es deliberada (la pantalla no quiere que se anote la hora a mano), pero deja un hueco entre lo que la pantalla puede hacer y lo que la API permite. | `products/activos/src/routes.ts:191-192`, `products/activos/src/routes.ts:444-447`, `products/activos/src/routes.ts:87-90`, `products/activos/public/app.js:402-423` | Buscar `happenedAt` en `index.html` y en `app.js`: no hay ningún campo. Después `POST /api/assets/<id>/movimientos` con `happenedAt` del mes pasado y abrir la ficha: si el movimiento queda en su fecha y `resumen.ultimoMovimientoAt` devuelve esa fecha vieja, está confirmado. Contrastar con `ACT-MOV-06`. | Media |
| **R-15** El historial **no se edita ni se borra** por ningún camino, ni por API ni por pantalla. Es lo correcto para un historial y está documentado en el código y en un test, pero tiene dos consecuencias: un movimiento con la fecha equivocada **no se puede corregir** (la API acepta `happenedAt`, la pantalla no, y no hay `PATCH`), y un movimiento con el `kind` equivocado no se puede anular: hay que registrar el contrario, y los dos quedan para siempre. | `products/activos/src/routes.ts:36-38`, `products/activos/src/routes.ts:411-474`, `products/activos/tests/activos.test.ts:90` | `PATCH`, `DELETE` y `POST` sobre `/api/assets/<id>/movimientos/<movementId>`: si los tres dan `404 No existe …` y no `403`, la ruta no está declarada. En la ficha, contar los botones: hay uno solo, el de registrar. Contrastar con `ACT-MOV-08`. | Baja |
| **R-16** La ficha **no muestra** ni `createdAt`, ni `updatedAt`, ni `archivedAt` como fecha, ni el `resumen.ultimoMovimientoAt` que la API sí devuelve: solo el número de movimientos. Y el instante de cada movimiento se pinta con `new Date(iso).toLocaleString('es-CL')` a pelo, o sea **en la zona horaria del navegador y con un formato literal que depende de la versión de ICU**: acá no se usa `AMIGO_UI.fecha`, que sí formatea de forma estable entre productos. Con el equipo en otra zona, la hora que se ve no es la que se guardó. | `products/activos/public/app.js:76`, `products/activos/public/app.js:384-386`, `products/activos/public/app.js:392-394`, `products/activos/src/routes.ts:385-392` | Comparar el texto de un movimiento con su `happenedAt` crudo; cambiar la zona horaria del navegador y recargar: si el texto se mueve y el dato crudo no, está confirmado. Buscar `fecha(` en `app.js`: no se usa la del shell. Contrastar con `ACT-FIC-02`, `ACT-FIC-03` y `ACT-MOV-06`. | Baja |
| **R-17** El ajuste `timezone` **no afecta nada** en este producto. No hay un solo `hoy` ni una fecha relativa en sus consultas: el tablero cuenta por estado y suma centavos, la lista y la ficha no comparan fechas, y la única fecha es `purchaseDate`, que se muestra tal cual. Se guarda y se valida contra `Intl`, pero es un dato muerto acá; el `schema.ts` lo declara y no lo usa. En el CRM es distinto: ahí la zona define el `hoy` de las bolsas. | `products/activos/src/routes.ts:151-157`, `products/activos/src/routes.ts:249-293`, `products/activos/src/routes.ts:686-693`, `products/activos/src/schema.ts:173` | Poner la zona en `Pacific/Kiritimati`, guardar y recorrer tablero, tabla y ficha: si ningún dato cambia, está confirmado. Y cambiar la zona del navegador: eso **sí** mueve los instantes del historial (`R-16`), lo que deja claro que la zona de la empresa no participa. Contrastar con `ACT-AJU-02`. | Baja |
| **R-18** Guardar la moneda **no repinta la tabla**. El `PUT` de ajustes solo llama a `renderConfig()` y a `pintarCosto()`, no a `repintar()`, así que los costos de `?panel=activos` y los de la ficha abierta conservan el símbolo viejo, mientras el estado en memoria ya es el nuevo: en la misma pantalla conviven el `$` de la tabla y el `MXN` de la pista del formulario. Se arregla al navegar, al filtrar o al recargar. | `products/activos/public/app.js:425-441`, `products/activos/public/app.js:468-479` | En `?panel=activos`, guardar `MXN` en Ajustes y volver por el enlace del canal: si la columna `Costo` sigue con `$` y la pista dice `MXN`, está confirmado. Con `F5`, la tabla ya sale con `MXN`. Contrastar con `ACT-AJU-04` y `ACT-E2E-04`. | Baja |
| **R-19** El `.env.example` está **internamente inconsistente**: `PORT=3022` pero `APP_URL=http://localhost:3023`, que es el puerto de Inventario. Con el `APP_URL` equivocado, el `return_to` del login y los enlaces que arma el shell apuntan al producto equivocado, y el síntoma aparece al iniciar sesión, no al arrancar. | `products/activos/.env.example:5`, `products/activos/.env.example:14` | Copiar el archivo a `.env`, entrar por el SSO y mirar la URL a la que vuelve: si es `:3023` en lugar de `:3022`, está confirmado. En Docker no aparece, porque ahí el `APP_URL` viene del `docker-compose.yml`. | Media |
| **R-20** El formulario de Ajustes se ve **igual para `member` que para `admin`**, con los dos campos editables y `Guardar ajustes` activo, aunque el `PUT` exija `admin`. Un `member` escribe, aprieta guardar y recibe un `403` en rojo; los campos **conservan lo que escribió** hasta que se recarga, así que durante un rato la pantalla muestra un valor que no está guardado. Y lo que escribe es la configuración compartida de la empresa. | `products/activos/public/index.html:104-121`, `products/activos/public/app.js:425-441`, `products/activos/src/routes.ts:679` | Entrar con sesión `member`, abrir `?panel=ajustes`, escribir una moneda distinta y guardar: si los campos aceptan escritura y el `PUT` responde `403`, está confirmado. Recargar después y ver que el valor guardado es el viejo. Contrastar con `ACT-AJU-03` y `ACT-E2E-05`. | Media |
| **R-21** La ficha y el formulario **no cambian la URL**, y `#activo-nuevo` se ve **en los tres paneles**. No hay `?id=` ni enlace a una ficha: no se puede compartir por enlace, no se puede guardar en marcadores y un `F5` cierra lo que estuviera abierto. Y el botón de la barra superior llama al renderizador del formulario directamente, así que se abre el diálogo encima de un panel sin que la URL lo refleje. | `products/activos/public/app.js:232-249`, `products/activos/public/app.js:277`, `products/activos/public/app.js:327-398`, `products/activos/public/index.html:59`, `packages/product-runtime/public/amigo.js:123-127` | Abrir una ficha y copiar la URL en otra pestaña: si abre el panel de activos y no la ficha, está confirmado. Pulsar `Nuevo activo` desde `?panel=ajustes` y mirar la barra: si sigue en `ajustes` con el formulario encima, también. Contrastar con `ACT-FIC-01`, `ACT-FRM-01` y `ACT-REG-02`. | Baja |
| **R-22** El tablero se pide **dos veces** al entrar: una por `alEntrar` → `repintar()` → `pintarTablero()` y otra por `cargar().then(repintar)` del final del arranque. Son 5 peticiones para abrir `/`, dos de ellas repetidas siempre, y entre la primera y la segunda hay una ventana en la que las tarjetas y la lista de recientes pueden no cuadrar entre sí. En los otros dos paneles son 3 peticiones, porque pintar la lista de activos no pide nada. | `products/activos/public/app.js:90-91`, `products/activos/public/app.js:481`, `products/activos/public/app.js:492` | Recargar `/` con **Preservar log** y contar: si aparecen dos `/api/dashboard`, está confirmado. Abrir `?panel=activos` y contar: si son tres y ninguna es el tablero, también. Contrastar con `ACT-SIS-02`. | Baja |
| **R-23** El campo «A quien se entrega (solo en checkout)» está **siempre visible**, y el rótulo es lo único que avisa: la pantalla no lo oculta ni lo deshabilita según el tipo. Con `checkin`, `maintenance` o `loss` lo que se escriba ahí **se pierde en silencio**, porque el JS solo agrega `assignedTo` al cuerpo cuando el tipo es `checkout`. Se pierde el texto y no queda señal, porque los dos campos se limpian igual después de guardar. | `products/activos/public/index.html:252-260`, `products/activos/public/app.js:402-423` | Escribir un responsable, elegir `Volvio (checkin)` y registrar: si el cuerpo de la petición no lleva `assignedTo` y el responsable del activo no cambia, está confirmado. Contrastar con `ACT-MOV-09`. | Baja |
| **R-24** Hay **dos `404` distintos para el mismo activo que no existe**: `Ese activo no existe` en la ficha, el `PATCH`, el `DELETE` y los movimientos (las rutas escritas a mano) y `No encontrado` en el `GET /api/assets/:id` (el `crudRouter`). Los dos están bien en lo importante: ninguno confirma que el id exista. Pero un cliente que muestre el mensaje crudo ve dos textos para el mismo hecho según por dónde consultó. | `products/activos/src/routes.ts:221`, `products/activos/src/routes.ts:376`, `products/activos/src/routes.ts:434`, `products/activos/src/routes.ts:547`, `packages/product-runtime/src/crud.ts:261` | `GET /api/assets/<id-inexistente>` y `GET /api/assets/<id-inexistente>/ficha`: si los mensajes son distintos y ambos `404`, está confirmado. Un `id` de otra organización da el mismo `404` en ambos, nunca `403`. Contrastar con `ACT-FIC-05` y `ACT-API-01`. | Baja |
| **R-25** El limitador de peticiones está montado **antes que `/health`**, así que el chequeo de salud del producto también consume cupo: con las 600 peticiones de 15 minutos agotadas, `/health` devuelve `429` en lugar de `200`. Un balanceador que use `/health` como sonda puede sacar el contenedor de rotación por una ráfaga de la propia aplicación, y como el corte es por IP, dos organizaciones distintas detrás de la misma salida comparten el mismo cupo. | `packages/product-runtime/src/app.ts:99-106`, `packages/product-runtime/src/app.ts:117-118` | Con el cupo agotado (700 peticiones en 15 minutos), pedir `/health`: si responde `429` y no `200 {"ok":true,…}`, está confirmado. Después esperar la ventana y repetir: vuelve a `200`. Contrastar con `ACT-SIS-03`. | Media |
| **R-26** Las rutas de escritura están **escritas dos veces**: el `crudRouter` declara `POST`, `PATCH` y `DELETE` de `/api/assets`, pero Express resuelve en orden de registro y las manuales van primero, así que **el CRUD solo aporta la lista y el `GET /:id`**. Su `DELETE` (que archivaría en vez de borrar, y con `deleteRole` igual a `writeRole`, o sea `member`) y su `PATCH` con `.strict()` **no se ejecutan nunca**. El día que se borre una ruta manual creyendo que el CRUD la reemplaza, el borrado pasa de «borrar de verdad» a «archivar», el rol deja de ser `admin`, y el `400 Campo desconocido` se vuelve un `201` silencioso, sin que ninguna prueba lo note. | `products/activos/src/routes.ts:495-538`, `products/activos/src/routes.ts:540-611`, `products/activos/src/routes.ts:626-654`, `products/activos/src/routes.ts:725-753` | Leer el orden de registro: las tres rutas manuales están antes del `router.use('/api/assets', crudRouter(...))`. Después, por `curl`: `DELETE /api/assets/<id>` responde `{"asset":…,"deleted":true}` y no `{"ok":true,"archived":true}`, lo que prueba que la manual ganó; y `PATCH` con una clave desconocida responde `200`, no `400`. | Media |
| **R-27** El `immutable` de un año se aplica **también a los recursos sin huella**. El módulo de assets del Core dice, en su propio comentario, que `immutable` solo es correcto porque la URL lleva la huella `?v=`; pero el `setHeaders` se pasa a `express.static` de la carpeta entera, así que un `GET /app.js` a secas se sirve igual con `public, max-age=31536000, immutable`. El HTML siempre pide la URL con `?v=` y por eso no se nota; se nota con una pestaña vieja, con la URL del asset guardada a mano o con un caché de por medio. | `packages/core/src/utils/assets.ts:64-67`, `packages/core/src/utils/assets.ts:83-97`, `packages/product-runtime/src/app.ts:150-165` | En producción, `GET /app.js` **sin** `?v=`: si el `cache-control` es `public, max-age=31536000, immutable`, está confirmado, y es el mismo header que lleva `GET /app.js?v=<huella>`. Después comprobar que en desarrollo el TTL es 0. Contrastar con `ACT-SIS-04` y `ACT-REG-04`. | Media |
| **R-28** Un cuerpo de JSON **mal formado devuelve `500` en vez de `400`**. `express.json()` lanza un `SyntaxError` con `type: "entity.parse.failed"`, y el manejador de errores solo distingue `AppError`, error de Zod y `entity.too.large`: lo demás cae en el `500` genérico y se escribe la traza entera en el log del contenedor. Afecta a los nueve productos, y un `500` por una petición mal armada ensucia los paneles de error y cualquier alerta que mire códigos 5xx. | `packages/product-runtime/src/app.ts:96`, `packages/product-runtime/src/errors.ts:27-40` | `POST /api/assets` con `Content-Type: application/json` y cuerpo `{"code":`: si la respuesta es `500 {"error":"Error interno del servidor"}` y en el log del contenedor aparece un `SyntaxError` con la posición, está confirmado. Lo mismo con `POST /api/assets/<id>/movimientos`. Contrastar con `ACT-SIS-05`, que además cubre el `413` del cuerpo de 2 MB, que sí está bien tratado. | Media |

> Veintiocho riesgos, y todos de archivos de `products/activos`, `packages/product-runtime` y
> `packages/core`. Veinticinco son de este producto; los tres que no lo son se repiten, con el
> mismo número de casa, en los otros planes: el `immutable` sin huella es el `R-24` del CRM
> (viene del Core), el limitador antes de `/health` es su `R-23`, y el `500` del JSON malformado es
> su `R-26` (los dos últimos, del runtime). Además hay un riesgo **fuera** de este producto, en el Core, que lo
> comparte con Inventario y Clientes: el test `packages/core/tests/followups.test.ts` («crea un
> seguimiento y lo devuelve con el cliente») espera `overdue === false` para un `dueDate` del
> `2026-09-30`, y `packages/core/src/modules/followups/routes.ts:33,65` compara contra
> `new Date().toISOString().slice(0,10)`. Esa comparación es correcta; lo que envejece es la fecha
> fija del test, que a partir del `2026-10-01` da `true`. No es un defecto de Activos ni del Core:
> es un test que depende del día. Se deja anotado para que nadie lo confunda con un fallo de este
> producto si aparece en una corrida de la suite.
>
> Un riesgo que **no** aparece en esta lista y conviene decir: la suite de este producto tiene 39
> casos (`products/activos/tests/activos.test.ts`) y cubre bien el aislamiento entre
> organizaciones, el `409` del código repetido, la invariante de los movimientos, el `409` del
> borrado con historial y el tablero sobre una base limpia. **No** cubre ninguno de los tres
> caminos de la pantalla que se rompen aquí —el filtro del navegador, la coma del costo y el
> doble pintado del tablero— porque esos tres son de la interfaz, y la suite solo mira el contrato
> de la API y el HTML.
---
## 8. Checklist visual

Recorrer una vez por cada panel, en 1280 x 800 y en 390 x 844. Marcar cada ítem.

**Canal lateral y cabecera**

- [ ] `#tabs` tiene tres entradas en dos grupos: `Inventario` (Tablero, Activos) y `Configuración` (Ajustes).
- [ ] Solo una entrada está activa, distinguida por fondo e indicador, y `aria-current` marca cuál.
- [ ] El logo del canal muestra `AC` y el nombre `Activos`; `data-amigo="empresa"`, `data-amigo="usuario"` y `data-amigo="correo"` traen los datos de la sesión.
- [ ] `data-amigo="otras-titulo"` queda oculto y `data-amigo="otras"` vacío cuando la organización tiene una sola herramienta.
- [ ] `#activo-nuevo` está en `.ui-topbar__acciones` y se ve **en los tres paneles**, incluso en Ajustes.
- [ ] `Salir` apunta a `/auth/logout`.
- [ ] El título de la barra superior cambia con el panel (`Tablero`, `Activos`, `Ajustes`), y la URL queda en `?panel=…`.
- [ ] Un `?panel=` que no existe cae en `tablero`, sin error y sin pantalla en blanco.

**Panel Tablero**

- [ ] `#resumen` lleva `ui-rejilla ui-rejilla--4` y muestra **seis** tarjetas: `Activos en libros`, `En uso`, `En reparacion`, `Dados de baja`, `Perdidos`, `Valor en uso`.
- [ ] Solo `Activos en libros` sale destacado; los otros cinco números van neutros.
- [ ] Las seis caben en una fila a 1280 px y se reparten en varias filas a 390 px, sin huecos.
- [ ] `Valor en uso` suma **solo** los `active`, con el símbolo de los ajustes y **dos decimales**; un bien en el taller o perdido no cuenta, aunque siga en la lista (ver `ACT-TAB-02`).
- [ ] La tarjeta se llama `Últimos activos registrados`, trae **cinco** fichas como máximo, y cada una muestra `código · nombre` arriba y `estado · responsable · ubicación · costo` abajo, sin los vacíos.
- [ ] La más nueva va primero, y un activo nuevo entra por `created_at` y desplaza al quinto.
- [ ] Los estados salen como etiqueta de color: `En uso` en ok, `En reparacion` en aviso, `Dado de baja` en neutro, `Perdido` en malo.
- [ ] La lista vacía dice `Todavia no hay activos registrados`, y las tarjetas muestran `0` y `$ 0,00` (nunca guiones).

**Panel Activos**

- [ ] La tabla tiene **8** columnas: `Codigo`, `Nombre`, `Categoria`, `Estado`, `Lo tiene`, `Ubicacion`, `Costo` y una sin título para las acciones; el `Costo` va alineado a la derecha con `class="num"`.
- [ ] El número de serie va debajo del nombre, con salto de línea y sin columna propia.
- [ ] El orden es por **código** ascendente, no por nombre ni por fecha.
- [ ] Cada fila tiene cuatro botones, en orden: `Ficha`, `Editar`, `Archivar` (fantasma) y `Borrar` (fantasma y peligro), y **ninguno de los dos pide confirmación**: van derecho al servidor (`R-03`). No hay botón de desarchivar ni de ver los archivados.
- [ ] Una sesión `member` **sí** ve `Borrar` (ver `R-01`: hoy se ve).
- [ ] `#activo-buscar` es un input de 100 caracteres con el texto «Codigo, nombre, serie, quien lo tiene», y busca en seis columnas.
- [ ] `#activo-filtro` tiene cinco opciones: `Todos`, `En uso`, `En reparacion`, `Dado de baja`, `Perdido`.
- [ ] Escribir en el buscador o cambiar el filtro **no** dispara ninguna petición a la red, y ninguno de los dos se pierde al abrir la ficha.
- [ ] La lista vacía dice `No hay activos que coincidan` y su celda atraviesa las **8** columnas.
- [ ] Los datos que faltan se ven como guion **corto** `-`, nunca el guion largo `—`.

**Formulario de activo**

- [ ] Abre como diálogo modal sobre la pantalla, con título `Nuevo activo` o `Editar activo` y `#activo-id` oculto.
- [ ] No cambia la URL (ver `R-21`).
- [ ] Tiene once campos visibles con los rótulos exactos (`Categoria`, `Ubicacion`, `Lo tiene`, `Comprado el`, `Costo (centavos)`, `Numero de serie`, `Notas`), y solo tres requeridos: código, nombre y categoría.
- [ ] El campo de código lleva el botón `Proponer` al lado y el `#activo-costo` lleva la pista `se ve como …` debajo.
- [ ] `#activo-estado` tiene cuatro opciones y arranca en `En uso`; `#activo-costo` es `min="0"`, `step="1"` y vale `0`.
- [ ] `#activo-compra` es `type="date"` y `#activo-notas` acepta 2000 caracteres.
- [ ] Abajo están `Guardar` y `Cancelar`, y arriba la `×`; los tres cierran sin preguntar y sin escribir.
- [ ] Al guardar, el diálogo se cierra, la tabla se repinta con la fila nueva y el aviso verde dura unos 5 segundos.
- [ ] Con la coma decimal en el costo, el campo queda vacío y el alta se guarda con `0` sin aviso (ver `R-13`).

**Ficha de un activo**

- [ ] Abre como diálogo modal sobre la lista, con el título `código · nombre` y sin cambiar la URL.
- [ ] Debajo del título hay etiquetas: estado con color, categoría, `Lo tiene …` solo si hay responsable, y `Archivado` solo si lo está.
- [ ] El `<dl>` muestra siempre `Marca`, `Modelo`, `Serie`, `Ubicacion` y `Costo`; `Comprado` y `Notas` solo si tienen valor, y la fecha como `DD/MM`.
- [ ] Los datos que faltan se muestran como `Sin marca`, `Sin modelo`, `Sin serie` y `Sin ubicacion`.
- [ ] El historial va del movimiento más nuevo al más viejo, con los rótulos `Salio`, `Volvio`, `A reparacion` y `Se perdio`, cada uno con su color, y la nota y la hora al lado.
- [ ] Debajo dice `N movimiento(s) en el historial`, y la lista vacía dice `Sin movimientos registrados`.
- [ ] Dentro del mismo diálogo está el formulario `Registrar un movimiento`, con los cuatro tipos y el campo `A quien se entrega (solo en checkout)`, **siempre visible**.
- [ ] No hay ningún botón para editar o borrar un movimiento, ni para moverlo de activo (ver `R-15`).
- [ ] `Esc` y `Cerrar` cierran la ficha; hacer clic en el fondo no.

**Panel Ajustes**

- [ ] El formulario tiene **dos** campos, `Moneda` y `Zona horaria`, con 5 y 64 caracteres, y nada más.
- [ ] `Guardar ajustes` avisa `Ajustes guardados` en verde y `rol-insuficiente` en rojo para un `member` (ver `R-20`).
- [ ] Un `member` ve los campos editables aunque no pueda guardar.
- [ ] La moneda **sí** cambia lo que se ve en el tablero, en la tabla y en la ficha; la zona horaria no cambia ningún dato de este producto (ver `R-17`).
- [ ] Tras guardar la moneda desde otro panel, la tabla conserva el símbolo viejo hasta que se navega o se recarga (ver `R-18`).

**En todas las pantallas**

- [ ] `#aviso` es único: muestra el último aviso, en verde o en rojo, y **desaparece solo a los 5 segundos**.
- [ ] Los formularios no recargan la página, y el botón `Guardar` **no** se deshabilita mientras corre la petición: con doble clic rápido puede duplicarse el alta, anotarlo si aparece.
- [ ] Las tablas se desplazan dentro de su caja, no con la barra del navegador: el canal y la barra superior no se mueven.
- [ ] A 900 px el shell pasa a una columna; a 560 px los formularios de dos y tres columnas se apilan.
- [ ] Con el teclado se llega a todos los botones y el foco se ve; con `prefers-reduced-motion` no hay transiciones.

## 9. Registro

Una fila por caso ejecutado. **Dejar vacía hasta la primera vuelta real**: nada de este documento
está verificado todavía. `Resultado` es `PASA`, `FALLA` o `BLOQUEADO`. Cuando un caso falle, la
`Evidencia` lleva el `id` de la petición y la respuesta (status y cuerpo), y la `Nota` dice si el
problema es del producto, del runtime o del Core.

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados. Transversal: Doc 10 §9.

| ID | Resultado (PASA/FALLA/BLOQUEADO) | Evidencia | Nota |
|---|---|---|---|
| ACT-LST-01 | BLOQUEADO | Requiere los cinco activos de la sección 2 | No ejecutado. |
| ACT-API-01 | BLOQUEADO | Requiere **segunda organización** (activos cruzados A→B) | No ejecutado; falta segundo tenant. |
| ACT-API-02 | PARCIAL | `GET /api/assets` → `{items,total,limit,offset}` ✅ con filas completas (`organizationId`, `archivedAt`, `updatedAt`). `limit=5000`→`1000` ✅ | Orden por `code` y comportamiento de `limit=-1` no verificados con datos seed; `offset` probado en customers (mismo `crudRouter`). |
| ACT-API-03 | BLOQUEADO | Requiere activo archivado (`QA-ACT-004`) | No ejecutado. |
| ACT-E2E-01 | BLOQUEADO | Requiere sesión `admin` y base limpia/seed | No ejecutado. |
| ACT-E2E-02 | BLOQUEADO | Requiere `QA-ACT-009 ciclo` y ciclo de movimientos | No ejecutado. |
| ACT-UI-01 | FALLA | KPI del tablero pinta `$ 202.796,00`; shared `dinero` da `$202.796` sin decimales ni espacio | R-S-08: formato de inventario/activos/pagos ≠ shared. |
| ACT-NAV-01 | PARCIAL | Tablero con KPIs y `Últimos activos registrados` al cargar; clic en pestañas → 0 peticiones (prefetch `assets`+`dashboard`) | h1/aria-current ✅. Consola: aviso de autocomplete en el buscador. |