# Acceso al catálogo y categorías de productos

## Objetivo y autorización
El 24/11/2026 el usuario reportó que Caja → Productos no muestra las categorías ni los productos creados y tampoco permite guardar sin categoría. La captura muestra un error de permisos en ambos listados. Se autoriza la corrección local del flujo existente, con sus permisos y aislamiento por comercio. No se concederán permisos ni se modificarán usuarios, datos, ventas o stock. No se usarán producción ni bases remotas. La publicación se resolverá sobre el resultado concreto; el permiso de push anterior correspondía a la consolidación 44ad43b.

## Evidencia
Base main 64dc136359e1ad756432ef1f050948d4ecaff56a, con archivos rastreados limpios. Se preservan los temporales anteriores. Rama de corrección: codex/fix-product-catalog-access. El mapa delegado product_catalog_access_map identificó dos causas:

1. internalRouteRoots de src/plugins/auth-guard.ts no reserva products, product-categories ni product-sales. Los GET se interpretan como slugs públicos y omiten autenticación; la guarda de productos recibe request.auth vacío y devuelve el 403 observado. ACCOUNT_ADMIN también necesita que las rutas concretas de catálogo se reconozcan como workspace del comercio autorizado, conservando las restricciones de asignación/demo existentes.
2. El formulario en src/routes/crm-ui/cash-register.ts exige una categoría y puede asignar la primera al editar. La API ya normaliza vacío a null y Product.categoryId admite null. No hace falta migración.

## Tareas
- [x] P1. Observar RED con AuthGuard y rutas reales offline: GET autenticado denegado y formulario que bloquea categoría vacía. Cubrir roles autorizados, staff restringido y aislamiento por comercio.
- [x] P2. Corregir las rutas internas y el acceso acotado de ACCOUNT_ADMIN; ofrecer Sin categoría, conservar null al editar y enviarlo explícitamente. Mantener rechazo de categorías ajenas/inactivas y las reglas existentes.
- [x] P3. Observar GREEN de catálogo, permisos, UI y rutas públicas; ejecutar sintaxis, UTF-8 y diff. Guardar work-unit commit, evaluación nativa, límites y siguiente paso de publicación.

## Ruta y comprobaciones
Ruta delegated direct por preparación de cuatro o más fuentes y escritura en dos o más archivos no triviales. El padre coordina Git y documentación. TDD estricto: strict_tdd:true de openspec/config.yaml. Runner: node node_modules/tsx/dist/cli.mjs scripts/<suite>.ts. Se exige RED antes del arreglo, GREEN y revisión del diff; no se elude el middleware en la prueba.

Regresiones: product-sales-service, product-sales-ui, appointment-product-sales, cash-treasury-access, cash-permissions, staff-auth-session-settlements, sintaxis JavaScript del CRM y npm run test:text-encoding antes de cada commit. Usar URL de base ficticia y dotenv inexistente. Sin DB, IA, mensajes ni red reales. Reutilizar el formulario, servicios y componentes; conservar jerarquía y escala, y verificar selector/guardado en escritorio y móvil si cambia la UI. Sin diálogos nativos. Fuentes UTF-8 y entidades HTML en plantillas.

Entrega ask-on-risk; forecast orientativo de 150–300 líneas nuevas/modificadas. Las 400 líneas son una heurística, no un límite ni razón para minificar. La estrategia feature-branch-chain ya está elegida en el proyecto si hiciera falta dividir la entrega; no se pidió PR. RDD global ON; las omisiones previas no cubren este candidato. Evaluación y STATUS nativos después del work-unit; no ejecutar revisores sin decisión vigente.

Engram/mem_* no está disponible: espejo odd/product-catalog-access/tasks pendiente. Esta copia local se leyó después de escribirla y permite recuperar el trabajo.

## Progreso
Mapa completado sin escrituras de fuentes ni accesos remotos. Documento creado antes de la implementación. Siguiente paso: delegar la corrección y sus pruebas RED/GREEN, acotadas a las dos causas confirmadas.


## Implementación y evidencia del escritor delegado
P1 RED observado antes de modificar producción: product-catalog-access-test.ts devuelve 403 PRODUCT_PERMISSION_REQUIRED a BUSINESS_ADMIN con sesión válida en el GET del catálogo (se esperaba 200); product-catalog-ui-test.ts observa cero solicitudes al guardar un producto válido sin categoría (se esperaba una). Ambas pruebas usan código productivo: AuthGuard + productSalesRoutes + sesión/Prisma en memoria, y funciones del script real del formulario en VM. No se suplanta el middleware.

P2 corregido en dos fuentes, sin servicios ni schema: se reservan los tres namespaces internos y se habilitan solo los métodos/rutas concretos de catálogo para ACCOUNT_ADMIN, conservando el control existente de comercio asignado/demo. La UI siempre ofrece «Sin categoría», conserva la selección activa al recargar, mantiene null al editar o pasar de un producto categorizado a otro sin categoría y envía categoryId null. El select real no tiene required ni disabled y su etiqueta dice categoría opcional. La validación de nombre, importes y orden sigue activa. No cambió CSS ni se creó un formulario.

GREEN observado: product-catalog-access-test.ts y product-catalog-ui-test.ts. La primera cubre administrador, superadministrador, ACCOUNT_ADMIN asignado/demo, anónimo, staff sin permiso/lector/gestor, comercio real ajeno y QA denegados, categoría creada visible tras recarga, crear/editar con null o sin campo, categorías ajenas/inactivas rechazadas. Se incorporó un producto extranjero existente al fixture: PATCH devuelve 404 sin escritura ni modificación del registro. La segunda ejecuta guardado sin categoría con lista vacía, creación/recarga de categoría, selección conservada, edición consecutiva entre productos y eliminación explícita de categoría, además de validaciones que siguen denegando nombre vacío o precio negativo.

Regresiones PASS: product-sales-service-contract-test.ts, product-sales-ui-contract-test.ts, appointment-product-sales-contract-test.ts, cash-treasury-access-contract-test.ts, cash-permissions-contract-test.ts, staff-auth-session-settlements-contract-test.ts y crm-ui-inline-syntax-test.ts (dos scripts). npm run test:text-encoding PASS y git diff --check PASS. Runner node node_modules/tsx/dist/cli.mjs; URL ficticia 127.0.0.1:1 y dotenv inexistente. No se accedió a DB/IA/red reales, producción, sesiones o datos del usuario.

P3 queda pendiente del commit/evaluación nativa del padre; todas las comprobaciones focales de esta unidad terminaron verdes. No se ejecutó typecheck global ni una suite visual nueva: el cambio no altera distribución, estilos o redimensionado; el selector y el guardado se comprobaron por ejecución y HTML real. Engram continúa sin herramienta, espejo pendiente. No hubo stage/commit, merge/push, revisión ni reinicio de servidores por este escritor.


## Verificación del padre y commit revisable
Commit e541eca: 5 archivos, 269 adiciones y 5 eliminaciones. El padre revisó las dos fuentes y las pruebas nuevas: solo se agregan rutas/métodos concretos y namespaces internos; no se cambia el permiso de productos ni el control de comercio. La opción vacía se representa como null y editar un producto sin categoría no reutiliza una selección anterior. El producto extranjero del fixture existe y permanece sin cambios tras el rechazo. Índice y diffcheck completos, incluidos archivos nuevos, pasaron. Encoding previo observado por el escritor.

Modo nativo verificado ON por preferencia global, sin modificación. Evaluación de 64dc136..e541eca: high por auth-guard, 274 líneas, review_due por high_risk. Se ejecutó el STATUS canónico, se declaró el inventario de temporales excluido y quedó listo el candidato sha256:fb53e75ca67f0e618194cc95bd4f57fbefc569a70dc07661ab1e8c1e6313af1a. No se ejecutó ningún revisor. Se envió al usuario una decisión concreta sobre revisión e integración/publicación de esta corrección en origin/main de MatiasGrando/salon-ai con la sesión Git configurada. La respuesta sigue pendiente; no se consultó ni se modificó ningún remoto.

P3: todas las comprobaciones funcionales locales están verdes y el commit está guardado; solo falta resolver la decisión nativa y la publicación. No hay migración, cambios de permisos ni datos. Espejo Engram pendiente por herramienta no disponible.


## Decisión del usuario: conservar solo local
El usuario eligió «Dejar la corrección solo local». La implementación verificada queda guardada en e541eca, rama codex/fix-product-catalog-access. No se integra ni publica en main y no se ejecuta revisión externa. Esa respuesta no se registra como una omisión explícita de revisión: el candidato sigue sin consentimiento de revisión; al retomar se debe consultar el estado nativo exacto antes de cualquier revisor.

P3 queda cerrado en su alcance de corrección local: RED/GREEN, regresiones, sintaxis, UTF-8, diff, commit y evaluación observados. La publicación deja de formar parte del resultado solicitado por decisión del usuario. El cierre documental no cambia el producto; las limitaciones de pruebas ya declaradas y el espejo Engram pendiente se conservan. No se accedió a remotos, servidores ni datos reales en esta corrección.
