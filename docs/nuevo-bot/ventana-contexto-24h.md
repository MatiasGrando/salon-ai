# Ventana de contexto de 24 horas — expiración lazy

## Decisión y alcance

Opción A elegida el 2026-08-30: comprobar vencimiento cuando el worker procesa
el siguiente mensaje del cliente, antes de clasificar su selección. No agregar
cron, reaper ni consultas periódicas. Es una ventana de inactividad del contexto
del bot; no modifica las políticas de envío del proveedor.

Implementación local; esta entrega no incluye despliegue.
Usa los campos existentes `BotSession.draftTouchedAt` y `draftExpiresAt`;
no requiere una migración de esquema.

## Comportamiento

1. La actividad nueva del cliente renueva el plazo a 24 horas transcurridas.
   No hace falta que sea una selección válida. Esta decisión sustituye el criterio
   anterior de «última acción válida» para esta ventana.
2. El reloj usa `providerOccurredAt`, acotado por `admittedAt`; si no existe,
   usa `admittedAt`. No usa el momento en que finalmente corre el worker.
   Duplicados y eventos anteriores no retroceden el reloj.
3. Si el siguiente mensaje llega exactamente al vencimiento o después,
   un contexto no protegido vuelve al menú inicial. Una selección de un botón
   anterior que dispara esa expiración no se ejecuta contra el nuevo contexto.
4. La respuesta explica que pasaron 24 horas y que los turnos y datos siguen
   guardados, y ofrece el menú con nuevos botones.
5. El reinicio aumenta la revisión e invalida los prompts anteriores.
   Los trabajos conversacionales anteriores elegibles quedan retirados como
   `DONE / CONTEXT_EXPIRED`; sus entradas como `STALE`, y los envíos seguros
   todavía no realizados como `SKIPPED`. No se eliminan filas de auditoría.
6. Sin mensajes nuevos no se hace nada: una sesión abandonada puede seguir
   figurando abierta. Antes del vencimiento se mantiene el recorrido existente;
   esta entrega no agrega la pantalla pendiente de Continuar/Empezar de nuevo.

## Protecciones

- No borrar conversaciones, mensajes del CRM, clientes, turnos confirmados,
  señas, comprobantes ni registros de atención humana.
- No resetear sesiones no activas, derivaciones pendientes/tomadas, reservas
  retenidas ni pagos en revisión. Se comprueba tanto el estado del motor como
  las entidades durables de reserva y handoff.
- Imágenes y documentos conservan su procesamiento especializado para no
  descartar un comprobante por vencimiento del contexto.
- Los trabajos de seña y otros trabajos financieros no se retiran.
- Ante trabajadores o envíos todavía en curso se difiere el procesamiento del
  evento, devolviendo el intento consumido. No se resetea debajo de un envío.
- Un envío `UNKNOWN`, o pendiente sin prompt asociado a su grupo, protege
  el contexto. No se reenvía automáticamente ni se supone que falló.
- Un lease vencido anterior al envío puede retirarse; `SENDING` no se trata
  como un envío seguro para descartar.
- En flujos protegidos, la actividad puede renovar la ventana, pero no extiende
  el vencimiento financiero de la seña ni quita una derivación humana.
- No reemplaza la recuperación general de POISON ni soluciona estados corruptos.

## Compatibilidad inicial e idempotencia

- Sesiones existentes sin `draftTouchedAt`: el primer mensaje inicia el reloj
  sin descartar de golpe el contexto existente. Se necesitan otras 24 horas
  de inactividad para que esta ventana lo expire.
- Sesiones nuevas inicializan ambas fechas desde el evento que las originó.
- Expiración, invalidación, nuevo menú y auditoría `system.context_expired`
  se escriben en una transacción. Ante fallo se revierte todo ese conjunto.
- La proyección entrante del CRM mantiene su commit independiente anterior:
  un fallo posterior de clasificación no elimina el mensaje recibido.
- El webhook conserva journal durable y ACK después de commit; la nueva
  comprobación se hace fuera del webhook. No implica una mejora de latencia:
  agrega lectura/bloqueo y, con nueva actividad, actualización en el worker.

## Verificación local

- `npm run test:bot-options-context-window`: límites temporales, reloj móvil,
  orden de eventos, flujos protegidos y ejecución del worker con dobles de DB.
- `npm run test:bot-options-context-window-sql`: SQL real con PostgreSQL/WASM
  (PGlite), transacciones y rollback, unicidad de prompt, aislamiento entre
  comercios, leases y protección financiera. Datos sintéticos en memoria;
  no utiliza credenciales ni endpoints productivos.
- Suites existentes de journal, reinicio, timeout, admisión, dominio, prompts,
  renderer y proveedores, más comprobación de codificación.

Limitación: PGlite prueba el SQL en un backend único y esquema mínimo del test;
no sustituye la prueba de concurrencia entre conexiones de PostgreSQL nativo
ni una validación del esquema completo migrado. Esa prueba y la verificación
del comportamiento en el comercio piloto quedan pendientes antes de dar por
validado el despliegue. No se ejecutaron builds ni se modificó producción.

El chequeo global de TypeScript no está verde: reporta errores preexistentes,
entre ellos el parámetro opcional `cursor` en `process-session-job.ts`, confirmado
contra HEAD. No se corrigieron errores ajenos a esta entrega. La suite global
de transición también comparte cambios con la tarea paralela de bienvenida;
no confundir sus pruebas en desarrollo con una validación completa de release.
