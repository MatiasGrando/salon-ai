import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  processProviderEventJob,
  providerEventInboundMessageMetadata
} from '../src/bot-options/application/process-provider-event-job.js'
import {
  subscribeToCrmRealtimeEvents
} from '../src/services/crm-realtime-events.js'
import type { ClaimedBotJob } from '../src/bot-options/infrastructure/postgres-worker.js'
import { PrismaAuthoritativeAdmissionRepository } from '../src/bot-options/infrastructure/prisma-admission.js'

const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('../src/bot-options/infrastructure/postgres-worker.ts', import.meta.url), 'utf8')
const processorSource = readFileSync(new URL('../src/bot-options/application/process-provider-event-job.ts', import.meta.url), 'utf8')
assert.match(serverSource, /job\.kind === 'PROCESS_PROVIDER_EVENT'[\s\S]*?processProviderEventJob/,
  'the production worker handler must dispatch provider-event jobs')
assert.equal(
  workerSource.match(/j\."kind" = 'PROCESS_PROVIDER_EVENT' OR NOT/g)?.length,
  2,
  'provider-event classification must remain claimable for human-owned sessions in selection and fenced update'
)
assert.match(workerSource, /CUTOVER_RETARGETABLE_JOB_KINDS = \['RECEIVE_DEPOSIT_PROOF', 'PROCESS_PROVIDER_EVENT'\]/,
  'a deployment generation change must not strand an acknowledged provider event')
assert.match(processorSource, /currentDeploymentTx[\s\S]*?retargetClaimedBotJobTx/,
  'classification must retarget an older journal job to the current deployment before interpreting it')
assert.doesNotMatch(
  processorSource,
  /const activeJob =[\s\S]*?await assertClaimedBotJobTx\(tx, activeJob\)[\s\S]*?loadProviderEventTx/,
  'classification must not repeat the claimed-job lock after the same transaction already locked or retargeted it'
)

assert.deepEqual(providerEventInboundMessageMetadata({
  messageType: 'document', mediaType: 'document', mediaId: 'media-safe-id',
  mediaMimeType: 'application/pdf', filename: 'turno.pdf', interactiveReplyId: 'b1.secret.secret'
}), {
  provider: 'whatsapp', source: 'bot-options-journal', messageType: 'document',
  media: { type: 'document', id: 'media-safe-id', mimeType: 'application/pdf', filename: 'turno.pdf' }
}, 'journal projection must preserve downloadable media without retaining interactive action tokens')

const classificationStatements: Array<{ sql: string; values: readonly unknown[] }> = []
const classifier = new PrismaAuthoritativeAdmissionRepository({} as never)
await classifier.classifyProviderEventTx({
  async $queryRaw(query: { strings?: readonly string[] }) {
    const sql = query.strings?.join('?') ?? String(query)
    if (sql.includes('FROM "Conversation"')) return []
    if (!sql.includes('FROM "BotPrompt"')) throw new Error(`unexpected classification query: ${sql}`)
    return [{
      promptId: 'prompt-a', sessionId: 'session-a', businessId: 'business-a',
      deploymentId: 'deployment-a', deploymentGeneration: 1, revision: 0n, stateRevision: 0n,
      mode: 'FUNCTIONAL', status: 'OPEN', firstActionAt: null, lastActionAt: null,
      settleAt: null, absoluteAt: null, resolvedAt: null, choiceToken: 'B'.repeat(11),
      actionType: 'menu.browse_services', entityType: null, entityId: null, payload: {},
      labelSnapshot: 'Ver servicios y precios', sortOrder: 0,
      dbNow: new Date('2026-08-30T00:00:00.000Z')
    }]
  },
  async $executeRaw(query: { strings?: readonly string[]; values?: readonly unknown[] }) {
    classificationStatements.push({
      sql: query.strings?.join('?') ?? String(query),
      values: Array.isArray(query.values) ? query.values : []
    })
    return 1
  }
} as never, {
  route: {
    kind: 'new', businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
    appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null
  },
  providerEventId: 'provider-event-interactive',
  event: {
    kind: 'message', eventKey: 'wamid.interactive', providerMessageId: 'wamid.interactive',
    phoneNumberId: 'phone-a', displayPhoneNumber: null, fromPhone: '5491100000000',
    textBody: 'Ver servicios y precios', messageType: 'interactive',
    interactiveReplyId: `b1.${'A'.repeat(16)}.${'B'.repeat(11)}`,
    mediaType: null, mediaMimeType: null, mediaId: null, filename: null, providerOccurredAtIso: null
  }
})
assert.ok(classificationStatements.some(({ sql }) => sql.includes('INSERT INTO "BotActionInbox"')),
  'worker classification must persist the real interactive reply')
assert.ok(classificationStatements.some(({ sql }) => sql.includes('UPDATE "BotPrompt"')),
  'worker classification must stabilize the selected prompt')
assert.ok(classificationStatements.some(({ sql, values }) => sql.includes('INSERT INTO "BotJob"') && values.includes('RECONCILE_PROMPT')),
  'worker classification must enqueue prompt reconciliation')

const callbackStatements: string[] = []
const callbackResult = await classifier.classifyProviderEventTx({
  async $executeRaw(query: { strings?: readonly string[] }) {
    const sql = query.strings?.join('?') ?? String(query)
    callbackStatements.push(sql)
    return 1
  },
  async $queryRaw(query: { strings?: readonly string[] }) {
    const sql = query.strings?.join('?') ?? String(query)
    callbackStatements.push(sql)
    if (sql.includes('UPDATE "Message"')) return [{ conversationId: 'conversation-a', messageId: 'outbox-a' }]
    throw new Error(`unexpected callback query: ${sql}`)
  }
} as never, {
  route: {
    kind: 'new', businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
    appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null
  },
  providerEventId: 'provider-event-status',
  event: {
    kind: 'status', eventKey: 'wamid.outbound:failed', providerMessageId: 'wamid.outbound',
    phoneNumberId: 'phone-a', status: 'failed', recipientPhone: null,
    providerOccurredAtIso: null, errorMessage: 'recipient unavailable'
  }
})
assert.deepEqual(callbackResult.outboundMessage, {
  businessId: 'business-a', conversationId: 'conversation-a', messageId: 'outbox-a'
}, 'a failed Meta callback must identify the CRM message that changed')
assert.ok(callbackStatements.some((sql) => sql.includes('UPDATE "Message"') && sql.includes('"providerErrorMessage"')),
  'a failed Meta callback must durably mark the visible CRM response as failed')
assert.match(processorSource, /const result = await input\.client\.\$transaction[\s\S]*?flushOutboundConversationMessages\(outbound\)/,
  'the failed callback update must refresh the CRM only after its transaction commits')

const job: ClaimedBotJob = {
  id: 'provider-job-a',
  kind: 'PROCESS_PROVIDER_EVENT',
  aggregateId: 'provider-event-a',
  businessId: 'business-a',
  deploymentId: 'deployment-a',
  deploymentGeneration: 1,
  expectedRevision: null,
  attempts: 1,
  maxAttempts: 5,
  claimToken: 'claim-a',
  claimedUntil: new Date('2026-08-30T01:00:00.000Z'),
  queueWaitMs: 0
}

let transactionNumber = 0
let projectionDatabaseRoundTrips = 0
const committedSql: string[] = []
const client = {
  async $transaction<T>(operation: (tx: unknown) => Promise<T>): Promise<T> {
    transactionNumber += 1
    if (transactionNumber === 2) throw new Error('simulated classification failure')
    const tx = {
      async $executeRaw(query: { strings?: readonly string[] }) {
        if (transactionNumber === 1) projectionDatabaseRoundTrips += 1
        committedSql.push(query.strings?.join('?') ?? String(query))
        return 1
      },
      async $queryRaw(query: { strings?: readonly string[] }) {
        if (transactionNumber === 1) projectionDatabaseRoundTrips += 1
        const sql = query.strings?.join('?') ?? String(query)
        committedSql.push(sql)
        if (sql.includes('SELECT j."id" FROM "BotJob"')) return [{ id: job.id }]
        if (sql.includes('"BotProviderEvent" e')) {
          return [{
            id: job.aggregateId,
            businessId: job.businessId,
            deploymentId: job.deploymentId,
            deploymentGeneration: job.deploymentGeneration,
            eventType: 'MESSAGE',
            providerMessageId: 'wamid.provider-event-a',
            payload: {
              kind: 'message', fromPhone: '5491100000000', textBody: 'Ver servicios y precios',
              messageType: 'interactive', interactiveReplyId: 'b1.AAAAAAAAAAAAAAAA.BBBBBBBBBBB'
            },
            status: 'ADMITTED'
          }]
        }
        if (sql.includes('INSERT INTO "Conversation"')) return [{ id: 'conversation-a' }]
        if (sql.includes('INSERT INTO "Message"')) {
          return [{ conversationId: 'conversation-a', messageId: 'provider-event-a' }]
        }
        throw new Error(`unexpected projection query: ${sql}`)
      }
    }
    return operation(tx)
  }
}

const visibleMessages: string[] = []
const unsubscribe = subscribeToCrmRealtimeEvents({
  businessId: job.businessId,
  send(event) {
    if (event.type === 'conversation_message_received') visibleMessages.push(event.messageId)
  }
})
try {
  await assert.rejects(
    () => processProviderEventJob({ client: client as never, job }),
    /simulated classification failure/
  )
} finally {
  unsubscribe()
}

assert.equal(transactionNumber, 2, 'projection and classification must have independent commits')
assert.equal(projectionDatabaseRoundTrips, 4,
  'durable inbound projection must use at most four sequential database round trips')
assert.ok(committedSql.some((sql) => sql.includes('INSERT INTO "Message"')),
  'the inbound client message must be durably projected before classification')
assert.deepEqual(visibleMessages, ['provider-event-a'],
  'a committed inbound message must reach the CRM even when classification fails afterward')

console.log('OK provider-event journal: inbound CRM evidence survives classification failure.')
