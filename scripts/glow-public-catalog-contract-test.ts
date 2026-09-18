import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import Fastify from 'fastify'
import { glowPublicCatalogRoutes } from '../src/routes/glow-public-catalog.js'

const calls: any[] = []
let unavailable: string | null = null
let fail = false
const database = { business: { async findUnique(query: any) {
  calls.push(query)
  if (fail) throw new Error('secret database error')
  if (unavailable === 'missing') return null
  const code = query.where.customerCode
  const prefix = code === 'WX-QG5FQA' ? 'urquiza' : 'canitas'
  assert.ok(['WX-QG5FQA', 'WX-NPP7HE'].includes(code))
  assert.deepEqual(query.select.services.where, { isActive: true, isBookable: true })
  assert.deepEqual(query.select.professionals.where, { isActive: true })
  for (const key of ['settings', 'paymentSettings', 'whatsappConfig', 'contactEmail', 'users']) {
    assert.equal(query.select[key], undefined)
  }
  return {
    name: `Glow ${prefix}`, slug: `glow${prefix}`, publicAddress: prefix === 'urquiza' ? 'Monroe 5252' : 'Teodoro García 1828', publicAddressArea: prefix,
    accountStatus: unavailable || 'ACTIVE', landingEnabled: unavailable !== 'disabled',
    contactEmail: 'private@example.test',
    services: [{ id: `${prefix}-service`, name: 'Color', description: 'Color personalizado', imageUrl: '/color.webp',
      duration: 60, customerDurationMin: 80, customerDurationMax: 100, category: 'Color', price: 15000, priceMode: 'STARTING_AT', secret: 'hidden' }],
    professionals: [{ id: `${prefix}-professional`, name: 'Profesional', description: 'Especialista', avatarUrl: '/professional.webp', phone: 'private' }]
  }
} } }
const app = Fastify()
await app.register(glowPublicCatalogRoutes, { database: database as any })
try {
  for (const branch of ['urquiza', 'canitas']) {
    const response = await app.inject(`/public/glow/branches/${branch}/catalog`)
    assert.equal(response.statusCode, 200)
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.equal(response.headers['access-control-allow-origin'], undefined)
    const body = response.json()
    assert.equal(body.branch.id, branch)
    assert.equal(body.branch.bookingUrl, `https://weex.com.ar/glow${branch}/reservar?template=salon-white`)
    assert.equal(body.branch.address, `${branch === 'urquiza' ? 'Monroe 5252' : 'Teodoro García 1828'}, ${branch}`)
    assert.equal(body.services[0].id, `${branch}-service`)
    assert.equal(body.professionals[0].id, `${branch}-professional`)
    assert.equal(body.services[0].description, 'Color personalizado')
    assert.equal(body.services[0].imageUrl, '/color.webp')
    assert.equal(body.services[0].displayDuration, '80 a 100 min')
    assert.equal(body.professionals[0].description, 'Especialista')
    assert.equal(body.professionals[0].avatarUrl, '/professional.webp')
    assert.deepEqual(Object.keys(body).sort(), ['branch', 'professionals', 'services'])
    assert.equal(JSON.stringify(body).includes('private'), false)
    assert.equal(JSON.stringify(body).includes('hidden'), false)
  }
  const before = calls.length
  for (const path of ['other', 'WX-QG5FQA', '__proto__', 'constructor']) {
    assert.equal((await app.inject(`/public/glow/branches/${path}/catalog`)).statusCode, 404)
  }
  for (const query of ['customerCode=WX-NPP7HE', 'businessId=another', 'branch=canitas']) {
    assert.equal((await app.inject(`/public/glow/branches/urquiza/catalog?${query}`)).statusCode, 400)
  }
  assert.equal(calls.length, before, 'invalid tenant input must not query any account')
  for (const state of ['missing', 'disabled', 'PAUSED', 'CANCELLED', 'ONBOARDING']) {
    unavailable = state
    const response = await app.inject('/public/glow/branches/urquiza/catalog')
    assert.equal(response.statusCode, 404)
    assert.equal(response.json().services, undefined)
  }
  unavailable = null
  fail = true
  const error = await app.inject('/public/glow/branches/canitas/catalog')
  assert.equal(error.statusCode, 503)
  assert.equal(error.body.includes('secret'), false)
  fail = false
  assert.equal((await app.inject({ method: 'HEAD', url: '/public/glow/branches/urquiza/catalog' })).statusCode, 200)
  assert.notEqual((await app.inject({ method: 'POST', url: '/public/glow/branches/urquiza/catalog' })).statusCode, 200)
  const guard = readFileSync('src/plugins/auth-guard.ts', 'utf8')
  assert.ok(guard.includes("['GET', 'HEAD'].includes(request.method) && /^\\/public\\/glow\\/branches\\/(urquiza|canitas)\\/catalog$/.test(path)"))
  assert.ok(readFileSync('src/server.ts', 'utf8').includes('app.register(glowPublicCatalogRoutes)'))
  console.log('Glow public catalog contract: OK (isolated branches, explicit DTO, availability and auth scope)')
} finally {
  await app.close()
}
