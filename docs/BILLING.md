# Facturación, suscripciones y pagos

## Qué decide el Core

El Core es la **única fuente de verdad**: si una organización tiene acceso a un
producto lo decide `core.sqlite`. No existe una lista aparte: los productos no
montan `clients.json` ni usan `clientsGuard` (ese mecanismo quedó fuera del
despliegue). Ver "clientes sin clients.json" más abajo.

## Catálogo

Nueve productos activos en `products`, con precio, período y URL. El catálogo se
siembra en cada arranque (`ensurePlatformSeed`) y el seed es **idempotente**:
actualiza nombre, precio y estado sin tocar los `id`, así que las suscripciones
que ya apuntan a un producto siguen apuntando al mismo.

Además, hay productos **retirados**: se dejan en la tabla con `status='inactive'`
porque las suscripciones y pagos ya apuntan a su `product_id`. No se borran, pero
no se venden ni se listan.

### Precios

Los precios del Core son **los que ya están publicados en la landing** (tabla
"PLANES AMG"), no una estimación interna:

| Slug | Herramienta | Precio |
|---|---|---|
| `espacios` | Reserva de Espacios | $18.000 |
| `citas` | Reserva de Citas | $12.000 |
| `inventario` | Inventario | $9.000 |
| `solicitudes` | Solicitudes y Órdenes | $18.000 |
| `cotizaciones` | Cotizaciones | $8.000 |
| `crm` | Gestión de Clientes | $7.000 |
| `activos` | Control de Activos | $16.900 |
| `checklists` | Checklists e Inspecciones | $14.900 |
| `pagos` | Control de Pagos | $15.900 |

Los retirados (`documentos`, `recordatorios`, `crm`, `talleres`, `peluqueria`,
`deportes`, `inventario-v2`) quedan `inactive`, mapeados a su producto canónico
en `RETIRED_SLUGS` (`packages/platform/src/seed.ts`): la suscripción que apuntaba
a ellos ya no abre ningún producto.

**Dos fuentes de verdad para un precio es un bug esperando.** Si cambia un precio,
se cambia en `packages/platform/src/seed.ts` **y** en la landing.

### Los slugs y las URLs no son lo mismo

El `slug` es la identidad comercial; `app_url` es el subdominio real. En la
arquitectura final **coinciden siempre**: el subdominio es el slug, y esa es la
regla que `catalog.test.ts` verifica para los nueve.

| Slug | Subdominio |
|---|---|
| `espacios` | `espacios.amgdeveloper.cl` |
| `citas` | `citas.amgdeveloper.cl` |
| `inventario` | `inventario.amgdeveloper.cl` |
| `solicitudes` | `solicitudes.amgdeveloper.cl` |
| `cotizaciones` | `cotizaciones.amgdeveloper.cl` |
| `crm` | `crm.amgdeveloper.cl` |
| `activos` | `activos.amgdeveloper.cl` |
| `checklists` | `checklists.amgdeveloper.cl` |
| `pagos` | `pagos.amgdeveloper.cl` |

Los subdominios anteriores (`canchas`, `agenda`, `ordenes`, `stock`,
`presupuestos`, `docs`, `recordatorios`) quedan como redirects a los nuevos. La
plataforma es `amgdeveloper.cl` y no es un producto más: no tiene fila
en `products` ni volumen propio.

## clientes sin clients.json

Antes había dos listas de verdad: `ops/clients.json` (el archivo que `clientsGuard`
leía en el contenedor) y `core.sqlite`. Esa puerta quedó **eliminada del
despliegue y del código**: no existe `clientsGuard`, no se monta `ops/clients.json`
ni existe el archivo. La activación la decide únicamente `subscriptions` en el Core.

## Suscripciones

Una suscripción por producto. Estados:

| Estado | Significa |
|---|---|
| `pending` | solicitada, sin pagar |
| `active` | pagada |
| `expired` | el periodo pagado se pasó |
| `cancelled` | el owner la canceló |

El acceso **no** es solo `status === 'active'`. `productAccess()` también exige que
`current_period_end` esté en el futuro (o sea nulo). Sin esa condición, una
suscripción vencida en marzo seguiría soltando el producto para siempre: el
cliente no renueva y nadie le dice nada.

Motivos de rechazo, que la API y el SSO usan para explicar:

`organizacion-inactiva`, `producto-inexistente`, `producto-inactivo`,
`sin-suscripcion`, `suscripcion-vencida`, `suscripcion-no-activa`.

Cada uno tiene su mensaje en castellano. La UI los muestra como etiqueta de
estado; no son texto para developers.

`expireDueSubscriptions()` marca las vencidas. Es idempotente. **Corre en cada arranque** del Core (`createPlatformApp`), así que el estado `expired` sí se usa y la fila no queda mintiendo. Un cron sigue siendo la mejora natural para no depender de un reinicio.

### Mensual o anual

El cliente elige el periodo en `/contratar`, no el producto: un producto
`billing_period='monthly'` se puede pagar **al mes o al año**. El anual regala dos
meses: **se cobran 10 y se entregan 12** (365 días), con el precio anual calculado
en `packages/platform/src/billing/period.ts` — la misma función que usa el Core
para cobrar y la landing para mostrar. El periodo elegido se **congela en la
suscripción** (`subscriptions.billing_period`) al crear el checkout, para que la
confirmación del pago no tenga que (ni pueda) re-deducirlo: se paga el año, se
abre el año. Los cupones rebajan sobre el precio del periodo elegido, no sobre el
mensual.

## El flujo de cobro

El cobro son **dos pasos separados** y esa separación es el mecanismo de
seguridad, no una-compliance formal:

```
  POST /api/account/subscriptions      <- el owner pide contratar
        |
        |  startCheckout()
        v
  suscripcion = pending        (NO abre el producto)
  pago        = pending        (con la referencia de la pasarela y el monto CONGELADO)
        |
        |  ... el usuario paga ...
        |
        +--> confirmCheckout()   <- la pasarela (webhook firmado) u ops por CLI
                  |
                  v
        suscripcion = active, con current_period_end
        pago        = paid
```

### Paso 1: la intención (`startCheckout`)

Crea la suscripción en `pending`, pide el checkout a la pasarela y guarda el pago
como `pending` con la `provider_reference` y el monto del catálogo.

Ese pago pendiente es lo que permite responder después "este pago no llegó". Sin
él, un pago que entra no tiene contra qué emparejarse y la única salida es
conciliar a mano.

El monto queda **congelado** en el pago. Si mañana sube el precio, este pago
sigue siendo el de hoy, y por eso la comparación del paso 2 es contra ese número
y no contra `products.price`.

Lo que **no** pasa en este paso, y es deliberado:

- **Una pasarela que no existe no escribe nada.** La pasarela se resuelve antes
  de la primera escritura, así que un `501` (webpay sin implementar, por
  ejemplo) no deja una suscripción `pending` por cada intento. Un error de
  configuración no puede dejar rastro de sí mismo como si hubiera cobrados.
- **Un cobro en curso no se duplica.** Un doble clic en "Contratar" es el caso
  normal, no el raro. El segundo intento se rechaza con un `409` que trae la
  referencia viva, para que la UI la muestre y el cliente termine el pago que ya
  empezó en vez de abrir otro. Sin esto, el cliente enfrentaría dos transferencias
  y AMG recibiría dos veces el mismo cobro.
- **Solo bloquea una suscripción vigente, no solo activa.** `status = 'active'`
  con el periodo vencido significa "se venció y nadie renovó", no "está pagada".
  Si se tomara `status` como sinónimo de pagada, un cliente cuyo periodo venció
  y no pudo renovar nunca podría volver a contratar, y vería un `409` que no
  explica la causa.
- **Si la pasarela falla al abrir el checkout, la suscripción pendiente se
  cancela.** Una suscripción `pending` sin checkout detrás no describe ningún
  cobro posible; dejarla bloquea el reintento con algo que no se puede pagar.

### Paso 2: la confirmación (`confirmCheckout`)

Aquí se abre el producto, y **solo aquí**. El orden de las comprobaciones *es* la
seguridad:

1. Se busca el pago por `provider_reference`. Si no existe, se corta.
2. Si ya está pagado, se responde con lo que ya se sabe y se sale, sin volver a
   preguntar a la pasarela (puede que ya haya purgado el evento, y un reintento
   legítimo fallaría dejando al cliente pagando sin acceso).
3. Se le pide a la pasarela que verifique. Si no puede, se corta.
4. Se comprueba que la confirmación es **de este pago**: mismo `provider` y misma
   `provider_reference` que se pidieron. Sin esto, un adaptador que conteste por
   otra referencia —un webhook reenrutado, un id mal mapeado— abriría el producto
   con el monto de un cobro y la referencia de otro.
5. Se compara lo verificado con lo congelado. Si no calza, se corta.
6. Recién entonces, en **una transacción**, se marca pagado y se activa.

**Las dos últimas escrituras van juntas o no van.** Marcar el pago pagado y
abrir el producto son dos escrituras sobre la misma realidad comercial, y
separadas dejan un estado que no debería existir: el cliente transfirió el
dinero, el pago consta pagado y la suscripción sigue pendiente. Ahí el sistema ya
no sabe qué hacer, y lo peor es que el reintento del webhook no lo arregla,
porque un pago pagado se responde "ya confirmado" y nunca se vuelve a intentar
abrir el producto. El cliente pagó y no entró.

Por eso, si ese estado aparece igual —una fila vieja, una restauración de backup,
un proceso que murió antes de este arreglo— un reintento de confirmación **lo
repara** en vez de responder "ya confirmado". Un cliente que pagó y no tiene acceso
no puede quedar atrapado por un sistema que ya decidió que cobró.

**Idempotente.** Las pasarelas reintentan webhooks y eso es lo normal, así que la
segunda confirmación se resuelve con lo que ya se sabe y **no extiende el
periodo**. Un reintento no le regala un mes al cliente, y la diferencia la paga
AMG.

### Por qué confirmar NO es un endpoint de la cuenta

Porque la confirmación es la acción que abre el producto, un endpoint de
confirmación tiene que estar autenticado por **la pasarela**, no por la sesión
del cliente. Con la sesión bastaría un `curl` para electrolumbrarse gratis.

Por eso hoy la confirmación es una CLI de ops:

```bash
# 1. el owner contrata desde la web; el sistema le da una referencia
#    (la que aparece en "Referencia" de las instrucciones)
#
# 2. ops verifica el comprobante BANCARIO y confirma:
npm run billing:confirm -w @amg/platform -- transfer tr-a1b2c3d4
```

Una transferencia en la mano no firma nada, así que su única garantía es que una
persona de confianza mire la cuenta bancaria. Cuando exista Stripe, la
confirmación llega por webhook con firma sobre el **cuerpo crudo** y esta CLI
pasa a ser el camino de emergencia.

## Pasarelas

`billingProviders` es un **enum**, y un enum no es una pasarela. La interfaz
`BillingProvider` (`packages/platform/src/billing/types.ts`) es lo que hace el
trabajo real: separar lo que no depende de la pasarela (el dominio decide cuándo
activa y cuándo vence) de lo que sí (crear el checkout, traducir un webhook).

| Provider | Estado | Qué hace |
|---|---|---|
| `transfer` | **operativo** | Genera referencia e instrucciones; la confirma ops |
| `mercadopago` | **operativo** (Checkout Pro) | Crea una *preference*; el webhook firmado confirma |
| `stripe` | costura | Falla con 503 sin llaves; 501 al implementar |
| `manual` | **no es pasarela** | Etiqueta histórica de `grantSubscription` y del camino promo |
| `webpay` | **no es pasarela** | Permitido por el enum, sin adapter: da 501 |

Que `manual` y `webpay` estén en el enum sin adapter es una deuda concertada:
`obtenerProveedor()` lanza 501 en vez de fingir. Antes, un registro podía decir
`provider='webpay'` y nadie cobraba nunca. Hay un test (`packages/platform/tests/billing.test.ts`)
que fija esta frontera: si alguien implementa webpay, ese test falla y le obliga
a decidir qué pasa con la etiqueta vieja.

Para sumar una pasarela nueva se implementa la interface y se registra:

```ts
registrarProveedor('webpay', () => new WebpayProvider(config));
```

Las rutas no deben saber cómo cobrar.

`mercadopago` se registra en `billing/index.ts` con tres variables de entorno:

- `MERCADOPAGO_ACCESS_TOKEN` — sin él la pasarela da 503 (no finge cobrar).
- `MERCADOPAGO_WEBHOOK_SECRET` — si está, valida la firma `x-signature` del
  webhook y **exige** que calce. Si no está (la app de MP aún no lo tiene), el
  webhook se acepta pero la verdad se pide igual a MP por re-consulta del pago.
- `MERCADOPAGO_MODE` — `sandbox` usa `sandbox_init_point`; cualquier otra cosa es
  producción.

El webhook vive en `POST /api/billing/webhook/mercadopago`. **No confía en el
cuerpo de la notificación**: si hay secreto verifica la firma HMAC, y en todos
los casos **re-consulta el pago** a la API de MP con nuestro token, comprobando
que `external_reference` sea la nuestra y que el estado sea `approved`. Una
notificación es una campanada; la prueba es la respuesta autenticada de la API.
Se acusa con 2xx (para que MP no reintente) salvo error de infraestructura, que
es 5xx para que reintente.

## Descuentos y cupones

Un cupón **no abre el producto**: solo rebaja el monto que se congela en el pago.
Vive en `src/domain/discounts.ts` y en las tablas `discounts` /
`discount_redemptions`. Tres tipos de cupón (`discountKinds`):

| Tipo | `value` | Efecto |
|---|---|---|
| `percent` | 1..100 | Rebaja ese % (redondeo hacia abajo). 100% → gratis |
| `fixed` | monto en la moneda | Rebaja un monto fijo |
| `trial` | días | El producto se abre gratis por N días |

Todo cupón puede acotarse con: `product_slug` (solo ese producto; vacío = todo el
catálogo), `currency`, `max_redemptions` (tope total), `per_org_limit` (tope por
organización), `starts_at` / `ends_at` (vigencia) y `status` (`active`/`disabled`).

**Cómo fluye un cupón.** El cliente lo ingresa en `/contratar?p=<slug>`, que lo
cotiza con `POST /api/account/discounts/validate` (solo lectura: mirar el precio
NO quema el cupo) y lo envía en `POST /api/account/subscriptions` con
`discountCode`. Ya dentro de `startCheckout`:

1. Se **cotiza** (`quoteDiscount`): valida estado, vigencia, producto, moneda y
   topes. Un código malo da 409/404 sin escribir nada.
2. Se **reserva** el cupo (`reserveRedemption`) dentro de una transacción que
   **revalida los topes**, para que dos compras simultáneas no se lleven el mismo
   último cupo. El cupo reservado ya cuenta para los topes.
3. Si el monto queda **$0** (prueba gratis o 100% off), se activa por el **camino
   promo**: sin pasarela, `provider='manual'`, pago `paid` de 0 y redención `used`.
   Es el único lugar donde algo se abre sin un pago confirmado, y es auditable.
   Si no, el pago pendiente guarda el monto **ya rebajado** (más `original_amount`,
   `discount_amount`, `discount_code`).
4. Al confirmar el pago, la redención pasa a `used`. Si la pasarela falla antes de
   crear el pago, el cupo reservado se **libera** (`released`) y no queda colgado.

**Administración (ops).** Solo por CLI, nunca por HTTP:

```bash
# % de descuento, con tope de usos y vigencia
npm run discounts -w @amg/platform -- create --code PREPAGO50 --kind percent --value 50 \
  --max-redemptions 200 --per-org-limit 2 --ends-at 2026-12-31T23:59:59-03:00
# prueba gratis de 7 días
npm run discounts -w @amg/platform -- create --code PRUEBA7 --kind trial --value 7
# listar y deshabilitar
npm run discounts -w @amg/platform -- list
npm run discounts -w @amg/platform -- status --code PREPAGO50 disabled
```

Un cupón `disabled` corta el código de inmediato sin tocar las redenciones ya
hechas.

## Activar a mano (solo para lo ya pagado)

`grantSubscription()` sigue existiendo para dar de alta una transferencia
**confirmada fuera del sistema** (un pago del año pasado, un acuerdo de
prueba). No es el camino normal:

```ts
grantSubscription({ organizationId, productId, days: 30, amount: 12900 });
```

Preferir `billing:confirm`: éste deja el pago con su referencia y se puede
auditar. `grantSubscription` no tiene referencia que conciliar.

Sólo el `owner` puede contratar o cancelar: es quien representa al cliente que
paga. Un `admin` administra la organización, pero no toca la facturación.

## Cancelación: qué significa "cancelar" HOY

**Cancelar corta el acceso de inmediato.** No hay final de periodo pagado.

`cancelSubscription()` pone `status='cancelled'` y `cancelled_at=ahora`, e
`isLive()` exige `status === 'active'`, así que el producto deja de responder en
el siguiente request, aunque falten 29 días para que venza el periodo.

Consecuencias, porque son las que hay que saber antes de vender:

- El cliente pierde el acceso ya. No hay "hasta el fin de lo pagado".
- **No hay reembolso automático.** Si se canceló a mitad de periodo, el dinero
  de los días que faltaban no se devuelve solo: hay que devolverlo a mano.
- El historial de pagos queda intacto y la suscripción cancelada sigue
  listándose: nada se borra.

Si se quiere el otro comportamiento (dejar acceso hasta `current_period_end` y
vencer sola), es un cambio de una línea en `isLive()` más una forma de agendar
la baja. **No está implementado y no se debe prometer.** Está anotado en "Lo que
falta" porque es una decisión de negocio, no un refactor.

## Pagos

`payments` es el registro de lo que se cobró, con `provider`, `amount`,
`currency`, `status` y `provider_reference` para conciliar con el proveedor.

Ojo con el nombre: en el Core, `payments` son **pagos de AMG al cliente**. Los
cobros que un producto le hace a sus propios clientes (las cuotas de
`pagos.amgdeveloper.cl`, por ejemplo) viven en la base de ese producto. No se
mezclan. Ver `DATA_ISOLATION.md`.

## Combos y suite — no implementado

La landing vende un combo de 3 herramientas a $29.000 y la suite completa a
$49.000. **El Core no puede representar eso**: el modelo es una suscripción por
producto, y no existe el concepto de plan que agrupe varios.

Por ahora los combos se cotizan a mano, como siempre, por WhatsApp. Cuando se
quieran automatizar, el camino es una tabla de planes (un plan agrupa N productos
con su precio) y que la suscripción apunte al plan en vez de a un producto suelto.
Es un bloque de trabajo propio, no una extensión de este.

## Lo que falta

- [x] Costura de pasarela (`BillingProvider`) y flujo intención → confirmación.
- [x] Referencia de pago y pago pendiente para poder conciliar.
- [x] Confirmación idempotente que no extiende el periodo.
- [x] Confirmación **fuera** del alcance de la sesión del cliente.
- [x] Pasarela `mercadopago` (Checkout Pro + webhook firmado con re-consulta).
- [x] Cupones: porcentaje, monto fijo y prueba gratis; con topes y vigencia.
- [ ] **Cancelación al término del periodo** en vez de inmediata (decisión de
      negocio; ver arriba lo que implica).
- [ ] Implementar `stripe` (checkout + webhook con firma sobre el cuerpo crudo).
- [ ] Renovación automática y cobros recurrentes.
- [x] `expireDueSubscriptions()` llamada en el arranque del Core (cron, opcional).
- [x] Plan mensual o anual por suscripción (anual = 10 meses cobrados, 12 entregados).
- [ ] Reembolsos: hoy la cancelación inmediata no genera ninguno.
- [ ] Combos de productos (hoy cada herramienta es una suscripción aparte).
- [ ] Facturación electrónica (Boletas/Facturas).
- [ ] Conciliación: `provider_reference` ↔ respaldos del proveedor.
- [ ] Quitar `manual` y `webpay` del enum, o dos de implementar.
