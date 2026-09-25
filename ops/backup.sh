#!/usr/bin/env bash
# Backup completo de SaaS Mini: las 8 SQLite + los archivos que NO estan en git.
#
# Lo que no esta en git es justamente lo mas fragil:
#   .env             -> JWT_SECRET. Si se pierde, nadie puede iniciar sesion.
#   ops/clients.json -> la whitelist de la puerta. Si se pierde y el guard esta
#                       fail-open, cualquiera se registra gratis.
# Por eso el backup copia tambien la configuracion, con permisos 600.
#
# Consistente sin downtime: snapshot via la API de backup de SQLite con la app
# escribiendo. Verifica la integridad de cada copia y de los archivos mismos
# (SHA256SUMS). Si algo falla, sale con codigo != 0 y systemd lo marca failed.
#
# Uso:  ops/backup.sh
# Env:  SAASMINI_RAIZ, SAASMINI_BACKUPS, SAASMINI_RETENCION, SAASMINI_IMAGEN
set -euo pipefail

RAIZ="${SAASMINI_RAIZ:-$HOME/projects/saas-mini}"
DESTINO_RAIZ="${SAASMINI_BACKUPS:-$HOME/backups/saasmini}"
RETENCION="${SAASMINI_RETENCION:-14}"
# La imagen se deduce del contenedor que ya esta corriendo en vez de escribirla a
# mano: si compose le cambia el tag, el backup sigue funcionando en vez de
# fallar con un "no such image" a las 3 de la mañana.
IMAGEN="${SAASMINI_IMAGEN:-$(docker inspect -f '{{.Config.Image}}' saasmini-crm 2>/dev/null || true)}"
IMAGEN="${IMAGEN:-saas-mini:latest}"

log()  { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fallar() { log "FALLO: $*"; exit 1; }

[ -d "$RAIZ" ] || fallar "no existe $RAIZ"
[ -f "$RAIZ/ops/sqlite-snapshot.mjs" ] || fallar "falta ops/sqlite-snapshot.mjs"
docker image inspect "$IMAGEN" >/dev/null 2>&1 || fallar "no existe la imagen $IMAGEN (levanta el stack antes de respaldar)"

# producto -> volumen. Los nombres siguen docker-compose.yml.
# Ojo: en `declare -A` el '=' va pegado a la clave. Con espacios bash lo
# interpreta como lista de palabras y el mapa queda roto en silencio.
# El landing queda fuera a proposito: no tiene base de datos.
declare -A VOL=(
  [peluqueria]=saas-mini_saasmini_data_peluqueria
  [crm]=saas-mini_saasmini_data_crm
  [deportes]=saas-mini_saasmini_data_deportes
  [talleres]=saas-mini_saasmini_data_talleres
  [recordatorios]=saas-mini_saasmini_data_recordatorios
  [documentos]=saas-mini_saasmini_data_documentos
  [inventario]=saas-mini_saasmini_data_inventario
  [cotizaciones]=saas-mini_saasmini_data_cotizaciones
)
[ "${#VOL[@]}" -eq 8 ] || fallar "el mapa de volúmenes está roto (${#VOL[@]} entradas en vez de 8)"
ESPERADOS=8

SELLO="$(date -u '+%Y%m%d-%H%M%S')"
DEST="$DESTINO_RAIZ/$SELLO"
mkdir -p "$DEST/sqlite" "$DEST/config"
chmod 700 "$DEST" "$DEST/sqlite" "$DEST/config"

log "destino: $DEST"
log "imagen : $IMAGEN"

# --------------------------------------------------------------- configuracion
for archivo in "$RAIZ/.env" "$RAIZ/ops/clients.json"; do
  if [ -f "$archivo" ]; then
    cp -p "$archivo" "$DEST/config/$(basename "$archivo")"
    chmod 600 "$DEST/config/$(basename "$archivo")"
    log "config  : $(basename "$archivo")"
  else
    log "AVISO   : no existe $archivo (no se respalda)"
  fi
done

# ------------------------------------------------------------------- databases
fallos=0
copias=0
{
  echo "saas-mini backup $SELLO"
  echo "commit  : $(git -C "$RAIZ" rev-parse --short HEAD 2>/dev/null || echo desconocido)"
  echo "host    : $(hostname)"
  echo "generado: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo
} > "$DEST/manifest.txt"

for p in "${!VOL[@]}"; do
  v="${VOL[$p]}"
  if ! docker volume inspect "$v" >/dev/null 2>&1; then
    # Volumen ausente = datos que crees respaldados y no lo estan. Cuenta como
    # fallo: un backup que se traga un producto sin avisar es peor que no tener.
    log "FALLO   : $p sin volumen $v"
    echo "$p SIN_VOLUMEN" >> "$DEST/manifest.txt"
    fallos=$((fallos + 1))
    continue
  fi

  # El origen va con permiso de escritura a proposito, aunque el script abra la
  # base en readonly. Las BDs estan en WAL, y SQLite necesita poder crear el
  # -shm aunque solo lea: si el contenedor esta detenido y no hay -shm, un
  # montaje :ro hace que el backup falle a las 3 de la manana.
  # El destino si es :ro desde el punto de vista de la app, y el script escribe
  # el snapshot directamente en el host.
  if salida=$(docker run --rm \
      -v "$v:/origen" \
      -v "$DEST/sqlite:/fuera" \
      -v "$RAIZ/ops/sqlite-snapshot.mjs:/app/snap.mjs:ro" \
      "$IMAGEN" node /app/snap.mjs "/origen/app.db" "/fuera/$p.db" 2>&1); then
    copias=$((copias + 1))
    log "OK      : $p  $(printf '%s' "$salida" | sed -n 's/.*"bytes":\([0-9]*\).*/\1 bytes/p')"
    echo "$p $salida" >> "$DEST/manifest.txt"
  else
    log "FALLO   : $p -> $salida"
    echo "$p SIN_INTEGRIDAD" >> "$DEST/manifest.txt"
    fallos=$((fallos + 1))
  fi
done

if [ "$copias" -eq 0 ]; then
  log "FALLO   : no se respaldo ninguna base. Esto NO es un backup."
  touch "$DEST/FAILED"
  exit 1
fi

# ------------------------------------------------- integridad de los archivos
( cd "$DEST" && find sqlite config -type f -exec sha256sum {} + > SHA256SUMS )
log "sha256  : $(wc -l < "$DEST/SHA256SUMS") archivos"

# ------------------------------------------------------------------ retencion
# Purga por FECHA DE MODIFICACION, no por nombre. Ordenar por nombre es un
# bug esperando: el directorio recien creado no queda primero entre los
# timestamps y el sort puede acabar borrando justo el backup que se acabo de
# hacer, dejando al operador sin nada. El directorio en curso queda excluido
# siempre, y solo se tocan directorios con forma de backup.
mapfile -t todos < <(
  find "$DESTINO_RAIZ" -mindepth 1 -maxdepth 1 -type d -name '20*' \
    -printf '%T@ %p\n' 2>/dev/null | sort -rn | cut -d' ' -f2-
)

mapfile -t healthy < <(
  for d in ${todos[@]+"${todos[@]}"}; do
    if [ ! -e "$d/FAILED" ]; then printf '%s\n' "$d"; fi
  done
)
if [ "${#healthy[@]}" -gt "$RETENCION" ]; then
  for d in "${healthy[@]:RETENCION}"; do
    [ "$d" = "$DEST" ] && continue
    log "purgando: $d"
    rm -rf "$d"
  done
fi

# Los fallidos se conservan porque son el diagnostico de que se rompio algo,
# pero solo los 3 mas recientes: si el disco se llena, primero se van estos.
mapfile -t malos < <(
  for d in ${todos[@]+"${todos[@]}"}; do
    if [ -e "$d/FAILED" ]; then printf '%s\n' "$d"; fi
  done
)
if [ "${#malos[@]}" -gt 3 ]; then
  for d in "${malos[@]:3}"; do
    [ "$d" = "$DEST" ] && continue
    log "purgando backup fallido: $d"
    rm -rf "$d"
  done
fi

if [ "$fallos" -gt 0 ]; then
  touch "$DEST/FAILED"
  log "RESULTADO: $fallos de $ESPERADOS bases con problema. Backup MARCADO como fallido."
  exit 1
fi

ln -sfn "$DEST" "$DESTINO_RAIZ/latest"
log "RESULTADO: OK. $copias/$ESPERADOS bases. $SELLO"
