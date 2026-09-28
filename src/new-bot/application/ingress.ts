export interface TrustedIngressContext {
  readonly businessId: string
  readonly vertical: string
}

export type NormalizedIngressMessage =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'selection'; readonly selectionId: string }
  | { readonly kind: 'unsupported' }

export interface NewBotIngressEvent {
  readonly provider: 'whatsapp' | 'instagram'
  readonly providerEventId: string
  readonly conversationId: string
  readonly message: NormalizedIngressMessage
}

export interface NewBotIngressRecord {
  readonly businessId: string
  readonly vertical: string
  readonly provider: 'whatsapp' | 'instagram'
  readonly providerEventId: string
  readonly conversationId: string
  readonly message: NormalizedIngressMessage
  readonly receivedAt: Date
}

export type IngressAdmissionResult =
  | { readonly status: 'accepted' }
  | { readonly status: 'duplicate' }
  | { readonly status: 'rejected'; readonly reason: 'invalid-trusted-context' | 'invalid-event' | 'invalid-message' }

export interface NewBotIngressStore {
  insert(record: NewBotIngressRecord): Promise<'accepted' | 'duplicate'>
}

const MAX_PROVIDER_EVENT_ID = 256
const MAX_CONVERSATION_ID = 256
const MAX_VERTICAL = 80
const MAX_MESSAGE_TEXT = 4096
const MAX_SELECTION_ID = 256

function readExactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  const keys = Reflect.ownKeys(value)
  if (keys.length !== expectedKeys.length || keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))) return null

  const result: Record<string, unknown> = Object.create(null)
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return null
    result[key] = descriptor.value
  }
  return result
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim().length > 0 && value.length <= maxLength
}

function normalizeMessage(value: unknown): NormalizedIngressMessage | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind')
  if (!kindDescriptor || !('value' in kindDescriptor) || typeof kindDescriptor.value !== 'string') return null

  if (kindDescriptor.value === 'text') {
    const record = readExactDataRecord(value, ['kind', 'text'])
    if (!record || !boundedString(record.text, MAX_MESSAGE_TEXT)) return null
    return { kind: 'text', text: record.text }
  }
  if (kindDescriptor.value === 'selection') {
    const record = readExactDataRecord(value, ['kind', 'selectionId'])
    if (!record || !boundedString(record.selectionId, MAX_SELECTION_ID)) return null
    return { kind: 'selection', selectionId: record.selectionId }
  }
  if (kindDescriptor.value === 'unsupported') {
    if (!readExactDataRecord(value, ['kind'])) return null
    return { kind: 'unsupported' }
  }
  return null
}

function normalizeTrustedContext(value: unknown): TrustedIngressContext | null {
  const record = readExactDataRecord(value, ['businessId', 'vertical'])
  if (!record || !boundedString(record.businessId, 128) || !boundedString(record.vertical, MAX_VERTICAL)) return null
  return { businessId: record.businessId, vertical: record.vertical }
}

function normalizeEvent(value: unknown):
  | { readonly status: 'invalid-event' }
  | { readonly status: 'invalid-message' }
  | { readonly status: 'valid'; readonly event: Omit<NewBotIngressRecord, 'businessId' | 'vertical' | 'receivedAt'> } {
  const record = readExactDataRecord(value, ['provider', 'providerEventId', 'conversationId', 'message'])
  if (
    !record ||
    (record.provider !== 'whatsapp' && record.provider !== 'instagram') ||
    !boundedString(record.providerEventId, MAX_PROVIDER_EVENT_ID) ||
    !boundedString(record.conversationId, MAX_CONVERSATION_ID)
  ) return { status: 'invalid-event' }
  const message = normalizeMessage(record.message)
  if (!message) return { status: 'invalid-message' }
  return {
    status: 'valid',
    event: {
      provider: record.provider,
      providerEventId: record.providerEventId,
      conversationId: record.conversationId,
      message,
    },
  }
}

/** Validates bounded normalized data and stores it under independently supplied tenant context. */
export async function ingestNewBotEvent(
  trustedContext: TrustedIngressContext,
  untrustedEvent: NewBotIngressEvent,
  store: NewBotIngressStore,
): Promise<IngressAdmissionResult> {
  const tenant = normalizeTrustedContext(trustedContext)
  if (!tenant) return { status: 'rejected', reason: 'invalid-trusted-context' }
  const normalized = normalizeEvent(untrustedEvent)
  if (normalized.status === 'invalid-event') return { status: 'rejected', reason: 'invalid-event' }
  if (normalized.status === 'invalid-message') return { status: 'rejected', reason: 'invalid-message' }

  const status = await store.insert({
    ...normalized.event,
    businessId: tenant.businessId,
    vertical: tenant.vertical,
    receivedAt: new Date(),
  })
  return { status }
}