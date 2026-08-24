import type { FastifyInstance } from 'fastify'
import type { FunctionalSseSession, SseOpenResult, SseRecorderFacade } from '../observability/egress-baseline/types.js'
import { prisma } from '../config/prisma.js'
import { Prisma, type Message } from '../generated/prisma/client.js'
import { assertBusinessCanSendWhatsApp } from '../services/business-whatsapp-settings.js'
import {
  authorizedBookingDepositWhere,
  authorizedConversationWhere,
  authorizedMessageWhere,
  loadAuthorizedBookingDeposit,
  loadAuthorizedBusiness,
  loadAuthorizedConversation,
  type TenantResourceAuthorizationClient
} from '../services/tenant-resource-authorization.js'
import { sendAuthorizationFailure } from '../services/authorization-response.js'
import type { AuthorizationProviders } from '../providers/authorization-providers.js'
import type { BusinessAuthorizationUser } from '../services/business-authorization.js'
import {
  closeConversationOpportunity,
  CONVERSATION_CLOSE_REASONS,
  markConversationOpportunityConverted,
  type ConversationCloseReason
} from '../services/conversation-opportunity-service.js'
import { bookingDepositService } from '../services/booking-deposit-service.js'
import {
  assistantPersonalityPreview,
  normalizeAssistantPersonality
} from '../services/assistant-personality-service.js'
import {
  normalizeBookingFlowOrder,
  normalizeCatalogDisplayMode
} from '../services/booking-v2-domain.js'
import {
  cleanBookingStateAfterResolvedHandoff,
  conversationPatchFromState,
  stateFromConversation
} from '../services/booking-v2-conversation-state.js'
import { BookingV2Engine } from '../services/booking-v2-engine.js'
import {
  acceptField,
  advanceToNextQueuedService,
  clearFieldAndDependents,
  nextMissingField,
  pendingDepositAppointmentIds,
  type BookingFlowOrder,
  type BookingV2State
} from '../services/booking-v2-state.js'
import { normalizeConversationContextSettings } from '../services/conversation-context-settings.js'
import {
  resolvedConversationHandoffPatch,
  takenConversationHandoffPatch
} from '../services/conversation-handoff.js'
import { sendBookingConfirmationEmail } from '../services/booking-confirmation-email-service.js'
import { customerDurationRange } from '../services/service-duration.js'
import {
  createGoogleCalendarEventForAppointment,
  weexGoogleCalendarEnabled
} from '../services/weex-account-service.js'
import {
  publishConversationUpdated,
  subscribeToCrmRealtimeEvents
} from '../services/crm-realtime-events.js'
import {
  assignTamaraOptionsBotToBusiness,
  getTamaraOptionsBotProfile
} from '../services/business-bot-configuration-service.js'
import { setTamaraOptionsBotEnabled } from '../services/business-bot-activation-service.js'

const bookingV2Engine = new BookingV2Engine()
const WHATSAPP_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000

class AuthorizationStateConflictError extends Error {}
class QaMaintenanceStateConflictError extends Error {}

const QA_MAINTENANCE_CONFIRMATION = 'delete-all-qa-cami-data'
const QA_PHONE_PREFIX = 'qa-cami-'

// Las listas del CRM sólo necesitan el estado de la seña. El archivo binario
// se descarga exclusivamente desde /crm/deposits/:id/proof cuando se lo abre.
const conversationDepositSelect = {
  id: true,
  status: true,
  amount: true
} satisfies Prisma.BookingDepositSelect

const crmDepositAppointmentSelect = {
  id: true,
  startAt: true,
  coordinationGroupId: true,
  customer: {
    select: { name: true, phone: true, email: true }
  },
  professional: {
    select: { name: true }
  },
  service: {
    select: { name: true }
  }
} satisfies Prisma.AppointmentSelect

function conversationStepForPersistedBookingState(
  state: BookingV2State,
  bookingFlowOrder: BookingFlowOrder = 'PROFESSIONAL_FIRST'
) {
  if (state.serviceValidation?.stage === 'awaiting_confirmation') {
    return 'ASK_SERVICE'
  }
  if (
    state.guidedEstimate?.stage === 'awaiting_option' ||
    state.guidedEstimate?.stage === 'awaiting_decision'
  ) {
    return 'ASK_SERVICE'
  }

  const nextField = nextMissingField(state.draft, bookingFlowOrder)
  if (nextField === 'name') return 'ASK_CUSTOMER_NAME'
  if (nextField === 'service') return 'ASK_SERVICE'
  if (nextField === 'professional') return 'ASK_PROFESSIONAL'
  if (nextField === 'date') return 'ASK_DATE'
  if (nextField === 'time') return 'ASK_TIME'
  return 'CONFIRM'
}

function isInlineCrmMedia(contentType: string) {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase()
  return normalized === 'application/pdf' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/png' ||
    normalized === 'image/webp' ||
    normalized === 'image/gif'
}

function safeMediaFilename(
  filename: string | null,
  contentType: string,
  mediaType: 'image' | 'document'
) {
  const sanitized = filename
    ?.replace(/[\r\n"]/g, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .trim()
  if (sanitized) return sanitized.slice(0, 160)

  const normalized = contentType.split(';')[0]?.trim().toLowerCase()
  const extension = normalized === 'application/pdf'
    ? 'pdf'
    : normalized === 'image/png'
      ? 'png'
      : normalized === 'image/webp'
        ? 'webp'
        : normalized === 'image/gif'
          ? 'gif'
          : normalized === 'image/jpeg'
            ? 'jpg'
            : 'bin'
  return `${mediaType === 'image' ? 'imagen' : 'archivo'}.${extension}`
}

export interface CrmRoutesOptions { readonly sseRecorder: SseRecorderFacade }

export async function crmRoutes(app: FastifyInstance, options: CrmRoutesOptions) {
  const routeSessions = new Set<FunctionalSseSession>()
  let routeClosing = false
  app.addHook('preClose', async () => {
    routeClosing = true
    for (const session of [...routeSessions]) session.close('server_shutdown')
  })
  app.get('/crm/events', async (request, reply) => {
    const query = request.query as { businessId?: string }
    const businessId = query.businessId || request.auth?.user.businessId
    if (!businessId) {
      return reply.status(400).send({ message: 'Selecciona un comercio para recibir eventos' })
    }
    if (routeClosing || !options.sseRecorder.canOpenSse()) return reply.status(503).send({ message: 'Eventos temporalmente no disponibles' })

    const response = reply.raw
    try {
      reply.hijack()
      response.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      })
    } catch {
      if (!response.destroyed) response.destroy()
      return reply
    }
    if (routeClosing) {
      try { response.end() } catch { if (!response.destroyed) response.destroy() }
      return reply
    }
    let opened: SseOpenResult
    try {
      opened = options.sseRecorder.openSse(response)
    } catch {
      if (!response.destroyed) response.destroy()
      return reply
    }
    if (opened.status === 'closing') {
      try { response.end() } catch { if (!response.destroyed) response.destroy() }
      return reply
    }
    if (routeClosing) {
      opened.session.close('server_shutdown')
      try { response.end() } catch { if (!response.destroyed) response.destroy() }
      return reply
    }
    routeSessions.add(opened.session)

    let unsubscribe = () => {}
    let heartbeat: NodeJS.Timeout | null = null
    const onRequestClose = () => opened.session.close('client_close')
    const onResponseClose = () => opened.session.close('client_close')
    const onResponseError = () => opened.session.close('write_failure')
    opened.session.bindCleanup((reason) => {
      routeSessions.delete(opened.session)
      if (heartbeat) clearInterval(heartbeat)
      heartbeat = null
      try { unsubscribe() } catch {}
      request.raw.removeListener('close', onRequestClose)
      response.removeListener('close', onResponseClose)
      response.removeListener('error', onResponseError)
      if (reason === 'server_shutdown' && !response.writableEnded && !response.destroyed) {
        try { response.end() } catch { try { response.destroy() } catch {} }
      }
      if ((reason === 'write_failure' || reason === 'unknown') && !response.destroyed) try { response.destroy() } catch {}
    })
    request.raw.once('close', onRequestClose)
    response.once('close', onResponseClose)
    response.once('error', onResponseError)

    const retryChunk = 'retry: 5000\n\n'
    opened.measurement?.control(retryChunk, true)
    try {
      const accepted = response.write(retryChunk)
      if (!accepted) opened.measurement?.writeBackpressure()
    } catch {
      opened.measurement?.writeFailure()
      opened.session.close('write_failure')
      return reply
    }

    try {
      unsubscribe = subscribeToCrmRealtimeEvents({
        businessId,
        send: (event) => {
          if (response.writableEnded || response.destroyed) throw new Error('La conexión de eventos se cerró')
          const chunk = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          opened.measurement?.business(chunk, true)
          try {
            const accepted = response.write(chunk)
            if (!accepted) opened.measurement?.writeBackpressure()
          } catch (error) {
            opened.measurement?.writeFailure()
            opened.session.close('write_failure')
            throw error
          }
        }
      })
      heartbeat = setInterval(() => {
        if (!response.writableEnded && !response.destroyed) {
          const chunk = ': ping\n\n'
          opened.measurement?.heartbeat(chunk, true)
          try {
            const accepted = response.write(chunk)
            if (!accepted) opened.measurement?.writeBackpressure()
          } catch {
            opened.measurement?.writeFailure()
            opened.session.close('write_failure')
          }
        }
      }, 25_000)
      heartbeat.unref()
    } catch {
      opened.session.close('unknown')
      return reply
    }

    return reply
  })

  app.post('/crm/maintenance/delete-qa-data', async (request, reply) => {
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    if (authUser.role !== 'SUPER_ADMIN') return sendAuthorizationFailure(reply, 'forbidden')

    const body = (request.body ?? {}) as { businessId?: string; confirm?: string }
    const businessId = body.businessId?.trim()
    if (!businessId || body.confirm !== QA_MAINTENANCE_CONFIRMATION) {
      return sendAuthorizationFailure(reply, 'malformed')
    }

    const configuredQaBusinessId = process.env.QA_BUSINESS_ID?.trim()
    if (!configuredQaBusinessId) return sendAuthorizationFailure(reply, 'conflict')
    if (businessId !== configuredQaBusinessId) return sendAuthorizationFailure(reply, 'malformed')

    const target = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, isDemo: true, demoType: true }
    })
    if (!target) return sendAuthorizationFailure(reply, 'notFound')
    if (!target.isDemo || target.demoType !== 'QA_SANDBOX') {
      return sendAuthorizationFailure(reply, 'conflict')
    }

    const result = await prisma.$transaction(async (transaction) => {
      const scopedTarget = await transaction.business.findFirst({
        where: { id: businessId, isDemo: true, demoType: 'QA_SANDBOX' },
        select: { id: true }
      })
      if (!scopedTarget) throw new QaMaintenanceStateConflictError()

      const customers = await transaction.customer.findMany({
        where: { businessId, phone: { startsWith: QA_PHONE_PREFIX } },
        select: { id: true, phone: true }
      })
      const conversations = await transaction.conversation.findMany({
        where: { businessId, phone: { startsWith: QA_PHONE_PREFIX } },
        select: { id: true, phone: true }
      })
      const customerIds = customers.map(({ id }) => id)
      const conversationIds = conversations.map(({ id }) => id)
      const appointments = customerIds.length
        ? await transaction.appointment.findMany({
            where: {
              customerId: { in: customerIds },
              customer: { businessId },
              professional: { businessId }
            },
            select: { id: true }
          })
        : []
      const appointmentIds = appointments.map(({ id }) => id)

      const foreignDeposits = appointmentIds.length || conversationIds.length
        ? await transaction.bookingDeposit.count({
            where: {
              businessId: { not: businessId },
              OR: [
                ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : []),
                ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])
              ]
            }
          })
        : 0
      if (foreignDeposits) throw new QaMaintenanceStateConflictError()

      const deposits = appointmentIds.length || conversationIds.length
        ? await transaction.bookingDeposit.findMany({
            where: {
              businessId,
              OR: [
                ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : []),
                ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])
              ]
            },
            select: { id: true }
          })
        : []
      const depositIds = deposits.map(({ id }) => id)
      const messages = conversationIds.length
        ? await transaction.message.findMany({
            where: {
              conversationId: { in: conversationIds },
              conversation: { businessId, phone: { startsWith: QA_PHONE_PREFIX } }
            },
            select: { id: true }
          })
        : []
      const messageIds = messages.map(({ id }) => id)
      const notes = customerIds.length
        ? await transaction.customerNote.findMany({
            where: {
              customerId: { in: customerIds },
              customer: { businessId, phone: { startsWith: QA_PHONE_PREFIX } }
            },
            select: { id: true }
          })
        : []
      const noteIds = notes.map(({ id }) => id)

      if (appointmentIds.length || conversationIds.length) {
        await transaction.aiUsageEvent.deleteMany({
          where: {
            businessId,
            OR: [
              ...(appointmentIds.length ? [{ appointmentId: { in: appointmentIds } }] : []),
              ...(conversationIds.length ? [{ conversationId: { in: conversationIds } }] : [])
            ]
          }
        })
      }
      const deletedDeposits = depositIds.length
        ? await transaction.bookingDeposit.deleteMany({
            where: {
              id: { in: depositIds },
              businessId,
              OR: [
                ...(appointmentIds.length
                  ? [{
                      appointmentId: { in: appointmentIds },
                      appointment: { customer: { businessId }, professional: { businessId } }
                    }]
                  : []),
                ...(conversationIds.length
                  ? [{ conversationId: { in: conversationIds }, conversation: { businessId } }]
                  : [])
              ]
            }
          })
        : { count: 0 }
      if (deletedDeposits.count !== depositIds.length) throw new QaMaintenanceStateConflictError()
      const deletedMessages = messageIds.length
        ? await transaction.message.deleteMany({
            where: {
              id: { in: messageIds },
              conversationId: { in: conversationIds },
              conversation: { businessId, phone: { startsWith: QA_PHONE_PREFIX } }
            }
          })
        : { count: 0 }
      if (deletedMessages.count !== messageIds.length) throw new QaMaintenanceStateConflictError()
      const deletedConversations = conversationIds.length
        ? await transaction.conversation.deleteMany({
            where: { id: { in: conversationIds }, businessId, phone: { startsWith: QA_PHONE_PREFIX } }
          })
        : { count: 0 }
      if (deletedConversations.count !== conversationIds.length) throw new QaMaintenanceStateConflictError()
      const deletedAppointments = appointmentIds.length
        ? await transaction.appointment.deleteMany({
            where: {
              id: { in: appointmentIds },
              customer: { businessId, phone: { startsWith: QA_PHONE_PREFIX } },
              professional: { businessId }
            }
          })
        : { count: 0 }
      if (deletedAppointments.count !== appointmentIds.length) throw new QaMaintenanceStateConflictError()
      const deletedNotes = noteIds.length
        ? await transaction.customerNote.deleteMany({
            where: {
              id: { in: noteIds },
              customerId: { in: customerIds },
              customer: { businessId, phone: { startsWith: QA_PHONE_PREFIX } }
            }
          })
        : { count: 0 }
      if (deletedNotes.count !== noteIds.length) throw new QaMaintenanceStateConflictError()
      const deletedCustomers = customerIds.length
        ? await transaction.customer.deleteMany({
            where: { id: { in: customerIds }, businessId, phone: { startsWith: QA_PHONE_PREFIX } }
          })
        : { count: 0 }
      if (deletedCustomers.count !== customerIds.length) throw new QaMaintenanceStateConflictError()

      return {
        businessId,
        deleted: {
          deposits: deletedDeposits.count,
          messages: deletedMessages.count,
          conversations: deletedConversations.count,
          appointments: deletedAppointments.count,
          notes: deletedNotes.count,
          customers: deletedCustomers.count
        },
        customerPhones: customers.map(({ phone }) => phone),
        conversationPhones: conversations.map(({ phone }) => phone)
      }
    }).catch((error: unknown) => {
      if (error instanceof QaMaintenanceStateConflictError) return null
      throw error
    })
    if (!result) return sendAuthorizationFailure(reply, 'conflict')
    return result
  })

  app.get('/crm/conversations', async (request) => {
    const query = request.query as {
      businessId?: string
      phone?: string
      take?: string
      cursor?: string
      since?: string
      archive?: 'active' | 'archived' | 'all'
      filter?: 'handoff'
      paginated?: string
    }
    const take = Math.min(Math.max(Number(query.take ?? 30) || 30, 1), 100)
    const archiveView = query.archive ?? 'all'
    await bookingDepositService.expireOverdue()
    await archiveOldCompletedConversations(query.businessId)

    const since = parseOptionalDate(query.since)
    const where: Prisma.ConversationWhereInput = {
      ...conversationListWhere({
        ...(query.businessId ? { businessId: query.businessId } : {}),
        ...(query.phone ? { phone: query.phone } : {}),
        archiveView,
        ...(query.filter ? { filter: query.filter } : {})
      }),
      ...(since ? { updatedAt: { gt: since } } : {})
    }

    const conversations = await prisma.conversation.findMany({
      where,
      include: {
        bookingDeposits: {
          select: conversationDepositSelect,
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: {
        updatedAt: 'desc'
      },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })

    const conversationIds = conversations.map((conversation) => conversation.id)
    const [latestMessages, latestInboundMessages] = await Promise.all([
      latestMessagesByConversationId(conversationIds),
      latestInboundMessagesByConversationId(conversationIds)
    ])
    const conversationsWithLatestMessage = conversations.map((conversation) => ({
      ...conversation,
      messages: latestMessages.has(conversation.id)
        ? [latestMessages.get(conversation.id)!]
        : [],
      latestInboundMessage: latestInboundMessages.get(conversation.id) ?? null
    }))

    const hasMore = conversationsWithLatestMessage.length > take
    const items = conversationsWithLatestMessage.slice(0, take).sort((left, right) => {
      return latestConversationActivityAt(right) - latestConversationActivityAt(left)
    })
    const itemsWithReplyWindow = await attachConversationReplyWindow(items)

    if (query.paginated !== 'true') {
      return itemsWithReplyWindow
    }

    const [counts, latestActivityAt] = await Promise.all([
      conversationCounts(query.businessId),
      latestConversationActivityAtForBusiness(query.businessId)
    ])

    return {
      items: itemsWithReplyWindow,
      nextCursor: since ? null : hasMore ? itemsWithReplyWindow[itemsWithReplyWindow.length - 1]?.id ?? null : null,
      counts,
      latestActivityAt
    }
  })

  app.get('/crm/conversations/summary', async (request) => {
    const query = request.query as {
      businessId?: string
    }
    const [counts, latestActivityAt] = await Promise.all([
      conversationCounts(query.businessId),
      latestConversationActivityAtForBusiness(query.businessId)
    ])

    return {
      counts,
      latestActivityAt
    }
  })

  app.get('/crm/conversations/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const conversation = await conversationListItemById(params.id, authUser)
    if (!conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    return conversation
  })

  app.get('/crm/messages/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const message = await prisma.message.findFirst({
      where: authorizedMessageWhere(authUser, params.id)
    })
    if (!message) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    return message
  })

  app.get('/crm/ai-settings', async (request) => {
    const query = request.query as {
      businessId?: string
    }

    const business = await findCrmBusiness(query.businessId)
    const featureSettings = business
      ? await prisma.businessFeatureSettings.findUnique({
          where: { businessId: business.id },
          select: {
            bookingV2Enabled: true,
            serviceCatalogDisplayMode: true,
            bookingFlowOrder: true,
            conversationPauseAfterMinutes: true,
            conversationExpireAfterMinutes: true,
            assistantPersonality: true
          }
        })
      : null
    const assistantPersonality = normalizeAssistantPersonality(
      featureSettings?.assistantPersonality
    )
    const contextSettings = normalizeConversationContextSettings(featureSettings)
    const tamaraOptionsBot = business
      ? await getTamaraOptionsBotProfile(business.id)
      : { available: false, professional: null, assigned: false, enabled: false }

    return {
      businessId: business?.id ?? null,
      botEnabled: business?.botEnabled ?? true,
      aiEnabled: business?.aiEnabled ?? true,
      bookingV2Enabled: Boolean(featureSettings?.bookingV2Enabled),
      serviceCatalogDisplayMode: normalizeCatalogDisplayMode(
        featureSettings?.serviceCatalogDisplayMode
      ),
      bookingFlowOrder: normalizeBookingFlowOrder(featureSettings?.bookingFlowOrder),
      conversationPauseAfterMinutes: contextSettings.pauseAfterMinutes,
      conversationExpireAfterMinutes: contextSettings.expireAfterMinutes,
      tamaraOptionsBot,
      assistantPersonality,
      assistantPersonalityPreview: assistantPersonalityPreview(assistantPersonality)
    }
  })

  app.patch('/crm/ai-settings', async (request, reply) => {
    const body = request.body as {
      businessId?: string
      botEnabled?: boolean
      aiEnabled?: boolean
      bookingV2Enabled?: boolean
      serviceCatalogDisplayMode?: string
      bookingFlowOrder?: string
      conversationPauseAfterMinutes?: number
      conversationExpireAfterMinutes?: number
      assistantPersonality?: unknown
      tamaraOptionsBotEnabled?: boolean
    }

    if (
      typeof body.botEnabled !== 'boolean' &&
      typeof body.aiEnabled !== 'boolean' &&
      typeof body.bookingV2Enabled !== 'boolean' &&
      body.serviceCatalogDisplayMode === undefined &&
      body.bookingFlowOrder === undefined &&
      body.conversationPauseAfterMinutes === undefined &&
      body.conversationExpireAfterMinutes === undefined &&
      body.assistantPersonality === undefined
      && typeof body.tamaraOptionsBotEnabled !== 'boolean'
    ) {
      return reply.status(400).send({
        message: 'Envia una configuracion valida para actualizar'
      })
    }

    const business = await findCrmBusiness(body.businessId)

    if (!business) {
      return reply.status(404).send({
        message: 'No encontre un negocio cargado'
      })
    }

    if (typeof body.tamaraOptionsBotEnabled === 'boolean') {
      const profile = await getTamaraOptionsBotProfile(business.id)
      if (!profile.available || !profile.professional) {
        return reply.status(409).send({ message: 'Este bot sólo está disponible para el perfil profesional de Tamara.' })
      }
      try {
        if (body.tamaraOptionsBotEnabled && !profile.assigned) {
          await assignTamaraOptionsBotToBusiness(business.id, profile.professional.id)
        }
        if (body.tamaraOptionsBotEnabled || profile.assigned) {
          await setTamaraOptionsBotEnabled(business.id, body.tamaraOptionsBotEnabled)
        }
      } catch (error) {
        return reply.status(409).send({ message: error instanceof Error ? error.message : 'No pude actualizar el bot de Tamara' })
      }
    }

    if (
      body.serviceCatalogDisplayMode !== undefined &&
      !['ALL_SERVICES', 'CATEGORIES_FIRST'].includes(body.serviceCatalogDisplayMode)
    ) {
      return reply.status(400).send({
        message: 'Seleccioná una forma válida de mostrar el catálogo.'
      })
    }

    if (
      body.bookingFlowOrder !== undefined &&
      !['PROFESSIONAL_FIRST', 'DATE_TIME_FIRST'].includes(body.bookingFlowOrder)
    ) {
      return reply.status(400).send({
        message: 'Seleccioná un orden válido para solicitar los datos de la reserva.'
      })
    }

    const hasContextSettings = body.conversationPauseAfterMinutes !== undefined ||
      body.conversationExpireAfterMinutes !== undefined
    if (hasContextSettings) {
      if (
        !Number.isInteger(body.conversationPauseAfterMinutes) ||
        !Number.isInteger(body.conversationExpireAfterMinutes) ||
        body.conversationPauseAfterMinutes! < 15 ||
        body.conversationPauseAfterMinutes! > 720 ||
        body.conversationExpireAfterMinutes! < 60 ||
        body.conversationExpireAfterMinutes! > 10080 ||
        body.conversationExpireAfterMinutes! <= body.conversationPauseAfterMinutes!
      ) {
        return reply.status(400).send({
          message: 'La pausa debe ser de 15 minutos a 12 horas y el reinicio debe ocurrir después, hasta 7 días.'
        })
      }
    }

    const updatedBusiness = await prisma.business.update({
      where: {
        id: business.id
      },
      data: {
        ...(typeof body.botEnabled === 'boolean' ? { botEnabled: body.botEnabled } : {}),
        ...(typeof body.aiEnabled === 'boolean' ? { aiEnabled: body.aiEnabled } : {})
      },
      select: {
        id: true,
        botEnabled: true,
        aiEnabled: true
      }
    })

    if (
      typeof body.bookingV2Enabled === 'boolean' ||
      body.serviceCatalogDisplayMode !== undefined ||
      body.bookingFlowOrder !== undefined ||
      hasContextSettings ||
      body.assistantPersonality !== undefined
    ) {
      const assistantPersonality = body.assistantPersonality === undefined
        ? undefined
        : normalizeAssistantPersonality(body.assistantPersonality)
      await prisma.businessFeatureSettings.upsert({
        where: { businessId: business.id },
        create: {
          businessId: business.id,
          ...(typeof body.bookingV2Enabled === 'boolean'
            ? { bookingV2Enabled: body.bookingV2Enabled }
            : {}),
          ...(body.serviceCatalogDisplayMode !== undefined
            ? { serviceCatalogDisplayMode: body.serviceCatalogDisplayMode as 'ALL_SERVICES' | 'CATEGORIES_FIRST' }
            : {}),
          ...(body.bookingFlowOrder !== undefined
            ? { bookingFlowOrder: body.bookingFlowOrder as 'PROFESSIONAL_FIRST' | 'DATE_TIME_FIRST' }
            : {}),
          ...(hasContextSettings ? {
            conversationPauseAfterMinutes: body.conversationPauseAfterMinutes!,
            conversationExpireAfterMinutes: body.conversationExpireAfterMinutes!
          } : {}),
          ...(assistantPersonality
            ? { assistantPersonality: assistantPersonality as Prisma.InputJsonValue }
            : {})
        },
        update: {
          ...(typeof body.bookingV2Enabled === 'boolean'
            ? { bookingV2Enabled: body.bookingV2Enabled }
            : {}),
          ...(body.serviceCatalogDisplayMode !== undefined
            ? { serviceCatalogDisplayMode: body.serviceCatalogDisplayMode as 'ALL_SERVICES' | 'CATEGORIES_FIRST' }
            : {}),
          ...(body.bookingFlowOrder !== undefined
            ? { bookingFlowOrder: body.bookingFlowOrder as 'PROFESSIONAL_FIRST' | 'DATE_TIME_FIRST' }
            : {}),
          ...(hasContextSettings ? {
            conversationPauseAfterMinutes: body.conversationPauseAfterMinutes!,
            conversationExpireAfterMinutes: body.conversationExpireAfterMinutes!
          } : {}),
          ...(assistantPersonality
            ? { assistantPersonality: assistantPersonality as Prisma.InputJsonValue }
            : {})
        }
      })
    }

    const featureSettings = await prisma.businessFeatureSettings.findUnique({
      where: { businessId: business.id },
      select: {
        bookingV2Enabled: true,
        serviceCatalogDisplayMode: true,
        bookingFlowOrder: true,
        conversationPauseAfterMinutes: true,
        conversationExpireAfterMinutes: true,
        assistantPersonality: true
      }
    })
    const assistantPersonality = normalizeAssistantPersonality(
      featureSettings?.assistantPersonality
    )
    const contextSettings = normalizeConversationContextSettings(featureSettings)
    const tamaraOptionsBot = await getTamaraOptionsBotProfile(business.id)

    return {
      ...updatedBusiness,
      bookingV2Enabled: Boolean(featureSettings?.bookingV2Enabled),
      serviceCatalogDisplayMode: normalizeCatalogDisplayMode(
        featureSettings?.serviceCatalogDisplayMode
      ),
      bookingFlowOrder: normalizeBookingFlowOrder(featureSettings?.bookingFlowOrder),
      conversationPauseAfterMinutes: contextSettings.pauseAfterMinutes,
      conversationExpireAfterMinutes: contextSettings.expireAfterMinutes,
      tamaraOptionsBot,
      assistantPersonality,
      assistantPersonalityPreview: assistantPersonalityPreview(assistantPersonality)
    }
  })

  app.get('/crm/conversations/:id/messages', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const query = request.query as {
      take?: string
      cursor?: string
      paginated?: string
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const conversation = await loadAuthorizedConversation(prisma, authUser, params.id)

    if (!conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }

    const take = Math.min(Math.max(Number(query.take ?? 100) || 100, 1), 200)
    const messages = await prisma.message.findMany({
      where: {
        conversationId: params.id,
        conversation: authorizedConversationWhere(authUser, params.id)
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
    })

    const hasMore = messages.length > take
    const page = messages.slice(0, take)
    const oldestCursor = page[page.length - 1]?.id ?? null
    const items = page.reverse()

    if (query.paginated !== 'true') {
      return items
    }

    return {
      items,
      nextCursor: hasMore ? oldestCursor : null
    }
  })

  app.get('/crm/messages/:id/media', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const message = await prisma.message.findFirst({
      where: authorizedMessageWhere(authUser, params.id),
      include: {
        conversation: {
          select: { businessId: true }
        }
      }
    })
    const metadata = message?.metadata && typeof message.metadata === 'object'
      ? message.metadata as Record<string, unknown>
      : null
    const media = metadata?.media && typeof metadata.media === 'object'
      ? metadata.media as Record<string, unknown>
      : null
    const mediaId = typeof media?.id === 'string' ? media.id : null
    const rawMediaType = media?.type
    const mediaType = rawMediaType === 'image' || rawMediaType === 'document'
      ? rawMediaType
      : null

    if (!message || !mediaId || !mediaType) {
      return sendAuthorizationFailure(reply, 'notFound')
    }

    const downloaded = await app.authorizationProviders.media.download({
      businessId: message.conversation.businessId,
      mediaId
    })
    if (!downloaded.downloaded) {
      return reply.status(502).send({
        message: downloaded.errorMessage || downloaded.reason || 'No pude descargar el archivo'
      })
    }

    const rawFilename = media && typeof media.filename === 'string'
      ? media.filename
      : null
    const filename = safeMediaFilename(
      rawFilename,
      downloaded.contentType,
      mediaType
    )
    const disposition = isInlineCrmMedia(downloaded.contentType)
      ? 'inline'
      : 'attachment'

    return reply
      .header('Content-Type', downloaded.contentType)
      .header('Content-Disposition', `${disposition}; filename="${filename}"`)
      .header('Cache-Control', 'private, max-age=300')
      .send(downloaded.data)
  })

  app.get('/crm/deposits', async (request, reply) => {
    const query = request.query as { businessId?: string; view?: 'active' | 'resolved' | 'all'; summary?: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const businessId = query.businessId || authUser.businessId
    if (!businessId) return sendAuthorizationFailure(reply, 'malformed')
    if (!await loadAuthorizedBusiness(prisma, authUser, businessId)) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    await bookingDepositService.expireOverdue()
    const activeStatuses: Array<'PENDING_PROOF' | 'PROOF_RECEIVED'> = ['PENDING_PROOF', 'PROOF_RECEIVED']
    const view = query.view || 'active'
    if (query.summary === 'true') {
      const [activeCount, reviewCount] = await Promise.all([
        prisma.bookingDeposit.count({
          where: { businessId, status: { in: [...activeStatuses] } }
        }),
        prisma.bookingDeposit.count({
          where: { businessId, status: 'PROOF_RECEIVED' }
        })
      ])
      return { activeCount, reviewCount }
    }
    const deposits = await prisma.bookingDeposit.findMany({
      where: view === 'active'
        ? { businessId, status: { in: activeStatuses } }
        : view === 'resolved'
          ? { businessId, status: { in: ['APPROVED', 'REJECTED', 'EXPIRED'] } }
          : { businessId },
      select: {
        id: true,
        source: true,
        status: true,
        mode: true,
        amount: true,
        expiresAt: true,
        proofMessageId: true,
        proofMimeType: true,
        proofFilename: true,
        reviewedAt: true,
        rejectionReason: true,
        createdAt: true,
        updatedAt: true,
        conversationId: true,
        appointment: {
          select: crmDepositAppointmentSelect
        }
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 100
    })
    const activeCount = await prisma.bookingDeposit.count({
      where: { businessId, status: { in: [...activeStatuses] } }
    })
    const reviewCount = await prisma.bookingDeposit.count({
      where: { businessId, status: 'PROOF_RECEIVED' }
    })
    const coordinationGroupIds = Array.from(new Set(deposits
      .map((deposit) => deposit.appointment.coordinationGroupId)
      .filter((id): id is string => Boolean(id))))
    const coordinatedAppointments = coordinationGroupIds.length
      ? await prisma.appointment.findMany({
          where: {
            coordinationGroupId: { in: coordinationGroupIds },
            professional: { businessId }
          },
          select: crmDepositAppointmentSelect,
          orderBy: { startAt: 'asc' }
        })
      : []
    return {
      items: deposits.map((deposit) => ({
        ...deposit,
        coordinatedAppointments: deposit.appointment.coordinationGroupId
          ? coordinatedAppointments.filter((appointment) =>
              appointment.coordinationGroupId === deposit.appointment.coordinationGroupId
            )
          : [deposit.appointment]
      })),
      activeCount,
      reviewCount
    }
  })

  app.get('/crm/deposits/:id/proof', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const deposit = await prisma.bookingDeposit.findFirst({
      where: authorizedBookingDepositWhere(authUser, params.id),
      select: {
        businessId: true,
        source: true,
        proofData: true,
        proofMimeType: true,
        proofFilename: true
      }
    })
    if (!deposit?.proofData || deposit.source !== 'WEB') {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    const contentType = deposit.proofMimeType || 'application/octet-stream'
    const filename = safeMediaFilename(
      deposit.proofFilename,
      contentType,
      contentType.startsWith('image/') ? 'image' : 'document'
    )
    return reply
      .header('Content-Type', contentType)
      .header('Content-Disposition', `inline; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store')
      .send(Buffer.from(deposit.proofData))
  })

  app.post('/crm/deposits/:id/approve', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const deposit = await loadAuthorizedBookingDeposit(prisma, authUser, params.id)
    if (!deposit || deposit.source !== 'WEB') return sendAuthorizationFailure(reply, 'notFound')
    await bookingDepositService.expireOverdue()
    if (deposit.status !== 'PROOF_RECEIVED') {
      return reply.status(409).send({ message: 'La seña no tiene un comprobante pendiente de revisión' })
    }
    const reviewedAt = app.clock()
    const approved = await prisma.$transaction(async (tx) => {
      const scopedDeposit = await loadAuthorizedBookingDeposit(tx, authUser, params.id)
      if (!scopedDeposit || scopedDeposit.source !== 'WEB' || scopedDeposit.status !== 'PROOF_RECEIVED') {
        return { approved: false as const, heldAppointmentIds: [] }
      }
      const heldAppointmentIds = await coordinatedAppointmentIds(
        tx,
        scopedDeposit.appointmentId,
        scopedDeposit.businessId
      )
      if (heldAppointmentIds.length === 0) {
        return { approved: false as const, heldAppointmentIds: [] }
      }
      const heldAppointment = await tx.appointment.count({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: scopedDeposit.businessId },
          status: 'PENDING'
        }
      })
      if (heldAppointment !== heldAppointmentIds.length) {
        return { approved: false as const, heldAppointmentIds: [] }
      }
      const claimed = await tx.bookingDeposit.updateMany({
        where: {
          ...authorizedBookingDepositWhere(authUser, scopedDeposit.id),
          businessId: scopedDeposit.businessId,
          source: 'WEB',
          status: 'PROOF_RECEIVED'
        },
        data: { status: 'APPROVED', reviewedAt, reviewedByUserId: authUser.id, rejectionReason: null }
      })
      if (!claimed.count) return { approved: false as const, heldAppointmentIds: [] }
      const confirmedAppointments = await tx.appointment.updateMany({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: scopedDeposit.businessId },
          status: 'PENDING'
        },
        data: { status: 'CONFIRMED' }
      })
      if (confirmedAppointments.count !== heldAppointmentIds.length) {
        throw new AuthorizationStateConflictError()
      }
      return { approved: true as const, heldAppointmentIds }
    }).catch((error: unknown) => {
      if (error instanceof AuthorizationStateConflictError) {
        return { approved: false as const, heldAppointmentIds: [] }
      }
      throw error
    })
    if (!approved.approved) return sendAuthorizationFailure(reply, 'conflict')
    const appointments = await prisma.appointment.findMany({
      where: {
        id: { in: approved.heldAppointmentIds },
        professional: { businessId: deposit.businessId }
      },
      include: {
        customer: {
          include: {
            weexLinks: {
              where: { businessId: deposit.businessId },
              include: { weexAccount: true },
              take: 1
            }
          }
        },
        service: true,
        professional: { include: { business: true } }
      }
    })
    for (const appointment of appointments) {
      const account = appointment.customer.weexLinks[0]?.weexAccount
      if (appointment.customer.email) {
        void sendBookingConfirmationEmail({
          recipientEmail: appointment.customer.email,
          recipientName: appointment.customer.name,
          appointmentId: appointment.id,
          businessName: appointment.professional.business.name,
          businessAddress: [appointment.professional.business.publicAddress, appointment.professional.business.publicAddressArea].filter(Boolean).join(', ') || null,
          businessAddressArea: appointment.professional.business.publicAddressArea,
          serviceName: appointment.service.name,
          professionalName: appointment.professional.name,
          startAt: appointment.startAt,
          durationMinutes: customerDurationRange(appointment.service).max
        }).catch((error) => request.log.error({ error, appointmentId: appointment.id }, 'No se pudo enviar el correo de confirmacion'))
      }
      if (account && weexGoogleCalendarEnabled()) {
        void createGoogleCalendarEventForAppointment({
          accountId: account.id,
          appointmentId: appointment.id
        }).catch((error) => request.log.error({ error, appointmentId: appointment.id }, 'No se pudo sincronizar Google Calendar'))
      }
    }
    return { ok: true }
  })

  app.post('/crm/deposits/:id/reject', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { reason?: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const deposit = await loadAuthorizedBookingDeposit(prisma, authUser, params.id)
    if (!deposit || deposit.source !== 'WEB') return sendAuthorizationFailure(reply, 'notFound')
    const reason = body.reason?.trim().slice(0, 300) || 'No pudimos validar el comprobante'
    const rejected = await prisma.$transaction(async (tx) => {
      const scopedDeposit = await loadAuthorizedBookingDeposit(tx, authUser, params.id)
      if (!scopedDeposit || scopedDeposit.source !== 'WEB') {
        return { rejected: false as const, heldAppointmentIds: [] }
      }
      const heldAppointmentIds = await coordinatedAppointmentIds(
        tx,
        scopedDeposit.appointmentId,
        scopedDeposit.businessId
      )
      if (heldAppointmentIds.length === 0) {
        return { rejected: false as const, heldAppointmentIds: [] }
      }
      const heldAppointmentCount = await tx.appointment.count({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: scopedDeposit.businessId }
        }
      })
      if (heldAppointmentCount !== heldAppointmentIds.length) {
        return { rejected: false as const, heldAppointmentIds: [] }
      }
      const claimed = await tx.bookingDeposit.updateMany({
        where: {
          ...authorizedBookingDepositWhere(authUser, scopedDeposit.id),
          businessId: scopedDeposit.businessId,
          source: 'WEB',
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        },
        data: { status: 'REJECTED', reviewedAt: app.clock(), reviewedByUserId: authUser.id, rejectionReason: reason }
      })
      if (!claimed.count) return { rejected: false as const, heldAppointmentIds: [] }
      const cancelledAppointments = await tx.appointment.updateMany({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: scopedDeposit.businessId },
          status: 'PENDING'
        },
        data: { status: 'CANCELLED' }
      })
      if (cancelledAppointments.count !== heldAppointmentIds.length) {
        throw new AuthorizationStateConflictError()
      }
      return { rejected: true as const, heldAppointmentIds }
    }).catch((error: unknown) => {
      if (error instanceof AuthorizationStateConflictError) {
        return { rejected: false as const, heldAppointmentIds: [] }
      }
      throw error
    })
    if (!rejected.rejected) return sendAuthorizationFailure(reply, 'conflict')
    return { ok: true }
  })

  app.patch('/crm/conversations/:id/archive', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { archived?: boolean }
    if (typeof body.archived !== 'boolean') {
      return sendAuthorizationFailure(reply, 'malformed')
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const conversation = await loadAuthorizedConversation(prisma, authUser, params.id)
    if (!conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    if (body.archived && conversation.currentStep === 'HUMAN_HANDOFF' && !conversation.humanHandoffResolvedAt) {
      return reply.status(409).send({ message: 'Resolve la derivacion antes de archivar la conversacion' })
    }

    const claimed = await prisma.conversation.updateMany({
      where: {
        ...authorizedConversationWhere(authUser, params.id),
        updatedAt: conversation.updatedAt
      },
      data: { archivedAt: body.archived ? new Date() : null }
    })
    if (!claimed.count) return sendAuthorizationFailure(reply, 'conflict')
    const updated = await loadAuthorizedConversation(prisma, authUser, params.id)
    if (!updated) return sendAuthorizationFailure(reply, 'notFound')
    publishCrmConversationUpdated(updated)
    return updated
  })

  app.patch('/crm/conversations/:id/opportunity/close', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { reason?: string; note?: string }
    if (!body.reason || !CONVERSATION_CLOSE_REASONS.includes(body.reason as ConversationCloseReason)) {
      return reply.status(400).send({ message: 'Selecciona un motivo de cierre valido' })
    }

    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })
    const result = await closeConversationOpportunity({
      conversationId: params.id,
      reason: body.reason as ConversationCloseReason,
      ...(authUser?.role === 'SUPER_ADMIN'
        ? { businessId: null }
        : authUser?.businessId ? { businessId: authUser.businessId } : {}),
      ...(body.note === undefined ? {} : { note: body.note }),
      ...(authUser?.id ? { actorUserId: authUser.id } : {})
    })
    if (!result.ok) return reply.status(result.statusCode).send({ message: result.message })
    return result.conversation
  })

  app.patch('/crm/conversations/:id/ai', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      aiEnabled?: boolean
    }

    if (typeof body.aiEnabled !== 'boolean') {
      return sendAuthorizationFailure(reply, 'malformed')
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const conversation = await loadAuthorizedConversation(prisma, authUser, params.id)

    if (!conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    if (!conversation.businessId) return sendAuthorizationFailure(reply, 'notFound')

    const isEnablingAi = body.aiEnabled
    const isResolvingHandoff = isEnablingAi && (
      conversation.currentStep === 'HUMAN_HANDOFF' || !conversation.aiEnabled
    )
    const nextState = isEnablingAi
      ? isResolvingHandoff
        ? cleanBookingStateAfterResolvedHandoff(conversation)
        : stateFromConversation(conversation)
      : null
    const nextPatch = nextState
      ? conversationPatchFromState(nextState)
      : null
    if (isEnablingAi) {
      const activeDeposit = await prisma.bookingDeposit.findFirst({
        where: {
          conversationId: conversation.id,
          businessId: conversation.businessId,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        },
        select: { id: true }
      })
      if (activeDeposit) {
        return reply.status(409).send({
          message: 'Aproba o rechaza la seña pendiente antes de resolver la derivacion'
        })
      }
    }

    const claimed = await prisma.conversation.updateMany({
      where: {
        ...authorizedConversationWhere(authUser, params.id),
        updatedAt: conversation.updatedAt
      },
      data: body.aiEnabled
        ? {
            ...(isResolvingHandoff
              ? resolvedConversationHandoffPatch()
              : { aiEnabled: true }),
            ...(isResolvingHandoff ? {} : {
              currentStep: conversationStepForPersistedBookingState(nextState!)
            }),
            ...nextPatch!,
            bookingV2State: nextPatch?.bookingV2State
              ? nextPatch.bookingV2State as Prisma.InputJsonValue
              : Prisma.JsonNull,
            supportBotState: Prisma.JsonNull,
            ...(isResolvingHandoff ? { lastAvailability: Prisma.JsonNull } : {})
          }
          : takenConversationHandoffPatch({ queuedAt: conversation.humanHandoffAt })
    })
    if (!claimed.count) return sendAuthorizationFailure(reply, 'conflict')
    const updated = await loadAuthorizedConversation(prisma, authUser, params.id)
    if (!updated) return sendAuthorizationFailure(reply, 'notFound')
    publishCrmConversationUpdated(updated)
    return updated
  })

  app.post('/crm/conversations/:id/service-resolution', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { serviceId?: string | null }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')

    const conversation = await loadAuthorizedConversation(prisma, authUser, params.id)
    if (!conversation?.businessId) return sendAuthorizationFailure(reply, 'notFound')
    if (conversation.currentStep !== 'HUMAN_HANDOFF' || conversation.aiEnabled) {
      return reply.status(409).send({
        message: 'La conversacion no esta esperando la intervencion de un asesor'
      })
    }

    const activeDeposit = await prisma.bookingDeposit.findFirst({
      where: {
        conversationId: conversation.id,
        businessId: conversation.businessId,
        status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
      },
      select: { id: true }
    })
    if (activeDeposit) {
      return reply.status(409).send({
        message: 'Aproba o rechaza la seña pendiente antes de devolver la conversacion al bot'
      })
    }

    let state = stateFromConversation(conversation)
    if (body.serviceId) {
      const service = await prisma.service.findFirst({
        where: {
          id: body.serviceId,
          businessId: conversation.businessId,
          isBookable: true
        },
        select: {
          id: true,
          validationEnabled: true
        }
      })
      if (!service) {
        return reply.status(404).send({ message: 'No encontre ese servicio reservable' })
      }
      state = acceptField(state, 'service', service.id)
      state = {
        ...state,
        serviceValidation: service.validationEnabled
          ? { serviceId: service.id, stage: 'completed' }
          : null,
        guidedEstimate: null,
        advisorQuote: null,
        pendingDeposit: null,
        misunderstandingCount: 0
      }
    } else {
      state = {
        ...state,
        draft: clearFieldAndDependents(state.draft, 'service'),
        pendingProposal: null,
        serviceValidation: null,
        guidedEstimate: null,
        advisorQuote: null,
        pendingDeposit: null,
        misunderstandingCount: 0
      }
    }

    const initialPatch = conversationPatchFromState(state)
    const resumed = await bookingV2Engine.resume({
      businessId: conversation.businessId,
      conversation: {
        ...conversation,
        ...initialPatch,
        bookingV2State: initialPatch.bookingV2State
      }
    })
    if (resumed.plan.type === 'handoff') {
      return reply.status(409).send({
        message: 'Ese servicio requiere que el equipo siga atendiendolo manualmente o cargue un presupuesto'
      })
    }

    const delivery = await sendCrmAutomatedMessage({
      conversationId: conversation.id,
      businessId: conversation.businessId,
      phone: conversation.phone,
      text: resumed.reply,
      provider: body.serviceId
        ? 'crm_advisor_service_resolution'
        : 'crm_advisor_catalog_return',
      whatsapp: app.authorizationProviders.whatsapp
    })
    if (!delivery.sent) {
      return reply.status(502).send({
        message: 'No pude enviar el siguiente paso por WhatsApp. La conversacion sigue en atencion manual.'
      })
    }

    const patch = resumed.conversationPatch
    const bookingFlowOrder = normalizeBookingFlowOrder((await prisma.businessFeatureSettings.findUnique({
      where: { businessId: conversation.businessId },
      select: { bookingFlowOrder: true }
    }))?.bookingFlowOrder)
    const claimed = await prisma.conversation.updateMany({
      where: {
        ...authorizedConversationWhere(authUser, conversation.id),
        currentStep: 'HUMAN_HANDOFF',
        aiEnabled: false,
        updatedAt: conversation.updatedAt
      },
      data: {
        currentStep: conversationStepForPersistedBookingState(resumed.state, bookingFlowOrder),
        aiEnabled: true,
        lastMessage: resumed.reply,
        humanHandoffResolvedAt: new Date(),
        ...patch,
        bookingV2State: patch.bookingV2State
          ? patch.bookingV2State as Prisma.InputJsonValue
          : Prisma.JsonNull,
        lastAvailability: Prisma.JsonNull
      }
    })
    if (!claimed.count) return sendAuthorizationFailure(reply, 'conflict')
    const updated = await loadAuthorizedConversation(prisma, authUser, conversation.id)
    if (!updated) return sendAuthorizationFailure(reply, 'notFound')
    publishCrmConversationUpdated(updated)
    return conversationWithLatestDeposit(conversation.id, authUser)
  })

  app.post('/crm/conversations/:id/advisor-quote', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { amount?: number | string; note?: string | null }
    const authUser = request.auth?.user
    if (!authUser) return reply.status(401).send({ message: 'Sesion requerida' })
    const amount = Number(body.amount)
    const note = body.note?.trim().slice(0, 500) || null
    if (!Number.isInteger(amount) || amount <= 0 || amount > 1_000_000_000) {
      return reply.status(400).send({ message: 'Carga un importe de presupuesto valido' })
    }
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.id }
    })
    if (!conversation || !conversation.businessId) {
      return reply.status(404).send({ message: 'No encontre esa conversacion' })
    }
    if (authUser.role !== 'SUPER_ADMIN' && authUser.businessId !== conversation.businessId) {
      return reply.status(403).send({ message: 'No tenes acceso a esa conversacion' })
    }
    if (conversation.currentStep !== 'HUMAN_HANDOFF' || conversation.aiEnabled) {
      return reply.status(409).send({ message: 'La conversacion no esta esperando la intervencion de un asesor' })
    }
    if (!conversation.selectedServiceId) {
      return reply.status(409).send({ message: 'La conversacion no tiene un servicio seleccionado' })
    }
    const service = await prisma.service.findFirst({
      where: {
        id: conversation.selectedServiceId,
        businessId: conversation.businessId
      },
      select: {
        id: true,
        name: true,
        attentionMode: true,
        requiresPhoto: true
      }
    })
    if (!service) return reply.status(404).send({ message: 'No encontre el servicio seleccionado' })
    if (
      !service.requiresPhoto &&
      service.attentionMode !== 'QUOTE' &&
      service.attentionMode !== 'GUIDED_ESTIMATE'
    ) {
      return reply.status(409).send({ message: 'Ese servicio no requiere un presupuesto del asesor' })
    }

    const quoteText = [
      `El presupuesto para ${service.name} es ${formatCrmMoney(amount)}.`,
      ...(note ? [note] : []),
      '¿Querés continuar con la reserva? Si aceptás, Cami te ayudará a elegir profesional, día y horario.'
    ].join('\n\n')
    const delivery = await sendCrmAutomatedMessage({
      conversationId: conversation.id,
      businessId: conversation.businessId,
      phone: conversation.phone,
      text: quoteText,
      provider: 'crm_advisor_quote',
      whatsapp: app.authorizationProviders.whatsapp
    })
    if (!delivery.sent) {
      return reply.status(502).send({
        message: 'No pude enviar el presupuesto por WhatsApp. La conversacion sigue en atencion manual.'
      })
    }

    const state = stateFromConversation(conversation)
    const quotedState = {
      ...state,
      agenda: state.agenda.map((item) => {
        if (item.intent === 'request_quote') {
          return { ...item, status: 'completed' as const, blockedBy: null }
        }
        if (item.intent === 'check_availability') {
          return { ...item, status: 'blocked' as const, blockedBy: 'quote_pending' as const }
        }
        return item
      }),
      advisorQuote: {
        serviceId: service.id,
        amount,
        note,
        status: 'awaiting_acceptance' as const,
        quotedAt: new Date().toISOString()
      },
      pendingPhotoQuote: null,
      pendingDeposit: null,
      misunderstandingCount: 0
    }
    const patch = conversationPatchFromState(quotedState)
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        currentStep: 'ASK_SERVICE',
        aiEnabled: true,
        lastMessage: quoteText,
        humanHandoffResolvedAt: new Date(),
        ...patch,
        bookingV2State: patch.bookingV2State as Prisma.InputJsonValue
      }
    })
    publishCrmConversationUpdated(updated)
    return conversationWithLatestDeposit(conversation.id, authUser)
  })

  app.post('/crm/conversations/:id/deposit/approve', async (request, reply) => {
    const params = request.params as { id: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const authorizedConversation = await loadAuthorizedConversation(prisma, authUser, params.id)
    if (!authorizedConversation?.businessId) return sendAuthorizationFailure(reply, 'notFound')
    const deposit = await findActiveConversationDeposit(params.id, authorizedConversation.businessId)
    if (!deposit) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    await bookingDepositService.expireOverdue()
    if (!deposit.conversationId || !deposit.conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    if (deposit.status !== 'PROOF_RECEIVED') {
      return reply.status(409).send({ message: 'Todavía no se recibió un comprobante para aprobar' })
    }

    const reviewedAt = app.clock()
    const depositBookingState = stateFromConversation(deposit.conversation)
    const heldAppointmentIds = depositBookingState.pendingDeposit
      ? pendingDepositAppointmentIds(depositBookingState.pendingDeposit)
      : [deposit.appointmentId]
    const queuedContinuation = heldAppointmentIds.length > 1
      ? null
      : advanceToNextQueuedService(depositBookingState)
    const resumedContinuation = queuedContinuation
      ? await bookingV2Engine.resume({
          businessId: deposit.businessId,
          conversation: conversationPatchFromState(queuedContinuation.state)
        })
      : null
    const continuationRequiresHandoff = resumedContinuation?.plan.type === 'handoff'
    const bookingFlowOrder = normalizeBookingFlowOrder((await prisma.businessFeatureSettings.findUnique({
      where: { businessId: deposit.businessId },
      select: { bookingFlowOrder: true }
    }))?.bookingFlowOrder)
    const approved = await prisma.$transaction(async (tx) => {
      const heldAppointments = await tx.appointment.count({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: deposit.businessId },
          status: 'PENDING'
        }
      })
      if (heldAppointments !== heldAppointmentIds.length) return false
      const claimed = await tx.bookingDeposit.updateMany({
        where: {
          ...authorizedBookingDepositWhere(authUser, deposit.id),
          businessId: deposit.businessId,
          conversationId: deposit.conversationId,
          status: 'PROOF_RECEIVED'
        },
        data: {
          status: 'APPROVED',
          reviewedAt,
          reviewedByUserId: authUser.id,
          rejectionReason: null
        }
      })
      if (!claimed.count) return false
      const confirmedAppointments = await tx.appointment.updateMany({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: deposit.businessId },
          status: 'PENDING'
        },
        data: { status: 'CONFIRMED' }
      })
      if (confirmedAppointments.count !== heldAppointmentIds.length) {
        throw new AuthorizationStateConflictError()
      }
      const conversationClaim = await tx.conversation.updateMany({
        where: authorizedConversationWhere(authUser, deposit.conversationId!),
        data: resumedContinuation
          ? {
              currentStep: continuationRequiresHandoff
                ? 'HUMAN_HANDOFF'
                : conversationStepForPersistedBookingState(resumedContinuation.state, bookingFlowOrder),
              aiEnabled: !continuationRequiresHandoff,
              humanHandoffAt: continuationRequiresHandoff ? reviewedAt : deposit.conversation!.humanHandoffAt,
              humanHandoffResolvedAt: continuationRequiresHandoff ? null : reviewedAt,
              ...resumedContinuation.conversationPatch,
              bookingV2State: resumedContinuation.conversationPatch.bookingV2State
                ? resumedContinuation.conversationPatch.bookingV2State as Prisma.InputJsonValue
                : Prisma.JsonNull,
              lastAvailability: resumedContinuation.availabilityOptions.length
                ? {
                    serviceId: resumedContinuation.state.draft.service,
                    professionalId: resumedContinuation.state.draft.professional,
                    date: resumedContinuation.state.draft.date,
                    options: resumedContinuation.availabilityOptions
                  } as Prisma.InputJsonValue
                : Prisma.JsonNull
            }
          : {
              currentStep: 'COMPLETED',
              aiEnabled: true,
              humanHandoffResolvedAt: reviewedAt,
              bookingV2State: Prisma.JsonNull,
              lastAvailability: Prisma.JsonNull
            }
      })
      if (conversationClaim.count !== 1) throw new AuthorizationStateConflictError()
      return true
    }).catch((error: unknown) => {
      if (error instanceof AuthorizationStateConflictError) return false
      throw error
    })
    if (!approved) {
      return reply.status(409).send({ message: 'La seña ya fue revisada o la retención venció' })
    }
    try {
      await markConversationOpportunityConverted({
        businessId: deposit.businessId,
        customerPhone: deposit.appointment.customer.phone,
        appointmentId: deposit.appointmentId
      })
    } catch (error) {
      console.error('No pude vincular el turno confirmado por seña con la oportunidad', error)
    }
    const coordinatedSelection = depositBookingState.pendingCoordinatedAvailability?.phase === 'OPTION_SELECTED'
      ? depositBookingState.pendingCoordinatedAvailability.options.find((option) =>
          option.id === depositBookingState.pendingCoordinatedAvailability?.selectedOptionId
        )
      : null
    const confirmedServiceNames = deposit.appointment.serviceItems.length
      ? deposit.appointment.serviceItems.map((item) => item.service.name).join(' + ')
      : deposit.appointment.service.name
    const confirmationText = coordinatedSelection && heldAppointmentIds.length > 1
      ? [
          `¡Listo! Confirmamos tu seña y tus reservas para el ${formatDepositAppointmentDate(deposit.appointment.startAt)} 😊`,
          ...coordinatedSelection.segments.map((segment) =>
            `${segment.serviceName} con ${segment.professionalName}: ${segment.startTime} a ${segment.endTime}`
          )
        ].join('\n')
      : `¡Listo! Confirmamos tu seña y el turno de ${confirmedServiceNames} para ${formatDepositAppointmentDate(deposit.appointment.startAt)} con ${deposit.appointment.professional.name}.`
    const nextService = queuedContinuation
      ? await prisma.service.findFirst({
          where: {
            id: queuedContinuation.nextService.serviceId,
            businessId: deposit.businessId
          },
          select: { name: true }
        })
      : null
    await sendCrmAutomatedMessage({
      conversationId: deposit.conversationId,
      businessId: deposit.businessId,
      phone: deposit.conversation.phone,
      text: resumedContinuation && nextService
        ? [
            confirmationText,
            `Ahora seguimos con la reserva de ${nextService.name}.`,
            resumedContinuation.reply
          ].join('\n\n')
        : confirmationText,
      provider: 'crm_deposit_review',
      whatsapp: app.authorizationProviders.whatsapp
    })
    publishCrmConversationUpdated({
      id: deposit.conversationId,
      businessId: deposit.businessId,
      updatedAt: new Date()
    })
    return conversationWithLatestDeposit(deposit.conversationId, authUser)
  })

  app.post('/crm/conversations/:id/deposit/reject', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { reason?: string }
    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const authorizedConversation = await loadAuthorizedConversation(prisma, authUser, params.id)
    if (!authorizedConversation?.businessId) return sendAuthorizationFailure(reply, 'notFound')
    const deposit = await findActiveConversationDeposit(params.id, authorizedConversation.businessId)
    if (!deposit) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    await bookingDepositService.expireOverdue()
    if (!deposit.conversationId || !deposit.conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    const reason = body.reason?.trim().slice(0, 300) || 'No pudimos validar el comprobante'
    const reviewedAt = app.clock()
    const depositBookingState = stateFromConversation(deposit.conversation)
    const heldAppointmentIds = depositBookingState.pendingDeposit
      ? pendingDepositAppointmentIds(depositBookingState.pendingDeposit)
      : [deposit.appointmentId]
    const rejected = await prisma.$transaction(async (tx) => {
      const scopedAppointmentCount = await tx.appointment.count({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: deposit.businessId }
        }
      })
      if (scopedAppointmentCount !== heldAppointmentIds.length) return false
      const claimed = await tx.bookingDeposit.updateMany({
        where: {
          ...authorizedBookingDepositWhere(authUser, deposit.id),
          businessId: deposit.businessId,
          conversationId: deposit.conversationId,
          status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
        },
        data: {
          status: 'REJECTED',
          reviewedAt,
          reviewedByUserId: authUser.id,
          rejectionReason: reason
        }
      })
      if (!claimed.count) return false
      const cancelledAppointments = await tx.appointment.updateMany({
        where: {
          id: { in: heldAppointmentIds },
          professional: { businessId: deposit.businessId },
          status: 'PENDING'
        },
        data: { status: 'CANCELLED' }
      })
      if (cancelledAppointments.count !== heldAppointmentIds.length) {
        throw new AuthorizationStateConflictError()
      }
      const conversationClaim = await tx.conversation.updateMany({
        where: authorizedConversationWhere(authUser, deposit.conversationId!),
        data: {
          bookingV2State: Prisma.JsonNull,
          lastAvailability: Prisma.JsonNull
        }
      })
      if (conversationClaim.count !== 1) throw new AuthorizationStateConflictError()
      return true
    }).catch((error: unknown) => {
      if (error instanceof AuthorizationStateConflictError) return false
      throw error
    })
    if (!rejected) {
      return reply.status(409).send({ message: 'La seña ya fue revisada o la retención venció' })
    }
    await sendCrmAutomatedMessage({
      conversationId: deposit.conversationId,
      businessId: deposit.businessId,
      phone: deposit.conversation.phone,
      text: `No pudimos validar el comprobante de la seña: ${reason}. Liberamos el horario para evitar una confirmación incorrecta. El equipo te ayudará a resolverlo por acá.`,
      provider: 'crm_deposit_review',
      whatsapp: app.authorizationProviders.whatsapp
    })
    publishCrmConversationUpdated({
      id: deposit.conversationId,
      businessId: deposit.businessId,
      updatedAt: new Date()
    })
    return conversationWithLatestDeposit(deposit.conversationId, authUser)
  })

  app.post('/crm/conversations/:id/manual-replies', async (request, reply) => {
    const params = request.params as {
      id: string
    }
    const body = request.body as {
      text?: string
      sendWhatsApp?: boolean
    }

    const text = body.text?.trim()

    if (!text) {
      return sendAuthorizationFailure(reply, 'malformed')
    }

    const authUser = request.auth?.user
    if (!authUser) return sendAuthorizationFailure(reply, 'unauthenticated')
    const conversation = await loadAuthorizedConversation(prisma, authUser, params.id)

    if (!conversation) {
      return sendAuthorizationFailure(reply, 'notFound')
    }
    if (!conversation.businessId) return sendAuthorizationFailure(reply, 'notFound')

    const shouldSendWhatsApp = body.sendWhatsApp !== false
    if (shouldSendWhatsApp) {
      const latestInbound = await prisma.message.findFirst({
        where: {
          conversationId: conversation.id,
          direction: 'INBOUND',
          conversation: authorizedConversationWhere(authUser, conversation.id)
        },
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          createdAt: true
        }
      })
      const replyWindowExpiresAt = latestInbound
        ? new Date(latestInbound.createdAt.getTime() + WHATSAPP_REPLY_WINDOW_MS)
        : null

      if (!replyWindowExpiresAt || replyWindowExpiresAt.getTime() <= Date.now()) {
        return reply.status(409).send({
          message: 'La ventana de WhatsApp de 24 hs ya vencio. Para volver a escribir, espera que el cliente envie un mensaje o usa una plantilla aprobada.',
          reason: 'whatsapp_reply_window_expired',
          lastInboundMessageAt: latestInbound?.createdAt ?? null,
          replyWindowExpiresAt
        })
      }
    }
    if (shouldSendWhatsApp) {
      const gate = await assertBusinessCanSendWhatsApp(conversation.businessId, 'BOT')
      if (!gate.allowed) return reply.status(409).send({ message: gate.message })
    }
    const pendingMessage = await prisma.$transaction(async (tx) => {
      const scopedConversation = await loadAuthorizedConversation(tx, authUser, conversation.id)
      if (!scopedConversation || scopedConversation.updatedAt.getTime() !== conversation.updatedAt.getTime()) {
        return null
      }
      return tx.message.create({
        data: {
          conversationId: conversation.id,
          phone: conversation.phone,
          direction: 'OUTBOUND',
          body: text,
          status: 'pending',
          metadata: {
            provider: 'crm_manual',
            delivery: { sent: false, reason: 'pending' }
          }
        }
      })
    })
    if (!pendingMessage) return sendAuthorizationFailure(reply, 'conflict')

    const deliveryResult = shouldSendWhatsApp
      ? await app.authorizationProviders.whatsapp.sendTextMessage({
          businessId: conversation.businessId,
          to: conversation.phone,
          text
        })
      : {
          sent: false,
          to: conversation.phone,
          reason: 'Envio por WhatsApp omitido desde CRM'
        }

    const providerMessageId = shouldSendWhatsApp
      ? getOutgoingProviderMessageId(deliveryResult)
      : null
    const messageDeliveryData = {
      status: shouldSendWhatsApp
        ? deliveryResult.sent ? 'sent' : 'failed'
        : 'manual',
      metadata: {
        provider: 'crm_manual',
        delivery: deliveryResult
      },
      ...(providerMessageId ? { providerMessageId } : {}),
      ...(!deliveryResult.sent && 'status' in deliveryResult && deliveryResult.status
        ? { providerStatusCode: deliveryResult.status }
        : {}),
      ...(!deliveryResult.sent && 'errorCode' in deliveryResult && deliveryResult.errorCode
        ? { providerErrorCode: deliveryResult.errorCode }
        : {}),
      ...(!deliveryResult.sent && 'errorMessage' in deliveryResult && deliveryResult.errorMessage
        ? { providerErrorMessage: deliveryResult.errorMessage }
        : {})
    }

    const persisted = await prisma.$transaction(async (tx) => {
      const conversationClaim = await tx.conversation.updateMany({
        where: {
          ...authorizedConversationWhere(authUser, conversation.id),
          updatedAt: conversation.updatedAt
        },
        data: {
          lastMessage: text,
          archivedAt: null,
          ...(conversation.currentStep === 'HUMAN_HANDOFF'
            ? takenConversationHandoffPatch({ queuedAt: conversation.humanHandoffAt })
            : {
                humanHandoffResolvedAt: conversation.humanHandoffResolvedAt
              })
        }
      })
      if (!conversationClaim.count) throw new AuthorizationStateConflictError()
      const messageClaim = await tx.message.updateMany({
        where: {
          ...authorizedMessageWhere(authUser, pendingMessage.id),
          status: 'pending'
        },
        data: messageDeliveryData
      })
      if (!messageClaim.count) throw new AuthorizationStateConflictError()
      const message = await tx.message.findFirst({
        where: authorizedMessageWhere(authUser, pendingMessage.id)
      })
      const updated = await loadAuthorizedConversation(tx, authUser, conversation.id)
      if (!message || !updated) throw new AuthorizationStateConflictError()
      return { message, updated }
    }).catch((error: unknown) => {
      if (error instanceof AuthorizationStateConflictError) return null
      throw error
    })
    if (!persisted) return sendAuthorizationFailure(reply, 'conflict')
    publishCrmConversationUpdated(persisted.updated)

    return {
      message: persisted.message,
      delivery: deliveryResult
    }
  })
}

async function archiveOldCompletedConversations(businessId?: string) {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  await prisma.conversation.updateMany({
    where: {
      ...(businessId ? { businessId } : {}),
      archivedAt: null,
      currentStep: 'COMPLETED',
      updatedAt: { lt: cutoff }
    },
    data: {
      archivedAt: new Date()
    }
  })
}

async function findCrmBusiness(businessId?: string) {
  if (businessId) {
    return prisma.business.findUnique({
      where: {
        id: businessId
      },
      select: { id: true, botEnabled: true, aiEnabled: true }
    })
  }

  return prisma.business.findFirst({
    orderBy: {
      createdAt: 'asc'
    },
    select: { id: true, botEnabled: true, aiEnabled: true }
  })
}

async function coordinatedAppointmentIds(
  client: TenantResourceAuthorizationClient,
  primaryAppointmentId: string,
  businessId: string
) {
  const primary = await client.appointment.findFirst({
    where: {
      id: primaryAppointmentId,
      professional: { businessId }
    },
    select: { coordinationGroupId: true }
  })
  if (!primary) return []
  if (!primary.coordinationGroupId) return [primaryAppointmentId]
  const appointments = await client.appointment.findMany({
    where: {
      coordinationGroupId: primary.coordinationGroupId,
      professional: { businessId }
    },
    select: { id: true }
  })
  return appointments.length
    ? appointments.map((appointment) => appointment.id)
    : [primaryAppointmentId]
}

function conversationListWhere(input: {
  businessId?: string
  phone?: string
  archiveView: 'active' | 'archived' | 'all'
  filter?: 'handoff'
}) {
  return {
    ...(input.businessId ? { businessId: input.businessId } : {}),
    ...(input.phone ? { phone: { contains: input.phone } } : {}),
    ...(input.archiveView === 'active' ? { archivedAt: null } : {}),
    ...(input.archiveView === 'archived' ? { archivedAt: { not: null } } : {}),
    ...(input.filter === 'handoff'
      ? pendingConversationHandoffWhere()
      : {})
  } satisfies Prisma.ConversationWhereInput
}

function pendingConversationHandoffWhere(): Prisma.ConversationWhereInput {
  return {
    OR: [
      { aiEnabled: false },
      {
        currentStep: 'HUMAN_HANDOFF',
        humanHandoffResolvedAt: null
      }
    ]
  }
}

async function conversationCounts(businessId?: string) {
  const countWhere: Prisma.ConversationWhereInput = businessId
    ? { businessId }
    : {}
  const [active, archived, handoff] = await Promise.all([
    prisma.conversation.count({ where: { ...countWhere, archivedAt: null } }),
    prisma.conversation.count({ where: { ...countWhere, archivedAt: { not: null } } }),
    prisma.conversation.count({
      where: {
        ...countWhere,
        archivedAt: null,
        ...pendingConversationHandoffWhere()
      }
    })
  ])

  return { active, archived, handoff }
}

async function latestConversationActivityAtForBusiness(businessId?: string) {
  const latestConversation = await prisma.conversation.findFirst({
    where: businessId ? { businessId } : {},
    orderBy: { updatedAt: 'desc' },
    select: { updatedAt: true }
  })

  return latestConversation?.updatedAt ?? null
}

async function attachConversationReplyWindow<T extends {
  id: string
}>(items: T[]) {
  const latestInboundByConversationId = new Map<string, Date | null>()
  if (items.length > 0) {
    const latestInboundMessages = await prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: {
          in: items.map((conversation) => conversation.id)
        },
        direction: 'INBOUND'
      },
      _max: {
        createdAt: true
      }
    })
    for (const item of latestInboundMessages) {
      latestInboundByConversationId.set(item.conversationId, item._max.createdAt)
    }
  }

  return items.map((conversation) => {
    const lastInboundMessageAt = latestInboundByConversationId.get(conversation.id) ?? null
    const whatsappReplyWindowExpiresAt = lastInboundMessageAt
      ? new Date(lastInboundMessageAt.getTime() + WHATSAPP_REPLY_WINDOW_MS)
      : null

    return {
      ...conversation,
      lastInboundMessageAt,
      whatsappReplyWindowExpiresAt,
      canReplyOnWhatsApp: Boolean(whatsappReplyWindowExpiresAt && whatsappReplyWindowExpiresAt.getTime() > Date.now())
    }
  })
}

function parseOptionalDate(value?: string) {
  if (!value) return null
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function latestConversationActivityAt(conversation: {
  updatedAt: Date
  messages: Array<{
    createdAt: Date
  }>
}) {
  return conversation.messages[0]?.createdAt.getTime() ?? conversation.updatedAt.getTime()
}

function getOutgoingProviderMessageId(
  deliveryResult: Awaited<ReturnType<AuthorizationProviders['whatsapp']['sendTextMessage']>>
) {
  if (!deliveryResult.sent) {
    return undefined
  }

  const response = deliveryResult.response as {
    messages?: Array<{
      id?: string
    }>
  }

  return response.messages?.[0]?.id
}

async function findActiveConversationDeposit(conversationId: string, businessId: string) {
  return prisma.bookingDeposit.findFirst({
    where: {
      conversationId,
      businessId,
      status: { in: ['PENDING_PROOF', 'PROOF_RECEIVED'] }
    },
    select: {
      id: true,
      businessId: true,
      appointmentId: true,
      conversationId: true,
      status: true,
      conversation: true,
      appointment: {
        select: {
          startAt: true,
          customer: { select: { phone: true } },
          professional: { select: { name: true } },
          service: { select: { name: true } },
          serviceItems: {
            select: { service: { select: { name: true } } },
            orderBy: { sortOrder: 'asc' }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
}

async function conversationWithLatestDeposit(
  conversationId: string,
  user: BusinessAuthorizationUser
) {
  const [conversation, latestMessage] = await Promise.all([
    prisma.conversation.findFirst({
      where: authorizedConversationWhere(user, conversationId),
      include: {
        bookingDeposits: {
          select: conversationDepositSelect,
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    }),
    prisma.message.findFirst({
      where: {
        conversationId,
        conversation: authorizedConversationWhere(user, conversationId)
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' }
      ]
    })
  ])

  if (!conversation) return null

  return {
    ...conversation,
    messages: latestMessage ? [latestMessage] : []
  }
}

async function conversationListItemById(
  conversationId: string,
  user: BusinessAuthorizationUser
) {
  const conversation = await prisma.conversation.findFirst({
    where: authorizedConversationWhere(user, conversationId),
    include: {
      bookingDeposits: {
        select: conversationDepositSelect,
        orderBy: { createdAt: 'desc' },
        take: 1
      }
    }
  })
  if (!conversation) return null

  const [latestMessage, latestInboundMessage] = await Promise.all([
    prisma.message.findFirst({
      where: {
        conversationId,
        conversation: authorizedConversationWhere(user, conversationId)
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    }),
    prisma.message.findFirst({
      where: {
        conversationId,
        direction: 'INBOUND',
        conversation: authorizedConversationWhere(user, conversationId)
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, conversationId: true, createdAt: true }
    })
  ])
  const lastInboundMessageAt = latestInboundMessage?.createdAt ?? null
  const whatsappReplyWindowExpiresAt = lastInboundMessageAt
    ? new Date(lastInboundMessageAt.getTime() + WHATSAPP_REPLY_WINDOW_MS)
    : null

  return {
    ...conversation,
    messages: latestMessage ? [latestMessage] : [],
    latestInboundMessage,
    lastInboundMessageAt,
    whatsappReplyWindowExpiresAt,
    canReplyOnWhatsApp: Boolean(
      whatsappReplyWindowExpiresAt && whatsappReplyWindowExpiresAt.getTime() > Date.now()
    )
  }
}

async function latestMessagesByConversationId(conversationIds: string[]) {
  if (conversationIds.length === 0) return new Map<string, Message>()

  const messages = await prisma.$queryRaw<Message[]>(Prisma.sql`
    SELECT DISTINCT ON ("conversationId") "Message".*
    FROM "Message"
    WHERE "conversationId" IN (${Prisma.join(conversationIds)})
    ORDER BY "conversationId", "createdAt" DESC, "id" DESC
  `)

  return new Map(messages.map((message) => [message.conversationId, message]))
}

async function latestInboundMessagesByConversationId(conversationIds: string[]) {
  if (conversationIds.length === 0) return new Map<string, LatestInboundMessage>()

  const messages = await prisma.$queryRaw<LatestInboundMessage[]>(Prisma.sql`
    SELECT DISTINCT ON ("conversationId") "id", "conversationId", "createdAt"
    FROM "Message"
    WHERE "conversationId" IN (${Prisma.join(conversationIds)})
      AND "direction" = 'INBOUND'
    ORDER BY "conversationId", "createdAt" DESC, "id" DESC
  `)

  return new Map(messages.map((message) => [message.conversationId, message]))
}

type LatestInboundMessage = {
  id: string
  conversationId: string
  createdAt: Date
}

async function sendCrmAutomatedMessage(input: {
  conversationId: string
  businessId: string
  phone: string
  text: string
  provider: string
  whatsapp: AuthorizationProviders['whatsapp']
}) {
  const gate = await assertBusinessCanSendWhatsApp(input.businessId, 'BOT')
  const delivery = gate.allowed
    ? await input.whatsapp.sendTextMessage({
        businessId: input.businessId,
        to: input.phone,
        text: input.text
      })
    : {
        sent: false as const,
        to: input.phone,
        reason: gate.message
      }
  await prisma.message.create({
    data: {
      conversationId: input.conversationId,
      phone: input.phone,
      direction: 'OUTBOUND',
      body: input.text,
      status: delivery.sent ? 'sent' : 'failed',
      metadata: {
        provider: input.provider,
        delivery
      }
    }
  })
  return delivery
}

function publishCrmConversationUpdated(conversation: {
  id: string
  businessId: string | null
  updatedAt: Date
}) {
  if (!conversation.businessId) return
  publishConversationUpdated({
    businessId: conversation.businessId,
    conversationId: conversation.id,
    updatedAt: conversation.updatedAt.toISOString()
  })
}

function formatDepositAppointmentDate(startAt: Date) {
  return new Intl.DateTimeFormat('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Argentina/Buenos_Aires'
  }).format(startAt)
}

function formatCrmMoney(value: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0
  }).format(value)
}
