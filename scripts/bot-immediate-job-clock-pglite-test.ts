import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'
import { PrismaAuthoritativeAdmissionRepository, upsertJob } from '../src/bot-options/infrastructure/prisma-admission.js'
import { createQueueMilestoneTracker, observeQueueProducerTransaction, type QueueMilestoneDiagnostic } from '../src/bot-options/observability/queue-milestones.js'

const db = new PGlite()
const route = { kind: 'new', businessId: 'barber', deploymentId: 'deployment', generation: 1,
  appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null } as const
const statements: Prisma.Sql[] = []
let skewAppDates = false
let futureAppDate = new Date()
const adapter = (pg: { query: PGlite['query'] }) => ({
  async $executeRaw(query: Prisma.Sql) {
    if (!query.text?.includes('INSERT INTO "BotJob"')) return 1
    statements.push(query)
    const values = [...query.values]
    // Model an application timestamp 2s ahead only at the driver boundary.
    // No global Date/clock patch and no alteration of the production SQL text.
    if (skewAppDates && values[7] instanceof Date) values[7] = futureAppDate
    return (await pg.query(query.text, values)).affectedRows ?? 0
  },
  async $queryRaw(query: Prisma.Sql) {
    if (query.text.includes('initial-classification-batch')) {
      statements.push(query)
      const result = await pg.query<{ inboxCount: number | bigint; jobCount: number | bigint }>(query.text, query.values)
      return result.rows.map(row => ({ inboxCount: BigInt(row.inboxCount), jobCount: BigInt(row.jobCount) }))
    }
    if (query.text.includes('INSERT INTO "BotProviderEvent"')) return [{ id: query.values[0] }]
    if (query.text.includes('SELECT "id", "generation"')) return [{ id: route.deploymentId, generation: 1 }]
    if (query.text.includes('conversation-policy') || query.text.includes('"BotSession"')) return []
    throw new Error('unexpected producer fixture query')
  }
})
async function eligible(kind: string) {
  return (await db.query<{ eligible: boolean }>(`SELECT "availableAt" <= clock_timestamp() AS eligible
    FROM "BotJob" WHERE "kind"=$1 AND "businessId"='barber' ORDER BY "createdAt" DESC LIMIT 1`, [kind])).rows[0]?.eligible
}
try {
  await db.exec(`
    CREATE TYPE "BotJobStatus" AS ENUM ('READY','RETRY','LEASED','DONE','POISON');
    CREATE TYPE "BotInboxStatus" AS ENUM ('ADMITTED');
    CREATE TABLE "BotActionInbox" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "providerEventId" text NOT NULL,
      "providerMessageId" text, "actionType" text NOT NULL, "deploymentId" text NOT NULL,
      "deploymentGeneration" int NOT NULL, "payload" jsonb NOT NULL, "status" "BotInboxStatus" NOT NULL);
    CREATE TABLE "BotJob" ("id" text PRIMARY KEY, "kind" text NOT NULL, "aggregateId" text NOT NULL,
      "businessId" text NOT NULL, "deploymentId" text NOT NULL, "deploymentGeneration" int NOT NULL,
      "expectedRevision" bigint, "availableAt" timestamptz NOT NULL, "status" "BotJobStatus" NOT NULL,
      "leaseToken" text, "leasedUntil" timestamptz, "updatedAt" timestamptz NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now(), UNIQUE("kind","aggregateId"));
  `)
  const clock = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now
  futureAppDate = new Date(clock.getTime() + 2_000)
  skewAppDates = true
  const milestones: QueueMilestoneDiagnostic[] = []
  const tracker = createQueueMilestoneTracker({ businessId: route.businessId, now: () => 100, emit: event => { milestones.push(event) } })
  const client = { async $transaction<T>(body: (tx: unknown) => Promise<T>) {
    return db.transaction(pg => body(adapter(pg)))
  } }
  const repository = new PrismaAuthoritativeAdmissionRepository(client as never, { queueMilestones: tracker })
  const unsupported = { kind: 'unsupported_change', eventKey: 'event-key' } as const
  const before = statements.length
  await repository.admitAuthoritative({ route, phoneNumberId: 'fixture', events: [unsupported] })
  assert.equal(statements.length - before, 1, 'one INSERT, no extra clock query in admission')
  assert.equal(await eligible('PROCESS_PROVIDER_EVENT'), true, 'immediate provider job cannot be held by the application clock')
  assert.equal(tracker.retainedCount, 1, 'existing postcommit milestone remains registered')
  await db.transaction(pg => repository.classifyProviderEventTx(adapter(pg) as never, { route, event: unsupported, providerEventId: 'event' }))
  assert.equal(await eligible('PROCESS_INBOX'), true, 'immediate classified inbox cannot be held by the application clock')
  const proofRepository = new PrismaAuthoritativeAdmissionRepository(client as never, { depositProofIngressEnabled: true })
  await db.transaction(pg => proofRepository.classifyProviderEventTx(adapter(pg) as never, {
    route, providerEventId: 'proof-event', event: { kind: 'message', eventKey: 'proof-key',
      providerMessageId: 'proof-message', phoneNumberId: 'fixture', displayPhoneNumber: null, fromPhone: 'fixture',
      textBody: null, messageType: 'image', interactiveReplyId: null, mediaType: 'image', mediaMimeType: null,
      mediaId: 'fixture-media', filename: null, providerOccurredAtIso: null }
  }))
  assert.equal(await eligible('RECEIVE_DEPOSIT_PROOF'), true, 'immediate proof admission uses DB clock without enabling a production capability')
  assert.equal(statements.length - before, 3)
  assert.ok(statements.every(query => !query.values.some(value => value instanceof Date)), 'all three immediate producers select server clock')
  skewAppDates = false

  const tx = adapter(db)
  const scheduled = new Date(clock.getTime() + 60_000)
  await upsertJob(tx as never, 'SCHEDULED', 'scheduled', 'barber', 'deployment', 1, 7n, scheduled)
  const scheduledRow = (await db.query<{ at: Date; revision: number | bigint; eligible: boolean }>(`SELECT "availableAt" AS at,
    "expectedRevision" AS revision, "availableAt" <= clock_timestamp() AS eligible FROM "BotJob" WHERE "kind"='SCHEDULED'`)).rows[0]!
  assert.equal(scheduledRow.at.getTime(), scheduled.getTime())
  assert.equal(scheduledRow.eligible, false, 'an explicit future Date remains a real schedule')
  assert.equal(BigInt(scheduledRow.revision), 7n)
  assert.ok(statements.at(-1)!.values.includes(scheduled), 'Date remains a bound parameter')

  const count = statements.length
  await upsertJob(tx as never, 'IMMEDIATE', 'duplicate', 'barber', 'deployment', 1, null, 'immediate')
  await db.exec(`UPDATE "BotJob" SET "status"='RETRY', "leaseToken"='old', "leasedUntil"=clock_timestamp()+interval '1 minute',
    "availableAt"=clock_timestamp()+interval '1 minute' WHERE "kind"='IMMEDIATE'`)
  await upsertJob(tx as never, 'IMMEDIATE', 'duplicate', 'barber', 'deployment', 1, null, 'immediate')
  assert.equal(statements.length - count, 2, 'one statement per upsert, including conflict')
  assert.equal(await eligible('IMMEDIATE'), true)
  const duplicate = (await db.query<{ count: number; status: string; lease: string | null }>(`SELECT count(*)::int AS count,
    max("status"::text) AS status, max("leaseToken") AS lease FROM "BotJob" WHERE "kind"='IMMEDIATE'`)).rows[0]!
  assert.deepEqual(duplicate, { count: 1, status: 'READY', lease: null })
  await db.exec(`UPDATE "BotJob" SET "status"='LEASED', "leaseToken"='fenced' WHERE "kind"='IMMEDIATE'`)
  await upsertJob(tx as never, 'IMMEDIATE', 'duplicate', 'barber', 'deployment', 1, null, 'immediate')
  assert.equal((await db.query<{ lease: string }>(`SELECT "leaseToken" AS lease FROM "BotJob" WHERE "kind"='IMMEDIATE'`)).rows[0]!.lease, 'fenced',
    'existing leased conflict fence remains unchanged')

  const rollback = createQueueMilestoneTracker({ businessId: 'barber', emit: () => undefined })
  const failure = new Error('rollback fixture')
  await assert.rejects(observeQueueProducerTransaction(rollback,
    body => db.transaction(pg => body(adapter(pg))), async pending => {
      await upsertJob(pending as never, 'ROLLBACK', 'rollback', 'barber', 'deployment', 1, null, 'immediate')
      throw failure
    }), error => error === failure)
  assert.equal(rollback.retainedCount, 0, 'rollback cannot publish ready ACK')
  assert.equal((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM "BotJob" WHERE "kind"='ROLLBACK'`)).rows[0]!.count, 0)
  await upsertJob(tx as never, 'FOREIGN', 'foreign', 'other', 'other-deployment', 2, null, 'immediate')
  assert.equal((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM "BotJob" WHERE "businessId"='barber' AND "kind"='FOREIGN'`)).rows[0]!.count, 0)
  for (const [file, aggregate] of [
    ['src/bot-options/application/process-session-job.ts', 'recoveryInboxId'],
    ['src/bot-options/application/process-deposit-proof-job.ts', 'inboxId']
  ]) {
    assert.ok(file && aggregate)
    const source = readFileSync(file, 'utf8')
    assert.match(source, new RegExp("upsertJob\\(tx, 'PROCESS_INBOX', " + aggregate + "[^\\n]+, 'immediate'\\)"),
      'mechanical recovery/fallback admission must not use the process clock')
  }
  console.log('PASS immediate job SQL clock: skewed producers, future Date, querycounts, conflicts, fences, tenant and rollback')
} finally { await db.close() }
