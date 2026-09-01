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
assert.match(source, /<option value="OTHER" selected>Otro<\/option>/)
assert.match(source, /function openAgendaBlockPopover\(input = \{\}\) \{[\s\S]*els\.blockReason\.value = input\.reason \|\| 'OTHER'/)
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
assert.match(source, /function agendaRangeGestureIntent\(deltaX, deltaY\)/)
assert.match(source, /if \(horizontal >= 14 && horizontal > vertical \* 1\.5\) return 'horizontal'/)
assert.match(source, /if \(vertical >= 8 && vertical >= horizontal \* 0\.75\) return 'vertical'/)
assert.match(source, /if \(moved < 18\) return 'pending'/)
assert.match(source, /if \(intent === 'pending'\) return/)
assert.match(source, /if \(intent === 'horizontal'\)/)

const gestureIntentBody = source.match(/function agendaRangeGestureIntent\(deltaX, deltaY\) \{([\s\S]*?)\n    \}/)?.[1] || ''
const gestureIntent = new Function('deltaX', 'deltaY', gestureIntentBody) as (deltaX: number, deltaY: number) => string
assert.equal(gestureIntent(12, 9), 'vertical', 'un inicio diagonal debe conservar la intención vertical')
assert.equal(gestureIntent(12, 5), 'pending', 'un movimiento ambiguo no debe cancelarse prematuramente')
assert.equal(gestureIntent(20, 4), 'horizontal', 'un deslizamiento claramente horizontal debe paginar')

console.log('OK: la agenda permite seleccionar un rango y elegir entre agendar o bloquear según permisos.')
