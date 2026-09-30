import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { resolveBusinessWhatsAppCredentials, type WhatsAppCloudCredentials } from '../services/business-whatsapp-settings.js'
import { BARBER_DEMO_BUSINESS_ID } from './ingress.js'

/** Only pass identities from a committed, bot-owned inbox snapshot, never webhook payload overrides. */
export type ReplyPreparationContext = {
  businessId: string
  providerPhoneNumberId: string
  providerMessageId: string
}
export type ReplyPreparationHook = (context: ReplyPreparationContext) => void

/** Ephemeral UX hint, not delivery infrastructure. No retry, persisted state or secret logging. */
export function createBarberTypingIndicator(dependencies: {
  api?: Pick<WhatsAppCloudApi, 'sendTypingIndicator'>
  resolveCredentials?: (businessId: string, options: { allowInternalFallback: false }) => Promise<WhatsAppCloudCredentials>
  now?: () => number
  timeoutMs?: number
} = {}): { notify: ReplyPreparationHook; stop: () => void } {
  const api = dependencies.api ?? new WhatsAppCloudApi()
  const resolveCredentials = dependencies.resolveCredentials ?? resolveBusinessWhatsAppCredentials
  const now = dependencies.now ?? (() => performance.now())
  const timeoutMs = dependencies.timeoutMs ?? 2_000
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_000) throw new Error('Invalid typing timeout')
  const recent = new Map<string, number>()
  const active = new Map<string, AbortController>()
  let stopped = false
  const notify: ReplyPreparationHook = context => {
    try {
      if (stopped || context.businessId !== BARBER_DEMO_BUSINESS_ID
        || !context.providerPhoneNumberId?.trim() || !context.providerMessageId?.trim()) return
      const { businessId, providerPhoneNumberId, providerMessageId } = context
      const key = JSON.stringify([businessId, providerPhoneNumberId, providerMessageId])
      const timestamp = now()
      if (!Number.isFinite(timestamp)) return
      for (const [id, expires] of recent) if (expires <= timestamp) recent.delete(id)
      if (recent.has(key) || active.has(key) || active.size >= 4) return
      if (recent.size >= 256) recent.delete(recent.keys().next().value!)
      recent.set(key, timestamp + 300_000)
      const controller = new AbortController()
      active.set(key, controller)
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      timer.unref()
      // No credentials lookup or HTTP is awaited by webhook/bot. Slots remain bounded even if a resolver ignores timeout.
      void Promise.resolve().then(async () => {
        const credentials = await resolveCredentials(businessId, { allowInternalFallback: false })
        if (controller.signal.aborted || stopped || !credentials.accessToken
          || credentials.phoneNumberId !== providerPhoneNumberId) return
        await api.sendTypingIndicator({ credentials, providerMessageId, signal: controller.signal })
      }).catch(() => { /* A failed hint must never fail processing or expose provider/credential errors. */ })
        .finally(() => { clearTimeout(timer); active.delete(key) })
    } catch { /* UX hints are fail-open, including clock or input failures. */ }
  }
  return { notify, stop: () => {
    stopped = true
    for (const controller of active.values()) controller.abort()
    recent.clear()
  } }
}
