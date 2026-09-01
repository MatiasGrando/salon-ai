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
assert.match(
  crmUiSource,
  /function bindAgendaProfessionalHorizontalDrag\(/,
  'la vista diaria por profesionales debe registrar su propio arrastre horizontal'
)
assert.match(
  crmUiSource,
  /bindAgendaProfessionalHorizontalDrag\(frame, \[daysViewport, columnsViewport\], syncHorizontalScroll, navigateProfessionalDay\)/,
  'el encabezado y la grilla profesional deben desplazarse de forma sincronizada'
)
assert.match(
  crmUiSource,
  /viewport\.scrollLeft = pointer\.startScrollLeft - deltaX/,
  'el arrastre horizontal debe mover realmente el viewport profesional'
)
assert.match(
  crmUiSource,
  /const intent = agendaRangeGestureIntent\(deltaX, deltaY\)/,
  'el desplazamiento profesional debe compartir el arbitraje con la seleccion vertical'
)
assert.match(
  crmUiSource,
  /const canScroll = viewport\.scrollWidth > viewport\.clientWidth \+ 1/,
  'el gesto debe detectar cuando todas las columnas profesionales ya entran en pantalla'
)
assert.match(
  crmUiSource,
  /const dayOffset = !pointer\.canScroll && Math\.abs\(deltaX\) >= 48/,
  'un deslizamiento sin overflow debe convertirse en navegacion diaria'
)
assert.match(
  crmUiSource,
  /state\.agendaSelectedDate = addDays\(state\.agendaSelectedDate, dayOffset\)/,
  'el fallback del gesto debe avanzar o retroceder un dia'
)
assert.match(
  crmUiSource,
  /data-agenda-professional-swipe-hint/,
  'la vista diaria debe incluir un indicador visual para el cambio de dia'
)
assert.match(
  crmUiSource,
  /--agenda-professional-swipe-x/,
  'el contenido diario debe acompañar visualmente al puntero'
)
assert.match(
  crmUiSource,
  /Math\.max\(-72, Math\.min\(72, deltaX \* \.35\)\)/,
  'el feedback debe aplicar resistencia y limitar el recorrido visual'
)
assert.match(
  crmUiSource,
  /classList\.toggle\('armed', Math\.abs\(deltaX\) >= 48\)/,
  'el indicador debe señalar cuando se alcanza el umbral de navegacion'
)
assert.match(
  crmUiSource,
  /window\.setTimeout\(\(\) => navigateDay\(dayOffset\), 120\)/,
  'el cambio de fecha debe esperar la transicion de salida'
)

console.log('OK: la agenda inicia en un dia y conserva las vistas 1/3/7 con fallbacks consistentes.')
