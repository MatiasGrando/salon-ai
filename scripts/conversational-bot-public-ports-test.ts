import assert from 'node:assert/strict'
import { createPrismaDialoguePort } from '../src/conversational-bot/prisma-dialogue-port.js'
const timezone = 'UTC'
let revision = 1, stampFailure = false, staffReads = 0, hoursReads = 0, exceptionReads = 0, agendaReads = 0
let identityReads = 0
let name = 'Ana'
const client: any = {
  business: { findFirst: async () => ({ id: 'a', name: 'Business' }) },
  businessFeatureSettings: { findUnique: async () => {identityReads++; return {businessId:'a',assistantPersonality:{name:'Configured'}}} },
  professional: { findMany: async () => { staffReads++; return [{ id: 'p', businessId: 'a', name, description: 'Descripción real', acceptsBotBookings: false, serviceLinks: [{ service: { id: 's', businessId: 'a', name: 'Service', description: null } }] }] } },
  professionalHours: { findMany: async () => { hoursReads++; return [{ professionalId: 'p', dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }] } },
  scheduleBlock: { findMany: async () => { exceptionReads++; return [] } },
  $executeRaw: async () => 0,
  $queryRaw: async (q: any) => {
    const sql = q.strings.join(' ')
    if (sql.includes('conversational-public-source-stamp')) {
      if (stampFailure) throw new Error('stamp unavailable')
      return [{ businessId: 'a', timezone, stamp: revision.toString(16).padStart(64, '0') }]
    }
    if (sql.includes('FROM "BusinessBotOptionsSettings"')) return [{ timezone, bookingHorizonDays: 30, bookingLeadTimeHours: 0, morningCutTime: '12:00', eveningCutTime: '19:00', now: new Date('2026-10-02T12:00:00Z') }]
    if (sql.includes('Appointment')) agendaReads++
    throw new Error('unexpected public query')
  },
  $transaction: async (body: any, options: any) => { assert.equal(options.isolationLevel, 'RepeatableRead'); return body(client) }
}
const target: any = { kind: 'professional', actions: [], mention: null, serviceIds: [], date: null, weekday: null, aspect: 'overview' }
const first = await createPrismaDialoguePort(client, 'a')
assert.equal(typeof first.port.professionalInformation, 'function')
assert.equal(typeof first.port.identity,'function')
assert.equal(typeof first.port.verifiedDateChoices,'function')
assert.equal(identityReads,0,'identity is not loaded for each context/query')
assert.equal((await first.port.identity!()).assistantName,'Configured')
assert.equal(identityReads,1)
const facts = await first.port.professionalInformation!(target)
assert.equal(facts.professionals[0]!.name, 'Ana')
assert.deepEqual([staffReads, hoursReads, exceptionReads], [1,1,1])
;(facts.professionals[0] as any).name = 'CORRUPT'
const second = await createPrismaDialoguePort(client, 'a')
assert.equal((await second.port.professionalInformation!(target)).professionals[0]!.name, 'Ana')
assert.deepEqual([staffReads, hoursReads, exceptionReads], [1,1,1], 'cached verified raw data can answer another target without refetch')
revision++; name = 'Updated'
assert.equal((await second.port.professionalInformation!(target)).professionals[0]!.name, 'Updated')
assert.deepEqual([staffReads, hoursReads, exceptionReads], [2,2,2], 'metadata verifies changes inside same turn')
stampFailure = true; name = 'Fresh bypass'
assert.equal((await second.port.professionalInformation!(target)).professionals[0]!.name, 'Fresh bypass')
assert.deepEqual([staffReads, hoursReads, exceptionReads], [3,3,3], 'unavailable stamp bypass never serves stale public staff')
assert.equal(agendaReads, 0, 'habitual work schedule never reads appointments')
console.log('conversational public ports: PASS')
