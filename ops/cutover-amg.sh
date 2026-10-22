#!/usr/bin/env bash
set -euo pipefail

CONF="$HOME/amgdeveloper.conf.staged"
CERT="/etc/nginx/ssl/amgdeveloper.pem"
KEY="/etc/nginx/ssl/amgdeveloper.key"
APP="$HOME/projects/saas-mini"

sudo test -f "$CERT" || { echo "Falta $CERT"; exit 1; }
sudo test -f "$KEY" || { echo "Falta $KEY"; exit 1; }
test -f "$CONF" || { echo "Falta $CONF"; exit 1; }

sudo cp "$CONF" /etc/nginx/conf.d/amgdeveloper.conf
sudo nginx -t
sudo systemctl reload nginx

cd "$APP"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp docker-compose.yml "docker-compose.yml.bak.$STAMP"
sed -i 's#https://desarrollo\.amgdeveloper\.cl#https://amgdeveloper.cl#g' docker-compose.yml
test "$(grep -c 'CORE_URL: https://amgdeveloper.cl' docker-compose.yml)" -eq 10

sudo docker compose up -d
sleep 5

curl -ksS -o /dev/null -w 'apex / -> %{http_code}\n' --resolve amgdeveloper.cl:443:127.0.0.1 https://amgdeveloper.cl/
curl -ksS -o /dev/null -w 'apex /privacy -> %{http_code}\n' --resolve amgdeveloper.cl:443:127.0.0.1 https://amgdeveloper.cl/privacy
curl -ksS -o /dev/null -w 'www /privacy -> %{http_code}\n' --resolve www.amgdeveloper.cl:443:127.0.0.1 https://www.amgdeveloper.cl/privacy

echo "Corte aplicado. desarrollo.amgdeveloper.cl retirado."
echo "Backup compose: $APP/docker-compose.yml.bak.$STAMP"
