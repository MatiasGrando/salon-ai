# Nuevo bot por opciones — alcance de la etapa 1

## Estado del documento

Este documento es canónico para el alcance de la primera etapa. Los documentos
`docs/navegacion-nuevo-bot-opciones.txt` y
`docs/flujo-senas-nuevo-bot.txt` conservan el relevamiento original, pero no
deben utilizarse aisladamente para implementar el nuevo motor.

## Objetivo

Construir un bot determinístico para WhatsApp que opere mediante acciones
cerradas, no dependa de IA para interpretar la navegación y pueda recuperar
cualquier interacción inválida sin corromper el estado.

La primera etapa debe validar el núcleo mediante reservas realizadas por un solo
profesional. Puede incluir varios servicios únicamente cuando una misma persona
esté habilitada para realizar todo el carrito dentro de un bloque continuo.

## Principios obligatorios

1. Cada opción transporta una acción e identificadores estables.
2. El texto visible y la posición de una fila nunca identifican una decisión.
3. Una acción inválida, vencida o duplicada no modifica el estado.
4. Toda pantalla ofrece acceso a Volver, Menú principal y Hablar con el equipo,
   directamente o mediante una sola interacción adicional.
5. Volver utiliza transiciones explícitas, no historial de mensajes.
6. El cliente confirma toda decisión que produzca una reserva, descarte datos o
   cancele una retención.
7. La disponibilidad se revalida al mostrar opciones y antes de retener o
   confirmar.
8. Un único motor automático puede estar activo por canal y negocio.

## Recorrido implementable de nueva reserva

1. Mostrar menú principal.
2. Iniciar una reserva.
3. Buscar al cliente por teléfono dentro del negocio.
4. Solicitar y confirmar el nombre solamente si falta uno válido.
5. Elegir categoría y servicios.
6. Ofrecer complementos compatibles.
7. Construir un carrito realizable por un único profesional.
8. Elegir un profesional específico o Cualquier profesional disponible.
9. Elegir una fecha con disponibilidad real.
10. Elegir un horario.
11. Mostrar el resumen final.
12. Revalidar y retener el bloque elegido.
13. Confirmar directamente o iniciar el flujo de seña.
14. Informar el resultado final.

## Incluido en la etapa 1

### Catálogo y carrito

- Consulta informativa por categoría con lista resumida y detalle de servicio.
- Conversión opcional del detalle a reserva mediante Reservar este servicio.
- Categorías, subcategorías existentes y servicios reales del negocio.
- Paginación estable cuando una lista excede la capacidad de WhatsApp.
- Varios servicios si existe al menos un profesional común para todo el carrito.
- Recomendaciones compatibles y rechazo explícito de recomendaciones.
- Solicitud separada para coordinar manualmente servicios incompatibles.
- Recalcular duración, precio, profesionales y disponibilidad ante cambios.

### Profesionales y disponibilidad

- Consulta informativa del horario de atención del negocio y de la jornada
  configurada de un profesional, separada de la disponibilidad reservable.
- Cualquier profesional disponible o elección de una persona específica.
- Asignación por menor cantidad de minutos ocupados durante la jornada.
- Desempate por prioridad configurada y luego por ID estable.
- Flujo servicios → profesional → fecha → horario.
- Horizonte configurable por negocio: 30 días por defecto y 90 como máximo.
- Anticipación mínima configurable: cero minutos por defecto.
- Hasta ocho próximas fechas con disponibilidad real por página.
- Horarios de inicio sobre una grilla de 30 minutos.
- Duraciones reales, aunque no sean múltiplos de 30 minutos.
- Presentación adaptativa: lista directa o franjas horarias.
- Franjas predeterminadas con cortes 12:30 y 16:30, configurables por negocio.

### Navegación y recuperación

- Volver, Menú principal y Hablar con el equipo.
- Confirmación antes de descartar un borrador con progreso.
- Borradores vigentes durante 24 horas desde la última actividad nueva del cliente,
  con [expiración lazy y protección de entidades durables](ventana-contexto-24h.md)
  (decisión 2026-08-30, sustituye «última acción válida»).
- Rechazo seguro de opciones vencidas.
- Recuperación de entradas no admitidas sin IA.
- Atención destacada en el segundo error consecutivo y derivación automática en
  el tercero dentro del mismo estado.
- Recuperación cuando el horario fue ocupado antes de retenerlo.
- Reconciliación de pulsaciones rápidas: duplicados idénticos se deduplican y
  opciones diferentes del mismo prompt solicitan confirmación antes de avanzar.
- Objetivos p95: webhook ≤ 200 ms, procesamiento interno ≤ 1 s y entrega al
  cliente ≤ 3 s. La ventana espera 500 ms de inactividad y tiene un máximo
  absoluto de 1500 ms desde la primera pulsación.

### Gestión de turnos

- Búsqueda por teléfono y negocio de turnos futuros confirmados o pendientes
  activos.
- Detalle, cancelación y reprogramación sin cambiar servicios ni profesional.
- Límites independientes configurables, ambos de 1 hora por defecto.
- Reprogramación mediante reemplazo atómico que conserva el turno original ante
  cualquier fallo.
- Conservación de la seña aprobada cuando no cambian servicios, profesional ni
  importe.
- Derivación de cancelaciones con seña aprobada o comprobante en revisión.
- Cancelación automática antes del comprobante o durante un reenvío rechazado.

### Atención humana

- Pausa del flujo al solicitar atención.
- Mientras está en cola: Seguir esperando o Cancelar atención y volver.
- Silencio completo del bot cuando un agente toma la conversación.
- El agente decide si la resolución vuelve al menú o retoma el flujo.
- Revalidación del contexto antes de retomar.

### Señas

- Configuración NONE, FIXED o PERCENTAGE por servicio.
- Una seña total para todos los servicios del bloque.
- Dos horas por defecto, configurables, para enviar el comprobante.
- Comprobantes JPEG, PNG, WebP o PDF de hasta 3 MiB.
- Retención sin vencimiento automático después de recibir un comprobante válido.
- Aprobación manual.
- Rechazo corregible o final con motivo obligatorio.
- Nuevo plazo configurable para reenviar, con dos horas por defecto.
- Comprobantes tardíos conservados para revisión, sin recuperar automáticamente
  el horario liberado.

### Activación

- Selector exclusivo del motor activo por negocio.
- Activación y rollback transaccionales y auditables.
- Negocio de prueba, luego piloto con el comercio que usa el bot normal.
- Los bots personalizados permanecen sin cambios hasta una migración explícita.

## Fuera de la etapa 1

Todo lo listado en `backlog-etapa-2.md`, especialmente:

- coordinación automática entre varios profesionales;
- retención conjunta de varios calendarios;
- búsqueda por hora deseada;
- orden fecha → horario → profesional;
- incorporación automática de servicios hoy derivados para coordinación.

## Criterio de finalización de la etapa

La etapa 1 termina cuando el recorrido de nueva reserva, con y sin seña, cumple
la máquina de estados y sus invariantes, puede activarse para un negocio piloto,
puede revertirse sin dos motores simultáneos y no depende del router semántico
del bot anterior.
