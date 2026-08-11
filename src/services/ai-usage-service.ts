import type { Response } from 'openai/resources/responses/responses.js'
import { prisma } from '../config/prisma.js'
import { getAiUsageAttribution, setAiUsageAttribution } from './ai-execution-context.js'
import { calculateAiUsageCostNanoUsd } from './ai-pricing.js'

export type AiUsageSource =
  | 'conversation_router'
  | 'message_understanding'
  | 'booking_extraction'
  | 'booking_choice'
  | 'booking_estimate_option'
  | 'booking_estimate_decision'
  | 'booking_service_validation'

export async function recordOpenAiResponseUsage(source: AiUsageSource, response: Response) {
  if (!response.usage) return

  const attribution = getAiUsageAttribution()
  const usage = response.usage
  const inputTokens = usage.input_tokens ?? 0
  const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const cacheWriteTokens = usage.input_tokens_details?.cache_write_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const pricing = calculateAiUsageCostNanoUsd(response.model, {
    inputTokens,
    cachedInputTokens,
    outputTokens
  })

  await prisma.aiUsageEvent.upsert({
    where: { responseId: response.id },
    update: {},
    create: {
      businessId: attribution.businessId,
      conversationId: attribution.conversationId,
      appointmentId: attribution.appointmentId,
      source,
      responseId: response.id,
      model: response.model,
      inputTokens,
      cachedInputTokens,
      cacheWriteTokens,
      outputTokens,
      totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
      costNanoUsd: pricing?.costNanoUsd ?? null,
      pricingKey: pricing?.pricingKey ?? null,
      createdAt: new Date(response.created_at * 1_000)
    }
  })
}

export async function linkAiUsageToAppointment(input: {
  conversationId: string
  appointmentId: string
}) {
  setAiUsageAttribution({ appointmentId: input.appointmentId })
  await prisma.aiUsageEvent.updateMany({
    where: {
      conversationId: input.conversationId,
      appointmentId: null
    },
    data: {
      appointmentId: input.appointmentId
    }
  })
}
