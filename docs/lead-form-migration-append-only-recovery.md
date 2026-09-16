# Recuperación de migración de formularios fallida (append-only)

**NO-GO actual:** `20260915183000_add_lead_capture_forms` quedó fallida (`P3018/P0001`) porque su versión anterior ejecutaba `UPDATE "PipelineLeadEvent"`, bloqueado por `PipelineLeadEvent_append_only_trigger`. No desactivar el trigger ni modificar los nueve eventos históricos. La segunda migración de `rewardMode` no se ejecutó.

## Decisión

Revertir **solo** el DDL parcial de la primera migración, después de auditoría y backup, y marcar el intento fallido `--rolled-back`. Luego desplegar el SQL local corregido (actorKind `NOT NULL DEFAULT 'USER'` por DDL, sin UPDATE). Es más seguro que completar manualmente una migración larga e intentar `--applied`, ya que aún no existen tablas nuevas y no hay datos de formularios que preservar. Toda operación productiva exige autorización separada del operador.

**Importante:** PostgreSQL/Prisma no envolvieron todo el archivo en una transacción; por eso quedaron tipos/columnas parciales. La recuperación de abajo SÍ es una transacción y falla antes de borrar si cualquier precondición cambió. El baseline remoto `00000000000000_f8_schema_baseline` está verificado `rolled_back=true`; aunque no existe como archivo local, no es un intento activo ni debe bloquear este repair. NO usar `--applied` para inventar historia ni tocar su fila a ciegas.

## Auditoría previa de solo lectura

Confirmar en una ventana controlada con backup/restauración disponible:

- La fila exacta de `_prisma_migrations` tiene `finished_at IS NULL`, `rolled_back_at IS NULL` y error append-only. Registrar `id`, `checksum` y logs.
- `PipelineLeadEvent`: nueve filas, todas con `actorKind IS NULL`; trigger append-only sigue habilitado.
- `BusinessFeatureSettings.leadCaptureFormsEnabled`: ninguna fila true.
- `PipelineLead.customData='{}'::jsonb`, `customDataSchemaVersion=1` en todas las filas.
- No existen `LeadCaptureForm`, `FormSubmission`, `FormReward`, `RewardClaim`, `PublicFormRateLimitBucket`; `PipelineStage_businessId_pipelineId_id_key` tampoco existe.
- Las cuatro enums de la migración fallida existen y no son utilizadas por otros objetos.

## SQL de reversión parcial — **preparado, NO ejecutado**

Ejecutar solo después de cotejar la auditoría y backup. Usar una sesión PostgreSQL conectada al esquema correcto; el script supone `public` en `search_path`. No usar `CASCADE`.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, pg_catalog;

-- Hold these locks through the audit and DROP so no writer can race the
-- default-data checks. If a lock is unavailable in 5s, stop/re-audit.
LOCK TABLE "BusinessFeatureSettings", "PipelineLead", "PipelineLeadEvent"
IN ACCESS EXCLUSIVE MODE;

DO $audit$
DECLARE
  failed_count integer;
  type_count integer;
  column_count integer;
BEGIN
  SELECT count(*) INTO failed_count
  FROM "_prisma_migrations"
  WHERE migration_name = '20260915183000_add_lead_capture_forms'
    AND finished_at IS NULL AND rolled_back_at IS NULL;
  IF failed_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one unresolved failed lead-form migration, got %', failed_count;
  END IF;

  SELECT count(*) INTO type_count FROM pg_type
  WHERE typnamespace = 'public'::regnamespace
    AND typname IN ('PipelineActorKind','LeadCaptureFormStatus','FormSubmissionStatus','LeadRewardType');
  IF type_count <> 4 THEN RAISE EXCEPTION 'Unexpected enum set: %', type_count; END IF;

  SELECT count(*) INTO column_count FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name='BusinessFeatureSettings' AND column_name='leadCaptureFormsEnabled')
      OR (table_name='PipelineLead' AND column_name IN ('customData','customDataSchemaVersion'))
      OR (table_name='PipelineLeadEvent' AND column_name='actorKind'));
  IF column_count <> 4 THEN RAISE EXCEPTION 'Unexpected partial column set: %', column_count; END IF;

  IF EXISTS (SELECT 1 FROM "PipelineLeadEvent" WHERE "actorKind" IS NOT NULL) THEN
    RAISE EXCEPTION 'ActorKind contains data; stop';
  END IF;
  IF EXISTS (SELECT 1 FROM "BusinessFeatureSettings" WHERE "leadCaptureFormsEnabled" IS DISTINCT FROM false) THEN
    RAISE EXCEPTION 'Lead-form flag contains non-default data; stop';
  END IF;
  IF EXISTS (SELECT 1 FROM "PipelineLead"
             WHERE "customData" IS DISTINCT FROM '{}'::jsonb
                OR "customDataSchemaVersion" IS DISTINCT FROM 1) THEN
    RAISE EXCEPTION 'PipelineLead partial columns contain non-default data; stop';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class
             WHERE relnamespace='public'::regnamespace
               AND relname IN ('LeadCaptureForm','FormSubmission','FormReward',
                               'RewardClaim','PublicFormRateLimitBucket',
                               'PipelineStage_businessId_pipelineId_id_key')) THEN
    RAISE EXCEPTION 'Later migration objects exist; stop';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                 WHERE tgrelid='public."PipelineLeadEvent"'::regclass
                   AND tgname='PipelineLeadEvent_append_only_trigger'
                   AND NOT tgisinternal AND tgenabled <> 'D') THEN
    RAISE EXCEPTION 'Append-only trigger missing/disabled; stop';
  END IF;
END
$audit$;

ALTER TABLE "PipelineLeadEvent" DROP COLUMN "actorKind";
ALTER TABLE "PipelineLead" DROP COLUMN "customDataSchemaVersion", DROP COLUMN "customData";
ALTER TABLE "BusinessFeatureSettings" DROP COLUMN "leadCaptureFormsEnabled";

DROP TYPE "LeadRewardType";
DROP TYPE "FormSubmissionStatus";
DROP TYPE "LeadCaptureFormStatus";
DROP TYPE "PipelineActorKind";

COMMIT;
```

Si cualquier assertion o DROP falla, hacer `ROLLBACK` y volver a auditar. No usar `CASCADE` para forzar dependencias. El DROP de una columna puede tomar un lock breve; respetar la ventana y no subir los timeouts a ciegas.

## Historia Prisma y reintento — **no ejecutado**

1. Verificar por read-only que las cuatro columnas y cuatro enums desaparecieron, las nueve filas de `PipelineLeadEvent` siguen intactas y su trigger continúa habilitado.
2. Con el SQL local corregido ya disponible en la máquina que despliega, ejecutar **bajo autorización separada**:

   `npx prisma migrate resolve --rolled-back 20260915183000_add_lead_capture_forms`

   Esto marca el intento fallido; NO usar `--applied`, ni editar a mano `_prisma_migrations` o su checksum.
3. Revisar `npx prisma migrate status`. La baseline F8 remota ya fue comprobada `rolled_back=true`; no resolverla ni recrearla. Si la herramienta denuncia otra historia divergente, detenerse.
4. Reintentar `npx prisma migrate deploy` solo tras revisar el checksum del archivo corregido, la copia de seguridad y el plan de rollback. Prisma debe registrar un **nuevo intento** con el nuevo checksum; no reescribir la fila fallida.
5. Solo luego de PASS de ambas migraciones, generar Prisma, probar cliente/DB/host y mantener Barber Demo DRAFT + flag false hasta E2E controlado y go/no-go.

La reparación y el deploy ya tienen autorización explícita del usuario; este documento prepara la secuencia segura y deja la ejecución al coordinador/operador, no a este test local. No reanudar el deploy fallido antes de cumplir las assertions y revisar la copia de seguridad.
