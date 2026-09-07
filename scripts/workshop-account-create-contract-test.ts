import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/config/prisma.js'
import { accountManagementRoutes } from '../src/routes/account-management.js'
import { businessOnboardingSteps } from '../src/services/business-onboarding-service.js'

// No database calls: every delegate used by the creation path is replaced.
const originals: Array<() => void> = []
function mock(delegate: any, key: string, value: any) {
  const old = delegate[key]
  originals.push(() => { delegate[key] = old })
  delegate[key] = value
}
const created: any[] = []
let role = 'ACCOUNT_ADMIN'
const app = Fastify()
app.addHook('preHandler', async request => { request.auth = { user: { id: 'owner', role } } as any })
await app.register(accountManagementRoutes)
try {
  mock(prisma.business, 'findUnique', async ({ where }: any) => where.id ? { id: 'new', name: 'Taller', businessType: 'WORKSHOP', contactPhone: '123', contactEmail: 'a@b.co' } : null)
  mock(prisma.business, 'create', async ({ data }: any) => { created.push(data); return { ...data, id: 'new' } })
  mock(prisma.user, 'findUnique', async () => null)
  mock(prisma.user, 'findFirst', async () => null)
  mock(prisma.user, 'create', async () => ({ id: 'user' }))
  mock(prisma.businessPlan, 'findUnique', async () => ({ id: 'plan' }))
  mock(prisma.businessBillingSettings, 'create', async () => ({}))
  for (const delegate of [prisma.service, prisma.professional, prisma.businessHours]) mock(delegate, 'count', async () => 0)
  mock(prisma.businessOnboardingStatus, 'upsert', async ({ create }: any) => ({ ...create, updatedAt: new Date() }))
  const payload = { businessName: 'Taller', adminName: 'Test', adminEmail: 'test@example.com', adminPassword: 'password123', contactPhone: '1155555555', planId: 'plan', billingDay: 1 }
  for (const businessType of ['WORKSHOP', undefined]) {
    const response = await app.inject({ method: 'POST', url: '/admin/accounts', payload: { ...payload, businessType } })
    assert.equal(response.statusCode, 201, response.body)
    assert.equal(created.at(-1).businessType, businessType || 'SALON')
    assert.equal(created.at(-1).accountAdminId, 'owner')
  }
  const count = created.length
  assert.equal((await app.inject({ method: 'POST', url: '/admin/accounts', payload: { ...payload, businessType: 'OTHER' } })).statusCode, 400)
  role = 'BUSINESS_ADMIN'
  assert.equal((await app.inject({ method: 'POST', url: '/admin/accounts', payload: { ...payload, businessType: 'WORKSHOP' } })).statusCode, 403)
  assert.equal(created.length, count)
  assert.deepEqual(businessOnboardingSteps('WORKSHOP').map(step => step.key), ['accountCreated', 'ownerLoggedIn', 'profileComplete'])
  assert.equal(businessOnboardingSteps('SALON').length, 8)
  console.log('Workshop account creation passed: persisted type, legacy default, invalid type, authorization, onboarding (mock DB)')
} finally {
  originals.reverse().forEach(restore => restore())
  await app.close()
  await prisma.$disconnect()
}
