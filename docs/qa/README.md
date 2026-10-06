# Planes de prueba de la suite SaaS

Rutas de prueba funcionales de los nueve productos y de la capa que comparten.
**770 casos** en 11 documentos.

Estos planes están **diseñados, no ejecutados**. Cada caso dice qué hacer y qué se espera,
no qué se observó. La columna `Resultado` de la sección 9 de cada documento está vacía
a propósito: se llena cuando se ejecutan.

---

## 1. Documentos

| Documento | Producto | Paneles | Casos |
|---|---|---|---|
| [`00-CONVENCIONES.md`](00-CONVENCIONES.md) | Cómo se escribe un plan de prueba | — | — |
| [`01-citas.md`](01-citas.md) | Citas · `citas.amgdeveloper.cl` | 7 | 71 |
| [`02-espacios.md`](02-espacios.md) | Espacios · `espacios.amgdeveloper.cl` | 6 | 70 |
| [`03-solicitudes.md`](03-solicitudes.md) | Solicitudes · `solicitudes.amgdeveloper.cl` | 2 | 79 |
| [`04-inventario.md`](04-inventario.md) | Inventario · `inventario.amgdeveloper.cl` | 3 | 90 |
| [`05-cotizaciones.md`](05-cotizaciones.md) | Cotizaciones · `cotizaciones.amgdeveloper.cl` | 3 | 115 |
| [`06-crm.md`](06-crm.md) | CRM · `crm.amgdeveloper.cl` | 5 | 68 |
| [`07-activos.md`](07-activos.md) | Activos · `activos.amgdeveloper.cl` | 3 | 67 |
| [`08-checklists.md`](08-checklists.md) | Checklists · `checklists.amgdeveloper.cl` | 4 | 69 |
| [`09-pagos.md`](09-pagos.md) | Pagos · `pagos.amgdeveloper.cl` | 4 | 85 |
| [`10-regresion-compartida.md`](10-regresion-compartida.md) | La capa común a los nueve | 37 | 56 |

Ordenados por número de pestaña, no por tamaño. `10` no es el último por ser el más
importante: es el que se ejecuta primero si se va a tocar el shell.

---

## 2. Por dónde empezar

Depende de qué se vaya a hacer.

| Si el objetivo es… | Ejecutar |
|---|---|
| Revisar un producto puntual | El documento de ese producto, de la §1 a la §9 |
| Desplegar un cambio en `amigo.js`, `amigo-ui.js` o `amigo.css` | `10` completo, **antes** de tocar nada. Es el único plan que detecta una regresión en los nueve. |
| Desplegar un cambio en `crudRouter` o en el runtime | `10` §4.3 (contrato de lista) + el documento de cada producto |
| Revisar el diseño móvil | `10` §4.6, luego la §8 de cada producto |
| Revisar seguridad y sesión | `10` §4.4 y §4.5 |
| Probar la suite completa | `10` primero, después los nueve en orden |

**El orden importa por una razón concreta:** el defecto más caro que encontró la QA de esta
suite no estaba en ningún producto. Estaba en `amigo.js`: el canal cambiaba de sección sin
pedirle datos a nadie, así que ocho productos mostraban un panel vacío por sección. El
síntoma era idéntico al de "este producto no carga sus datos", y por eso durante dos rondas
se buscó el bug en los productos equivocados. Se descubrióo detrás de él solo entrando por el
subdominio y haciendo clic: entrar por `?panel=` funcionaba, y esa era la trampa.

De ahí la regla que se repite en todos los documentos: **nunca entrar por `?panel=` como
prueba de que un panel funciona.**

---

## 3. Precondiciones comunes

Estas aplican a los diez documentos. Están también en el §3 de cada uno.

1. **Sesión en el Core** (`desarrollo.amgdeveloper.cl`, puerto 3108). Es el emisor de SSO por
   diseño, no un entorno de desarrollo: que un producto autentique contra ahí es la
   arquitectura, no un bug. Cada subdominio tiene su propia cookie y la obtiene del SSO.
2. **Nunca pedir credenciales.** Quien las tipea.
3. **La sesión dura 15 minutos.** Al expirar, `/api/*` responde `401 {"error":"sin-sesion"}` y
   el navegador va al login. Anotar el corte en el registro, no contarlo como fallo.
4. **Límite de tasa: 600 peticiones / 15 min por IP**, igual en los nueve. Un `429` que
   aparece es el límite, no un defecto del producto.
5. **Aislamiento:** todo dato de prueba con sufijo identificable (`QA-<producto>-<sigla del
   caso>`), para poder limpiar sin ambigüedad. Ningún `INSERT` directo a la base.
6. **Zona horaria del navegador distinta de la de la organización.** Si coinciden, todos los
   casos de fecha y hora pasan sin probar nada. Es el requisito que más se olvida y el que
   más defectos escondió.

---

## 4. Datos de prueba

Cada documento trae los suyos en su §2, sembrados antes de empezar. En común:

| Dato | Para qué |
|---|---|
| Una organización con acceso a los nueve | Para que `Mis otras herramientas` se llene y se pueda probar el salto entre productos (`REG-NAV-09`, `REG-E2E-01`) |
| Una cuenta `member` y otra `admin` | Los roles importan en varios productos y hay casos que esperan `403` (`REG-SES-05`) |
| Una segunda organización | Para aislamiento (`REG-SES-06`) |
| Navegador en una zona distinta a la del taller | Sin esto, los casos de fecha y hora son decorativos |

**Limpieza al terminar:** todo lo que se creó con prefijo `QA-`, por API o UI. Si se probó
aislamiento, verificar que la otra organización no tiene nada. Si se tocó un ajuste
organizacional, restaurarlo y anotarlo.

---

## 5. Tipos de caso

Los tipos están definidos en `00-CONVENCIONES.md` §1. En resumen:

| Tipo | Qué mide |
|---|---|
| `FUNC` | Una función contra su resultado esperado. El grueso de los 636 casos. |
| `E2E` | Un flujo completo de principio a fin, cruzando varios módulos. |
| `REG` | Que algo que ya funcionaba no se rompió. Casi todo lo que toca el shell común. |
| `SIST` | El producto entero: sesión, roles, aislamiento, límites. |
| `EXP` | Exploratorio. Se registra como hallazgo, no como caso con esperado fijo. |

Prioridad `P0` = bloquea el uso del producto · `P1` = afecta una función · `P2` = cosmético o
de configuración.

---

## 6. Riesgos que cruzan productos

Los que no son de un producto sino de la capa compartida o del diseño del portfolio. Salen
en las §7 de varios documentos y se reunen aquí para tenerlos a mano antes de empezar.

| Riesgo | Alcance | Dónde |
|---|---|---|
| Sin layout móvil: `.ui-canal` declara `grid-area: canal` y las áreas móviles no la definen. Medido: `scrollWidth` 482 px con viewport de 390 px | **Los 9** | `10` §7 `R-S-01` |
| Sin CSP: `helmet` instalado con `contentSecurityPolicy: false` | **Los 9** | `10` §7 `R-S-02` |
| JSON malformado responde `500` en vez de `400` | **Los 9** | `10` §7 `R-S-03` |
| El límite de tasa se instala antes de `/health`: las sondas de salud consumen presupuesto | **Los 9** | `10` §7 `R-S-04` |
| El shell no lee el rol: cada producto lo pide por su cuenta o no lo pide | **Los 9** | `10` §7 `R-S-05` |
| Contrato de lista `{ items, total, limit, offset }`: desviarse deja un panel mudo | **Los 9** | `10` §7 `R-S-06` |
| Caché `immutable` sin huella `?v=`: un arreglo del shell puede no llegar nunca | **Los 9** | `10` §7 `R-S-07` |
| El formateo de dinero no es uniforme en el portfolio | **Los 9** | `10` §7 `R-S-08` |
| Ninguna lista tiene paginador: truncamiento silencioso pasado el `limit` | 7 de 9 | `10` §7 `R-S-13` |
| `settings.timezone` guardado pero sin efecto en varios productos | 3 de 9 | `05`, `08`, y la matriz de `10` |
| Ningún producto tiene alto de cita, edita o cancela | 5 de 9 | `01`, `04`, `05`, `09`, `10` |

---

## 7. Cómo se verifica que estos planes sirven

Un plan de prueba que no se ha ejecutado no está probado. Cuando se ejecuten, hay tres
cosas que hay que comprobar para saber que el plan era bueno y no solo largo:

1. **Los casos reproducen defectos conocidos.** Ejecutar `01-citas.md` sobre un entorno con
   el `app.js` viejo debe fallar en los casos de paneles vacíos, selector de cita mudo, alta
   silenciosa y precio en `$ 0`. Si pasa con el código viejo, el caso no prueba nada.
2. **Los hallazgos nuevos caben en el formato.** Si aparece algo que ningún caso contempla,
   hay que añadirlo como caso con su ID y no quedarse con un reporte suelto. El objetivo es
   que el plan crezca con lo que se aprende.
3. **La sección 7 se confirma o se corrige.** Los riesgos están marcados como *sospechados*,
   leídos del código. Ejecutar el plan convierte parte de ellos en confirmados y deja el
   resto en "no se reproduce", que también es un resultado que vale.

---

## 8. Estado

| | |
|---|---|
| Documentos escritos | 11 de 11 |
| Casos diseñados | 636 |
| Casos ejecutados | 0 |
| Riesgos confirmados en ejecución | 0 de ~90 |
| Verificación de selectores y rutas contra el código | Hecha: 4 correcciones (pagos ×5, crm ×1, cotizaciones ×2) |

Un detalle de la verificación que conviene conocer: los identificadores que cada producto
genera en runtime no aparecen en el HTML estático. En Inventario, por ejemplo, los ids
`c_name`, `c_sku`, `c_minQuantity`, `c_unit`, `c_priceCents` se crean con
`` `c_${c.name}` `` en `app.js`, así que no se pueden verificar leyendo `index.html`. Una
búsqueda de selectores contra el HTML da falsos positivos en todos esos casos: el campo sí
existe, se arma justo antes de abrir el diálogo.