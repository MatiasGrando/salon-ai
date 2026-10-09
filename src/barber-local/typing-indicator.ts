import { WhatsAppCloudApi } from '../integrations/whatsapp-cloud-api.js'
import { resolveBusinessWhatsAppCredentials, type WhatsAppCloudCredentials } from '../services/business-whatsapp-settings.js'
import { BARBER_DEMO_BUSINESS_ID } from './ingress.js'

/** Identities come only from committed, bot-owned consumption/preparation. */
export type ReplyPreparationContext = {
  businessId: string
  providerPhoneNumberId: string
  providerMessageId: string
  signal?: AbortSignal
}
export type ReplyPreparationHook = (context: ReplyPreparationContext) => void
export type PresenceDiagnostic = {
  phase: 'read' | 'typing' | 'credentials'
  outcome: 'accepted' | 'rejected' | 'error' | 'timeout' | 'cancelled' | 'busy' | 'invalid' | 'duplicate'
  count: number
}

/** Ephemeral bounded UX work, never a durable queue or a delivery retry. */
export function createBarberTypingIndicator(dependencies: {
  api?: Pick<WhatsAppCloudApi, 'sendTypingIndicator'> & Partial<Pick<WhatsAppCloudApi, 'sendReadReceipt'>>
  resolveCredentials?: (businessId: string, options: { allowInternalFallback: false }) => Promise<WhatsAppCloudCredentials>
  now?: () => number
  timeoutMs?: number
  onDiagnostic?: (event: PresenceDiagnostic) => void
} = {}) {
  const api = dependencies.api ?? new WhatsAppCloudApi()
  const resolveCredentials = dependencies.resolveCredentials ?? resolveBusinessWhatsAppCredentials
  const now = dependencies.now ?? (() => performance.now())
  const timeoutMs = dependencies.timeoutMs ?? 2_000
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_000) throw new Error('Invalid typing timeout')
  const recent = new Map<string, number>()
  const pendingTyping = new Set<string>()
  const pendingHttp = new Set<string>()
  const controllers = new Set<AbortController>()
  const waiters = new Set<() => void>()
  let activeHttp = 0
  let batches = 0
  let stopped = false
  const emit = (phase: PresenceDiagnostic['phase'], outcome: PresenceDiagnostic['outcome'], count = 1) => {
    try { dependencies.onDiagnostic?.({ phase, outcome, count }) } catch { /* Diagnostics cannot block the bot. */ }
  }
  const key = (context: ReplyPreparationContext) => JSON.stringify([context.businessId, context.providerPhoneNumberId, context.providerMessageId])
  const valid = (context: ReplyPreparationContext) => context.businessId === BARBER_DEMO_BUSINESS_ID &&
    Boolean(context.providerPhoneNumberId?.trim() && context.providerMessageId?.trim())
  const duplicate = (id: string) => {
    const timestamp = now()
    for (const [saved, expiry] of recent) if (expiry <= timestamp) recent.delete(saved)
    return recent.has(id)
  }
  const accepted = (id: string) => {
    if (recent.size >= 256) recent.delete(recent.keys().next().value!)
    recent.set(id, now() + 300_000)
  }
  const deadline = (controller: AbortController, duration: number) => {
    const timer = setTimeout(() => controller.abort(), duration)
    timer.unref()
    return () => clearTimeout(timer)
  }
  const wake = () => { for (const resume of [...waiters]) resume() }
  const credentialsFor = async (context: ReplyPreparationContext, signal: AbortSignal) => {
    const controller = new AbortController()
    controllers.add(controller)
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) controller.abort()
    const clear = deadline(controller, timeoutMs)
    try {
      const expired = new Promise<null>(resolve => {
        if (controller.signal.aborted) resolve(null)
        else controller.signal.addEventListener('abort', () => resolve(null), { once: true })
      })
      const credentials = await Promise.race([resolveCredentials(context.businessId, { allowInternalFallback: false }), expired])
      if (!credentials || stopped || signal.aborted) { emit('credentials', signal.aborted ? 'cancelled' : 'timeout'); return null }
      if (!credentials.accessToken || credentials.phoneNumberId !== context.providerPhoneNumberId) {
        emit('credentials', 'invalid'); return null
      }
      return credentials
    } catch { emit('credentials', 'error'); return null }
    finally { clear(); controllers.delete(controller); signal.removeEventListener('abort', abort) }
  }
  const send = async (phase: 'read' | 'typing', context: ReplyPreparationContext, credentials: WhatsAppCloudCredentials, signal: AbortSignal) => {
    const id = phase + key(context)
    if (duplicate(id)) { emit(phase, 'duplicate'); return }
    while (activeHttp >= 4 && !stopped && !signal.aborted) {
      await new Promise<void>(resolve => {
        const resume = () => { waiters.delete(resume); signal.removeEventListener('abort', resume); resolve() }
        waiters.add(resume)
        signal.addEventListener('abort', resume, { once: true })
      })
    }
    if (stopped || signal.aborted) { emit(phase, 'cancelled'); return }
    if (duplicate(id) || pendingHttp.has(id)) { emit(phase, 'duplicate'); return }
    pendingHttp.add(id)
    activeHttp++
    const controller = new AbortController()
    controllers.add(controller)
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    const clear = deadline(controller, timeoutMs)
    try {
      // Credential lookup has its own deadline; this HTTP phase receives the full budget.
      const operation = phase === 'typing' ? api.sendTypingIndicator.bind(api) : api.sendReadReceipt?.bind(api)
      if (!operation) { emit(phase, 'invalid'); return }
      const result = await operation({ credentials, providerMessageId: context.providerMessageId, signal: controller.signal })
      emit(phase, result ? 'accepted' : 'rejected')
      if (result) { accepted(id); if (phase === 'typing') accepted('read' + key(context)) }
    } catch { emit(phase, signal.aborted ? 'cancelled' : controller.signal.aborted ? 'timeout' : 'error') }
    finally { clear(); signal.removeEventListener('abort', abort); controllers.delete(controller); pendingHttp.delete(id); activeHttp--; wake() }
  }
  const notify: ReplyPreparationHook = context => {
    try {
      if (stopped || !valid(context) || context.signal?.aborted) return
      const id = key(context)
      if (duplicate('typing' + id) || pendingTyping.has(id)) { emit('typing', 'duplicate'); return }
      if (pendingTyping.size >= 4) { emit('typing', 'busy'); return }
      pendingTyping.add(id)
      const controller = new AbortController()
      controllers.add(controller)
      const abort = () => controller.abort()
      context.signal?.addEventListener('abort', abort, { once: true })
      void credentialsFor(context, controller.signal).then(async credentials => {
        if (credentials) await send('typing', context, credentials, controller.signal)
      }).catch(() => { emit('typing', 'error') }).finally(() => {
        context.signal?.removeEventListener('abort', abort)
        controllers.delete(controller); pendingTyping.delete(id)
      })
    } catch { emit('typing', 'error') }
  }
  const consume = (contexts: readonly ReplyPreparationContext[]) => {
    try {
      if (stopped || !contexts.length) return
      // Matches the existing consolidation MAX_EVENTS=128; does not expand admission.
      if (contexts.length > 128 || contexts.some(context => !valid(context) ||
          context.businessId !== contexts[0]!.businessId || context.providerPhoneNumberId !== contexts[0]!.providerPhoneNumberId)) {
        emit('read', 'invalid', contexts.length); return
      }
      if (batches >= 4) { emit('read', 'busy', contexts.length); return }
      batches++
      const controller = new AbortController()
      controllers.add(controller)
      // Lookup plus four-at-a-time HTTP budgets, at most 66 seconds for 128 messages.
      const clear = deadline(controller, timeoutMs * (1 + Math.ceil(contexts.length / 4)))
      void credentialsFor(contexts[0]!, controller.signal).then(async credentials => {
        if (!credentials) return
        let index = 0
        await Promise.all(Array.from({ length: Math.min(4, contexts.length) }, async () => {
          while (index < contexts.length) {
            const context = contexts[index++]!
            await send('read', context, credentials, controller.signal)
          }
        }))
      }).catch(() => { emit('read', 'error', contexts.length) }).finally(() => {
        clear(); controllers.delete(controller); batches--
      })
    } catch { emit('read', 'error', contexts.length) }
  }
  return { notify, consume, stop: () => {
    stopped = true
    for (const controller of controllers) controller.abort()
    recent.clear(); wake()
  } }
}