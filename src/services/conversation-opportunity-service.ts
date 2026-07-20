import { prisma } from '../config/prisma.js'

export const CONVERSATION_CLOSE_REASONS = [
  'NO_RESPONSE',
  'PRICE_INQUIRY',
  'NO_AVAILABILITY',
  'NOT_INTERESTED',
  'WRONG_NUMBER',
  'OTHER'
] as const

export type ConversationCloseReason = (typeof CONVERSATION_CLOSE_REASONS)[number]

type ConversationIdRow = { id: string }

export async function markConversationOpportunityConverted(input: {
  businessId: string
  customerPhone: string
  appointmentId: string
}) {
  const conversationRows = await prisma.$queryRawUnsafe<ConversationIdRow[]>(
    `SELECT id
     FROM "Conversation"
     WHERE "businessId" = $1
       AND regexp_replace(phone, '[^0-9]', '', 'g') = regexp_replace($2, '[^0-9]', '', 'g')
     ORDER BY "updatedAt" DESC
     LIMIT 1`,
    input.businessId,
    input.customerPhone
  )
  const conversationId = conversationRows[0]?.id
  if (!conversationId) return null

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { opportunityStatus: true, opportunityAppointmentId: true }
  })
  if (!conversation) return null
  if (conversation.opportunityStatus === 'CONVERTED' && conversation.opportunityAppointmentId === input.appointmentId) {
    return conversationId
  }

  const convertedAt = new Date()
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        opportunityStatus: 'CONVERTED',
        opportunityAppointmentId: input.appointmentId,
        opportunityConvertedAt: convertedAt,
        opportunityClosedAt: null,
        opportunityCloseReason: null,
        opportunityCloseNote: null
      }
    }),
    prisma.conversationOpportunityEvent.create({
      data: {
        conversationId,
        type: 'CONVERTED',
        appointmentId: input.appointmentId,
        createdAt: convertedAt
      }
    })
  ])
  return conversationId
}

export async function reopenClosedConversationOpportunity(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { opportunityStatus: true }
  })
  if (conversation?.opportunityStatus !== 'CLOSED') return false

  const openedAt = new Date()
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversationId },
      data: {
        opportunityStatus: 'OPEN',
        opportunityOpenedAt: openedAt,
        opportunityConvertedAt: null,
        opportunityClosedAt: null,
        opportunityCloseReason: null,
        opportunityCloseNote: null,
        opportunityAppointmentId: null,
        archivedAt: null
      }
    }),
    prisma.conversationOpportunityEvent.create({
      data: {
        conversationId,
        type: 'REOPENED_BY_MESSAGE',
        createdAt: openedAt
      }
    })
  ])
  return true
}

export async function reopenConversationOpportunityForInvalidatedAppointment(appointmentId: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { opportunityAppointmentId: appointmentId },
    select: { id: true }
  })
  if (!conversation) return false

  const openedAt = new Date()
  await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        opportunityStatus: 'OPEN',
        opportunityOpenedAt: openedAt,
        opportunityConvertedAt: null,
        opportunityAppointmentId: null,
        archivedAt: null
      }
    }),
    prisma.conversationOpportunityEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'REOPENED_AFTER_APPOINTMENT_INVALIDATED',
        appointmentId,
        createdAt: openedAt
      }
    })
  ])
  return true
}

export async function closeConversationOpportunity(input: {
  conversationId: string
  businessId?: string | null
  reason: ConversationCloseReason
  note?: string
  actorUserId?: string
}) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: input.conversationId,
      ...(input.businessId ? { businessId: input.businessId } : {})
    },
    select: { id: true, opportunityStatus: true, currentStep: true, humanHandoffResolvedAt: true }
  })
  if (!conversation) return { ok: false as const, statusCode: 404, message: 'No encontre esa conversacion' }
  if (conversation.opportunityStatus === 'CONVERTED') {
    return { ok: false as const, statusCode: 409, message: 'Esta conversacion ya genero un turno' }
  }

  const closedAt = new Date()
  const note = input.note?.trim().slice(0, 500) || null
  const [updated] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        opportunityStatus: 'CLOSED',
        opportunityClosedAt: closedAt,
        opportunityCloseReason: input.reason,
        opportunityCloseNote: note,
        archivedAt: closedAt,
        ...(conversation.currentStep === 'HUMAN_HANDOFF' && !conversation.humanHandoffResolvedAt
          ? { humanHandoffResolvedAt: closedAt }
          : {})
      }
    }),
    prisma.conversationOpportunityEvent.create({
      data: {
        conversationId: conversation.id,
        type: 'CLOSED_WITHOUT_APPOINTMENT',
        reason: input.reason,
        note,
        actorUserId: input.actorUserId ?? null,
        createdAt: closedAt
      }
    })
  ])
  return { ok: true as const, conversation: updated }
}
