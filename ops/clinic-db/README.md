# clinic-db

Configuracion de la base de datos que usa la app de Clinic en Render
(`https://clinica-salud-vital.onrender.com`).

El proyecto vive en `/home/opc/projects/clinic-db` y **no tiene git**, por eso
estas copias se guardan aqui.

## por que `pg_hba.conf` esta dentro del repositorio

La base quedo expuesta a internet porque Render la necesita, y el firewall del
host no sirve como filtro: Docker publica el puerto con DNAT y firewalld acepta
ese trafico antes de evaluar la zona, asi que las reglas por IP nunca se
aplicaban.

El filtro real esta en `pg_hba.conf`, que corre **dentro de Postgres** y no se
puede esquivar. Reglas:

- `local` y `127.0.0.1`: sin contrasena. Solo healthcheck y tunel SSH.
- `74.220.48.0/24`: bloque de salida que Render asigno al web service. Entra con
  `scram-sha-256`. Las IPs observadas en los logs son `.30` y `.71`
  (`oregon-egress.render.com`).
- Todo lo demas: `reject`.

## acceso desde tu computador

Tu IP domestica cambia (compartes internet con el celular), asi que no se puede
permitir por IP. Usa un tunel SSH, que ademas pide la llave:

```bash
ssh -i ssh-key-2026-08-18.key -L 5433:127.0.0.1:5432 opc@146.181.55.59
# y en el cliente: localhost:5433
```

## aviso de la app

La app en Render pide `GET /api/auth/refresh` y el backend responde
`404 Route not found`, por eso la pantalla se queda en "Cargando...".
No es un problema de la base: `/api/health` responde `database: ok`.
Se corrige en el codigo de la app.
