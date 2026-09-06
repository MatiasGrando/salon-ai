# Cash Register Specification

## Purpose

Define jornadas, responsables, control de efectivo y movimientos generales de Caja.

## Requirements

### Requirement: Jornada operativa

El sistema **MUST** mantener una jornada desde Abrir caja hasta Cerrar caja, aunque cruce medianoche. La primera apertura **MUST** pedir responsable y efectivo inicial; cada apertura posterior **MUST** heredar el efectivo final de la jornada anterior.

#### Scenario: Cruce de medianoche
- GIVEN una jornada abierta el sábado
- WHEN se registra un movimiento el domingo antes del cierre
- THEN pertenece a la jornada del sábado

### Requirement: Sesiones responsables

Cada sesión **MUST** elegir un usuario activo del mismo negocio, incluido su administrador. Nueva sesión **MUST** cerrar la actual y abrir la siguiente atómicamente sin reiniciar la jornada ni sus totales. Nueva sesión y Cerrar caja **MUST** registrar efectivo esperado, contado y diferencia, pero **MUST NOT** crear un ajuste automático. Cerrar caja **MUST** finalizar jornada y sesión; la siguiente jornada **MUST** heredar el último efectivo esperado hasta que un ajuste manual cambie el saldo.

#### Scenario: Nueva sesión
- GIVEN jornada abierta por María
- WHEN se inicia sesión de Lucas con una diferencia
- THEN cambian responsable y control, continúan los totales y el saldo no se ajusta

### Requirement: Movimientos generales

Con sesión activa, el sistema **MUST** permitir: gasto con descripción y medio (CASH por defecto); retiro sólo CASH con persona que retira y motivo opcional; ingreso CASH con descripción; ajuste manual desde contado/delta con observación; devolución general con cualquier medio y descripción, sin vínculo requerido a turno/pago.

#### Scenario: Gasto no efectivo
- GIVEN una sesión activa
- WHEN se registra un gasto por transferencia
- THEN afecta gastos y neto, pero no el efectivo físico

#### Scenario: Retiro incompleto
- GIVEN una sesión activa
- WHEN se intenta retirar efectivo sin persona
- THEN no se registra el movimiento

### Requirement: Ledger append-only

Todo movimiento **MUST** registrar importe, medio aplicable, hora de servidor, origen y observación cuando sea requerida, y atribuirse al responsable de su sesión; se considera confirmado al agregarse. **MUST NOT** editarse ni borrarse y su corrección **MUST** usar contrapartida.

#### Scenario: Rectificación
- GIVEN un gasto registrado erróneamente
- WHEN se corrige
- THEN se agrega una contrapartida y ambos quedan auditables

### Requirement: Métricas de jornada

Caja **MUST** mostrar total cobrado bruto, cobros por medio, devoluciones separadas, neto derivable, gastos, retiros, ingresos, ajustes, efectivo inicial y esperado. El efectivo esperado **MUST** sumar CASH cobrado/ingresado/ajustado y restar gastos CASH, retiros y devoluciones CASH; otros medios **MUST NOT** alterarlo.

#### Scenario: Resumen diario
- GIVEN cobros $100.000 y devolución $20.000
- WHEN se consulta la jornada
- THEN bruto muestra $100.000, devolución $20.000 y neto $80.000

### Requirement: Consulta de movimientos

La UI **MUST** permitir seleccionar jornada, filtrar por tipo y medio, buscar por cliente o descripción y cargar resultados incrementalmente con orden estable.

#### Scenario: Filtrar movimientos
- GIVEN una jornada con múltiples movimientos
- WHEN se filtra CASH y se busca un cliente
- THEN sólo aparecen coincidencias y pueden cargarse páginas posteriores sin duplicados

### Requirement: Caja cerrada

Sin jornada/sesión activa, pagos manuales, gastos, retiros, ingresos, ajustes y devoluciones **MUST** bloquearse; las señas automáticas **MUST** seguir registrándose fuera de sesión.

#### Scenario: Operación manual cerrada
- GIVEN Caja cerrada
- WHEN se intenta registrar un gasto
- THEN no se crea el movimiento y se ofrece abrir Caja según permisos
