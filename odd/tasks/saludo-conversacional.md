# Saludo conversacional redactado por la IA

El usuario pidió que la IA redacte el saludo completo y que la respuesta suene natural, sin duplicar saludos ni recurrir a «¿En qué te puedo ayudar con el local?».

- [x] SC1. Dar a la IA la identidad verificada para redactar el primer saludo social y validar la respuesta completa antes de entregarla. Mantener el flujo de reservas y los hechos del servidor. Verificar el motor compartido por WhatsApp e Instagram. Ruta delegada por contrato de respuesta, compositor y regresión.

TDD estricto según `openspec/config.yaml`. Pruebas de composición y actos comunicativos mediante tsx, sintaxis/UTF-8 aplicables. Forecast 100–200 líneas. Estrategia ask-on-risk. Alcance local. Engram pendiente por falta de herramienta.

RED y GREEN observados en la regresión nueva con respuestas simuladas. La prueba de identidad pasó. Actos comunicativos conserva ocho fallos observados en la base y las pruebas de primer borrador, contrato e intérprete se detienen en las mismas aserciones que en `main` (632a8dd). No se enviaron mensajes reales. UTF-8 y diff limpios.
