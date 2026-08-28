import { type PrismaClient } from '../../generated/prisma/client.js'
import {
  bridgeDepositReviewOutboxTx,
  bridgeDirectDepositNotificationTx,
  isDirectNotificationRecoveryAggregate,
  parseDirectNotificationRecovery
} from '../../services/deposit-notification-outbox.js'
import {
  assertClaimedBotJobTx,
  completeClaimedBotJobTx,
  poisonClaimedBotJobTx,
  rescheduleClaimedBotJobTx,
  type ClaimedBotJob
} from '../infrastructure/postgres-worker.js'

type BridgeClient = Pick<PrismaClient, '$transaction'>

export async function bridgeDepositNotificationJob(
  client: BridgeClient,
  job: ClaimedBotJob
): Promise<'COMPLETED' | 'ROUTE_UNAVAILABLE' | 'TERMINAL_MALFORMED'> {
  if (job.kind !== 'BRIDGE_DEPOSIT_NOTIFICATION') throw new Error(`unsupported notification bridge job kind: ${job.kind}`)

  return client.$transaction(async (tx) => {
    // Recovery belongs to the durable review intent, not to the deployment that
    // happened to create it. Lease token + tenant remain the mutation fence.
    await assertClaimedBotJobTx(tx, job, { requireCurrentDeployment: false })
    const directRecovery = parseDirectNotificationRecovery(job.aggregateId)
    if (isDirectNotificationRecoveryAggregate(job.aggregateId) && !directRecovery) {
      await poisonClaimedBotJobTx(tx, job, 'malformed reserved direct notification recovery aggregate')
      return 'TERMINAL_MALFORMED'
    }
    const outcome = directRecovery
      ? await bridgeDirectDepositNotificationTx(tx, { businessId: job.businessId, aggregateId: job.aggregateId })
      : await bridgeDepositReviewOutboxTx(tx, { businessId: job.businessId, reviewOutboxId: job.aggregateId })
    if (outcome === 'ROUTE_UNAVAILABLE') {
      await rescheduleClaimedBotJobTx(tx, job, new Date(Date.now() + 5 * 60_000), { refundClaimAttempt: true })
      return 'ROUTE_UNAVAILABLE'
    }
    await completeClaimedBotJobTx(tx, job)
    return 'COMPLETED'
  })
}
