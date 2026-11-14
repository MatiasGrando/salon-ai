# Nuevo bot predeterminado para Instagram

- [x] IG2. Corregir el contrato de reprogramación de Instagram. RED en main con texto libre sin intérprete. GREEN con confirmación numerada y con «Sí, dale de una» interpretado mediante IA simulada, ambos con cambio persistido. Ruta delegada directa. Runner focalizado `node --import tsx scripts/instagram-shared-bot-runtime-test.ts`.

Autorizado el 14/11/2026. El comercio ya conectado y las cuentas que se conecten después deben poder reservar con el Nuevo bot de Instagram sin configurar WhatsApp ni agregar cada comercio a una lista.

- [x] IG1. Preparar y asignar la configuración inicial de Instagram automáticamente para cuentas conectadas y aptas. Cubrir la conexión ya existente y las nuevas. Conservar asignaciones activas, permisos, pausas, estados protegidos y el alcance de los trabajadores. Actualizar el mapa del módulo y verificar regresiones de los dos canales.

Ruta delegada directa por mapa de cuatro o más archivos y escritor de varios archivos. TDD STRICT heredado de nuevo-bot-reservas. Runner `npm run test:instagram-shared-bot`. Forecast 250–400 líneas. Estrategia feature-branch-chain previamente elegida. Alcance local, sin despliegue ni cambios a la base remota.

RED observado en el modo general y en el guardado de Configuración sin WhatsApp. GREEN en activación inicial, deduplicación, pausas, asignación existente, configuración de Instagram, webhook y enrutamiento comercial. La suite integral termina en la aserción de reprogramación anterior (10:00 frente a 11:00), reproducida en un archivo aislado de main. Queda comprobar una reserva por DM en el entorno activo una vez desplegado y habilitado el modo general.
