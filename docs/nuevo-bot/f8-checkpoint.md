# Checkpoint F8 — baseline Prisma formal (2026-08-27)

## Estado

- El runtime, ingress de proofs, sender y schedulers productivos permanecen **OFF**.
- F8.2–F8.9 está verificado contra el schema aislado. La historia activa de Prisma ahora es un único baseline formal: `00000000000000_f8_schema_baseline`.
- La cadena histórica fue archivada fuera de `prisma/migrations` porque no bootstrappea desde vacío (`20260621202644_add_reminder_automation_list` falla con P3018/42P01). No usar el archivo como input de Prisma.
- La fuente del baseline es el catálogo real de `salon_ai_f7_snapshot` tras F8: diff de schema sin datos + funciones/triggers extraídos de `pg_catalog`. El baseline corrige cinco invariantes parciales únicas de F4 que el snapshot perdió por drift; contiene 14 funciones, 15 triggers, 7 constraint triggers diferidos, **297 índices** y 113 FKs. El snapshot no fue modificado.

## Evidencia F8

- Empty deploy: `prisma migrate deploy` aplicó el baseline en `salon_ai_f8_baseline_empty_final`; `migrate diff --from-schema` no detectó diferencias y `migrate status` quedó limpio.
- Existing-schema: `salon_ai_f8_baseline_existing_final` se construyó por `pg_dump --schema-only --no-owner --no-privileges --exclude-table=public._prisma_migrations` desde el snapshot, sin datos. Tras la reconciliación aprobada, tuvo paridad total con el empty scratch; `migrate resolve --applied 00000000000000_f8_schema_baseline`, deploy no-op y status limpio. El SQL baseline no se ejecutó sobre ese schema no vacío.
- El snapshot no reconciliado tiene 292 índices y cero parciales: ése es drift conocido, no una condición sana. Contra él, funciones/triggers/constraints diferidos/FKs y los 292 índices comunes deben coincidir; el único delta permitido son los cinco parciales restaurados. Un scratch existente reconciliado debe tener paridad total con el deploy vacío (297 índices).
- Pasaron sobre `salon_ai_f8_baseline_empty_final` los contratos PG F7 booking y F8 booking/proofs/expiry/proof writer/review/purge byte-only/vertical F8.9; los contratos puros F8 de terms/expiry/validación de imagen/proof writer/review/purge/F8.9 también pasaron.
- Los contratos PG aislados usan transacciones de cliente de hasta 60 s únicamente para scheduling de pruebas. El E2E F8.9 inyecta sólo ahí un presupuesto agregado de admisión de 5 s; producción conserva 175 ms. `lock_timeout` (50 ms), `statement_timeout` (120 ms) y fencing no cambiaron.

## Operación obligatoria

Seguir `docs/nuevo-bot/prisma-f8-baseline-runbook.md`. En un schema existente sin ledger, **nunca ejecutar el SQL baseline**: backup/restore drill, preflight, reconciliación aprobada de los cinco índices con chequeo de duplicados, paridad total y recién entonces `migrate resolve --applied`. Un ambiente con ledger histórico requiere el rollout explícito del runbook; no es seguro apuntarlo automáticamente a esta historia squashed.

## Bloqueadores de producción restantes

El baseline cierra F8 de migraciones, no habilita operación: legal hold/exclusión, cuarentena/AV de PDF, auditoría de descargas, backup/restore drill y aprobación explícita de ingress/sender/schedulers siguen siendo necesarios.
