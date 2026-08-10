import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  conversationHandoffStage,
  isQueuedConversationHandoff,
  queuedConversationHandoffPatch,
  takenConversationHandoffPatch
} from '../src/services/conversation-handoff.js'

const now = new Date('2026-08-10T12:00:00.000Z')
const queued = queuedConversationHandoffPatch(now)
assert.deepEqual(queued, {
  currentStep: 'HUMAN_HANDOFF',
  aiEnabled: true,
  misunderstandingCount: 0,
  humanHandoffAt: now,
  humanHandoffResolvedAt: null
})
assert.equal(conversationHandoffStage(queued), 'QUEUED')
assert.equal(isQueuedConversationHandoff(queued), true)
assert.equal(conversationHandoffStage({ ...queued, aiEnabled: false }), 'TAKEN')
const taken = takenConversationHandoffPatch({ queuedAt: now })
assert.equal(conversationHandoffStage(taken), 'TAKEN')
assert.equal(taken.humanHandoffAt, now)
assert.equal(conversationHandoffStage({
  ...queued,
  humanHandoffResolvedAt: new Date('2026-08-10T12:05:00.000Z')
}), 'RESOLVED')
assert.equal(conversationHandoffStage({
  currentStep: 'START',
  aiEnabled: true,
  humanHandoffAt: null,
  humanHandoffResolvedAt: null
}), 'NONE')

const conversationSource = readFileSync('src/services/conversation-service.ts', 'utf8')
assert.doesNotMatch(conversationSource, /aiEnabled:\s*false/)
assert.match(conversationSource, /isQueuedConversationHandoff\(conversation\)/)
assert.match(conversationSource, /humanHandoffBookingLocked\(\)/)
assert.match(conversationSource, /businessInformationTopicsFromRouting\(input\.routing\)/)

const postSaleSource = readFileSync('src/services/post-sale-service.ts', 'utf8')
assert.match(postSaleSource, /queuedConversationHandoffPatch\(now\)/)
assert.doesNotMatch(postSaleSource, /currentStep:\s*'HUMAN_HANDOFF'[\s\S]*?aiEnabled:\s*false/)

const photoQuoteSource = readFileSync('src/services/photo-quote-acknowledgement-service.ts', 'utf8')
assert.match(
  photoQuoteSource,
  /currentStep:\s*'HUMAN_HANDOFF'[\s\S]*?aiEnabled:\s*true[\s\S]*?photoQuoteAcknowledgedAt:\s*null/
)

const crmSource = readFileSync('src/routes/crm.ts', 'utf8')
assert.match(
  crmSource,
  /conversation\.currentStep === 'HUMAN_HANDOFF'[\s\S]*?takenConversationHandoffPatch\(\{ queuedAt: conversation\.humanHandoffAt \}\)/
)

console.log('conversation-handoff-contract-test: OK')
