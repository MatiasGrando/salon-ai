import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { fileURLToPath } from 'node:url'

process.env.DOTENV_CONFIG_PATH = fileURLToPath(new URL('./.product-test-env-does-not-exist', import.meta.url))
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/isolated_test'
const { prisma } = await import('../src/config/prisma.js')
const { sessionCookieName } = await import('../src/services/auth-service.js')
const { authGuard } = await import('../src/plugins/auth-guard.js')
const { productSalesRoutes } = await import('../src/routes/product-sales.js')

const baseUser = { id: 'owner-1', email: 'owner@example.test', name: 'Owner', role: 'BUSINESS_ADMIN', businessId: 'business-1', isActive: true,
  professionalId: null, staffProfile: 'SECRETARY', permissionPreset: 'CUSTOM', agendaScope: 'ALL', canCreateBusinesses: false,
  canViewProducts: false, canManageProducts: false, canSellProducts: false, business: { accountStatus: 'ACTIVE' } }
let user: any = { ...baseUser }
const categories: any[] = [
  { id: 'category-1', businessId: 'business-1', name: 'Cuidado', isActive: true },
  { id: 'category-foreign', businessId: 'business-foreign', name: 'Foreign', isActive: true },
  { id: 'category-inactive', businessId: 'business-1', name: 'Inactive', isActive: false }
]
const products: any[] = [
  { id: 'product-1', businessId: 'business-1', categoryId: null, name: 'Gel', salePrice: 1000, isActive: true },
  { id: 'product-foreign', businessId: 'business-foreign', categoryId: null, name: 'Foreign product', salePrice: 2000, isActive: true }
]
const businesses = [{ id: 'business-1', accountAdminId: 'account-1' }, { id: 'business-foreign', accountAdminId: 'other' },
  { id: 'shared-demo', isDemo: true, demoType: 'BARBERSHOP' }, { id: 'qa-demo', isDemo: true, demoType: 'QA_SANDBOX' }]
let catalogCalls = 0
let writes = 0
const originals: Array<() => void> = []
function replace(model: string, method: string, implementation: (...args: any[]) => any) {
  const delegate = (prisma as any)[model], original = delegate[method]
  originals.push(() => { delegate[method] = original })
  delegate[method] = implementation
}
const matches = (row: any, where: any) => Object.entries(where).every(([key, value]) => row[key] === value)
replace('userSession', 'findUnique', async () => ({ id: 'session-1', expiresAt: new Date('2030-01-01'), user }))
replace('staffAuditLog', 'create', async () => ({}))
replace('business', 'findFirst', async ({ where }: any) => businesses.find((item: any) => item.id === where.id && item.isDemo === true
  && (typeof where.demoType === 'string' ? item.demoType === where.demoType : where.demoType.in.includes(item.demoType))) ?? null)
replace('business', 'count', async ({ where }: any) => {
  const [scope, requested] = where.AND
  return businesses.filter((item: any) => requested.id.in.includes(item.id) && matches(item, scope)).length
})
for (const [model, rows] of [['productCategory', categories], ['product', products]] as const) {
  replace(model, 'findMany', async ({ where }: any) => { catalogCalls++; return rows.filter(row => matches(row, where)) })
  replace(model, 'findFirst', async ({ where }: any) => { catalogCalls++; return rows.find(row => matches(row, where)) ?? null })
  replace(model, 'create', async ({ data }: any) => { writes++; const row = { id: model + '-' + rows.length, isActive: true, ...data }; rows.push(row); return row })
  replace(model, 'update', async ({ where, data }: any) => { writes++; const row = rows.find(row => row.id === where.id); Object.assign(row, data); return row })
}
const app = Fastify()
await authGuard(app)
await productSalesRoutes(app)
app.get('/barberdemo', async () => ({ public: true }))
app.get('/products-preview', async () => ({ public: true }))
const cookie = sessionCookieName() + '=product-isolated-session'
const request = (method: any, url: string, payload?: any, authenticated = true) => app.inject({ method, url,
  headers: authenticated ? { cookie } : {}, ...(payload === undefined ? {} : { payload }) })
const product = { name: 'Crema', salePrice: 1500, categoryId: null }
try {
  for (const url of ['/product-categories', '/products']) {
    const response = await request('GET', url)
    assert.equal(response.statusCode, 200, 'authenticated catalog must resolve its real session: ' + response.body)
  }
  for (const url of ['/product-categories', '/products', '/product-sales']) {
    const before = catalogCalls
    assert.equal((await request(url === '/product-sales' ? 'POST' : 'GET', url, undefined, false)).statusCode, 401)
    assert.equal(catalogCalls, before, 'anonymous access must stop before catalog queries')
  }
  assert.equal((await request('HEAD', '/products', undefined, false)).statusCode, 401)
  assert.equal((await request('GET', '/barberdemo', undefined, false)).statusCode, 200)
  assert.equal((await request('GET', '/products-preview', undefined, false)).statusCode, 200, 'only exact internal roots are reserved')

  const category = await request('POST', '/product-categories', { name: 'Peinado' })
  assert.equal(category.statusCode, 200)
  assert.ok((await request('GET', '/product-categories')).json().categories.some((row: any) => row.id === category.json().id))
  const created = await request('POST', '/products', product)
  assert.equal(created.statusCode, 200, created.body)
  assert.equal(created.json().categoryId, null)
  const id = created.json().id
  assert.equal((await request('PATCH', '/products/' + id, { ...product, categoryId: category.json().id })).json().categoryId, category.json().id)
  assert.equal((await request('PATCH', '/products/' + id, product)).json().categoryId, null)
  assert.equal((await request('POST', '/products', { name: 'Sin campo', salePrice: 500 })).json().categoryId, null)
  for (const categoryId of ['category-foreign', 'category-inactive']) {
    const before = writes
    assert.equal((await request('POST', '/products', { ...product, categoryId })).statusCode, 404)
    assert.equal(writes, before, 'unavailable categories must not create products')
  }
  const beforeForeignEdit = writes
  assert.equal((await request('PATCH', '/products/product-foreign', product)).statusCode, 404)
  assert.equal(writes, beforeForeignEdit, 'a real foreign product must not be updated')
  assert.equal(products.find(row => row.id === 'product-foreign').name, 'Foreign product')
  for (const role of ['BUSINESS_ADMIN', 'STAFF']) {
    user = { ...baseUser, role, canViewProducts: true, canManageProducts: true }
    const before = catalogCalls, beforeWrites = writes
    assert.equal((await request('GET', '/products?businessId=business-foreign')).statusCode, 403)
    assert.equal((await request('POST', '/products', { ...product, businessId: 'business-foreign' })).statusCode, 403)
    assert.equal(catalogCalls, before); assert.equal(writes, beforeWrites)
  }
  for (const canViewProducts of [false, true]) {
    user = { ...baseUser, role: 'STAFF', canViewProducts }
    const before = catalogCalls, beforeWrites = writes
    assert.equal((await request('GET', '/products')).statusCode, canViewProducts ? 200 : 403)
    if (!canViewProducts) assert.equal(catalogCalls, before)
    assert.equal((await request('POST', '/products', product)).statusCode, 403)
    assert.equal((await request('PATCH', '/product-categories/category-1', { name: 'No' })).statusCode, 403)
    assert.equal(writes, beforeWrites, 'viewing products must not grant mutations')
  }
  user = { ...baseUser, role: 'STAFF', canViewProducts: true, canManageProducts: true }
  assert.equal((await request('POST', '/products', product)).statusCode, 200)
  user = { ...baseUser, id: 'account-1', role: 'ACCOUNT_ADMIN', businessId: null }
  for (const businessId of ['business-1', 'shared-demo']) {
    assert.equal((await request('GET', '/products?businessId=' + businessId)).statusCode, 200)
    assert.equal((await request('POST', '/product-categories', { name: 'Accesorios', businessId })).statusCode, 200)
    assert.equal((await request('POST', '/products', { ...product, businessId })).statusCode, 200)
  }
  for (const businessId of ['business-foreign', 'qa-demo']) {
    const before = catalogCalls, beforeWrites = writes
    assert.equal((await request('GET', '/products?businessId=' + businessId)).statusCode, 403)
    assert.equal((await request('POST', '/products', { ...product, businessId })).statusCode, 403)
    assert.equal(catalogCalls, before); assert.equal(writes, beforeWrites)
  }
  user = { ...baseUser, role: 'SUPER_ADMIN', businessId: null }
  assert.equal((await request('GET', '/products?businessId=business-1')).statusCode, 200)
  console.log('OK product catalog: real auth guard, roles, tenant, reload and optional categories')
} finally {
  await app.close()
  originals.reverse().forEach(restore => restore())
  await prisma.$disconnect()
}
