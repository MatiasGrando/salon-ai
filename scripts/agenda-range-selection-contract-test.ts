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
assert.match(source, /data-agenda-action-rail/)
assert.match(source, /function agendaActionRailCellAtPointer\(/)
assert.match(source, /function selectAgendaOccupiedRange\(/)
assert.match(source, /eventNode\.closest\('\[data-gcal-professional\]'\)/)
assert.match(source, /startAgendaRangeSelection\(event, cell\)/)
assert.match(source, /agenda-action-rail-marker/)

const occupiedActionHandler = source.match(/eventNode\.querySelector\('\[data-agenda-new-at\]'\)\?\.addEventListener\('click'[\s\S]*?eventNode\.addEventListener\('pointerdown'/)?.[0] || ''
assert.match(occupiedActionHandler, /selectAgendaOccupiedRange/)
assert.doesNotMatch(occupiedActionHandler, /openAppointmentDialog/)
assert.doesNotMatch(occupiedActionHandler, /serviceId:\s*appointment\.serviceId/)

const rangePointerStart = source.match(/function startAgendaRangeSelection\([\s\S]*?function updateAgendaRangeSelection\(/)?.[0] || ''
assert.doesNotMatch(rangePointerStart, /stopPropagation\(/)
assert.match(source, /const deltaX = pointerEvent\.clientX - pointer\.startX/)
assert.match(source, /const deltaY = pointerEvent\.clientY - pointer\.startY/)
assert.match(source, /Math\.abs\(deltaX\) > Math\.abs\(deltaY\) \* 1\.15/)
assert.match(source, /if \(moved < 10\) return/)

console.log('OK: la agenda permite seleccionar un rango y elegir entre agendar o bloquear según permisos.')
