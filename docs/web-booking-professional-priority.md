# Prioridad opcional de profesionales en reservas web

En CRM → Ajustes → Landing pública → Orden de profesionales, activar **Mostrar primero al profesional con menos turnos** y guardar. Empieza desactivada en negocios existentes y nuevos. El perfil STAFF no puede cambiarla. Para activarla, el comercio debe tener una zona horaria IANA válida; también se puede configurar junto con la opción mediante el PATCH existente del negocio.

La ventana comprende las cinco fechas anteriores, hoy y las dos siguientes en la zona horaria del comercio. Se calcula en el servidor al cargar el catálogo, antes de elegir la fecha del turno: `[inicio(hoy - 5), inicio(hoy + 3))`. Los cambios de horario de verano se resuelven por fecha civil; no se usa una cantidad fija de horas.

Cada turno cuenta una vez, con independencia del servicio o su duración. Se incluyen realizados, confirmados y pendientes vigentes, incluidos los comprobantes en revisión. Se excluyen cancelados, ausentes y retenciones pendientes vencidas. El orden es cantidad ascendente, luego nombre e identificador para desempatar. Los profesionales sin turnos cuentan como cero.

El catálogo conserva su proyección pública de identificador, nombre y avatar. No devuelve cantidades, turnos ni información de clientes. El filtro de profesionales por servicio conserva el orden recibido. La opción sólo ordena las opciones web: no elige un profesional, no cambia una selección o un horario guardado, no modifica el flujo de varios servicios ni se aplica al bot o a reprogramaciones.

Con la opción desactivada, se mantiene exactamente el orden anterior y no se ejecuta la consulta de carga. Para revertir el comportamiento, desmarcar y guardar. La migración es aditiva; no es necesario borrar la columna para desactivar la función.

## Comprobaciones locales

`npm run test:web-booking-professional-priority` ejecuta los contratos de PATCH, persistencia, autorización, migración, agregado SQL y handlers de interfaz. Usa datos ficticios y PGlite en memoria; no conecta una base real ni proveedores. Cubre el intervalo semiabierto, varios servicios, límites exactos, zona del servidor, cambios de horario y medianoches repetidas o inexistentes, estados, aislamiento por comercio y privacidad pública. La prueba de interfaz ejecuta los handlers efectivamente entregados por el CRM y la web, con respuestas y elementos de prueba.

Regresiones aplicables: `node --import tsx scripts/public-guest-booking-test.ts`, `node --import tsx scripts/guest-web-booking-ui-test.ts`, `npm run test:public-booking-services-ui`, `npm run test:crm-ui-syntax`, `npm run test:text-encoding` y `git diff --check`.

El control visual de geometría en escritorio y móvil sigue pendiente: las pruebas funcionales con DOM/VM no lo sustituyen. El contrato completo de autorización con PostgreSQL local requiere su entorno dedicado y no se ejecutó; la nueva prueba cubre las rutas reales de autorización con almacenamiento de prueba.

## Estado de entrega

Implementado y verificado localmente el 2026-10-28. No se aplicó la migración a una base real. TypeScript global continúa FALLANDO con los 638 diagnósticos previos: el resultado final completo coincide exactamente con la línea base tras normalizar únicamente ubicaciones y CRLF, conservando orden, multiplicidad y continuaciones. No quedan diagnósticos nuevos de esta función. Evidencia: `C:/Users/cpu/salon-ai/tmp/web-professional-priority-typecheck-comparison-20261028.json`.

La rama local `codex/web-booking-optional-email` contiene la mejora previa de correo opcional y aún debe integrarse antes de publicar. Su parche de cuatro archivos pasa `git apply --check` sobre estos cambios, sin aplicarlo. La preparación de commits, revisión y publicación sigue detenida por el STOP nativo ya existente. No se reintentó la revisión ni se modificó su configuración.
