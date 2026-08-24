import { Prisma } from '../generated/prisma/client.js'
import { prisma } from '../config/prisma.js'
import {
  WeexSupportBotV1,
  type WeexSupportBotCustomerIdentity,
  type WeexSupportBotResult,
  type WeexSupportBotState
} from './weex-support-bot-v1.js'
import { isBusinessCustomerCode, normalizeBusinessCustomerCode } from './business-customer-code.js'
import { takenConversationHandoffPatch } from './conversation-handoff.js'
import {
  TAMARA_OPTIONS_BOT_KEY,
  TamaraOptionsBot,
  type TamaraOptionsBotState
} from './tamara-options-bot.js'
import { PrismaTamaraOptionsBotGateway } from './tamara-options-bot-gateway.js'

const bot = new WeexSupportBotV1()

export async function handleExclusiveBusinessSupportBotMessage(input: {
  businessId: string
  conversationId: string
  message: string
  interactiveReplyId?: string
  previousActivityAt?: Date
}) {
  const configuration = await prisma.businessBotConfiguration.findFirst({
    where: {
      businessId: input.businessId,
      status: 'ACTIVE',
      channel: 'WHATSAPP',
      routingMode: 'EXCLUSIVE'
    },
    select: { botKey: true, definition: true }
  })

  if (!configuration) return null

  if (configuration.botKey === TAMARA_OPTIONS_BOT_KEY) {
    return handleTamaraOptionsBotMessage(input, configuration)
  }
  if (configuration.botKey !== 'weex-support-v1') return null

  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { supportBotState: true }
  })
  if (!conversation) throw new Error('No encontré la conversación del bot')

  const previousState = isSupportBotState(conversation.supportBotState)
    ? conversation.supportBotState
    : null
  const customerIdentity = previousState?.node === 'HANDOFF_CUSTOMER_CODE'
    ? await resolveCustomerIdentity(input.message)
    : undefined
  const result = previousState
    ? bot.handle(input.message, previousState, customerIdentity)
    : bot.start()

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: result.status === 'completed'
      ? {
          ...takenConversationHandoffPatch(),
          supportBotKey: configuration.botKey,
          supportBotState: result.state as Prisma.InputJsonValue,
          ...(result.handoff?.name ? { selectedCustomerName: result.handoff.name } : {})
        }
      : {
          currentStep: 'START',
          aiEnabled: true,
          misunderstandingCount: result.state.invalidAttempts,
          humanHandoffAt: null,
          humanHandoffResolvedAt: null,
          supportBotKey: configuration.botKey,
          supportBotState: result.state as Prisma.InputJsonValue
        }
  })

  return {
    reply: formatWeexSupportBotForWhatsApp(result),
    messages: undefined as string[] | undefined,
    replyButtons: undefined as Array<{ id: string; title: string }> | undefined,
    depositRequestId: undefined as string | undefined,
    supportBot: configuration.botKey,
    handoff: result.handoff
  }
}

async function handleTamaraOptionsBotMessage(
  input: {
    businessId: string
    conversationId: string
    message: string
    interactiveReplyId?: string
    previousActivityAt?: Date
  },
  configuration: { botKey: string; definition: Prisma.JsonValue }
) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: input.conversationId },
    select: { supportBotState: true, updatedAt: true }
  })
  if (!conversation) throw new Error('No encontré la conversación del bot')

  const definition = configuration.definition && typeof configuration.definition === 'object' && !Array.isArray(configuration.definition)
    ? configuration.definition as Record<string, Prisma.JsonValue>
    : {}
  const professionalId = typeof definition.professionalId === 'string' ? definition.professionalId : undefined
  const tamaraBot = new TamaraOptionsBot(new PrismaTamaraOptionsBotGateway(input.conversationId, professionalId))
  const previousState = isTamaraOptionsBotState(conversation.supportBotState)
    ? conversation.supportBotState
    : null
  const result = previousState
    ? await tamaraBot.handle({
        businessId: input.businessId,
        phone: await conversationPhone(input.conversationId),
        message: input.message,
        ...(input.interactiveReplyId ? { interactiveReplyId: input.interactiveReplyId } : {}),
        state: previousState,
        previousActivityAt: input.previousActivityAt ?? conversation.updatedAt
      })
    : await tamaraBot.start({
        businessId: input.businessId,
        phone: await conversationPhone(input.conversationId)
      })

  await prisma.conversation.update({
    where: { id: input.conversationId },
    data: result.handoff
      ? {
          ...takenConversationHandoffPatch(),
          supportBotKey: configuration.botKey,
          supportBotState: result.state as Prisma.InputJsonValue,
          lastMessage: result.handoff.reason,
          ...(result.handoff.name ? { selectedCustomerName: result.handoff.name } : {})
        }
      : {
          currentStep: result.depositRequestId ? 'AWAITING_DEPOSIT' : 'START',
          aiEnabled: true,
          misunderstandingCount: result.state.invalidAttempts,
          humanHandoffAt: null,
          humanHandoffResolvedAt: null,
          supportBotKey: configuration.botKey,
          supportBotState: result.state as Prisma.InputJsonValue,
          ...(result.reset ? {
            selectedServiceId: null,
            selectedProfessionalId: null,
            selectedDate: null,
            selectedTime: null,
            selectedCustomerName: null,
            lastAvailability: Prisma.JsonNull,
            bookingV2State: Prisma.JsonNull,
            photoQuoteAcknowledgedAt: null
          } : {}),
          ...(result.state.context.customerName ? { selectedCustomerName: result.state.context.customerName } : {})
        }
  })

  return {
    reply: result.message,
    messages: undefined as string[] | undefined,
    replyButtons: result.options.map((option) => ({
      id: option.id,
      title: option.title,
      ...(option.description ? { description: option.description } : {})
    })),
    depositRequestId: result.depositRequestId,
    supportBot: configuration.botKey,
    handoff: result.handoff
  }
}

async function conversationPhone(conversationId: string) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { phone: true } })
  if (!conversation) throw new Error('No encontré la conversación del bot')
  return conversation.phone
}

async function resolveCustomerIdentity(message: string): Promise<WeexSupportBotCustomerIdentity | undefined> {
  const customerCode = normalizeBusinessCustomerCode(message)
  if (!isBusinessCustomerCode(customerCode)) return undefined

  const business = await prisma.business.findUnique({
    where: { customerCode },
    select: { name: true }
  })

  return business
    ? { status: 'verified', customerCode, businessName: business.name }
    : { status: 'not_found', customerCode }
}

export function formatWeexSupportBotForWhatsApp(result: WeexSupportBotResult) {
  if (!result.options.length) return result.message
  return `${result.message}\n\n${result.options
    .map((option) => `${option.value} · ${option.label}`)
    .join('\n')}`
}

function isSupportBotState(value: Prisma.JsonValue | null): value is WeexSupportBotState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.node === 'string' &&
    typeof candidate.invalidAttempts === 'number' &&
    Array.isArray(candidate.trail) &&
    Boolean(candidate.context) &&
    typeof candidate.context === 'object'
}

function isTamaraOptionsBotState(value: Prisma.JsonValue | null): value is TamaraOptionsBotState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.node === 'string' &&
    typeof candidate.invalidAttempts === 'number' &&
    Boolean(candidate.context) &&
    typeof candidate.context === 'object' &&
    Array.isArray(candidate.history)
}
