# Nuevo bot por opciones — reglas funcionales

## 1. Identidad de acciones

- Cada interacción contiene versión, contexto de pantalla, acción e IDs de
  entidades necesarios.
- Los IDs se validan contra negocio, conversación, pantalla y estado activos.
- Nunca se interpreta una fila por título, descripción, número o posición.
- Una acción se procesa una sola vez y las repeticiones son idempotentes.
- Al emitir una pantalla nueva, las opciones incompatibles de la anterior quedan
  vencidas.

### Pulsaciones rápidas y latencia

- El webhook confirma recepción y persiste cada acción antes de ejecutar trabajo
  conversacional costoso.
- Las acciones de una conversación se procesan en orden y bajo una única
  exclusión lógica; nunca se ejecutan dos transiciones simultáneas.
- Varias pulsaciones idénticas del mismo prompt representan una sola acción y no
  duplican efectos.
- Varias opciones diferentes del mismo prompt recibidas dentro de la ventana de
  estabilización producen una única pantalla de conflicto que pregunta cuál
  prefiere el cliente. Ninguna de esas opciones avanza el flujo por suposición.
- Una pulsación que llega después de cerrar el prompt se trata como vencida y
  reconstruye el estado vigente; no revierte una transición ya confirmada.
- La ventana de estabilización debe ser corta, reiniciable al recibir otra
  pulsación y tener un máximo absoluto para no degradar indefinidamente la
  respuesta.
- La ventana espera 500 ms de inactividad desde la última pulsación del mismo
  prompt y tiene un máximo absoluto de 1500 ms desde la primera.
- Al llegar otra pulsación antes del máximo, se recalcula el cierre por
  inactividad sin superar el límite absoluto. Al vencer cualquiera de los dos,
  se reconcilian todas las acciones persistidas.
- El webhook no permanece abierto durante la estabilización. Confirma recepción
  después de persistir y el procesamiento continúa de forma asíncrona.
- La conciliación pendiente debe sobrevivir reinicios del proceso; un timer en
  memoria puede optimizar el despertar, pero no ser la única fuente de verdad.
- El diseño técnico debe fijar y medir por separado tiempo de aceptación del
  webhook, espera de estabilización, procesamiento interno y entrega del
  proveedor.
- Objetivos iniciales de latencia en percentil 95:
  - aceptación HTTP del webhook menor o igual a 200 ms;
  - procesamiento interno menor o igual a 1 segundo, excluyendo espera de
    estabilización y entrega de Meta;
  - respuesta entregada al cliente menor o igual a 3 segundos como objetivo de
    experiencia, incluyendo estabilización y proveedor.
- La entrega al cliente se mide mediante el estado `delivered` de Meta cuando
  esté disponible. Si falta, la muestra se identifica como incompleta y no se
  sustituye silenciosamente por el tiempo de aceptación de la API.
- Las métricas se segmentan por tipo de acción, resultado de conflicto, negocio y
  versión del motor, sin registrar contenido sensible del mensaje.

## 2. Menú principal

Opciones previstas:

- Sacar un turno.
- Ver servicios y precios.
- Consultar horarios.
- Gestionar un turno.
- Hablar con el equipo.

Sacar un turno, Ver servicios y precios, Consultar horarios, Gestionar un turno y
las reglas transversales de atención están especificados para el primer corte.

## 3. Identidad del cliente

- Buscar por teléfono y negocio antes de preguntar el nombre.
- No compartir identidad entre negocios.
- Reutilizar un nombre existente válido.
- Si falta, normalizar espacios sin eliminar Unicode, acentos, guiones ni
  apóstrofes.
- Después de normalizar, el nombre debe tener entre 2 y 80 caracteres.
- Un valor fuera del rango no avanza, no se guarda como candidato y no reemplaza
  un nombre existente.
- Se admiten letras y marcas Unicode, espacios, apóstrofes rectos o tipográficos,
  guiones y puntos.
- La validación debe aceptar explícitamente ñ, Ñ, vocales acentuadas y nombres de
  otros alfabetos. No puede basarse en rangos ASCII como `A-Z` o `a-z`.
- El valor se normaliza a Unicode NFC sin transliterar, quitar acentos ni
  convertir ñ en n.
- Se conserva el uso de mayúsculas y minúsculas confirmado por el cliente. El
  sistema no aplica formato título ni altera partículas o apellidos.
- Se rechazan números, emojis, URLs, caracteres de control y símbolos ajenos a
  un nombre.
- Confirmar el valor mediante Sí, es correcto, Corregir nombre o Hablar con el
  equipo.
- Persistir sólo después de la confirmación.
- Una corrección no elimina el resto del borrador.

## 3.1. Consulta de servicios y precios

- Consultar el catálogo no crea un borrador de reserva ni solicita el nombre.
- El recorrido permite elegir categoría, servicio y ver su información.
- El detalle ofrece Reservar este servicio, Ver otros servicios, Volver, Menú
  principal y acceso a atención humana según la política adaptativa de
  navegación.
- Sólo Reservar este servicio convierte la consulta en reserva y agrega el ID
  real del servicio al carrito después de revalidarlo.
- Al convertir la consulta, el sistema busca al cliente por teléfono y solicita
  el nombre únicamente si falta uno válido.
- Después de identificar al cliente, continúa con recomendaciones y carrito sin
  obligarlo a seleccionar nuevamente el servicio.
- El precio se presenta según la configuración real del servicio: importe para
  precio fijo, “Desde [importe]” para precio estimado o inicial y “Consultar con
  el equipo” cuando no existe un precio público.
- El bot no oculta un servicio por carecer de precio público, no convierte un
  estimado en precio definitivo y no inventa importes a partir de la categoría.
- Cada servicio sin precio público define una política explícita: Reservable sin
  precio público o Requiere consulta previa.
- Un servicio reservable conserva Reservar este servicio y presenta el importe
  como pendiente de confirmación en todo el recorrido.
- Un servicio que requiere consulta previa reemplaza la conversión automática
  por Consultar con el equipo, conservando servicio y motivo en el handoff.
- La política se valida mediante la configuración del servicio y no mediante el
  texto visible del detalle.
- El detalle muestra nombre, descripción, precio y duración usando los datos
  reales disponibles.
- Un campo opcional ausente se omite sin mostrar valores de relleno como “Sin
  descripción”, duración cero o un importe inventado.
- La duración se presenta como estimada cuando la configuración del servicio no
  represente un compromiso exacto.
- Cada fila de la lista muestra nombre, precio resumido y duración cuando esos
  datos existen.
- El nombre ocupa el título y el precio con la duración utilizan la descripción
  cuando sea necesario para respetar los límites de WhatsApp.
- Los textos se formatean dentro de los límites del proveedor sin truncar de
  manera ambigua importes, unidades ni la indicación “Desde”.
- Antes de emitir cualquier mensaje interactivo, el sistema valida el cuerpo
  final ya renderizado. El cuerpo no puede superar 1024 caracteres e incluye
  descripción, precio, duración, avisos y cualquier texto de navegación.
- La validación ocurre antes de llamar al proveedor; no se confía en un rechazo
  de Meta ni en un fallback accidental del transporte.
- Si el detalle completo no entra en el cuerpo interactivo, se envía primero la
  descripción como uno o más mensajes de texto informativos y después un mensaje
  interactivo breve con resumen y acciones.
- Los fragmentos informativos respetan también los límites vigentes del
  proveedor y se dividen por párrafos o palabras, sin cortar caracteres Unicode,
  importes ni unidades.
- Sólo el mensaje interactivo final crea el token de opciones. Si no se pudo
  entregar el contenido previo requerido, no se presenta una acción de reserva
  descontextualizada.
- Si un dato no existe, se omite y la fila continúa siendo seleccionable.
- El detalle de un servicio reservable ofrece como acción principal Reservar
  este servicio.
- También ofrece Ver más de esta categoría, que regresa a la misma categoría y
  página cuando continúan vigentes, y Cambiar categoría, que abre el catálogo de
  categorías.
- Un servicio de consulta previa reemplaza Reservar este servicio por Consultar
  con el equipo.

## 4. Catálogo

- Seleccionar categoría y luego un servicio real.
- Usar subcategorías cuando formen parte del catálogo.
- Procurar no superar diez opciones por categoría.
- Si se supera la capacidad efectiva de la lista, paginar mediante acciones
  estables.
- Reservar filas para navegación; no asumir diez servicios por página.
- La página forma parte del contexto interactivo.

## 4.1. Consulta de horarios de atención

- Consultar horarios muestra primero el horario de atención del negocio; no
  presenta turnos disponibles.
- Desde esa pantalla se puede elegir Consultar horario de un profesional, Buscar
  un turno disponible, Volver, Menú principal o atención humana según la
  navegación adaptativa.
- Consultar horario de un profesional permite elegir una persona y muestra su
  jornada laboral configurada, no los huecos libres de su agenda.
- La lista incluye todos los profesionales activos. Los inactivos no aparecen.
- Quienes no aceptan reservas por el bot se identifican como “No reservable por
  este medio”. Se puede consultar su jornada, pero no buscar disponibilidad ni
  iniciar una reserva automática con esa persona.
- Para un profesional no reservable por el bot, el detalle ofrece Hablar con el
  equipo en lugar de Buscar un turno disponible.
- La vista informa la semana habitual completa, de lunes a domingo, tanto para
  el negocio como para el profesional elegido.
- También avisa cierres, ausencias o cambios excepcionales configurados que
  afecten los próximos 30 días.
- Si no hay excepciones dentro de ese horizonte, no muestra una sección vacía ni
  un aviso genérico.
- Los avisos utilizan información operativa como “cerrado” o “no atiende”; no
  exponen motivos internos, notas administrativas ni datos de otras reservas.
- Buscar un turno disponible inicia el flujo normal de reserva, porque primero
  necesita servicio, duración y profesional específico o Cualquier profesional.
- La consulta informativa no solicita nombre, no crea borrador y no revela
  turnos, bloqueos ni datos de otros clientes.

## 4.2. Gestión de turnos existentes

- Al ingresar desde WhatsApp, el sistema busca próximos turnos mediante teléfono
  normalizado y negocio activo.
- No solicita un código de reserva ni el nombre para realizar la búsqueda.
- Nunca comparte ni combina turnos de otros negocios o teléfonos.
- Si existe más de uno, muestra una lista con fecha, hora, servicio y estado
  resumido para elegir cuál gestionar.
- La lista incluye turnos confirmados y pendientes que todavía conserven una
  retención activa: esperando comprobante, comprobante en revisión o reenvío
  habilitado.
- Excluye turnos cancelados, vencidos, finalizados y fechas pasadas.
- Los resultados se ordenan cronológicamente y cada fila distingue claramente
  Confirmado, Esperando comprobante, Comprobante en revisión o Reenvío
  pendiente.
- Para un turno confirmado, el detalle permite Cancelar turno y Reprogramar
  turno.
- La cancelación automática exige una anticipación configurable por negocio, con
  1 hora como valor predeterminado.
- Si el turno está dentro de ese límite, el bot no lo cancela: conserva la
  reserva e inicia atención humana con el motivo y el turno seleccionado.
- La comparación usa la zona horaria del negocio y se revalida inmediatamente
  antes de cancelar.
- La reprogramación utiliza una anticipación configurable independiente, también
  con 1 hora como valor predeterminado.
- Si el turno está dentro del límite de reprogramación, el bot conserva fecha y
  horario originales y deriva al equipo.
- Cambiar una configuración no altera retroactivamente operaciones ya completadas,
  pero toda operación todavía pendiente se valida contra la regla vigente.
- Reprogramar conserva inicialmente servicios y profesional, y vuelve a buscar
  fecha y horario después de revalidar el turno original.
- Al elegir el nuevo horario, el sistema revalida el turno original y retiene el
  nuevo bloque antes de liberar el anterior.
- La sustitución es atómica: mover la reserva al bloque nuevo y liberar el viejo
  se confirman juntos, o no se aplica ningún cambio.
- Si el nuevo bloque se ocupó o falla la operación, el turno original permanece
  intacto y se muestran alternativas actualizadas.
- Repetir la misma confirmación no crea un segundo turno ni vuelve a ejecutar el
  reemplazo.
- Si existe una seña aprobada y se conservan exactamente servicios, profesional
  e importe, la seña permanece vinculada al turno reprogramado y no se solicita
  un nuevo pago.
- La transferencia se registra en el historial de la reserva. Si cualquiera de
  esos datos difiere, el bot no mueve automáticamente la seña y deriva al equipo.
- Si el cliente solicita cancelar un turno con seña aprobada, el bot no cancela
  ni libera el bloque automáticamente, aunque se encuentre fuera del límite de
  una hora.
- En ese caso deriva al equipo conservando turno, pago y motivo para que el
  comercio resuelva cancelación, crédito o devolución.
- Mientras la seña está esperando el primer comprobante, el cliente puede
  cancelar mediante una confirmación explícita.
- Esa operación cancela la solicitud de seña y libera el bloque en una misma
  transacción idempotente.
- Si un comprobante fue recibido concurrentemente, la cancelación condicionada
  no se ejecuta y el bot recupera el estado actualizado antes de responder.
- Si el comprobante ya fue recibido y está en revisión, el bot no cancela ni
  libera el horario automáticamente.
- Registra la solicitud de cancelación y deriva al equipo conservando bloque,
  comprobante y estado hasta una resolución manual.
- Durante un reenvío habilitado después de un rechazo, el cliente puede cancelar
  mediante confirmación explícita.
- La cancelación cierra el reenvío y libera el bloque atómicamente. Si llega un
  nuevo comprobante en simultáneo, la guarda de estado impide cancelar con una
  lectura obsoleta.
- Mientras espera el primer comprobante, puede reprogramar mediante el mismo
  reemplazo atómico usado por un turno confirmado.
- La solicitud de seña y su vencimiento original se conservan; reprogramar no
  reinicia ni extiende el plazo para enviar el comprobante.
- Si el cambio alterara servicios, profesional, importe o política de seña, no se
  aplica automáticamente y se deriva al equipo.
- Si el comprobante está en revisión, la reprogramación no se ejecuta
  automáticamente. Se registra la solicitud y se deriva conservando fecha,
  horario, retención y archivo sin cambios.
- Durante un reenvío permitido, puede reprogramar mediante reemplazo atómico y
  conserva el vencimiento vigente del reenvío sin extensión.
- Si no encuentra una nueva opción válida, el turno original permanece intacto
  y se ofrece continuar buscando o solicitar atención.
- Toda cancelación automática muestra primero un resumen y exige confirmación
  explícita; Volver conserva el turno.
- La gestión de etapa 1 no modifica servicios ni profesional. Esos cambios
  requieren iniciar una reserva nueva o solicitar atención.
- La fila transporta el ID estable del turno; no se identifica por fecha,
  posición ni texto visible.
- Si no encuentra próximos turnos gestionables, informa el resultado y ofrece
  Sacar un turno, Menú principal o Hablar con el equipo.

## 5. Carrito de etapa 1

- El carrito automático sólo puede contener servicios realizables por al menos
  un profesional común.
- Validar la combinación antes de agregar, reemplazar o recuperar un servicio.
- Después de cada cambio recalcular duración, precio y profesionales comunes.
- Cambiar servicios invalida profesional, fecha, horario y disponibilidad.
- El carrito conserva IDs, no copias derivadas de los nombres visibles.
- Precios y duraciones se revalidan antes del resumen y la confirmación.

### Servicio incompatible agregado manualmente

- No incorporarlo al carrito reservable.
- Informar que requiere varios profesionales.
- Ofrecer Agregar y coordinar con el equipo o Continuar sin este servicio.
- Si se deriva, guardar el servicio como solicitud pendiente de coordinación y
  conservar separado el carrito compatible.

## 6. Recomendaciones

- Nunca agregar automáticamente.
- No volver a mostrar servicios elegidos ni recomendaciones rechazadas durante
  el mismo borrador.
- No encadenar recomendaciones de complementos indefinidamente.
- Mostrar normalmente sólo complementos compatibles con el carrito.
- Ofrecer Consultar otros complementos con el equipo para los incompatibles.
- Una derivación conserva el complemento consultado y el carrito válido.

## 7. Elección y asignación de profesional

- Mostrar únicamente profesionales habilitados para todos los servicios.
- Ofrecer Cualquier profesional disponible y personas específicas visibles para
  el negocio.
- Una elección específica restringe la búsqueda.
- Cualquier profesional muestra cada horario una sola vez.
- Entre candidatos para el mismo bloque, elegir quien tenga menos minutos
  ocupados en la jornada.
- Contar reservas confirmadas y pendientes que aún bloqueen disponibilidad.
- Resolver empates por prioridad del negocio y luego por ID estable.
- Revalidar y reasignar dentro de la operación protegida al retener.
- Informar siempre la persona finalmente asignada.
- Si una persona específica no tiene disponibilidad, conservar la preferencia y
  ofrecer buscar con cualquiera, modificar servicios o solicitar atención.

## 8. Fechas y horarios

- Recorrido de etapa 1: servicios → profesional → fecha → horario.
- Mostrar sólo fechas con disponibilidad real para todo el carrito.
- Mostrar hasta ocho fechas por página y permitir avanzar o retroceder.
- Horizonte de 30 días por defecto, configurable hasta 90.
- Anticipación mínima de cero minutos por defecto, configurable por negocio.
- La anticipación configurada debe ser igual o mayor que cero y estrictamente
  menor que el horizonte de búsqueda vigente del negocio.
- El CRM configura y muestra la anticipación en horas enteras no negativas. No
  admite minutos sueltos ni valores decimales.
- El valor puede persistirse internamente en una unidad temporal distinta, pero
  el contrato de configuración y validación se expresa en horas enteras.
- El backend rechaza cambios que dejen anticipación y horizonte incompatibles;
  no guarda una configuración que garantice cero fechas posibles.
- Si ningún profesional compatible tiene un bloque en todo el horizonte, derivar
  obligatoriamente y registrar una señal operativa sin afirmar automáticamente
  que existe un error de configuración.
- Generar inicios sobre una grilla de 30 minutos.
- Conservar la duración real de cada servicio.
- Si los horarios caben, mostrarlos en orden cronológico.
- Si no caben, mostrar Mañana, Tarde, Noche y Ver todos los horarios.
- Ver todos pagina cronológicamente.
- Apertura y cierre provienen de la agenda real del día.
- Cortes predeterminados: 12:30 y 16:30, configurables y sin huecos ni
  superposiciones.
- Interpretar fechas, franjas y vencimientos en la zona horaria del negocio.

## 9. Resumen y confirmación

- Mostrar cliente, servicios, duración, precio, profesional, fecha y horario.
- No confirmar una opción que haya cambiado desde que se mostró.
- Revalidar catálogo, capacidades, precio y disponibilidad.
- Si el horario se ocupó, conservar servicios y profesional, invalidar la opción
  y mostrar primero alternativas del mismo día y luego próximas fechas.
- Nunca elegir una alternativa automáticamente.

## 10. Navegación

- Mostrar Volver, Menú principal y Hablar con el equipo directamente cuando
  entren.
- Si no entran, mostrar Opciones de navegación con esas tres acciones.
- Acceder a navegación consume como máximo una interacción adicional.
- Abrir navegación, ayuda, páginas o franjas no cambia el estado funcional.
- Volver usa una transición explícita por estado.
- Cada transición declara qué conserva y qué invalida.
- Si el destino dejó de ser válido, recuperar el paso válido más cercano e
  informar el ajuste.

### Menú principal

- Sin progreso, regresar directamente.
- Con progreso, ofrecer Continuar reserva, Descartar e ir al menú o Hablar con el
  equipo.
- Descartar requiere aceptación explícita.
- Retenciones y señas no usan el descarte genérico.
- Mientras espera el primer comprobante, Menú principal abre opciones
  específicas: Continuar con el pago, Cancelar reserva y liberar horario o Hablar
  con el equipo.
- Continuar reconstruye instrucciones, importe y vencimiento vigentes.
- Cancelar reserva exige una confirmación adicional; sólo después cancela seña y
  reserva, libera el bloque y abre el menú principal.
- Abrir o cerrar este menú no modifica el vencimiento ni la retención.
- Con un comprobante en revisión, Menú principal informa que el horario continúa
  reservado provisoriamente y vuelve al menú sin cancelar ni pausar la revisión.
- El estado queda visible desde Gestionar un turno. La aprobación o el rechazo se
  notifican aunque la conversación esté navegando otra sección.
- Durante un reenvío permitido, Menú principal abre el mismo patrón protegido
  con Continuar con el reenvío, Cancelar reserva y liberar horario o Hablar con
  el equipo.
- La pantalla muestra el vencimiento vigente del reenvío. Navegar, volver o abrir
  el menú no reinicia ni extiende ese plazo.

### Borradores

- Conservar 24 horas desde la última actividad nueva del cliente (decisión
  2026-08-30: reemplaza «última acción válida»).
- Expiración lazy: comprobar al procesar el siguiente mensaje, fuera del webhook;
  no realizar barridos periódicos. Informar expiración y mostrar un menú nuevo.
- Preservar turnos, historial, señas y atención humana. Los flujos protegidos
  no se descartan por esta ventana; ver [alcance y excepciones](ventana-contexto-24h.md).
- Al regresar dentro del plazo, ofrecer Continuar o Empezar de nuevo y revalidar
  el último paso válido sigue siendo el objetivo del contrato. Esa pantalla
  no se incorpora en la entrega lazy; se conserva el recorrido existente.

## 11. Entradas inválidas

- Una opción vencida no modifica estado y reconstruye la pantalla vigente.
- No adaptar opciones antiguas al contexto actual.
- Fuera de nombre y comprobante, no interpretar texto, audio, imágenes,
  documentos, ubicación ni contactos.
- Primer error consecutivo del estado: explicar y reconstruir.
- Segundo: destacar Hablar con el equipo.
- Tercero: derivar automáticamente conservando contexto.
- Una acción válida o cambio válido de estado reinicia el contador.

## 12. Atención humana

- Solicitar atención pausa el estado funcional.
- En cola, informar que no hace falta responder y ofrecer sólo Cancelar solicitud.
- Los mensajes libres enviados mientras espera se conservan para el CRM sin generar respuestas repetitivas del bot.
- Cancelar sólo antes de que un agente tome la conversación.
- Al cancelar, revalidar y reconstruir el paso pausado.
- Una vez tomada, el bot permanece en silencio.
- La primera respuesta manual toma la conversación antes de enviarse y silencia cualquier motor de bot activo.
- Al resolver, el agente elige volver al menú o retomar.
- Los cambios manuales prevalecen sobre el borrador.
- La toma y resolución son auditables e idempotentes.

## 13. Señas

- Obtener configuración desde cada servicio real del negocio.
 - Antes de crear una retención para una reserva con seña, validar que el negocio
   tenga completos los datos e instrucciones de pago requeridos.
+- Para el medio transferencia, los campos obligatorios son alias o CBU/CVU y
+  nombre del titular; banco e instrucciones adicionales son opcionales. Otros
+  medios futuros definen su propio set obligatorio antes de habilitarse.
+- El preflight y la advertencia del CRM nombran exactamente los campos que
+  faltan por cada servicio con seña afectado.
- Si faltan, no retener, no confirmar sin seña y no enviar instrucciones
  parciales. Conservar el borrador, derivar al equipo y generar una alerta
  operativa de configuración.
- La alerta identifica los campos faltantes sin exponer credenciales ni datos de
  pago sensibles en logs inseguros.
- La validación previa a activar el motor no bloquea todo el bot por uno o más
  servicios afectados.
- El CRM permite activar con una advertencia visible que enumera los servicios
  con seña sin configuración de pago completa.
- Sólo esos servicios quedan fuera de la confirmación automática y derivan sin
  retener. Los servicios correctamente configurados continúan funcionando.
- Al corregir la configuración, las reservas nuevas vuelven a validar y pueden
  continuar automáticamente sin una migración manual del catálogo.
- NONE aporta cero; FIXED aporta importe fijo; PERCENTAGE aplica sobre el precio
  o mínimo estimado definido.
- Para varios servicios compatibles, sumar los importes y usar un comprobante.
- El plazo de retención de la seña es una configuración única del negocio para
  todos sus servicios; sin configuración explícita se usan dos horas. El motor
  nuevo ignora el campo por servicio heredado del sistema anterior, que queda
  como legado sin migrar (decisión 8).
- Retener antes de solicitar pago.
- No considerar confirmada la reserva hasta aprobar el comprobante.
- Si no llega a tiempo, vencer, liberar y notificar.
- Si llega a tiempo, pasar a revisión y mantener la retención sin vencimiento
  automático.
- Informar reservado provisoriamente, nunca confirmado.
- Aceptar JPEG, PNG, WebP y PDF de hasta 3 MiB por WhatsApp y web.
- Validar tipo real o MIME confiable, no sólo extensión.
- Un archivo inválido no cambia estado ni extiende el plazo.
- Aprobación confirma y notifica.
- Rechazo exige motivo y permite elegir reenvío o rechazo final.
- Reenvío mantiene la retención y usa plazo elegido por el comercio, dos horas
  por defecto.
- Rechazo final libera y notifica.
- Un comprobante tardío se conserva y deriva, pero no recupera el horario.

## 14. Exclusividad y rollout

- Un negocio y canal tienen un único motor automático activo.
- El CRM utiliza un selector o acciones exclusivas, nunca checkboxes
  independientes.
- El backend aplica la exclusividad dentro de una transacción.
- No cambiar el motor de conversaciones tomadas por humanos.
- Registrar motor anterior, motor nuevo, usuario y fecha.
- Permitir rollback sin respuestas simultáneas.
- Segmentar métricas por motor y versión.
- Al activar el nuevo motor, los borradores del bot anterior que no tengan
  retención, seña ni atención humana se descartan de forma controlada.
- Se elimina su estado conversacional incompatible, se registra el motivo de
  migración y la próxima interacción abre `MAIN_MENU` del nuevo bot con un aviso
  para iniciar nuevamente.
- El aviso no se envía proactivamente fuera de la ventana de WhatsApp; se entrega
  al próximo mensaje salvo que exista una plantilla aprobada y una decisión
  operativa distinta.
- El nuevo motor nunca intenta inferir o traducir esos borradores leyendo textos
  o campos parciales del bot anterior.
- La primera activación se planifica como un corte limpio en un horario sin
  actividad: ninguna conversación del bot anterior continúa su flujo y el
  siguiente mensaje del cliente comienza en `MAIN_MENU` del motor nuevo.
- Antes del cambio, el activador cuenta y reporta borradores, retenciones, señas
  y handoffs activos. No debe asumir que el horario nocturno garantiza por sí
  solo que el conteo sea cero.
- Retenciones vigentes, señas esperando comprobante, comprobantes en revisión,
  reenvíos habilitados y handoffs en cola o tomados bloquean la activación.
- Si existe al menos un bloqueo, la activación se aborta completa: no cambia el
  motor, no limpia conversaciones y muestra en el CRM los casos que deben
  resolverse.
- Los turnos ya confirmados sin flujo conversacional pendiente no bloquean el
  cambio.
- El preflight y la activación se ejecutan bajo una exclusión que impide procesar
  un nuevo evento con el motor anterior entre el conteo y el cambio.
- Si el preflight termina en cero, se activa transaccionalmente el nuevo motor,
  se invalidan prompts anteriores y se reinician los estados no protegidos.
- El rollback al motor anterior utiliza el mismo preflight y la misma exclusión.
- Si detecta un estado protegido, aborta sin cambios. Si el conteo es cero,
  descarta borradores incompatibles del motor nuevo, invalida sus prompts y
  restaura el motor anterior transaccionalmente.
- Activación y rollback no alteran turnos confirmados que no tengan un proceso
  conversacional o financiero pendiente.
