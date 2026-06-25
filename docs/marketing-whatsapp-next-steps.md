# Marketing y WhatsApp: estado y siguientes features

## Orden acordado

1. [Hecho] Completar el enlace entre plantillas aprobadas de Meta y campanas.
2. [Hecho] Hacer un envio controlado al numero del administrador.
3. [Hecho] Conectar WhatsApp por comercio desde Ajustes con carga manual asistida.
4. [Pendiente] Probar recordatorios con plantilla `UTILITY` aprobada.
5. [Pendiente] Probar con 1 cliente propio con autorizacion de marketing `ACTIVE`.
6. [Pendiente] Probar con 2 o 3 clientes con autorizacion de marketing `ACTIVE`.
7. [Pendiente] Mantener bloqueados los envios masivos hasta validar esas pruebas.

## Campanas con plantillas de Meta

- Una campana solo puede seleccionar plantillas `APPROVED` del mismo comercio.
- El texto, nombre, idioma e ID de Meta se toman de la plantilla seleccionada.
- Las variables con nombre se convierten al formato numerado requerido por Meta.
- La prueba al numero del administrador usa los ejemplos cargados en la plantilla.
- Antes del piloto con clientes falta mapear las variables a datos reales del CRM.

## Recordatorios automaticos pendientes

- [Hecho] Plantillas de categoria `UTILITY`.
- [Hecho] Anticipacion configurable respecto del turno.
- [Hecho] Variables de cliente, fecha, hora, servicio y profesional.
- [Hecho] Idempotencia para no enviar recordatorios duplicados.
- [Pendiente] Probar cancelacion o reprogramacion cuando cambia el turno.
- [Pendiente] Revisar cola, historial y estados de entrega con envios reales.

## WhatsApp por comercio

- [Hecho] Configuracion por comercio para WABA ID, Phone Number ID, token y numero visible.
- [Hecho] Bloqueos para campanas, recordatorios, pruebas, bot y respuestas manuales.
- [Hecho] Fallback `.env` solo para desarrollo/pruebas controladas.
- [Hecho] Boton de ayuda para cargar manualmente los datos de WhatsApp del comercio.
- [Hecho] Conexion tecnica manual para piloto/desarrollo.
- [Hecho] Configurar `META_APP_ID`, `META_APP_SECRET` y `META_EMBEDDED_SIGNUP_CONFIG_ID`.
- [Hecho] Validar popup real de Meta en dominio autorizado.
- [Hecho] Diagnosticar que Meta limita el Embedded Signup completo a apps Technology Provider/BSP.
- [Hecho] Dejar la carga manual como flujo principal del MVP.
- [Hecho] Agregar guia interna para asistir al comercio cuando Meta no devuelve WABA/Phone Number automaticamente.
- [Pendiente] Evaluar conversion de la app Meta a Technology Provider/BSP despues del MVP.
- [Pendiente] Definir flujo de onboarding para comercios nuevos: cuenta personal de Facebook, Business Manager, WhatsApp Business Account, telefono verificable y metodo de pago.
- [Pendiente] Resolver renovacion de token: reconectar manualmente en MVP y aviso antes del vencimiento.
- [Pendiente] Definir manejo productivo de tokens con cifrado o secret manager.

## Onboarding Meta para comercios

- [Hecho] Disenar el flujo visible desde el CRM para cargar WABA ID, Phone Number ID, numero visible, token y vencimiento.
- [Pendiente] Explicar dentro del CRM que el comercio debe tener acceso admin a su Business Manager y WhatsApp Business Account.
- [Hecho] Validar que Embedded Signup oficial no entrega WABA/Phone de forma confiable sin app Technology Provider/BSP.
- [Hecho] Mantener carga manual asistida de WABA ID y Phone Number ID como camino principal mientras la app no sea Technology Provider/BSP.
- [Pendiente] Documentar requisitos previos del comercio: acceso admin al Business Manager, numero verificable, metodo de pago para campanas.
- [Pendiente] Separar estados: conectado tecnicamente, numero verificado, facturacion Meta lista, token proximo a vencer.
