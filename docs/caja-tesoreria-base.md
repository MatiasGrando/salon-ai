# Caja diaria y Tesorería — funcionamiento y pruebas

Estado: reserva de efectivo, permisos separados, cierre con cambio, tablero Cobrado/Egresos/Total, subcategorías, pagos privados desde Tesorería y resultado global exclusivo de administración. El seguimiento bancario/Mercado Pago aún no está implementado.

## Preparación para probar

1. Aplicar, en orden, las migraciones `20260923030000_today_professional_production_permission`, `20260923040000_treasury_foundation`, `20260923050000_cash_expense_subcategories`, `20260923060000_treasury_professional_payments` y `20260923070000_treasury_expense_classification` mediante el procedimiento habitual. El desarrollo local no aplicó migraciones ni modificó datos.
2. Mantener `CASH_REGISTER_ENABLED=true` y volver a iniciar la aplicación con el código nuevo.
3. Usar un local autorizado con un usuario administrador y una cuenta de secretaría. Las sesiones ya existentes toman los permisos de la base en cada solicitud.

## Perfiles y límites

| Acceso | Administrador del local | Secretaría con permiso de Caja | Secretaría con permiso «actividad de hoy» |
|---|---|---|---|
| Caja diaria | Sí | Sí | Solo si además tiene permiso de Caja |
| Tesorería: saldo, movimientos y operaciones | Sí | No | No |
| Liquidaciones completas, saldos, pagos, configuración | Sí | No | No |
| Servicios completados y facturación de profesionales de hoy | Sí | No | Sí |

- El permiso seleccionable en **Ajustes → Personal** es «Ver trabajo y facturación de profesionales de hoy (sin saldos ni pagos)». Es independiente de Caja. El preset «Secretaria · Caja» no lo activa automáticamente.
- Un permiso heredado de «Ver liquidaciones» o «Registrar pagos» en una cuenta staff existente **no concede** acceso a endpoints completos: el servidor lo niega aun si el dato previo sigue en la base.
- Las APIs de profesionales que secretaría puede consultar tampoco entregan reglas de comisión; el listado se filtra por los locales autorizados.
- La vista de hoy usa la zona horaria del local, filtra turnos completados por fecha de turno y muestra cantidad de servicios y **base facturada**. No usa la comisión del profesional como facturación; no envía deuda, pago, adelanto, configuración ni histórico.
- Los reportes por período de secretaría incluyen solo movimientos asociados a jornadas de Caja; no cobros históricos o proyectados sin jornada.
- El administrador de cuentas solo puede consultar locales que tenga autorizados. Las consultas de Caja y Tesorería verifican ese alcance en servidor. Una URL manipulada de otro local debe devolver 404.

## Efectivo de Tesorería

La pestaña **Tesorería** aparece solo a administración. El dueño puede:

1. Habilitar una reserva de efectivo en cero. La habilitación es idempotente.
2. Transferir efectivo desde una **sesión abierta** de Caja diaria. Se verifica que el importe no supere el efectivo esperado de la jornada.
3. Registrar un **gasto** o **retiro** desde la reserva, con detalle obligatorio y sin necesitar Caja abierta. Un gasto puede clasificarse en categoría/subcategoría y tener destinatario; el formulario exige categoría para gastos nuevos. El retiro interno no permite clasificarlo como gasto.
4. Pagar una **liquidación o adelanto profesional** desde Liquidaciones, eligiendo «Tesorería (efectivo)» como origen. No requiere una sesión de Caja abierta.
5. Consultar el saldo destacado y movimientos de la reserva paginados de a 20; el historial puede filtrarse por categoría/subcategoría sin modificar el saldo mostrado. Los filtros reinician en la primera página.

Un traspaso registra dos hechos **en una misma transacción**:
- `CashEntry WITHDRAWAL/CASH` en Caja diaria: baja el efectivo esperado.
- `TreasuryMovement DAILY_TRANSFER/INFLOW` en Tesorería: sube la reserva.

No es venta ni gasto del negocio. En la caja diaria se ve el retiro para conciliar el efectivo físico; el saldo y los egresos de Tesorería nunca se entregan a personal. Los importes son enteros en ARS y los movimientos no se borran ni editan. Los traspasos manuales incluyen clave de idempotencia; reintentar el mismo envío no duplica dinero. El cierre automático se protege por el estado cerrado de la sesión, además del bloqueo transaccional.

Una salida desde Tesorería baja solo su saldo. `EXPENSE` representa un gasto real; `WITHDRAWAL` representa dinero que sale de la reserva sin clasificarlo como gasto. **Alquiler y proveedores** se registran como `EXPENSE` con categoría/subcategoría y destinatario; esos importes solo aparecen en Tesorería para administración, no en Caja diaria ni en sus filtros para secretaría. La clasificación de gastos anteriores queda vacía y se conserva su historial. Un gasto o retiro reintentado con la misma clave no duplica el movimiento; si cambian sus datos, se rechaza. Categorías inactivas o subcategorías ajenas al local/categoría se rechazan para carga nueva.

Para **profesionales**, pagar desde la reserva genera atómicamente un `TreasuryMovement` de salida y un `ProfessionalAccountEntry` de débito vinculado: baja el saldo reservado y lo adeudado al profesional. No crea `CashEntry`, no necesita Caja abierta y no aparece en reportes/filtros de Caja de secretaría. El mismo identificador de operación se puede reintentar sin duplicar el pago; la ruta rechaza importe mayor al saldo, profesional de otro local y claves reutilizadas con otros datos.

Si el administrador elige **Caja diaria + Efectivo**, la operación crea en una sola transacción un retiro interno de Caja, un ingreso a Tesorería, el pago profesional de Tesorería y el débito de la cuenta profesional. Exige Caja abierta, reserva habilitada y efectivo esperado suficiente. La reserva queda con el mismo saldo neto: el efectivo pasa por Tesorería como cuenta puente y sale en el mismo acto. El retiro en Caja se identifica como «Traspaso a Tesorería para liquidación», **no** como gasto; el pago real aparece en el historial privado de Tesorería como «Pago profesional» o «Adelanto profesional», con categoría «Liquidaciones profesionales» y nombre. Esa categoría se crea al primer pago, se comparte con los pagos digitales de Caja y no se puede renombrar ni desactivar para preservar la búsqueda histórica. En el resultado global se cuenta solo el pago, no el traspaso. Un reintento con la misma clave no repite ningún movimiento. No se coloca en «Otros».

Si elige **Caja diaria + Transferencia/Tarjeta**, el dinero no se inventa como efectivo reservado: sigue registrándose como egreso directo de Caja, con categoría específica «Liquidaciones profesionales», creada al primer uso. Secretaría con acceso a Caja puede ver ese egreso. Para privacidad total, usar efectivo de Tesorería.

## Resultado global exclusivo de administración

En la pestaña **Tesorería**, «Resultado global del local» permite consultar hasta 31 días. Muestra **Cobrado**, **Egresos** y **Total** por medio, con desglose del egreso entre Caja y Tesorería. Se combinan los cobros y gastos/devoluciones de Caja con `EXPENSE`, `PROFESSIONAL_PAYMENT` y `PROFESSIONAL_ADVANCE` de Tesorería dentro de la fecha local del negocio. Un pago profesional hecho desde Caja ya está en los egresos de Caja y no se vuelve a agregar. `DAILY_TRANSFER` y `WITHDRAWAL` no son gastos y quedan fuera del resultado. Se trata de un **resultado por movimientos de dinero**, no del saldo físico; el saldo reservado se ve aparte. El tablero de Caja sigue mostrando solamente Caja, por lo que secretaría nunca recibe un total que incluya alquiler o liquidaciones privadas.

La consulta y los cálculos globales del servidor están restringidos a administración y a locales autorizados. Un GET de personal a `/treasury/consolidated` responde 403. Los importes de transferencias y Mercado Pago todavía comparten el medio `TRANSFER`; no se puede desglosar esos dos canales con los datos actuales.

## Cierre con cambio para la próxima apertura

Solo administración ve **Dejar cambio en caja** al cerrar. Primero ingresa el **efectivo físico contado**; si marca la casilla, indica **cuánto quiere dejar**. La interfaz sugiere $20.000, limitado al efectivo contado, pero se puede cambiar incluso a $0. Muestra antes de guardar cuánto quedará en Caja y cuánto pasará a Tesorería. La reserva de efectivo debe haberse habilitado previamente cuando haya un excedente que transferir. Secretaría puede seguir cerrando la jornada sin traspaso y no ve el control ni el saldo reservado. La API también rechaza `cashToLeave` para personal aunque manipule el formulario.

Ejemplo: esperado $120.000, contado $120.000 y dejar $20.000. El cierre crea un retiro interno por $100.000 en Caja y un ingreso vinculado por $100.000 en Tesorería. Guarda **$20.000 como efectivo final contado**, que será el inicial al abrir la próxima jornada. No crea gasto ni venta. Si el contado fuera $119.000 con esperado $120.000, la diferencia de arqueo es **-$1.000**; el traspaso es $99.000, quedan $20.000 físicos y $21.000 esperados. La diferencia no desaparece ni se calcula sobre el dinero posterior al retiro.

El servidor valida importes enteros, no negativos y que el monto a dejar no supere lo contado. Con diferencia exige la confirmación habitual. Jornada, sesión, retiro interno, ingreso en Tesorería y cierre se guardan **en una sola transacción** bajo el bloqueo del negocio: si falla cualquiera, no queda un movimiento parcial. Un reintento tras un cierre exitoso responde `CASH_CLOSED`; no vuelve a transferir. Sin marcar la casilla, el cierre anterior permanece igual y arrastra todo el contado.

## Resumen y subcategorías de gastos

Las tarjetas de Jornada y Período muestran **Cobrado**, **Egresos** y **Total**, con desglose por efectivo, transferencia y tarjeta. Cobrado son los pagos asentados; Egresos son gastos más devoluciones; Total es Cobrado menos Egresos. Los aportes, retiros internos a Tesorería y ajustes no se hacen pasar por ventas ni gastos: se muestran aparte. El **efectivo esperado** sigue siendo un indicador operativo distinto del resultado. Una reserva de Tesorería no se suma a la Caja diaria de secretaría.

En **Administrar categorías** se crean categorías y subcategorías opcionales. Ejemplo: categoría Servicios y subcategorías Luz, Gas, Agua, Internet y Alquiler. Al registrar un gasto se elige una categoría y, si corresponde, una subcategoría activa de esa misma categoría. Los gastos antiguos quedan sin subcategoría; no se modifica su historial. Se puede filtrar la jornada y los gastos por período por ambos niveles. Desactivar una subcategoría la quita de la carga nueva, pero conserva su nombre y sus movimientos históricos. El servidor valida pertenencia a categoría, vigencia y local, incluso si se manipula el formulario.

## Prueba manual sugerida

1. Administrador: habilitar reserva; verificar saldo $0.
2. Abrir Caja con efectivo inicial y registrar cobros. Transferir, por ejemplo, $10.000 a la reserva.
3. Confirmar: efectivo esperado de Caja baja $10.000; saldo reservado sube $10.000; el resultado por ventas/gastos no se altera por ese traspaso.
4. Registrar un gasto de $3.000 desde Tesorería: el saldo reservado baja a $7.000. Repetir el envío no lo duplica.
5. Intentar transferir más que el efectivo esperado o gastar más que el saldo reservado: debe rechazarse sin movimientos parciales.
6. Entrar con secretaría con Caja: ve solo Caja diaria, no pestaña ni API de Tesorería. Un GET/POST a `/treasury` debe responder 403. Liquidaciones completas y pagos también, aunque fueran permisos heredados.
7. Activar solo «actividad de hoy» para una secretaria: en Liquidaciones ve profesionales, servicios realizados y facturación de hoy. Cambiar la fecha del dispositivo o probar parámetros `from`/`to` no debe revelar otro día; no hay saldos, movimientos de pago ni botón de pagar.
8. Administrador: con Tesorería habilitada, abrir jornada con $20.000, cobrar $100.000 en efectivo y cerrar con $120.000 contados dejando $20.000. Comprobar retiro de $100.000 en la jornada, ingreso de $100.000 en Tesorería, diferencia $0 y siguiente apertura de $20.000.
9. Repetir con $119.000 contados y confirmar diferencia: quedan $20.000, se transfieren $99.000 y la diferencia del cierre sigue en -$1.000. Probar sin confirmar: no debe cerrar ni transferir.
10. Probar monto a dejar mayor que el contado, negativo o fraccionario y Tesorería deshabilitada: no debe cerrar ni mover fondos. Repetir un cierre ya exitoso: no debe duplicar el ingreso. Cerrar sin marcar la casilla conserva el comportamiento anterior.
11. Con secretaría: no aparece la casilla; enviar `cashToLeave` manualmente al endpoint de cierre responde 403. Puede cerrar sin traspaso si tiene permiso de sesiones.
12. Crear Servicios → Luz y Gas. Registrar un gasto bajo Luz, filtrar por Servicios y luego por Luz; Gas no debe aparecer. Desactivar Luz: no debe poder asignarse a gastos nuevos, pero debe seguir visible en el histórico. Probar una subcategoría de otra categoría y otro local: debe rechazarse.
13. Comprobar el tablero con cobros $150.000, gastos $25.000 y devoluciones $10.000: Cobrado $150.000, Egresos $35.000 y Total $115.000. Un retiro interno de $30.000 y un aporte de $3.000 no cambian esas tres tarjetas; sí modifican el efectivo esperado según el medio.
14. Probar un `businessId` de otro local: Caja y Tesorería no deben entregar datos.
15. Administrador: en Liquidaciones elegir **Tesorería (efectivo)**, pagar $5.000 a un profesional con Caja cerrada. Verificar que baja $5.000 la reserva, baja $5.000 su saldo profesional y aparece el origen «Tesorería» en el historial; Caja diaria no recibe un gasto duplicado.
16. Reintentar el mismo pago o forzar saldo insuficiente: no se deben duplicar movimientos ni aceptar saldo negativo. Probar un profesional de otro local: debe rechazarse.
17. Crear Servicios → Alquiler y Luz; desde Tesorería registrar $30.000 de alquiler con destinatario «Propietario» y detalle «Septiembre». Verificar que baja la reserva y que los filtros de categoría/subcategoría encuentran el movimiento. El saldo reservado siempre muestra el saldo **total**, aunque el historial esté filtrado.
18. Pausar Alquiler: debe permanecer en el historial, pero no permitir un gasto nuevo bajo esa subcategoría. Enviar IDs de otra categoría u otro local debe rechazarse. Reintentar la misma salida no duplica fondos; cambiar el detalle con la misma clave debe dar conflicto.
19. Ingresar como secretaría: no debe ver pagos profesionales desde Tesorería ni gastos de alquiler/proveedores en Caja, Liquidaciones limitadas o APIs de Tesorería, aunque conozca un identificador de categoría o movimiento.
20. Administrador: en «Resultado global» elegir un período con $150.000 cobrados, $25.000 de gastos de Caja, $10.000 de devoluciones y $35.000 pagados desde Tesorería. Debe mostrar Cobrado $150.000, Egresos $70.000 y Total $80.000. Un traspaso de $20.000 o un retiro interno no modifica esas tarjetas.
21. Comprobar que el mismo período visto en Caja mantiene su resultado **solo de Caja** ($115.000 en el ejemplo), mientras el global incorpora el egreso privado. Entrar como secretaría e intentar GET `/treasury/consolidated`: 403.

## Presentación de Tesorería y origen de pagos

El **efectivo reservado** se destaca en una tarjeta de saldo independiente del resultado global. «Transferir a Tesorería» mueve efectivo desde una sesión de Caja diaria abierta y registra un retiro/ingreso interno; no es gasto. «Gastos y retiros desde Tesorería» es una operación distinta: consume la reserva y solo el tipo Gasto modifica el resultado del negocio. Cada acción tiene un bloque y explicación propios.

El historial de Tesorería muestra **20 movimientos por página**, con Anterior/Siguiente y cantidad total. Los filtros de tipo, búsqueda por detalle/profesional, categoría y subcategoría se aplican antes de paginar y no alteran el saldo total; los movimientos nuevos llevan a la primera página.

**Liquidaciones:** «Caja diaria» requiere una sesión abierta. En efectivo usa el puente atómico Caja → Tesorería → profesional descrito arriba; Caja refleja la salida física, pero solo Tesorería refleja el gasto real. Desde Tesorería se paga con la reserva existente. Transferencia/tarjeta desde Caja permanecen como egresos de Caja porque la reserva aún no lleva saldos digitales. El error genérico anterior surgía porque el asiento `CashEntry EXPENSE` omitía la categoría obligatoria por el esquema; este flujo ya no usa «Otros».

## Alcance de jornadas, responsable administrador y actualización visible

- **Secretaría/personal (STAFF) con permiso de Caja:** el selector de Jornada queda limitado a la jornada abierta. Si la Caja está cerrada, no muestra la última jornada como si estuviera activa. La API también rechaza la consulta directa de resúmenes y movimientos de jornadas cerradas (404) y los reportes por período (403). La pestaña «Consultar período» no se presenta. Administración mantiene la consulta histórica.
- **Apertura y cambio de responsable:** el administrador autenticado puede elegirse a sí mismo aunque no tenga una cuenta de secretaría dentro del local. No puede designar como administrador a otro usuario global. Para personal local se conserva la relación estricta con el negocio; la migración nueva separa la identidad del administrador y exige exactamente un responsable por sesión. Antes de desplegar este código debe aplicarse la migración 20260924020000_cash_admin_responsible.
- **Carga:** al guardar una apertura, cambio de sesión o cierre aparece una rueda y el cuadro permanece visible hasta terminar el refresco. Si la operación se guardó pero falló solo el refresco, el botón pasa a «Reintentar actualización» y no vuelve a enviar la operación.
- **Liquidaciones:** en el detalle de servicios, «Fecha» indica el movimiento y «Turno / cliente» muestra fecha **y** hora del turno, en la zona horaria del local.

### Casos para probar con uso real

1. Con Caja cerrada, entrar como secretaria: no hay jornada histórica seleccionable ni totales viejos; intentar abrir una jornada cerrada por URL/API devuelve 404. Tras abrir, aparece solo la activa.
2. Como administrador, comprobar que siguen apareciendo jornadas anteriores y «Consultar período».
3. Como administrador sin perfil de secretaría, abrir Caja eligiéndose como responsable. Repetir en «Nueva sesión»; el nombre debe quedar en historial. Como secretaria, no debe poder asignar un administrador de otro local.
4. Al abrir Caja, la rueda se mantiene hasta ver la jornada nueva. Si falla el refresco después de guardar, reintentar no crea otra jornada.
5. En Liquidaciones, comparar un turno creado un día y realizado otro: ambas columnas deben mostrar su fecha correcta además de la hora. Revisar en móvil.

## Todavía pendiente, no asumirlo implementado

- Seguimiento opcional de transferencias/banco y Mercado Pago. Esta etapa habilita únicamente reserva **en efectivo**.
- Integración PostgreSQL: no se ejecutó porque `TEST_DATABASE_URL` no está configurada. La migración y el despliegue quedan a cargo del procedimiento habitual. Se revisó una maqueta local de la vista en escritorio y viewport móvil real de 390 px (sin scroll horizontal); falta probar el CRM conectado con datos reales.
- Pendientes por cobrar: expresamente fuera de alcance.

## Regresión: pagos profesionales desde Caja

1. Administrador: habilitar Tesorería, abrir Caja con $10.000 y pagar $3.000 en efectivo desde Liquidaciones. Verificar un **retiro interno** de $3.000 en Caja, un ingreso y un pago de $3.000 en Tesorería, saldo reservado sin cambio, saldo profesional -$3.000 y **un solo egreso** de $3.000 en resultado global.
2. En Tesorería filtrar «Pagos profesionales» o la categoría «Liquidaciones profesionales», y buscar el nombre: debe aparecer el pago con importe y fecha; secretaría no puede abrir esa vista.
3. Reintentar la misma solicitud: no crear nuevos movimientos. Probar reserva deshabilitada y efectivo esperado insuficiente: mostrar motivo, sin asientos parciales.
4. Pagar mediante transferencia/tarjeta desde Caja: gasto categorizado como «Liquidaciones profesionales», sin cambiar saldo reservado ni crear movimientos de Tesorería.
