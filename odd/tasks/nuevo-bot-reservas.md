# ODD — Nuevo bot de reservas multi-vertical

Este documento es el tracker de trabajo de la funcionalidad; `plan-nuevo-bot.txt` es el plan transportable. El usuario autorizó iniciar ODD y el trabajo local del nuevo bot. No autorizó push, despliegue, acceso remoto ni mensajes reales de WhatsApp.

## Objetivo

Reemplazar gradualmente Booking V2 por un bot más rápido, escalable y confiable, con un núcleo compartido para transporte, persistencia, sesión y observabilidad, y contratos, políticas, entidades, acciones y capacidades configurables por vertical. Salón es el primer vertical; coaching y mecánica vendrán después sin duplicar el bot.

## Problema y motivo

El plan debe evitar que el núcleo incorpore supuestos exclusivos de salones. Las reservas de turnos sirven como primer caso, pero mecánica puede requerir diagnóstico y presupuestos además de agenda. La arquitectura debe mantener la latencia y la confiabilidad de mensajes como prioridades, y reservar al dominio el control de las operaciones.

## Alcance autorizado y restricciones

- Trabajo local del nuevo bot autorizado. T01 sigue parcial y T02 puede avanzar solo como trabajo parcial hasta que se cierre T01 o se revise explícitamente la dependencia. No tocar producción.
- No hacer builds, push, despliegues, acceso remoto ni envíos o pruebas reales por WhatsApp sin autorización específica. Las pruebas locales enfocadas sí forman parte de la implementación.
- Barber Demo (WX-38N6UG) es un perfil de prueba aislado por tenant; no exige reversión rápida. El despliegue diagnóstico del 2026-09-27 quedó activo, pero el tráfico observado usó bot-options y la ruta diagnóstica legacy no emitió datos. No asumir mediciones de T01 ni cambiar activación/configuración compartida sin autorización.
- Mantener transporte, persistencia, orden de sesión y observabilidad compartidos; representar diferencias como contratos/políticas/capacidades de cada vertical.
- Salón primero; incluir un contrato de segundo vertical en pruebas antes de congelar el núcleo.
- La mecánica puede requerir flujo de diagnóstico/presupuesto, no solo reservar un horario.
- IA solo propone intención y entidades; las reglas del dominio validan y ejecutan.
- TDD estricto: activo según AGENTS.md. La selección de modelo IA se difiere a T08; el fallback local conocido es `gpt-4o-mini`, mientras el `OPENAI_MODEL` efectivo de Railway no está verificado.
- Estrategia de entrega predeterminada: `ask-on-risk`. Pronóstico inicial: más de 400 líneas propias para la funcionalidad completa, orientativo y no vinculante. Estrategia de cadena: pendiente de decisión cuando corresponda.

## Tareas y dependencias

| ID | Tarea | Depende de | Estado |
|---|---|---|---|
| T01 | Medir línea base de latencia, corrección y confiabilidad del flujo actual | — | Parcial: resumen estadístico puro conservado; colector operacional retirado por defectos de cohorte y timestamps. Falta evidencia route-specific con DB aislada |
| T02 | Definir contratos del motor, del núcleo compartido y de los verticales; incluir un contrato de segundo vertical | T01 | Parcial: primer slice contractual en progreso; no cierra T02 ni resuelve la dependencia de T01 |
| T03 | Implementar ingreso durable, validación y deduplicación | T02 | Pendiente |
| T04 | Implementar procesamiento ordenado por conversación y escalable | T03 | Pendiente |
| T05 | Implementar outbox y envío confiable, con reconciliación de resultados inciertos | T03, T04 | Pendiente |
| T06 | Implementar dominio de reservas de salón y estados versionados sobre el núcleo | T02, T03, T04, T05 | Pendiente |
| T07 | Implementar comprensión determinística inicial y capacidades configurables | T02, T06 | Pendiente |
| T08 | Integrar IA restringida como intérprete/proponente, sin autoridad de dominio | T06, T07 | Pendiente |
| T09 | Evaluar NLP entrenado y reducir gradualmente dependencia de IA con evidencia | T07, T08 | Pendiente |
| T10 | Ejecutar pruebas integrales y piloto autorizado con migración/reversión | T01–T09, según alcance | Pendiente |

### T01 — Verificación enfocada

- Runner requerido: `npm run test:whatsapp-greeting-latency`
- Runner requerido: `npm run test:whatsapp-shadow-wiring`
- Runner requerido: `npm run test:bot-options-provider-event-journal`
- Runner enfocado agregado: `npm run test:bot-options-e2e-latency-summary`
- Prueba del resumen estadístico puro: `npm run test:bot-options-e2e-latency-summary`. No hay colector operacional disponible.

- No ejecutar build como parte de T01.
- Antes de medir, confirmar que cada script existe y registrar cualquier limitación. TDD estricto: observar RED antes de cambios de implementación, luego GREEN y REFACTOR.
- Mapa de partida aportado por el orquestador: la ruta legacy tiene batcher en proceso, envío inline y diagnóstico de latencia por mensaje; la ruta autoritativa bot-options tiene journal durable, jobs/outbox, callbacks de estado y métricas, pero no percentiles end-to-end unidos hasta entrega.
- El análisis debe reconciliar la ruta real de webhook a estados de envío, medir p50/p95/p99, carga, saturación, errores y arranque frío; no inferir rendimiento solo de consumo de Supabase.
- Criterio de cierre: línea base reproducible, cuello de botella demostrado, correlación por identificador y brechas explícitas.
- Resumen estadístico puro conservado para percentiles y atribución de hitos cuando existan trazas válidas. No hay un colector confiable conectado a los datos durables.
- Follow-up local: se conectó la salida del diagnóstico legacy existente a una lista de códigos públicos de negocio opt-in. El despliegue del diagnóstico quedó activo el 2026-09-27. En el tráfico de prueba reportado se usó la ruta bot-options, por lo que la ruta legacy de diagnóstico no emitió; no hay medición operacional ni percentiles de T01. Barber Demo (WX-38N6UG) sigue siendo un perfil de prueba con aislamiento por tenant; no requiere reversión rápida. No se cambió el flujo productivo ni se infirió rendimiento de ese intento.
- La propuesta previa de colector se retiró: excluía replies iniciales sin `providerEventId`, no cubría transiciones `RECOVERED`/`HANDOFF`, usaba `now()` escrito en la misma transacción para aparentar transición→outbox, y descartaba eventos sin outbox, eliminando fallos del denominador. Por eso sus percentiles no representan una cohorte operacional válida.
- No se afirma una medición ni percentiles del bot. La prueba del resumen opera sobre fixtures y valida solamente el cálculo matemático.
- Brecha bloqueante: inspeccionar con una DB aislada las rutas reales y definir cohortes que incluyan replies iniciales, `RECOVERED`/`HANDOFF` y fallos previos a outbox; identificar timestamps persistidos (sin defaults del mismo instante transaccional) para recepción/ACK, encolado, inicio/fin de worker, aceptación del proveedor y callback sintético. Solo después añadir un colector probado contra esa DB y medir cold/sustained load. Aún no hay resultado real para p50/p95/p99 ni cuello de botella.

## Criterios de aceptación

- El núcleo compartido no depende de conceptos exclusivos de salón.
- Los contratos de verticales declaran sus capacidades y políticas sin duplicar el bot.
- Antes de congelar el núcleo, las pruebas incluyen al menos un contrato de segundo vertical; mecánica contempla explícitamente diagnóstico/presupuesto además de una posible agenda.
- El flujo de salón puede expresarse como vertical inicial y preserva validación determinística, aislamiento por negocio, idempotencia y confirmación segura.
- Persistencia durable, orden por conversación, outbox, métricas y reconciliación de fallos mantienen intactas las prioridades de latencia y confiabilidad del plan.
- Cada tarea se cierra solo con evidencia observada y checks aplicables; no se consideran completadas por existir en este documento.

## Progreso y evidencia

- Estado: T01 parcial. Se conserva un resumidor estadístico puro; el colector local fue retirado antes de afirmar validez operacional. No se midió el flujo real ni se demostró cuello de botella.
- Ruta: delegada directa; trigger: implementación no trivial en dos archivos de código más actualización documental, con lectura preparatoria integrada en el trabajo del writer.
- TDD seguimiento: RED observado al cambiar primero las aserciones: el resumen contaba como aceptada/entregada una traza con `deliveredAt < metaAcceptedAt` (metaAcceptedCount 4, deliveredCount 3); GREEN tras excluir trazas con orden imposible de los contadores de resultado. El test de contrato y el colector fueron retirados al descubrir sesgo de cohortes y duraciones artificiales.
- Verificación de esta corrección: `npm run test:bot-options-e2e-latency-summary` → OK (fixtures: metaAcceptedCount 3, deliveredCount 2, invalidTimestampOrderCount 1; percentiles de solo 3 trazas válidas); `npm run test:text-encoding` → OK. Los runners requeridos de greeting latency, shadow wiring y event journal habían sido reportados OK antes de retirar el colector. Sin build.
- Follow-up TDD del allowlist: RED observado al ejecutar `npm run test:whatsapp-tenant-latency-diagnostics` antes de implementar: falló por export inexistente `isWhatsAppLatencyDiagnosticsEnabledForBusiness`. GREEN: `npm run test:whatsapp-tenant-latency-diagnostics` → OK; `npm run test:whatsapp-greeting-latency` → OK; `npm run test:whatsapp-shadow-wiring` → OK; `npm run test:text-encoding` → OK. Sin build.
- Runtime harness: N/A; no hay colector disponible y no se usó DB. No se conectaron workers/outbox/Meta ni se enviaron mensajes reales.
- Follow-up runtime harness: N/A; la prueba valida allowlist y conexión al seam de emisión, pero no se hizo una ejecución contra la DB/ruta real. No se accedió a una DB aislada, configuración de piloto ni Meta/WhatsApp; no se enviaron mensajes reales. Los logs existentes identifican trazas con IDs internos, sin incluir teléfono ni texto del mensaje.
- Cierre de unidad: sin commit por instrucción del orquestador; conservar el diff local para inspección y cierre por el padre.
- Follow-up scope/rollback: retirar el código de WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES y su test revierte esta activación, dejando intactas las métricas existentes y las rutas de reservas. Unidad local aún sin commit; el padre revisa y cierra el work-unit.
- `missingStageCount` significa trazas cronológicamente válidas con aceptación del proveedor sin timestamp de callback `delivered`; no es un denominador de confiabilidad y excluye fallas anteriores a la aceptación.
- RDD: no iniciado por este writer; queda a cargo del gate de verificación del orquestador.
- Próximo paso: disponer de una PostgreSQL aislada y evidencia por ruta; determinar claves y timestamps persistidos para replies iniciales, `RECOVERED`/`HANDOFF`, eventos sin outbox y callbacks sintéticos. Diseñar cohorte con denominador de todos los ingresos elegibles y duraciones basadas en timestamps reales; después escribir RED contra una fixture representativa y validar query/join en DB aislada antes de volver a introducir cualquier colector. T01 sigue abierta.

## Estrategia y cierre por unidad

- Entrega: `ask-on-risk` (predeterminada); estrategia de cadena aún no elegida.
- Forecast de funcionalidad completa: >400 líneas propias, estimación inicial no vinculante.
- Cada tarea sustancial debe cerrarse con una unidad de trabajo y sus pruebas/documentación antes de marcarse completada. Este tracker aún no es una tarea cerrada ni un commit.

## Cierre de primera unidad local

- Commit: 2c90256 — diagnóstico por perfil y resumidor estadístico. T01 continúa abierta; no hay medición operacional.
- Revisión nativa: aprobada y reconocida (review-b342561edaa3c1fc); sin bloqueantes. Advertencia no bloqueante: agregar prueba conductual de emisión del webhook con sink capturado; las expresiones regulares actuales no prueban ejecución completa.
- Estrategia elegida: feature-branch-chain; integrar primero en rama del nuevo bot, no en producción.
- Validación final: test:text-encoding OK. diff --check detectó únicamente una línea vacía final del tracker en el candidato original; este registro normaliza ese final.
- No se activó el piloto ni se hizo push/despliegue. Próximo paso: prueba conductual del diagnóstico antes de habilitarlo en Barber Demo.
- Commit 79c3abd: prueba conductual con sink capturado; demuestra emisión para perfil opt-in y ausencia para perfil no listado, sin ejecutar webhook/DB reales. RED/GREEN observado; tests tenant, greeting, shadow, booking-v2 (250), encoding y diff check: PASS.
- RDD para 79c3abd: riesgo alto por tocar webhook; usuario eligió omitir revisión solo para este candidato (declined_this_candidate). No hay recibo de revisión de este commit; futuras revisiones siguen habilitadas. T01 continúa abierta y no se activó el piloto.

## Follow-up de revisión R3 — emisión tenant-scoped

- RED observado: `npm run test:whatsapp-tenant-latency-diagnostics` falló antes del seam conductual porque `latency-diagnostic.ts` aún no exportaba `emitWhatsAppLatencyDiagnostic`.
- GREEN: se extrajo la decisión/serialización de emisión a `emitWhatsAppLatencyDiagnostic`, inyectando el sink. La prueba ejecuta el seam real, captura el sink y verifica que el negocio allowlisted emite exactamente una línea mientras el no listado no emite; en ambos casos los disparadores global, greeting y bot especial están desactivados.
- El webhook delega la emisión existente al seam con los mismos cuatro disparadores; no cambia enrutamiento, reservas ni decisiones del motor. La prueba de greeting verifica el wiring y la serialización en su nueva ubicación.
- Verificación observada: `npm run test:whatsapp-tenant-latency-diagnostics` → OK; `npm run test:whatsapp-greeting-latency` → OK (fixtures: total 8130 ms); `npm run test:whatsapp-shadow-wiring` → OK; `npm run test:text-encoding` → OK; `git diff --check` → OK. Sin build.
- Runtime harness: parcial — ejecución del seam con sink capturado; no se ejecutó el webhook de punta a punta, ni DB, tráfico, configuración ni WhatsApp real.
- Reversión: restaurar el bloque de emisión anterior en `src/services/whatsapp-webhook-service.ts`, retirar `emitWhatsAppLatencyDiagnostic` de `src/services/latency-diagnostic.ts` y eliminar las expectativas conductuales/wiring actualizadas en `scripts/whatsapp-tenant-latency-diagnostics-test.ts` y `scripts/whatsapp-greeting-latency-diagnostic-test.ts`. No afecta la allowlist ni comportamiento de reservas.
- T01 permanece parcial: esta prueba resuelve el warning de cobertura de emisión, pero no aporta medición operacional, percentiles del flujo real ni cuello de botella demostrado. Sin commit por instrucción del orquestador; revisión/commit quedan a cargo del padre.

## T02 — Primer slice de contratos compartidos

- Estado: parcial; T01 también sigue parcial y su dependencia no está resuelta. Este slice no cierra T02 ni modifica la ruta productiva `bot-options`.
- Ruta: T02, delegada directa. El núcleo expone contratos genéricos; los fixtures de salón y taller declaran capacidades distintas, y taller admite diagnóstico/cotización sin agenda.
- Admisión determinística: `admitIntentProposal` recibe el tenant confiable aparte de la propuesta no confiable; acepta solo intents y capacidades declarados, exige entidades requeridas, rechaza `businessId` reservado en `requiredEntities` y proyecta solo los campos requeridos. Devuelve un descriptor ligado al businessId confiable; no ejecuta efectos ni está conectado a una ruta activa.
- TDD observado: RED del slice inicial por fixtures ausentes; RED de la regresión de seguridad mostró `attacker-tenant` dentro de `entities` cuando el contrato pedía `businessId`. GREEN tras agregar la validación y pasar ambas pruebas.
- Checks: `npm run test:new-bot-contracts` → OK; `npm run test:booking-v2` → OK (250 pruebas); `npm run test:text-encoding` → OK; `git diff --check` → OK (avisos Git LF/CRLF). Typecheck focal `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node scripts/new-bot-contracts-contract-test.ts src/new-bot/domain/contracts.ts src/new-bot/domain/admission.ts src/new-bot/domain/verticals/salon.ts src/new-bot/domain/verticals/workshop.ts` → OK.
- Typecheck global: `npx tsc --noEmit` agotó el heap Node predeterminado; al reintentar con heap de 4 GB aparecieron errores de TypeScript en archivos ajenos al slice. Sigue sin quedar limpio.
- Runtime harness: N/A; función pura sin routing, DB, Meta/WhatsApp ni configuración remota.
- Reversión: retirar el módulo, fixtures y test bajo `src/new-bot/domain` y `scripts/new-bot-contracts-contract-test.ts`, el script de `package.json` y esta sección; no modifica datos ni rutas productivas.
- Cierre: commit pendiente del padre; el review gate también queda a su cargo.
- Próximo paso: mantener T01/T02 parciales hasta resolver la dependencia de T01 y completar el alcance restante.
