import type { Prisma } from '../../generated/prisma/client.js'
import { prisma } from '../../config/prisma.js'
import type { CommunicationAttemptRepository, RecordCommunicationAttemptInput } from '../../application/communications/record-communication-attempt.js'

export class PrismaCommunicationAttemptRepository implements CommunicationAttemptRepository {
  async record(input: RecordCommunicationAttemptInput) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.communicationRecipient.findUnique({ where: { sourceDeliveryId: input.sourceDeliveryId } })
      if (existing) {
        await tx.communicationExecution.update({
          where: { id: existing.executionId },
          data: { mode: input.mode, status: 'COMPLETED', completedAt: input.occurredAt }
        })
        await tx.communicationRecipient.update({
          where: { id: existing.id },
          data: {
            status: input.status,
            providerMessageId: input.providerMessageId || null,
            failureReason: input.failureReason || null,
            ...(input.status === 'SENT' ? { sentAt: input.occurredAt, failedAt: null } : { failedAt: input.occurredAt })
          }
        })
        await tx.communicationEvent.create({
          data: { recipientId: existing.id, fromStatus: existing.status, toStatus: input.status, actorType: 'SYSTEM', note: input.failureReason || null }
        })
        return
      }
      await tx.communicationExecution.create({
        data: {
          businessId: input.businessId,
          sourceType: input.sourceType,
          sourceId: input.sourceId,
          purpose: input.purpose,
          mode: input.mode,
          status: 'COMPLETED',
          candidateCount: 1,
          eligibleCount: 1,
          excludedCount: 0,
          startedAt: input.occurredAt,
          completedAt: input.occurredAt,
          ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
          recipients: {
            create: {
              business: { connect: { id: input.businessId } },
              customer: { connect: { id: input.customerId } },
              phoneSnapshot: input.phone,
              customerNameSnapshot: input.customerName,
              messageSnapshot: input.message,
              status: input.status,
              sourceDeliveryId: input.sourceDeliveryId,
              providerMessageId: input.providerMessageId || null,
              ...(input.status === 'SENT' ? { sentAt: input.occurredAt } : { failedAt: input.occurredAt }),
              failureReason: input.failureReason || null,
              events: { create: { toStatus: input.status, actorType: 'SYSTEM', note: input.failureReason || null } }
            }
          }
        }
      })
    })
  }
}
