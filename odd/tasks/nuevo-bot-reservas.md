# ODD — Nuevo bot de reservas multi-vertical

Este documento es el tracker de trabajo de la funcionalidad; `plan-nuevo-bot.txt` es el plan transportable. El usuario autorizó iniciar ODD y el trabajo local del nuevo bot. No autorizó push, despliegue, acceso remoto ni mensajes reales de WhatsApp.

## Objetivo

Reemplazar gradualmente Booking V2 por un bot más rápido, escalable y confiable, con un núcleo compartido para transporte, persistencia, sesión y observabilidad, y contratos, políticas, entidades, acciones y capacidades configurables por vertical. Salón es el primer vertical; coaching y mecánica vendrán después sin duplicar el bot.

## Problema y motivo

El plan debe evitar que el núcleo incorpore supuestos exclusivos de salones. Las reservas de turnos sirven como primer caso, pero mecánica puede requerir diagnóstico y presupuestos además de agenda. La arquitectura debe mantener la latencia y la confiabilidad de mensajes como prioridades, y reservar al dominio el control de las operaciones.

## Alcance autorizado y restricciones

- Trabajo local del nuevo bot autorizado. T01 continúa parcial, pero ya no bloquea el desarrollo local independiente del nuevo bot. El subconjunto de admisión/dispatch y contrato de sesión versionada de T02 aporta la base suficiente para este slice de T03; T02 sigue parcial. No tocar producción.
- No hacer builds, push, despliegues, acceso remoto ni envíos o pruebas reales por WhatsApp sin autorización específica. Las pruebas locales enfocadas sí forman parte de la implementación.
- Barber Demo (WX-38N6UG) es un perfil de prueba aislado por tenant; no exige reversión rápida. El despliegue diagnóstico del 2026-09-27 quedó activo, pero el tráfico observado usó bot-options y la ruta diagnóstica legacy no emitió datos. No asumir mediciones de T01 ni cambiar activación/configuración compartida sin autorización.
- Mantener transporte, persistencia, orden de sesión y observabilidad compartidos; representar diferencias como contratos/políticas/capacidades de cada vertical.
- Salón primero; incluir un contrato de segundo vertical en pruebas antes de congelar el núcleo.
- La mecánica puede requerir flujo de diagnóstico/presupuesto, no solo reservar un horario.
- IA solo propone intención y entidades; las reglas del dominio validan y ejecutan.
- TDD estricto: activo según AGENTS.md. La selección de modelo IA se difiere a T08; el fallback local conocido es `gpt-4o-mini`, mientras el `OPENAI_MODEL` efectivo de Railway no está verificado.
- Estrategia de entrega: `ask-on-risk`; estrategia de cadena elegida: `feature-branch-chain` (integrar primero en la rama del nuevo bot). Forecast inicial de funcionalidad completa: más de 400 líneas propias, orientativo y no vinculante.

## Tareas y dependencias

| ID | Tarea | Depende de | Estado |
|---|---|---|---|
| T01 | Medir línea base de latencia, corrección y confiabilidad del flujo actual | — | Parcial: resumen estadístico puro conservado; colector operacional retirado por defectos de cohorte y timestamps. Falta evidencia route-specific con DB aislada |
| T02 | Definir contratos del motor, del núcleo compartido y de los verticales; incluir un contrato de segundo vertical | T01 (benchmark sigue abierto; no bloquea slices locales independientes) | Parcial: contratos, dispatch y sesión avanzan por unidades; no cierra T02 |
| T03 | Implementar ingreso durable, validación y deduplicación | T02 (contratos y tenant confiable mínimos) | Parcial: T03.1 inbox durable, aún sin integración webhook ni cierre de T03 |
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
- Próximo paso de T01: disponer de PostgreSQL aislada y evidencia por ruta para definir cohorte y timestamps operacionales. T01 sigue abierta, pero no bloquea el desarrollo local independiente del nuevo bot.

## Estrategia y cierre por unidad

- Entrega: `ask-on-risk` (predeterminada); estrategia de cadena elegida: `feature-branch-chain`.
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

- **Estado:** código local commiteado y desplegado por el padre; T01 sigue parcial. No se envió un mensaje de prueba ni se observaron logs diagnósticos o latencias reales.
- **Allowlist:** claim/queue, preflight, request/finalización y resultados del sender son opt-in mediante `WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES`, con match tenant-scoped. No se agregó una variable ni se hardcodeó Barber Demo. Durante la implementación local inicial la allowlist no estaba cargada; antes del despliegue, el padre verificó sin exponer valores que la configuración de producción existe e incluye WX-38N6UG. Con la allowlist vacía se evitan el join a `Business` y la búsqueda de ledger/eventos.
- **Correlación y alcance:** correlación sin migración por `transitionId`, sesión y revisión validados; incluye `transition`, `initial` y `cutover-recovery`, con `providerEventId` persistido para la vista inicial. El SQL devuelve solo `event.id` de la fila que superó el join tenant-scoped. Logs opt-in se etiquetan `cohort: outbox_only`, `correlation: linked|unavailable` y provider event ID o `null`; no incluyen contenido, teléfono ni código de negocio. El intervalo es `admission_to_meta_acceptance` entre `BotProviderEvent.admittedAt` y `BotOutbox.sentAt`. Meta acceptance NO significa delivery. Eventos sin outbox y fallas pre-outbox no aparecen en este emisor.
- **Seguridad:** parser exacto `kind:sessionId:revision`, sesión coincidente y revisión decimal canónica dentro del rango `bigint`; SQL recibe la revisión ya validada y compara negocio/sesión/ID completo. ID inválido, evento ausente o de otro negocio produce correlación unavailable. Fechas inválidas/ausentes/invertidas producen `durationMs: null` y `outcome: unavailable`, nunca cero corregido ni `NaN`.
- **Integración local:** `npm run test:bot-options-outbox-latency-pglite` llama a `claimOutbox` y `sendClaimedOutbox` y ejecuta su SQL real en PGlite efímero. Cubre allowlist on/off, transición normal e inicial enlazadas, evento cross-tenant/no enlazado, ID malformado y duración contra `sentAt` devuelto/persistido por SQL de aceptación. La fixture siembra manualmente la transición `initial`: no prueba el writer que la crea. El esquema mínimo vive solo en memoria; no equivale a migraciones ni a la base PostgreSQL administrada. El padre reportó PASS independiente del PGlite y encoding.
- **TDD y checks:** RED/GREEN del parser, intervalo, proyección tenant-scoped y SQL aislado están registrados en las correcciones previas. Checks locales: `npm run test:bot-options-provider-event-journal`, `npm run test:bot-options-outbox-latency-pglite`, `npm run test:whatsapp-tenant-latency-diagnostics`, `npm run test:bot-options-e2e-latency-summary`, `npm run test:whatsapp-greeting-latency`, `npm run test:whatsapp-shadow-wiring`, `npm run test:text-encoding`, `git diff --check` → PASS. `npx tsc --noEmit --pretty false` no devolvió resultado/código observable; no se afirma typecheck aprobado. Sin build.
- **Entrega:** commit local `948998a9cc017d6e6d753b95cff7f1b13c7625f8`. El padre subió únicamente `git archive HEAD` con Railway; deployment `766920f3-8b6d-4721-9622-f394d10a1d81` quedó `SUCCESS/Online`. No hubo cambio de variable por este writer; no hubo mensaje real ni medición operacional.
- **RDD:** assessment del candidato desde `2c90256` fue alto (20 paths/1671 líneas). STATUS ofreció selección untracked que omitía `--base-ref` y `--committed-only`; se detuvo antes de START. Esta unidad no tiene receipt/aprobación y no se debe afirmar revisión.
- **Cierre T01:** sigue parcial. Falta enviar un mensaje de prueba autorizado y observar los logs, incorporar eventos sin outbox/fallas pre-outbox al denominador y obtener percentiles de cohorte completa; no se ha demostrado un cuello de botella ni confiabilidad operacional. Cualquier prueba real o acción remota queda a cargo del padre/usuario.
### T03.1 — Bandeja durable aislada del webhook (unidad local)

- **Objetivo:** persistir eventos entrantes mínimos del nuevo motor en una tabla propia, tenant-scoped, sin activar ni cambiar el webhook existente.
- **Estado:** implementación local de T03.1 terminada y verificada; T03 continúa parcial. Falta integrar un adaptador autenticado al webhook y verificar su respuesta ACK en el límite real.
- **Ruta:** delegada directa; trigger: preparación de lectura y escritura no trivial en varios archivos de esquema/migración, aplicación e infraestructura y pruebas; lectura preparatoria incluida en el trabajo del writer.
- **Dependencia:** el subconjunto T02 ya probado aporta contratos de admisión/despacho y `TrustedTenantContext`; T01 parcial no bloquea esta unidad local. No declarar T02 ni T03 completas.
- **Decisión de ownership:** deduplicación por `(businessId, provider, providerEventId)`. Un replay del mismo tenant conserva la primera carga; el mismo provider ID en otro negocio es un evento independiente. El `businessId` proviene de contexto confiable separado del payload y no de datos del mensaje.
- **Modelo mínimo:** Business FK, versión de esquema, tenant/vertical confiables, proveedor + ID de evento, identidad de conversación, mensaje normalizado tipado mínimo, timestamps de recepción/admisión y solo campos de procesamiento mínimos. No persistir cuerpo arbitrario del proveedor, credenciales ni PII en logs. El contrato no afirma autenticación/firma; un adaptador futuro deberá suministrar contexto autenticado.
- **Seguridad de datos:** la migración habilita RLS en la bandeja sin crear políticas públicas: un rol no propietario sin BYPASSRLS queda denegado por defecto. No se fuerza RLS al propietario. Antes de desplegar, confirmar que el rol de servicio runtime es propietario de la tabla o tiene BYPASSRLS; este trabajo no inspecciona credenciales ni roles reales.
- **Acceptance:** validación acotada sin ejecutar getters; persistencia en transacción; resultado `accepted` o `duplicate` solo luego de resolver commit; error de storage/commit nunca es éxito elegible para ACK; replay no sobrescribe el primer payload; eventos concurrentes producen una fila; tenant distinto con ID igual produce filas independientes.
- **Fuera de alcance:** rutas/webhook, autenticación/firma, workers/scheduling, transiciones de sesión, outbox, activación del bot, tráfico real, DB compartida, generación de Prisma contra servicios, build, Railway, deploy, push y commit.
- **TDD y runner:** observar RED real antes de implementar; `npm run test:new-bot-ingress` debe aplicar la migración SQL real en PGlite aislado e invocar producción de admisión/repositorio (no SQL duplicado en prueba). Fixtures de DB locales, sin `DATABASE_URL`.
- **Checks exactos:** `npm run test:new-bot-ingress`; `npm run test:new-bot-contracts`; `npm run test:new-bot-runtime-core`; `npm run test:new-bot-session-contract`; `npm run test:text-encoding`; `git diff --check`; typecheck focal estricto de módulos/prueba modificados. No correr Booking V2 ni bot-options salvo que se toque runtime compartido.
- **Regresión mínima:** insert durable válido; replay tenant igual; duplicados paralelos; mismo ID con tenant distinto; input inválido y contexto forjado; primer payload inmutable; rollback de INSERT y fallo de COMMIT no producen éxito.
- **Rollback:** retirar la migración aditiva y los módulos/runner de `src/new-bot/application`, `src/new-bot/infrastructure` y su test/script; no requiere ni permite revertir webhook, rutas activas o datos compartidos.
- **TDD de correcciones:** RED de seguridad: `npm run test:new-bot-ingress` mostró que el rol no confiable podía leer una fila (`1 !== 0`) mientras RLS no estaba habilitado. GREEN tras habilitar RLS sin políticas: el rol fixture con `SELECT`/`INSERT` grant no ve filas y su `INSERT` se rechaza; el owner inserta mediante el repositorio.
- **Fallo real de COMMIT:** la prueba agrega solo en memoria una FK `DEFERRABLE INITIALLY DEFERRED` con un ID faltante. La sentencia devuelve `accepted` y el callback de transacción termina; el COMMIT real rechaza por FK y revierte la fila. La promesa de admisión rechaza, no devuelve `accepted`/ACK elegible. El fallo de inserción separado usa trigger fixture para probar rollback antes del commit.
- **Verificación observada:** `npm run test:new-bot-ingress`, `npm run test:new-bot-contracts`, `npm run test:new-bot-runtime-core`, `npm run test:new-bot-session-contract`, `npm run test:text-encoding`, `npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --types node scripts/new-bot-ingress-test.ts src/new-bot/application/ingress.ts src/new-bot/infrastructure/ingress-repository.ts`, `git diff --check` → PASS. No build.
- **Runtime harness:** PGlite efímero cargó la migración aditiva real y fixture mínima de `Business`; ejercitó el seam productivo, RLS con rol no propietario y FK diferida que falla en COMMIT. Sin `DATABASE_URL`, base compartida, webhook, Meta ni tráfico real. Prisma Client no se generó; migración no aplicada. El acceso del rol de servicio owner/BYPASSRLS queda como preflight obligatorio antes de deploy.
- **Cierre:** sin commit por instrucción del orquestador; el padre conserva revisión/cierre del work-unit. Retirar `prisma/migrations/20260927010000_new_bot_durable_ingress`, modelo/relación en `prisma/schema.prisma`, `src/new-bot/application/ingress.ts`, `src/new-bot/infrastructure/ingress-repository.ts`, `scripts/new-bot-ingress-test.ts` y el runner `test:new-bot-ingress` revierte esta unidad. T03 no se marca completa sin integración de webhook.