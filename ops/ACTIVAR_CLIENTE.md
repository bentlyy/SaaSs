# Puerta de acceso · alta y renovación de clientes (manual, sin código)

Todo pasa por editar **1 archivo en el servidor**: `ops/clients.json` (montado en
`/app/clients.json`). El cambio aplica **al instante**: no se reinicia ni se
rebuilda nada, porque cada login y cada registro re-leen el archivo.

Ese archivo **no se versiona** (está en `.gitignore`): es configuración de cada
instalación. La plantilla sí lo está, en `ops/clients.example.json`, y
`ops/deploy.sh` la copia a `ops/clients.json` la primera vez, con la puerta ya
encendida y solo los demos autorizados. Así el repo nunca te pisa la lista de
clientes reales ni te ensucia el `git status` del servidor.

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

## Qué bloquea y qué no

| | Registrarse | Entrar |
|---|---|---|
| Slug **autorizado** | 201, cuenta creada | 200, sesión iniciada |
| Slug **no autorizado** | **403**, no se crea nada | 403 `Tu acceso está en pausa…` |
| `"enabled": false` | 201 | 200 |

El rechazo en el registro ocurre **antes de escribir en la base**: un slug no
autorizado no deja tenants, usuarios ni empleados huérfanos. La captación de
clientes ocurre en la landing (CTA de WhatsApp), no por el endpoint de registro.

## ⚠️ OJO: el editor con el que guardes

`ops/clients.json` se monta como **archivo** dentro del contenedor. El montaje
apunta al *inode* que existía cuando se creó el contenedor, no al nombre de la
ruta. Si tu editor **reemplaza** el archivo (escribe en un temporal y renombra),
que es lo que hacen `sed -i`, `mv` y varios editores gráficos, el inode cambia y
**los contenedores siguen leyendo el contenido viejo**: cambiarás el archivo y
la puerta no se moverá, sin ningún aviso.

Formas de guardar que **sí** funcionan al instante:

```bash
nano ops/clients.json       # nano escribe in-place
jq ... > /tmp/x && cat /tmp/x > ops/clients.json
node -e "...writeFileSync('ops/clients.json', ...)..."   # writeFileSync trunca in-place
```

Si ya lo rompiste (o no estás seguro), fuerza la recreación de contenedores y el
montaje se rehace contra el inode actual:

```bash
cd ~/projects/saas-mini
docker compose up -d --force-recreate
```

Comprobar que el contenedor ve lo mismo que el host:

```bash
echo "host: $(stat -c %i ops/clients.json)  cont: $(docker exec saasmini-crm stat -c %i /app/clients.json)"
```

Los dos números deben coincidir. Si no coinciden, el montaje está obsoleto.

## Activar / desactivar la puerta global

- **Puerta apagada:** `"enabled": false`. Todo abierto: cualquiera se registra y entra.
- **Puerta encendida:** `"enabled": true`. Solo los slugs listados pueden registrarse y entrar.

## Notas

- Los slugs demo deben permanecer listados o los demos dejarán de abrir.
- Si ya existen tenants creados antes de prender la puerta y son clientes de
  pago, agrégales su slug al archivo antes de `"enabled": true`.
- El archivo se monta con `:ro` en el contenedor; se edita desde el host del
  servidor (`~/projects/saas-mini/ops/clients.json`).
- Si borras el archivo por error, la puerta queda **abierta** (fail-open). Recréalo
  desde la plantilla y verifica el montaje.
