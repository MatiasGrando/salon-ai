import assert from 'node:assert/strict'
import { initialDialogueState, respond, parseDialogueState, type DialoguePort, type DialogueService } from '../src/conversational-bot/engine.js'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
const services: DialogueService[] = [
  { id: 'cut', name: 'Corte Hombre', durationMinutes: 30, requiresConsultation: false, price: 5000 },
  { id: 'color', name: 'Corte y Color', durationMinutes: 60, requiresConsultation: false, price: null }
]
const professionals = [{ id: 'ana', name: 'Ana', priority: 0 }, { id: 'luz', name: 'Luz', priority: 1 }]
const slots = professionals.map(p => ({ startAt: '2026-09-28T20:00:00.000Z', date: '2026-09-28', time: '17:00', professionalId: p.id, professionalName: p.name, band: 'AFTERNOON' as const, occupiedMinutes: 0 }))
const port: DialoguePort = { catalog: async () => services, availability: async (_, date, id) => ({ professionals, slots: slots.filter(s => s.date === date && (!id || id === s.professionalId)) }) }
const context = { businessId: 'trusted-tenant', timezone: 'America/Argentina/Buenos_Aires', dbNow: new Date('2026-09-28T15:00:00Z') }
let state = initialDialogueState(context.businessId)
async function say(message: string, selectedPort = port) { const r = await respond(context, state, message, selectedPort); state = r.state; return r }
assert.match((await say('hola')).reply, /Corte Hombre/)
assert.equal((await say('quiero Corte Hombre hoy 17:00')).state.pending, 'professional')
assert.equal(state.professional, null, 'date/time never silently select a professional')
assert.equal(state.requestedTime, '17:00')
await say('sos linda')
assert.equal(state.serviceId, 'cut', 'smalltalk preserves booking context')
assert.equal((await say('Ana')).state.pending, 'name')
assert.equal(state.slot?.professionalId, 'ana')
await say('Hola Manu')
assert.equal(state.customerName, null, 'greeting is not customer identity')
const proposal = (await say('Matias')).proposal
assert.equal(proposal?.kind, 'BOOKING_PROPOSAL')
assert.equal(proposal?.businessId, context.businessId)
assert.equal(proposal?.startAt, slots[0]!.startAt)
assert.doesNotMatch((await say('gracias')).reply, /Corte|servicio|reservado/)
await say('quiero cambiar la hora')
assert.equal(state.pending, 'time'); assert.equal(state.slot, null)
await say('18:00')
assert.equal(state.slot, null, 'arbitrary nonreturned time rejected')
await say('reset')
assert.equal(state.serviceId, null); assert.equal(state.customerName, null)
assert.match((await say('corte')).reply, /Corte Hombre[\s\S]*Corte y Color/)
assert.equal(state.serviceId, null)
await say('COLOR y CORTE hoy')
assert.equal(state.serviceId, 'color', 'conjunction order normalizes')
assert.equal(state.professional, null)
assert.equal((await say('cualquiera')).state.pending, 'time')
await say('17:00'); await say('soy Maria')
assert.equal(state.pending, 'proposal')
await say('nunca te dije Ana')
assert.equal(state.professional, null); assert.equal(state.slot, null)
await say('no quiero nada'); assert.equal(state.date, null)
await say('Corte Hombre hoy', { ...port, availability: async () => ({ professionals, slots: [] }) })
assert.equal(state.pending, 'date'); assert.equal(state.date, null)
await say('hoy', { ...port, availability: async () => ({ professionals, slots: [{ ...slots[0]!, startAt: '2026-09-28T10:00:00Z' }] }) })
assert.equal(state.slot, null)
assert.throws(() => parseDialogueState({ ...state, businessId: 'foreign' }, context.businessId))
assert.throws(() => parseDialogueState({ ...state, slot: slots[0] }, context.businessId))
await assert.rejects(() => respond(context, state, 'x'.repeat(2001), port))
const nearMidnight = { ...context, dbNow: new Date('2026-09-29T01:00:00Z') }
const timezone = await respond(nearMidnight, initialDialogueState(context.businessId), 'Corte Hombre hoy', { ...port, availability: async () => ({ professionals, slots: [{ ...slots[0]!, startAt: '2026-09-29T02:00:00Z' }] }) })
assert.equal(timezone.state.date, '2026-09-28', 'today follows tenant timezone')
await say('reset'); await say('Corte Hombre 28/09/2026'); assert.equal(state.date, '2026-09-28')

// Exercise the ACTUAL repository adapter via an injected fake Prisma client; no DB/global client.
const seen: string[] = []
const row = (id: string, name: string, parentServiceId: string | null = null, isBookable = true) => ({
  id, name, businessId: context.businessId, catalogCategoryId: 'cat', parentServiceId, isBookable,
  description: null, duration: 30, customerDurationMin: null, customerDurationMax: null,
  price: 5000, priceMode: 'FIXED', attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: false,
  estimateOptions: null, requiresPhoto: false, validationEnabled: false
})
const client = {
  serviceCategory: {
    findMany: async (args: any) => { assert.equal(args.where.businessId, context.businessId); return [{ id: 'cat', name: 'Servicios' }] },
    count: async () => 1, findFirst: async () => ({ id: 'cat' })
  },
  service: {
    findFirst: async (args: any) => args.where.id ? row(args.where.id, 'Corte Hombre') : null,
    findMany: async (args: any) => { assert.equal(args.where.businessId, context.businessId); return args.where.parentServiceId ? [row('child', 'Variante', 'parent')] : [row('cut', 'Corte Hombre'), row('parent', 'Variantes', null, false)] }
  },
  async $queryRaw(query: any) {
    const sql = query.strings.join(' '); seen.push(sql)
    if (sql.includes('CURRENT_TIMESTAMP')) return [{ now: context.dbNow }]
    if (sql.includes('BusinessBotOptionsSettings')) return [{ timezone: context.timezone, bookingHorizonDays: 2, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00' }]
    if (sql.includes('FROM "Professional" p')) return professionals
    if (sql.includes('FROM "BusinessHours"')) return [{ ownerId: context.businessId, dayOfWeek: 1, startTime: '17:00', endTime: '18:00' }]
    if (sql.includes('FROM "ProfessionalHours"')) return professionals.map(p => ({ ownerId: p.id, dayOfWeek: 1, startTime: '17:00', endTime: '18:00' }))
    return []
  }
}
const actual = await createPrismaDialoguePort(client as any, context.businessId)
assert.equal(actual.context.dbNow, context.dbNow)
assert.deepEqual((await actual.port.catalog()).map(s => s.id), ['cut', 'child'])
const actualSlots = await actual.port.availability(services[0]!, '2026-09-28')
assert.equal(actualSlots.slots.length, 4, 'all actual slots from both professionals preserved')
assert.equal(new Set(actualSlots.slots.map(s => s.professionalId)).size, 2)
assert.ok(seen.some(sql => sql.includes('CURRENT_TIMESTAMP')))
assert.equal((await actual.port.availability(services[0]!, '2026-09-28', 'foreign-pro')).slots.length, 0)
console.log('conversational bot: multi-turn engine and actual repository adapter PASS')
const mixedName = await respond(context, initialDialogueState(context.businessId), 'hola soy Matias quiero Corte Hombre hoy', port)
assert.equal(mixedName.state.customerName, 'Matias', 'explicit mixed identity captured without booking words')
state = { ...initialDialogueState(context.businessId), serviceId: 'cut', date: '2026-09-28', pending: 'professional' }
const identityOnly = await say('soy Ana')
assert.equal(identityOnly.state.professional, null, 'identity must not select a professional')
assert.equal(identityOnly.state.customerName, 'Ana')
await say('no quiero Ana')
assert.equal(state.professional, null, 'negative preference must never select rejected professional')
state = { ...state, professional: { kind: 'specific', id: 'luz' }, requestedTime: '17:00', slot: slots[1]!, customerName: null, pending: 'name' }
assert.equal((await say('no')).proposal, null, 'negative control is not a name')
assert.equal(state.customerName, null)
assert.equal((await say('cualquier profesional')).proposal, null, 'preference is not a name')
assert.equal(state.customerName, null)
state = { ...state, professional: { kind: 'specific', id: 'luz' }, slot: slots[1]!, customerName: 'Maria', pending: 'proposal' }
const invalidCorrection = await say('quiero cambiar al 31/02/2027')
assert.equal(invalidCorrection.proposal, null, 'invalid date correction must not emit stale proposal')
assert.match(invalidCorrection.reply, /fecha|día|dia/i)
assert.throws(() => parseDialogueState({ ...state, date: '2026-02-31', slot: null, pending: 'date' }, context.businessId), /date|fecha/)
assert.throws(() => parseDialogueState({ ...state, serviceId: 'cut', date: '2026-09-28', professional: { kind: 'specific', id: 'ana' }, slot: { ...slots[0]!, time: '18:00' }, pending: 'name' }, context.businessId, context.timezone), /slot/)
const singlePort = { ...port, availability: async () => ({ professionals: [professionals[0]!], slots: [slots[0]!] }) }
state = { ...initialDialogueState(context.businessId), serviceId: 'cut', date: '2026-09-28', pending: 'professional' }
await say('si', singlePort)
assert.equal(state.professional?.kind, 'specific', 'literal affirmative selects only the single compatible professional')
