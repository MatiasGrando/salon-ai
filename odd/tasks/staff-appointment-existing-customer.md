# Turno staff vinculado a cliente existente por teléfono exacto

## Objetivo, problema y autorización
El usuario informa que staff no puede cargar turnos pese a habilitar el permiso; confirmó implementar: «al poner el número exacto del cliente debería crear el turno», «sin crear uno nuevo». Resolver únicamente un cliente existente del mismo negocio por teléfono exacto normalizado y crear el turno con el permiso de Agenda. No crear/duplicar clientes ni editar identidad, marketing, pagos o permisos generales.
Mapa previo delegado staff_appointment_permissions_map: saveManualAppointment primero POST /customers y GET /customers; perfil profesional permite turnos pero no esos accesos. Mensaje de captura coincide auth-guard global. No trace real, cuentas/base/producción no inspeccionadas. Estado local customers vacío deliberadamente cuando no hay permiso de listado.

## Alcance y restricciones
Cuenta staff con canCreateAppointments; conservar negocio/profesional OWN, disponibilidad/force y Caja. Si número no existe o es ambiguo, error integrado al CRM, sin alta de cliente ni turno. Reutilizar normalización/scoping existentes sin findOrCreateCustomerByPhone (actualiza datos/marketing). No listado/búsqueda parcial general ni exposición de ficha ajena. Mantener flujos existentes de usuarios con permisos de Clientes y clientes seleccionados. No nueva UI/formulario ni cambios de escalado; no alert/confirm/prompt.
Autorización local solamente; sin Railway, base remota, publicación, credenciales o restartBarber. Rama actual codex/new-bot-multivertical, preservar dirtyfiles ajenos.

## Ruta, checks y entrega
Delegated direct: mapping4+ completado; writer por preparación y2+fuentes no triviales. TDD STRICT configuración vigente sesión/E2.25 en odd/tasks/nuevo-bot-reservas.md; runner node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts. RED observado antes fuentes, GREEN y regresiones permisos/routes/agenda/UI. test:text-encoding antes commit, diff; no pruebas remotas. RDD ONglobal, frontera882b0c2 pendingmedium48authored; assess por commit y transición nativa si corresponde. Engram mem APIs ausentes: espejo odd/staff-appointment-existing-customer/tasks pendiente, recuperación local.
Forecast200–350authored orientativo, no cap; ask-on-risk, feature-branch-chain elegida sesión, sin PR/push. Commits Conventional Commit locales incluyen tests/docs, evidencia por tarea. No publicación autorizada por checkbox.

## Tareas
- [ ] S1 — Resolver cliente existente por teléfono exacto dentro del alta de turno y conectar formulario staff sin POST/GET de Clientes. Ruta delegatedwriter; tests exactmatch, formato, absent/ambiguous, business/professional boundaries, permissions and no customer/marketing mutation. Commit coherente backend/frontend y pruebas.
- [ ] S2 — Verificar regresiones y cierre documentado; distinguir prueba local de producción no actualizada. Padre verificación/cierre, commit documental si necesario. Baseline staff-secretary-contract-test falla etiqueta20vs15 ya observado, conservar sin suavizar.

## Progreso y recuperación
Exploración completada; implementación no iniciada. Próximo escritor debe leer este archivo antes fuentes; parent controla producto, commit y revisión. No consultas a base ni datos reales.

S1 implementado: customerPhone selector exclusivo de customerId, lookup exacto normalizado readonly tras autorización del profesional/negocio; límite2 rechaza ambigüedad. Reusa cliente ya existente y omite alta/edición/marketing. Formulario staff sin create o view Clientes envía sólo Agenda, oculta/guarda búsquedas y mantiene nombre readonly/teléfono usable; permisos completos conservan flujo. RED previo10fallos2baselinePASS, luego GREEN17 verificaciones observadas padre incluyendo SQL real PGlite ficticio y handlerCRM ejecutado. Tests OWN/tenant, inválido/ausente/ambiguo, selectorconflict, force/Caja/disponibilidad preservados. No fuentes auth-guard/roles/permisos generales alteradas.
Regresiones PASS: búsqueda/edición clientes, sin teléfono, pagos, override, payload, seña, agendascope y sintaxisCRM. Tres contratos generales FAIL exactamente en snapshot7d54b57 anterior: layout falta appointment-finance-price, bajaMarketingassert124, secretaría20vs15assert127. Baseline inicialPHONE/secretary noenv falló import; rerun sólo DATABASE_URL ficticia127.0.0.1:1 (sin credenciales) llegó a mismosasserts. Ninguna prueba suavizada. Sin prueba visual navegador ni typecheckglobal nuevos; sin servidor/prod actualizados.
