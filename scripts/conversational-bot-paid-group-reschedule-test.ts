import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { routeActions } from '../src/conversational-bot/actions.js'
import { initialDialogueState, respond, type DialoguePort, type DialogueState } from '../src/conversational-bot/engine.js'
import { runtimeBookingFingerprint, type RuntimeBookingTerms } from '../src/conversational-bot/prisma-conversational-booking.js'
import { confirmGroupReschedule, managementRescheduleOfferKey, parseAppointmentManagement, presentGroupReschedule, type CancellationSnapshot } from '../src/conversational-bot/appointment-management.js'
import { loadCancellationGroupSnapshot, prepareGroupRescheduleOffers, rescheduleGroupInTransaction } from '../src/conversational-bot/prisma-appointment-management.js'

// Only a trusted, owned confirmed aggregate may be moved. None of these fixtures
// use the application's database or WhatsApp transport.
const scope = { businessId: 'business', customerId: 'customer', sessionId: 'session', normalizedPhone: '5491112345678' }
const failures: string[] = []
async function check(name: string, run: () => void | Promise<void>) {
  try { await run(); console.log('PASS ' + name) }
  catch (error) { failures.push(name); console.error('FAIL ' + name + ': ' + String(error)) }
}

await check('natural confirmed-booking request is reprogramming, not a draft edit', () => {
  for (const message of ['Tenía un turno el martes, quería reprogramarlo', 'Tengo un turno y quiero cambiarlo de fecha']) {
    assert.equal(routeActions(message).pendingAction, 'RESCHEDULE', message)
  }
})

const oldDate = '2030-10-08T15:00:00.000Z'
const nextDate = '2030-10-09T15:00:00.000Z'
const sample: CancellationSnapshot = { scope, groupId: 'joint-group', dbNow: '2030-10-01T12:00:00.000Z', members: [
  { appointmentId: 'a', version: 3, status: 'CONFIRMED', visitId: 'v-a', visitVersion: 2, visitStatus: 'CONFIRMED', professionalId: 'p-a', serviceIds: ['illumination'], startAt: oldDate, durationMinutes: 120, quotedPrice: null, depositId: 'deposit', depositStatus: 'APPROVED', manualDepositPaid: false, manualDepositAmount: null },
  { appointmentId: 'b', version: 3, status: 'CONFIRMED', visitId: 'v-b', visitVersion: 2, visitStatus: 'CONFIRMED', professionalId: 'p-b', serviceIds: ['cut'], startAt: '2030-10-08T17:00:00.000Z', durationMinutes: 30, quotedPrice: 15000, depositId: null, depositStatus: null, manualDepositPaid: false, manualDepositAmount: null }
] }
const moves = [
  { appointmentId: 'a', newStartAt: nextDate },
  { appointmentId: 'b', newStartAt: '2030-10-09T17:00:00.000Z' }
]
await check('paid proposal requires fresh explicit consent; old booking and deposit remain immutable', () => {
  const before = structuredClone(sample)
  const proposal = presentGroupReschedule(sample, moves)
  assert.throws(() => confirmGroupReschedule(proposal, { nonce: 'old-booking-consent', fingerprint: proposal.fingerprint }), /consent/)
  const confirmed = confirmGroupReschedule(proposal, { nonce: proposal.nonce, fingerprint: proposal.fingerprint })
  assert.equal(confirmed.kind, 'RESCHEDULE_APPOINTMENT_GROUP')
  assert.deepEqual(sample, before)
  assert.equal(confirmed.snapshot.members[0]!.depositStatus, 'APPROVED')
  assert.equal(confirmed.snapshot.members[0]!.quotedPrice, null, 'estimated price is not silently converted to fixed')
  assert.deepEqual(confirmed.moves, moves, 'date/time-only request preserves both original professional assignments')
  assert.deepEqual(confirmed.snapshot.members.map(member => member.professionalId), ['p-a', 'p-b'])
})
await check('explicit professional switch is signed in the paid group offer, never inferred for other members', () => {
  const withProfessional = [{ ...moves[0]!, newProfessionalId: 'p-c' }, moves[1]!]
  const proposal = presentGroupReschedule(sample, withProfessional)
  assert.throws(() => confirmGroupReschedule({ ...proposal, moves: [{ ...withProfessional[0]!, newProfessionalId: 'p-b' }, moves[1]!] },
    { nonce: proposal.nonce, fingerprint: proposal.fingerprint }), /fingerprint|consent/)
  const date = '2030-10-09'
  const offer = { key: managementRescheduleOfferKey(sample, date, withProfessional), date, moves: withProfessional }
  const parsed = parseAppointmentManagement({ version: 1, action: 'RESCHEDULE', snapshot: sample, offers: [offer], proposal }, scope.businessId, scope.sessionId)
  assert.equal(parsed.proposal?.kind, 'GROUP_RESCHEDULE_PROPOSAL')
  assert.equal(parsed.proposal.moves[0]?.newProfessionalId, 'p-c')
  assert.equal(parsed.proposal.moves[1]?.newProfessionalId, undefined)
})
await check('fresh availability proves an explicitly changed professional for one service only', async () => {
  const seen: string[] = []
  const reader = async (member: CancellationSnapshot['members'][number], date: string, professionalId: string) => {
    seen.push(member.appointmentId + ':' + professionalId)
    return [{ date, professionalId, serviceIds: member.serviceIds, durationMinutes: member.durationMinutes,
      customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes,
      startAt: date + member.startAt.slice(10) }]
  }
  const offers = await prepareGroupRescheduleOffers(sample, '2030-10-09', reader, { appointmentId: 'a', professionalId: 'p-c' })
  assert.deepEqual(seen, ['a:p-c', 'b:p-b'])
  assert.equal(offers.length, 1)
  assert.deepEqual(offers[0]!.moves, [{ ...moves[0]!, newProfessionalId: 'p-c' }, moves[1]!])
  const plain = await prepareGroupRescheduleOffers(sample, '2030-10-09', reader)
  assert.deepEqual(plain[0]!.moves, moves)
  const bad = await prepareGroupRescheduleOffers(sample, '2030-10-09', async (member, date, professionalId) =>
    member.appointmentId === 'a' ? [{ date, professionalId: 'p-a', serviceIds: member.serviceIds, durationMinutes: member.durationMinutes,
      customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes, startAt: date + member.startAt.slice(10) }] : [],
  { appointmentId: 'a', professionalId: 'p-c' }).then(() => null, error => error)
  assert.match(String(bad), /availability proof mismatch/)
})

await check('confirmed conversation asks only missing date and binds professional to requested service', async () => {
  const terms: RuntimeBookingTerms = { version: 1, businessId: 'business', timezone: 'UTC', date: '2030-10-08', customerName: 'Ana',
    preference: { kind: 'any' }, totalPriceMinor: null, segments: [
      { serviceId: 'illumination', serviceName: 'Iluminacion', professionalId: 'p-a', professionalName: 'Tamara',
        startAt: oldDate, endAt: '2030-10-08T17:00:00.000Z', durationMinutes: 120, customerDurationMinutes: 120,
        priceMinor: null, priceMode: 'STARTING_AT', configurationHash: null },
      { serviceId: 'cut', serviceName: 'Corte Hombre', professionalId: 'p-b', professionalName: 'Juan',
        startAt: '2030-10-08T17:00:00.000Z', endAt: '2030-10-08T17:30:00.000Z', durationMinutes: 30, customerDurationMinutes: 30,
        priceMinor: 15000, priceMode: 'FIXED', configurationHash: null }
    ] }
  const presented = { scope: { businessId: 'business', sessionId: 'session', deploymentId: 'deployment', generation: 1,
    revision: '1', configurationId: 'config', dispatchFenceEpoch: 1, handoffFenceEpoch: 0 }, version: 1 as const,
    nonce: '11111111-1111-4111-8111-111111111111', fingerprint: runtimeBookingFingerprint(terms), conditionsPresented: true as const, terms }
  const state: DialogueState = { ...initialDialogueState('business'), completedBooking: { presented,
    receipt: { kind: 'COMMITTED', coordinationGroupId: 'joint-group', proposalNonce: presented.nonce,
      fingerprint: presented.fingerprint, appointments: [
        { segmentIndex: 0, appointmentId: 'a', visitId: 'v-a' }, { segmentIndex: 1, appointmentId: 'b', visitId: 'v-b' }
      ] } } }
  const unpaid = { ...sample, members: sample.members.map(member => ({ ...member, depositId: null, depositStatus: null })) }
  const context = { businessId: 'business', timezone: 'UTC', dbNow: new Date(sample.dbNow), serverManagementSnapshot: unpaid,
    serverRuntimeBookingScope: { ...presented.scope, revision: '3' } }
  const port: DialoguePort = { catalog: async () => [], availability: async () => ({ professionals: [], slots: [] }),
    professionalInformation: async () => ({ businessId: 'business', complete: true, professionals: [
      { id: 'p-a', name: 'Tamara', services: [], schedule: null }, { id: 'p-b', name: 'Juan', services: [], schedule: null },
      { id: 'p-c', name: 'Gaspar', services: [], schedule: null }
    ] }),
    managementRescheduleOffers: (group, date, professionalChange) => prepareGroupRescheduleOffers(group, date,
      async (member, d, professionalId) => [{ date: d, professionalId, serviceIds: member.serviceIds,
        durationMinutes: member.durationMinutes, customerDurationMinutes: member.customerDurationMinutes ?? member.durationMinutes,
        startAt: d + member.startAt.slice(10) }], professionalChange)
  }
  const opened = await respond(context, state, 'Tenía un turno el martes, quería reprogramarlo', port)
  assert.equal(opened.state.appointmentManagement?.context.action, 'RESCHEDULE')
  assert.match(opened.reply, /horario|fecha/i, 'ask only the next missing value, not the service again')
  assert.equal(opened.managementCommand, undefined)
  const message = 'Quiero Corte Hombre con Gaspar'
  const changed = await respond({ ...context, serverRuntimeBookingScope: { ...presented.scope, revision: '4' } }, opened.state, message, port,
    { serviceId: null, candidateIds: [], correction: false, professionalMention: 'Gaspar',
      turnPlan: { version: 1, operations: [{ kind: 'professional', mode: 'specific', mention: 'Gaspar', evidence: message, confidence: 1 }] } })
  assert.deepEqual(changed.state.appointmentManagement?.professionalChange,
    { appointmentId: 'b', professionalId: 'p-c', professionalName: 'Gaspar' })
  assert.equal(changed.managementCommand, undefined)
  assert.deepEqual(changed.state.appointmentManagement?.context.snapshot.members.map(member => member.professionalId), ['p-a', 'p-b'])
})

const db = new PGlite()
let connection: Pick<PGlite, 'query'> = db
const tx = {
  async $queryRaw<T>(query: Prisma.Sql): Promise<T> {
    if (query.text.includes('pg_advisory_xact_lock')) return [{ locked: 1 }] as T
    return (await connection.query(query.text, query.values)).rows as T
  },
  async $executeRaw(query: Prisma.Sql) { return (await connection.query(query.text, query.values)).affectedRows ?? 0 },
  professional: { async findMany(input: { where: { businessId: string; id: { in: string[] } } }) {
    return (await connection.query('SELECT id FROM "Professional" WHERE "businessId"=$1 AND id=ANY($2)', [input.where.businessId, input.where.id.in])).rows
  } }
}
const inTx = <T>(work: () => Promise<T>) => db.transaction(async pg => {
  connection = pg
  try { return await work() } finally { connection = db }
})
try {
  await db.exec(`
    CREATE TABLE "Professional" (id text PRIMARY KEY,"businessId" text);
    CREATE TABLE "Service" (id text PRIMARY KEY,"businessId" text,duration int,"customerDurationMin" int,"customerDurationMax" int);
    CREATE TABLE "Customer" (id text PRIMARY KEY,"businessId" text,"normalizedPhone" text);
    CREATE TABLE "Conversation" (id text PRIMARY KEY,"businessId" text,phone text);
    CREATE TABLE "BotSession" (id text PRIMARY KEY,"businessId" text,"conversationId" text,status text NOT NULL);
    CREATE TABLE "Appointment" (id text PRIMARY KEY,"businessId" text,"customerId" text,"professionalId" text,"serviceId" text,"coordinationGroupId" text,
      version int,status text,"visitId" text,"startAt" timestamptz,"totalDurationMinutes" int,"quotedPrice" int,"manualDepositPaid" boolean,"manualDepositAmount" int);
    CREATE TABLE "BookingVisit" (id text PRIMARY KEY,"businessId" text,"customerId" text,"professionalId" text,version int,status text,"scheduledStartAt" timestamptz);
    CREATE TABLE "BookingDeposit" (id text PRIMARY KEY,"businessId" text,"appointmentId" text,"visitId" text,status text);
    CREATE TABLE "AppointmentServiceItem" ("appointmentId" text,"serviceId" text,"sortOrder" int);
    CREATE TABLE "BotOperation" (id text PRIMARY KEY,"operationKey" text UNIQUE,type text,"businessId" text,"sessionId" text,status text,"requestHash" text,"resultRef" text,"updatedAt" timestamptz);
    CREATE TABLE "AppointmentChangeHistory" (id text PRIMARY KEY,"appointmentId" text,"operationKey" text UNIQUE,actor text,"fromStartAt" timestamptz,"toStartAt" timestamptz,"bookingDepositId" text,"depositPreserved" boolean);
    INSERT INTO "Professional" VALUES ('p-a','business'),('p-b','business');
    INSERT INTO "Service" (id,"businessId",duration) VALUES ('illumination','business',120),('cut','business',30);
    INSERT INTO "Customer" VALUES ('customer','business','5491112345678');
    INSERT INTO "Conversation" VALUES ('conversation','business','+54 9 11 1234 5678');
    INSERT INTO "BotSession" VALUES ('session','business','conversation','ACTIVE');
    INSERT INTO "Appointment" VALUES
      ('a','business','customer','p-a','illumination','joint-group',3,'CONFIRMED','v-a',now()+interval '3 days',120,NULL,false,NULL),
      ('b','business','customer','p-b','cut','joint-group',3,'CONFIRMED','v-b',now()+interval '3 days 2 hours',30,15000,false,NULL);
    INSERT INTO "BookingVisit" VALUES
      ('v-a','business','customer','p-a',2,'CONFIRMED',(SELECT "startAt" FROM "Appointment" WHERE id='a')),
      ('v-b','business','customer','p-b',2,'CONFIRMED',(SELECT "startAt" FROM "Appointment" WHERE id='b'));
    INSERT INTO "AppointmentServiceItem" VALUES ('a','illumination',0),('b','cut',0);
    INSERT INTO "BookingDeposit" VALUES ('deposit','business','a','v-a','APPROVED');
  `)
  const snapshot = () => loadCancellationGroupSnapshot(tx as never, scope, 'a')
  const current = await snapshot()
  await check('paid group ownership rejects an inactive caller before reading booking terms', async () => {
    await db.exec(`UPDATE "BotSession" SET status='CLOSED' WHERE id='session'`)
    try { await assert.rejects(snapshot(), /management ownership unavailable/) }
    finally { await db.exec(`UPDATE "BotSession" SET status='ACTIVE' WHERE id='session'`) }
    assert.deepEqual((await snapshot()).members, current.members)
  })
  const requested = current.members.map(member => ({ appointmentId: member.appointmentId, newStartAt: new Date(Date.parse(member.startAt) + 86400000).toISOString() }))
  const proposed = presentGroupReschedule(current, requested)
  const command = confirmGroupReschedule(proposed, { nonce: proposed.nonce, fingerprint: proposed.fingerprint })
  await check('unsealed paid aggregate is rejected before any child or payment mutation', async () => {
    let childCalls = 0
    await assert.rejects(inTx(() => rescheduleGroupInTransaction(tx as never, command, async () => {
      childCalls++
      throw new Error('child must never accept an unsealed payment aggregate')
    })), /coordinated deposit group scope, terms or membership mismatch/)
    assert.equal(childCalls, 0)
    assert.deepEqual((await snapshot()).members, current.members)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "BotOperation"')).rows[0]!.n, 0)
    assert.equal((await db.query('SELECT status FROM "BookingDeposit" WHERE id=$1', ['deposit'])).rows[0]!.status, 'APPROVED')
  })
  await check('stale consent cannot bypass missing financial authority', async () => {
    await db.exec(`UPDATE "Appointment" SET version=version+1 WHERE id='b'`)
    await assert.rejects(inTx(() => rescheduleGroupInTransaction(tx as never, command)), /coordinated deposit group scope, terms or membership mismatch/)
    assert.equal((await db.query('SELECT status FROM "BookingDeposit" WHERE id=$1', ['deposit'])).rows[0]!.status, 'APPROVED')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM "AppointmentChangeHistory"')).rows[0]!.n, 0)
  })
  // Positive SQL behavior, second-member rollback, payment/Cash immutability,
  // replay and professional-only amendments use the real sealed F8 aggregate in
  // conversational-bot-coordinated-deposit-pglite-test.ts. A status string alone
  // is deliberately insufficient authority to move an approved payment.
} finally { await db.close() }

if (failures.length) { console.error(`${failures.length} paid group reschedule regression(s) failed`); process.exitCode = 1 }
else console.log('paid group reschedule regression: PASS')
