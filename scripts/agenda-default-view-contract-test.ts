import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const crmUiSource = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(
  crmUiSource,
  /agendaViewDays:\s*1,/,
  'la agenda debe iniciar mostrando un dia'
)
assert.match(
  crmUiSource,
  /const viewDays = \[1, 3, 7\]\.includes\(Number\(state\.agendaViewDays\)\) \? Number\(state\.agendaViewDays\) : 1/,
  'el renderer debe volver a un dia si recibe un valor de vista invalido'
)
assert.match(
  crmUiSource,
  /\[1, 3, 7\]\.map\(\(count\) => '<option value="' \+ count/,
  'el selector debe conservar las vistas de uno, tres y siete dias'
)
assert.match(
  crmUiSource,
  /state\.agendaViewDays = Number\(event\.target\.value \|\| 1\)/,
  'el selector debe volver a un dia cuando no recibe un valor'
)
assert.match(
  crmUiSource,
  /const viewDays = Number\(frame\.dataset\.agendaViewDays \|\| 1\)/,
  'los gestos deben interpretar como un dia un dataset ausente'
)
assert.match(
  crmUiSource,
  /data-agenda-view-days="' \+ viewDays \+ '"/,
  'el frame debe publicar la cantidad de dias renderizada para navegacion y gestos'
)

console.log('OK: la agenda inicia en un dia y conserva las vistas 1/3/7 con fallbacks consistentes.')
