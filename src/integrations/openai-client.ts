import OpenAI from 'openai'
import { performance } from 'node:perf_hooks'
import type { Response, ResponseCreateParamsNonStreaming } from 'openai/resources/responses/responses.js'
import { openAiConfig } from '../config/openai.js'
import {
  recordOpenAiResponseUsage,
  type AiUsageSource
} from '../services/ai-usage-service.js'
import { getAiUsageAttribution } from '../services/ai-execution-context.js'

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
  const startedAt = performance.now()
  let providerMs = 0
  const attribution = getAiUsageAttribution()
  const schemaName = openAiSchemaName(input)
  let response: Response
  try {
    response = await openAiClient.responses.create(input)
    providerMs = performance.now() - startedAt
  } catch (error) {
    logOpenAiLatency({
      source,
      schemaName,
      conversationId: attribution.conversationId,
      success: false,
      providerMs: rounded(performance.now() - startedAt),
      telemetryMs: 0,
      totalMs: rounded(performance.now() - startedAt)
    })
    throw error
  }

  const telemetryStartedAt = performance.now()
  try {
    await recordOpenAiResponseUsage(source, response)
  } catch (error) {
    console.error('No pude guardar la telemetría de uso de IA', error)
  }
  const finishedAt = performance.now()
  logOpenAiLatency({
    source,
    schemaName,
    conversationId: attribution.conversationId,
    success: true,
    providerMs: rounded(providerMs),
    telemetryMs: rounded(finishedAt - telemetryStartedAt),
    totalMs: rounded(finishedAt - startedAt)
  })
  return response
}

function logOpenAiLatency(payload: Record<string, unknown>) {
  if (process.env.WHATSAPP_LATENCY_DIAGNOSTICS_ENABLED !== 'true') return
  console.info('[openai-latency]', JSON.stringify(payload))
}

function openAiSchemaName(input: ResponseCreateParamsNonStreaming) {
  const format = input.text?.format as { name?: unknown } | undefined
  return typeof format?.name === 'string' ? format.name : null
}

function rounded(value: number) {
  return Math.round(value * 100) / 100
}
