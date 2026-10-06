# Convenciones para los planes de prueba funcional

Este directorio contiene la ruta de prueba de cada SaaS del monorepo. El objetivo es que
alguien (o un agente con Chrome DevTools) pueda **ejecutar** los casos sin volver a leer el
código del producto, y que el resultado sea comparable entre productos.

Los planes se **diseñan**, no se ejecutan. Cada caso dice qué hacer y qué se espera, no
qué se observó.

---

## 1. Tipos de prueba (se usan en la columna `Tipo`)

| Tipo | Qué significa aquí | Cuándo aplica |
|---|---|---|
| `FUNC` | Pruebas funcionales. Una función contra su resultado esperado. | El grueso de los casos: cada CRUD, cada validación, cada cálculo. |
| `E2E` | Recorrido completo de principio a fin, cruza varios módulos. | El flujo de dinero del producto: crear → confirmar → facturar. |
| `REG` | Regresión. Verifica que algo que ya funcionaba no se rompió. | Todo lo que toca código compartido (`amigo.js`, `amigo-ui.js`, `amigo.css`, `crudRouter`, SSO). |
| `SIST` | Pruebas de sistema. El producto completo, incluyendo la sesión y el aislamiento entre organizaciones. | Login, expiración de sesión, logout, aislamiento multi-org, límites de tasa. |
| `EXP` | Exploratorias. Se navega buscando lo que no está definido. | Se registran como hallazgo, no como caso con esperado fijo. |

Prioridades: `P0` bloquea el uso del producto · `P1` afecta una función · `P2` cosmético o
de configuración.

---

## 2. Anatomía de un caso

Cada caso es una tabla de dos columnas con las filas fijas siguientes, en este orden:

- **ID** — `PROD-AREA-NN`. Ejemplo: `INV-ART-03`, `SOL-EST-01`, `CRM-E2E-02`.
- **Tipo / Prioridad**
- **Precondición** — qué debe existir antes. Si depende de un caso anterior, se referencia por ID.
- **Pasos** — numerados. Cada paso debe ser accionable sin Suposiciones: se citan el texto
  visible del botón, el `id` del campo y la URL.
- **Esperado** — el resultado observable, con el dato exacto cuando se puede (ej. "3 filas",
  "HTTP 400 con `Stock insuficiente`").

Reglas de redacción:

1. **Citar el selector real.** `id="nuevo"`, `data-tab="articulos"`, texto del botón. Nunca
   "el botón de la esquina".
2. **Un caso, un resultado esperado.** Si un caso verifica tres reglas, son tres casos.
3. **Los números van con unidad.** "Cantidad 5", "$ 120" (no "el precio"), "HTTP 201".
4. **Nada de "funciona bien".** Se describe qué se ve.
5. **Si el resultado depende del servidor, se dice.** "GET /api/quotes responde 200 con
   `total: 51`".

---

## 3. Estructura obligatoria de cada documento de producto

```
# Plan de pruebas — <nombre del producto>

## 1. Ficha técnica        slug, dominio, puerto, script, ruta local, roles
## 2. Datos de prueba      qué sembrar antes de empezar y cómo
## 3. Precondiciones       login, sesión de 15 min, qué hacer si expira
## 4. Casos por módulo     el grueso del documento
## 5. Recorridos E2E       flujos completos
## 6. Regresión compartida  lo que este producto debe cumplir del shell común
## 7. Riesgo conocido      candidatos a defecto encontrados al leer el código
## 8. Checklist visual     responsive, consola, accesibilidad
## 9. Registro             tabla vacía para llenar al ejecutar
```

Las secciones 7 y 9 no son opcionales. La 7 es lo que justifica revisar el código antes de
probar; la 9 es lo que convierte el plan en evidencia.

---

## 4. Alcance por producto

Cada producto tiene dos capas que no se deben confundir:

- **Lo que la UI permite hacer.** Es lo que se prueba en Chrome.
- **Lo que la API permite hacer.** Va en los casos `FUNC` de la API, con forma de resposta
  y código de estado exactos. Aunque no haya UI para algo, se prueba: la ausencia de UI es
  un hallazgo, no una excepción.

Criterio de qué va en cada tipo:

| Situación | Dónde se prueba |
|---|---|
| Botón, enlace o campo visible | Caso `FUNC` del módulo, en Chrome. |
| Regla que el servidor impone (roles, validaciones, solapamientos) | Caso `FUNC` de API **y** caso de UI que la intenta. |
| Ruta de API sin UI | Caso `FUNC` de API. Anotar "sin UI" en riesgo conocido. |
| Botón en UI sin ruta | Caso `FUNC` de UI. Anotar el 404 esperado. |
| Código compartido | Sección 6, como `REG`. |

---

## 5. Reglas de la sesión

Estas aplican a todos los productos yexplain el 80% de los falsos positivos.

1. **La sesión dura 15 minutos.** Al expirar, `/api/*` responde `401 {"error":"sin-sesion",
   "loginUrl":...}` y el navegador salta al login del Core. No es un bug del producto.
   Volver a entrar y anotar en el registro que hubo corte.
2. **Nunca pedir credenciales.** El tester las tipea. La sesión se crea desde el Core
   (`desarrollo.amgdeveloper.cl`, puerto 3108), que es el emisor de SSO por diseño.
3. **Login directo a un subdominio redirige al Core.** Si el producto abre el login de
   entrada, es el flujo correcto, no un error de Auth.
4. **Límite de tasa: 600 peticiones / 15 min por IP.** Un caso que recorra la tabla entera
   más un recargado de página puede agotarlo. El `429` que aparece no es un defecto del
   producto; se anota y se espera.
5. **Aislamiento entre organizaciones.** Cualquier creación de datos debe ir con sufijo
   identificable (`QA-<producto>-<fecha>`) para poder limpiar al final sin ambigüedad.

---

## 6. Checklist visual (sección obligatoria de cada producto)

Se hace una vez por producto, con el viewport que se indica.

| Qué | Viewport | Cómo se comprueba |
|---|---|---|
| El canal lateral no desborda | 390 × 844 | `document.documentElement.scrollWidth` ≤ 390 |
| Hay forma de llegar a todas las secciones | 390 × 844 | Enlace o botón por cada pestaña |
| Los formularios no se salen | 390 × 844 | Ningún campo con `scrollWidth > 390` |
| La tabla no rompe el layout | 1280 × 800 | Sin scroll horizontal si la tabla es angosta |
| Consola sin errores | cualquier | Panel de consola, filtro `error` |
| Las peticiones esperadas happening | cualquier | Panel Network: una petición por acción |

El criterio de scroll horizontal es el que más défauts ha encontrado: `scrollWidth` mayor que
el viewport es un fallo de diseño, no un detalle.

---

## 7. Índice de productos

| Documento | Producto | Dominio |
|---|---|---|
| `01-citas.md` | Citas | `citas.amgdeveloper.cl` |
| `02-espacios.md` | Espacios | `espacios.amgdeveloper.cl` |
| `03-solicitudes.md` | Solicitudes | `solicitudes.amgdeveloper.cl` |
| `04-inventario.md` | Inventario | `inventario.amgdeveloper.cl` |
| `05-cotizaciones.md` | Cotizaciones | `cotizaciones.amgdeveloper.cl` |
| `06-crm.md` | CRM | `crm.amgdeveloper.cl` |
| `07-activos.md` | Activos | `activos.amgdeveloper.cl` |
| `08-checklists.md` | Checklists | `checklists.amgdeveloper.cl` |
| `09-pagos.md` | Pagos | `pagos.amgdeveloper.cl` |
| `10-regresion-compartida.md` | Shell común a los 9 | — |
| `00-CONVENCIONES.md` | Este documento | — |