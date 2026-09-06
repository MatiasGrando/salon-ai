import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveCashRegisterConfig } from '../src/config/cash-register.js'
import { renderCrmHtml } from '../src/routes/crm-ui.js'
import { DISABLED_POLLING_MARKER } from '../src/observability/egress-baseline/types.js'
import { legacyPaymentEntryId } from '../src/services/cash-service.js'

assert.deepEqual(resolveCashRegisterConfig({}), {
  enabled: false,
  legacyFallbackEnabled: true
})
assert.deepEqual(resolveCashRegisterConfig({
  CASH_REGISTER_ENABLED: 'true'
}), {
  enabled: true,
  legacyFallbackEnabled: true
})
assert.throws(() => resolveCashRegisterConfig({ CASH_REGISTER_ENABLED: 'yes' }), /exactly "true" or "false"/)
assert.throws(() => resolveCashRegisterConfig({
  CASH_REGISTER_ENABLED: 'true',
  CASH_REGISTER_LEGACY_FALLBACK_ENABLED: 'false'
}), /legacy fallback/i)
assert.equal(legacyPaymentEntryId('business-a', 'appointment-a'), legacyPaymentEntryId('business-a', 'appointment-a'))
assert.notEqual(legacyPaymentEntryId('business-a', 'appointment-a'), legacyPaymentEntryId('business-b', 'appointment-a'))

const disabledUi = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: false })
const enabledUi = renderCrmHtml({ pollingMarker: DISABLED_POLLING_MARKER, cashRegisterEnabled: true })
assert.doesNotMatch(disabledUi, /data-section="cash"/)
assert.doesNotMatch(disabledUi, /id="appointment-finance"/)
assert.match(enabledUi, /data-section="cash"/)
assert.match(enabledUi, /id="appointment-finance"/)

const server = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const appointmentRoutes = readFileSync(new URL('../src/routes/appointment.ts', import.meta.url), 'utf8')
const crmRoutes = readFileSync(new URL('../src/routes/crm.ts', import.meta.url), 'utf8')
const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
const rollout = readFileSync(new URL('./cash-register-rollout.ts', import.meta.url), 'utf8')
const runbook = readFileSync(new URL('../docs/cash-register.md', import.meta.url), 'utf8')

assert.match(server, /resolveCashRegisterConfig/)
assert.match(server, /cashRegisterConfig\.enabled[\s\S]*?register\(cashRegisterRoutes/)
assert.match(server, /cashRegisterConfig\.enabled[\s\S]*?startCashRealtimeListener/)
assert.match(appointmentRoutes, /cashRegisterEnabled[\s\S]*?app\.get\('\/appointments\/:id\/finance'/)
assert.match(crmRoutes, /cashRegisterEnabled[\s\S]*?registerRealtimeRoute\('\/crm\/cash-events'/)
assert.match(crmUi, /cashRegisterEnabled[\s\S]*?cashRegisterMarkup/)
assert.match(rollout, /mode:\s*'audit'\s*\|\s*'apply'/)
assert.match(rollout, /CASH_REGISTER_BACKFILL_APPLY[\s\S]*?exactly "true"/)
assert.match(rollout, /backfillAppointmentAccounts/)
assert.match(rollout, /backfillApprovedDeposits/)
assert.match(rollout, /approvedDepositBackfill/)
assert.match(rollout, /assertIanaTimezone/)
assert.match(rollout, /legacyPaymentEntryId/, 'cada pago legacy debe auditarse por el id determinístico de su turno')
assert.doesNotMatch(rollout, /\b(?:DELETE|TRUNCATE|DROP)\b/i, 'rollout no debe borrar ledger ni historia')
assert.match(runbook, /CASH_REGISTER_ENABLED/)
assert.match(runbook, /CASH_REGISTER_LEGACY_FALLBACK_ENABLED/)
assert.match(runbook, /CASH_REGISTER_BACKFILL_APPLY/)
assert.match(runbook, /jam[aá]s borrar[^\n]*ledger/i)
assert.match(runbook, /rollback/i)
assert.match(runbook, /todos los tenants/i, 'el flag global sólo puede activarse luego de auditar todos los tenants del proceso')

console.log('OK Caja rollout: flag cerrado por defecto, fallback legacy, auditoría/backfill y rollback no destructivo.')
