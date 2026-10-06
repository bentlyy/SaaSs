# Plan de pruebas - Clientes (CRM)

> Producto `crm` sobre el runtime compartido. Documento escrito para que alguien con
> Chrome DevTools pueda ejecutar cada caso sin volver a leer el cÃ³digo, y para que el resultado
> sea comparable con el plan de Inventario y con el de Activos.

## 1. Ficha tÃ©cnica

| | |
|---|---|
| Producto | `crm` |
| Nombre visible | Clientes (`<title>Clientes</title>`, `data-amigo="logo"` = `CL`) |
| DescripciÃ³n | Ficha de clientes (persona o empresa), seguimientos con fecha de vencimiento e historial de contacto. |
| Puerto | `.env.example`: `PORT=3020` (el `APP_URL` del mismo archivo dice `3023`, que es el de Inventario: secciÃ³n 7, `R-20`). ProducciÃ³n: `127.0.0.1:3105:3000`, `APP_URL=https://crm.amgdeveloper.cl`. El Core escucha en `3108`. |
| Ruta local | `products/crm` Â· `npm run dev:crm` Â· `npm test -w @amg/crm` Â· `npm run typecheck -w @amg/crm` |
| Base | `./data/crm.sqlite`, `DB_SCHEMA_VERSION=1`. En tests, `:memory:`. La identidad **no** estÃ¡ acÃ¡: vive en el `core.sqlite` del Core. |
| Schema | `customers`, `followups`, `interactions`, `settings` (`products/crm/src/schema.ts`; DDL con los mismos Ã­ndices en `ddl.ts`). |
| Entrada | `GET /` -> `public/index.html`, `public/app.js`, `public/style.css`, y del runtime `/amigo-ui.js`, `/amigo.js`, `/amigo.css`. |
| Paneles | 5: `?panel=tablero` (por defecto), `?panel=clientes`, `?panel=seguimientos`, `?panel=contactos`, `?panel=ajustes`. Grupos del canal: `Cartera`, `Seguimiento`, `ConfiguraciÃ³n`. |
| Rutas | `GET /health`, `POST /health`, `GET /api/meta`, `GET /api/me`, `GET /api/inicio`, `GET /api/tablero`, `GET /api/resumen`, `GET /api/customers/:id/ficha`, `GET /api/followups`, `GET /api/followups/:id`, `POST /api/followups`, `PATCH /api/followups/:id`, `DELETE /api/followups/:id`, `GET /api/interactions`, `POST /api/interactions`, `GET /api/settings`, `PUT /api/settings`, y las de `crudRouter` sobre `/api/customers` (secciÃ³n 4.7). |
| Identidad | SSO contra el Core. El producto **no** pide usuario ni clave: sin sesiÃ³n no se sirve ni el HTML. |
| Roles | Lectura: cualquiera con sesiÃ³n. `POST`/`PATCH` de clientes, seguimientos y contactos: `member`. `DELETE /api/customers/:id` (archiva) y `DELETE /api/followups/:id`: `admin`. `PUT /api/settings`: `admin`. Un `member` **ve** el botÃ³n `Archivar` y recibe `403` al pulsarlo (secciÃ³n 7, `R-01`). |
| Convenciones | `docs/qa/00-CONVENCIONES.md`. Tipos `FUNC`, `E2E`, `REG`, `SIST`, `EXP`; prioridades `P0`, `P1`, `P2`. |
| Fuera de alcance | El Core y los otros productos, salvo `/health`, `/api/meta`, `/api/inicio` y `/api/me`. |

Lo que este producto **no** tiene, y conviene fijar antes de empezar porque cambia lo que se
puede probar:

- **Ni un solo importe.** El precio de un trabajo es de `citas` y el de una propuesta es de
  `cotizaciones`. AcÃ¡ no hay centavos, ni `currency` pintada, ni suma de dinero: la tarjeta de
  moneda de los ajustes no cambia ni una cifra de la pantalla (`R-21`).
- **No hay paginaciÃ³n** en ninguna lista. La UI pide `limit=500` clientes, `limit=300`
  seguimientos y `limit=300` contactos, y no hay `offset` ni segunda pÃ¡gina (`R-09`).
- **No hay forma de desarchivar un cliente** desde la pantalla: archivar es una puerta de
  ida (`R-02`). Y archivar **no** esconde sus seguimientos ni su historial (`R-04`).
- **El historial de contacto no se edita ni se borra**, por API ni por pantalla. Es a
  propÃ³sito: una fila de contacto es la prueba de lo que pasÃ³.
- **No hay agenda, ni documentos, ni cotizaciones, ni repuestos**: no hay ningÃºn `total`, ni
  agenda duplicada, ni stock en esta herramienta.
- **No hay filtro por tipo de ficha** en la pantalla, aunque la API lo soporte (`R-07`).
- **No hay `seed`**: el producto arranca vacÃ­o y sin datos de ejemplo, a propÃ³sito.

## 2. Datos de prueba

**OrganizaciÃ³n.** La propia, la de la sesiÃ³n del Core. Nunca escribir el `organization_id` a
mano: sale de la identidad y un valor forzado se ignora.

**ConvenciÃ³n de fechas.** Todo lo relativo a Â«hoyÂ» se anotarÃ¡ como `H`. Antes de empezar,
leer `H` de `GET /api/tablero` (el campo `hoy`, que es el dÃ­a **de la organizaciÃ³n**, no el del
navegador) y calcular las fechas con `H-3`, `H`, `H+5`. Los ejemplos numÃ©ricos de este
documento usan **`H = 2026-10-05`**; si el dÃ­a real es otro, los nÃºmeros de este documento no
aplican tal cual y hay que recalcularlos.

**Clientes.** Cuatro, todos con prefijo `QA-CRM` en el nombre para poder limpiarlos con
`#cliente-buscar`. El sufijo en el **documento** o en la **ciudad** es lo que hace Ãºtil el caso
de la bÃºsqueda por `?q=` de la API, que no busca por nombre de empresa (`R-08`).

| Nombre | Tipo | RazÃ³n social | TelÃ©fono | Correo | Documento | Ciudad | CumpleaÃ±os | Etiquetas |
|---|---|---|---|---|---|---|---|---|
| `QA-CRM persona norte` | Persona | (vacÃ­o) | `+56 9 1111 0001` | `norte@qa-crm.example` | `11.111.111-1` | `Santiago` | `1985-<mes de H>-12` | `vip,norte` |
| `QA-CRM empresa sur` | Empresa | `QA-CRM Servicios Sur SpA` | `+56 2 2222 0002` | `sur@qa-crm.example` | `76.543.210-9` | `Valparaiso` | (vacÃ­o) | `mayorista` |
| `QA-CRM ficha minima` | Persona | (vacÃ­o) | (vacÃ­o) | (vacÃ­o) | (vacÃ­o) | (vacÃ­o) | `1990-12-01` | (vacÃ­o) |
| `QA-CRM empresa andina` | Empresa | `QA-CRM Andina SRL` | `+56 9 3333 0003` | `andina@qa-crm.example` | `RUC 20512345678` | `Lima` | (vacÃ­o) | `credito` |

El primero lleva el cumpleaÃ±os **en el mes que se estÃ¡ probando** (con `H = 2026-10-05`,
`1985-10-12`) porque es el que alimenta la tarjeta `CumpleaÃ±os del mes`, que se arma con el
**mes** del cumpleaÃ±os y no con un rango de fechas. `QA-CRM ficha minima` tiene `1990-12-01` a
propÃ³sito: **no** debe salir en esa tarjeta salvo que `H` caiga en diciembre. `QA-CRM ficha
minima` no tiene ni telÃ©fono ni correo: sirve para ver los `â€”` de la tabla y los `Sin
telÃ©fono` / `Sin correo` de la ficha. Los documentos van **con letras y guiones a propÃ³sito**
(`11.111.111-1`, `RUC 20512345678`): el campo es texto, no nÃºmero.

**Seguimientos.** Seis, con el cliente al que apuntan. Los que no tienen cliente no se pueden
crear: `#seguimiento-cliente` es `required` y la API exige que el cliente sea de esta
organizaciÃ³n.

| Cliente | QuÃ© hay que hacer | Detalle | Para el dÃ­a | Estado |
|---|---|---|---|---|
| `QA-CRM persona norte` | `Llamar para renovar` | `QA-CRM vencido` | `H-3` (`2026-10-02`) | Pendiente |
| `QA-CRM persona norte` | `Enviar propuesta` | `QA-CRM de hoy` | `H` (`2026-10-05`) | Pendiente |
| `QA-CRM empresa sur` | `Confirmar visita` | (vacÃ­o) | `H+5` (`2026-10-10`) | Pendiente |
| `QA-CRM ficha minima` | `Recordar sin fecha` | `QA-CRM sin fecha` | (vacÃ­o) | Pendiente |
| `QA-CRM empresa sur` | `Cobrar factura` | `QA-CRM hecho` | `H-1` (`2026-10-04`) | Hecho |
| `QA-CRM empresa andina` | `No aplica` | (vacÃ­o) | (vacÃ­o) | Cancelado |

Los tres casos de estado existen porque cada uno se comporta distinto: `Recordar sin fecha` es
`pending` sin `dueDate` y **no aparece en ninguna de las tres bolsas del tablero** (`R-11`), pero
sÃ­ cuenta en el KPI `Pendientes` y sale en `?panel=seguimientos` **primero**, porque en SQLite
los `NULL` ordenan antes (`R-12`). `Cobrar factura` con `H-1` en estado `Hecho` verifica que un
seguimiento cerrado **no** se cuente como vencido aunque su fecha ya haya pasado.

**Contactos.** Cinco. Cuatro se registran desde la pantalla, que **no** manda `happenedAt`: el
servidor pone la hora (`CRM-CON-04`).

| Cliente | Tipo | QuÃ© pasÃ³ | CuÃ¡ndo |
|---|---|---|---|
| `QA-CRM persona norte` | Llamada | `QA-CRM no contesto` | el momento del alta |
| `QA-CRM persona norte` | Correo | `QA-CRM mando propuesta` | el momento del alta |
| `QA-CRM empresa sur` | Visita | `QA-CRM visita a planta` | el momento del alta |
| `QA-CRM empresa andina` | Nota | `QA-CRM pidio factura` | el momento del alta |
| `QA-CRM ficha minima` | Llamada | `QA-CRM contacto antiguo` | `2020-01-01T12:00:00Z`, **por API** |

El quinto se crea por API porque la pantalla no deja anotar la hora a mano, y es el que
hace que la tarjeta `Contactos (30 dÃ­as)` dÃ© `4` y no `5`: la ventana del resumen son los
**Ãºltimos 30 dÃ­as**, no el mes calendario.

**Ajustes.** Los defaults del servidor: `currency = '$'` y `timezone = 'America/Santiago'`.
Para `CRM-AJU-02` se cambian a `MXN` y `America/Mexico_City`, y **se restauran al final**:
de `timezone` depende el `hoy` de todo el tablero.

**Con los datos de arriba, y con `H = 2026-10-05`, los nÃºmeros que deben aparecer son:**

- `GET /api/resumen` -> `200 {"total":4,"activos":4,"archivados":0,"seguimientos":{"total":6,"porEstado":{"pending":4,"done":1,"canceled":1},"vencidos":1,"paraHoy":1},"contactos30d":4}`
- `GET /api/tablero` -> `200` con `hoy: "2026-10-05"`, `seguimientos.vencidos` con **1** elemento,
  `seguimientos.hoy` con **1**, `seguimientos.proximos` con **1**, `cumpleanos` con **1** y
  `contactos` con **5**.
- `#resumen` -> seis tarjetas: `4 Clientes activos` (con acento), `0 Archivados`, `4 Pendientes`,
  `1 Vencidos`, `1 Para hoy`, `4 Contactos (30 dÃ­as)`.

Si alguno de estos nÃºmeros no cuadra, parar y anotarlo en la secciÃ³n 9 antes de seguir: casi
siempre la causa es un `H` distinto al anotado o un cliente archivado de una vuelta anterior.

## 3. Precondiciones

- El Core arriba en `CORE_URL=http://localhost:3108` y el producto con una sesiÃ³n vÃ¡lida.
  `GET /health` responde `200 {"ok":true,"product":"crm","name":"Clientes"}` **sin** sesiÃ³n,
  asÃ­ que sirve de comprobaciÃ³n de arranque.
- La sesiÃ³n dura lo que el token del Core (15 minutos por defecto). Al expirar, `/api/*`
  responde `401 {"error":"expirado","loginUrl":â€¦}` y el navegador salta al login del Core: no es
  un defecto del producto. Volver a entrar y anotarlo en el registro.
- `AMG_SSO_INTROSPECT=0` en desarrollo significa que una baja de suscripciÃ³n en el Core **no** se
  nota en el acto; en producciÃ³n el compose lo deja en `1` y corta al instante.
- Para `CRM-API-09` y `CRM-REG-07` hace falta **una segunda organizaciÃ³n** con suscripciÃ³n al
  CRM y al menos un cliente propio, para comprobar que nada se mezcla.
- Herramientas: DevTools con Network y **Preservar log**, y `curl` con la cookie `app_session`
  para los casos de API.
- Cargar los datos de la secciÃ³n 2 **antes** de empezar y **anotar los ids** que devuelve el
  servidor: no se pueden fijar a mano. Guardarlos en una nota con la forma
  `clienteId`, `seguimientoId`, `contactoId`.
- Para los casos que dependen del dÃ­a, dejar el reloj del navegador en la zona horaria del
  equipo de pruebas y anotar la zona del navegador junto al `H` anotado: la diferencia entre el
  `hoy` del servidor y el del navegador es justo lo que prueban `CRM-TAB-07` y `CRM-AJU-03`.

---
## 4. Casos por mÃ³dulo

### 4.1 Panel Tablero â€” tarjetas, bolsas y cumpleaÃ±os

| | |
|---|---|
| **ID** | CRM-TAB-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n activa, con los cuatro clientes y los seis seguimientos de la secciÃ³n 2. |
| **Pasos** | 1. Abrir `/`.<br>2. Contar las tarjetas de `#resumen` y leerlas en orden.<br>3. Comparar con `GET /api/resumen` en crudo.<br>4. Cambiar el valor de `#tablero-cliente` a cada opciÃ³n y volver a leer las tarjetas. |
| **Esperado** | `#resumen` lleva la clase `ui-rejilla ui-rejilla--4` y muestra **seis** tarjetas, en este orden: `Clientes activos`, `Archivados`, `Pendientes`, `Vencidos`, `Para hoy`, `Contactos (30 dÃ­as)`. Con los datos de la secciÃ³n 2 y `H = 2026-10-05` los valores son `4`, `0`, `4`, `1`, `1`, `4`, que son exactamente los de `GET /api/resumen` (`activos`, `archivados`, `seguimientos.porEstado.pending`, `seguimientos.vencidos`, `seguimientos.paraHoy`, `contactos30d`). **Solo la primera tarjeta lleva el acento de color**: es el tercer elemento del arreglo que se pasa a `AMIGO_UI.kpis`, y los otros cinco van neutros. Las seis caben en una sola fila a 1280 px (`flex: 1 1 9rem` con `flex-wrap`) y se reparten en varias filas a 390 px. Cambiar `#tablero-cliente` **no** cambia ninguna tarjeta: el resumen es de toda la organizaciÃ³n. |

| | |
|---|---|
| **ID** | CRM-TAB-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los datos de la secciÃ³n 2. |
| **Pasos** | 1. Leer `#seguimiento-vencidos`, `#seguimiento-hoy` y `#seguimiento-proximos`.<br>2. Anotar el texto de cada ficha (tÃ­tulo y lÃ­nea secundaria).<br>3. Buscar `QA-CRM Recordar sin fecha` en las tres listas.<br>4. Comparar con `GET /api/tablero`. |
| **Esperado** | Con `H = 2026-10-05`: `Vencidos` trae **una** ficha, `Llamar para renovar Â· QA-CRM persona norte Â· 02/10`; `Para hoy` trae **una**, `Enviar propuesta Â· QA-CRM persona norte Â· 05/10`; `PrÃ³ximos` trae **una**, `Confirmar visita Â· QA-CRM empresa sur Â· 10/10`. El nombre del cliente y la fecha van en la misma lÃ­nea secundaria, unidos por ` Â· `, y la fecha se escribe `DD/MM` (no cambia el dato guardado). **`Recordar sin fecha` no aparece en ninguna de las tres** aunque sea `pending`: las tres bolsas se arman comparando `dueDate` contra `hoy`, y `null` no es menor, igual ni mayor (secciÃ³n 7, `R-11`). Y `Cobrar factura`, con `H-1` y estado `Hecho`, tampoco aparece: solo se cuentan los `pending`. |

| | |
|---|---|
| **ID** | CRM-TAB-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | `QA-CRM persona norte` con cumpleaÃ±os en el mes en curso y `QA-CRM ficha minima` con `1990-12-01`. |
| **Pasos** | 1. Leer `#cumpleanos`.<br>2. Comparar con `cumpleanos` de `GET /api/tablero`.<br>3. Cambiar la zona horaria de los ajustes a una que estÃ© en el mes siguiente (por ejemplo `Pacific/Kiritimati`) y volver a abrir `/`. |
| **Esperado** | La tarjeta se llama `CumpleaÃ±os del mes` y trae **solo** a `QA-CRM persona norte`, con la lÃ­nea secundaria `12/10` (el dÃ­a y el mes del cumpleaÃ±os). La bÃºsqueda es por **mes**, no por rango de fechas: por eso un cumpleaÃ±os de enero aparece en enero y no Â«dentro de 365 dÃ­asÂ». `QA-CRM ficha minima` (`1990-12-01`) no sale, salvo que el mes en curso sea diciembre. Con la zona cambiada a una que ya es el dÃ­a siguiente, el cumpleaÃ±os que se muestra cambia de mes, porque la consulta usa el mes del `hoy` del servidor. |

| | |
|---|---|
| **ID** | CRM-TAB-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Los cinco contactos de la secciÃ³n 2. |
| **Pasos** | 1. Leer `#contactos-recientes`.<br>2. Anotar cuÃ¡ntas fichas hay y en quÃ© orden.<br>3. Comparar con `contactos` de `GET /api/tablero`.<br>4. Registrar un contacto nuevo desde `?panel=contactos` y volver al tablero. |
| **Esperado** | La tarjeta se llama `Ãšltimos contactos` y trae **los 10 mÃ¡s recientes de toda la organizaciÃ³n**, ordenados de mÃ¡s nuevo a mÃ¡s viejo por `happenedAt`. Cada ficha muestra el **nombre del cliente** como tÃ­tulo y `Tipo: quÃ© pasÃ³ Â· fecha` como lÃ­nea secundaria (`Llamada: QA-CRM no contesto Â· 5 oct 2026 14:03`). Con los datos de la secciÃ³n 2 salen las cinco fichas, y la del contacto de 2020 queda **Ãºltima**, aunque su cliente (`QA-CRM ficha minima`) no tenga telÃ©fono ni correo. Al registrar un contacto nuevo, es el primero de la lista. El servidor manda un mÃ¡ximo de 10 aunque haya mÃ¡s. |

| | |
|---|---|
| **ID** | CRM-TAB-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | `#tablero-cliente` con las cinco opciones (una vacÃ­a = `Todos los clientes`, y los cuatro clientes). |
| **Pasos** | 1. Elegir `QA-CRM persona norte`.<br>2. Mirar en Network la URL de `GET /api/tablero`.<br>3. Leer las tres bolsas y las dos tarjetas de cumpleaÃ±os y contactos.<br>4. Volver a `Todos los clientes`. |
| **Esperado** | Al elegir un cliente sale `GET /api/tablero?customerId=<id>` y **solo** las tres bolsas de seguimientos se filtran: quedan las de ese cliente y el resto desaparece. **`CumpleaÃ±os del mes` y `Ãšltimos contactos` no se filtran**: la API solo aplica el `customerId` a los seguimientos, asÃ­ que las otras dos tarjetas siguen mostrando los de toda la organizaciÃ³n, lo que se lee como un filtro que funciona a medias (secciÃ³n 7, `R-05`). Las seis tarjetas de arriba tampoco cambian. Al volver a `Todos los clientes` la URL pierde el `?customerId=` y las bolsas se rellenan otra vez. |

| | |
|---|---|
| **ID** | CRM-TAB-06 |
| **Tipo / Prioridad** | FUNC / P2 |
| **PrecondiciÃ³n** | SesiÃ³n activa. |
| **Pasos** | 1. En una organizaciÃ³n limpia, abrir `/`.<br>2. Leer los cinco contenedores de listas del tablero.<br>3. Registrar el primer cliente y volver a abrir `/`. |
| **Esperado** | Las cinco listas (`#seguimiento-vencidos`, `#seguimiento-hoy`, `#seguimiento-proximos`, `#cumpleanos`, `#contactos-recientes`) muestran la misma cadena vacÃ­a **`Nada por acÃ¡`**, en un `<p class="ui-vacio">` centrado. Las tarjetas del resumen muestran `0` en las seis, no guiones. Con el primer cliente cargado, `#cumpleanos` y `#contactos-recientes` siguen vacÃ­os y `#seguimiento-*` tambiÃ©n: el texto no cambia nunca, en ninguna de las cinco listas. |

| | |
|---|---|
| **ID** | CRM-TAB-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n activa, con el reloj del navegador en una zona distinta de la de los ajustes de la organizaciÃ³n. |
| **Pasos** | 1. Anotar la fecha y la hora del navegador.<br>2. Leer `hoy` en `GET /api/tablero`.<br>3. Poner el navegador en `America/Mexico_City`, recargar y volver a leer.<br>4. Cambiar `#cfg-zona` a `America/Mexico_City` (como `admin`), recargar y leer `hoy` otra vez. |
| **Esperado** | `hoy` **lo decide el servidor**, con la zona horaria de la organizaciÃ³n leÃ­da de `settings`, y no el navegador: la pantalla no llama a `new Date()` para decidir el dÃ­a. Con el navegador en `America/Santiago` y la organizaciÃ³n en `America/Mexico_City` (o al revÃ©s), los dos pueden diferir en un dÃ­a cerca de la medianoche, y `GET /api/tablero` sigue diciendo el de la organizaciÃ³n. Cambiar la zona de los ajustes **sÃ­** mueve `hoy`, y con ello las tres bolsas: un seguimiento con `dueDate` = el dÃ­a anterior al nuevo `hoy` pasa de `Para hoy` a `Vencidos`. Si la zona escrita en `#cfg-zona` no existe en la base IANA, el `PUT` se rechaza con `400 Zona horaria desconocida: â€¦` y el `hoy` no cambia. |

### 4.2 Panel Clientes â€” tabla, bÃºsqueda, alta, ediciÃ³n y archivo

| | |
|---|---|
| **ID** | CRM-CLI-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los cuatro clientes de la secciÃ³n 2. |
| **Pasos** | 1. Ir a `?panel=clientes`.<br>2. Leer las cabeceras de `#clientes-lista`.<br>3. Leer la fila de `QA-CRM persona norte` y la de `QA-CRM empresa sur` campo por campo.<br>4. Leer la celda de acciones de cada fila.<br>5. Mirar el contenedor de la tabla en el inspector. |
| **Esperado** | Las columnas son **6**: `Nombre`, `Tipo`, `TelÃ©fono`, `Correo`, `Ciudad`, `Acciones`. El **documento va debajo del nombre**, con un `<br>` y en la misma celda, no en columna propia. `QA-CRM persona norte` -> `Tipo` `Persona`, `TelÃ©fono` `+56 9 1111 0001`, `Correo` `norte@qa-crm.example`, `Ciudad` `Santiago`. `QA-CRM empresa sur` -> `Empresa`. Cada fila tiene tres botones: `Ficha`, `Editar` y `Archivar` (este Ãºltimo en `ui-btn--fantasma`). La tabla **sÃ­** va dentro de `AMIGO_UI.cajaTabla`, o sea `.ui-tabla-caja > .ui-tabla-scroll` con `overflow-x: auto`: con muchas columnas el scroll es interno y la pÃ¡gina no se mueve. |

| | |
|---|---|
| **ID** | CRM-CLI-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | `QA-CRM ficha minima`, sin telÃ©fono, correo, ciudad, razÃ³n social ni etiquetas. |
| **Pasos** | 1. Buscar `minima` en `#cliente-buscar`.<br>2. Leer la fila completa.<br>3. Pulsar `Ficha` y leer el `<dl>`. |
| **Esperado** | En la tabla, `TelÃ©fono`, `Correo` y `Ciudad` muestran el guion largo `â€”`, nunca texto en blanco, y el documento no aparece porque no hay. En la ficha, los pares del `<dl>` son `TelÃ©fono Sin telÃ©fono` y `Correo Sin correo`: es decir, **sÃ­** sale el par, con ese texto, y no `â€”`. `CumpleaÃ±os`, `DirecciÃ³n`, `Ciudad`, `Etiquetas` y `Notas` **no** salen: cada par se agrega solo si el valor es verdadero, asÃ­ que un cliente sin direcciÃ³n no deja una fila vacÃ­a en la ficha. Abajo se lee `0 pendiente(s), 0 vencido(s), 0 contacto(s)`, con el `pendiente(s)` literal. |

| | |
|---|---|
| **ID** | CRM-CLI-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Los cuatro clientes de la secciÃ³n 2. |
| **Pasos** | 1. Escribir `empresa` en `#cliente-buscar`.<br>2. Escribir `norte@qa-crm.example`.<br>3. Escribir `RUC 20512345678`.<br>4. Escribir `Lima`.<br>5. Escribir `EMPRESA` en mayÃºsculas.<br>6. Escribir `%` (el campo de buscar tiene `maxlength="100"`: no entran textos mÃ¡s largos).<br>7. Escribir `zzz`. |
| **Esperado** | 1: las dos empresas. 2 y 3: el cliente 1, porque se busca en nombre, razÃ³n social, telÃ©fono, correo, documento **y ciudad**. 4: `QA-CRM empresa andina`, porque la pantalla **sÃ­** filtra por ciudad aunque la API no lo haga (secciÃ³n 7, `R-08`). 5: las dos, la comparaciÃ³n es en minÃºsculas. 6: **cero resultados**, con el texto `No hay clientes que coincidan`: la pantalla compara con `String.includes`, donde `%` es un carÃ¡cter literal. 7: lo mismo. Ese `%` es la diferencia con la API: `GET /api/customers?q=%` devuelve **los cuatro**, porque del otro lado el texto se mete en un `LIKE` sin escapar. |

| | |
|---|---|
| **ID** | CRM-CLI-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n activa. `#cliente-form` visible en `?panel=clientes`. |
| **Pasos** | 1. Pulsar `#nuevo-cliente` desde el tablero.<br>2. Confirmar que se llega a `?panel=clientes`.<br>3. Llenar `#cliente-nombre` = `QA-CRM alta`, `#cliente-tipo` = `Empresa`, `#cliente-empresa` = `QA-CRM Alta SpA`, `#cliente-telefono` = `+56 9 4444 0004`, `#cliente-correo` = `alta@qa-crm.example`, `#cliente-documento` = `99.999.999-9`, `#cliente-cumpleanos` = `1991-07-04`, `#cliente-direccion` = `QA-CRM Calle Falsa 123`, `#cliente-ciudad` = `QA-CRM`, `#cliente-notas` = `QA-CRM nota de alta`, `#cliente-etiquetas` = `QA-CRM nuevo,vip`.<br>4. Pulsar `Guardar` y leer en Network el `POST`.<br>5. Anotar los valores de `#clientes-lista` y del resumen. |
| **Esperado** | 1: el formulario aparece **vacÃ­o** y con el tÃ­tulo `Nuevo cliente`; `#cliente-cancelar` estÃ¡ oculto, porque en alta no hay nada que cancelar. 2: el botÃ³n salta al panel de clientes pero **la URL sigue en `?panel=tablero`** (secciÃ³n 7, `R-06`). 4: `POST /api/customers` `201`, y el cuerpo que se envÃ­a tiene exactamente once claves: `name`, `kind`, `company`, `phone`, `email`, `taxId`, `birthday`, `address`, `city`, `notes`, `tags`. No manda `id`, ni `archivedAt`, ni `organizationId`, ni `createdAt`. El `id` que devuelve el servidor empieza con `clicliente`, `kind` es `"empresa"`, `archivedAt` es `null`, `updatedAt` es `null` y `createdAt` es un ISO. 5: sale el aviso verde `Cliente creado`, la fila aparece en la tabla y el formulario vuelve a quedar vacÃ­o con el tÃ­tulo `Nuevo cliente`. **La organizaciÃ³n queda con 5 clientes**: para volver a los nÃºmeros de la secciÃ³n 2 hay que archivar `QA-CRM alta` al terminar este caso. |

| | |
|---|---|
| **ID** | CRM-CLI-05 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n activa. |
| **Pasos** | 1. Con `#cliente-nombre` vacÃ­o, pulsar `Guardar`.<br>2. Escribir 151 caracteres en `#cliente-nombre`.<br>3. Escribir `no-es-correo` en `#cliente-correo` y pulsar `Guardar`.<br>4. Escribir 41 caracteres en `#cliente-telefono` y 33 en `#cliente-documento`.<br>5. Poner `#cliente-cumpleanos` = `4/7/1991` a mano. |
| **Esperado** | Todo lo bloquea **el navegador**, antes de que salga una sola peticiÃ³n: 1 y 3, los campos `required` y `type="email"` disparan la validaciÃ³n nativa y no hay ningÃºn `POST` en Network; 2 y 4, los `maxlength` (150 en el nombre, 200 en la razÃ³n social, 40 en el telÃ©fono, 200 en el correo, 32 en el documento, 300 en la direcciÃ³n, 120 en la ciudad, 2000 en las notas y 500 en las etiquetas) impiden escribir el carÃ¡cter de mÃ¡s; 5, `#cliente-cumpleanos` es `type="date"` y el navegador no acepta un formato que no sea `AAAA-MM-DD`. Ninguno de los cinco casos muestra un error del servidor, porque no llega a haber peticiÃ³n. |

| | |
|---|---|
| **ID** | CRM-CLI-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | `QA-CRM persona norte` con telÃ©fono, correo, direcciÃ³n, ciudad, notas y etiquetas. |
| **Pasos** | 1. Pulsar `Editar` en su fila.<br>2. Vaciar `#cliente-telefono`, `#cliente-direccion`, `#cliente-ciudad`, `#cliente-notas` y `#cliente-etiquetas`.<br>3. Pulsar `Guardar`.<br>4. Leer `GET /api/customers/<id>`.<br>5. Pulsar `Ficha` y volver a leer la fila de la tabla. |
| **Esperado** | 3: `PATCH /api/customers/<id>` con esos cinco campos en `null`, **no** en cadena vacÃ­a: la pantalla convierte cada campo vacÃ­o en `null` antes de mandarlo, y por eso el servidor distingue Â«no lo tengoÂ» de Â«lo tengo en blancoÂ». 4: los cinco campos quedan en `null` en la API. 5: en la tabla, `TelÃ©fono` y `Ciudad` vuelven a `â€”`, y en la ficha desaparecen los pares `DirecciÃ³n`, `Ciudad`, `Etiquetas` y `Notas` en lugar de quedar vacÃ­os. El `Correo` sigue porque no se tocÃ³. |

| | |
|---|---|
| **ID** | CRM-CLI-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n `member` o `admin`, con la cookie a mano para `curl`. |
| **Pasos** | 1. `POST /api/customers` con `{"name":"","kind":"tercera"}`.<br>2. `POST /api/customers` con `{"name":"QA-CRM api","email":"no-es-correo"}`.<br>3. `POST /api/customers` con `{"name":"QA-CRM api","emial":"a@b.example"}`.<br>4. `POST /api/customers` con `{"name":"QA-CRM api","birthday":"2026-9-4"}`.<br>5. `PATCH /api/customers/<id>` con `{"archivedAt":"2026-01-01"}`.<br>6. `POST /api/customers` con un `name` de 151 caracteres. |
| **Esperado** | 1: `400 {"error":"Datos invÃ¡lidos"}` con `errors.fieldErrors.name` y `errors.fieldErrors.kind`: el tipo de ficha es un enum cerrado (`persona`, `empresa`). 2: `400` con `errors.fieldErrors.email` = `["Correo invalido"]`. 3: `400 Campo desconocido: emial. Revisa el nombre; si esta bien escrito, no lo mandes.` â€” el `crudRouter` arma su schema con `.strict()`, asÃ­ que una clave mal escrita **no** se descarta en silencio. 4: `400` con `errors.fieldErrors.birthday` = `["La fecha va como AAAA-MM-DD"]`, aunque `Date.parse` la aceptara: la fecha se valida con una expresiÃ³n regular, no con `Date.parse`. 5: `400 Campo desconocido: archivedAtâ€¦`: `archivedAt` es de solo lectura para el CRUD y la Ãºnica forma de archivarlo es `DELETE`. 6: `400` con `errors.fieldErrors.name`. En todos, la pantalla muestra el texto del campo y el mensaje unidos con ` Â· ` en `#aviso`. |

| | |
|---|---|
| **ID** | CRM-CLI-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | `QA-CRM ficha minima`. |
| **Pasos** | 1. Pulsar `Editar` y anotar los once valores del formulario.<br>2. Cambiar solo `#cliente-telefono` a `+56 9 5555 0005`.<br>3. Pulsar `Guardar`.<br>4. Pulsar `Editar` otra vez.<br>5. Comprobar en Network que el `PATCH` manda los once campos. |
| **Esperado** | 4: los once campos vuelven con el valor nuevo, asÃ­ que la ediciÃ³n no pierde nada. 5: el `PATCH` manda **los once campos**, no solo el cambiado: la pantalla reconstruye el cuerpo completo en cada guardado (`app.js`), y el `crudRouter` acepta que sobre lo que no se manda. El aviso es `Cliente actualizado` y el formulario queda vacÃ­o de nuevo, con el tÃ­tulo `Nuevo cliente`, como si fuera un alta nueva. `updatedAt` cambia y `createdAt` no. |

| | |
|---|---|
| **ID** | CRM-CLI-09 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n **`admin`** y `QA-CRM ficha minima` con un seguimiento y un contacto. |
| **Pasos** | 1. Pulsar `Archivar` en su fila.<br>2. Responder lo que aparezca, si aparece algo.<br>3. Leer en Network la peticiÃ³n.<br>4. Mirar la tabla, las seis tarjetas y las bolsas del tablero.<br>5. Leer `GET /api/customers?q=QA-CRM` y `GET /api/resumen`. |
| **Esperado** | 1: **no aparece ninguna confirmaciÃ³n**: el botÃ³n va derecho al `DELETE` (secciÃ³n 7, `R-03`). 3: `DELETE /api/customers/<id>` `200 {"ok":true,"archived":true}`: es un archivado, no un borrado. 4: la fila desaparece de la tabla, `Clientes activos` baja 1 y `Archivados` sube 1; el aviso verde dice `Cliente archivado`. **El cliente no sale de los otros lados**: su seguimiento sigue en las bolsas del tablero y su contacto sigue en `Ãšltimos contactos`, porque ni `/api/tablero` ni `/api/resumen` filtran por `archived_at` (secciÃ³n 7, `R-04`). 5: `GET /api/customers` lo excluye y `total` no lo cuenta, `seguimientos.total` **no** baja y `contactos30d` **no** baja. La fila sigue existiendo: `GET /api/customers/<id>` responde `200` con `archivedAt` con valor. |

| | |
|---|---|
| **ID** | CRM-CLI-10 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n **`member`**, con la misma organizaciÃ³n de los casos anteriores. |
| **Pasos** | 1. Entrar con rol `member` y abrir `?panel=clientes`.<br>2. Contar los botones de la celda de acciones.<br>3. Pulsar `Archivar`.<br>4. Leer `#aviso` y la respuesta en Network.<br>5. Comprobar que el cliente sigue en la lista. |
| **Esperado** | 2: el botÃ³n `Archivar` **estÃ¡ a la vista**, con los mismos tres botones que un `admin`: la pantalla no mira el rol en ningÃºn momento. 3 y 4: `DELETE /api/customers/<id>` responde `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}` y `#aviso` muestra `rol-insuficiente` en rojo. 5: la fila no se mueve y ningÃºn dato cambia. La garantÃ­a es del servidor, no de la pantalla (secciÃ³n 7, `R-01`). |

| | |
|---|---|
| **ID** | CRM-CLI-11 |
| **Tipo / Prioridad** | FUNC / P2 |
| **PrecondiciÃ³n** | Una organizaciÃ³n limpia, sin clientes. |
| **Pasos** | 1. Abrir `?panel=clientes`.<br>2. Leer `#clientes-lista`.<br>3. Crear un cliente y escribir `zzz` en `#cliente-buscar`.<br>4. Borrar el texto de `#cliente-buscar`. |
| **Esperado** | 2: una sola fila con `No hay clientes que coincidan`, y su celda atraviesa las **seis** columnas (`colspan=6`). 3: el mismo texto, que dice Â«coincidanÂ» y no Â«hay clientesÂ»: sirve para los dos casos, el de lista vacÃ­a y el de bÃºsqueda sin resultados, y no propone ninguna acciÃ³n. 4: la fila vuelve a aparecer. El formulario de alta, que estÃ¡ al lado, no cambia nunca con la bÃºsqueda: escribir en `#cliente-buscar` no filtra el formulario. |

---
### 4.3 Ficha del cliente

La ficha es un `<dialog>` (`#ficha-dialog`) que se abre sobre la pantalla y se arma con **una**
peticiÃ³n: `GET /api/customers/<id>/ficha`. No hay tabla de agenda, ni totales, ni Â«detalleÂ» como
en Inventario: es un `<dl>` de datos y dos listas de lÃ­neas.

| | |
|---|---|
| **ID** | CRM-FIC-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | `QA-CRM persona norte` con 2 seguimientos (1 `pending`, 1 `done`) y 2 contactos. |
| **Pasos** | 1. En `?panel=clientes`, pulsar `Ficha` en su fila.<br>2. Anotar, en orden, los pares del `<dl>`.<br>3. Leer los dos contadores de abajo.<br>4. Leer los dos encabezados `<h4>`.<br>5. Contar las peticiones que salieron desde que se abriÃ³ el diÃ¡logo.<br>6. Mirar la barra de direcciones. |
| **Esperado** | 2: los pares son, **solo los que tienen valor**: `TelÃ©fono`, `Correo`, `CumpleaÃ±os` (en `DD/MM`), `DirecciÃ³n`, `Ciudad`, `Etiquetas`, `Notas`. NingÃºn par trae el rÃ³tulo `Nombre`: el nombre es el tÃ­tulo de la ficha, no una fila del `dl`, y **no aparecen** `RazÃ³n social`, `Tipo de ficha` ni `RUT / RUC / NIT`, que sÃ­ se ven en el listado (secciÃ³n 7, `R-13`). 3: la lÃ­nea de abajo dice `1 pendiente(s), 0 vencido(s), 2 contacto(s)`. El de contactos cuenta **todos** los del cliente, sin la ventana de 30 dÃ­as del resumen. 4: `Seguimientos` y `Historial de contacto`. 5: **una sola** peticiÃ³n. La ficha no pide `/api/tablero`, ni `/api/resumen`, ni `/api/interactions`: el endpoint devuelve `{customer, followups, interactions, resumen}` de una vez, y `resumen` trae ademÃ¡s `ultimoContacto`. 6: la URL no cambia: sigue en `?panel=clientes` y no hay `?id=`, asÃ­ que **no hay enlace directo a una ficha** y recargar la pÃ¡gina la cierra (secciÃ³n 7, `R-10`). |

| | |
|---|---|
| **ID** | CRM-FIC-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | `QA-CRM persona norte` con los seguimientos y contactos de la secciÃ³n 2. |
| **Pasos** | 1. Buscar con el teclado los botones dentro del diÃ¡logo.<br>2. Leer una lÃ­nea de `Seguimientos` y una de `Historial de contacto`.<br>3. Anotar el orden de los seguimientos en la ficha.<br>4. Anotar el orden de los seguimientos en `?panel=seguimientos`.<br>5. Cerrar la ficha y abrir la de un cliente sin seguimientos ni contactos. |
| **Esperado** | 1: **cero botones** dentro de la ficha, y cero enlaces: es de solo lectura. No hay `Archivar`, ni `Editar`, ni `Eliminar`, ni para el cliente ni para sus seguimientos ni para sus contactos. En el servidor tampoco existe `PATCH` ni `DELETE` sobre `/api/interactions`: el historial se agrega y se lee, a propÃ³sito, y un contacto mal escrito se corrige **agregando otro** (secciÃ³n 7, `R-14`). 2: cada lÃ­nea es un `.ui-ficha` con tÃ­tulo y nota: en seguimientos, el tÃ­tulo es el texto y la nota es `Estado Â· DD/MM` (por ejemplo `Pendiente Â· 02/10`); en contactos, el tÃ­tulo es `QuÃ© pasÃ³` y la nota es `Tipo Â· DD/MM AAAA HH:MM` (por ejemplo `Llamada Â· 5 oct 2026 14:03`). 3 y 4: **los dos paneles ordenan al revÃ©s**. La ficha ordena por `dueDate` **descendente** (`routes.ts:351`), asÃ­ que el seguimiento sin fecha sale **Ãºltimo**; el panel ordena ascendente (`routes.ts:404`), asÃ­ que sale **primero**. Con los datos de la secciÃ³n 2, en la ficha el orden es `Enviar propuesta (05/10)`, `Llamar para renovar (02/10)`, `Recordar sin fecha (â€”)`. 5: los dos bloques muestran `Sin seguimientos` y `Sin contactos registrados`, cada uno en su `<div class="ui-lista">`. |

| | |
|---|---|
| **ID** | CRM-FIC-03 |
| **Tipo / Prioridad** | FUNC / P2 |
| **PrecondiciÃ³n** | `QA-CRM persona norte`. |
| **Pasos** | 1. Abrir la ficha y pulsar `Esc`.<br>2. Abrirla otra vez y pulsar `Cerrar`.<br>3. Abrirla otra vez y hacer clic en el fondo gris, fuera de la tarjeta.<br>4. Con la ficha abierta, registrar un contacto desde otra pestaÃ±a del mismo producto.<br>5. Cerrar y reabrir la ficha. |
| **Esperado** | 1 y 2: el diÃ¡logo se cierra de las dos maneras; `Esc` es el comportamiento nativo de `<dialog>` y `Cerrar` llama a `$('#ficha-dialog').close()`. 3: el clic **no** cierra nada: no hay manejador en el fondo, y el `showModal()` nativo no cierra al hacer clic afuera (a diferencia de un `alert`). Solo `Esc` y `Cerrar` cierran. 4: la ficha abierta **no se entera de nada**: no hay sondeo ni `Esc` de cambios, asÃ­ que sigue mostrando los nÃºmeros de cuando se abriÃ³. 5: al reabrir, la ficha vuelve a pedir `/ficha` y ya muestra el contacto nuevo y el nuevo `N contacto(s)`: cada apertura es una lectura fresca. |

| | |
|---|---|
| **ID** | CRM-FIC-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n `member`. Un cliente de esta organizaciÃ³n, un cliente de **otra** organizaciÃ³n y un `id` inexistente. |
| **Pasos** | 1. `GET /api/customers/<id de esta org>/ficha`.<br>2. `GET /api/customers/<id de otra org>/ficha`.<br>3. `GET /api/customers/no-existe/ficha`.<br>4. `GET /api/followups?customerId=<id de otra org>`.<br>5. `POST /api/followups` con `customerId` de la otra organizaciÃ³n.<br>6. `POST /api/interactions` con `customerId` de la otra organizaciÃ³n. |
| **Esperado** | 1: `200`, con los datos del cliente: el aislamiento es por **organizaciÃ³n**, no por persona, asÃ­ que cualquier `member` ve cualquier ficha de su empresa. 2 y 3: `404 {"error":"no-encontrado"}` con el mensaje `Ese cliente no existe`; la consulta trae `organization_id` de la sesiÃ³n, asÃ­ que un cliente de otra empresa no existe para nadie y **no** se responde `403` (no se confirma que el id sea real). 4: `200 {"followups":[]}`: filtro aplicado, cero filas, nunca datos ajenos. 5 y 6: `400` con `Ese cliente no existe en esta organizacion`, porque el alta valida el cliente antes de escribir (distinto del `404` de la lectura: acÃ¡ se dice que no se puede escribir para un cliente que no es tuyo). En ningÃºn caso aparecen datos de la otra organizaciÃ³n, ni en el cuerpo ni en el mensaje. |

### 4.4 Panel Seguimientos

La tabla de este panel tiene **5 columnas**, y el detalle del seguimiento va **dentro de la celda
del tÃ­tulo**, con un salto de lÃ­nea, no en una columna propia.

| | |
|---|---|
| **ID** | CRM-SEG-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los seis seguimientos de la secciÃ³n 2. |
| **Pasos** | 1. Abrir `?panel=seguimientos`.<br>2. Contar las cabeceras y leerlas.<br>3. Leer la celda del tÃ­tulo de `Llamar para renovar`.<br>4. Leer la celda de `Recordar sin fecha`.<br>5. Contar los botones de la celda de acciones.<br>6. Mirar el contenedor de la tabla en el inspector. |
| **Esperado** | 2: **5** columnas: `Cliente`, `QuÃ© hay que hacer`, `Para el dÃ­a`, `Estado`, `Acciones`. No hay columna `Detalle`: el `#seguimiento-detalle` se pinta en la **misma** celda del tÃ­tulo, debajo, separado por un `<br>`, y solo si no estÃ¡ vacÃ­o (por eso `Confirmar visita` y `No aplica` muestran una sola lÃ­nea y `Llamar para renovar` muestra dos). 3: `Llamar para renovar` y, debajo, `QA-CRM vencido`. 4: `â€”` en `Para el dÃ­a`, y `Pendiente` como etiqueta de tono `aviso`; `Hecho` es `ok` y `Cancelado` es neutro. En la lista **no** existe la etiqueta `Vencido`: el vencimiento solo se ve en el tablero. 5: **dos** botones por fila: `Editar` y `Marcar hecho` (o `Reabrir`, si el seguimiento ya estÃ¡ `Hecho`). **No hay `Archivar` ni `Eliminar`**, ni aquÃ­ ni en la ficha, aunque el servidor tenga `DELETE /api/followups/:id` (secciÃ³n 7, `R-18`). 6: la tabla va dentro de `AMIGO_UI.cajaTabla`, con `overflow-x: auto` interno: con 5 columnas y un canal lateral fijo, el scroll es de la tabla y no de la pÃ¡gina. |

| | |
|---|---|
| **ID** | CRM-SEG-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los seis seguimientos de la secciÃ³n 2, creados en el orden de esa tabla. |
| **Pasos** | 1. Leer las seis filas en el orden en que salen.<br>2. Anotar lo que dice `Para el dÃ­a` en cada una.<br>3. Anotar la etiqueta de `Estado` de cada una.<br>4. Comparar con `GET /api/followups?limit=300`.<br>5. Filtrar el panel por `QA-CRM ficha minima` y volver a `ElegÃ­ un cliente`. |
| **Esperado** | El orden es **`No aplica`**, **`Recordar sin fecha`**, **`Llamar para renovar`** (`02/10`), **`Cobrar factura`** (`04/10`), **`Enviar propuesta`** (`05/10`), **`Confirmar visita`** (`10/10`). Los dos primeros son los que **no tienen fecha** y salen primero: el `ORDER BY due_date ASC` de SQLite pone los `NULL` antes de todo, y entre los dos gana el mÃ¡s reciente, porque el desempate es `createdAt` **descendente** (`routes.ts:404`). `Cobrar factura` aparece en medio por su fecha, no por su estado: estÃ¡ `Hecho` con `H-1` y no se trata como vencido. 3: `Pendiente`, `Pendiente`, `Pendiente`, `Hecho`, `Pendiente`, `Cancelado`. La lista trae **los seis**, sin filtro de estado por defecto: la API acepta `?status=`, pero la pantalla no lo manda nunca (secciÃ³n 7, `R-18`). 5: con el filtro puesto, la tabla trae solo las filas de ese cliente y la peticiÃ³n incluye `&customerId=<id>`; al volver a la opciÃ³n vacÃ­a, el parÃ¡metro desaparece. |

| | |
|---|---|
| **ID** | CRM-SEG-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n `member`. `#cliente-cancelar` y `#seguimiento-cancelar` ocultos. |
| **Pasos** | 1. Pulsar `Nuevo` en `?panel=seguimientos`.<br>2. Leer el desplegable `#seguimiento-cliente`: cuÃ¡ntas opciones tiene y con quÃ© texto.<br>3. Con la opciÃ³n vacÃ­a, pulsar `Guardar`.<br>4. Llenar `#seguimiento-titulo` = `Avisar antes de la visita`, dejar `#seguimiento-detalle` vacÃ­o, `#seguimiento-fecha` = `H+7` (`2026-10-12`), `#seguimiento-estado` = `Pendiente` y `#seguimiento-cliente` = `QA-CRM empresa sur`.<br>5. Pulsar `Guardar` y leer el `POST` en Network.<br>6. Buscar la fila nueva y leer el aviso. |
| **Esperado** | 1: el formulario queda **vacÃ­o** y con el tÃ­tulo `Nuevo seguimiento`; `#seguimiento-cancelar` sigue oculto, porque en alta no hay nada que cancelar. 2: la primera opciÃ³n es `ElegÃ­ un cliente` con `value=""`, y despuÃ©s viene **un cliente por opciÃ³n, y solo los activos**: los cuatro de la secciÃ³n 2. Un cliente archivado desaparece de este desplegable (secciÃ³n 7, `R-04`). 3: el navegador lo bloquea, porque el `select` es `required`: no sale ninguna peticiÃ³n. 5: `POST /api/followups` `201` con **cinco** claves â€”`customerId`, `title`, `body`, `dueDate`, `status`â€”, sin `id`, sin `organizationId`, sin `completedAt` y sin `createdAt`. `body` va en `null` (el `Detalle` del formulario se llama `body` en la API y `body` es tambiÃ©n la columna), y `status` es `"pending"` porque asÃ­ venÃ­a el desplegable. El `id` que devuelve el servidor empieza con `cliseg` y trae `completedAt: null`, `createdAt` con ISO y `updatedAt: null`. 6: la fila aparece de golpe en la tabla, el aviso verde dice `Seguimiento creado` y el formulario vuelve a quedar vacÃ­o. El `Detalle` vacÃ­o **no** aparece como texto en la celda del tÃ­tulo: solo se pinta si hay valor. |

| | |
|---|---|
| **ID** | CRM-SEG-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | `QA-CRM empresa sur` con un `pending` sin `dueDate`. |
| **Pasos** | 1. Pulsar `Editar` en ese seguimiento.<br>2. Comprobar los cinco valores del formulario y que `#seguimiento-cancelar` estÃ© visible.<br>3. Cambiar `#seguimiento-estado` a `Cancelado` y pulsar `Guardar`.<br>4. Leer el `PATCH` en Network.<br>5. Comprobar la fila y el aviso. |
| **Esperado** | 2: los cinco campos vienen con lo que hay en la base, y el botÃ³n `Cancelar` **sÃ­** aparece (en alta estÃ¡ oculto). 3 y 4: `PATCH /api/followups/<id>` con los **cinco** campos, `status: "canceled"` incluido y `dueDate: null`: la pantalla reconstruye el cuerpo entero, y el servidor lo **mezcla** con la fila existente antes de validar, asÃ­ que un campo que no se manda no se pierde (aunque igual se mande). 5: la fila pasa a `Cancelado`, `completedAt` queda en `null` (no es `done`) y el aviso dice `Seguimiento actualizado`. El formulario queda vacÃ­o otra vez, como si fuera un alta nueva. Al pulsar `Cancelar` en cualquier momento, el formulario se vacÃ­a sin pedir nada al servidor. |

| | |
|---|---|
| **ID** | CRM-SEG-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Un seguimiento `pending` con `dueDate` = `H-3`. |
| **Pasos** | 1. Ir a `?panel=seguimientos` y pulsar `Marcar hecho` en su fila.<br>2. Responder lo que aparezca, si aparece algo.<br>3. Leer el `PATCH` en Network.<br>4. Recargar la tabla.<br>5. Ir al tablero y leer las tres bolsas y el KPI `Pendientes`. |
| **Esperado** | 1: **no hay ninguna confirmaciÃ³n** antes de completar (secciÃ³n 7, `R-03`). 3: `PATCH /api/followups/<id>` con el cuerpo **`{"status":"done"}` a secas**: la fecha de completado no se manda, la pone el servidor (`completedAt = new Date()`), y con `dueDate` sigue en la base. La respuesta es `200 {"followup":â€¦}` con `completedAt` con valor. 4: la etiqueta pasa a `Hecho` y **el botÃ³n cambia a `Reabrir`**. La **fecha de vencimiento no se borra**: `Marcar hecho` marca el estado y nada mÃ¡s. 5: el seguimiento sale de `Vencidos`, el KPI `Pendientes` baja 1 y `porEstado.done` sube 1. El tablero y el panel leen los dos de la base, asÃ­ que quedan coherentes sin que la pantalla recargue el tablero. |

| | |
|---|---|
| **ID** | CRM-SEG-06 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Un `pending` y un `done`. |
| **Pasos** | 1. Pulsar `Marcar hecho` en el `pending`.<br>2. Leer `completedAt` con `GET /api/followups/<id>`.<br>3. Pulsar `Reabrir` en esa misma fila.<br>4. Volver a leer `completedAt`.<br>5. Pulsar `Marcar hecho` otra vez y volver a leer `completedAt`. |
| **Esperado** | El botÃ³n es el **mismo** en los dos sentidos y su texto se calcula con el estado: `Marcar hecho` si no estÃ¡ `done`, `Reabrir` si estÃ¡ (secciÃ³n 7, `R-15`). 1 y 2: `PATCH {"status":"done"}` y `completedAt` con la hora del servidor. 3 y 4: `PATCH {"status":"pending"}` y **`completedAt` vuelve a `null`**: un seguimiento abierto no puede quedar con la hora de un cierre anterior, y el servidor la limpia (`routes.ts:435-438`). 5: al volver a marcarlo hecho, `completedAt` es **una hora nueva**, no la anterior: se perdiÃ³ el dato de cuÃ¡ndo se terminÃ³ la primera vez. Con el estado del formulario (`#seguimiento-estado`) pasa lo mismo, porque va por la misma funciÃ³n. |

| | |
|---|---|
| **ID** | CRM-SEG-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Los seis seguimientos de la secciÃ³n 2. |
| **Pasos** | 1. Escribir `QA-CRM` en el campo de buscar del panel.<br>2. Buscar un selector de fecha, un filtro de estado y un filtro de texto.<br>3. Filtrar por `#seguimiento-cliente` y copiar la URL.<br>4. Recargar con esa URL.<br>5. Comparar con `GET /api/followups?status=pending` y `GET /api/followups?customerId=<id>`. |
| **Esperado** | 1: **el campo no existe**. Este panel no tiene buscador: no hay `#seguimiento-buscar`, ni filtro por estado, ni filtro por rango de fechas, aunque la API soporte `status` y el cliente. Solo existe el desplegable de cliente (secciÃ³n 7, `R-18`). 3: la URL **no cambia**: sigue en `?panel=seguimientos`, asÃ­ que el filtro no se puede compartir, marcar ni sobrevivir a un `F5`; al recargar (paso 4) la tabla sale **sin filtrar y el desplegable vuelve a `ElegÃ­ un cliente`**: el `F5` baja el HTML otra vez y el `value` elegido no estaba en el `index.html`, asÃ­ que el filtro no sobrevive ni a un `F5`. 5: por API los dos filtros funcionan: `?status=pending` deja solo los `pending` y `?customerId=` deja solo los de ese cliente, y los dos se pueden combinar. La pantalla usa solo el segundo. |

| | |
|---|---|
| **ID** | CRM-SEG-08 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n activa. |
| **Pasos** | 1. Escribir 151 caracteres en `#seguimiento-titulo`.<br>2. Escribir 2001 caracteres en `#seguimiento-detalle`.<br>3. Poner `#seguimiento-fecha` = `2026-9-1`.<br>4. Con `#seguimiento-cliente` sin elegir, pulsar `Guardar`.<br>5. Por API, `POST /api/followups` con un `title` de 151 caracteres y otro con `dueDate` = `"2026-9-1"`. |
| **Esperado** | 1 y 2: los `maxlength` (`150` y `2000`) impiden escribir el carÃ¡cter de mÃ¡s; 3, el `type="date"` no acepta ese formato; 4, el `select` `required` bloquea el envÃ­o. En los cuatro **no sale ningÃºn error del servidor**, porque no llega a haber `POST`. 5: acÃ¡ sÃ­ se prueba la validaciÃ³n del servidor: `400 {"error":"Datos invÃ¡lidos","errors":{"fieldErrors":{"title":["MÃ¡ximo 150 caracteres"]}}}` y, para la fecha, `La fecha va como AAAA-MM-DD`. En la pantalla, ese mismo error aparecerÃ­a en `#aviso` con el nombre del campo y el mensaje unidos por ` Â· `. |

| | |
|---|---|
| **ID** | CRM-SEG-09 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n `member`, con la cookie a mano. |
| **Pasos** | 1. En la pantalla, buscar un botÃ³n que borre o archive un seguimiento.<br>2. Crear un seguimiento y marcarlo hecho desde la pantalla.<br>3. Por API, `DELETE /api/followups/<id>` con la sesiÃ³n de `member`.<br>4. Por API, `DELETE /api/followups/<id>` con la sesiÃ³n de `admin`.<br>5. Reintentar el `DELETE` de un id ya borrado. |
| **Esperado** | 1: **no hay ningÃºn botÃ³n**: ni `Archivar`, ni `Eliminar`, ni `Marcar cancelado`. La ruta existe y es de `admin`, pero desde la pantalla no se llega (`R-18`). 2: un `member` **sÃ­** puede crear y completar seguimientos: `POST` `201` y `PATCH` `200`, porque el rol de escritura por defecto es `member`. 3: `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`. 4: `200 {"followup":â€¦,"deleted":true}` â€” y es un **borrado fÃ­sico**: el seguimiento desaparece de la base, del panel, de la ficha y de los KPI (`R-01`, `R-04`). 5: `404 Ese seguimiento no existe`, y no `200`: al revÃ©s que archivar un cliente, que es idempotente en cuanto al mensaje. |

---
### 4.5 Panel Contactos

El historial **no** tiene formulario de ediciÃ³n, y no es una falta de pantalla: una fila de
contacto es la prueba de lo que pasÃ³, y se corrige agregando otra fila.

| | |
|---|---|
| **ID** | CRM-CON-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los cinco contactos de la secciÃ³n 2. |
| **Pasos** | 1. Abrir `?panel=contactos`.<br>2. Contar las cabeceras y leerlas.<br>3. Leer las filas en orden.<br>4. Contar los botones de cada fila.<br>5. Comparar con `GET /api/interactions?limit=300`.<br>6. Buscar en el panel cualquier control de bÃºsqueda, filtro o paginaciÃ³n. |
| **Esperado** | 2: **4** columnas: `Cliente`, `Tipo`, `QuÃ© pasÃ³`, `CuÃ¡ndo`. **No hay columna `Acciones`**: la tabla es de solo lectura y no tiene ni un botÃ³n. El `Tipo` sale con su etiqueta en mayÃºscula inicial (`Llamada`, `Correo`, `Visita`, `Nota`). 3: las filas van de la mÃ¡s reciente a la mÃ¡s vieja por `happenedAt`, y el contacto de `2020` queda **Ãºltimo** aunque su cliente (`QA-CRM ficha minima`) no tenga telÃ©fono ni correo. El nombre del cliente sale del arreglo de clientes ya cargado en el navegador; si el `customerId` no estuviera en esa lista, se verÃ­a `â€”`. 5: la respuesta es `{"interactions":[â€¦]}`, no un arreglo pelado, y viene en el mismo orden que la pantalla. 6: **no hay nada**: ni buscador, ni filtro por cliente, ni por tipo, ni paginaciÃ³n, aunque la API soporte `customerId`, `kind` y `limit` (secciÃ³n 7, `R-18`). La lista se limita a **300** filas, sin ningÃºn aviso de que haya mÃ¡s. |

| | |
|---|---|
| **ID** | CRM-CON-02 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n `member`. |
| **Pasos** | 1. En `#contacto-cliente`, elegir `QA-CRM empresa sur`.<br>2. Elegir `#contacto-tipo` = `Visita`.<br>3. Escribir en `#contacto-resumen` = `QA-CRM visita a planta`.<br>4. Pulsar `Registrar` y leer el `POST`.<br>5. Mirar la tabla, el formulario y el aviso.<br>6. Buscar un botÃ³n `Cancelar` en el formulario. |
| **Esperado** | 1: el desplegable tiene la opciÃ³n vacÃ­a `ElegÃ­ un cliente` y despuÃ©s **los clientes activos**, uno por opciÃ³n. 4: `POST /api/interactions` `201` con **tres** claves: `customerId`, `kind`, `summary`. **No** manda `happenedAt` â€”es deliberado, `app.js:516`â€”, ni `id`, ni `organizationId`, ni `createdAt`. El `id` que devuelve el servidor empieza con `clicont`, y trae `happenedAt` con la hora del servidor en ISO y `createdAt` casi idÃ©ntico. 5: la fila aparece **primera** en la tabla (es la mÃ¡s reciente), el campo `QuÃ© pasÃ³` queda **vacÃ­o** para el siguiente y el aviso verde dice `Contacto registrado`. 6: **no hay `Cancelar`**: es el Ãºnico formulario del producto sin botÃ³n de deshacer, porque es el Ãºnico que solo agrega. `#contacto-cliente` y `#contacto-tipo` **conservan** el valor elegido, asÃ­ que registrar dos contactos seguidos para el mismo cliente sale rÃ¡pido. |

| | |
|---|---|
| **ID** | CRM-CON-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Los cinco contactos, y un navegador con zona horaria distinta de la de los ajustes de la organizaciÃ³n. |
| **Pasos** | 1. Anotar la hora del navegador.<br>2. Leer el `CuÃ¡ndo` de las filas y el `happenedAt` crudo de `GET /api/interactions`.<br>3. Cambiar la zona horaria del navegador y recargar.<br>4. Registrar 6 contactos nuevos seguidos.<br>5. Mirar `Ãšltimos contactos` en el tablero y el panel de contactos. |
| **Esperado** | 2: el `CuÃ¡ndo` se pinta con `AMIGO_UI.fecha(iso, true)` en formato `es-CL`: `5 oct 2026 14:03`, **sin zona horaria explÃ­cita**, o sea que se convierte a la **zona del navegador**; el dato guardado es UTC y no se toca. El `hoy` del tablero, en cambio, lo decide el servidor con la zona de la organizaciÃ³n (secciÃ³n 7, `R-17`). 3: al cambiar la zona del navegador, **todas** las horas se mueven y puede cambiar el dÃ­a que se ve, sin que se haya tocado nada en el servidor. 4 y 5: la tarjeta `Ãšltimos contactos` del tablero muestra **10** filas y nada mÃ¡s; con 11 contactos, el primero se queda fuera. El panel de contactos, en cambio, muestra los 11. Los dos leen la misma tabla con lÃ­mites distintos: `limit(10)` en el servidor (`routes.ts:247`) y `limit=300` en la pantalla. |

| | |
|---|---|
| **ID** | CRM-CON-04 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | La cookie de sesiÃ³n, para llamar a la API con `curl`. |
| **Pasos** | 1. `POST /api/interactions` con `happenedAt` = `2020-01-01T12:00:00Z`.<br>2. Leer la respuesta.<br>3. Mirar la tabla de `?panel=contactos`.<br>4. Registrar otro contacto **desde la pantalla**.<br>5. Comparar con `GET /api/resumen`. |
| **Esperado** | 1 y 2: `201`, y el `happenedAt` guardado es **exactamente** el que se mandÃ³: la API sÃ­ acepta el instante (es lo que permite migrar el historial del legacy), aunque la pantalla no lo ofrezca. 3: la fila sale **Ãºltima** de la tabla, con `1 ene 2020 09:00` si el navegador estÃ¡ en `America/Santiago` (doce horas menos). 4: el `POST` de la pantalla sale sin `happenedAt` y el servidor le pone la hora de ahora: **no hay forma de anotar a mano** un contacto de ayer, ni de corregir la hora de uno mal registrado. 5: `contactos30d` no lo cuenta: la ventana son los **Ãºltimos 30 dÃ­as** exactos (`happenedAt >= now âˆ’ 30 dÃ­as`), no el mes calendario, asÃ­ que el nÃºmero **baja solo** al empezar el mes sin que nadie haya hecho menos contacto. |

| | |
|---|---|
| **ID** | CRM-CON-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Un contacto existente y la cookie de sesiÃ³n. |
| **Pasos** | 1. Buscar en la pantalla cualquier forma de editar o borrar un contacto.<br>2. `PATCH /api/interactions/<id>` con `{"summary":"otro texto"}`.<br>3. `DELETE /api/interactions/<id>`.<br>4. `GET /api/interactions/<id>`.<br>5. Registrar dos contactos con el mismo texto. |
| **Esperado** | 1: **no hay ninguna**. Ni botÃ³n, ni menÃº, ni atajo: el historial es de agregar y leer. 2: `404 {"error":"No existe PATCH /api/interactions/<id>"}` â€” no es un `403` ni un `400`: la ruta **no estÃ¡ declarada**, y el mensaje dice el mÃ©todo y la ruta que se pidiÃ³. 3 y 4: igual, `404` con `No existe DELETE â€¦` y `No existe GET â€¦`. Las Ãºnicas rutas de contactos son `GET /api/interactions` y `POST /api/interactions` (`routes.ts:544` y `routes.ts:567`), y el comentario del archivo explica por quÃ©: editar en silencio un registro de lo que pasÃ³ lo convierte en lo que alguien escribiÃ³ despuÃ©s (secciÃ³n 7, `R-14`). 5: **sÃ­** se puede, y quedan **dos filas**: el historial no deduplica ni avisa. La Ãºnica forma de Â«corregirÂ» un contacto es agregar otro que lo corrija, y los dos quedan para siempre. |

---
### 4.6 Panel Ajustes

Solo hay **dos** ajustes, y son de la **organizaciÃ³n**, no de la persona: por eso leer es libre y
cambiar exige `admin`.

| | |
|---|---|
| **ID** | CRM-AJU-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n `member` o `admin`. |
| **Pasos** | 1. Abrir `?panel=ajustes`.<br>2. Contar los campos del formulario y leer sus rÃ³tulos.<br>3. Leer sus valores y sus `maxlength`.<br>4. Comparar con `GET /api/settings`.<br>5. Buscar campos de nombre de empresa, logo, color o idioma. |
| **Esperado** | 2: **dos** campos, `Moneda` y `Zona horaria`, en una fila de dos columnas. No hay nombre de empresa, ni logo, ni color de marca, ni idioma: el shell los saca del Core, no del producto. 3: `Moneda` es un `input` de texto con `maxlength="5"` y `Zona horaria` con `maxlength="64"`; ninguno es un `select`, asÃ­ que el valor por defecto (`America/Santiago`) hay que reconocerlo, no elegirlo. 4: `GET /api/settings` devuelve `{"settings":{"organizationId":"â€¦","currency":"$","timezone":"America/Santiago"}}`: los **defaults son del servidor** (`leerPreferencias`, `routes.ts:98`), no del navegador, asÃ­ que una organizaciÃ³n sin fila de ajustes ve igual `$` y `America/Santiago`. Los `name` de los campos (`currency`, `timezone`) coinciden con las claves de la API. 5: no existe ninguno de los cuatro. |

| | |
|---|---|
| **ID** | CRM-AJU-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n **`admin`**. |
| **Pasos** | 1. Poner `#cfg-moneda` = `MXN` y `#cfg-zona` = `America/Mexico_City`.<br>2. Pulsar `Guardar ajustes` y leer el `PUT`.<br>3. Recargar `/` y volver a abrir `?panel=ajustes`.<br>4. Recorrer las seis tarjetas, las tres bolsas, las tablas de clientes, seguimientos y contactos, y la ficha buscando importes.<br>5. Restaurar `$` y `America/Santiago` y comprobar con `GET /api/settings`. |
| **Esperado** | 2: `PUT /api/settings` con `{"currency":"MXN","timezone":"America/Mexico_City"}` y `200`: el cuerpo se arma recorriendo `form.elements` y copiando `name` â†’ valor, asÃ­ que manda **exactamente** esos dos campos. El aviso verde dice `Ajustes guardados`. 3: los dos valores vuelven a aparecer, cargados desde el servidor y no desde el navegador. 4: **no cambia ni una cifra en ninguna parte**: el CRM no tiene un solo importe, asÃ­ que la moneda guardada no se pinta nunca. Es un ajuste heredado del legacy que acÃ¡ no hace nada (secciÃ³n 7, `R-21`). 5: `PUT` `200` de nuevo y los valores vuelven a los del principio. El cambio de zona, en cambio, **sÃ­** mueve el `hoy` del tablero, que es lo que se prueba en `CRM-AJU-03`. |

| | |
|---|---|
| **ID** | CRM-AJU-03 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | SesiÃ³n `admin`, con un seguimiento en `H` y otro en `H-3`. |
| **Pasos** | 1. Leer `hoy` en `GET /api/tablero`.<br>2. Poner `#cfg-zona` = `Pacific/Kiritimati` (horas adelante) y guardar.<br>3. Volver a leer `hoy`, las tres bolsas y las tarjetas `Pendientes`, `Vencidos` y `Para hoy`.<br>4. Poner `#cfg-zona` = `NoSuch/Zone` y guardar.<br>5. Restaurar `America/Santiago`. |
| **Esperado** | 1 y 3: el `hoy` **se mueve con la zona de la organizaciÃ³n**, no con la del navegador: al guardar `Pacific/Kiritimati`, el seguimiento de `H` pasa a `Vencidos`. El KPI `Pendientes` **no** cambia (sigue en 4, porque cuenta estados y no fechas), asÃ­ que el tablero puede mostrar `Vencidos: 2` y `Para hoy: 0` con cuatro pendientes. La zona se valida contra la base IANA **con `Intl`** (`routes.ts:628`), no contra una lista escrita a mano. 4: `400 {"error":"Zona horaria desconocida: NoSuch/Zone"}` en rojo, y el `hoy` **no** cambia: un error de zona produce un mensaje que se puede arreglar, no un tablero con la fecha de otro huso. 5: la zona vuelve a la original y el `hoy` se va con ella. |

| | |
|---|---|
| **ID** | CRM-AJU-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n **`member`** de la misma organizaciÃ³n. |
| **Pasos** | 1. Abrir `?panel=ajustes`.<br>2. Comprobar si el formulario aparece editable o deshabilitado.<br>3. Cambiar `#cfg-moneda` y pulsar `Guardar ajustes`.<br>4. Leer el `PUT` en Network y el aviso.<br>5. Comprobar el valor del campo despuÃ©s del intento y con `GET /api/settings`. |
| **Esperado** | 2: el formulario aparece **completamente editable**: los dos campos aceptan escritura y `Guardar ajustes` estÃ¡ activo. La pantalla no sabe el rol â€”`GET /api/inicio` sÃ­ se lo dice en `rol`, pero `app.js` no lo usa para nadaâ€”, asÃ­ que un `member` ve un formulario de empresa como si fuera suyo (secciÃ³n 7, `R-22`). 3 y 4: `PUT /api/settings` `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`, y `#aviso` muestra `rol-insuficiente` en rojo. 5: el campo **conserva lo que se escribiÃ³**, aunque no se guardÃ³: no hay reversiÃ³n ni otro aviso que el del error. `GET /api/settings` sigue devolviendo los valores de antes, asÃ­ que el `member` puede cambiar de zona en su pantalla y tener el tablero de toda la empresa movido, aunque el servidor no lo acepte. |

---
### 4.7 API, aislamiento y rutas generadas

Las rutas de clientes salen del `crudRouter` compartido (`packages/product-runtime/src/crud.ts`) y
devuelven la **fila pelada**, sin envoltorio. Las de seguimientos, contactos y ajustes estÃ¡n
escritas a mano y sÃ­ envuelven (`{followup}`, `{interaction}`, `{settings}`). En los `AppError` el
campo `error` lleva el **mensaje**, y el cÃ³digo estÃ¡ en el status: `{"error":"No encontrado"}` es un
`404`, no un `404 not-found`.

| | |
|---|---|
| **ID** | CRM-API-01 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los cuatro clientes de la secciÃ³n 2, mÃ¡s uno archivado. |
| **Pasos** | 1. `GET /api/customers`.<br>2. `GET /api/customers?limit=1&offset=1`.<br>3. `GET /api/customers?limit=0`, `?limit=99999` y `?limit=-1`.<br>4. `GET /api/customers?q=norte`, `?q=Lima` y `?q=%`.<br>5. `GET /api/customers/<id del archivado>`.<br>6. Anotar el orden de los `items` y el `total` de cada respuesta. |
| **Esperado** | 1: `200 {"items":[â€¦],"total":4,"limit":200,"offset":0}`, **ordenado por nombre ascendente** (`QA-CRM ficha minima` va primero), en camelCase, y con el archivado **excluido** (`archived_at IS NULL`, `crud.ts:199-203`). 2: `limit=1, offset=1` devuelve la segunda fila por nombre y `total` sigue siendo 4: `total` cuenta todo lo filtrado, no la pÃ¡gina. 3: `limit=0` cae al default (**200**), porque `Number('0') \|\| 200` es 200; `limit=99999` se recorta a **1000**; y **`limit=-1` pasa tal cual**: `Math.min(-1, 1000)` es `-1`, y SQLite lo lee como Â«sin lÃ­miteÂ», asÃ­ que un `?limit=-1` devuelve la tabla entera (secciÃ³n 7, `R-09`). 4: `q=norte` trae un cliente, porque busca en `name`, `company`, `email`, `phone` y `taxId` (`routes.ts:667`) y **no** en `city` ni en `tags`; `q=Lima` trae **cero**; y `q=%` trae **los cuatro**, porque el texto se mete en un `LIKE '%â€¦%'` sin escapar y `%` es un comodÃ­n (secciÃ³n 7, `R-08`). 5: `200` con la fila y su `archivedAt` con valor: archivar esconde de la lista, no de la API. 6: los cuatro `total` son los de arriba y ninguno incluye al archivado. |

| | |
|---|---|
| **ID** | CRM-API-02 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Dos empresas y dos personas de la secciÃ³n 2. |
| **Pasos** | 1. `GET /api/customers?kind=empresa`.<br>2. `GET /api/customers?kind=tercero`.<br>3. `GET /api/customers?kind` (sin valor).<br>4. `GET /api/customers?kind=persona&kind=empresa`.<br>5. `GET /api/customers?status=activo`.<br>6. Comparar con lo que se puede filtrar en la pantalla. |
| **Esperado** | 1: `200` con **dos** clientes y `total: 2`. 2: `400 {"error":"El filtro kind no es valido","errors":{"fields":["kind: â€¦"]}}`: un valor fuera del enum es un error de quien lo escribiÃ³, y se dice en vez de devolver la lista completa y dejar que el que prueba crea que filtrÃ³ (`crud.ts:219-224`). 3: `200` con todo, sin filtro: un filtro sin valor se ignora a propÃ³sito, porque `?kind` significa Â«trÃ¡emelos todosÂ». 4: `200` filtrando por **`empresa`**, el primer valor: un parÃ¡metro repetido no es error. 5: `200` con todo y **sin error**: `status` no estÃ¡ declarado como filtro de clientes, asÃ­ que un parÃ¡metro que el producto no usa se ignora en silencio (secciÃ³n 7, `R-09`). 6: la pantalla no tiene filtro por tipo: el desplegable de tipo existe en el formulario de alta, pero no hay forma de listar Â«solo empresasÂ». La API lo soporta y la pantalla no lo usa (secciÃ³n 7, `R-07`). |

| | |
|---|---|
| **ID** | CRM-API-03 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | SesiÃ³n `member`. |
| **Pasos** | 1. `POST /api/customers` con `{"name":"QA-CRM api 1","kind":"empresa"}`.<br>2. `PATCH /api/customers/<id>` con `{"city":"QA-CRM"}`.<br>3. `PATCH` con `{"emial":"a@b.example"}`.<br>4. `PATCH` con `{"archivedAt":"2026-01-01"}`, y aparte con `{"organizationId":"org_de_otra"}`.<br>5. `POST` con `{"name":"QA-CRM api 2","createdAt":"2020-01-01"}`.<br>6. `POST` con `{"name":""}`.<br>7. `POST` con `{"name":"QA-CRM api 3","birthday":"2026-9-4"}`. |
| **Esperado** | 1: `201` con la fila pelada: `id` que empieza con `clicliente`, `organizationId` **de la sesiÃ³n**, `kind: "empresa"`, `archivedAt: null`, `createdAt` del servidor, `updatedAt: null` y `birthday` en `null` si no se mandÃ³. El `id` lo pone el servidor. 2: `200` con la fila y `updatedAt` con valor; los campos que no se manda **no se tocan**, porque el schema del `PATCH` es parcial. 3: `400 Campo desconocido: emial. Revisa el nombre; si esta bien escrito, no lo mandes.`: el `crudRouter` valida con `.strict()` para que una clave mal escrita no se descarte en silencio (`crud.ts:148`). 4: los dos dan `400 Campo desconocido`, uno por clave: `archivedAt`, `createdAt` y `updatedAt` son de **solo lectura**, y `organizationId` no es un campo del producto. 5: `400 Campo desconocido: createdAt`. 6: `400 {"error":"Datos invÃ¡lidos","errors":{"fieldErrors":{"name":["Too small: expected string to have >=1 characters"]}}}`. 7: `400` con `La fecha va como AAAA-MM-DD`: la fecha se valida con una expresiÃ³n regular, no con `Date.parse`, asÃ­ que `2026-9-4` no pasa aunque esa fecha exista. |

| | |
|---|---|
| **ID** | CRM-API-04 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Un cliente con un seguimiento y un contacto. |
| **Pasos** | 1. `DELETE /api/customers/<id>`.<br>2. `GET /api/customers/<id>`.<br>3. `GET /api/customers?q=<prefijo>`.<br>4. `GET /api/followups?customerId=<id>`.<br>5. `GET /api/tablero` y `GET /api/resumen`.<br>6. `PATCH /api/customers/<id>` con `{"archivedAt":null}`. |
| **Esperado** | 1: `200 {"ok":true,"archived":true}`. No hay `deleted`, porque no se borrÃ³ nada: la fila recibe `archivedAt = nowIso()` (`crud.ts:309-318`). 2: `200` con la fila y `archivedAt` con valor: el cliente **sigue existiendo**. 3: `200` con `items: []` y `total: 0`. 4: `200 {"followups":[â€¦]}`: los seguimientos **siguen ahÃ­**, porque archivar no toca esa tabla y la ruta no consulta `archived_at` (secciÃ³n 7, `R-04`). 5: `cumpleanos` **sÃ­** pierde al cliente archivado (esa consulta filtra `archived_at IS NULL`, `routes.ts:229`), pero `seguimientos.vencidos/hoy/proximos` y `contactos` lo siguen mostrando, y `resumen.seguimientos.total` y `contactos30d` no bajan. 6: `400 Campo desconocido: archivedAt`: **no hay forma de desarchivar** por API ni por pantalla (secciÃ³n 7, `R-02`). |

| | |
|---|---|
| **ID** | CRM-API-05 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Los seis seguimientos de la secciÃ³n 2. |
| **Pasos** | 1. `GET /api/followups`.<br>2. `GET /api/followups?status=done` y `?status=pendiente`.<br>3. `GET /api/followups?limit=0`, `?limit=99999` y `?limit=-5`.<br>4. `GET /api/followups?customerId=<id>&status=pending`.<br>5. `POST /api/followups` con `{"customerId":"<id>","title":"QA-CRM api","organizationId":"otra","completedAt":"2020-01-01","id":"mio"}`.<br>6. `GET /api/followups/<id>`.<br>7. `PATCH` con `{"status":"done"}` y luego con `{"status":"pending"}`, leyendo `completedAt` en cada paso. |
| **Esperado** | 1: `200 {"followups":[â€¦]}` â€” **envuelto**, a diferencia de los clientes. Sin `?limit=` el tope es **100**, y el orden es `dueDate` ascendente con los `NULL` primero. 2: `?status=done` trae 1; `?status=pendiente` trae **0 con `200`**: esta ruta **no valida el enum** (a diferencia de `?kind=` en clientes, que da `400`), asÃ­ que un typo devuelve una lista vacÃ­a sin avisar. 3: `limit=0` â†’ 100, `limit=99999` â†’ **500** (aquÃ­ sÃ­ recorta: `Math.min(Math.max(n \|\| 100, 1), 500)`) y `limit=-5` â†’ **1**: un lÃ­mite negativo aquÃ­ no devuelve todo, lo deja en uno. 4: los dos filtros se combinan con `AND`: 2 filas. 5: `201`, y el `followup` devuelto tiene **`organizationId` de la sesiÃ³n**, `id` con prefijo `cliseg` y `completedAt` segÃºn el estado; las tres claves extra se **descartan en silencio**, porque el schema de esta ruta no es `.strict()` (secciÃ³n 7, `R-16`). 6: `200 {"followup":â€¦}` en camelCase. 7: al pasar a `done` se guarda la hora; al volver a `pending`, `completedAt` **se limpia a `null`**; y al volver a `done` se guarda una hora **nueva**. Con solo `{"status":â€¦}` el resto de la fila no se pierde: el `PATCH` parte de la fila existente y la mezcla antes de validar (`routes.ts:482-489`). |

---| | |
|---|---|
| **ID** | CRM-API-06 |
| **Tipo / Prioridad** | FUNC / P0 |
| **PrecondiciÃ³n** | Un cliente de la organizaciÃ³n A y otro de la organizaciÃ³n B. |
| **Pasos** | 1. `POST /api/followups` con el `customerId` de B.<br>2. `PATCH /api/followups/<id de A>` con `{"customerId":"<id de B>"}`.<br>3. `GET /api/followups/<id de B>`.<br>4. `PATCH /api/followups/<id de B>`.<br>5. `DELETE /api/followups/<id de B>`.<br>6. `POST /api/interactions` con el `customerId` de B. |
| **Esperado** | 1: `400 Ese cliente no existe en esta organizacion`: el alta valida el cliente **antes** de escribir (`clienteDe`, `routes.ts:162`), y el mensaje no revela si ese id existe en otra organizaciÃ³n. 2: `400` con el mismo mensaje, y el seguimiento **no** cambia de cliente ni queda desasociado: la validaciÃ³n ocurre antes del `UPDATE`. 3 y 4: `404 Ese seguimiento no existe`: la consulta trae `organization_id` de la sesiÃ³n, asÃ­ que un `id` de otra organizaciÃ³n es inexistente. 5: con `member` es `403 rol-insuficiente`, y con `admin` es `404`, porque el `requireRole` va **antes** del manejador. En ningÃºn caso aparecen datos de B. 6: `400 Ese cliente no existe en esta organizacion`, igual que el alta de un seguimiento. |

| | |
|---|---|
| **ID** | CRM-API-07 |
| **Tipo / Prioridad** | FUNC / P1 |
| **PrecondiciÃ³n** | Un `customerId` vÃ¡lido y uno invÃ¡lido. |
| **Pasos** | 1. `POST /api/interactions` con `{"customerId":"<vÃ¡lido>","kind":"llamada","summary":"QA-CRM"}`.<br>2. Repetir con `kind` = `whatsapp`.<br>3. Repetir **sin** `kind`.<br>4. `GET /api/interactions?kind=nota&limit=3`.<br>5. `GET /api/interactions?customerId=<otro cliente>`.<br>6. `GET /api/interactions?limit=99999` y `?limit=-5`. |
| **Esperado** | 1: `201 {"interaction":â€¦}` con `id` que empieza con `clicont`, `happenedAt` del servidor y `createdAt` del servidor. 2: `400 Datos invÃ¡lidos` con `errors.fieldErrors.kind`: los cuatro canales son un enum cerrado (`llamada`, `correo`, `visita`, `nota`) y no hay texto libre. 3: `201`, y el `kind` guardado es **`nota`**, porque el default estÃ¡ en el schema y no en la pantalla: un `POST` sin tipo registra una nota. 4: `200 {"interactions":[â€¦]}` con 3 filas como mÃ¡ximo, de la mÃ¡s reciente a la mÃ¡s antigua. 5: `200` solo con las filas de ese cliente. 6: `limit=99999` â†’ **500** y `limit=-5` â†’ **1**, igual que seguimientos. Las tres rutas que aceptan `limit` recortan distinto: clientes **1000**, seguimientos **500** y contactos **500**, y solo la de clientes se deja pasar un negativo. |

| | |
|---|---|
| **ID** | CRM-API-08 |
| **Tipo / Prioridad** | SIST / P0 |
| **PrecondiciÃ³n** | La cookie de sesiÃ³n. |
| **Pasos** | 1. `GET /api/tablero` sin cookie.<br>2. `GET /api/tablero` con una cookie alterada.<br>3. `GET /api/tablero` con un token vencido.<br>4. `GET /health` sin cookie.<br>5. `GET /api/customers/123456789` con un id que no existe.<br>6. `GET /api/ruta-que-no-existe`. |
| **Esperado** | 1: `401 {"error":"sin-sesion","message":"Tu sesiÃ³n no estÃ¡ iniciada.","loginUrl":"http://localhost:3108/auth/login?â€¦"}`. 2: `401` con `error` = `invalido` y el mensaje `No pudimos validar tu sesiÃ³n. VolvÃ© a entrar.`, y la cookie se borra: una cookie manipulada es un `401`, no un `403`. 3: `401 {"error":"expirada","message":"Tu sesiÃ³n venciÃ³. VolvÃ© a entrar para seguir.",â€¦}`. 4: `200 {"ok":true,"product":"crm","name":"Clientes"}` **sin sesiÃ³n**: `/health` es pÃºblico por diseÃ±o, es lo que revisa el balanceador; si la base no estuviera, serÃ­a `503 {"ok":false,"product":"crm"}`. 5: `404 {"error":"No encontrado"}`, nunca `500` por un id raro. 6: `404 {"error":"No existe GET /api/ruta-que-no-existe"}`. |

| | |
|---|---|
| **ID** | CRM-API-09 |
| **Tipo / Prioridad** | SIST / P0 |
| **PrecondiciÃ³n** | Dos organizaciones con suscripciÃ³n al CRM, cada una con sus datos. |
| **Pasos** | 1. Con la sesiÃ³n de A, listar clientes, seguimientos y contactos, y leer `/api/resumen` y `/api/tablero`.<br>2. Repetir todo con la sesiÃ³n de B.<br>3. Con A, meter en las URLs el `customerId`, el `id` de la ficha y los filtros `q` y `kind` con valores de B.<br>4. Con A, `POST` y `PATCH` mandando `organizationId` de B.<br>5. Comparar los conteos de A y de B. |
| **Esperado** | Cada sesiÃ³n ve **solo** lo suyo, en las cinco lecturas y en las tres escrituras: el `organization_id` sale siempre del token y ninguna consulta lo toma del `query` ni del cuerpo. 3: un `id` de B en la URL da `404` y un `q` de B da `items: []`; nunca una fila ajena. 4: en el `crudRouter`, `400 Campo desconocido: organizationId`; en seguimientos y contactos, la clave se **descarta** y la fila se escribe con la organizaciÃ³n de la sesiÃ³n (secciÃ³n 7, `R-16`). 5: los conteos son independientes y no se suman entre sÃ­: `resumen.total` y `contactos30d` son por organizaciÃ³n. |

| | |
|---|---|
| **ID** | CRM-API-10 |
| **Tipo / Prioridad** | SIST / P1 |
| **PrecondiciÃ³n** | `curl` con la cookie, para mandar cuerpos raros. |
| **Pasos** | 1. `POST /api/customers` con `Content-Type: application/json` y el cuerpo `{"name":`.<br>2. `POST /api/customers` con un cuerpo de 2 MB.<br>3. `POST /api/customers` con `Content-Type: application/x-www-form-urlencoded`.<br>4. Mandar 700 peticiones a `/api/customers` en menos de 15 minutos.<br>5. Mirar las cabeceras de `/` y de `/app.js?v=â€¦`. |
| **Esperado** | 1: **`500 {"error":"Error interno del servidor"}`**, y **no** un `400`: `express.json()` lanza un `SyntaxError` con `type: 'entity.parse.failed'`, que no es `AppError`, ni error de Zod, ni `entity.too.large`, asÃ­ que el manejador cae en el `500` genÃ©rico y ademÃ¡s vuelca la traza al log del contenedor (secciÃ³n 7, `R-26`). 2: `413 {"error":"La peticiÃ³n es demasiado grande"}`: el lÃ­mite del runtime es 1 MB, tanto para JSON como para urlencoded (`app.ts:96-97`). 3: `201`: el runtime acepta formularios urlencoded, aunque la pantalla nunca los use. 4: al pasar de 600 peticiones en la ventana de 15 minutos, la respuesta es **`429`** con `Retry-After` y las cabeceras de lÃ­mite en formato `draft-8` (`RateLimit-Policy`, `RateLimit`); el `X-RateLimit-*` legacy estÃ¡ desactivado. Como el `429` no es un `401`, la pantalla lo muestra en `#aviso` en vez de navegar. 5: **no** hay `X-Powered-By`; `/` se sirve con `Cache-Control: no-cache` y **cualquier** recurso estÃ¡tico, versionado o no, con `public, max-age=31536000, immutable` (secciÃ³n 7, `R-24`). |

### 4.8 SesiÃ³n, arranque y lÃ­mites

| | |
|---|---|
| **ID** | CRM-SIS-01 |
| **Tipo / Prioridad** | SIST / P0 |
| **PrecondiciÃ³n** | El Core arriba. |
| **Pasos** | 1. `GET /` sin cookie.<br>2. `GET /?panel=clientes` sin cookie.<br>3. `GET /app.js` sin cookie.<br>4. `GET /health` sin cookie.<br>5. Entrar por el Core y volver a pedir `/`. |
| **Esperado** | 1, 2 y 3: **`302` al login del Core**, con un `return_to` que devuelve a la URL original (`?panel=clientes` incluida): una pÃ¡gina no responde `401` con JSON, navega. El `302` depende de la cabecera `Accept`: con `curl`, que no manda `Accept`, la misma ruta responde `401 {"error":"sin-sesion","loginUrl":"â€¦"}`, porque `/api/` y todo lo que no acepte HTML se responden siempre en JSON (`middleware.ts:87`). 4: `200 {"ok":true,"product":"crm","name":"Clientes"}` **sin sesiÃ³n**. 5: `200 text/html` con el HTML del producto, y **sin datos de ninguna organizaciÃ³n** en el cuerpo: el `index.html` no trae ni un cliente escrito, todo entra por la API. Si el Core no puede validar el token en ese instante, el producto redirige al login en vez de quedar en blanco. |

| | |
|---|---|
| **ID** | CRM-SIS-02 |
| **Tipo / Prioridad** | SIST / P1 |
| **PrecondiciÃ³n** | SesiÃ³n activa. |
| **Pasos** | 1. `GET /api/meta`.<br>2. `GET /api/me`.<br>3. `GET /api/inicio`.<br>4. Recargar `/` con **Preservar log** y contar las peticiones.<br>5. Comparar el nombre, el logo y el usuario del canal lateral con lo que dice `/api/inicio`. |
| **Esperado** | 1: `{"name":"Clientes","product":"crm","version":2,"identity":"amg-central"}`. 2: la identidad de la sesiÃ³n. 3: `{"usuario":{"id","nombre","email"},"organizacion":{"id","slug","nombre"},"rol":"â€¦","herramienta":"crm","herramientas":[{"slug","name","url"},â€¦]}`: **una sola llamada** con todo lo que dibuja el shell, resuelta desde el token y no con una llamada al Core por peticiÃ³n (`auth.ts:134-149`). 4: **7** peticiones en la carga inicial: `/api/inicio`, `/api/resumen` **dos veces**, `/api/tablero` **dos veces**, `/api/customers?limit=500` y `/api/settings` (secciÃ³n 7, `R-19`). Si se entra **directo** a `?panel=seguimientos` o `?panel=contactos` son **6** y ademÃ¡s la tabla de ese panel se pinta antes de tener los clientes, asÃ­ que la columna `Cliente` sale con `â€”` hasta que se escriba algo (secciÃ³n 7, `R-25`). 5: coinciden. El logo `CL` y el nombre `Clientes` vienen del HTML con `data-amigo`, y el usuario, su correo y el nombre de la organizaciÃ³n salen de `/api/inicio`. El bloque `Mis otras herramientas` queda oculto si la organizaciÃ³n tiene una sola herramienta. |

| | |
|---|---|
| **ID** | CRM-SIS-03 |
| **Tipo / Prioridad** | SIST / P1 |
| **PrecondiciÃ³n** | SesiÃ³n iniciada en el CRM. |
| **Pasos** | 1. En DevTools, mirar la cookie en Application â†’ Cookies.<br>2. Anotar sus atributos.<br>3. Escribir `document.cookie` en la consola.<br>4. Pulsar `Salir` en el pie del canal.<br>5. Intentar volver a `/` con la cookie anterior. |
| **Esperado** | 1 y 2: una sola cookie, **`app_session`**, con `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` **en producciÃ³n** (en local no, porque es `http`) y 30 dÃ­as de vencimiento por defecto (`middleware.ts:47-55`). No hay cookie de refresco ni de estado: el token viaja en esa. 3: `document.cookie` **no** la muestra, que es la forma de comprobar que el `HttpOnly` estÃ¡ puesto. 4: `Salir` apunta a `/auth/logout`, que redirige al Core, borra la cookie y vuelve al login: la sesiÃ³n se cierra **en el Core**, no en el producto. 5: con la cookie anterior guardada, la peticiÃ³n da `401` o el `302` al login, y el producto no monta nada: no queda una segunda copia de la sesiÃ³n que sobreviva al `Salir`. |

| | |
|---|---|
| **ID** | CRM-SIS-04 |
| **Tipo / Prioridad** | SIST / P0 |
| **PrecondiciÃ³n** | SesiÃ³n iniciada, con la expiraciÃ³n del token a la vista. |
| **Pasos** | 1. Anotar el `expires` del token de la sesiÃ³n.<br>2. Dejar que la sesiÃ³n venza (15 minutos por defecto).<br>3. Intentar guardar un cliente.<br>4. Mirar la pantalla y la URL.<br>5. Con `AMG_SSO_INTROSPECT=0`, dar de baja la suscripciÃ³n en el Core e intentar usar el producto. |
| **Esperado** | 3: el `POST /api/customers` responde `401 {"error":"expirada","message":"Tu sesiÃ³n venciÃ³. VolvÃ© a entrar para seguir.","loginUrl":"â€¦"}`, y la pantalla salta al login del Core en lugar de mostrar el error en un `#aviso`: el cliente HTTP compartido detecta el `401` y navega. El formulario no queda a medias con la fila escrita a medias. 4: el `loginUrl` trae el `return_to` de la URL que se estaba mirando, asÃ­ que al volver a entrar se cae en el mismo panel. 5: con `AMG_SSO_INTROSPECT=0` (el default en desarrollo) el producto **no** se entera: la cookie es vÃ¡lida hasta que vence, asÃ­ que una baja de acceso se nota tarde. En producciÃ³n el `docker-compose.yml` pone `AMG_SSO_INTROSPECT=1` y el corte es inmediato. |

| | |
|---|---|
| **ID** | CRM-SIS-05 |
| **Tipo / Prioridad** | SIST / P2 |
| **PrecondiciÃ³n** | `curl` con la cookie. |
| **Pasos** | 1. Mandar 700 peticiones a `/api/customers` en menos de 15 minutos.<br>2. Anotar status, `Retry-After` y `RateLimit` de la peticiÃ³n que se corta.<br>3. Esperar a que pase la ventana y reintentar.<br>4. Con la sesiÃ³n de **otra organizaciÃ³n**, repetir el paso 1 desde la misma IP.<br>5. Pedir `/health` con el cupo agotado. |
| **Esperado** | 1 y 2: al pasar de 600 peticiones en la ventana de 15 minutos, la respuesta es **`429`**, con `Retry-After` en segundos y cabeceras de lÃ­mite en `draft-8`; el `X-RateLimit-*` legacy estÃ¡ desactivado (`app.ts:99-106`). 3: al vencer la ventana, la API vuelve a `200`. 4: el corte es **por IP**, no por organizaciÃ³n: dos organizaciones distintas desde la misma red comparten el mismo cupo de 600. 5: `/health` **tambiÃ©n** pasa por el limitador, asÃ­ que con el cupo agotado devuelve `429` en lugar de `200`: un chequeo de salud se cuenta como llamada normal y puede hacer caer al balanceador (secciÃ³n 7, `R-23`). |

---

## 5. Recorridos E2E

Recorridos completos, de punta a punta, con los datos de la secciÃ³n 2. Son los que hay que hacer
primero: si un recorrido se rompe, casi todos los casos de la secciÃ³n 4 se van a ver afectados.

| | |
|---|---|
| **ID** | CRM-E2E-01 |
| **Tipo / Prioridad** | E2E / P0 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin`, base con los cuatro clientes y los seis seguimientos de la secciÃ³n 2, y `H` anotado. El recorrido crea un cliente, su primer pendiente y su primer contacto, y los tres tienen que aparecer donde corresponde. |
| **Pasos** | 1. `?panel=clientes` â†’ `Nuevo cliente` y cargar los datos de `QA-CRM persona norte`.<br>2. `Guardar`.<br>3. `?panel=seguimientos` â†’ `Nuevo` â†’ `Avisar antes de la visita`, cliente = el reciÃ©n creado, fecha = `H+7`.<br>4. `Guardar`.<br>5. `?panel=contactos` â†’ cliente = el reciÃ©n creado, tipo = `Llamada`, `QuÃ© pasÃ³` = `QA-CRM primera llamada`.<br>6. `Registrar`.<br>7. Volver al tablero y leer las seis tarjetas, las tres bolsas y las dos tarjetas de abajo. |
| **Esperado** | Los tres `POST` responden `201`, con los avisos `Cliente creado`, `Seguimiento creado` y `Contacto registrado`. En el tablero: `Clientes activos` sube a 5, `Pendientes` sube a 1, `Contactos (30 dÃ­as)` sube a 1; el seguimiento aparece en `PrÃ³ximos` con `07/10`â€¦ salvo que `H+7` haya pasado al dÃ­a siguiente por la zona, y el contacto aparece **primero** en `Ãšltimos contactos`. La ficha del cliente nuevo muestra `1 pendiente(s), 0 vencido(s), 1 contacto(s)`. Cada paso se ve en su propio panel y en el tablero sin recargar la pÃ¡gina a mano: `recargar()` vuelve a pedir los datos despuÃ©s de cada escritura. |

| | |
|---|---|
| **ID** | CRM-E2E-02 |
| **Tipo / Prioridad** | E2E / P0 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin` y base con los datos de la secciÃ³n 2. El recorrido recorre el ciclo completo de un pendiente: crearlo vencido, verlo en `Vencidos`, completarlo y reabrirlo. |
| **Pasos** | 1. Crear `Llamar para renovar` para `QA-CRM persona norte` con fecha `H-3`.<br>2. Ir al tablero y confirmar que estÃ¡ en `Vencidos` y que `Vencidos` subiÃ³ a 2.<br>3. En `?panel=seguimientos`, `Marcar hecho`.<br>4. Volver al tablero: leer las tres bolsas y las tarjetas `Pendientes` y `Vencidos`.<br>5. Volver al panel y pulsar `Reabrir`.<br>6. Mirar el tablero otra vez y `GET /api/followups/<id>`. |
| **Esperado** | 1 y 2: el pendiente cae en `Vencidos` porque `dueDate < hoy`. 3: la etiqueta pasa a `Hecho` y el botÃ³n a `Reabrir`. 4: sale de `Vencidos`, `Pendientes` baja 1 y `Vencidos` vuelve a 1. 5: `PATCH {"status":"pending"}`. 6: **vuelve a `Vencidos`**, `Pendientes` sube 1, y `completedAt` queda en **`null`** (se limpiÃ³), no con la hora del cierre anterior. Las cifras del tablero y del panel siempre coinciden porque los dos leen la base; no hay estado en el navegador que pueda quedar viejo. |

| | |
|---|---|
| **ID** | CRM-E2E-03 |
| **Tipo / Prioridad** | E2E / P1 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin` y base con los cuatro clientes, los seis seguimientos y los cinco contactos de la secciÃ³n 2. El recorrido filtra el tablero por cliente y deja ver hasta dÃ³nde llega el filtro. |
| **Pasos** | 1. En el tablero, elegir `QA-CRM persona norte` en `Filtrar por cliente`.<br>2. Leer las tres bolsas y las dos tarjetas de abajo.<br>3. Leer las seis tarjetas de `#resumen`.<br>4. Cambiar a `QA-CRM empresa sur`.<br>5. Volver a `Todos los clientes`. |
| **Esperado** | 1: sale `GET /api/tablero?customerId=<id>` y las bolsas quedan con lo de ese cliente: `QA-CRM persona norte` tiene `Llamar para renovar` (vencido) y `Enviar propuesta` (hoy), asÃ­ que `Vencidos` trae 1 y `Para hoy` trae 1, y `PrÃ³ximos` queda vacÃ­o. 2: **`CumpleaÃ±os del mes` y `Ãšltimos contactos` no se filtran**: siguen mostrando los de toda la organizaciÃ³n, aunque el filtro diga Â«Filtrar por clienteÂ» y no Â«Filtrar los seguimientosÂ» (secciÃ³n 7, `R-05`). 3: las seis tarjetas tampoco cambian. 4: `QA-CRM empresa sur` muestra `Confirmar visita` en `PrÃ³ximos` y nada en `Vencidos` ni `Para hoy` (su `Cobrar factura` estÃ¡ `Hecho`). 5: al volver a `Todos los clientes`, sale `GET /api/tablero` sin `customerId` y las bolsas se rellenan con los **cuatro** pendientes de la secciÃ³n 2; `Recordar sin fecha` tampoco sale en ninguna bolsa porque no tiene fecha, aunque cuente en la tarjeta `Pendientes` (secciÃ³n 7, `R-11`). |

| | |
|---|---|
| **ID** | CRM-E2E-04 |
| **Tipo / Prioridad** | E2E / P0 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin`, base con los datos de la secciÃ³n 2 y `curl` con la cookie. El recorrido archiva un cliente y audita **todo** lo que queda visible de Ã©l. |
| **Pasos** | 1. Crear `QA-CRM para archivar` con un pendiente vencido, un pendiente para hoy y un contacto.<br>2. Confirmar que aparece en la tabla de clientes, en `Vencidos`, en `Para hoy` y en `Ãšltimos contactos`.<br>3. `Archivar` en su fila.<br>4. Revisar, uno por uno: la tabla de clientes, las seis tarjetas, las tres bolsas, `CumpleaÃ±os del mes`, `Ãšltimos contactos`, `GET /api/resumen`, `GET /api/followups`, `GET /api/interactions`.<br>5. Con `curl`, `GET /api/customers/<id>/ficha` y `GET /api/customers?q=QA-CRM para archivar`. |
| **Esperado** | 3: `DELETE` `200 {"ok":true,"archived":true}`, la fila desaparece de la tabla, `Clientes activos` baja 1, `Archivados` sube 1, aviso `Cliente archivado`, y **sin confirmaciÃ³n previa** (`R-03`). 4: el cliente **sigue apareciendo** en `Vencidos`, en `Para hoy` y en `Ãšltimos contactos`, con su nombre al lado; `seguimientos.total` y `contactos30d` **no** bajan; y ya **no** se puede elegir en los desplegables de seguimiento ni de contacto (secciÃ³n 7, `R-04`). 5: la ficha responde `200` con los datos del cliente archivado, y la bÃºsqueda por `q` **no** lo encuentra. O sea: estÃ¡ archivado en un sentido y vivo en el otro, y no hay forma de dar de baja. |

| | |
|---|---|
| **ID** | CRM-E2E-05 |
| **Tipo / Prioridad** | E2E / P0 |
| **PrecondiciÃ³n** | Dos sesiones de la **misma** organizaciÃ³n, una `member` y otra `admin`, con los datos de la secciÃ³n 2 en la base. El recorrido repite las mismas acciones con los dos roles. |
| **Pasos** | 1. Entrar como `member`.<br>2. Crear un cliente, un seguimiento y un contacto; marcar un seguimiento hecho; cambiar la zona horaria en Ajustes.<br>3. Intentar archivar un cliente y, por API, borrar un seguimiento.<br>4. Salir y entrar como `admin`.<br>5. Repetir los intentos del paso 3. |
| **Esperado** | 2: las cuatro escrituras de pantalla que son de `member` funcionan: `Cliente creado`, `Seguimiento creado`, `Contacto registrado`, y `Marcar hecho` sin mensaje de error. El `PUT /api/settings` responde `403 rol-insuficiente` y el formulario de Ajustes **no** dice que no se pudo guardar salvo el aviso rojo (`R-22`). 3: el botÃ³n `Archivar` de la tabla de clientes responde `403` y el cliente sigue en la lista; por API, `DELETE /api/followups/<id>` responde `403` para `member`. 5: como `admin`, los dos funcionan: el cliente queda archivado y el seguimiento desaparece de verdad. La diferencia entre los dos roles estÃ¡ **solo** en el servidor: la pantalla se ve exactamente igual (`R-01`). |

| | |
|---|---|
| **ID** | CRM-E2E-06 |
| **Tipo / Prioridad** | E2E / P1 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin`, base con los datos de la secciÃ³n 2 y el `timezone` de Ajustes anotado. El recorrido cambia el dÃ­a de la empresa y anota quÃ© se mueve. |
| **Pasos** | 1. Como `admin`, anotar `hoy` de `GET /api/tablero`.<br>2. Poner la zona horaria a una que va horas adelante y `Guardar ajustes`.<br>3. Volver al tablero y leer `hoy`, las tres bolsas y las tarjetas `Pendientes`, `Vencidos`, `Para hoy`.<br>4. Devolver la zona a `America/Santiago`.<br>5. Anotar si algÃºn dato quedÃ³ desactualizado. |
| **Esperado** | 3: `hoy` avanza un dÃ­a y los seguimientos de Â«hoyÂ» pasan a `Vencidos`; los de `H+1` pasan a Â«Para hoyÂ». `Pendientes` **no** se mueve, porque cuenta estados y no fechas: el tablero queda con `Vencidos` y `Para hoy` mÃ¡s altos y los mismos pendientes. NingÃºn dato se corrompe: cambiar la zona no toca ninguna fila, solo cambia quÃ© dÃ­a se considera hoy. 5: al volver a la zona original, `hoy` vuelve y las bolsas se reorganizan solas en el siguiente render, porque cada entrada al tablero vuelve a pedir `/api/tablero`. |

---
## 6. RegresiÃ³n compartida

Lo que este producto usa del runtime y de las nueve pantallas comunes. Un fallo acÃ¡ rompe el
CRM, pero tambiÃ©n los otros ocho productos: por eso los casos son de **una** comprobaciÃ³n y se
repiten con el mismo resultado en los planes de Inventario y Activos.

| | |
|---|---|
| **ID** | CRM-REG-01 |
| **Tipo / Prioridad** | REG / P0 |
| **PrecondiciÃ³n** | SesiÃ³n iniciada y base con los datos de la secciÃ³n 2. El caso recorre el canal lateral y los cinco paneles, incluido un `?panel=` que no existe. |
| **Pasos** | 1. Abrir `/`.<br>2. Recorrer los cinco enlaces de `?panel=` y volver al tablero.<br>3. Abrir `/?panel=inventario`. |
| **Esperado** | El canal tiene **5** entradas en **3** grupos: `Cartera` (Tablero, Clientes), `Seguimiento` (Seguimientos, Contactos) y `ConfiguraciÃ³n` (Ajustes). Solo el panel activo queda marcado (`aria-current="page"`). El tÃ­tulo de la barra superior cambia con el panel (`Tablero`, `Clientes`, `Seguimientos`, `Contactos`, `Ajustes`) y la URL queda en `?panel=â€¦`. 3: un panel que no existe **cae en `tablero`**, sin error y sin pantalla en blanco. El pie del canal trae el avatar, el nombre, el correo y `Salir`. |

| | |
|---|---|
| **ID** | CRM-REG-02 |
| **Tipo / Prioridad** | REG / P0 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin`, base con los datos de la secciÃ³n 2 y al menos un cliente y un seguimiento para abrir la ediciÃ³n. El caso recorre los tres formularios y su cancelaciÃ³n. |
| **Pasos** | 1. Abrir cada formulario en modo alta.<br>2. Comprobar `Cancelar` en los tres.<br>3. Abrir cada formulario en modo ediciÃ³n y comprobar `Cancelar`.<br>4. Buscar el `hidden` de `#cliente-cancelar` y `#seguimiento-cancelar` en el inspector. |
| **Esperado** | En alta, los formularios de cliente y de seguimiento muestran `Cancelar` **oculto** (`hidden`), porque no hay nada que cancelar; el de contactos no tiene ese botÃ³n. En ediciÃ³n los dos aparecen y, al pulsarlos, vacÃ­an el formulario y vuelven al tÃ­tulo de alta (`Nuevo cliente`, `Nuevo seguimiento`) sin preguntar nada al servidor. Los tres formularios usan `e.preventDefault()`, asÃ­ que ninguno recarga la pÃ¡gina. Los `label` apuntan con `for` a su `input`, y los campos requeridos (`Nombre`, `QuÃ© hay que hacer`, `Cliente`, `QuÃ© pasÃ³`) estÃ¡n marcados como tales. |

| | |
|---|---|
| **ID** | CRM-REG-03 |
| **Tipo / Prioridad** | REG / P0 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin` y, en paralelo, una sesiÃ³n `member` y otra que se pueda dejar vencer. El caso comprueba cÃ³mo se muestran los errores. |
| **Pasos** | 1. Provocar un `400` de validaciÃ³n desde el formulario (por ejemplo, un correo invÃ¡lido escrito por `curl` y reenviado desde la consola).<br>2. Provocar un `403` con un `member`.<br>3. Provocar un `404` con un cliente inexistente.<br>4. Provocar un `401` dejando vencer la sesiÃ³n.<br>5. Mirar `#aviso` en los cuatro casos. |
| **Esperado** | Hay **un solo** contenedor de avisos (`#aviso.ui-aviso`), no uno por panel, y siempre con el mismo formato: el texto del error en el `#aviso` y el color segÃºn el tipo (verde el Ã©xito, rojo el error). El cliente HTTP compartido arma el mensaje de un `Datos invÃ¡lidos` juntando los mensajes de campo con ` Â· ` y pone el nombre del campo adelante (`email: Correo invalido`). Un `401` **no** se pinta en el `#aviso`: el cliente detecta el cÃ³digo y navega al `loginUrl` del cuerpo. NingÃºn error muestra una traza ni un texto interno del servidor. |

| | |
|---|---|
| **ID** | CRM-REG-04 |
| **Tipo / Prioridad** | REG / P1 |
| **PrecondiciÃ³n** | El producto serviÃ©ndose como en despliegue (`NODE_ENV=production`), porque en desarrollo los TTL de cachÃ© son 0. El caso revisa las cabeceras de la pÃ¡gina y de sus recursos. |
| **Pasos** | 1. Pedir `/` y mirar `Cache-Control`, `X-Powered-By` y `Content-Security-Policy`.<br>2. Pedir `/app.js` sin `?v=` y con `?v=1`.<br>3. Pedir `/favicon.ico`.<br>4. Pedir `/index.html?v=abc123`.<br>5. Mandar un cuerpo de 2 MB a `/api/customers`. |
| **Esperado** | 1: `Cache-Control: no-cache` en el HTML (que se sirve **sin sesiÃ³n** o con `302`, nunca cacheado con datos), y **sin** `X-Powered-By`. La CSP viene **deshabilitada** en el runtime (`app.ts:95`), asÃ­ que no hay que esperar un `default-src` que rompa los scripts del shell. 2: los recursos versionados (`/app.js?v=â€¦`, `/style.css?v=â€¦`, `/amigo-ui.js?v=â€¦`) salen con `public, max-age=31536000, immutable` y **tambiÃ©n sin `?v=`**: el `setHeaders` se aplica a la carpeta entera, asÃ­ que el `immutable` no distingue la URL con huella de la que no la tiene (secciÃ³n 7, `R-24`). En desarrollo el TTL es 0 y solo sale `public, max-age=0`. 3: `/favicon.ico` es **pÃºblico** (`publicPaths` por defecto en `auth.ts:111`), asÃ­ que sin sesiÃ³n no redirige: `404` con el mensaje `No existe GET /favicon.ico`, porque el producto no declara favicon; el error tampoco rompe la pÃ¡gina. 4: el HTML es el mismo, con el `?v=` ignorado. 5: `413 La peticiÃ³n es demasiado grande` (lÃ­mite de 1 MB). |

| | |
|---|---|
| **ID** | CRM-REG-05 |
| **Tipo / Prioridad** | REG / P1 |
| **PrecondiciÃ³n** | SesiÃ³n iniciada y base con datos suficientes para que las rejillas y las tablas se llenen. El caso revisa la pantalla en las cuatro anchuras. |
| **Pasos** | 1. Mirar la pantalla a 1280 px.<br>2. Bajar a 900 px.<br>3. Bajar a 560 px.<br>4. Bajar a 390 px.<br>5. Con el teclado, recorrer los botones y leer los textos pequeÃ±os. |
| **Esperado** | 1: el canal lateral y el contenido van en dos columnas. 2: por debajo de 900 px el shell pasa a **una** columna y el canal queda arriba; las rejillas de 2, 3 y 4 columnas dejan de ser columnas fijas porque son `flex-wrap`, asÃ­ que las seis tarjetas del resumen **se reparten en varias filas** en vez de dejar huecos (a 1280 px caben en una fila: `flex: 1 1 9rem`). 3: por debajo de 560 px los formularios de dos columnas (`#cliente-form`, `#config-form`) pasan a una columna y las parejas de campos se apilan. 4: las tablas no se parten: van dentro de `.ui-tabla-caja > .ui-tabla-scroll` con `overflow-x: auto`, asÃ­ que el scroll es **de la tabla**, la barra del navegador no se mueve y el canal ni el tÃ­tulo se desplazan. 5: el foco es visible, los botones se alcanzan con `Tab` y las etiquetas de estado (`Pendiente`, `Hecho`, `Cancelado`) se distinguen sin depender solo del color. Con `prefers-reduced-motion` no hay transiciones. |

| | |
|---|---|
| **ID** | CRM-REG-06 |
| **Tipo / Prioridad** | REG / P1 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin`, base con los datos de la secciÃ³n 2 y, en una segunda vuelta, una organizaciÃ³n limpia sin filas. El caso revisa los textos de listas vacÃ­as y los guiones de los datos faltantes. |
| **Pasos** | 1. En una organizaciÃ³n limpia, abrir cada panel.<br>2. Escribir algo que no coincida en `#cliente-buscar`.<br>3. Con datos, abrir la ficha de un cliente sin telÃ©fono, sin correo y sin ciudad.<br>4. Filtrar `#seguimiento-cliente` por un cliente sin seguimientos.<br>5. Buscar `â€”` en el cÃ³digo fuente de la pantalla. |
| **Esperado** | Cada lista vacÃ­a tiene **su propio** texto y ninguno se repite por accidente: las cinco listas del tablero usan `Nada por acÃ¡`, la tabla de clientes usa `No hay clientes que coincidan`, la de seguimientos `No hay seguimientos`, la de contactos del panel `No hay contactos registrados`, y dentro de la ficha `Sin seguimientos` y `Sin contactos registrados`. Un dato faltante se muestra como **guion largo** `â€”` en las tablas (`c.phone ?? 'â€”'`), pero en la ficha el par se **omite** (`Sin telÃ©fono` y `Sin correo` solo aparecen si el campo no trae nada, y `DirecciÃ³n`, `Ciudad`, `Etiquetas` y `Notas` desaparecen de la lista). NingÃºn campo vacÃ­o se muestra como texto en blanco ni como `null`. |

| | |
|---|---|
| **ID** | CRM-REG-07 |
| **Tipo / Prioridad** | REG / P0 |
| **PrecondiciÃ³n** | SesiÃ³n de `admin`, los datos de la secciÃ³n 2 cargados y una segunda organizaciÃ³n con suscripciÃ³n. El caso revisa identidad, aislamiento y carga inicial. |
| **Pasos** | 1. Recargar `/` con **Preservar log** y contar las peticiones.<br>2. Entrar por el Core y volver a cargar.<br>3. Comparar `organizationId` en `/api/inicio` y en `/api/settings`.<br>4. Con la sesiÃ³n de otra organizaciÃ³n, pedir un `id` de esta.<br>5. Pulsar `Salir` y volver a entrar. |
| **Esperado** | 1: **7** peticiones: `/api/inicio`, `/api/resumen` Ã—2, `/api/tablero` Ã—2, `/api/customers?limit=500`, `/api/settings`. Todas de la misma organizaciÃ³n. 3: los dos `organizationId` son el mismo, y ninguno de los dos se puede cambiar desde la pantalla. 4: `404`, nunca datos ajenos ni `403`. 5: la sesiÃ³n se cierra en el Core y al volver a entrar `/` se sirve de nuevo con los datos de la sesiÃ³n nueva, sin cachÃ© del navegador: el HTML no trae datos y `Cache-Control: no-cache` obliga a pedirlo otra vez. |

---
## 7. Riesgo conocido

Defectos y trampas **sospechados en el cÃ³digo**, no ejecutados. Cada uno dice dÃ³nde mirar y cÃ³mo
confirmarlo en el navegador o en Network. Todos estÃ¡n `POR CONFIRMAR` en la secciÃ³n 9.

| Riesgo | DÃ³nde | CÃ³mo se confirma | Severidad |
|---|---|---|---|
| **R-01** El botÃ³n `Archivar` se le muestra a cualquiera, incluido un `member`. La pantalla no consulta el rol en ningÃºn momento: `GET /api/inicio` sÃ­ lo devuelve, y `app.js` no lo usa para nada. La garantÃ­a real es el `deleteRole: 'admin'` del `crudRouter`, asÃ­ que el `403` existe, pero un `member` ve tres botones por fila (`Ficha`, `Editar`, `Archivar`) y descubre el `403` al pulsarlo. Lo mismo pasa con el formulario de Ajustes, que se ve editable y guarda con `403` (ver `R-22`). | `products/crm/public/app.js:218`, `products/crm/src/routes.ts:675`, `products/crm/src/routes.ts:519`, `packages/product-runtime/src/crud.ts:184` | Entrar con sesiÃ³n `member`, abrir `?panel=clientes` y contar los botones de la celda de acciones: si `Archivar` estÃ¡ a la vista, estÃ¡ confirmado. Pulsarlo y leer el `403 {"error":"rol-insuficiente","necesario":"admin","actual":"member"}`. Contrastar con `CRM-CLI-10` y `CRM-E2E-05`. | Media |
| **R-02** Archivar un cliente es una puerta de ida: no hay forma de **desarchivar** ni de **listar** los archivados. `archivedAt` es de solo lectura, asÃ­ que el `PATCH` que lo limpiarÃ­a da `400 Campo desconocido`, y el `GET` filtra siempre por `archived_at IS NULL`. Si el archivado fue un error (un cliente dado de baja por un `DELETE` sin querer), la Ãºnica salida es entrar a la base. | `packages/product-runtime/src/crud.ts:199-203`, `packages/product-runtime/src/crud.ts:309-318`, `packages/product-runtime/src/crud.ts:139-150`, `products/crm/src/routes.ts:690` | Archivar un cliente y despuÃ©s `GET /api/customers/<id>`: si responde `200` con `archivedAt` con valor, y `GET /api/customers` no lo lista, estÃ¡ confirmado. Luego `PATCH` con `{"archivedAt":null}` y leer el `400`. Buscar en el producto si hay algÃºn `?` o filtro de archivados: no hay ninguno. Contrastar con `CRM-API-04`. | Alta |
| **R-03** Las acciones que borran o archivan **no piden confirmaciÃ³n**. `Archivar` (cliente), `Marcar hecho` y `Reabrir` (seguimiento) van directo al servidor. No hay `confirm()` en ninguna parte de `app.js`. Con un clic torpe se archiva un cliente o se completa un pendiente sin querer, y en el caso de `Archivar` no hay vuelta atrÃ¡s (ver `R-02`). | `products/crm/public/app.js:218-230`, `products/crm/public/app.js:430-443`, `products/crm/public/app.js:512-518` | Buscar `confirm(` en `app.js`: no aparece. DespuÃ©s, con el cliente de prueba, pulsar `Archivar` una vez y ver que en Network sale el `DELETE` sin que aparezca nada en pantalla. Contrastar con `CRM-CLI-09` y `CRM-SEG-05`. | Media |
| **R-04** **Archivar un cliente no esconde sus seguimientos ni su historial de contacto**, ni baja los contadores del resumen. Solo se esconde en la lista de clientes y de los cumpleaÃ±os del mes. El resultado es un cliente Â«dado de bajaÂ» que sigue apareciendo con nombre y todo en las bolsas del tablero y en `Ãšltimos contactos`, y que sigue sumando en `Pendientes` y `Contactos (30 dÃ­as)`. Los desplegables de seguimiento y de contacto, en cambio, sÃ­ dejan de ofrecerlo, porque se llenan con la lista de clientes ya sin archivados. | `products/crm/src/routes.ts:200-203`, `products/crm/src/routes.ts:229`, `products/crm/src/routes.ts:245`, `products/crm/src/routes.ts:315-321`, `products/crm/public/app.js:42-44` | Crear un cliente con un pendiente y un contacto, archivarlo, y comparar `GET /api/resumen` y `GET /api/tablero` antes y despuÃ©s: si `seguimientos.total` y `contactos30d` no bajan y el pendiente sigue en `vencidos`, estÃ¡ confirmado. Y abrir `#seguimiento-cliente` para ver que ya no estÃ¡. Contrastar con `CRM-E2E-04`. | Alta |
| **R-05** El filtro Â«Filtrar por clienteÂ» del tablero **solo filtra los seguimientos**. Se manda `customerId` a `/api/tablero`, y esa ruta lo aplica a la consulta de pendientes, pero los cumpleaÃ±os y los contactos recientes se consultan sin ese filtro. El rÃ³tulo promete un filtro y la pantalla cumple la mitad: dos tarjetas cambian y dos no. | `products/crm/src/routes.ts:201-203`, `products/crm/src/routes.ts:223-248`, `products/crm/public/app.js:109-113` | Elegir un cliente en `#tablero-cliente` y mirar las cinco listas: si las bolsas cambian y `CumpleaÃ±os del mes` y `Ãšltimos contactos` muestran lo mismo que sin filtro, estÃ¡ confirmado. Contrastar con `CRM-TAB-05` y `CRM-E2E-03`. | Media |
| **R-06** `#nuevo-cliente` (el botÃ³n de la barra superior, visible en los cinco paneles) salta al panel de clientes **sin actualizar la URL**. El shell cambia el panel visible y el `?panel=` de la barra de direcciones, pero este botÃ³n llama al renderizador del panel directamente. DespuÃ©s de un Â«recargarÂ» la persona vuelve al panel anterior y pierde el formulario a medio llenar. | `products/crm/public/app.js:598-601`, `packages/product-runtime/public/amigo.js:123-127` | Pulsar `Nuevo cliente` desde `?panel=tablero` y mirar la barra de direcciones: si sigue en `?panel=tablero` con el panel de clientes a la vista, estÃ¡ confirmado. DespuÃ©s pulsar `F5`. Contrastar con `CRM-CLI-04`. | Baja |
| **R-07** El filtro por tipo de ficha **existe en la API y no en la pantalla**. El `crudRouter` declara `kind` como filtro con su enum, asÃ­ que `?kind=empresa` funciona, pero el desplegable de tipo estÃ¡ solo en el formulario de alta y no hay forma de listar Â«solo empresasÂ» ni Â«solo personasÂ». Quien migra datos o arma un reporte tiene que filtrar por API. | `products/crm/src/routes.ts:670`, `products/crm/public/index.html:136-141`, `packages/product-runtime/src/crud.ts:212-226` | `GET /api/customers?kind=empresa` y contar: si devuelve solo empresas, la API lo soporta. DespuÃ©s revisar los paneles: no hay ningÃºn control que lo ponga en la URL. Contrastar con `CRM-API-02`. | Baja |
| **R-08** La bÃºsqueda de la pantalla y el `?q=` de la API **no buscan lo mismo**. La pantalla busca en nombre, razÃ³n social, telÃ©fono, correo, documento **y ciudad**; la API busca en nombre, razÃ³n social, telÃ©fono, correo y documento, y **no** en ciudad ni en etiquetas. Y con `%` o `_` los dos se separan: la pantalla compara con `includes` (carÃ¡cter literal) y la API mete el texto en un `LIKE` sin escapar (comodÃ­n). Un `q=%` devuelve la tabla entera; en pantalla devuelve cero resultados. | `products/crm/src/routes.ts:667`, `products/crm/public/app.js:190`, `packages/product-runtime/src/crud.ts:205-210` | Escribir `Lima` en `#cliente-buscar`: aparece `QA-CRM empresa andina`. DespuÃ©s `GET /api/customers?q=Lima`: devuelve `items: []`. Y `GET /api/customers?q=%` devuelve todos mientras la pantalla con `%` dice Â«No hay clientes que coincidanÂ». Contrastar con `CRM-CLI-03` y `CRM-API-01`. | Media |
| **R-09** No hay paginaciÃ³n en ninguna lista, y el lÃ­mite se puede eludir. La pantalla carga hasta **500** clientes, **300** seguimientos y **300** contactos, sin paginar y sin avisar que hay mÃ¡s; en el tablero el servidor corta los pendientes en 200. AdemÃ¡s, el `crudRouter` calcula `Math.min(Number(limit) \|\| 200, 1000)`, asÃ­ que `?limit=-1` pasa el recorte y SQLite lo lee como Â«sin lÃ­miteÂ». Y un parÃ¡metro que el producto **no** declara como filtro (por ejemplo `?status=activo` en clientes) se ignora en silencio en vez de dar `400`. | `packages/product-runtime/src/crud.ts:228`, `packages/product-runtime/src/crud.ts:212-226`, `products/crm/public/app.js:38`, `products/crm/public/app.js:409`, `products/crm/src/routes.ts:209` | `GET /api/customers?limit=-1` y contar las filas: si vienen todas, el recorte estÃ¡ eludido. `GET /api/customers?status=activo`: si devuelve `200` con todo, el parÃ¡metro se ignora. Y en la pantalla, cargar mÃ¡s de 500 clientes y ver que la lista se corta sin ningÃºn aviso. Contrastar con `CRM-API-01` y `CRM-API-02`. | Media |
| **R-10** La ficha del cliente **no tiene direcciÃ³n propia**: no hay `?panel=ficha` ni `?id=`, y abrirla no cambia la URL. No se puede compartir por enlace, no se puede guardar en marcadores y un `F5` la cierra. Para volver a verla hay que ir a la lista y volver a pulsar `Ficha`. | `products/crm/public/app.js:226`, `products/crm/public/app.js:603-609`, `packages/product-runtime/public/amigo.js:123-127` | Abrir una ficha y mirar la barra de direcciones: si sigue en `?panel=clientes` sin ningÃºn identificador, estÃ¡ confirmado. Luego copiar la URL en otra pestaÃ±a: abre el panel de clientes, no la ficha. Contrastar con `CRM-FIC-01`. | Baja |
| **R-11** Un pendiente **sin fecha no aparece en ninguna bolsa** del tablero, pero **sÃ­** cuenta en el KPI `Pendientes`. Las tres bolsas se arman comparando `dueDate` contra `hoy`, asÃ­ que un `pending` con `dueDate` nulo no es vencido, no es de hoy y no es prÃ³ximo; el resumen, en cambio, cuenta los `pending` sin mirar la fecha. El resultado es un tablero que dice Â«4 pendientesÂ» y no muestra dÃ³nde estÃ¡n tres de ellos. | `products/crm/src/routes.ts:215-218`, `products/crm/src/routes.ts:318-319` | Crear un pendiente sin fecha y comparar `GET /api/resumen.seguimientos.porEstado.pending` con las tres listas de `GET /api/tablero`: si el nÃºmero es 1 y las listas no lo muestran, estÃ¡ confirmado. Contrastar con `CRM-TAB-02`. | Media |
| **R-12** Los seguimientos **sin fecha salen primero** en la lista, porque el `ORDER BY due_date ASC` de SQLite ordena los `NULL` antes que todo. La lista parece ordenada por urgencia y en realidad arranca con las tareas sin fecha. Y la ficha los ordena al revÃ©s (`dueDate` descendente), asÃ­ que el mismo seguimiento aparece en posiciones opuestas segÃºn dÃ³nde se mire. | `products/crm/src/routes.ts:404`, `products/crm/src/routes.ts:351` | Crear dos seguimientos, uno con fecha y otro sin ella, y mirar el orden de `?panel=seguimientos` (el sin fecha primero) y de la ficha del cliente (el sin fecha Ãºltimo). Si coinciden, estÃ¡ confirmado. Contrastar con `CRM-SEG-02` y `CRM-FIC-02`. | Baja |
| **R-13** La ficha del cliente **no muestra la razÃ³n social, el tipo de ficha ni el documento**, aunque los tres se guardan y el listado sÃ­ enseÃ±a el documento debajo del nombre. Para una empresa, la ficha es un `<dl>` con telÃ©fono y correo: no dice ni el nombre legal ni el RUT/RUC. | `products/crm/public/app.js:318-324`, `products/crm/public/app.js:206`, `products/crm/src/routes.ts:678-684` | Abrir la ficha de `QA-CRM empresa sur` y buscar `QA-CRM Servicios Sur SpA`, `76.543.210-9` y `Empresa`: no aparecen en el `<dl>`, aunque los tres estÃ©n en la fila de la lista. Contrastar con `CRM-FIC-01`. | Media |
| **R-14** El historial de contacto **solo se agrega y se lee**: no hay `PATCH`, no hay `DELETE`, y en la pantalla tampoco hay botÃ³n de editar ni de borrar. Es una decisiÃ³n de diseÃ±o documentada en el cÃ³digo, pero tiene dos consecuencias que conviene tener presentes: **no se puede anotar la hora a mano** (la pantalla no manda `happenedAt`; el instante lo pone el servidor), y **no se puede corregir** una fila equivocada mÃ¡s que agregando otra, que queda al lado para siempre. Tampoco hay deduplicaciÃ³n: el mismo texto repetido queda dos veces. | `products/crm/src/routes.ts:534-543`, `products/crm/src/routes.ts:544`, `products/crm/src/routes.ts:567`, `products/crm/public/app.js:516-517` | Buscar botones de editar o borrar contactos en el panel y en la ficha: no hay ninguno. DespuÃ©s `PATCH /api/interactions/<id>` y `DELETE /api/interactions/<id>`: si ambos responden `404 No existe â€¦` y no `403`, la ruta no estÃ¡ declarada. Contrastar con `CRM-CON-04` y `CRM-CON-05`. | Baja |
| **R-15** `Marcar hecho` y `Reabrir` son el mismo botÃ³n con dos textos, y **pierden la hora del cierre anterior**: al reabrir, `completedAt` se limpia a `null`, asÃ­ que volver a marcarlo hecho guarda una hora nueva. Si alguien completÃ³ un pendiente a las 10:00, lo reabriÃ³ a las 11:00 y lo volviÃ³ a completar a las 15:00, el registro dice 15:00 y no 10:00. AdemÃ¡s el `PATCH` manda solo `{"status":â€¦}`, sin la fecha de vencimiento: marcar hecho **no** borra el `dueDate`, asÃ­ que un pendiente `Hecho` sigue con su fecha vencida en la base. | `products/crm/public/app.js:430-443`, `products/crm/src/routes.ts:435-438`, `products/crm/src/routes.ts:500` | Marcar un pendiente hecho, leer `completedAt`, reabrirlo y volverlo a marcar: si `completedAt` es `null` despuÃ©s de reabrir y una hora nueva despuÃ©s de volver a marcar, estÃ¡ confirmado. Y ver que `dueDate` sigue puesto. Contrastar con `CRM-SEG-05` y `CRM-SEG-06`. | Media |
| **R-16** Los schemas de seguimientos y contactos **no son estrictos**: las claves que no conoce se **descartan en silencio**. Mandar `organizationId`, `id` o `completedAt` en un `POST /api/followups` devuelve `201` y se ignora lo enviado, sin error ni aviso. Es distinto del `crudRouter` de clientes, que sÃ­ usa `.strict()` y responde `400 Campo desconocido`. Quien migra datos o arma un script tiene que saber que el cuerpo se reescribe sin avisar. | `products/crm/src/routes.ts:136-142`, `products/crm/src/routes.ts:144-150`, `packages/product-runtime/src/crud.ts:148`, `packages/product-runtime/src/crud.ts:271` | `POST /api/followups` con `organizationId`, `id` y `completedAt` en el cuerpo: si responde `201` y la fila devuelta trae el `organizationId` de la sesiÃ³n, el `id` del servidor y el `completedAt` calculado, estÃ¡ confirmado. El mismo `POST` contra `/api/customers` da `400`. Contrastar con `CRM-API-05` y `CRM-API-09`. | Media |
| **R-17** Los instantes se pintan en la **zona horaria del navegador** y el Â«hoyÂ» en la de la **organizaciÃ³n**. Los contactos usan `AMIGO_UI.fecha(iso, true)` sin zona, que convierte con la del navegador; el `hoy` del tablero lo calcula el servidor con la zona de los ajustes. Con el navegador en otra zona, un contacto puede verse con un dÃ­a distinto al que lo cuenta el resumen, y la fecha que se ve cambia al cambiar la zona del equipo sin que se toque nada en el servidor. | `products/crm/public/app.js:80`, `packages/product-runtime/public/amigo-ui.js:68-79`, `products/crm/src/routes.ts:119-134` | Registrar un contacto, anotar su `happenedAt` crudo y la hora que muestra la pantalla. DespuÃ©s cambiar la zona del navegador y recargar: si la hora se mueve y el dato crudo no, estÃ¡ confirmado. Contrastar con `CRM-CON-03` y `CRM-AJU-03`. | Baja |
| **R-18** La API soporta filtros y acciones que **la pantalla no ofrece**: `?status=` y `?kind=` en seguimientos, `?kind=` y `?customerId=` en contactos, y el `DELETE /api/followups/:id` (de `admin`) no tiene ningÃºn botÃ³n. El panel de seguimientos no tiene buscador, ni filtro por estado, ni filtro por rango de fechas, y el de contactos no tiene nada de filtrado, aunque el API los tenga. El filtro por cliente que sÃ­ existe no va en la URL. | `products/crm/src/routes.ts:393-397`, `products/crm/src/routes.ts:549-554`, `products/crm/src/routes.ts:517`, `products/crm/public/index.html:191-238` | Abrir `?panel=seguimientos` y contar los controles de filtrado: si no hay buscador ni select de estado ni de fecha, estÃ¡ confirmado. DespuÃ©s `GET /api/followups?status=done`: si la API devuelve la lista filtrada, el filtro existe y la pantalla no lo usa. Y buscar un botÃ³n de borrar seguimiento: no hay ninguno, aunque la ruta exista. Contrastar con `CRM-SEG-07` y `CRM-SEG-09`. | Media |
| **R-19** El tablero **se pinta con los datos que ya tiene el navegador**: la carga inicial pide `/api/resumen` y `/api/tablero` una vez cada una, y despuÃ©s cada escritura llama a `recargar()`, que las pide **otra vez**. Son 7 peticiones para abrir la pÃ¡gina, dos de ellas repetidas siempre, y entre la primera y la segunda hay una ventana en la que las tarjetas y las bolsas pueden no cuadrar entre sÃ­. El filtro por cliente del tablero solo se aplica al repintado, sin recargar el resumen, asÃ­ que las tarjetas de arriba nunca cambian con el filtro. | `products/crm/public/app.js:108-113`, `products/crm/public/app.js:553-558`, `products/crm/src/routes.ts:193`, `products/crm/src/routes.ts:286` | Recargar `/` con **Preservar log** y contar: si aparecen dos `/api/resumen` y dos `/api/tablero`, estÃ¡ confirmado. DespuÃ©s cambiar el filtro de cliente y ver que no sale ninguna peticiÃ³n para `/api/resumen`. Contrastar con `CRM-SIS-02` y `CRM-TAB-01`. | Baja |
| **R-20** El `.env.example` estÃ¡ **internamente inconsistente**: `PORT=3020` pero `APP_URL=http://localhost:3023`, que es el puerto de Inventario. Con el `APP_URL` equivocado, el `return_to` del login y los enlaces que arma el shell apuntan al producto equivocado, y el sÃ­ntoma aparece al iniciar sesiÃ³n, no al arrancar. | `products/crm/.env.example:5`, `products/crm/.env.example:14`, `products/inventario/.env.example:14` | Copiar el archivo a `.env`, entrar por el SSO y mirar la URL a la que vuelve: si es `:3023` en lugar de `:3020`, estÃ¡ confirmado. En Docker no aparece, porque ahÃ­ el `APP_URL` viene del `docker-compose.yml`. | Media |
| **R-21** El ajuste `currency` **no hace nada** en este producto. El CRM no tiene un solo importe (el precio de un trabajo es de `citas` y el de una propuesta es de `cotizaciones`), asÃ­ que guardar `MXN` no cambia ni un nÃºmero de ninguna pantalla; el propio `schema.ts` lo dice en su comentario. Es un campo heredado del legacy que se guarda y se muestra, y que puede dar la impresiÃ³n de que el producto maneja dinero. | `products/crm/src/routes.ts:618`, `products/crm/public/index.html:291-293`, `products/crm/src/schema.ts:27-31`, `products/crm/src/routes.ts:98` | Cambiar la moneda a `MXN`, guardar y recorrer las seis tarjetas, las bolsas, la ficha y las tres tablas: si no aparece ningÃºn sÃ­mbolo ni ninguna cantidad con esa moneda, estÃ¡ confirmado. Contrastar con `CRM-AJU-02`. | Baja |
| **R-22** El formulario de Ajustes se ve **igual para `member` que para `admin`**, con los dos campos editables y `Guardar ajustes` activo, aunque el `PUT` exige `admin`. Un `member` escribe, apretas guardar y recibe un `403` en rojo; y el campo **conserva lo que escribiÃ³**, asÃ­ que la pantalla queda mostrando un valor que no estÃ¡ guardado. La zona horaria es lo que mÃ¡s muerde: el `member` ve Â«suÂ» formulario con la fecha del negocio cambiada. | `products/crm/public/index.html:285-302`, `products/crm/public/app.js:560-576`, `products/crm/src/routes.ts:611-613` | Entrar con sesiÃ³n `member`, abrir `?panel=ajustes`, escribir una zona distinta y guardar: si los campos aceptan escritura y el `PUT` responde `403`, estÃ¡ confirmado. Recargar despuÃ©s y ver que el valor guardado es el viejo. Contrastar con `CRM-AJU-04`. | Media |
| **R-23** El limitador de peticiones estÃ¡ montado **antes que `/health`**, asÃ­ que el chequeo de salud del producto tambiÃ©n consume cupo: con las 600 peticiones de 15 minutos agotadas, `/health` devuelve `429` en lugar de `200`. Un balanceador que use `/health` como sonda puede sacar el contenedor de rotaciÃ³n por una rÃ¡faga de la propia aplicaciÃ³n, y como el corte es por IP, dos organizaciones distintas detrÃ¡s de la misma salida comparten el mismo cupo. | `packages/product-runtime/src/app.ts:99-106`, `packages/product-runtime/src/app.ts:117-118` | Con el cupo agotado (700 peticiones en 15 minutos), pedir `/health`: si responde `429` y no `200 {"ok":true,â€¦}`, estÃ¡ confirmado. DespuÃ©s esperar la ventana y repetir: vuelve a `200`. Contrastar con `CRM-SIS-05`. | Media |
| **R-24** El `immutable` de un aÃ±o se aplica **tambiÃ©n a los recursos sin huella**. El mÃ³dulo de assets dice, en su propio comentario, que `immutable` solo es correcto porque la URL lleva la huella `?v=`; pero el `setHeaders` se pasa a `express.static` de la carpeta entera, asÃ­ que un `GET /app.js` a secas se sirve igual con `public, max-age=31536000, immutable`. El HTML siempre pide la URL con `?v=` y por eso no se nota; se nota con una pestaÃ±a vieja que referencia el recurso sin la huella, con la URL del asset guardada a mano o con un cachÃ© de por medio que guarde la ruta pelada. | `packages/core/src/utils/assets.ts:64-67`, `packages/core/src/utils/assets.ts:83-97`, `packages/product-runtime/src/app.ts:159-165` | En producciÃ³n, `GET /app.js` **sin** `?v=`: si el `cache-control` es `public, max-age=31536000, immutable`, estÃ¡ confirmado, y es el mismo header que lleva `GET /app.js?v=<huella>`. DespuÃ©s comprobar que en desarrollo el TTL es 0. Contrastar con `CRM-REG-04` y `CRM-API-10`. | Media |
| **R-25** Entrar **directo** a `?panel=seguimientos` o `?panel=contactos` pinta la tabla **antes de tener los nombres**. `AMIGO.montar` llama a `alEntrar` de inmediato (y el producto pinta el panel de la URL), y reciÃ©n despuÃ©s arranca `cargar()`, que es la que trae `/api/customers`. Como el nombre se busca en `estado.clientes`, la columna `Cliente` sale con `â€”` y se queda asÃ­: la promesa de la lÃ­nea 609 solo vuelve a pintar el **tablero**, no la tabla de la que se entrÃ³. Con la red rÃ¡pida no se ve; con DevTools en `Slow 3G` es constante. | `products/crm/public/app.js:603-609`, `products/crm/public/app.js:412`, `products/crm/public/app.js:495`, `packages/product-runtime/public/amigo.js:157-163` | DevTools â†’ Network â†’ `Slow 3G`, abrir `/?panel=seguimientos` en una pestaÃ±a nueva y mirar la primera fila: si la columna `Cliente` sale `â€”` y sigue `â€”` despuÃ©s de que la red se calme, estÃ¡ confirmado. Lo mismo en `/?panel=contactos`. Se arreglarÃ­a llamando a `recargar()` en vez de `pintarTablero` al final del arranque, o esperando a `cargar()` antes del primer pintado. | Media |
| **R-26** Un cuerpo de JSON **mal formado devuelve `500` en vez de `400`**. `express.json()` lanza un `SyntaxError` con `type: 'entity.parse.failed'`, y el manejador de errores solo distingue `AppError`, error de Zod y `entity.too.large`: lo demÃ¡s cae en el `500` genÃ©rico y se escribe la traza entera en el log del contenedor. Afecta a los nueve productos, y un `500` por una peticiÃ³n mal armada ensucia los paneles de error y cualquier alerta que mire cÃ³digos 5xx. | `packages/product-runtime/src/app.ts:96`, `packages/product-runtime/src/errors.ts:27-40` | `POST /api/customers` con `Content-Type: application/json` y cuerpo `{"name":`: si la respuesta es `500 {"error":"Error interno del servidor"}` y en el log del contenedor aparece un `SyntaxError` con la posiciÃ³n, estÃ¡ confirmado. Contrastar con `CRM-API-10`, que ademÃ¡s cubre el `413` del cuerpo de 2 MB, que sÃ­ estÃ¡ bien tratado. | Media |

> Los veintisÃ©is riesgos de arriba son de los archivos de `products/crm`, `packages/product-runtime`
> y `packages/auth-client`. AdemÃ¡s hay un riesgo **fuera** de este producto, en el Core, que lo
> comparte con Inventario y Activos: el test `packages/core/tests/followups.test.ts` (Â«crea un
> seguimiento y lo devuelve con el clienteÂ») espera `overdue === false` para un `dueDate` del
> `2026-09-30`, y `packages/core/src/modules/followups/routes.ts:33,65` compara contra
> `new Date().toISOString().slice(0,10)`. Esa comparaciÃ³n es correcta; lo que envejece es la fecha
> fija del test, que a partir del `2026-10-01` da `true`. No es un defecto del CRM ni del Core: es un
> test que depende del dÃ­a. Se deja anotado para que nadie lo confunda con un fallo de este producto
> si aparece en una corrida de la suite.

---
## 8. Checklist visual

Recorrer una vez por cada panel, en 1280 x 800 y en 390 x 844. Marcar cada Ã­tem.

**Canal lateral y cabecera**

- [ ] `#tabs` tiene cinco entradas en tres grupos: `Cartera` (Tablero, Clientes), `Seguimiento` (Seguimientos, Contactos) y `ConfiguraciÃ³n` (Ajustes).
- [ ] Solo una entrada estÃ¡ activa, distinguida por fondo e indicador, y `aria-current` marca cuÃ¡l.
- [ ] El logo del canal muestra `CL` y el nombre `Clientes`; `data-amigo="empresa"`, `data-amigo="usuario"` y `data-amigo="correo"` traen los datos de la sesiÃ³n.
- [ ] `data-amigo="otras-titulo"` queda oculto y `data-amigo="otras"` vacÃ­o cuando la organizaciÃ³n tiene una sola herramienta.
- [ ] `#nuevo-cliente` estÃ¡ en `.ui-topbar__acciones` y se ve **en los cinco paneles**, incluso en Ajustes y Contactos.
- [ ] `Salir` apunta a `/auth/logout`.
- [ ] El tÃ­tulo de la barra superior cambia con el panel, y la URL queda en `?panel=â€¦`.

**Panel Tablero**

- [ ] `#resumen` lleva `ui-rejilla ui-rejilla--4` y muestra **seis** tarjetas: `Clientes activos`, `Archivados`, `Pendientes`, `Vencidos`, `Para hoy`, `Contactos (30 dÃ­as)`.
- [ ] Las seis caben en una fila a 1280 px y se reparten en varias filas a 390 px, sin huecos ni columnas vacÃ­as.
- [ ] Solo `Clientes activos` sale destacado; los otros cinco nÃºmeros van neutros.
- [ ] El filtro se rotula `Filtrar por cliente` y su primera opciÃ³n es `Todos los clientes`.
- [ ] Las tres tarjetas de seguimientos se llaman `Vencidos`, `Para hoy` y `PrÃ³ximos`, y cada ficha muestra el tÃ­tulo y, debajo, `nombre del cliente Â· DD/MM`.
- [ ] Las otras dos se llaman `CumpleaÃ±os del mes` y `Ãšltimos contactos`; en la segunda, cada lÃ­nea es `Tipo: quÃ© pasÃ³ Â· DD/MM AAAA HH:MM` con el nombre del cliente arriba.
- [ ] Las listas vacÃ­as dicen `Nada por acÃ¡`, y el guion de los datos que faltan es `â€”`, nunca un hueco en blanco.
- [ ] Los pendientes sin fecha no aparecen en ninguna bolsa (ver `R-11`).

**Panel Clientes**

- [ ] La lista tiene 6 columnas: `Nombre`, `Tipo`, `TelÃ©fono`, `Correo`, `Ciudad`, `Acciones`; el documento va debajo del nombre, con salto de lÃ­nea y sin columna propia.
- [ ] `#cliente-buscar` es un input de 100 caracteres con el texto Â«Buscar por nombre, telÃ©fono, documentoâ€¦Â».
- [ ] Cada fila tiene `Ficha`, `Editar` y `Archivar`, con `Archivar` en `ui-btn--fantasma`.
- [ ] Una sesiÃ³n `member` **sÃ­** ve `Archivar` (ver `R-01`: hoy se ve).
- [ ] El formulario tiene 11 campos, con `Nombre` requerido, `Correo` de tipo email y `CumpleaÃ±os` de tipo fecha; `Cancelar` estÃ¡ oculto mientras es un alta.
- [ ] La lista vacÃ­a dice `No hay clientes que coincidan` y su celda atraviesa las 6 columnas.
- [ ] Los datos que faltan se ven `â€”` en la tabla, y en la ficha como `Sin telÃ©fono` y `Sin correo`, con los pares que no tienen valor directamente ocultos.

**Ficha del cliente**

- [ ] Abre como diÃ¡logo modal sobre la pantalla, con la tarjeta y el botÃ³n `Cerrar` al pie.
- [ ] No cambia la URL (ver `R-10`: hoy no hay enlace directo a la ficha).
- [ ] Los pares son `TelÃ©fono`, `Correo`, `CumpleaÃ±os`, `DirecciÃ³n`, `Ciudad`, `Etiquetas` y `Notas`, y solo salen los que tienen valor.
- [ ] Debajo dice `N pendiente(s), M vencido(s), K contacto(s)`.
- [ ] Los dos bloques son `Seguimientos` y `Historial de contacto`, con lÃ­neas de tÃ­tulo y nota, y **ningÃºn botÃ³n** (ver `R-14`).
- [ ] `Esc` y `Cerrar` la cierran; hacer clic en el fondo no.

**Panel Seguimientos**

- [ ] La tabla tiene 5 columnas: `Cliente`, `QuÃ© hay que hacer`, `Para el dÃ­a`, `Estado`, `Acciones`; el detalle va dentro de la celda del tÃ­tulo.
- [ ] Cada fila tiene `Editar` y `Marcar hecho` (o `Reabrir` si estÃ¡ `Hecho`), y **no** hay botÃ³n de borrar (ver `R-18`).
- [ ] Los estados salen con etiqueta: `Pendiente` en aviso, `Hecho` en ok, `Cancelado` neutro; no existe `Vencido`.
- [ ] La fecha se escribe `DD/MM` y los `â€”` no tienen fecha.
- [ ] El formulario tiene `Cliente` (con `ElegÃ­ un cliente`), `QuÃ© hay que hacer` requerido, `Detalle`, `Para el dÃ­a` y `Estado`, con `Cancelar` oculto en alta.
- [ ] La lista vacÃ­a dice `No hay seguimientos` y su celda atraviesa las 5 columnas.

**Panel Contactos**

- [ ] La tabla tiene 4 columnas: `Cliente`, `Tipo`, `QuÃ© pasÃ³`, `CuÃ¡ndo`, y **ninguna** columna de acciones.
- [ ] El tipo sale como `Llamada`, `Correo`, `Visita` o `Nota`.
- [ ] El formulario es `Registrar un contacto` con `Cliente`, `Tipo` y `QuÃ© pasÃ³`, sin botÃ³n `Cancelar`.
- [ ] La lista vacÃ­a dice `No hay contactos registrados`.
- [ ] Los datos que faltan se ven `â€”`, y los `â€”` de `Nombre` y `Tipo` son celdas reales, no texto pegado.

**Panel Ajustes**

- [ ] El formulario tiene **dos** campos, `Moneda` y `Zona horaria`, con 5 y 64 caracteres, y nada mÃ¡s.
- [ ] `Guardar ajustes` avisa `Ajustes guardados` en verde y `rol-insuficiente` en rojo para un `member` (ver `R-22`).
- [ ] Un `member` ve los campos editables aunque no pueda guardar.
- [ ] NingÃºn importe de la pantalla cambia con la moneda (ver `R-21`).

**En todas las pantallas**

- [ ] `#aviso` es Ãºnico: muestra el Ãºltimo aviso, en verde o en rojo, y no se acumulan varios.
- [ ] Los formularios no recargan la pÃ¡gina, y el botÃ³n `Guardar` queda deshabilitadoâ€¦ o no cambia: si el doble clic duplica el alta, anotarlo.
- [ ] Las tablas se desplazan dentro de su caja, no con la barra del navegador: el canal y la barra superior no se mueven.
- [ ] A 900 px el shell pasa a una columna; a 560 px los formularios de dos columnas se apilan.
- [ ] Con el teclado se llega a todos los botones y el foco se ve; con `prefers-reduced-motion` no hay transiciones.

## 9. Registro

Una fila por caso ejecutado. **Dejar vacÃ­a hasta la primera vuelta real**: nada de este documento
estÃ¡ verificado todavÃ­a. `Resultado` es `PASA`, `FALLA` o `BLOQUEADO`. Cuando un caso falle, la
`Evidencia` lleva el `id` de la peticiÃ³n y la respuesta (status y cuerpo), y la `Nota` dice si el
problema es del producto, del runtime o del Core.

**Primera vuelta transversal · 2026-10-06 · producción.** Solo casos ejecutados. Transversal: Doc 10 §9.

| ID | Resultado (PASA/FALLA/BLOQUEADO) | Evidencia | Nota |
|---|---|---|---|
| CRM-CLI-01 | FALLA | `?panel=clientes` → `<div id="clientes"></div>` vacío, sin cabeceras ni estado de vacío; 0 peticiones al clic. Con `GET /api/customers` fresco (200, 18 items) el panel **no pinta** | No hay datos seed `QA-CRM` en prod; el defecto real es que ni siquiera pinta los datos demo que la API sí devuelve. Shell corre `app.js` viejo. |
| CRM-CLI-02 | BLOQUEADO | Requiere el cliente seed `QA-CRM ficha minima` | No ejecutado. |
| CRM-API-01 | PARCIAL | `GET /api/customers` → `{items,total,limit,offset}` ✅. `limit=5000`→`1000` ✅. `limit=-5` → ecoa `limit:-5`. `order=asc`/`desc` → **idénticos**. 404 → `{"error":"No encontrado"}`. Borrar → `200 {ok:true,archived:true}` pero la lista lo muestra con `archivedAt:null` | Datos demo (18), no los 4 seed; `q` busca por nombre/email ✅. El borrado archivado no se refleja en el listado (hallazgo Doc 10 REG-CRUD-09). |
| CRM-API-02 | BLOQUEADO | Requiere empresas/personas seed y segunda organización | No ejecutado. Filtro `kind` no probado. |
| CRM-E2E-01 | BLOQUEADO | Requiere sesión `admin` y datos de la sección 2 | No ejecutado. |
| CRM-E2E-02 | BLOQUEADO | Idem | No ejecutado. |
| REG-E2E-02 | PASA | Cliente `QA Compartido` creado en Citas (`201`); `GET /api/customers?q=QA%20Compartido` en CRM → 0 items; UI tampoco lo muestra | Aislamiento de catálogos entre productos confirmado en producción. |
