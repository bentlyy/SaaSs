# Backups de SaaS Mini

Los datos viven en 8 volumenes Docker, uno por producto. Si se pierde un volumen
o alguien mete mano, el backup es lo unico que queda.

## Que se respalda

| Que | Donde | Nota |
|---|---|---|
| 8 SQLite (`app.db`) | `~/backups/saasmini/<sello>/sqlite/` | snapshot consistente, app encendida |
| `.env` | `<sello>/config/.env` | contiene `JWT_SECRET`; sin el nadie puede iniciar sesion |
| `ops/clients.json` | `<sello>/config/clients.json` | la whitelist de la puerta; no esta en git a proposito |

Cada backup lleva `manifest.txt` (commit, host, `integrity_check` y conteos por
base) y `SHA256SUMS` para detectar corrupcion del propio archivo.

Los dos archivos de `config/` van con permiso 600: son secretos.

## Como corre

Un timer de systemd, diario a las 03:17 UTC con desfase aleatorio de hasta
5 minutos. `Persistent=true` hace que corra en cuanto arranca el servidor si
esa hora paso con la maquina apagada.

```bash
systemctl list-timers saasmini-backup.timer    # cuando corre la proxima
systemctl status  saasmini-backup.service      # resultado del ultimo
journalctl -u saasmini-backup.service -n 50    # log
```

Correr a mano (mismo codigo que el timer):

```bash
~/projects/saas-mini/ops/backup.sh
```

## Retencion

14 backups healthy (variables: `SAASMINI_RETENCION`). Los fallidos se conservan
porque son el diagnostico, y se marcan con un archivo `FAILED`.

## Como se sabe si un backup sirve

Un backup que nunca se restauro no es un backup. `ops/restore.sh` existe para
poder comprobarlo, y se debe usar periodicamente sobre un volumen de prueba:

```bash
ops/restore.sh latest crm
```

Un backup con `FAILED` significa que alguna base no paso `integrity_check`.
Hay que mirarlo antes de confiar en el.

## Por que se verifican dos veces

- `integrity_check` sobre la **copia**: dice si los datos estan enteros.
- `SHA256SUMS` sobre los **archivos**: dice si el backup se leyo bien al
  guardarse o al descargarse. Un checksum cobre el caso distinto: el disco o el
  transporte te entrego bytes cambiados sin que la base lo note.
