# Nuevo bot por opciones — máquina de estados de la etapa 1

## 1. Contrato del motor

El núcleo recibe un estado persistido y una acción admitida. Devuelve un nuevo
estado y efectos declarativos:

```text
transition(state, action, context) -> {
  nextState,
  statePatch,
  effects,
  view
}
```

El núcleo no envía mensajes, no consulta Meta y no interpreta texto libre. Los
adaptadores ejecutan efectos después de validar la transición.

Una transición que falla una guarda devuelve una recuperación explícita sin
mutar el estado funcional.

## 2. Regiones de estado

No se debe comprimir todo en un único campo `status`. El estado persistido tiene
regiones relacionadas:

### 2.1. Flujo conversacional

```text
MAIN_MENU
DRAFT_RESUME
NAME_INPUT
NAME_CONFIRM
CATEGORY_SELECT
SERVICE_SELECT
SERVICE_DETAIL
BUSINESS_HOURS
PROFESSIONAL_HOURS_SELECT
PROFESSIONAL_HOURS_DETAIL
APPOINTMENT_LIST
APPOINTMENT_DETAIL
APPOINTMENT_CANCEL_CONFIRM
APPOINTMENT_RESCHEDULE_DATE
APPOINTMENT_RESCHEDULE_SLOT
APPOINTMENT_RESCHEDULE_SUMMARY
RECOMMENDATION_SELECT
CART_REVIEW
INCOMPATIBLE_SERVICE_DECISION
PROFESSIONAL_SELECT
DATE_SELECT
SLOT_SELECT
BOOKING_SUMMARY
DISCARD_CONFIRM
DEPOSIT_INSTRUCTIONS
DEPOSIT_CANCEL_CONFIRM
DEPOSIT_REVIEW
BOOKING_CONFIRMED
HANDOFF_QUEUED
HANDOFF_TAKEN
```

Paginación, franja horaria y menú de navegación son modos de presentación del
estado funcional vigente; no alteran por sí mismos el recorrido.

### 2.2. Reserva

```text
DRAFT
HELD
PENDING_PAYMENT_REVIEW
CONFIRMED
CANCELLED
EXPIRED
```

### 2.3. Seña

```text
NONE
PENDING_PROOF
PROOF_RECEIVED
REJECTED_RESUBMISSION_ALLOWED
APPROVED
REJECTED_FINAL
EXPIRED
```

### 2.4. Atención humana

```text
BOT_ACTIVE
HUMAN_QUEUED
HUMAN_TAKEN
HUMAN_RESOLVED
```

## 3. Formato conceptual de acciones

```text
v1:<promptToken>:<action>:<entityId?>
```

Ejemplos:

```text
v1:p_123:menu.start_booking
v1:p_124:category.select:cat_8
v1:p_125:service.add:srv_21
v1:p_126:professional.select:pro_4
v1:p_127:date.select:2026-09-02
v1:p_128:slot.select:2026-09-02T15:00:00-03:00
v1:p_129:navigation.back
v1:p_129:handoff.request
```

El formato de transporte puede cambiar, pero debe conservar estas propiedades:

- versión;
- token de pantalla vigente;
- acción tipada;
- ID estable cuando corresponda.

## 4. Acciones universales

| Acción | Regla |
|---|---|
| `navigation.open` | Abre opciones globales sin cambiar estado funcional. |
| `navigation.close` | Reconstruye la vista funcional vigente. |
| `navigation.back` | Ejecuta la transición inversa explícita del estado. |
| `navigation.home` | Va directo al menú sin progreso o abre `DISCARD_CONFIRM`. |
| `handoff.request` | Pausa el estado y crea una única solicitud de atención. |
| `handoff.wait` | Reitera el estado de espera sin duplicar la solicitud. |
| `handoff.cancel` | Cancela sólo una solicitud todavía no tomada y revalida. |

Las acciones universales no se admiten ciegamente. Una retención o seña activa
puede bloquear `navigation.back` y `navigation.home` hasta que exista una acción
específica de cancelación.

## 5. Transiciones principales

### 5.1. Entrada e identidad

| Estado | Acción o evento | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| `MAIN_MENU` | `menu.start_booking` | Bot activo para el negocio | `NAME_INPUT`, `CATEGORY_SELECT` o `DRAFT_RESUME` | Buscar cliente y borrador vigente. |
| `MAIN_MENU` | `menu.browse_services` | Catálogo disponible | `CATEGORY_SELECT` | Abrir catálogo informativo sin crear borrador. |
| `MAIN_MENU` | `menu.business_hours` | Negocio activo | `BUSINESS_HOURS` | Mostrar jornada del negocio sin consultar disponibilidad. |
| `MAIN_MENU` | `menu.manage_appointment` | Negocio activo | `APPOINTMENT_LIST` | Buscar turnos futuros por teléfono y negocio. |
| `DRAFT_RESUME` | `draft.continue` | Borrador menor a 24 h | Último paso válido | Revalidar catálogo y selecciones. |
| `DRAFT_RESUME` | `draft.restart` | Confirmación explícita | `MAIN_MENU` | Expirar borrador anterior. |
| `NAME_INPUT` | `name.submit` | Texto normalizado válido | `NAME_CONFIRM` | Guardar candidato, no cliente. |
| `NAME_CONFIRM` | `name.confirm` | Candidato vigente | `CATEGORY_SELECT` | Persistir nombre en el negocio. |
| `NAME_CONFIRM` | `name.edit` | — | `NAME_INPUT` | Eliminar sólo el candidato. |

La búsqueda de cliente y la revalidación son efectos del caso de uso, no estados
interactivos que deban quedar esperando una respuesta.

### 5.1.1. Horarios informativos

| Estado | Acción | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| `BUSINESS_HOURS` | `hours.professional` | Existen profesionales visibles | `PROFESSIONAL_HOURS_SELECT` | Listar personas sin consultar turnos libres. |
| `BUSINESS_HOURS` | `hours.search_availability` | Bot de reservas habilitado | `NAME_INPUT`, `CATEGORY_SELECT` o `DRAFT_RESUME` | Iniciar reserva normal; la disponibilidad se calcula después del servicio. |
| `PROFESSIONAL_HOURS_SELECT` | `hours.professional_select` | Profesional activo | `PROFESSIONAL_HOURS_DETAIL` | Mostrar jornada e indicar si acepta reservas por el bot. |
| `PROFESSIONAL_HOURS_DETAIL` | `hours.choose_other_professional` | — | `PROFESSIONAL_HOURS_SELECT` | Volver al listado informativo. |
| `PROFESSIONAL_HOURS_DETAIL` | `hours.search_availability` | Profesional acepta reservas por el bot | `NAME_INPUT`, `CATEGORY_SELECT` o `DRAFT_RESUME` | Iniciar reserva; no asumir compatibilidad hasta elegir servicios. |
| `PROFESSIONAL_HOURS_DETAIL` | `hours.consult_human` | Profesional no reservable por el bot | `HANDOFF_QUEUED` | Conservar persona consultada y motivo. |

### 5.1.2. Gestión de turnos

| Estado | Acción | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| `APPOINTMENT_LIST` | `appointment.select` | Turno futuro del teléfono y negocio, confirmado o pendiente activo | `APPOINTMENT_DETAIL` | Cargar detalle por ID estable. |
| `APPOINTMENT_LIST` | `appointment.next_page` | Existe página posterior | `APPOINTMENT_LIST` | Cambiar sólo cursor de vista. |
| `APPOINTMENT_DETAIL` | `appointment.cancel` | Cancelación automática admitida por estado y anticipación | `APPOINTMENT_CANCEL_CONFIRM` | Mostrar consecuencias sin mutar turno. |
| `APPOINTMENT_DETAIL` | `appointment.cancel` | Seña aprobada, comprobante en revisión o dentro del límite | `HANDOFF_QUEUED` | Conservar turno y registrar motivo. |
| `APPOINTMENT_CANCEL_CONFIRM` | `appointment.cancel_confirm` | Estado no cambió y cancelación sigue permitida | `APPOINTMENT_LIST` | Cancelar y liberar atómicamente. |
| `APPOINTMENT_CANCEL_CONFIRM` | `navigation.back` | — | `APPOINTMENT_DETAIL` | No modificar el turno. |
| `APPOINTMENT_DETAIL` | `appointment.reschedule` | Reprogramación admitida por estado y anticipación | `APPOINTMENT_RESCHEDULE_DATE` | Revalidar servicios y profesional; buscar fechas. |
| `APPOINTMENT_DETAIL` | `appointment.reschedule` | Comprobante en revisión o dentro del límite | `HANDOFF_QUEUED` | Conservar turno y registrar solicitud. |
| `APPOINTMENT_RESCHEDULE_DATE` | `appointment.date_select` | Fecha con bloque para mismos servicios y profesional | `APPOINTMENT_RESCHEDULE_SLOT` | Guardar fecha provisional. |
| `APPOINTMENT_RESCHEDULE_SLOT` | `appointment.slot_select` | Bloque representable y vigente | `APPOINTMENT_RESCHEDULE_SUMMARY` | Guardar horario provisional. |
| `APPOINTMENT_RESCHEDULE_SUMMARY` | `appointment.reschedule_confirm` | Turno original y nuevo bloque siguen válidos | `APPOINTMENT_DETAIL` | Retener nuevo bloque y reemplazar el anterior atómicamente. |
| `APPOINTMENT_RESCHEDULE_SUMMARY` | `appointment.slot_conflict` | Nuevo bloque ocupado | `APPOINTMENT_RESCHEDULE_SLOT` o `APPOINTMENT_RESCHEDULE_DATE` | Mantener turno original y mostrar alternativas frescas. |

Al reprogramar con seña aprobada se conserva si servicios, profesional e importe
son idénticos. En `PENDING_PROOF` o reenvío permitido se conserva el vencimiento
vigente. Un comprobante en revisión obliga a handoff sin modificar la reserva.

### 5.2. Catálogo y carrito

| Estado | Acción | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| `CATEGORY_SELECT` | `category.select` | Categoría activa del negocio | `SERVICE_SELECT` | Guardar categoría de navegación. |
| `SERVICE_SELECT` | `service.view` | Servicio activo en modo informativo | `SERVICE_DETAIL` | Mostrar detalle sin crear borrador. |
| `SERVICE_SELECT` | `service.select` | Servicio activo en modo reserva | `RECOMMENDATION_SELECT` o `CART_REVIEW` | Evaluar carrito propuesto antes de agregar. |
| `SERVICE_SELECT` | `catalog.next_page` | Existe página posterior | `SERVICE_SELECT` | Cambiar sólo cursor de vista. |
| `SERVICE_SELECT` | `catalog.previous_page` | Existe página anterior | `SERVICE_SELECT` | Cambiar sólo cursor de vista. |
| `SERVICE_DETAIL` | `service.book` | Servicio reservable y vigente | `NAME_INPUT`, `RECOMMENDATION_SELECT` o `CART_REVIEW` | Crear borrador, agregar servicio e identificar cliente sin repetir selección. |
| `SERVICE_DETAIL` | `service.consult` | Requiere consulta previa | `HANDOFF_QUEUED` | Conservar servicio y motivo del handoff. |
| `SERVICE_DETAIL` | `service.more_same_category` | Categoría vigente | `SERVICE_SELECT` | Restaurar categoría y página informativa. |
| `SERVICE_DETAIL` | `service.change_category` | — | `CATEGORY_SELECT` | Limpiar sólo navegación de categoría. |
| `RECOMMENDATION_SELECT` | `recommendation.add` | Carrito propuesto conserva profesional común | `CART_REVIEW` | Agregar complemento y marcar aceptado. |
| `RECOMMENDATION_SELECT` | `recommendation.skip` | — | `CART_REVIEW` | Marcar recomendación rechazada. |
| `RECOMMENDATION_SELECT` | `recommendation.consult` | Requiere varios profesionales | `HANDOFF_QUEUED` | Guardar solicitud separada y pausar. |
| `CART_REVIEW` | `cart.add_service` | — | `CATEGORY_SELECT` | Conservar carrito. |
| `CART_REVIEW` | `cart.remove_service` | Queda al menos un servicio o se confirma vaciado | `CART_REVIEW` o `CATEGORY_SELECT` | Recalcular e invalidar dependencias. |
| `CART_REVIEW` | `cart.continue` | Existe profesional común | `PROFESSIONAL_SELECT` | Congelar snapshot de carrito para la búsqueda. |
| `INCOMPATIBLE_SERVICE_DECISION` | `service.coordinate_human` | Servicio válido pero sin profesional común | `HANDOFF_QUEUED` | Guardar solicitud separada, no tocar carrito reservable. |
| `INCOMPATIBLE_SERVICE_DECISION` | `service.skip_incompatible` | — | `CART_REVIEW` | Descartar sólo la propuesta incompatible. |

Si `service.select` deja vacía la intersección de profesionales, no agrega el
servicio y transiciona a `INCOMPATIBLE_SERVICE_DECISION`.

### 5.3. Profesional y disponibilidad

| Estado | Acción | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| `PROFESSIONAL_SELECT` | `professional.any` | Existe al menos un profesional común | `DATE_SELECT` | Eliminar preferencia específica. |
| `PROFESSIONAL_SELECT` | `professional.select` | Persona activa y compatible con todo | `DATE_SELECT` | Guardar preferencia específica. |
| `DATE_SELECT` | `date.next_page` | No supera el horizonte | `DATE_SELECT` | Cambiar cursor sin alterar selección. |
| `DATE_SELECT` | `date.previous_page` | Existe página anterior | `DATE_SELECT` | Cambiar cursor sin alterar selección. |
| `DATE_SELECT` | `date.select` | Fecha vigente con bloques reales | `SLOT_SELECT` | Guardar fecha y calcular horarios. |
| `SLOT_SELECT` | `slot.band` | Franja con disponibilidad | `SLOT_SELECT` | Cambiar filtro de vista. |
| `SLOT_SELECT` | `slot.show_all` | — | `SLOT_SELECT` | Eliminar filtro y paginar cronológicamente. |
| `SLOT_SELECT` | `slot.next_page` | Existe página posterior | `SLOT_SELECT` | Cambiar cursor de vista. |
| `SLOT_SELECT` | `slot.select` | Bloque todavía representable por el contexto | `BOOKING_SUMMARY` | Guardar opción provisional y asignación provisional. |

Si una persona específica no tiene disponibilidad, `DATE_SELECT` conserva la
preferencia y muestra acciones para `professional.any`, modificar servicios o
derivar. Si nadie tiene disponibilidad en todo el horizonte, el único resultado
funcional es `HANDOFF_QUEUED` con señal operativa.

### 5.4. Resumen, retención y confirmación

| Estado | Acción o evento | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| `BOOKING_SUMMARY` | `booking.confirm` | Catálogo, precio y bloque revalidados | `BOOKING_CONFIRMED` o `DEPOSIT_INSTRUCTIONS` | Crear retención y snapshot dentro de operación protegida. |
| `BOOKING_SUMMARY` | `booking.confirm` | Requiere seña y faltan datos de pago | `HANDOFF_QUEUED` | No retener; conservar borrador y emitir alerta operativa. |
| `BOOKING_SUMMARY` | `booking.slot_conflict` | El bloque fue ocupado | `SLOT_SELECT` o `DATE_SELECT` | Invalidar horario y mostrar disponibilidad fresca. |
| `DEPOSIT_INSTRUCTIONS` | `deposit.proof_received` | Archivo válido antes del vencimiento | `DEPOSIT_REVIEW` | Cambiar seña a `PROOF_RECEIVED`; detener expiración automática. |
| `DEPOSIT_INSTRUCTIONS` | `navigation.home` | Espera comprobante inicial o reenvío | `DEPOSIT_CANCEL_CONFIRM` | Mostrar Continuar, Cancelar y Atención sin mutar retención. |
| `DEPOSIT_CANCEL_CONFIRM` | `deposit.continue_payment` | Retención y plazo vigentes | `DEPOSIT_INSTRUCTIONS` | Reconstruir instrucciones y vencimiento vigente. |
| `DEPOSIT_CANCEL_CONFIRM` | `deposit.cancel_confirm` | Espera comprobante inicial o reenvío | `MAIN_MENU` | Cancelar seña y reserva y liberar bloque atómicamente. |
| `DEPOSIT_CANCEL_CONFIRM` | `handoff.request` | — | `HANDOFF_QUEUED` | Pausar conservando retención y motivo. |
| `DEPOSIT_INSTRUCTIONS` | `deposit.expired` | Venció sin archivo válido | `MAIN_MENU` | Seña y reserva `EXPIRED`; liberar bloque y notificar. |
| `DEPOSIT_INSTRUCTIONS` | `deposit.late_proof` | Archivo posterior al vencimiento | `HANDOFF_QUEUED` | Conservar archivo; no recuperar bloque. |
| `DEPOSIT_REVIEW` | `deposit.approve` | Acción autorizada e idempotente | `BOOKING_CONFIRMED` | Seña `APPROVED`; reserva `CONFIRMED`; notificar. |
| `DEPOSIT_REVIEW` | `deposit.reject_resubmission` | Motivo y nuevo plazo | `DEPOSIT_INSTRUCTIONS` | Mantener bloque; seña `REJECTED_RESUBMISSION_ALLOWED`. |
| `DEPOSIT_REVIEW` | `deposit.reject_final` | Motivo obligatorio | `MAIN_MENU` | Seña `REJECTED_FINAL`; reserva cancelada; liberar y notificar. |
| `DEPOSIT_REVIEW` | `navigation.home` | Comprobante recibido | `MAIN_MENU` | Conservar revisión y avisar que el horario sigue reservado provisoriamente. |

La creación de retención, reserva pendiente y seña debe ser atómica dentro de la
base de datos. El envío por WhatsApp es un efecto externo idempotente y no forma
parte de la transacción SQL.

### 5.5. Atención humana

| Estado | Acción o evento | Guarda | Próximo estado | Efectos |
|---|---|---|---|---|
| Cualquier estado habilitado | `handoff.request` | No existe solicitud activa | `HANDOFF_QUEUED` | Guardar estado pausado y motivo. |
| `HANDOFF_QUEUED` | `handoff.wait` | Solicitud no tomada | `HANDOFF_QUEUED` | Informar sin duplicar. |
| `HANDOFF_QUEUED` | `handoff.cancel` | Solicitud no tomada | Estado pausado revalidado | Cancelar cola y reconstruir. |
| `HANDOFF_QUEUED` | `handoff.take` | Agente autorizado | `HANDOFF_TAKEN` | Desactivar respuestas automáticas. |
| `HANDOFF_TAKEN` | Cualquier entrada del cliente | — | `HANDOFF_TAKEN` | Persistir para CRM; no responder. |
| `HANDOFF_TAKEN` | `handoff.resolve_home` | Agente autorizado | `MAIN_MENU` | Cerrar contexto pausado. |
| `HANDOFF_TAKEN` | `handoff.resolve_resume` | Agente autorizado | Último paso válido | Revalidar; cambios manuales prevalecen. |

## 6. Destinos explícitos de Volver

| Estado actual | Destino de `navigation.back` | Invalidación |
|---|---|---|
| `NAME_INPUT` | `MAIN_MENU` | Borrador sin servicios. |
| `NAME_CONFIRM` | `NAME_INPUT` | Candidato de nombre. |
| `CATEGORY_SELECT` | `CART_REVIEW` si hay carrito; si no, `MAIN_MENU` | Sólo navegación de categoría. |
| `SERVICE_SELECT` | `CATEGORY_SELECT` | Categoría de navegación opcional. |
| `SERVICE_DETAIL` | `SERVICE_SELECT` | Ninguna; restaura categoría y página vigentes. |
| `BUSINESS_HOURS` | `MAIN_MENU` | Ninguna. |
| `PROFESSIONAL_HOURS_SELECT` | `BUSINESS_HOURS` | Ninguna. |
| `PROFESSIONAL_HOURS_DETAIL` | `PROFESSIONAL_HOURS_SELECT` | Profesional consultado. |
| `APPOINTMENT_LIST` | `MAIN_MENU` | Cursor de lista. |
| `APPOINTMENT_DETAIL` | `APPOINTMENT_LIST` | Turno seleccionado. |
| `APPOINTMENT_CANCEL_CONFIRM` | `APPOINTMENT_DETAIL` | Ninguna. |
| `APPOINTMENT_RESCHEDULE_DATE` | `APPOINTMENT_DETAIL` | Propuesta de reprogramación. |
| `APPOINTMENT_RESCHEDULE_SLOT` | `APPOINTMENT_RESCHEDULE_DATE` | Fecha y horario provisionales. |
| `APPOINTMENT_RESCHEDULE_SUMMARY` | `APPOINTMENT_RESCHEDULE_SLOT` | Horario provisional. |
| `RECOMMENDATION_SELECT` | `CART_REVIEW` | No elimina el servicio ya aceptado. |
| `CART_REVIEW` | `SERVICE_SELECT` | No elimina servicios. |
| `INCOMPATIBLE_SERVICE_DECISION` | `CART_REVIEW` | Propuesta incompatible. |
| `PROFESSIONAL_SELECT` | `CART_REVIEW` | Snapshot de búsqueda. |
| `DATE_SELECT` | `PROFESSIONAL_SELECT` | Profesional, fecha y horario posteriores se recalculan según nueva elección. |
| `SLOT_SELECT` | `DATE_SELECT` | Fecha y horario. |
| `BOOKING_SUMMARY` | `SLOT_SELECT` | Horario provisional. |
| `DISCARD_CONFIRM` | Estado que abrió la confirmación | Ninguna. |
| `DEPOSIT_INSTRUCTIONS` | No usa Volver genérico | Usa el menú específico de retención. |
| `DEPOSIT_CANCEL_CONFIRM` | `DEPOSIT_INSTRUCTIONS` | Ninguna. |
| `DEPOSIT_REVIEW` | No usa Volver genérico | Sólo revisión o atención humana. |
| `HANDOFF_QUEUED` | No usa Volver genérico | Usar `handoff.cancel`. |
| `HANDOFF_TAKEN` | No disponible | El bot está en silencio. |

## 7. Matriz de invalidación

| Dato modificado | Debe invalidar |
|---|---|
| Nombre | Nada del carrito. |
| Servicios | Profesional, fecha, horario, asignación y opciones de disponibilidad. |
| Profesional o preferencia | Fecha, horario, asignación y opciones de disponibilidad. |
| Fecha | Horario, asignación provisional y resumen. |
| Horario | Asignación provisional y resumen. |
| Configuración de servicio | Todo dato derivado del carrito desde el último paso válido. |
| Agenda o bloqueo | Opciones de fecha y horario afectadas. |

## 8. Recuperaciones

| Evento | Mutación funcional | Respuesta |
|---|---|---|
| Token vencido | Ninguna | Explicar y reconstruir pantalla vigente. |
| Acción duplicada | Ninguna adicional | Devolver resultado ya producido o pantalla actual. |
| Varias opciones distintas del mismo prompt | Ninguna | Mostrar una única desambiguación con las opciones recibidas. |
| Acción de otra conversación o negocio | Ninguna | Rechazar y registrar evento de seguridad. |
| Entidad eliminada o inactiva | Invalidar sólo dependencias | Recuperar último paso válido. |
| Entrada no admitida 1 | Incrementar contador | Explicar y reconstruir. |
| Entrada no admitida 2 | Incrementar contador | Destacar atención humana. |
| Entrada no admitida 3 | Reiniciar contador al pausar | Derivar automáticamente. |
| Horario ocupado | Invalidar horario | Alternativas del día o próximas fechas. |
| Caída al enviar mensaje | No inventar confirmación | Reintento idempotente y compensación definida por el caso. |

## 9. Invariantes obligatorias

1. Un carrito automático no existe sin al menos un profesional común.
2. Una opción interactiva sólo actúa sobre la pantalla que la emitió.
3. Una acción duplicada no duplica reservas, señas, handoffs ni mensajes.
4. Una reserva `CONFIRMED` tiene servicio, profesional, fecha y bloque válidos.
5. Una reserva `HELD` bloquea disponibilidad hasta su vencimiento o resolución.
6. Una seña `PENDING_PROOF` tiene importe, vencimiento y reserva retenida.
7. Una seña `PROOF_RECEIVED` mantiene la retención sin vencimiento automático.
8. Una seña `APPROVED` implica reserva `CONFIRMED`.
9. Una seña `REJECTED_FINAL` o `EXPIRED` no conserva el bloque.
10. `HUMAN_TAKEN` impide toda respuesta automática.
11. Sólo un motor automático está activo por negocio y canal.
12. Toda pantalla funcional tiene salida válida o derivación humana.
13. Ninguna transición depende del último texto visible de la conversación.
14. Ningún cuerpo interactivo supera 1024 caracteres después del render final.
15. Dos acciones de la misma conversación nunca ejecutan transiciones en
    paralelo.
16. Un conflicto entre opciones del mismo prompt no aplica ninguna de ellas
    antes de la confirmación explícita.
17. Toda conciliación iniciada puede recuperarse después de reiniciar el proceso
    sin perder acciones aceptadas ni ejecutarlas dos veces.

## 10. Pruebas mínimas de tabla

Cada fila principal debe probarse como:

```text
Dado estado X y contexto C
Cuando llega acción Y
Entonces produce estado Z
Y conserva A
Y invalida B
Y emite efectos E
```

Casos obligatorios:

- recorrido completo sin seña;
- recorrido completo con seña aprobada;
- vencimiento sin comprobante;
- rechazo corregible y reenvío;
- rechazo final;
- opción vencida y duplicada;
- horario ocupado durante confirmación;
- tres entradas inválidas consecutivas;
- handoff en cola, cancelado, tomado y resuelto;
- borrador retomado y expirado;
- activación y rollback sin dos motores simultáneos.
