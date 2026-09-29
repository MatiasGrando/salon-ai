import { createOpenAiInterpretationProvider } from './openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from './openai-response-provider.js'
import type { AiInterpretationProvider } from './ai-interpreter.js'

/** Explicit QA flag. Missing credentials remain an observable deterministic fallback. */
export function resolveQaPreviewAi(
  env: Record<string, string | undefined>, fetchImpl?: typeof fetch
): AiInterpretationProvider | undefined {
  if (env.CONVERSATIONAL_QA_AI_ENABLED !== 'true') return undefined
  const key = env.OPENAI_API_KEY?.trim()
  if (!key) return async () => { throw new Error('QA AI configuration unavailable') }
  const provider = createOpenAiInterpretationProvider({
    apiKey: key,
    model: env.CONVERSATIONAL_QA_AI_MODEL?.trim() || 'gpt-6-luna',
    ...(fetchImpl ? { fetchImpl } : {})
  })
  provider.respond = createOpenAiResponseProvider({ apiKey: key, model: env.CONVERSATIONAL_QA_AI_MODEL?.trim() || 'gpt-6-luna', ...(fetchImpl ? { fetchImpl } : {}) })
  return provider
}

/** Bounded QA-only interpreter deadline; invalid values use the observed-latency default. */
export function resolveQaPreviewAiTimeoutMs(env: Record<string, string | undefined>): number {
  const value = env.CONVERSATIONAL_QA_AI_TIMEOUT_MS
  if (value === undefined || !/^\d+$/.test(value)) return 4500
  return Math.min(5000, Math.max(1000, Number(value)))
}