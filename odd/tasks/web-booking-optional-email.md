# Correo opcional en reserva web

## Objetivo y alcance autorizado
Agregar correo opcional a la reserva invitada por nombre y teléfono y reutilizar el envío de confirmación existente de Google. Trabajo local en copia separada desde codex/social-platforms (5b40a80); preservar sus cambios pendientes. Sin despliegue, push, PR, migraciones ni acceso remoto.

## Evidencia y decisiones
Mapping delegado map_optional_email: landing-ui.ts y public-booking.ts, con sus dos suites de invitados. Reutilizar findOrCreateCustomerByPhone sin sobrescribir correo existente y sendBookingConfirmationEmail con destinatario validado del pedido. Google conserva correo verificado. Mantener política actual de señas pendientes.
TDD STRICT: openspec/config.yaml strict_tdd:true. Runner: node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts. RED antes de fuentes, GREEN y refactor. No builds. Entorno ficticio sin .env ni servicios reales.
Ruta delegated-direct: mapping/preparación y writer por dos fuentes no triviales. Forecast 200–350 líneas authored; estrategia ask-on-risk, consultar sólo si se supera presupuesto aproximado 400. Rama codex/web-booking-optional-email.

## Tareas
- [ ] E1 — Unidad coherente: campo opcional, estado/borrador, validación y payload; backend valida y reutiliza persistencia y confirmación. Pruebas RED/GREEN para vacío/válido/inválido, Google y teléfono existente; regresiones focalizadas, verificación escritorio/móvil, encoding y diff; commit Conventional Commit con evidencia. Ruta delegada por writer trigger. Se consolidan implementación y verificación antes de fuentes porque entregan un solo comportamiento pequeño.

## Aceptación y checks
Sin correo permite reservar; válido recibe la confirmación existente; inválido muestra error integrado antes de efectos; conservar Google, teléfono, coordinadas y señas. Suites public-guest-booking, guest-web-booking-ui, public-registration-phone, public-booking-confirmation-performance-contract, booking-coordinated-flow-contract y deposit-flow-contract; npm run test:text-encoding antes de cada commit; git diff --check.

## Progreso y recuperación
Implementación y verificaciones funcionales completadas; cierre y commit pendientes. Engram no disponible en este runtime: espejo odd/web-booking-optional-email/tasks PENDIENTE. RDD: primera consulta en checkout original falló al resolver identidad; consulta posterior en copia nueva verificó ON, fuente global. No se cambió el modo. Evaluación del candidato pendiente del commit.

### Evidencia E1
- RED funcional observado antes de editar fuentes: UI 27 PASS / 4 FAIL (campo, payload, borrador, input). Backend 23 PASS / 4 FAIL: tres faltas del comportamiento pedido y un fixture Google sin stub de customer.updateMany, corregido en pruebas.
- GREEN: UI 31/31 y backend 27/27. Se comprueban vacío/válido/inválido, normalización, ambos endpoints, destinatario del pedido frente a ficha con correo previo, persistencia sin sobrescribir esa ficha, Google verificado, seña pendiente y restauración compatible de borradores sin correo.
- Regresiones PASS: public-registration-phone 273/273; public-booking-confirmation-performance-contract OK; booking-coordinated-flow-contract OK; deposit-flow-contract 22/22; account-booking-origin 19/19. Generación local Prisma 7.8.0 PASS con URL ficticia puerto 1 y dotenv inexistente, salida sólo en src/generated/prisma de esta copia.
- Fallos de preparación resueltos: primer arranque de suites sin cliente generado; primera ejecución de coordinadas/señas sin DATABASE_URL (repetidas con URL ficticia PASS). Ninguno se cuenta como RED de comportamiento.
- Visual PASS: Chrome headless, HTML/CSS/funciones reales, fixture offline sin solicitudes externas. Escritorio 1366x900, móvil 390x844 y 320x740: ancho del documento igual al viewport, controles de 48px de alto; correo de 648/306/236px de ancho. Capturas en tmp/optional-email-visual/{1366,390,320}.png, fixture form.html. Inspección visual worker y parent en escritorio/móvil: jerarquía, padding, acciones y ausencia de desborde correctos. Edge no instalado; Chrome existente permitió completar la comprobación. No se agregó un formulario nuevo ni un cuadro redimensionable.
- npm run test:text-encoding y git diff --check PASS. Typecheck global no completado: node node_modules/typescript/bin/tsc --noEmit terminó exit 1 por heap out of memory cerca de 2GB, sin diagnósticos TypeScript. No se afirma typecheck aprobado ni fallo de código; no se amplía esta mejora pequeña para reparar la infraestructura global. Build omitido por prohibición explícita de openspec/config.yaml. Sin prueba de entrega real de correo: sender probado con fetch interceptado y respuesta ficticia; sin servicios ni datos reales.
- Fuentes modificadas: src/routes/landing-ui.ts y src/routes/public-booking.ts. Se reutilizan normalizeCustomerEmail, findOrCreateCustomerByPhone y sendBookingConfirmationEmail. Se mantiene política actual de aprobación de señas; no se altera correo previo de una ficha existente. Cambio coherente de 190 líneas authored aprox. más este documento, debajo del forecast 400; ask-on-risk no requiere resolver cadena.

Próximo paso: guardar unidad con Conventional Commit, registrar identidad y evaluar RDD sobre el rango comprometido. Typecheck global y espejo Engram quedan pendientes.
