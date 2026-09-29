/** Ephemeral API usage metadata; never serializes prompts or model output. */
export const aiUsage = Symbol('qa-ai-usage')
export type AiUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number; reasoningTokens: number }
export function attachAiUsage<T>(result: T, body: unknown): T {
  if (!result || typeof result !== 'object' || !body || typeof body !== 'object') return result
  const raw = (body as { usage?: unknown }).usage
  if (!raw || typeof raw !== 'object') return result
  const usage = raw as Record<string, unknown>
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0
  Object.defineProperty(result, aiUsage, { value: {
    inputTokens: count(usage.input_tokens),
    outputTokens: count(usage.output_tokens),
    cachedInputTokens: count((usage.input_tokens_details as Record<string, unknown> | undefined)?.cached_tokens),
    reasoningTokens: count((usage.output_tokens_details as Record<string, unknown> | undefined)?.reasoning_tokens)
  } satisfies AiUsage })
  return result
}
export function readAiUsage(result: unknown): AiUsage | null {
  return result && typeof result === 'object' ? ((result as { [aiUsage]?: AiUsage })[aiUsage] ?? null) : null
}
