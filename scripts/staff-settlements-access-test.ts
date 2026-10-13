import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { readFileSync } from 'node:fs'
import { canStaffAccessRoute, resolveStaffPermissions, type StaffAuthorizationUser } from '../src/services/staff-permission-service.js'

process.env.DATABASE_URL ||= 'postgresql://unused:unused@127.0.0.1:1/isolated_test'
const { prisma } = await import('../src/config/prisma.js')
const { professionalSettlementRoutes } = await import('../src/routes/professional-settlements.js')
const professional = resolveStaffPermissions({ staffProfile: 'PROFESSIONAL', permissionPreset: 'CUSTOM', canViewProfessionalSettlements: true, canManageProfessionalSettlements: true })
assert.equal(professional.permissions.canViewProfessionalSettlements, true, 'explicit own settlement consultation must persist')
assert.equal(professional.permissions.canManageProfessionalSettlements, false)
assert.equal(resolveStaffPermissions({ staffProfile: 'PROFESSIONAL', permissionPreset: 'PROFESSIONAL_DEFAULT' }).permissions.canViewProfessionalSettlements, false)
assert.equal(resolveStaffPermissions({ staffProfile: 'SECRETARY', permissionPreset: 'SECRETARY_CASHIER' }).permissions.canViewProfessionalSettlements, false)
const staff = { id: 'staff', name: 'Staff', email: 'test@example.test', businessId: 'business-a', professionalId: 'pro-a', role: 'STAFF', staffProfile: 'PROFESSIONAL', canCreateBusinesses: false, ...professional.permissions } as StaffAuthorizationUser
for (const path of ['/professional-settlements/summary', '/professional-settlements/entries']) assert.equal(canStaffAccessRoute(staff, 'GET', path), true)
for (const [method, path] of [['GET', '/professional-settlements/configuration'], ['POST', '/professional-settlements/payments'], ['PUT', '/professional-settlements/configuration/pro-a'], ['GET', '/professional-settlements/unknown'], ['GET', '/crm/cash-events'], ['GET', '/cash-register/current'], ['GET', '/treasury']]) assert.equal(canStaffAccessRoute(staff, method!, path!), false, path)
assert.equal(canStaffAccessRoute({ ...staff, professionalId: null }, 'GET', '/professional-settlements/summary'), false)
assert.equal(canStaffAccessRoute({ ...staff, canViewCashRegister: true }, 'GET', '/crm/cash-events'), true, 'existing cash event permission survives')

const professionals = [{ id: 'pro-a', name: 'Ana', businessId: 'business-a' }, { id: 'pro-b', name: 'Bruno', businessId: 'business-a' }, { id: 'pro-foreign', name: 'Foreign', businessId: 'business-b' }]
const entries = professionals.map((pro, i) => ({ id: 'earning-' + pro.id, businessId: pro.businessId, professionalId: pro.id, amount: 12_500 + i, baseAmount: 25_000, ruleMode: 'PERCENTAGE', rulePercentage: 50, type: 'EARNING', direction: 'CREDIT', effectiveAt: new Date('2026-10-13T16:00:00Z'), description: 'service', professional: { name: pro.name }, appointment: { startAt: new Date('2026-10-13T16:00:00Z'), customer: { name: 'Private ' + pro.name }, service: { name: 'Corte' } } }))
const calls: Array<{ kind: string; args: any }> = []
const undo: Array<() => void> = []
function stub(object: any, key: string, value: any) { const original = object[key]; object[key] = value; undo.push(() => { object[key] = original }) }
function selectedRows(args: any) {
  const where = args.where
  assert.equal(where.businessId, 'business-a', 'data query must always carry trusted business')
  const rows = entries.filter((entry) => entry.businessId === where.businessId && (!where.professionalId || entry.professionalId === where.professionalId))
  return rows.map((entry) => ({ ...entry, appointment: { ...entry.appointment, ...(args.select?.appointment?.select?.customer === false || args.include?.appointment?.select?.customer === false ? { customer: undefined } : {}) } }))
}
stub(prisma.business, 'findFirst', async (args: any) => {
  calls.push({ kind: 'business', args })
  assert.deepEqual(args.where, { AND: [{ id: 'business-a' }, { id: 'business-a' }] }, 'authorization must use assigned business even for forged query overrides')
  return { id: 'business-a' }
})
stub(prisma.business, 'findUnique', async () => ({ timezone: 'America/Argentina/Buenos_Aires' }))
stub(prisma.professional, 'findFirst', async (args: any) => { calls.push({ kind: 'professional', args }); return professionals.find((pro) => pro.businessId === args.where.businessId && pro.id === args.where.id) || null })
stub(prisma.professionalAccountEntry, 'findMany', async (args: any) => { calls.push({ kind: 'entries', args }); return selectedRows(args) })
stub(prisma.professionalAccountEntry, 'count', async (args: any) => { calls.push({ kind: 'count', args }); return selectedRows(args).length })
stub(prisma, '$transaction', async (queries: any[]) => Promise.all(queries))
stub(prisma, '$queryRaw', async (query: any) => {
  calls.push({ kind: 'sql', args: query })
  if (!query.sql.includes('FROM "Professional"')) return [{ from: new Date('2026-10-13T03:00:00Z'), toExclusive: new Date('2026-10-14T03:00:00Z') }]
  assert.ok(query.values.includes('business-a'))
  const scoped = query.values.find((value: any) => typeof value === 'string' && value.startsWith('pro-'))
  assert.ok(!scoped || /professional\."id" = \?/.test(query.sql), 'professional scope must be a parameterized WHERE condition')
  return professionals.filter((pro) => pro.businessId === 'business-a' && (!scoped || pro.id === scoped)).map((pro) => ({ ...pro, isActive: true, archivedAt: null, completedServices: 1, periodEarned: 12_500, periodPaid: 2_000, periodBalance: 10_500, currentBalance: 15_000 }))
})
const app = Fastify()
let currentUser: any = staff
app.addHook('preHandler', async (request) => { request.auth = { user: currentUser } })
await app.register(professionalSettlementRoutes)
async function get(path: string, user: any = staff) { currentUser = user; calls.length = 0; return app.inject({ method: 'GET', url: path }) }
try {
  for (const path of ['/professional-settlements/summary', '/professional-settlements/entries']) {
    const result = await get(path + '?businessId=business-b&from=2026-10-13&to=2026-10-13')
    assert.equal(result.statusCode, 200, result.body)
    const body = result.json()
    assert.equal(body.items.length, 1)
    assert.doesNotMatch(result.body, /Bruno|Foreign|Private|pro-b|pro-foreign/)
    for (const call of calls.filter((item) => ['entries', 'count'].includes(item.kind))) assert.equal(call.args.where.professionalId, 'pro-a')
    if (path.endsWith('summary')) {
      assert.equal(body.items[0].id, 'pro-a')
      assert.equal(body.items[0].services.length, 1)
      assert.equal(body.items[0].currentBalance, 15_000, 'historical balance remains independent of selected period')
      assert.equal(body.items[0].periodPaid, 2_000)
      assert.ok(calls.filter((item) => item.kind === 'sql').some((item) => item.args.values.includes('pro-a')))
    } else {
      assert.equal(body.total, 1)
      assert.equal(body.totalPages, 1)
      assert.equal(calls.find((item) => item.kind === 'entries')!.args.take, 10)
    }
    for (const invalid of [{ ...staff, professionalId: null }, { ...staff, professionalId: 'pro-foreign' }, { ...staff, canViewProfessionalSettlements: false }, { ...staff, staffProfile: 'INVALID' }]) {
      const denied = await get(path, invalid)
      assert.ok([403, 404].includes(denied.statusCode), denied.body)
      assert.equal(calls.some((item) => ['entries', 'count', 'sql'].includes(item.kind)), false)
    }
    assert.ok([403, 404].includes((await get(path + '?professionalId=pro-b')).statusCode))
    assert.equal(calls.some((item) => ['entries', 'count', 'sql'].includes(item.kind)), false)
    const own = await get(path + '?professionalId=pro-a', { ...staff, canViewCustomers: true })
    assert.equal(own.statusCode, 200)
    assert.match(own.body, /Private Ana/)
    const secretary = { ...staff, staffProfile: 'SECRETARY', professionalId: null }
    const all = await get(path, secretary)
    assert.equal(all.statusCode, 200)
    assert.equal(all.json().items.length, 2)
    const filtered = await get(path + '?professionalId=pro-b', secretary)
    assert.equal(filtered.statusCode, 200)
    assert.equal(filtered.json().items.length, 1)
    assert.doesNotMatch(filtered.body, /Ana|Private/)
    for (const call of calls.filter((item) => ['entries', 'count'].includes(item.kind))) assert.equal(call.args.where.professionalId, 'pro-b')
    assert.equal((await get(path + '?professionalId=pro-foreign', secretary)).statusCode, 404)
    assert.equal(calls.some((item) => ['entries', 'count', 'sql'].includes(item.kind)), false)
    assert.equal((await get(path + '?from=2026-10-13')).statusCode, 400)
    const admin = await get(path, { ...staff, role: 'BUSINESS_ADMIN' })
    assert.equal(admin.statusCode, 200)
    assert.equal(admin.json().items.length, 2)
    assert.match(admin.body, /Private/)
  }
  for (const path of ['/professional-settlements/configuration', '/professional-settlements/today']) assert.equal((await get(path)).statusCode, 403)
  currentUser = staff
  assert.equal((await app.inject({ method: 'POST', url: '/professional-settlements/payments', payload: {} })).statusCode, 403)
  assert.equal((await app.inject({ method: 'PUT', url: '/professional-settlements/configuration/pro-a', payload: {} })).statusCode, 403)
  const auth = readFileSync(new URL('../src/routes/auth.ts', import.meta.url), 'utf8')
  assert.match(auth, /canViewProfessionalSettlements: user\.role === 'STAFF' \? user\.canViewProfessionalSettlements === true : isCashAdmin/)
  console.log('OK scoped read-only staff settlements: opt-in, tenant, own professional, secretary filters, privacy, balances and mutation denial')
} finally {
  await app.close()
  for (const restore of undo.reverse()) restore()
  await prisma.$disconnect()
}
