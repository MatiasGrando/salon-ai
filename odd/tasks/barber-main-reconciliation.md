# Integración preservando Barberdemo y main

## Objetivo y autorización
2026-11-03: el usuario autoriza resolver los conflictos detectados antes de publicar los cambios. Conservar el trabajo local de Barberdemo, rediseño web y chat móvil, junto con las funciones y protecciones existentes en main. No desplegar, modificar datos, enviar mensajes ni confirmar reservas.

## Evidencia y alcance
Rama codex/barber-service-continuity, HEAD inicial 8c727f764a52244e5c89693497b40344a7c05fa6. Main examinado: origin/main f77c0f268349c2db0af553db3d67e26f1e794823; ancestro común 7d54b5753ec9776a2be83bf89e110a73b797acad. Auditoría de tres versiones incluye trabajo sin commit y siete archivos nuevos: 22 rutas compartidas, nueve con conflictos reales; once limpias y dos adiciones idénticas. No se ha ejecutado merge todavía.

Preservar autogestión e historial de reservas del navegador, titularidad/autorización de main, configuración comercial del orden de profesionales, nuevo checkout/diseño, cualquiera profesional y correcciones semánticas/confirmación/recuperación del bot. No resolver archivos enteros a favor de una parte.

## Tareas
- [ ] R1 — Preservar el estado local en un commit recuperable e integrar el historial de main en esta rama; sin reset, force push ni cambios en main. Ruta inline para operaciones Git y documento; preparación delegada integration_preparation, disparador de mapa de cuatro o más fuentes. Evidencia de commit pendiente.
- [ ] R2 — Reconciliar reservas web, interfaz y configuración/esquema relacionados. Ruta delegated direct, escritores con propiedad separada; disparador de dos o más fuentes no triviales. Mantener historial/autogestión, autorización, formulario y configuración del orden de profesionales. Evidencia de commit y verificación pendiente.
- [ ] R3 — Reconciliar motor, persistencia, workers y servicios de agenda. Ruta delegated direct, escritores con propiedad separada; disparador de dos o más fuentes no triviales. Conservar confirmación semántica, comparación canónica de movimientos, recuperaciones, otros canales y borradores. Evidencia de commit y verificación pendiente.
- [ ] R4 — Verificar integración, ausencia de conflictos y preservación de funciones; guardar resultado y comunicar límites. Ruta inline para coordinación, verificación delegada si requiere más de tres fuentes. Commit final pendiente; publicación no equivale a despliegue.

## Comprobaciones y restricciones
TDD STRICT heredado de los documentos de UI/bot; instrucción explícita del usuario de omitir pruebas sintéticas de flujo prevalece. No inventar RED/GREEN. Se harán verificaciones estáticas de UTF-8, marcadores de conflicto, sintaxis TypeScript/JavaScript embebido y git diff --check. Antes de cada commit: npm run test:text-encoding (runner tsx scripts/text-encoding-contract-test.ts). Pruebas funcionales con DB/IA, migraciones, mensajes, reservas y despliegue quedan fuera de esta integración. No alterar servidor operativo.

Estrategia de entrega single-pr, coherente con los documentos de rediseño existentes; no crear PR en esta fase. La preservación incluye aproximadamente 2.700 líneas previas acumuladas; la reconciliación añade solo los cambios necesarios, sin límite artificial. Registrar conteo real y commits. Las importaciones ya existentes de main no son comportamiento nuevo diseñado aquí.

RDD: consulta inicial devolvió off/clone_local pero también error de resolución de identidad por acceso denegado; resultado no confiable, pendiente determinar modo efectivo. No enviar código a revisor externo ni afirmar aprobación. Engram no disponible en las herramientas de esta sesión: espejo odd/barber-main-reconciliation/tasks pendiente; este archivo es la copia local recuperable.

## Progreso
Documento creado antes de la primera escritura de fuentes. Auditoría previa solo lectura y refs verificadas. Índice inicialmente vacío; 47 rutas locales modificadas o nuevas. Siguiente paso: preservar estado y preparar integración con escritores por dominio.
