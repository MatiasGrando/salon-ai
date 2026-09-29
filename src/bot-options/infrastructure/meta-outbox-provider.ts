import type { Prisma } from '../../generated/prisma/client.js'
import { WhatsAppCloudApi, type WhatsAppSendLatencyDiagnostic } from '../../integrations/whatsapp-cloud-api.js'
import { resolveBusinessWhatsAppCredentials, type WhatsAppCloudCredentials } from '../../services/business-whatsapp-settings.js'
import type { OutboxProvider, OutboxProviderDiagnostic } from './whatsapp-outbox-sender.js'

type OutboxPayload = {
  to: string
  expectedProviderPhoneNumberId?: string
  item:
    | { type: 'informative_text'; body: string }
    | { type: 'interactive'; mode: 'buttons' | 'list'; body: string; buttons?: Array<{ id: string; title: string }>; rows?: Array<{ id: string; title: string; description?: string }>; buttonText?: string; sectionTitle?: string }
}

function providerId(response: unknown): string | null {
  if (typeof response !== 'object' || response === null) return null
  const messages = (response as { messages?: unknown }).messages
  if (!Array.isArray(messages)) return null
  const first = messages[0]
  return typeof first === 'object' && first !== null && typeof (first as { id?: unknown }).id === 'string'
    ? (first as { id: string }).id
    : null
}

export class MetaOutboxProvider implements OutboxProvider {
  readonly #api: Pick<WhatsAppCloudApi, 'sendTextMessage' | 'sendReplyButtonsMessage' | 'sendInteractiveListMessage'>
  readonly #resolveCredentials: (businessId: string) => Promise<WhatsAppCloudCredentials>

  constructor(dependencies: {
    api?: Pick<WhatsAppCloudApi, 'sendTextMessage' | 'sendReplyButtonsMessage' | 'sendInteractiveListMessage'>
    resolveCredentials?: (businessId: string) => Promise<WhatsAppCloudCredentials>
  } = {}) {
    this.#api = dependencies.api ?? new WhatsAppCloudApi()
    this.#resolveCredentials = dependencies.resolveCredentials
      ?? ((businessId) => resolveBusinessWhatsAppCredentials(businessId, { allowInternalFallback: false }))
  }

  async send(input: { businessId: string; payload: Prisma.JsonValue }, signal: AbortSignal, onDiagnostic?: (diagnostic: OutboxProviderDiagnostic) => void) {
    const value = input.payload as unknown as OutboxPayload
    if (!value?.to || !value.item) return { kind: 'clear_failure' as const, code: 'invalid_outbox_payload', retryable: false }
    const emit = (diagnostic: OutboxProviderDiagnostic) => {
      try { onDiagnostic?.(diagnostic) } catch { /* diagnostics never affect delivery */ }
    }
    const credentialsStartedAt = performance.now()
    let credentialsOutcome: 'ok' | 'error' = 'error'
    let credentials: WhatsAppCloudCredentials
    try {
      credentials = await this.#resolveCredentials(input.businessId)
      credentialsOutcome = 'ok'
    } finally {
      emit({ phase: 'provider_credentials', durationMs: performance.now() - credentialsStartedAt, outcome: credentialsOutcome })
    }
    if (!credentials.accessToken || !credentials.phoneNumberId) {
      return { kind: 'clear_failure' as const, code: 'tenant_whatsapp_credentials_missing', retryable: false }
    }
    if (value.expectedProviderPhoneNumberId !== undefined) {
      if (typeof value.expectedProviderPhoneNumberId !== 'string' || !value.expectedProviderPhoneNumberId.trim()) {
        return { kind: 'clear_failure' as const, code: 'invalid_provider_identity_fence', retryable: false }
      }
      if (credentials.phoneNumberId !== value.expectedProviderPhoneNumberId) {
        return { kind: 'clear_failure' as const, code: 'provider_identity_mismatch', retryable: true }
      }
    }
    // Include the provider's existing ID validation in the body-read span, not in HTTP headers.
    let parseDiagnostic: WhatsAppSendLatencyDiagnostic | undefined
    const apiDiagnostic = onDiagnostic ? (diagnostic: WhatsAppSendLatencyDiagnostic) => {
      if (diagnostic.phase === 'meta_response_parse') parseDiagnostic = diagnostic
      else emit(diagnostic)
    } : undefined
    let validationStartedAt: number | undefined
    let validationOutcome: 'ok' | 'error' = 'error'
    try {
      const item = value.item
      const result = item.type === 'informative_text'
        ? await this.#api.sendTextMessage({ businessId: input.businessId, credentials, to: value.to, text: item.body, signal }, apiDiagnostic)
        : item.mode === 'buttons'
          ? await this.#api.sendReplyButtonsMessage({ businessId: input.businessId, credentials, to: value.to, text: item.body, buttons: item.buttons ?? [], signal }, apiDiagnostic)
          : await this.#api.sendInteractiveListMessage({
              businessId: input.businessId, credentials, to: value.to, text: item.body, rows: item.rows ?? [], signal,
              ...(item.buttonText ? { buttonText: item.buttonText } : {}),
              ...(item.sectionTitle ? { sectionTitle: item.sectionTitle } : {})
            }, apiDiagnostic)
      validationStartedAt = performance.now()
      if (!result.sent) {
        validationOutcome = 'ok'
        const status = 'status' in result && typeof result.status === 'number' ? result.status : 400
        const code = 'errorCode' in result && result.errorCode ? String(result.errorCode) : ('reason' in result ? result.reason : `http_${status}`)
        return { kind: 'clear_failure' as const, code, retryable: status === 429 || status >= 500 }
      }
      const id = providerId(result.response)
      if (!id) throw new Error('accepted_without_provider_id')
      validationOutcome = 'ok'
      return { kind: 'accepted' as const, providerMessageId: id }
    } finally {
      if (parseDiagnostic) emit({
        ...parseDiagnostic,
        durationMs: parseDiagnostic.durationMs + (validationStartedAt === undefined ? 0 : performance.now() - validationStartedAt),
        outcome: validationOutcome === 'error' ? 'error' : parseDiagnostic.outcome
      })
    }
  }
}
