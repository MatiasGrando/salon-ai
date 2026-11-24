# Consolidación de cambios implementados en main

## Objetivo y autorización
2026-11-23: el usuario pide un commit en el main principal con todos los cambios implementados hasta el momento, sin omitir Staff/Filtros de Agenda; luego ordena continuar. Autoriza consolidación local y commits/merge en main. No se infiere autorización nueva de push, fetch, despliegue, otras migraciones ni uso de credenciales remotas.

## Evidencia inicial y alcance
Rama actual codex/instagram-pantalla-principal cc31c30, main3229b9a en C:/Users/cpu/salon-ai/tmp/instagram-barber-main-release y limpio. Los11commits propios de main son cherry-picks de primeros11actuales; quedan24commits funcionales propios de la rama actual. Se preservan5documentos de verificación modificados y se excluyen temporales/logs locales del producto. Staff en toolbar es1127f0a, únicamente en codex/agenda-staff-dropdown; no está en rama actual ni main. Inventario de otras ramas/worktrees en curso, sin red ni lectura de secretos. No integrar experimentos o cambios inconclusos como terminados ni reemplazar archivos completos por una versión antigua.

## Tareas
- [x] M1 Inventario de commits, equivalencias y cambios completos restantes en ramas/worktrees; comprobar Staff y preservar main actual.
- [ ] M2 Guardar la evidencia de verificación local pendiente y este documento en la rama actual; conservar código, datos y temporales sin incluirlos por accidente.
- [ ] M3 Integrar en el main existente todos los commits actuales no equivalentes, resolviendo únicamente conflictos necesarios y conservando ambas historias.
- [ ] M4 Recuperar1127f0a Staff de Agenda sobre la versión consolidada, sin perder cargas incrementales, bloqueos ni permisos.
- [ ] M5 Incorporar otros bloques implementados pendientes si el inventario demuestra una omisión real; preservar WIP ajeno y documentar cualquier decisión de alcance pendiente.
- [ ] M6 Ejecutar checks pertinentes sobre main, verificar inclusión de bloques/commits y estado final; registrar identidad de integración y decisión nativa de revisión correspondiente.

## Rutas, checks y límites
Ruta delegated direct para mapeo4+fuentes (main_current_integration_map y main_other_branches_inventory) y para cualquier resolución multifuente no trivial. Padre coordina Git/documento y commits; merge local en main autorizado explícitamente. TDD strict_tdd:true de openspec/config.yaml; runner node node_modules/tsx/dist/cli.mjs scripts/<suite>.ts. Integración de parches ya implementados reutiliza sus regresiones y evidencia histórica sin inventar RED; si aparece un defecto nuevo, RED/GREEN focal antes de reparar. UTF8/npm run test:text-encoding antes de cada commit; diffcheck y pruebas existentes Agenda/Staff/Caja/permisos y sintaxis CRM según fuentes finalmente integradas. No DB real/IA/mensajes/pagos ni pruebas con efectos. Typecheck previo no completó por memoria; evaluar check proporcional sin repetirlo a ciegas.

Entrega local sobre main solicitada; estrategia feature-branch-chain ya elegida en el proyecto, sin PR en este pedido. Forecast nuevo documento/resolución80–250líneas orientativo, excluye autoría histórica de commits incorporados;400 es heurística, no cap ni razón para minificar. RDD efectivo ON global; omisión anterior aplica solo a cc31c30, no a un nuevo candidato de integración. Usar evaluación/STATUS nativos y no ejecutar revisores sin la decisión correspondiente. Engram/mem_* no disponibles: espejo odd/main-consolidation-20261123/tasks pendiente; documento local es la recuperación. No sobrescribir otros documentos ni worktrees sucios.

## Progreso
Exploración de Git delegada antes de fuentes; main limpio y Staff faltante comprobados. Próximo paso: cerrar inventario, guardar docs y ejecutar integración local.


M1 observado: main limpio; divergencia11/35 con11equivalentes y24commits funcionales reales actuales pendientes. Staff1127f0a es la única omisión funcional completada confirmada externa. Agenda-prefetch,bloqueos profesionales,priority-loading yconfirmation-presentation ya contenidos; email-media82bad08/2090d30 incorporados como895a6ca y evolucionados, no traer rama vieja. Corrección de servicio,draglock yrecipientkey1b95a37 presentes. Único dirty de código externo es prueba offline de availability profesional en root; incorporar solo su diff si pasa, sin tocar el dirty original. Otros documentos/materiales/temporales y package.json viejo de publicación que quita migrate deploy se preservan fuera del producto. Inventarios delegados sin mutaciones ni red.

Plan concretado para un único commit final de main: preservar docs en rama actual, consolidar Staff y la prueba adicional allí primero, luego merge --no-commit hacia main y cerrar un solo commit de integración comprobado. Merge-tree puramente textual predice conflictos en src/server.ts, scripts/instagram-shared-bot-runtime-test.ts y odd/tasks/instagram-message-delivery-recovery.md; mapa comparó que la versión actual conserva main y añade IDR4/5. Resolver acotado, no copiar versiones antiguas completas de CRM. M4/M5 se ejecutan antes de M3 para evitar main intermedio incompleto. Writer main_integration_writer asignado y espera preservación documental.
