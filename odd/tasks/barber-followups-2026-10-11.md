# Seguimientos de Barber Demo — 11/10/2026

## Objetivo y autorización
El usuario autorizó implementar cuatro correcciones locales: información contextual sobre Raíces/canas, reprogramación de turno confirmado, prioridad multiservicio y cancelación mediante derivación directa al equipo. Raíces es la prioridad. No se autorizó usar base real, IA externa, WhatsApp, Meta, Railway ni desplegar. El árbol inicial contiene cambios y temporales ajenos que se preservan.

## Evidencia y alcance
### B1 — Consultas informativas sobre servicios
El diálogo aportado muestra que el bot publicó para Raíces «Ayuda a tapar las canas con productos A11Lux», pero luego no pudo responder si ayudaría con las canas, citó el mensaje completo del cliente como «procedimiento» desconocido y volvió a ofrecer Raíces. La IA debe conservar el referente, interpretar la pregunta y redactar. Cuando el cliente pide entender un servicio o procedimiento (qué es, para qué sirve, diferencias o si puede ayudar con un objetivo), debe dar explicación general **marcada como orientativa** y, separado de ella, la descripción, precio y duración **publicados por el local**. No añadir explicación larga a saludo, selección, precio simple o reserva. No prometer resultado individual, inventar técnica del negocio, agregar al carrito ni forzar elección por una consulta.

Mapa read-only previo: la utilidad/beneficio no entra consistentemente en lectura informativa; puede convertirse en `service_request`, cuya respuesta cita el texto completo. `overview` reúne descripción/precio/duración, pero `catalog-information-answer.ts` actualmente excluye explicación general de `overview`. La ruta informativa necesita unir ambos con atribución y validación de evidencia. La frase observada coincide con una plantilla del motor, pero no se leyó el diagnóstico del nuevo turno: registrar `copyMode`, `deliveryOrigin`, `replyValidation` y ruta de interpretación en pruebas antes de afirmar su origen. El motor debe validar hechos/efectos, no reemplazar una consulta entendida por repregunta genérica. Si IA falla, no cambiar la intención a «procedimiento desconocido» ni inventar datos.

### B2 — Reprogramar confirmado
«Tenía un turno el martes; quería reprogramarlo» recibió «Mantengo los datos del pedido...»; «la fecha» obtuvo una pregunta genérica. Reconocer la intención y el turno confirmado, pedir sólo lo faltante y reprogramar de forma segura, sin confundirlo con edición de borrador. Decisión expresa del usuario: también si la seña ya fue aprobada, reusar el circuito existente para cambiar **sólo fecha/hora y profesional si el cliente lo solicita**, con disponibilidad verificada y cambio completo atómico. La seña, comprobante, importe, pago registrado y servicios no se eliminan ni modifican ni se vuelven a cobrar; cancelación/devolución financiera exclusivamente desde Caja.

### B3 — Prioridad multiservicio
Iluminación y Corte Hombre se planificaron sin respetar la prioridad configurada en cada servicio. Verificar y aplicar ese dato sin romper disponibilidad, profesionales distintos, confirmación conjunta ni seña.

### B4 — Cancelar confirmado
El usuario aclaró que, cuando el cliente quiera cancelar, **se deriva directamente al equipo** con el contexto del turno. No cancelar automáticamente, borrar turnos ni modificar señas.

## Tareas
- [x] B1 — TDD RED/GREEN para consulta informativa contextual y redacción IA grounded; negativos de catálogo cambiado, técnica no publicada, ambigüedad, carrito/reserva. Ruta delegated direct: mapa 4+ archivos y 2+ fuentes no triviales. Cambio local verificado; commit/evaluación nativa en cierre.
- [ ] B2 — TDD y corrección de reprogramación confirmada, con seguridad y continuidad. Ruta delegated direct por mapa 4+ y 2+ fuentes previstas. Commit propio.
- [x] B3 — TDD y prioridad de servicios en plan/confirmación, sin alterar seña ni profesionales. Ruta delegated direct por mapa 4+ y 2+ fuentes. Cambio local verificado; commit/evaluación nativa en cierre.
- [x] B4 — TDD y derivación directa al cancelar, sin efecto financiero ni cancelación automática. Ruta delegated direct por mapa 4+ y 2+ fuentes. Pruebas focalizadas/PGlite ejecutadas; falta SQL integral APPROVED multiservicio. Commit propio.
- [ ] B5 — Suites pertinentes, `npm run test:text-encoding`, diff, evaluación/revisión nativa por work-unit commit; registrar fallos, pendientes y omisiones. No activación remota sin autorización separada.

## Configuración y entrega
TDD STRICT heredado E2.25 de `odd/tasks/nuevo-bot-reservas.md`; runner `node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts`. Rama `codex/new-bot-multivertical`. Forecast orientativo 600–1000 líneas authored para cuatro unidades, no cap. Estrategia `single-pr` elegida por el usuario: conservar los work-unit commits en la rama actual y decidir la publicación al final; sin PR, push ni merge autorizados ahora. RDD ON por preferencia global; evaluar cada work-unit commit y seguir preflight/consentimiento aplicable sin heredar omisiones anteriores. Engram mem_* no está expuesto; espejo `odd/barber-followups-2026-10-11/tasks` pendiente.

## Progreso
Documento local creado antes de fuentes. Mapa read-only B1 terminado; mapas B2/B4 y B3 en curso. No hay implementación de estas cuatro unidades todavía. Próximo: B1 RED antes de tocar fuentes.



## Mapeo read-only antes de implementación
B2/B4: el detector de reprogramación exige «reprogramar» antes de «turno» y no capta «reprogramarlo», así que ni carga el turno confirmado. El grupo transaccional existente rechaza depósito y conserva profesionales; la reprogramación individual con depósito aprobado exige precio fijo, incompatible con Iluminación estimada. La prueba de autoridad del turno vincula el profesional original. Quitar sólo el bloqueo de depósito sería inseguro: la solución completa debe conservar seña, consentimiento, oferta/replay, transacción y posibilidad de cambiar profesional únicamente por pedido expreso. La derivación actual rechaza `BOOKING_CONFIRMED`; B4 necesita una ruta para encolar cancelación al equipo sin mutar turno ni seña.

B3: `Service.bookingOrderPriority` existe y el motor legado lo usa, pero el catálogo/proyección del bot nuevo no lo transporta y la cesta se coordina en orden de ingreso. Llevar prioridad vigente al catálogo, ordenar estable antes de buscar horarios y volver a cotizar si cambia la prioridad; empate mantiene orden del cliente y reservas confirmadas no se reordenan. Las ofertas/confirmación deben usar el mismo orden validado.

Los mapas no consultaron datos reales ni modificaron archivos. B2 tiene alcance transaccional mayor al supuesto inicial; no se declarará completado con un arreglo de detección de frases o quitando guardas financieras.

## B1 — Evidencia de cierre funcional local
TDD STRICT: antes de fuentes, suite catálogo 38 PASS/2 FAIL nuevos (`overview` rechazaba general); después de fuentes 40/40 PASS, confirmado de nuevo por el padre. Caso integrado con propuestas IA controladas: menú Color Completo/Raíces, selección sólo informativa, tres seguimientos sobre canas, `replyRoute=first_call` y `copyMode=ai`, descripción/precio/duración vigentes, sin cesta/reserva. Catálogo cambiado y beneficios inventados no adquieren hechos. Otras suites pasaron: explanatory-plan 19/19, informational-followup 27/27, information, reply-contract y service-request. `npm run test:text-encoding` y `git diff --check` pasan. No se probó con modelo real ni WhatsApp: la calidad de interpretación libre sigue pendiente de validación. `information-focus-test.ts:74` falla en ruta de precio ajena a B1; baseline aislado no corrido. TypeScript global agotó heap de 2 GB; no se afirma typecheck completo.

## B1 — Commit y control nativo
Work-unit commit `ff82db4` (`fix(bot): preserve AI-led service guidance`), cuatro archivos/125 inserciones y cuatro borrados incluido este documento. Evaluación inicial `gentle-ai review assess` no pudo clasificar por temporales sin declaración; se trató como due, nunca como bajo riesgo. Preflight STATUS con exclusión explícita de temporales identificó candidato sólo con esos cuatro archivos. `review start` fue rechazado por el control de seguridad porque podría compartir el diff con Gentle AI. El usuario eligió omitir **sólo esta revisión**. No se ejecutó revisor ni se obtuvo recibo nativo de omisión; se continúa bajo controles ordinarios, sin fingir aprobación. Frontera nativa pendiente. No hay despliegue ni prueba IA real.

## B3 — Evidencia de cierre funcional local
TDD STRICT: RED antes de fuentes en basket-port (prioridad 10 seguía detrás de 30) y runtime-presentation (confirmación con orden obsoleto); GREEN posterior. Se transporta `bookingOrderPriority` desde el catálogo a la proyección del diálogo, se ordena la cesta resuelta de forma estable antes de disponibilidad, y una opción/propuesta obsoleta por cambio de prioridad debe volver a cotizarse. Empate conserva el orden elegido por el cliente; coordinación con profesionales distintos y seña conjunta permanecen verificadas. Padre revisó diff y ejecutó independientemente basket-port, runtime-presentation, runtime-booking, `npm run test:text-encoding` y `git diff --check`: PASS. Delegado verificó basket-port-pglite y choice-contract: PASS. Fallos observados fuera del bloque: sandbox-booking prueba de afirmación de un solo servicio con fallback IA; sandbox-adapter fixture PGlite carece de tabla `BookingVisit`. No se modificaron esas pruebas ni se afirma suite global limpia. Sin DB real, WhatsApp ni despliegue.

## B3 — Commit y revisión nativa
Work-unit commit `eef96b2` (`fix(bot): respect service booking priority`), once archivos/87 inserciones y seis borrados. Evaluación local con `gentle-ai review assess` desde la frontera nativa aún pendiente de B1: riesgo medium, 14 archivos/220 líneas acumuladas, `review_due=false` por `under_budget`; no se inició revisión ni se solicitó consentimiento para B3. La omisión humana de B1 no se extiende automáticamente a este bloque. No hay activación remota.

## B4 — Evidencia de cierre funcional local
TDD STRICT: RED observado en la ruta antigua que proponía cancelar desde el chat; GREEN en `conversational-bot-confirmed-cancel-handoff-test.ts`. La solicitud de cancelación del cliente, incluso con seña APPROVED, se convierte en derivación al equipo con identificadores del grupo/turnos y prueba de sesión; se revalida el estado dentro de la transacción. El texto aclara que el turno sigue vigente. Nunca se emite un comando automático de cancelación ni se cambia pago o reserva. El padre ejecutó independientemente el test focalizado, `conversational-bot-runtime-management-test.ts`, `conversational-bot-handoff-sql-test.ts` (29 PASS), `npm run test:text-encoding` y `git diff --check`: PASS. La prueba SQL integral de grupo multiservicio con seña APPROVED y cola real queda pendiente: el fixture actual de handoff usa un adaptador controlado y ampliar el financiero sería un trabajo separado. Sin IA real, DB real, WhatsApp ni despliegue.
