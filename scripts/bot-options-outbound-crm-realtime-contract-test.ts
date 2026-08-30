import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  collectOutboundConversationMessage,
  flushOutboundConversationMessages,
  subscribeToCrmRealtimeEvents
} from '../src/services/crm-realtime-events.js'
import {
  outboundMessageMetadata,
  sendClaimedOutbox,
  type ClaimedOutbox
} from '../src/bot-options/infrastructure/whatsapp-outbox-sender.js'

const senderSource = readFileSync(
  new URL('../src/bot-options/infrastructure/whatsapp-outbox-sender.ts', import.meta.url),
  'utf8'
)

assert.match(senderSource, /ON CONFLICT \("providerMessageId"\) DO NOTHING\s+RETURNING "id", "conversationId"/,
  'only an inserted Message may be eligible for outbound SSE')
assert.match(senderSource, /const pendingCrmEvents[\s\S]*?await input\.client\.\$transaction[\s\S]*?flushOutboundConversationMessages\(pendingCrmEvents\)/,
  'outbound SSE must be flushed strictly after the accepted transaction commits')
assert.match(senderSource, /collectOutboundConversationMessage\(pendingCrmEvents,\s*\{[\s\S]*?businessId: input\.item\.businessId/,
  'the committed projection must retain its authoritative tenant')

const buttonMetadata = outboundMessageMetadata({
  item: {
    type: 'interactive', mode: 'buttons', actionIds: ['b1.prompt-secret.choice-secret'],
    buttons: [{ id: 'b1.prompt-secret.choice-secret', title: 'Reservar' }],
    promptToken: 'prompt-secret', choiceId: 'choice-secret'
  }
})
assert.deepEqual(buttonMetadata, {
  provider: 'whatsapp', source: 'bot-options', kind: 'interactive',
  interactive: { mode: 'buttons', buttons: [{ title: 'Reservar' }] }
})

const listMetadata = outboundMessageMetadata({
  item: {
    type: 'interactive', mode: 'list', actionIds: ['b1.prompt-secret.choice-secret'],
    rows: [{ id: 'b1.prompt-secret.choice-secret', title: 'Corte', description: 'Desde $20.000' }],
    buttonText: 'Elegí una opción', sectionTitle: 'Servicios', promptToken: 'prompt-secret'
  }
})
assert.deepEqual(listMetadata, {
  provider: 'whatsapp', source: 'bot-options', kind: 'interactive',
  interactive: {
    mode: 'list', rows: [{ title: 'Corte', description: 'Desde $20.000' }],
    buttonText: 'Elegí una opción', sectionTitle: 'Servicios'
  }
})
assert.doesNotMatch(JSON.stringify({ buttonMetadata, listMetadata }), /actionIds|prompt-secret|choice-secret|"id"/,
  'durable metadata must not retain action IDs, prompt tokens, or internal choice IDs')

const glowEvents: string[] = []
const otherEvents: string[] = []
const unsubscribeGlow = subscribeToCrmRealtimeEvents({
  businessId: 'glow',
  send: (event) => { if (event.type === 'conversation_message_sent') glowEvents.push(event.messageId) }
})
const unsubscribeOther = subscribeToCrmRealtimeEvents({
  businessId: 'other',
  send: (event) => { if (event.type === 'conversation_message_sent') otherEvents.push(event.messageId) }
})

const committed = [] as Array<{ businessId: string; conversationId: string; messageId: string }>
collectOutboundConversationMessage(committed, { businessId: 'glow', conversationId: 'conversation-1', messageId: 'message-1' })
assert.deepEqual(glowEvents, [], 'no outbound SSE before commit')
flushOutboundConversationMessages(committed)
assert.deepEqual(glowEvents, ['message-1'], 'committed outbound Message must notify its tenant')
assert.deepEqual(otherEvents, [], 'outbound SSE must not cross tenant boundaries')

// Conflict produces no collected row; rollback skips flush. Both emit nothing.
flushOutboundConversationMessages([])
const rolledBack = [] as Array<{ businessId: string; conversationId: string; messageId: string }>
collectOutboundConversationMessage(rolledBack, { businessId: 'glow', conversationId: 'conversation-1', messageId: 'rolled-back' })
assert.deepEqual(glowEvents, ['message-1'], 'conflict and rollback must not emit duplicate or phantom SSE')

unsubscribeGlow()
unsubscribeOther()

type SenderScenario = 'inserted' | 'conflict' | 'rollback-after-insert'

function senderClient(scenario: SenderScenario) {
  let transactionNumber = 0
  const transactions: string[] = []
  const client = {
    async $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      transactionNumber += 1
      const currentTransaction = transactionNumber
      let queryNumber = 0
      transactions.push(`tx-${currentTransaction}`)
      const tx = {
        async $executeRaw() { return 1 },
        async $queryRaw() {
          queryNumber += 1
          if (currentTransaction === 1) return [{ claimToken: 'dispatch-token' }]
          if (currentTransaction === 2) return [{ outboxCount: 1n, dispatchCount: 1n }]
          if (currentTransaction === 3 && queryNumber === 1) return [{ outboxCount: 1n, dispatchCount: 1n }]
          if (currentTransaction === 3 && queryNumber === 2) {
            if (scenario === 'conflict') return []
            return [{ id: 'persisted-message', conversationId: 'conversation-sender' }]
          }
          if (currentTransaction === 4) return [{ outboxCount: 1n, dispatchCount: 1n }]
          return []
        }
      }
      const result = await callback(tx)
      if (currentTransaction === 3 && scenario === 'rollback-after-insert') {
        throw new Error('simulated accepted transaction rollback')
      }
      return result
    },
    async $executeRaw() { return 1 },
    async $queryRaw() { return [] }
  }
  return { client, transactions }
}

const claimedItem: ClaimedOutbox = {
  id: 'outbox-1',
  businessId: 'sender-business',
  sessionId: 'session-1',
  payload: {
    to: '5491100000000',
    item: {
      type: 'interactive',
      mode: 'buttons',
      body: 'Elegí una opción',
      buttons: [{ id: 'secret-action-id', title: 'Reservar' }]
    }
  },
  attempts: 1,
  maxAttempts: 5,
  claimToken: 'outbox-claim',
  generation: 1,
  fenceEpoch: 1,
  queueWaitMs: 0
}

async function exerciseSenderScenario(scenario: SenderScenario) {
  const messageIds: string[] = []
  let providerCalls = 0
  const unsubscribe = subscribeToCrmRealtimeEvents({
    businessId: claimedItem.businessId,
    send: (event) => {
      if (event.type === 'conversation_message_sent') messageIds.push(event.messageId)
    }
  })
  const fake = senderClient(scenario)
  try {
    const outcome = await sendClaimedOutbox({
      client: fake.client as never,
      item: claimedItem,
      provider: {
        async send() {
          providerCalls += 1
          return { kind: 'accepted' as const, providerMessageId: 'wamid.sender-contract' }
        }
      }
    })
    return { outcome, messageIds, providerCalls, transactions: fake.transactions }
  } finally {
    unsubscribe()
  }
}

const insertedScenario = await exerciseSenderScenario('inserted')
assert.equal(insertedScenario.outcome, 'ACCEPTED')
assert.deepEqual(insertedScenario.messageIds, ['persisted-message'], 'actual sender path must publish only the inserted Message')
assert.equal(insertedScenario.providerCalls, 1)
assert.equal(insertedScenario.transactions.length, 3, 'accepted sender must preserve acquire, preflight and finalize fences')

const conflictScenario = await exerciseSenderScenario('conflict')
assert.equal(conflictScenario.outcome, 'ACCEPTED')
assert.deepEqual(conflictScenario.messageIds, [], 'providerMessageId conflict must not emit duplicate outbound SSE')
assert.equal(conflictScenario.providerCalls, 1)
assert.equal(conflictScenario.transactions.length, 3, 'conflict must retain the normal fenced accepted outcome')

const rollbackScenario = await exerciseSenderScenario('rollback-after-insert')
assert.equal(rollbackScenario.outcome, 'UNKNOWN', 'post-provider transaction rollback must quarantine the ambiguous send')
assert.deepEqual(rollbackScenario.messageIds, [], 'rolled-back accepted transaction must not emit phantom outbound SSE')
assert.equal(rollbackScenario.providerCalls, 1, 'rollback recovery must never call Meta a second time')
assert.equal(rollbackScenario.transactions.length, 4, 'rollback must preserve the fenced UNKNOWN recovery transaction')

console.log('Bot Options authoritative outbound CRM realtime contract: OK')
