import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canStaffAccessRoute, resolveStaffPermissions, type StaffAuthorizationUser } from '../src/services/staff-permission-service.js'

const cashier = resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_CASHIER' }).permissions
assert.equal(cashier.canViewProfessionalSettlements, false)
assert.equal(cashier.canManageProfessionalSettlements, false)
assert.equal(cashier.canViewTodayProfessionalProduction, false)

const limited = resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'CUSTOM', canViewTodayProfessionalProduction: true, canViewProfessionalSettlements: true, canManageProfessionalSettlements: true }).permissions
assert.equal(limited.canViewTodayProfessionalProduction, true)
assert.equal(limited.canViewProfessionalSettlements, false)
assert.equal(limited.canManageProfessionalSettlements, false)
const user = { role: 'STAFF', ...limited } as StaffAuthorizationUser
assert.equal(canStaffAccessRoute(user, 'GET', '/professional-settlements/today'), true)
assert.equal(canStaffAccessRoute(user, 'GET', '/professional-settlements/summary'), false)
assert.equal(canStaffAccessRoute(user, 'GET', '/professional-settlements/entries'), false)
assert.equal(canStaffAccessRoute(user, 'POST', '/professional-settlements/payments'), false)
assert.equal(canStaffAccessRoute(user, 'GET', '/treasury/accounts'), false)
assert.equal(canStaffAccessRoute(user, 'POST', '/treasury/movements'), false)
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const routes = readFileSync(new URL('../src/routes/professional-settlements.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../src/routes/crm-ui/cash-register.ts', import.meta.url), 'utf8')
assert.match(schema, /canViewTodayProfessionalProduction\s+Boolean/)
assert.match(routes, /professional-settlements\/today/)
const todayRoute = routes.split("app.get('/professional-settlements/today'")[1]!.split("app.get('/professional-settlements/summary'")[0]!
assert.match(todayRoute, /baseAmount: true/)
assert.doesNotMatch(todayRoute, /amount: true|currentBalance|periodPaid|cashEntryId/)
assert.match(ui, /cash-professional-today-table/)
console.log('OK caja/tesorería: personal solo ve producción autorizada de hoy')
