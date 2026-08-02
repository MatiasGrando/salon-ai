import { prisma as defaultPrisma } from '../config/prisma.js'
import type { BusinessInformationTopic, ConversationRouterInput } from './conversation-router.js'
import { stateFromConversation, type BookingV2ConversationSnapshot } from './booking-v2-conversation-state.js'

type PrismaClientLike = typeof defaultPrisma

export class ConversationRouterContextService {
  constructor(private readonly db: PrismaClientLike = defaultPrisma) {}

  async load(input: {
    businessId: string
    conversationId: string
    message: string
    currentStep: string
    conversation: BookingV2ConversationSnapshot
  }): Promise<ConversationRouterInput> {
    const [business, messages] = await Promise.all([
      this.db.business.findUnique({
        where: { id: input.businessId },
        select: {
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
          businessHours: {
            select: { dayOfWeek: true, startTime: true, endTime: true }
          },
          services: {
            where: { isBookable: true },
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
            },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }]
          },
          professionals: {
            where: { isActive: true },
            select: { id: true, name: true, description: true },
            orderBy: { name: 'asc' }
          }
        }
      }),
      this.db.message.findMany({
        where: { conversationId: input.conversationId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { direction: true, body: true }
      })
    ])

    const recentMessages = removeCurrentInboundFromHistory(messages.reverse().map((message) => ({
      direction: message.direction,
      body: message.body
    })), input.message)
    const lastBotMessage = [...recentMessages].reverse().find((message) => message.direction === 'OUTBOUND')?.body ?? null
    const state = stateFromConversation(input.conversation)

    return {
      message: input.message,
      currentStep: input.currentStep,
      lastBotMessage,
      recentMessages,
      draft: state.draft,
      business: {
        name: business?.name ?? 'el local',
        availableInformation: availableInformationForBusiness(business)
      },
      catalog: {
        services: business?.services.map((service) => {
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
                    ...service.parentService.aliases.map((alias) =>
                      `${alias.name} ${service.name}`
                    )
                  ]
                : [])
            ]))
          }
        }) ?? [],
        professionals: business?.professionals.map((professional) => ({
          id: professional.id,
          name: professional.name,
          description: professional.description
        })) ?? []
      }
    }
  }
}

export function removeCurrentInboundFromHistory(
  messages: ConversationRouterInput['recentMessages'],
  currentMessage: string
) {
  const result = messages.slice()
  const normalizedCurrent = normalizeForComparison(currentMessage)

  for (let index = result.length - 1; index >= 0; index -= 1) {
    const candidate = result[index]
    if (
      candidate?.direction === 'INBOUND' &&
      normalizeForComparison(candidate.body) === normalizedCurrent
    ) {
      result.splice(index, 1)
      break
    }
  }

  return result
}

function normalizeForComparison(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function availableInformationForBusiness(business: {
  slug: string | null
  landingEnabled: boolean
  publicWhatsapp: string | null
  contactEmail: string | null
  publicAddress: string | null
  publicAddressArea: string | null
  publicMapsUrl: string | null
  instagramUrl: string | null
  facebookUrl: string | null
  businessHours: Array<{ dayOfWeek: number; startTime: string; endTime: string }>
  services: Array<{ id: string }>
  professionals: Array<{ id: string }>
} | null): BusinessInformationTopic[] {
  if (!business) return []

  const topics: BusinessInformationTopic[] = []
  if (business.businessHours.length) topics.push('opening_hours')
  if (business.publicAddress || business.publicAddressArea || business.publicMapsUrl) topics.push('address')
  if (business.landingEnabled && business.slug) topics.push('website', 'booking_channels')
  if (business.publicWhatsapp) topics.push('phone')
  if (business.contactEmail) topics.push('email')
  if (business.instagramUrl) topics.push('instagram')
  if (business.facebookUrl) topics.push('facebook')
  if (business.services.length) topics.push('services', 'prices')
  if (business.professionals.length) topics.push('professionals')
  return topics
}
