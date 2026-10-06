# Plan de pruebas — Regresión compartida (los nueve productos)

Este documento no prueba un producto. Prueba la **capa que los nueve comparten**, que es donde
un cambio se multiplica por nueve. Cada caso se ejecuta **una vez por producto**, salvo que diga
"una sola vez".

Es el plan con la mejor relación costo/beneficio del repositorio: sin él, cambiar
`amigo.js`, `amigo-ui.js`, `amigo.css` o `crudRouter` es un cambio a ciegas en ocho
aplicaciones que nadie puede ver.

## Por qué este documento existe

`amigo.js`, `amigo-ui.js` y `amigo.css` los cargan los nueve productos. Una sola línea
equivocada rompe los nueve a la vez. El caso más caro que se encontró en la suite fue
exactamente ahí: el canal dejaba de pedir datos al cambiar de sección, y el síntoma
—paneles vacíos— parecía un bug de cada producto por separado. Parecía sano si se entraba
por URL con `?panel=`, que es como lo probaba la QA.

**Regla del plan: hay que entrar a cada producto por el subdominio y hacer clic en cada
pestaña. Nunca basta con probar `?panel=` ni con abrir una sola pestaña.**

---

## 1. Ficha técnica

| Dato | Valor |
|---|---|
| Qué cubre | `packages/product-runtime/public/amigo.js` (180 líneas), `amigo-ui.js`, `amigo.css`, `src/crud.ts`, `src/app.ts`, `packages/auth-client/src/` |
| Productos | 9 · 37 paneles en total |
| API pública del shell | `AMIGO.montar(opciones)`, `AMIGO.mostrar(clave)`, `AMIGO.esc(v)`, `AMIGO.iniciales(nombre)` |
| API pública de la UI | `AMIGO_UI.$`, `esc`, `dinero`, `fecha`, `celda`, `fila`, `cajaTabla`, `tabla`, `cuerpoDe`, `boton`, `etiqueta`, `estadoDe`, `TONOS`, `kpis`, `avisar`, `vacio`, `filaVacia`, `api` |
| Endpoint de arranque | `GET /api/inicio` — lo llama `amigo.js` para pintar la cuenta y las otras herramientas |
| Orden de scripts | `/amigo-ui.js` → `/amigo.js` → `/app.js`, **clásicos, sin `defer` ni `type="module"`** |
| Matriz de paneles | ver §2 |
| tests que lo blindan | `packages/product-runtime/tests/` (41 casos, incluye `time.test.ts` con 12) y `packages/core/tests/frontendMoney.test.ts`, que recorre los nueve `app.js` y falla si aparece un `* 100` o `/ 100` sobre un monto |

### Matriz de paneles por producto

| Producto | Dominio | Paneles (`data-panel`) | Acento |
|---|---|---|---|
| Activos | `activos.amgdeveloper.cl` | `tablero`, `activos`, `ajustes` | `#…` |
| Checklists | `checklists.amgdeveloper.cl` | `tablero`, `plantillas`, `corridas`, `ajustes` | `#…` |
| Citas | `citas.amgdeveloper.cl` | `agenda`, `clientes`, `servicios`, `profesionales`, `horarios`, `avisos`, `config` | `#c2571a` |
| Cotizaciones | `cotizaciones.amgdeveloper.cl` | `inicio`, `cotizaciones`, `ajustes` | `#b0403a` |
| CRM | `crm.amgdeveloper.cl` | `tablero`, `clientes`, `seguimientos`, `contactos`, `ajustes` | `#…` |
| Espacios | `espacios.amgdeveloper.cl` | `agenda`, `espacios`, `horarios`, `clientes`, `extras`, `ajustes` | `#…` |
| Inventario | `inventario.amgdeveloper.cl` | `articulos`, `movimientos`, `configuracion` | `#2f6fd0` |
| Pagos | `pagos.amgdeveloper.cl` | `tablero`, `cobros`, `reporte`, `ajustes` | `#…` |
| Solicitudes | `solicitudes.amgdeveloper.cl` | `solicitudes`, `ajustes` | `#…` |

El color de acento vive en el `style.css` de cada producto, no en `amigo.css`. Si un producto
no lo declara, hay que anotar cuál es el que queda: **todos deberían verse como la misma
aplicación con un color distinto**.

---

## 2. Datos de prueba

Ninguno. Este plan no necesita sembrar datos.

Necesita **una organización con acceso a los nueve productos**, para que la lista
`Mis otras herramientas` se llene y el salto entre productos se pueda probar. Si la
organización solo tiene acceso a tres, el caso `REG-NAV-09` se ejecuta con lo que haya y se
anota cuántos aparecen.

Lo que sí hay que registrar antes de empezar, porque después se usa en el informe:

| # | Qué anotar | Cómo |
|---|---|---|
| D1 | Rol de la cuenta con la que se prueba: `member`, `admin` u `owner` | En la sesión del Core |
| D2 | La zona horaria del navegador y la de cada organización | `Intl.DateTimeFormat().resolvedOptions().timeZone` |
| D3 | Cuántos productos lista `Mis otras herramientas` | Visible en el canal |

**D2 es obligatorio y no es opcional.** Si el navegador y la organización están en la misma
zona, los casos de fecha y hora no prueban nada. Ver `REG-UI-04` y `REG-UI-05`.

---

## 3. Precondiciones

1. Sesión iniciada en el Core. **Cada subdominio tiene su propia cookie**: entrar a un producto
   por primera vez redirige al Core y vuelve solo si la sesión del Core sigue viva.
2. **Nunca pedir credenciales.** El tester las tipea.
3. La sesión dura **15 minutos**. Al expirar, `/api/*` responde `401 {"error":"sin-sesion"}` y el
   navegador salta al login. Anotar el corte, no contarlo como fallo.
4. Empezar por el subdominio, **nunca** por una URL con `?panel=`. La URL funciona aunque el clic
   esté roto, que es justamente el caso que este plan busca.
5. Para los casos de rol hace falta una segunda cuenta. El shell **no** lee el rol: el lo pide
   cada producto, o no lo pide. Ver `REG-SES-05`.

---

## 4. Casos por módulo

### 4.1 Navegación (`amigo.js`)

#### `REG-NAV-01` — Clic en cada pestaña pide datos

| | |
|---|---|
| **ID** | `REG-NAV-01` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Sesión iniciada, entered por el subdominio |
| **Pasos** | 1. En cada producto, ir a la pestaña inicial y esperar a que cargue.<br>2. Clic en **cada** pestaña del canal, una por una.<br>3. En Network, contar las peticiones `/api/` que aparecen tras cada clic.<br>4. Repetir en los nueve productos. |
| **Esperado** | En los 37 paneles: la pestaña se marca activa, su panel se muestra, y **cada clic dispara al menos una petición a `/api/`**. Un panel que queda visible con la tabla vacía y sin texto de vacío es una regresión de este documento. Referencia: `amigo.js:123-127`. |

#### `REG-NAV-02` — El panel inicial carga sin hacer clic

| | |
|---|---|
| **ID** | `REG-NAV-02` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Cargar la raíz del producto, sin `?panel=`.<br>2. Contar las peticiones. |
| **Esperado** | El primer panel pinta con datos en la primera carga. `mostrar(inicial)` se llama desde `montar` (`amigo.js:159`), así que el camino es el mismo que el de un clic. Si el primer pintado no dispara red, hay dos caminos distintos y uno está roto. |

#### `REG-NAV-03` — La URL refleja la sección

| | |
|---|---|
| **ID** | `REG-NAV-03` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. Clic en la tercera pestaña.<br>2. Leer la barra de direcciones.<br>3. Copiar la URL y abrirla en una pestaña nueva. |
| **Esperado** | La URL queda `?panel=<clave>`. Abrirla en una pestaña nueva muestra ese panel, con datos. Sirve para compartir un enlace y para comparar contra el resultado del clic. |

#### `REG-NAV-04` — La flecha atrás y adelante

| | |
|---|---|
| **ID** | `REG-NAV-04` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Al menos dos paneles con datos |
| **Pasos** | 1. Ir a la pestaña 1, luego a la 2, luego a la 3.<br>2. Atrás, atrás, adelante.<br>3. Repetir en los nueve. |
| **Esperado** | Cada paso repinta **con datos**. `popstate` dispara `mostrar()` igual que el clic (`amigo.js:150`). Un panel vacío tras la flecha atrás es el mismo defecto que `REG-NAV-01`, por otro camino. |

#### `REG-NAV-05` — Un `?panel=` inválido cae al primero

| | |
|---|---|
| **ID** | `REG-NAV-05` |
| **Tipo / Prioridad** | `REG` · `P2` |
| **Precondición** | — |
| **Pasos** | 1. Abrir `?panel=inventado`.<br>2. Abrir `?panel=` vacío.<br>3. Abrir `?panel=` con un valor mal escapado. |
| **Esperado** | Los tres caen al primer panel declarado, que **sí** pinta con datos. `panelDeUrl` solo acepta claves que estén en la lista (`amigo.js:40-43`). No debe quedar la pantalla en blanco ni un error en consola. |

#### `REG-NAV-06` — El título del producto cambia con la sección

| | |
|---|---|
| **ID** | `REG-NAV-06` |
| **Tipo / Prioridad** | `REG` · `P2` |
| **Precondición** | Producto con `[data-amigo="titulo"]` |
| **Pasos** | 1. Recorrer las pestañas.<br>2. Observar el `<h1>` del centro. |
| **Esperado** | El `<h1>` toma el texto de la pestaña activa (`amigo.js:104-108`). Todas las pestañas deben traer texto: una pestaña vacía deja el `<h1>` en blanco. |

#### `REG-NAV-07` — La pestaña activa se marca para lectores de pantalla

| | |
|---|---|
| **ID** | `REG-NAV-07` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. En cada pestaña activa, inspeccionar el elemento.<br>2. Verificar que solo una tiene el atributo. |
| **Esperado** | Exactamente una `[data-tab]` con `aria-current="page"` en todo momento (`amigo.js:97-100`). Las demás lo pierden. Con dos marcadas, un lector de pantalla anuncia la sección dos veces. |

#### `REG-NAV-08` — Solo el panel activo es visible

| | |
|---|---|
| **ID** | `REG-NAV-08` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. En cada producto, recorrer todas las pestañas.<br>2. En cada paso, contar los `[data-panel]` visibles. |
| **Esperado** | Exactamente un panel sin `hidden`. Un panel oculto que sigue occupying espacio indica que se está manipulando `display` en vez de `hidden`, que es como lo hace `marcar` (`amigo.js:101-103`). |

#### `REG-NAV-09` — `Mis otras herramientas`

| | |
|---|---|
| **ID** | `REG-NAV-09` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | D3 anotado |
| **Pasos** | 1. En cada producto, mirar el pie del canal.<br>2. Contar los enlaces de `Mis otras herramientas`.<br>3. Verificar que **no** aparece el producto en el que se está.<br>4. Clic en un enlace y volver. |
| **Esperado** | El título `Mis otras herramientas` solo aparece si hay enlaces. El producto actual queda fuera de su propia lista (`amigo.js:78`). Todos los enlaces funcionan y llevan al producto correcto. Un producto sin `url` se nombra en texto plano, sin enlace roto (`amigo.js:88`). |

#### `REG-NAV-10` — El pie del canal muestra la cuenta

| | |
|---|---|
| **ID** | `REG-NAV-10` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | `GET /api/inicio` responde `200` |
| **Pasos** | 1. Mirar el pie del canal en los nueve.<br>2. Comparar con la respuesta de `/api/inicio`. |
| **Esperado** | `[data-amigo="usuario"]`, `[data-amigo="correo"]`, `[data-amigo="empresa"]` y `[data-amigo="avatar"]` con el nombre de la persona, su correo, el nombre de la organización y unas iniciales. El enlace `Salir` apunta a `/auth/logout`. |

#### `REG-NAV-11` — Las iniciales del avatar

| | |
|---|---|
| **ID** | `REG-NAV-11` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | Poder cambiar el nombre en el Core |
| **Pasos** | 1. Poner el nombre a `Deportes y Salud` → comprobar que da `DS`.<br>2. A `Empresa Unida` → `EU`.<br>3. A `Nombre` (una sola palabra) → `NO`.<br>4. A `de la` (solo palabras de relleno) → `?`.<br>5. Cerrar la sesión y observar el avatar. |
| **Esperado** | Las palabras de relleno no cuentan (`amigo.js:33`). Con una sola palabra toma las dos primeras letras. Con solo relleno, `?`. Sin sesión, un guion `–` (el valor del HTML) y no un error. |

#### `REG-NAV-12` — Un fallo en `/api/inicio` no rompe la app

| | |
|---|---|
| **ID** | `REG-NAV-12` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | DevTools abierto |
| **Pasos** | 1. En Network, poner `/api/inicio` en modo *Block request*.<br>2. Recargar.<br>3. Recorrer las pestañas. |
| **Esperado** | El producto sigue usable: el pie queda con los guiones del HTML, no hay errores en consola y los paneles cargan. La cuenta y las otras herramientas son adorno (`amigo.js:173-176`). Si el panel inicial queda vacío, `alEntrar` dependía de esta llamada. |

### 4.2 Tablas y avisos (`amigo-ui.js`)

#### `REG-UI-01` — La envoltura de tabla

| | |
|---|---|
| **ID** | `REG-UI-01` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Un producto con tabla (cualquiera de los nueve) |
| **Pasos** | 1. Abrir un panel con tabla.<br>2. Inspeccionar la estructura. |
| **Esperado** | `AMIGO_UI.tabla` + `cuerpoDe` + `fila` + `cajaTabla` producen la misma geometría en los nueve: encabezado, cuerpo y contenedor con scroll horizontal. El ancho de columna no depende del producto. |

#### `REG-UI-02` — Fila de vacío con el número de columnas correcto

| | |
|---|---|
| **ID** | `REG-UI-02` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Un filtro o búsqueda sin resultados |
| **Pasos** | 1. En cada producto, provocar una lista vacía (buscar algo imposible).<br>2. Inspeccionar el `colspan` de la fila de vacío. |
| **Esperado** | `filaVacia` recibe **exactamente** el número de columnas de su tabla y el mensaje es útil. Un `colspan` desalineado descuadra la tabla entera. El texto nunca es `undefined`. |

#### `REG-UI-03` — El money format es idéntico en los nueve

| | |
|---|---|
| **ID** | `REG-UI-03` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Poder ver montos en varios productos |
| **Pasos** | 1. En cada producto que muestre dinero, anotar el formato de un monto redondo y de uno con decimales.<br>2. Comparar entre productos. |
| **Esperado** | **Todos formatean igual.** Se comprobó que hay al menos dos formatos distintos en la suite: uno redondea a pesos enteros y otro muestra decimales. En el mismo portfolio eso se ve como una inconsistencia, no como un bug de un producto. La conversión vive en `AMIGO_UI.dinero` y `packages/core/src/money.ts`, no en el `app.js` de cada uno. |

#### `REG-UI-04` — `AMIGO_UI.fecha` respeta la zona pedida

| | |
|---|---|
| **ID** | `REG-UI-04` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | D2: navegador y organización en zonas distintas |
| **Pasos** | 1. Conocer un instante concreto, por ejemplo `2026-10-06T04:00:00.000Z`.<br>2. Pintarlo con `AMIGO_UI.fecha(iso, true)` sin zona.<br>3. Pintarlo con `AMIGO_UI.fecha(iso, true, 'America/Mexico_City')`.<br>4. Comparar con `new Date(iso).toLocaleString('es-CL')`. |
| **Esperado** | Con zona explícita, la hora es la de esa zona: para el ejemplo, `22:00` del día 5. Sin zona, sigue la del navegador. **La firma de tres argumentos es aditiva**: los productos que llaman con dos no cambian de comportamiento. Si un producto empezara a recibir tres argumentos donde antes recibía dos, el texto de fecha cambiaría: eso es exactamente lo que hay que vigilar. |

#### `REG-UI-05` — Ningún producto calcula la hora a mano

| | |
|---|---|
| **ID** | `REG-UI-05` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | — |
| **Pasos** | 1. En cada `products/*/public/app.js`, buscar `toLocaleString`, `toLocaleDateString`, `getHours`, `getDate`.<br>2. Buscar `new Date(` y ver si se usa para formatear o solo para enviar. |
| **Esperado** | El formateo de fechas **delega en `AMIGO_UI.fecha`**. Un `toLocaleString` a secas usa el huso del navegador y por eso se desviaron las fechas: un taller en UTC−6 vio la cita del día 5 archivada en el 6. Construir el instante para enviar sí se puede hacer con `new Date`, siempre que se pase por la zona de la organización. |

#### `REG-UI-06` — `estadoDe` y los tonos

| | |
|---|---|
| **ID** | `REG-UI-06` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Un producto con estados (citas, cotizaciones, espacios) |
| **Pasos** | 1. Crear un registro con cada estado que el producto maneje.<br>2. Comparar la etiqueta y el color. |
| **Esperado** | Ninguna etiqueta muestra la clave cruda del estado: `pending` se traduce, no se muestra. El color sale de `AMIGO_UI.TONOS`, igual en los nueve. Un estado que el API acepta y el mapa no conoce, aparece sin estilo o con el texto crudo: anotarlo. |

#### `REG-UI-07` — `AMIGO_UI.api` y el `401`

| | |
|---|---|
| **ID** | `REG-UI-07` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Sesión que va a expirar |
| **Pasos** | 1. Dejar expirar la sesión.<br>2. Usar cualquier formulario.<br>3. Observar la respuesta y la navegación. |
| **Esperado** | `api()` detecta el `401` y lleva al `loginUrl` (`amigo-ui.js:331-336`). No se muestra un error rojo con un JSON crudo. Al volver a entrar, la app se puede usar. |

#### `REG-UI-08` — Los avisos se autocultan

| | |
|---|---|
| **ID** | `REG-UI-08` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. Provocar un aviso de error.<br>2. Esperar más de 5 segundos.<br>3. Contar los avisos visibles. |
| **Esperado** | Los avisos se van solos tras ~5 s (`amigo-ui.js:270-278`) y quedan los que siguen vivos. **Consecuencia a tener presente al probar**: un error que se oculta solo puede escaparse de una revisión rápida. Hay que mirar la consola y la Network, no solo la barra. |

#### `REG-UI-09` — `kpis` y las rejillas

| | |
|---|---|
| **ID** | `REG-UI-09` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Producto con tablero (crm, activos, pagos, checklists, cotizaciones) |
| **Pasos** | 1. Abrir el tablero.<br>2. Contar tarjetas.<br>3. Cambiar el ancho a 640, 1000 y 1100 px. |
| **Esperado** | Las rejillas colapsan por los puntos de corte de `amigo.css` (640, 1000, 1100). Sin scroll horizontal en ningún ancho. Una tarjeta con número largo no rompe la rejilla. |

### 4.3 Contrato de `crudRouter`

#### `REG-CRUD-01` — La forma de la lista

| | |
|---|---|
| **ID** | `REG-CRUD-01` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. En cada ruta montada con `crudRouter`, pedir la lista.<br>2. Inspeccionar las claves de la respuesta. |
| **Esperado** | Siempre `{ items, total, limit, offset }` (`crud.ts:248`). **Este contrato es la causa de bug más repetida de la suite**: si el frontend desestructura `{ customers }` o `{ requests }` en vez de `{ items }`, el panel queda mudo con un `undefined.map` y sin mensaje. Toda lista montada con `crudRouter` que devuelva otra envoltura es un hallazgo crítico. Nota: Solicitudes devuelve `{ requests, total }`, que es una ruta propia y no `crudRouter`. |

#### `REG-CRUD-02` — El `total` no es el tamaño de la página

| | |
|---|---|
| **ID** | `REG-CRUD-02` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Más objetos que el `limit` pedido |
| **Pasos** | 1. Crear objetos hasta superar el `limit`.<br>2. Pedir la lista con `limit=5`.<br>3. Leer `total`, `limit`, `offset` y `items.length`. |
| **Esperado** | `total` es el número total de la organización, mayor que `items.length`. `limit` refleja lo pedido. `offset` es 0 en la primera página. Un frontend que pinte el `total` como número de filas visibles miente. |

#### `REG-CRUD-03` — El tope del `limit`

| | |
|---|---|
| **ID** | `REG-CRUD-03` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Pedir `limit=5000`.<br>2. Pedir `limit=0`.<br>3. Pedir `limit=-5`. |
| **Esperado** | 1. Se limita a **1000**, no a 5000. 2 y 3. Se normaliza a un valor utilizable en lugar de devolver una lista vacía sin explicación. Anotar el comportamiento exacto: es parte del contrato. |

#### `REG-CRUD-04` — La búsqueda `q` depende de la configuración

| | |
|---|---|
| **ID** | `REG-CRUD-04` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Dos rutas con `search` distinto: clientes busca en nombre, correo y teléfono; servicios solo en nombre |
| **Pasos** | 1. Buscar un término que esté en el correo del cliente.<br>2. Buscar un término que esté en la descripción de un servicio. |
| **Esperado** | 1. El cliente aparece: `email` está en la lista `search`. 2. El servicio **no** aparece: `description` no está. El `q` se ignora por completo si `search` está vacío (`crud.ts:206`). Saber qué columnas buscar en cada recurso es la diferencia entre una búsqueda que funciona y una que no. |

#### `REG-CRUD-05` — Offset y orden

| | |
|---|---|
| **ID** | `REG-CRUD-05` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | Al menos 6 objetos |
| **Pasos** | 1. Pedir `offset=0&limit=3` y luego `offset=3&limit=3`.<br>2. Pedir `order=asc` y `order=desc`.<br>3. Pedir un `offset` mayor que el total. |
| **Esperado** | 1. Dos páginas distintas, sin huecos ni repetidas. 2. El orden se invierte. Cualquier valor distinto de `asc` se trata como `desc`. 3. Lista vacía con `total` intacto. |

#### `REG-CRUD-06` — Crear devuelve la fila, no un id suelto

| | |
|---|---|
| **ID** | `REG-CRUD-06` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Sesión con permiso de escritura |
| **Pasos** | 1. `POST` en cada ruta `crudRouter`.<br>2. Leer el cuerpo de la respuesta.<br>3. Usar el `id` devuelto para un `GET /:id`. |
| **Esperado** | `201` con la fila completa, incluido el `id` generado. El `GET` posterior devuelve esa misma fila. Si el `POST` devolviera solo `{ ok: true }`, el frontend tendría que recargar la lista entera para conocer el id. |

#### `REG-CRUD-07` — `404` con mensaje estable

| | |
|---|---|
| **ID** | `REG-CRUD-07` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. `GET /<recurso>/no-existe`.<br>2. `PATCH /<recurso>/no-existe`.<br>3. `DELETE /<recurso>/no-existe`. |
| **Esperado** | Los tres `404` con `{ "error": "No existe" }`. El mensaje es el mismo en los nueve productos, porque sale del runtime y no de cada producto. Si uno dice otra cosa, está reescribiendo el `404` y hay que anotarlo. |

#### `REG-CRUD-08` — Un campo desconocido se rechaza o se ignora

| | |
|---|---|
| **ID** | `REG-CRUD-08` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Sesión con escritura |
| **Pasos** | 1. `POST` con un campo que no existe en el esquema.<br>2. `POST` con `archivedAt` o `createdAt`.<br>3. `POST` con un campo `readonly`. |
| **Esperado** | El comportamiento es uniforme en los nueve. Los campos `readonly` están declarados como tales y no se pueden escribir por API. Anotar exactamente qué hace cada ruta: algunos rechazan con `400 Campo desconocido`, otros descartan el campo en silencio. **Un campo descartado en silencio es una trampa**: el usuario cree que lo guardó. |

#### `REG-CRUD-09` — Borrado lógico y `archive`

| | |
|---|---|
| **ID** | `REG-CRUD-09` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Dos rutas, una con `archive: true` y otra sin |
| **Pasos** | 1. `DELETE` en la que tiene `archive`.<br>2. `DELETE` en la que no.<br>3. Listar después de cada una. |
| **Esperado** | Con `archive: true`, el registro **sigue en la lista** con `archivedAt` puesto; el borrado es lógico. Sin `archive`, desaparece. En ambos casos la respuesta es `200`. Una lista que trae los archivados sin distinguirlos hace que el borrado parezca que no funcionó. |

#### `REG-CRUD-10` — Los campos de solo lectura en el PATCH

| | |
|---|---|
| **ID** | `REG-CRUD-10` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Sesión con escritura |
| **Pasos** | 1. `PATCH` con `quantity` en Inventario.<br>2. `PATCH` con `totalCents` en Pagos.<br>3. `PATCH` con `status` en Cotizaciones. |
| **Esperado** | El comportamiento está declarado y es uniforme: en Inventario, mandar `quantity` da `400 Campo desconocido` porque el campo es `readonly`; en Cotizaciones, `status` se **descarta** porque solo cambia por una ruta dedicada. Un `400` y un descarte son dos experiencias distintas para la misma intención y hay que saber cuál da cada ruta. |

### 4.4 Sesión, roles y aislamiento

#### `REG-SES-01` — Sin sesión, la API responde `401` JSON

| | |
|---|---|
| **ID** | `REG-SES-01` |
| **Tipo / Prioridad** | `SIST` · `P0` |
| **Precondición** | Sesión cerrada o caducada, DevTools abierto |
| **Pasos** | 1. Sin sesión, pedir `GET /api/<lo que sea>` de cada producto.<br>2. Observar el `Accept` de cada uno. |
| **Esperado** | `401` con `{ error, message, loginUrl }`. Nunca un `500`. El mensaje es legible: `Tu sesión no está iniciada.` o `Tu sesión venció. Volvé a entrar para seguir.` |

#### `REG-SES-02` — Sin sesión, la página redirige al Core

| | |
|---|---|
| **ID** | `REG-SES-02` |
| **Tipo / Prioridad** | `SIST` · `P0` |
| **Precondición** | Sesión cerrada |
| **Pasos** | 1. Abrir la raíz de cada subdominio sin sesión.<br>2. Observar a dónde se llega. |
| **Esperado** | Redirección al login del Core, y de vuelta al producto que se pidió. Que el subdominio **muestre su propio login** es un defecto de configuración: el login vive en el Core. Y que tras el Core no se vuelva al producto original, también. |

#### `REG-SES-03` — La página también está detrás de la sesión

| | |
|---|---|
| **ID** | `REG-SES-03` |
| **Tipo / Prioridad** | `SIST` · `P1` |
| **Precondición** | Sin sesión |
| **Pasos** | 1. Sin sesión, pedir `/`, `/app.js`, `/style.css`, `/amigo.css`. |
| **Esperado** | Todos redirigen o devuelven `401`. El HTML y sus scripts **no** se sirven sin sesión. Si `/app.js` se sirve sin sesión, el código del cliente queda expuesto: anotar. |

#### `REG-SES-04` — Lo que sí es público

| | |
|---|---|
| **ID** | `REG-SES-04` |
| **Tipo / Prioridad** | `SIST` · `P2` |
| **Precondición** | Sin sesión |
| **Pasos** | 1. Pedir `/health`, `POST /health`, `/api/meta`, `/auth/callback`, `/auth/logout`. |
| **Esperado** | `GET /health` y `POST /health` devuelven `200 { ok: true, product, name }` sin sesión. `/api/meta` devuelve el nombre y el slug. `/auth/callback` sin `code` devuelve `400` con una página de error legible. Los cinco funcionan en los nueve, idénticos. |

#### `REG-SES-05` — `403` por rol insuficiente

| | |
|---|---|
| **ID** | `REG-SES-05` |
| **Tipo / Prioridad** | `SIST` · `P0` |
| **Precondición** | Una cuenta `member` |
| **Pasos** | 1. Con `member`, llamar a las rutas que exigen `admin`.<br>2. Leer el cuerpo de la respuesta. |
| **Esperado** | `403` con `{ "error": "rol-insuficiente", "necesario": "admin", "actual": "member" }`. La jerarquía es `member` < `admin` < `owner`. Un `member` no puede escribir ajustes ni borrar donde corresponda. **Ojo: el shell no lee el rol.** Cada producto lo pide por su cuenta o no lo pide, y ahí están los hallazgos: hay productos que esconden el botón y productos que lo muestran y dejan que el `403` lo reprima. Comparar los nueve. |

#### `REG-SES-06` — Aislamiento entre organizaciones

| | |
|---|---|
| **ID** | `REG-SES-06` |
| **Tipo / Prioridad** | `SIST` · `P0` |
| **Precondición** | Dos organizaciones, con datos propios |
| **Pasos** | 1. Con sesión de A, listar en los nueve productos.<br>2. Con sesión de A, pedir por id un registro de B.<br>3. Con sesión de A, `PATCH` y `DELETE` ese registro de B. |
| **Esperado** | A solo ve lo suyo. Los tres intentos contra B dan `404`, **nunca** `200` con datos ajenos ni un `403` que confirme que el registro existe. `organizationId` sale del token verificado y nunca del cuerpo, de la query ni de una cabecera. Este caso es el de mayor consecuencia si falla. |

#### `REG-SES-07` — Salir de sesión

| | |
|---|---|
| **ID** | `REG-SES-07` |
| **Tipo / Prioridad** | `SIST` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. En cada producto, clic en **Salir**.<br>2. Intentar volver con la flecha atrás.<br>3. Volver a entrar en otro producto. |
| **Esperado** | `GET /auth/logout` redirige al logout del Core y vuelve al producto. El botón atrás no restaura datos: la sesión del producto ya no está. |

#### `REG-SES-08` — El límite de tasa

| | |
|---|---|
| **ID** | `REG-SES-08` |
| **Tipo / Prioridad** | `SIST` · `P1` |
| **Precondición** | Poder acelerar peticiones desde la consola |
| **Pasos** | 1. Repetir un `GET /api/...` en bucle desde la consola.<br>2. Cruzar las 600 peticiones en 15 minutos.<br>3. Ver las cabeceras de respuesta. |
| **Esperado** | `429` con cabeceras `draft-7` (`RateLimit`, `RateLimit-Policy`). El límite es **600 por 15 min por IP**, en los nueve, sin que ninguno lo suba. Dos detalles: el contador se instala **antes** de `/health`, así que las sondas de salud consumen presupuesto; y el error se ve como `429`, no como un fallo de la app. |

### 4.5 Errores, límites y caché

#### `REG-ERR-01` — La forma de los errores

| | |
|---|---|
| **ID** | `REG-ERR-01` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Provocar en cada producto un `400`, un `404`, un `409` y un `500`.<br>2. Comparar las claves de la respuesta. |
| **Esperado** | Siempre `{ error: <mensaje> }`, con `errors` opcional. Un `400` de validación trae `{ error: "Datos inválidos", errors: { formErrors, fieldErrors } }`. Un `500` **nunca** filtra un stack trace ni un mensaje interno: dice `Error interno del servidor`. Si algún producto muestra el mensaje crudo de una excepción, es un hallazgo de seguridad. |

#### `REG-ERR-02` — JSON malformado

| | |
|---|---|
| **ID** | `REG-ERR-02` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. `POST` con cuerpo `{` (JSON inválido) a un endpoint cualquiera de los nueve. |
| **Esperado** | Lo correcto sería `400`. **Se ha observado que responde `500`**, porque el error de parseo no se traduce (`app.ts:96` con `errors.ts:27-40`). Si se confirma, es un hallazgo del runtime: afecta a los nueve. Anotar el código real que devuelven los nueve. |

#### `REG-ERR-03` — Cuerpo demasiado grande

| | |
|---|---|
| **ID** | `REG-ERR-03` |
| **Tipo / Prioridad** | `FUNC` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. `POST` con un cuerpo de 2 MB a cada producto. |
| **Esperado** | `413` con `{ "error": "La petición es demasiado grande" }`. El límite del parser es 1 MB en los nueve. Con adjuntos, ojo: un archivo de 900 KB puede reventar el límite de JSON **antes** de que se compruebe el límite del adjunto, porque el base64 lo infla un 33 %. |

#### `REG-ERR-04` — Sin CSP

| | |
|---|---|
| **ID** | `REG-ERR-04` |
| **Tipo / Prioridad** | `SIST` · `P1` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Ver las cabeceras de respuesta de `/` en los nueve.<br>2. Buscar `Content-Security-Policy`. |
| **Esperado** | `helmet` está activo pero **con la CSP desactivada** (`app.ts:95`), así que no hay ninguna. Las otras sí deben estar: HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, y cookie de sesión `HttpOnly`. Si falta alguna de esas en algún producto, es un hallazgo de ese producto. |

#### `REG-ERR-05` — Caché de estáticos sin huella

| | |
|---|---|
| **ID** | `REG-ERR-05` |
| **Tipo / Prioridad** | `FUNC` · `P2` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Pedir `/amigo.css` y `/app.js` en cada producto.<br>2. Leer `Cache-Control`. |
| **Esperado** | En producción debe haber `?v=<hash>` en la URL: sin huella, un `immutable` de un año sirve un `amigo.css` viejo a un navegador que ya lo tenía cacheado, y el arreglo del shell no llega nunca. Verificar que el HTML se sirve con `no-cache` y los scripts con huella versionada. |

#### `REG-ERR-06` — `favicon.ico`

| | |
|---|---|
| **ID** | `REG-ERR-06` |
| **Tipo / Prioridad** | `EXP` · `P2` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Pedir `/favicon.ico` en cada producto. |
| **Esperado** | `404` en los nueve, si ninguno lo declara. Una pestaña con el icono roto del navegador en las nueve pantallas: es cosmético, pero delata que el shell no trae favicon. Anotar si algún producto lo resuelve. |

### 4.6 Geometría (`amigo.css`)

#### `REG-CSS-01` — Desborde horizontal en móvil

| | |
|---|---|
| **ID** | `REG-CSS-01` |
| **Tipo / Prioridad** | `REG` · `P0` |
| **Precondición** | Viewport 390 × 844 |
| **Pasos** | 1. En los nueve, medir `document.documentElement.scrollWidth`.<br>2. Medir `getComputedStyle(document.querySelector('.ui')).gridTemplateColumns`. |
| **Esperado** | `scrollWidth <= 390` en los nueve. **Hoy falla en los nueve**: `.ui-canal` declara `grid-area: canal` (`amigo.css:153`) pero las áreas móviles de `.ui` (línea 139) son `"topbar" "main"` y **no definen `canal`**. El item cae en la grilla implícita: medido `350.4px 0px 132.137px` y `scrollWidth` 482 px. El canal queda cortado y sin hamburguesa. Es el defecto visual más grande de la suite y vive en el archivo compartido. |

#### `REG-CSS-02` — Las áreas del grid están declaradas

| | |
|---|---|
| **ID** | `REG-CSS-02` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | Viewport 390 |
| **Pasos** | 1. Mirar la lista de áreas en móvil.<br>2. Compararla con los `grid-area` que declaran los items. |
| **Esperado** | Todo item con `grid-area` tiene su área declarada en **todas** las variantes. Si falta una, el item se va a la grilla implícita, que es lo que produce `REG-CSS-01`. Es un criterio mecánico, aplicable al diff de cualquier cambio en `amigo.css`. |

#### `REG-CSS-03` — El arreglo del canal no puede apilar 700 px

| | |
|---|---|
| **ID** | `REG-CSS-03` |
| **Tipo / Prioridad** | `EXP` · `P1` |
| **Precondición** | Viewport 390 |
| **Pasos** | 1. Al corregir `REG-CSS-01`, probar el arreglo mínimo: añadir `canal` a las áreas móviles.<br>2. Medir la altura total de `.ui-canal`. |
| **Esperado** | El arreglo mínimo **no es aceptable**: apila un canal de unos 700 px (8 enlaces de sección más los de herramientas) encima del contenido. En un teléfono deja el contenido abajo del todo. Lo correcto es un cajón lateral con hamburguesa, que es funcionalidad nueva en `amigo.js` y toca a los nueve. **Decidir antes de tocar `amigo.css`.** |

#### `REG-CSS-04` — Los puntos de corte

| | |
|---|---|
| **ID** | `REG-CSS-04` |
| **Tipo / Prioridad** | `REG` · `P1` |
| **Precondición** | — |
| **Pasos** | 1. En cada producto, redimensionar de 360 a 1400 px.<br>2. Buscar saltos, solapes o scrolls horizontales en cada corte. |
| **Esperado** | Sin scroll horizontal en ningún ancho. Los cortes declarados están en 560, 640, 768, 900, 1000 y 1100 px. Un corte sin `grid-area` produce un salto. Verificar también a 320 px, el móvil más chico. |

#### `REG-CSS-05` · Preferencia de movimiento y contraste

| | |
|---|---|
| **ID** | `REG-CSS-05` |
| **Tipo / Prioridad** | `REG` · `P2` |
| **Precondición** | DevTools → Rendering |
| **Pasos** | 1. Emular `prefers-reduced-motion: reduce`.<br>2. Emular `prefers-contrast: more`.<br>3. Recorrer un producto con cada ajuste. |
| **Esperado** | Sin animaciones con `reduce` (`amigo.css:815`). Con `prefers-contrast: more` los textos siguen siendo legibles y los estados no se distinguen solo por color (`amigo.css:819`). Ambas media queries existen; hay que verificar que sean efectivas y no solo declaradas. |

#### `REG-CSS-06` — El color de acento es por producto

| | |
|---|---|
| **ID** | `REG-CSS-06` |
| **Tipo / Prioridad** | `REG` · `P2` |
| **Precondición** | Sesión iniciada en los nueve |
| **Pasos** | 1. En cada producto, leer `--acento` en `:root`.<br>2. Comprobar que `AMIGO.montar` no lo sobreescribe de forma global. |
| **Esperado** | Cada producto declara su acento en su `style.css`. `montar` acepta `color` y `acentoTenue` y los pone en el `documentElement` (`amigo.js:134-135`): si un producto pasa `color`, ese gana sobre el CSS. Ninguno debe estar EFFECTUANDO en los nueve sin cambiar. El objetivo de diseño es que los nueve se vean como la misma aplicación con un color distinto. |

---

## 5. Recorridos E2E

#### `REG-E2E-01` — Recorrido por los nueve productos

| | |
|---|---|
| **ID** | `REG-E2E-01` |
| **Tipo / Prioridad** | `E2E` · `P0` |
| **Precondición** | Organización con acceso a los nueve |
| **Pasos** | 1. Entrar a Citas por el subdominio.<br>2. Recorrer sus 7 paneles con clics.<br>3. Saltar a Espacios con el enlace de `Mis otras herramientas`.<br>4. Recorrer sus 6 paneles.<br>5. Repetir por los nueve, en el orden del índice de la sección 1. |
| **Esperado** | Los **37 paneles** cargan datos al hacer clic, ninguno queda en blanco. Ninguna consola con errores. La sesión no se cae entre productos: son 15 minutos de sesión por producto, y el recorrido entero debe caber en uno con pasos rápidos. Si la sesión expira en medio, anotar dónde y seguir. |

#### `REG-E2E-02` — La sesión de un producto no-filtera a otro

| | |
|---|---|
| **ID** | `REG-E2E-02` |
| **Tipo / Prioridad** | `E2E` · `SIST` · `P0` |
| **Precondición** | Sesión iniciada en Citas |
| **Pasos** | 1. Crear un cliente `QA Compartido` en Citas.<br>2. Saltar a CRM y buscar `QA Compartido`.<br>3. Saltar a Solicitudes y abrir un registro nuevo.<br>4. Volver a Citas. |
| **Esperado** | El cliente de Citas **no** aparece en CRM: cada producto tiene su base y su alcance, y Citas no comparte catálogo con CRM. Un dato que aparece en dos productos es una fuga de datos entre organizaciones o un error de diseño que hay que documentar. El nombre de la organización es lo único común. |

#### `REG-E2E-03` — El core de navegación entre secciones, en un solo producto

| | |
|---|---|
| **ID** | `REG-E2E-03` |
| **Tipo / Prioridad** | `E2E` · `P0` |
| **Precondición** | Un producto con ≥4 paneles, datos en todos |
| **Pasos** | 1. Recorrer todos los paneles con clic.<br>2. Repetir con la flecha atrás, desde el último al primero.<br>3. Abrir cada panel con `?panel=` directo.<br>4. Combinar: entrar por URL a un panel del medio, luego hacer clic a otro, luego atrás. |
| **Esperado** | Los tres caminos dan el mismo resultado: panel con datos. Si el clic funciona y la URL no (o al revés), hay dos caminos distintos en el shell y uno está roto. Este es el recorrido que hay que hacer en **cada** producto antes de desplegar cualquier cambio en el shell. |

#### `REG-E2E-04` — Caducidad de sesión a mitad del recorrido

| | |
|---|---|
| **ID** | `REG-E2E-04` |
| **Tipo / Prioridad** | `E2E` · `SIST` · `P0` |
| **Precondición** | Sesión iniciada |
| **Pasos** | 1. Navegar hasta que pasen 15 minutos.<br>2. En la mitad de un formulario, disparar la acción que guarda.<br>3. Reingresar.<br>4. Reintentar la acción. |
| **Esperado** | 1. Al vencer, la acción devuelve `401` y el navegador va al login: **correcto**. 2. Al reingresar, lo que la persona había escrito **se conserva** o el aviso es claro de que no. Un formulario que se vacía al perder la sesión hace perder trabajo. Anotar qué producto vacía y cuál conserva: es un dato de usabilidad, no de seguridad. |

#### `REG-E2E-05` — Cambios en el shell, medidos en los nueve

| | |
|---|---|
| **ID** | `REG-E2E-05` |
| **Tipo / Prioridad** | `E2E` · `REG` · `P0` |
| **Precondición** | Un cambio hecho en `amigo.js`, `amigo-ui.js` o `amigo.css` |
| **Pasos** | 1. Antes de tocar nada, ejecutar `REG-E2E-01` en los nueve y guardar capturas de los nueve tableros.<br>2. Aplicar el cambio.<br>3. Repetir `REG-E2E-01` completo.<br>4. Comparar capturas. |
| **Esperado** | La única diferencia es la buscada. Cualquier otra diferencia en un producto es una regresión. Este es el caso de uso que justifica el documento: **sin la foto previa no hay forma de saber qué se rompió.** |

---

## 6. Regresión compartida

Esta sección se solapa con el contenido del documento. Lo que aquí se registra es **qué parte
del shell cubre cada archivo de tests automatizados**, para saber qué está protegido por CI y
qué depende de una persona ejecutando este plan.

| Capa | ¿Hay test que la cubra? | Qué lo cubre |
|---|---|---|
| `amigo.js` — navegación | **No.** Solo hay pruebas de UI de Citas en jsdom. | `REG-NAV-01` a `REG-NAV-12` |
| `amigo.js` — cuenta y herramientas | **No** | `REG-NAV-09`, `REG-NAV-10`, `REG-NAV-11` |
| `amigo-ui.js` — `fecha` y zona | Sí: `packages/product-runtime/tests/time.test.ts` (12 casos) | `REG-UI-04`, `REG-UI-05` |
| `amigo-ui.js` — dinero | Sí: `packages/core/tests/frontendMoney.test.ts` recorre los nueve `app.js` y falla si alguien convierte un monto en el frontend | `REG-UI-03` |
| `amigo-ui.js` — tablas y estados | **No** | `REG-UI-01`, `REG-UI-02`, `REG-UI-06` |
| `crudRouter` | Sí, en los tests de cada producto | `REG-CRUD-01` a `REG-CRUD-10` |
| Sesión y SSO | Sí, en `packages/auth-client` | `REG-SES-01` a `REG-SES-08` |
| `amigo.css` | **No.** Ningún test mide geometría. | `REG-CSS-01` a `REG-CSS-06` |

**El hueco grande: `amigo.js` y `amigo.css` no tienen ninguna cobertura automatizada.** Son las
dos capas donde un error se multiplica por nueve, y las dos que más daño han hecho. La
recomendación que sale de este plan es escribir un test de navegación en jsdom para los nueve,
similar al que ya existe en `products/citas/tests/ui.test.ts`: cargar el `index.html` real,
evaluar los tres scripts reales y afirmar que **clic en cada pestaña provoca al menos una
llamada a `/api/`**. Eso convierte `REG-NAV-01` de un caso manual a una comprobación de cada
push.

---

## 7. Riesgo conocido

| # | Severidad | Hallazgo | Dónde | Cómo se confirma |
|---|---|---|---|---|
| `R-S-01` | Crítica | **Sin layout móvil.** `.ui-canal` declara `grid-area: canal` y las áreas móviles de `.ui` no definen `canal`. Medido: `350.4px 0px 132.137px` y `scrollWidth` 482 px con viewport 390. Afecta a los nueve. El arreglo mínimo apila 700 px y no es aceptable: hace falta un cajón con hamburguesa, que es funcionalidad nueva. | `amigo.css:139,153` | `REG-CSS-01`, `REG-CSS-03` |
| `R-S-02` | Crítica | **Sin CSP.** `helmet` está instalado con `contentSecurityPolicy: false`. No hay política de seguridad de contenido en ninguno de los nueve. | `app.ts:95` | `REG-ERR-04` |
| `R-S-03` | Alta | **JSON malformado devuelve `500`** en lugar de `400`: el error de parseo no se traduce al manejador. Afecta a los nueve. | `app.ts:96`, `errors.ts:27-40` | `REG-ERR-02` |
| `R-S-04` | Alta | **El límite de tasa se instala antes de `/health`**, así que las sondas de salud consumen el presupuesto de 600/15 min. Una sonda cada segundo agota el límite en 15 minutos. | `app.ts:99-106,117-118` | `REG-SES-08` |
| `R-S-05` | Media | **El shell no lee el rol.** No hay un mecanismo común para ocultar acciones por rol: cada producto lo hace por su cuenta o no lo hace. El resultado es que hay productos que esconden botones y productos que los muestran y dejan que el `403` los reprima. La comparación entre los nueve da la lista. | `amigo.js` no consulta el rol | `REG-SES-05` |
| `R-S-06` | Media | **Contrato de lista único y fácil de romper**: `{ items, total, limit, offset }`. Es la causa del defecto crítico original y la forma más rápida de dejar un panel mudo. Cualquier ruta montada con `crudRouter` que devuelva otra envoltura es crítica. | `crud.ts:248` | `REG-CRUD-01` |
| `R-S-07` | Media | **Caché `immutable` sin huella**: si un estático se sirve sin `?v=`, los navegadores que ya lo tenían cacheado no reciben el arreglo del shell nunca. Un arreglo del shell puede ser invisible en producción durante meses. | `app.ts:150-165` | `REG-ERR-05` |
| `R-S-08` | Media | **El formateo de dinero no es uniforme** en el portfolio: hay al menos dos formatos distintos. Se ve como descuido, no como bug. | `AMIGO_UI.dinero` y los `app.js` | `REG-UI-03` |
| `R-S-09` | Media | **Un `PATCH` con un campo desconocido se comporta de dos maneras**: en unas rutas da `400 Campo desconocido` y en otras se descarta en silencio. El usuario cree que guardó. Hay que mapear cuál es cuál. | `crud.ts:132` | `REG-CRUD-08`, `REG-CRUD-10` |
| `R-S-10` | Baja | Avisos que se ocultan solos a los ~5 s: un error puede escaparse de una revisión visual rápida. Mirar consola y Network, no solo la barra. | `amigo-ui.js:270-278` | `REG-UI-08` |
| `R-S-11` | Baja | Sin `favicon.ico` en ninguno de los nueve, si ninguno lo declara. Icono roto en las nueve pestañas. | — | `REG-ERR-06` |
| `R-S-12` | Baja | La cookie de sesión es `HttpOnly` y el `state` del OAuth se valida contra redirecciones fuera de sitio (`isSafeReturnTo` rechaza `//` y `\`), lo que está bien. Anotado para que quede constancia de que se revisó. | `auth-client/src/login.ts:39-43` | `REG-SES-02` |
| `R-S-13` | Baja | `limit` con tope 1000 y `total` que no coincide con las filas devueltas. Ninguna lista tiene paginador, así que cualquier producto que pase su `total` por alto tiene un truncamiento silencioso. | `crud.ts:166-174` | `REG-CRUD-02`, `REG-CRUD-03` |

---

## 8. Checklist visual

Se ejecuta en los nueve. Para no repetirlo nueve veces, se hace en un producto y se confirma en
los demás, anotando cualquier diferencia.

| # | Qué | Cómo | Esperado |
|---|---|---|---|
| `REG-VIS-01` | Sin desborde horizontal | `scrollWidth` a 390 × 844 | `<= 390`. Hoy falla en los nueve |
| `REG-VIS-02` | Todas las secciones alcanzables en móvil | Recorrer el canal a 390 px | Las 37 secciones alcanzables. Hoy el canal está cortado |
| `REG-VIS-03` | Sin salto de layout entre anchos | 320 → 1400 px | Sin scroll horizontal en ningún corte |
| `REG-VIS-04` | Rejillas de KPI | Tableros a 640, 1000 y 1100 px | Sin desborde con cifras largas |
| `REG-VIS-05` | Diálogos | Abrir cada `<dialog>` | Centrado, foco dentro, `Esc` cierra, fondo no desplazable |
| `REG-VIS-06` | Foco visible | Recorrer con `Tab` | Anillo de foco visible en todo elemento interactivo |
| `REG-VIS-07` | Contraste del acento | Medir `--acento` sobre el fondo | `>= 4.5:1` para texto. En Citas mide 4.49:1 |
| `REG-VIS-08` | Consola limpia | Filtro `error` durante el recorrido completo | Cero errores |
| `REG-VIS-09` | Una petición por acción | Network durante el recorrido | Una por cambio de pestaña, una por alta |
| `REG-VIS-10` | Estados distinguibles | Filtrar en escala de grises | Los estados se distinguen por texto o forma, no solo por color |

---

## 9. Registro

**Ejecución 2026-10-06 · entorno:** producción `*.amgdeveloper.cl` (Cloudflare + nginx), cuenta `demo@talleres.com` (rol `owner`), organización "Talleres El Mecanico" (`id_b507f1ef7cb144d49f40`).
**D1** = `owner`. **D2** = navegador `America/Santiago` vs organización `America/Mexico_City` (zona distinta ✅, casos de fecha válidos). **D3** = 9 herramientas en `/api/inicio`; el canal lista 8 (excluye la actual ✅).
**Convención de esta vuelta:** `PASA` = comportamiento observado igual al esperado; `FALLA` = desviación confirmada; `PARCIAL` = la intención del caso se cumple pero la letra no (o falta evidencia en un paso); `N/A` = el producto no aplica el caso.

### 9.1 Navegación y shell por producto

| Producto | `REG-NAV-01` | `REG-NAV-04` | `REG-CSS-01` | `REG-UI-03` | Consola | Nota |
|---|---|---|---|---|---|---|
| Citas | FALLA | FALLA | FALLA | PASA | Limpia (solo favicon 404) | Clic en pestaña = 0 peticiones `/api/`; paneles clientes/servicios/profesionales quedan vacíos sin texto de vacío (regresión original viva en prod). Atrás/adelante repite el defecto. `amigo.css`/`app.js` con `?v=3f944c182b06c5bf306f`. |
| Espacios | PARCIAL | PARCIAL | FALLA | PASA | Limpia | 0 peticiones por clic, pero prefetch al cargar (`spaces`,`customers`,`addons`) y los paneles **sí** pintan. Sin síntoma de panel vacío. |
| Solicitudes | PARCIAL | PARCIAL | FALLA | PASA | Limpia | 0 peticiones por clic; paneles con datos (KPIs 5/5/5 + tabla). `/api/requests` = `{requests,total}` (ruta propia, no `crudRouter`). |
| Inventario | PASA* | PASA* | FALLA | FALLA | Limpia | `INV-NAV-02` es diseño: `montar` sin `alEntrar`, 0 peticiones por clic **y** paneles con contenido desde `cargar()`. *Pasa el criterio de "sin panel vacío". Dinero KPI: `$ 14.530` ≠ shared `$14.530`. |
| Cotizaciones | PARCIAL | PARCIAL | FALLA | PARCIAL | Limpia | Paneles con datos (prefetch `quotes`+`dashboard`). KPI "En la mesa" pinta `totalCents` crudo (`4959600`). Tablas usan `dinero` shared. |
| CRM | FALLA | PARCIAL | FALLA | N/A | Limpia | 0 peticiones por clic; panel Clientes **vacío hasta que se busca** (sin estado de vacío). Tablero con KPIs OK. Sin montos. |
| Activos | PARCIAL | PARCIAL | FALLA | FALLA | Limpia (aviso autocomplete) | Prefetch `assets`+`dashboard`; tablero con KPIs. Montos: `$ 202.796,00` ≠ shared. |
| Checklists | PARCIAL | PARCIAL | FALLA | N/A | Limpia | Prefetch `templates`+`runs`; tablero OK. Ajustes: "Este producto no maneja importes". |
| Pagos | PARCIAL | PARCIAL | FALLA | FALLA | Limpia | Prefetch `charges`+`dashboard`+`saldos`; tablero OK. Montos: `$ 120,00` ≠ shared. **`Salir` roto** (ver REG-SES-07). Ráfaga provocó 429 + 503 + episodio transitorio de 404 en todas las rutas API (recuperó al recargar). |

\* Inventario: la letra de `REG-NAV-01` exige "al menos una petición a `/api/`" por clic; el plan del producto (`INV-NAV-02`) documenta que **0 peticiones** es el diseño correcto allí. Se registra PASA por producto, FALLA como caso de shell.

### 9.2 Casos del documento

| ID | Resultado | Evidencia | Nota |
|---|---|---|---|
| `REG-NAV-01` | FALLA (citas, crm) / PARCIAL (resto) | Recorrido de pestañas con instrumentación `performance` en los 9 productos | Citas y CRM: paneles sin datos al clic. Resto: 0 requests/clic pero datos por prefetch o rendering diferido. |
| `REG-NAV-02` | PASA | Raíz de citas pintó agenda con KPIs y tabla en la primera carga | Camino inicial funciona. |
| `REG-NAV-03` | PARCIAL | `?panel=clientes` carga y trae `/api/customers` (200, 18 items) pero el panel queda vacío | La URL cambia y el fetch ocurre; el render no. En espacios/inventario/cotizaciones/etc. el deep-link sí muestra datos. |
| `REG-NAV-04` | FALLA (citas) / PASA (resto) | Citas: atrás/adelante sin nuevas peticiones y paneles vacíos; resto: paneles con datos en caché | Mismo defecto raíz que NAV-01 en citas. |
| `REG-NAV-05` | PASA | `?panel=inventado`, `?panel=` y `?panel=%22%3E%3Cimg...` caen a `agenda`, sin XSS ni error | `panelDeUrl` filtra claves declaradas. |
| `REG-NAV-06` | PASA | `<h1>` = texto de la pestaña en los 9 | |
| `REG-NAV-07` | PASA | Exactamente un `[aria-current="page"]` tras cada clic | |
| `REG-NAV-08` | PASA | Exactamente un `[data-panel]` sin `hidden` | |
| `REG-NAV-09` | PASA | Canal: 8 enlaces de herramientas, sin el producto actual; clic a espacios → `espacios.amgdeveloper.cl` con sesión | |
| `REG-NAV-10` | PASA | Footer = `usuario`/`correo`/`empresa`/`avatar` de `/api/inicio`; `Salir` → `/auth/logout` | En soliciudes e inventario `/api/inicio` incluye `rol` y `organizacion` (forma descrita en sus planes). |
| `REG-NAV-11` | PARCIAL | "Talleres El Mecanico" → avatar `TM` (relleno "El" excluido ✅) | No se renombró la org para los demás escenarios. |
| `REG-NAV-12` | PASA | Con `/api/inicio` bloqueado: agenda carga datos, cero errores, footer con guiones parciales | `usuario`/`correo`/`empresa` quedan vacíos (no "–"); avatar sí "–". |
| `REG-UI-01` | PASA | Tabla agenda: `thead`+`tbody`+`.ui-tabla-scroll`, 5 columnas | Misma geometría que en inventario/espacios. |
| `REG-UI-02` | PASA | Búsqueda "zzz" en agenda → fila vacía `colspan=5`, texto "No hay citas para este día." | |
| `REG-UI-03` | FALLA | Shared: `dinero(1234567)=$12.345,67`, `dinero(15000)=$150`. Inventario KPI `$ 14.530`; activos `$ 202.796,00`; pagos `$ 120,00` | Tres formatos visibles en el portfolio. Cotizaciones KPI pinta cents crudos. Confirma R-S-08. |
| `REG-UI-04` | FALLA | `fecha('2026-10-06T04:00:00Z', true, 'America/Mexico_City')` = "6 oct 2026 01:00 a. m." (zona del navegador); el valor correcto es "5 oct 22:00" (`toLocaleString('es-MX',{timeZone})`) | **El tercer argumento de zona no funciona en el bundle desplegado.** P0: invalida toda la estrategia de fechas por organización. |
| `REG-UI-05` | PARCIAL | Sin ejecutar el barrido estático de los 9 `app.js` en esta vuelta | Cubierto por `frontendMoney.test.ts` solo para dinero. |
| `REG-UI-06` | PASA | Citas `ESTADOS`: confirmed/pending/done/cancelled/no_show traducidos con tonos ok/aviso/acento/neutro/malo; sin claves crudas | |
| `REG-UI-07` | BLOQUEADO | Requiere sesión caducada; `Salir` roto impide provocar el corte a voluntad | Queda para la vuelta con logout arreglado o esperando los 15 min. |
| `REG-UI-08` | PASA | `AMIGO_UI.avisar(...,'error')` → visible a los 200 ms, `display:none` a los 5200 ms | |
| `REG-UI-09` | PASA | KPIs de agenda sin desborde a 502/642/902/1002 px (`scrollWidth==clientWidth`) | Viewport mínimo del entorno: 502 px (DPR 1.25). |
| `REG-CRUD-01` | PASA | `customers`,`services`,`staff`,`spaces`,`items`,`templates`,`runs`,`charges`,`quotes`,`assets`,`requests`* | Todos `{items,total,limit,offset}` excepto: `requests` = `{requests,total}` (documentado), `movements` = `{movements}` (sin envoltorio, hallazgo nuevo), `settings`/`dashboard`/`saldos` = rutas propias. *solicitudes. |
| `REG-CRUD-02` | PASA | `customers?limit=5` → `total=18`, `items=5`, `offset=0` | |
| `REG-CRUD-03` | PARCIAL | `limit=5000`→`limit=1000` ✅; `limit=0`→`limit=200` (default) ✅; `limit=-5`→ responde `limit:-5` con las 18 filas | El envoltorro ecoa `-5` sin normalizar. |
| `REG-CRUD-04` | PARCIAL | `q=sofia.mejia` encuentra por email ✅ (2 filas). Servicios: `description=null` en datos demo → no se pudo probar el negativo | |
| `REG-CRUD-05` | FALLA | `order=asc` y `order=desc` devuelven la **misma** lista completa (19 filas idénticas). `offset=9999`→`items=[]`,`total=18` ✅. Paginación 0/3 sin solapes ✅ | El parámetro `order` no tiene efecto en `customers`. |
| `REG-CRUD-06` | PARCIAL | Citas `POST /api/customers` → `201` fila plana con `id`,`organizationId`,… y `GET /:id` devuelve la misma fila ✅ | Cotizaciones `GET /:id` = `{quote,lines}` (envuelto); pagos `POST /api/charges` → `200` `{charge}` (no 201 plano). |
| `REG-CRUD-07` | FALLA | GET/PATCH/DELETE inexistente → `404 {"error":"No encontrado"}` (no `"No existe"`) | Mensaje uniforme en los productos probados (citas, pagos); el plan Doc 10 esperaba otro texto. Los planes de producto (INV-API-03) sí dicen "No encontrado". |
| `REG-CRUD-08` | PASA | POST campo inventado → `400 "Campo desconocido"` + `errors.formErrors` (zod). `archivedAt`/`createdAt`/`organizationId` en POST y PATCH → `400` | Uniforme en customers. En charges: `totalCents`/`paidCents` se **descartan en silencio** (`200`), `amountCents` da `409` de negocio → confirma R-S-09. |
| `REG-CRUD-09` | PARCIAL | Customers `DELETE` → `200 {ok:true,archived:true}`; GET posterior `200` con `archivedAt` ✅. Charges `DELETE` → hard delete (`deleted:true`, GET `404`) ✅ | **Hallazgo:** el listado de customers muestra el registro archivado con `archivedAt:null` → el borrado parece no funcionar. |
| `REG-CRUD-10` | PASA | Cotizaciones PATCH `status` → `200` y status sigue `draft` (descarte documentado). Inventario no tiene `quantity` writable en PATCH (400 Campo desconocido vía customers como referencia) | Comportamiento descrito en el plan: descarte ≠ rechazo. |
| `REG-SES-01` | PARCIAL | 9/9 `401 {"error":"sin-sesion","loginUrl":…}` | **Falta el campo `message`** que el caso exige. |
| `REG-SES-02` | PASA | Raíz sin sesión → `302` a `desarrollo.amgdeveloper.cl/api/sso/authorize?...return_to=<producto>` | Tras login el Core devuelve al producto ✅ (flujo completo verificado en navegador). |
| `REG-SES-03` | FALLA | `/`,`/app.js`,`/style.css` → 302 en 9/9; **`/amigo.css` → 200 público en cotizaciones, crm y activos** (`immutable`, `cf-cache-status:HIT`) | Fuga del shell compartido vía CDN en 3 productos. |
| `REG-SES-04` | PASA | `/health` GET+POST `200`; `/api/meta` 200; `/auth/callback` sin code → 400 HTML legible; `/auth/logout` → `302` al Core | |
| `REG-SES-05` | BLOQUEADO | Solo hay cuenta `owner` | Falta cuenta `member`. |
| `REG-SES-06` | BLOQUEADO | Solo hay una organización | Parcial: todos los objetos probados traen `organizationId` de la org propia. |
| `REG-SES-07` | FALLA | Clic Salir → `302` `desarrollo.amgdeveloper.cl/api/logout?redirect=…` → **`404 {"error":"No existe GET /api/logout"}`** (POST idem). La sesión del producto **sigue viva** tras el flujo | Core no monta ruta de logout. Rompe REG-SES-07 y REG-UI-07 en los nueve. |
| `REG-SES-08` | PARCIAL | Ráfaga en pagos: `429` con `ratelimit:"600-in-15min"; r=0` y cuerpo **plain text** "Too many requests, please try again later."; 23×`503`; episodio transitorio de `404` en todas las rutas API (recuperó al recargar) | Headers draft-7 presentes ✅. **El límite no es uniforme:** pagos mostró `"1000-in-15min"` en una ventana previa y `"600-in-15min"` al agotarse; citas mostró 600. |
| `REG-ERR-01` | PARCIAL | 400 junk → `{error:"Datos inválidos",errors:{formErrors,fieldErrors}}` ✅. 404 → `{error}` con mensaje "No encontrado". 500 JSON malformado → `{error:"Error interno del servidor"}` (sin stack) ✅ | **409 duplicado no existe:** POST mismo nombre en customers → `201` (sin restricción de unicidad). |
| `REG-ERR-02` | FALLA | POST `{` → `500 {"error":"Error interno del servidor"}` | Confirma R-S-03 en producción. |
| `REG-ERR-03` | FALLA | POST 2 MB → `413` con **HTML de nginx**, no `{ "error": "La petición es demasiado grande" }` | El límite existe; la forma del error no. |
| `REG-ERR-04` | PASA | Sin `Content-Security-Policy` ✅. HSTS, `nosniff`, `SAMEORIGIN`, `Referrer-Policy` presentes | `X-Content-Type-Options` y `X-Frame-Options` **duplicados** (`nosniff, nosniff`); `Referrer-Policy` con dos políticas concatenadas. Sin `Set-Cookie` en respuestas API (cookie solo en login). |
| `REG-ERR-05` | PARCIAL | Scripts con huella `?v=3f944c182b06c5bf306f` ✅; `/amigo.css` y `/app.js` con sesión: `immutable` 1 año | No se verificó `no-cache` del HTML en esta vuelta. |
| `REG-ERR-06` | PASA | `/favicon.ico` → 404 en los 9 | |
| `REG-CSS-01` | FALLA | A ≤642 px: `.ui` con áreas `"topbar" "main"` (sin `canal`); canal en columna implícita (137–232 px de ancho, 829–984 px de alto), sin hamburguesa. Desborde horizontal no reproducible (ventana mín. 502 px) | Confirma R-S-01 estructuralmente; el número del plan (482@390) no se pudo medir por límite de ventana. |
| `REG-CSS-02` | FALLA | Mismo dato: `gridTemplateAreas` móvil no declara `canal` aunque `.ui-canal` tiene `grid-area: canal` | |
| `REG-CSS-03` | PARCIAL | Canal apilado mide ~829–984 px en móvil (orden de magnitud del "700 px" documentado) | No se probó el arreglo mínimo (es cambio de diseño, no de test). |
| `REG-CSS-04` | PASA | Sin scroll horizontal a 502/642/902/1002 px | A ≥902 px las áreas `"canal topbar" "canal main"` están declaradas y el layout es correcto. |
| `REG-CSS-05` | BLOQUEADO | El MCP no permite emular `prefers-reduced-motion` / `prefers-contrast` | Verificación estática pendiente en `amigo.css`. |
| `REG-CSS-06` | PASA | `--acento` por producto: citas `#c2571a`, espacios `#1a7f5a`, solicitudes `#4f46e5`, inventario `#2f6fd0`, cotizaciones `#b0403a`, crm `#7a4bb8`, activos `#a16207`, checklists `#0e7490`, pagos `#b02a72` | |
| `REG-E2E-01` | FALLA | Recorrido de los 9 por canal: la sesión no se cae y los tableros cargan, pero **clic en pestaña no refresca datos** en citas/crm y en el resto no pide red | 37 paneles: no quedan en blanco en 7/9 por prefetch; citas/crm sí quedan parciales. |
| `REG-E2E-02` | PASA | Cliente `QA Compartido` creado en citas (`201`,`cicliente_03dcc…`); CRM `/api/customers?q=QA%20Compartido` → 0; UI tampoco lo muestra | Aislamiento de catálogos entre productos confirmado. |
| `REG-E2E-03` | FALLA | En citas: clic / atrás-adelante / `?panel=` no dan el mismo resultado (solo agenda pinta datos) | Dos caminos con distinto resultado = defecto del shell. |
| `REG-E2E-04` | BLOQUEADO | Requiere esperar 15 min o logout funcional | Logout roto (REG-SES-07). |
| `REG-E2E-05` | N/A | Es el protocolo de cambio de shell; no hay cambio que comparar en esta vuelta | La tabla 9.1 funciona como línea base para el próximo cambio en `amigo.js`/`amigo.css`. |
| `REG-VIS-01` | FALLA | Igual que REG-CSS-01 (defecto de grid móvil) | |
| `REG-VIS-02` | FALLA | En móvil el canal queda en columna lateral angosta (137 px) sin hamburguesa; secciones no alcanzables cómodamente | |
| `REG-VIS-03` | PARCIAL | Sin salto horizontal en cortes probados | No se barrió 320→1400 completo. |
| `REG-VIS-04` | PASA | KPIs sin desborde en los anchos probados | |
| `REG-VIS-05` | PARCIAL | `#dlg` abre centrado, foco en `button.ui-cerrar` (dentro), Esc cierra | **Body no queda bloqueado** (`overflow:visible`) → fondo desplazable. |
| `REG-VIS-06` | PARCIAL | Foco inicial en enlace del canal; Esc devuelve foco a `BODY` | No se barrió `Tab` completo. |
| `REG-VIS-07` | FALLA | `--acento` citas `#c2571a` sobre `#f7f6f3` → **4.16:1** (< 4.5) | El plan ya anticipaba 4.49; medido 4.16 con este fondo. |
| `REG-VIS-08` | PARCIAL | Consolas limpias salvo favicon 404 y avisos de autocomplete | Los avisos auto-ocultos (REG-UI-08) pueden ocultar errores visuales. |
| `REG-VIS-09` | FALLA | Una petición por acción: los clics de pestaña no generan ninguna | En inventario el diseño es 0 por clic (documentado). |
| `REG-VIS-10` | PARCIAL | Estados de citas tienen etiqueta + tono (no solo color) | No se filtró a escala de grises. | |