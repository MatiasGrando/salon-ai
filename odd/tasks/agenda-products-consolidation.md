# Consolidación local de Agenda, Productos y diagnóstico IG

## Autorización y alcance
El 24/11/2026 el usuario pidió un commit completo con los cambios de Agenda y la corrección de Productos, en continuidad con el diagnóstico IG ya preparado. Se consolidan todos los commits actuales en main LOCAL, conservando el historial. Esta instrucción permite integrar el trabajo antes mantenido en ramas locales, pero no autoriza push ni despliegue. No tocar DB, mensajes o configuración remota.

Base main64dc136; rama fuente codex/instagram-ai-diagnostics a6afbf3. Main no está ocupado por otro worktree. El árbol de producto está limpio; solo queda el cierre documental del diagnóstico y temporales no versionados, que se preservan fuera del commit.

## Tareas
- [x] C1. Verificar inclusión de e541eca/07982b1 Productos,65cc12a/ad88abe/c0c266f/ea0f74c/e3c7147 Agenda y a6afbf3 diagnóstico; comprobar main disponible y ausencia de fuentes sin commit. Comandos git status/log/worktree observados, sin red.
- [ ] C2. Guardar evidencia pendiente e integrar mediante merge conservando ambos historiales, sin repetir ni reemplazar fuentes.
- [ ] C3. Verificar ancestros/árbol/ausencia de fuentes pendientes y evaluar el candidato nativo; informar commit completo y límites de publicación.

Ruta inline para Git/documento con parches ya verificados y sin resolución no trivial prevista. Si aparece conflicto de fuentes se detiene el merge y se delega la resolución acotada. TDD strict heredado openspec/config.yaml; no hay comportamiento nuevo ni RED a inventar, se reutilizan pruebas observadas de cada unidad. UTF-8 antes de cada commit, diffcheck e igualdad del árbol fuente al consolidar. No repetir suites ya corridas sin cambios o fallo nuevo.

Pruebas previas: Producto auth/tenant/categoría opcional y regresiones PASS; Agenda contratos/checkout/idempotencia/PGlite/Prisma validate y navegador real1440/390/320 PASS. Migración Agenda ya aplicada y verificada con autorización separada. Diagnóstico IG wiring cuatro combinaciones,UTF8/diff PASS; suites semánticas tienen fallos declarados sin baseline separado. Typecheck global y contención PostgreSQL multiproceso siguen pendientes; no se declaran PASS. No se corrigió todavía la selección Tamara ni el fallo de fecha/hora, solo se preparó observabilidad.

Entrega local explícita. Estrategia feature-branch-chain ya elegida, sin PR pedido; esta consolidación conserva las unidades históricas, sin nuevas líneas de producto ni fraccionamiento artificial. RDD ON, evaluar commits según política nativa y conservar decisiones exactas anteriores sin inventar aprobación para una nueva integración. Engram no disponible: espejo odd/agenda-products-consolidation/tasks pendiente, copia local recuperable.

## Progreso
C1 observado. Próximo: commit documental de preparación y merge local en main. Publicar requiere autorización explícita posterior.
