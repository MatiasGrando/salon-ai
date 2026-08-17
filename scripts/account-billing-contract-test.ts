import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { nextAccountBillingDate, parseBillingMonth } from '../src/services/account-billing-service.js'

const nextDayOne = nextAccountBillingDate(new Date('2026-08-17T12:00:00.000Z'), 1)
assert.equal(nextDayOne.toISOString(), '2026-09-01T00:00:00.000Z')

const nextDayFifteen = nextAccountBillingDate(new Date('2026-08-15T00:00:00.000Z'), 15)
assert.equal(nextDayFifteen.toISOString(), '2026-09-15T00:00:00.000Z')

const month = parseBillingMonth('2026-08')
assert.equal(month.value, '2026-08')
assert.equal(month.start.toISOString(), '2026-08-01T00:00:00.000Z')
assert.equal(month.end.toISOString(), '2026-09-01T00:00:00.000Z')

const service = readFileSync('src/services/account-billing-service.ts', 'utf8')
assert.match(service, /accountStatus: 'ACTIVE'/)
assert.match(service, /Math\.min\(grossAmount/)
assert.match(service, /businessId_period/)

console.log('Account billing contract tests passed')
