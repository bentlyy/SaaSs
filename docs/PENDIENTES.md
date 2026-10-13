# Pendientes y bloqueados — Suite AMG (Core · SaaS Mini · Taller · Vitaria)

Actualizado: 2026-10-13

## Bloqueado (requiere acción del usuario)

Nada bloqueado por ahora.

## Pendiente (accionable, sin decisión pendiente)

- **C —** Actualizar `README.md` de `bentlyy/TallerMecanico` (documentar la integración SSO/AMG).
- **E2 —** Escombros menores: sueltos de la raíz de `08_SaaS_Mini` (`harness.log`,
  `harness.err.log`, `.inspect-sso.cjs`, `opencode.json`). Están gitignored (no trackeados);
  `opencode.json` podría estar en uso → se conserva.
- **Vitaria —** `/vite.svg` responde 400 (cosmético).

## Plan — Vitaria (bentlyy/Clinica-Salud-Vital) SSO + billing propio

**Estado: cerrado (2026-10-13).** SSO en producción, verificado con login real (CDP).

Alcance confirmado: **SSO con el Core + billing propio** (mismo token MP; la BD se queda como está).

**Prerrequisitos en el Core (ops):**
- Registrar el producto `vitaria` en el catálogo (`products`: slug, name, `app_url`).
- Derivar el secreto del cliente SSO:
  `npm run sso:secret -w @amg/platform -- vitaria` (crea/repair del `ssoClient`).

**Lado Vitaria:**
- Dep: `@amg/auth-client`.
- Env: `CORE_URL`, `APP_URL`, `AMG_SSO_CLIENT_ID=vitaria`, `AMG_SSO_CLIENT_SECRET`.
- Migración: `tenants.sso_org_id`, `users.sso_sub` (+ índices), `users.sso_provider`.
- `src/sso/amgSso.ts` (`loadConfig(env,'vitaria')` + `mountAmgAuth`) y resolución
  identidad Core → tenant (`sso_org_id`) y usuario (`sso_sub`); rol `owner/admin`→`admin`,
  `member`→`user`.
- `app.ts`: montar tras `cookieParser`/`express.json`.
- Billing: se mantiene tal cual.

**Riesgos:** auth propio grande (JWT+cookies, 2FA/TOTP, `user_sessions`/`refresh_tokens`,
RLS por `app.tenant_id`) y suite de tests que asume login local.

**Decisiones (usuario):** reemplazo total (como el Taller) · `APP_URL=https://clinica-salud-vital.onrender.com` (se queda en Render).

**Hallazgos que condicionan el diseño (recon):**
- **RLS en `tenants` es `USING(true)` + `WITH CHECK(false)`** → la app NO puede crear tenants en runtime; el vínculo `sso_org_id` se hace fuera de banda (ops/rol BYPASSRLS `DATABASE_URL_SUPERADMIN`). La cuenta local NO auto-crea tenant: si la org no está vinculada, el login se rechaza (`TenantNoVinculadoError`).
- `users` RLS: la fila solo es visible/escribible con `app.tenant_id = tenant_id` → la resolución del usuario debe correr dentro de `tenantContext.run(tenantId)`.
- `users.password` es `NOT NULL` → alta SSO usa placeholder (`randomUUID`); rol por defecto `owner/admin→admin`, `member→user`.
- **4 servicios usan `jwt.service`** además del login: `booking.service`, `doctor.service`, `guest.service`, `lab-result-email.service` (tokens de flujos/emails) → hay que conservar un camino de token o reworks; NO borrar `jwt.service` a ciegas.
- `optionalAuth` + `tenantMiddleware` hoy derivan de `req.user` (JWT). Con SSO el orden cambia: guard (req.amg) → resolver cuenta local/tenant → tenantMiddleware. `csrfProtection` también debe revisarse.
- Tests afectados por el reemplazo (~10): `auth.controller/service/middleware/schema`, `auth-refresh-2fa.service`, `jwt.service`, `sessions.service`, `sessionActivity.middleware`, `feature.middleware`, `auth.routes`, `tenant.middleware`.

**Progreso:**
- **Hecho (base, no destructiva)** en rama `feat/vitaria-sso` (commit `f1d3db8`, pusheada): dep `@amg/auth-client` (vendor tarball), env, migración `db/migrations/032_amg_sso.sql` (`tenants.sso_org_id`, `users.sso_sub` + índices únicos parciales), `src/sso/{amgTypes,amgSso,localAccount}.ts`. `npm run typecheck` OK; el paquete resuelve por CJS `require`. Aún **sin cablear** (no rompe prod).
- **Hecho (Etapa 1 — cableado)** commit `9970fbb`: `app.ts` monta `mountAmgAuthMiddleware()` + `app.use('/api', amgRouter)` (login→Core, `/api/auth/me`, `/api/auth/inicio`) tras cookieParser/json y antes de `csrfProtection`, con `express.static(..., { index: false })` y catch-all SPA movido tras las rutas; `auth.middleware.ts` reescrito: `optionalAuth` resuelve la cuenta local desde `req.amg` (tenant por `sso_org_id`, usuario por `sso_sub`) y `authMiddleware` consume `req.user`, con camino JWT legado conservado pero **inalcanzable en prod** (el guard rechaza antes). `tests/setup.js` con env SSO; `tests/unit/app.test.js` mockea `src/sso/amgSso.js`.
- **Hecho (Etapa 2 — retiro del auth local)** commit `db2c41e` (pusheado): eliminados los endpoints de credenciales (`login/refresh/logout/2FA/change/forgot/reset/admin/jwks/sessions/me`), `sessions.service.ts`, el `sessionLimiter` y los handlers muertos de `auth.controller`/`auth.service`; `auth.routes`/`auth.schema` quedan **solo con el alta por invitación** (`GET /invite-info` + `POST /register`), que crea la cuenta local que luego se vincula por `sso_sub`/email al entrar vía SSO. `amgPublicPaths` expone `/api/auth/{login,register,invite-info}`. `jwt.service` **conservado**. Tests del auth retirado borrados (4 archivos) y 2 recortados → suite **110 files / 1491 tests verde**; `typecheck` OK.
- **Cierre:** (5) resuelto/verificado (ver aclaraciones abajo); (6) hecho — PR `SaaSs#1`
  (`feat/vitaria-product`) mergeado, secreto derivado, `tenants.sso_org_id` vinculado fuera de banda
  y login real verificado en `https://vitaria.amgdeveloper.cl`; (7) no aplica (ver aclaraciones).

## Hecho (2026-10-12)

- **B6 —** `docs/qa/06-crm.md`, `07-activos.md`, `10-regresion-compartida.md`: referencias
  `packages/core/...` → repo externo `bentlyy/amg-core` (paquete `@amg/core`);
  `frontendMoney.test.ts` → `packages/platform/tests/`.
- **Suite** desplegada verde en `main` `54ad149`; `AMG_SSO_INTROSPECT=1` verificado en runtime.
- **Vitaria** `backup.yml` reescrito a SSH + `pg_dump` en el host OCI (commit `bafe7af`).

## Hecho (2026-10-13)

- **D1 —** `DEPLOY_SSH_KEY` cargado en `bentlyy/Clinica-Salud-Vital`; `backup.yml` en verde
  (run `38343426771`, 40s): dump 889K, restore `tables=50`, artifact subido.
- **B7 —** `DISPATCH_TOKEN` cargado en `bentlyy/amg-core` y `bentlyy/SaaSs`; ciclo
  tag core → dispatch → `Core release` verificado (idempotente). Hoy vale el token del CLI de `gh`
  (`gho_…`, scopes `repo workflow gist read:org`); se puede reemplazar por un PAT dedicado.
- **B5 —** `diagnose.yml` ya no existe; workflows de `SaaSs`: `CI`, `Core release`, `Deploy`.
- **Docs —** `docs/db-architecture.html` reescrito (Core `core.sqlite` + 9 bases por producto);
  `docs/SSO.md` documenta el bloqueo de Bot Fight Mode y el CORS del canje.
- **Landing —** PRs `SaaSs#2`–`#7` mergeados: navbar `Inicio · Sistemas · Soluciones · Quiénes somos`,
  `index.html` a resumen con `#explora`, nuevas `soluciones.html` y `nosotros.html`, `sistemas.html`
  con navbar coherente; `typecheck` limpio y 193 tests verdes en 11 archivos.

## Deuda diferida al cierre del SSO (2026-10-12)

Decisiones tomadas para **no bloquear** el cierre del SSO (retomar al final):

- **Gates de cobertura del CI de Vitaria (preexistente; NO lo causó el SSO).** El job `CI`
  lleva rojo desde ~22-sep-2026. En `master` (`bafe7af`): Lines 84.53 / Branches 75.42 /
  Funcs 83.21 / Stmts 83.41 vs umbral 85/80/85/85 (`vitest.config.js`). Backend además fallaba
  antes en `npm audit --audit-level=critical` (**ya corregido** con `npm audit fix` en
  `feat/vitaria-sso`); frontend incumple sus umbrales en `master` y en este PR. Decisión:
  **no tocar umbrales ni perseguir cobertura ahora**. Módulos con más hueco cuando se aborde:
  `shared/metrics.service.ts`, `modules/saas/*onboarding*.service.ts`, `shared/currencies.ts`,
  `shared/db.ts`, `shared/ownership.ts`, controllers `attachments`/`calendar`, `modules/booking`.
- **Ops de Vitaria (hecho):** (1) `SaaSs#1` (`feat/vitaria-product`) mergeado, cliente/producto
  `vitaria` registrado y secreto derivado; (2) custom domain `vitaria.amgdeveloper.cl` operativo en
  Render; (3) `032_amg_sso.sql` aplicado y `tenants.sso_org_id` vinculado fuera de banda.
- **Precio de `vitaria`:** fijado en `49990` CLP/mes (12-oct-2026) «por ahora»;
  revisar tarifa definitiva más adelante.
- **`docs/db-architecture.html`** reescrito (2026-10-13): Core `core.sqlite` + 9 bases por producto,
  ya no cita `packages/core/src/db/init.ts`.

**Aclaraciones a los "pendientes destructivos" previos:**
- (5) **resuelto/verificado:** `csrfProtection` es double-submit por cookie y no depende
  de `req.user`; el guard (`mountAmgAuthMiddleware`) y `amgRouter` se montan **antes** de
  `app.use(csrfProtection)` (`app.ts:193-194` vs `:196`) → login/callback SSO no pasa por
  CSRF y las mutaciones del SPA mantienen protección. Sin cambios.
- (7) **resuelto/no aplica:** `feature.middleware` sí se usa (`laboratory.routes.ts` →
  `requireFeature('laboratory')`); `sessionActivity.middleware` se conserva (mantiene
  `users.last_activity_at`); `cleanup.service` es cron diario inofensivo (se conserva).
- (6) **hecho:** PR `SaaSs#1` (`feat/vitaria-product`, commit `b1dbfa9`) mergeado; `vitaria`
  registrado en el catálogo y la vinculación `sso_org_id` aplicada (login real verificado).
- Purga SSO Vitaria commiteada hasta `a2ef115` (cubre `localAccount`, retira `base32.ts` y
  `encrypt/decrypt/hashToken` muertos, `docs/SSO.md` §7 con esta deuda).

