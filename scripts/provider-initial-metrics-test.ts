import assert from 'node:assert/strict'
import { processProviderEventJob } from '../src/bot-options/application/process-provider-event-job.js'
import { withAttemptMetrics, type AttemptMetricEvent } from '../src/bot-options/observability/attempt-metrics.js'
import type { ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'

const job: ClaimedBotJob = { id: 'private-job', kind: 'PROCESS_PROVIDER_EVENT', aggregateId: 'event', businessId: 'business',
  deploymentId: 'deployment', deploymentGeneration: 1, expectedRevision: null, attempts: 1, maxAttempts: 3,
  claimToken: 'private-token', claimedUntil: new Date(), queueWaitMs: 0 }
for (const fail of [null, 'projection', 'classification'] as const) {
  const events: AttemptMetricEvent[] = []
  const original = new Error('private transaction error')
  let commits = 0
  let transactions = 0
  const client = {
    async $transaction<T>(body: (tx: unknown) => Promise<T>) {
      transactions++
      if (fail === (transactions === 1 ? 'projection' : 'classification')) throw original
      const result = await body({
        async $executeRaw() { return 1 },
        async $queryRaw(query: { strings: readonly string[] }) {
          const sql = query.strings.join('?')
          if (sql.includes('FROM "BotJob" j') && sql.includes('JOIN "BotProviderEvent"')) return [{ eventType: 'STATUS' }]
          if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: job.id }]
          if (sql.includes('FROM "BotChannelDeployment"')) return [{ id: job.deploymentId, generation: 1 }]
          if (sql.includes('FROM "BotProviderEvent"')) return [{ status: 'PROCESSED' }]
          throw new Error('unexpected fixture query')
        }
      })
      commits++
      return result
    }
  }
  const operation = withAttemptMetrics({ jobId: job.id, attempt: 1 }, () => processProviderEventJob({ client: client as never, job }), {
    emit: event => events.push(event)
  })
  if (fail) await assert.rejects(operation, error => error === original)
  else assert.equal(await operation, 'PROCESSED')
  assert.equal(transactions, fail === 'projection' ? 1 : 2)
  assert.equal(commits, fail === 'projection' ? 0 : fail === 'classification' ? 1 : 2)
  assert.ok(events.some(event => event.stage === 'provider_projection_transaction_total'))
  if (fail !== 'projection') assert.ok(events.some(event => event.stage === 'provider_classification_transaction_total'))
  assert.doesNotMatch(JSON.stringify(events), /private/)
}
console.log('PASS provider initial metrics: independent commits, success and acquisition failures')

const { subscribeToCrmRealtimeEvents } = await import('../src/services/crm-realtime-events.js')
for (const commitFails of [false, true]) {
  let transactions = 0
  let committed = false
  let queries = 0
  const statements: string[] = []
  const visible: string[] = []
  const spans: AttemptMetricEvent[] = []
  const error = new Error('private commit or classification')
  const unsubscribe = subscribeToCrmRealtimeEvents({ businessId: job.businessId, send(event) {
    if (event.type === 'conversation_message_received') {
      assert.equal(committed, true, 'CRM publication only after confirmed commit')
      visible.push(event.messageId)
    }
  } })
  const client = { async $transaction<T>(body: (tx: unknown) => Promise<T>) {
    transactions++
    if (transactions === 2) throw error
    const result = await body({
      async $executeRaw(query: { strings: readonly string[] }) { queries++; statements.push(query.strings.join('?') ); return 1 },
      async $queryRaw(query: { strings: readonly string[] }) {
        queries++
        const sql = query.strings.join('?')
        statements.push(sql)
        if (sql.includes('"BotProviderEvent" e')) return [{ id: job.aggregateId, businessId: job.businessId,
          eventType: 'MESSAGE', providerMessageId: 'private-message', payload: { fromPhone: 'private-phone', textBody: 'private-body', messageType: 'text' } }]
        if (sql.includes('provider-consolidation-session-lock')) return []
        if (sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation' }]
        if (sql.includes('INSERT INTO "Message"')) return [{ conversationId: 'conversation', messageId: job.aggregateId }]
        throw new Error('unexpected projection query')
      }
    })
    if (commitFails) throw error
    committed = true
    return result
  } }
  try {
    await assert.rejects(withAttemptMetrics({ jobId: job.id, attempt: 1 }, () => processProviderEventJob({ client: client as never, job }), {
      emit(event) { spans.push(event); throw new Error('sink unavailable') }
    }), failure => failure === error)
  } finally { unsubscribe() }
  const jobLock = statements.findIndex(sql => sql.includes('FOR UPDATE OF j'))
  const phoneGate = statements.findIndex(sql => sql.includes('pg_advisory_xact_lock('))
  assert.ok(phoneGate >= 0 && phoneGate < jobLock, 'projection conversation fence precedes job/deployment/event locks')
  assert.equal(queries, 7, 'identity read and conversation/session fences are explicit, not hidden telemetry queries')
  assert.equal(transactions, commitFails ? 1 : 2)
  assert.deepEqual(visible, commitFails ? [] : [job.aggregateId])
  assert.ok(spans.some(event => event.stage === 'provider_projection_message'))
  assert.equal(spans.find(event => event.stage === 'provider_projection_transaction_total')!.outcome, commitFails ? 'error' : 'ok')
  assert.doesNotMatch(JSON.stringify(spans), /private-message|private-phone|private-body|private commit/)
}
console.log('PASS provider initial metrics: seven statements with explicit fences, CRM postcommit, rollback and sink fail-open')

// Covered raw journal events still project CRM, but classification never replays a settled event.
const phases: string[][] = []
const row = { id: job.aggregateId, eventType: 'MESSAGE', businessId: job.businessId, status: 'PROCESSED',
  payload: { fromPhone: '5491100000000', textBody: 'synthetic', messageType: 'text' }, providerMessageId: 'synthetic' }
const coveredClient = { async $transaction<T>(body: (tx: unknown) => Promise<T>) {
  const phase: string[] = []; phases.push(phase)
  return body({
    async $executeRaw(query: { strings: readonly string[] }) { phase.push(query.strings.join('?')); return 1 },
    async $queryRaw(query: { strings: readonly string[] }) {
      const sql = query.strings.join('?'); phase.push(sql)
      if (sql.includes('provider-consolidation-identity')) return [row]
      if (sql.includes('provider-consolidation-session-lock')) return []
      if (sql.includes('FROM "BotJob" j') && sql.includes('JOIN "BotProviderEvent"')) return [row]
      if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: job.id }]
      if (sql.includes('FROM "BotChannelDeployment"')) return [{ id: job.deploymentId, generation: 1 }]
      if (sql.includes('FROM "BotProviderEvent"')) return [row]
      if (sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation' }]
      if (sql.includes('INSERT INTO "Message"')) return [{ conversationId: 'conversation', messageId: job.aggregateId }]
      throw new Error('covered event must not classify or create another inbox')
    }
  })
} }
assert.equal(await processProviderEventJob({ client: coveredClient as never, job }), 'PROCESSED')
assert.equal(phases.length, 2)
for (const phase of phases) {
  const exclusive = phase.findIndex(sql => sql.includes('pg_advisory_xact_lock('))
  const rowLock = phase.findIndex(sql => sql.includes('FOR UPDATE'))
  assert.ok(exclusive > 0 && rowLock > exclusive, 'both phases gate before every locked row snapshot')
}
assert.ok(phases[0]!.some(sql => sql.includes('INSERT INTO "Message"')))
assert.ok(!phases[1]!.some(sql => sql.includes('BotActionInbox') || sql.includes('lazy-context')))
console.log('PASS covered provider event: CRM preserved, both phase fences, no late classification replay')