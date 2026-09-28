import { createOpenAiInterpretationProvider } from './openai-interpretation-provider.js'
import type { AiInterpretationProvider } from './ai-interpreter.js'

/** Explicit QA flag. Missing credentials remain an observable deterministic fallback. */
export function resolveQaPreviewAi(
  env: Record<string, string | undefined>, fetchImpl?: typeof fetch
): AiInterpretationProvider | undefined {
  if (env.CONVERSATIONAL_QA_AI_ENABLED !== 'true') return undefined
  const key = env.OPENAI_API_KEY?.trim()
  if (!key) return async () => { throw new Error('QA AI configuration unavailable') }
  return createOpenAiInterpretationProvider({
    apiKey: key,
    model: env.CONVERSATIONAL_QA_AI_MODEL?.trim() || 'gpt-6-luna',
    ...(fetchImpl ? { fetchImpl } : {})
  })
}
