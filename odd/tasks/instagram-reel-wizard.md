# Asistente de creación de Reels

El usuario aprobó la maqueta de cuatro pasos y pidió reiniciar el servidor local. El formulario debe conservar lo ingresado al volver atrás y reutilizar la preparación, guardado y programación existentes.

- [x] RW1. Implementar y verificar Contenido, Automatización opcional, Publicación y Revisar. Mantener la edición de borradores, la reprogramación y los errores visibles. Ruta delegada por integración del formulario con planificación y pruebas. Commit local `d775ced`.
- [x] RW2. Reiniciar el servidor local en 3000 y verificar que sirva el asistente. Ruta directa. CRM devuelve HTTP 200 y contiene el ajuste móvil final.

TDD estricto según `openspec/config.yaml`. Prueba de contrato del asistente, contratos de UI y planificación aplicables, sintaxis del CRM y UTF-8. Estimación de 180 a 320 líneas, estrategia ask-on-risk. Alcance local. Espejo Engram pendiente por falta de herramienta.

RED observado en el contrato de indicadores. GREEN en los contratos de interfaz, planificación y formato, sintaxis CRM, UTF-8 y `git diff --check`. Chrome verificó el flujo con datos ficticios a 1440×900, 390×844 y 320×568 tras corregir un desborde en el ancho menor. Publicación real en Instagram no ejecutada.

El commit contiene 416 líneas cambiadas y también integra los retoques de navegación de Instagram ya autorizados. La evaluación local de revisión indicó riesgo medio y presupuesto alcanzado. La prelectura requiere seleccionar el alcance de archivos sin seguimiento. Revisión externa pendiente, sin envío de código. Próximo paso: validación del usuario en el CRM local.
