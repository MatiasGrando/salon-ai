import assert from 'node:assert/strict'
import { runBarberDemoQueryProbe } from './bot-options-query-probe.js'

const calls: Array<{ method: string; input?: unknown }> = []
const record = async <T>(method: string, result: T, input?: unknown): Promise<T> => {
  calls.push({ method, input })
  return result
}
const client = {
  $transaction: async (operation: (tx: unknown) => Promise<unknown>, options?: unknown) => { calls.push({ method: 'transaction', input: options }); return operation({
    $executeRawUnsafe: async (sql: string) => record('sql', 0, sql),
    business: { findUnique: (input: unknown) => record('business', { id: 'private-business' }, input) },
    service: {
      findFirst: (input: unknown) => record('service', { id: 'private-service', duration: 30, catalogCategoryId: 'private-category', isBookable: true, attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: false }, input),
      findMany: (input: unknown) => record('services', [], input)
    },
    serviceCategory: {
      findMany: (input: unknown) => record('categories', [], input),
      count: (input: unknown) => record('categoryCount', 0, input),
      findFirst: (input: unknown) => record('category', { id: 'private-category' }, input)
    },
    businessHours: { findMany: (input: unknown) => record('hours', [], input) },
    scheduleBlock: { findMany: (input: unknown) => record('exceptions', [], input) },
    $queryRaw: async (query: { sql: string }) => record('raw', query.sql.includes('CURRENT_TIMESTAMP') ? [{ now: new Date('2026-09-28T00:00:00Z') }] : query.sql.includes('BusinessBotOptionsSettings')
      ? [{ timezone: 'UTC', bookingHorizonDays: 1, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '18:00' }]
      : query.sql.includes('ProfessionalService') ? [{ id: 'private-professional', name: 'Private Person', priority: 1 }] : [], query.sql)
  }) }
}
const result = await runBarberDemoQueryProbe(client as never, { samples: 2 })
assert.equal(result.sampleCount, 2)
assert.equal(result.classification, 'exploratory')
assert.equal(result.searchHorizonCapDays, 7)
assert.deepEqual(calls.find(call => call.method === 'transaction')?.input, { maxWait: 1000, timeout: 20000, isolationLevel: 'ReadCommitted' })
assert.equal(result.stages.catalog_list_categories?.count, 2)
assert.equal(result.stages.availability_search?.count, 2)
assert.equal(result.stages.availability_compatible_professionals?.count, 4)
assert.ok(result.stages.attempt?.p50Ms !== undefined)
assert.doesNotMatch(JSON.stringify(result), /private-|Private Person|WX-38N6UG|SELECT|businessId/)
assert.deepEqual(calls.filter(call => call.method === 'sql').slice(0, 3).map(call => call.input), [
  'SET TRANSACTION READ ONLY', "SET LOCAL statement_timeout = '3000ms'", "SET LOCAL lock_timeout = '1000ms'"
])
const business = calls.find(call => call.method === 'business')?.input as { where: { customerCode: string } }
assert.equal(business.where.customerCode, 'WX-38N6UG')
const service = calls.find(call => call.method === 'service')?.input as { where: { isActive: boolean; isBookable: boolean; duration: { gt: number } } }
assert.equal(service.where.isActive, true)
assert.equal(service.where.isBookable, true)
assert.equal(service.where.duration.gt, 0)
const failingClient = {
  $transaction: async (operation: (tx: unknown) => Promise<unknown>, options?: unknown) => { calls.push({ method: 'transaction', input: options }); return operation({
    $executeRawUnsafe: async () => 0,
    business: { findUnique: async () => ({ id: 'private-business' }) },
    service: { findFirst: async () => ({ id: 'private-service', duration: 30, catalogCategoryId: 'private-category', isBookable: true, attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: false }) },
    $queryRaw: async (query: { sql: string }) => {
      if (query.sql.includes('CURRENT_TIMESTAMP')) return [{ now: new Date('2026-09-28T00:00:00Z') }]
      throw Object.assign(new Error('Private customer SQL text'), { code: 'P2028' })
    }
  }) }
}
const transactionsBeforeFailure = calls.filter(call => call.method === 'transaction').length
const failure = await runBarberDemoQueryProbe(failingClient as never, { samples: 2 })
assert.equal(calls.filter(call => call.method === 'transaction').length - transactionsBeforeFailure, 1, 'Stops after the first failure')
assert.equal(failure.sampleCount, 1)
assert.equal(failure.successfulSamples, 0)
assert.equal(failure.failedSamples, 1)
assert.equal(failure.stages.availability_settings?.errors, 1)
assert.equal(failure.stages.attempt?.errors, 1)
assert.doesNotMatch(JSON.stringify(failure), /private|customer|SQL|P2028/i)
await assert.rejects(runBarberDemoQueryProbe(client as never, { samples: 6 }), /INVALID_SAMPLE_COUNT/)
assert.ok(calls.some(call => call.method === 'raw' && typeof call.input === 'string' && call.input.includes('CURRENT_TIMESTAMP')), 'Uses database clock')
console.log('bot-options query probe offline contract: PASS')