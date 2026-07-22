import { randomBytes } from 'node:crypto'
import { instagramConfig } from '../config/instagram.js'
import { prisma } from '../config/prisma.js'
import { InstagramApi } from '../integrations/instagram-api.js'

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
const AUTO_REPLY_COOLDOWN_MS = 6 * 60 * 60 * 1000

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
        include: { business: { select: { id: true, name: true, publicWhatsapp: true } } }
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

      const cooldownActive = Boolean(
        existingLead?.lastAutoReplyAt && Date.now() - existingLead.lastAutoReplyAt.getTime() < AUTO_REPLY_COOLDOWN_MS
      )
      if (!config.enabled || !config.accessToken || cooldownActive) {
        results.push({ messageId: event.messageId, saved: true, replied: false })
        continue
      }

      const whatsappUrl = buildWhatsappUrl(config.business.publicWhatsapp, lead.referralCode)
      if (!whatsappUrl) {
        await prisma.businessInstagramConfig.update({
          where: { businessId: config.businessId },
          data: { lastError: 'Falta cargar el WhatsApp publico del comercio para derivar reservas.' }
        })
        results.push({ messageId: event.messageId, saved: true, replied: false, reason: 'WhatsApp publico no configurado' })
        continue
      }

      const replyText = [
        `¡Hola! Soy el asistente de ${config.business.name}.`,
        'Para consultar disponibilidad y confirmar tu reserva, continuemos por WhatsApp:',
        whatsappUrl
      ].join('\n\n')

      try {
        const delivery = await instagramApi.sendTextMessage({
          instagramAccountId: config.apiAccountId ?? config.instagramAccountId,
          accessToken: config.accessToken,
          recipientId: event.senderId,
          text: replyText
        })
        await prisma.instagramMessage.create({
          data: {
            leadId: lead.id,
            providerMessageId: delivery.messageId,
            direction: 'OUTBOUND',
            body: replyText,
            status: 'sent',
            metadata: { provider: 'instagram', recipientId: delivery.recipientId }
          }
        })
        await prisma.instagramLead.update({ where: { id: lead.id }, data: { lastAutoReplyAt: new Date() } })
        await prisma.businessInstagramConfig.update({ where: { businessId: config.businessId }, data: { lastError: null } })
        results.push({ messageId: event.messageId, saved: true, replied: true })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'No pude responder por Instagram.'
        await prisma.instagramMessage.create({
          data: {
            leadId: lead.id,
            direction: 'OUTBOUND',
            body: replyText,
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

function buildWhatsappUrl(phone: string | null, referralCode: string) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (!digits) return null
  const text = `Hola, vengo de Instagram y quiero reservar. Codigo: ${referralCode}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
