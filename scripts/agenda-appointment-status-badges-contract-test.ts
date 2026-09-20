import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'

const source = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')

assert.match(source, /function agendaAppointmentStatusBadgesHtml\(appointment\)/)
assert.match(source, /agenda-service-status/)
assert.match(source, /agenda-payment-status/)
assert.match(source, /Realizado/)
assert.match(source, /Pendiente/)
assert.match(source, /Pagado/)
assert.match(source, /Se&ntilde;a/)
assert.match(source, /Debe/)
assert.match(source, /Sin cargo/)
assert.match(source, /financeSummary\.paidAmount/)
assert.match(source, /financeSummary\.balanceAmount/)
assert.match(source, /appointment\.status === 'COMPLETED'/)
assert.match(source, /cashRegisterEnabled \?/)
assert.match(source, /agendaDepositIndicator[\s\S]*financeSummary[\s\S]*paidAmount/)
assert.match(source, /renderAgendaMobileEvent[\s\S]*agendaAppointmentStatusBadgesHtml\(appointment\)/)
assert.match(source, /renderAgendaMobileList[\s\S]*agendaAppointmentStatusBadgesHtml\(appointment\)/)
assert.match(source, /renderAgendaEvents[\s\S]*agendaAppointmentStatusBadgesHtml\(appointment\)/)
assert.match(source, /agenda-status-legend/)
assert.match(source, /Estados del turno/)
assert.match(source, /function agendaStatusDensityClass\(duration\)/)
assert.match(source, /duration < 30[\s\S]*is-status-icons[\s\S]*duration < 60[\s\S]*is-status-compact/)
assert.match(source, /renderAgendaMobileEvent[\s\S]*agendaStatusDensityClass\(duration\)/)
assert.match(source, /renderAgendaEvents[\s\S]*agendaStatusDensityClass\(duration\)/)
assert.match(source, /agenda-status-label/)
assert.match(source, /agenda-gcal-event\.is-status-compact/)
assert.match(source, /agenda-gcal-event\.is-status-icons/)
assert.match(source, /agenda-event\.is-status-compact/)
assert.match(source, /agenda-event\.is-status-icons/)

const enabledUi = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: true })
const disabledUi = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const enabledBadgeCalls = enabledUi.match(/agendaAppointmentStatusBadgesHtml\(appointment\)/g) || []
const disabledBadgeCalls = disabledUi.match(/agendaAppointmentStatusBadgesHtml\(appointment\)/g) || []
const enabledDensityCalls = enabledUi.match(/agendaStatusDensityClass\(duration\)/g) || []
const disabledDensityCalls = disabledUi.match(/agendaStatusDensityClass\(duration\)/g) || []
assert.ok(enabledBadgeCalls.length > disabledBadgeCalls.length, 'Caja activa debe insertar badges en las tarjetas')
assert.ok(enabledDensityCalls.length > disabledDensityCalls.length, 'La densidad adaptativa solo debe alterar tarjetas cuando Caja está activa')
assert.match(enabledUi, /const paymentAlreadyRepresented = true &&/)
assert.match(disabledUi, /const paymentAlreadyRepresented = false &&/)
assert.match(enabledUi, /const statusLegend = "<div class=\\\"agenda-status-legend/)
assert.match(disabledUi, /const statusLegend = ""/)

console.log('agenda appointment status badges contract: OK')
