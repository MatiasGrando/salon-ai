---
name: salon-ai-bot-qa
description: Disenar, implementar y revisar pruebas de regresion del bot de Salon AI. Usar al modificar el flujo de reservas, interpretacion con IA, niveles de confianza, correcciones, textos, derivacion humana o configuracion por comercio; al investigar una conversacion fallida; o antes de habilitar un comercio o Booking V2.
---

# Salon AI Bot QA

## Procedimiento

1. Leer [references/booking-contract.md](references/booking-contract.md).
2. Identificar las reglas afectadas.
3. Elegir escenarios de [references/test-matrix.md](references/test-matrix.md).
4. Agregar primero una prueba reproducible.
5. Implementar el cambio sin delegar estado ni acciones a la IA.
6. Ejecutar TypeScript y las pruebas relevantes.
7. Informar resultados, fallos preexistentes y riesgos pendientes.

## Reglas obligatorias

- Mantener el orden `nombre -> servicio -> profesional -> fecha -> horario -> confirmacion`.
- Extraer varios datos juntos, pero preguntar siempre por el primer campo faltante.
- Aplicar confianza por cada campo, no una confianza global del mensaje.
- No guardar valores de confianza media hasta confirmacion explicita.
- No guardar valores de confianza baja.
- Reconocer correcciones sobre datos elegidos y confirmar el cambio antes de invalidarlos.
- Validar todas las opciones contra los datos del comercio.
- No permitir que la IA cree, cancele o modifique turnos directamente.
- Mantener fallback determinista cuando OpenAI falle.
- Probar el estado y los datos, no depender de una frase exacta.

## Suites

- Mantener `conversation-smoke-test` para proteger el bot actual.
- Crear `booking-v2-contract-test` para el contrato nuevo.
- Separar pruebas del extractor, motor de estado e integracion con agenda.
- Ejecutar Booking V2 con IA activa y con fallback antes de habilitarlo.

## Criterio de aprobacion

No aprobar si el bot pierde datos validos, pregunta por datos confirmados, salta el primer campo faltante, guarda una interpretacion dudosa, modifica datos ante una correccion ambigua, inventa opciones, reserva sin confirmacion o falla sin OpenAI.
