export const DEFAULT_CONVERSATION_PAUSE_MINUTES = 120
export const DEFAULT_CONVERSATION_EXPIRE_MINUTES = 1440

export type ConversationContextSettings = {
  pauseAfterMinutes: number
  expireAfterMinutes: number
}

export function normalizeConversationContextSettings(input?: {
  conversationPauseAfterMinutes?: unknown
  conversationExpireAfterMinutes?: unknown
} | null): ConversationContextSettings {
  const pauseAfterMinutes = normalizeInteger(
    input?.conversationPauseAfterMinutes,
    DEFAULT_CONVERSATION_PAUSE_MINUTES,
    15,
    720
  )
  const requestedExpiration = normalizeInteger(
    input?.conversationExpireAfterMinutes,
    DEFAULT_CONVERSATION_EXPIRE_MINUTES,
    60,
    10080
  )

  return {
    pauseAfterMinutes,
    expireAfterMinutes: Math.max(requestedExpiration, pauseAfterMinutes + 15)
  }
}

function normalizeInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(numeric)) return fallback
  return Math.min(maximum, Math.max(minimum, numeric))
}
