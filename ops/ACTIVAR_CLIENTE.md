# Puerta de acceso · alta y renovación de clientes (manual, sin código)

Todo pasa por editar **1 archivo en el servidor**: `ops/clients.json` (montado en
`/app/clients.json`). El cambio aplica **al instante**: no se reinicia ni se
rebuilda nada, porque cada login re-lee el archivo.

## Ficha de un cliente

Cada cliente es un **slug** dentro del producto que contrató. Los slugs van
por producto porque cada app tiene su propio SQLite (los slugs de la lista demo
están aparte).

```json
{
  "enabled": true,
  "clients": {
    "peluqueria": ["demo-pelu", "pelu-jardin"],
    "deportes": ["demo-deportes"]
  }
}
```

## Procedimiento manual

| Paso | Acción |
|------|--------|
| 1. Captura | El cliente entra a `desarrollo.amgdeveloper.cl`, ve la demo y escribe por WhatsApp "Solicitar acceso". |
| 2. Cobro | Le pasas el depósito / datos bancarios (sección de pago de la landing). |
| 3. Alta | Agregas su slug al producto correspondiente en `ops/clients.json` (SSH al servidor, `nano ops/clients.json`). **Listo al instante.** |
| 4. Aviso | Le dices su slug y que cree su cuenta o entre con sus credenciales. |
| 5. Renovación | Cuando no renueva el plan, borras su slug (o pones `"enabled": false` para cerrar TODO temporalmente). Vuelve al instante a 403. |

## Activar / desactivar la puerta global

- **Puerta apagada (default):** todo sigue abierto como hoy (demos y cuentas libres).
- **Puerta encendida:** `"enabled": true`. Solo los slugs listados pueden
  autenticarse. El registro sigue permitido (captura lead) pero la cuenta queda
  "en revisión" hasta que agregues el slug.

## Notas

- Los slugs demo deben permanecer listados o los demos dejarán de abrir.
- Si ya existen tenants creados antes de prender la puerta y son clientes de
  pago, agrégales su slug al archivo antes de `"enabled": true`.
- El archivo se monta con `:ro` en el contenedor; se edita desde el host del
  servidor (`~/projects/saas-mini/ops/clients.json`).