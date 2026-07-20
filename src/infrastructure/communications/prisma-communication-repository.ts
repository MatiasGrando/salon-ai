import type { Prisma } from '../../generated/prisma/client.js'
import { prisma } from '../../config/prisma.js'
import type { CommunicationRepository, StartCommunicationExecutionInput } from '../../application/communications/communication-service.js'
import type { CommunicationStatus } from '../../domain/communications/communication.js'

export class PrismaCommunicationRepository implements CommunicationRepository {
  createExecution(input: StartCommunicationExecutionInput) {
    return prisma.communicationExecution.create({
      data: {
        businessId: input.businessId,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        purpose: input.purpose,
        mode: input.mode,
        status: 'RUNNING',
        initiatedByUserId: input.initiatedByUserId || null,
        candidateCount: input.candidateCount,
        eligibleCount: input.recipients.length,
        excludedCount: input.excludedCount,
        ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
        recipients: {
          create: input.recipients.map((recipient) => ({
            business: { connect: { id: input.businessId } },
            customer: { connect: { id: recipient.customerId } },
            phoneSnapshot: recipient.phone,
            customerNameSnapshot: recipient.customerName,
            messageSnapshot: recipient.message,
            ...(recipient.metadata ? { metadata: recipient.metadata as Prisma.InputJsonValue } : {}),
            events: { create: { toStatus: 'PENDING', actorType: 'SYSTEM' } }
          }))
        }
      },
      include: executionInclude
    })
  }

  findExecution(id: string) {
    return prisma.communicationExecution.findUnique({ where: { id }, include: executionInclude })
  }

  findRecipient(id: string) {
    return prisma.communicationRecipient.findUnique({
      where: { id },
      select: {
        id: true,
        executionId: true,
        customerId: true,
        status: true,
        phoneSnapshot: true,
        customerNameSnapshot: true,
        messageSnapshot: true,
        sourceDeliveryId: true,
        openedAt: true,
        sentAt: true,
        skipReason: true,
        failureReason: true
      }
    })
  }

  transitionRecipient(input: {
    recipientId: string
    fromStatus: string
    toStatus: CommunicationStatus
    timestampField: string | null
    actorType: 'USER' | 'SYSTEM'
    actorId?: string | null
    note?: string | null
    skipReason?: string | null
    failureReason?: string | null
    sourceDeliveryId?: string | null
  }) {
    const now = new Date()
    return prisma.$transaction(async (tx) => {
      const updated = await tx.communicationRecipient.update({
        where: { id: input.recipientId },
        data: {
          status: input.toStatus,
          ...(input.timestampField ? { [input.timestampField]: now } : {}),
          ...(input.skipReason !== undefined ? { skipReason: input.skipReason } : {}),
          ...(input.failureReason !== undefined ? { failureReason: input.failureReason } : {}),
          ...(input.sourceDeliveryId !== undefined ? { sourceDeliveryId: input.sourceDeliveryId } : {})
        }
      })
      await tx.communicationEvent.create({
        data: {
          recipientId: input.recipientId,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          actorType: input.actorType,
          actorId: input.actorId || null,
          note: input.note || null
        }
      })
      return updated
    })
  }

  async recipientStatuses(executionId: string) {
    const rows = await prisma.communicationRecipient.findMany({ where: { executionId }, select: { status: true } })
    return rows.map((row) => row.status)
  }

  async completeExecution(executionId: string) {
    await prisma.communicationExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', completedAt: new Date() } })
  }
}

const executionInclude = {
  recipients: {
    include: { customer: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'asc' as const }
  }
}
