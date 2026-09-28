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

- Estado: parcial; T01 sigue parcial y su dependencia no está resuelta. El bot no está activo y esta unidad no modifica la ruta productiva `bot-options`.
- Ruta: T02, delegada directa. El núcleo declara contratos genéricos; los fixtures de salón y taller expresan capacidades distintas, con diagnóstico y cotización de taller independientes de agenda.
- Admisión determinística: `admitIntentProposal` recibe por separado el tenant confiable y la propuesta no confiable; exige intent/capacidad declarados y entidades requeridas, rechaza `businessId` dentro de `requiredEntities` y proyecta solo campos requeridos. Devuelve un descriptor ligado al `businessId` confiable, sin ejecutar efectos ni activar routing.
- Commit local de la unidad contractual: `86cc5aa20d141705c106b35d48839362dbb08cd2` — `feat(bot): define tenant-bound multivertical contracts`.
- Checks de esa unidad: `npm run test:new-bot-contracts` → OK; `npm run test:text-encoding` → OK; typecheck focal → OK; `git diff --check` → OK. No usar Booking V2 como prueba principal de slices nuevos; correrla solo ante integración/código compartido relevante.
- Limitación del typecheck global anterior: `npx tsc --noEmit` agotó el heap Node predeterminado; con 4 GB arrojó errores en archivos ajenos. No se afirma un typecheck global limpio.
- RDD: la revisión nativa de un candidato mal delimitado de 236 archivos fue declinada solo para ese candidato (`declined_this_candidate`). No se envió reporte: GitHub CLI no estaba disponible y la automatización de navegador falló por ACL. El modo RDD global sigue activo; no existe recibo/aprobación de ese candidato. No reutilizar la evaluación mal delimitada para declarar revisada esta unidad.
- Runtime harness: N/A; funciones puras sin ruta activa, DB, Meta/WhatsApp ni configuración remota.
- Cierre documental de la unidad anterior: el padre conserva el control del commit de trabajo.

### T02 — Segundo slice acotado: despacho vertical puro

- Estado: unidad local commiteada en `857f451b9dcf926314a3d694ce60a53504627cb2`; T01 y T02 siguen parciales. El nuevo bot no tiene ruta activa.
- Alcance implementado: frontera pura que recibe `ValidatedOperationDescriptor` y `TrustedTenantContext` por separado, exige igualdad exacta del tenant, valida vertical + intent + capability, y resuelve un único descriptor/ruta. Devuelve resultado tipado con el `businessId` del contexto confiable. No ejecuta handlers, no añade estado de reservas al núcleo y no conecta rutas productivas.
- Conducta cubierta: despacho de salón `reserve-service`; taller `diagnose-vehicle` y `prepare-quote` con capacidades distintas; preservación de tenant; rechazo de descriptor con tenant forjado, contexto inválido, propuesta cruda, capability/handler ausente o discordante, contratos/intents/handlers ambiguos y rutas accessor sin ejecutar efectos.
- TDD: RED observado para `prepare-quote` sin registro (`handler-not-found`) y para tenant forjado (el dispatch anterior aceptó y devolvió `forged-tenant`). GREEN al registrar `quote-preparation` y exigir `TrustedTenantContext` independiente; el mismatch e identidad inválida se rechazan.
- Verificación: `npm run test:new-bot-runtime-core`, `npm run test:new-bot-contracts`, `npm run test:text-encoding`, typecheck focal estricto `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node scripts/new-bot-runtime-core-test.ts src/new-bot/domain/admission.ts src/new-bot/domain/contracts.ts src/new-bot/domain/verticals/salon.ts src/new-bot/domain/verticals/workshop.ts src/new-bot/runtime/dispatch.ts`, y `git diff --check` → OK. El verificador independiente confirmó un seam de procedencia de tenant; se corrigió y cubrió con regresión. Runtime harness: N/A; la ruta no está activa y no se ejecutó integración.
- RDD: assessment desde el último boundary revisado `2c90256` devolvió riesgo alto (13 paths / 807 líneas). STATUS devolvió tokens de envío con selección de untracked que omiten `--base-ref` y `--committed-only`; un envío idéntico previo amplió el candidato a 236 archivos no relacionados. Se detuvo antes de START/consent: no se revisó este candidato, no hay recibo y no debe afirmarse aprobación. No se envió reporte de issue porque el control del navegador integrado falló por ACL.
- Sin ruta activa, despliegue ni integración. T01/T02 siguen parciales; próximos pasos dependen de completar T01 o revisar explícitamente esa dependencia.

## T02 — Contrato de sesión versionada (slice local implementado)

- Estado: T01 y T02 permanecen parciales; este slice local está implementado y verificado, sin cierre de la dependencia T01 ni activación del bot.
- Alcance: contrato puro y versionado de estado/eventos/transiciones, independiente del vertical; no cambia admisión/despacho previos, no crea ruta activa y no incorpora persistencia, IA, Meta, DB ni Railway.
- Implementación: `ConversationSnapshot` y `ConversationEvent` usan `schemaVersion: 1`; `ConversationData` restringe snapshots, payloads y efectos a datos serializables. La transición exige coincidencia entre identidad confiable, snapshot y evento (`businessId`, `conversationId`, `vertical`) y `expectedRevision` igual a la revisión actual; al aceptar incrementa revision y devuelve efectos como descriptores de datos sin ejecutarlos. No mantiene historial de IDs procesados: idempotencia durable corresponde a T03.
- Cobertura conductual: salón avanza su estado de servicio a fecha; taller avanza diagnóstico a presupuesto con estado y efectos propios. Se rechazan tenant/conversación/vertical discordantes, escritura obsoleta, descriptores de efecto ejecutables y accessors en payloads/listas sin evaluarlos.
- TDD: RED inicial por módulo `session.js` ausente. RED de regresión adicional: array accessor en payload fue aceptado; RED adicional: accessor en lista de efectos fue aceptado. GREEN tras validar arrays con descriptores propios y rechazar accessors antes de leerlos; effects se mantienen como datos.
- Verificación: `npm run test:new-bot-session-contract` → OK; `npm run test:new-bot-runtime-core` → OK; `npm run test:new-bot-contracts` → OK; `npm run test:text-encoding` → OK; `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node scripts/new-bot-session-contract-test.ts scripts/new-bot-runtime-core-test.ts scripts/new-bot-contracts-contract-test.ts src/new-bot/domain/session.ts src/new-bot/domain/admission.ts src/new-bot/domain/contracts.ts src/new-bot/domain/verticals/salon.ts src/new-bot/domain/verticals/workshop.ts src/new-bot/runtime/dispatch.ts` → OK; `git diff --check` → OK. Sin build.
- Runtime harness: N/A; no hay ruta activa ni integración durable. No se ejecutó Booking V2, DB, Meta/WhatsApp ni tráfico real.
- Ruta: delegada directa, con lectura preparatoria, por requerir archivo de contrato, prueba y script npm además del tracker. Forecast total >400 líneas permanece orientativo, no es presupuesto duro; estrategia `ask-on-risk`, cadena `feature-branch-chain` ya elegidas por el usuario.
- Reversión: retirar `src/new-bot/domain/session.ts`, `scripts/new-bot-session-contract-test.ts` y el runner `test:new-bot-session-contract` sin modificar los slices anteriores.
- Cierre: commit `d26a4d5e201ff3366fa12d7e64337c0be601cdb4` — `feat(bot): define versioned conversation transitions` (3 archivos, 509 líneas propias). Verificador independiente tras las correcciones: PASS; spot-check del padre `npm run test:new-bot-session-contract`: PASS. T01/T02 permanecen parciales; el bot sigue sin ruta activa.

### Corrección acotada tras verificación independiente — frontera de sesión

- Hallazgos corregidos en la misma unidad: el máximo entero seguro podía incrementarse a una revisión insegura; una lista de efectos con prototipo personalizado podía invocar `every` heredado; y snapshot/evento/efectos aceptados conservaban referencias mutables de entrada.
- TDD: RED observado para overflow: `Number.MAX_SAFE_INTEGER + 1` se aceptaba y producía `9007199254740992`; la regresión exigió rechazo `revision-exhausted`. Se agregaron además pruebas para el método heredado que no debe ejecutarse y mutaciones posteriores de estado/evento/efectos.
- GREEN/refactor: la transición rechaza revisión agotada; valida que arreglos usen el prototipo estándar antes de inspeccionarlos y recorre entradas por descriptores propios, sin llamar métodos heredados; copia profundamente datos validados para snapshot, evento y efectos, conservando objetos con prototipo nulo.
- Verificación posterior a corrección: `npm run test:new-bot-session-contract` → OK; `npm run test:new-bot-runtime-core` → OK; `npm run test:new-bot-contracts` → OK; `npm run test:text-encoding` → OK; typecheck focal estricto del slice → OK; `git diff --check` → OK. Sin build.
- Alcance: contrato puro del nuevo bot; runtime harness N/A; sin Booking V2, ruta activa, DB, Meta ni operaciones remotas. El commit local queda registrado arriba; T01/T02 siguen parciales.
- RDD: modo activo. Assessment desde `2c90256`: riesgo alto, 15 paths/1313 líneas (incluye hot-path de WhatsApp ajeno a esta unidad), `review_due=true`. STATUS con `--base-ref=2c90256 --committed-only=true` devolvió `intended_untracked_selection`, con tokens de envío que omiten ambos selectores. El padre se detuvo antes de START: esta unidad no tiene revisión, recibo ni aprobación; no afirmar lo contrario.

### T01 — Slice local de hitos bot-options (parcial)

- Alcance implementado: los logs de claim/queue, preflight, llamada/finalización y resultados de sender se emiten solo si el customer code pertenece al allowlist existente `WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES`. Se verificó que el parser acepta códigos `WX-...` y que el helper hace match tenant-scoped; no se creó variable nueva ni se hardcodeó Barber Demo. La variable está vacía/no configurada en este entorno, por lo que actualmente no hay emisión; además, con el allowlist vacío, la consulta de candidatos no agrega el join a `Business` ni busca `BotTransitionLog`/`BotProviderEvent`.
- Correlación sin migración: el sender relaciona `BotOutbox.transitionId` con `BotTransitionLog` por sesión/revisión únicamente para los formatos `transition`, `initial` y `cutover-recovery`; la transición de vista inicial ahora conserva `providerEventId`. Los registros incluyen `cohort: outbox_only`, `correlation: linked|unavailable` y el ID provider o `null`; no incluyen contenido del mensaje, teléfono ni código de negocio.
- Único intervalo end-to-end emitido: `admission_to_meta_acceptance`, calculado entre `BotProviderEvent.admittedAt` y el `BotOutbox.sentAt` persistido al aceptar Meta. Es aceptación del proveedor, NO entrega; un callback `deliveredAt` sigue siendo otro hito. Fallas y reintentos permanecen etiquetados como resultados del outbox. Los eventos sin outbox no llegan a este emisor y quedan fuera explícitamente de la cohorte; no se calculan percentiles ni confiabilidad de todos los ingresos.
- TDD: RED observado al agregar aserciones de contrato; `npm run test:bot-options-provider-event-journal` falló porque el sender no tenía el allowlist/campo de correlación. GREEN: el mismo runner pasó tras cablear la correlación, el gate y el hito de aceptación.
- Verificación observada: `npm run test:bot-options-provider-event-journal`, `npm run test:whatsapp-tenant-latency-diagnostics`, `npm run test:bot-options-e2e-latency-summary`, `npm run test:whatsapp-greeting-latency`, `npm run test:whatsapp-shadow-wiring`, `npm run test:text-encoding` y `git diff --check` → OK. Typecheck focal estricto no limpio: los dos archivos cambiados ya no reportaron errores; persisten errores preexistentes/no relacionados en `src/services/deposit-operations.ts` (unión de `flatMap`, nullability y `unknown`). Sin build.
- Limitación/cierre: no hubo DB aislada, runtime, tráfico Meta ni cálculo de `no-outbox`/fallas previas a outbox; T01 permanece parcial sin baseline, percentiles operacionales ni cuello de botella demostrado. No iniciar RDD desde este writer.
- Reversión: retirar los campos/CTE y nuevos hitos opt-in en `src/bot-options/infrastructure/whatsapp-outbox-sender.ts`, revertir el `providerEventId` añadido a `BotTransitionLog` en `src/bot-options/application/process-session-job.ts`, y retirar las aserciones en `scripts/bot-options-provider-event-journal-contract-test.ts`; dejar el tracker como evidencia parcial. No hay migración ni cambio de routing.
- Entrega: sin commit por instrucción del orquestador; sin build, DB, Railway, variable compartida, deploy, push, Meta ni envío real. La unidad se deja para revisión/cierre del padre.

### Corrección acotada tras verificación independiente — validación de correlación e intervalos (corregida localmente)

- Alcance autorizado: corregir únicamente la validación del identificador `transitionId` antes de asociar el outbox a un evento y la validación del intervalo de fechas antes de emitir la duración. No alterar envío, rutas, schema, configuración ni DB.
- TDD estricto: agregar primero pruebas de comportamiento del parser real de `transitionId` (prefijo/segmentos/sesión/revisión completa, sufijos inválidos, exceso de rango) y cálculo de duración (fechas válidas, invertidas, inválidas/ausentes); observar RED antes de tocar la implementación.
- Corrección: el parser ahora exige exactamente `kind:sessionId:revision`, sesión exacta y revisión decimal canónica dentro del rango PostgreSQL `bigint`; el SQL compara negocio/sesión/`transitionId` y recibe revisión como parámetro ya validado, sin castear texto de fila. IDs inválidos conservan la emisión opt-in con correlación `unavailable` y sin provider event/fecha.
- Intervalo: helper real rechaza fechas ausentes, inválidas o invertidas; para toda aceptación se registra el milestone `admission_to_meta_acceptance` con `outcome: unavailable` y `durationMs: null` cuando no hay intervalo válido, nunca cero corregido ni `NaN`. El logger preserva `null`.
- TDD de corrección: RED observado en `npm run test:bot-options-provider-event-journal` por exports helper ausentes; GREEN tras implementación y las pruebas conductuales del parser/intervalo real. Cobertura incluye sesión distinta, segmentos adicionales, sufijo vacío, signos, ceros iniciales, formato no permitido, overflow de bigint, fecha invertida/inválida/ausente.
- Verificación de corrección: `npm run test:bot-options-provider-event-journal`, `npm run test:whatsapp-tenant-latency-diagnostics`, `npm run test:bot-options-e2e-latency-summary`, `npm run test:whatsapp-greeting-latency`, `npm run test:whatsapp-shadow-wiring`, `npm run test:text-encoding` y `git diff --check` → OK. `npx tsc --noEmit --pretty false` no devolvió diagnóstico ni código observable en la sesión; queda sin verificar, no se declara typecheck aprobado.
- Corrección tenant-scope posterior: el CTE ahora proyecta `event.id` (la fila que superó el `LEFT JOIN` condicionado por `businessId`) en vez de copiar `transition.providerEventId`; así un evento ausente o de otro negocio queda `null` y no puede reportarse como linked. RED observado: la nueva aserción del contrato falló con la proyección anterior; GREEN: `npm run test:bot-options-provider-event-journal` pasó después del cambio. También pasaron `npm run test:text-encoding` y `git diff --check`. La prueba de correlación es contractual sobre SQL fuente; no se usó una DB aislada, por lo que el join real aún requiere integración.
- Integración aislada agregada: `npm run test:bot-options-outbox-latency-pglite` ejecuta las funciones productivas `claimOutbox` y `sendClaimedOutbox` y su SQL real mediante adapter efímero PGlite, sin URL/DB compartida/migración. Cubre allowlist habilitado/deshabilitado; transición normal e inicial enlazadas; event cross-tenant y event ausente sin enlace; transitionId malformado sin enlace; y el intervalo calculado contra el `sentAt` real devuelto por SQL de aceptación. RED del harness: la primera fixture puso `availableAt` en el futuro y no seleccionó la fila; la siguiente discrepancia fue la conversión PGlite de `int8`, que el adapter normaliza a `bigint` como Prisma. Son fallas de fixture/adapter, no errores observados del sender. GREEN: test PGlite, provider-event journal, encoding y diff check → OK. PGlite valida estas sentencias pero no sustituye PostgreSQL administrado ni migraciones.
- Límite de evidencia: no se ejecutó integración SQL contra DB. La prueba ejecuta helpers productivos; el filtro SQL está inspeccionado localmente pero su comportamiento de DB permanece sin prueba. Full T01 sigue parcial: no-outbox/fallos pre-outbox fuera del denominador, sin métricas operacionales ni percentiles completos.
- Mantener el límite outbox-only: esto no resuelve no-outbox/fallos anteriores a outbox, no habilita percentiles o conclusiones de cohorte completa. Sin migración, cambios de routing/envío, DB, build, Railway, variable compartida, deploy, commit, push ni Meta.