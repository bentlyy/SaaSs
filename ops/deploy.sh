#!/usr/bin/env bash
# Despliegue de SaaS Mini: Core + nueve productos, con migracion de los legacy.
#
#   bash ~/projects/saas-mini/ops/deploy.sh
#
# Es idempotente: se puede volver a correr las veces que haga falta. Los pasos que
# tocan datos (respaldar, crear organizacion, migrar) estan todos pensados para
# que repetirlos no rompa nada ni duplique filas.
#
# Variables de entorno que lo controlan:
#   AMG_SKIP_BUILD=1        no reconstruir la imagen (iteraciones rapidas)
#   AMG_SKIP_MIGRATIONS=1   no correr los migradores
#   AMG_SKIP_LEGACY_BACKUP=1  NO hacerlo: solo si ya respaldaste a mano
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
#   3. La organizacion se crea ANTES de migrar. Los migradores resuelven la
#      empresa destino con el Core, y si no existe crean datos huerfanos: filas
#      en los productos que no aparecen en ninguna cuenta y que despues hay que
#      ir a buscar a mano.
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
MIG="$DC -f ops/migrate.compose.yml"

# ── La organizacion unica ───────────────────────────────────────────────────
# Los siete tenants legacy son SIETE empresas demo distintas con datos que en
# realidad son del mismo ejercicio. Sin esto, cada migrador resolveria su propia
# organizacion y quedarian nueve empresas vacias y los datos repartidos entre
# ellas, sin ningun usuario que las pueda ver. Ver la nota de `migrate.compose.yml`.
ORG_SLUG="${AMG_ORG_SLUG:-talleres-el-mecanico}"
ORG_NAME="${AMG_ORG_NAME:-Talleres El Mecanico}"
ORG_EMAIL="${AMG_ORG_EMAIL:-demo@talleres.com}"
ORG_ROL=owner

PRODUCTOS=(espacios citas inventario solicitudes cotizaciones clientes activos checklists pagos)

# Los ocho servicios de migracion, en orden. `citas` aparece tres veces porque su
# CLI acepta UNA fuente por corrida. Todos escriben en la misma core.sqlite, asi
# que nunca en paralelo.
MIGRACIONES=(
  migrar-espacios
  migrar-solicitudes
  migrar-inventario
  migrar-citas-peluqueria
  migrar-citas-crm
  migrar-citas-recordatorios
  migrar-clientes
  migrar-cotizaciones
)

LEGACY=(peluqueria deportes talleres documentos crm recordatorios inventario)

paso()  { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
aviso() { printf '    \033[33m[aviso] %s\033[0m\n' "$*" >&2; }
fallar(){ printf '\n\033[31mFALLO: %s\033[0m\n' "$1" >&2; exit 1; }

# ── 0. Preflight ────────────────────────────────────────────────────────────
paso "0. Preflight"

command -v docker >/dev/null 2>&1 || fallar "no esta docker en el PATH"
docker info >/dev/null 2>&1 || fallar "docker no responde. Esta corriendo el daemon?"
[ -f "$RAIZ/docker-compose.yml" ] || fallar "no estoy en el repositorio ($RAIZ)"

# Los volumenes legacy tienen que existir TODOS antes de tocar nada. Si alguno
# no esta, es que se esta desplegando en el servidor equivocado, y seguir
# significaria que los migradores no encuentran la fuente: o fallan, o peor,
# crean el destino vacio y el deploy "termina bien" sin datos.
faltan=()
for p in "${LEGACY[@]}"; do
  docker volume inspect "$PROYECTO"_saasmini_data_"$p" >/dev/null 2>&1 || faltan+=("$p")
done
if [ ${#faltan[@]} -gt 0 ]; then
  fallar "faltan volumenes legacy: ${faltan[*]}
    Esto NO es un servidor con los datos. No se sigue: se desplegaria el stack
    nuevo y las migraciones no tendrian nada que leer."
fi
info "los ${#LEGACY[@]} volumenes legacy estan"

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

# ── 4. Respaldo de los legacy, ANTES de nada ────────────────────────────────
# Este es el paso que hace que todo lo demas sea reversible. Va antes de parar
# un solo contenedor, y si falla, el script se para: es preferible no desplegar
# a desplegar sin red.
if [ "${AMG_SKIP_LEGACY_BACKUP:-0}" = "1" ]; then
  aviso "AMG_SKIP_LEGACY_BACKUP=1: se desplega SIN respaldo de los legacy"
else
  paso "4. Respaldo de los volumenes legacy"
  bash ops/backup-legacy.sh
fi

# ── 5. El Core, solo ────────────────────────────────────────────────────────
paso "5. Arrancar el Core"

# `landing` se levanta aqui y no con el `up` general porque es el unico que
# genera los secretos SSO de los demas. Los productos se paran todavia: arrancan
# en el paso 8, cuando su `.env` ya tiene los secretos de verdad.
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

# ── 6. Los nueve secretos SSO de verdad ─────────────────────────────────────
paso "6. Secretos SSO reales (desde el Core)"

# El Core genera y PERSISTE el secreto de cada cliente en core.sqlite. Se leen de
# ahi y se escriben en el `.env`, siempre sobrescribiendo lo anterior.
#
# `LOG_LEVEL=warn` no es cosmetico: `sso:secret` imprime lineas de log por stdout
# y sin esto cada "Base central lista" se cuela dentro del valor del secreto. El
# `.env` queda con basura, el producto no valida firmas y el sintoma es un login
# roto sin ninguna pista de por que.
for p in "${PRODUCTOS[@]}"; do
  mayusculas="$(printf '%s' "$p" | tr '[:lower:]' '[:upper:]')"
  secreto="$($DC exec -T -e LOG_LEVEL=warn landing \
              npm run sso:secret -- "$p" --solo-secreto | tr -d '\r\n')"
  # Un secreto vacio o con el placeholder significa que el CLI fallo. Escribirlo
  # igual dejaria el producto con una puerta abierta de par en par.
  [ -n "$secreto" ] || fallar "el Core no devolvio secreto para $p"
  case "$secreto" in
    PENDIENTE-*) fallar "el Core devolvio un placeholder para $p, no un secreto" ;;
  esac
  poner "AMG_SSO_${mayusculas}_SECRET" "$secreto" sobrescribir
done
info "los ${#PRODUCTOS[@]} secretos copiados del Core al .env"

# ── 7. Empresa y usuario ────────────────────────────────────────────────────
paso "7. Empresa, usuario y suscripciones"
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

# ── 8. Migraciones ──────────────────────────────────────────────────────────
if [ "${AMG_SKIP_MIGRATIONS:-0}" = "1" ]; then
  aviso "AMG_SKIP_MIGRATIONS=1: NO se migra nada"
else
  paso "8. Migrar los datos legacy (una por vez)"
  # La organizacion destino. El `:?` de `migrate.compose.yml` aborta si no viene.
  # Ojo con exportar el VALOR derivado y no la variable de control: exportar
  # `AMG_ORG_SLUG` a secas pondria un valor vacio y el compose no lo distingue
  # de un no definido ("missing a value").
  export AMG_ORG_SLUG="$ORG_SLUG"
  # Los migradores importan `config.ts` del Core, que en produccion exige estos
  # dos secretos al cargar el modulo. El CLI no firma sesiones, pero el import
  # no lo sabe: sin ellos muere con "Falta la variable de entorno ...". Estan en
  # el .env, no en el shell, asi que se leen y se exportan aqui.
  for v in AMG_SESSION_SECRET AMG_SSO_ROOT_SECRET; do
    valor="$(grep -m1 "^${v}=" .env | cut -d= -f2- 2>/dev/null || true)"
    [ -n "$valor" ] || fallar "falta ${v} en el .env"
    export "$v=$valor"
  done
  fallos=0
  for m in "${MIGRACIONES[@]}"; do
    printf '    %-28s ' "$m"
    if salida="$($MIG run --rm "$m" 2>&1)"; then
      # El migrador imprime su informe; se deja la ultima linea no vacia, que
      # es el resumen, y el detalle va al log si alguien lo pide con --verbose.
      resumen="$(printf '%s\n' "$salida" | grep -E 'migrad|resumen|filas' | tail -1)"
      info "${resumen:-ok}"
      [ "${AMG_VERBOSE:-0}" = "1" ] && printf '%s\n' "$salida"
    else
      fallos=$((fallos + 1))
      printf '\n'
      aviso "FALLO $m"
      printf '%s\n' "$salida" | tail -20
    fi
  done
  if [ "$fallos" -gt 0 ]; then
    fallar "$fallos migracion(es) fallaron. NO se levanta el stack nuevo.
    Lo legacy sigue intacto y en su sitio. Revisa el log de arriba y repite
    este script: son idempotentes."
  fi
fi

# ── 9. El stack completo ────────────────────────────────────────────────────
paso "9. Levantar los nueve productos"
$DC up -d

paso "10. Salud de los nueve + el Core"
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

# ── 11. Resumen ─────────────────────────────────────────────────────────────
paso "Listo"
$DC ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
cat <<FIN

  Empresa:  $ORG_NAME  ($ORG_SLUG)
  Usuario:  $ORG_EMAIL
  Entrar:   https://${PLATAFORMA:-desarrollo.amgdeveloper.cl}

  El usuario ya tiene suscripcion a los ${#PRODUCTOS[@]} productos. La contrasena
  es la de AMG_BOOTSTRAP_PASSWORD y no se ha cambiado ni se muestra aqui.

  Pendiente de hacer a mano:
    - Copiar el respaldo legacy FUERA de este servidor. Un respaldo en el mismo
      disco que los datos no es un respaldo.
    - Los volumenes legacy NO se borran. Sigue siendo lo unico que no se puede
      regenerar si un migrador resulto tener un bug.
FIN
