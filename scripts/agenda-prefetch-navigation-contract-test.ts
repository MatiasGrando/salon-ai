import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /function agendaRangeContains\(/, 'debe centralizar la validacion del rango precargado')
assert.match(source, /function navigateAgendaToDate\(/, 'debe centralizar toda navegacion de fecha')
assert.match(
  source,
  /: addDays\(startOfDay\(state\.agendaSelectedDate\), -7\)[\s\S]*const rangeEnd = addDays\(rangeStart, monthRange \? 42 : 15\)/,
  'la vista operativa debe precargar quince dias: siete anteriores, el actual y siete siguientes'
)
assert.match(
  source,
  /if \(agendaRangeContains\(visibleStart, visibleEnd\)\) \{[\s\S]*renderAgenda\(\)[\s\S]*agendaShouldRefreshBuffer/,
  'un dia precargado debe renderizarse antes de renovar el buffer'
)
assert.match(
  source,
  /void loadAgenda\(\)\.catch/,
  'la renovacion cercana al borde debe ejecutarse en segundo plano'
)
assert.match(
  source,
  /agendaShouldRefreshBuffer\(visibleStart, visibleEnd\) && !state\.agendaLoadController/,
  'no debe reiniciar una precarga que ya esta en curso'
)
assert.match(
  source,
  /await navigateAgendaToDate\(addDays\(state\.agendaSelectedDate, dayOffset\)\)/,
  'el gesto diario profesional debe reutilizar el rango precargado'
)
assert.match(
  source,
  /await navigateAgendaToDate\(addDays\(state\.agendaSelectedDate, -state\.agendaViewDays\)\)/,
  'la flecha anterior debe navegar segun la vista sin recargar si ya esta precargada'
)
assert.match(
  source,
  /await navigateAgendaToDate\(addDays\(state\.agendaSelectedDate, state\.agendaViewDays\)\)/,
  'la flecha siguiente debe navegar segun la vista sin recargar si ya esta precargada'
)
assert.doesNotMatch(
  source,
  /state\.agendaSelectedDate = addDays\(state\.agendaSelectedDate, dayOffset\)[\s\S]{0,180}await loadAgenda\(\)/,
  'el gesto diario no debe forzar una consulta completa por cada paso'
)

console.log('OK agenda: navegación instantánea sobre rango precargado y renovación anticipada.')
