import {runtimeChannelIdentityRecord,type RuntimeChannelIdentity} from './conversation-subject.js'
import { Prisma } from '../generated/prisma/client.js'
import { initialDialogueState, type DialogueState } from './engine.js'
import { loadRuntimeDepositReceipt, parseRuntimeBookingReservation, type RuntimeShownScope } from './prisma-conversational-booking.js'

type RecoveryScope = RuntimeShownScope & RuntimeChannelIdentity
type Reader = Pick<Prisma.TransactionClient, '$queryRaw'>

/** Completed historical effects are not pending; uncertain deliveries always are. */
export async function hasPendingConversationEffectsTx(tx: Reader, scope: Pick<RecoveryScope, 'businessId' | 'sessionId'>): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ blocked: boolean }>>(Prisma.sql`
    /* test-reset-pending-effects */
    SELECT EXISTS (SELECT 1 FROM "BotOutbox"
      WHERE "businessId" = ${scope.businessId} AND "sessionId" = ${scope.sessionId}
        AND "status"::text IN ('PENDING','CLAIMED','RETRY','SENDING','UNKNOWN'))
      OR EXISTS (SELECT 1 FROM "BotOperation"
        WHERE "businessId" = ${scope.businessId} AND "sessionId" = ${scope.sessionId}
          AND "status" IS DISTINCT FROM 'COMPLETED') AS "blocked"
  `)
  if (rows.length !== 1 || typeof rows[0]?.blocked !== 'boolean') throw new Error('conversation effect guard unavailable')
  return rows[0].blocked
}

/** Sidecar terminal labels never grant permission to discard financial context without durable authority. */
export async function canResumeExpiredConversationTx(tx: Reader, scope: RecoveryScope, draft: DialogueState): Promise<boolean> {
  if (draft.businessId !== scope.businessId || draft.appointmentManagement && !draft.appointmentManagement.outcome ||
      !draft.bookingReservation) return false
  let reservation
  try { reservation = parseRuntimeBookingReservation(draft.bookingReservation, scope.businessId) } catch { return false }
  const presented = reservation.presented, receipt = reservation.receipt
  if (!receipt || receipt.kind !== 'HELD' || !['PENDING_PROOF','PENDING_RESUBMISSION','EXPIRED','REJECTED'].includes(receipt.depositStatus) ||
      presented.scope.sessionId !== scope.sessionId || presented.scope.deploymentId !== scope.deploymentId ||
      presented.scope.generation !== scope.generation || presented.scope.configurationId !== scope.configurationId ||
      presented.scope.dispatchFenceEpoch !== scope.dispatchFenceEpoch || presented.scope.handoffFenceEpoch !== scope.handoffFenceEpoch ||
      !/^\d+$/.test(scope.revision) || BigInt(presented.scope.revision) > BigInt(scope.revision)) return false
  const actual = await loadRuntimeDepositReceipt(tx, { businessId: scope.businessId, sessionId: scope.sessionId,
    ...runtimeChannelIdentityRecord(scope), expectedRevision: BigInt(scope.revision) }, reservation)
  const terminal = actual?.depositStatus === 'EXPIRED' || actual?.depositStatus === 'REJECTED' &&
    (actual.cancellationReason === 'CUSTOMER' || actual.cancellationReason === 'STAFF')
  return terminal && !await hasPendingConversationEffectsTx(tx, scope)
}

/** Keep safe identity context, but never a slot, basket, financial receipt or consent. */
export function expiredConversationDraft(draft: DialogueState): DialogueState {
  return { ...initialDialogueState(draft.businessId), introduced: draft.introduced ?? false, customerName: draft.customerName }
}
