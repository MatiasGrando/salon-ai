# Runbook de corte productivo Prisma — F7 → F10

## Propósito, alcance y hechos establecidos

Este documento gobierna **un único corte productivo autorizado** para recuperar el forward Prisma F8–F10 desde el ledger histórico que termina en F7. Es un procedimiento de cambio; no autoriza por sí mismo acceso, despliegues ni operaciones sobre producción.

Hechos de partida que deben conservarse en el ticket de cambio:

- `origin/main` está en el hotfix de recuperación `1b28d6f`, que omitió `prisma migrate deploy`.
- La rama preparada restaura runtime y exactamente 13 migraciones forward F8–F10; no contiene ni debe recrear el baseline `00000000000000_f8_schema_baseline`.
- Existe evidencia de un drill Docker aislado exitoso: `prisma-local-drill-20260828-210304.log.*`. La scratch local estuvo ligada a `127.0.0.1:55433`; esa evidencia **no** prueba conectividad, permisos ni estado de producción.
- No ocurrió un deploy productivo de estas migraciones.
- F11 queda fuera de alcance: el commit, PR, artefacto y release de este cambio no pueden incluir código, migraciones, flags, contratos ni configuración de F11.

## Roles, autoridad y evidencia

| Rol | Responsabilidad | Autoridad de abortar |
| --- | --- | --- |
| Change owner | Coordina ventana, ticket, aprobaciones y evidencia. | Sí |
| DBA / operador de recuperación | Crea backup, ejecuta preflight, operación Prisma y restauración si corresponde. | Sí |
| Release owner | Controla quiescence, release y health checks. | Sí |
| Dueño funcional | Valida datos y recorridos F8–F10. | Sí |
| Observador independiente | Verifica backup restaurable y gates antes de avanzar. | Sí |

Conservar en el ticket: SHA del commit/PR aprobado, lista de 13 directorios y checksums, identificación y timestamp del backup, evidencia independiente de restore, salida completa de preflight/Prisma/status, evidencia de quiescence, estado de health checks, verificaciones post-release y decisión final. Sanitizar cualquier salida: nunca adjuntar URLs con credenciales, secretos ni variables de entorno.

## Invariantes no negociables

1. El baseline fallido se marca **solamente** como `rolled back`; jamás como `applied`, jamás se edita `_prisma_migrations` a mano y jamás se recrea su directorio.
2. F7 debe estar aplicado exactamente una vez. Las 13 migraciones F8–F10 se ejecutan forward, en orden y una sola vez mediante Prisma; no se saltean ni se marcan artificialmente aplicadas.
3. Antes de F10.1 y hasta terminar verificación o recuperación, todos los writers permanecen detenidos. Incluye procesos web, workers, cron, colas, reintentos y arranque automático.
4. La aplicación con migraciones habilitadas sólo puede iniciar después de que la operación de base haya terminado exitosamente y los controles de ledger/schema hayan pasado.
5. Un rollback de imagen de Railway restaura una imagen y sus variables custom previas; **no revierte DDL ni backfills de la base**. La recuperación de base es restaurar el backup creado inmediatamente antes del corte y luego validar la restauración.

## Gate 0 — Código y PR frescos (GO / NO-GO)

El change owner aprueba GO sólo si todos los puntos son verdaderos:

- Hay un commit nuevo, inmutable y revisado, y un PR fresco aprobado contra la base acordada. Registrar SHA, enlace del PR y revisión de los 13 directorios de migración.
- El diff contiene runtime F8–F10 y exactamente estas migraciones posteriores a F7: `20260827110000`, `20260827130000`, `20260827140000`, `20260827150000`, `20260827160000`, `20260827161000`, `20260827170000`, `20260827200000`, `20260827210000`, `20260827220000`, `20260827230000`, `20260827240000`, `20260827250000`.
- El árbol no contiene `00000000000000_f8_schema_baseline`; el PR no agrega baseline, SQL manual de reparación, ni un mecanismo que marque migraciones como aplicadas.
- La revisión demuestra que F11 está excluido: no hay directorios F11 ni cambios de runtime/configuración/flags/contratos F11. Cualquier mezcla exige un PR y ventana separados.
- El artefacto a liberar se puede vincular inequívocamente al SHA aprobado y no incluye cambios posteriores.
- El drill aislado y su evidencia fueron revisados, pero no se usan como sustituto del backup/restore productivo ni del preflight actual.

**NO-GO:** falta cualquiera de esos elementos, cambia el SHA, hay drift de migraciones/checksums, o se mezcla F11. Abrir un cambio nuevo; no “arreglar” el árbol durante la ventana.

## Gate 1 — Backup fresco y recuperación verificada (GO / NO-GO)

Inmediatamente antes de iniciar quiescence y cualquier modificación de producción, el DBA crea un backup consistente de producción. El ticket debe registrar proveedor, identificador, hora de finalización, alcance, retención y verificación de integridad, sin secretos.

Antes del corte, un operador distinto verifica **por separado** el procedimiento de restore/rollback sobre una copia aislada: identifica el backup exacto, restaura, confirma integridad mínima de ledger y datos, documenta tiempos de recuperación y confirma quién puede ejecutar la restauración productiva. No basta con saber que existe un backup ni con el drill Docker local.

**NO-GO:** backup no fresco, incompleto, no identificable, restore no verificado independientemente, o RTO/RPO no aceptado por el dueño del cambio. No avanzar a quiescence.

## Gate 2 — Quiescence sostenida (GO / NO-GO)

El release owner detiene y bloquea todos los writers **antes de F10.1**. La evidencia aprobada debe cubrir sin interrupción desde ese momento hasta la verificación completa o hasta que termine una recuperación: instancias de aplicación, jobs, consumers, cron, colas, reintentos, integraciones y auto-start/auto-scale.

Además, se confirma que no quedan operaciones de negocio en vuelo y que el mecanismo de bloqueo no iniciará writers por health/restart. Mantener lectura administrativa mínima sólo si está aprobada y no puede escribir.

**NO-GO / ABORT:** writer activo, operación en vuelo no drenada, `UNKNOWN`/handoff in-flight que no puede estabilizarse, autoarranque habilitado, o evidencia incompleta. Mantener writers detenidos, preservar evidencia y escalar; no ejecutar F10.1 ni continuar tras un fallo parcial.

## Gate 3 — Preflight actual del ledger productivo (GO / NO-GO)

El DBA ejecuta una consulta **de sólo lectura** en el canal productivo autorizado y adjunta el resultado sanitizado. Debe devolver la fila del baseline y F7, más cualquier fila activa posterior a F7:

```sql
SELECT migration_name, applied_steps_count, started_at, finished_at, rolled_back_at, logs
FROM "_prisma_migrations"
WHERE migration_name IN (
  '00000000000000_f8_schema_baseline',
  '20260827010000_add_booking_visit_f7'
)
   OR (migration_name > '20260827010000_add_booking_visit_f7'
       AND rolled_back_at IS NULL)
ORDER BY migration_name;
```

GO sólo si la evidencia demuestra simultáneamente:

- existe exactamente una fila `00000000000000_f8_schema_baseline`, con `applied_steps_count = 0`, `started_at` no nulo, `finished_at` nulo y `rolled_back_at` nulo;
- F7 (`20260827010000_add_booking_visit_f7`) existe exactamente una vez, está terminada y no está rolled back; y
- no hay migración activa posterior a F7.

Registrar también las versiones de CLI/Prisma aprobadas y el checksum/árbol de migraciones que usará el artefacto. **NO-GO:** ausencia, duplicado o estado distinto de baseline/F7; checksum inesperado; drift de catálogo; o forward activo posterior a F7. No usar `resolve`, no reintentar y no editar el ledger: preservar salida y recuperar/escalar según corresponda.

## Ejecución controlada

Con Gates 0–3 aprobados y dentro de la ventana:

1. El DBA vuelve a confirmar que el backup fresco y la quiescence siguen vigentes. Si cambió cualquiera, volver al gate respectivo.
2. Ejecutar **una sola vez** `prisma migrate resolve --rolled-back 00000000000000_f8_schema_baseline` mediante el mecanismo productivo aprobado. Capturar salida y volver a consultar la fila: debe seguir tener cero pasos y sin `finished_at`, con `rolled_back_at` no nulo.
3. Ejecutar **una sola vez** `prisma migrate deploy` con el artefacto/SHA aprobado. Capturar stdout, stderr, código de salida y timestamp. No lanzar una segunda vez como “solución rápida”.
4. Verificar el ledger: las 13 migraciones F8–F10 deben estar terminadas exactamente una vez y activas; no puede quedar ninguna fila `finished_at IS NULL AND rolled_back_at IS NULL`. Ejecutar además `prisma migrate status` como evidencia suplementaria.
5. Verificar schema y backfills antes de liberar tráfico: objetos F8/F9/F10 esperados, constraints/guards, y los cuatro índices F10.5 (`BotHandoffAudit_createdAt_action_idx`, `BotHandoff_status_queuedAt_idx`, `BotHandoff_status_takenAt_idx`, `BotOperation_status_type_idx`) deben pertenecer a las tablas esperadas, ser `btree`, estar `indisready` e `indisvalid`, y coincidir con la definición aprobada. La salida preservada de Prisma es la evidencia del modo de creación; el catálogo no prueba retrospectivamente `CONCURRENTLY`.

**ABORT durante pasos 2–5:** ante cualquier error, timeout, lock inesperado, fila parcial, índice inválido/no listo, drift o pérdida de quiescence, no ejecutar otro `resolve`, otro `migrate deploy` ni SQL correctivo. Mantener writers detenidos, capturar ledger/logs/schema, declarar incidente y activar restauración desde el backup fresco si el estado de la base no puede demostrarse íntegro.

## Release y health checks

Sólo tras el éxito de todos los pasos de base, el release owner aplica el artefacto aprobado con inicio habilitado para migraciones. Railway debe mantener el tráfico protegido por health checks: una instancia nueva no se considera apta ni recibe tráfico hasta que su health check configurado sea exitoso. Confirmar en el ticket el estado saludable y la versión/imagen activa antes de reanudar writers.

Si la aplicación falla health checks o los checks funcionales posteriores, mantener writers detenidos y decidir:

- **Fallo exclusivamente de imagen/runtime, con base validada:** puede usarse rollback de Railway a una imagen previa como contención de aplicación. Railway documenta que el rollback crea un deployment activo desde una imagen previa (sin rebuild) y restaura sus custom variables; no modifica el estado de base.
- **Fallo de DDL, backfill, ledger o incompatibilidad de datos:** rollback de imagen no resuelve el problema. Ejecutar el procedimiento previamente verificado de restauración desde backup, validar integridad, y recién entonces decidir el estado de la aplicación.

Referencia operativa Railway: [Deployment Actions — Rollback](https://docs.railway.com/deployments/deployment-actions), [Healthchecks](https://docs.railway.com/deployments/healthchecks) y [Pre-deploy migrations](https://docs.railway.com/guides/fullstack-nextjs). La decisión de rollback/recovery la toman DBA, release owner y change owner; no es automática.

## Verificación post-deploy y reapertura

Antes de habilitar writers, reunir evidencia de:

1. **Base:** ledger completo, status Prisma, schema F8–F10, validez de índices y conteos/sanity checks de backfills sin datos imposibles, duplicados inesperados ni referencias huérfanas.
2. **Datos y reglas:** validación funcional aprobada de términos/líneas y proofs F8, gestión/cancelación F9, y handoff/fencing/snapshot/auditoría F10. Validar lecturas y escrituras con cuentas de prueba controladas sin exponer datos personales.
3. **Aplicación:** health check Railway saludable, logs sin errores de esquema/Prisma, endpoints críticos y workers procesando el recorrido aprobado, sin errores de autorización ni incompatibilidad de runtime.
4. **Monitoreo:** durante el periodo acordado observar error rate, latencia, reinicios, fallos Prisma/DB, locks/timeouts, cola/reintentos, errores de writer y métricas de handoff. Definir responsable, dashboard y umbrales de alerta en el ticket.

El dueño funcional, DBA y release owner firman la reapertura. Recién entonces se habilitan writers gradualmente y se mantiene observación reforzada. Si surge una anomalía antes o después de abrir writers, detenerlos nuevamente, preservar evidencia y aplicar la rama de decisión anterior; no ocultarla mediante redeploys repetidos.

## Cierre del cambio

El change owner adjunta el paquete de evidencia, registra hora de reapertura, estado de monitoreo y resultado de la ventana. Cualquier cambio adicional, incluido F11, requiere PR, evaluación de riesgo y ventana independiente.
