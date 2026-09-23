# Imagen única para la suite SaaS Mini: core + 8 productos compilados.
# Cada contenedor ejecuta el workspace indicado por la variable PRODUCT.
FROM node:20-bookworm-slim

WORKDIR /app

# Herramientas de compilación para módulos nativos (better-sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Monorepo con workspaces (npm ci resuelve todos los package.json)
COPY package.json package-lock.json ./
COPY packages packages
COPY products products

# Instala dependencias de todos los workspaces y compila core + productos
RUN npm ci
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

# El workspace a ejecutar viene del environment (ej: PRODUCT=peluqueria).
# npm run start -w <product> corre `node dist/index.js` con CWD en el producto.
CMD ["sh", "-c", "npm run start -w \"$PRODUCT\""]