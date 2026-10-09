import { createOpenAiInterpretationProvider } from './openai-interpretation-provider.js'
import { createOpenAiResponseProvider } from './openai-response-provider.js'
import type { AiInterpretationProvider, InterpretationDiagnostics } from './ai-interpreter.js'
import type { InterpretationAttemptDiagnostic, ValidationSummary } from './ai-diagnostics.js'
import { resolveConversationalAiEnvTimeoutMs } from './ai-timeout.js'

/** Correlation IDs only, never recipient, prompts, replies or raw provider errors. */
export type ConversationAiDiagnostic = {
  jobId: string; businessId: string; providerEventId: string; transitionId: string | null
  result: 'PROCESSED' | 'STALE_REVISION'; contextMs: number; computeMs: number
  mode: InterpretationDiagnostics['mode']; reason: InterpretationDiagnostics['reason']
  copyMode: InterpretationDiagnostics['copyMode']; copyReason: InterpretationDiagnostics['copyReason']
  replyValidation?: InterpretationDiagnostics['replyValidation']
  validation?: ValidationSummary
  interpretationAttempts?: readonly InterpretationAttemptDiagnostic[]
  interpretationMs: number; validationMs: number; engineMs: number; responseMs: number
  aiCalls?: InterpretationDiagnostics['aiCalls']; replyRoute?: InterpretationDiagnostics['replyRoute']
  interpretationProviderError?: InterpretationDiagnostics['interpretationProviderError']
  responseProviderError?: InterpretationDiagnostics['responseProviderError']
  availability?: InterpretationDiagnostics['availability']
  usage: InterpretationDiagnostics['usage'] | null
}
export type WhatsAppConversationAi = {
  provider: AiInterpretationProvider
  timeoutMs: number
  onDiagnostic?: (value: ConversationAiDiagnostic) => void | Promise<void>
}

/** Separate opt-in: neither QA flags nor the legacy global model enable this channel. */
export function resolveWhatsAppConversationAi(
  env: Record<string, string | undefined>, fetchImpl?: typeof fetch
): WhatsAppConversationAi | undefined {
  if (env.CONVERSATIONAL_WHATSAPP_AI_ENABLED !== 'true') return undefined
  const timeoutMs = resolveConversationalAiEnvTimeoutMs(env.CONVERSATIONAL_WHATSAPP_AI_TIMEOUT_MS)
  const key = env.OPENAI_API_KEY?.trim()
  if (!key) return { provider: async () => { throw new Error('WhatsApp AI configuration unavailable') }, timeoutMs }
  const options = { apiKey: key, model: env.CONVERSATIONAL_WHATSAPP_AI_MODEL?.trim() || 'gpt-6-luna', ...(fetchImpl ? { fetchImpl } : {}) }
  const provider = createOpenAiInterpretationProvider(options)
  provider.respond = createOpenAiResponseProvider(options)
  return { provider, timeoutMs }
}