import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { PrismaCatalogRepository } from '../src/bot-options/infrastructure/prisma-catalog.js'
import { PrismaHoursRepository } from '../src/bot-options/infrastructure/prisma-hours.js'
import { PrismaAvailabilityRepository } from '../src/bot-options/infrastructure/prisma-availability.js'
import { withAttemptMetrics, type AttemptMetricEvent } from '../src/bot-options/observability/attempt-metrics.js'

const businessId = 'private-business'
const dbNow = new Date('2026-09-28T00:00:00Z')
const settings = { timezone: 'UTC', horizonDays: 1, leadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '18:00' }
const serviceInput = { businessId, serviceIds: ['private-service'] }
const searchInput = { ...serviceInput, durationMinutes: 30, dbNow, settings }

function fixture(failure?: unknown, missing = false) {
  const calls: Array<{ method: string; input: unknown }> = []
  const query = async (method: string, input: unknown, result: unknown) => {
    calls.push({ method, input })
    if (failure) throw failure
    return result
  }
  const client = {
    serviceCategory: {
      findMany: (input: unknown) => query('categories', input, [{ id: 'category', name: 'Hair' }]),
      count: (input: unknown) => query('categoryCount', input, 1),
      findFirst: (input: unknown) => query('category', input, missing ? null : { id: 'category', name: 'Hair' })
    },
    service: {
      findMany: (input: unknown) => query('services', input, []),
      findFirst: (input: unknown) => query('service', input, missing ? null : { id: 'service', catalogCategoryId: 'category', parentServiceId: null, name: 'Cuts', description: null,
        isBookable: true, duration: 30, customerDurationMin: null, customerDurationMax: null, price: 10, priceMode: 'FIXED',
        attentionMode: 'APPOINTMENT', estimateAllowsBooking: false, estimateOptions: null })
    },
    businessHours: { findMany: (input: unknown) => query('weeklyHours', input, [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]) },
    scheduleBlock: { findMany: (input: unknown) => query('exceptions', input, [{ startAt: dbNow, endAt: new Date('2026-09-29T00:00:00Z'), reason: 'HOLIDAY', title: 'Private title', note: 'Private note' }]) },
    $queryRaw: async (input: { sql: string; values: unknown[] }) => {
      const sql = input.sql
      const result = sql.includes('BusinessBotOptionsSettings')
        ? [{ timezone: 'UTC', bookingHorizonDays: 1, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '18:00' }]
        : sql.includes('ProfessionalService') ? (missing ? [] : [{ id: 'professional', name: 'Private name', priority: 1 }])
        : sql.includes('BusinessHours') ? [{ ownerId: businessId, dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]
        : sql.includes('ProfessionalHours') ? [{ ownerId: 'professional', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }]
        : []
      return query('raw', { sql, values: input.values }, result)
    }
  }
  return {
    calls,
    catalog: new PrismaCatalogRepository(client as unknown as ConstructorParameters<typeof PrismaCatalogRepository>[0]),
    hours: new PrismaHoursRepository(client as unknown as ConstructorParameters<typeof PrismaHoursRepository>[0]),
    availability: new PrismaAvailabilityRepository(client as unknown as ConstructorParameters<typeof PrismaAvailabilityRepository>[0])
  }
}

type Fixture = ReturnType<typeof fixture>
const cases: Array<{ stage: string; run: (f: Fixture) => Promise<unknown> }> = [
  { stage: 'catalog_list_categories', run: f => f.catalog.listCategories({ businessId, page: 0 }) },
  { stage: 'catalog_get_category', run: f => f.catalog.getCategory({ businessId, categoryId: 'category' }) },
  { stage: 'catalog_list_services', run: f => f.catalog.listServices({ businessId, categoryId: 'category', page: 0 }) },
  { stage: 'catalog_get_subcategory', run: f => f.catalog.getSubcategory({ businessId, categoryId: 'category', subcategoryId: 'subcategory' }) },
  { stage: 'catalog_get_service', run: f => f.catalog.getService({ businessId, serviceId: 'private-service' }) },
  { stage: 'hours_weekly', run: f => f.hours.loadBusinessWeeklyHours({ businessId }) },
  { stage: 'hours_exceptions', run: f => f.hours.loadBusinessOperationalExceptions({ businessId, dbNow, timezone: 'UTC' }) },
  { stage: 'availability_settings', run: f => f.availability.loadSettings(businessId) },
  { stage: 'availability_compatible_professionals', run: f => f.availability.compatibleProfessionals(serviceInput) },
  { stage: 'availability_search', run: f => f.availability.search(searchInput) }
]
const events: AttemptMetricEvent[] = []
const emit = (event: AttemptMetricEvent) => events.push(event)
for (const [index, test] of cases.entries()) {
  const plain = fixture()
  const timed = fixture()
  const expected = await test.run(plain)
  events.length = 0
  const actual = await withAttemptMetrics({ jobId: 'private-job', attempt: index }, () => test.run(timed), { emit })
  assert.deepEqual(actual, expected, `${test.stage}: result preserved`)
  assert.deepEqual(timed.calls, plain.calls, `${test.stage}: query arguments and count preserved`)
  assert.deepEqual(events.map(event => event.stage), [
    ...(test.stage === 'availability_search' ? ['availability_compatible_professionals'] : []), test.stage, 'attempt'
  ], `${test.stage}: full method stage emitted exactly once`)
  assert.ok(events.every(event => event.outcome === 'ok' && event.errorCode === null && event.durationMs >= 0 && Number.isFinite(event.durationMs)))
  assert.ok(events.every(event => event.attempt === index))
  assert.doesNotMatch(JSON.stringify(events), /private-|Private|SELECT|businessId|serviceIds/)

  const failure = Object.assign(new Error('private SQL customer details'), { code: 'P2028' })
  events.length = 0
  await assert.rejects(withAttemptMetrics({ jobId: 'private-job', attempt: index }, () => test.run(fixture(failure)), { emit }), error => error === failure)
  assert.ok(events.some(event => event.stage === test.stage), `${test.stage}: failed operation measured`)
  assert.ok(events.every(event => event.outcome === 'error' && event.errorCode === 'P2028'))
  assert.doesNotMatch(JSON.stringify(events), /private|SQL|customer/)
}

// Early returns and nested search measurements retain their own spans, not additive latency.
const earlyCases: Array<{ run: (f: Fixture) => Promise<unknown>; result: unknown; stages: string[] }> = [
  { run: f => f.catalog.getCategory({ businessId, categoryId: 'uncategorized' }), result: null, stages: ['catalog_get_category'] },
  { run: f => f.catalog.listServices({ businessId, categoryId: 'category', page: 0 }), result: null, stages: ['catalog_list_services'] },
  { run: f => f.catalog.getService({ businessId, serviceId: 'missing' }), result: null, stages: ['catalog_get_service'] },
  { run: f => f.availability.compatibleProfessionals({ businessId, serviceIds: [] }), result: [], stages: ['availability_compatible_professionals'] },
  { run: f => f.availability.search(searchInput), result: { professionals: [], slots: [] }, stages: ['availability_compatible_professionals', 'availability_search'] }
]
for (const test of earlyCases) {
  events.length = 0
  assert.deepEqual(await withAttemptMetrics({ jobId: 'early', attempt: 0 }, () => test.run(fixture(undefined, true)), { emit }), test.result)
  assert.deepEqual(events.map(event => event.stage), [...test.stages, 'attempt'])
}
// Local validation failures are measured even when no database call is made.
events.length = 0
const invalidHours = fixture()
await assert.rejects(withAttemptMetrics({ jobId: 'validation', attempt: 0 }, () => invalidHours.hours.loadBusinessOperationalExceptions({ businessId, dbNow, timezone: 'invalid-timezone' }), { emit }))
assert.equal(invalidHours.calls.length, 0)
assert.deepEqual(events.map(event => [event.stage, event.outcome, event.errorCode]), [['hours_exceptions', 'error', 'UNKNOWN'], ['attempt', 'error', 'UNKNOWN']])
const available = await fixture().availability.search(searchInput)
assert.ok(available.slots.length > 0, 'full search fixture exercises slot projection, not only an early return')
assert.equal(available.slots[0]?.time, '09:00')

// A span cannot finish before the underlying asynchronous query settles.
let release!: (rows: unknown[]) => void
const gate = new Promise<unknown[]>(resolve => { release = resolve })
const waiting = new PrismaAvailabilityRepository({ $queryRaw: () => gate } as unknown as ConstructorParameters<typeof PrismaAvailabilityRepository>[0])
events.length = 0
const pending = withAttemptMetrics({ jobId: 'waiting', attempt: 0 }, () => waiting.compatibleProfessionals(serviceInput), { emit })
await Promise.resolve()
assert.equal(events.length, 0)
release([])
assert.deepEqual(await pending, [])
assert.deepEqual(events.map(event => event.stage), ['availability_compatible_professionals', 'attempt'])

const parallel: AttemptMetricEvent[] = []
await Promise.all([1, 2].map(attempt => withAttemptMetrics({ jobId: `isolated-${attempt}`, attempt }, async () => {
  await fixture().availability.search(searchInput)
  await fixture().hours.loadBusinessWeeklyHours({ businessId })
}, { emit: event => parallel.push(event) })))
for (const attempt of [1, 2]) {
  const expectedRef = createHash('sha256').update(`isolated-${attempt}`).digest('hex').slice(0, 24)
  const own = parallel.filter(event => event.attempt === attempt)
  assert.equal(own.length, 4)
  assert.ok(own.every(event => event.jobRef === expectedRef), 'concurrent contexts do not leak')
}

let logged = 0
const originalInfo = console.info
console.info = () => { logged += 1 }
try {
  for (const test of cases) await test.run(fixture())
} finally { console.info = originalInfo }
assert.equal(logged, 0, 'repository calls outside attempt context must not log')
const failOpenResult = await withAttemptMetrics({ jobId: 'sink-failure', attempt: 0 }, () => fixture().hours.loadBusinessWeeklyHours({ businessId }), {
  emit: () => { throw new Error('sink unavailable') }
})
assert.deepEqual(failOpenResult, [{ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' }])
console.log('PASS query timing: 10 real repository methods, preserved queries/results/errors, early returns, async settlement, context isolation and fail-open emission; fake DB only')
