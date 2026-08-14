import assert from 'node:assert/strict'
import { normalizeWeeklyHours, validateWeeklyHours } from '../src/services/weekly-hours.js'
import { weeklyScheduleRows } from '../src/routes/crm-ui.js'

const splitSchedule = [
  { dayOfWeek: 1, startTime: '10:00', endTime: '14:00' },
  { dayOfWeek: 1, startTime: '16:00', endTime: '21:00' },
  { dayOfWeek: 2, startTime: '10:00', endTime: '14:00' },
  { dayOfWeek: 2, startTime: '16:00', endTime: '21:00' }
]

const valid = validateWeeklyHours(splitSchedule)
assert.equal(valid.ok, true)
if (valid.ok) {
  assert.deepEqual(valid.hours, splitSchedule)
}

assert.equal(validateWeeklyHours([
  { dayOfWeek: 1, startTime: '10:00', endTime: '16:00' },
  { dayOfWeek: 1, startTime: '14:00', endTime: '21:00' }
]).ok, false)

assert.equal(validateWeeklyHours([
  { dayOfWeek: 1, startTime: '10:00', endTime: '14:00' },
  { dayOfWeek: 1, startTime: '10:00', endTime: '14:00' }
]).ok, false)

assert.deepEqual(normalizeWeeklyHours([
  { dayOfWeek: 0, startTime: '10:00', endTime: '14:00' },
  { dayOfWeek: 1, startTime: '16:00', endTime: '21:00' },
  { dayOfWeek: 1, startTime: '10:00', endTime: '14:00' }
]), [
  { dayOfWeek: 1, startTime: '10:00', endTime: '14:00' },
  { dayOfWeek: 1, startTime: '16:00', endTime: '21:00' },
  { dayOfWeek: 0, startTime: '10:00', endTime: '14:00' }
])

const rows = weeklyScheduleRows({
  prefix: 'business',
  rowClass: 'business-hours-row',
  weekdayEnd: '19:00',
  weekendEnd: '14:00'
})
assert.equal((rows.match(/data-weekly-schedule-add/g) || []).length, 7)
assert.equal((rows.match(/weekly-schedule-ranges/g) || []).length, 7)
assert.equal(rows.includes('Agregar otro horario'), true)

console.log('OK: los horarios cortados conservan varias franjas y rechazan superposiciones.')
