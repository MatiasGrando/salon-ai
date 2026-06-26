# Matriz inicial de pruebas

## Flujo

| ID | Situacion | Resultado |
| --- | --- | --- |
| F01 | Saludo inicial | Se presenta una vez y pide nombre |
| F02 | Nombre simple | Guarda nombre y pide servicio |
| F03 | Nombre y servicio juntos | Guarda ambos y pide profesional |
| F04 | Servicio y fecha sin nombre | Guarda datos validos y pide nombre |
| F05 | Todos los datos juntos | Valida y muestra resumen para confirmar |
| F06 | Confirmacion explicita | Crea exactamente un turno |

## Confianza

| ID | Situacion | Resultado |
| --- | --- | --- |
| K01 | `Quiero cortarme el pelo` | Alta: guarda Corte de pelo |
| K02 | `Quiero un corte` con servicios parecidos | Media: pregunta cual quiso |
| K03 | `Quiero cortarme el lope` | Baja: no guarda y rehace pregunta |
| K04 | Confirma propuesta media | Guarda propuesta y continua |
| K05 | Rechaza propuesta media | Descarta propuesta y ofrece opciones |
| K06 | Un campo claro y otro dudoso | Guarda solo el campo claro |
| K07 | Alta confianza pero opcion inexistente | Backend rechaza y muestra opciones reales |

## Correcciones

| ID | Situacion | Resultado |
| --- | --- | --- |
| C01 | Con profesional, fecha y hora dice `mejor otro dia` | Pregunta si quiere cambiar el dia |
| C02 | Confirma cambio de dia | Conserva nombre, servicio y profesional; limpia fecha y horario |
| C03 | Rechaza cambio de dia | Conserva fecha y horario anteriores |
| C04 | Dice `mejor con otra persona` | Confirma cambio de profesional |
| C05 | Cambia profesional | Conserva fecha y limpia horario |
| C06 | Dice `queria barba tambien` | Confirma servicio y revalida profesional y horario |
| C07 | Correccion explicita con nuevo valor | Confirma o aplica segun confianza del valor |

## Validacion y seguridad

| ID | Situacion | Resultado |
| --- | --- | --- |
| V01 | Servicio inexistente | No guarda; ofrece servicios reales |
| V02 | Profesional no ofrece servicio | Ofrece profesionales compatibles |
| V03 | Fecha pasada | Solicita otra fecha |
| V04 | Horario ocupado | Ofrece horarios disponibles |
| V05 | Confirmacion final ambigua | No crea turno |
| V06 | Mensaje duplicado | No crea dos turnos |
| V07 | OpenAI falla | Continua con fallback determinista |
| V08 | Tres incomprensiones | Ofrece derivacion humana |

## Aserciones por paso

Comprobar `currentStep`, valores confirmados, propuesta pendiente, confianza, evidencia, primer campo faltante, invalidaciones, datos conservados, cantidad de turnos y aislamiento entre comercios.
