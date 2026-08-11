import { AsyncLocalStorage } from 'node:async_hooks'

type AiExecutionContext = {
  enabled: boolean
  businessId: string | null
  conversationId: string | null
  appointmentId: string | null
}

const aiExecutionContext = new AsyncLocalStorage<AiExecutionContext>()

export function runWithAiEnabled<T>(enabled: boolean, callback: () => Promise<T>) {
  return aiExecutionContext.run({
    enabled,
    businessId: null,
    conversationId: null,
    appointmentId: null
  }, callback)
}

export function isAiExecutionEnabled() {
  return aiExecutionContext.getStore()?.enabled ?? true
}

export function setAiUsageAttribution(input: Partial<Pick<
  AiExecutionContext,
  'businessId' | 'conversationId' | 'appointmentId'
>>) {
  const context = aiExecutionContext.getStore()
  if (!context) return
  Object.assign(context, input)
}

export function getAiUsageAttribution() {
  const context = aiExecutionContext.getStore()
  return {
    businessId: context?.businessId ?? null,
    conversationId: context?.conversationId ?? null,
    appointmentId: context?.appointmentId ?? null
  }
}
