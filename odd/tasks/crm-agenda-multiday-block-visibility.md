# Bloqueos visibles por vista de Agenda

## Objetivo y autorización

El usuario pide que en vistas generales de 3 y 7 días se dibujen solo los bloqueos del local. Los bloqueos personales siguen visibles en la vista diaria, en la columna del profesional. Aplicar la regla por número de días sin excepciones implícitas para filtros o alcance OWN: la petición dice solo local en 3/7 y personales en diaria. Esta es una preferencia de presentación; preservar datos, permisos y restricciones de disponibilidad/creación/arrastre.

Base de esta función 9854c79, rama existente codex/instagram-pantalla-principal. No crear versiones paralelas ni modificar los cambios de Caja o sus documentos pendientes. Sin push, PR ni despliegue solicitado.

## Mapa y ruta

renderAgendaGrid usa renderAgendaMobileThreeDay para todas las pantallas; 3/7 días pasan por renderAgendaMobileDayColumn y 1 día por renderAgendaProfessionalDayColumn. Los renderers legacy no alcanzables no requieren cambios. Mantener filteredAgendaBlocksForRange y state.agendaBlocks intactos; agregar un filtro de presentación en el camino activo de las columnas por día. Contrato existente staff-agenda-own-visibility-test ejecuta funciones reales para vistas 1/3/7 y permisos.

Ruta delegada por preparación/mapeo de módulo, contratos de staff y vistas/arrastre (4+ archivos) y escritura no trivial en módulo y regresión. Forecast 60–110 líneas autoradas. TDD estricto según openspec/config.yaml strict_tdd:true; runner node node_modules/tsx/dist/cli.mjs. RED antes de producto y GREEN antes del commit. Entrega ask-on-risk para este bloque pequeño (sin cadena nueva prevista); respetar la rama de trabajo actual. Evaluar la unidad desde su base 9854c79 sin mezclar el candidato de revisión de Caja que continúa pendiente y no se considera revisado.

- [x] A1. Filtrar solo el render activo para mostrar bloqueos del local en 3/7 y conservar local+profesional en diaria. Probar perfiles administrativos, filtros, OWN, datos originales y filtro base intactos. Ruta delegada por módulo y test; unidad de comportamiento y regresión.
- [x] A2. Ejecutar contratos relacionados y sintaxis/UTF-8, revisar diff, actualizar la misma vista previa local 3000 una sola vez y verificar versión/HTTP. Padre verifica y registra la evidencia/commit de la unidad.

## Aceptación y checks

- En 3 y 7 días no se dibuja ningún bloque con professionalId; sí aparecen los bloqueos generales del local.
- En 1 día cada columna sigue mostrando bloqueos generales y del profesional correspondiente.
- state.agendaBlocks y filteredAgendaBlocksForRange conservan los bloqueos personales para sus consumidores existentes. No se modifica backend ni reglas de reservas.
- Checks: staff-agenda-own-visibility, agenda-default-view, agenda-professional-drag y CRM inline syntax; npm run test:text-encoding antes del commit. Cualquier fallo se registra sin rebajar riesgo.

Engram: no hay herramientas mem_context/mem_search/mem_get_observation disponibles; espejo odd/crm-agenda-multiday-block-visibility/tasks pendiente. Documento local creado y leído de vuelta.

Implementación y verificaciones terminadas; registrar commit y evaluación de esta unidad.


A1 completada: una línea de filtro exclusivamente en renderAgendaMobileDayColumn; sin cambios de filteredAgendaBlocksForRange, state, endpoints o disponibilidad. RED observado en el contrato real: Secretaría en 3 días dibujaba block-own y block-other además de block-null. GREEN tras el filtro: 3/7 para Secretaría, administrador, OWN y filtro profesional; diaria local+profesional por columna; identidad y contenido de la colección y filtro base preservados. Dos stubs faltantes del harness (agendaPendingMoves y agendaDragLockPreferenceKey) se completaron antes del RED funcional. Contratos staff-agenda-own-visibility, agenda-default-view y agenda-professional-drag pasaron. El último necesitó DATABASE_URL dummy no conectante; no usó base real. Un intento de ruta de sintaxis inexistente se corrigió: el padre ejecutó crm-ui-inline-syntax-test.ts y pasó; npm run test:text-encoding también pasó. Diff de fuente y prueba: 39 adiciones. No se requirió navegador para esta condición pura: el contrato ejecuta el mismo renderer activo para escritorio/móvil. A2 pendiente solo de verificar HTTP/versión tras el único reinicio final y registrar commit/RDD.


A2 completada: padre inspeccionó el diff de una línea de producto y regresiones; sintaxis CRM, UTF-8 y diff --check sin errores. Local 3000 reiniciado una sola vez y respuesta /crm HTTP 200 con el filtro nuevo confirmado. Unidad de comportamiento y pruebas terminada; no hay checks funcionales pendientes. Engram continúa no disponible.
