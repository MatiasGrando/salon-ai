export type AiTokenUsage = {
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
}

type AiModelPricing = {
  key: string
  inputNanoUsdPerToken: bigint
  cachedInputNanoUsdPerToken: bigint
  outputNanoUsdPerToken: bigint
}

const MODEL_PRICING: Array<{ matches: (model: string) => boolean; pricing: AiModelPricing }> = [
  {
    matches: (model) => model === 'gpt-4o-mini' || model.startsWith('gpt-4o-mini-'),
    pricing: {
      key: 'gpt-4o-mini-2026-08',
      inputNanoUsdPerToken: 150n,
      cachedInputNanoUsdPerToken: 75n,
      outputNanoUsdPerToken: 600n
    }
  },
  {
    matches: (model) => model === 'gpt-5-mini' || model.startsWith('gpt-5-mini-'),
    pricing: {
      key: 'gpt-5-mini-2026-08',
      inputNanoUsdPerToken: 250n,
      cachedInputNanoUsdPerToken: 25n,
      outputNanoUsdPerToken: 2_000n
    }
  }
]

export function calculateAiUsageCostNanoUsd(model: string, usage: AiTokenUsage) {
  const pricing = MODEL_PRICING.find((candidate) => candidate.matches(model))?.pricing
  if (!pricing) return null

  const inputTokens = Math.max(0, Math.trunc(usage.inputTokens))
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, Math.trunc(usage.cachedInputTokens))
  )
  const uncachedInputTokens = inputTokens - cachedInputTokens
  const outputTokens = Math.max(0, Math.trunc(usage.outputTokens))
  const costNanoUsd =
    BigInt(uncachedInputTokens) * pricing.inputNanoUsdPerToken +
    BigInt(cachedInputTokens) * pricing.cachedInputNanoUsdPerToken +
    BigInt(outputTokens) * pricing.outputNanoUsdPerToken

  return {
    costNanoUsd,
    pricingKey: pricing.key
  }
}
