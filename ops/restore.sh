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
IMAGEN="${SAASMINI_IMAGEN:-$(docker inspect -f '{{.Config.Image}}' saasmini-landing 2>/dev/null || true)}"
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
  [espacios]=saas-mini_saasmini_data_espacios
  [citas]=saas-mini_saasmini_data_citas
  [inventario]=saas-mini_saasmini_data_inventario
  [solicitudes]=saas-mini_saasmini_data_solicitudes
  [cotizaciones]=saas-mini_saasmini_data_cotizaciones
  [clientes]=saas-mini_saasmini_data_clientes
  [activos]=saas-mini_saasmini_data_activos
  [checklists]=saas-mini_saasmini_data_checklists
  [pagos]=saas-mini_saasmini_data_pagos
  [core]=saas-mini_saasmini_data_core
)
[ "${#VOL[@]}" -eq 10 ] || { echo "el mapa de volúmenes está roto (${#VOL[@]} entradas en vez de 10)" >&2; exit 1; }
v="${VOL[$PRODUCTO]:-}"
[ -n "$v" ] || { echo "producto desconocido: $PRODUCTO" >&2; exit 2; }

# ruta de SU base dentro del volumen; tiene que coincidir con el compose
declare -A BD=(
  [espacios]=espacios.sqlite
  [citas]=citas.sqlite
  [inventario]=inventario.sqlite
  [solicitudes]=solicitudes.sqlite
  [cotizaciones]=cotizaciones.sqlite
  [clientes]=clientes.sqlite
  [activos]=activos.sqlite
  [checklists]=checklists.sqlite
  [pagos]=pagos.sqlite
  [core]=core/core.sqlite
)
b="${BD[$PRODUCTO]:-}"
[ -n "$b" ] || { echo "producto sin ruta de base conocida: $PRODUCTO" >&2; exit 2; }
BD_REL="$b"

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
docker run --rm -e ESPERA_CORE="$([ "$PRODUCTO" = core ] && echo 1 || echo 0)" -v "$TMP:/d" "$IMAGEN" node -e '
  const D = require("better-sqlite3");
  const esCore = process.env.ESPERA_CORE === "1";
  const db = new D("/d/inspeccion.db", { readonly: true, fileMustExist: true });
  const ok = db.pragma("integrity_check", { simple: true });
  if (ok !== "ok") { console.error("integridad: " + ok); process.exit(1); }

  const tablas = db.prepare("select name from sqlite_master where type = ?").all("table")
    .map(r => r.name).filter(t => !t.startsWith("sqlite_"));
  if (tablas.length === 0) { console.error("la copia no tiene ninguna tabla: no es una base de AMG"); process.exit(1); }

  // Un backup integro de una base que NO es la de este producto pasaria
  // integrity_check y dejaria el producto andando con los datos de otro. Por eso
  // el restore tambien mira la FORMA de la base, no solo que no este corrupta:
  //
  //   - el Core guarda organizaciones en `organizations`
  //   - un producto tiene que aislar por organization_id
  //   - ningun producto guarda contrasenas: si aparece, se esta restaurando una
  //     base legacy, que es exactamente lo que esta arquitectura prohibe
  const columnas = (t) => db.prepare(`pragma table_info("${t}")`).all().map(c => c.name);
  const conOrg = tablas.filter(t => columnas(t).includes("organization_id"));
  const conPassword = tablas.filter(t =>
    columnas(t).some(c => /password|contrasena|contraseña/i.test(c)));

  if (conPassword.length) {
    console.error("la copia tiene columnas de contrasena en: " + conPassword.join(", "));
    console.error("eso es una base legacy. No se restaura en un producto: la identidad es del Core.");
    process.exit(1);
  }
  if (esCore) {
    if (!tablas.includes("organizations")) {
      console.error("se pidio restaurar el core y la copia no tiene la tabla organizations");
      process.exit(1);
    }
  } else if (conOrg.length === 0) {
    console.error("la copia no tiene ninguna tabla con organization_id: no es una base de producto AMG");
    process.exit(1);
  }

  const detalle = esCore
    ? `${db.prepare("select count(*) as n from organizations").get().n} organizaciones`
    : `${conOrg.length}/${tablas.length} tablas aisladas por organization_id`;
  db.close();
  console.log(`  integridad de la copia: OK (${detalle})`);'

# 3. la app no debe estar escribiendo
#
# El nombre del contenedor NO siempre es "saasmini-<producto>". La plataforma
# (que es quien tiene abierto core.sqlite) corre dentro de `landing`. Si aqui se
# asumiera el patron, `restore core` buscaria `saasmini-core`, no lo encontraria,
# `docker inspect` devolveria false, y el script escribiria la base POR DEBAJO de
# la plataforma viva: en WAL eso deja -wal y -shm viejos, y el resultado es una
# core.sqlite a medias que no se explica. Un contenedor que no existe es un
# fallo, no un "no estaba corriendo".
declare -A CONTENEDOR=(
  [core]=saasmini-landing
)
CARRILLO="${CONTENEDOR[$PRODUCTO]:-saasmini-$PRODUCTO}"
if ! docker inspect "$CARRILLO" >/dev/null 2>&1; then
  echo "el contenedor $CARRILLO no existe. No se restaura nada: si el nombre del" >&2
  echo "servicio cambio, actualiza el mapa CONTENEDOR en ops/restore.sh." >&2
  exit 1
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$CARRILLO")" = "true" ]; then
  [ "$FUERCE" -eq 1 ] || { echo "$CARRILLO esta corriendo. Usa --force si de verdad quieres restaurar encima." >&2; exit 1; }
  log "deteniendo $CARRILLO"
  docker stop "$CARRILLO" >/dev/null
fi

# 4.Swap con red de seguridad
log "respaldando la BD actual como $PRODUCTO.db.pre-restore"
docker run --rm -e BD="$BD_REL" -v "$v:/d" "$IMAGEN" node -e '
  const fs = require("fs");
  fs.copyFileSync("/d/" + process.env.BD, "/d/" + process.env.BD + ".pre-restore");'
docker run --rm -e BD="$BD_REL" -v "$v:/d" -v "$SNAP:/nuevo.db:ro" "$IMAGEN" node -e '
  const fs = require("fs");
  const b = process.env.BD;
  fs.copyFileSync("/nuevo.db", "/d/" + b);
  fs.rmSync("/d/" + b + "-wal", { force: true });
  fs.rmSync("/d/" + b + "-shm", { force: true });'
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
