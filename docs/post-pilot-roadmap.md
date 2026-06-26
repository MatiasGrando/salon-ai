# Post-Pilot Roadmap

Cuando el piloto este validado, escalar el SaaS poco a poco con estos tres frentes.

## 1. Multi-negocio real para WhatsApp

Objetivo: dejar de depender de variables por cada local.

- Crear una tabla `WhatsAppAccount`.
- Asociar cada numero de WhatsApp a un `businessId`.
- Usar `metadata.phone_number_id` del webhook para identificar el negocio.
- Mover configuracion por local desde variables de entorno a base de datos.
- Mantener variables globales solo para configuracion tecnica compartida.

Resultado esperado:

```txt
Numero WhatsApp A -> Business A
Numero WhatsApp B -> Business B
Numero WhatsApp C -> Business C
```

## 2. Configuracion del bot por comercio

Objetivo: que cada local pueda configurar como atiende su asistente sin tocar codigo.

Alcance inicial acordado:

- Para los primeros clientes el foco comercial sera peluquerias/barberias.
- La plantilla de rubro peluqueria queda cubierta con el flujo actual de Booking V2: nombre, servicio, profesional, dia, horario y confirmacion.
- No hace falta crear bots separados por rubro en esta etapa. Primero se estabiliza peluquerias.

Pendiente antes de escalar mas alla del piloto:

- Nombre del bot.
- Tono de atencion: formal, cercano, juvenil, premium, etc.
- Uso de emojis.
- Nivel de IA por negocio: sin IA, IA simple o agente/orquestador.
- Mensaje de bienvenida.
- Frase de derivacion a humano.
- Reglas del local.
- Servicios destacados.
- Politicas: cancelaciones, tolerancia de llegada tarde, senas, etc.
- Pantalla de Configuracion del bot dentro del CRM.
- Activacion visual de Booking V2 por comercio, sin tocar base/API manualmente.
- Pantalla Probar bot: escribir como cliente y ver respuesta, datos detectados y estado guardado.
- Alias de servicios y profesionales mas comodos desde CRM.
- Checklist previo a activar WhatsApp real: servicios, profesionales, horarios, alias, prueba del bot y derivacion humana.
- Evitar prompts o flujos globales rigidos: cada comercio puede vender servicios distintos y necesitar una conversacion diferente.

Resultado esperado:

```txt
Salon A -> "Cami", tono cercano
Salon B -> "Lara", tono premium
Salon C -> "Recepcion", tono formal
```

Despues del piloto de peluquerias:

- Crear plantillas por rubro solo cuando haya demanda real.
- Ejemplos: estetica, medicos, clases/turnos.
- Mantener un motor comun y variar campos/reglas por rubro, no reescribir un bot entero por cada vertical.

## 3. CRM simple de conversaciones

Objetivo: que el negocio pueda ver conversaciones y tomar control cuando haga falta.

- Bandeja de conversaciones.
- Ver historial por cliente.
- Filtrar por pendientes, reservas, cancelaciones o errores.
- Marcar conversacion como atendida.
- Intervenir manualmente si Cami no puede resolver.
- Ver turnos asociados al cliente.
- Ver errores de WhatsApp o mensajes fallidos.

Nota de escalabilidad:

- Mantener el polling liviano de novedades como base para los primeros comercios.
- Agregar Supabase Realtime como mejora importante para pulir el producto: avisos instantaneos de mensajes nuevos, derivaciones humanas y cambios de estado sin depender de consultas periodicas.
- Usar Realtime solo como capa de notificaciones; las respuestas de WhatsApp deben seguir pasando por el backend y WhatsApp Cloud API.

Resultado esperado:

```txt
Cami atiende automaticamente
↓
El negocio puede revisar
↓
Un humano puede intervenir si hace falta
```

## Orden recomendado

1. Multi-negocio WhatsApp.
2. Configuracion del bot por comercio.
3. CRM simple.
4. IA mas natural sobre una base multi-tenant ya ordenada.
