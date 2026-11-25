# Diagnóstico de interpretación de Instagram

El usuario autorizó preparar localmente el diagnóstico faltante de Instagram, reutilizando el existente de WhatsApp. No cambiar interpretación, validadores, reservas ni envío. Sin publicación ni despliegue; la autorización de Railway anterior era solo lectura de logs. Preservar Productos y Agenda locales.

Base e3c7147; rama codex/instagram-ai-diagnostics. server.ts asigna onDiagnostic solo a WhatsApp y entrega instagramAi separado al procesador. process-inbox-job.ts condiciona los detalles a ese callback. Los logs consultados no permiten atribuir retrospectivamente la causa exacta de Tamara o fecha/hora.

- [x] D1. Observar RED y GREEN al conectar Instagram al registro de diagnósticos resumidos, con canal identificable y sin texto, credenciales ni conversaciones completas; preservar WhatsApp y canal deshabilitado.
- [x] D2. Regresiones focales de diagnóstico y wiring, UTF-8/diff, commit local y evaluación nativa. Publicación y repetición de mensajes quedan pendientes.

Ruta delegated direct por preparación y fuente/prueba no trivial. TDD estricto strict_tdd:true de openspec/config.yaml; runner node node_modules/tsx/dist/cli.mjs scripts/<suite>.ts. RED antes de fuente. Solo pruebas sintéticas offline, sin IA/DB/red ni sesiones reales. Reutilizar payload resumido del procesador, no request/message/state completos.

Entrega ask-on-risk, forecast40–100líneas orientativo;400esheurística no cap. Sin PR ni nueva arquitectura. RDD global ON; omisiones anteriores no cubren este candidato. Assess/STATUS tras work-unit, sin revisor hasta decisión vigente. Engram/mem_* no disponibles: espejo odd/instagram-ai-diagnostics/tasks pendiente. Documento local escrito y leído antes de fuentes.

Exploración acotada completa; siguiente paso: prueba y conexión mínima. No corregir lógica semántica en esta unidad.


## Evidencia de implementación
El escritor delegado observó RED al ejecutar el tramo real de inicialización del servidor mediante AST/VM: callback INSTAGRAM undefined. Tras conectar el callback y añadir channel a ambos diagnósticos, GREEN en las cuatro combinaciones de canales habilitados/deshabilitados. La prueba no arranca aplicación, workers ni DB y usa solo un diagnóstico sintético. El padre inspeccionó la prueba y el diff: cuatro líneas de conexión/etiquetado en server.ts, sin cambios de interpretación, permisos, reservas o envío. git diff --check PASS. Regresiones de diagnóstico y encoding en cierre; commit/evaluación a cargo del padre.


Cierre de checks: wiring GREEN, UTF-8 y diffcheck PASS. Dos regresiones semánticas no pasaron: conversational-bot-diagnostics-test.ts:73 esperaba response_error y recibió null; rejection-diagnostics dio22PASS/2FAIL (motor vs first_call e identity_in_frame). Estas suites no ejecutan server.ts y sus fuentes no se modificaron en esta unidad, pero no se ejecutó un baseline separado: registrar fallos pendientes, no afirmar GREEN global ni atribuirles solución. No se amplió el alcance a interpretación ni se usó IA/red reales. D2 cierra preparación local y registra límites; publicación, reproducción real y revisión nativa según resultado del commit permanecen fuera de esta autorización.


## Cierre tras reanudación
Commit local a6afbf3: 3 archivos,79adiciones/1eliminación. El usuario pidió continuar tras la interrupción del control automático de aprobación por límite de uso; aquella acción no llegó a ejecutarse y no constituyó un rechazo de seguridad. Al reanudar, el árbol rastreado estaba limpio y el commit intacto. STATUS válido e inventario canónico de temporales consultados; assessment de e3c7147..a6afbf3 devolvió medium/executable_change,80líneas, review_due=false con under_budget. No se inició revisión ni se asumió omisión humana. La preparación local está cerrada; queda pendiente publicar exclusivamente este commit y repetir los mensajes para obtener diagnóstico real, con autorización separada del destino/operación/sesión. El límite pendiente de revisión permanece e3c7147 para un eventual slice posterior.

No se corrigieron aún duplicación de opciones ni semántica de Tamara/fecha-hora. Se preservan los fallos de las dos suites semánticas ya declarados, sin afirmar baseline probado. Sin nueva consulta remota, migración, envío, despliegue o cambio de configuración. Agenda/Productos anteriores permanecen locales y no deben publicarse junto a este diagnóstico por accidente. Espejo Engram pendiente por ausencia de herramientas.
