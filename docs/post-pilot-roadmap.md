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

## 2. Configuracion del negocio y personalidad de Cami

Objetivo: que cada local pueda configurar como atiende su asistente.

- Nombre del bot.
- Tono de atencion: formal, cercano, juvenil, premium, etc.
- Nivel de IA por negocio: sin IA, IA simple o agente/orquestador.
- Mensaje de bienvenida.
- Reglas del local.
- Servicios destacados.
- Politicas: cancelaciones, tolerancia de llegada tarde, senas, etc.
- Horarios y profesionales desde una interfaz simple.
- Settings del bot por comercio: servicios disponibles, vocabulario esperado, preguntas frecuentes, estilo de conversacion y reglas para derivar a humano.
- Evitar prompts o flujos globales rigidos: cada comercio puede vender servicios distintos y necesitar una conversacion diferente.

Resultado esperado:

```txt
Salon A -> "Cami", tono cercano
Salon B -> "Lara", tono premium
Salon C -> "Recepcion", tono formal
```

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
2. Configuracion del negocio y personalidad.
3. CRM simple.
4. IA mas natural sobre una base multi-tenant ya ordenada.
