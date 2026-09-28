#!/usr/bin/env bash
# Despliegue de SaaS Mini: Core + nueve productos.
#
#   bash ~/projects/saas-mini/ops/deploy.sh
#
# Es idempotente: se puede volver a correr las veces que haga falta. Los pasos que
# tocan datos (respaldar, crear organizacion) estan todos pensados para que
# repetirlos no rompa nada ni duplique filas.
#
# Variables de entorno que lo controlan:
#   AMG_SKIP_BUILD=1        no reconstruir la imagen (iteraciones rapidas)
#   AMG_ORG_SLUG            slug de la organizacion (por defecto el de abajo)
#
# ── EL ORDEN DE ESTE SCRIPT NO SE PUEDE REORDENAR ────────────────────────────
# Hay tres dependencias que rompen si se tocan, y por eso estan en comentarios en
# cada paso y no en un doc aparte que nadie lee al depurar a las 3 de la manana:
#
#   1. Los ONCE secretos tienen que existir en el `.env` ANTES del primer comando
#      compose, y no solo del `up`. `docker compose` interpola el archivo ENTERO
#      para construir cualquier comando, incluso uno de un solo servicio: sin
#      `AMG_SSO_PAGOS_SECRET`, hasta `docker compose config` falla. Por eso se
#      rellenan con placeholders y solo despues se sustituyen por los de verdad.
#
#   2. El Core va PRIMERO y solo. Los secretos SSO de cada producto los genera y
#      guarda el Core en `core.sqlite`; si el producto arranca antes de que sus
#      secretos esten en el `.env`, queda con un placeholder y despues el login
#      falla con un error de firma que no dice nada de un placeholder.
#
#   3. La organizacion se crea ANTES de arrancar los productos: sin la empresa y
#      su suscripcion, un producto nuevo no tiene a quien servirle datos.
set -euo pipefail

RAIZ="${SAASMINI_RAIZ:-$HOME/projects/saas-mini}"
cd "$RAIZ"

# Hash de ESTA copia del script. El paso 2 hace `git pull`, que puede reemplazar
# `ops/deploy.sh` en disco CON ESTE MISMO SCRIPT en ejecucion. Bash lee el archivo
# por su file-descriptor, asi que al quedar el inode viejo huerfano sigue leyendo
# la version vieja (es como ejecutar "dentro" de un archivo que se sobrescribe).
# El paso 2 compara el hash y, si el disco cambio, se re-ejecuta con la version
# nueva: idempotente, y evita que "pulle, pero despliego con el codigo de hace un
# commit".
AMG_SCRIPT_INICIAL="$(sha256sum ops/deploy.sh)"

# El nombre del proyecto se fija a mano. Docker lo deduciria del nombre de la
# carpeta, y si alguien clona el repo en `saas-mini-2` los volumenes serian OTROS
# (con prefijo distinto) y arrancaria un stack vacio al lado del de produccion,
# con los datos intactos y sin ningun error visible. `name:` en los compose no
# cubre este porque el `-p` de la linea de comando manda sobre el.
PROYECTO=saas-mini
DC="docker compose -p $PROYECTO"

# ── La organizacion unica ───────────────────────────────────────────────────
ORG_SLUG="${AMG_ORG_SLUG:-talleres-el-mecanico}"
ORG_NAME="${AMG_ORG_NAME:-Talleres El Mecanico}"
ORG_EMAIL="${AMG_ORG_EMAIL:-demo@talleres.com}"
ORG_ROL=owner

PRODUCTOS=(espacios citas inventario solicitudes cotizaciones clientes activos checklists pagos)

paso()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
aviso() { printf '    \033[33m[aviso] %s\033[0m\n' "$*" >&2; }
fallar(){ printf '\n\033[31mFALLO: %s\033[0m\n' "$1" >&2; exit 1; }

# ── 0. Preflight ────────────────────────────────────────────────────────────
paso "0. Preflight"

command -v docker >/dev/null 2>&1 || fallar "no esta docker en el PATH"
docker info >/dev/null 2>&1 || fallar "docker no responde. Esta corriendo el daemon?"
[ -f "$RAIZ/docker-compose.yml" ] || fallar "no estoy en el repositorio ($RAIZ)"

# Espacio en disco: la imagen son varios GB y se reconstruye en cada deploy.
libre_kb=$(df -Pk "$RAIZ" | awk 'NR==2{print $4}')
[ "$libre_kb" -ge 6000000 ] || fallar "quedan $((libre_kb/1024)) MB libres en $RAIZ; hacen falta ~6 GB para la imagen"
info "$((libre_kb/1024)) MB libres en disco"

# ── 1. Secretos ─────────────────────────────────────────────────────────────
paso "1. Secretos en el .env"

# Escribe CLAVE=valor sustituyendo la linea si ya existe, o anadiendo al final.
# No se toca una clave que ya tiene valor: `AMG_SSO_ROOT_SECRET` deriva de el el
# secreto de cada producto, asi que regenerarlo invalida los nueve clientes SSO
# a la vez y nadie podria entrar a nada.
poner() {
  local clave="$1" valor="$2" generado="$3"
  if grep -q "^${clave}=" .env 2>/dev/null; then
    # En los secretos SSO SI se sobrescribe: el Core es la fuente de verdad y lo
    # que hay en el `.env` puede ser un placeholder de este mismo deploy.
    if [ "$generado" = "sobrescribir" ]; then
      local tmp; tmp="$(mktemp)"
      grep -v "^${clave}=" .env > "$tmp"
      printf '%s=%s\n' "$clave" "$valor" >> "$tmp"
      mv "$tmp" .env
      info "$clave actualizado desde el Core"
    else
      info "$clave ya existe, se conserva"
    fi
  else
    printf '%s=%s\n' "$clave" "$valor" >> .env
    info "$clave generado"
  fi
}

nuevo_secreto() { openssl rand -base64 48 | tr -d '=+/' | head -c 64; }

[ -f .env ] || { : > .env; chmod 600 .env; info ".env creado"; }

# 1a. Las dos raices: se generan UNA vez y no se vuelven a tocar mas nunca.
poner AMG_SESSION_SECRET  "$(nuevo_secreto)" conservar
poner AMG_SSO_ROOT_SECRET "$(nuevo_secreto)" conservar

# La contrasena NO se genera sola a proposito. Si el script inventara una y la
# perdiera nadie podria entrar, y una contrasena que solo existe en el historial
# del deploy tampoco cuenta. Si falta, se para aqui y se dice que hacer.
if ! grep -q '^AMG_BOOTSTRAP_PASSWORD=' .env; then
  fallar "falta AMG_BOOTSTRAP_PASSWORD en .env
    Es la contrasena de $ORG_EMAIL y hay que elegirla a mano, no se inventa sola.
    Genera una y agregala:
      printf 'AMG_BOOTSTRAP_PASSWORD=%s\n' \"\$(openssl rand -base64 18 | tr -d '=+/')\" >> .env
      chmod 600 .env"
fi
info "AMG_BOOTSTRAP_PASSWORD presente"

# 1b. Placeholders para los nueve secretos SSO. Solo para que el archivo de
# compose se pueda interpolar; los de verdad se ponen en el paso 5, con el Core
# ya arrancado. Un placeholder en el `.env` durante un deploy fallido es
# inofensivo: el paso 5 lo pisa antes de que arranque ningun producto.
for p in "${PRODUCTOS[@]}"; do
  mayusculas="$(printf '%s' "$p" | tr '[:lower:]' '[:upper:]')"
  poner "AMG_SSO_${mayusculas}_SECRET" "PENDIENTE-$(nuevo_secreto)" conservar
done
chmod 600 .env

# ── 2. Codigo ───────────────────────────────────────────────────────────────
paso "2. Codigo"
if [ -n "$(git status --porcelain)" ]; then
  aviso "hay cambios sin commitear; se despliegan igual, pero no se pueden reproducir"
fi
git fetch origin
git pull --ff-only origin main
info "en $(git rev-parse --short HEAD) ($(git log -1 --format=%s))"

# Si el pull reemplazo este mismo script (ver AMG_SCRIPT_INICIAL arriba), seguir
# ejecutando seria usar el codigo viejo a medias: bash sigue leyendo el inode que
# ya no esta en disco. Se re-ejecuta la copia nueva y se aprovechan los pasos ya
# hechos (el script es idempotente de arriba a abajo).
if [ "$(sha256sum ops/deploy.sh)" != "$AMG_SCRIPT_INICIAL" ]; then
  aviso "ops/deploy.sh cambio con el pull: me re-ejecuto con la version nueva"
  exec bash ops/deploy.sh
fi

# ── 3. Imagen ───────────────────────────────────────────────────────────────
if [ "${AMG_SKIP_BUILD:-0}" = "1" ]; then
  aviso "AMG_SKIP_BUILD=1: se usa la imagen que ya hay"
else
  paso "3. Build de la imagen"
  $DC build
fi

# ── 4. El Core, solo ────────────────────────────────────────────────────────
paso "4. Arrancar el Core"

# `landing` se levanta aqui y no con el `up` general porque es el unico que
# genera los secretos SSO de los demas. Los productos se paran todavia: arrancan
# en el paso 7, cuando su `.env` ya tiene los secretos de verdad.
$DC up -d landing

# Espera activa en vez de un `sleep`: si el Core tarda 3 s no se pierden 60, y si
# no levanta nunca el deploy dice "no levanta" y no "migrando...".
esperar_salud() {
  local url="$1" nombre="$2" intentos="${3:-60}"
  for ((i=1; i<=intentos; i++)); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      info "$nombre responde en $url"
      return 0
    fi
    sleep 2
  done
  echo "--- ultimas lineas de $nombre ---" >&2
  $DC logs --tail 30 "$nombre" >&2 2>/dev/null || true
  fallar "$nombre no responde en $url tras $((intentos*2)) s"
}

esperar_salud http://127.0.0.1:3108/health "el Core"

# El catalogo de los nueve productos. Idempotente.
$DC exec -T landing npm run seed -w @amg/platform
info "catalogo listo"

# ── 5. Los nueve secretos SSO de verdad ─────────────────────────────────────
paso "5. Secretos SSO reales (desde el Core)"

# El Core genera y PERSISTE el secreto de cada cliente en core.sqlite. Se leen de
# ahi y se escriben en el `.env`, siempre sobrescribiendo lo anterior.
#
# `LOG_LEVEL=warn` no es cosmetico: `sso:secret` imprime lineas de log por stdout
# y sin esto cada "Base central lista" se cuela dentro del valor del secreto. El
# `.env` queda con basura, el producto no valida firmas y el sintoma es un login
# roto sin ninguna pista de por que.
for p in "${PRODUCTOS[@]}"; do
  mayusculas="$(printf '%s' "$p" | tr '[:lower:]' '[:upper:]')"
  # `--loglevel=silent` calla el banner que npm imprime ANTES del script
  # (`> @amg/platform@0.1.0 sso:secret`) y que viaja por stdout. Sin el, sumado
  # al `tr -d`, banner y secreto llegaban pegados al `.env`: el producto firmaba
  # con un secreto roto y el login fallaba sin ninguna pista. LOG_LEVEL=warn
  # calla el logger de tsx (stderr). Con los dos, el stdout es SOLO el secreto.
  secreto="$($DC exec -T -e LOG_LEVEL=warn landing \
              npm --loglevel=silent run sso:secret -- "$p" --solo-secreto | tr -d '\r\n' || true)"
  # Validacion dura en vez de "si no esta vacio, sirve": un secreto mal
  # extraido es indistinguible de uno bueno a ojo, y escribirlo deja al producto
  # con una firma rota. Si el CLI no devolvio EXACTAMENTE base64url, se falla.
  case "$secreto" in
    '')    fallar "el Core no devolvio secreto para $p" ;;
    *' '*) fallar "el secreto de $p trae texto de mas (${secreto:0:24}...)" ;;
    *">"*) fallar "el secreto de $p trae basura de la salida (${secreto:0:24}...)" ;;
    PENDIENTE-*) fallar "el Core devolvio un placeholder para $p, no un secreto" ;;
  esac
  [[ "$secreto" =~ ^[A-Za-z0-9_-]{16,}$ ]] || {
    local_foto="${secreto:0:24}"
    fallar "el secreto de $p no es base64url valido ($local_foto...)"
  }
  poner "AMG_SSO_${mayusculas}_SECRET" "$secreto" sobrescribir
done
info "los ${#PRODUCTOS[@]} secretos copiados del Core al .env"

# ── 6. Empresa y usuario ────────────────────────────────────────────────────
paso "6. Empresa, usuario y suscripciones"
# Idempotente: si la empresa ya existe, la deja como esta y solo agrega lo que
# falte. Nunca cambia la contrasena de un usuario que ya existe, porque el hash
# esta en la base y reescribirlo dejaria al usuario con la clave anterior.
#
# El `tr -d '\r\n'` no es cosmetico. Si el `.env` se creo o edito en Windows, sus
# lineas acaban en CRLF, y `cut -d= -f2-` se lleva el CR pegado al final: la
# contrasena llega al bootstrap con un caracter invisible al final. El usuario
# escribe bien su clave, el hash no coincide y el unico sintoma es que "no puede
# entrar", sin ninguna pista de por que. Es un fallo que se Busca mucho tiempo.
$DC exec -T \
  -e AMG_BOOTSTRAP_PASSWORD="$(grep '^AMG_BOOTSTRAP_PASSWORD=' .env | cut -d= -f2- | tr -d '\r\n')" \
  landing npm run bootstrap -- \
    --slug "$ORG_SLUG" --name "$ORG_NAME" --email "$ORG_EMAIL" --role "$ORG_ROL"

# ── 7. El stack completo ────────────────────────────────────────────────────
paso "7. Levantar los nueve productos"
$DC up -d

paso "8. Salud de los nueve + el Core"
# El puerto sale de `docker compose port`, no de leer el `docker-compose.yml` ni de
# un array escrito a mano. Dos razones: hardcodear el mapa aqui es exactamente el
# bug que el comentario del compose describe (el puerto del archivo y el del proxy
# se desalinean y el dominio abre el producto equivocado sin error), y preguntar
# a Docker responde "que puerto esta ENLAZADO de verdad ahora", no "que dice el
# archivo".
#
# Tampoco se usa `node` para esto: este script no necesita node en el host, que
# en un servidor donde solo corre Docker puede no estar instalado. Todo lo que se
# ejecuta dentro de contenedores ya lleva su propio node en la imagen.
for p in "${PRODUCTOS[@]}"; do
  # `docker compose port` responde "127.0.0.1:3101"; se toma lo que va tras el
  # ultimo dos puntos, que es el puerto publicado (y no el 3000 de dentro).
  enlace="$($DC port "$p" 3000 2>/dev/null | head -1 | awk -F: '{print $NF}')"
  [ -n "$enlace" ] || fallar "$p no tiene el puerto 3000 publicado; el health check no tendria contra que probar"
  esperar_salud "http://127.0.0.1:${enlace}/health" "$p" 40
done
esperar_salud http://127.0.0.1:3108/health "el Core" 40

# ── 8. Resumen ──────────────────────────────────────────────────────────────
paso "Listo"
$DC ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
cat <<FIN

  Empresa:  $ORG_NAME  ($ORG_SLUG)
  Usuario:  $ORG_EMAIL
  Entrar:   https://${PLATAFORMA:-desarrollo.amgdeveloper.cl}

  El usuario ya tiene suscripcion a los ${#PRODUCTOS[@]} productos. La contrasena
  es la de AMG_BOOTSTRAP_PASSWORD y no se ha cambiado ni se muestra aqui.
FIN