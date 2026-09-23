# SaaS Mini

Suite de **mini-SaaS de nicho** para vender baratos: simples, seguros y baratos de
operar. Un solo código base (core) multi-tenant alimenta varios productos verticales.

```
08_SaaS_Mini/
├── packages/
│   └── core/                 ← Núcleo reutilizable (Node + TS + Express + Drizzle/SQLite)
├── products/
│   └── peluqueria/           ← Producto #1: agenda y gestión para peluquerías/barberías
└── package.json              ← npm workspaces
```

## Productos planeados

| # | Producto | Estado | Diferencia vs core |
|---|----------|--------|--------------------|
| 1 | Agenda para peluquerías | ✅ MVP completo | branding + seed |
| 2 | Reservas para centros deportivos | ⬜ | módulo de recursos/canchas + reservas por bloque |
| 3 | Gestión de talleres | ⬜ | órdenes de trabajo + inventario con piezas |
| 4 | Control de inventario | ⬜ | módulo standalone |
| 5 | Cotizaciones | ⬜ | módulo standalone |
| 6 | Generación de documentos | ⬜ | módulo standalone |
| 7 | Recordatorios WhatsApp/email | ⬜ | pasarela + panel de envíos |
| 8 | Gestión de clientes | ⬜ | CRM liviano |

Todos comparten **clientes, agenda/reservas, recordatorios, cotizaciones, documentos
e inventario**: al construir un producto vertical solo se eligen módulos activos,
branding y datos semilla.

## Stack (decisiones)

- **Node 20+ / TypeScript / Express** — el mismo stack que ya usas en tus proyectos.
- **SQLite (better-sqlite3) + Drizzle ORM** — sin servidor de BD: un archivo `.db`
  por instalación. Hosting baratísimo, backup = copiar 1 archivo.
  > Se evaluó Prisma y se descartó: agrega motores binarios y codegen sin valor real
  > aquí. Drizzle da tipado fuerte y migraciones ligeras.
- **Seguridad**: helmet, rate-limit, validación Zod en cada ruta, contraseñas con
  bcrypt, sesión JWT en cookie `HttpOnly` + `SameSite=Strict`, todo scoped por tenant
  (`tenant_id` en cada tabla y en cada query).
- **Sin build de frontend**: la UI es HTML/CSS/JS vanilla servida por Express. Cero
  bundler, cero node_modules extra, deploy trivial.

## Probar el MVP (peluquería)

```bash
cd 08_SaaS_Mini
npm install
npm run seed      # crea un negocio demo
npm run dev       # http://localhost:3000
```

Credenciales demo: **slug** `demo-pelu` · **email** `demo@pelu.com` · **contraseña** `demo1234`

O crea tu propio negocio desde el botón "Crear cuenta" (multi-tenant).

## Comandos

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | arranca peluquería en modo watch (`tsx`) |
| `npm run seed` | siembra datos demo |
| `npm run test` | tests del core (vitest) |
| `npm run build` | compila core + productos a `dist/` |
| `npm start` (en el producto) | corre la versión compilada |

## Configuración (.env en `products/<producto>/`)

```env
PORT=3000
DB_PATH=./data/app.db        # archivo SQLite (se crea solo)
JWT_SECRET=clave-larga       # ¡obligatorio cambiarla en producción!
SMTP_HOST=                   # opcional: recordatorios por email
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
MAIL_FROM=no-reply@saas-mini.local
APP_NAME=Peluquería
APP_URL=http://localhost:3000
```

WhatsApp se configura por negocio desde la app (Configuración): URL de webhook +
token de una pasarela (Twilio, 360dialog, WATI, plataforma propia). El webhook recibe
`{ to, text }`.

## Crear un producto nuevo (receta)

1. Copia `products/peluqueria` → `products/<tu-producto>`.
2. Cambia nombre/producto y los módulos activos en `src/index.ts`:
   ```ts
   createApp({ name: 'Mi Producto', product: 'mi-producto', staticDir: '...' })
   ```
   El core expone banderas por módulo (`routers: { inventory: false, ... }`).
3. Reescribe `src/seed.ts` y la carpeta `public/` (branding).
4. Listo para vender.

## Deploy barato

Opciones de un solo proceso (servicio + BD en el mismo servidor):

- **Fly.io / Railway / Render** — un contenedor Node; persiste solo la carpeta `data/`.
- **VPS mínimo** — `node dist/index.js` detrás de Caddy (HTTPS gratis).
- **Docker**: añadir un `Dockerfile` mínimo que copie `dist/` y `public/` y monte un
  volumen en `/app/data`.

Cada tenant es un registro (multi-tenant en un solo SQLite) o, si crece, se cambia
`DB_PATH` para aislar por cliente sin tocar código.