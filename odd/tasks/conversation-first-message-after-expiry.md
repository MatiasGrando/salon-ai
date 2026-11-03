# Primer mensaje conversacional tras vencer el contexto

## Objetivo y autorización
2026-11-03: el usuario autoriza corregir el reinicio por inactividad que consume el nuevo pedido antes de la IA. También solicita revisar el primer contacto sin historial y el mensaje posterior a /reset. La interpretación y redacción siguen a cargo de la IA; no iniciar una reserva porque el contexto terminó. No desplegar, reiniciar servidor ni alterar datos de producción.

## Problema y evidencia
Con varios días de inactividad, «hola quiero cancelar mi turno» recibió «Hola. Empecemos de nuevo. ¿Qué servicio necesitás?». El código vence a las 24 horas, reinicia BotSession, persiste un saludo, marca el evento PROCESSED y retorna EXPIRED antes de clasificación. El texto nuevo no se interpreta. Este camino no había cambiado respecto de origin/main almacenado localmente (9d5c01b); no se consultó producción ni se verificó su commit desplegado.

Base local 459a9d4 en codex/barber-initial-intent-recovery. Los cambios conversacionales y visuales anteriores se conservan. Trabajo local autorizado; sin acceso remoto, consultas reales, cancelaciones ni reprogramaciones.

## Alcance y restricciones
Para texto nuevo del canal conversacional habilitado y con política vigente verificada, limpiar el borrador vencido y continuar procesando el mismo evento sobre el estado actualizado. No interpretar un botón antiguo como texto nuevo ni reproducir su acción tras el reset. Conservar comportamiento de menú legacy, invalidación de prompts, auditoría, límites de tenant/deployment/generation, revisiones, espera de trabajos/envíos en curso y protecciones financieras/handoff. No cambiar el plazo de 24 horas ni el significado de /reset. Número nuevo y mensaje posterior al reset deben conservar su texto y recorrido normal; investigar antes de modificar esos caminos.

## Tareas
- [ ] C1 — Transición de expiración que continúa con texto nuevo: señal explícita y acotada desde llamadores, política conversacional vigente, reset seguro sin saludo ni consumo anticipado del evento. Ruta delegated direct: mapa de cuatro o más fuentes y escritor acotado obligatorio. Criterios: texto se entrega una vez al flujo normal, botones viejos no se ejecutan, entidades financieras y confirmadas intactas.
- [ ] C2 — Auditar primer contacto y post-/reset, alinear documentación y regresiones existentes del alcance C1, comprobar sintaxis/codificación/diff y guardar evidencia de commits y revisión. Ruta delegated direct para lectura preparatoria, controles y ajustes de las pruebas; cierre documental mecánico del padre. Informar límites de lo observado y prueba humana pendiente.

## Verificación y entrega
TDD STRICT heredado; por instrucciones persistentes del usuario no ejecutar suites/flujos, pruebas con IA/DB, tipos ni build. No inventar RED/GREEN. Se permite actualizar regresiones existentes relevantes sin ejecutarlas; registrar esa limitación. Comprobaciones observables: parseo sintáctico TypeScript sin importar la aplicación, UTF-8, git diff --check y npm run test:text-encoding obligatorio antes de cada commit. Runner funcional existente para referencia: npm run test:bot-options-context-window; no ejecutarlo sin nueva autorización que revoque la restricción anterior.

Forecast 150–280 líneas authored, heurístico y no límite. Entrega local ask-on-risk, feature-branch-chain ya elegida en la sesión si hiciera falta; sin PR/push en este trabajo. Modo RDD ON previamente verificado; frontera pendiente b622043 (último slice observado 60 líneas bajo presupuesto). Evaluar committed-only y seguir preflight sólo si corresponde; omisión anterior de revisión no autoriza omitir un candidato nuevo. Espejo Engram odd/conversation-first-message-after-expiry/tasks pendiente porque no hay herramientas mem_context/mem_search/mem_get_observation disponibles.

## Progreso
Exploración read-only delegada de expiración y auditoría independiente de nuevo contacto/post-reset en curso. Documento creado antes de la primera escritura de fuentes. Próximo paso: confirmar estado que consume la IA tras el reset y señal segura de texto, luego implementar C1 conservando fences e idempotencia. Sin fuentes modificadas todavía.

### Hallazgos previos a C1
El estado de la IA vive en BotSession.state.conversationDraft; el reset existente elimina ese sidecar y el lector reconoce el estado inicial. El inbox vuelve a leer/bloquear la sesión tras el fallback de expiración. La invalidación de prompts estaba dentro de persistView: al omitir el saludo debe hacerse explícitamente en la nueva rama y en la misma transacción. Sólo la política conversacional vigente y texto actual sin token interactivo permiten continuar; la señal del llamador por sí sola no otorga autoridad.

### Auditoría C2 de primer contacto y reset
Sin sesión, la ventana retorna CONTINUE y el admission input.initial conserva textBody; el worker crea la sesión y pasa el mismo payload a la IA. No se encontró pérdida determinista equivalente en contacto nuevo. Reset exacto es una barrera de consolidación; la transición system.conversation_restart no se mezcla con conversation.message y el siguiente texto llega a la IA con estado limpio. /reset es un control de Barberdemo; los otros negocios conservan sus comandos de reinicio existentes. Pagos/handoff protegidos pueden rechazar un reset expresamente. La intersección corregida por C1 es que un comando de reset recibido tras vencer la ventana tampoco debe consumirse antes de llegar a su handler. Fuentes de regresión existentes del post-reset reconocen diálogo limpio; no se ejecutaron. Auditoría de código, no validación de chats reales nuevos ni de producción.
