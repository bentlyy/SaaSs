# SaaS Mini

Suite de **mini-SaaS de nicho** vendidos en conjunto: un Core de plataforma
(identidad, organizaciones, suscripciones) y **nueve productos** sobre un mismo
runtime, con una sola imagen Docker y una SQLite por producto, en un solo VPS.

```
08_SaaS_Mini/
├── packages/
│   ├── platform/            ← el Core: identidad, organizaciones, suscripciones (express + drizzle/sqlite)
│   ├── product-runtime/     ← el runtime que comparten los productos (CreateApp, DB, migraciones)
│   ├── auth-client/         ← verificación SSO en cada request
│   └── core/                ← utilidades HTTP/logger compartidas
├── products/
│   ├── activos/             ← patrimonio con historial de movimientos
│   ├── checklists/          ← plantillas de inspección y su ejecución con snapshot
│   ├── citas/               ← agenda por profesional y servicio, con bloqueos y avisos
│   ├── clientes/            ← ficha del cliente y seguimientos
│   ├── cotizaciones/        ← presupuestos con líneas, folio y estados
│   ├── espacios/            ← reservas de salas/canchas con disponibilidad y bloques
│   ├── inventario/          ← artículos y movimientos trazables
│   ├── pagos/               ← cobros a clientes de la empresa
│   ├── solicitudes/         ← mesa de ayuda: peticiones, comentarios, adjuntos e historial
│   └── landing/             ← el Core sirviendo la web (catálogo, acceso, mi cuenta)
├── ops/                      ← deploy, backup y restore
└── package.json              ← npm workspaces
```

## Arquitectura en una línea

Sin usuarios ni contraseñas dentro de los productos: la identidad vive en el
Core (`packages/platform`, que corre como el contenedor `landing`). Cada
producto pide sesión por SSO y consulta la suscripción de la organización en
cada request. Una SQLite por producto, aislada por `organization_id`. Ver
`docs/ARCHITECTURE.md` y `docs/SSO.md`.

## Los nueve productos y sus dominios

| Producto | Subdominio | Puerto |
|---|---|---|
| Reserva de Espacios | `espacios.amgdeveloper.cl` | 3101 |
| Reserva de Citas | `citas.amgdeveloper.cl` | 3100 |
| Inventario | `inventario.amgdeveloper.cl` | 3103 |
| Solicitudes y Órdenes | `solicitudes.amgdeveloper.cl` | 3102 |
| Cotizaciones | `cotizaciones.amgdeveloper.cl` | 3104 |
| Gestión de Clientes | `clientes.amgdeveloper.cl` | 3107 |
| Control de Activos | `activos.amgdeveloper.cl` | 3109 |
| Checklists e Inspecciones | `checklists.amgdeveloper.cl` | 3110 |
| Control de Pagos | `pagos.amgdeveloper.cl` | 3111 |
| Core | `desarrollo.amgdeveloper.cl` | 3108 |

Los subdominios viejos (`agenda`, `canchas`, `ordenes`, `stock`,
`presupuestos`, `docs`, `recordatorios`) quedan como redirects a estos. El
registro DNS vive en `ops/cloudflare-amgdeveloper.zone`.

## Stack

- **Node 20+ / TypeScript / Express**.
- **SQLite (better-sqlite3) + Drizzle ORM** — una archivo por producto, sin
  servidor de BD. Backup = snapshot consistente (ver `ops/backup.sh`).
- **Seguridad**: cookie HttpOnly + SameSite=Strict, firmas HMAC derivadas por
  cliente SSO, validación Zod, todo scoped por `organization_id`.
- **Sin build de frontend**: la UI es HTML/CSS/JS vanilla servida por el
  runtime. Cero bundler.

## En desarrollo

```bash
npm install
# Levantar el Core solo (genera secretos SSO, semilla y bootstrap):
npm run dev:core
# Y cada producto en su propio puerto:
npm run dev:espacios
npm run dev:citas
# ... dev:inventario, dev:solicitudes, dev:cotizaciones, dev:clientes,
#     dev:activos, dev:checklists, dev:pagos
```

La primera vez el Core necesita una contraseña para el usuario y una
organización: ver `packages/platform` y `.env.example`.

## Verificación

```bash
npm run typecheck   # todo el monorepo
npm test            # tests de todos los workspaces
npm run build       # compila paquete a paquete a dist/
```

## En producción

Un solo servidor, una sola imagen Docker (`saas-mini:latest`), un contenedor por
producto + el Core, cada uno con su volumen `saasmini_data_<producto>`:

```bash
bash ops/deploy.sh   # idempotente: secretos -> Core solo -> bootstrap -> up -d -> health
ops/backup.sh        # snapshot de las 10 SQLite + config a ~/backups/saasmini
ops/restore.sh       # restaura <producto>.db desde un backup
```

Caminos completos y el orden DNS → certificado → nginx → stack en
`docs/DEPLOY.md`.

## Comandos del monorepo

| Comando | Qué hace |
|---|---|
| `npm run dev:core` | el Core (plataforma + web) en modo watch |
| `npm run dev:<producto>` | cualquier producto en modo watch (`tsx`) |
| `npm run seed` | carga/verifica el catálogo de productos en el Core |
| `npm run sso:secret -- <slug>` | secreto SSO de un cliente desde el Core |
| `npm run bootstrap -- ...` | crea la organización y el usuario owner |
| `npm test` | tests de todos los workspaces |
| `npm run typecheck` | typecheck de todo el monorepo |
| `npm run build` | compila todo a `dist/` |