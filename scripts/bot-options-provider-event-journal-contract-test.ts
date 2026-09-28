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
import { admissionToAcceptanceDurationMs, parseOutboxTransitionId } from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'

const serverSource = readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('../src/bot-options/infrastructure/postgres-worker.ts', import.meta.url), 'utf8')
const processorSource = readFileSync(new URL('../src/bot-options/application/process-provider-event-job.ts', import.meta.url), 'utf8')
const sessionProcessorSource = readFileSync(new URL('../src/bot-options/application/process-session-job.ts', import.meta.url), 'utf8')
const outboxSenderSource = readFileSync(new URL('../src/bot-options/infrastructure/whatsapp-outbox-sender.ts', import.meta.url), 'utf8')
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

const staleStatements: Array<{ sql: string; values: readonly unknown[] }> = []
await classifier.classifyProviderEventTx({
  async $queryRaw(query: { strings?: readonly string[] }) {
    const sql = query.strings?.join('?') ?? String(query)
    if (sql.includes('FROM "Conversation"')) return []
    if (!sql.includes('FROM "BotPrompt"')) throw new Error(`unexpected stale query: ${sql}`)
    assert.ok(sql.includes('owner."phone"'), 'prompt lookup must bind the historical button to its sender')
    return [{
      promptId: 'prompt-old', sessionId: 'session-a', businessId: 'business-a',
      deploymentId: 'deployment-a', deploymentGeneration: 1, revision: 9n, stateRevision: 8n,
      mode: 'FUNCTIONAL', status: 'INVALIDATED', firstActionAt: null, lastActionAt: null,
      settleAt: null, absoluteAt: null, resolvedAt: new Date('2026-08-30T00:00:00.000Z'), choiceToken: 'B'.repeat(11),
      actionType: 'menu.browse_services', entityType: null, entityId: null, payload: {},
      labelSnapshot: 'Ver servicios y precios', sortOrder: 0, dbNow: new Date('2026-08-30T00:01:00.000Z')
    }]
  },
  async $executeRaw(query: { strings?: readonly string[]; values?: readonly unknown[] }) {
    staleStatements.push({ sql: query.strings?.join('?') ?? String(query), values: Array.isArray(query.values) ? query.values : [] })
    return 1
  }
} as never, {
  route: {
    kind: 'new', businessId: 'business-a', deploymentId: 'deployment-a', generation: 1,
    appSecret: null, appSecretPrevious: null, appSecretPreviousValidUntil: null
  },
  providerEventId: 'provider-event-stale-interactive',
  event: {
    kind: 'message', eventKey: 'wamid.stale', providerMessageId: 'wamid.stale',
    phoneNumberId: 'phone-a', displayPhoneNumber: null, fromPhone: '5491100000000',
    textBody: 'Ver servicios y precios', messageType: 'interactive',
    interactiveReplyId: `b1.${'A'.repeat(16)}.${'B'.repeat(11)}`,
    mediaType: null, mediaMimeType: null, mediaId: null, filename: null, providerOccurredAtIso: null
  }
})
const staleInbox = staleStatements.find(({ sql }) => sql.includes('INSERT INTO "BotActionInbox"'))
assert.ok(staleInbox?.values.some(value => typeof value === 'string' && value.includes('"contextWindowEvaluated":false')),
  'recovery cannot skip the 24-hour check unless admission really evaluated it')
assert.ok(staleInbox?.values.includes('system.stale_prompt'), 'a known old button must become a safe recovery action')
assert.ok(staleInbox?.values.includes('ADMITTED'), 'a known old button must be processed instead of discarded silently')
assert.ok(staleStatements.some(({ sql, values }) => sql.includes('INSERT INTO "BotJob"') && values.includes('PROCESS_INBOX')),
  'a known old button must enqueue one durable current-view refresh')
assert.ok(!staleStatements.some(({ sql }) => sql.includes('UPDATE "BotPrompt"') && sql.includes("'STABILIZING'")),
  'an old button must never stabilize or execute its historical choice')
assert.match(sessionProcessorSource, /stalePromptClassification[\s\S]*?withStalePromptNotice\(currentView\)/,
  'the recovery job must prepend the explanation and render the latest state, not the historical choice')
assert.match(sessionProcessorSource, /typeof eventPayload\.interactiveReplyId === 'string'[\s\S]*?stalePromptClassification: 'STALE_CUTOVER'/,
  'only interactive cutover recovery receives the old-button explanation')
assert.match(processorSource, /applyLazyContextWindowTx[\s\S]*?window\?\.kind === 'EXPIRED'[\s\S]*?classifyProviderEventTx/,
  'the 24-hour reset must finish before stale-button classification to avoid a duplicate explanation')

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

assert.match(sessionProcessorSource, /INSERT INTO "BotTransitionLog" \("id", "businessId", "sessionId", "deploymentId", "deploymentGeneration", "revisionFrom", "revisionTo", "actionType", "outcome", "providerEventId"\)[\s\S]*?\$\{forceFreshView \? 'system\.cutover_recovery' : 'system\.initial_view'\}, 'APPLIED', \$\{row\.providerEventId\}/,
  'initial-view transition evidence must retain its originating provider event for outbox correlation')
assert.match(outboxSenderSource, /latencyDiagnosticBusinessCodes\.size > 0[\s\S]*?businessJoin[\s\S]*?providerEventId/,
  'outbox correlation lookup must be opt-in behind the existing tenant allowlist')
assert.match(outboxSenderSource, /cohort: 'outbox_only'[\s\S]*?correlation:[\s\S]*?sourceProviderEventId/,
  'diagnostic records must explicitly scope the cohort and report missing correlation')
assert.match(outboxSenderSource, /admission_to_meta_acceptance[\s\S]*?accepted/,
  'outbox acceptance latency must be named as provider acceptance, not delivery')
assert.match(outboxSenderSource, /SELECT \$\{candidate\.customerCode\}::text AS "customerCode", event\."id" AS "providerEventId", event\."admittedAt"[\s\S]*?LEFT JOIN "BotProviderEvent" event ON event\."id" = transition\."providerEventId"[\s\S]*?event\."businessId" = transition\."businessId"/,
  'diagnostic correlation must return only the provider event that passed the tenant-scoped join')
assert.doesNotMatch(outboxSenderSource, /SELECT \$\{candidate\.customerCode\}::text AS "customerCode", transition\."providerEventId"/,
  'the unvalidated transition event id must never be reported when the joined event is absent')
assert.deepEqual(parseOutboxTransitionId('transition:session-a:12', 'session-a'), { kind: 'transition', revision: 12n })
assert.deepEqual(parseOutboxTransitionId('initial:session-a:0', 'session-a'), { kind: 'initial', revision: 0n })
for (const malformed of [
  'transition:session-b:12', 'transition:session-a:12:extra', 'transition::12', 'transition:session-a:',
  'transition:session-a:-1', 'transition:session-a:+1', 'transition:session-a:01',
  'transition:session-a:9223372036854775808', 'restart:session-a:12'
]) assert.equal(parseOutboxTransitionId(malformed, 'session-a'), null, `malformed transition must not correlate: ${malformed}`)
assert.equal(admissionToAcceptanceDurationMs(new Date(1000), new Date(1025)), 25)
assert.equal(admissionToAcceptanceDurationMs(new Date(1025), new Date(1000)), null)
assert.equal(admissionToAcceptanceDurationMs(new Date(Number.NaN), new Date(1025)), null)
assert.equal(admissionToAcceptanceDurationMs(new Date(1000), null), null)
console.log('OK provider-event journal: inbound CRM evidence survives classification failure.')
