# Historias disponibles desde la conexión de Instagram

Todos los comercios con Instagram conectado pueden usar Historias. La publicación automática usa la conexión que el comercio configuró. Meta valida el permiso al publicar. Weex debe indicar problemas concretos de conexión, servidor o almacenamiento.

- [x] IC1. Separar la disponibilidad, procesamiento y retención de Historias de los interruptores y la lista de Reels en Railway. Conservar los límites de Reels y comprobar el alcance por negocio.
- [x] IC2. Quitar la confirmación manual como requisito, usar la conexión vigente y mostrar los fallos específicos en Historias. Diferenciar las acciones disponibles en cada modalidad.

TDD estricto según `openspec/config.yaml`. Contratos de runtime, publicación, retención, rutas e interfaz de Instagram, sintaxis CRM y UTF-8. Forecast aproximado 250–400 líneas. Estrategia ask-on-risk. Alcance local. Espejo Engram pendiente por falta de herramienta.

Se intentó delegar ambos cambios por abarcar varios archivos. Los agentes quedaron sin cuota, por lo que la implementación continuó de forma directa. RED de disponibilidad de Historias con configuración vacía, GREEN en pruebas de Historias, rutas y aislamiento por comercio, runtime, publicación, retención, manual de operaciones, sintaxis y UTF-8. Las pruebas usaron datos simulados. Pendiente verificar una publicación real después del despliegue autorizado.
