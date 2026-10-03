import assert from 'node:assert/strict'
import { explanationForDate, parseAvailabilityExplanation } from '../src/bot-options/application/availability-evidence.js'
import { PrismaAvailabilityRepository } from '../src/bot-options/infrastructure/prisma-availability.js'
import type { AvailabilitySettings } from '../src/bot-options/application/availability-queries.js'
const businessId = 'private-evidence-tenant'
const now = new Date('2026-10-03T12:00:00Z')
const settings: AvailabilitySettings = { timezone: 'America/Argentina/Buenos_Aires', horizonDays: 3, leadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '18:00' }
const professionals = [{ id: 'p1', name: 'One', priority: 1 }, { id: 'p2', name: 'Two', priority: 0 }]
type Row = { ownerId: string; dayOfWeek: number; startTime: string; endTime: string }
const hours = (ownerId: string, dayOfWeek = 6, startTime = '10:00', endTime = '11:00'): Row => ({ ownerId, dayOfWeek, startTime, endTime })
function fixture(input: { business?: Row[]; pro?: Row[]; busy?: object[]; blocks?: object[] } = {}) {
  const calls: string[] = []
  const client = { $queryRaw: async <T>(query: any): Promise<T> => {
    const sql = query.strings.join(' '); calls.push(sql)
    if (sql.includes('FROM "Professional"')) { assert.ok(query.values.includes(businessId)); return structuredClone(professionals) as T }
    if (sql.includes('FROM "BusinessHours"')) { assert.ok(query.values.includes(businessId)); return structuredClone(input.business ?? [hours(businessId)]) as T }
    if (sql.includes('FROM "ProfessionalHours"')) { assert.ok(query.values.includes('p1') && query.values.includes('p2')); return structuredClone(input.pro ?? professionals.map(p => hours(p.id))) as T }
    if (sql.includes('FROM "ScheduleBlock"')) { assert.ok(query.values.includes(businessId)); return structuredClone(input.blocks ?? []) as T }
    if (sql.includes('FROM "Appointment"')) { assert.ok(query.values.includes(businessId)); return structuredClone(input.busy ?? []) as T }
    throw new Error('unexpected offline query')
  } }
  return { repo: new PrismaAvailabilityRepository(client), calls }
}
const request = { businessId, serviceIds: ['service'], durationMinutes: 30, settings, dbNow: now }
async function explain(input: Parameters<typeof fixture>[0], durationMinutes = 30) {
  const f = fixture(input)
  const result = await f.repo.search({ ...request, durationMinutes, allocation: 'all', diagnostics: true } as any) as any
  assert.equal(f.calls.length, 5, 'one compatibility read and the four existing agenda reads, no parallel filter queries')
  assert.ok(result.evidence, 'existing availability calculation must explain its result')
  return result
}
const available = await explain({})
assert.equal(available.slots.filter((slot: any) => slot.date === '2026-10-03').length, 4)
assert.deepEqual(available.evidence.days.find((day: any) => day.date === '2026-10-03').reasons, [])
assert.deepEqual(available.evidence.days.find((day: any) => day.date === '2026-10-04').reasons, ['BUSINESS_CLOSED'])
const noProfessional = await explain({ pro: [] })
assert.deepEqual(noProfessional.evidence.days[0].reasons, ['PROFESSIONAL_NOT_WORKING'])
const short = await explain({}, 90)
assert.deepEqual(short.evidence.days[0].reasons, ['DURATION_DOES_NOT_FIT'])
const busy = await explain({ busy: professionals.map(p => ({ professionalId: p.id, startAt: new Date('2026-10-03T13:00:00Z'), duration: 60 })) })
assert.deepEqual(busy.evidence.days[0].reasons, ['BUSY'])
const blocked = await explain({ blocks: [{ professionalId: null, startAt: new Date('2026-10-03T13:00:00Z'), endAt: new Date('2026-10-03T14:00:00Z') }] })
assert.deepEqual(blocked.evidence.days[0].reasons, ['BLOCKED'])
const noOverlap = await explain({ pro: professionals.map(p => hours(p.id, 6, '12:00', '13:00')) })
assert.deepEqual(noOverlap.evidence.days[0].reasons, ['NO_COMPATIBLE_WINDOW'])
const lead = fixture()
const early = await lead.repo.search({ ...request, settings: { ...settings, leadTimeHours: 3 }, diagnostics: true })
assert.deepEqual(early.evidence!.days[0]!.reasons, ['LEAD_TIME'])
const forged = fixture()
await assert.rejects(() => forged.repo.search({ ...request, diagnostics: true }, professionals), /verified|eligibility/, 'callers cannot supply unverified professional arrays')
const scoped = fixture()
const eligible = await scoped.repo.compatibleProfessionals(request)
await assert.rejects(() => scoped.repo.search({ ...request, businessId: 'foreign' }, eligible), /scope|verified/, 'fresh eligibility cannot cross tenant scope')
await assert.rejects(() => scoped.repo.search({ ...request, serviceIds: ['other'] }, eligible), /scope|verified/, 'fresh eligibility cannot cross service scope')
const partly = await explain({ pro: [hours('p2'), hours('p1', 1), hours('p2', 1)], business: [hours(businessId), hours(businessId, 1)] })
const unavailablePreference = explanationForDate(partly.evidence, '2026-10-03', 'p1', partly.slots)
assert.deepEqual(unavailablePreference.reasons, ['PROFESSIONAL_NOT_WORKING'])
assert.ok(unavailablePreference.otherProfessionals.every(slot => slot.professionalId === 'p2' && slot.date === '2026-10-03'))
assert.equal(unavailablePreference.nextDates.length, 1)
assert.equal(unavailablePreference.nextDates[0]!.date, '2026-10-05')
assert.equal(unavailablePreference.nextDates[0]!.professionalId, 'p1', 'alternative date keeps a specific preference')
const untouched = fixture()
const proof = await untouched.repo.compatibleProfessionals(request)
proof.push({ id: 'foreign', name: 'Foreign', priority: 0 })
await assert.rejects(() => untouched.repo.search(request, proof), /verified/, 'mutating a minted list invalidates its proof')
const scope = { date: '2026-10-03', professionalId: 'p1', professionals, dbNow: now, timezone: settings.timezone }
assert.deepEqual(parseAvailabilityExplanation(unavailablePreference, scope), unavailablePreference)
for (const invalid of [
  { ...unavailablePreference, date: '2026-10-04' }, { ...unavailablePreference, reasons: ['private-text'] },
  { ...unavailablePreference, otherProfessionals: [...unavailablePreference.otherProfessionals, ...unavailablePreference.otherProfessionals] },
  { ...unavailablePreference, otherProfessionals: [{ ...unavailablePreference.otherProfessionals[0], professionalId: 'foreign' }] },
  { ...unavailablePreference, nextDates: [{ ...unavailablePreference.nextDates[0], professionalId: 'p2' }] },
  { ...unavailablePreference, extra: 'private' }
]) assert.throws(() => parseAvailabilityExplanation(invalid, scope), /explanation/)
const legacy = fixture()
const legacyResult = await legacy.repo.search(request)
assert.deepEqual(Object.keys(legacyResult).sort(), ['professionals', 'slots'], 'legacy Booking V2 result shape is unchanged')
assert.equal(legacyResult.slots.length, 2, 'legacy allocation stays balanced, not all professionals at each hour')
assert.ok(legacyResult.slots.every(slot => slot.professionalId === 'p2'))
console.log('availability evidence: scoped fresh causes, legacy allocation and exact query budget PASS')