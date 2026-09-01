import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /function startAgendaRangeSelection\(/)
assert.match(source, /function updateAgendaRangeSelection\(/)
assert.match(source, /function finishAgendaRangeSelection\(/)
assert.match(source, /data-agenda-range-action="appointment"/)
assert.match(source, /data-agenda-range-action="block"/)
assert.match(source, /openAppointmentDialog\(\{[\s\S]*minute: selection\.startMinute/)
assert.match(source, /openAgendaBlockPopover\(\{[\s\S]*startAt:[\s\S]*endAt:/)
assert.match(source, /canCreateAppointments\(\)/)
assert.match(source, /canManageScheduleBlocks\(\)/)
assert.match(source, /cell\.dataset\.cellProfessionalId/)
assert.match(source, /agenda-range-selected/)
assert.match(source, /agenda-range-actions/)
assert.match(source, /pointerType === 'touch'/)

console.log('OK: la agenda permite seleccionar un rango y elegir entre agendar o bloquear según permisos.')
