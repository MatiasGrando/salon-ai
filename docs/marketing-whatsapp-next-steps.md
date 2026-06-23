# Marketing y WhatsApp: estado y siguientes features

## Orden acordado

1. [Hecho] Completar el enlace entre plantillas aprobadas de Meta y campanas.
2. [Hecho] Hacer un envio controlado al numero del administrador.
3. [En curso] Conectar WhatsApp por comercio desde Ajustes.
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
- [Hecho] Boton `Conectar WhatsApp` con login Meta y token real.
- [Hecho] Conexion tecnica manual para piloto/desarrollo.
- [Hecho] Configurar `META_APP_ID`, `META_APP_SECRET` y `META_EMBEDDED_SIGNUP_CONFIG_ID`.
- [Hecho] Validar popup real de Meta en dominio autorizado.
- [En curso] Capturar automaticamente WABA ID, Phone Number ID y numero visible desde Embedded Signup.
- [En curso] Diagnosticar si Meta no envia WABA/Phone, si llegan con otro formato o si el CRM los descarta.
- [Pendiente] Validar que el CRM conserve el comercio activo durante el retorno del popup de Meta.
- [Pendiente] Definir flujo de onboarding para comercios nuevos: login con Facebook, seleccion/creacion de negocio, creacion de cuenta WhatsApp Business y verificacion de telefono.
- [Pendiente] Agregar pantalla o guia interna para asistir al comercio cuando Meta no devuelve WABA/Phone Number automaticamente.
- [Pendiente] Resolver renovacion de token: reconectar manualmente en MVP y aviso antes del vencimiento.
- [Pendiente] Definir manejo productivo de tokens con cifrado o secret manager.

## Onboarding Meta para comercios

- [Pendiente] Disenar el flujo visible desde el CRM para un comercio sin Meta configurado.
- [Pendiente] Explicar dentro del CRM que el comercio debe iniciar sesion con Facebook personal y autorizar su negocio.
- [En curso] Validar que Embedded Signup oficial puede devolver Business Manager, WhatsApp Business Account y telefono sin carga manual cuando el popup se completa correctamente.
- [Pendiente] Si Meta no entrega IDs en el callback, implementar recuperacion automatica por Graph API con permisos aprobados o guiar carga manual.
- [Pendiente] Documentar requisitos previos del comercio: acceso admin al Business Manager, numero verificable, metodo de pago para campanas.
- [Pendiente] Separar estados: conectado tecnicamente, numero verificado, facturacion Meta lista, token proximo a vencer.
