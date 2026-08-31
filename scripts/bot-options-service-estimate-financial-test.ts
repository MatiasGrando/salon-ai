import assert from 'node:assert/strict'
import { confirmBookingWithoutDeposit, holdBookingWithDeposit } from '../src/services/booking-operations.js'
import { calculateBookingDepositTerms } from '../src/services/deposit-operations.js'
import type { Prisma } from '../src/generated/prisma/client.js'

const estimate = { optionId: 'long', optionLabel: 'Cabello largo', priceMin: 70000, priceMax: 95000 }
const service = {
  id: 's1', businessId: 'b1', name: 'Iluminación', duration: 45, price: 50000,
  priceMode: 'STARTING_AT', attentionMode: 'GUIDED_ESTIMATE', estimateAllowsBooking: true,
  estimateOptions: [{ id: 'long', label: 'Cabello largo', priceMin: 70000, priceMax: 95000 }],
  depositMode: 'NONE', depositValue: null
}
const input = {
  businessId: 'b1', sessionId: 'session', operationKey: 'op', newBookingAllowed: true,
  services: [{ serviceId: 's1', name: service.name, durationMinutes: 45, priceMinor: 70000,
    priceMode: 'STARTING_AT' as const, estimate }],
  professional: { professionalId: 'p1', name: 'Ana', assignedByBalancer: false },
  date: '2030-09-02', slotStartAt: '2030-09-02T12:00:00.000Z', totalDurationMinutes: 45, totalPriceMinor: null
}

// No database or provider is connected: exercise the production transaction with a strict fake.
function fixture(overrides: Record<string, unknown> = {}, overlap = false) {
  const canonical = { ...service, ...overrides }
  const writes: Array<{ sql: string; values: unknown[] }> = []
  const tx = {
    professional: { findFirst: async () => ({ id: 'p1', isActive: true }), findMany: async () => [{ id: 'p1' }] },
    service: { findMany: async () => [canonical] },
    professionalService: { count: async () => 1 },
    businessHours: { findMany: async () => [{ startTime: '00:00', endTime: '23:59' }] },
    professionalHours: { findMany: async () => [{ startTime: '00:00', endTime: '23:59' }] },
    scheduleBlock: { findFirst: async () => null },
    $queryRaw: async (q: Prisma.Sql) => {
      const sql = q.sql
      if (sql.includes('pg_advisory_xact_lock')) return [{ locked: 1 }]
      if (sql.includes('FROM "BotOperation" operation')) return []
      if (sql.includes('FROM "BusinessBotOptionsSettings"')) return [{ timezone: 'UTC', dbNow: new Date('2030-09-01T12:00:00Z'), localDate: input.date, insideWindow: true, onGrid: true, depositHoldMinutes: 60 }]
      if (sql.includes('FROM "Professional" p')) return [{ id: 'p1', name: 'Ana', priority: 0 }]
      if (sql.includes('AS "overlaps"')) return [{ overlaps: overlap }]
      if (sql.includes('FROM "Service" s')) {
        const permitsGuided = sql.includes("'GUIDED_ESTIMATE'")
        return [{ count: canonical.attentionMode === 'DIRECT_BOOKING' || (canonical.estimateAllowsBooking && permitsGuided && canonical.attentionMode === 'GUIDED_ESTIMATE') ? 1 : 0 }]
      }
      if (sql.includes('FROM "BusinessPaymentSettings"')) return [{ transferEnabled: true, alias: 'alias', cbu: null, cvu: null, paymentLinkEnabled: false, paymentLink: null }]
      if (sql.includes('AS "occupiedMinutes"')) return []
      if (sql.includes('AS "customerId"')) return [{ customerId: 'customer' }]
      if (sql.includes('INSERT INTO "BotOperation"')) return [{ operationKey: input.operationKey }]
      throw new Error(`Unexpected query: ${sql}`)
    },
    $executeRaw: async (q: Prisma.Sql) => { writes.push({ sql: q.sql, values: q.values }); return 1 }
  } as unknown as Prisma.TransactionClient
  return { tx, writes }
}

const chosen = fixture()
assert.equal((await confirmBookingWithoutDeposit(chosen.tx, input)).kind, 'CONFIRMED')
const appointment = chosen.writes.find((q) => q.sql.includes('INSERT INTO "Appointment"'))!
assert.ok(appointment.values.some((value) => typeof value === 'string' && value.includes('Cabello largo') && value.includes('70.000') && value.includes('95.000')), 'persist range and selected option as an estimate in appointment notes')
assert.ok(appointment.values.includes(null), 'never store a fixed quoted total for an estimate')
assert.ok(chosen.writes.find((q) => q.sql.includes('INSERT INTO "AppointmentServiceItem"'))!.values.includes(70000), 'item snapshots the selected minimum rather than base catalog price')

const base = fixture({ estimateOptions: [] })
await confirmBookingWithoutDeposit(base.tx, { ...input, services: [{ ...input.services[0]!, priceMinor: 50000,
  estimate: { optionId: null, optionLabel: null, priceMin: 50000, priceMax: null } }] })

for (const overrides of [
  { estimateOptions: [] },
  { estimateOptions: [], priceMode: 'FIXED' },
  { estimateOptions: [{ id: 'long', label: 'Cabello largo', priceMin: 75000, priceMax: 95000 }] },
  { estimateAllowsBooking: false },
  { attentionMode: 'QUOTE_REQUIRED' },
  { duration: 60 }
]) {
  const stale = fixture(overrides)
  await assert.rejects(confirmBookingWithoutDeposit(stale.tx, input), /snapshot|catalog|estimate/i)
  assert.equal(stale.writes.some((q) => q.sql.includes('INSERT INTO "Appointment"')), false)
}
await assert.rejects(confirmBookingWithoutDeposit(fixture().tx, { ...input, totalPriceMinor: 70000 }), /aggregate snapshot/)
await assert.rejects(confirmBookingWithoutDeposit(fixture().tx, { ...input, services: [{ ...input.services[0]!, estimate: undefined }] }), /estimate snapshot/)
await assert.rejects(confirmBookingWithoutDeposit(fixture().tx, { ...input, services: [{ ...input.services[0]!, estimate: { ...estimate, priceMax: 90000 } }] }), /estimate snapshot/)
assert.equal((await confirmBookingWithoutDeposit(fixture({}, true).tx, input)).kind, 'SLOT_CONFLICT')

const direct = fixture({ attentionMode: 'DIRECT_BOOKING', estimateAllowsBooking: false, estimateOptions: [], priceMode: 'FIXED' })
assert.equal((await confirmBookingWithoutDeposit(direct.tx, { ...input,
  services: [{ ...input.services[0]!, estimate: undefined, priceMinor: 50000, priceMode: 'FIXED' }], totalPriceMinor: 50000
})).kind, 'CONFIRMED', 'direct booking ignores the setting specific to estimates')
await assert.rejects(confirmBookingWithoutDeposit(fixture({ attentionMode: 'DIRECT_BOOKING' }).tx, input), /estimate no longer matches/)

const percent = fixture({ depositMode: 'PERCENTAGE', depositValue: 20 })
const held = await holdBookingWithDeposit(percent.tx, input)
assert.equal(held.kind, 'HELD')
if (held.kind === 'HELD') assert.equal(held.amount, 14000)
const depositLine = percent.writes.find((q) => q.sql.includes('INSERT INTO "BookingDepositLine"'))!
assert.ok(depositLine.values.includes(70000), 'deposit base is the selected estimated minimum')
assert.ok(depositLine.values.includes(14000))

const basePercent = fixture({ estimateOptions: [], depositMode: 'PERCENTAGE', depositValue: 20 })
const baseHeld = await holdBookingWithDeposit(basePercent.tx, { ...input, services: [{ ...input.services[0]!, priceMinor: 50000,
  estimate: { optionId: null, optionLabel: null, priceMin: 50000, priceMax: null } }] })
assert.equal(baseHeld.kind, 'HELD')
if (baseHeld.kind === 'HELD') assert.equal(baseHeld.amount, 10000)

const fixed = fixture({ depositMode: 'FIXED', depositValue: 5000 })
const fixedHeld = await holdBookingWithDeposit(fixed.tx, input)
if (fixedHeld.kind === 'HELD') assert.equal(fixedHeld.amount, 5000)
else assert.fail('fixed deposit must hold the estimate')

assert.throws(() => calculateBookingDepositTerms({ services: [{ id: 's', name: 'S', price: null, priceMode: 'STARTING_AT', depositMode: 'PERCENTAGE', depositValue: 20 }], businessDepositHoldMinutes: 30 }), /positive price/)
for (const priceMode of [null, 'UNKNOWN']) {
  assert.throws(() => calculateBookingDepositTerms({ services: [{ id: 's', name: 'S', price: 50000,
    priceMode: priceMode as 'FIXED', depositMode: 'PERCENTAGE', depositValue: 20 }], businessDepositHoldMinutes: 30 }), /positive price/)
}
console.log('service estimate financial contracts: PASS (no real DB)')
