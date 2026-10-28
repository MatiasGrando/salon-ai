# Consistencia de acceso de staff

## Objetivo y autorización

El 28/10/2026 el usuario autorizó implementar la corrección tras la investigación local: una cuenta profesional de staff debe mostrarse como Profesional, ver solamente su propia agenda y poder consultar sus liquidaciones cuando el permiso explícito esté habilitado. No autoriza cambios de cuentas, datos, contraseñas, base de producción, publicación, push, pull request ni uso de sesiones remotas.

## Hallazgos confirmados

- `crm-ui.ts` etiqueta como Administrador cualquier rol distinto de SUPER_ADMIN o ACCOUNT_ADMIN.
- La Agenda carga el catálogo activo completo y la vista de un día dibuja todas las columnas con el filtro vacío. El servidor conserva el alcance OWN para listas de turnos y bloqueos si existe `professionalId`; la interfaz debe reflejarlo.
- `auth-service.ts` entrega a la interfaz el permiso guardado de liquidaciones pero lo fuerza a `false` en el contexto autenticado de toda cuenta STAFF. El guard bloquea entonces resumen y movimientos. Se reprodujo en memoria con un perfil PROFESSIONAL y vínculo válido.

## Alcance y criterios

- STAFF/PROFESSIONAL se presenta como Profesional; SECRETARY conserva una etiqueta de Secretaría; administradores conservan sus etiquetas actuales.
- Un profesional con alcance OWN sólo ve su propio selector y columna de Agenda en escritorio y móvil. La autorización del servidor se conserva y se valida ante vínculos ausentes o ajenos.
- El permiso `canViewProfessionalSettlements` guardado llega sin alteración al contexto STAFF. Las liquidaciones siguen siendo lectura, con alcance profesional propio y sin habilitar Caja, pagos ni configuración.
- Las regresiones cubren sesión real/guard, etiquetas, catálogo y las variantes móvil/escritorio. No se usan alert, confirm ni prompt.

## Ruta, TDD y entrega

Trabajo sustancial ODD en tres unidades delegadas. Motivos: el mapeo abarcó más de cuatro archivos y cada unidad modifica dos o más archivos no triviales (producción y prueba). TDD estricto proviene de `openspec/config.yaml`; runner: `tsx`/`node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts`. Cada unidad requiere RED observado, GREEN, refactor, pruebas focalizadas, `npm run test:text-encoding` y `git diff --check` antes de su commit. Rama existente `codex/la-cochera-v11`, base de esta corrección `694cff6`; los commits incluirán exclusivamente archivos de esta función y preservarán los cambios ajenos.

Pronóstico actualizado: unas 450–550 líneas autoradas entre fuentes, regresiones reales y este documento. Se supera la heurística inicial por la cobertura del authGuard real y las variantes de Agenda, sin minificar ni omitir negativos. Estrategia de entrega: ask-on-risk; se conserva la elección de cadena `feature-branch-chain` ya registrada para este proyecto en `odd/tasks/agenda-professional-filter-persistence.md` (rama actual y publicación al final). No se crean PR ni se publica con esta autorización; las unidades serán commits locales. La consulta inicial de receipt-driven development falló al resolver la identidad del repositorio y su salida no era válida. La consulta repetida con acceso de lectura suficiente terminó exit 0: modo ON, fuente global ON y clone-local unset. No se cambió ninguna preferencia; corresponde evaluar los commits y seguir las transiciones nativas que resulten. El espejo Engram `odd/staff-access-consistency/tasks` está pendiente porque las herramientas de memoria no están disponibles.

## Tareas

- [x] SAC-1 — Corregido el contexto de sesión para conservar el permiso de liquidaciones de staff; regresión con getAuthFromRequest y authGuard reales. Ruta: delegated; disparador writer (auth + contrato). Observado: permiso activo profesional/secretaría permite summary/entries, y siguen denegados permiso apagado, perfil/vínculo inválido, negocio ajeno y mutaciones. El alcance propio y vínculo ajeno se verifican además en la suite existente de rutas. Commit de unidad pendiente de guardar abajo.
- [ ] SAC-2 — Corregir etiqueta del perfil y presentación de Agenda propia, con regresiones de escritorio/móvil. Ruta: delegated; disparador writer (CRM + contrato). Aceptación: las cuentas staff tienen etiqueta correcta y un profesional OWN no recibe ni dibuja profesionales ajenos; secretaría y administradores preservan sus vistas autorizadas.
- [x] SAC-3 — Investigación histórica delegada tras aclaración del usuario: el problema de secretaría es liquidaciones, al igual que el profesional. No corresponde alterar su autorización de turnos por ese síntoma. `a1ab52e` (20/09) conservaba el permiso; `a29b17da` (23/09) lo forzó a false para STAFF; `cc703c1` (13/10) reabrió publicUser/guard/endpoints pero no auth-service. git log -G/-S y blame HEAD confirman que esa condición no volvió a cambiar: no hay evidencia de una corrección de sesión posterior sobrescrita. La publicación documentada del 13/10 tampoco incluía auth-service. La causa común se corrige en SAC-1, sin una segunda modificación de negocio. Evidencia y cierre incluidos en el commit SAC-1.

## Estado y siguiente paso

SAC-1 implementada y verificada: RED observado antes del cambio con permiso guardado `true` convertido en `false` durante sesión; GREEN cubre summary/entries permitidos sólo con permiso y vínculo válidos, y conserva denegadas configuración, pagos y mutaciones. El contrato final fuerza dotenv inexistente y DB ficticia, registra authGuard real y atraviesa la sesión en Fastify.inject: profesional/secretaría true/false, gestión almacenada true aún denegada, vínculo ausente, perfil inválido y negocio ajeno. Los handlers testigos comprueban el guard; el alcance de datos y vínculo ajeno lo comprueba `staff-settlements-access-test`, también PASS. Parent repitió contrato final PASS. Codificación y diff PASS; `staff-secretary` conserva su fallo heredado de 15 frente a 20 etiquetas. No se ejecuta build según configuración. El intento de stage anterior falló por permisos de escritura de `.git/index.lock`; no existe lock persistente y no se borró nada. Resolver mediante acceso autorizado a Git, sin intervenir procesos ajenos.

SAC-2 dejó sólo el borrador `scripts/staff-agenda-own-visibility-test.ts` antes de que su delegado fallara por límite de uso. Nuevo writer delegado observó RED por helper de rol ausente y completa CRM/regresión. SAC-3 terminó read-only con la secuencia histórica arriba; la reproducción SECRETARY ALL de Agenda funcionaba localmente, y el usuario aclaró que el síntoma era liquidaciones.

Evaluación nativa preliminar: unavailable/high/unassessable por inventario ajeno de 125.084 archivos no rastreados que excede el límite de 8 MiB. No equivale a aprobación ni riesgo bajo. Se intentarán assessment committed-only y STATUS correspondiente al commit desde base 694cff6.

El árbol contiene cambios ajenos, incluidos documentos y scripts, que no se tocarán. Siguiente: cerrar SAC-1 con un commit aislado, completar SAC-2 y resolver SAC-3 según evidencia. Herramientas de memoria consultadas en reanudación: no disponibles; no se afirma espejo recuperado ni sincronizado.
