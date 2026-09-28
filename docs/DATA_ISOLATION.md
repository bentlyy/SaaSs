# Aislamiento de datos

La regla en una línea: **el Core no sabe de negocios, y cada producto no sabe de
los demás.**

## Las bases

| Archivo | Contenido | Producto | Puerto |
|---|---|---|---|
| `core.sqlite` | usuarios, organizaciones, membresías, sesiones, catálogo, suscripciones, pagos, SSO | el Core | 3108 |
| `espacios.sqlite` | espacios, extras, clientes, reservas | espacios | 3101 |
| `citas.sqlite` | citas, clientes, servicios, profesionales, avisos | citas | 3100 |
| `inventario.sqlite` | artículos, movimientos, proveedores | inventario | 3103 |
| `solicitudes.sqlite` | solicitudes, líneas de trabajo, repuestos, clientes, técnicos | solicitudes | 3102 |
| `cotizaciones.sqlite` | cotizaciones, líneas, clientes | cotizaciones | 3104 |
| `clientes.sqlite` | clientes y seguimientos | clientes | 3107 |
| `activos.sqlite` | activos, movimientos, estados | activos | 3109 |
| `checklists.sqlite` | plantillas, ejecuciones, items firmados | checklists | 3110 |
| `pagos.sqlite` | cargos, abonos, saldos | pagos | 3111 |

Nueve bases de negocio, nueve contenedores, nueve volúmenes Docker. **Ningún
volumen se comparte.** Un contenedor comprometido no puede leer ni escribir la
base de otro cliente, y ni siquiera montar el volumen ajeno: no lo tiene.

El puerto no se elige por estetica: se elige para que coincida con el `map` de
`ops/nginx.conf` y con el `ports:` de `docker-compose.yml`. Son tres lugares que
hay que cambiar en el mismo deploy, y desalinearlos abre el producto equivocado
sin ningun error visible.

La razón de que sean volúmenes separados y no un `SELECT` con un `WHERE tenant_id`
no es la seguridad: es la base. Una consulta mal escrita, un `DELETE` sin filtro
o un backup mal restaurado borra los datos de un cliente entero. Con nueve bases
pequeñas, un error se pierde en un producto.

## Lo que NO puede estar en el Core

`core.sqlite` no tiene, y no debe tener: clientes, inventario, citas, órdenes de
trabajo, cotizaciones, activos, checklists, cobros a clientes, empleados,
horarios, ni ninguna otra cosa de un mini-SaaS.

El DDL lo dice en el primer comentario de `packages/platform/src/db/init.ts`, y
está ahí a propósito. Si alguna vez aparece una tabla así, es que se coló lógica
de producto en el Core y hay que sacarla.

**Ojo con `payments`.** En el Core, `payments` son los pagos de AMG **al**
cliente: lo que se le cobró por una suscripción. Los cobros que un producto le
hace a sus propios clientes viven en la base de ese producto y no se mezclan.
Cuando esto se lea en seis meses, esa es la confusión que hay que evitar.

## La regla que evita que una organización vea a otra

Todo lo que sale de `/api/account/*` está acotado a `req.amg.organizationId`.
Ninguna ruta acepta un `organizationId` del cuerpo o de la query para leer datos.

```
GET /api/account/subscriptions?organizationId=otraco   →  ignora el query
GET /api/account/organization/otraco                   →  403
```

`organizationId` sale de la sesión, y la sesión está verificada contra
`core.sqlite` en cada request. No hay forma de que un cliente lo elija.

Esto está concentrado en `account-routes.ts` a propósito: si la regla está
esparcida por 40 handlers, basta uno que la olvide.

## La excepción, y por qué está justificada

`order_parts.item_id` es la única referencia que cruza de un producto a otro: un
repuesto en una orden apunta a un artículo de `inventario.sqlite`.

**No es una foreign key, y no lo va a ser.** No se puede poner: la tabla vive en
otra base, y SQLite no valida FKs entre archivos. Lo que hay es un `item_id` que
es una referencia suelta y, al lado, un `item_name` que es la **foto histórica**
del nombre tal como estaba cuando se usó el repuesto.

El snapshot es lo que hace aceptable la referencia suelta. Si mañana el artículo
se renombra o se da de baja, la orden vieja sigue diciendo qué se usó en ella; si
en algún momento la referencia apunta a algo que ya no existe, la orden sigue
leyéndose. Por eso la migración reporta los `item_id` que no encuentran destino en
vez de inventar un artículo o dejar la línea huérfana en silencio.

Lo que NO hace esta excepción: ninguna consulta de `solicitudes` lee
`inventario.sqlite`. El `item_id` viaja en la respuesta y el frontend lo consulta
por HTTP contra `inventario`, que es su dueño. Sigue valiendo "un producto no se
conecta a la base de otro".

## El Core no se importa desde un producto

- `products/*` **no** puede importar `@amg/platform`. Hablan por HTTP.
- Un producto no lee `core.sqlite` aunque los dos estén en la misma imagen: la
  imagen es el mismo disco, los volúmenes son distintos, y `core.sqlite` no está
  en el volumen del producto.
- Un producto no se conecta a la base de otro.

La regla se puede verificar: `products/*/package.json` no debe tener
`@amg/platform` en `dependencies`.

## Identidad: el límite que cruza

Lo único que cruza de un producto al Core es la **identidad**, y cruza por SSO:

- El Core firma un JWT con el secreto del producto, de vida corta, con `aud` =
  slug del producto.
- El producto valida ese token y arma **su propia** sesión.
- El Core nunca ve los datos del producto; el producto nunca ve la contraseña.

El producto no recibe ni la cookie del Core ni el token de sesión central. La
cookie del Core es host-only en `desarrollo.amgdeveloper.cl`: por diseño, un
subdominio no puede leerla.

Y al revés: el token de un producto no sirve en otro (`aud` + secreto distinto).

## Permisos: el Core no sabe qué hace un peluquero

Los tres roles son de plataforma, no de negocio:

- `owner` — paga y decide.
- `admin` — opera la organización.
- `member` — usa.

Si alguna vez el Core necesita un permiso tipo "un recepcionista no puede ver el
margen", esa regla va **dentro del producto**, con el `role` que le llega del
token. El Core no crece un cuarto rol.

## Para agregar un producto nuevo

1. Ficha en `CATALOG` (`packages/platform/src/seed.ts`) con precio, período y
   `app_url`. El seed también da de alta el cliente SSO.
2. Volumen Docker nuevo, `DB_PATH` propio, y su servicio en
   `docker-compose.yml` con un puerto que no uses nadie.
3. Su entrada en el `map $host` de `ops/nginx.conf` apuntando a ese puerto, y el
   nombre en el `server_name` del bloque.
4. Su registro DNS y su certificado, si el subdominio es nuevo.
5. `npm run sso:secret -- <slug>` y escribir el resultado en su
   `AMG_SSO_<SLUG>_SECRET`. **El secreto lo genera el Core**, no se inventa: un
   valor puesto a mano hace que el producto rechace todos los tokens.

No hay `ops/clients.json`, ni `CLIENTS_GATE`, ni `JWT_SECRET`: la puerta es la
suscripción en el Core.

Y la comprobación de que quedó bien aislado:

```bash
docker compose exec <producto> ls /app/data     # solo su propio volumen
```

## Cómo se verifica

- `packages/platform/tests/` cubre que una organización no lee a otra, que el
  acceso expira, y que los tokens no sirven para otro producto.
- `products/*` siguen siendo independientes: cada uno con su `tsconfig`, su build y
  su base.
