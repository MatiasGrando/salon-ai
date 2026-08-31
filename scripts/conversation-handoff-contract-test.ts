import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  cleanBookingStateAfterResolvedHandoff,
  conversationPatchFromState
} from '../src/services/booking-v2-conversation-state.js'
import {
  conversationHandoffStage,
  isQueuedConversationHandoff,
  queuedConversationHandoffPatch,
  resolvedConversationHandoffPatch,
  takenConversationHandoffPatch
} from '../src/services/conversation-handoff.js'
import { canonicalResolveOperation, canonicalTakeOperation, recoverStaleTakeOperations, STALE_HANDOFF_TAKE_MS, type StaleTakeCandidate } from '../src/bot-options/application/handoff-operations.js'

assert.equal(STALE_HANDOFF_TAKE_MS, 60_000)
assert.equal(canonicalTakeOperation({ requestedOperationKey: 'new', actorUserId: 'actor-a', requestHash: 'hash-a' }), 'new')
assert.equal(canonicalTakeOperation({
  requestedOperationKey: 'new', actorUserId: 'actor-a', requestHash: 'hash-a',
  pending: { canonicalOperationKey: 'canonical', actorUserId: 'actor-a', requestHash: 'hash-a' }
}), 'canonical')
assert.throws(() => canonicalTakeOperation({
  requestedOperationKey: 'new', actorUserId: 'actor-b', requestHash: 'hash-b',
  pending: { canonicalOperationKey: 'canonical', actorUserId: 'actor-a', requestHash: 'hash-a' }
}), /TAKE_IN_PROGRESS/)
assert.equal(canonicalResolveOperation({
  requestedOperationKey: 'new-resolve', actorUserId: 'actor-a', requestHash: 'hash-a',
  pending: { canonicalOperationKey: 'canonical-resolve', actorUserId: 'actor-a', requestHash: 'hash-a' }
}), 'canonical-resolve')
assert.throws(() => canonicalResolveOperation({
  requestedOperationKey: 'new-resolve', actorUserId: 'actor-b', requestHash: 'hash-a',
  pending: { canonicalOperationKey: 'canonical-resolve', actorUserId: 'actor-a', requestHash: 'hash-a' }
}), /RESOLVE_IN_PROGRESS/)
const staleCandidate = (operationKey: string): StaleTakeCandidate => ({
  operationKey, businessId: 'business-a', sessionId: `session-${operationKey}`, handoffId: `handoff-${operationKey}`,
  conversationId: `conversation-${operationKey}`, actorUserId: 'actor-a', epoch: 1
})
const staleCandidates = ['complete', 'active', 'unknown', 'failed'].map(staleCandidate)
const recoveryResult = await recoverStaleTakeOperations({
  client: { async $queryRaw() { return staleCandidates } } as never,
  recovery: {
    async drain(candidate) { return { active: candidate.operationKey === 'active' ? 1 : 0, unknown: candidate.operationKey === 'unknown' } },
    async resume(candidate) {
      if (candidate.operationKey === 'complete') return 'COMPLETED'
      if (candidate.operationKey === 'unknown') return 'BLOCKED_UNKNOWN'
      return 'FAILED'
    },
    async abort(candidate) { return candidate.operationKey === 'failed' }
  }
})
assert.deepEqual(recoveryResult, { completed: 1, waiting: 1, blockedUnknown: 1, aborted: 1 })
await assert.rejects(() => recoverStaleTakeOperations({ client: {} as never, staleMs: STALE_HANDOFF_TAKE_MS - 1 }), /safe window/)

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
const resolved = resolvedConversationHandoffPatch(now)
assert.deepEqual(resolved, {
  currentStep: 'START',
  aiEnabled: true,
  misunderstandingCount: 0,
  humanHandoffResolvedAt: now
})
const cleanBookingPatch = conversationPatchFromState(cleanBookingStateAfterResolvedHandoff({
  selectedCustomerName: 'Mati QA',
  selectedServiceId: 'service-1',
  selectedProfessionalId: 'professional-1',
  selectedDate: '2026-08-20',
  selectedTime: '14:00',
  misunderstandingCount: 2,
  bookingV2State: { version: 1, pendingProposal: null }
}))
assert.deepEqual(cleanBookingPatch, {
  selectedCustomerName: 'Mati QA',
  selectedServiceId: null,
  selectedProfessionalId: null,
  selectedDate: null,
  selectedTime: null,
  misunderstandingCount: 0,
  bookingV2State: null
})
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
assert.match(conversationSource, /El equipo sigue teniendo tus imágenes/)
assert.match(conversationSource, /handoff_cancel:\$\{conversationId\}/)
assert.match(conversationSource, /isQueuedConversationHandoff\(conversation\)[\s\S]*?isHandoffCancellationRequest/)
assert.match(conversationSource, /humanHandoffResolvedAt:\s*new Date\(\)/)
assert.match(conversationSource, /title:\s*'Cancelar atención'/)
assert.match(
  conversationSource,
  /conversation\.updateMany\([\s\S]*?currentStep:\s*'HUMAN_HANDOFF'[\s\S]*?aiEnabled:\s*true[\s\S]*?humanHandoffResolvedAt:\s*null/
)

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
assert.match(
  crmSource,
  /function pendingConversationHandoffWhere\(\)[\s\S]*?OR:\s*\[[\s\S]*?aiEnabled:\s*false[\s\S]*?currentStep:\s*'HUMAN_HANDOFF'[\s\S]*?humanHandoffResolvedAt:\s*null/
)
assert.match(crmSource, /isResolvingHandoff[\s\S]*?cleanBookingStateAfterResolvedHandoff\(conversation\)/)
assert.match(crmSource, /isResolvingHandoff[\s\S]*?resolvedConversationHandoffPatch\(\)/)
assert.match(crmSource, /isResolvingHandoff[\s\S]*?lastAvailability:\s*Prisma\.JsonNull/)

const crmUiSource = readFileSync('src/routes/crm-ui.ts', 'utf8')
assert.match(
  crmUiSource,
  /function isPendingHandoff\(conversation\)[\s\S]*?conversation\.aiEnabled === false[\s\S]*?conversation\.currentStep === 'HUMAN_HANDOFF'/
)
assert.match(crmUiSource, /function conversationHandoffUiStage\(conversation\)/)
assert.match(crmUiSource, /handoffStage === 'QUEUED'[\s\S]*?conversationAiToggle/)
assert.match(crmUiSource, /handoffStage === 'TAKEN'[\s\S]*?resolveHandoff/)
assert.match(crmUiSource, /handoffOperationKeys: new Map\(\)/)
assert.match(crmUiSource, /handoffOperationKeys\.get\(operationKeyId\)[\s\S]*?body: JSON\.stringify\(\{ operationKey \}\)/,
  'take retries keep one operation key until success')
assert.match(crmUiSource, /handoffOperationKeys\.get\(operationKeyId\)[\s\S]*?body: JSON\.stringify\(\{ operationKey, resolution:/,
  'resolve retries keep one operation key until success')

const operationsSource = readFileSync('src/bot-options/application/handoff-operations.ts', 'utf8')
assert.match(operationsSource, /export const STALE_HANDOFF_TAKE_MS = 60_000/)
assert.match(operationsSource, /TAKE_STARTED[\s\S]*?actorUserId[\s\S]*?canonicalOperationKey/,
  'a same-actor retry must adopt the canonical started take')
assert.match(operationsSource, /export async function recoverStaleTakeOperations/)
assert.match(operationsSource, /TAKE_RECOVERY_ABORTED/)
assert.match(operationsSource, /RESOLVE_BLOCKED_UNKNOWN[\s\S]*?canonicalOperationKey/,
  'a same-actor resolve retry after a reload must adopt its canonical blocked operation')

const workerSource = readFileSync('src/bot-options/infrastructure/postgres-worker.ts', 'utf8')
assert.match(workerSource, /maintainBotJobs\(input\.client\)[\s\S]*?recoverStaleTakeOperations\(\{ client: input\.client \}\)/,
  'the single worker maintenance cadence must recover stale takes')

console.log('conversation-handoff-contract-test: OK')
