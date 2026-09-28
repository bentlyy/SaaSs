#!/usr/bin/env bash
# Respaldo de los volumenes LEGACY, antes y durante la consolidacion.
#
#   bash ops/backup-legacy.sh [destino]
#
# POR QUE ESTE SCRIPT EXISTE, Y POR QUE NO ES `ops/backup.sh`
# ------------------------------------------------------
# `ops/backup.sh` respalda los NUEVE productos + el Core, y solo existen desde que
# se armo el stack nuevo. Los volumenes legacy (peluqueria, deportes, talleres,
# documentos, crm, recordatorios, inventario) NO estan en ese mapa: despues del
# deploy no los usa ningun servicio, asi que el backup diario deja de verlos.
#
# Y esos volumenes son la UNICA copia de los datos originales. El destino de las
# migraciones es una COPIA derivada: si el migrador tiene un bug, la forma de
# volver atras no es "correrlo al reves", es restaurar el legacy. Borrar un
# volumen legacy con `docker volume rm` tira el original y se lleva el unico
# punto de retorno.
#
# Por eso este respaldo NO rota. No hay `--retention`, no borra nada, y escribe
# en un directorio con sello de tiempo. Cuando alguien decida que ya no lo
# necesita, se borra a mano, con el deploy viejo verificado.
#
# Ubicacion por defecto: $HOME/backups/saasmini-legacy
#
# NO es un backup de verdad hasta que se saque del MISMO servidor. Un respaldo en
# el mismo disco que los datos no sobrevive a un fallo de ese disco, y este
# servidor no tiene RAID. Copiarlo a otro sitio es un paso manual y es el paso
# que mas se olvida.
set -euo pipefail

RAIZ="${SAASMINI_RAIZ:-$HOME/projects/saas-mini}"
IMAGEN="${SAASMINI_IMAGEN:-saas-mini:latest}"
DESTINO_RAIZ="${1:-${SAASMINI_BACKUPS_LEGACY:-$HOME/backups/saasmini-legacy}}"

log()  { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }
fallar() { printf '%s  FALLO: %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$1" >&2; exit 1; }

[ -f "$RAIZ/ops/sqlite-snapshot.mjs" ] || fallar "falta $RAIZ/ops/sqlite-snapshot.mjs"

# El nombre real lleva el prefijo del proyecto (`saas-mini_`). Se calcula en vez de
#-suponerlo: un proyecto con otro nombre, o un volumen creado a mano, no se
# encontraria y el script "no respaldaria nada" sin avisar.
PROYECTO="${SAASMINI_PROYECTO:-saas-mini}"

# Volumenes legacy -> lo que tienen dentro. Todos tienen `app.db` en la raiz.
LEGACY=(peluqueria deportes talleres documentos crm recordatorios inventario)

[ -f "$RAIZ/.env" ] || log "aviso: no hay .env, se continua (este respaldo no lo necesita)"

docker image inspect "$IMAGEN" >/dev/null 2>&1 \
  || fallar "no existe la imagen $IMAGEN. Levanta el stack antes de respaldar."

SELLO="$(date -u '+%Y%m%d-%H%M%S')"
DEST="$DESTINO_RAIZ/$SELLO"
mkdir -p "$DEST/sqlite"
chmod 700 "$DEST" "$DEST/sqlite"

log "volumenes legacy: ${#LEGACY[@]}"
log "imagen:           $IMAGEN"
log "destino:          $DEST"

copias=0
faltantes=()
manifiesto="$DEST/MANIFIESTO.txt"

{
  echo "Respaldo de los volumenes legacy de saas-mini"
  echo "sello:   $SELLO"
  echo "proyecto: $PROYECTO"
  echo "imagen:  $IMAGEN"
  echo "host:    $(hostname)"
  echo ""
  echo "ATENCION: este archivo esta en el MISMO servidor que los datos. No lo"
  echo "confundas con un respaldo: copialo a otro sitio antes de confiar en el."
  echo ""
} > "$manifiesto"

for p in "${LEGACY[@]}"; do
  v="$PROYECTO"_saasmini_data_"$p"

  if ! docker volume inspect "$v" >/dev/null 2>&1; then
    log "AUSENTE : $p  (el volumen $v no existe)"
    faltantes+=("$p")
    echo "AUSENTE: $p  volumen=$v" >> "$manifiesto"
    continue
  fi

  # El volumen se abre en SOLO LECTURA. `db.backup()` necesita poder escribir en
  # el destino, no en el origen, y si el origen estuviera en rw un descuido
  # escribiria en la fuente.
  if salida=$(docker run --rm \
      -v "$v":/origen:ro \
      -v "$DEST/sqlite":/fuera \
      -v "$RAIZ/ops/sqlite-snapshot.mjs:/app/snap.mjs:ro" \
      "$IMAGEN" node /app/snap.mjs "/origen/app.db" "/fuera/$p.db" 2>&1); then
    bytes=$(printf '%s' "$salida" | sed -n 's/.*"bytes":\([0-9]*\).*/\1/p')
    log "OK      : $p  ${bytes:-?} bytes  (volumen $v)"
    echo "OK: $p  volumen=$v  $salida" >> "$manifiesto"
    copias=$((copias + 1))
  else
    # No se avisa y se sigue: un volumen que falla no puede tapar el respaldo de
    # los otros seis, y el manifiesto deja claro cual fallo.
    log "FALLO   : $p  (volumen $v) -> $salida"
    echo "FALLO: $p  volumen=$v" >> "$manifiesto"
    echo "$salida" >> "$manifiesto"
  fi
done

echo "" >> "$manifiesto"
echo "respaldo de $copias volumen(es) en $DEST/sqlite" >> "$manifiesto"
if [ ${#faltantes[@]} -gt 0 ]; then
  echo "volumenes ausentes (no es un fallo: nunca se crearon): ${faltantes[*]}" >> "$manifiesto"
fi

chmod 600 "$DEST"/sqlite/*.db 2>/dev/null || true
chmod 600 "$manifiesto"

echo
if [ "$copias" -eq 0 ]; then
  log "NO se respaldo ningun volumen. Esto NO es un respaldo."
  exit 1
fi

if [ ${#faltantes[@]} -gt 0 ]; then
  log "Se respaldaron $copias volumen(es). FALTARON: ${faltantes[*]}"
  log "Si esos volumenes deberian existir, el deploy NO debe seguir: se perderian datos."
  exit 1
fi

log "Listo: $copias volumen(es) en $DEST"
log "Cada .db paso integrity_check dentro del contenedor."
log "COPIA ESTO FUERA DE ESTE SERVIDOR antes de tocar los volumenes legacy."
