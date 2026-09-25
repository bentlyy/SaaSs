#!/usr/bin/env bash
# Restaura una SQLite desde un backup.
#
#   ops/restore.sh <backup-dir> <producto> [--force]
#   ops/restore.sh latest crm
#
# Por seguridad NO toca nada si el contenedor esta corriendo sin --force:
# restaurar encima de una app viva deja escrituras huerfanas en la BD nueva.
# Con --force para el contenedor, restaura, lo levanta y verifica que la app
# responda. Si algo sale mal, deja el .db previo en <producto>.db.pre-restore.
set -euo pipefail

RAIZ="${SAASMINI_RAIZ:-$HOME/projects/saas-mini}"
IMAGEN="${SAASMINI_IMAGEN:-$(docker inspect -f '{{.Config.Image}}' saasmini-crm 2>/dev/null || true)}"
IMAGEN="${IMAGEN:-saas-mini:latest}"
FUERCE=0

log() { printf '  %s\n' "$*"; }
die()  { printf 'error: %s\n' "$*" >&2; exit 1; }

[ $# -ge 2 ] || { echo "uso: $0 <backup-dir> <producto> [--force]" >&2; exit 2; }
case "${3:-}" in --force) FUERCE=1 ;; "") ;; *) echo "argumento desconocido: $3" >&2; exit 2 ;; esac

BACKUP="$1"; PRODUCTO="$2"
[ -n "$BACKUP" ] || { echo "falta el backup" >&2; exit 2; }
# "latest" es un symlink al ultimo backup good. Se resuelve antes de validar
# para que el error diga cual es y no un "no existe" generico.
[ "$BACKUP" = "latest" ] && BACKUP="$HOME/backups/saasmini/latest"
[ -d "$BACKUP" ] || { echo "no existe el backup: $BACKUP" >&2; exit 1; }
BACKUP="$(cd "$BACKUP" && pwd)"
log "origen: $BACKUP"

# Un backup con FAILED significa que alguna base no paso integrity_check. Se
# puede restaurar a mano si se sabe lo que se hace, pero no por accident.
if [ -f "$BACKUP/FAILED" ] && [ "$FUERCE" -ne 1 ]; then
  echo "Este backup esta MARCADO como fallido (integridad). Si de verdad quieres" >&2
  echo "restaurar algo asi, repite con --force." >&2
  exit 1
fi

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
[ "${#VOL[@]}" -eq 8 ] || { echo "el mapa de volúmenes está roto (${#VOL[@]} entradas en vez de 8)" >&2; exit 1; }
v="${VOL[$PRODUCTO]:-}"
[ -n "$v" ] || { echo "producto desconocido: $PRODUCTO" >&2; exit 2; }

SNAP="$BACKUP/sqlite/$PRODUCTO.db"
[ -f "$SNAP" ] || { echo "el backup no tiene sqlite/$PRODUCTO.db" >&2; exit 1; }

# 1. el backup mismo esta intacto
if [ -f "$BACKUP/SHA256SUMS" ]; then
  ( cd "$BACKUP" && sha256sum -c --quiet SHA256SUMS ) \
    && log "SHA256SUMS del backup: OK" \
    || { echo "el backup esta corrupto, no restauro" >&2; exit 1; }
fi

# 2. la copia pasa integrity_check
# Se inspecciona una copia temporal escribible, no el backup en su sitio: las
# BDs estan en WAL y SQLite necesita crear el -shm aunque solo lea, asi que
# abrir el backup en :ro falla con SQLITE_READONLY_DIRECTORY. Asi el backup queda
# intacto y sin archivos -shm/-wal sueltos.
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cp "$SNAP" "$TMP/inspeccion.db"
docker run --rm -v "$TMP:/d" "$IMAGEN" node -e '
  const D = require("better-sqlite3");
  const db = new D("/d/inspeccion.db", { readonly: true, fileMustExist: true });
  const ok = db.pragma("integrity_check", { simple: true });
  const tenants = db.prepare("select count(*) as n from tenants").get().n;
  db.close();
  if (ok !== "ok") { console.error("integridad: " + ok); process.exit(1); }
  console.log("  integridad de la copia: OK (" + tenants + " tenant/s)");'

# 3. la app no debe estar escribiendo
CARRILLO="saasmini-$PRODUCTO"
if [ "$(docker inspect -f '{{.State.Running}}' "$CARRILLO" 2>/dev/null || echo false)" = "true" ]; then
  [ "$FUERCE" -eq 1 ] || { echo "$CARRILLO esta corriendo. Usa --force si de verdad quieres restaurar encima." >&2; exit 1; }
  log "deteniendo $CARRILLO"
  docker stop "$CARRILLO" >/dev/null
fi

# 4.Swap con red de seguridad
log "respaldando la BD actual como $PRODUCTO.db.pre-restore"
docker run --rm -v "$v:/d" "$IMAGEN" node -e '
  const fs = require("fs");
  fs.copyFileSync("/d/app.db", "/d/app.db.pre-restore");'
docker run --rm -v "$v:/d" -v "$SNAP:/nuevo.db:ro" "$IMAGEN" node -e '
  const fs = require("fs");
  fs.copyFileSync("/nuevo.db", "/d/app.db");
  fs.rmSync("/d/app.db-wal", { force: true });
  fs.rmSync("/d/app.db-shm", { force: true });'
log "restaurada $PRODUCTO desde $(basename "$BACKUP")"

# 5. arriba y que responda
if [ "$FUERCE" -eq 1 ]; then
  log "levantando $CARRILLO"
  docker start "$CARRILLO" >/dev/null
  PUERTO=$(docker port "$CARRILLO" | head -1 | sed 's/.*://')
  for i in $(seq 1 20); do
    if [ -n "${PUERTO:-}" ] && curl -fsS "http://127.0.0.1:$PUERTO/health" >/dev/null 2>&1; then
      log "health: OK tras ${i}s"
      break
    fi
    sleep 1
  done
  curl -fsS "http://127.0.0.1:$PUERTO/health" >/dev/null 2>&1 \
    || { echo "la app no respondio /health tras restaurar. Revisa: docker logs $CARRILLO" >&2; exit 1; }
fi

log "OK"
