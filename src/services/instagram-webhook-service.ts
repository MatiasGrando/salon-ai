import { randomBytes } from 'node:crypto'
import { instagramConfig } from '../config/instagram.js'
import { prisma } from '../config/prisma.js'
import { InstagramApi } from '../integrations/instagram-api.js'
import {
  applyAssistantPersonalityToReply,
  getBusinessAssistantPersonality
} from './assistant-personality-service.js'
import { BusinessKnowledgeService } from './business-knowledge-service.js'
import {
  businessInformationTopicsFromRouting,
  ConversationRouter,
  type BusinessInformationTopic,
  type ConversationRouterInput,
  type ConversationRouting
} from './conversation-router.js'

type VerifyWebhookInput = {
  mode: string | undefined
  token: string | undefined
  challenge: string | undefined
}

type InstagramWebhookPayload = {
  object?: string
  entry?: Array<{
    id?: string
    messaging?: Array<{
      sender?: { id?: string }
      recipient?: { id?: string }
      timestamp?: number
      message?: {
        mid?: string
        text?: string
        is_echo?: boolean
        is_deleted?: boolean
      }
    }>
  }>
}

const instagramApi = new InstagramApi()
const conversationRouter = new ConversationRouter()
const businessKnowledgeService = new BusinessKnowledgeService()
const INSTAGRAM_MESSAGE_MAX_LENGTH = 900

export class InstagramWebhookService {
  verifyWebhook(input: VerifyWebhookInput) {
    if (input.mode === 'subscribe' && input.token === instagramConfig.verifyToken && input.challenge) {
      return { verified: true, challenge: input.challenge }
    }
    return { verified: false }
  }

  async handleWebhook(payload: InstagramWebhookPayload = {}) {
    if (payload.object && payload.object !== 'instagram') return { received: true, processed: 0 }
    const events = extractTextEvents(payload)
    const results = []

    for (const event of events) {
      const config = await prisma.businessInstagramConfig.findFirst({
        where: {
          OR: [
            { instagramAccountId: { in: event.instagramAccountIds } },
            { apiAccountId: { in: event.instagramAccountIds } }
          ]
        },
        include: {
          business: {
            select: {
              id: true,
              name: true,
              slug: true,
              landingEnabled: true,
              publicWhatsapp: true,
              contactEmail: true,
              publicAddress: true,
              publicAddressArea: true,
              publicMapsUrl: true,
              instagramUrl: true,
              facebookUrl: true,
              tiktokUrl: true,
              businessHours: {
                select: { dayOfWeek: true, startTime: true, endTime: true }
              },
              services: {
                where: { isBookable: true },
                orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
                select: {
                  id: true,
                  name: true,
                  description: true,
                  category: true,
                  aliases: { select: { name: true } },
                  catalogCategory: { select: { name: true } },
                  parentService: {
                    select: {
                      name: true,
                      aliases: { select: { name: true } }
                    }
                  }
                }
              },
              professionals: {
                where: { isActive: true, acceptsBotBookings: true },
                orderBy: { name: 'asc' },
                select: { id: true, name: true, description: true }
              }
            }
          }
        }
      })
      if (!config) {
        results.push({ messageId: event.messageId, skipped: true, reason: 'Cuenta de Instagram no configurada' })
        continue
      }

      if (event.messageId) {
        const duplicate = await prisma.instagramMessage.findUnique({ where: { providerMessageId: event.messageId } })
        if (duplicate) {
          results.push({ messageId: event.messageId, skipped: true, reason: 'Mensaje duplicado' })
          continue
        }
      }

      const existingLead = await prisma.instagramLead.findUnique({
        where: {
          businessId_instagramUserId: {
            businessId: config.businessId,
            instagramUserId: event.senderId
          }
        }
      })
      const recentMessages = existingLead
        ? await prisma.instagramMessage.findMany({
            where: { leadId: existingLead.id },
            orderBy: { createdAt: 'desc' },
            take: 8,
            select: { direction: true, body: true }
          })
        : []
      const lead = await prisma.instagramLead.upsert({
        where: {
          businessId_instagramUserId: {
            businessId: config.businessId,
            instagramUserId: event.senderId
          }
        },
        update: { lastMessage: event.text },
        create: {
          businessId: config.businessId,
          instagramUserId: event.senderId,
          referralCode: createReferralCode(),
          lastMessage: event.text
        }
      })

      await prisma.instagramMessage.create({
        data: {
          leadId: lead.id,
          ...(event.messageId ? { providerMessageId: event.messageId } : {}),
          direction: 'INBOUND',
          body: event.text,
          status: 'received',
          metadata: {
            provider: 'instagram',
            webhookAccountIds: event.instagramAccountIds,
            ...(event.timestamp ? { timestamp: event.timestamp } : {})
          }
        }
      })

      if (!config.enabled || !config.accessToken) {
        results.push({ messageId: event.messageId, saved: true, replied: false })
        continue
      }

      const routing = await conversationRouter.route(buildInstagramRouterInput({
        message: event.text,
        business: config.business,
        recentMessages: recentMessages.reverse().map((message) => ({
          direction: message.direction,
          body: message.body
        }))
      }))
      const informationTopics = businessInformationTopicsFromRouting(routing)
        .filter((topic) => topic !== 'booking_channels')
      const informationReply = informationTopics.length
        ? await businessKnowledgeService.answer({
            businessId: config.businessId,
            topics: informationTopics,
            ...(routing.catalogQuery ? { catalogQuery: routing.catalogQuery } : {})
          })
        : null
      const requiresWhatsapp = requiresWhatsappContinuation(routing)
      const whatsappUrl = requiresWhatsapp
        ? buildWhatsappUrl(
            config.business.publicWhatsapp,
            lead.referralCode,
            event.text,
            whatsappContinuationKind(routing)
          )
        : null
      if (requiresWhatsapp && !whatsappUrl) {
        await prisma.businessInstagramConfig.update({
          where: { businessId: config.businessId },
          data: { lastError: 'Falta cargar el WhatsApp publico del comercio para derivar reservas.' }
        })
      }

      const personality = await getBusinessAssistantPersonality(config.businessId)
      const personalizedReplyText = applyAssistantPersonalityToReply(
        composeInstagramReply({
          businessName: config.business.name,
          assistantName: personality.name,
          customerMessage: event.text,
          routing,
          informationReply,
          requiresWhatsapp,
          whatsappUrl
        }),
        personality
      )
      const outboundMessages = splitInstagramReply(personalizedReplyText)

      try {
        for (const outboundMessage of outboundMessages) {
          const delivery = await instagramApi.sendTextMessage({
            instagramAccountId: config.apiAccountId ?? config.instagramAccountId,
            accessToken: config.accessToken,
            recipientId: event.senderId,
            text: outboundMessage
          })
          await prisma.instagramMessage.create({
            data: {
              leadId: lead.id,
              providerMessageId: delivery.messageId,
              direction: 'OUTBOUND',
              body: outboundMessage,
              status: 'sent',
              metadata: { provider: 'instagram', recipientId: delivery.recipientId }
            }
          })
        }
        await prisma.instagramLead.update({ where: { id: lead.id }, data: { lastAutoReplyAt: new Date() } })
        await prisma.businessInstagramConfig.update({
          where: { businessId: config.businessId },
          data: {
            lastError: requiresWhatsapp && !whatsappUrl
              ? 'Falta cargar el WhatsApp publico del comercio para derivar reservas.'
              : null
          }
        })
        results.push({ messageId: event.messageId, saved: true, replied: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No pude responder por Instagram.'
        await prisma.instagramMessage.create({
          data: {
            leadId: lead.id,
            direction: 'OUTBOUND',
            body: personalizedReplyText,
            status: 'failed',
            metadata: { provider: 'instagram', error: message }
          }
        })
        await prisma.businessInstagramConfig.update({ where: { businessId: config.businessId }, data: { lastError: message } })
        results.push({ messageId: event.messageId, saved: true, replied: false, reason: message })
      }
    }

    return { received: true, processed: results.length, results }
  }
}

function extractTextEvents(payload: InstagramWebhookPayload) {
  const result: Array<{
    instagramAccountIds: string[]
    senderId: string
    messageId?: string
    text: string
    timestamp?: number
  }> = []
  for (const entry of payload.entry ?? []) {
    if (!entry.id) continue
    for (const event of entry.messaging ?? []) {
      const message = event.message
      if (!event.sender?.id || !message?.text || message.is_echo || message.is_deleted) continue
      const instagramAccountIds = [...new Set([event.recipient?.id, entry.id].filter((id): id is string => Boolean(id)))]
      if (instagramAccountIds.length === 0) continue
      result.push({
        instagramAccountIds,
        senderId: event.sender.id,
        text: message.text.trim(),
        ...(message.mid ? { messageId: message.mid } : {}),
        ...(event.timestamp ? { timestamp: event.timestamp } : {})
      })
    }
  }
  return result.filter((event) => event.text)
}

function createReferralCode() {
  return `IG-${randomBytes(4).toString('hex').toUpperCase()}`
}

export type InstagramRouterBusiness = {
  name: string
  slug: string | null
  landingEnabled: boolean
  publicWhatsapp: string | null
  contactEmail: string | null
  publicAddress: string | null
  publicAddressArea: string | null
  publicMapsUrl: string | null
  instagramUrl: string | null
  facebookUrl: string | null
  tiktokUrl: string | null
  businessHours: Array<{ dayOfWeek: number; startTime: string; endTime: string }>
  services: Array<{
    id: string
    name: string
    description: string | null
    category: string | null
    aliases: Array<{ name: string }>
    catalogCategory: { name: string } | null
    parentService: { name: string; aliases: Array<{ name: string }> } | null
  }>
  professionals: Array<{ id: string; name: string; description: string | null }>
}

export function buildInstagramRouterInput(input: {
  message: string
  business: InstagramRouterBusiness
  recentMessages?: ConversationRouterInput['recentMessages']
}): ConversationRouterInput {
  const recentMessages = input.recentMessages ?? []
  return {
    message: input.message,
    currentStep: 'START',
    lastBotMessage: [...recentMessages].reverse()
      .find((message) => message.direction === 'OUTBOUND')?.body ?? null,
    recentMessages,
    draft: {
      name: null,
      service: null,
      professional: null,
      date: null,
      time: null
    },
    business: {
      name: input.business.name,
      availableInformation: instagramAvailableInformation(input.business)
    },
    catalog: {
      services: input.business.services.map((service) => {
        const category = service.catalogCategory?.name ?? service.category
        return {
          id: service.id,
          name: service.parentService
            ? `${service.parentService.name} — ${service.name}`
            : service.name,
          description: service.description,
          aliases: Array.from(new Set([
            service.name,
            ...service.aliases.map((alias) => alias.name),
            ...(category ? [category] : []),
            ...(service.parentService
              ? [
                  service.parentService.name,
                  `${service.parentService.name} ${service.name}`,
                  ...service.parentService.aliases.map((alias) => `${alias.name} ${service.name}`)
                ]
              : [])
          ]))
        }
      }),
      professionals: input.business.professionals.map((professional) => ({
        id: professional.id,
        name: professional.name,
        description: professional.description
      }))
    }
  }
}

function instagramAvailableInformation(business: InstagramRouterBusiness) {
  const topics: BusinessInformationTopic[] = []
  if (business.businessHours.length) topics.push('opening_hours')
  if (business.publicAddress || business.publicAddressArea || business.publicMapsUrl) topics.push('address')
  if (business.landingEnabled && business.slug) topics.push('website', 'booking_channels')
  if (business.publicWhatsapp) topics.push('phone', 'booking_channels')
  if (business.contactEmail) topics.push('email')
  if (business.instagramUrl) topics.push('instagram')
  if (business.facebookUrl) topics.push('facebook')
  if (business.tiktokUrl) topics.push('tiktok')
  if (business.services.length) topics.push('services', 'prices')
  if (business.professionals.length) topics.push('professionals')
  return Array.from(new Set(topics))
}

export function requiresWhatsappContinuation(routing: ConversationRouting) {
  if (routing.bookingMessage) return true
  return routing.intents.some((intent) =>
    intent.confidence >= 0.65 && (
      ['book_appointment', 'edit_booking', 'cancel_appointment', 'request_quote', 'submit_media', 'request_human']
        .includes(intent.type) ||
      (intent.type === 'business_information' && intent.topic === 'booking_channels')
    )
  )
}

type WhatsappContinuationKind = 'booking' | 'quote' | 'human'

export function whatsappContinuationKind(routing: ConversationRouting): WhatsappContinuationKind {
  if (routing.intents.some((intent) => intent.type === 'request_quote' && intent.confidence >= 0.65)) {
    return 'quote'
  }
  if (routing.intents.some((intent) =>
    ['request_human', 'submit_media'].includes(intent.type) && intent.confidence >= 0.65
  )) {
    return 'human'
  }
  return 'booking'
}

export function composeInstagramReply(input: {
  businessName: string
  assistantName: string
  customerMessage: string
  routing: ConversationRouting
  informationReply: string | null
  requiresWhatsapp: boolean
  whatsappUrl: string | null
}) {
  if (input.requiresWhatsapp) {
    const continuationKind = whatsappContinuationKind(input.routing)
    const action = continuationKind === 'quote'
      ? 'preparar el presupuesto'
      : continuationKind === 'human'
        ? 'continuar con el equipo'
        : 'reservar el turno'
    const continuation = input.whatsappUrl
      ? `Para ${action}, continuemos por WhatsApp. Voy a llevar el contexto de esta consulta para que no tengas que empezar de nuevo:\n${input.whatsappUrl}`
      : `Para ${action} necesitamos continuar por WhatsApp, pero el comercio todavía no tiene cargado el número de reservas.`
    return [input.informationReply, continuation].filter(Boolean).join('\n\n')
  }

  if (input.informationReply) {
    return `${input.informationReply}\n\nSi querés reservar, escribime “quiero reservar” y te paso a WhatsApp con el contexto de esta consulta.`
  }

  if (/\b(hola|holi|buenas|buen dia|buenas tardes|buenas noches)\b/i.test(input.customerMessage)) {
    return `¡Hola! Soy ${input.assistantName}, asistente de ${input.businessName} 😊\n\nPuedo ayudarte con servicios, precios, horarios, ubicación y profesionales. Si querés reservar, también te paso a WhatsApp.`
  }

  return `No estoy segura de haber entendido 😊\n\nPuedo ayudarte con servicios, precios, horarios, ubicación y profesionales. Para reservar o pedir un presupuesto, también puedo pasarte a WhatsApp.`
}

export function splitInstagramReply(
  reply: string,
  maxLength = INSTAGRAM_MESSAGE_MAX_LENGTH
) {
  const paragraphs = reply.trim().split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  const messages: string[] = []
  let current = ''
  const push = () => {
    if (current) messages.push(current)
    current = ''
  }
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (candidate.length <= maxLength) {
      current = candidate
      continue
    }
    push()
    let remaining = paragraph
    while (remaining.length > maxLength) {
      let splitAt = remaining.lastIndexOf(' ', maxLength)
      if (splitAt < Math.floor(maxLength * 0.6)) splitAt = maxLength
      messages.push(remaining.slice(0, splitAt).trim())
      remaining = remaining.slice(splitAt).trim()
    }
    current = remaining
  }
  push()
  return messages
}

export function buildWhatsappUrl(
  phone: string | null,
  referralCode: string,
  context = '',
  kind: WhatsappContinuationKind = 'booking'
) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  const action = kind === 'quote'
    ? 'quiero pedir un presupuesto'
    : kind === 'human'
      ? 'quiero hablar con una persona'
      : 'quiero reservar'
  const cleanContext = context.replace(/\s+/g, ' ').trim().slice(0, 500)
  const text = [
    `Hola, vengo de Instagram y ${action}.`,
    cleanContext ? `Mi consulta fue: ${cleanContext}.` : null,
    `Codigo: ${referralCode}`
  ].filter(Boolean).join(' ')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
