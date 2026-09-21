import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  calculateProfessionalCompensation,
  normalizeProfessionalCompensationRule
} from '../src/services/professional-compensation.js'

assert.equal(calculateProfessionalCompensation({
  baseAmount: 40_000,
  rule: { mode: 'PERCENTAGE', percentage: 50, fixedAmount: null }
}), 20_000)
assert.equal(calculateProfessionalCompensation({
  baseAmount: 40_000,
  rule: { mode: 'FIXED', percentage: null, fixedAmount: 12_000 }
}), 12_000)
assert.equal(calculateProfessionalCompensation({
  baseAmount: 40_000,
  rule: { mode: 'NONE', percentage: null, fixedAmount: null }
}), 0)
assert.deepEqual(
  normalizeProfessionalCompensationRule({ mode: 'PERCENTAGE', percentage: 35.5 }),
  { mode: 'PERCENTAGE', percentage: 35.5, fixedAmount: null }
)
assert.throws(
  () => normalizeProfessionalCompensationRule({ mode: 'PERCENTAGE', percentage: 101 }),
  /porcentaje/i
)
assert.throws(
  () => normalizeProfessionalCompensationRule({ mode: 'FIXED', fixedAmount: -1 }),
  /monto/i
)

const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
assert.match(schema, /enum ProfessionalCompensationMode/)
assert.match(schema, /model ProfessionalAccountEntry/)
assert.match(schema, /commissionMode\s+ProfessionalCompensationMode/)
assert.match(schema, /commissionPercentage\s+Decimal\?/)
assert.match(schema, /commissionFixedAmount\s+Int\?/)
assert.match(schema, /model ProfessionalService[\s\S]*commissionMode/)
assert.match(schema, /appointmentId\s+String\?/)
assert.match(schema, /cashEntryId\s+String\?/)
assert.match(schema, /@@unique\(\[businessId, appointmentId\]\)/)
assert.match(schema, /canViewProfessionalSettlements\s+Boolean/)
assert.match(schema, /canManageProfessionalSettlements\s+Boolean/)

const routes = readFileSync(new URL('../src/routes/professional-settlements.ts', import.meta.url), 'utf8')
assert.match(routes, /professional-settlements\/summary/)
assert.match(routes, /professional-settlements\/entries/)
assert.match(routes, /professional-settlements\/payments/)
assert.match(routes, /cashSessionId/)
assert.match(routes, /canViewProfessionalSettlements/)
assert.match(routes, /canManageProfessionalSettlements/)
assert.match(routes, /serviceRules/)
assert.match(routes, /professionalService\.updateMany/)
assert.doesNotMatch(routes, /LEFT JOIN "Appointment"[\s\S]*LEFT JOIN "ProfessionalAccountEntry"/)
assert.match(routes, /from\?: string; to\?: string/)
assert.match(routes, /periodBalance/)
assert.match(routes, /currentBalance/)
assert.match(routes, /services:/)
assert.match(routes, /pageSize/)
assert.match(routes, /totalPages/)
assert.match(routes, /entry\."type" = 'EARNING'[\s\S]*appointment\."startAt" >= \$\{range\.from\}[\s\S]*appointment\."startAt" < \$\{range\.toExclusive\}/)
assert.match(routes, /entry\."type" <> 'EARNING'[\s\S]*entry\."effectiveAt" >= \$\{range\.from\}[\s\S]*entry\."effectiveAt" < \$\{range\.toExclusive\}/)
assert.match(routes, /appointment:\s*\{\s*is:\s*\{\s*startAt:/)

const appointmentService = readFileSync(new URL('../src/services/appointment-service.ts', import.meta.url), 'utf8')
assert.match(appointmentService, /ensureProfessionalEarningForCompletedAppointment/)
const cashRepository = readFileSync(new URL('../src/repositories/prisma-cash-repository.ts', import.meta.url), 'utf8')
assert.match(cashRepository, /ensureProfessionalEarningForCompletedAppointment/)
assert.doesNotMatch(readFileSync(new URL('../src/services/professional-compensation.ts', import.meta.url), 'utf8'), /rule\.mode === 'NONE'[\s\S]*return null/)

const permissions = readFileSync(new URL('../src/services/staff-permission-service.ts', import.meta.url), 'utf8')
assert.match(permissions, /path\.startsWith\('\/professional-settlements'\)/)
assert.match(permissions, /canViewProfessionalSettlements/)
assert.match(permissions, /canManageProfessionalSettlements/)

const crmUi = readFileSync(new URL('../src/routes/crm-ui.ts', import.meta.url), 'utf8')
assert.match(crmUi, /professional-compensation-section/)
assert.match(crmUi, /professional-compensation-mode/)
assert.match(crmUi, /professional-service-compensation-list/)
assert.match(crmUi, /saveProfessionalCompensation/)

const cashUi = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.match(cashUi, /cash-view-professionals/)
assert.match(cashUi, /viewMode === 'professionals'/)
assert.match(cashUi, /canManageProfessionalSettlements/)
assert.match(cashUi, /data-cash-professional-preset="week"/)
assert.match(cashUi, /cash-professional-period-from/)
assert.match(cashUi, /Saldo del per&iacute;odo/)
assert.match(cashUi, /Saldo actual/)
assert.match(cashUi, /Hist&oacute;rico · no cambia con el filtro/)
assert.match(cashUi, /cash-professional-current-balance/)
assert.match(cashUi, /data-professional-settlement-toggle/)
assert.match(cashUi, /cash-professional-previous/)
assert.match(cashUi, /cash-professional-next/)
assert.match(cashUi, /function professionalSettlementEntryDate\(entry\)/)
assert.match(cashUi, /entry\.type === 'EARNING'[\s\S]*entry\.appointment\?\.startAt/)

console.log('professional settlements contract: OK')
