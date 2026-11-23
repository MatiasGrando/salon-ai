# Permisos de completar y cobrar turnos propios

Usuario autoriza opciones independientes en crear/editar staff para marcar completado y registrar pago de turnos propios. Pago ya existe pero se oculta al profesional; completar usa editar. Agregar permiso específico sin conceder administración de Caja ni acceso a turnos ajenos. Preservar capacidades existentes al migrar, sin activar pagos de forma general.

Base 4d5a023, rama existente codex/instagram-pantalla-principal. Ruta delegada por mapeo de 4+archivos y escritura multicomponente (UI/persistencia/auth/guardas/tests). TDD estricto openspec/config.yaml strict_tdd:true; runner node node_modules/tsx/dist/cli.mjs. Entrega auto-chain con feature-branch-chain heredada; sin push/PR/deploy. Forecast 600–1000 líneas orientativo,400 por tarea no hardcap. No ejecutar migraciones contra bases compartidas ni usar credenciales remotas sin autorización explícita.

- [x] P1. Permisos independientes crear/editar/presets/persistencia/auth y UI Agenda: completar, registrar pago. Conservar acceso anterior a completar para cuentas existentes mediante backfill desde editar; pago conserva sus valores actuales.
- [x] P2. Guardas de servidor para completar y operaciones financieras, incluidos pago+completar, verificando negocio y profesional propio; sin IDOR ni concesión de administración de Caja.
- [ ] P3. Regresiones funcionales de permisos, matriz de combinaciones/roles/own-scope, sintaxis/encoding y migración como artefacto. No aplicar DDL remoto. Informar cualquier paso de base de datos pendiente antes de probar el preview si falta columna.

Engram no disponible: espejo odd/staff-complete-payment-permissions/tasks pendiente. Documento local leído; preservar todos los cambios ajenos de Caja/Agenda. Revisión anterior pendiente no constituye autorización de revisión para este bloque.

## Evidencia de implementación delegada

P1 implementado: canCompleteAppointments separado; pagos reutiliza capacidad, formulario y guardado staff existentes. Controles visibles para profesional al crear/editar; presets de edición conservan completar, pago mantiene default false. Migración código prisma/migrations/20261123190000_staff_completion_permission/migration.sql agrega columna false y backfill desde canEditAppointments. Migración NO aplicada a ninguna base compartida. Requiere generar cliente Prisma y aplicar DDL autorizado antes de usar el preview con la columna nueva.

P2 implementado: estado COMPLETED y pago+completar exigen capacidad independiente. Finance/estimated-total/adjust-total/discount/payments validan turno y profesional propio. Cuatro mutaciones financieras además reciben allowedProfessionalId y validan bajo FOR UPDATE OF appointment antes del backfill o escritura. Profesional no revierte entradas de Caja; capacidades administrativas permanecen separadas.

P3 evidencia: RED observado por permiso inexistente, luego GREEN. Segundo RED por completar todavía dependiente de editar, luego GREEN. Tercer RED simula reasignación concurrente y demuestra llegada indebida a cuenta financiera, luego GREEN con bloqueo propio antes de efectos. Prueba nueva scripts/staff-complete-payment-permissions-test.ts pasa modelo, matriz Fastify offline, denegación de IDs ajenos/inexistentes sin efectos, rechazo transaccional de cuatro mutaciones, controles UI y migración PGlite aislada preservando valores anteriores.

Checks PASS con node node_modules/tsx/dist/cli.mjs: staff-complete-payment-permissions-test.ts, staff-secretary-contract-test.ts, cash-permissions-contract-test.ts, cash-routes-contract-test.ts, appointment-completion-payment-contract-test.ts, agenda-payment-method-loading-test.ts. Regresiones importando Prisma se ejecutaron con DATABASE_URL offline ficticia 127.0.0.1:1; sin acceso a datos reales. Staff-secretary tenía recuento rígido obsoleto 15; se reemplazó por comprobaciones concretas de controles exclusivos. npm run test:text-encoding PASS; transpileModule verificó sintaxis de 11 archivos modificados.

Typecheck completo node node_modules/typescript/bin/tsc --noEmit NO completado: proceso terminó exit134 por JavaScript heap out of memory, sin diagnósticos TypeScript. No se amplió investigación ni se ejecutó build. Visual desktop/móvil y preview pendientes de migración/cliente; no se reinició servidor.

Cierre de tareas/commits y RDD a cargo del padre; trabajador no creó commits. Aproximadamente 225 líneas nuevas/modificadas de implementación y pruebas (sin documentos ajenos); revisar git numstat al commit. Engram no disponible, espejo pendiente.


Padre verificó migración exacta (solo columna canCompleteAppointments false y UPDATE desde canEditAppointments), guardas de rutas y bloqueo transaccional. Encoding pasó antes del commit. Cliente Prisma: intento local con URL dummy, sin DDL, quedó sin salida y se detuvo para no extender diagnóstico; generación pendiente. Typecheck global sin completar por memoria y prueba visual pendiente de preparar cliente/aplicar migración autorizada. P1/P2 se confirman como unidad inseparable para no habilitar un permiso sin su propia restricción de alcance; P3 permanece pendiente.
