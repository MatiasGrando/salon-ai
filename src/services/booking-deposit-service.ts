import { prisma as defaultPrisma } from '../config/prisma.js'

type PrismaClientLike = typeof defaultPrisma

const ACTIVE_DEPOSIT_STATUSES = ['PENDING_PROOF', 'PROOF_RECEIVED'] as const

export class BookingDepositService {
  constructor(private readonly db: PrismaClientLike = defaultPrisma) {}

  async expireOverdue(now = new Date()) {
    const overdue = await this.db.bookingDeposit.findMany({
      where: {
        status: { in: [...ACTIVE_DEPOSIT_STATUSES] },
        expiresAt: { lte: now }
      },
      select: {
        id: true,
        appointmentId: true
      }
    })
    if (!overdue.length) return { expired: 0 }

    const expired = await this.db.$transaction(async (tx) => {
      let count = 0
      for (const deposit of overdue) {
        const claimed = await tx.bookingDeposit.updateMany({
          where: {
            id: deposit.id,
            status: { in: [...ACTIVE_DEPOSIT_STATUSES] },
            expiresAt: { lte: now }
          },
          data: {
            status: 'EXPIRED',
            reviewedAt: now
          }
        })
        if (!claimed.count) continue
        await tx.appointment.updateMany({
          where: {
            id: deposit.appointmentId,
            status: 'PENDING'
          },
          data: {
            status: 'CANCELLED'
          }
        })
        count += 1
      }
      return count
    })
    return { expired }
  }

  async markProofReceived(input: {
    conversationId: string
    messageId: string
    receivedAt?: Date
  }) {
    await this.expireOverdue(input.receivedAt ?? new Date())
    const deposit = await this.db.bookingDeposit.findFirst({
      where: {
        conversationId: input.conversationId,
        status: 'PENDING_PROOF',
        expiresAt: { gt: input.receivedAt ?? new Date() }
      },
      orderBy: { createdAt: 'desc' }
    })
    if (!deposit) return null
    const updated = await this.db.bookingDeposit.updateMany({
      where: {
        id: deposit.id,
        status: 'PENDING_PROOF',
        expiresAt: { gt: input.receivedAt ?? new Date() }
      },
      data: {
        status: 'PROOF_RECEIVED',
        proofMessageId: input.messageId
      }
    })
    return updated.count
      ? this.db.bookingDeposit.findUnique({ where: { id: deposit.id } })
      : null
  }
}

export const bookingDepositService = new BookingDepositService()
