# Runbook — baseline Prisma F8

## Alcance y límite de seguridad

Historia activa: `prisma/migrations/00000000000000_f8_schema_baseline`.
La historia anterior está preservada sólo para auditoría en `prisma/migration-history/` con SHA-256 por SQL; Prisma no debe leerla.

El baseline se obtuvo desde el catálogo de `salon_ai_f7_snapshot` después de aplicar F8, sin datos: `prisma migrate diff --from-empty --to-config-datasource --script` más `pg_get_functiondef`/`pg_get_triggerdef`. El segundo paso es obligatorio: Prisma no representa funciones, triggers ni constraint triggers diferidos. No hay ownership, GRANTs, datos ni `_prisma_migrations` dentro del SQL.

El baseline **repara deliberadamente** cinco índices parciales únicos F4 que el snapshot perdió por drift: `BotSession_active_deployment_conversation_key`, `BotPrompt_open_functional_per_session_key`, `BotActionInbox_promptId_providerMessageId_key`, `BotOutbox_providerMessageId_key` y `BotDispatchClaim_active_resource_key`. Que el snapshot tenga cero índices parciales no es saludable ni criterio de aceptación.

**No activar runtime, ingress, sender ni scheduler como parte de este procedimiento.**

## Base nueva y vacía

Con una URL explícita del target autorizado:

```powershell
$env:DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/DATABASE'
npx prisma migrate deploy
npx prisma migrate status
npx prisma migrate diff --from-schema prisma/schema.prisma --to-config-datasource --exit-code
```

El baseline se ejecuta una única vez y Prisma registra `00000000000000_f8_schema_baseline` en `_prisma_migrations`.

## Schema existente sin ledger (P3005)

Precondiciones obligatorias: backup/restauración ensayados, ventana de cambio, URL explícita y preflight de catálogo/schema. El schema debe ser estructuralmente idéntico al baseline después de la reconciliación; no alcanza con que la aplicación parezca funcionar.

**No ejecutar `migration.sql` sobre ese schema no vacío.** Crearía objetos duplicados o fallaría. Si el preflight muestra exactamente los cinco índices parciales ausentes, ejecutar el SQL aprobado que toma locks, comprueba duplicados y falla cerrado; nunca borra, fusiona ni modifica datos:

```powershell
$env:DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/EXISTING_DATABASE'
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f prisma/f8-baseline-reconcile-partial-indexes.sql
```

El orden obligatorio es: **backup/restore drill -> preflight de catálogo/schema -> preflight de duplicados + SQL de reconciliación aprobado -> verificar paridad de catálogo -> `migrate resolve --applied baseline` -> `migrate deploy`/`status`**. Si falta cualquier otro objeto, si alguno de los cinco índices ya existe con una definición distinta o si hay duplicados, detenerse y escalar: no hay reparación automática.

Sólo después de esa paridad, registrar el hecho de que ya contiene el baseline:

```powershell
$env:DATABASE_URL='postgresql://USER:PASSWORD@HOST:PORT/EXISTING_DATABASE'
npx prisma migrate resolve --applied 00000000000000_f8_schema_baseline
npx prisma migrate deploy
npx prisma migrate status
```

En el checkpoint F8, `migrate deploy` debía resultar sin migraciones pendientes. Una vez resuelto ese baseline sobre un schema existente, las migraciones aditivas posteriores (por ejemplo F9) deben aplicar normalmente; esa evidencia F8 de cero pendientes no afirma que el árbol futuro carezca de migraciones. No marcar migraciones históricas aplicadas a ciegas.

## Ambiente con ledger histórico

Este squash **no es** un upgrade automático para una base que ya tiene filas de la historia anterior. Prisma valida los directorios y checksums de su ledger; borrar/mover esa historia y apuntar ese ambiente al baseline puede dejarlo en estado inconsistente.

Antes de cualquier rollout se requiere un plan específico, aprobado y probado sobre una copia restaurada: inventario de ledger/checksums, comparación de catálogo, estrategia de transición compatible con la versión de Prisma y prueba de rollback. Hasta entonces, ese ambiente no debe ejecutar `migrate deploy` con este árbol.

## Verificación local reproducible

Los contratos mutantes F7/F8 requieren `F8_PG_CONTRACT_DATABASE_URL` explícita y sólo aceptan `postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f8_baseline_*`, sin query ni fragment. Nunca aceptan snapshot, `salon_ai_test` ni un `DATABASE_URL` arbitrario. El script de catálogo es la única excepción: puede leer (sólo `SELECT`) el snapshot para comparar; ningún helper mutante reutiliza esa excepción.

```powershell
$env:F8_BASELINE_LEFT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f8_baseline_empty_final'
$env:F8_BASELINE_RIGHT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f7_snapshot'
npm run test:prisma-f8-baseline-catalog

$env:F8_PG_CONTRACT_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:54322/salon_ai_f8_baseline_empty_final'
npm run test:f8-pg-contract-database-safety
npm run test:bot-options-f7-booking-pg
npm run test:bot-options-f8-booking-pg
npm run test:bot-options-f8-proofs-pg
npm run test:bot-options-f8-expiry-pg
npm run test:bot-options-f8-proof-writer-pg
npm run test:bot-options-f8-review-pg
npm run test:bot-options-f8-proof-purge-pg
npm run test:bot-options-f8-9-pg
```

La aceptación exige: deploy vacío, reconcile/resolve/deploy sobre `salon_ai_f8_baseline_existing_final`, `prisma validate`, `migrate diff` sin diferencias representables por Prisma y contrato explícito de catálogo. El baseline tiene 14 funciones, 15 triggers, 7 constraints diferidos, **297 índices** y 113 FKs; el snapshot no reconciliado conserva 292 índices y el único delta permitido son esos cinco parciales. Los contratos PG aislados pueden configurar transacciones de cliente de hasta 60 s; sólo el E2E F8.9 inyecta 5 s para el presupuesto agregado de admisión. Eso no cambia el default productivo de 175 ms ni los `lock_timeout`/`statement_timeout` de 50/120 ms. El snapshot y `salon_ai_test` no se mutan.
