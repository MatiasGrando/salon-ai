# Marketing y WhatsApp: estado y siguientes features

## Orden acordado

1. Completar el enlace entre plantillas aprobadas de Meta y campanas.
2. Hacer un envio controlado al numero del administrador.
3. Probar con 2 o 3 clientes con autorizacion de marketing `ACTIVE`.
4. Mantener bloqueados los envios masivos hasta validar esas pruebas.
5. Implementar recordatorios automaticos.

## Campanas con plantillas de Meta

- Una campana solo puede seleccionar plantillas `APPROVED` del mismo comercio.
- El texto, nombre, idioma e ID de Meta se toman de la plantilla seleccionada.
- Las variables con nombre se convierten al formato numerado requerido por Meta.
- La prueba al numero del administrador usa los ejemplos cargados en la plantilla.
- Antes del piloto con clientes falta mapear las variables a datos reales del CRM.

## Recordatorios automaticos pendientes

- Plantillas de categoria `UTILITY`.
- Anticipacion configurable respecto del turno.
- Variables de cliente, fecha, hora, servicio y profesional.
- Idempotencia para no enviar recordatorios duplicados.
- Cancelacion o reprogramacion cuando cambia el turno.
- Cola, historial y estados de entrega.

