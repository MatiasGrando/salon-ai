# Appointment Finance Specification

## Purpose

Define la cuenta, precio, descuentos y cobros compartidos por Agenda y Caja.

## Requirements

### Requirement: Cuenta financiera de la reserva

El sistema **MUST** mantener una cuenta única por reserva simple, `BookingVisit` o grupo coordinado; cada turno **MUST** pertenecer como máximo a una cuenta. Los turnos manuales creados individualmente **MAY** conservar cuentas separadas en v1.

#### Scenario: Reserva coordinada
- GIVEN varios turnos del mismo grupo web
- WHEN se consulta cualquiera de ellos
- THEN todos muestran el mismo total, pagos y saldo

### Requirement: Precio acordado y descuento

El sistema **MUST** congelar el precio fijo y **MUST NOT** permitir editarlo. Para precio estimativo **MUST** exigir y permitir editar el total definitivo. La UI **MUST** aceptar el descuento únicamente como monto nominal entero, sin motivo obligatorio y sólo con permiso; **MUST NOT** dejar el total final bajo lo ya pagado.

#### Scenario: Descuento válido
- GIVEN una cuenta de $100.000 con $20.000 pagados
- WHEN un autorizado aplica un descuento de $10.000
- THEN se persiste $10.000 y el total final es $90.000

#### Scenario: Descuento inválido
- GIVEN pagos mayores al total final propuesto
- WHEN se intenta guardar el descuento
- THEN una ventana integrada explica el error y nada cambia

### Requirement: Pagos manuales

El sistema **MUST** admitir pagos completos, parciales y mixtos con `CASH`, `TRANSFER` o `CARD`; Mercado Pago **MUST** clasificarse `TRANSFER`. Cada línea **MUST** guardar importe, medio, origen, observación opcional y hora de servidor no editable. Un pago manual **MUST** requerir sesión activa y la suma atómica **MUST NOT** superar el saldo, aun bajo concurrencia.

#### Scenario: Pago mixto
- GIVEN saldo $18.000 y sesión activa
- WHEN se cobran $10.000 CASH y $8.000 CARD
- THEN se crean dos cobros y el saldo queda en cero

#### Scenario: Sobrepago concurrente
- GIVEN saldo $10.000
- WHEN dos solicitudes concurrentes intentan cobrarlo
- THEN como máximo $10.000 queda aplicado y la otra falla sin saldo a favor

### Requirement: Proyección de señas

Un comprobante pendiente **MUST NOT** contar como cobro. Una seña web o bot aprobada **MUST** proyectarse exactamente una vez como `TRANSFER`; **MUST** asociarse a la sesión activa o quedar fuera de sesión sin bloquear la aprobación.

#### Scenario: Aprobación repetida
- GIVEN una seña ya proyectada
- WHEN la aprobación se reintenta
- THEN no se crea otro cobro

### Requirement: Historia e inmutabilidad

Los cobros confirmados **MUST NOT** editarse ni borrarse; una corrección **MUST** ser una contrapartida vinculada. Un pago manual legacy **MUST** mostrarse “Pago anterior sin especificar”, contar para pagado/saldo y quedar fuera de jornada, sesión y desglose por medio.

#### Scenario: Corregir un pago
- GIVEN un cobro incorrecto
- WHEN se registra su contrapartida
- THEN el original permanece visible y el saldo refleja ambos

### Requirement: Límites monetarios v1

Los importes **MUST** ser enteros no negativos en la moneda implícita del negocio. El sistema **MUST NOT** administrar cambio, cuotas ni saldo a favor.

#### Scenario: Importe sobre saldo
- GIVEN saldo $18.000
- WHEN se intenta aplicar $20.000
- THEN se rechaza el registro completo
