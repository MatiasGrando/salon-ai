# Recuperación de redacción en adquisición parcial

## Objetivo y autorización
2026-10-29: el usuario autorizó corregir primero la regla que limita la redacción observada y avisar al terminar; el análisis conversacional amplio queda para después. Recuperar una respuesta natural cuando la IA entendió nombre/fecha/franja sin servicio y su encuadre fue rechazado por presentación. Mantener hechos y acciones bajo validación del sistema.
Se conserva la autorización de esta sesión para actualizar Barberdemo aislado con su configuración/credenciales guardadas y túnel de WhatsApp. Sin Railway, Fly.io, migraciones, mensajes sintéticos reales, replay de eventos ni otras funciones del bot.

## Evidencia y alcance
Logs reales: name/date/time_preference aceptados, firstReply rechazado identity_in_frame, aiCalls=1 y replyRoute=motor. ai-interpreter excluye partialAcquisition de la composición adicional. No cambiar identity_in_frame ni los controles de datos, catálogo, disponibilidad o consentimiento.
Base exacta del bot activo: 7d54b5753ec9776a2be83bf89e110a73b797acad. Copia de trabajo aislada para preservar el checkout y sus cambios ajenos. Rama codex/barber-reply-recovery.
Cambio mínimo: una composición adicional sólo para adquisición parcial válida cuyo encuadre inicial fue rechazado por identidad/presentación. Reutilizar estado y hechos finales, no reinterpretar ni ejecutar agenda/reservas. Si falla o es insegura, fallback existente.

## Configuración y entrega
TDD STRICT heredado de E2.25 y odd/tasks/barber-followups-2026-10-11.md:43; runner node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts. Skill local salon-ai-bot-qa y sus referencias leídas; preservar datos, confianza y acciones verificadas.
RDD ON, fuente global, confirmado por gentle-ai review mode status con acceso local permitido. Primer límite revisado: base 7d54b5753ec9776a2be83bf89e110a73b797acad; assess committed-only por unidad. No enviar diff a revisión externa sin consentimiento nativo.
Forecast 120–220 líneas authored más documento; estrategia ask-on-risk. No PR/push/merge. Registrar conteo y aplicar estrategia antes de otro commit si supera ~400.
Engram mem_* no disponible (discovery vacío). Mirror odd/barber-partial-reply-recovery/tasks PENDIENTE; locator odd/tasks/barber-partial-reply-recovery.md. Se preserva y se lee esta copia local; no afirmar espejo guardado.

## Tareas
- [x] R1 — Recuperación acotada de redacción, pruebas y commit. Ruta delegated direct: mapeo de 4+ archivos/preparación y writer por fuente + suite no triviales. RED antes de fuente, GREEN y regresiones; padre verifica y registra commit.
- [x] R2 — Verificar paquete exacto y activar corrección en Barberdemo. Ruta delegated preparation por empaquetado/4+ evidencias; padre opera sólo procesos propios/configuración autorizada. Idle e identidad frescos, snapshot exacto, conservar túnel/callback vivo, comprobar arranque y conectividad. Commit documental de resultado.

## Aceptación y comprobaciones
R1: nombre + mañana + alrededor de las 16 sin servicio, con y sin presentación previa. Rechazo identity_in_frame permite exactamente una composición segura: aiCalls=2 y second_call; nombre/fecha/franja conservados; agenda=0, propuesta/reserva ausentes.
Primera redacción válida mantiene una llamada. Precio/catálogo/acciones no sustentadas mantienen rechazo. Recuperación insegura, error o timeout conserva fallback y estado, sin tercera llamada. Fuera de adquisición parcial no habilitar nuevas llamadas.
Checks: first-call-writing, reply-contract, standard-composition y suites de adquisición/contexto pertinentes; TypeScript sin emisión con comparación baseline si hay fallos anteriores; npm run test:text-encoding y git diff --check antes de cada commit.
R2: manifiesto exacto SHA256, dependencias/cliente generado local compatibles, import smoke sin red, procesos/puertos sólo propios, challenge local/público y callback conservado o verificado sólo si cambia. No afirmar prueba conversacional con modelo/WhatsApp hasta mensaje humano.

## Progreso y siguiente paso
Mapeo delegado finalizado. RDD confirmado ON. Copia Git aislada verificada limpia en base exacta; registro de la copia en la interfaz de Codex COMPLETED (operación 5648120f-6e15-492b-a8fe-f864e34b37cc), confirmado por el padre. Uso explícito de la ruta validada; no depender del cambio automático de directorio.
Siguiente: writer lee este documento, añade pruebas y demuestra RED; luego GO de fuente. Mirror pendiente. Ningún código modificado todavía.

## R1 — RED observado, 2026-10-29
Writer delegado leyó este documento y agregó únicamente regresiones en scripts/conversational-bot-first-call-writing-test.ts. Sin modificaciones de fuentes. Runner exacto node node_modules/tsx/dist/cli.mjs scripts/conversational-bot-first-call-writing-test.ts terminó EXIT1: 13 fallos nuevos por compositionCalls=0 frente a 1 esperado, y dos controles de primera redacción válida PASS. La matriz cubre con/sin presentación previa, con/sin nombre y hora exacta/franja alrededor de las 16; estado de fecha/hora/nombre conservado, agenda cero y sin reserva. Cinco negativos adicionales exigen una única composición seguida de fallback seguro para valor/acción/identidad insegura, error o timeout, sin tercera llamada.
Se conserva la prueba de rechazo de identidad y se reemplaza únicamente su antigua expectativa de no recuperación en adquisición parcial; precio/catálogo y acción material inicial siguen sin llamada de reparación.
Baselines observados por el padre antes de fuentes: reply-contract PASS; standard-composition 9 PASS/1 FAIL preexistente en social answer survives prepared neutral acknowledgment, assert80 (/Bien, gracias/ ausente en reconocimiento de nombre y presupuesto). Assertion intacta, fuera del alcance; no se afirma suite global limpia.
Siguiente: esperar GO del padre para modificar exclusivamente ai-interpreter.ts; R1 sigue abierto y sin commit. Engram mirror pendiente.

## R1 — GREEN observado y fuentes congeladas, 2026-10-29
GO de fuente recibido del padre después de revisar RED. Cambio único de producción en src/conversational-bot/ai-interpreter.ts: partialFrameRecovery permite una composición adicional sólo para adquisición parcial y primer encuadre rechazado identity_in_frame. Se conservan !reason, !canonicalOnly, validador original, hechos/contrato finales, plazo y fallback existentes. No se repite interpretación, agenda ni acciones.
Writer ejecutó con DOTENV_CONFIG_PATH=.env-unused y DATABASE_URL ficticia: first-call-writing EXIT0 (15 regresiones nuevas PASS: matriz8, primera redacción válida2, fallback seguro5); reply-contract EXIT0; dialogue-context EXIT0. standard-composition EXIT1, exactamente 9 PASS/1 FAIL en assert80, mismo caso de reconocimiento neutral preexistente documentado antes de fuente; assertion y archivo intactos. No se afirma suite global limpia, modelo real, TypeScript global ni WhatsApp.
Fuentes congeladas para verificación del padre: ai-interpreter.ts, first-call-writing-test.ts y este documento. R1 sigue abierto hasta commit observado; TypeScript comparado, codificación/diff y controles nativos corresponden al cierre del padre. R2 y activación no ejecutadas por writer. Engram mirror pendiente.

## R1 — Verificación independiente del padre
First-call-writing repetido por el padre: 15 regresiones nuevas PASS, EXIT0. UTF-8 oficial y git diff --check PASS; sólo ai-interpreter, su suite y este documento en alcance. TypeScript comparado contra base exacta está en curso (sesión 47727); R1 permanece abierto hasta observar ese resultado y registrar el commit. No hay prueba con modelo real ni cambios de runtime todavía.

## R1 — Cierre verificado
Commit 057fb37bc09de43eb62f5bdf73bf0b0dbe120e1f (fix(bot): recover rejected partial booking replies): 3 archivos, 141 inserciones + 5 borrados = 146 líneas authored. Codificación y diff staged PASS antes del commit. TypeScript comparado de los dos roots y sus 780 dependencias: 43 diagnósticos baseline y 43 actuales, cero nuevos y cero propios; comprobación semántica enfocada adicional 0/0. Sin emisión de archivos. First-call-writing del padre PASS15; reply-contract y dialogue-context PASS del writer. standard-composition conserva exactamente baseline9PASS/1FAIL, fuera de alcance.
RDD assess committed-only desde7d54 observado: medium/executable_change, 3paths146lines, review_due=false, reason=under_budget. No revisión externa ni recibo; frontera7d54 permanece pendiente para el slice. R1 cerrado con evidencia; R2 todavía abierto. Engram mirror pendiente.
Preparación R2: primer archive detectó conversión CRLF frente a blobs Git y fue rechazado antes de activar; se regenera con core.autocrlf=false/core.eol=lf. Fuente y servidor activo intactos durante preparación. Próximo: paquete exacto PASS, idle fresco y actualización sólo de Barberdemo.

## R2 — Entrega verificada, 2026-10-29
Paquete canónico tmp/barber-reply-recovery-057fb37-1793290018673: 1474 archivos comprometidos verificados contra blobs Git y 137 generados iguales al activo; total1611 exactos. ZIP SHA256 DD5FCD74D0525C24C7C2F41AE8448AB8434AED2DDD57194A2B7E0D01E224C19A; prueba tmp/barber-reply-recovery-057fb37-1793290018673-preparation.json, respecto a la raíz original C:/Users/cpu/salon-ai. Schema, package.json y lock idénticos al activo anterior. Import smoke PASS con networkAttempts0/startInvokedfalse; primer smoke45s agotado y repetición aislada PASS. Primer ZIP con conversión CRLF rechazado y reemplazado por archivo canónico, no activado.
Preflight real scoped del padre: dos snapshots estables jobs/dispatch/outbox/inbox0, policy/credentialsReady; POISON histórico1 preservado, sin replay ni modificaciones manuales de datos. Primer control de carga60s agotado; rollback anterior7d54 se comprobó después realmente ready con dos puertos y stderr0. Se repitió arranque con margen mayor sin cambiar guardas del bot.
Versión057fb37bc09de43eb62f5bdf73bf0b0dbe120e1f activa: launcher1372 y worker12496, identidades y source exactas verificadas por padre y worker independiente. Puertos3311/3312 sólo127.0.0.1/12496, marcador ready y stderr0; CRMlocal404. Túnel20568 y callbackclarke-computers-musician-detection.trycloudflare.com conservados. Challenge local y público HTTP200 exacto y CRM404 verificados por padre; ninguna escritura Meta ni nuevo túnel.
State y prepared habituales de Barberdemo apuntan ambos a057 y al mismo snapshot, worker12496; ambos escritos y releídos para que próximos reinicios conserven el arreglo. Respaldos de state/prepared anteriores preservados en tmp original. Sin Railway/Fly, migraciones, nuevas evaluaciones IA, mensajes sintéticos, reservas/pagos manuales ni recuperación de eventos.
R2 resultado observado y commit documental siguiente. Prueba humana del mismo mensaje WhatsApp pendiente; no se afirma calidad universal del modelo. RDD del nuevo commit se registra después de observarlo. Mirror Engram sigue pendiente por herramientas ausentes. Próximo paso: usuario prueba el pedido sin servicio y luego decide el análisis conversacional amplio.

R2 work-unit documental observado: 5f09e6572de19b8a40814215313bed8451071f28 (docs(bot): record verified Barber reply rollout), codificación y diff staged PASS. Conteo acumulado por commits: 146 + 16 = 162 líneas authored; diff neto base/HEAD158. Assessment committed-only del cierre observado EXIT0: medium, 3 paths158 líneas, review_due=false/under_budget. Frontera7d54 pendiente del slice; no revisión externa ni recibo. Fuente activa permanece057fb37, sin cambios funcionales en este commit documental. Mirror Engram pendiente.
