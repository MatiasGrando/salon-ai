/** Individual deadline shared by conversational interpretation and grounded reply calls. */
export const DEFAULT_CONVERSATIONAL_AI_TIMEOUT_MS = 15_000
export const MAX_CONVERSATIONAL_AI_TIMEOUT_MS = 15_000

/** Programmatic callers retain the existing 1ms minimum; invalid values use the default. */
export function resolveConversationalAiTimeoutMs(value?: number): number {
  if (value === undefined || !Number.isFinite(value) || !Number.isInteger(value)) return DEFAULT_CONVERSATIONAL_AI_TIMEOUT_MS
  return Math.min(MAX_CONVERSATIONAL_AI_TIMEOUT_MS, Math.max(1, value))
}

/** Environment values remain integer milliseconds with the existing 1000ms minimum. */
export function resolveConversationalAiEnvTimeoutMs(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) return DEFAULT_CONVERSATIONAL_AI_TIMEOUT_MS
  return Math.max(1000, resolveConversationalAiTimeoutMs(Number(value)))
}
