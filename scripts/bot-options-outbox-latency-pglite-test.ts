/** Disposable in-memory PostgreSQL/WASM coverage for the production outbox claim SQL. */
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { Prisma } from '../src/generated/prisma/client.js'

process.env.WHATSAPP_LATENCY_DIAGNOSTIC_BUSINESS_CODES = 'WX-38N6UG'
const { claimOutbox, sendClaimedOutbox, maintainOutbox } = await import('../src/bot-options/infrastructure/whatsapp-outbox-sender.js')
const { whatsappConfig } = await import('../src/config/whatsapp.js')
const db = new PGlite()
const businessId = 'business-integration'
const foreignBusinessId = 'business-foreign'
const deploymentId = 'deployment-integration'
const foreignDeploymentId = 'deployment-foreign'
const diagnosticCode = 'WX-38N6UG'
const foreignCode = 'WX-38N6UH'
const admittedAt = new Date('2026-09-27T10:00:00.000Z')

try {
  await db.exec(`
    CREATE TYPE "BotSessionStatus" AS ENUM ('ACTIVE','HUMAN_QUEUED','HUMAN_TAKEN','CLOSED');
    CREATE TYPE "BotOutboxStatus" AS ENUM ('PENDING','CLAIMED','SENDING','UNKNOWN','ACCEPTED','DELIVERED','READ','RETRY','FAILED','POISON','SKIPPED');
    CREATE TYPE "BotChannel" AS ENUM ('WHATSAPP');
    CREATE TYPE "BotDispatchKind" AS ENUM ('PROCESS','SEND');
    CREATE TYPE "BotDispatchStatus" AS ENUM ('CLAIMED','SENDING','DONE','UNKNOWN');
    CREATE TYPE "MessageDirection" AS ENUM ('INBOUND','OUTBOUND');
    CREATE TABLE "Business" ("id" text PRIMARY KEY, "customerCode" text NOT NULL);
    CREATE TABLE "BotChannelDeployment" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "channel" "BotChannel" NOT NULL,
      "generation" int NOT NULL, "activeConfigurationId" text, "engineKey" text NOT NULL,
      "legacyDispatchCoverageVersion" int NOT NULL, "claimsPausedAt" timestamptz,
      "dispatchFenceEpoch" int NOT NULL DEFAULT 0
    );
    CREATE TABLE "Conversation" ("id" text PRIMARY KEY, "businessId" text NOT NULL,
      "lastMessage" text, "archivedAt" timestamptz, "updatedAt" timestamptz DEFAULT clock_timestamp());
    CREATE TABLE "BotSession" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "conversationId" text NOT NULL,
      "deploymentId" text NOT NULL, "deploymentGeneration" int NOT NULL,
      "status" "BotSessionStatus" NOT NULL, "handoffClaimsPausedAt" timestamptz,
      "handoffFenceEpoch" int NOT NULL DEFAULT 0
    );
    CREATE TABLE "BotProviderEvent" ("id" text PRIMARY KEY, "businessId" text NOT NULL, "admittedAt" timestamptz NOT NULL);
    CREATE TABLE "BotTransitionLog" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "sessionId" text NOT NULL,
      "revisionTo" bigint NOT NULL, "providerEventId" text NOT NULL
    );
    CREATE TABLE "BotOutbox" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "sessionId" text NOT NULL,
      "transitionId" text NOT NULL, "deliveryGroupId" text NOT NULL, "sequence" int NOT NULL,
      "kind" text NOT NULL, "payload" jsonb NOT NULL, "idempotencyKey" text NOT NULL,
      "status" "BotOutboxStatus" NOT NULL, "attempts" int NOT NULL DEFAULT 0,
      "maxAttempts" int NOT NULL DEFAULT 5, "leaseToken" text, "leasedUntil" timestamptz,
      "availableAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "dependsOnSequence" int,
      "createdAt" timestamptz NOT NULL DEFAULT clock_timestamp(), "updatedAt" timestamptz NOT NULL DEFAULT clock_timestamp(),
      "sentAt" timestamptz, "providerMessageId" text, "errorCode" text
    );
    CREATE TABLE "BotDispatchClaim" (
      "id" text PRIMARY KEY, "businessId" text NOT NULL, "channel" "BotChannel" NOT NULL,
      "sessionId" text, "resourceId" text, "engineKey" text NOT NULL, "generation" int NOT NULL,
      "fenceEpoch" int NOT NULL, "handoffFenceEpoch" int, "kind" "BotDispatchKind" NOT NULL,
      "status" "BotDispatchStatus" NOT NULL, "claimToken" text NOT NULL UNIQUE,
      "claimedUntil" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL,
      "providerMessageId" text
    );
    CREATE UNIQUE INDEX "BotDispatchClaim_active_resource_key"
      ON "BotDispatchClaim" ("kind", "engineKey", "resourceId")
      WHERE "resourceId" IS NOT NULL AND "status" IN ('CLAIMED','SENDING','UNKNOWN');
    CREATE TABLE "Message" (
      "id" text PRIMARY KEY, "conversationId" text NOT NULL, "phone" text NOT NULL,
      "direction" "MessageDirection" NOT NULL, "body" text NOT NULL, "providerMessageId" text,
      "status" text NOT NULL, "providerErrorCode" text, "metadata" jsonb NOT NULL
    );
    INSERT INTO "Business" VALUES ('business-integration','WX-38N6UG'),('business-foreign','WX-38N6UH');
    INSERT INTO "BotChannelDeployment" VALUES
      ('deployment-integration','business-integration','WHATSAPP',0,'config-a','deterministic-options',1,NULL,0),
      ('deployment-foreign','business-foreign','WHATSAPP',0,'config-b','deterministic-options',1,NULL,0);
    INSERT INTO "Conversation" ("id","businessId") VALUES ('conversation-a','business-integration'),('conversation-b','business-foreign');
    INSERT INTO "BotSession" VALUES
      ('session-a','business-integration','conversation-a','deployment-integration',0,'ACTIVE',NULL,0),
      ('session-b','business-foreign','conversation-b','deployment-foreign',0,'ACTIVE',NULL,0);
  `)

  const prismaRows = (rows: Array<Record<string, unknown>>) => rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, /Count$/.test(key) && (typeof value === 'string' || typeof value === 'number') ? BigInt(value) : value])
  ))
  let sqlOperations = 0
  let transactions = 0
  let transactionOpen = false
  let lastTransactionOptions: unknown
  const statements: string[] = []
  let beforeStatement: ((query: Prisma.Sql, pg: Pick<PGlite, 'query'>) => Promise<void>) | undefined
  let beforeCommit: (() => void) | undefined
  let afterCommit: (() => void) | undefined
  const client = {
    async $queryRaw(query: Prisma.Sql) { sqlOperations += 1; return prismaRows((await db.query(query.text, query.values)).rows as Array<Record<string, unknown>>) },
    async $executeRaw(query: Prisma.Sql) { sqlOperations += 1; return (await db.query(query.text, query.values)).affectedRows ?? 0 },
    async $transaction<T>(operation: (tx: unknown) => Promise<T>, options?: unknown) {
      transactions += 1
      lastTransactionOptions = options
      transactionOpen = true
      try {
        const result = await db.transaction(async (pg) => {
          const queryRaw = async (query: Prisma.Sql) => {
            sqlOperations += 1
            statements.push(query.text)
            await beforeStatement?.(query, pg)
            return pg.query(query.text, query.values)
          }
          const value = await operation({
            async $queryRaw(query: Prisma.Sql) { return prismaRows((await queryRaw(query)).rows as Array<Record<string, unknown>>) },
            async $executeRaw(query: Prisma.Sql) { return (await queryRaw(query)).affectedRows ?? 0 }
          })
          beforeCommit?.()
          return value
        })
        afterCommit?.()
        return result
      } finally { transactionOpen = false }
    }
  }
  const insert = async (sql: Prisma.Sql) => { await db.query(sql.text, sql.values) }
  const addOutbox = async (id: string, transitionId: string, order: number) => {
    await insert(Prisma.sql`INSERT INTO "BotOutbox" ("id","businessId","sessionId","transitionId","deliveryGroupId","sequence","kind","payload","idempotencyKey","status","availableAt","createdAt")
      VALUES (${id},${businessId},'session-a',${transitionId},${`group-${id}`},0,'text',${JSON.stringify({ to: 'synthetic-recipient', item: { type: 'text', body: 'synthetic test content' } })}::jsonb,${`key-${id}`},'PENDING'::"BotOutboxStatus",clock_timestamp()-interval '1 second',clock_timestamp()+(${order} * interval '1 millisecond'))`)
  }
  const addEvent = async (id: string, ownerBusinessId: string, at = admittedAt) => {
    await insert(Prisma.sql`INSERT INTO "BotProviderEvent" VALUES (${id},${ownerBusinessId},${at})`)
  }
  const addTransition = async (id: string, ownerBusinessId: string, ownerSessionId: string, revision: bigint, providerEventId: string) => {
    await insert(Prisma.sql`INSERT INTO "BotTransitionLog" VALUES (${id},${ownerBusinessId},${ownerSessionId},${revision},${providerEventId})`)
  }

  await addEvent('event-normal','business-integration')
  await addEvent('event-initial','business-integration',new Date('2026-09-27T10:00:01.000Z'))
  await addEvent('event-cross-tenant','business-foreign')
  await addEvent('event-malformed','business-integration')
  await addTransition('transition-normal','business-integration','session-a',11n,'event-normal')
  await addTransition('transition-initial','business-integration','session-a',0n,'event-initial')
  await addTransition('transition-cross-tenant','business-integration','session-a',13n,'event-cross-tenant')
  await addTransition('transition-unlinked','business-integration','session-a',14n,'event-missing')
  await addTransition('transition-malformed','business-integration','session-a',15n,'event-malformed')
  await addOutbox('outbox-normal','transition:session-a:11',1)
  await addOutbox('outbox-initial','initial:session-a:0',2)
  await addOutbox('outbox-cross-tenant','transition:session-a:13',3)
  await addOutbox('outbox-unlinked','transition:session-a:14',4)
  await addOutbox('outbox-malformed','transition:session-a:15:extra',5)

  const claimed = async (expectedId: string) => {
    const item = await claimOutbox(client as never, 30_000, `claim-${expectedId}`, { businessId })
    assert.equal(item?.id, expectedId)
    return item!
  }
  whatsappConfig.latencyDiagnosticBusinessCodes.clear()
  whatsappConfig.latencyDiagnosticBusinessCodes.add(diagnosticCode)

  const normal = await claimed('outbox-normal')
  assert.equal(normal.diagnosticCustomerCode, diagnosticCode)
  assert.equal(normal.sourceProviderEventId, 'event-normal')
  assert.equal(normal.sourceProviderEventAdmittedAt?.toISOString(), admittedAt.toISOString())
  const initial = await claimed('outbox-initial')
  assert.equal(initial.sourceProviderEventId, 'event-initial', 'initial transitions must link through their joined event')
  const crossTenant = await claimed('outbox-cross-tenant')
  assert.equal(crossTenant.sourceProviderEventId, null, 'foreign-business event rows cannot be returned as linked')
  assert.equal(crossTenant.sourceProviderEventAdmittedAt, null)
  const unlinked = await claimed('outbox-unlinked')
  assert.equal(unlinked.sourceProviderEventId, null, 'missing event row reports unavailable correlation')
  const malformed = await claimed('outbox-malformed')
  assert.equal(malformed.sourceProviderEventId, null, 'malformed transition IDs do not reach the ledger join')

  await addOutbox('outbox-allowlist-off','transition:session-a:11',10)
  whatsappConfig.latencyDiagnosticBusinessCodes.clear()
  const off = await claimed('outbox-allowlist-off')
  assert.equal(off.diagnosticCustomerCode, null)
  assert.equal(off.sourceProviderEventId, null)
  assert.equal(off.sourceProviderEventAdmittedAt, null)

  await addOutbox('outbox-sent-at','transition:session-a:11',11)
  whatsappConfig.latencyDiagnosticBusinessCodes.add(diagnosticCode)
  const acceptanceItem = await claimed('outbox-sent-at')
  const diagnostics: Array<{ phase: string; durationMs: number | null; outcome: string; sourceProviderEventId: string | null }> = []
  const beforeSendSql = sqlOperations
  const beforeSendTransactions = transactions
  const beforeSendStatements = statements.length
  let observedPreflightTransactions = 0
  let providerSignal: AbortSignal | undefined
  const sendResult = await sendClaimedOutbox({
    client: client as never,
    item: acceptanceItem,
    provider: { async send(input, signal, onDiagnostic) {
      assert.equal(transactionOpen, false, 'provider runs only after confirmed commit')
      observedPreflightTransactions = transactions - beforeSendTransactions
      assert.deepEqual(lastTransactionOptions, { maxWait: 2_000, timeout: 8_000 })
      const preflight = statements.slice(beforeSendStatements)
      assert.equal(preflight.length, 4, 'lock, expiry, acquisition and markers stay separate')
      assert.match(preflight[0]!, /SELECT pg_advisory_xact_lock_shared/)
      assert.doesNotMatch(preflight[0]!, /BotDispatchClaim/)
      assert.equal((await db.query<{ status: string }>(`SELECT "status" FROM "BotOutbox" WHERE "id"='outbox-sent-at'`)).rows[0]!.status, 'SENDING')
      assert.equal((await db.query<{ status: string }>(`SELECT "status" FROM "BotDispatchClaim" WHERE "resourceId"='outbox-sent-at'`)).rows[0]!.status, 'SENDING')
      assert.deepEqual(input, { businessId: acceptanceItem.businessId, payload: acceptanceItem.payload })
      providerSignal = signal
      for (const phase of ['provider_credentials', 'meta_http', 'meta_response_parse'] as const) onDiagnostic?.({ phase, durationMs: 1, outcome: 'ok' })
      return { kind: 'accepted', providerMessageId: 'synthetic-meta-acceptance' }
    } },
    onDiagnostic(diagnostic) { diagnostics.push(diagnostic) }
  })
  assert.equal(observedPreflightTransactions, 1, 'one preflight transaction before provider')
  assert.equal(sendResult, 'ACCEPTED')
  const measuredSendSql = sqlOperations - beforeSendSql
  assert.equal(providerSignal?.aborted, false)
  const providerPhases = diagnostics.filter((event) => ['provider_credentials', 'meta_http', 'meta_response_parse'].includes(event.phase))
  assert.equal(providerPhases.length, 3, 'provider subspans reach the existing sender diagnostic sink')
  for (const event of providerPhases) {
    assert.equal(event.sourceProviderEventId, 'event-normal')
    assert.deepEqual(Object.keys(event).sort(), ['cohort', 'correlation', 'durationMs', 'outcome', 'phase', 'resource', 'resourceId', 'sourceProviderEventId'])
  }
  assert.ok(diagnostics.find((event) => event.phase === 'meta_request'), 'inclusive provider total remains present')
  const sentAt = (await db.query<{ sentAt: Date }>(`SELECT "sentAt" FROM "BotOutbox" WHERE "id"='outbox-sent-at'`)).rows[0]!.sentAt
  const acceptance = diagnostics.find((diagnostic) => diagnostic.phase === 'admission_to_meta_acceptance')!
  assert.equal(acceptance.outcome, 'accepted')
  assert.equal(acceptance.sourceProviderEventId, 'event-normal')
  assert.equal(acceptance.durationMs, sentAt.getTime() - admittedAt.getTime(), 'latency uses the sentAt returned by acceptance SQL')

  let disabledDiagnostics = 0
  const disabledSendSqlStart = sqlOperations
  assert.equal(await sendClaimedOutbox({
    client: client as never, item: off,
    provider: { async send(_input, _signal, onDiagnostic) {
      assert.equal(onDiagnostic, undefined, 'unlisted tenant never receives a provider diagnostic callback')
      return { kind: 'accepted', providerMessageId: 'synthetic-off' }
    } },
    onDiagnostic() { disabledDiagnostics += 1 }
  }), 'ACCEPTED')
  assert.equal(sqlOperations - disabledSendSqlStart, measuredSendSql, 'diagnostics perform no additional SQL')
  assert.equal(disabledDiagnostics, 0)

  await addOutbox('outbox-throwing-sink','transition:session-a:11',12)
  const throwingSinkItem = await claimed('outbox-throwing-sink')
  assert.equal(await sendClaimedOutbox({
    client: client as never, item: throwingSinkItem,
    provider: { async send(_input, _signal, onDiagnostic) {
      onDiagnostic?.({ phase: 'meta_http', durationMs: 2, outcome: 'ok' })
      return { kind: 'accepted', providerMessageId: 'synthetic-sink' }
    } },
    onDiagnostic() { throw new Error('synthetic_sink_failure') }
  }), 'ACCEPTED', 'sink failure cannot change acceptance or rollback')

  await addOutbox('outbox-timeout','transition:session-a:11',13)
  const timeoutItem = await claimed('outbox-timeout')
  let timeoutSignal: AbortSignal | undefined
  let finishLate: (() => void) | undefined
  const timeoutDiagnostics: string[] = []
  assert.equal(await sendClaimedOutbox({
    client: client as never, item: timeoutItem, timeoutMs: 10,
    provider: { async send(_input, signal, onDiagnostic) {
      timeoutSignal = signal
      await new Promise<void>((resolve) => { finishLate = resolve })
      onDiagnostic?.({ phase: 'meta_http', durationMs: 20, outcome: 'error' })
      return { kind: 'accepted', providerMessageId: 'synthetic-late' }
    } },
    onDiagnostic(event) { timeoutDiagnostics.push(event.phase) }
  }), 'UNKNOWN', 'existing timeout semantics remain conservative')
  assert.equal(timeoutSignal?.aborted, true)
  finishLate!()
  await new Promise<void>((resolve) => setTimeout(resolve, 5))
  assert.equal((await db.query<{ status: string }>(`SELECT "status"::text FROM "BotOutbox" WHERE "id"='outbox-timeout'`)).rows[0]!.status, 'UNKNOWN', 'late provider completion never finalizes accepted')
  assert.ok(timeoutDiagnostics.includes('meta_request'))
  assert.ok(timeoutDiagnostics.includes('meta_http'))
  // These hooks inject state/faults in a single PGlite session, not concurrent PostgreSQL sessions.
  const fresh = async (name: string) => {
    await addOutbox(name, 'transition:session-a:11', 20)
    return claimed(name)
  }
  const statuses = async (name: string) => ({
    outbox: (await db.query<{ status: string }>('SELECT "status"::text FROM "BotOutbox" WHERE "id"=$1', [name])).rows[0]!.status,
    dispatch: (await db.query<{ status: string }>('SELECT "status"::text FROM "BotDispatchClaim" WHERE "resourceId"=$1 ORDER BY "claimToken"', [name])).rows.map((row) => row.status)
  })
  let sends = 0
  const provider = { async send() { sends += 1; return { kind: 'accepted' as const, providerMessageId: 'synthetic-regression' } } }
  const send = (item: typeof acceptanceItem) => sendClaimedOutbox({ client: client as never, item, provider })
  const expired = async (name: string, status: 'CLAIMED' | 'SENDING') => {
    await insert(Prisma.sql`INSERT INTO "BotDispatchClaim" ("id","businessId","channel","sessionId","resourceId","engineKey","generation","fenceEpoch","handoffFenceEpoch","kind","status","claimToken","claimedUntil","updatedAt")
      VALUES (${`old-${name}`},${businessId},'WHATSAPP','session-a',${name},'deterministic-options',0,0,0,'SEND',${status}::"BotDispatchStatus",${`old-${name}`},clock_timestamp()-interval '1 second',clock_timestamp())`)
  }
  const unknown = await fresh('null-cleanup')
  await expired(unknown.id, 'SENDING')
  assert.equal(await send(unknown), 'STALE')
  assert.deepEqual(await statuses(unknown.id), { outbox: 'CLAIMED', dispatch: ['UNKNOWN'] }, 'null acquisition commits UNKNOWN cleanup; real partial index blocks reacquisition')
  assert.equal(await send(unknown), 'STALE')
  assert.equal(sends, 0)

  const reusable = await fresh('expired-reuse')
  await expired(reusable.id, 'CLAIMED')
  assert.equal(await send(reusable), 'ACCEPTED')
  assert.deepEqual(await statuses(reusable.id), { outbox: 'ACCEPTED', dispatch: ['DONE', 'DONE'] })
  assert.equal(await send(reusable), 'STALE', 'repeated caller cannot resend an accepted outbox')
  assert.equal(sends, 1)

  const duplicate = await fresh('duplicate-active')
  await expired(duplicate.id, 'CLAIMED')
  await db.query(`UPDATE "BotDispatchClaim" SET "claimedUntil"=clock_timestamp()+interval '1 minute' WHERE "resourceId"=$1`, [duplicate.id])
  assert.equal(await send(duplicate), 'STALE', 'active resource uniqueness rejects a competing sender')
  assert.equal(sends, 1)

  for (const [name, overrides] of [
    ['wrong-tenant', { businessId: foreignBusinessId }],
    ['wrong-generation', { generation: 1 }],
    ['wrong-fence', { fenceEpoch: 1 }],
    ['wrong-lease', { claimToken: 'stale-token' }]
  ] as const) {
    const item = await fresh(name)
    assert.equal(await send({ ...item, ...overrides }), 'STALE', name)
    assert.deepEqual(await statuses(item.id), { outbox: 'CLAIMED', dispatch: [] }, name)
  }
  // Change each gate immediately before the production marker statement. Rollback restores it.
  for (const [name, mutation] of [
    ['deployment-paused', 'UPDATE "BotChannelDeployment" SET "claimsPausedAt"=clock_timestamp()'],
    ['deployment-fenced', 'UPDATE "BotChannelDeployment" SET "dispatchFenceEpoch"=1'],
    ['handoff-paused', 'UPDATE "BotSession" SET "handoffClaimsPausedAt"=clock_timestamp()'],
    ['handoff-fenced', 'UPDATE "BotSession" SET "handoffFenceEpoch"=1'],
    ['human-taken', `UPDATE "BotSession" SET "status"='HUMAN_TAKEN'`],
    ['dispatch-expired', `UPDATE "BotDispatchClaim" SET "claimedUntil"=clock_timestamp()-interval '1 second'`]
  ]) {
    const item = await fresh(name!)
    beforeStatement = async (query, pg) => { if (query.text.includes('WITH outbox AS')) await pg.query(mutation!) }
    assert.equal(await send(item), 'STALE', name)
    beforeStatement = undefined
    assert.deepEqual(await statuses(item.id), { outbox: 'CLAIMED', dispatch: [] }, `${name}: both markers rollback`)
  }
  assert.equal(sends, 1)

  const recoverable = await fresh('marker-rollback')
  await expired(recoverable.id, 'CLAIMED')
  beforeStatement = async (query) => { if (query.text.includes('WITH outbox AS')) throw new Error('marker failed') }
  assert.equal(await send(recoverable), 'STALE')
  beforeStatement = undefined
  assert.deepEqual(await statuses(recoverable.id), { outbox: 'CLAIMED', dispatch: ['CLAIMED'] }, 'expiry cleanup rolls back conservatively with marker failure')
  const drain = await db.query<{ active: number }>(`SELECT count(*)::int AS active FROM (
    SELECT "id" FROM "BotDispatchClaim" WHERE "resourceId"=$1 AND "status" IN ('CLAIMED','SENDING')
    UNION ALL SELECT "id" FROM "BotOutbox" WHERE "id"=$1 AND "status" IN ('CLAIMED','SENDING')
  ) active`, [recoverable.id])
  assert.equal(drain.rows[0]!.active, 2, 'handoff drain still sees committed work after rollback')
  assert.equal(await send(recoverable), 'ACCEPTED', 'next attempt recovers expired claim')
  assert.equal(await send(recoverable), 'STALE', 'recovery cannot duplicate delivery')
  assert.equal(sends, 2)

  const acquisitionFailure = await fresh('acquisition-failure')
  const acquisitionError = new Error('acquisition failed')
  beforeStatement = async (query) => { if (query.text.includes('INSERT INTO "BotDispatchClaim"')) throw acquisitionError }
  await assert.rejects(send(acquisitionFailure), (error) => error === acquisitionError, 'acquisition failures still propagate')
  beforeStatement = undefined
  assert.deepEqual(await statuses(acquisitionFailure.id), { outbox: 'CLAIMED', dispatch: [] })
  for (const name of ['preflight-rollback', 'preflight-timeout']) {
    const item = await fresh(name)
    beforeCommit = () => { throw new Error(name === 'preflight-timeout' ? 'Transaction already closed: timeout' : 'rollback') }
    assert.equal(await send(item), 'STALE')
    beforeCommit = undefined
    assert.deepEqual(await statuses(item.id), { outbox: 'CLAIMED', dispatch: [] })
  }
  const ambiguous = await fresh('commit-ack-lost')
  afterCommit = () => { throw new Error('commit acknowledgement lost') }
  assert.equal(await send(ambiguous), 'STALE')
  afterCommit = undefined
  assert.deepEqual(await statuses(ambiguous.id), { outbox: 'SENDING', dispatch: ['DONE'] }, 'captured token cleanup preserves existing no-provider ambiguous-commit behavior')
  assert.equal(await send(ambiguous), 'STALE', 'even explicit replay cannot resend durable SENDING')
  await db.query(`UPDATE "BotOutbox" SET "leasedUntil"=clock_timestamp()-interval '1 second' WHERE "id"=$1`, [ambiguous.id])
  await maintainOutbox(client as never, { businessId })
  assert.equal((await statuses(ambiguous.id)).outbox, 'UNKNOWN', 'durable SENDING remains subject to conservative recovery')
  assert.equal(sends, 2, 'all preflight faults call no provider')

  console.log('bot-options-outbox-latency-pglite-test: OK')
} finally {
  await db.close()
}