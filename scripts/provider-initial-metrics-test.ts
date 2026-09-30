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
      async $executeRaw() { queries++; return 1 },
      async $queryRaw(query: { strings: readonly string[] }) {
        queries++
        const sql = query.strings.join('?')
        if (sql.includes('"BotProviderEvent" e')) return [{ id: job.aggregateId, businessId: job.businessId,
          eventType: 'MESSAGE', providerMessageId: 'private-message', payload: { fromPhone: 'private-phone', textBody: 'private-body', messageType: 'text' } }]
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
  assert.equal(queries, 4, 'no extra queries for metrics')
  assert.equal(transactions, commitFails ? 1 : 2)
  assert.deepEqual(visible, commitFails ? [] : [job.aggregateId])
  assert.ok(spans.some(event => event.stage === 'provider_projection_message'))
  assert.equal(spans.find(event => event.stage === 'provider_projection_transaction_total')!.outcome, commitFails ? 'error' : 'ok')
  assert.doesNotMatch(JSON.stringify(spans), /private-message|private-phone|private-body|private commit/)
}
console.log('PASS provider initial metrics: four statements, CRM postcommit, rollback and sink fail-open')
