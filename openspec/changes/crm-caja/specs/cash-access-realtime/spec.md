# Cash Access and Realtime Specification

## Purpose

Define autorización, aislamiento, UX y sincronización financiera del CRM.

## Requirements

### Requirement: Permisos explícitos

`BUSINESS_ADMIN` y `SUPER_ADMIN` **MUST** tener acceso total implícito. Otros roles **MUST** recibir explícitamente permisos independientes para: ver Caja, registrar pagos desde Agenda, aplicar descuentos, operar gastos/retiros/ingresos/devoluciones, ajustar Caja y administrar jornadas/sesiones (abrir, Nueva sesión y cerrar). Un permiso financiero existente **MUST NOT** concederlos implícitamente.

#### Scenario: Staff sin permiso
- GIVEN un staff sin permiso de Caja
- WHEN intenta abrir su pantalla o endpoint
- THEN UI y servidor deniegan acceso

#### Scenario: Superadministrador
- GIVEN un superadministrador dentro del negocio
- WHEN accede a cualquier operación de Caja
- THEN queda autorizado sin asignación adicional

### Requirement: Aislamiento por negocio

Toda lectura, escritura, autorización y suscripción **MUST** quedar limitada por `businessId`. Las rutas nuevas o desconocidas **MUST NOT** heredar acceso permisivo.

#### Scenario: Identificador ajeno
- GIVEN un usuario autorizado del negocio A
- WHEN usa un identificador financiero del negocio B
- THEN el servidor no revela ni modifica datos de B

### Requirement: Hora canónica

El negocio **MUST** tener una zona IANA canónica. El servidor **MUST** asignar la fecha efectiva, no editable en v1; filtros y métricas **MUST** usar la jornada seleccionada y no cortar automáticamente a medianoche.

#### Scenario: Movimiento nocturno
- GIVEN zona canónica y jornada abierta
- WHEN se registra después de las 00:00
- THEN conserva la hora correcta y la jornada abierta

### Requirement: Agenda y Caja coherentes

Agenda y Caja **MUST** mostrar la misma cuenta y movimientos. “Pago del turno” **MUST** estar cerrado por defecto y resumir estado/saldo; abierto **MUST** permitir total estimativo, descuento, historial y pago según permisos.

#### Scenario: Pago desde Agenda
- GIVEN sesión activa y permiso de pagos
- WHEN se cobra desde el turno
- THEN el mismo movimiento aparece en Caja

### Requirement: Apertura contextual

Si falta sesión, Agenda **MUST** preservar turno y formulario. Con permiso **MUST** ofrecer CTA integrado “Abrir caja”; sin permiso **MUST** explicar que requiere un responsable autorizado.

#### Scenario: Abrir sin perder datos
- GIVEN un importe cargado con Caja cerrada
- WHEN el autorizado abre Caja y regresa
- THEN el turno y los datos ingresados permanecen disponibles

### Requirement: UX integrada y estados vacíos

Confirmaciones, errores y advertencias **MUST** usar componentes del CRM y **MUST NOT** usar `alert`, `confirm` ni `prompt`. Caja **MUST** mostrar estados accionables para primera apertura, jornada cerrada y ausencia de movimientos.

#### Scenario: Descuento inválido
- GIVEN un descuento que produciría saldo negativo
- WHEN se intenta guardar
- THEN un componente integrado explica el error

### Requirement: Realtime post-commit

Los cambios financieros **MUST** publicarse sólo después de confirmar la operación y propagarse entre instancias únicamente al tenant correspondiente; una reversión **MUST NOT** emitir un estado confirmado.

#### Scenario: Actualización multiusuario
- GIVEN Agenda y Caja abiertas para el mismo negocio en instancias distintas
- WHEN se confirma un pago
- THEN ambas reciben actualización post-commit y otros negocios no reciben el evento

### Requirement: Exclusiones del MVP

El sistema **MUST NOT** incluir en esta entrega facturación fiscal, comisiones, saldo a favor, cuotas, conciliación automática, categorías avanzadas, recibos/exportaciones ni doble partida.

#### Scenario: Función excluida
- GIVEN el MVP de Caja
- WHEN se consulta una conciliación bancaria automática
- THEN no se ofrece como capacidad disponible
