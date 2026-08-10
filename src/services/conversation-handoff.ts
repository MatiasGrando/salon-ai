export type ConversationHandoffStage = 'NONE' | 'QUEUED' | 'TAKEN' | 'RESOLVED'

export function queuedConversationHandoffPatch(now = new Date()) {
  return {
    currentStep: 'HUMAN_HANDOFF' as const,
    aiEnabled: true,
    misunderstandingCount: 0,
    humanHandoffAt: now,
    humanHandoffResolvedAt: null
  }
}

export function takenConversationHandoffPatch(input?: {
  queuedAt?: Date | null
  now?: Date
}) {
  return {
    currentStep: 'HUMAN_HANDOFF' as const,
    aiEnabled: false,
    misunderstandingCount: 0,
    humanHandoffAt: input?.queuedAt ?? input?.now ?? new Date(),
    humanHandoffResolvedAt: null
  }
}

export function conversationHandoffStage(input: {
  currentStep: string
  aiEnabled: boolean
  humanHandoffAt?: Date | null
  humanHandoffResolvedAt?: Date | null
}): ConversationHandoffStage {
  if (input.humanHandoffResolvedAt) return 'RESOLVED'
  if (input.currentStep !== 'HUMAN_HANDOFF' || !input.humanHandoffAt) return 'NONE'
  return input.aiEnabled ? 'QUEUED' : 'TAKEN'
}

export function isQueuedConversationHandoff(input: {
  currentStep: string
  aiEnabled: boolean
  humanHandoffAt?: Date | null
  humanHandoffResolvedAt?: Date | null
}) {
  return conversationHandoffStage(input) === 'QUEUED'
}
