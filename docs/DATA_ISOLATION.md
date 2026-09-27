# Aislamiento de datos

La regla en una línea: **el Core no sabe de negocios, y cada producto no sabe de
los demás.**

## Las bases

| Archivo | Contenido | Producto |
|---|---|---|
| `core.sqlite` | usuarios, organizaciones, membresías, sesiones, catálogo, suscripciones, pagos, SSO | el Core |
| `app.db` (peluqueria) | citas, clientes de la peluquería | agenda |
| `app.db` (deportes) | reservas de canchas | canchas |
| ... | ... | ... |

Nueve bases, nueve contenedores, nueve volúmenes Docker. **Ningún volumen se
comparte.** Un contenedor comprometido no puede leer ni escribir la base de otro
cliente, y ni siquiera montar el volumen ajeno: no lo tiene.

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
cookie del Core es host-only en `desarrollador.amgdeveloper.cl`: por diseño, un
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
2. `npm run sso:secret -w @amg/platform -- <slug>` y ponerlo en su `.env`.
3. Volumen Docker nuevo, `DB_PATH` propio, y su entrada en `ops/clients.json`
   mientras no se migre al SSO.
4. Su subdominio apuntando al puerto que le toque.

Y la comprobación de que quedó bien aislado:

```bash
docker compose exec <producto> ls /app/data     # solo su propio volumen
```

## Cómo se verifica

- `packages/platform/tests/` cubre que una organización no lee a otra, que el
  acceso expira, y que los tokens no sirven para otro producto.
- `packages/core` tiene tests de `clientsGuard`, incluido el caso fail-closed.
- `products/*` siguen siendo independientes: cada uno con su `tsconfig`, su build y
  su base.
