# Recordar el filtro de profesional de Agenda por perfil

## Objetivo, problema y autorización
El usuario pide que staff/secretaría conserve el profesional elegido al cerrar y volver a abrir la Agenda en su teléfono. El filtro actual sólo vive en el DOM y se pierde al recargar. Orden explícita14/10/2026: «quiero sumar un arreglito ... al cerrar y abrir se perdía el filtro ... mantenerlo para ese perfil». Autoriza desarrollo LOCAL; no publicación, Railway, base real, sesión remota, WhatsApp, nuevas migraciones, push/merge ni compartir código. El permiso anterior publicaba exclusivamente el paquete invitado a5d36de6, no estos nuevos cambios.

## Exploración y decisión acotada
Mapeo read-only delegado guest_web_ui_writer por4+archivos/preparación: crm-ui, auth/me, professional route, auth-guard y regresiones. currentUser.id estable más role/staffProfile y businessId están disponibles. No endpoint/modelo de preferencias de Agenda reutilizable; existen localStorage de tamaños/emojis, no helper scoped equivalente.
Guardar sólo el ID del profesional (o vacío=Todos) en almacenamiento local del navegador, con clave versionada por usuario autenticado+rol/perfil+negocio. Es preferencia de este dispositivo, no sincronización entre dispositivos ni cambio de permisos. No guardar tokens, credenciales, teléfonos ni datos de clientes. Aislar claves evita mezclar otra cuenta/negocio del mismo teléfono.
Restaurar después de cargar catálogo autorizado; no consumir/borrar una preferencia válida mientras el catálogo todavía carga. Sanitizar contra profesionales activos del negocio y alcance STAFF/OWN (sólo su professionalId), sin sustituir injectStaffAgendaScope. Profesional eliminado/inactivo/acceso retirado o almacenamiento malformado/bloqueado: fallback seguro Todos, Agenda funcional. Cambio de scope no hereda DOM del anterior; respuesta/carga antigua no debe restaurar otro negocio.
Persistir únicamente elecciones explícitas en selector principal, pestañas, selector móvil y encabezado de columna. No convertir selección temporal por navegación a un turno/impacto en preferencia persistida. No campos/modales nuevos, nueva tabla ni migración; mantener jerarquía responsive/foco de los controles existentes y no usar alert/confirm/prompt.

## Ruta, TDD, entrega y memoria
Substantial ODD delegated-direct. A1 mapping4+ y writer2+no triviales (CRM+regresión); A2 verificación acotada delegada, parent observa/commits. No SDD ni task ajena sobrescrita. Rama codex/new-bot-multivertical, baseactual8fd2e0d; seis dirtyfiles ajenos y13commitsbot pendientes se preservan. Cambio futuro se aplica como patch aislado a publicación invitada a5d36de6, nunca HEAD entero.
TDD STRICT heredado E2.25 y odd/tasks/guest-web-booking.md/public-registration-phone.md; runner `node node_modules/tsx/dist/cli.mjs scripts/<suite>-test.ts`. Exigir RED observado antes de cambiar fuentes, GREEN y refactor; pruebas de DOM/handlers y storage real simulado, no sólo substrings. Regresiones: agenda-business-scope, agenda-default-view, agenda-prefetch-navigation, staff-secretary, crm-ui-inline-syntax y npm run test:text-encoding; git diff --check antes de cada commit. Datos/DB/red sólo ficticios, DOTENV_CONFIG_PATH inexistente/DBloopbackpuerto1 antes de imports.
Forecast200–400authored orientativo (código+tests+docs),400 es heurístico/no cap: no omitir negativos/minificar/dividir artificial. Entrega ask-on-risk; feature-branch-chain previamente elegida por usuario («rama actual/publicar al final») se conserva, no PR/push/merge autorizados. CommitConventional porunidad funcional/verification y registrar hash al observar, no marcar checklist por intuición.
RDD ON user-owned; omisiones anteriores eran otros bloques, no ésta. Evaluar commit desde boundaryb15b7ba con nativeassess ySTATUS mismo selector cuando debido. Inventario anterior91738 excede8MiB: unavailable no riesgo bajo/receipt ni autoriza compartir código/cambiarsettings/ignores. Revisión externa requerirá decisión específica si procede; conservar comprobaciones funcionales aunque native no inicie.
Engram mem_* no expuesto (discovery vacía): espejo odd/agenda-professional-filter-persistence/tasks y mem_session_summary pendientes; documento local recuperación, no guardar/sincronizar remoto afirmado.

## Tareas y criterios de aceptación
- [x] A1 — Persistencia scoped implementada y14/14GREEN observado por parent. RED original1PASS10FAIL antesdeCRM; reanudación11PASS2FAIL porrefresco pendiente/catálogoobsoleto yRED13PASS1FAIL porselectHTML descarta valorantescrearoptions, todoscorregidos. Guardiasbackend/OWN intactas. Writerdelegadoprep/2+fuentes yparent repitióscope/default/prefetch/inline2/encoding/diffPASS. staff-secretary20vs15 FAIL conservado (HEADtambién20, prueba/permisos intactos). Fuentes congeladas hashCRM E4A506DA051B99F9C84100C3E5093CE276DB5F049B0FF3D37764658F757EDDA9; commit funcional de esta unidad se guarda a continuación.
- [ ] A2 — Verificar navegador offline escritorio/móvil: selección de un profesional, recarga/mismo perfil, Todos, cambio scope, controles móviles, sin desborde/errores nuevos ni requests reales. Verifier delegado; parent observa evidencia/actualhash y npmencoding/diff, cierra documento/commit y reporta límites. No publicación automática por permiso viejo.

## Estado y siguiente paso
Exploración y A1 cerrados; documento creado antes de primera escritura de fuentes. Writerinicialguest_web_ui_writer fue interrumpido trasRED/fuentes y agente ya no estaba activo; agenda_filter_resume recuperó documento/diff, observóRED adicionales yGREEN real. A2 delegado a agenda_filter_browser_verify sólo después de freeze final; primerfreeze13tests reabierto al detectarselectsemantics, no afirmar browserPASSporVM. Outcome de storage no valida permisos remotos ni sincronización entre dispositivos.

## Verificación y límites A1
Parent repitiórunner exacto14/14, agenda-business-scope/default-view/prefetch-navigation ycrm-ui-inline-syntax(2) PASS. Las cuatroelecciones explícitas llaman remember; restauración ocurre despuésdecrearoptions reales, en scope autenticado/negocio/catálogocargado. Staleproresponses tienen generationguard y scopecheck; cambio de filtro por impacto no persiste. localStorage guarda sóloIDoTodos, no datoscliente/token; fallbackcorrupt/denegado/sinauth/invalidprofessional mantieneAgenda.
Regresión staff-secretary falla por assertionglobal de15labels pero encuentra20. Writercomprobóconteo20 enHEAD yfuenteactual; ningún cambio depermiso ni prueba borrada/suavizada. No checkoutbaseline ejecucióncompleta independiente, por eso noafirmar suitebasePASS. Este fallo no demuestra pérdida de filtro y queda registrado pendiente. No tsc/buildglobal ni Safari/iPad/servidorreal/Google/WhatsApp, sin sincronización entre equipos.
RDD primera lectura sandbox imprimióoffpero terminóAccesodenegado: no estadoefectivo válido. Lectura metadata autorizada posterior exit0 confirmóglobalON/cloneunset; no toggle. Revisiónnativa porcommit a continuación, sin inferir autorización de la omisión anterior invitado. mem_* todavía ausente: mirrorfulltopic ysession_summary no disponibles, recuperaciónlocalcompleta.

## Session recovery
### Goal
Conservar el profesional filtrado de Agenda al reabrir, aislado por cuenta/perfil/negocio en ese navegador.
### Instructions
Usuario quiere preferencia personal de staff/secretaría en móvil. Local únicamente; no bot, pagos, permisos, migraciones o despliegue por inferencia.
### Discoveries
- DOM mantiene filtro durante render normal, pero no existe preferencia persistida.
- /auth/me incluye identidad estable; catálogo general no filtra OWN, por eso el filtro guardado también debe validar alcance.
- Navegación temporal de impacto cambia selección y no es elección persistida del usuario.
### Accomplished
- Mapeo/delegación/RED/GREEN14 y regresiones observadas de A1, guardias ydatos preservados. Encoding/diffPASS; commit funcional pendiente inmediato. Fuente congelada para A2 navegador.
### Next Steps
- Guardar A1 y verificarA2 navegador; permisos/backend permanecen sin cambios. RDD/mirror ystaff-secretaryglobalcount pendientes honestos, no afirmar todosloschecksPASS. No publicar por autorización vieja.
### Relevant Files
- src/routes/crm-ui.ts — init/load/render filtros y cuatro elecciones explícitas.
- src/routes/auth.ts, src/routes/professional.ts, src/plugins/auth-guard.ts — identidad/alcance actuales, sólo inspección.
- scripts/agenda-business-scope-contract-test.ts, agenda-default-view-contract-test.ts, agenda-prefetch-navigation-contract-test.ts, staff-secretary-contract-test.ts y crm-ui-inline-syntax-test.ts — regresiones existentes.
- scripts/agenda-professional-filter-persistence-test.ts —14casos dehandlers/carga/storage/select generado, conredsgenuinos ygreen.
- odd/tasks/agenda-professional-filter-persistence.md — feature document y recuperación local.
