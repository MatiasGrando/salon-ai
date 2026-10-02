# Extracción de conversaciones Glow Booking v2

## Objetivo y autorización
Extraer de Supabase las conversaciones históricas de Glow Cañitas (WX-NPP7HE) y Peluquería Glow (WX-QG5FQA) del período Booking v2 previo al bot de opciones, para pruebas locales. El usuario autorizó la extracción y confirmó utilizar la conexión habitual de salon-ai. Proyecto autorizado: dvnllpvdpvdvdheafyau; conexión DATABASE_URL del .env del proyecto, verificada sin exponer secretos.

## Problema, alcance y restricciones
Identificar el período histórico con evidencia, conservar orden y contexto de mensajes, entregar datos locales con reemplazo de identificadores personales. No cambiar la DB ni el bot; no ejecutar QA que cree conversaciones, envíe mensajes o llame modelos; no subir datos a terceros. Los datos se guardan fuera del repositorio en el directorio de artefactos autorizado de este chat. El estado Booking v2 actual se limpia al activar opciones y no basta para clasificar el historial. No inferir etiquetas de motor inexistentes.

## Ruta y configuración
- Ruta delegada: lectura preparatoria y mapeo de más de cuatro archivos delegados a conversation_export_mapping; extracción y validación se delegarán como unidad acotada.
- Ejecución local ordinaria y navegador: fallan al iniciar; lecturas locales fuera del entorno restringido autorizadas y observadas.
- TDD: no aplica al cambio de comportamiento porque se extraen datos sin modificar código de producto. No se cambia la configuración TDD del proyecto. Verificación funcional sobre integridad, filtros, conteos y reemplazo de identificadores.
- Runner de codificación obligatorio antes de cada commit: npm run test:text-encoding.
- RDD: on, fuente global (status observado). Candidatos limitados a commits de este documento; no incluir trabajo ajeno.
- Rama existente: codex/new-bot-multivertical, con modificaciones ajenas que se preservan. Límite inicial: 4ef50fbb4188bc5c1eafe3027fc50ee295a33f90.
- Entrega: ask-on-risk, pronóstico inferior a 200 líneas autoradas de documentación; no push, PR ni merge autorizados.
- Engram: herramientas no disponibles en esta sesión. Espejo odd/glow-booking-v2-conversation-export/tasks PENDIENTE; conservar documento completo local.

## Tareas y aceptación
- [x] GLOW-01 — Verificar tenants, rango de mensajes y transición histórica al motor de opciones mediante SELECT en transacción READ ONLY. Ruta delegada (mapeo y preparación). Evidencia: tablas Business, Conversation, Message, BotDeploymentAudit, BusinessBotConfiguration; conexión verificada localmente. Registrar fechas, conteos y cualquier límite de atribución a Booking v2. Commit de unidad: pendiente.
- [ ] GLOW-02 — Extraer los intervalos comprobados y entregar corpus para pruebas con conversaciones completas, mensajes cronológicos, identificadores reemplazados y manifiesto verificable. Ruta delegada (preparación y ejecución acotada). Verificar aislamiento de ambos tenants, límite temporal, conteos, unicidad, orden, pares inbound/outbound y reemplazo de PII reconocible; declarar cualquier conversación incompleta o clasificación histórica no demostrable. Commit de unidad: pendiente.

## Progreso y evidencia
Mapeo local observado: public.Business.customerCode identifica tenants; Conversation contiene businessId; Message guarda direction/body/metadata/createdAt. BotDeploymentAudit registra cambios de motor. No exportador dedicado encontrado. scripts/reproduce-glow-conversations.ts es mutante y queda excluido. La conexión y las consultas remotas de solo lectura fueron verificadas; ver evidencia GLOW-01.

## Siguiente paso
Extraer la cohorte con evidencia positiva V2, validar los archivos locales y registrar los conteos y límites de atribución.
### GLOW-01: verificación observada
Conexión remota de sólo lectura exitosa con transacciones READ ONLY y timeout; sin modificación de la DB. Tenant WX-NPP7HE: cmt7sz93r004n2yl7vy1kk862; WX-QG5FQA: cmrw86lgr00042xob5k2pm1k5 (nombre de DB Glow Urquiza). Cortes conservadores por DISPATCH_PAUSED: Cañitas 2026-09-03T01:18:06.522Z (AR 02/09 22:18:06); Glow 2026-09-02T16:28:39.631Z (AR 02/09 13:28:39). ACTIVATE ocurrió luego; no mensajes entre pausa y activación. Cañitas registra replay de transición; queda excluido con el corte por pausa.
Antes de pausa: Cañitas 93 conversaciones / 1877 mensajes; Glow 60 / 3459. Estos son candidatos históricos, no todos demostrados Booking v2. AiUsageEvent.source en booking_choice, booking_estimate_option, booking_estimate_decision y booking_service_validation demuestra uso V2 por conversación. booking_choice aparece en 49 y 40 conversaciones respectivamente; unión final pendiente de exportación. No hay fecha global histórica de habilitación V2 ni vínculo a Message.id.
Criterio de extracción: sólo cohorte con al menos un evento específico V2 anterior al corte; historial de esa conversación anterior al corte, con contexto anterior al primer evento identificado explícitamente. No afirmar atribución individual del motor ni tratar las respuestas reales como resultados correctos de prueba. Excluir metadatos del proveedor y mantener sólo claves operativas necesarias; etiquetar respuestas manuales conocidas. No aparecieron prefijos artificiales comprobados del reproductor.
Aceptación GLOW-02 precisada: verificar filtros, unicidad y orden, contar INBOUND/OUTBOUND sin exigir alternancia ni inventar respuestas ausentes; señalar conversaciones que carezcan de alguna dirección. Reemplazar teléfonos, emails, enlaces e identificadores y nombres registrados; el texto libre requiere revisión humana antes de compartir o tomarlo como verdad esperada.
Documentación Supabase y pautas Postgres leídas; índice público de cambios consultado. No se crean índices, grants ni políticas. Espejo Engram continúa pendiente.