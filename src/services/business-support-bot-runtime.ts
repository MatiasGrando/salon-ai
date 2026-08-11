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

const bot = new WeexSupportBotV1()

export async function handleExclusiveBusinessSupportBotMessage(input: {
  businessId: string
  conversationId: string
  message: string
}) {
  const configuration = await prisma.businessBotConfiguration.findFirst({
    where: {
      businessId: input.businessId,
      botKey: 'weex-support-v1',
      status: 'ACTIVE',
      channel: 'WHATSAPP',
      routingMode: 'EXCLUSIVE'
    },
    select: { botKey: true }
  })

  if (!configuration) return null

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
