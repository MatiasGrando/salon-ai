# Runbook de cutover, rollback y piloto F11

## Alcance y regla de seguridad

Este procedimiento cambia el **routing exclusivo** de WhatsApp para un único comercio piloto. No habilita capacidades por sí solo. Routing y capability switches son controles distintos y nunca se sustituyen entre sí.

Una ventana nocturna **no demuestra inactividad**. El único criterio válido es el preflight durable ejecutado bajo pausa de dispatch, con quiescence confirmada y cero estados protegidos o `UNKNOWN`.

## Responsables

| Rol | Responsabilidad |
|---|---|
| Responsable de corte | Inicia preflight, lee toda la evidencia y confirma o aborta. No opera solo. |
| Observador de datos | Verifica métricas, backlog, ledger de auditoría y ausencia de `UNKNOWN`. |
| Responsable funcional | Ejecuta los gates verticales del negocio piloto y decide avance de capacidades. |
| Responsable de rollback | Conserva acceso al selector CRM y puede volver a routing legacy con el mismo protocolo. |

La misma persona no debe confirmar el corte y declarar exitoso el piloto sin una segunda revisión.

## Precondiciones obligatorias

1. Gate 1 de restauración local aprobado y evidencia retenida.
2. Estado real de migraciones verificado; migraciones requeridas aplicadas sin errores pendientes.
3. Deployment saludable con **todos los capability switches F11 apagados**.
4. Configuración exclusiva del motor objetivo en estado `ACTIVE`, perteneciente al mismo comercio.
5. WhatsApp conectado y tenant resuelto unívocamente.
6. Métricas y logs sanitizados accesibles; rollback CRM probado en un comercio de prueba.
7. Un solo comercio piloto autorizado. Ningún bot personalizado o comercio restante cambia.

## Estado de preparación registrado el 29 de agosto de 2026

Validaciones locales aprobadas:

- contratos puros completos del bot de opciones;
- configuración con defaults apagados y dependencias estrictas;
- API/CRM F11.4 autenticada, sin acceso de staff y con confirmación integrada;
- fuentes UTF-8 sin secuencias corruptas;
- hash y tamaño del backup de recuperación verificados nuevamente.

Hallazgos y deuda histórica:

- una reconstrucción local desde una base vacía encontró que la migración `20260621202644_add_reminder_automation_list` intenta alterar `ReminderAutomation` antes de que la tabla sea creada/renombrada por migraciones posteriores;
- por ese error, la cadena completa de 145 migraciones no es reproducible desde una base vacía; la recuperabilidad productiva se valida restaurando el backup lógico y aplicando únicamente las migraciones posteriores al ledger restaurado;
- el 29 de agosto de 2026 la restauración local aprobó F8→F11, F11.1, F11.2/F11.3, inbound legacy, carga, integridad `pg_amcheck` y cleanup;
- ese mismo día el ledger productivo se recuperó desde F7 mediante el procedimiento ensayado y Prisma confirmó las 145 migraciones actualizadas;
- F11 quedó desplegado con los nueve flags explícitamente apagados. La activación del piloto continúa requiriendo un comercio y una configuración exclusivos autorizados.

La excepción de rendimiento descrita más abajo no aplica a estos bloqueos.

## Capability switches

Mantener apagados antes del corte y habilitar de a uno durante el piloto:

1. admisión autoritativa del motor nuevo;
2. workers de procesamiento;
3. sender/outbox;
4. reservas sin seña;
5. señas y comprobantes;
6. gestión de turnos;
7. handoff humano.

Apagar una capacidad contiene esa función; **no devuelve el routing a legacy**. Para rollback de routing se usa el selector y el preflight completo.

El deployment inicial debe verificar explícitamente estos valores:

```text
BOT_OPTIONS_SHADOW_ADMISSION_ENABLED=false
BOT_OPTIONS_AUTHORITATIVE_PROCESSING_ENABLED=false
BOT_OPTIONS_WORKERS_ENABLED=false
BOT_OPTIONS_SENDER_ENABLED=false
BOT_OPTIONS_CAPABILITY_BOOKING_ENABLED=false
BOT_OPTIONS_CAPABILITY_DEPOSITS_ENABLED=false
BOT_OPTIONS_CAPABILITY_APPOINTMENT_MANAGEMENT_ENABLED=false
BOT_OPTIONS_CAPABILITY_HANDOFF_ENABLED=false
BOT_OPTIONS_LEGACY_DISPATCH_COVERAGE_COMPLETE=false
```

La ausencia de una variable también resuelve a `false`, pero el deployment piloto debe declararlas para que la evidencia operativa sea inequívoca. Cualquier valor distinto de los literales `true` o `false` impide iniciar la aplicación.

## Procedimiento de cutover

1. Abrir el selector exclusivo del CRM y verificar comercio, motor actual y `generation`.
2. Seleccionar el motor objetivo y ejecutar **Revisar y cambiar routing**.
3. El sistema pausa nuevas claims, incrementa el fence y espera el drain.
4. Revisar todos los conteos y listas del snapshot:
   - borradores nuevos/legacy: advertencia; se descartarán sólo al confirmar;
   - inbox/jobs/outbox activos: bloqueo;
   - holds, señas pendientes/revisión/reenvío y handoffs: bloqueo;
   - estados legacy protegidos: bloqueo;
   - cualquier `UNKNOWN`: bloqueo absoluto.
5. Si el preflight está bloqueado, no confirmar. Resolver el estado o abortar para reanudar sin cambiar pointer.
6. Si está limpio, una segunda persona revisa evidencia y generación esperada.
7. Confirmar en el diálogo integrado. El commit invalida runtime descartable, cambia pointer y `generation`, audita y reabre dispatch atómicamente.
8. Verificar inmediatamente:
   - un solo engine activo;
   - `claimsPausedAt` nulo;
   - generación incrementada exactamente una vez;
   - auditoría `ACTIVATE` con actor y transición;
   - cero `UNKNOWN` y cero doble claim.

## Tratamiento de `UNKNOWN`

`UNKNOWN` significa que un efecto pudo haber llegado al proveedor, pero no existe confirmación durable suficiente. Nunca se reintenta automáticamente durante cutover.

1. Mantener el scope pausado.
2. Correlacionar por outbox/dispatch claim y, si existe, provider message ID.
3. Resolver mediante una decisión auditada: asumir enviado, omitir o reenviar aceptando riesgo de duplicado.
4. Repetir preflight desde la generación todavía vigente.
5. Si no puede clasificarse, abortar el cambio y escalar. No forzar el pointer.

## Gates verticales del piloto

Avanzar sólo si el gate anterior permanece estable y admite rollback separado:

1. menú principal;
2. catálogo y horarios;
3. draft de reserva;
4. confirmación sin seña;
5. seña, comprobante, revisión, expiración y reenvío;
6. cancelación/reprogramación;
7. handoff y retorno.

Para cada gate registrar comercio, generación, capacidad habilitada, hora, resultado, métricas y decisión de continuar/retroceder.

## Métricas y umbrales

- ACK autoritativo `http_received → durable_admission_commit → ack`: p95 ≤ 200 ms.
- Procesamiento interno queue-inclusive, excluyendo settle y Meta: p95 ≤ 1,5 s sostenido.
- `inbound_admitted → delivered_callback`: p95 ≤ 3 s; si falta callback, marcar muestra **incompleta**, nunca reemplazar por `accepted`.
- backlog más viejo: aviso > 60 s, crítico > 5 min.
- alerta inmediata: cualquier `POISON`, cualquier `UNKNOWN`, doble engine/claim o cambio inesperado de generation.

No incluir teléfonos, nombres, cuerpos, secretos ni IDs de entidad en labels o evidencia compartida.

## Excepción temporal de rendimiento del primer piloto

El 29 de agosto de 2026 se autorizó continuar la preparación de F11 sin considerar el incumplimiento aislado del ACK p95 como un error funcional. La evidencia local retenida clasificó:

- transacción vacía p95: 47,21 ms;
- admisión autoritativa secuencial p95: 265,65 ms;
- admisión autoritativa en ráfaga x4 p95: 402,34 ms;
- errores funcionales observados durante esa prueba: cero.

Esta excepción:

1. aplica únicamente al primer comercio piloto y a volumen controlado;
2. no modifica el objetivo técnico de ACK p95 ≤ 200 ms ni el test que lo exige;
3. no autoriza `UNKNOWN`, `POISON`, duplicados, cross-tenant, pérdida de auditoría, migraciones pendientes ni rollback no probado;
4. exige registrar latencia, timeouts, reintentos del proveedor y backlog durante todo el piloto;
5. obliga a detener la expansión si la latencia produce timeouts, reintentos, duplicados o crecimiento sostenido del backlog;
6. vence antes de habilitar un segundo comercio o aumentar concurrencia.

La muestra de delivery continúa siendo incompleta mientras no exista `delivered_callback`; `accepted` nunca se registra como entrega.

## Rollback de routing

1. Contener primero la capacidad defectuosa si reduce riesgo; esto no cambia routing.
2. En el selector elegir **Bot actual (legacy)**.
3. Ejecutar el mismo preflight, pausa, drain y revisión. No existe atajo de rollback.
4. Con cero protegidos y cero `UNKNOWN`, confirmar el diálogo de rollback.
5. Verificar `engineKey=legacy-whatsapp`, configuración activa nula, generación incrementada una vez, scope reanudado y auditoría `ROLLBACK`.
6. Mantener capacidades nuevas apagadas y conservar evidencia para análisis.

## Criterios de abortar el piloto

- ACK p95 fuera de presupuesto de forma sostenida, excepto durante la excepción temporal documentada; aun con excepción se aborta si causa timeouts, reintentos, duplicados o backlog creciente.
- Delivery p95 > 6 s o muestra incompleta creciente sin explicación.
- `UNKNOWN`, `POISON`, doble respuesta, doble motor o reejecución de una acción `STALE_CUTOVER`.
- Inconsistencia financiera, tenant incorrecto, pérdida de auditoría o incapacidad de ejecutar rollback.

Ante cualquiera: detener avance, apagar la capacidad afectada, preservar evidencia sanitizada y ejecutar rollback protegido cuando el preflight lo permita.
