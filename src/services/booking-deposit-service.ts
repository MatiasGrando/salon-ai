import { prisma as defaultPrisma } from '../config/prisma.js'

type PrismaClientLike = typeof defaultPrisma

const EXPIRABLE_DEPOSIT_STATUS = 'PENDING_PROOF' as const

export const DEPOSIT_PROOF_RECEIVED_ACKNOWLEDGEMENT =
  'Recibimos tu comprobante. El horario continúa reservado mientras el equipo verifica el pago. Te avisamos por acá cuando quede confirmado.'

export const LATE_DEPOSIT_PROOF_ACKNOWLEDGEMENT =
  'Recibimos tu comprobante, pero llegó después de que venció la retención y el horario ya fue liberado. Ya avisamos al equipo para que revise el pago y coordine una nueva disponibilidad con vos por acá.'

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
        appointmentId: true,
        conversation: { select: { bookingV2State: true } }
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
            id: { in: depositAppointmentIds(deposit.appointmentId, deposit.conversation?.bookingV2State) },
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

  async registerLateProofIfExpired(input: {
    depositId: string | null
    conversationId: string
    messageId: string
    receivedAt?: Date
  }) {
    if (!input.depositId) return null
    const receivedAt = input.receivedAt ?? new Date()
    const deposit = await this.db.bookingDeposit.findUnique({
      where: { id: input.depositId }
    })
    if (
      !deposit ||
      deposit.conversationId !== input.conversationId ||
      deposit.status !== 'EXPIRED' ||
      deposit.expiresAt > receivedAt
    ) {
      return null
    }
    if (!deposit.proofMessageId) {
      await this.db.bookingDeposit.updateMany({
        where: {
          id: deposit.id,
          conversationId: input.conversationId,
          status: 'EXPIRED',
          proofMessageId: null
        },
        data: {
          proofMessageId: input.messageId,
          rejectionReason: 'Comprobante recibido después del vencimiento de la retención.'
        }
      })
    }
    return this.db.bookingDeposit.findUnique({ where: { id: deposit.id } })
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
        select: {
          appointmentId: true,
          conversation: { select: { bookingV2State: true } }
        }
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
        where: {
          id: { in: depositAppointmentIds(deposit.appointmentId, deposit.conversation?.bookingV2State) },
          status: 'PENDING'
        },
        data: { status: 'CANCELLED' }
      })
      return true
    })
  }

  async cancelPendingProofsForConversation(input: {
    conversationId: string
    reason: string
    cancelledAt?: Date
  }) {
    const pendingDeposits = await this.db.bookingDeposit.findMany({
      where: {
        conversationId: input.conversationId,
        status: EXPIRABLE_DEPOSIT_STATUS
      },
      select: { id: true }
    })
    let cancelled = 0
    for (const deposit of pendingDeposits) {
      if (await this.cancelPendingProof({
        depositId: deposit.id,
        reason: input.reason,
        cancelledAt: input.cancelledAt
      })) {
        cancelled += 1
      }
    }
    return cancelled
  }
}

export const bookingDepositService = new BookingDepositService()

function depositAppointmentIds(primaryAppointmentId: string, bookingV2State: unknown) {
  if (!bookingV2State || typeof bookingV2State !== 'object') return [primaryAppointmentId]
  const pendingDeposit = (bookingV2State as { pendingDeposit?: unknown }).pendingDeposit
  if (!pendingDeposit || typeof pendingDeposit !== 'object') return [primaryAppointmentId]
  const related = (pendingDeposit as { relatedAppointmentIds?: unknown }).relatedAppointmentIds
  return Array.from(new Set([
    primaryAppointmentId,
    ...(Array.isArray(related)
      ? related.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      : [])
  ]))
}
