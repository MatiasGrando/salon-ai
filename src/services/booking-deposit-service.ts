import { prisma as defaultPrisma } from '../config/prisma.js'

type PrismaClientLike = typeof defaultPrisma

const EXPIRABLE_DEPOSIT_STATUS = 'PENDING_PROOF' as const

export const DEPOSIT_PROOF_RECEIVED_ACKNOWLEDGEMENT =
  'Recibimos tu comprobante. El horario continúa reservado mientras el equipo verifica el pago. Te avisamos por acá cuando quede confirmado.'

export class BookingDepositService {
  constructor(private readonly db: PrismaClientLike = defaultPrisma) {}

  async expireOverdue(now = new Date()) {
    const overdue = await this.db.bookingDeposit.findMany({
      where: {
        status: EXPIRABLE_DEPOSIT_STATUS,
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
            status: EXPIRABLE_DEPOSIT_STATUS,
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

  async cancelPendingProof(input: {
    depositId: string
    reason: string
    cancelledAt?: Date
  }) {
    const cancelledAt = input.cancelledAt ?? new Date()
    return this.db.$transaction(async (tx) => {
      const deposit = await tx.bookingDeposit.findUnique({
        where: { id: input.depositId },
        select: { appointmentId: true }
      })
      if (!deposit) return false
      const cancelled = await tx.bookingDeposit.updateMany({
        where: {
          id: input.depositId,
          status: EXPIRABLE_DEPOSIT_STATUS
        },
        data: {
          status: 'REJECTED',
          reviewedAt: cancelledAt,
          rejectionReason: input.reason
        }
      })
      if (!cancelled.count) return false
      await tx.appointment.updateMany({
        where: { id: deposit.appointmentId, status: 'PENDING' },
        data: { status: 'CANCELLED' }
      })
      return true
    })
  }
}

export const bookingDepositService = new BookingDepositService()
