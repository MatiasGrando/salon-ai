import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { canStaffAccessRoute, type StaffAuthorizationUser } from '../src/services/staff-permission-service.js'

const staff = (canManageDeposits: boolean): StaffAuthorizationUser => ({
  role: 'STAFF',
  agendaScope: 'ALL',
  canCreateAppointments: false,
  canEditAppointments: false,
  canCancelAppointments: false,
  canManageScheduleBlocks: false,
  canForceAppointments: false,
  canViewCustomers: true,
  canCreateCustomers: false,
  canEditCustomers: false,
  canManageCustomerNotes: false,
  canManageCustomerMarketing: false,
  canViewConversations: true,
  canReplyConversations: true,
  canManageDeposits,
  canViewOperationalReports: false,
  canViewFinancialAmounts: false
})

for (const path of [
  '/crm/deposits',
  '/crm/deposits/deposit-1/proof',
  '/crm/deposits/deposit-1/approve',
  '/crm/deposits/deposit-1/reject',
  '/crm/conversations/conversation-1/deposit/approve',
  '/crm/conversations/conversation-1/deposit/reject'
]) {
  const method = path.endsWith('/approve') || path.endsWith('/reject') ? 'POST' : 'GET'
  assert.equal(canStaffAccessRoute(staff(false), method, path), false, `${method} ${path} requires canManageDeposits`)
  assert.equal(canStaffAccessRoute(staff(true), method, path), true, `${method} ${path} permits designated reviewer`)
}

const depositService = readFileSync(new URL('../src/services/booking-deposit-service.ts', import.meta.url), 'utf8')
assert.equal(depositService.includes("'application/pdf'"), false, 'legacy web proof parsing must not admit PDFs')

const runbook = readFileSync(new URL('../docs/nuevo-bot/runbook-seguridad-privacidad.md', import.meta.url), 'utf8')
assert.match(runbook, /F8\.1 aprobada: no hay cron de purga activado/i)
assert.match(runbook, /canManageDeposits/i)
assert.match(runbook, /12 meses/i)

console.log('OK: F8.1 deposit security authorization and policy gates')
