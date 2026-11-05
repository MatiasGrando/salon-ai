# Navegación central de reservas y anticipación de cancelación

## Objetivo y autorización
2026-11-05: centralizar los enlaces públicos de reserva y cuenta en https://weex.com.ar/{slug}/reservar y /cuenta; volver a la página propia del comercio. Aplicar una regla compartida a las plantillas y adaptar las portadas personalizadas existentes. Mantener los accesos directos de subdominio y central, la navegación interna de reprogramación, autenticación, cookies y diseño.

Corrección más reciente del usuario: anticipación 0 solamente para La Cochera; todos los demás negocios conservan sus valores. La autorización anterior de poner todos en 0 queda reemplazada. Añadir editor en minutos en Landing para cada negocio. Conservar el predeterminado general actual (60 minutos), la anticipación de reprogramación y las reglas de pagos. 0 permite cancelar hasta antes del inicio, no turnos pasados. Preparar migración limitada a La Cochera, sin ejecutar consultas o modificaciones de DB en esta sesión. No push, despliegue ni reinicio autorizados en este bloque.

## Exploración y decisiones
Mapas delegados leídos: landing-ui genera destinos locales en tres plantillas, reserva y cuenta; custom-site-profile-binding identifica el hostname de perfiles cuyo slug puede ser distinto. La Cochera, Tamara, Yamila y Natura tienen botones propios. Glow ya centraliza por sede y conserva su selector. No cambiar portadas sin botones.

BusinessBotOptionsSettings.cancellationLeadMinutes ya existe, predeterminado 60. Web y bot usan el mismo campo; web exige turno futuro y anticipación suficiente. Usar un GET/PATCH dedicado booking-management-settings con los permisos existentes evita modificar el contrato de cortes de availability-settings. No alterar la excepción conversacional existente de WhatsApp ni introducir otra política paralela. La migración usa Business.slug único igual a lacochera, actualiza su fila y crea la configuración si falta usando sólo la zona horaria ya configurada; no inventa zona ni modifica otros negocios. Sin configuración de zona, la creación queda omitida y requiere configurar el negocio antes de guardar.

## Tareas y rutas
- [x] N1 — Delegated direct: helper puro compartido y navegación de plantillas, reserva y cuenta. Rutas internas de reprogramación conservadas en su origen. Trigger: preparación delegada y fuentes no triviales múltiples. Padre revisó helper y diff; sintaxis TS y JS inline, UTF-8, diferencias y codificación PASS. Navegación real pendiente, no se ejecutaron flujos.
- [x] N2 — Delegated direct, misma unidad de navegación: adaptadores personalizados y enlace dinámico Natura, conservando gates y Glow. Trigger: múltiples adaptadores y archivos de portada. Padre revisó guards y destinos; JS dinámico escapado antes de innerHTML. Mismos checks estáticos PASS.
- [x] C1 — Delegated direct: editor numérico en Landing y GET/PATCH protegido, valores enteros >= 0, conserva valores no enviados y permisos existentes. Migración UPDATE/INSERT sólo slug lacochera; general 60 y otros negocios intactos. Trigger: API, CRM y migración no triviales. Padre revisó diferencias y SQL selectivo; no se ejecutó la migración.
- [x] V1 — Sintaxis, diferencias, UTF-8 y codificación PASS; editor observado en fixture con CSS/markup reales a 1440 y 390 sin desbordes. Etiqueta/ayuda/foco/error correctos y contenido escala al heredar fuente de 16 a 24 px. Formulario existente resize:none. Sin DB, Google, turnos reales o servidor. Guardado de la unidad y evaluación final se registran al observar sus identidades.

## Comprobaciones y entrega
TDD STRICT heredado, limitado por preferencia explícita de no ejecutar flujos, suites, IA/DB, tipos, build o reinicios. No declarar RED/GREEN. Sí: parseo TS/JS inline sin importar aplicación, invariantes estáticas, UTF-8, git diff --check y npm run test:text-encoding antes de cada commit. Runners relacionados existentes test:booking-theme-ui y contratos de perfiles/settings; no ejecutarlos. Editor integrado en el formulario Landing existente, con etiqueta, ayuda, foco/error y adaptación móvil/escritorio, sin nuevo modal.

Base main e3f2580; rama codex/central-booking-navigation. Forecast orientativo 300–420 líneas authored, revisar alcance antes de cada commit. Entrega ask-on-risk; elección previa feature-branch-chain conservada si hicieran falta segmentos, sin PR solicitado. RDD ON; frontera de revisión anterior e02b8ff con 178 líneas pendientes under_budget. Evaluar cada unidad committed-only; consentimiento por candidato si corresponde, sin enviar código por defecto.

Engram no disponible: espejo odd/central-booking-navigation/tasks pendiente. Este documento conserva el contexto completo y su locator odd/tasks/central-booking-navigation.md.

## Progreso
N1/N2 guardados en 477167d, unidad coherente de navegación con siete fuentes y documento; sin reescribir imágenes/base64. Primer assessment rechazó el inventario no declarado de la migración todavía no guardada. Se consultó STATUS y se declaró su exclusión exacta para committed-only; assessment corregido desde e02b8ff: medium, 303 líneas acumuladas, review_due=false/under_budget. Sin revisión externa ni código compartido.

C1: tres archivos propios, aproximadamente 134 líneas authored. Padre revisó API/CRM/SQL; TS parseado sin importar app, tres funciones inline modificadas parseadas sin ejecutar, UTF-8, invariantes de migración y npm run test:text-encoding PASS. El primer harness de JS completo no reconstruyó interpolaciones; se limitó a las funciones cambiadas y no se afirma parseo completo del CRM. No pruebas de guardado ni ejecución de migración. Foto del editor aislado observada en cancellation-editor-preview/desktop-initial.png y mobile-error.png bajo la raíz de visualizaciones de esta conversación; no son capturas de la aplicación real.

El cambio a 0 entra en vigor al aplicar la migración durante un despliegue posterior. Si La Cochera carece de fila de settings y zona horaria configurada, INSERT se omite para no inventar zona. Prueba manual de navegación, Google y gestión de turnos pendiente. Engram pendiente. Próximo paso: guardar C1 y consultar evaluación nativa del candidato, sin reinicio ni publicación.
