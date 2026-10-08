import { presentVerifiedDates } from '../src/conversational-bot/availability-presentation.js'
import assert from 'node:assert/strict'
import { loadPrismaBasketAvailability, loadPrismaVerifiedDateChoices } from '../src/conversational-bot/prisma-basket-availability.js'
const context = { businessId: 'a', timezone: 'UTC', dbNow: new Date('2026-10-02T10:00:00Z') }
const settings = { timezone: 'UTC', horizonDays: 2, leadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00' }
let endTime = '11:00'
let agendaQueries = 0, unavailable = false, blocks: any[] = [], busy: any[] = []
let service: any = { id: 's', businessId: 'a', name: 'Service', price: 10, priceMode: 'FIXED', duration: 30, isBookable: true, isActive: true, attentionMode: 'DIRECT_BOOKING', requiresPhoto: false, validationEnabled: false, estimateAllowsBooking: false, catalogCategoryId: null, parentServiceId: null, description: null, customerDurationMin: null, customerDurationMax: null, estimateQuestion: null, estimateOptions: null, estimateExplanation: null, estimateDisclaimer: null, validationMessage: null, validationQuestion: null }
const client: any = {
  service: { findFirst: async (query: any) => { assert.equal(query.where.businessId, 'a'); return unavailable ? null : structuredClone(service) } },
  $queryRaw: async (query: any) => {
    const sql = query.strings.join(' ')
    if (sql.includes('FROM "Professional"')) return [{ id: 'p', name: 'Staff', priority: 0 }]
    agendaQueries++
    if (sql.includes('FROM "BusinessHours"')) return Array.from({length: 7}, (_,dayOfWeek) => ({ ownerId: 'a', dayOfWeek, startTime: '09:00', endTime }))
    if (sql.includes('FROM "ProfessionalHours"')) return Array.from({length: 7}, (_,dayOfWeek) => ({ ownerId: 'p', dayOfWeek, startTime: '09:00', endTime }))
    if (sql.includes('FROM "ScheduleBlock"')) return blocks
    if (sql.includes('FROM "Appointment"')) return busy
    throw new Error('unexpected agenda query')
  }
}
const selected: any = { id: 's', name: 'STALE', durationMinutes: 1, price: 0, requiresConsultation: false }
const all = await loadPrismaVerifiedDateChoices(client, context, settings, [selected])
assert.equal(all.ok, true, JSON.stringify(all))
if (!all.ok) throw new Error('verified days unavailable')
assert.deepEqual([...new Set(all.slots.map(s => s.date))], ['2026-10-02','2026-10-03'])
assert.equal(all.slots.filter(s => s.date === '2026-10-02').length, 1, 'one actual proof per date')
assert.equal(all.slots[0]!.time, '10:00', 'past instants omitted from today')
assert.equal(agendaQueries, 4, 'one bulk horizon search, not one agenda read per date')
const fixed = await loadPrismaBasketAvailability(client, context, settings, [selected], '2026-10-03')
assert.ok(fixed.ok && fixed.slots.every(s => s.date === '2026-10-03'), 'fixed-date export remains compatible')
blocks = [{ professionalId: null, startAt: new Date('2026-10-02T10:00:00Z'), endAt: new Date('2026-10-03T00:00:00Z') }]
const tomorrow = await loadPrismaVerifiedDateChoices(client, context, settings, [selected])
assert.ok(tomorrow.ok && tomorrow.slots.length > 0 && tomorrow.slots.every(s => s.date === '2026-10-03'), 'no today proof when actual remaining slots blocked')
unavailable = true; const before = agendaQueries
assert.deepEqual(await loadPrismaVerifiedDateChoices(client, context, settings, [selected]), {ok:false,reason:'SERVICE_UNAVAILABLE'})
assert.equal(agendaQueries, before, 'rejected service cannot query agenda')
unavailable = false; service.requiresPhoto = true
assert.deepEqual(await loadPrismaVerifiedDateChoices(client, context, settings, [selected]), {ok:false,reason:'PHOTO_REQUIRED'})
service.requiresPhoto = false
await assert.rejects(() => loadPrismaVerifiedDateChoices(client, context, {...settings,timezone:'Invalid/Zone'}, [selected]), /timezone/)
await assert.rejects(() => loadPrismaVerifiedDateChoices(client, context, {...settings,timezone:'America/New_York'}, [selected]), /timezone/)
blocks = []; endTime = '18:00'
const after = await loadPrismaVerifiedDateChoices(client, context, settings, [selected], undefined, {}, { requestedTime: null, preference: {kind:'after',time:'13:00'} })
assert.ok(after.ok && after.slots.length === 2 && after.slots.every(s => s.time === '13:00'), 'preference filters before reducing date proofs')
const exact = await loadPrismaVerifiedDateChoices(client, context, settings, [selected], undefined, {}, { requestedTime: '15:00' })
assert.ok(exact.ok && exact.slots.length === 2 && exact.slots.every(s => s.time === '15:00'))
const huge = await loadPrismaVerifiedDateChoices(client, context, {...settings,horizonDays:90}, [selected])
assert.ok(huge.ok && huge.slots.length === 90, 'verified dates stay bounded despite thousands of real horizon slots')
const presentationQueries = agendaQueries
const scope = { businessId: 'a', serviceIds: ['s'], date: null, professionalId: null }
const input = { scope, read: { fresh: true, scope, slots: after.ok ? after.slots : [] }, timezone: 'UTC', now: context.dbNow,
  orderedDates: ['2026-10-03', '2026-10-02'] }
assert.deepEqual(presentVerifiedDates(input).choices.flatMap(choice => choice.kind === 'date' ? [choice.date] : []), input.orderedDates, 'fresh horizon proof follows customer priorities')
assert.equal(agendaQueries, presentationQueries, 'ranking cannot issue another agenda read')
console.log('conversational verified date choices: PASS')

// Each service can start early, but only later slots can join the previous segment.
const pairedRows = new Map(['cut', 'colour'].map(id => [id, { ...service, id, name: id, duration: id === 'cut' ? 30 : 60 }]))
const paired: any = {
  service: { findFirst: async (query: any) => {
    assert.equal(query.where.businessId, 'a')
    return structuredClone(pairedRows.get(query.where.id) ?? null)
  } },
  $queryRaw: async (query: any) => {
    const sql = query.strings.join(' ')
    if (sql.includes('FROM "ServiceCombinationRule"')) return []
    if (sql.includes('FROM "Professional"')) return query.values.includes('cut') && query.values.includes('colour') ? []
      : [{ id: query.values.includes('cut') ? 'cut-pro' : 'colour-pro', name: 'Staff', priority: 0 }]
    if (sql.includes('FROM "BusinessHours"')) return Array.from({length:7}, (_, dayOfWeek) => ({ ownerId:'a', dayOfWeek, startTime:'09:00', endTime:'23:00' }))
    if (sql.includes('FROM "ProfessionalHours"')) return ['cut-pro','colour-pro'].flatMap(ownerId => Array.from({length:7}, (_, dayOfWeek) => ({ownerId,dayOfWeek,startTime:'09:00',endTime:'23:00'})))
    if (sql.includes('FROM "ScheduleBlock"') || sql.includes('FROM "Appointment"')) return []
    throw Error('unexpected paired query')
  }
}
const pair = ['cut','colour'].map(id => ({...selected,id}))
const coordinatedDays = await loadPrismaVerifiedDateChoices(paired,context,settings,pair)
assert.ok(coordinatedDays.ok && coordinatedDays.slots.length === 2, 'horizon retains later second-service starts before reducing to one proof per date')
if (!coordinatedDays.ok) throw Error('coordinated days rejected')
for (const slot of coordinatedDays.slots as any[]) {
  assert.deepEqual(slot.coordination.segments.map((segment: any) => segment.serviceId), ['cut','colour'])
  assert.equal(slot.coordination.segments[0].endAt, slot.coordination.segments[1].startAt)
}
const late = await loadPrismaVerifiedDateChoices(paired,context,settings,pair,undefined,{}, {requestedTime:'20:00'})
assert.ok(late.ok && late.slots.length === 2 && late.slots.every(slot => slot.time === '20:00'), 'late exact request must be applied to anchors before the coordinator result bound')
const lateBand = await loadPrismaVerifiedDateChoices(paired,context,settings,pair,undefined,{}, {requestedTime:null,preference:{kind:'band',band:'EVENING'}})
assert.ok(lateBand.ok && lateBand.slots.length === 2 && lateBand.slots.every(slot => slot.band === 'EVENING'), 'a later segment is not restricted to the first-service time filter')
const longPair = await loadPrismaVerifiedDateChoices(paired,context,{...settings,horizonDays:90},pair)
assert.ok(longPair.ok && longPair.slots.length === 90, 'bounded full internal reads keep the verified horizon without leaking slot arrays publicly')
console.log('coordinated horizon and temporal date proofs: PASS')
for (const [staffCount,horizonDays] of [[25,2],[5,90]]) {
  const original = paired.$queryRaw
  const guarded: any = {...paired,$queryRaw:async (query: any) => {
    const sql = query.strings.join(' ')
    if (sql.includes('FROM "Professional"')) return query.values.includes('cut') && query.values.includes('colour') ? []
      : Array.from({length:staffCount!}, (_, index) => ({id:`staff-${index}`,name:'Staff',priority:index}))
    if (sql.includes('FROM "ProfessionalHours"')) return Array.from({length:staffCount!}, (_, index) =>
      Array.from({length:7}, (_, dayOfWeek) => ({ownerId:`staff-${index}`,dayOfWeek,startTime:'09:00',endTime:'23:00'}))).flat()
    return original(query)
  }}
  await assert.rejects(() => loadPrismaVerifiedDateChoices(guarded,context,{...settings,horizonDays:horizonDays!},pair), /supported bound/,
    'excessive internal agenda evidence throws instead of masquerading as no available dates')
}
console.log('coordinated internal proof bounds fail explicitly: PASS')