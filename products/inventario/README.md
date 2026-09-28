# Inventario

Producto de inventario que corre sobre
[`@amg/product-runtime`](../../packages/product-runtime): sin usuarios propios,
sin contraseñas, sin tenants: la identidad y las suscripciones viven en el Core.

## Qué es

| Aspecto | Detalle |
| --- | --- |
| Base | `inventario.sqlite` con 3 tablas: `items`, `movements`, `settings` |
| Organización | `organization_id` del Core, siempre del token |
| Usuarios | ninguno: entra por SSO del Core |
| Credenciales | `AMG_SSO_CLIENT_ID` / `AMG_SSO_CLIENT_SECRET` |
| Edición de stock | sólo por movimientos, con motivo y autor |
| `DELETE` de un artículo | baja lógica; el historial no se rompe |

## Correrlo

```bash
cp .env.example .env          # y completar AMG_SSO_CLIENT_SECRET
npm run sso:secret -w @amg/platform -- inventario   # pide el secreto al Core
npm run dev -w @amg/inventario
```

El HTML también pide sesión: sin cookie del Core no se sirve ni el shell, y la
API responde 401.

## Tests

```bash
npm run test -w @amg/inventario
```

- `tests/inventario.test.ts`: la API con identidad AMG firmada de verdad
  (organización de sesión, roles, nonegativos, stock bajo, baja lógica,
  configuración, y que la UI se sirva sin login).

`tests/setup.ts` fija `CORE_DB_PATH` a un temporal **antes** de que se cargue la
config del Core. Sin eso, estos tests escribirían en el `core.sqlite` de
desarrollo.