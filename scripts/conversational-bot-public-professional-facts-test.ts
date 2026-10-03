import assert from 'node:assert/strict'
import { loadPublicProfessionalFacts } from '../src/conversational-bot/prisma-public-professional-facts.js'
import { computeExceptionWindow } from '../src/bot-options/application/hours-queries.js'
import { queryPublicProfessionalFacts, type PublicProfessionalTarget } from '../src/conversational-bot/public-professional-facts.js'
const context = { businessId: 'a', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-10-02T15:00:00Z') }
const calls: { model: string; args: any }[] = []
const client: any = {
  professional: { findMany: async (args: any) => { calls.push({ model: 'professional', args }); return [
    { id: 'p1', businessId: 'a', name: 'Ana', description: 'Colorista', acceptsBotBookings: false,
      serviceLinks: [{ service: { id: 's1', businessId: 'a', name: 'Color', description: 'Producto cargado' } }] },
    { id: 'p2', businessId: 'a', name: 'Ana Maria', description: null, acceptsBotBookings: true, serviceLinks: [] }
  ] } },
  professionalHours: { findMany: async (args: any) => { calls.push({ model: 'professionalHours', args });
    return [{ professionalId: 'p1', dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }] } },
  scheduleBlock: { findMany: async (args: any) => { calls.push({ model: 'scheduleBlock', args });
    return [{ businessId: 'a', professionalId: 'p1', startAt: new Date('2026-10-03T15:00:00Z'), endAt: new Date('2026-10-03T17:00:00Z'), note: 'PRIVATE', reason: 'PERSONAL' }] } }
}
const facts = await loadPublicProfessionalFacts(client, context)
assert.equal(calls.length, 3, 'bulk public professional facts use three constant queries')
assert.equal(facts.professionals.length, 2, 'active non-bot-bookable staff remain public')
assert.equal(facts.professionals[0]!.description, 'Colorista')
assert.equal(facts.professionals[0]!.services[0]!.description, 'Producto cargado')
assert.ok(!JSON.stringify(facts).includes('PRIVATE')); assert.ok(!JSON.stringify(facts).includes('PERSONAL'))
const first = calls.find(call => call.model === 'professional')!.args
assert.equal(first.where.businessId, 'a'); assert.equal(first.where.isActive, true)
assert.equal(first.where.acceptsBotBookings, undefined)
assert.equal(first.select.commissionMode, undefined); assert.equal(first.select.appointments, undefined)
assert.deepEqual(first.select.serviceLinks.where.service, { businessId: 'a', isActive: true })
for (const call of calls.filter(call => call.model !== 'professional')) {
  if (call.model === 'professionalHours') assert.equal(call.args.where.professional.businessId, 'a')
  else { assert.equal(call.args.where.businessId, 'a'); assert.equal(call.args.where.OR[1].professional.businessId, 'a'); assert.deepEqual(call.args.where.OR[1].professionalId.in, ['p1','p2']); assert.equal(call.args.select.note, undefined); assert.equal(call.args.select.reason, undefined) }
}
const target = (overrides: Partial<PublicProfessionalTarget> = {}): PublicProfessionalTarget => ({ kind: 'professional', mention: null, serviceIds: [], date: null, weekday: null, aspect: 'overview', ...overrides })
assert.equal(queryPublicProfessionalFacts(facts, target()).professionals.length, 2)
assert.equal(queryPublicProfessionalFacts(facts, target({ mention: 'Ana' })).professionals.length, 1)
assert.equal(queryPublicProfessionalFacts(facts, target({ serviceIds: ['s1'] })).professionals[0]!.id, 'p1')
assert.match(queryPublicProfessionalFacts(facts, target({ mention: 'Ana', aspect: 'schedule' })).professionals[0]!.schedule!, /Sábado.*09:00 a 18:00/)
assert.match(queryPublicProfessionalFacts(facts, target({ mention: 'Ana', aspect: 'schedule' })).professionals[0]!.schedule!, /No atiende:.*12:00.*14:00/)
const saturday = queryPublicProfessionalFacts(facts, target({ date: '2026-10-03', aspect: 'schedule' }))
assert.equal(saturday.professionals.length, 1)
assert.match(saturday.professionals[0]!.schedule!, /09:00 a 12:00, 14:00 a 18:00/)
assert.match(saturday.professionals[0]!.schedule!, /habitual/i)
assert.match(saturday.professionals[0]!.schedule!, /no.*turnos libres/i)
assert.equal(saturday.complete, false, 'missing staff schedule is not evidence of absence')
assert.equal(queryPublicProfessionalFacts(facts, target({ weekday: 6 })).complete, false)
assert.equal(queryPublicProfessionalFacts(facts, target({ mention: 'Ana Maria', aspect: 'schedule' })).professionals[0]!.schedule, null)
assert.equal(queryPublicProfessionalFacts(facts, target({ date: '2026-12-03', aspect: 'schedule' })).complete, false)
assert.throws(() => queryPublicProfessionalFacts(facts, target({ date: '2026-02-30' })), /date/)
assert.throws(() => queryPublicProfessionalFacts(facts, target({ weekday: 7 })), /weekday/)
client.professionalHours.findMany = async () => [{ professionalId: 'foreign', dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }]
await assert.rejects(() => loadPublicProfessionalFacts(client, context), /scope/)
client.professionalHours.findMany = async () => Array.from({ length: 101 }, () => ({ professionalId: 'p1', dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }))
await assert.rejects(() => loadPublicProfessionalFacts(client, context), /bound/)
client.professional.findMany = async () => [{ id: 'foreign', businessId: 'b', name: 'Foreign', serviceLinks: [] }]
await assert.rejects(() => loadPublicProfessionalFacts(client, context), /scope/)
client.professional.findMany = async () => [{ id: 'p1', businessId: 'a', name: 'Ana', acceptsBotBookings: true, serviceLinks: [{ service: { id: 'foreign', businessId: 'b', name: 'Foreign' } }] }]
await assert.rejects(() => loadPublicProfessionalFacts(client, context), /scope/)
for (const timezone of ['Pacific/Kiritimati', 'Asia/Kathmandu', 'America/New_York']) {
  const window = computeExceptionWindow(new Date('2026-10-02T15:00:00Z'), timezone)
  const localized = { ...facts, timezone, exceptionWindow: { from: window.from.toISOString(), to: window.to.toISOString() }, businessExceptions: [],
    professionals: [{ ...facts.professionals[0]!, exceptions: [] }] }
  assert.match(queryPublicProfessionalFacts(localized, target({ date: '2026-10-03', aspect: 'schedule' })).professionals[0]!.schedule!, /09:00 a 18:00/, 'date uses business timezone ' + timezone)
}
const closed = { ...facts, businessExceptions: [{ startAt: '2026-10-03T03:00:00.000Z', endAt: '2026-10-04T03:00:00.000Z' }], professionals: [facts.professionals[0]!] }
assert.equal(queryPublicProfessionalFacts(closed, target({ date: '2026-10-03' })).professionals.length, 0)
assert.match(queryPublicProfessionalFacts(closed, target({ date: '2026-10-03', mention: 'Ana' })).professionals[0]!.schedule!, /No atiende según/)
assert.throws(() => queryPublicProfessionalFacts({ ...facts, professionals: [{ ...facts.professionals[0]!, weeklyHours: [{ dayOfWeek: 8, startTime: '09:00', endTime: '18:00' }] }] }, target()), /hours/)
assert.throws(() => queryPublicProfessionalFacts({ ...facts, professionals: [facts.professionals[0]!, facts.professionals[0]!] }, target()), /duplicate/)
assert.throws(() => queryPublicProfessionalFacts({ ...facts, professionals: [{ ...facts.professionals[0]!, description: 'x'.repeat(8001) }] }, target()), /professional/)
console.log('conversational public professional facts: PASS')
