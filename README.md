# SaaS Mini

Suite de **mini-SaaS de nicho** para vender baratos: simples, seguros y baratos de
operar. Un solo código base (core) multi-tenant alimenta varios productos verticales.

```
08_SaaS_Mini/
├── packages/
│   └── core/                 ← Núcleo reutilizable (Node + TS + Express + Drizzle/SQLite)
├── products/
│   ├── peluqueria/           ← Producto #1: agenda y gestión para peluquerías/barberías
│   ├── deportes/             ← Producto #2: reservas por bloque para centros deportivos
│   ├── talleres/             ← Producto #3: órdenes de trabajo e inventario de piezas
│   ├── inventario/           ← Producto #4: control de stock con movimientos trazables
│   ├── cotizaciones/         ← Producto #5: presupuestos y recibos profesionales en PDF
│   ├── documentos/           ← Producto #6: generación de documentos (facturas, notas, etc.)
│   ├── recordatorios/        ← Producto #7: recordatorios automáticos WhatsApp/email
│   ├── crm/                  ← Producto #8: gestión de clientes con etiquetas y seguimientos
│   └── landing/              ← Pantalla principal AMG: mapa de las 8 herramientas con acceso directo
└── package.json              ← npm workspaces
```

## Productos planeados

| # | Producto | Estado | Diferencia vs core |
|---|----------|--------|--------------------|
| 1 | Agenda para peluquerías | ✅ MVP completo | branding + seed |
| 2 | Reservas para centros deportivos | ✅ MVP completo | módulo de recursos/canchas + reservas por bloque |
| 3 | Gestión de talleres | ✅ MVP completo | módulo de órdenes de trabajo + piezas que consumen inventario |
| 4 | Control de inventario | ✅ MVP completo | módulo standalone de artículos + movimientos (endpoint `/movements` con filtros y trazabilidad) |
| 5 | Cotizaciones | ✅ MVP completo | módulo standalone de documentos: cotizaciones + recibos con estados y PDF |
| 6 | Generación de documentos | ✅ MVP completo | módulo de documentos ampliado: 4 tipos (factura, nota de venta, cotización, recibo) + catálogo de conceptos con precio |
| 7 | Recordatorios WhatsApp/email | ✅ MVP completo | panel de envíos: canales (SMTP + webhook), histórico `reminder_logs` y API `/api/reminders` |
| 8 | Gestión de clientes | ✅ MVP completo | CRM liviano: módulo standalone de seguimientos (`/api/followups`) con estado, fecha límite y vencimientos |

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

## Probar el MVP (deportes)

```bash
npm run seed -w deportes   # crea el centro deportivo demo
npm run dev -w deportes    # http://localhost:3000
```

Credenciales demo: **slug** `demo-deportes` · **email** `demo@deportes.com` · **contraseña** `demo1234`

Demo: 5 canchas/instalaciones (Fútbol 7/11, Basquetbol, Frontón, Sala de Yoga),
reservas por bloque con detección de solape por cancha (409) y vistas de canchas
como recursos (color, capacidad y precio/hora).

## Probar el MVP (talleres)

```bash
npm run seed:talleres   # crea el taller demo
npm run dev:talleres    # http://localhost:3002
```

Credenciales demo: **slug** `demo-talleres` · **email** `demo@talleres.com` · **contraseña** `demo1234`

Demo: 3 mecánicos, 6 labores, 5 clientes, 8 piezas en inventario y 6 órdenes de trabajo.
Al abrir/editar/cancelar una orden, las piezas asignadas se descuentan o devuelven
automáticamente al inventario (con movimiento de stock trazable). Estados de orden:
Recibida, Presupuestada, En proceso, Completada y Cancelada.

## Probar el MVP (inventario)

```bash
npm run seed:inventario   # crea el almacén demo
npm run dev:inventario    # http://localhost:3003
```

Credenciales demo: **slug** `demo-inventario` · **email** `demo@inventario.com` · **contraseña** `demo1234`

Demo: 12 artículos con SKU, precio y mínimo de reorden; historial de movimientos
trazable (entradas/salidas con usuario, fecha y motivo) y filtros por tipo y
artículo; avisos de bajo stock y valor del inventario. El endpoint
`GET /api/inventory/movements` acepta `itemId`, `type=in|out` y `limit`.

## Probar el MVP (cotizaciones)

```bash
npm run seed:cotizaciones   # crea el despacho demo
npm run dev:cotizaciones    # http://localhost:3004
```

Credenciales demo: **slug** `demo-cotizaciones` · **email** `demo@cotizaciones.com` · **contraseña** `demo1234`

Demo: 5 clientes, cotizaciones con líneas (cantidad × precio), impuesto %, estados
Borrador → Enviada → Aceptada/Rechazada y recibos de cobros. Cada documento genera un
PDF listo para descargar/entregar con encabezado del negocio (nombre, dirección,
teléfono), detalle de líneas y totales con impuesto.

## Probar el MVP (documentos)

```bash
npm run seed:documentos   # crea el despacho demo
npm run dev:documentos    # http://localhost:3005
```

Credenciales demo: **slug** `demo-docupro` · **email** `demo@docupro.com` · **contraseña** `demo1234`

Demo: 5 clientes, catálogo de 8 conceptos con precio y 7 documentos de los **4 tipos**
(factura `F-`, nota de venta `NV-`, cotización `C-` y recibo `R-`) con estados y PDF
descargable. Al crear un documento puedes agregar líneas desde el catálogo o manuales,
con impuesto % y encabezado del negocio en el PDF (nombre, dirección y teléfono).

## Probar el MVP (recordatorios)

```bash
npm run seed:recordatorios   # crea el negocio demo
npm run dev:recordatorios    # http://localhost:3006
```

Credenciales demo: **slug** `demo-recordatorios` · **email** `demo@alertas.com` · **contraseña** `demo1234`

Demo: 2 profesionales, 5 servicios y 5 clientes con 6 citas (3 confirmadas dentro de
la ventana de 24 h). El scheduler corre cada minuto y envía recordatorios por los
canales activos sin duplicar. En "Envíos" ves el histórico (`reminder_logs`) con
filtros por canal/estado, y en "Próximas citas" puedes disparar un recordatorio de
prueba por Email o WhatsApp. Configura SMTP en `.env` y el webhook de WhatsApp por
negocio en Configuración. El webhook recibe `{ to, text }` con
`Authorization: Bearer <token>` (Twilio, 360dialog, WATI, plataforma propia).

## Probar el MVP (CRM / gestión de clientes)

```bash
npm run seed:crm   # crea el negocio demo
npm run dev:crm    # http://localhost:3007
```

Credenciales demo: **slug** `demo-crm` · **email** `demo@crmpro.com` · **contraseña** `demo1234`

Demo: 8 clientes con etiquetas (vip, nuevo, frecuente, mayorista, pendiente…), 10
visitas (6 realizadas + 4 próximas) y 6 seguimientos de contacto. El dashboard
resume la cartera (clientes con email/teléfono, vencidos, visitas a 30 días y
próximas). Los seguimientos soportan estado (pendiente/hecho/cancelado), fecha
límite y detección automática de vencidos; por cliente se consulta su resumen con
historial de visitas y seguimientos abiertos (`GET /api/customers/:id` y
`GET /api/followups/stats`).

## Probar el MVP (landing / pantalla principal)

```bash
npm run dev:landing    # http://localhost:3008
```

Pantalla principal de la suite AMG: mapa de las 8 herramientas operativas, cada
una con acceso directo a su subdominio (`peluqueria.amgdeveloper.cl`,
`deportes.amgdeveloper.cl`, `talleres.amgdeveloper.cl`, `inventario.amgdeveloper.cl`,
`cotizaciones.amgdeveloper.cl`, `docupro.amgdeveloper.cl`, `recordatorios.amgdeveloper.cl`
y `crm.amgdeveloper.cl`).

En producción el landing se sirve en **`https://desarrollo.amgdeveloper.cl`**
(construido con `docker compose up -d landing`, puerto `3108`). Registro DNS en
`ops/cloudflare-amgdeveloper.zone`.

## Comandos

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | arranca peluquería en modo watch (`tsx`) |
| `npm run seed` | siembra datos demo |
| `npm run dev:deportes` | arranca deportes en modo watch |
| `npm run seed:deportes` | siembra datos demo del centro deportivo |
| `npm run dev:talleres` | arranca talleres en modo watch |
| `npm run seed:talleres` | siembra datos demo del taller |
| `npm run dev:inventario` | arranca inventario en modo watch |
| `npm run seed:inventario` | siembra datos demo del almacén |
| `npm run dev:cotizaciones` | arranca cotizaciones en modo watch |
| `npm run seed:cotizaciones` | siembra datos demo del despacho |
| `npm run dev:documentos` | arranca documentos (DocuPro) en modo watch |
| `npm run seed:documentos` | siembra datos demo de documentos |
| `npm run dev:recordatorios` | arranca recordatorios en modo watch |
| `npm run seed:recordatorios` | siembra datos demo de recordatorios |
| `npm run dev:crm` | arranca el CRM (gestión de clientes) en modo watch |
| `npm run seed:crm` | siembra datos demo del CRM |
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
APP_NAME=Agenda de Citas
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