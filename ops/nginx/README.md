# Configuracion nginx del servidor

Estos archivos son copias de los archivos vivos en `/etc/nginx/conf.d/`.
Se guardan aqui porque los proyectos a los que sirven **no tienen control de
versiones** (son solo carpetas en el servidor).

| Archivo | Sirve a | Puerto interno | Proyecto |
|---|---|---|---|
| `desarrollo.conf` | desarrollo.amgdeveloper.cl | 3108 | saas-mini (Core) |
| `gateway.conf` | agrobot.amgdeveloper.cl | 5173 | AgroBot-Alert |
| `gateway.conf` | taller.amgdeveloper.cl | 3043 | TallerMecanico |
| `transallendes.conf` | Transporte.amgdeveloper.cl | 3004 | transallendes |

El archivo `../nginx.conf` es el que usa `ops/deploy.sh` para los 9 productos
SaaS, y a diferencia de estos si se despliega de forma automatica.

## Como aplicar un cambio

```bash
# en el servidor, tras editar aca
cp ops/nginx/gateway.conf /etc/nginx/conf.d/gateway.conf
sudo nginx -t && sudo systemctl reload nginx
```

Nunca se copian los certificados de `/etc/letsencrypt/`, solo se referencian.
