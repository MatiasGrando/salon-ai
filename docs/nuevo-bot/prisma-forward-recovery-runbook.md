# Contrato de recuperación forward Prisma — F8 a F10

## Propósito y límite

Esta rama preparada restaura exclusivamente la cadena forward desde el ledger productivo histórico que termina en `20260827010000_add_booking_visit_f7`. No se despliega ni se ejecuta contra producción desde este contrato.

La fila fallida `00000000000000_f8_schema_baseline` con cero pasos **no corresponde al árbol final** y **nunca se marca como aplicada**. Se la puede marcar `rolled back` únicamente en una scratch recién restaurada y después de completar todos los controles de este documento. No ejecutar `migrate resolve --applied` para ese nombre y no recrear el directorio baseline.

## Árbol forward esperado

Después de F7, Prisma debe encontrar solamente estas 13 migraciones de recuperación:

- F8: `20260827110000`, `20260827130000`, `20260827140000`, `20260827150000`, `20260827160000`, `20260827161000`, `20260827170000`.
- F9/F10: `20260827200000`, `20260827210000`, `20260827220000`, `20260827230000`, `20260827240000`, `20260827250000`.

## Procedimiento ejecutable: sólo scratch restaurada

### Barrera obligatoria de aislamiento scratch (puerta externa previa)

**Antes de ejecutar cualquier comando `psql` o Prisma, incluso uno de inspección, ABORTAR** salvo que otro operador haya revisado y aprobado evidencia de plataforma externa que demuestre simultáneamente:

- una base scratch **efímera**, recién restaurada y separada de producción;
- una credencial/rol dedicado, exclusivo de scratch, para este procedimiento;
- aislamiento de red/endpoint y ACL que impida que esa ruta de credencial alcance producción; y
- la identidad de la restauración y del destino scratch aprobadas por ese segundo operador.

La evidencia debe provenir de los controles de la plataforma (provisionamiento, IAM/roles, red/ACL y restauración), no de la shell ni de la propia base. Si falta, no está aprobada independientemente, o no cubre una re-restauración, no ejecutar comandos: descartar la preparación y escalar. Las aserciones de `DATABASE_URL`, host, base y manifest de abajo son **defensa en profundidad**; no prueban esta barrera ni pueden sustituir la evidencia externa.

No iniciar la aplicación ni writers como parte de este procedimiento. `DATABASE_URL` y toda variable que Prisma cargue deben referir **solamente** a la scratch restaurada. La scratch se descarta y se vuelve a restaurar ante cualquier desvío; no se la reutiliza como si fuera producción.

Antes de ejecutar un comando Prisma, un operador debe cargar explícitamente estos placeholders con la identidad de la scratch restaurada. Se dejan deliberadamente sin valores: este bloque debe abortar si se copia sin confirmar el destino y no constituye un comando para producción.

```sh
# Ejecutar en una shell POSIX. No reemplazar estos valores por un destino productivo.
export SCRATCH_DATABASE_URL='__SET_THE_RESTORED_SCRATCH_DATABASE_URL__'
export SCRATCH_ALLOWED_HOSTS='__SET_COMMA_SEPARATED_SCRATCH_DB_HOSTS_ONLY__'
export SCRATCH_EXPECTED_DATABASE='__SET_THE_RESTORED_SCRATCH_DATABASE_NAME__'
export RESTORE_EVIDENCE_MANIFEST='__SET_PATH_TO_RESTORE_EVIDENCE_MANIFEST__'
export RESTORE_EVIDENCE_SHA256='__SET_SHA256_OF_RESTORE_EVIDENCE_MANIFEST__'

case "$SCRATCH_DATABASE_URL,$SCRATCH_ALLOWED_HOSTS,$SCRATCH_EXPECTED_DATABASE,$RESTORE_EVIDENCE_MANIFEST,$RESTORE_EVIDENCE_SHA256" in
  *'__SET_'*) echo 'ABORT: complete the scratch-only target allowlist and database assertion.' >&2; exit 1 ;;
esac
[ -n "$SCRATCH_DATABASE_URL" ] && [ -n "$SCRATCH_ALLOWED_HOSTS" ] && [ -n "$SCRATCH_EXPECTED_DATABASE" ] || {
  echo 'ABORT: scratch target values must not be empty.' >&2; exit 1;
}

# Defensa en profundidad únicamente: estas comprobaciones no prueban la barrera externa de aislamiento.
# Generic psql invocation: its URL is the restored scratch URL above, never a hard-coded host or credential.
actual_target="$(psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
  "SELECT coalesce(inet_server_addr()::text, 'local') || '|' || current_database()")" || exit 1
actual_host="${actual_target%%|*}"
actual_database="${actual_target#*|}"
case ",$SCRATCH_ALLOWED_HOSTS," in
  *",$actual_host,"*) ;;
  *) echo "ABORT: server host '$actual_host' is not in SCRATCH_ALLOWED_HOSTS." >&2; exit 1 ;;
esac
[ "$actual_database" = "$SCRATCH_EXPECTED_DATABASE" ] || {
  echo "ABORT: database '$actual_database' does not match SCRATCH_EXPECTED_DATABASE." >&2; exit 1;
}
echo "Confirmed restored scratch target: $actual_host/$actual_database"

# The allowlist identifies a permitted target; it does NOT prove the restoration or scratch isolation barrier.
# Keep a restore manifest outside the scratch (backup identity, restore completion time,
# operator, and target) and bind it to its recorded SHA-256 before proceeding.
[ -f "$RESTORE_EVIDENCE_MANIFEST" ] || { echo 'ABORT: restore evidence manifest is missing.' >&2; exit 1; }
actual_restore_manifest_sha256="$(sha256sum "$RESTORE_EVIDENCE_MANIFEST" | awk '{print $1}')" || exit 1
[ "$actual_restore_manifest_sha256" = "$RESTORE_EVIDENCE_SHA256" ] || {
  echo 'ABORT: restore evidence manifest hash does not match the approved value.' >&2; exit 1;
}
grep -Fqx "scratch_target=$actual_host/$actual_database" "$RESTORE_EVIDENCE_MANIFEST" || {
  echo 'ABORT: restore evidence manifest does not bind to the confirmed scratch target.' >&2; exit 1;
}
grep -Fqx 'restore_completed=true' "$RESTORE_EVIDENCE_MANIFEST" || {
  echo 'ABORT: restore evidence manifest does not record a completed restore.' >&2; exit 1;
}
```

Con ese mismo destino confirmado, inspeccionar **la fila exacta** antes de resolverla. Conservar esta salida junto con la evidencia de restauración:

```sh
psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 -P pager=off -c "
SELECT migration_name, applied_steps_count, started_at, finished_at, rolled_back_at, logs
FROM \"_prisma_migrations\"
WHERE migration_name = '00000000000000_f8_schema_baseline';"
```

Abortar y restaurar de nuevo la scratch salvo que exista exactamente una fila y ésta tenga `applied_steps_count = 0`, `started_at` no nulo, `finished_at` nulo (sin terminar) y `rolled_back_at` nulo (aún no rolled back). No modificar `_prisma_migrations` manualmente. Una vez revisada esa salida, hacer que el control falle de forma automática para cualquier otro estado:

```sh
psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $check$
DECLARE matching_rows integer;
BEGIN
  SELECT count(*) INTO matching_rows
  FROM "_prisma_migrations"
  WHERE migration_name = '00000000000000_f8_schema_baseline';

  IF matching_rows <> 1 OR NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '00000000000000_f8_schema_baseline'
      AND applied_steps_count = 0
      AND started_at IS NOT NULL
      AND finished_at IS NULL
      AND rolled_back_at IS NULL
  ) THEN
    RAISE EXCEPTION 'ABORT: baseline ledger row is not exactly one unfinished, zero-step, not-rolled-back row';
  END IF;
END
$check$;
SQL

env DATABASE_URL="$SCRATCH_DATABASE_URL" npx prisma migrate resolve --rolled-back 00000000000000_f8_schema_baseline

psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $check$
DECLARE matching_rows integer;
BEGIN
  SELECT count(*) INTO matching_rows
  FROM "_prisma_migrations"
  WHERE migration_name = '00000000000000_f8_schema_baseline';

  IF matching_rows <> 1 OR NOT EXISTS (
    SELECT 1 FROM "_prisma_migrations"
    WHERE migration_name = '00000000000000_f8_schema_baseline'
      AND applied_steps_count = 0
      AND finished_at IS NULL
      AND rolled_back_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ABORT: baseline was not resolved to exactly one zero-step, unfinished, rolled-back row';
  END IF;
END
$check$;
SQL
```

La verificación posterior anterior **enforce** exactamente la misma fila con `applied_steps_count = 0`, `finished_at` nulo y `rolled_back_at` no nulo, y sale no-cero ante cualquier otro estado. Si falla, abortar, conservar la evidencia y re-restaurar la scratch; no intentar otro `resolve`.

Antes del deploy, validar estáticamente el árbol local final y el ledger de la scratch. Este control no modifica la base: exige que los únicos directorios posteriores a F7 sean los 13 nombres enumerados, que baseline no exista localmente, que F7 esté aplicado, y que no haya otro forward activo en el ledger.

```sh
MIGRATIONS_DIR='./prisma/migrations'
F7_MIGRATION='20260827010000_add_booking_visit_f7'
expected_forward_migrations='20260827110000_add_f8_deposit_terms_and_lines
20260827130000_add_f8_append_only_deposit_proofs
20260827140000_add_f8_proof_writer_guards
20260827150000_add_f8_review_operations
20260827160000_add_f8_8_rejection_operations
20260827161000_fix_f8_resubmission_deadline_guard
20260827170000_add_f8_proof_byte_retention_purge
20260827200000_add_f9_appointment_management
20260827210000_add_f9_cancellation_transition
20260827220000_add_f10_handoffs
20260827230000_add_f10_2_handoff_fencing
20260827240000_add_f10_4_handoff_resume_snapshot
20260827250000_add_f10_5_handoff_observability_indexes'

[ -d "$MIGRATIONS_DIR" ] || { echo 'ABORT: local Prisma migrations directory is missing.' >&2; exit 1; }
[ ! -e "$MIGRATIONS_DIR/00000000000000_f8_schema_baseline" ] || {
  echo 'ABORT: baseline directory must not exist in the final local tree.' >&2; exit 1;
}
actual_forward_migrations="$(find "$MIGRATIONS_DIR" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | \
  awk -v f7="$F7_MIGRATION" '$0 > f7' | LC_ALL=C sort)" || exit 1
[ "$actual_forward_migrations" = "$expected_forward_migrations" ] || {
  echo 'ABORT: local post-F7 migration directories are not exactly the approved 13.' >&2
  printf '%s\n' "Observed:" "$actual_forward_migrations" >&2
  exit 1
}

psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $check$
BEGIN
  IF (SELECT count(*) FROM "_prisma_migrations"
      WHERE migration_name = '20260827010000_add_booking_visit_f7') <> 1
     OR NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                    WHERE migration_name = '20260827010000_add_booking_visit_f7'
                      AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'ABORT: F7 is not applied exactly once in the scratch ledger';
  END IF;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
             WHERE migration_name > '20260827010000_add_booking_visit_f7'
               AND migration_name <> '00000000000000_f8_schema_baseline'
               AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'ABORT: scratch ledger already has an active migration later than F7';
  END IF;
END
$check$;
SQL
```

### Puerta operativa de quiescence para F10.1

Antes del deploy, el operador debe adjuntar una evidencia **real y aprobada**, no un placeholder ni una consulta genérica a la base. Debe demostrar que los writers están detenidos, que no hay arranque automático de aplicación/writers, y que la aprobación cubre desde F10.1 hasta completar recuperación y validación (incluido un fallo y re-restauración). Una consulta de catálogo o ledger no puede demostrar quiescence de writers.

```sh
export QUIESCENCE_EVIDENCE_FILE='__SET_PATH_TO_APPROVED_QUIESCENCE_EVIDENCE__'
export QUIESCENCE_APPROVAL_RECORD='__SET_APPROVAL_RECORD_IDENTIFIER__'
case "$QUIESCENCE_EVIDENCE_FILE,$QUIESCENCE_APPROVAL_RECORD" in
  *'__SET_'*|',') echo 'ABORT: approved F10.1 quiescence evidence and approval record are mandatory.' >&2; exit 1 ;;
esac
[ -s "$QUIESCENCE_EVIDENCE_FILE" ] || { echo 'ABORT: quiescence evidence file is absent or empty.' >&2; exit 1; }
grep -Fqx "approval_record=$QUIESCENCE_APPROVAL_RECORD" "$QUIESCENCE_EVIDENCE_FILE" && \
grep -Fqx 'writers_stopped=true' "$QUIESCENCE_EVIDENCE_FILE" && \
grep -Fqx 'automatic_application_or_writer_start=disabled' "$QUIESCENCE_EVIDENCE_FILE" && \
grep -Fqx 'coverage=F10.1_through_recovery_and_validation' "$QUIESCENCE_EVIDENCE_FILE" || {
  echo 'ABORT: quiescence evidence does not meet the required F10.1-to-validation gate.' >&2; exit 1;
}
```

Con la puerta de quiescence aprobada, ejecutar el forward una sola vez y conservar toda su salida:

```sh
run_log="./prisma-forward-scratch-$(date +%Y%m%dT%H%M%SZ).log"
set +e
env DATABASE_URL="$SCRATCH_DATABASE_URL" npx prisma migrate deploy >"$run_log" 2>&1
migrate_exit_code=$?
set -e
cat "$run_log"
[ "$migrate_exit_code" -eq 0 ] || { echo "ABORT: deploy failed; follow the failure procedure below." >&2; exit "$migrate_exit_code"; }

psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $check$
DECLARE expected_name text;
BEGIN
  FOREACH expected_name IN ARRAY ARRAY[
    '20260827110000_add_f8_deposit_terms_and_lines', '20260827130000_add_f8_append_only_deposit_proofs',
    '20260827140000_add_f8_proof_writer_guards', '20260827150000_add_f8_review_operations',
    '20260827160000_add_f8_8_rejection_operations', '20260827161000_fix_f8_resubmission_deadline_guard',
    '20260827170000_add_f8_proof_byte_retention_purge', '20260827200000_add_f9_appointment_management',
    '20260827210000_add_f9_cancellation_transition', '20260827220000_add_f10_handoffs',
    '20260827230000_add_f10_2_handoff_fencing', '20260827240000_add_f10_4_handoff_resume_snapshot',
    '20260827250000_add_f10_5_handoff_observability_indexes'
  ] LOOP
    IF (SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = expected_name) <> 1
       OR NOT EXISTS (SELECT 1 FROM "_prisma_migrations"
                      WHERE migration_name = expected_name
                        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
      RAISE EXCEPTION 'ABORT: expected migration % is not complete exactly once', expected_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM "_prisma_migrations"
             WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'ABORT: an unfinished, non-rolled-back migration remains in the ledger';
  END IF;
END
$check$;
SQL

status_log="${run_log%.log}-status.log"
set +e
env DATABASE_URL="$SCRATCH_DATABASE_URL" npx prisma migrate status >"$status_log" 2>&1
status_exit_code=$?
set -e
cat "$status_log"
[ "$status_exit_code" -eq 0 ] || { echo 'ABORT: migrate status failed; preserve its captured evidence.' >&2; exit "$status_exit_code"; }
# The SQL assertions above are the state proof; this captured Prisma status is supplementary evidence only.
```

## Fallo de un forward: recuperación sin reintento en sitio

Ante cualquier fallo de `npx prisma migrate deploy`, actuar inmediatamente en este orden:

1. Detener aplicación y todos los writers; no permitir un nuevo arranque automático. Preservar el archivo completo de salida de Prisma y la salida de la fila exacta de `_prisma_migrations` asociada a la migración fallida.
2. Identificar la causa a partir de esa evidencia (SQL, lock, permiso, drift o estado de índice). No ejecutar de nuevo `migrate deploy`, `migrate resolve` ni SQL correctivo sobre esa scratch.
3. Descartar esa scratch y restaurar una nueva copia aislada. Repetir desde la confirmación de destino y el precheck del ledger, nunca desde un estado parcial.

Para preservar esa fila, copiar el nombre de migración fallida desde el log en un placeholder y ejecutar el siguiente bloque antes de descartar. El placeholder evita consultar accidentalmente otra fila:

```sh
export FAILED_MIGRATION_NAME='__COPY_EXACT_NAME_FROM_THE_PRISMA_LOG__'
case "$FAILED_MIGRATION_NAME" in
  '__COPY_EXACT_NAME_FROM_THE_PRISMA_LOG__' | '') echo 'ABORT: set the exact failed migration name from the preserved log.' >&2; exit 1 ;;
esac
psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 -v failed_migration_name="$FAILED_MIGRATION_NAME" -P pager=off <<'SQL'
SELECT CASE WHEN count(*) = 1 THEN 'true' ELSE 'false' END AS failed_row_is_unique
FROM "_prisma_migrations"
WHERE migration_name = :'failed_migration_name' \gset

\if :failed_row_is_unique
  \echo 'Confirmed exactly one ledger row for the failure; capturing it.'
\else
  \echo 'ABORT: expected exactly one ledger row for the named failure.'
  SELECT 1 / 0;
\endif

SELECT migration_name, applied_steps_count, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name = :'failed_migration_name';
SQL
```

## Verificación F10.5 de catálogo y modo de ejecución

Ejecutar este control obligatoriamente después del deploy exitoso y antes de aprobar la scratch; si falla F10.5 o falla mientras se crean sus índices, capturarlo además antes de descartar la scratch. Verifica los objetos resultantes en `public`, la tabla padre, método `btree`, `indisready`, `indisvalid` y la definición canónica exacta. Cualquier discrepancia es condición de abortar; un índice concurrente parcial no sirve. PostgreSQL no conserva en el catálogo si se usó `CONCURRENTLY`: el log de Prisma preservado en `run_log` es la evidencia del modo de ejecución, mientras este catálogo valida los objetos resultantes.

```sh
psql "$SCRATCH_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
DO $check$
DECLARE mismatches integer;
BEGIN
  WITH expected(index_name, parent_table, index_definition) AS (
  VALUES
    ('BotHandoffAudit_createdAt_action_idx', 'BotHandoffAudit', 'CREATE INDEX "BotHandoffAudit_createdAt_action_idx" ON public."BotHandoffAudit" USING btree ("createdAt", action)'),
    ('BotHandoff_status_queuedAt_idx', 'BotHandoff', 'CREATE INDEX "BotHandoff_status_queuedAt_idx" ON public."BotHandoff" USING btree (status, "queuedAt")'),
    ('BotHandoff_status_takenAt_idx', 'BotHandoff', 'CREATE INDEX "BotHandoff_status_takenAt_idx" ON public."BotHandoff" USING btree (status, "takenAt")'),
    ('BotOperation_status_type_idx', 'BotOperation', 'CREATE INDEX "BotOperation_status_type_idx" ON public."BotOperation" USING btree (status, type)')
)
  SELECT count(*) INTO mismatches
  FROM expected
  LEFT JOIN pg_namespace AS index_schema ON index_schema.nspname = 'public'
  LEFT JOIN pg_class AS index_class
    ON index_class.relname = expected.index_name AND index_class.relnamespace = index_schema.oid
  LEFT JOIN pg_index ON pg_index.indexrelid = index_class.oid
  LEFT JOIN pg_class AS parent_class ON parent_class.oid = pg_index.indrelid
  LEFT JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent_class.relnamespace
  LEFT JOIN pg_am AS access_method ON access_method.oid = index_class.relam
  WHERE index_class.oid IS NULL
     OR parent_schema.nspname <> 'public'
     OR parent_class.relname <> expected.parent_table
     OR access_method.amname <> 'btree'
     OR pg_index.indisready IS NOT TRUE
     OR pg_index.indisvalid IS NOT TRUE
     OR pg_get_indexdef(index_class.oid) <> expected.index_definition;

  IF mismatches <> 0 THEN
    RAISE EXCEPTION 'ABORT: F10.5 index catalog does not match the approved public btree definitions (% mismatches)', mismatches;
  END IF;
END
$check$;

WITH expected(index_name, parent_table, index_definition) AS (
  VALUES
    ('BotHandoffAudit_createdAt_action_idx', 'BotHandoffAudit', 'CREATE INDEX "BotHandoffAudit_createdAt_action_idx" ON public."BotHandoffAudit" USING btree ("createdAt", action)'),
    ('BotHandoff_status_queuedAt_idx', 'BotHandoff', 'CREATE INDEX "BotHandoff_status_queuedAt_idx" ON public."BotHandoff" USING btree (status, "queuedAt")'),
    ('BotHandoff_status_takenAt_idx', 'BotHandoff', 'CREATE INDEX "BotHandoff_status_takenAt_idx" ON public."BotHandoff" USING btree (status, "takenAt")'),
    ('BotOperation_status_type_idx', 'BotOperation', 'CREATE INDEX "BotOperation_status_type_idx" ON public."BotOperation" USING btree (status, type)')
)
SELECT expected.index_name, parent_schema.nspname AS parent_schema,
       parent_class.relname AS parent_table, access_method.amname AS access_method,
       pg_index.indisready, pg_index.indisvalid, pg_get_indexdef(index_class.oid) AS definition
FROM expected
JOIN pg_namespace AS index_schema ON index_schema.nspname = 'public'
JOIN pg_class AS index_class ON index_class.relname = expected.index_name AND index_class.relnamespace = index_schema.oid
JOIN pg_index ON pg_index.indexrelid = index_class.oid
JOIN pg_class AS parent_class ON parent_class.oid = pg_index.indrelid
JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent_class.relnamespace
JOIN pg_am AS access_method ON access_method.oid = index_class.relam
ORDER BY expected.index_name;
SQL
```

## Quiescence y puertas obligatorias

1. Ensayar backup y restauración en una copia aislada del ledger y catálogo productivos; documentar el resultado y el rollback/recovery observado.
2. Antes de **todo** `psql` o Prisma, pasar la barrera externa de aislamiento scratch: restauración efímera, rol/credencial scratch-only, ruta de red/ACL sin acceso a producción y evidencia de plataforma aprobada por otro operador. Las variables, host y manifest locales sólo agregan defensa en profundidad; ninguna comprobación de shell puede probar esta puerta.
3. En esa scratch, verificar el `rolled back` de baseline con el procedimiento anterior y que no existe el directorio `00000000000000_f8_schema_baseline`.
4. Ejecutar `migrate deploy` forward y exigir las aserciones SQL de las 13 filas completas y de ausencia de filas unfinished/no rolled back; conservar `migrate status` capturado sólo como evidencia suplementaria y validar paridad de schema en la scratch. No se acepta saltear ni marcar como aplicadas las migraciones F8–F10.
5. Antes de F10.1, pasar la puerta operativa de quiescence con su archivo de evidencia y registro de aprobación. Ningún writer pre-F10 puede cambiar `BotSession.status` durante el backfill de `HUMAN_QUEUED` ni antes del índice parcial activo. La cobertura aprobada se mantiene desde F10.1 hasta finalizar recuperación y validación, incluido cualquier fallo y re-restauración; no hay arranque automático de aplicación/writers ni se levanta la quiescence por un fallo parcial.
6. Validar el resultado de F10.5 con la aserción de catálogo de `public` anterior: los cuatro índices deben tener tabla padre, `btree`, definición exacta, `indisready` e `indisvalid` correctos. El log Prisma preservado es la evidencia de `CONCURRENTLY`; el catálogo no puede probar ese modo retrospectivamente. Si falla o queda inválido, detenerse y aplicar la recuperación por re-restauración; no continuar por asumir que el índice sirve.
7. Este procedimiento nunca inicia automáticamente aplicación ni writers, ni contra scratch ni contra producción. Un arranque posterior requiere aprobación explícita separada.
8. Recién con evidencia de scratch aprobada, ventana de cambio y autorización explícita, preparar un procedimiento separado para producción. Esta rama no autoriza ese paso.

## Invariantes de abortar y escalar

- Ledger anterior a F7, checksum inesperado, baseline con pasos distintos de cero, baseline terminado o ya rolled back antes del precheck, o cualquier drift de catálogo no explicado.
- Fallo parcial de una migración, índice concurrente inválido/no listo, o writer activo durante F10.1.
- `UNKNOWN` o in-flight dispatch que impida la quiescence de handoff.
- Falta de evidencia externa aprobada por otro operador de scratch efímera, rol/credencial scratch-only y aislamiento de red/ACL sin ruta a producción.

Con cualquiera de estas condiciones, no ejecutar más migraciones ni modificar filas de `_prisma_migrations` manualmente: preservar evidencia, descartar y re-restaurar la scratch, y escalar.
