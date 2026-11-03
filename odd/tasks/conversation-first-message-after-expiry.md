# Primer mensaje conversacional tras vencer el contexto

## Objetivo y autorización
2026-11-03: el usuario autoriza corregir el reinicio por inactividad que consume el nuevo pedido antes de la IA. También solicita revisar el primer contacto sin historial y el mensaje posterior a /reset. La interpretación y redacción siguen a cargo de la IA; no iniciar una reserva porque el contexto terminó. No desplegar, reiniciar servidor ni alterar datos de producción.

## Problema y evidencia
Con varios días de inactividad, «hola quiero cancelar mi turno» recibió «Hola. Empecemos de nuevo. ¿Qué servicio necesitás?». El código vence a las 24 horas, reinicia BotSession, persiste un saludo, marca el evento PROCESSED y retorna EXPIRED antes de clasificación. El texto nuevo no se interpreta. Este camino no había cambiado respecto de origin/main almacenado localmente (9d5c01b); no se consultó producción ni se verificó su commit desplegado.

Base local 459a9d4 en codex/barber-initial-intent-recovery. Los cambios conversacionales y visuales anteriores se conservan. Trabajo local autorizado; sin acceso remoto, consultas reales, cancelaciones ni reprogramaciones.

## Alcance y restricciones
Para texto nuevo del canal conversacional habilitado y con política vigente verificada, limpiar el borrador vencido y continuar procesando el mismo evento sobre el estado actualizado. No interpretar un botón antiguo como texto nuevo ni reproducir su acción tras el reset. Conservar comportamiento de menú legacy, invalidación de prompts, auditoría, límites de tenant/deployment/generation, revisiones, espera de trabajos/envíos en curso y protecciones financieras/handoff. No cambiar el plazo de 24 horas ni el significado de /reset. Número nuevo y mensaje posterior al reset deben conservar su texto y recorrido normal; investigar antes de modificar esos caminos.

## Tareas
- [x] C1 — Implementado en d1c6ab2: señal explícita de texto actual desde tres llamadores y política conversacional vigente comprobada sólo al vencer. Reset, auditoría y prompts invalidados en la misma transacción; retorno CONTINUE antes de saludo y consumo del evento. Ruta delegated direct por mapa de cuatro fuentes y escritor acotado. Sintaxis, UTF-8, encoding y diff PASS; criterios funcionales preparados en regresiones sin ejecutarlas, aceptación humana pendiente.
- [x] C2 — Auditoría de nuevo contacto y post-/reset completada sin pérdida equivalente encontrada; documentación y contrato worker alineados en d1c6ab2. Ruta delegated direct para preparación y regresiones; cierre documental mecánico del padre. Regresiones añadidas pero no ejecutadas, comprobaciones estáticas PASS y evaluación nativa bajo presupuesto. Prueba real y publicación pendientes del usuario.

## Verificación y entrega
TDD STRICT heredado; por instrucciones persistentes del usuario no ejecutar suites/flujos, pruebas con IA/DB, tipos ni build. No inventar RED/GREEN. Se permite actualizar regresiones existentes relevantes sin ejecutarlas; registrar esa limitación. Comprobaciones observables: parseo sintáctico TypeScript sin importar la aplicación, UTF-8, git diff --check y npm run test:text-encoding obligatorio antes de cada commit. Runner funcional existente para referencia: npm run test:bot-options-context-window; no ejecutarlo sin nueva autorización que revoque la restricción anterior.

Forecast 150–280 líneas authored, heurístico y no límite. Entrega local ask-on-risk, feature-branch-chain ya elegida en la sesión si hiciera falta; sin PR/push en este trabajo. Modo RDD ON previamente verificado; frontera pendiente b622043 (último slice observado 60 líneas bajo presupuesto). Evaluar committed-only y seguir preflight sólo si corresponde; omisión anterior de revisión no autoriza omitir un candidato nuevo. Espejo Engram odd/conversation-first-message-after-expiry/tasks pendiente porque no hay herramientas mem_context/mem_search/mem_get_observation disponibles.

## Progreso
Exploración read-only delegada de expiración y auditoría independiente de nuevo contacto/post-reset en curso. Documento creado antes de la primera escritura de fuentes. Próximo paso: confirmar estado que consume la IA tras el reset y señal segura de texto, luego implementar C1 conservando fences e idempotencia. Sin fuentes modificadas todavía.

### Hallazgos previos a C1
El estado de la IA vive en BotSession.state.conversationDraft; el reset existente elimina ese sidecar y el lector reconoce el estado inicial. El inbox vuelve a leer/bloquear la sesión tras el fallback de expiración. La invalidación de prompts estaba dentro de persistView: al omitir el saludo debe hacerse explícitamente en la nueva rama y en la misma transacción. Sólo la política conversacional vigente y texto actual sin token interactivo permiten continuar; la señal del llamador por sí sola no otorga autoridad.

### Auditoría C2 de primer contacto y reset
Sin sesión, la ventana retorna CONTINUE y el admission input.initial conserva textBody; el worker crea la sesión y pasa el mismo payload a la IA. No se encontró pérdida determinista equivalente en contacto nuevo. Reset exacto es una barrera de consolidación; la transición system.conversation_restart no se mezcla con conversation.message y el siguiente texto llega a la IA con estado limpio. /reset es un control de Barberdemo; los otros negocios conservan sus comandos de reinicio existentes. Pagos/handoff protegidos pueden rechazar un reset expresamente. La intersección corregida por C1 es que un comando de reset recibido tras vencer la ventana tampoco debe consumirse antes de llegar a su handler. Fuentes de regresión existentes del post-reset reconocen diálogo limpio; no se ejecutaron. Auditoría de código, no validación de chats reales nuevos ni de producción.

## Cierre observado
Commit d1c6ab21b0a533e5a3451752c1d2b4ac2caf44ae: siete archivos, 147 adiciones y 21 eliminaciones (168 authored con este documento). El padre revisó los diffs de cuatro fuentes y del contrato/documentación. Se conservaron guards financieros/handoff, generaciones, revisión, jobs/inboxes actuales excluidos del retiro, WAIT/REPLAY y flujo legacy/interactivo. La autorización de continuación se basa en tipo de mensaje y política vigente, sin palabras clave de cancelación, reserva o reinicio.

Contrato worker ampliado con continuación de texto original una vez hacia clasificación, comandos de reinicio, primer contacto sin sesión, política inválida y botón con identificador interactivo aunque declare tipo texto. No se ejecutaron esas pruebas ni dobles de DB. Observados PASS: parseo TypeScript de cinco archivos sin importar aplicación, UTF-8 estricto de seis archivos, git diff --check y npm run test:text-encoding antes del commit. No flujo, suites, tipos, build, IA/DB real, servidor, push ni producción. No se afirma aceptación funcional sin la nueva prueba humana.

Assessment nativo committed-only desde b622043: medium/executable_change, 16 paths y 228 líneas acumuladas, review_due=false/under_budget. No revisión externa ni consentimiento nuevo requerido; slice continúa pendiente y modo RDD intacto. Engram no disponible: espejo completo sigue pendiente. Próximo paso: cargar la versión local y comprobar el primer mensaje tras inactividad y tras reset, con turnos reales de prueba; producción requiere la publicación que autorice el usuario.
