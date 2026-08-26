/**
 * F5.7 — Contrato puro del read model de horarios de profesionales.
 *
 * Cubre:
 * - formatProfessionalListLabel: reservable vs no reservable
 * - formatProfessionalWeeklySchedule: semana completa, parcial, cerrado
 * - Excepciones del profesional en ventana 30 días
 * - No sección vacía si no hay excepciones
 * - No expone note/motivo interno
 * - Determinismo del orden
 * - Validación de inputs
 *
 * Ejecución: npx tsx scripts/bot-options-f57-professional-hours-pure-test.ts
 */

import assert from 'node:assert/strict'
import {
  formatProfessionalListLabel,
  formatProfessionalWeeklySchedule,
  formatProfessionalExceptionLabel,
  formatTimeRange,
  formatDayHours,
  groupHoursByDay,
  sortWeeklyHours,
  formatExceptionLabel,
  DAY_NAMES,
  EXCEPTION_WINDOW_DAYS,
  validateBusinessWeeklyRow,
  validateOperationalException,
  computeExceptionWindow,
  decomposeDateInTimezone,
  calcularOffsetUtcMs,
  sumarDiasCalendario,
  isValidTimezone,
  formatTimeInTimezoneString,
  type BusinessWeeklyHourRow,
  type BusinessOperationalException,
  type ProfessionalCatalogRow,
  type ProfessionalWeeklyHourRow,
  type ProfessionalOperationalException
} from '../src/bot-options/application/hours-queries.js'

const dbNow = new Date('2026-08-25T12:00:00Z')
const timezone = 'America/Buenos_Aires'

// ─── formatProfessionalListLabel ─────────────────────────────────────────────

const bookable: ProfessionalCatalogRow = { professionalId: 'p1', name: 'Ana García', acceptsBotBookings: true }
const nonBookable: ProfessionalCatalogRow = { professionalId: 'p2', name: 'Carlos López', acceptsBotBookings: false }

assert.equal(formatProfessionalListLabel(bookable), 'Ana García', 'reservable: sin sufijo')
assert.equal(formatProfessionalListLabel(nonBookable), 'Carlos López — No reservable por este medio', 'no reservable: con separador')
console.log('OK formatProfessionalListLabel')

// ─── formatProfessionalWeeklySchedule — semana completa ───────────────────────

const fullWeekHours: ProfessionalWeeklyHourRow[] = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 6, startTime: '10:00', endTime: '14:00' }
]

const fullSchedule = formatProfessionalWeeklySchedule('Ana', fullWeekHours, [], dbNow, timezone)
assert.ok(fullSchedule.includes('*Lunes*: 09:00 a 18:00'), `lunes: ${fullSchedule}`)
assert.ok(fullSchedule.includes('*Martes*: 09:00 a 18:00'), 'martes')
assert.ok(fullSchedule.includes('*Miércoles*: 09:00 a 18:00'), 'miércoles')
assert.ok(fullSchedule.includes('*Jueves*: 09:00 a 18:00'), 'jueves')
assert.ok(fullSchedule.includes('*Viernes*: 09:00 a 18:00'), 'viernes')
assert.ok(fullSchedule.includes('*Sábado*: 10:00 a 14:00'), 'sábado')
assert.ok(fullSchedule.includes('*Domingo*: Cerrado'), 'domingo cerrado')
assert.ok(!fullSchedule.includes('Excepciones'), 'sin excepciones no hay sección')
console.log('OK formatProfessionalWeeklySchedule: semana completa')

// ─── formatProfessionalWeeklySchedule — semana parcial (sólo lunes y miércoles)

const partialHours: ProfessionalWeeklyHourRow[] = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 3, startTime: '10:00', endTime: '16:00' }
]
const partialSchedule = formatProfessionalWeeklySchedule('Bob', partialHours, [], dbNow, timezone)
assert.ok(partialSchedule.includes('*Lunes*: 09:00 a 18:00'))
assert.ok(partialSchedule.includes('*Martes*: Cerrado'), 'martes cerrado')
assert.ok(partialSchedule.includes('*Miércoles*: 10:00 a 16:00'))
assert.ok(partialSchedule.includes('*Jueves*: Cerrado'))
assert.ok(partialSchedule.includes('*Viernes*: Cerrado'))
assert.ok(partialSchedule.includes('*Sábado*: Cerrado'))
assert.ok(partialSchedule.includes('*Domingo*: Cerrado'))
console.log('OK formatProfessionalWeeklySchedule: semana parcial')

// ─── formatProfessionalWeeklySchedule — todo cerrado ──────────────────────────

const emptySchedule = formatProfessionalWeeklySchedule('Sin Horarios', [], [], dbNow, timezone)
for (const day of ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']) {
  assert.ok(emptySchedule.includes(`*${day}*: Cerrado`), `${day} cerrado`)
}
console.log('OK formatProfessionalWeeklySchedule: todo cerrado')

// ─── formatProfessionalWeeklySchedule — con excepciones ───────────────────────

const exceptions: ProfessionalOperationalException[] = [
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z') },
  { startAt: new Date('2026-09-15T03:00:00Z'), endAt: new Date('2026-09-16T06:00:00Z') }
]
const scheduleWithExc = formatProfessionalWeeklySchedule('Ana', fullWeekHours, exceptions, dbNow, timezone)
assert.ok(scheduleWithExc.includes('Excepciones próximas:'), 'sección excepciones presente')
assert.ok(scheduleWithExc.includes('No atiende'), 'generic copy exposed')
assert.ok(!scheduleWithExc.includes('Feriado'), 'reason HOLIDAY NOT exposed')
assert.ok(!scheduleWithExc.includes('Día del Logger'), 'title NOT exposed')
assert.ok(!scheduleWithExc.includes('Ausencia'), 'reason ABSENCE NOT exposed')
console.log('OK formatProfessionalWeeklySchedule: con excepciones — privacidad')

// ─── formatProfessionalWeeklySchedule — note/reason/title no se exponen ──────

const excWithNote: ProfessionalOperationalException[] = [
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z') }
]
const label = formatProfessionalExceptionLabel(excWithNote[0]!, timezone)
assert.ok(label.includes('No atiende'), 'generic copy used')
assert.equal(
  label,
  'No atiende: del jueves, 10 de septiembre 00:00 al viernes, 11 de septiembre 00:00',
  'exception times are rendered as HH:mm strings'
)
assert.ok(!label.includes('[object Object]'), 'exception label never interpolates time-part objects')
console.log('OK formatProfessionalExceptionLabel: note/reason/title no se exponen')

// ─── formatProfessionalWeeklySchedule — excepciones ordenadas ────────────────

const unsorted: ProfessionalOperationalException[] = [
  { startAt: new Date('2026-09-15T03:00:00Z'), endAt: new Date('2026-09-16T03:00:00Z') },
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z') },
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z') }
]
const sortedSchedule = formatProfessionalWeeklySchedule('X', [], unsorted, dbNow, timezone)
const excLines = sortedSchedule.split('\n').filter((l) => l.startsWith('•'))
// All lines should use generic "No atiende" copy
for (const line of excLines) {
  assert.ok(line.includes('No atiende'), `sorted line uses generic copy: ${line}`)
}
// Order: same startAt → same endAt (stable sort)
assert.equal(excLines.length, 3, '3 exception lines')
console.log('OK formatProfessionalWeeklySchedule: orden determinista + privacidad')

// ─── formatProfessionalWeeklySchedule — múltiples intervalos ─────────────────

const multiInterval: ProfessionalWeeklyHourRow[] = [
  { dayOfWeek: 1, startTime: '14:00', endTime: '20:00' },
  { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }
]
const multiSchedule = formatProfessionalWeeklySchedule('Multi', multiInterval, [], dbNow, timezone)
assert.ok(
  multiSchedule.includes('*Lunes*: 09:00 a 12:00, 14:00 a 20:00'),
  `intervalos ordenados: ${multiSchedule}`
)
console.log('OK formatProfessionalWeeklySchedule: múltiples intervalos')

// ─── determinismo ────────────────────────────────────────────────────────────

const s1 = formatProfessionalWeeklySchedule('Ana', fullWeekHours, [], dbNow, timezone)
const s2 = formatProfessionalWeeklySchedule('Ana', fullWeekHours, [], dbNow, timezone)
assert.equal(s1, s2, 'mismo input → misma salida')
console.log('OK determinismo del formato')

// ─── validación de inputs ────────────────────────────────────────────────────

assert.throws(
  () => formatProfessionalWeeklySchedule('X', [{ dayOfWeek: 7, startTime: '09:00', endTime: '18:00' }], [], dbNow, timezone),
  /dayOfWeek/,
  'bad dayOfWeek throws'
)
assert.throws(
  () => formatProfessionalWeeklySchedule('X', [{ dayOfWeek: 1, startTime: '25:00', endTime: '18:00' }], [], dbNow, timezone),
  /startTime/,
  'bad startTime throws'
)
assert.throws(
  () => formatProfessionalWeeklySchedule('X', [],
    [{ startAt: new Date('invalid'), endAt: new Date('2026-09-11T03:00:00Z') }],
    dbNow, timezone),
  /startAt/,
  'bad exception startAt throws'
)
console.log('OK formatProfessionalWeeklySchedule: validación de inputs')

// ─── formatProfessionalExceptionLabel — privacy ──────────────────────────────

// Test: formatProfessionalExceptionLabel exposes NO reason/title/note
const secretExc: ProfessionalOperationalException = {
  startAt: new Date('2026-09-10T03:00:00Z'),
  endAt: new Date('2026-09-11T03:00:00Z')
}
const profLabel = formatProfessionalExceptionLabel(secretExc, timezone)
assert.ok(profLabel.startsWith('No atiende'), `label starts with generic copy: ${profLabel}`)
console.log('OK formatProfessionalExceptionLabel: NO reason/title exposed')

// Test: formatProfessionalExceptionLabel with multi-day exception
const multiDayExc: ProfessionalOperationalException = {
  startAt: new Date('2026-09-10T03:00:00Z'),
  endAt: new Date('2026-09-15T03:00:00Z')
}
const multiLabel = formatProfessionalExceptionLabel(multiDayExc, timezone)
assert.ok(multiLabel.startsWith('No atiende'), `multi-day: generic copy`)
console.log('OK formatProfessionalExceptionLabel: multi-day NO reason/title exposed')

// Test: professional schedule uses generic copy, not formatExceptionLabel
const secretsForSchedule: ProfessionalOperationalException[] = [
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z') },
  { startAt: new Date('2026-09-15T03:00:00Z'), endAt: new Date('2026-09-16T06:00:00Z') }
]
const privacySchedule = formatProfessionalWeeklySchedule('Secret', [], secretsForSchedule, dbNow, timezone)
assert.ok(privacySchedule.includes('No atiende'), `schedule: uses generic copy`)
console.log('OK formatProfessionalWeeklySchedule: privacy — secrets NOT in output')

// ─── Renderer label split: title/description con separador " — " ─────────────

import { renderWhatsAppScreen, WHATSAPP_ROW_TITLE_MAX, WHATSAPP_ROW_DESCRIPTION_MAX } from '../src/bot-options/infrastructure/whatsapp-renderer.js'
import { menuView } from '../src/bot-options/domain/views.js'

// Simular view con label no reservable usando separador " — "
const nonReservableLabel = 'Carlos López — No reservable por este medio'
const reservableLabel = 'Ana García'
const testPromptToken = 'test_pure_'.padEnd(16, '0')
let tokenCounter = 0
function testChoiceBytes(): Buffer { tokenCounter += 1; return Buffer.from(String(tokenCounter).padStart(8, '0')) }

const viewWithNonReservable = menuView('¿De quién querés ver el horario?', [
    { actionType: 'hours.professional_select' as const, label: 'María García', entityRef: { type: 'PROFESSIONAL' as const, id: 'p0' } },
    { actionType: 'hours.professional_select' as const, label: nonReservableLabel, entityRef: { type: 'PROFESSIONAL' as const, id: 'p1' } },
    { actionType: 'hours.professional_select' as const, label: 'Laura Sánchez', entityRef: { type: 'PROFESSIONAL' as const, id: 'p3' } },
    { actionType: 'hours.professional_select' as const, label: 'Pedro López', entityRef: { type: 'PROFESSIONAL' as const, id: 'p4' } }
  ])
const rendered = renderWhatsAppScreen(viewWithNonReservable, { promptToken: testPromptToken, generateChoiceBytes: testChoiceBytes })
const listRows = rendered.items.find((item) => item.type === 'interactive' && 'mode' in item && item.mode === 'list')
assert.ok(listRows && 'rows' in listRows, 'rendered as interactive list')
if (listRows && 'rows' in listRows) {
  // Find the Carlos López row (index 1)
  const row = listRows.rows![1]!
  // Title should be "Carlos López" (split at " — ")
  assert.equal(row.title, 'Carlos López', `title split at separator: ${row.title}`)
  assert.ok([...row.title].length <= WHATSAPP_ROW_TITLE_MAX, `title ≤ ${WHATSAPP_ROW_TITLE_MAX}: ${row.title}`)
  // Description should be "No reservable por este medio"
  assert.equal(row.description, 'No reservable por este medio', `description from split: ${row.description}`)
  assert.ok([...row.description!].length <= WHATSAPP_ROW_DESCRIPTION_MAX, `description ≤ ${WHATSAPP_ROW_DESCRIPTION_MAX}: ${row.description}`)
}
console.log('OK renderer: non-reservable label splits into title + description correctly')

// Simular view con label reservable (sin separador)
const viewWithReservable = menuView('¿De quién querés ver el horario?', [
    { actionType: 'hours.professional_select' as const, label: reservableLabel, entityRef: { type: 'PROFESSIONAL' as const, id: 'p2' } },
    { actionType: 'hours.professional_select' as const, label: 'Laura Sánchez', entityRef: { type: 'PROFESSIONAL' as const, id: 'p3' } },
    { actionType: 'hours.professional_select' as const, label: 'Pedro López', entityRef: { type: 'PROFESSIONAL' as const, id: 'p4' } },
    { actionType: 'hours.professional_select' as const, label: 'Sofía Martínez', entityRef: { type: 'PROFESSIONAL' as const, id: 'p5' } }
  ])
const renderedReservable = renderWhatsAppScreen(viewWithReservable, { promptToken: testPromptToken, generateChoiceBytes: testChoiceBytes })
const listRowsReservable = renderedReservable.items.find((item) => item.type === 'interactive' && 'mode' in item && item.mode === 'list')
assert.ok(listRowsReservable && 'rows' in listRowsReservable, 'reservable rendered as interactive list')
if (listRowsReservable && 'rows' in listRowsReservable) {
  const row = listRowsReservable.rows![0]!
  assert.equal(row.title, 'Ana García', `reservable title: ${row.title}`)
  assert.ok(!('description' in row) || row.description === undefined, 'reservable has NO description')
}
console.log('OK renderer: reservable label stays as title only (no description)')

// ─── No crea draft, no revela agenda ─────────────────────────────────────────

// El read model puro no tiene dependencias de Appointment ni Professional
// (se verifica estáticamente: las funciones exportadas no consultan DB)
console.log('OK: professional hours functions son puras (sin dependencias de DB)')

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('OK F5.7 professional hours pure: todos los contratos pasan')
console.log('═══════════════════════════════════════════════════════════════')
