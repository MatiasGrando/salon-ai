import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { resolveStaffPermissions, canStaffAccessRoute } from '../src/services/staff-permission-service.js'

process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/offline_staff_test'
const [{ prisma }, { customerRoutes }] = await Promise.all([
  import('../src/config/prisma.js'), import('../src/routes/customer.js')
])
const db = prisma as any
const restore: Array<() => void> = []
function replace(object: any, key: string, value: any) {
  const previous = object[key]
  object[key] = value
  restore.push(() => { object[key] = previous })
}
const existing = { id: 'customer-a', businessId: 'business-a', name: 'Nombre reservado', phone: '+54 9 11 6431-2742', normalizedPhone: null, email: 'privado@example.com', technicalProfile: 'Ficha privada' }
let current: any = existing
let writes: string[] = []
let createdData: any
const resolved = resolveStaffPermissions({ staffProfile: 'PROFESSIONAL', permissionPreset: 'CUSTOM', canCreateCustomers: true })
assert.equal(resolved.permissions.canCreateCustomers, true, 'Crear no requiere Ver clientes')
assert.equal(resolved.permissions.canViewCustomers, false)
assert.equal(resolved.permissions.agendaScope, 'OWN')
assert.equal(resolveStaffPermissions({ staffProfile: 'PROFESSIONAL' }).permissions.canCreateCustomers, false, 'opción explícita, no default')
const user: any = { id: 'staff-a', role: 'STAFF', businessId: 'business-a', professionalId: 'professional-a', ...resolved.permissions }
const app = Fastify()
try {
  replace(db.business, 'findFirst', async ({ where }: any) => JSON.stringify(where).includes('business-foreign') ? null : { id: 'business-a' })
  replace(db.business, 'findUnique', async () => ({ publicWhatsapp: '+54 9 11 4000-0000' }))
  replace(db.customer, 'findFirst', async () => current)
  replace(db.customer, 'create', async ({ data }: any) => { writes.push('create'); createdData = data; return { id: 'customer-new', ...data } })
  replace(db.customer, 'update', async () => { writes.push('update'); return existing })
  replace(db.customerMarketingPreference, 'upsert', async () => { writes.push('marketing'); return {} })
  replace(db, '$queryRaw', async () => [])
  replace(db, '$transaction', async (run: any) => run(db))
  app.decorateRequest('auth', null)
  app.addHook('onRequest', async (request: any, reply) => {
    request.auth = { user }
    if (!canStaffAccessRoute(user, request.method, request.url)) return reply.code(403).send({ message: 'Sin permiso' })
  })
  await app.register(customerRoutes)
  const payload = { name: 'Nombre ingresado', phone: '11-6431-2742', email: 'sobrescribir@example.com', businessId: 'business-a' }
  for (const profile of ['PROFESSIONAL', 'SECRETARY']) {
    user.staffProfile = profile
    writes = []
    const response = await app.inject({ method: 'POST', url: '/customers', payload })
    assert.equal(response.statusCode, 200, response.body)
    assert.deepEqual(response.json(), { id: existing.id, name: payload.name, phone: '5491164312742' }, 'solo identidad aportada; ninguna ficha ni conflicto existente')
    assert.deepEqual(writes, [], 'reutilizar identidad no escribe ficha ni promociones')
    for (const url of ['/customers?businessId=business-a', '/customers/search?businessId=business-a&q=Nombre', '/customers/overview?businessId=business-a', '/customers/customer-a/notes']) {
      assert.equal((await app.inject(url)).statusCode, 403, url)
    }
    assert.equal((await app.inject({ method: 'PATCH', url: '/customers/customer-a', payload })).statusCode, 403)
  }
  current = null; writes = []
  const created = await app.inject({ method: 'POST', url: '/customers', payload })
  assert.equal(created.statusCode, 200, created.body)
  assert.deepEqual(created.json(), { id: 'customer-new', name: payload.name, phone: '5491164312742' })
  assert.equal(createdData.email, null, 'alta básica ignora email no autorizado')
  assert.equal(createdData.businessId, 'business-a')
  for (const phone of ['', '123']) {
    const response = await app.inject({ method: 'POST', url: '/customers', payload: { ...payload, phone } })
    assert.equal(response.statusCode, 400, 'alta básica requiere teléfono completo')
  }
  assert.equal((await app.inject({ method: 'POST', url: '/customers', payload: { ...payload, businessId: 'business-foreign' } })).statusCode, 404)
  user.canCreateCustomers = false
  assert.equal((await app.inject({ method: 'POST', url: '/customers', payload })).statusCode, 403)
  user.canCreateCustomers = true; user.canViewCustomers = true; current = existing; writes = []
  const full = await app.inject({ method: 'POST', url: '/customers', payload })
  assert.equal(full.statusCode, 200, full.body)
  assert.equal(full.json().email, existing.email, 'Secretaría con Ver conserva respuesta y flujo actuales')
  assert.equal(full.json().wasExisting, true)
  assert.deepEqual(writes, ['update', 'marketing'])
  console.log('Staff create customer: permission, real route, privacy and legacy workflow OK')
} finally {
  await app.close()
  for (const reset of restore.reverse()) reset()
  await prisma.$disconnect()
}
