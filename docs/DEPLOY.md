# Desplegar en producción

Este es el camino para pasar la suite al servidor OCI. Todo lo que se puede
automatizar está en `ops/deploy.sh`; lo que queda aquí son los tres pasos que
**no** se pueden automatizar y que, en este orden, bloquean a los demás.

Si algo de acá contradice al código, el código manda.

## Dónde está cada cosa

| | |
|---|---|
| Servidor | `opc@146.181.55.59` |
| Repositorio | `~/projects/saas-mini` |
| Proyecto de Docker | `saas-mini` (los volúmenes son `saas-mini_saasmini_data_*`) |
| Nginx | `/etc/nginx/conf.d/saas-mini.conf` (productos) y `desarrollo.conf` (el Core) |
| Certificado | `saasmini-nuevo`, cubre los once nombres de abajo |
| Datos | volúmenes Docker. `ops/backup.sh` saca los nueve + el Core |

## Orden, y por qué en este orden

```
1. DNS (Cloudflare, a mano)     ─┐
2. Certificado (certbot)         ├─ el 3 depende del 1; el 4, del 2
3. Nginx (ops/nginx.conf)       ─┘
4. El stack (ops/deploy.sh)        depende del 3: si no, los dominios dan 502
```

Hacer el 3 antes del 1 deja los dominios sirviendo con un certificado que no los
cubre: el navegador muestra un aviso rojo en vez de dejar entrar. Hacer el 4
antes del 3 deja los dominios apuntando a puertos que no tienen nadie
escuchando: 502 en todos a la vez.

---

## 1. DNS

En el panel de Cloudflare, dejar los nueve nombres de producto **igual que el
slug** de cada uno, todos `A` a `146.181.55.59`:

| Nombre | Producto | Puerto |
|---|---|---|
| `citas` | citas | 3100 |
| `espacios` | espacios | 3101 |
| `solicitudes` | solicitudes | 3102 |
| `inventario` | inventario | 3103 |
| `cotizaciones` | cotizaciones | 3104 |
| `clientes` | clientes | 3105 |
| `activos` | activos | 3106 |
| `checklists` | checklists | 3107 |
| `pagos` | pagos | 3109 |

`desarrollo` (el Core) ya está bien, y `docs` + `recordatorios` se **conservan**
retirados: sus redirects los necesitan (ver sección de certificado).

Proxy naranja (activado) está bien: el challenge de Let's Encrypt sigue llegando
al origen a través de Cloudflare.

`ops/cloudflare-amgdeveloper.zone` es la lista de lo que debería existir.

## 2. Certificado

Se **amplía** el que ya hay, y no se pide uno nuevo. La razón es concreta: los
bloques de nginx apuntan a una ruta fija
(`/etc/letsencrypt/live/saasmini-nuevo/`), y un `certbot --nginx` a secas crea
un certificado nuevo con otra ruta, dejando los dos bloques sin el suyo.

```bash
sudo certbot certonly --cert-name saasmini-nuevo --expand \
  -d citas.amgdeveloper.cl -d espacios.amgdeveloper.cl \
  -d solicitudes.amgdeveloper.cl -d inventario.amgdeveloper.cl \
  -d cotizaciones.amgdeveloper.cl -d clientes.amgdeveloper.cl \
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

El script, en orden: rellena los secretos, construye la imagen, levanta el Core
solo, copia los nueve secretos SSO del Core al `.env`, crea la empresa y el
usuario con su suscripción, levanta los nueve y pregunta `/health` a cada uno.

Variables para iterar:

| | |
|---|---|
| `AMG_SKIP_BUILD=1` | no reconstruir la imagen |

## Qué queda a mano después

- **Copiar el respaldo fuera del servidor.** Un respaldo en el mismo disco que
  los datos no sobrevive a un fallo de ese disco, y este servidor no tiene RAID.
  Es el paso que más se olvida y el que más caro sale.
- Crear los registros DNS nuevos (paso 1) y comprobar que los dominios abren.

## Volver atrás

Si algo sale mal después del paso 4, los datos siguen ahí: el script no toca las
bases salvo para migrar su esquema hacia adelante, así que correr el deploy de
nuevo no pierde filas.

```bash
# Parar el stack y volver a levantar desde un backup bueno
cd ~/projects/saas-mini && docker compose -p saas-mini down
bash ops/restore.sh latest <producto>
```

- **Nginx**: el archivo del repo (paso 3) es el mismo que hay que volver a
  poner; es legible, a diferencia de un `nginx.conf` generado a mano.