import assert from 'node:assert/strict'
import { PrismaAvailabilityRepository } from '../src/bot-options/infrastructure/prisma-availability.js'
import { localDateTimeToInstants } from '../src/bot-options/application/availability-queries.js'

const settings = { timezone: 'America/Argentina/Buenos_Aires', horizonDays: 2, leadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00' }
const dbNow = new Date('2026-10-01T12:00:00Z')
const professional = { id: 'pro', name: 'Professional', priority: 0 }
function fixture() {
  let businessEnd = '14:00', professionalEnd = '14:00'
  let blocks: any[] = [], busy: any[] = []
  const queries: any[] = []
  const client: any = { $queryRaw: async (query: any) => {
    queries.push(query)
    const sql = query.strings.join(' ')
    if (sql.includes('FROM "Professional"')) return [professional]
    if (sql.includes('FROM "BusinessHours"')) return [{ ownerId: 'tenant', dayOfWeek: 5, startTime: '10:00', endTime: businessEnd }]
    if (sql.includes('FROM "ProfessionalHours"')) return [{ ownerId: 'pro', dayOfWeek: 5, startTime: '10:00', endTime: professionalEnd }]
    if (sql.includes('FROM "ScheduleBlock"')) return blocks
    if (sql.includes('FROM "Appointment"')) return busy
    throw new Error('unexpected query ' + sql)
  } }
  const repo = new PrismaAvailabilityRepository(client)
  const input = { businessId: 'tenant', serviceIds: ['service'], durationMinutes: 90, dbNow, settings, professionalId: 'pro' }
  const search = (customerDurationMinutes?: number) => repo.search({ ...input, ...(customerDurationMinutes !== undefined ? { customerDurationMinutes } : {}) })
  return { queries, input, repo, search, hours: (business: string, pro: string) => { businessEnd = business; professionalEnd = pro },
    blocks: (value: any[]) => { blocks = value }, busy: (value: any[]) => { busy = value } }
}
const times = (result: Awaited<ReturnType<PrismaAvailabilityRepository['search']>>) => result.slots.map(slot => slot.time)
const instant = (time: string) => localDateTimeToInstants('2026-10-02', Number(time.slice(0, 2)) * 60 + Number(time.slice(3)), settings.timezone)[0]!
const f = fixture()
assert.deepEqual(times(await f.search()), ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30'])
assert.deepEqual(await f.search(), await f.search(90), 'omitting new parameter exactly preserves legacy results')
const queriesBefore = f.queries.length
assert.deepEqual(times(await f.search(150)), ['10:00', '10:30', '11:00', '11:30'], 'customer must fit business closure, not only professional duration')
assert.equal(f.queries.length - queriesBefore, 5, 'dual occupancy adds no database round trip')
f.hours('14:00', '12:00')
assert.deepEqual(times(await f.search(150)), ['10:00', '10:30'], 'professional can finish before customer leaves')
f.hours('14:00', '14:00')
f.blocks([{ professionalId: null, startAt: instant('12:00'), endAt: instant('13:00') }])
assert.deepEqual(times(await f.search(150)), [], 'business block checks full customer interval')
f.blocks([{ professionalId: 'pro', startAt: instant('12:00'), endAt: instant('13:00') }])
assert.deepEqual(times(await f.search(150)), ['10:00', '10:30'], 'professional block only consumes professional interval; touching end is safe')
f.blocks([{ professionalId: 'foreign', startAt: instant('10:00'), endAt: instant('14:00') }])
assert.deepEqual(times(await f.search(150)), ['10:00', '10:30', '11:00', '11:30'], 'foreign professional blocks cannot affect current professional')
f.blocks([])
f.busy([{ professionalId: 'pro', startAt: instant('12:00'), duration: 30 }])
assert.deepEqual(times(await f.search(150)), ['10:00', '10:30'], 'appointments check professional interval, not customer presence')
f.busy([])
f.input.durationMinutes = 120
assert.deepEqual(times(await f.search(180)), ['10:00', '10:30', '11:00'], 'joint professional120/customer180 respects whole business occupancy')
for (const value of [0, -1, 1.5, Number.NaN, Infinity, 1441]) await assert.rejects(() => f.search(value), /customer duration/)
assert.ok(f.queries.every(query => query.values.includes('tenant') || query.strings.join(' ').includes('FROM "ProfessionalHours"')))
const legacy = fixture()
legacy.input.settings.leadTimeHours = 26
assert.deepEqual(await legacy.search(), await legacy.search(90), 'lead-time and horizon remain identical in legacy mode')
assert.deepEqual(times(await legacy.search()), ['11:00', '11:30', '12:00', '12:30'])
console.log('dual availability business/professional windows, blocks, appointments and legacy equality: PASS')