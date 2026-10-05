import assert from 'node:assert/strict'
import { resolveDialogueDate } from '../src/conversational-bot/dialogue-date.js'

const ref = '2026-10-01' // Thursday in the business calendar; no process timezone enters this API.
const resolved = (text: string, reference: string | null, date: string) => {
  const result = resolveDialogueDate(text, reference)
  assert.deepEqual(result.kind, 'resolved', `${text}: ${JSON.stringify(result)}`)
  if (result.kind === 'resolved') assert.equal(result.date, date, text)
}
const rejected = (text: string, reference: string | null, kind: string, reason: string) => {
  const result = resolveDialogueDate(text, reference)
  assert.equal(result.kind, kind, text)
  if (result.kind !== 'resolved') assert.equal(result.reason, reason, text)
}

resolved('hoy', ref, '2026-10-01')
resolved('mañana', ref, '2026-10-02')
resolved('pasado mañana', ref, '2026-10-03')
resolved('no, mejor el martes', ref, '2026-10-06')
resolved('el sábado', ref, '2026-10-03')
resolved('jueves', ref, ref)
resolved('domingo', ref, '2026-10-04')
resolved('mañana', '2026-12-31', '2027-01-01')
resolved('mañana', '2028-02-28', '2028-02-29')
resolved('mañana', '2027-02-28', '2027-03-01')
resolved('02/10', ref, '2026-10-02')
resolved('30/09', ref, '2027-09-30')
resolved('29/02', '2027-02-28', '2028-02-29')
resolved('29/02/2028', ref, '2028-02-29')
resolved('2027-01-01', ref, '2027-01-01')
resolved('mañana, 02/10/2026', ref, '2026-10-02')
resolved('martes 06/10/2026', ref, '2026-10-06')
resolved('2027-01-01', null, '2027-01-01')

rejected('martes', null, 'ambiguous', 'missing_reference')
rejected('02/10', null, 'ambiguous', 'missing_reference')
rejected('el martes de la semana pasada', ref, 'ambiguous', 'past_week')
rejected('el martes de la semana que viene', ref, 'ambiguous', 'week_modifier')
rejected('mañana o pasado mañana', ref, 'ambiguous', 'contradictory_dates')
rejected('mañana 03/10/2026', ref, 'ambiguous', 'contradictory_dates')
rejected('martes 03/10/2026', ref, 'ambiguous', 'contradictory_dates')
rejected('29/02/2027', ref, 'invalid', 'invalid_calendar_date')
rejected('31/04/2026', ref, 'invalid', 'invalid_calendar_date')
rejected('2026-13-01', ref, 'invalid', 'invalid_calendar_date')
rejected('30/09/2026', ref, 'invalid', 'past_date')
rejected('mañana', '2026-02-30', 'invalid', 'invalid_reference')
rejected('a fin de mes', ref, 'unsupported', 'unsupported_expression')
rejected('ayer', ref, 'unsupported', 'unsupported_expression')
rejected('17:00', ref, 'unsupported', 'unsupported_expression')

// Weekday is a qualifier of an explicit date, not a second implicit nearest-week date.
resolved('sábado 29/08/2026','2026-08-21','2026-08-29')
resolved('sábado 2026-08-29','2026-08-21','2026-08-29')
resolved('sábado 29/08','2026-08-21','2026-08-29')
resolved('sábado 29/08/2026',null,'2026-08-29')
assert.deepEqual(resolveDialogueDate('sábado 29/08/2026','2026-08-21'),{kind:'resolved',date:'2026-08-29',source:'mixed'})
rejected('viernes 29/08/2026','2026-08-21','ambiguous','contradictory_dates')
rejected('sábado 29/08/2026 o 05/09/2026','2026-08-21','ambiguous','contradictory_dates')
rejected('hoy sábado 29/08/2026','2026-08-21','ambiguous','contradictory_dates')
rejected('sábado 29/08/2026','2026-08-30','invalid','past_date')

console.log('dialogue calendar date resolver: OK')
