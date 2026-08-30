import assert from 'node:assert/strict'
import { Prisma } from '../src/generated/prisma/client.js'
import { menuView, textView } from '../src/bot-options/domain/views.js'
import {
  persistView,
  PROCESS_INBOX_TRANSACTION_OPTIONS,
  PROCESS_SESSION_TRANSACTION_OPTIONS,
  runCommittedProcessSession,
  runProcessInboxTransaction
} from '../src/bot-options/application/process-session-job.js'
import { BotOptionsMetrics } from '../src/bot-options/observability/metrics.js'
import { withDispatchClaimCleanup } from '../src/bot-options/infrastructure/dispatch-claims.js'

type CapturedSql = { kind: 'sql'; sql: string; text: string; values: unknown[] }
type CapturedTaggedTemplate = { kind: 'tagged'; strings: readonly string[]; values: unknown[] }
type CapturedWrite = CapturedSql | CapturedTaggedTemplate

function inspectSql(query: Prisma.Sql): CapturedSql {
  const sql = query as unknown as { sql?: string; text?: string; values?: unknown[] }
  return { kind: 'sql', sql: sql.sql ?? '', text: sql.text ?? '', values: Array.isArray(sql.values) ? sql.values : [] }
}

function createStagingClient() {
  const committed: CapturedWrite[] = []
  const transactionOptions: unknown[] = []
  const timeline: string[] = []
  const tx = {
    $executeRaw: async (query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]) => {
      const write: CapturedWrite = Array.isArray(query)
        ? { kind: 'tagged', strings: [...query], values }
        : inspectSql(query)
      staged.push(write)
      timeline.push(`staged:${write.kind}`)
      return 1
    },
    $queryRaw: async (query: Prisma.Sql) => {
      const write = inspectSql(query)
      staged.push(write)
      timeline.push('staged:sql')
      if (write.sql.includes('inserted_choices AS')) return [{ choiceCount: 2n, outboxCount: 2n }]
      return []
    }
  }
  let staged: CapturedWrite[] = []
  const client = {
    $queryRaw: async () => [],
    $executeRaw: async () => { throw new Error('writes must use the transaction client') },
    $transaction: async <T>(operation: (transaction: typeof tx) => Promise<T>, options: unknown): Promise<T> => {
      transactionOptions.push(options)
      staged = []
      try {
        const result = await operation(tx)
        committed.push(...staged)
        timeline.push('committed')
        staged = []
        return result
      } catch (error) {
        staged = []
        timeline.push('discarded')
        throw error
      }
    }
  }
  return { client, committed, transactionOptions, timeline }
}

function view() {
  const result = menuView('Elegí', [
    { actionType: 'menu.start_booking', label: 'Sacar un turno' },
    { actionType: 'menu.browse_services', label: 'Ver servicios' }
  ])
  result.informativeTexts = ['Información previa']
  return result
}

async function persist(tx: any, id: number) {
  await persistView(tx, {
    businessId: 'business-1', sessionId: 'session-1', revision: BigInt(8 + id), transitionId: `transition-${id}`,
    toPhone: '+5491100000000', view: view(), dbNow: new Date('2026-08-29T12:00:00.000Z'),
    promptToken: 'AAAAAAAAAAAAAAAA', idFactory: () => `id-${++id}`
  })
}

// Exercise the real committed-session boundary and the real persistView Prisma.Sql writes.
const success = createStagingClient()
let successPostCommitCalls = 0
await runCommittedProcessSession({
  client: success.client as any,
  operation: async (tx) => {
    await persist(tx, 1)
    return 'persisted'
  },
  postCommit: async (result) => {
    assert.equal(result, 'persisted')
    assert.equal(success.committed.length, 3, 'post-commit cannot run until all FK-ordered persistence statements commit')
    assert.equal(success.timeline.at(-1), 'committed')
    success.timeline.push('postCommit')
    successPostCommitCalls += 1
  }
})
assert.deepEqual(success.transactionOptions, [{ maxWait: 2_000, timeout: 10_000 }])
assert.deepEqual(PROCESS_SESSION_TRANSACTION_OPTIONS, { maxWait: 2_000, timeout: 10_000 })
assert.ok(PROCESS_SESSION_TRANSACTION_OPTIONS.maxWait + PROCESS_SESSION_TRANSACTION_OPTIONS.timeout < 30_000)
assert.equal(successPostCommitCalls, 1)
assert.equal(success.timeline.at(-1), 'postCommit')
assert.equal(success.committed.length, 3, 'invalidation, prompt, then combined choices+outbox')

const sqlWrites = success.committed.filter((write): write is CapturedSql => write.kind === 'sql')
const choices = sqlWrites.filter((query) => query.sql.includes('INSERT INTO "BotPromptChoice"'))
const outbox = sqlWrites.filter((query) => query.sql.includes('INSERT INTO "BotOutbox"'))
assert.equal(choices.length, 1, 'one bulk PromptChoice insert')
assert.equal(outbox.length, 1, 'outbox is bulk-inserted in the combined persistence CTE')
const compact = (value: string) => value.replace(/\s+/g, '')
assert.ok(compact(choices[0].sql).includes('VALUES(?,?,?,?,?,?,?::jsonb,?,?),(?,?,?,?,?,?,?::jsonb,?,?)'))
assert.ok(compact(choices[0].text).includes('VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9),($10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18)'))
assert.deepEqual(choices[0].values.slice(0, 18).map((value, index) => index === 2 || index === 11 ? typeof value : value), [
  'id-3', 'id-2', 'string', 'menu.start_booking', null, null, null, 'Sacar un turno', 0,
  'id-4', 'id-2', 'string', 'menu.browse_services', null, null, null, 'Ver servicios', 1
])
assert.notEqual(choices[0].values[2], choices[0].values[11], 'choice tokens remain distinct')
assert.ok(compact(outbox[0].sql).includes(`invalidatedAS(SELECTNULL::textAS"id"WHEREFALSE),inserted_choicesAS(`),
  'interactive persistence keeps invalidation and prompt insertion in prior ordered statements')
assert.ok(compact(outbox[0].sql).includes(`inserted_outboxAS(INSERTINTO"BotOutbox"`))
assert.ok(compact(outbox[0].sql).includes(`SELECT(SELECTcount(*)FROMinserted_choices)::bigintAS"choiceCount",(SELECTcount(*)FROMinserted_outbox)::bigintAS"outboxCount"`))
assert.ok(outbox[0].values.includes('transition-1:0') && outbox[0].values.includes('transition-1:1'), 'both idempotency keys remain in one bulk insert')
const prompt = sqlWrites.find((query) => query.sql.includes('INSERT INTO "BotPrompt"'))
assert.ok(prompt)
assert.ok(prompt.sql.includes('"outboxMessageId"'))
assert.equal(prompt.values.at(-1), 'id-7', 'interactive outbox link is persisted before choices reference the prompt')
assert.equal(success.committed.some((write) => write.kind === 'tagged'), false, 'no follow-up prompt update round trip')

const textWrites: CapturedSql[] = []
await persistView({
  $executeRaw: async () => { throw new Error('text-only view must persist in one statement') },
  $queryRaw: async (query: Prisma.Sql) => {
    textWrites.push(inspectSql(query))
    return [{ choiceCount: 0n, outboxCount: 1n }]
  }
} as any, {
  businessId: 'business-1', sessionId: 'session-1', revision: 20n, transitionId: 'text-transition',
  toPhone: '+5491100000000', view: textView('Listo'), dbNow: new Date('2026-08-29T12:00:00.000Z'),
  promptToken: 'BBBBBBBBBBBBBBBB', idFactory: (() => { let id = 0; return () => `text-id-${++id}` })()
})
assert.equal(textWrites.length, 1, 'text-only view consolidates invalidation and outbox from two round trips to one')
assert.ok(textWrites[0]!.sql.includes('UPDATE "BotPrompt"') && textWrites[0]!.sql.includes('INSERT INTO "BotOutbox"'))
assert.equal(textWrites[0]!.sql.includes('INSERT INTO "BotPrompt"'), false)
assert.equal(textWrites[0]!.sql.includes('INSERT INTO "BotPromptChoice"'), false)

// Claim cleanup is skipped only after a transaction promise has resolved and marked settlement.
function cleanupClient(input: { failCommit?: boolean } = {}) {
  let releases = 0
  const client = {
    $queryRaw: async () => [],
    $executeRaw: async (query: Prisma.Sql) => {
      if (inspectSql(query).sql.includes('UPDATE "BotDispatchClaim"')) releases += 1
      return 1
    },
    $transaction: async <T>(operation: (tx: object) => Promise<T>) => {
      const result = await operation({})
      if (input.failCommit) throw new Error('forced commit failure')
      return result
    }
  }
  return { client, releases: () => releases }
}

const settledCleanup = cleanupClient()
await withDispatchClaimCleanup(settledCleanup.client as any, 'settled-token', async (markSettled) => {
  await settledCleanup.client.$transaction(async () => 'committed')
  markSettled()
})
assert.equal(settledCleanup.releases(), 0, 'committed transactional settlement removes the redundant release round trip')

const failedCleanup = cleanupClient({ failCommit: true })
await assert.rejects(() => withDispatchClaimCleanup(failedCleanup.client as any, 'failed-token', async (markSettled) => {
  await failedCleanup.client.$transaction(async () => 'callback-complete')
  markSettled()
}), /forced commit failure/)
assert.equal(failedCleanup.releases(), 1, 'commit failure leaves settlement unmarked and releases the claim')

const earlyFailureCleanup = cleanupClient()
await assert.rejects(() => withDispatchClaimCleanup(earlyFailureCleanup.client as any, 'early-token', async () => {
  throw new Error('forced pre-commit failure')
}), /forced pre-commit failure/)
assert.equal(earlyFailureCleanup.releases(), 1, 'pre-commit failure releases the claim')

const postCommitFailureCleanup = cleanupClient()
await assert.rejects(() => withDispatchClaimCleanup(postCommitFailureCleanup.client as any, 'post-token', async (markSettled) => {
  markSettled()
  throw new Error('forced post-commit failure')
}), /forced post-commit failure/)
assert.equal(postCommitFailureCleanup.releases(), 0, 'post-commit failure does not issue a redundant release')

// A rejection after real persistence must discard all staged writes and skip post-commit.
const rollback = createStagingClient()
let rollbackPostCommitCalls = 0
await assert.rejects(() => runCommittedProcessSession({
  client: rollback.client as any,
  operation: async (tx) => {
    await persist(tx, 2)
    throw new Error('forced rollback after persistView')
  },
  postCommit: () => { rollbackPostCommitCalls += 1 }
}), /forced rollback after persistView/)
assert.deepEqual(rollback.transactionOptions, [{ maxWait: 2_000, timeout: 10_000 }])
assert.equal(rollback.committed.length, 0)
assert.equal(rollbackPostCommitCalls, 0)
assert.deepEqual(rollback.timeline.slice(-1), ['discarded'])

// Initial inbox work creates or recovers a session and persists its first view.
// It therefore needs the same bounded budget as subsequent session transitions.
const inbox = createStagingClient()
await runProcessInboxTransaction(inbox.client as any, async (tx) => {
  await tx.$executeRaw(Prisma.sql`SELECT 1`)
  return 'inbox-persisted'
})
assert.deepEqual(inbox.transactionOptions, [{ maxWait: 2_000, timeout: 10_000 }])
assert.deepEqual(PROCESS_INBOX_TRANSACTION_OPTIONS, { maxWait: 2_000, timeout: 10_000 })
assert.ok(PROCESS_INBOX_TRANSACTION_OPTIONS.maxWait + PROCESS_INBOX_TRANSACTION_OPTIONS.timeout < 30_000)

const metrics = new BotOptionsMetrics()
metrics.observe('session_context_load', 1); metrics.observe('session_effects', 1)
metrics.observe('session_persist_view', 1); metrics.observe('session_critical_transaction', 1)
metrics.observe('worker_claim', 1); metrics.observe('worker_processing', 1); metrics.observe('worker_finalize', 1)
metrics.observe('outbox_claim', 1); metrics.observe('outbox_preflight', 1); metrics.observe('outbox_finalize', 1)
assert.equal(metrics.snapshot().durations.session_critical_transaction.count, 1)

console.log('OK F11 timeout contract: committed-session options, real persistence SQL bulk alignment, and rollback boundary.')
