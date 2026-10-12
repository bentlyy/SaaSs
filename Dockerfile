# Imagen única para la suite SaaS Mini: core + plataforma central + 8 productos.
# Cada contenedor ejecuta el workspace indicado por la variable PRODUCT.
# PRODUCT=landing levanta el Core (@amg/platform) con la web de la plataforma.
FROM node:20-bookworm-slim

WORKDIR /app

# Herramientas de compilación para módulos nativos (better-sqlite3).
# git es necesario porque @amg/core llega como dependencia git (no vive en el
# monorepo): sin git, `npm ci` no puede clonar el repo del core.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ git \
  && rm -rf /var/lib/apt/lists/*

# @amg/core viene como dependencia git (git+https://github.com/bentlyy/amg-core)
# y npm normaliza esas URLs a `git+ssh` en el lockfile. El servidor no tiene
# llave SSH para clonarla: se reescribe a HTTPS, que para un repo publico clona
# anonimo. Omitir esto rompe `npm ci` con "Permission denied (publickey)".
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/ \
 && git config --global url."https://github.com/".insteadOf git@github.com:

# Monorepo con workspaces (npm ci resuelve todos los package.json)
COPY package.json package-lock.json ./
COPY packages packages
COPY products products

# Instala dependencias de todos los workspaces y compila core + productos
# `npm cache clean --force` evita que la caché de npm (centenares de MB en
# /root/.npm/_cacache) se meta como capa de la imagen: en el server, esa capa
# ya reventó el disco EN la exportación ("no space left on device").
RUN npm ci \
  && npm cache clean --force \
  && rm -rf /root/.npm/_logs
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# --- Hardening: ejecutar como usuario NO-root (node, uid 1000) ---
# Cada servicio persiste su SQLite en un volumen nombrado montado en /app/data/<producto>.
# Los volúmenes nombrados heredan la propiedad del directorio de montaje de la imagen;
# por eso creamos /app/data y lo entregamos a node ANTES de montar (copy-on-first-use).
# /app/data/core es el punto de montaje del Core (core.sqlite): tiene que existir con
# node como dueño, o better-sqlite3 no puede crear el archivo y el arranque falla.
RUN mkdir -p /app/data/core && chown -R node:node /app/data

# El workspace a ejecutar viene del environment (ej: PRODUCT=@amg/espacios).
# npm run start -w <product> corre `node dist/index.js` con CWD en el producto.
USER node
CMD ["sh", "-c", "npm run start -w \"$PRODUCT\""]