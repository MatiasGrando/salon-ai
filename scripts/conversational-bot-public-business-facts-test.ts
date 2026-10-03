import assert from 'node:assert/strict'
import { loadBusinessFacts } from '../src/conversational-bot/prisma-business-facts.js'
import { projectDialogueService } from '../src/conversational-bot/prisma-basket-availability.js'
const context = { businessId: 'a', timezone: 'UTC', dbNow: new Date('2026-10-02T15:00:00Z') }
let paymentQuery: any
const row = { id: 'a', name: 'Demo', publicAddress: null, publicAddressArea: null, publicMapsUrl: null, publicWhatsapp: null, contactEmail: null, workshopPublicSiteUrl: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, landingDescription: 'Solo descripción cargada' }
const client: any = { business: { findFirst: async () => row }, businessHours: { findMany: async () => [] }, scheduleBlock: { findMany: async () => [] },
  $queryRaw: async (args: any) => { paymentQuery = args; return [{ id: 'cash', businessId: 'a', name: 'Efectivo' }, { id: 'card', businessId: 'a', name: 'Tarjeta' }] } }
const facts: any = await loadBusinessFacts(client, context, ['BUSINESS_INFO'])
assert.equal(facts.paymentMethods, 'Efectivo, Tarjeta')
assert.ok(paymentQuery.values.includes('a'))
assert.match(paymentQuery.text, /WHERE "businessId" = \$1 AND "isActive" = true/)
assert.match(paymentQuery.text, /ORDER BY "position" ASC, "name" ASC, "id" ASC LIMIT 101/)
assert.doesNotMatch(paymentQuery.text, /treasury|cashEntries|bank|alias/i)
assert.equal(facts.description, row.landingDescription)
for (const field of ['discounts','parking','accessibility','wifi','policies']) assert.equal(facts[field] ?? null, null)
client.$queryRaw = async () => []
assert.equal((await loadBusinessFacts(client, context, ['BUSINESS_INFO']) as any).paymentMethods, null)
client.$queryRaw = async () => [{ id: 'bad', businessId: 'b', name: 'Foreign' }]
await assert.rejects(() => loadBusinessFacts(client, context), /scope/)
const service: any = { id: 's', name: 'Service', description: 'Includes actual loaded details', durationMinutes: 30, durationMinMinutes: 20, durationMaxMinutes: 40, price: 2500, priceMode: 'STARTING_AT', requiresConsultation: false }
const projected: any = projectDialogueService(service)
assert.equal(projected.description, service.description)
assert.equal(projected.durationMinMinutes, 20); assert.equal(projected.durationMaxMinutes, 40)
console.log('conversational public business facts: PASS')
