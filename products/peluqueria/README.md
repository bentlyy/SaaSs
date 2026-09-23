# PeluqueríaPro — Agenda y gestión para peluquerías y barberías

Producto #1 del suite **SaaS Mini**. Corre sobre el core común
(`@saas-mini/core`) con los módulos de agenda, clientes, servicios, empleados,
inventario, documentos/cotizaciones y recordatorios.

## Funcionalidad

- **Multi-tenant**: cada negocio crea su cuenta (slug único) y solo ve sus datos.
- **Agenda semanal** con detección de conflictos por empleado y estado por cita
  (pendiente / confirmada / completada / cancelada / no asistió).
- **Clientes, servicios y empleados** (empleados con sus servicios).
- **Recordatorios automáticos**: cada minuto, el scheduler envía avisos por email
  y/o WhatsApp a las citas confirmadas según las horas configuradas por negocio.
- **Cotizaciones y recibos en PDF** descargables.
- **Inventario** con control de stock bajo y movimientos (entradas/salidas).
- Roles: `owner` (todo) y `staff` (solo lectura de agenda y clientes).

## Empezar

```bash
cd products/peluqueria
cp .env.example .env      # edita JWT_SECRET
npm run seed              # datos demo
npm run dev               # http://localhost:3000
```

Demo: `demo-pelu` / `demo@pelu.com` / `demo1234`

## Recordatorios

- **Email**: requiere `SMTP_HOST` en `.env` + "Enviar por email" activado en
  Configuración del negocio.
- **WhatsApp**: en Configuración pega la URL de webhook de tu pasarela y su token.
  El webhook recibe `{ to, text }` con el mensaje ya formado.
- Sin configuración no falla nada: los intentos se registran como `failed` en
  `reminder_logs` para depurar después.

## Producción

```bash
npm run build
npm start                 # node dist/index.js
```

El único estado que hay que respaldar es el archivo SQLite en `./data/`.