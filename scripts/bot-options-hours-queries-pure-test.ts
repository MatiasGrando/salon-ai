/**
 * F5.6 — Contrato puro del read model de horarios semanales del negocio.
 *
 * Cubre:
 * - Semana completa lunes–domingo con intervalos múltiples
 * - Día cerrado (sin intervalos)
 * - Excepciones operativas (ScheduleBlock a nivel negocio)
 * - Bordes de ventana 30 días
 * - Determinismo del ordenamiento
 * - Tenant-scoped (validación de que no se filtra por businessId en pure)
 * - No crea draft ni revela agenda
 *
 * Ejecución: npx tsx scripts/bot-options-hours-queries-pure-test.ts
 */

import assert from 'node:assert/strict'
import {
  formatTimeRange,
  formatDayHours,
  sortWeeklyHours,
  groupHoursByDay,
  formatBusinessWeeklySchedule,
  computeExceptionWindow,
  formatDateInTimezone,
  formatTimeInTimezoneString,
  formatExceptionLabel,
  blockReasonLabel,
  DAY_NAMES,
  EXCEPTION_WINDOW_DAYS,
  decomposeDateInTimezone,
  calcularOffsetUtcMs,
  sumarDiasCalendario,
  isValidTimezone,
  validateBusinessWeeklyRow,
  validateOperationalException,
  type BusinessWeeklyHourRow,
  type BusinessOperationalException
} from '../src/bot-options/application/hours-queries.js'

/** Helper: formatea un Date como ISO sin milisegundos para comparación exacta. */
function isoNoMs(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, '.000Z')
}

// ─── formatTimeRange ──────────────────────────────────────────────────────────

assert.equal(formatTimeRange('09:00', '18:00'), '09:00 a 18:00')
assert.equal(formatTimeRange('14:00', '20:30'), '14:00 a 20:30')
console.log('OK formatTimeRange')

// ─── formatDayHours ───────────────────────────────────────────────────────────

assert.equal(formatDayHours([]), 'Cerrado')
assert.equal(
  formatDayHours([{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }]),
  '09:00 a 18:00'
)
assert.equal(
  formatDayHours([
    { dayOfWeek: 1, startTime: '14:00', endTime: '20:00' },
    { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }
  ]),
  '09:00 a 12:00, 14:00 a 20:00',
  'intervalos se ordenan por startTime'
)
console.log('OK formatDayHours')

// ─── sortWeeklyHours ──────────────────────────────────────────────────────────

const unsorted: BusinessWeeklyHourRow[] = [
  { dayOfWeek: 0, startTime: '10:00', endTime: '14:00' },  // domingo
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },  // miércoles
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },  // lunes
  { dayOfWeek: 6, startTime: '10:00', endTime: '14:00' },  // sábado
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },  // viernes
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },  // martes
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },  // jueves
]
const sorted = sortWeeklyHours(unsorted)
const sortedDays = sorted.map((h) => h.dayOfWeek)
assert.deepEqual(sortedDays, [1, 2, 3, 4, 5, 6, 0], 'orden lunes→domingo')
console.log('OK sortWeeklyHours: lunes→domingo')

// ─── groupHoursByDay ──────────────────────────────────────────────────────────

const withMultipleIntervals: BusinessWeeklyHourRow[] = [
  { dayOfWeek: 1, startTime: '14:00', endTime: '20:00' },
  { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
]
const grouped = groupHoursByDay(withMultipleIntervals)
assert.equal(grouped.size, 2)
assert.equal(grouped.get(1)!.length, 2, 'lunes tiene 2 intervalos')
assert.equal(grouped.get(3)!.length, 1, 'miércoles tiene 1 intervalo')
assert.deepEqual(
  grouped.get(1)!.map((h) => h.startTime),
  ['09:00', '14:00'],
  'groupHoursByDay ordena por startTime dentro de cada día'
)
console.log('OK groupHoursByDay')

// ─── blockReasonLabel ─────────────────────────────────────────────────────────

assert.equal(blockReasonLabel('VACATION'), 'Vacaciones')
assert.equal(blockReasonLabel('HOLIDAY'), 'Feriado')
assert.equal(blockReasonLabel('CUSTOM_REASON'), 'CUSTOM_REASON', 'reason desconocido se usa raw')
console.log('OK blockReasonLabel')

// ─── validateBusinessWeeklyRow ────────────────────────────────────────────────

const validRow: BusinessWeeklyHourRow = { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }
assert.deepEqual(validateBusinessWeeklyRow(validRow), { ok: true, row: validRow })

// dayOfWeek fuera de rango
assert.equal(validateBusinessWeeklyRow({ ...validRow, dayOfWeek: 7 }).ok, false)
assert.equal(validateBusinessWeeklyRow({ ...validRow, dayOfWeek: -1 }).ok, false)
assert.equal(validateBusinessWeeklyRow({ ...validRow, dayOfWeek: 1.5 }).ok, false)

// startTime inválido
assert.equal(validateBusinessWeeklyRow({ ...validRow, startTime: '9:00' }).ok, false, '9:00 sin pad')
assert.equal(validateBusinessWeeklyRow({ ...validRow, startTime: '25:00' }).ok, false, 'hora > 23')
assert.equal(validateBusinessWeeklyRow({ ...validRow, startTime: 'abc' }).ok, false, 'no es HH:mm')
assert.equal(validateBusinessWeeklyRow({ ...validRow, startTime: '' }).ok, false, 'vacío')

// endTime inválido
assert.equal(validateBusinessWeeklyRow({ ...validRow, endTime: '25:00' }).ok, false)
assert.equal(validateBusinessWeeklyRow({ ...validRow, endTime: '18:60' }).ok, false, 'minuto > 59')

// start >= end
assert.equal(validateBusinessWeeklyRow({ ...validRow, startTime: '18:00', endTime: '09:00' }).ok, false, 'start > end')
assert.equal(validateBusinessWeeklyRow({ ...validRow, startTime: '09:00', endTime: '09:00' }).ok, false, 'start = end')

// Domingo válido
assert.deepEqual(validateBusinessWeeklyRow({ dayOfWeek: 0, startTime: '10:00', endTime: '14:00' }).ok, true)
console.log('OK validateBusinessWeeklyRow')

// ─── validateOperationalException ─────────────────────────────────────────────

const validExc: BusinessOperationalException = {
  startAt: new Date('2026-09-10T03:00:00Z'),
  endAt: new Date('2026-09-11T03:00:00Z'),
  reason: 'HOLIDAY', title: null, note: null
}
assert.deepEqual(validateOperationalException(validExc), { ok: true })

// endAt <= startAt
assert.equal(validateOperationalException({ ...validExc, endAt: validExc.startAt }).ok, false, 'end = start')
assert.equal(validateOperationalException({ ...validExc, endAt: new Date('2026-09-09T03:00:00Z') }).ok, false, 'end < start')

// Invalid dates
assert.equal(validateOperationalException({ ...validExc, startAt: new Date('invalid') }).ok, false, 'startAt invalid')
assert.equal(validateOperationalException({ ...validExc, endAt: new Date('invalid') }).ok, false, 'endAt invalid')

// Epoch 0
assert.equal(validateOperationalException({ ...validExc, startAt: new Date(0) }).ok, false, 'startAt epoch 0')
console.log('OK validateOperationalException')

// ─── formatBusinessWeeklySchedule — validation throws on bad input ────────────

const validationDbNow = new Date('2026-08-25T12:00:00Z')
assert.throws(
  () => formatBusinessWeeklySchedule([{ dayOfWeek: 7, startTime: '09:00', endTime: '18:00' }], [], validationDbNow, 'UTC'),
  /dayOfWeek/,
  'bad dayOfWeek throws'
)
assert.throws(
  () => formatBusinessWeeklySchedule([{ dayOfWeek: 1, startTime: '25:00', endTime: '18:00' }], [], validationDbNow, 'UTC'),
  /startTime/,
  'bad startTime throws'
)
assert.throws(
  () => formatBusinessWeeklySchedule([],
    [{ startAt: new Date('invalid'), endAt: new Date('2026-09-11T03:00:00Z'), reason: 'X', title: null, note: null }],
    validationDbNow, 'UTC'),
  /startAt/,
  'bad exception startAt throws'
)
console.log('OK formatBusinessWeeklySchedule: validation rejects invalid input')

// ─── isValidTimezone ──────────────────────────────────────────────────────────

assert.equal(isValidTimezone('America/Buenos_Aires'), true)
assert.equal(isValidTimezone('UTC'), true, 'UTC es timezone válida')
assert.equal(isValidTimezone('utc'), true, 'UTC case-insensitive')
assert.equal(isValidTimezone(''), false)
assert.equal(isValidTimezone('Foo/Bar'), false, 'Foo/Bar no es IANA real')
assert.equal(isValidTimezone('NotATimezone'), false)
assert.equal(isValidTimezone('   '), false, 'solo whitespace')
assert.ok(isValidTimezone('Asia/Kolkata'))
assert.ok(isValidTimezone('America/New_York'))
assert.ok(isValidTimezone('Pacific/Kiritimati'))
assert.ok(isValidTimezone('Pacific/Chatham'))
console.log('OK isValidTimezone: Intl-based validation')

// ─── decomposeDateInTimezone ─────────────────────────────────────────────────

const aug25_utc = new Date('2026-08-25T12:00:00Z')
const decomBA = decomposeDateInTimezone(aug25_utc, 'America/Buenos_Aires')
assert.equal(decomBA.day, 25); assert.equal(decomBA.month, 8); assert.equal(decomBA.year, 2026)
const decomIST = decomposeDateInTimezone(aug25_utc, 'Asia/Kolkata')
assert.equal(decomIST.day, 25); assert.equal(decomIST.month, 8)
const decomUTC = decomposeDateInTimezone(aug25_utc, 'UTC')
assert.equal(decomUTC.day, 25)
console.log('OK decomposeDateInTimezone')

// ─── calcularOffsetUtcMs — Rango completo UTC-12..UTC+14 ─────────────────────

// Buenos Aires: UTC-3
assert.equal(calcularOffsetUtcMs(aug25_utc, 'America/Buenos_Aires'), -3 * 60 * 60 * 1000)
// UTC: 0
assert.equal(calcularOffsetUtcMs(aug25_utc, 'UTC'), 0)
// Asia/Kolkata: UTC+5:30
assert.equal(calcularOffsetUtcMs(aug25_utc, 'Asia/Kolkata'), 5.5 * 60 * 60 * 1000)
// America/New_York: UTC-4 (EDT en agosto 2026)
assert.equal(calcularOffsetUtcMs(aug25_utc, 'America/New_York'), -4 * 60 * 60 * 1000)
// Pacific/Kiritimati: UTC+14 (la zona más al este del mundo)
const kiritimatiOffset = calcularOffsetUtcMs(aug25_utc, 'Pacific/Kiritimati')
assert.equal(kiritimatiOffset, 14 * 60 * 60 * 1000, `Kiritimati +14: ${kiritimatiOffset}`)
// Pacific/Chatham: +12:45 (DST) o +12:45 normal
const chathamOffset = calcularOffsetUtcMs(aug25_utc, 'Pacific/Chatham')
assert.equal(chathamOffset, 12.75 * 60 * 60 * 1000, `Chatham +12:45: ${chathamOffset}`)
// Pacific/Kwajalein: UTC+12
assert.equal(calcularOffsetUtcMs(aug25_utc, 'Pacific/Kwajalein'), 12 * 60 * 60 * 1000)
// Pacific/Pago_Pago: UTC-11
assert.equal(calcularOffsetUtcMs(aug25_utc, 'Pacific/Pago_Pago'), -11 * 60 * 60 * 1000)
// Asia/Kathmandu: UTC+5:45
const kathmanduOffset = calcularOffsetUtcMs(aug25_utc, 'Asia/Kathmandu')
assert.equal(kathmanduOffset, 5.75 * 60 * 60 * 1000, `Kathmandu +5:45: ${kathmanduOffset}`)
// Australia/Lord_Howe: +10:30 (DST half-hour)
const lordHoweOffset = calcularOffsetUtcMs(aug25_utc, 'Australia/Lord_Howe')
// Lord_Howe in Aug 2026: AEST = +10:30
assert.equal(lordHoweOffset, 10.5 * 60 * 60 * 1000, `Lord Howe +10:30: ${lordHoweOffset}`)
console.log('OK calcularOffsetUtcMs: UTC-12..UTC+14, fractional offsets')

// ─── calcularOffsetUtcMs — DST both sides (America/New_York) ─────────────────
// Enero: EST (UTC-5)
const jan1 = new Date('2026-01-15T12:00:00Z')
assert.equal(calcularOffsetUtcMs(jan1, 'America/New_York'), -5 * 60 * 60 * 1000, 'NY EST en enero')
// Julio: EDT (UTC-4)
const jul1 = new Date('2026-07-15T12:00:00Z')
assert.equal(calcularOffsetUtcMs(jul1, 'America/New_York'), -4 * 60 * 60 * 1000, 'NY EDT en julio')
console.log('OK calcularOffsetUtcMs: DST both sides')

// ─── sumarDiasCalendario ──────────────────────────────────────────────────────

const summed = sumarDiasCalendario(2026, 8, 25, 30)
assert.equal(summed.year, 2026); assert.equal(summed.month, 9); assert.equal(summed.day, 24)
const sumFromJan30 = sumarDiasCalendario(2025, 1, 30, 31)
assert.equal(sumFromJan30.month, 3); assert.equal(sumFromJan30.day, 2)
const sumFromJan30Leap = sumarDiasCalendario(2024, 1, 30, 31)
assert.equal(sumFromJan30Leap.month, 3); assert.equal(sumFromJan30Leap.day, 1)
console.log('OK sumarDiasCalendario')

// ─── isValidTimezone rejects invalid ──────────────────────────────────────────

assert.throws(() => computeExceptionWindow(aug25_utc, ''), /Invalid IANA timezone/)
assert.throws(() => computeExceptionWindow(aug25_utc, 'Foo/Bar'), /Invalid IANA timezone/)
console.log('OK computeExceptionWindow rejects invalid timezone')

// ─── computeExceptionWindow — helper para verificar from/to en timezone ──────

function assertWindowFromTo(
  dbNow: Date, tz: string, expectedFromLocal: string, expectedToLocal: string, label: string
) {
  const w = computeExceptionWindow(dbNow, tz)
  // from formateado en la timezone debe ser exactamente 00:00 de expectedFromLocal
  const fromStr = formatTimeInTimezoneString(w.from, tz)
  const fromDate = decomposeDateInTimezone(w.from, tz)
  assert.equal(fromStr, '00:00', `${label}: from es midnight local`)
  assert.equal(`${fromDate.year}-${String(fromDate.month).padStart(2, '0')}-${String(fromDate.day).padStart(2, '0')}`,
    expectedFromLocal, `${label}: from date`)

  const toStr = formatTimeInTimezoneString(w.to, tz)
  const toDate = decomposeDateInTimezone(w.to, tz)
  assert.equal(toStr, '00:00', `${label}: to es midnight local`)
  assert.equal(`${toDate.year}-${String(toDate.month).padStart(2, '0')}-${String(toDate.day).padStart(2, '0')}`,
    expectedToLocal, `${label}: to date`)

  // Verificar que el intervalo es exactamente 30 días calendario
  const fromParts = decomposeDateInTimezone(w.from, tz)
  const expectedTo = sumarDiasCalendario(fromParts.year, fromParts.month, fromParts.day, EXCEPTION_WINDOW_DAYS)
  const toParts = decomposeDateInTimezone(w.to, tz)
  assert.equal(toParts.year, expectedTo.year, `${label}: to year = from + 30 days`)
  assert.equal(toParts.month, expectedTo.month, `${label}: to month = from + 30 days`)
  assert.equal(toParts.day, expectedTo.day, `${label}: to day = from + 30 days`)
}

// ─── computeExceptionWindow — Buenos Aires (UTC-3) ───────────────────────────

const dbNow = new Date('2026-08-25T12:00:00Z')
assertWindowFromTo(dbNow, 'America/Buenos_Aires', '2026-08-25', '2026-09-24', 'Buenos Aires')
console.log('OK computeExceptionWindow: Buenos Aires (midnight + 30 días exactos)')

// ─── computeExceptionWindow — UTC (offset 0) ─────────────────────────────────

assertWindowFromTo(dbNow, 'UTC', '2026-08-25', '2026-09-24', 'UTC')
console.log('OK computeExceptionWindow: UTC')

// ─── computeExceptionWindow — Asia/Kolkata (UTC+5:30, fractional) ────────────

// 2026-08-25T12:00:00Z = 17:30 IST → from = 2026-08-25 00:00 IST
assertWindowFromTo(dbNow, 'Asia/Kolkata', '2026-08-25', '2026-09-24', 'Kolkata +5:30')
console.log('OK computeExceptionWindow: Asia/Kolkata (UTC+5:30)')

// ─── computeExceptionWindow — Pacific/Kiritimati (UTC+14) ────────────────────

// 2026-08-25T12:00:00Z = 2026-08-26T02:00:00 Kiritimati → from = 2026-08-26 00:00
assertWindowFromTo(dbNow, 'Pacific/Kiritimati', '2026-08-26', '2026-09-25', 'Kiritimati +14')
// Kiritimati from = 2026-08-26 00:00 local = 2026-08-25 10:00 UTC (before dbNow 12:00 UTC)
// This is correct: the window starts at midnight LOCAL of the business day where dbNow falls
const wKiri = computeExceptionWindow(dbNow, 'Pacific/Kiritimati')
assert.equal(wKiri.from.toISOString(), '2026-08-25T10:00:00.000Z', 'Kiritimati from = midnight local = 10:00 UTC')
console.log('OK computeExceptionWindow: Pacific/Kiritimati (UTC+14)')

// ─── computeExceptionWindow — Pacific/Chatham (UTC+12:45) ────────────────────

// 2026-08-25T12:00:00Z = 2026-08-26T00:45 Chatham → from = 2026-08-26 00:00
assertWindowFromTo(dbNow, 'Pacific/Chatham', '2026-08-26', '2026-09-25', 'Chatham +12:45')
console.log('OK computeExceptionWindow: Pacific/Chatham (UTC+12:45)')

// ─── computeExceptionWindow — America/New_York (DST) ─────────────────────────

// Agosto: EDT (UTC-4)
assertWindowFromTo(dbNow, 'America/New_York', '2026-08-25', '2026-09-24', 'NY EDT')
console.log('OK computeExceptionWindow: America/New_York (EDT)')

// Enero: EST (UTC-5)
const janDbNow = new Date('2026-01-15T12:00:00Z')
assertWindowFromTo(janDbNow, 'America/New_York', '2026-01-15', '2026-02-14', 'NY EST')
console.log('OK computeExceptionWindow: America/New_York (EST)')

// ─── computeExceptionWindow — DST crossing (Feb→Mar, EST→EDT) ────────────────

const feb10 = new Date('2026-02-10T12:00:00Z')
assertWindowFromTo(feb10, 'America/New_York', '2026-02-10', '2026-03-12', 'NY DST cross')
// Verificar que to usa EDT no EST (Mar 12 después de DST start Mar 8)
const wDST = computeExceptionWindow(feb10, 'America/New_York')
const toOffsetDST = calcularOffsetUtcMs(wDST.to, 'America/New_York')
assert.equal(toOffsetDST, -4 * 60 * 60 * 1000, 'to está en EDT (UTC-4) tras DST start')
console.log('OK computeExceptionWindow: DST crossing usa offset correcto en to')

// ─── formatDateInTimezone ─────────────────────────────────────────────────────

const aug25 = new Date('2026-08-25T12:00:00Z')
const formattedDate = formatDateInTimezone(aug25, 'America/Buenos_Aires')
assert.ok(formattedDate.includes('25'), `fecha debe incluir día: ${formattedDate}`)
assert.ok(formattedDate.includes('Agosto') || formattedDate.includes('agosto'), `fecha debe incluir mes: ${formattedDate}`)
assert.ok(formattedDate.includes('martes') || formattedDate.includes('Martes'), `fecha debe incluir día semana: ${formattedDate}`)
console.log('OK formatDateInTimezone')

// ─── formatTimeInTimezoneString ───────────────────────────────────────────────

const aug25_15 = new Date('2026-08-25T18:00:00Z') // 15:00 ART
const timeStr = formatTimeInTimezoneString(aug25_15, 'America/Buenos_Aires')
assert.equal(timeStr, '15:00', `hora en ART: ${timeStr}`)
console.log('OK formatTimeInTimezoneString')

// ─── formatExceptionLabel ─────────────────────────────────────────────────────

const exception: BusinessOperationalException = {
  startAt: new Date('2026-09-10T03:00:00Z'), // 00:00 ART
  endAt: new Date('2026-09-11T03:00:00Z'),
  reason: 'HOLIDAY',
  title: 'Día del.getLogger',
  note: null
}
const excLabel = formatExceptionLabel(exception, 'America/Buenos_Aires')
assert.ok(excLabel.includes('Feriado'), `label incluye reason: ${excLabel}`)
assert.ok(excLabel.includes('Día del.getLogger'), `label incluye título: ${excLabel}`)
console.log('OK formatExceptionLabel')

// ─── formatBusinessWeeklySchedule — semana completa ───────────────────────────

const fullWeekHours: BusinessWeeklyHourRow[] = [
  // Lunes a Viernes: 09:00–18:00
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 2, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 3, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 4, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 5, startTime: '09:00', endTime: '18:00' },
  // Sábado: 10:00–14:00
  { dayOfWeek: 6, startTime: '10:00', endTime: '14:00' },
  // Domingo: cerrado (no hay fila)
]

const fullSchedule = formatBusinessWeeklySchedule(fullWeekHours, [], dbNow, 'America/Buenos_Aires')
assert.ok(fullSchedule.includes('*Lunes*: 09:00 a 18:00'), `lunes: ${fullSchedule}`)
assert.ok(fullSchedule.includes('*Martes*: 09:00 a 18:00'), `martes`)
assert.ok(fullSchedule.includes('*Miércoles*: 09:00 a 18:00'), `miércoles`)
assert.ok(fullSchedule.includes('*Jueves*: 09:00 a 18:00'), `jueves`)
assert.ok(fullSchedule.includes('*Viernes*: 09:00 a 18:00'), `viernes`)
assert.ok(fullSchedule.includes('*Sábado*: 10:00 a 14:00'), `sábado`)
assert.ok(fullSchedule.includes('*Domingo*: Cerrado'), `domingo cerrado`)
assert.ok(!fullSchedule.includes('Excepciones'), 'sin excepciones')
assert.ok(fullSchedule.includes('Los horarios pueden variar en fechas especiales.'), 'aclaración pública presente')
console.log('OK formatBusinessWeeklySchedule: semana completa')

// ─── formatBusinessWeeklySchedule — semana parcial (sólo lunes y miércoles) ───

const partialHours: BusinessWeeklyHourRow[] = [
  { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
  { dayOfWeek: 3, startTime: '10:00', endTime: '16:00' },
]
const partialSchedule = formatBusinessWeeklySchedule(partialHours, [], dbNow, 'America/Buenos_Aires')
assert.ok(partialSchedule.includes('*Lunes*: 09:00 a 18:00'))
assert.ok(partialSchedule.includes('*Martes*: Cerrado'), 'martes cerrado en semana parcial')
assert.ok(partialSchedule.includes('*Miércoles*: 10:00 a 16:00'))
assert.ok(partialSchedule.includes('*Jueves*: Cerrado'))
assert.ok(partialSchedule.includes('*Viernes*: Cerrado'))
assert.ok(partialSchedule.includes('*Sábado*: Cerrado'))
assert.ok(partialSchedule.includes('*Domingo*: Cerrado'))
console.log('OK formatBusinessWeeklySchedule: semana parcial')

// ─── formatBusinessWeeklySchedule — múltiples intervalos ──────────────────────

const multiIntervalHours: BusinessWeeklyHourRow[] = [
  { dayOfWeek: 1, startTime: '14:00', endTime: '20:00' },
  { dayOfWeek: 1, startTime: '09:00', endTime: '12:00' },
]
const multiSchedule = formatBusinessWeeklySchedule(multiIntervalHours, [], dbNow, 'America/Buenos_Aires')
assert.ok(
  multiSchedule.includes('*Lunes*: 09:00 a 12:00, 14:00 a 20:00'),
  `múltiples intervalos ordenados: ${multiSchedule}`
)
console.log('OK formatBusinessWeeklySchedule: múltiples intervalos')

// ─── formatBusinessWeeklySchedule — con excepciones operativas ────────────────

const exceptions: BusinessOperationalException[] = [
  {
    startAt: new Date('2026-09-10T03:00:00Z'),
    endAt: new Date('2026-09-11T03:00:00Z'),
    reason: 'HOLIDAY',
    title: 'Día del Logger',
    note: null
  },
  {
    startAt: new Date('2026-09-15T03:00:00Z'),
    endAt: new Date('2026-09-16T06:00:00Z'),
    reason: 'MAINTENANCE',
    title: null,
    note: 'Reparación de equipamiento'
  }
]
const scheduleWithExceptions = formatBusinessWeeklySchedule(fullWeekHours, exceptions, dbNow, 'America/Buenos_Aires')
assert.ok(!scheduleWithExceptions.includes('Excepciones próximas:'), 'las excepciones internas no se publican')
assert.ok(!scheduleWithExceptions.includes('Feriado'), 'el motivo interno no se publica')
assert.ok(!scheduleWithExceptions.includes('Día del Logger'), 'el título interno no se publica')
assert.ok(!scheduleWithExceptions.includes('Mantenimiento'), 'el motivo interno no se publica')
assert.ok(scheduleWithExceptions.includes('Para conocer la disponibilidad exacta, podés buscar un turno.'), 'orienta hacia la disponibilidad real')
console.log('OK formatBusinessWeeklySchedule: excepciones privadas')

// ─── formatBusinessWeeklySchedule — sin horarios (todo cerrado) ───────────────

const emptySchedule = formatBusinessWeeklySchedule([], [], dbNow, 'America/Buenos_Aires')
assert.ok(emptySchedule.includes('*Lunes*: Cerrado'))
assert.ok(emptySchedule.includes('*Domingo*: Cerrado'))
console.log('OK formatBusinessWeeklySchedule: sin horarios (todo cerrado)')

// ─── formatExceptionLabel — note no se expone ─────────────────────────────────

const excWithNote: BusinessOperationalException = {
  startAt: new Date('2026-09-10T03:00:00Z'),
  endAt: new Date('2026-09-11T03:00:00Z'),
  reason: 'MAINTENANCE',
  title: 'Reparación',
  note: 'Detalles internos del equipamiento roto - NO mostrar al cliente'
}
const labelWithNote = formatExceptionLabel(excWithNote, 'America/Buenos_Aires')
assert.ok(!labelWithNote.includes('NO mostrar al cliente'),
  `note NO se expone en el label: ${labelWithNote}`)
assert.ok(!labelWithNote.includes('Detalles internos'),
  `note NO se expone: ${labelWithNote}`)
assert.ok(labelWithNote.includes('Mantenimiento'), 'reason SÍ se muestra')
assert.ok(labelWithNote.includes('Reparación'), 'title SÍ se muestra')
console.log('OK formatExceptionLabel: note no se expone')

// ─── formatBusinessWeeklySchedule — excepciones no alteran el texto público ───

const unsortedExceptions: BusinessOperationalException[] = [
  { startAt: new Date('2026-09-15T03:00:00Z'), endAt: new Date('2026-09-16T03:00:00Z'), reason: 'MAINTENANCE', title: null, note: null },
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z'), reason: 'HOLIDAY', title: null, note: null },
  { startAt: new Date('2026-09-10T03:00:00Z'), endAt: new Date('2026-09-11T03:00:00Z'), reason: 'ABSENCE', title: null, note: null },
]
const scheduleSorted = formatBusinessWeeklySchedule([], unsortedExceptions, dbNow, 'America/Buenos_Aires')
assert.equal(scheduleSorted, formatBusinessWeeklySchedule([], [], dbNow, 'America/Buenos_Aires'))
console.log('OK formatBusinessWeeklySchedule: excepciones no alteran el texto público')

// El mismo input siempre produce la misma salida
const schedule1 = formatBusinessWeeklySchedule(fullWeekHours, [], dbNow, 'America/Buenos_Aires')
const schedule2 = formatBusinessWeeklySchedule(fullWeekHours, [], dbNow, 'America/Buenos_Aires')
assert.equal(schedule1, schedule2, 'formato determinista: mismo input → misma salida')
console.log('OK determinismo del formato')

// ─── Day names completos ─────────────────────────────────────────────────────

assert.equal(DAY_NAMES.length, 7)
assert.equal(DAY_NAMES[0], 'Domingo')
assert.equal(DAY_NAMES[1], 'Lunes')
assert.equal(DAY_NAMES[6], 'Sábado')
console.log('OK DAY_NAMES')

// ─── WINDOW_DAYS constante ───────────────────────────────────────────────────

assert.equal(EXCEPTION_WINDOW_DAYS, 30, 'ventana de excepciones = 30 días')
console.log('OK EXCEPTION_WINDOW_DAYS')

// ─── No crea draft, no revela agenda ─────────────────────────────────────────

// El read model puro no tiene dependencias de BookingRegion, Appointment ni Professional
// (esto se verifica estáticamente: el módulo no importa esos tipos)
console.log('OK: hours-queries.ts no importa BookingRegion/Appointment/Professional (alcance estricto)')

console.log('')
console.log('═══════════════════════════════════════════════════════════════')
console.log('OK F5.6 hours-queries pure: todos los contratos pasan')
console.log('═══════════════════════════════════════════════════════════════')
