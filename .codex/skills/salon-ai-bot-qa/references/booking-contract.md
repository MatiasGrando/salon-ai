# Contrato de Booking V2

## Orden canonico

1. Nombre
2. Servicio
3. Profesional
4. Fecha
5. Horario
6. Confirmacion

Guardar todos los datos validos que aparezcan juntos. Preguntar siempre por el primer campo faltante.

## Confianza por campo

El extractor debe devolver por cada dato `value`, `confidence` y `evidence`.

Umbrales iniciales configurables:

- Alta: `>= 0.85`
- Media: `>= 0.55` y `< 0.85`
- Baja: `< 0.55`

### Confianza alta

Validar contra la base y guardar. Ejemplo: `Quiero cortarme el pelo` coincide claramente con `Corte de pelo`.

### Confianza media

No modificar el estado definitivo. Guardar una propuesta pendiente y pedir confirmacion cerrada.

Ejemplo: `Quiero un corte` puede responder `Queres Corte de pelo o Corte de pelo y barba?`. Si existe una sola interpretacion razonable: `Te referis a Corte de pelo?`.

Al confirmar, guardar. Al rechazar, descartar la propuesta y mostrar opciones reales.

### Confianza baja

No guardar ni cambiar datos. Avisar humanamente que no se entendio y repetir la pregunta del campo actual.

Ejemplo: `Quiero cortarme el lope` puede responder `Disculpa, no llegue a entender que servicio queres reservar. Estas son las opciones disponibles: ...`.

La respuesta debe reconocer la incomprension, nombrar el dato faltante, rehacer la pregunta y ofrecer opciones reales cuando ayude.

## Correcciones

Detectar intenciones como `mejor otro dia`, `prefiero con otra persona`, `cambiemos el horario` o `en realidad queria barba tambien`.

Una correccion ambigua no modifica el estado inmediatamente. Crear una propuesta y confirmar: `Queres cambiar el dia del turno?`.

Si confirma:

- Cambio de servicio: invalidar profesional y horario; revalidar fecha.
- Cambio de profesional: invalidar horario.
- Cambio de fecha: invalidar horario.
- Cambio de horario: invalidar confirmacion previa.

Retomar desde el campo modificado. Si rechaza, conservar el estado anterior.

## Responsabilidades

La IA extrae campos, confianza, evidencia e intenciones de correccion. El backend decide si acepta, confirma o rechaza; que campo preguntar; que dependencias invalidar; que opciones son validas; y cuando crear el turno.

## Seguridad

- Confirmar explicitamente antes de reservar.
- Revalidar disponibilidad al confirmar.
- Tras dos incomprensiones, usar opciones numeradas.
- Tras tres, ofrecer derivacion humana.
- Mantener funcionamiento sin OpenAI.
