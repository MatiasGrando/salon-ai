# Registro sanitizado de implementación y deployment F11 — 2026-08-29

## Resultado ejecutivo

F11 fue desplegado en producción en modo **dark**, con todas sus capacidades apagadas. El CRM permaneció disponible y el endpoint de routing rechazó acceso no autenticado. No se activó ningún comercio ni se cambió ningún pointer de routing.

## Cambios funcionales implementados

- Preflight durable de activación: pausa claims, incrementa fencing, drena trabajo y clasifica estados bloqueantes, descartables y `UNKNOWN`.
- Cambio y rollback atómicos de pointer/generation, invalidación de runtime descartable y auditoría de la transición.
- Selector exclusivo integrado al CRM; no usa `alert`, `confirm` ni `prompt` nativos.
- API de routing autenticada con autorización por comercio; staff no puede operar el corte.
- Protección de inbound legacy durante una pausa: receipt/claim idempotente antes del ACK y reintento seguro para estados no concluyentes.
- Contrato de carga para verificar admisión, backlog, drain, fencing y generación antigua.
- Guard de base de pruebas F11: sólo loopback, base `salon_ai_f11_*`, puerto explícito, contraseña scratch y roles locales `postgres`/`supabase_admin`.
- Excepción temporal de latencia opt-in mediante `F11_ALLOW_LATENCY_WAIVER=true`; el objetivo de 200 ms permanece y el test falla por defecto si no se autoriza la excepción.
- Exclusión de logs, mediciones y scripts locales del snapshot Railway mediante `.railwayignore`.

## Archivos principales

- `src/bot-options/application/activation-operations.ts` — orquestación de preflight, activación y rollback.
- `src/bot-options/infrastructure/prisma-activation.ts` — fencing, snapshots, drain, auditoría y commit atómico.
- `src/bot-options/infrastructure/prisma-admission.ts` — validación de pointer/generation en admisión autoritativa.
- `src/routes/business-bot-routing.ts` — API autenticada del selector.
- `src/services/business-bot-routing-service.ts` — servicio de estado/preflight/commit/abort.
- `src/routes/crm-ui.ts` — selector, evidencia y confirmación visual integrada.
- `src/plugins/auth-guard.ts` y `src/services/staff-permission-service.ts` — fronteras de autorización.
- `src/server.ts` — registro de la ruta F11.
- `scripts/bot-options-f11-1-preflight-pg-contract-test.ts` — contrato PostgreSQL de preflight.
- `scripts/bot-options-f11-2-cutover-pg-contract-test.ts` — corte/rollback/concurrencia.
- `scripts/bot-options-f11-4-crm-contract-test.ts` — API, permisos e interfaz CRM.
- `scripts/bot-options-cutover-load-test.ts` — carga y corte con waiver explícito.
- `scripts/f11-pg-contract-database.ts` y su test — aislamiento del scratch local.
- `docs/nuevo-bot/runbook-piloto.md` — operación, rollback, métricas y piloto.

## Gate local de recuperación

- Backup: 14.040.876 bytes.
- SHA-256: `cb35a686e2aa42639f19b2e7f7c910c9cb431ebdd8385ddf90c02fbeb606b8f0`.
- PostgreSQL server/client: 17.6.
- Restauración: exit 0; duración 54.758 ms en el scratch final.
- Forward local: 15 migraciones F8→F11 aplicadas.
- Ledger final local: 145 completas; 0 activas sin terminar; 2 rolled-back históricas.
- `pg_amcheck`: exit 0 después de habilitar la extensión únicamente en el scratch.
- F11.1, F11.2/F11.3 e inbound legacy PostgreSQL: PASS.
- F11.6 final: burst x4 p95 199,82 ms; cero doble motor; cero ejecuciones stale; generación final 2.
- Delivery callback: muestra local incompleta; `accepted` no se trató como `delivered`.
- Contenedor y volumen finales: destruidos; ausencia verificada.

## Incidentes diagnósticos retenidos

1. Una base vacía no pudo ejecutar las 145 migraciones históricas porque `20260621202644_add_reminder_automation_list` referencia `ReminderAutomation` antes de su creación/renombre. Esto queda como deuda histórica; no se alteró esa migración.
2. Un primer scratch restaurado intentó migrar con el rol local `postgres` y recibió `permission denied for schema public`. Se destruyó sin reintento. El siguiente scratch nuevo utilizó `supabase_admin`, propietario compatible con el dump, y aprobó.
3. La CLI Prisma instalada no acepta `db push --skip-generate`; la base creada para esa clasificación fue destruida sin repetir el comando.

## Producción

- Estado previo: F7 aplicado; baseline F8 histórico sin finalizar; 15 forward F8→F11 pendientes.
- Acción: baseline F8 conocida marcada rolled-back; 15 forward aplicadas exitosamente.
- Estado posterior: Prisma informó `Database schema is up to date` para 145 migraciones.
- Flags: 9/9 explícitamente `false`.
- Deployment Railway: `86d5d8be-39c3-456f-9873-845928eadbc8`, estado `SUCCESS`.
- Imagen: `sha256:96f79e042bdf44bad2d4e4f11f35fe38417359af313e26eb75bbba2a77a7085d`.
- Smoke test: CRM HTTP 200; routing sin sesión HTTP 401; cero marcadores fatales en el arranque inspeccionado.

## Pendiente antes del piloto

- Autorizar exactamente un comercio y una configuración exclusiva.
- Verificar WhatsApp conectado, rollback disponible y segunda persona revisora.
- Activar capacidades de a una siguiendo `runbook-piloto.md`.
- No ampliar a un segundo comercio hasta corregir o revalidar la latencia sostenida.
