# Nuevo bot por opciones — backlog de la etapa 2

## Propósito

Este documento conserva decisiones postergadas deliberadamente. Ningún elemento
de esta lista debe filtrarse parcialmente dentro de la etapa 1 mediante parches.

## 1. Coordinación multiprofesional

Permitir que distintos profesionales realicen servicios consecutivos durante una
misma visita.

Debe resolver:

- construir secuencias continuas y sin superposición;
- informar profesional, servicio y horario de cada tramo;
- retener todos los calendarios o ninguno;
- confirmar, rechazar, vencer o cancelar todo el conjunto;
- vincular las reservas bajo una visita lógica común;
- recalcular el conjunto ante cualquier cambio;
- impedir confirmaciones y liberaciones parciales;
- aplicar una única seña al conjunto cuando corresponda.

Las recomendaciones y servicios que en etapa 1 se guardan como solicitud
pendiente de coordinación podrán ingresar al carrito principal únicamente si el
planificador encuentra una secuencia válida.

## 2. Retenciones atómicas multiprofesionales

La operación debe producir exactamente uno de estos resultados:

- todos los tramos retenidos;
- ningún tramo retenido.

Debe contemplar concurrencia entre calendarios, expiración, recuperación tras
caídas, compensación de efectos externos e idempotencia de confirmaciones.

La retención simple de un bloque continuo con un único profesional pertenece a
la etapa 1 y no depende de este planificador.

## 3. Orden configurable de disponibilidad

Evaluar una política por negocio después de completar servicios:

- profesional → fecha → horario;
- fecha → horario → profesional.

La variación debe implementarse como una política dentro de una sola máquina de
estados, no como motores duplicados.

## 4. Búsqueda invertida por hora

Permitir elegir una hora deseada y encontrar fechas compatibles.

Antes de implementarla hay que definir:

- coincidencia exacta o tolerancia;
- rango de tolerancia;
- horizonte y paginación;
- interacción con Cualquier profesional disponible;
- orden de resultados;
- bloques cuya duración no entra a la hora solicitada.

## 5. Catálogo avanzado

- Herramientas para detectar categorías con demasiadas opciones.
- Sugerencias de subcategorías sin reorganizar automáticamente el catálogo.
- Presentación explícita de complementos que requieren coordinación automática.

## 6. Optimización avanzada de agenda

Evaluar una política distinta de carga equilibrada, por ejemplo minimizar huecos
entre turnos. Debe ser explicable, determinística, auditable y configurable.

No reemplaza la política de menor cantidad de minutos ocupados de la etapa 1 sin
medición comparativa.

## 7. Migración de bots personalizados

Los comercios con bots personalizados permanecen en su motor actual. Cada
migración futura debe comparar capacidades, datos propios y handoffs antes de
activar el nuevo motor.

## Condición para iniciar esta etapa

No comenzar coordinación multiprofesional hasta que el piloto de etapa 1 haya
demostrado:

- transiciones determinísticas estables;
- ausencia de reservas duplicadas;
- recuperación correcta de opciones vencidas;
- retenciones y señas confiables;
- activación y rollback seguros;
- observabilidad suficiente para explicar cada transición.
