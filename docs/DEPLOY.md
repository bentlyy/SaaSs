# Desplegar en producción

Este es el camino para pasar de la suite nueva al servidor OCI. Todo lo que se
puede automatizar está en `ops/deploy.sh`; lo que queda aquí son los tres pasos
que **no** se pueden automatizar y que, en este orden, bloquean a los demás.

Si algo de acá contradice al código, el código manda.

## Dónde está cada cosa

| | |
|---|---|
| Servidor | `opc@146.181.55.59` |
| Repositorio | `~/projects/saas-mini` |
| Proyecto de Docker | `saas-mini` (los volúmenes son `saas-mini_saasmini_data_*`) |
| Nginx | `/etc/nginx/conf.d/saas-mini.conf` (productos) y `desarrollo.conf` (el Core) |
| Certificado | `saasmini-nuevo`, cubre los once nombres de abajo |
| Datos | volúmenes Docker. `ops/backup.sh` saca los nueve + el Core; `ops/backup-legacy.sh` saca los siete legacy |

## Orden, y por qué en este orden

```
1. DNS (Cloudflare, a mano)     ─┐
2. Certificado (certbot)         ├─ el 3 depende del 1; el 4, del 2
3. Nginx (ops/nginx.conf)       ─┘
4. El stack (ops/deploy.sh)        depende del 3: si no, los dominios dan 502
```

hacer el 3 antes del 1 deja los dominios nuevos sirviendo con un certificado que
no los cubre: el navegador muestra un aviso rojo en vez de dejar entrar. Hacer el
4 antes del 3 deja los seis dominios viejos apuntando a puertos que ya no tienen
nadie escuchando: 502 en todos a la vez.

---

## 1. DNS

Crear en el panel de Cloudflare tres registros **A** a `146.181.55.59`:

| Nombre | Qué abre | Puerto |
|---|---|---|
| `activos` | activos | 3109 |
| `checklists` | checklists | 3110 |
| `pagos` | pagos | 3111 |

Proxy naranja (activado) está bien: el challenge de Let's Encrypt sigue llegando
al origen a través de Cloudflare.

Los otros ocho (`agenda`, `canchas`, `ordenes`, `stock`, `presupuestos`,
`clientes`, `desarrollo`, `docs`, `recordatorios`) ya existen. **No borrar** los
dos últimos: sus redirects los necesitan.

`ops/cloudflare-amgdeveloper.zone` es la lista de lo que debería existir.

## 2. Certificado

Se **amplía** el que ya hay, y no se pide uno nuevo. La razón es concreta: los
bloques de nginx apuntan a una ruta fija
(`/etc/letsencrypt/live/saasmini-nuevo/`), y un `certbot --nginx` a secas crea
un certificado nuevo con otra ruta, dejando los dos bloques sin el suyo.

```bash
sudo certbot certonly --cert-name saasmini-nuevo --expand \
  -d agenda.amgdeveloper.cl -d canchas.amgdeveloper.cl \
  -d ordenes.amgdeveloper.cl -d stock.amgdeveloper.cl \
  -d presupuestos.amgdeveloper.cl -d clientes.amgdeveloper.cl \
  -d docs.amgdeveloper.cl -d recordatorios.amgdeveloper.cl \
  -d activos.amgdeveloper.cl -d checklists.amgdeveloper.cl \
  -d pagos.amgdeveloper.cl
```

`docs` y `recordatorios` se siguen pidiendo **a propósito**. Sus productos ya no
existen, pero hay un 301 que los lleva al producto que los absorbió, y un redirect
en HTTPS con un nombre fuera del certificado enseña un aviso rojo en vez de
redirigir. Por eso van en la lista.

Comprobar que quedaron los once:

```bash
sudo openssl x509 -in /etc/letsencrypt/live/saasmini-nuevo/fullchain.pem \
  -noout -ext subjectAltName
```

## 3. Nginx

```bash
scp ops/nginx.conf opc@146.181.55.59:/tmp/saas-mini.conf.new
ssh opc@146.181.55.59 'sudo cp /tmp/saas-mini.conf.new /etc/nginx/conf.d/saas-mini.conf && sudo nginx -t && sudo systemctl reload nginx'
```

Este archivo usa un `map $host → upstream` en vez de un bloque por dominio. La
tabla del principio es la única fuente de verdad de qué puerto abre cada
dominio, y tiene que coincidir con los `ports:` de `docker-compose.yml`.

`desarrollo.amgdeveloper.cl` **no** se toca: vive en `desarrollo.conf`, con su
propio certificado, y ya apunta a 3108.

Para probar la sintaxis **sin** tocar el que está corriendo: copiar el archivo,
`nginx -t`, y restaurar. No hace falta recargar; la configuración en memoria del
proceso no cambia por escribir el archivo.

## 4. El stack

```bash
ssh opc@146.181.55.59
cd ~/projects/saas-mini
git pull
cp .env.example .env      # solo la primera vez; chmod 600 .env
```

Editar `.env` y poner **una sola cosa a mano**: la contraseña del usuario.

```bash
printf 'AMG_BOOTSTRAP_PASSWORD=%s\n' "$(openssl rand -base64 18 | tr -d '=+/')" >> .env
chmod 600 .env
```

Las otras diez no se inventan: `AMG_SESSION_SECRET` y `AMG_SSO_ROOT_SECRET` las
genera el script la primera vez y no las vuelve a tocar, y los nueve secretos SSO
los pide al Core y los escribe. Ponerlos a mano hace que los productos rechacen
todos los tokens.

Y luego:

```bash
bash ops/deploy.sh
```

El script, en orden: comprueba que los volúmenes legacy existen, rellena los
secretos, construye la imagen, **respalda los volúmenes legacy y para si el
respaldo falla**, levanta el Core solo, copia los nueve secretos SSO del Core al
`.env`, crea la empresa y el usuario, migra los datos uno por uno, levanta los
nueve y pregunta `/health` a cada uno.

Variables para iterar:

| | |
|---|---|
| `AMG_SKIP_BUILD=1` | no reconstruir la imagen |
| `AMG_SKIP_MIGRATIONS=1` | no migrar |
| `AMG_SKIP_LEGACY_BACKUP=1` | desplegar sin respaldar (solo si ya se respaldó a mano) |
| `AMG_VERBOSE=1` | ver el informe completo de cada migración |

## Qué queda a mano después

- **Copiar el respaldo fuera del servidor.** Un respaldo en el mismo disco que
  los datos no sobrevive a un fallo de ese disco, y este servidor no tiene RAID.
  Es el paso que más se olvida y el que más caro sale.
- **No borrar los volúmenes legacy.** Hasta que exista un respaldo externo
  verificado, son lo único que no se puede regenerar si un migrador tenía un bug.
- Crear los registros DNS nuevos (paso 1) y comprobar que los dominios abren.

## Volver atrás

Si algo sale mal después del paso 4, los datos siguen ahí: el script no borra
volúmenes legacy en ningún momento, y los migradores son idempotentes, así que
volver a correrlo no duplica filas.

```bash
# 1. Parar el stack nuevo
cd ~/projects/saas-mini && docker compose -p saas-mini down
```

Volver al legacy de verdad son tres cosas, y conviene tenerlas claras **antes**
de necesitarlas:

1. **Restaurar los volúmenes** desde un `ops/backup-legacy.sh`. Cada carpeta
   lleva un `MANIFIESTO.txt` con el `.db` de cada producto y el volumen del que
   salió.
2. **El `docker-compose.yml` viejo**, que está en el historial de git:
   `git log --oneline -- docker-compose.yml` y volver a ese commit. Los puertos
   viejos (3105, 3106) y los seis servicios originales.
3. **Nginx**: el archivo anterior está en el servidor como
   `/etc/nginx/conf.d/saas-mini.conf.pre-tls`, pero ese es el de antes de TLS y
   **no sirve tal cual**. Lo que hay que hacer es rehacer los `server_name` con
   los puertos del punto 2. Por eso el paso 3 de este documento deja el `map` en
   un archivo del repo: es el mismo archivo el que hay que volver a poner, y es
   legible, a diferencia de un `nginx.conf` generado.

Vale la pena tener un `ops/nginx-legacy.conf` guardado **antes** del primer
despliegue, no cuando haya que volver atrás con urgencia.
