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
- [ ] R1 — Recuperación acotada de redacción, pruebas y commit. Ruta delegated direct: mapeo de 4+ archivos/preparación y writer por fuente + suite no triviales. RED antes de fuente, GREEN y regresiones; padre verifica y registra commit.
- [ ] R2 — Verificar paquete exacto y activar corrección en Barberdemo. Ruta delegated preparation por empaquetado/4+ evidencias; padre opera sólo procesos propios/configuración autorizada. Idle e identidad frescos, snapshot exacto, conservar túnel/callback vivo, comprobar arranque y conectividad. Commit documental de resultado.

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
