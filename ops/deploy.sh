#!/usr/bin/env bash
# Staging automático de SaaS Mini en el servidor OCI.
# Ejecutar: bash ~/projects/saas-mini/ops/deploy.sh
set -euo pipefail

cd "$HOME/projects/saas-mini"

echo "==> [1/5] Config local: .env con JWT aleatorios + ops/clients.json"
if [ ! -f .env ]; then
  cat > .env << EOF
PELU_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
DEPO_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
TALLE_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
INV_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
COTI_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
DOCU_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
ALER_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
CRM_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
LAND_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)
EOF
  chmod 600 .env
  echo "    .env creado con llaves nuevas"
else
  echo "    .env ya existe, se conserva"
  if ! grep -q '^LAND_JWT=' .env; then
    echo "LAND_JWT=$(openssl rand -base64 48 | tr -d '=+/' | head -c 64)" >> .env
    chmod 600 .env
    echo "    LAND_JWT agregado al .env existente"
  fi
fi

# La lista de clientes NO se versiona: es config por servidor. Si no existe, se
# siembra desde la plantilla con la puerta ENCENDIDA y los demos autorizados.
# Debe existir antes de `docker compose up`, porque compose lo monta como archivo.
if [ ! -f ops/clients.json ]; then
  cp ops/clients.example.json ops/clients.json
  chmod 600 ops/clients.json
  echo "    ops/clients.json creado desde la plantilla (puerta encendida, solo demos)"
else
  echo "    ops/clients.json ya existe, se conserva"
  if ! node -e "JSON.parse(require('fs').readFileSync('ops/clients.json','utf8'))" 2>/dev/null; then
    echo "    [warn] ops/clients.json tiene JSON invalido: la puerta quedara CERRADA y nadie podra entrar"
  fi
  if ! grep -q '"enabled": *true' ops/clients.json; then
    echo "    [warn] enabled != true: en produccion la puerta queda CERRADA, no abierta"
  fi
fi

echo "==> [2/5] git pull (fast-forward)"
git fetch origin
git pull --ff-only origin main

echo "==> [3/5] Build de imagen"
docker compose build

echo "==> [4/5] Levantar los 8 servicios"
docker compose up -d

echo "==> [5/5] Seed de los productos demo"
for p in peluqueria deportes talleres inventario cotizaciones documentos recordatorios crm; do
  echo "    - seed $p"
  docker compose run --rm --no-deps "$p" npm run seed -w "$p" || echo "    [warn] seed $p fallo"
done

echo
echo "==> Listo. Resumen:"
docker compose ps