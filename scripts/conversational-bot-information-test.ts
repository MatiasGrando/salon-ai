import assert from 'node:assert/strict'
import { initialDialogueState, respond, type DialoguePort } from '../src/conversational-bot/engine.js'
import { ACTION_REGISTRY, routeActions } from '../src/conversational-bot/actions.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
const context = { businessId: 'tenant-a', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
const services = [
  { id: 'cut', name: 'Corte', price: 5000, durationMinutes: 30, requiresConsultation: false },
  { id: 'beard', name: 'Barba', price: 3000, durationMinutes: 20, requiresConsultation: false }
]
const slot = { date: '2026-09-29', time: '17:00', startAt: '2026-09-29T20:00:00Z', professionalId: 'rama', professionalName: 'Rama', band: 'AFTERNOON' as const, occupiedMinutes: 0 }
let availabilityReads = 0
const facts = { businessId: context.businessId, name: 'Demo', address: 'Calle 123', area: null, mapsUrl: null, website: 'https://demo.example', whatsapp: '12345', email: 'info@demo.example', instagram: null, facebook: null, tiktok: null, description: 'Atención con turno', hours: 'Lunes: 09:00 a 18:00', bookingUrl: null }
const port: DialoguePort = {
  catalog: async () => services,
  information: async () => facts,
  availability: async () => { availabilityReads++; return { professionals: [{ id: 'rama', name: 'Rama', priority: 0 }], slots: [slot] } }
}
const pending = { ...initialDialogueState(context.businessId), serviceId: 'cut', pending: 'date' as const }
const snapshot = structuredClone(pending)
const address = await respond(context, pending, 'donde quedan?', port)
assert.deepEqual(address.state, snapshot)
assert.deepEqual(pending, snapshot, 'caller state never mutates')
assert.match(address.reply, /Calle 123/)
assert.match(address.reply, /día/)
assert.equal(address.proposal, null)
assert.equal(availabilityReads, 0)
const greet = await respond(context, address.state, 'hola', port)
assert.doesNotMatch(greet.reply, /Calle 123/)
const price = await respond(context, pending, 'cuanto cuesta barba?', port)
assert.match(price.reply, /Barba.*3.?000/)
assert.equal(price.state.serviceId, 'cut')
const mixed = await respond(context, initialDialogueState(context.businessId), 'a que hora abren y quiero un corte mañana', port)
assert.match(mixed.reply, /09:00 a 18:00/)
assert.equal(mixed.state.serviceId, 'cut')
assert.equal(mixed.state.date, '2026-09-29')
assert.equal(mixed.state.pending, 'professional')
const multi = await respond(context, pending, 'precio de barba y direccion?', port)
assert.match(multi.reply, /3.?000/)
assert.match(multi.reply, /Calle 123/)
assert.deepEqual(multi.state, pending)
const availability = await respond(context, pending, 'tenes turno hoy a la tarde?', port)
assert.doesNotMatch(availability.reply, /09:00 a 18:00/)
assert.deepEqual(routeActions('tenes turno hoy a la tarde?').information, [])
assert.equal(ACTION_REGISTRY.CANCEL.status, 'pending')
const cancel = await respond(context, { ...pending, pending: 'name', date: slot.date, professional: { kind: 'specific', id: 'rama' }, slot }, 'quiero cancelar el turno', port)
assert.equal(cancel.state.customerName, null)
assert.equal(cancel.proposal, null)
assert.match(cancel.reply, /todavía/)
const proposalState = { ...pending, pending: 'proposal' as const, date: slot.date, professional: { kind: 'specific' as const, id: 'rama' }, slot, customerName: 'Ana' }
const interruption = await respond(context, proposalState, 'tenes pagina web?', port)
assert.deepEqual(interruption.state, proposalState)
assert.equal(interruption.proposal, null)
assert.match(interruption.reply, /demo.example/)
const missing = await respond(context, pending, 'direccion?', { ...port, information: async () => ({ ...facts, address: null, area: null }) })
assert.match(missing.reply, /no tengo/i)
const unknownPrice = await respond(context, pending, 'cuanto cuesta un masaje?', port)
assert.doesNotMatch(unknownPrice.reply, /5000|3000/)
assert.match(unknownPrice.reply, /servicio/i)
const ambiguous = await respond(context, pending, 'precio corte?', { ...port, catalog: async () => [services[0]!, { ...services[0]!, id: 'other', name: 'Corte largo' }] })
assert.match(ambiguous.reply, /Cuál/)
assert.deepEqual(ambiguous.state, pending)
await assert.rejects(() => respond(context, pending, 'direccion?', { ...port, information: async () => ({ ...facts, businessId: 'tenant-b' }) }))
const failed = await respond(context, proposalState, 'direccion?', { ...port, information: async () => { throw new Error('secret') } })
assert.deepEqual(failed.state, proposalState)
assert.doesNotMatch(failed.reply, /secret/)
assert.equal(failed.proposal, null)
// Actual repositories with injected clients: tenant isolation and public-only projections.
const queries: any[] = []
const client: any = {
  business: { findFirst: async (args: any) => { queries.push(args); assert.equal(args.where.id, context.businessId); assert.equal(args.select.contactPhone, undefined); return { id: context.businessId, name: 'Demo', publicAddress: 'Calle 123', publicAddressArea: null, publicMapsUrl: null, publicWhatsapp: '12345', workshopPublicSiteUrl: 'https://demo.example', instagramUrl: null, facebookUrl: null, tiktokUrl: null, landingDescription: null } } },
  businessHours: { findMany: async (args: any) => { assert.equal(args.where.businessId, context.businessId); return [{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00' }] } },
  scheduleBlock: { findMany: async (args: any) => { assert.equal(args.where.businessId, context.businessId); assert.equal(args.where.professionalId, null); return [{ startAt: new Date('2026-09-29T12:00:00Z'), endAt: new Date('2026-09-29T15:00:00Z'), reason: 'MAINTENANCE', title: 'Cierre especial', note: 'PRIVATE INTERNAL NOTE' }] } },
  serviceCategory: {}, service: {},
  $queryRaw: async (query: any) => query.strings.join(' ').includes('CURRENT_TIMESTAMP') ? [{ now: context.dbNow }] : [{ timezone: context.timezone, bookingHorizonDays: 2, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00' }]
}
const actual = await createPrismaDialoguePort(client, context.businessId)
const actualFacts = await actual.port.information!()
assert.match(actualFacts.hours!, /09:00 a 18:00/)
assert.doesNotMatch(actualFacts.hours!, /PRIVATE/)
assert.equal(actualFacts.address, 'Calle 123')
assert.equal(actualFacts.email, null, 'missing configured customer-facing email is unknown')
client.business.findFirst = async () => ({ id: 'tenant-b', name: 'Foreign' })
await assert.rejects(() => actual.port.information!(), /scope/)


const hoursDate = await respond(context, pending, 'a que hora abren mañana?', port)
assert.deepEqual(hoursDate.state, pending, 'date in an hours question is not booking data')
const mixedPrice = await respond(context, initialDialogueState(context.businessId), 'cuanto sale barba y quiero corte mañana', port)
assert.equal(mixedPrice.state.serviceId, 'cut', 'price service never overwrites booking service')
assert.equal(mixedPrice.state.date, '2026-09-29')
assert.match(mixedPrice.reply, /Barba.*3.?000/)
const fromPrice = await respond(context, pending, 'precio barba?', { ...port, catalog: async () => [{ ...services[1]!, priceMode: 'STARTING_AT' as const }] })
assert.match(fromPrice.reply, /Desde/)
const infoIntent = await respond(context, proposalState, 'quiero información', port)
assert.deepEqual(infoIntent.state, proposalState)
assert.equal(infoIntent.proposal, null)
const contact = await respond(context, pending, 'telefono y correo?', port)
assert.match(contact.reply, /12345/)
assert.match(contact.reply, /info@demo.example/)
await assert.rejects(() => respond({ ...context, businessId: 'tenant-b' }, pending, 'direccion?', port))
const unchangedMixed = await respond(context, proposalState, 'direccion y quiero un turno', port)
assert.equal(unchangedMixed.proposal, null, 'a mixed question does not republish an unchanged proposal')
for (const operation of ['quiero reprogramar mi turno', 'quiero modificar mi turno', 'quiero hablar con una persona']) {
  const result = await respond(context, proposalState, operation, port)
  assert.equal(result.proposal, null)
  assert.deepEqual(result.state, proposalState)
  assert.match(result.reply, /todavía/)
}
const exactPrice = await respond(context, pending, 'precio corte hombre?', { ...port, catalog: async () => [{ ...services[0]!, name: 'Corte Hombre' }, { ...services[0]!, id: 'color', name: 'Corte Color' }] })
assert.match(exactPrice.reply, /Corte Hombre.*5.?000/)
assert.doesNotMatch(exactPrice.reply, /Corte Color/)
const reverseMixed = await respond(context, initialDialogueState(context.businessId), 'quiero corte mañana y cuanto sale barba?', port)
assert.equal(reverseMixed.state.serviceId, 'cut')
assert.match(reverseMixed.reply, /Barba.*3.?000/)


const hoursMixedTime = await respond(context, initialDialogueState(context.businessId), 'quiero corte mañana y abren a las 17:00?', port)
assert.equal(hoursMixedTime.state.serviceId, 'cut')
assert.equal(hoursMixedTime.state.date, '2026-09-29')
assert.equal(hoursMixedTime.state.requestedTime, null, 'opening-hours time is not booking time')
const catalogMixed = await respond(context, initialDialogueState(context.businessId), 'quiero corte mañana y que servicios hay?', port)
assert.equal(catalogMixed.state.serviceId, 'cut')
assert.equal(catalogMixed.state.date, '2026-09-29')
assert.equal(catalogMixed.state.pending, 'professional')
const pureInfoProposal = await respond(context, proposalState, 'quiero ver precios de barba', port)
assert.deepEqual(pureInfoProposal.state, proposalState)
assert.equal(pureInfoProposal.proposal, null)

const corrections: string[] = []
for (const [label, message, expectedDate, expectedService] of [
  ['pure request to view prices', 'quiero ver precios de barba', null, 'cut'],
  ['info request followed by explicit booking', 'quiero saber el precio de barba y quiero corte mañana', '2026-09-29', 'cut'],
  ['booking followed by explicit information request', 'quiero corte mañana y quiero saber a qué hora abren', '2026-09-29', 'cut']
] as const) {
  try {
    const result = await respond(context, pending, message, port)
    if (expectedDate === null) assert.deepEqual(result.state, pending)
    else { assert.equal(result.state.date, expectedDate); assert.equal(result.state.serviceId, expectedService) }
    assert.equal(result.proposal, null)
  } catch (error) { corrections.push(label + ': ' + (error as Error).message) }
}
assert.deepEqual(corrections, [], 'independently identified clause regressions')

const startingCatalog = await respond(context, initialDialogueState(context.businessId), 'hola', { ...port, catalog: async () => [{ ...services[1]!, priceMode: 'STARTING_AT' as const }] })
assert.match(startingCatalog.reply, /Desde.*3.?000/, 'booking catalog preserves starting price semantics')
console.log('conversational bot information: PASS')