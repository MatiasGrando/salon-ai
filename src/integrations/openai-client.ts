import OpenAI from 'openai'
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses.js'
import { openAiConfig } from '../config/openai.js'
import {
  recordOpenAiResponseUsage,
  type AiUsageSource
} from '../services/ai-usage-service.js'

let client: OpenAI | null = null

export function getOpenAiClient() {
  if (!openAiConfig.enabled || !openAiConfig.apiKey) {
    return null
  }

  client ??= new OpenAI({
    apiKey: openAiConfig.apiKey
  })

  return client
}

export async function createTrackedOpenAiResponse(
  openAiClient: OpenAI,
  source: AiUsageSource,
  input: ResponseCreateParamsNonStreaming
): Promise<Response> {
  const response = await openAiClient.responses.create(input)
  try {
    await recordOpenAiResponseUsage(source, response)
  } catch (error) {
    console.error('No pude guardar la telemetría de uso de IA', error)
  }
  return response
}
