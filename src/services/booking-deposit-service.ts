import { prisma as defaultPrisma } from '../config/prisma.js'
import { acquireAppointmentWriteHierarchy } from './agenda-locks.js'

type PrismaClientLike = typeof defaultPrisma

const EXPIRABLE_DEPOSIT_STATUS = 'PENDING_PROOF' as const
const WEB_PROOF_MAX_BYTES = 3 * 1024 * 1024
const WEB_PROOF_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf'
])

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
        businessId: true,
        appointmentId: true,
        conversation: { select: { bookingV2State: true } }
      }
    })
    if (!overdue.length) return { expired: 0 }

    let expired = 0
    for (const deposit of overdue) {
      const didExpire = await this.db.$transaction(async (tx) => {
        const appointmentIds = await depositAppointmentIdsFromDb(
          tx,
          deposit.appointmentId,
          deposit.conversation?.bookingV2State
        )
        await acquireAppointmentWriteHierarchy(tx, {
          businessId: deposit.businessId,
          appointmentIds
        })
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
        if (!claimed.count) return false
        await tx.appointment.updateMany({
          where: {
            id: { in: appointmentIds },
            status: 'PENDING'
          },
          data: {
            status: 'CANCELLED'
          }
        })
        return true
      })
      if (didExpire) expired += 1
    }
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

  async submitWebProof(input: {
    depositId: string
    dataUrl?: string
    filename?: string
    receivedAt?: Date
  }): Promise<
    | { ok: true; deposit: Awaited<ReturnType<PrismaClientLike['bookingDeposit']['findUnique']>> }
    | { ok: false; statusCode: number; message: string }
  > {
    const parsed = parseWebProof(input.dataUrl, input.filename)
    if (!parsed.ok) return parsed
    const receivedAt = input.receivedAt ?? new Date()
    await this.expireOverdue(receivedAt)

    const claimed = await this.db.bookingDeposit.updateMany({
      where: {
        id: input.depositId,
        source: 'WEB',
        status: 'PENDING_PROOF',
        expiresAt: { gt: receivedAt }
      },
      data: {
        status: 'PROOF_RECEIVED',
        proofData: parsed.data,
        proofMimeType: parsed.mimeType,
        proofFilename: parsed.filename
      }
    })
    if (!claimed.count) {
      return {
        ok: false,
        statusCode: 409,
        message: 'La retencion vencio o el comprobante ya fue enviado'
      }
    }
    return {
      ok: true,
      deposit: await this.db.bookingDeposit.findUnique({ where: { id: input.depositId } })
    }
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
          businessId: true,
          conversation: { select: { bookingV2State: true } }
        }
      })
      if (!deposit) return false
      const appointmentIds = await depositAppointmentIdsFromDb(
        tx,
        deposit.appointmentId,
        deposit.conversation?.bookingV2State
      )
      await acquireAppointmentWriteHierarchy(tx, {
        businessId: deposit.businessId,
        appointmentIds
      })
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
          id: { in: appointmentIds },
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
        ...(input.cancelledAt !== undefined ? { cancelledAt: input.cancelledAt } : {})
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

async function depositAppointmentIdsFromDb(
  db: Pick<PrismaClientLike, 'appointment'>,
  primaryAppointmentId: string,
  bookingV2State: unknown
) {
  const stateIds = depositAppointmentIds(primaryAppointmentId, bookingV2State)
  const primary = await db.appointment.findUnique({
    where: { id: primaryAppointmentId },
    select: { coordinationGroupId: true }
  })
  if (!primary?.coordinationGroupId) return stateIds
  const coordinated = await db.appointment.findMany({
    where: { coordinationGroupId: primary.coordinationGroupId },
    select: { id: true }
  })
  return Array.from(new Set([...stateIds, ...coordinated.map((appointment) => appointment.id)]))
}

function parseWebProof(dataUrl?: string, filename?: string):
  | { ok: true; data: Uint8Array<ArrayBuffer>; mimeType: string; filename: string }
  | { ok: false; statusCode: number; message: string } {
  const match = dataUrl?.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) {
    return { ok: false, statusCode: 400, message: 'Selecciona una imagen o PDF valido' }
  }
  const mimeType = match[1]!.trim().toLowerCase()
  if (!WEB_PROOF_MIME_TYPES.has(mimeType)) {
    return { ok: false, statusCode: 400, message: 'El comprobante debe ser JPG, PNG, WebP o PDF' }
  }
  const decoded = Buffer.from(match[2]!, 'base64')
  if (!decoded.length || decoded.length > WEB_PROOF_MAX_BYTES) {
    return { ok: false, statusCode: 400, message: 'El comprobante debe pesar hasta 3 MB' }
  }
  if (!matchesProofSignature(decoded, mimeType)) {
    return { ok: false, statusCode: 400, message: 'El contenido del archivo no coincide con su formato' }
  }
  const data = Uint8Array.from(decoded)
  const cleanedFilename = String(filename || defaultProofFilename(mimeType))
    .replace(/[\r\n"]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .trim()
    .slice(0, 160) || defaultProofFilename(mimeType)
  return { ok: true, data, mimeType, filename: cleanedFilename }
}

function defaultProofFilename(mimeType: string) {
  if (mimeType === 'application/pdf') return 'comprobante.pdf'
  if (mimeType === 'image/png') return 'comprobante.png'
  if (mimeType === 'image/webp') return 'comprobante.webp'
  return 'comprobante.jpg'
}

function matchesProofSignature(data: Buffer, mimeType: string) {
  if (mimeType === 'application/pdf') return data.subarray(0, 5).toString('ascii') === '%PDF-'
  if (mimeType === 'image/jpeg') return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (mimeType === 'image/png') return data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/webp') {
    return data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}
