import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { fileURLToPath } from 'node:url'
import { canStaffAccessRoute } from '../src/services/staff-permission-service.js'

process.env.DOTENV_CONFIG_PATH = fileURLToPath(new URL('./.staff-session-test-env-does-not-exist', import.meta.url))
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/isolated_test'

const { prisma } = await import('../src/config/prisma.js')
const { getAuthFromRequest, sessionCookieName } = await import('../src/services/auth-service.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')

const staffSessionUser = {
  id: 'staff-1',
  email: 'professional@example.test',
  name: 'Profesional',
  role: 'STAFF' as const,
  businessId: 'business-1',
  professionalId: 'professional-1',
  staffProfile: 'PROFESSIONAL',
  permissionPreset: 'CUSTOM',
  agendaScope: 'OWN',
  isActive: true,
  canCreateAppointments: true,
  canEditAppointments: true,
  canCancelAppointments: true,
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
  canViewProfessionalSettlements: true,
  canManageProfessionalSettlements: false,
  canViewTodayProfessionalProduction: false,
  canAdjustCash: false,
  canManageCashSessions: false,
  canViewProducts: false,
  canManageProducts: false,
  canSellProducts: false,
  canCreateBusinesses: false,
  business: { accountStatus: 'ACTIVE' as const }
}

const originalFindUnique = prisma.userSession.findUnique
const originalBusinessCount = prisma.business.count
let currentUser: Omit<typeof staffSessionUser, 'professionalId'> & { professionalId: string | null } = { ...staffSessionUser }
prisma.userSession.findUnique = async () => ({
  id: 'session-1',
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  user: currentUser
}) as never
prisma.business.count = async (args: any) => {
  assert.deepEqual(args.where.AND[0], { id: 'business-1' }, 'guard must retain the authenticated tenant')
  return args.where.AND[1].id.in.length === 1 && args.where.AND[1].id.in[0] === 'business-1' ? 1 : 0
}

const app = Fastify()
await authGuard(app)
let reachedHandler = 0
for (const [method, url] of [
  ['GET', '/professional-settlements/summary'],
  ['GET', '/professional-settlements/entries'],
  ['GET', '/professional-settlements/configuration'],
  ['POST', '/professional-settlements/payments'],
  ['PUT', '/professional-settlements/configuration/professional-1']
] as const) {
  app.route({ method, url, handler: async (request) => {
    reachedHandler += 1
    return { user: request.auth?.user, businessId: (request.query as { businessId?: string }).businessId }
  } })
}
const cookie = sessionCookieName() + '=isolated-session'

try {
  const auth = await getAuthFromRequest({
    headers: { cookie }
  } as never)

  assert.ok(auth, 'active staff session must resolve')
  assert.equal(auth.user.canViewProfessionalSettlements, true, 'session must preserve explicit staff settlement consultation')
  for (const path of ['/professional-settlements/summary', '/professional-settlements/entries']) {
    assert.equal(canStaffAccessRoute(auth.user, 'GET', path), true, path + ' must remain available to the authenticated professional')
  }
  for (const [method, path] of [
    ['GET', '/professional-settlements/configuration'],
    ['POST', '/professional-settlements/payments'],
    ['PUT', '/professional-settlements/configuration/professional-1']
  ]) {
    assert.equal(canStaffAccessRoute(auth.user, method, path), false, method + ' ' + path + ' must remain denied')
  }
  assert.equal(canStaffAccessRoute({ ...auth.user, canViewProfessionalSettlements: false }, 'GET', '/professional-settlements/summary'), false, 'opt-in stays required')
  assert.equal(canStaffAccessRoute({ ...auth.user, professionalId: null }, 'GET', '/professional-settlements/summary'), false, 'professional link stays required')
  for (const staffProfile of ['PROFESSIONAL', 'SECRETARY']) {
    for (const allowed of [false, true]) {
      currentUser = { ...staffSessionUser, staffProfile, professionalId: staffProfile === 'PROFESSIONAL' ? 'professional-1' : null,
        agendaScope: staffProfile === 'PROFESSIONAL' ? 'OWN' : 'ALL', canViewProfessionalSettlements: allowed,
        canManageProfessionalSettlements: true }
      for (const url of ['/professional-settlements/summary', '/professional-settlements/entries']) {
        const before = reachedHandler
        const response = await app.inject({ method: 'GET', url, headers: { cookie } })
        assert.equal(response.statusCode, allowed ? 200 : 403, staffProfile + ' ' + allowed + ': ' + response.body)
        assert.equal(reachedHandler - before, allowed ? 1 : 0, 'denied requests must stop at the actual guard')
        if (allowed) {
          assert.equal(response.json().user.canViewProfessionalSettlements, true)
          assert.equal(response.json().user.canManageProfessionalSettlements, false, 'stored management flag must not grant staff mutation rights')
          assert.equal(response.json().businessId, 'business-1')
        }
      }
      for (const [method, url] of [
        ['GET', '/professional-settlements/configuration'], ['POST', '/professional-settlements/payments'],
        ['PUT', '/professional-settlements/configuration/professional-1']
      ] as const) {
        const before = reachedHandler
        assert.equal((await app.inject({ method, url, headers: { cookie } })).statusCode, 403)
        assert.equal(reachedHandler, before)
      }
    }
  }
  for (const invalid of [{ professionalId: null }, { staffProfile: 'INVALID' }]) {
    currentUser = { ...staffSessionUser, ...invalid }
    for (const url of ['/professional-settlements/summary', '/professional-settlements/entries']) {
      assert.equal((await app.inject({ method: 'GET', url, headers: { cookie } })).statusCode, 403)
    }
  }
  currentUser = { ...staffSessionUser }
  assert.equal((await app.inject({ method: 'GET', url: '/professional-settlements/summary?businessId=business-foreign', headers: { cookie } })).statusCode, 403)
  console.log('OK real staff session and auth guard: professional/secretary opt-in, tenant, missing-link and mutation denial')
} finally {
  await app.close()
  prisma.userSession.findUnique = originalFindUnique
  prisma.business.count = originalBusinessCount
  await prisma.$disconnect()
}
