# Recuperación general de consultas iniciales y redacción

## Objetivo y autorización
2026-11-03: el usuario pide corregir las restricciones que producen «Mantengo los datos del pedido. ¿Qué dato querés elegir o cambiar?» al pedir corte o asesoramiento general después de reset, en números nuevos y existentes. La IA interpreta y redacta; el programa valida catálogo, agenda, titularidad, consentimiento y efectos reales. No resolver mediante listas de frases aceptadas ni respuestas específicas a estos ejemplos.

Base main publicada 9d5c01b421fc327348478ab986e8bdf6c9c54c13; rama de trabajo codex/barber-initial-intent-recovery. Cambios locales de esta corrección; sin push, reinicio de servidor, mensajes, DB, modelos, migraciones ni reservas. Conservar todos los cambios integrados y no ampliar cancelación/reprogramación.

## Evidencia y corrección del diagnóstico
Mapa delegado initial_intent_recovery_map por cuatro o más fuentes/preparación. communicative-act filtra operaciones antes del motor; el motor corta ante blockedFields y la frase general es obligatoria en communicativeClarification. Catalog_navigation exige contexto previo en admisión y motor, lo que bloquea exploración inicial sin categorías presentadas. La clasificación general de information/business/SERVICES puede discrepar con el acto semántico service.

El log real indica interpretación aceptada, descarte opcional de encuadre identity_in_frame y segunda redacción aceptada, no rechazo global por identidad. La lista validationAcceptedKinds omite tipos existentes: [] NO prueba por sí solo que el plan haya quedado vacío. No afirmar cuál operación fue descartada sin evidencia; ampliar diagnóstico con enums/razones acotadas, sin texto, IDs ni contenido del cliente. El filtrado completo silencioso debe distinguirse de un mensaje legítimamente sin operaciones.

## Tareas y ruta
- [ ] I1 — Recuperar consultas iniciales de catálogo e intención útil, coordinando admisión y motor; mantener separadas lecturas, selección y operaciones materiales. Registrar admisión/rechazos sin datos sensibles. Ruta delegated direct, writer coherente por seis fuentes potencialmente no triviales; mapeo/preparación delegados. Commit y evidencia pendientes.
- [ ] I2 — Conservar redacción útil al descartar identidad opcional; aclaración contextual con una sola pregunta, sin imponer el fallback genérico ni duplicar encuadre/pregunta. Reparación únicamente dentro del presupuesto existente y sin repetir efectos. Misma unidad delegada por interacción con I1; sin selección inventada ni desprotección de datos concretos. Commit y evidencia pendientes.
- [ ] I3 — Verificar estáticamente preservación de guardas, diagnóstico, sintaxis/UTF-8 y documentar límites; guardar unidad de trabajo. Ruta inline padre para integración y cierre, verificación acotada delegada si corresponde. Commit pendiente; calidad WhatsApp y aceptación funcional pendientes del usuario.

## Aceptación y límites
Una consulta inicial o después de reset no requiere un menú previo para leer el catálogo vigente. Navegar no añade ni reemplaza servicios; la selección continúa requiriendo IDs actuales. Una descripción amplia o ambigua permite a la IA preguntar o presentar alternativas reales, sin inventar que el local ofrece prestaciones. No omitir restricciones de tenant, catálogo vigente, versión/tokens nativos, disponibilidad, pagos, consentimiento ni efectos.

Las operaciones materialmente rechazadas no se aceptan por simpatía ni por palabra clave. Una interpretación sin operaciones válida se diferencia de una interpretación cuyo contenido útil fue totalmente descartado; la reparación conserva los límites existentes. identity_in_frame afecta sólo el encuadre no utilizable, conservando contenido y partes independientes validadas cuando sea seguro. Sin tercera llamada por identidad, sin inferir identidad incorrecta como válida y sin duplicar preguntas.

## Configuración y comprobaciones
TDD STRICT heredado de odd/tasks/barber-time-and-catalog-intake.md y barber-partial-reply-recovery.md. La instrucción explícita posterior del usuario de omitir pruebas sintéticas/flujos, tipos y compilación prevalece: no ejecutar suites ni inventar RED/GREEN. Runner obligatorio antes de commit: npm run test:text-encoding (tsx scripts/text-encoding-contract-test.ts). Sintaxis TypeScript sin ejecución, UTF-8 estricto, git diff --check y lectura de rutas de autoridad. No aplicación/DB/IA ni reinicio. Aceptación real posterior por el usuario.

Forecast orientativo 200–450 líneas authored, no cap ni motivo para minificar o fragmentar artificialmente. Estrategia feature-branch-chain previamente elegida; sin nueva publicación ni PR en esta fase. Una unidad funcional coherente puede cerrar I1/I2 juntas. RDD conserva ON global; omisión anterior correspondía al candidato de integración y no se hereda para este. Assess/preflight del work-unit al cerrar, revisión externa sólo con consentimiento del candidato.

Engram mem_* no disponible tras discovery: espejo odd/barber-initial-intent-recovery/tasks pendiente. Documento local recuperable creado y leído antes de fuentes. No se afirma espejo ni aprobación guardados.

## Progreso
Writer initial_intent_recovery_map leyó el documento y completó una unidad coordinada en siete fuentes: communicative-act, engine, ai-interpreter, ai-diagnostics, reply-contract y dos guías. Ajuste adicional mecánico de openai-interpretation-provider justificado por evidencia: las categorías actuales ya llegaban antes del menú, pero la guía exigía expectedAnswer.role=category. Sin nueva capa léxica ni cambio de modelo.

I1 implementado: navegación extra inicial acotada a pending service, cesta vacía y sin reserva/sandbox/gestión; la navegación previamente presentada conserva su vía contextual. Ambos límites (admisión/motor) coordinados y catálogo actual revalidado por negocio. SERVICES puede pertenecer al acto service/general sin autorizar selección. Rechazos cerrados por tipo/campo/razón, inventario completo de operaciones (incluida professional_reference), feedback y proyecciones de diagnóstico sanitizados. Un descarte total usa sólo el segundo intento de interpretación existente; si persiste se identifica como aclaración, sin fingir una adquisición exitosa.

I2 implementado: aclaración semántica transitoria con una pregunta IA que reemplaza procedure/next, sin convertir encuadre en autoridad de datos/efectos. Se descarta cada componente completo con identidad no utilizable, conservando componentes independientes previamente validados; no se rescatan fragmentos. Dos llamadas totales en recuperación de admisión/identidad, presupuesto anterior de otros circuitos preservado. Intro configurada única y guardas materiales intactas.

Comprobación del writer y del padre: siete fuentes UTF-8 estrictas, sintaxis TypeScript sin ejecutar aplicación y cero marcadores PASS; git diff --check PASS. npm run test:text-encoding PASS. Fuentes congeladas: 157 adiciones y 65 eliminaciones, 222 líneas authored, más este documento. Padre revisó ramas de lectura inicial/presentada, datos actuales, tokens nativos separados, interceptores de gestión anteriores, alcance de reparación y proyección privada de diagnóstico. Un primer guard de presupuesto demasiado amplio se acotó antes de congelar; no se cambian otros circuitos.

TDD/red-green, suites, tipos, build, aplicación, modelos, DB, reinicio y aceptación WhatsApp OMITIDOS/PENDIENTES por las restricciones vigentes, no se afirman comprobados. RDD ON global confirmado con consulta autorizada; no revisión externa iniciada. Próximo paso: commit de la unidad y assessment nativo, registro de evidencia. Espejo Engram sigue pendiente por falta de herramientas.
