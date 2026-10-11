# Seguimientos de Barber Demo — 11/10/2026

## Objetivo y autorización
El usuario autorizó implementar cuatro correcciones locales: información contextual sobre Raíces/canas, reprogramación de turno confirmado, prioridad multiservicio y cancelación mediante derivación directa al equipo. Raíces es la prioridad. No se autorizó usar base real, IA externa, WhatsApp, Meta, Railway ni desplegar. El árbol inicial contiene cambios y temporales ajenos que se preservan.

## Evidencia y alcance
### B1 — Consultas informativas sobre servicios
El diálogo aportado muestra que el bot publicó para Raíces «Ayuda a tapar las canas con productos A11Lux», pero luego no pudo responder si ayudaría con las canas, citó el mensaje completo del cliente como «procedimiento» desconocido y volvió a ofrecer Raíces. La IA debe conservar el referente, interpretar la pregunta y redactar. Cuando el cliente pide entender un servicio o procedimiento (qué es, para qué sirve, diferencias o si puede ayudar con un objetivo), debe dar explicación general **marcada como orientativa** y, separado de ella, la descripción, precio y duración **publicados por el local**. No añadir explicación larga a saludo, selección, precio simple o reserva. No prometer resultado individual, inventar técnica del negocio, agregar al carrito ni forzar elección por una consulta.

Mapa read-only previo: la utilidad/beneficio no entra consistentemente en lectura informativa; puede convertirse en `service_request`, cuya respuesta cita el texto completo. `overview` reúne descripción/precio/duración, pero `catalog-information-answer.ts` actualmente excluye explicación general de `overview`. La ruta informativa necesita unir ambos con atribución y validación de evidencia. La frase observada coincide con una plantilla del motor, pero no se leyó el diagnóstico del nuevo turno: registrar `copyMode`, `deliveryOrigin`, `replyValidation` y ruta de interpretación en pruebas antes de afirmar su origen. El motor debe validar hechos/efectos, no reemplazar una consulta entendida por repregunta genérica. Si IA falla, no cambiar la intención a «procedimiento desconocido» ni inventar datos.

### B2 — Reprogramar confirmado
«Tenía un turno el martes; quería reprogramarlo» recibió «Mantengo los datos del pedido...»; «la fecha» obtuvo una pregunta genérica. Reconocer la intención y el turno confirmado, pedir sólo lo faltante y reprogramar de forma segura, sin confundirlo con edición de borrador. Decisión expresa del usuario: también si la seña ya fue aprobada, reusar el circuito existente para cambiar fecha/hora y profesional sólo si el cliente lo solicita; conservar la seña y confirmar el cambio completo de forma atómica, sin volver a cobrarla.

### B3 — Prioridad multiservicio
Iluminación y Corte Hombre se planificaron sin respetar la prioridad configurada en cada servicio. Verificar y aplicar ese dato sin romper disponibilidad, profesionales distintos, confirmación conjunta ni seña.

### B4 — Cancelar confirmado
El usuario aclaró que, cuando el cliente quiera cancelar, **se deriva directamente al equipo** con el contexto del turno. No cancelar automáticamente, borrar turnos ni modificar señas.

## Tareas
- [x] B1 — TDD RED/GREEN para consulta informativa contextual y redacción IA grounded; negativos de catálogo cambiado, técnica no publicada, ambigüedad, carrito/reserva. Ruta delegated direct: mapa 4+ archivos y 2+ fuentes no triviales. Cambio local verificado; commit/evaluación nativa en cierre.
- [ ] B2 — TDD y corrección de reprogramación confirmada, con seguridad y continuidad. Ruta delegated direct por mapa 4+ y 2+ fuentes previstas. Commit propio.
- [ ] B3 — TDD y prioridad de servicios en plan/confirmación, sin alterar seña ni profesionales. Ruta delegated direct por mapa 4+ y 2+ fuentes previstas. Commit propio.
- [ ] B4 — TDD y derivación directa al cancelar, sin efecto financiero ni cancelación automática. Ruta delegated direct por mapa 4+ y 2+ fuentes previstas. Commit propio.
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
