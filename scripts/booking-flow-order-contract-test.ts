import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeBookingFlowOrder } from '../src/services/booking-v2-domain.js'
import { nextMissingField, type BookingDraft } from '../src/services/booking-v2-state.js'

const baseDraft: BookingDraft = {
  name: 'Mati',
  service: 'corte',
  professional: null,
  date: null,
  time: null
}

assert.equal(normalizeBookingFlowOrder(undefined), 'PROFESSIONAL_FIRST')
assert.equal(normalizeBookingFlowOrder('DATE_TIME_FIRST'), 'DATE_TIME_FIRST')
assert.equal(normalizeBookingFlowOrder('INVALID'), 'PROFESSIONAL_FIRST')
assert.equal(nextMissingField(baseDraft, 'PROFESSIONAL_FIRST'), 'professional')
assert.equal(nextMissingField(baseDraft, 'DATE_TIME_FIRST'), 'date')
assert.equal(nextMissingField({ ...baseDraft, date: '2026-08-06' }, 'DATE_TIME_FIRST'), 'time')
assert.equal(nextMissingField({
  ...baseDraft,
  date: '2026-08-06',
  time: '15:00'
}, 'DATE_TIME_FIRST'), 'professional')

const schema = readFileSync('prisma/schema.prisma', 'utf8')
const crmRoute = readFileSync('src/routes/crm.ts', 'utf8')
const crmUi = readFileSync('src/routes/crm-ui.ts', 'utf8')
const migration = readFileSync(
  'prisma/migrations/20260805023000_add_booking_flow_order/migration.sql',
  'utf8'
)

assert.match(schema, /bookingFlowOrder\s+BookingFlowOrder\s+@default\(PROFESSIONAL_FIRST\)/)
assert.match(crmRoute, /bookingFlowOrder/)
assert.match(crmRoute, /DATE_TIME_FIRST/)
assert.match(crmUi, /id="booking-flow-order"/)
assert.match(crmUi, /Servicio &rarr; profesional &rarr; d&iacute;a y hora/)
assert.match(crmUi, /Servicio &rarr; d&iacute;a y hora &rarr; profesional/)
assert.match(migration, /DEFAULT 'PROFESSIONAL_FIRST'/)

console.log('booking-flow-order-contract-test: OK')
