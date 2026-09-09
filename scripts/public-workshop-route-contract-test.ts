import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/config/prisma.js'
import { publicWorkshopRoutes } from '../src/routes/public-workshop.js'
import { authGuard } from '../src/plugins/auth-guard.js'

const restores: Array<() => void> = []
function mock(target: any, key: string, value: any) {
  const original = target[key]
  restores.push(() => { target[key] = original })
  target[key] = value
}

let vehicleWhere: any = null
let jobsArgs: any = null
const vehicle = {
  id: 'vehicle-a', businessId: 'business-a', plate: 'AB123CD', model: 'Kangoo', year: null,
  engine: '--', currentMileage: 120_000, usage: 'PARTICULAR', brand: { name: 'Renault' }
}
const jobs = [
  { id: 'job-a', date: '2026-08-15', mileage: 120_000, lines: [{ description: 'Cambio de aceite', quantity: 1 }] },
  { id: 'job-b', date: '2026-02-15', mileage: 110_000, lines: [{ description: 'Filtro de aceite', quantity: 1 }] }
]

const app = Fastify()
await app.register(publicWorkshopRoutes)
await authGuard(app)

try {
  mock(prisma.business, 'findFirst', async ({ where }: any) => where.customerCode === 'WX-8Y4HHG' ? { id: 'business-a' } : null)
  mock(prisma.workshopVehicle, 'findFirst', async ({ where }: any) => {
    vehicleWhere = where
    return where.businessId === 'business-a' && where.plate === 'AB123CD' ? vehicle : null
  })
  mock(prisma.workshopJob, 'findFirst', async () => jobs[0])
  mock(prisma.workshopJob, 'findMany', async (args: any) => { jobsArgs = args; return jobs })

  let response = await app.inject({ method: 'GET', url: '/public/workshops/WX-8Y4HHG/vehicles/ab-123-cd?limit=1&offset=0' })
  assert.equal(response.statusCode, 200, response.body)
  assert.equal(response.json().plate, 'AB123CD')
  assert.equal(response.json().history.items.length, 1)
  assert.equal(response.json().history.hasMore, true)
  assert.equal(response.json().history.nextOffset, 1)
  assert.deepEqual(vehicleWhere, { businessId: 'business-a', plate: 'AB123CD' })
  assert.equal(jobsArgs.take, 2)
  assert.equal(jobsArgs.skip, 0)
  assert.equal(response.headers['access-control-allow-origin'], '*')
  assert.match(String(response.headers['cache-control']), /no-store/)

  response = await app.inject({ method: 'GET', url: '/public/workshops/WX-8Y4HHG/vehicles/A' })
  assert.equal(response.statusCode, 400)

  response = await app.inject({ method: 'GET', url: '/public/workshops/UNKNOWN/vehicles/AB123CD' })
  assert.equal(response.statusCode, 404)

  response = await app.inject({ method: 'GET', url: '/public/workshops/WX-8Y4HHG/vehicles/ZZ999ZZ' })
  assert.equal(response.statusCode, 404)

  console.log('Public workshop route contract: OK')
} finally {
  restores.reverse().forEach(restore => restore())
  await app.close()
  await prisma.$disconnect()
}
