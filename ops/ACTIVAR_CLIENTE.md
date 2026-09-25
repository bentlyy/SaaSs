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
| `"enabled": false` en producción | **403** | **403** |
| archivo ausente o corrupto en producción | **403** | **403** |

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

**En producción la puerta solo se abre con `"enabled": true`.** Cualquier otro
valor —`false`, ausente, o un archivo que no exista o no sea JSON válido— deja
la puerta **cerrada**: nadie puede registrarse ni entrar.

Antes era al revés: un archivo roto abría la puerta y cualquiera se registraba
gratis. Con clientes pagando, "se me borró el archivo" no puede significar "entra
todo el mundo".

En desarrollo (`NODE_ENV` distinto de `production`) sí sigue abierta si no hay
archivo, para no tener que crear un `clients.json` cada vez que levantas en local.

Esto significa que **`"enabled": false` ya no apaga nada en producción**. Para
pausar a un cliente se borra su slug de la lista, que es la operación que ya
estaba documentada y es reversible al instante.

### Si la puerta se cierra por un error de configuración

Tres señales, para que no haya que adivinar:

1. **El log del contenedor**, una sola vez al arrancar:
   `[clientsGuard] PUERTA CERRADA (faltante): no existe /app/clients.json...`
2. **`/health`**, que ahora incluye el estado de la puerta:
   ```bash
   curl -s https://clientes.amgdeveloper.cl/health
   # {"ok":true,"product":"crm","name":"Gestión de Clientes",
   #  "puerta":{"cerrada":true,"source":"faltante"}}
   ```
   `source` puede ser `archivo` (todo bien), `faltante`, `invalido` o
   `desactivado`. No expone la ruta del archivo porque `/health` es público.
3. **Todos los logins devuelven 403**, incluidos los de los clientes de pago.

La causa más probable de las tres es el *inode* obsoleto de la sección anterior,
no un archivo realmente roto. Verifica con el `stat` de más arriba.

Y si el archivo se perdió de verdad, está en el backup diario:
`~/backups/saasmini/<sello>/config/clients.json` (ver `ops/README_BACKUP.md`).

## Notas

- Los slugs demo deben permanecer listados o los demos dejarán de abrir.
- Si ya existen tenants creados antes de prender la puerta y son clientes de
  pago, agrégales su slug al archivo.
- El archivo se monta con `:ro` en el contenedor; se edita desde el host del
  servidor (`~/projects/saas-mini/ops/clients.json`).
- `ops/clients.json` **no está en git** a propósito. La plantilla versionada es
  `ops/clients.example.json`, y el backup diario copia el archivo vivo.
