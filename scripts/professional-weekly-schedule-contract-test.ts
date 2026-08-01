import assert from 'node:assert/strict'
import { weeklyScheduleRows } from '../src/routes/crm-ui.js'

const professionalRows = weeklyScheduleRows({
  prefix: 'professional',
  rowClass: 'schedule-row',
  weekdayEnd: '18:00',
  weekendEnd: '14:00'
})
const businessRows = weeklyScheduleRows({
  prefix: 'business',
  rowClass: 'business-hours-row',
  weekdayEnd: '19:00',
  weekendEnd: '14:00'
})

const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

assert.equal((professionalRows.match(/data-weekly-schedule-day=/g) || []).length, 7)
assert.equal((businessRows.match(/data-weekly-schedule-day=/g) || []).length, 7)

for (const day of days) {
  assert.equal(professionalRows.includes(`id="professional-${day}-enabled"`), true)
  assert.equal(professionalRows.includes(`id="professional-${day}-start"`), true)
  assert.equal(professionalRows.includes(`id="professional-${day}-end"`), true)
  assert.equal(businessRows.includes(`id="business-${day}-enabled"`), true)
}

assert.equal(professionalRows.includes('professional-weekdays-enabled'), false)
assert.equal(professionalRows.includes('Lunes a viernes'), false)

console.log('OK: comercio y profesionales reutilizan siete filas semanales editables por separado.')
