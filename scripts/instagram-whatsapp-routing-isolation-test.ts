import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import {
  collectActivationPreflight,
  pauseDispatchScope,
  recoverPausedDispatchScope,
  resumeDispatchScope,
  startActivationPreflight,
  switchPausedRouting,
  waitForDispatchQuiescence,
  type DispatchPauseHandle
} from '../src/bot-options/infrastructure/prisma-activation.js'

// Production SQL in one memory-only database; no provider or PostgreSQL server.
// Advisory locks are no-ops: this proves outcomes, not concurrent-worker locks.
const db = new PGlite()
const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8')
const enums = [...schema.matchAll(/enum (\w+) \{([\s\S]*?)\n\}/g)]
const models = [
  'BotChannelDeployment', 'BusinessBotConfiguration', 'BotSession', 'BotPrompt',
  'BotActionInbox', 'BotJob', 'BotOutbox', 'BotDispatchClaim', 'BotHandoff',
  'BotDeploymentAudit', 'Conversation', 'LegacyWhatsAppCutoverInbound',
  'BookingVisit', 'BookingDeposit'
]
for (const [, name, body] of enums) {
  const values = body!.split('\n').flatMap(line =>
    line.match(/@map\("([^"]+)"\)/)?.[1]
    ?? line.trim().match(/^([A-Za-z_][A-Za-z_0-9]*)(?:\s|$)/)?.[1] ?? [])
  await db.exec(`CREATE TYPE "${name}" AS ENUM (${values.map(value => `'${value}'`).join(',')})`)
}
for (const name of models) {
  const body = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`))![1]!
  const columns = body.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\w+)\s+(\w+)(\?)?(?:\s|$)/)
    if (!match || /\[\]/.test(line)) return []
    const scalar = ({ String: 'text', Int: 'integer', Boolean: 'boolean', DateTime: 'timestamptz', Json: 'jsonb', Decimal: 'numeric', BigInt: 'bigint', Float: 'double precision' } as Record<string, string>)[match[2]!]
    const type = scalar ?? (enums.some(entry => entry[1] === match[2]) ? `"${match[2]}"` : null)
    if (!type) return []
    const value = line.match(/@default\(("[^"]*"|true|false|[0-9]+|[A-Z_]+)\)/)?.[1]
    const defaultSql = value
      ? value.startsWith('"') ? `'${value.slice(1, -1).replaceAll("'", "''")}'` : /^[A-Z_]+$/.test(value) ? `'${value}'` : value
      : ['createdAt', 'updatedAt', 'receivedAt', 'queuedAt'].includes(match[1]!) ? 'clock_timestamp()' : null
    const column = line.match(/@map\("([^"]+)"\)/)?.[1] ?? match[1]
    return [`"${column}" ${type}${match[1] === 'id' ? ' PRIMARY KEY' : ''}${defaultSql ? ` DEFAULT ${defaultSql}` : ''}`]
  })
  await db.exec(`CREATE TABLE "${name}" (${columns.join(',')})`)
}
await db.exec(`CREATE UNIQUE INDEX deployment_channel ON "BotChannelDeployment" ("businessId",channel);
  CREATE FUNCTION pg_advisory_xact_lock(bigint) RETURNS void LANGUAGE sql AS 'SELECT NULL::void';`)

type Query = { text: string; values: unknown[] }
let failAudit = false
const client = {
  $transaction: async <T>(operation: (tx: never) => Promise<T>) => db.transaction(async sql => {
    const query = async (statement: Query) => {
      const result = await sql.query(statement.text, statement.values.map(value => value instanceof Date ? value.toISOString() : value))
      for (const field of result.fields ?? []) {
        if (field.dataTypeID === 20) for (const row of result.rows as Record<string, unknown>[]) {
          if (row[field.name] !== null) row[field.name] = BigInt(String(row[field.name]))
        }
      }
      if (failAudit && statement.text.includes('INSERT INTO "BotDeploymentAudit"')) {
        failAudit = false
        throw new Error('controlled audit rollback')
      }
      return result
    }
    return operation({
      $queryRaw: async (statement: Query) => (await query(statement)).rows,
      $executeRaw: async (statement: Query) => (await query(statement)).affectedRows ?? 0
    } as never)
  })
}
const actorId = 'offline-operator'
async function seed() {
  await db.exec(`TRUNCATE ${models.map(name => `"${name}"`).join(',')};
    INSERT INTO "BusinessBotConfiguration" (id,"businessId",status,"routingMode") VALUES ('next','biz','ACTIVE','EXCLUSIVE');
    INSERT INTO "BotChannelDeployment" (id,"businessId",channel,"engineKey",generation,"dispatchFenceEpoch","activeConfigurationId","legacyDispatchCoverageVersion") VALUES
      ('wa-dep','biz','WHATSAPP','deterministic-options',3,4,'previous',1),
      ('ig-dep','biz','INSTAGRAM','deterministic-options',8,9,'instagram-config',0);
    INSERT INTO "BotSession" (id,"businessId","deploymentId","deploymentGeneration",channel,state,status) VALUES
      ('wa-session','biz','wa-dep',3,'WHATSAPP','{"booking":"DRAFT","marker":"wa"}','ACTIVE'),
      ('ig-session','biz','ig-dep',8,'INSTAGRAM','{"booking":"DRAFT","marker":"ig"}','ACTIVE');
    INSERT INTO "BotPrompt" (id,"sessionId",status) VALUES ('wa-prompt','wa-session','OPEN'),('ig-prompt','ig-session','STABILIZING');`)
}
const pause = () => pauseDispatchScope({ client: client as never, businessId: 'biz', expectedGeneration: 3, actorId, legacyCoverageComplete: true })
const switchRouting = (handle: DispatchPauseHandle) => switchPausedRouting({ client: client as never, handle, actorId, action: 'ACTIVATE', targetConfigurationId: 'next' })
async function instagramSnapshot() {
  const tables = ['BotChannelDeployment', 'BotSession', 'BotPrompt', 'BotActionInbox', 'BotJob', 'BotOutbox', 'BotDispatchClaim', 'BotHandoff']
  const result: Record<string, unknown> = {}
  for (const table of tables) {
    result[table] = (await db.query(`SELECT row_to_json(t)::text AS bytes FROM "${table}" t WHERE id LIKE 'ig-%' ORDER BY id`)).rows
  }
  return result
}
async function seedInstagramWork() {
  await db.exec(`INSERT INTO "BotActionInbox" (id,"businessId","deploymentId","deploymentGeneration","sessionId",status) VALUES ('ig-inbox','biz','ig-dep',8,'ig-session','ADMITTED');
    INSERT INTO "BotJob" (id,"businessId","deploymentId","deploymentGeneration",status,"leasedUntil","leaseToken") VALUES ('ig-job','biz','ig-dep',8,'LEASED',clock_timestamp()-interval '1 minute','ig-lease');
    INSERT INTO "BotOutbox" (id,"businessId","sessionId",status,"leasedUntil","leaseToken") VALUES
      ('ig-sending','biz','ig-session','SENDING',clock_timestamp()-interval '1 minute','ig-send'),
      ('ig-claimed','biz','ig-session','CLAIMED',clock_timestamp()-interval '1 minute','ig-claim'),
      ('ig-accepted','biz','ig-session','ACCEPTED',NULL,NULL),
      ('ig-unknown','biz','ig-session','UNKNOWN',NULL,NULL),
      ('ig-poison','biz','ig-session','POISON',NULL,NULL);
    INSERT INTO "BotDispatchClaim" (id,"businessId",channel,"sessionId","resourceId",kind,status,"claimToken","claimedUntil") VALUES
      ('ig-sending-claim','biz','INSTAGRAM','ig-session','ig-sending','SEND','SENDING','ig-send',clock_timestamp()-interval '1 minute'),
      ('ig-claimed-claim','biz','INSTAGRAM','ig-session','ig-claimed','SEND','CLAIMED','ig-claim',clock_timestamp()-interval '1 minute'),
      ('ig-accepted-claim','biz','INSTAGRAM','ig-session','ig-accepted','SEND','CLAIMED','ig-accepted-token',clock_timestamp()+interval '1 minute'),
      ('ig-unknown-claim','biz','INSTAGRAM','ig-session',NULL,'PROCESS','UNKNOWN','ig-unknown-token',clock_timestamp());
    INSERT INTO "BotHandoff" (id,"businessId","sessionId",status) VALUES ('ig-handoff','biz','ig-session','TAKEN');`)
}

try {
  await seed()
  await seedInstagramWork()
  const beforePreflight = await instagramSnapshot()
  const handle = await pause()
  const snapshot = await collectActivationPreflight({ client: client as never, handle })
  assert.deepEqual(snapshot.drafts, [{ id: 'wa-session', status: 'DRAFT' }], 'WA preflight must not list an Instagram draft')
  for (const category of ['inbox', 'jobs', 'outbox', 'handoffs', 'unknown'] as const) {
    assert.deepEqual(snapshot[category], [], `Instagram ${category} must not enter WA preflight`)
    assert.equal(snapshot.counts[category], 0n, `Instagram ${category} must not contaminate WA counts`)
  }
  assert.equal(snapshot.counts.drafts, 1n)
  assert.equal((await waitForDispatchQuiescence({ client: client as never, handle, timeoutMs: 0 })).kind, 'QUIESCENT')
  assert.deepEqual(await instagramSnapshot(), beforePreflight, 'WA recovery leaves every Instagram row byte-identical')
  assert.deepEqual(await recoverPausedDispatchScope({ client: client as never, businessId: 'biz', expectedGeneration: 3 }), handle)
  assert.equal((await switchRouting(handle)).generation, 4)
  assert.deepEqual(await instagramSnapshot(), beforePreflight, 'WA commit leaves Instagram prompts, sessions and work byte-identical')
  assert.deepEqual((await db.query(`SELECT status FROM "BotPrompt" WHERE id='wa-prompt'`)).rows, [{ status: 'INVALIDATED' }])
  assert.deepEqual((await db.query(`SELECT status FROM "BotSession" WHERE id='wa-session'`)).rows, [{ status: 'CLOSED' }])
  console.log('WA preflight/counts/recovery/commit preserve active Instagram draft, questions, work and UNKNOWN: PASS')

  await seed()
  await seedInstagramWork()
  const beforeRecovery = await instagramSnapshot()
  await db.exec(`INSERT INTO "BotOutbox" (id,"businessId","sessionId",status,"leasedUntil","leaseToken") VALUES
      ('wa-sending','biz','wa-session','SENDING',clock_timestamp()-interval '1 minute','wa-send'),
      ('wa-claimed','biz','wa-session','CLAIMED',clock_timestamp()-interval '1 minute','wa-claim'),
      ('wa-accepted','biz','wa-session','ACCEPTED',NULL,NULL);
    INSERT INTO "BotDispatchClaim" (id,"businessId",channel,"sessionId","resourceId",kind,status,"claimToken","claimedUntil") VALUES
      ('wa-sending-claim','biz','WHATSAPP','wa-session','wa-sending','SEND','SENDING','wa-send',clock_timestamp()-interval '1 minute'),
      ('wa-claimed-claim','biz','WHATSAPP','wa-session','wa-claimed','SEND','CLAIMED','wa-claim',clock_timestamp()-interval '1 minute'),
      ('wa-accepted-claim','biz','WHATSAPP','wa-session','wa-accepted','SEND','CLAIMED','wa-accepted-token',clock_timestamp()+interval '1 minute'),
      ('wa-legacy-claim','biz','WHATSAPP',NULL,NULL,'LEGACY_PROCESS','SENDING','wa-legacy',clock_timestamp()-interval '1 minute');
    INSERT INTO "LegacyWhatsAppCutoverInbound" (id,"businessId",status,"claimToken") VALUES ('wa-legacy','biz','NORMAL_SENDING','wa-legacy');
    INSERT INTO "BotJob" (id,"businessId","deploymentId","deploymentGeneration",status,"leasedUntil","leaseToken") VALUES ('wa-job','biz','wa-dep',2,'LEASED',clock_timestamp()-interval '1 minute','wa-job-lease');`)
  const recoveryHandle = await pause()
  const quiescence = await waitForDispatchQuiescence({ client: client as never, handle: recoveryHandle, timeoutMs: 0 })
  assert.equal(quiescence.kind, 'BLOCKED_UNKNOWN', 'stale WA sends retain ambiguous-send protection')
  assert.deepEqual(await instagramSnapshot(), beforeRecovery, 'WA lease reconciliation cannot change Instagram rows')
  assert.deepEqual((await db.query(`SELECT id,status FROM "BotOutbox" WHERE id LIKE 'wa-%' ORDER BY id`)).rows,
    [{ id: 'wa-accepted', status: 'ACCEPTED' }, { id: 'wa-claimed', status: 'PENDING' }, { id: 'wa-sending', status: 'UNKNOWN' }])
  assert.deepEqual((await db.query(`SELECT id,status FROM "BotDispatchClaim" WHERE id LIKE 'wa-%' ORDER BY id`)).rows,
    [{ id: 'wa-accepted-claim', status: 'DONE' }, { id: 'wa-claimed-claim', status: 'DONE' }, { id: 'wa-legacy-claim', status: 'UNKNOWN' }, { id: 'wa-sending-claim', status: 'UNKNOWN' }])
  assert.deepEqual((await db.query(`SELECT status,"leaseToken" FROM "BotJob" WHERE id='wa-job'`)).rows, [{ status: 'RETRY', leaseToken: null }])
  assert.deepEqual((await db.query(`SELECT status FROM "LegacyWhatsAppCutoverInbound"`)).rows, [{ status: 'NORMAL_UNKNOWN' }])
  await assert.rejects(() => resumeDispatchScope({ client: client as never, handle: recoveryHandle, actorId }), /BLOCKED_UNKNOWN/)
  await assert.rejects(() => switchRouting(recoveryHandle), /protected state/)
  console.log('WA expired leases reconcile; legacy and UNKNOWN guards remain; Instagram leases stay untouched: PASS')

  for (const entry of [
    { table: 'BotActionInbox', fields: '"deploymentId","deploymentGeneration"', values: "'wa-dep',3", status: 'ADMITTED', category: 'inbox' },
    { table: 'BotJob', fields: '"deploymentId","deploymentGeneration"', values: "'wa-dep',3", status: 'POISON', category: 'jobs' },
    { table: 'BotOutbox', fields: '"sessionId"', values: "'wa-session'", status: 'POISON', category: 'outbox' },
    { table: 'BotHandoff', fields: '"sessionId"', values: "'wa-session'", status: 'QUEUED', category: 'handoffs' },
    { table: 'BookingVisit', fields: '"sessionId"', values: "'ig-session'", status: 'HELD', category: 'holds' },
    { table: 'BookingDeposit', fields: '"source"', values: "'INSTAGRAM'", status: 'PROOF_RECEIVED', category: 'deposits' }
  ] as const) {
    await seed()
    await db.exec(`INSERT INTO "${entry.table}" (id,"businessId",${entry.fields},status) VALUES ('protected','biz',${entry.values},'${entry.status}')`)
    const result = await startActivationPreflight({ client: client as never, businessId: 'biz', expectedGeneration: 3, actorId, legacyCoverageComplete: true, timeoutMs: 0 })
    assert.equal(result.kind, 'BLOCKED', `${entry.table} must keep blocking WA activation`)
    assert.equal(result.snapshot.counts[entry.category], 1n)
    await assert.rejects(() => switchRouting(result.handle), /protected state/)
  }
  console.log('WA inbox/POISON/handoff and business-wide financial holds/review all retain activation guards: PASS')

  await seed()
  await db.exec(`INSERT INTO "BotActionInbox" (id,"businessId","deploymentId",status) VALUES ('orphan-inbox','biz','missing','ADMITTED');
    INSERT INTO "BotJob" (id,"businessId","deploymentId",status) VALUES ('orphan-job','biz','missing','POISON');
    INSERT INTO "BotOutbox" (id,"businessId","sessionId",status) VALUES ('orphan-outbox','biz','missing','POISON');
    INSERT INTO "BotHandoff" (id,"businessId","sessionId",status) VALUES ('orphan-handoff','biz','missing','QUEUED');
    INSERT INTO "BotDispatchClaim" (id,"businessId",channel,kind,status,"claimToken","claimedUntil") VALUES ('orphan-claim','biz','WHATSAPP','PROCESS','UNKNOWN','orphan',clock_timestamp());`)
  const orphanHandle = await pause()
  const orphanSnapshot = await collectActivationPreflight({ client: client as never, handle: orphanHandle })
  for (const category of ['inbox', 'jobs', 'outbox', 'handoffs', 'unknown'] as const) assert.equal(orphanSnapshot.counts[category], 1n, `unattributed ${category} remains protected`)
  await assert.rejects(() => switchRouting(orphanHandle), /protected state/)
  console.log('Unattributed/orphan work remains conservative and cannot permit a switch: PASS')

  await seed()
  await seedInstagramWork()
  const beforeResume = await instagramSnapshot()
  const resumeHandle = await pause()
  await resumeDispatchScope({ client: client as never, handle: resumeHandle, actorId })
  assert.deepEqual(await instagramSnapshot(), beforeResume)
  assert.equal((await db.query<{ paused: Date | null }>(`SELECT "claimsPausedAt" AS paused FROM "BotChannelDeployment" WHERE id='wa-dep'`)).rows[0]!.paused, null)
  await db.exec(`UPDATE "BotChannelDeployment" SET "claimsPausedAt"=clock_timestamp() WHERE id='ig-dep'`)
  const igPause = (await db.query<{ pausedAt: Date }>(`SELECT "claimsPausedAt" AS "pausedAt" FROM "BotChannelDeployment" WHERE id='ig-dep'`)).rows[0]!
  const wrongHandle = { businessId: 'biz', deploymentId: 'ig-dep', generation: 8, fenceEpoch: 9, pausedAt: igPause.pausedAt }
  const beforeWrongHandle = await instagramSnapshot()
  await assert.rejects(() => collectActivationPreflight({ client: client as never, handle: wrongHandle }), /stale dispatch pause handle/)
  await assert.rejects(() => waitForDispatchQuiescence({ client: client as never, handle: wrongHandle, timeoutMs: 0 }), /stale dispatch pause handle/)
  assert.deepEqual(await instagramSnapshot(), beforeWrongHandle)
  console.log('WA resume preserves Instagram; an Instagram deployment cannot be used as a WA pause handle: PASS')

  await seed()
  await db.exec(`INSERT INTO "Conversation" (id,"businessId","currentStep","selectedCustomerName") VALUES ('legacy','biz','ASK_CUSTOMER_NAME','Legacy draft')`)
  const rollbackHandle = await pause()
  const beforeRollback = (await db.query(`SELECT row_to_json(t)::text AS bytes FROM "BotSession" t ORDER BY id`)).rows
  failAudit = true
  await assert.rejects(() => switchRouting(rollbackHandle), /controlled audit rollback/)
  assert.deepEqual((await db.query(`SELECT row_to_json(t)::text AS bytes FROM "BotSession" t ORDER BY id`)).rows, beforeRollback)
  assert.deepEqual((await db.query(`SELECT status FROM "BotPrompt" WHERE id='wa-prompt'`)).rows, [{ status: 'OPEN' }])
  assert.equal((await switchRouting(rollbackHandle)).generation, 4)
  assert.deepEqual((await db.query(`SELECT "currentStep","selectedCustomerName" FROM "Conversation" WHERE id='legacy'`)).rows, [{ currentStep: 'START', selectedCustomerName: null }])
  console.log('WA switch remains atomic on audit failure and retains legitimate legacy draft reset: PASS')
} finally {
  await db.close()
}
