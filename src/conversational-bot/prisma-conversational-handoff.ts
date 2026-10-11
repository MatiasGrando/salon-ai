import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { Prisma } from '../generated/prisma/client.js'
import { transition } from '../bot-options/domain/transition.js'
import { parseBotOptionsState } from '../bot-options/domain/state.js'
import { prismaHandoffEffectExecutor } from '../bot-options/infrastructure/prisma-handoff-effect-executor.js'
import { parseConversationalReferral, type ConversationalReferral } from './conversational-referral.js'
import { readConversationDraft } from './session-state.js'
import type { ConversationPolicy } from './runtime-policy.js'
import type { ConversationUpdatedEvent } from '../services/crm-realtime-events.js'
import { isCustomerText } from './customer-text.js'
import { cancellationFingerprint, type CancellationSnapshot } from './appointment-management.js'
import { loadOwnConfirmedCancellationHandoffSnapshot } from './prisma-appointment-management.js'

type HandoffInput = {
  businessId: string
  sessionId: string
  policy: ConversationPolicy
  expectedRevision: bigint
  handoffFenceEpoch: number
  operationKey: string
  /** Trusted server command, never an interpretation-provider payload. The caller proves explicit intent. */
  command: ({ referral: ConversationalReferral } | { confirmedCancellation: CancellationSnapshot }) & { consent: { revision: bigint; evidence: string } }
  /** Collect only; the transaction owner publishes after commit. */
  pendingConversationUpdates?: Array<Omit<ConversationUpdatedEvent, 'type'>>
}
type LockedSession = {
  state: Prisma.JsonValue
  status: string
  revision: string
  businessTimezone: string
  handoffFenceEpoch: number
  handoffClaimsPausedAt: Date | null
  deploymentId: string
  deploymentGeneration: number
  generation: number
  activeConfigurationId: string | null
  claimsPausedAt: Date | null
  dbNow: Date
}
const boundedId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 128 && !/[\u0000-\u001f]/.test(value)

/** Partial capability only: caller-owned transaction, no reply, booking, TAKE or return policy. */
export async function enqueueConversationalHandoffTx(tx: Prisma.TransactionClient, input: HandoffInput):
Promise<{ handoffId: string; revision: bigint; replayed: boolean }> {
  const { policy, command } = input
  if (![input.businessId, input.sessionId, input.operationKey, policy?.deploymentId, policy?.configurationId].every(boundedId) ||
      policy.businessId !== input.businessId || !Number.isSafeInteger(policy.generation) || policy.generation < 1 ||
      typeof input.expectedRevision !== 'bigint' || input.expectedRevision < 0n ||
      !Number.isSafeInteger(input.handoffFenceEpoch) || input.handoffFenceEpoch < 0 ||
      !command?.consent || command.consent.revision !== input.expectedRevision || !isCustomerText(command.consent.evidence, 300)) {
    throw new Error('invalid conversational handoff command scope')
  }
  const confirmedCancellation = 'confirmedCancellation' in command ? command.confirmedCancellation : null
  const referral = 'referral' in command ? parseConversationalReferral(command.referral, input.businessId) : null
  if (confirmedCancellation && (confirmedCancellation.scope.businessId !== input.businessId || confirmedCancellation.scope.sessionId !== input.sessionId ||
      !confirmedCancellation.members.length)) throw new Error('confirmed cancellation handoff scope mismatch')
  const cancellationProof = confirmedCancellation ? cancellationFingerprint(confirmedCancellation) : null
  // Existing executor hashes detail and context. Bind consent and complete server scope
  // in canonical detail instead of adding a second operation ledger or widening model fields.
  const binding = JSON.stringify({ v: 1, referral, cancellationProof, consent: { revision: String(command.consent.revision),
    evidence: command.consent.evidence }, policy: { businessId: policy.businessId, deploymentId: policy.deploymentId,
      generation: policy.generation, configurationId: policy.configurationId, serviceContent: policy.serviceContent ?? null },
    sessionId: input.sessionId, handoffFenceEpoch: input.handoffFenceEpoch })
  const detail = 'conversational-consent:' + createHash('sha256').update(binding, 'utf8').digest('hex')
  const effect = { kind: 'REQUEST_HUMAN_HANDOFF' as const, reason: confirmedCancellation ? 'confirmed_booking_cancellation_request' : referral!.reason, detail,
    context: confirmedCancellation ? { coordinationGroupId: confirmedCancellation.groupId,
      appointmentIds: confirmedCancellation.members.map(member => member.appointmentId).sort() }
      : referral!.serviceId === null ? null : { serviceId: referral!.serviceId } }
  const sessions = await tx.$queryRaw<LockedSession[]>(Prisma.sql`
    /* conversational-handoff-session */ SELECT s."state",s."status"::text AS "status",s."revision"::text AS "revision",s."businessTimezone",s."handoffFenceEpoch",s."handoffClaimsPausedAt",
      s."deploymentId",s."deploymentGeneration",d."generation",d."activeConfigurationId",d."claimsPausedAt",
      clock_timestamp() AS "dbNow"
    FROM "BotSession" s JOIN "BotChannelDeployment" d ON d."id"=s."deploymentId" AND d."businessId"=s."businessId"
    WHERE s."id"=${input.sessionId} AND s."businessId"=${input.businessId}
    FOR UPDATE OF s,d
  `)
  const session = sessions[0]
  if (sessions.length !== 1 || !session) throw new Error('conversational handoff session not found in tenant')
  const key = input.operationKey + ':REQUEST_HUMAN_HANDOFF'
  const operations = await tx.$queryRaw<Array<{ resultRef: string | null }>>(Prisma.sql`
    /* conversational-handoff-replay */ SELECT "resultRef" FROM "BotOperation" WHERE "operationKey"=${key} FOR UPDATE
  `)
  if (operations.length) {
    // The existing executor validates tenant/session/type/hash/status/exact resultRef,
    // even if the referenced queue is now historical. Never project the old state again.
    await prismaHandoffEffectExecutor(tx, { businessId: input.businessId, sessionId: input.sessionId,
      operationKey: input.operationKey, effects: [effect] })
    if (operations.length !== 1 || !operations[0]?.resultRef) throw new Error('invalid handoff replay reference')
    return { handoffId: operations[0].resultRef, revision: input.expectedRevision + 1n, replayed: true }
  }
  if (session.status !== 'ACTIVE' || BigInt(session.revision) !== input.expectedRevision ||
      session.handoffClaimsPausedAt || session.handoffFenceEpoch !== input.handoffFenceEpoch ||
      session.deploymentId !== policy.deploymentId || session.deploymentGeneration !== policy.generation ||
      session.generation !== policy.generation || session.activeConfigurationId !== policy.configurationId || session.claimsPausedAt) {
    throw new Error('stale or fenced conversational handoff')
  }
  const parsed = parseBotOptionsState(session.state)
  if (!parsed.ok || parsed.state.handoff !== 'NONE' || (confirmedCancellation
    ? parsed.state.booking !== 'CONFIRMED' || !['NONE', 'APPROVED'].includes(parsed.state.deposit)
    : !['NONE', 'DRAFT'].includes(parsed.state.booking) || parsed.state.deposit !== 'NONE')) throw new Error('protected conversational handoff state')
  const draft = readConversationDraft(session.state, policy, session.businessTimezone)
  if (confirmedCancellation) {
    const booking = draft.bookingReservation ?? draft.completedBooking
    if (!booking?.receipt || booking.receipt.coordinationGroupId !== confirmedCancellation.groupId ||
        booking.receipt.appointments.length !== confirmedCancellation.members.length) throw new Error('confirmed cancellation booking changed')
    const current = await loadOwnConfirmedCancellationHandoffSnapshot(tx, { businessId: input.businessId, sessionId: input.sessionId,
      canonicalPhone: confirmedCancellation.scope.normalizedPhone, expectedRevision: input.expectedRevision })
    if (cancellationFingerprint(current) !== cancellationProof) throw new Error('confirmed cancellation snapshot changed')
  } else if (!isDeepStrictEqual(draft.referral, referral)) throw new Error('conversational handoff referral changed')
  const requested = transition(parsed.state, { actionType: 'handoff.request', entityRef: null, payload: null },
    { dbNowIso: session.dbNow.toISOString() })
  if (requested.outcome !== 'HANDOFF') throw new Error('conversational handoff transition rejected')
  await prismaHandoffEffectExecutor(tx, { businessId: input.businessId, sessionId: input.sessionId,
    operationKey: input.operationKey, effects: [effect],
    ...(input.pendingConversationUpdates ? { pendingConversationUpdates: input.pendingConversationUpdates } : {}) })
  const revision = input.expectedRevision + 1n
  const updated = await tx.$executeRaw(Prisma.sql`
    /* conversational-handoff-revision */ UPDATE "BotSession" SET "state"=${JSON.stringify(requested.state)}::jsonb,"revision"=${revision},"updatedAt"=clock_timestamp()
    WHERE "id"=${input.sessionId} AND "businessId"=${input.businessId} AND "revision"=${input.expectedRevision}
      AND "status"='HUMAN_QUEUED'::"BotSessionStatus" AND "handoffFenceEpoch"=${input.handoffFenceEpoch}
      AND "handoffClaimsPausedAt" IS NULL
  `)
  if (updated !== 1) throw new Error('conversational handoff revision lost')
  const completed = await tx.$queryRaw<Array<{ resultRef: string | null }>>(Prisma.sql`
    SELECT "resultRef" FROM "BotOperation" WHERE "operationKey"=${key} AND "businessId"=${input.businessId}
      AND "sessionId"=${input.sessionId} AND "status"='COMPLETED'
  `)
  if (completed.length !== 1 || !completed[0]?.resultRef) throw new Error('conversational handoff receipt missing')
  return { handoffId: completed[0].resultRef, revision, replayed: false }
}
