# Contenido conversacional y regreso natural al local

## Objetivo y autorización
2026-11-03: usuario autoriza implementar respuesta libre para charla, creatividad y conocimiento general, separada de datos/acciones del negocio. Aclara que siempre debe cerrar con una invitación contextual a ayudar o reservar, redactada por la IA sin frase fija. Con borrador, retomar el dato pendiente conservando el estado. No tratar el contenido libre como consentimiento ni autoridad comercial.

Base funcional c169464 en codex/barber-initial-intent-recovery, con arreglos conversacionales locales anteriores preservados. Continuación directa conforme a la autorización del usuario de seguir sin el ejecutor delegado, que agotó cupo; no reintentar ese recurso ni cambiar límites. Mapa del padre en contrato de respuesta, admisión semántica y orquestación existentes. No fuente escrita antes de este documento. Engram no disponible: espejo odd/barber-free-conversation/tasks pendiente.

## Evidencia y alcance
firstReply sólo ofrece encuadre de 180 caracteres sin saltos de línea y facts controlados por servidor; instrucciones encauzan pedidos ajenos al local. La suma tiene parseIncidentalArithmetic específico. Añadir cuerpo conversacional tipado y acotado, sin listas de pedidos/frases. Reutilizar primera interpretación y composición existentes, sin nuevo modelo, búsqueda ni llamada dedicada. La IA clasifica el pedido y escribe contenido y regreso; programa comprueba scope, formato y ausencia de afirmaciones/efectos comerciales.

No modificar funciones que reservan, cancelan o reprograman. Primera versión habilitada para conversación independiente y borradores ordinarios; las gestiones, reservas con capacidad financiera/presentación activa y derivaciones protegidas conservan sus rutas existentes. Mensajes combinados con operaciones/datos del local conservan su vía funcional. El contenido libre no consume elecciones, no selecciona opciones y no confirma. Mantener calculador y explicaciones orientativas del catálogo.

## Tareas
- [ ] F1 — Contrato de contenido y cierre IA separados de hechos del negocio; límites/validación y compatibilidad con drafts anteriores. Ruta inline autorizada por excepción de delegación vigente; campos compartidos de schema, sin control léxico de la intención del cliente. Evidencia/commit pendientes.
- [ ] F2 — Admisión semántica y composición de conversación independiente; preservar datos/pregunta/opciones del borrador y capacidades operativas. Ruta inline autorizada, misma unidad coherente con F1. Usar respuesta inicial y presupuesto existente; no llamada/modelo adicional. Evidencia/commit pendientes.
- [ ] F3 — Revisión estática y registro; guardar unidad local y evaluar RDD. Ruta inline autorizada. Sintaxis/UTF-8, diff, autoridad y continuidad; sin ejecución de flujo. Evidencia/commit pendientes.

## Comprobaciones y entrega
TDD STRICT heredado, ejecución de suites/flujos/tipos/build omitida por instrucción explícita del usuario. Runner requerido antes de cada commit: npm run test:text-encoding (tsx scripts/text-encoding-contract-test.ts). Sólo parseo TypeScript sin ejecución, UTF-8 estricto, git diff --check y revisión de guards/contratos. No pruebas IA/DB, servidor, mensajes ni reservas. Calidad real y regresiones funcionales pendientes de la prueba humana; no inventar RED/GREEN.

Forecast orientativo 160–280 líneas authored, no cap ni motivo para fragmentar artificialmente. Feature-branch-chain ya elegida; sin PR/push en esta fase. RDD ON global conservado y frontera pendiente 9d5c01b (slice anterior 388 líneas), sin reiniciar contador por cambiar documento. Assessment committed-only al cerrar y preflight si review_due; revisión externa sólo bajo consentimiento del candidato.

## Progreso
Documento creado antes de fuentes. Siguiente: cuerpo conversacional acotado y pregunta final IA validada, con hechos y acciones del negocio intactos. Si una pregunta de regreso no es utilizable, conservar el contenido validado y la continuación segura existente.

F1/F2 implementados en cuatro fuentes compartidas: acto conversation/social validado sin operaciones, contenido conversationalAnswer separado de hechos y returnQuestion redactada por IA. Cuerpo generado de hasta 1.600 caracteres con saltos de línea; invitación única de hasta 240 caracteres, sin plantilla. Para cálculo ya verificado body server exige text null y conserva el hecho calculation; sólo el regreso es generado. Legacy drafts sin el nuevo campo siguen siendo válidos cuando no se concede ese permiso.

Permiso final exige intención other, admisión semántica actual, plan vacío, sin targets informativos/comandos ni agenda consultada, y estado exactamente igual antes de redactar la invitación. No se habilita en propuestas, señas/recibos, gestión propia, referencias/ambigüedades protegidas, presupuestos o derivaciones. Mensajes con información/acciones del negocio conservan sus contratos previos. Se reutiliza el camino social no operativo del motor; sus escritores, reglas de agenda y confirmaciones no se modifican.

La invitación retoma el dato pendiente o ayuda/reserva cuando no hay borrador. Se registra su pregunta real conservando rol, opciones, target y contexto, sin otorgar consentimiento. Contenido válido sobrevive a encuadre o invitación descartados; CTA insegura usa el next de respaldo, no una promesa operativa. Scope ausente, mezcla de catálogo/acciones, afirmaciones materiales locales y membresía/orden de hechos conservan validadores. Sin cuerpo útil no se considera suficiente el Claro; se puede usar la composición existente, máximo dos llamadas en esta ruta, sin tercer intento ni nuevo modelo.

Verificación estática inicial: sintaxis TypeScript/UTF-8 de las cuatro fuentes y documento PASS; git diff --check y npm run test:text-encoding PASS. Lectura de schema compartido usado por ambos proveedores, continuidad/autoridad y contadores. Sin aplicación, IA/DB, flujo, suites, tipos, build, reinicio ni publicación. Calidad del contenido y del regreso pendiente de prueba humana. Espejo Engram pendiente. Falta commit y assessment nativo del slice acumulado.
