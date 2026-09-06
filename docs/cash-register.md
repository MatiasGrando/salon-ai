# Caja — operación, rollout y rollback

## Alcance

Caja usa un ledger append-only compartido por Agenda y Caja. Los cobros confirmados, señas proyectadas, operaciones y contrapartidas son historia auditable: **jamás borrar el ledger** durante una activación, corrección o rollback.

No incluye facturación fiscal, comisiones, cuotas, saldo a favor, conciliación automática, exportaciones ni doble partida.

## Interruptores

| Variable | Valor inicial | Uso |
|---|---:|---|
| `CASH_REGISTER_ENABLED` | `false` | Habilita rutas, UI, proyección de señas y listener realtime de Caja. |
| `CASH_REGISTER_LEGACY_FALLBACK_ENABLED` | `true` | Conserva la lectura/escritura legacy de señas manuales mientras Caja está apagada. |
| `CASH_REGISTER_BACKFILL_APPLY` | sin definir | Debe valer exactamente `true` sólo durante una ejecución aprobada de backfill. |

El fallback legacy debe permanecer habilitado durante todo el MVP, incluso con Caja activa. La aplicación falla al iniciar si se intenta apagarlo; retirarlo pertenece a la tarea post-MVP 9.1.

## Preflight por negocio

1. Aplicar las migraciones mediante el proceso normal de infraestructura. Este runbook no ejecuta migraciones.
2. Confirmar backup y punto de restauración de PostgreSQL.
3. Mantener `CASH_REGISTER_ENABLED=false` y `CASH_REGISTER_LEGACY_FALLBACK_ENABLED=true`.
4. Ejecutar sólo auditoría, sin `--apply`:

   ```text
   npm run cash:rollout -- --business-id=<BUSINESS_ID>
   ```

5. Revisar `timezone`, turnos sin enlace, pagos legacy faltantes, señas aprobadas sin proyección y cantidad actual del ledger.
6. Resolver manualmente conflictos de evidencia; no adivinar precios, medios ni fechas.

## Backfill controlado

El comando trabaja sobre un único `businessId`, en lotes reanudables e idempotentes. No procesa todos los negocios implícitamente.

1. En una ventana aprobada, definir temporalmente `CASH_REGISTER_BACKFILL_APPLY=true`.
2. Ejecutar:

   ```text
   npm run cash:rollout -- --business-id=<BUSINESS_ID> --batch-size=100 --apply
   ```

3. Guardar el reporte `before`, `backfill` y `after` como evidencia operativa.
4. Si hay conflictos o `readyForActivation=false`, no activar Caja.
5. Quitar `CASH_REGISTER_BACKFILL_APPLY` al terminar.
6. Repetir la auditoría sin `--apply`; debe ser estable e idempotente.

El backfill conserva precios acordados existentes. Un pago manual histórico se proyecta como `LEGACY_PAYMENT/MIGRATION/UNSPECIFIED`, sin jornada, sesión ni fecha inventada.

## Activación

Como `CASH_REGISTER_ENABLED` es un flag global del proceso, sólo debe activarse después de verificar zona IANA y una auditoría limpia para **todos los tenants** alojados en ese proceso. Auditar un solo negocio no habilita una activación parcial.

1. Verificar zona IANA y auditoría limpia de todos los negocios del proceso.
2. Configurar `CASH_REGISTER_ENABLED=true` manteniendo inicialmente `CASH_REGISTER_LEGACY_FALLBACK_ENABLED=true`.
3. Reiniciar mediante el procedimiento normal.
4. Validar permisos, apertura de jornada, sesión, Agenda, Caja y SSE sólo para ese tenant.
5. Confirmar que una seña aprobada aparece exactamente una vez y que un pago de Agenda aparece en Caja.
6. Observar errores `CASH_CLOSED`, `STALE_SESSION`, `OVERPAYMENT` y conflictos de backfill.

## Operación diaria

- **Abrir caja:** elegir responsable activo. La primera apertura requiere efectivo inicial; las siguientes heredan el efectivo esperado anterior.
- **Nueva sesión:** ingresar contado y siguiente responsable. Cambia sesión, no reinicia la jornada ni crea ajuste automático.
- **Cerrar caja:** registrar contado; la diferencia queda auditada y no modifica el saldo por sí sola.
- **Correcciones:** usar una contrapartida. No editar ni eliminar movimientos.
- **Medianoche:** la jornada continúa hasta su cierre explícito.

## Rollback seguro

1. Configurar `CASH_REGISTER_ENABLED=false`.
2. Mantener `CASH_REGISTER_LEGACY_FALLBACK_ENABLED=true`.
3. Reiniciar normalmente. La UI, rutas financieras nuevas, proyección nueva y listener de Caja quedan apagados; Agenda conserva los campos legacy.
4. Auditar el negocio y registrar el último cursor/reporte de backfill.
5. Investigar y corregir con operaciones compensatorias si corresponde.

El rollback **no** revierte migraciones, no ejecuta SQL destructivo, no elimina cuentas y no borra `CashEntry`. El ledger queda disponible para auditoría y una reactivación posterior.

## Recuperación

Después de corregir la causa, repetir preflight y auditoría. Como IDs, links y pagos legacy son idempotentes, el backfill puede reanudarse. Reactivar sólo cuando el reporte no tenga conflictos y `readyForActivation=true`.
