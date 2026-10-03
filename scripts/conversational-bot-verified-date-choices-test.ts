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
console.log('conversational verified date choices: PASS')
