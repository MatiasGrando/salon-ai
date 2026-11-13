# Carga prioritaria de Agenda, Clientes y Caja

### Selector de profesionales al bloquear agenda

- [x] A6. Abrir «Bloquear agenda» desde el arranque en frío con el catálogo que ya carga Agenda. Conservar la preselección desde una columna y respetar los permisos. Comprobar que el panel espera si falta el catálogo, sin agregar consultas.

Ruta delegada directa para el mapa y la regresión. TDD STRICT heredado. Runner: `npm run test:agenda-range-selection`. Forecast 60–120 líneas. Espejo Engram pendiente por acceso a la base local.

RED: el selector inicial descartaba el profesional de la columna. GREEN: apertura en frío, preselección y horario, permiso limitado, catálogo aún no disponible y ausencia de nuevas consultas. Siguiente paso: validar en producción tras publicación autorizada.

### Continuidad de la precarga de Agenda

- [x] A5. Mantener la primera carga acotada y la navegación inmediata sobre rangos ya consultados. Consultar los días vecinos al llegar a un período sin datos, compartir solicitudes en curso y conservar la invalidación tras cambios reales. Verificar aislamiento entre profesionales y comercios.

Ruta delegada directa para el diagnóstico y el contrato funcional, con edición acotada de la lógica CRM. TDD STRICT heredado. Runner: `node node_modules/tsx/dist/cli.mjs scripts/agenda-prefetch-navigation-contract-test.ts`. Comprobaciones adicionales de sintaxis CRM, alcance y codificación. Forecast 120–230 líneas, misma estrategia de entrega. Espejo Engram pendiente.

RED: la navegación durante una precarga compatible duplicó el par de consultas. GREEN: retorno inmediato a fechas cargadas, ventana en curso compartida, reutilización por profesional, recuperación tras actualización y salto semanal. Sintaxis CRM, vista inicial, alcance de negocio, UTF-8 y diff verificados. Sin medición en producción. Próximo paso: validar al publicar. Espejo pendiente por acceso a la base local de Engram.

2026-11-12. Autorizado implementar el plan acordado. La captura de apertura en frío muestra /appointments 3,33 s y /schedule-blocks 2,10 s en paralelo, precedidos por ajustes y catálogos secuenciales. Meta operativa: Agenda utilizable en 2–5 s en frío, y retorno inmediato a vistas con datos cargados.

- [x] A1. Cargar sesión, comercio, permisos y período visible primero. Mostrar carga explícita hasta recibir datos operativos. Diferir ajustes y catálogos. Precargar de forma acotada después de Agenda.
- [x] A2. Reutilizar Agenda, Clientes y Caja durante la sesión, por comercio y consulta. Compartir solicitudes en curso, impedir respuestas fuera de contexto, conservar datos visibles al revalidar, invalidar tras mutaciones y eventos existentes.
- [x] A3. Verificar contratos y sintaxis de la interfaz, aislamiento y casos de recarga. Medición real en PC y teléfono pendiente de una versión desplegada.
- [x] A4. Barra móvil única para mes, días, filtros, bloqueo y hoy. Se conservan menú, flechas y bloqueo de arrastre. El padre cerró el ajuste directo de un archivo tras detener la edición delegada y un agente verificó la vista aislada.

Ruta delegada: mapa de arranque y datos, escritor de CRM y escritor de módulo Caja con archivos separados. Preservar permisos, flujos de cobro, navegación de otros rubros y cambios en tiempo real. Sin publicación ni DB remota. TDD heredado STRICT; priorizar contrato aislado sin aplicación, DB ni red y conservar preferencias anteriores de evitar suites amplias y reinicios. Runners: test:crm-ui-syntax, test:agenda-default-view, test:agenda-business-scope, test:text-encoding, y contrato puntual si hace falta. Forecast inicial 240–390 líneas authored; estrategia ask-on-risk, decisión previa feature-branch-chain, sin PR. RDD evaluar commit local. Base df2ae75. Engram sin herramientas, espejo odd/crm-priority-loading/tasks pendiente.

Caja: unidad delegada para retener jornada y filtros, compartir precarga y solicitudes en curso e invalidar por mutaciones y eventos. Comprobación aislada falló en la base y pasó tras el cambio. Incluyó vuelta con caché vigente, deduplicación, jornada histórica, invalidación, permisos y descarte de respuestas obsoletas. El enlace desde el CRM se guarda con la segunda unidad. El alcance revisado supera el forecast inicial por las protecciones de sesión y las cargas separadas. Se mantienen dos unidades locales en la rama del feature, sin entrega remota.

Unidad de Caja observada en 6dceea6. El control automático de permisos impidió ejecutar la evaluación nativa por límite de uso. Se volverá a consultar el estado cuando el entorno permita la operación.

Agenda: primera consulta de 1, 3 o 7 días según la vista, con turnos, bloqueos, horarios y profesionales en paralelo. Los resúmenes financieros se solicitan por separado y el resto del CRM se hidrata cuando se necesita. La precarga posterior pide un rango de 15 días, que incluye el día ya visible. Agenda y Clientes retienen datos durante la sesión y revalidan según vigencia o cambios. Caja precarga el resumen actual y conserva jornada, filtros y movimientos al volver.

PASS: contrato de alcance de Agenda, vista inicial y permisos de personal, precarga (expectativa actualizada para período visible y rango secundario), alcance de Caja y sintaxis del CRM. La prueba aislada de la barra con CSS del repositorio y markup equivalente pasó en Chrome a 320, 390, 490 y 1100 px: una fila, controles de 44 px y desplazamiento interno. A 490 caben las cinco opciones; a 390 se desliza para Hoy y a 320 también para Bloquear. El primer Chrome en sandbox no inició por error de GPU y el agente repitió en entorno aislado con autorización. No se probó contra la aplicación real, datos de clientes ni Caja operativa. Próximo paso: medir apertura en frío y reentrada en PC y teléfono tras despliegue autorizado.

Unidad de Agenda, Clientes y barra guardada en 031aa27 tras comprobaciones de sintaxis, codificación y diff. La evaluación local del bloque df2ae75..031aa27 respondió medium, 778 líneas acumuladas y revisión debida por superar el presupuesto. Se recuperó el acceso para esta evaluación tras el límite de uso anterior. Consentimiento de revisión pendiente y espejo Engram pendiente.
