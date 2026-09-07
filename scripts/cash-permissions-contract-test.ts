import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const [schema, migration, authSource, authRouteSource, permissionSource] = await Promise.all([
  readFile(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8'),
  readFile(path.join(process.cwd(), 'prisma', 'migrations', '20260906150000_add_cash_permissions', 'migration.sql'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'services', 'auth-service.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'routes', 'auth.ts'), 'utf8'),
  readFile(path.join(process.cwd(), 'src', 'services', 'staff-permission-service.ts'), 'utf8')
])
const permissions = [
  'canViewCashRegister',
  'canRecordAppointmentPayments',
  'canApplyDiscounts',
  'canManageCashOperations',
  'canAdjustCash',
  'canManageCashSessions'
] as const
for (const permission of permissions) {
  assert.match(schema, new RegExp(`${permission}\\s+Boolean\\s+@default\\(false\\)`), `${permission} debe ser deny-by-default`)
  assert.match(migration, new RegExp(`"${permission}" BOOLEAN NOT NULL DEFAULT false`), `la migración debe crear ${permission} cerrada`)
  assert.match(authSource, new RegExp(`${permission}:`), `AuthUser debe exponer ${permission}`)
  assert.match(authRouteSource, new RegExp(`${permission}:`), `/auth/me debe publicar ${permission}`)
  assert.match(permissionSource, new RegExp(`${permission}: false`), `los presets base deben negar ${permission}`)
}

const { canStaffAccessRoute, hasCashPermission, resolveStaffPermissions } = await import('../src/services/staff-permission-service.js')
const denied = staff()
for (const permission of permissions) assert.equal(hasCashPermission(denied, permission), false)
assert.equal(hasCashPermission({ ...denied, role: 'BUSINESS_ADMIN' }, 'canAdjustCash'), true)
assert.equal(hasCashPermission({ ...denied, role: 'SUPER_ADMIN' }, 'canManageCashSessions'), true)
for (const permission of permissions) {
  assert.equal(
    hasCashPermission({ ...denied, role: 'ACCOUNT_ADMIN' }, permission),
    true,
    `ACCOUNT_ADMIN debe administrar ${permission} dentro de un comercio autorizado`
  )
}
assert.equal(hasCashPermission({ ...denied, canRecordAppointmentPayments: true }, 'canRecordAppointmentPayments'), true)
assert.equal(hasCashPermission({ ...denied, canViewFinancialAmounts: true }, 'canViewCashRegister'), false, 'un permiso financiero legacy no concede Caja')
assert.equal(canStaffAccessRoute(denied, 'GET', '/cash-register/current'), false)
assert.equal(canStaffAccessRoute({ ...denied, canViewCashRegister: true }, 'GET', '/cash-register/current'), true)
assert.equal(canStaffAccessRoute({ ...denied, canManageCashSessions: true }, 'GET', '/cash-register/responsibles'), true)
assert.equal(canStaffAccessRoute({ ...denied, canViewCashRegister: true }, 'GET', '/cash-register/responsibles'), false, 'ver Caja no concede administrar responsables')
assert.equal(canStaffAccessRoute({ ...denied, canRecordAppointmentPayments: true }, 'GET', '/cash-register/payment-context'), true)
assert.equal(canStaffAccessRoute({ ...denied, canViewCashRegister: true }, 'GET', '/cash-register/payment-context'), false, 'ver Caja no concede el contexto para cobrar turnos')
assert.equal(canStaffAccessRoute({ ...denied, canViewCashRegister: true }, 'GET', '/crm/cash-events'), true)
assert.equal(canStaffAccessRoute(denied, 'GET', '/crm/cash-events'), false)
assert.equal(canStaffAccessRoute({ ...denied, canRecordAppointmentPayments: true }, 'POST', '/appointments/a/payments'), true)
assert.equal(canStaffAccessRoute({ ...denied, canViewCashRegister: true }, 'POST', '/appointments/a/payments'), false, 'ver Caja no concede cobros de Agenda')
assert.equal(canStaffAccessRoute({ ...denied, canRecordAppointmentPayments: true }, 'POST', '/cash-register/entries/payment/reverse'), true)
assert.equal(canStaffAccessRoute({ ...denied, canViewCashRegister: true }, 'POST', '/cash-register/entries/payment/reverse'), false)

const custom = resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'CUSTOM', canAdjustCash: true })
assert.equal(custom.permissions.canAdjustCash, true)
assert.equal(custom.permissions.canManageCashOperations, false)

console.log('OK Caja permissions: seis capacidades independientes, admins implícitos y staff deny-by-default.')

function staff() {
  return {
    businessId: 'business-a',
    role: 'STAFF',
    staffProfile: 'SECRETARY',
    permissionPreset: 'CUSTOM',
    agendaScope: 'ALL' as const,
    canCreateAppointments: false,
    canEditAppointments: false,
    canCancelAppointments: false,
    canManageScheduleBlocks: false,
    canForceAppointments: false,
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canManageCustomerNotes: false,
    canManageCustomerMarketing: false,
    canViewConversations: false,
    canReplyConversations: false,
    canManageDeposits: false,
    canViewOperationalReports: false,
    canViewFinancialAmounts: false,
    canViewCashRegister: false,
    canRecordAppointmentPayments: false,
    canApplyDiscounts: false,
    canManageCashOperations: false,
    canAdjustCash: false,
    canManageCashSessions: false
  }
}
