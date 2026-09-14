import { prisma } from '../config/prisma.js'
import { InstagramApi } from '../integrations/instagram-api.js'
import { publishOutgoingConversationMessage } from './crm-realtime-events.js'

export type InboxChannel = 'WHATSAPP' | 'INSTAGRAM' | 'FACEBOOK' | 'TIKTOK' | 'LANDING'
type ExternalInboxChannel = Exclude<InboxChannel, 'WHATSAPP'>
type PrismaLike = Record<string, any>

export function channelConversationId(channel: ExternalInboxChannel, resourceId: string) {
  return `${channel.toLowerCase()}:${resourceId}`
}

export function channelMessageId(channel: ExternalInboxChannel, resourceId: string) {
  return `${channel.toLowerCase()}-message:${resourceId}`
}

export function parseChannelResourceId(value: string): {
  channel: ExternalInboxChannel
  resourceId: string
  resourceType: 'conversation' | 'message'
} | null {
  const match = /^(instagram|facebook|tiktok|landing)(-message)?:([^:]+)$/i.exec(value)
  if (!match) return null
  return {
    channel: match[1]!.toUpperCase() as ExternalInboxChannel,
    resourceId: match[3]!,
    resourceType: match[2] ? 'message' : 'conversation'
  }
}

export async function listChannelConversations(input: {
  businessId: string
  take?: number
  since?: Date | null
  search?: string | null
  client?: PrismaLike
}) {
  const client = input.client ?? prisma as unknown as PrismaLike
  const take = Math.min(Math.max(input.take ?? 30, 1), 100)
  const search = input.search?.trim()
  const leads = await client.instagramLead.findMany({
    where: {
      businessId: input.businessId,
      ...(input.since ? { updatedAt: { gt: input.since } } : {}),
      ...(search ? {
        OR: [
          { username: { contains: search, mode: 'insensitive' } },
          { displayName: { contains: search, mode: 'insensitive' } },
          { lastMessage: { contains: search, mode: 'insensitive' } }
        ]
      } : {})
    },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { updatedAt: 'desc' },
    take
  })
  return leads.map(projectInstagramConversation)
}

export async function countChannelConversations(businessId: string, client: PrismaLike = prisma as unknown as PrismaLike) {
  return client.instagramLead.count({ where: { businessId } }) as Promise<number>
}

export async function latestChannelConversationActivityAt(businessId: string, client: PrismaLike = prisma as unknown as PrismaLike) {
  const lead = await client.instagramLead.findFirst({
    where: { businessId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true }
  })
  return lead?.updatedAt ?? null
}

export async function loadChannelConversation(input: {
  businessId: string
  id: string
  client?: PrismaLike
}) {
  const parsed = parseChannelResourceId(input.id)
  if (!parsed || parsed.resourceType !== 'conversation' || parsed.channel !== 'INSTAGRAM') return null
  const client = input.client ?? prisma as unknown as PrismaLike
  const lead = await client.instagramLead.findFirst({
    where: { id: parsed.resourceId, businessId: input.businessId },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } }
  })
  return lead ? projectInstagramConversation(lead) : null
}

export async function loadChannelConversationMessages(input: {
  businessId: string
  conversationId: string
  take: number
  cursor?: string
  client?: PrismaLike
}) {
  const parsed = parseChannelResourceId(input.conversationId)
  if (!parsed || parsed.resourceType !== 'conversation' || parsed.channel !== 'INSTAGRAM') return null
  const client = input.client ?? prisma as unknown as PrismaLike
  const lead = await client.instagramLead.findFirst({ where: { id: parsed.resourceId, businessId: input.businessId }, select: { id: true } })
  if (!lead) return null
  const cursor = input.cursor ? parseChannelResourceId(input.cursor) : null
  const rows = await client.instagramMessage.findMany({
    where: { leadId: lead.id },
    orderBy: { createdAt: 'desc' },
    take: input.take + 1,
    ...(cursor?.resourceType === 'message' && cursor.channel === 'INSTAGRAM'
      ? { cursor: { id: cursor.resourceId }, skip: 1 }
      : {})
  })
  const hasMore = rows.length > input.take
  const page = rows.slice(0, input.take)
  return {
    items: page.reverse().map(projectInstagramMessage),
    nextCursor: hasMore ? channelMessageId('INSTAGRAM', page[page.length - 1]!.id) : null
  }
}

export async function loadChannelMessage(input: { businessId: string; id: string; client?: PrismaLike }) {
  const parsed = parseChannelResourceId(input.id)
  if (!parsed || parsed.resourceType !== 'message' || parsed.channel !== 'INSTAGRAM') return null
  const client = input.client ?? prisma as unknown as PrismaLike
  const row = await client.instagramMessage.findFirst({
    where: { id: parsed.resourceId, lead: { businessId: input.businessId } }
  })
  return row ? projectInstagramMessage(row) : null
}

export async function sendChannelConversationReply(input: {
  businessId: string
  conversationId: string
  text: string
  clientMessageId?: string
  client?: PrismaLike
  instagramApi?: Pick<InstagramApi, 'sendTextMessage'>
}) {
  const parsed = parseChannelResourceId(input.conversationId)
  if (!parsed || parsed.resourceType !== 'conversation' || parsed.channel !== 'INSTAGRAM') return null
  const client = input.client ?? prisma as unknown as PrismaLike
  const [lead, config] = await Promise.all([
    client.instagramLead.findFirst({ where: { id: parsed.resourceId, businessId: input.businessId } }),
    client.businessInstagramConfig.findFirst({ where: { businessId: input.businessId, enabled: true } })
  ])
  if (!lead) return null
  if (!config?.accessToken) throw new Error('Instagram no está conectado o habilitado para este comercio.')
  const latestInbound = await client.instagramMessage.findFirst({
    where: { leadId: lead.id, direction: 'INBOUND' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true }
  })
  if (!latestInbound || latestInbound.createdAt.getTime() + 24 * 60 * 60 * 1000 <= Date.now()) {
    throw new Error('La ventana de Instagram de 24 hs ya venció. Esperá que la persona vuelva a escribir para responder desde el CRM.')
  }
  const api = input.instagramApi ?? new InstagramApi()
  const delivery = await api.sendTextMessage({
    instagramAccountId: config.apiAccountId ?? config.instagramAccountId,
    accessToken: config.accessToken,
    recipientId: lead.instagramUserId,
    text: input.text
  })
  const message = await client.instagramMessage.create({
    data: {
      leadId: lead.id,
      providerMessageId: delivery.messageId,
      direction: 'OUTBOUND',
      body: input.text,
      status: 'sent',
      metadata: {
        provider: 'instagram',
        recipientId: delivery.recipientId,
        ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {})
      }
    }
  })
  await client.instagramLead.update({ where: { id: lead.id }, data: { lastMessage: input.text } })
  const projected = projectInstagramMessage(message)
  publishOutgoingConversationMessage({
    businessId: input.businessId,
    conversationId: input.conversationId,
    messageId: projected.id,
    sentAt: new Date().toISOString()
  })
  return projected
}

function projectInstagramConversation(lead: any) {
  const latestMessage = lead.messages?.[0] ? projectInstagramMessage(lead.messages[0]) : null
  const label = lead.displayName || (lead.username ? `@${lead.username.replace(/^@/, '')}` : `Instagram ${String(lead.instagramUserId).slice(-6)}`)
  return {
    id: channelConversationId('INSTAGRAM', lead.id),
    sourceId: lead.id,
    businessId: lead.businessId,
    channel: 'INSTAGRAM' as const,
    displayName: label,
    phone: lead.username ? `@${lead.username.replace(/^@/, '')}` : lead.instagramUserId,
    currentStep: 'START',
    aiEnabled: true,
    lastMessage: lead.lastMessage,
    messages: latestMessage ? [latestMessage] : [],
    latestInboundMessage: latestMessage?.direction === 'INBOUND' ? latestMessage : null,
    archivedAt: null,
    createdAt: lead.createdAt,
    updatedAt: latestMessage?.createdAt ?? lead.updatedAt
  }
}

function projectInstagramMessage(message: any) {
  return {
    ...message,
    id: channelMessageId('INSTAGRAM', message.id),
    sourceId: message.id,
    conversationId: channelConversationId('INSTAGRAM', message.leadId),
    channel: 'INSTAGRAM' as const
  }
}
