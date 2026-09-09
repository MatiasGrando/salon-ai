import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/config/prisma.js'
import { workshopRoutes } from '../src/routes/workshop.js'

const restores: Array<() => void> = []
function mock(target: any, key: string, value: any) {
  const original = target[key]
  restores.push(() => { target[key] = original })
  target[key] = value
}

let role = 'BUSINESS_ADMIN'
let assignedBusinessId: string | null = 'workshop-a'
const brands = [{ id: 'brand-a', businessId: 'workshop-a', name: 'Renault', normalizedName: 'renault' }]
const vehicle = {
  id: 'vehicle-a', customerId: 'customer-a', businessId: 'workshop-a', plate: 'AB123CD', model: 'Kangoo', year: 2020,
  engine: '1.6', currentMileage: 82400, usage: 'PROFESSIONAL', createdAt: new Date(), updatedAt: new Date(),
  brand: brands[0], customer: { id: 'customer-a', name: 'Ana', phone: '5491155555555', email: null }
}
let customerUpsertArgs: any = null
let vehicleUpdateArgs: any = null
let vehicleFindManyArgs: any = null

const app = Fastify()
app.addHook('preHandler', async request => {
  request.auth = { user: { id: 'user-a', role, businessId: assignedBusinessId, canCreateBusinesses: false } } as any
})
await app.register(workshopRoutes)

try {
  mock(prisma.business, 'findFirst', async ({ where }: any) => {
    const ids = where.AND?.map((part: any) => part.id) || [where.id]
    const id = ids[0]
    if (ids.some((value: string) => value !== id)) return null
    return id === 'workshop-a' ? { id, businessType: 'WORKSHOP' } : id === 'salon-a' ? { id, businessType: 'SALON' } : null
  })
  mock(prisma.workshopBrand, 'findMany', async ({ where }: any) => brands.filter(item => item.businessId === where.businessId))
  mock(prisma.workshopBrand, 'upsert', async ({ create }: any) => ({ id: 'brand-new', ...create }))
  mock(prisma.workshopVehicle, 'findMany', async (args: any) => { vehicleFindManyArgs = args; return args.where.businessId === 'workshop-a' ? [vehicle] : [] })
  mock(prisma.workshopVehicle, 'findFirst', async ({ where }: any) => where.businessId === 'workshop-a' && where.id === vehicle.id ? vehicle : null)
  mock(prisma, '$transaction', async (operation: any) => operation({
    workshopBrand: { findFirst: async ({ where }: any) => where.businessId === 'workshop-a' && where.id === 'brand-a' ? brands[0] : null },
    customer: { update: async () => vehicle.customer, upsert: async (args: any) => { customerUpsertArgs = args; return vehicle.customer } },
    workshopVehicle: {
      findFirst: async ({ where }: any) => where.businessId === 'workshop-a' && where.id === vehicle.id ? vehicle : null,
      create: async () => vehicle,
      update: async (args: any) => { vehicleUpdateArgs = args; return { ...vehicle, ...args.data, brand: brands[0], customer: { id: 'customer-updated', name: 'Ana corregida', phone: '11-4444-4444', email: 'ana@example.com' } } }
    }
  }))

  let response = await app.inject({ method: 'GET', url: '/workshop/vehicles?businessId=workshop-a' })
  assert.equal(response.statusCode, 200, response.body)
  assert.deepEqual(response.json(), [])
  assert.equal(vehicleFindManyArgs, null)

  response = await app.inject({ method: 'GET', url: '/workshop/vehicles?businessId=workshop-a&q=ab1' })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json()[0].plate, 'AB123CD')
  assert.deepEqual(vehicleFindManyArgs.where.plate, { startsWith: 'AB1' })
  assert.equal(vehicleFindManyArgs.take, 10)
  assert.deepEqual(vehicleFindManyArgs.orderBy, [{ plate: 'asc' }])

  response = await app.inject({ method: 'POST', url: '/workshop/brands', payload: { businessId: 'workshop-a', name: 'Ford' } })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().normalizedName, 'ford')

  response = await app.inject({ method: 'POST', url: '/workshop/vehicles', payload: {
    businessId: 'workshop-a', plate: 'ab 123 cd', brandId: 'brand-a', model: 'Kangoo', year: 2020,
    engine: '1.6', currentMileage: 82400, usage: 'PROFESSIONAL', contactName: 'Ana', contactPhone: '11 5555-5555'
  } })
  assert.equal(response.statusCode, 201, response.body)
  assert.equal(response.json().contact.name, 'Ana')
  assert.equal(customerUpsertArgs.create.phone, '11-5555-5555')
  assert.equal(customerUpsertArgs.create.normalizedPhone, '5491155555555')

  response = await app.inject({ method: 'PATCH', url: '/workshop/vehicles/vehicle-a', payload: {
    businessId: 'workshop-a', plate: 'ac 987 zy', brandId: 'brand-a', model: 'Kangoo II', year: 2021,
    engine: '1.6 nafta', currentMileage: 83000, usage: 'FREQUENT', contactName: 'Ana corregida', contactPhone: '11-4444-4444', contactEmail: 'ana@example.com'
  } })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().plate, 'AC987ZY')
  assert.equal(response.json().contact.name, 'Ana corregida')
  assert.equal(vehicleUpdateArgs.where.id, 'vehicle-a')
  assert.equal(vehicleUpdateArgs.data.customerId, 'customer-a')

  response = await app.inject({ method: 'PATCH', url: '/workshop/vehicles/unknown', payload: {
    businessId: 'workshop-a', plate: 'AC987ZY', brandId: 'brand-a', model: 'Kangoo II', year: 2021,
    engine: '1.6', currentMileage: 83000, usage: 'FREQUENT', contactName: 'Ana', contactPhone: '11-4444-4444'
  } })
  assert.equal(response.statusCode, 404)

  assignedBusinessId = 'salon-a'
  response = await app.inject({ method: 'GET', url: '/workshop/vehicles?businessId=salon-a' })
  assert.equal(response.statusCode, 403)

  assignedBusinessId = 'workshop-a'
  response = await app.inject({ method: 'GET', url: '/workshop/vehicles?businessId=workshop-b' })
  assert.equal(response.statusCode, 404)

  role = 'SUPER_ADMIN'
  assignedBusinessId = null
  response = await app.inject({ method: 'GET', url: '/workshop/vehicles/unknown?businessId=workshop-a' })
  assert.equal(response.statusCode, 404)

  console.log('Workshop vehicle route contracts passed (CRUD, workshop guard and tenant isolation)')
} finally {
  restores.reverse().forEach(restore => restore())
  await app.close()
  await prisma.$disconnect()
}
