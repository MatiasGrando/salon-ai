import type { Prisma } from '../../generated/prisma/client.js'
import { WhatsAppCloudApi } from '../../integrations/whatsapp-cloud-api.js'
import { resolveBusinessWhatsAppCredentials, type WhatsAppCloudCredentials } from '../../services/business-whatsapp-settings.js'
import type { OutboxProvider } from './whatsapp-outbox-sender.js'

type OutboxPayload = {
  to: string
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

  async send(input: { businessId: string; payload: Prisma.JsonValue }, signal: AbortSignal) {
    const value = input.payload as unknown as OutboxPayload
    if (!value?.to || !value.item) return { kind: 'clear_failure' as const, code: 'invalid_outbox_payload', retryable: false }
    const credentials = await this.#resolveCredentials(input.businessId)
    if (!credentials.accessToken || !credentials.phoneNumberId) {
      return { kind: 'clear_failure' as const, code: 'tenant_whatsapp_credentials_missing', retryable: false }
    }
    const item = value.item
    const result = item.type === 'informative_text'
      ? await this.#api.sendTextMessage({ businessId: input.businessId, credentials, to: value.to, text: item.body, signal })
      : item.mode === 'buttons'
        ? await this.#api.sendReplyButtonsMessage({ businessId: input.businessId, credentials, to: value.to, text: item.body, buttons: item.buttons ?? [], signal })
        : await this.#api.sendInteractiveListMessage({
            businessId: input.businessId, credentials, to: value.to, text: item.body, rows: item.rows ?? [], signal,
            ...(item.buttonText ? { buttonText: item.buttonText } : {}),
            ...(item.sectionTitle ? { sectionTitle: item.sectionTitle } : {})
          })
    if (!result.sent) {
      const status = 'status' in result && typeof result.status === 'number' ? result.status : 400
      const code = 'errorCode' in result && result.errorCode ? String(result.errorCode) : ('reason' in result ? result.reason : `http_${status}`)
      return { kind: 'clear_failure' as const, code, retryable: status === 429 || status >= 500 }
    }
    const id = providerId(result.response)
    if (!id) throw new Error('accepted_without_provider_id')
    return { kind: 'accepted' as const, providerMessageId: id }
  }
}
