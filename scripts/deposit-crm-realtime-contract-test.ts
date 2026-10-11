import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { writeValidatedDepositProofInTransaction } from '../src/services/deposit-proof-writer.js'
import { dispatchAppointmentDatabaseNotification } from '../src/services/appointment-realtime-listener.js'
import { subscribeToCrmRealtimeEvents, type CrmRealtimeEvent } from '../src/services/crm-realtime-events.js'

// No operative database. Only the production NOTIFY SQL crosses this fixture
// boundary into real PostgreSQL; normal writer guards use fenced responses.
const db = new PGlite()
await db.exec(`CREATE TABLE "BookingDeposit" (id text,"businessId" text,"appointmentId" text,"conversationId" text); INSERT INTO "BookingDeposit" VALUES ('deposit-a','tenant-a','appointment-a','conversation-a')`)
const events: string[] = []
const stop = await db.listen('appointment_changed', payload => events.push(payload))
const now = new Date('2030-01-01T12:00:00Z')
const evidence = {
  sourceData: Buffer.from('offline'), sourceMimeType: 'image/png' as const, sourceFilename: 'offline.png', sourceByteSize: 7,
  sourceSha256: 'a'.repeat(64), derivedData: Buffer.from('offline'), derivedMimeType: 'image/webp' as const,
  derivedByteSize: 7, derivedSha256: 'b'.repeat(64), validatorVersion: 'f8-image-v1' as const
}
const input = { businessId: 'tenant-a', depositId: 'deposit-a', operationKey: 'proof-a', evidence }
function fixture(pg: Pick<PGlite, 'query'>, replay = false, invalid = false, late = false) {
  const row = { depositId: 'deposit-a', visitId: 'visit-a', appointmentId: 'appointment-a', conversationId: 'conversation-a',
    sessionId: 'session-a', scheduledStartAt: now, dbNow: now, expiresAt: new Date(+now + 60_000),
    holdExpiresAt: new Date(+now + 60_000), depositStatus: invalid ? 'APPROVED' : late ? 'EXPIRED' : 'PENDING_PROOF',
    visitStatus: late ? 'EXPIRED' : 'HELD', appointmentStatus: late ? 'CANCELLED' : 'PENDING', snapshotSealedAt: now, proofCount: 0n }
  async function query(q: Prisma.Sql) {
    if (q.text.includes('pg_notify')) return (await pg.query(q.text, q.values)).rows
    if (q.text.includes('SELECT v."professionalId"')) return [{ professionalId: 'professional-a' }]
    if (q.text.includes('FOR UPDATE OF d, v, a')) return [row]
    if (q.text.includes('"sourceSha256"') && q.text.includes('SELECT') && q.text.includes('BookingDepositProof')) {
      return replay ? [{ id: 'proof-existing', kind: 'INITIAL', sourceSha256: evidence.sourceSha256 }] : []
    }
    return []
  }
  return { professional: { findMany: async () => [{ id: 'professional-a' }] }, $queryRaw: query, $executeRaw: async (q: Prisma.Sql) => { const rows = await query(q); return q.text.includes('pg_notify') ? rows.length : 1 } } as unknown as Prisma.TransactionClient
}
const failures: string[] = []
let passed = 0
async function test(name: string, run: () => unknown | Promise<unknown>) {
  try { await run(); passed++; console.log('PASS', name) }
  catch (error) { failures.push(name); console.error('FAIL', name, error instanceof Error ? error.message : '') }
}
try {
  await test('writer emits committed minimal receipt event, never before commit', async () => {
    await db.transaction(async raw => {
      assert.equal((await writeValidatedDepositProofInTransaction(fixture(raw), input)).outcome, 'APPLIED')
      assert.equal(events.length, 0)
    })
    assert.equal(events.length, 1)
    const event = JSON.parse(events[0]!)
    assert.deepEqual(event, { businessId: 'tenant-a', appointmentId: 'appointment-a', depositId: 'deposit-a',
      conversationId: 'conversation-a', updatedAt: now.toISOString() })
    assert.equal(JSON.stringify(event).includes('offline'), false)
  })
  await test('rollback emits no event and replay does not repeat it', async () => {
    const before = events.length
    await assert.rejects(db.transaction(async raw => {
      await writeValidatedDepositProofInTransaction(fixture(raw), { ...input, operationKey: 'rollback-a' })
      throw Error('fixture rollback')
    }), /fixture rollback/)
    assert.equal(events.length, before)
    assert.equal((await db.transaction(raw => writeValidatedDepositProofInTransaction(fixture(raw, true), input))).outcome, 'REPLAYED')
    assert.equal(events.length, before)
  })
  await test('ineligible aggregate cannot emit a receipt event', async () => {
    const before = events.length
    await assert.rejects(db.transaction(raw => writeValidatedDepositProofInTransaction(fixture(raw, false, true), input)))
    assert.equal(events.length, before)
  })
  await test('notification tenant fence rejects a foreign target', async () => {
    const before = events.length
    await assert.rejects(db.transaction(raw => writeValidatedDepositProofInTransaction(fixture(raw), { ...input, businessId: 'foreign' })), /tenant fence/)
    assert.equal(events.length, before)
  })
  await test('late proof invalidation does not claim approval or reopen a booking', async () => {
    const before = events.length
    const result = await db.transaction(raw => writeValidatedDepositProofInTransaction(fixture(raw, false, false, true), { ...input, operationKey: 'late-a' }))
    assert.equal(result.kind, 'LATE')
    assert.equal(events.length, before + 1)
    assert.deepEqual(Object.keys(JSON.parse(events.at(-1)!)).sort(), ['appointmentId', 'businessId', 'conversationId', 'depositId', 'updatedAt'])
  })
  await test('receipt without a conversation emits only the compatible agenda hint', async () => {
    await db.exec('UPDATE "BookingDeposit" SET "conversationId"=NULL')
    await db.transaction(raw => writeValidatedDepositProofInTransaction(fixture(raw), { ...input, operationKey: 'no-conversation' }))
    assert.deepEqual(JSON.parse(events.at(-1)!), { businessId: 'tenant-a', appointmentId: 'appointment-a', updatedAt: now.toISOString() })
  })
  const a: CrmRealtimeEvent[] = [], b: CrmRealtimeEvent[] = []
  const unsubA = subscribeToCrmRealtimeEvents({ businessId: 'tenant-a', send: e => a.push(e) })
  const unsubB = subscribeToCrmRealtimeEvents({ businessId: 'tenant-b', send: e => b.push(e) })
  const receipt = { businessId: 'tenant-a', appointmentId: 'appointment-a', depositId: 'deposit-a',
    conversationId: 'conversation-a', updatedAt: now.toISOString() }
  await test('database bridge fans agenda, receipt and conversation only to its tenant', () => {
    assert.equal(dispatchAppointmentDatabaseNotification(JSON.stringify(receipt)), true)
    assert.deepEqual(a.map(e => e.type), ['appointment_changed', 'deposit_updated', 'conversation_updated'])
    assert.equal(b.length, 0)
  })
  await test('invalid optional receipt fields reject the entire payload', () => {
    for (const value of [null, '', 4, 'x\n', 'x'.repeat(257)]) {
      const before = a.length
      assert.equal(dispatchAppointmentDatabaseNotification(JSON.stringify({ ...receipt, depositId: value })), false)
      assert.equal(a.length, before)
    }
  })
  await test('partial receipt identities and invalid dates fail before any publication', () => {
    for (const payload of [
      { businessId: 'tenant-a', appointmentId: 'appointment-a', updatedAt: now.toISOString(), depositId: 'deposit-a' },
      { businessId: 'tenant-a', appointmentId: 'appointment-a', updatedAt: now.toISOString(), conversationId: 'conversation-a' },
      { ...receipt, conversationId: null }, { ...receipt, updatedAt: 'not-a-date' },
      { ...receipt, updatedAt: now.toISOString() + '\n' },
      { ...receipt, businessId: 'tenant-a\n' }, { ...receipt, appointmentId: 'x'.repeat(257) }
    ]) {
      const before = a.length
      assert.equal(dispatchAppointmentDatabaseNotification(JSON.stringify(payload)), false)
      assert.equal(a.length, before)
    }
  })
  await test('legacy agenda notifications keep their exact publisher contract', () => {
    const got: unknown[] = []
    assert.equal(dispatchAppointmentDatabaseNotification(JSON.stringify({ businessId: 'tenant-a', appointmentId: 'appointment-a',
      updatedAt: now.toISOString() }), value => got.push(value)), true)
    assert.deepEqual(got, [{ businessId: 'tenant-a', appointmentId: 'appointment-a', updatedAt: now.toISOString() }])
  })
  unsubA(); unsubB()
} finally { await stop(); await db.close() }
console.log(`${passed} passed; ${failures.length} failed`)
assert.equal(failures.length, 0, failures.join('; '))