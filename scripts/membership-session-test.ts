import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'

process.env.DOTENV_CONFIG_PATH = fileURLToPath(new URL('./.membership-session-test-env-does-not-exist', import.meta.url))
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/isolated_membership_test'

const { prisma } = await import('../src/config/prisma.js')
const { sessionCookieName } = await import('../src/services/auth-service.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { bookingProgramRoutes } = await import('../src/routes/booking-programs.js')

const shop = 'shop-test'
const token = 'fixture-crm-session'
const tokenHash = createHash('sha256').update(token).digest('hex')
const cookie = `${sessionCookieName()}=${token}`
const plan = { id: 'plan-test', name: 'Plata' }
let role: 'BUSINESS_ADMIN' | 'STAFF' | 'ACCOUNT_ADMIN' = 'BUSINESS_ADMIN'
let canRecordAppointmentPayments = false
let catalogReads = 0

prisma.userSession.findUnique = (async ({ where }: { where: { tokenHash: string } }) => where.tokenHash === tokenHash ? {
  id: 'session-test', expiresAt: new Date(Date.now() + 60_000), user: {
    id: 'user-test', role, businessId: role === 'ACCOUNT_ADMIN' ? null : shop,
    business: { accountStatus: 'ACTIVE' }, isActive: true, canRecordAppointmentPayments
  }
} : null) as unknown as typeof prisma.userSession.findUnique
prisma.business.count = (async ({ where }: { where: { AND: [{ id?: string; accountAdminId?: string }, { id: { in: string[] } }] } }) => {
  const [scope, requested] = where.AND
  assert.deepEqual(scope, role === 'ACCOUNT_ADMIN' ? { accountAdminId: 'user-test' } : { id: shop })
  return requested.id.in.filter(id => id === shop).length
}) as unknown as typeof prisma.business.count
prisma.business.findFirst = (async ({ where }: { where: { isDemo?: boolean; id?: string; accountAdminId?: string; AND?: Array<{ id: string }> } }) => {
  if (where.isDemo) return null
  assert.deepEqual(where, role === 'ACCOUNT_ADMIN' ? { id: shop, accountAdminId: 'user-test' } : { AND: [{ id: shop }, { id: shop }] })
  return { id: shop }
}) as unknown as typeof prisma.business.findFirst
prisma.benefitPlan.findMany = (async ({ where }: { where: { businessId: string } }) => {
  catalogReads++
  assert.equal(where.businessId, shop)
  return [plan]
}) as unknown as typeof prisma.benefitPlan.findMany

const app = Fastify()
await authGuard(app)
await app.register(bookingProgramRoutes)
app.get('/mi-local-demo', async () => ({ public: true }))

try {
  const catalog = `/benefit-plans?businessId=${shop}`
  const valid = await app.inject({ url: catalog, headers: { cookie } })
  assert.equal(valid.statusCode, 200, valid.body)
  assert.deepEqual(valid.json(), [plan])
  for (const url of [catalog, '/availability-weeks', '/recurring-bookings']) {
    const response = await app.inject({ url })
    assert.equal(response.statusCode, 401, url)
    assert.equal(response.json().message, 'Necesitas iniciar sesion', 'the session guard must reject the request before the route handler')
  }
  const invalid = await app.inject({ url: catalog, headers: { cookie: `${sessionCookieName()}=invalid` } })
  assert.equal(invalid.statusCode, 401)
  const wrongShop = await app.inject({ url: '/benefit-plans?businessId=another-shop', headers: { cookie } })
  assert.equal(wrongShop.statusCode, 403)
  role = 'STAFF'
  assert.equal((await app.inject({ url: catalog, headers: { cookie } })).statusCode, 403)
  canRecordAppointmentPayments = true
  assert.equal((await app.inject({ url: catalog, headers: { cookie } })).statusCode, 200)
  assert.equal((await app.inject({ method: 'POST', url: catalog, headers: { cookie }, payload: { businessId: shop } })).statusCode, 403)
  role = 'ACCOUNT_ADMIN'
  assert.equal((await app.inject({ url: catalog, headers: { cookie } })).statusCode, 200)
  assert.equal((await app.inject({ url: '/benefit-plans?businessId=another-shop', headers: { cookie } })).statusCode, 403)
  assert.equal(catalogReads, 3)
  assert.equal((await app.inject({ url: '/mi-local-demo' })).statusCode, 200, 'public business URLs stay public')
  console.log('OK sesión CRM en Membresías, permisos del personal y acceso por comercio.')
} finally {
  await app.close()
  await prisma.$disconnect()
}
