# Pendientes y bloqueados — Suite AMG (Core · SaaS Mini · Taller · Vitaria)

Actualizado: 2026-10-12

## Bloqueado (requiere acción del usuario)

- **D1 — Backup de Vitaria.** Falta el secret `DEPLOY_SSH_KEY` en `bentlyy/Clinica-Salud-Vital`
  (misma llave que usa el deploy de la suite; no está en disco).
  ```
  gh secret set DEPLOY_SSH_KEY --repo bentlyy/Clinica-Salud-Vital < "ruta\a\ssh-key-2026-08-18.key"
  ```
  En cuanto exista: disparar `backup.yml` y verificar dump + restore de prueba + artifact.
- **B7 — `DISPATCH_TOKEN`.** PAT scope `repo` en `bentlyy/amg-core` y `bentlyy/SaaSs` para cerrar el
  ciclo tag core → release suite.
- **D2/A3 — Alcance de Vitaria.** Confirmar si se implementa SSO + billing propio y si la BD
  migra de Render a OCI (o se queda). No tocar código hasta decidir.

## Pendiente (accionable, sin decisión pendiente)

- **B5 —** Borrar `08_SaaS_Mini/.github/workflows/diagnose.yml` (workflow temporal ya cumplido).
- **C —** Actualizar `README.md` de `bentlyy/TallerMecanico` (documentar la integración SSO/AMG).
- **E2 —** Archivar escombros: `09_Saas_miniv2`, `citas-standalone`; sueltos de la raíz de
  `08_SaaS_Mini` (`harness.log`, `harness.err.log`, `.inspect-sso.cjs`, `opencode.json`).
- **Docs —** `docs/db-architecture.html` sigue citando `packages/core/src/db/init.ts`. El diagrama
  describe la arquitectura vieja (DDL compartido de 17 tablas); hoy los productos usan
  `openProductDb` de `product-runtime` y DDL por producto. Requiere reescritura, no solo renombrar.

## Hecho (2026-10-12)

- **B6 —** `docs/qa/06-crm.md`, `07-activos.md`, `10-regresion-compartida.md`: referencias
  `packages/core/...` → repo externo `bentlyy/amg-core` (paquete `@amg/core`);
  `frontendMoney.test.ts` → `packages/platform/tests/`.
- **Suite** desplegada verde en `main` `54ad149`; `AMG_SSO_INTROSPECT=1` verificado en runtime.
- **Vitaria** `backup.yml` reescrito a SSH + `pg_dump` en el host OCI (commit `bafe7af`).
