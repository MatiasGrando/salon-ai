import assert from 'node:assert/strict'
import * as evidence from '../src/bot-options/application/availability-evidence.js'
import { PrismaAvailabilityRepository } from '../src/bot-options/infrastructure/prisma-availability.js'
const businessId = 'target-tenant', date = '2026-10-03', dbNow = new Date('2026-10-03T12:00:00Z')
const settings = { timezone: 'America/Argentina/Buenos_Aires', horizonDays: 2, leadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '18:00' }
const professionals = [{ id: 'p1', name: 'One', priority: 0 }, { id: 'p2', name: 'Two', priority: 1 }]
const hour = (ownerId: string, startTime = '16:00', endTime = '18:00') => ({ ownerId, dayOfWeek: 6, startTime, endTime })
function fixture(extra: { business?: readonly object[]; pro?: readonly object[]; busy?: readonly object[]; blocks?: readonly object[] } = {}) {
  const calls: string[] = []
  const repo = new PrismaAvailabilityRepository({ $queryRaw: async <T>(q: any): Promise<T> => {
    const sql = q.strings.join(' '); calls.push(sql)
    if (sql.includes('FROM "Professional"')) return structuredClone(professionals) as T
    if (sql.includes('FROM "BusinessHours"')) return structuredClone(extra.business ?? [hour(businessId)]) as T
    if (sql.includes('FROM "ProfessionalHours"')) return structuredClone(extra.pro ?? professionals.map(p => hour(p.id))) as T
    if (sql.includes('FROM "ScheduleBlock"')) return structuredClone(extra.blocks ?? []) as T
    if (sql.includes('FROM "Appointment"')) return structuredClone(extra.busy ?? []) as T
    throw Error('unexpected offline query')
  } })
  return { repo, calls }
}
const request = { businessId, serviceIds: ['b', 'a'], date, time: '17:00', durationMinutes: 30, customerDurationMinutes: 60, dbNow, timezone: settings.timezone, professionals }
async function search(extra: Parameters<typeof fixture>[0] = {}, changes: object = {}) {
  const f = fixture(extra), eligible = await f.repo.compatibleProfessionals(request)
  const result = await f.repo.search({ ...request, settings, allocation: 'all', diagnostics: true, requestedStart: { date, time: request.time }, ...changes } as any, eligible)
  assert.equal(f.calls.length, 5, 'existing eligibility plus four grouped agenda reads')
  const target = (result.evidence as any)?.requestedStart
  assert.ok(target, 'target needs its own proof when another hour is available')
  return { result, target }
}
const occupied = professionals.map(p => ({ professionalId: p.id, startAt: new Date('2026-10-03T20:00:00Z'), duration: 30 }))
const busy = await search({ busy: occupied })
assert.ok(busy.result.slots.some(s => s.time === '16:00'))
assert.deepEqual(busy.target.professionals.map((p: any) => p.reasons), [['BUSY'], ['BUSY']])
const parse = (evidence as any).parseRequestedStartExplanation as (v: unknown, s: any) => any
assert.deepEqual(parse(busy.target, request), { date, time: '17:00', available: false, reasons: ['BUSY'] })
const one = await search({ busy: occupied.slice(0, 1) })
assert.deepEqual(parse(one.target, request).reasons, [])
assert.equal(parse(one.target, { ...request, professionalId: 'p1' }).available, false)
assert.equal(parse((await search()).target, request).available, true)
const blocked = await search({ blocks: [{ professionalId: null, startAt: new Date('2026-10-03T20:45:00Z'), endAt: new Date('2026-10-03T21:00:00Z') }] })
assert.deepEqual(parse(blocked.target, request).reasons, ['BLOCKED'], 'business blocks cover customer duration')
const proBlock = await search({ blocks: [{ professionalId: 'p1', startAt: new Date('2026-10-03T20:45:00Z'), endAt: new Date('2026-10-03T21:00:00Z') }] })
assert.equal(parse(proBlock.target, { ...request, professionalId: 'p1' }).available, true)
for (const [extra, reasons] of [
  [{ business: [hour(businessId, '16:00', '17:30')] }, ['DURATION_DOES_NOT_FIT']],
  [{ business: [hour(businessId, '10:00', '12:00')] }, ['REQUESTED_START_OUTSIDE_BUSINESS_HOURS']],
  [{ pro: professionals.map(p => hour(p.id, '10:00', '12:00')) }, ['REQUESTED_START_OUTSIDE_PROFESSIONAL_HOURS']],
  [{ pro: [] }, ['PROFESSIONAL_NOT_WORKING']], [{ business: [] }, ['BUSINESS_CLOSED']]
] as const) assert.deepEqual(parse((await search(extra)).target, request).reasons, reasons)
assert.deepEqual(parse((await search({}, { settings: { ...settings, leadTimeHours: 9 } })).target, request).reasons, ['LEAD_TIME'])
for (const scope of [
  { ...request, businessId: 'foreign' }, { ...request, serviceIds: ['foreign'] },
  { ...request, date: '2026-10-04' }, { ...request, time: '16:00' },
  { ...request, durationMinutes: 60 }, { ...request, customerDurationMinutes: 90 },
  { ...request, dbNow: new Date(dbNow.getTime() + 1) }, { ...request, timezone: 'UTC' },
  { ...request, professionals: professionals.slice(0, 1) }, { ...request, professionalId: 'foreign' }
]) assert.throws(() => parse(busy.target, scope), /requested start/)
for (const proof of [
  undefined, { ...busy.target, serviceIds: ['b', 'a'] }, { ...busy.target, extra: 'private' },
  { ...busy.target, professionals: [{ professionalId: 'foreign', available: false, reasons: ['BUSY'] }] },
  { ...busy.target, professionals: [{ professionalId: 'p1', available: true, reasons: ['BUSY'] }, busy.target.professionals[1]] },
  { ...busy.target, professionals: [{ ...busy.target.professionals[0], reasons: ['private text'] }, busy.target.professionals[1]] }
]) assert.throws(() => parse(proof, request), /requested start/)
for (const time of ['17:15', 'bad']) {
  const f = fixture(), result = await f.repo.search({ ...request, settings, diagnostics: true, requestedStart: { date, time } } as any)
  assert.equal((result.evidence as any).requestedStart, undefined)
}
const dst = fixture()
const fold = await dst.repo.search({ ...request, settings: { ...settings, timezone: 'America/New_York' }, dbNow: new Date('2026-10-31T12:00:00Z'), diagnostics: true, requestedStart: { date: '2026-11-01', time: '01:30' } } as any)
assert.equal((fold.evidence as any).requestedStart, undefined)
assert.deepEqual(Object.keys(await fixture().repo.search({ ...request, settings })).sort(), ['professionals', 'slots'])

const crossing = await search({ busy: professionals.map(p => ({ professionalId: p.id, startAt: new Date('2026-10-03T02:00:00Z'), duration: 1080 })) }, { requestedStart: { date, time: '16:00' } })
assert.equal(crossing.result.slots.some(s => s.date === date && s.time === '16:00'), false, 'actual occupancy from the previous local date still blocks a target')
assert.deepEqual(parse(crossing.target, { ...request, time: '16:00' }).reasons, ['BUSY'])
const mixed = await search({ busy: occupied.slice(0, 1), blocks: [{ professionalId: 'p2', startAt: new Date('2026-10-03T20:00:00Z'), endAt: new Date('2026-10-03T20:30:00Z') }] })
assert.deepEqual(parse(mixed.target, request).reasons, ['NO_SLOTS'], 'mixed per-professional causes must stay generic in aggregate')
const customerOnlyBusy = await search({ busy: professionals.map(p => ({ professionalId: p.id, startAt: new Date('2026-10-03T20:45:00Z'), duration: 30 })) })
assert.equal(parse(customerOnlyBusy.target, request).available, true, 'customer occupancy does not consume professional appointment time')
const professionalFits = await search({ pro: professionals.map(p => hour(p.id, '16:00', '17:30')) })
assert.equal(parse(professionalFits.target, request).available, true, 'longer customer occupancy need not fit a professional window')
const professionalShort = await search({ pro: professionals.map(p => hour(p.id, '16:00', '17:00')) }, { requestedStart: { date, time: '16:30' }, durationMinutes: 60 })
assert.deepEqual(parse(professionalShort.target, { ...request, time: '16:30', durationMinutes: 60 }).reasons, ['DURATION_DOES_NOT_FIT'])

const sparse = { ...busy.target, professionals: Array(2) }
assert.throws(() => parse(sparse, request), /requested start/, 'sparse proof cannot masquerade as complete professional membership')
let getterCalls = 0
const getterRows: any[] = []
Object.defineProperty(getterRows, '0', { get: () => { getterCalls++; return busy.target.professionals[0] }, enumerable: true })
getterRows[1] = busy.target.professionals[1]
assert.throws(() => parse({ ...busy.target, professionals: getterRows }, request), /requested start/)
assert.equal(getterCalls, 0, 'untrusted proof arrays must not execute getters')
assert.deepEqual(parse(JSON.parse(JSON.stringify(busy.target)), request), parse(busy.target, request))

console.log('requested start evidence: exact proof, durations, foreign scope, conservative gaps and grouped budget PASS')
