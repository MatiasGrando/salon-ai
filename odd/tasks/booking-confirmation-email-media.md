# Imágenes en el correo de confirmación

## Objetivo y alcance

Los negocios pueden personalizar el correo de turno con su portada, su logo y hasta tres fotos ordenadas. La portada puede reutilizar la imagen actual, elegirse de la galería o subirse para el correo. El negocio elige el encuadre y ve el logo en la vista previa. Las miniaturas que se recortan también admiten ajuste. Los archivos y encuadres originales de la página pública se conservan.

El correo usa la paleta de Weex en carbón, dorado y crema. Los datos, la ubicación, las acciones disponibles y el calendario siguen siendo legibles con las imágenes bloqueadas. La Cochera es el caso de evaluación local de una función para todos los negocios. La autorización cubre implementación y pruebas locales con datos de muestra.

## Ruta, entrega y verificación

Rama `codex/booking-confirmation-email-media` desde `ebc0016`. Mapeo delegado por el alcance en CRM, persistencia, almacenamiento y rutas de correo. Los cambios previos del árbol pertenecen a otros trabajos. Estrategia `single-pr` para una función coherente si se autoriza una entrega posterior, sujeta a los controles vigentes. Estimación inicial de 750–1100 líneas de autoría. El tamaño orientativo de 400 líneas por unidad admite la solución clara con sus pruebas.

TDD estricto según `openspec/config.yaml` (`strict_tdd: true`). Runner para cada unidad `node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts`. Observar RED antes de cambiar fuentes, luego GREEN y revisar el diff. Ejecutar los contratos aplicables, `npm run test:text-encoding` y `git diff --check` antes de cada commit. La configuración global de RDD está activa. Primera frontera `ebc0016`.

## Unidades de trabajo

- [x] CEM-1 — Guardar configuración por negocio y servirla al correo real. Ruta delegada por edición no trivial en almacenamiento, CRM, plantilla y sus tres puntos de envío. Commit `82bad088f555763a5debc6026dff4024f79b3340` con 749 líneas de autoría. RED observado en el contrato de envío por cabecera ausente. GREEN en contratos de correo y de guardado con proveedor simulado, confirmación rápida, reserva coordinada, señas (22), reservas de invitado (23), simulador sin contacto, Prisma validate/generate, migración local con PGlite, `test:text-encoding` y `git diff --check`. El chequeo de tipos global se quedó sin memoria. El acotado detectó dos tipos introducidos en esta unidad, en corrección junto al cierre de la siguiente. RDD medio por cambio de migración y presupuesto de entrega alcanzado. La copia local limpia permitió completar la evaluación ante el límite de inventario del árbol principal. El usuario declinó este candidato y la transición nativa devolvió `declined_this_candidate`. La próxima evaluación excluye ese commit y parte de `82bad08`.
- [x] CEM-2 — Editor en el CRM y prueba funcional local con La Cochera. Ruta delegada por editor, integración y contrato de navegador. RED observado por editor ausente. GREEN en Chrome a 1366 y 390 px con la plantilla real, selección, carga opcional, arrastre y zoom, recorte, orden, fallo y reintento, reapertura, permisos y lectura con imágenes bloqueadas. Pasaron `test:crm-ui-syntax`, `test:text-encoding` y `git diff --check`. El usuario se encargará de la revisión visual restante. Se corrigieron los dos diagnósticos de tipos introducidos en CEM-1 y volvieron a pasar sus contratos. El chequeo acotado aún falla por diagnósticos preexistentes fuera del cambio.

## Recuperación

Copia completa de este documento en Engram bajo `odd/booking-confirmation-email-media/tasks` para el proyecto `salon-ai`. Observación inicial `4889`, verificada con el contenido completo.

Commit CEM-2 `2090d30de479809a838785d47d26d9fe77b37612` con 789 líneas de autoría y 1538 acumuladas. La evaluación RDD de este candidato fue media y debida por presupuesto de entrega. La transición nativa registró `declined_this_candidate` por elección del usuario. Los dos cambios de tipos introducidos en CEM-1 quedaron corregidos en CEM-2 y se repitieron los contratos. La verificación de tipos global sigue incompleta por memoria y la acotada conserva errores previos fuera del cambio.

## Integración en main

- [x] CEM-3 — Integrar únicamente CEM-1 y CEM-2 en `main` y publicar esa rama en GitHub. Base local y remota verificada `3299d35`. Ruta delegada por el mapeo de más de cuatro archivos y la adaptación en CRM, rutas públicas y prueba. Se conservaron Instagram, chat móvil, navegación pública y correo opcional de invitados. El enlace a la cuenta se ofrece a usuarios con correo verificado. TDD estricto según `openspec/config.yaml`, runner `node node_modules/tsx/dist/cli.mjs scripts/public-guest-booking-test.ts`. Push por HTTPS a `MatiasGrando/salon-ai` con la autorización confirmada por el usuario. El commit de integración incluyó 1571 líneas de cambio.

**CEM-3 completado.** Commit `895a6cae9dc9c9753d7d5ae4b5badf9a6132e944` publicado por avance directo de `main` desde `3299d35`. GitHub devolvió el mismo hash al consultar `refs/heads/main`. RED observado por enlace de cuenta en correo de invitado. GREEN en invitados y cuentas verificadas (27), medios, confirmación, seguridad de señas, navegación acotada (2), Prisma, sintaxis, codificación, diff y pruebas funcionales de navegador. La suite completa de señas conserva una aserción desactualizada verificada en `3299d35`. La suite visual se omitió a pedido del usuario. La evaluación RDD media fue debida por presupuesto y se registró `declined_this_candidate` por elección del usuario.

## Ajustes tras la prueba en La Cochera

La prueba del usuario mostró primero un logo cuadrado como portada del correo y luego la portada y las tres fotos ya configuradas. El zoom mínimo recorta las miniaturas. La confirmación web sigue mostrando la pantalla anterior, sin ficha del turno en móvil. La autorización actual cubre la corrección local general. La evaluación visual real queda a cargo del usuario.

- [ ] CEM-4 — Permitir alejar las fotos de la portada y de la galería hasta que entren completas. Mantener el zoom de relleno inicial, encuadres guardados de versiones anteriores y guardado y reapertura de los nuevos. Rellenar con crema cuando la imagen deje espacio. En el correo usar la composición de portada validada y, si falta, el logo compacto. Ruta delegada por CRM, validación, resolución y pruebas en múltiples archivos. TDD `node node_modules/tsx/dist/cli.mjs scripts/booking-email-media-ui-test.ts` más contratos de correo y guardado. Verificar sin proveedor real.
- [ ] CEM-5 — Mostrar una ficha de turno confirmada que se lea en escritorio y móvil con servicio, profesional, fecha, horario, ubicación y acciones existentes, y con marca e imágenes configuradas si están disponibles. Preservar reservas de invitados, coordinadas, pendientes de seña, consulta y regreso al local. Ruta delegada por mapeo de vista, estado y catálogo. TDD estricto con prueba focalizada de la página de reserva y regresiones de confirmación.

TDD estricto por `openspec/config.yaml`. Verificar los contratos focalizados, sintaxis, codificación y diff por unidad. Usar la rama local de trabajo sobre `895a6ca`; el cambio de Google tiene su propia unidad y se preserva. Continuar con estrategia `single-pr` solo si se autoriza la entrega. Estimación adicional de 450–700 líneas de autoría entre ambas unidades.

CEM-4 reprodujo el zoom mínimo de 100% y la portada sin composición antes de editar. Pasaron los contratos del editor a 1366 y 390 px, guardado, correo y sintaxis. La comprobación general de codificación está en curso. CEM-5 usará un contrato focalizado `node node_modules/tsx/dist/cli.mjs scripts/booking-confirmation-card-ui-test.ts`, con la vista real y datos ficticios de invitado, cuenta y turno coordinado.

Siguiente paso: cerrar la verificación del encuadre y completar la ficha web. Pruebas sin envío ni autenticación reales.
