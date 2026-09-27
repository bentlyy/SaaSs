# Inventario v2

El mismo inventario que `products/inventario`, pero corriendo sobre
[`@amg/product-runtime`](../../packages/product-runtime): sin usuarios propios,
sin contraseñas, sin tenants, con la identidad y las suscripciones en el Core.

El legacy queda intacto y sigue funcionando. Los dos se llaman `inventario` a
propósito —mismo subdominio, mismo `client_id` de SSO, mismo producto para el
cliente— y en despliegue sólo puede quedar uno vivo.

## Qué cambió

| legacy (`products/inventario`) | v2 (acá) |
| --- | --- |
| `app.db` con 18 tablas del Core + las suyas | `inventario.sqlite` con 3 tablas: `items`, `movements`, `settings` |
| `tenants` | `organization_id` del Core, siempre del token |
| usuarios con `password_hash` | ninguno: entra por SSO del Core |
| `JWT_SECRET` y `clientsGuard` | `AMG_SSO_CLIENT_ID` / `AMG_SSO_CLIENT_SECRET` |
| editar stock con un PATCH | sólo por movimientos, con motivo y autor |
| `DELETE` de un artículo | baja lógica; el historial no se rompe |

## Correrlo

```bash
cp .env.example .env          # y completar AMG_SSO_CLIENT_SECRET
npm run sso:secret -w @amg/platform -- inventario   # pide el secreto al Core
npm run dev:inventario:v2
```

El HTML también pide sesión: sin cookie del Core no se sirve ni el shell, y la
API responde 401.

## Migrar los datos del legacy

El legacy tiene 1 tenant, 12 artículos y 18 movimientos en
`../inventario/data/app.db`. La migración es un CLI puntual, no algo que corra en
cada arranque:

```bash
npm run migrate:inventario
```

Qué hace, y qué NO hace:

- Abre el legacy en **solo lectura**. Si algo falla, el legacy sigue sirviendo.
- Por cada `tenant_id` busca la organización en el Core **por slug**; si no
  existe, la crea con el nombre del legacy. El Core sigue siendo la única
  fuente de verdad de qué organizaciones hay.
- Deja anotado el mapeo en `legacy_tenant_map`, así que se puede re-ejecutar sin
  duplicar nada y se puede auditar de dónde salió cada organización.
- **No inventa usuarios.** El autor de un movimiento se resuelve por email
  contra el Core; si no está, el movimiento queda con el nombre legacy como foto
  histórica y la migración lista los emails que hay que crear. Al crearlos y
  volver a correr la migración, los movimientos quedan asociados.
- Conserva los ids legacy de artículos y movimientos, porque los movimientos
  referencian al artículo.
- Al final compara cuántos movimientos hay en cada lado y sale con código 1 si
  no cuadran.

Opciones: `--legacy <ruta>`, `--destino <ruta>`, `--org id_tenant=slug-nuevo`
(para cuando el slug legacy no sirve en el Core).

> **Ojo con `CORE_DB_PATH`.** La migración lee la config de `@amg/platform`, y
> el Core resuelve esa ruta **relativa al directorio de trabajo**. Como
> `npm run -w` cambia ese directorio, hay que fijar `CORE_DB_PATH` en el `.env`
> apuntando al mismo `core.sqlite` que usa el Core; si no, la migración abre un
> Core nuevo y deja los datos y la identidad en bases distintas.

### Estado de la corrida sobre el legacy real

12 artículos, 18 de 18 movimientos, organización `Bodega Central`
(`demo-inventario`) creada en el Core. La segunda corrida no duplicó nada.

Dos cosas que el reporte levanta y que conviene saber antes de mirar el stock:

1. **La autora del legacy no está en el Core.** `demo@inventario.com`
   (Sofía Ramírez) migró con su nombre como foto histórica y sin `actor_user_id`.
   Se la crea en el Core y se vuelve a correr la migración para asociarla.
2. **Los 12 artículos descuadran con su historial** (`stock 30` pero los
   movimientos suman `15`, y en tres casos la suma es negativa). No es un error
   de la migración: el legacy tiene datos de *seed*, no historia real — las
   cantidades se generaron aparte de los movimientos. La migración copia las dos
   cosas tal cual, sin inventar un movimiento de ajuste, y lo reporta. Con datos
   reales, en cambio, ese mismo descuadre sería una señal de alarma.


## Tests

```bash
npm run test -w @amg/inventario
```

- `tests/inventario.test.ts`: la API con identidad AMG firmada de verdad
  (organización de sesión, roles, nonegativos, stock bajo, baja lógica,
  configuración, y que la UI se sirva sin login).
- `tests/migrate-legacy.test.ts`: la migración contra un Core y un legacy reales
  en carpetas temporales. Corre también el contrato de frontend de
  `packages/core/tests/frontendContract.test.ts`, que exige que todo producto
  con `public/` tenga su panel de configuración.

`tests/setup.ts` fija `CORE_DB_PATH` a un temporal **antes** de que se cargue la
config del Core. Sin eso, estos tests escribirían en el `core.sqlite` de
desarrollo.
