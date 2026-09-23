import type { Prisma } from '../../generated/prisma/client.js'
import { prisma } from '../../config/prisma.js'
import type { CommunicationRepository, StartCommunicationExecutionInput } from '../../application/communications/communication-service.js'
import type { CommunicationStatus } from '../../domain/communications/communication.js'

export class PrismaCommunicationRepository implements CommunicationRepository {
  constructor(private readonly database: typeof prisma = prisma) {}

  createExecution(input: StartCommunicationExecutionInput) {
    return this.database.$transaction(async (tx) => {
      const execution = await tx.communicationExecution.create({
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
          ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {})
        },
        select: { id: true }
      })
      const startedAt = new Date()
      const batchSize = 500
      for (let offset = 0; offset < input.recipients.length; offset += batchSize) {
        const batch = input.recipients.slice(offset, offset + batchSize)
        const created = await tx.communicationRecipient.createManyAndReturn({
          data: batch.map((recipient, index) => ({
            executionId: execution.id,
            businessId: input.businessId,
            customerId: recipient.customerId,
            recipientKey: recipient.recipientKey || recipient.customerId,
            phoneSnapshot: recipient.phone,
            customerNameSnapshot: recipient.customerName,
            messageSnapshot: recipient.message,
            createdAt: new Date(startedAt.getTime() + offset + index),
            ...(recipient.metadata ? { metadata: recipient.metadata as Prisma.InputJsonValue } : {})
          })),
          select: { id: true }
        })
        await tx.communicationEvent.createMany({
          data: created.map((recipient) => ({
            recipientId: recipient.id,
            toStatus: 'PENDING',
            actorType: 'SYSTEM'
          }))
        })
      }
      return execution
    }, { maxWait: 10_000, timeout: 90_000 })
  }

  findExecution(id: string) {
    return this.database.communicationExecution.findUnique({ where: { id }, include: executionInclude })
  }

  findExecutionHeader(id: string) {
    return this.database.communicationExecution.findUnique({
      where: { id },
      select: { id: true, businessId: true, sourceType: true, sourceId: true, mode: true }
    })
  }

  findRecipient(id: string) {
    return this.database.communicationRecipient.findUnique({
      where: { id },
      select: {
        id: true,
        executionId: true,
        customerId: true,
        recipientKey: true,
        status: true,
        phoneSnapshot: true,
        customerNameSnapshot: true,
        messageSnapshot: true,
        sourceDeliveryId: true,
        openedAt: true,
        sentAt: true,
        skipReason: true,
        failureReason: true,
        metadata: true
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
    return this.database.$transaction(async (tx) => {
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
    const rows = await this.database.communicationRecipient.findMany({ where: { executionId }, select: { status: true } })
    return rows.map((row) => row.status)
  }

  async hasPendingRecipients(executionId: string) {
    const recipient = await this.database.communicationRecipient.findFirst({
      where: { executionId, status: { in: ['PENDING', 'OPENED'] } },
      select: { id: true }
    })
    return Boolean(recipient)
  }

  async completeExecution(executionId: string) {
    await this.database.communicationExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', completedAt: new Date() } })
  }
}

const executionInclude = {
  recipients: {
    include: { customer: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'asc' as const }
  }
}
