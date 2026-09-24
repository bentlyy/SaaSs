#!/usr/bin/env bash
# Staging automático de SaaS Mini en el servidor OCI.
# Ejecutar: bash ~/projects/saas-mini/ops/deploy.sh
set -euo pipefail

cd "$HOME/projects/saas-mini"

echo "==> [1/5] Generando .env con JWT aleatorios (no versionado)"
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