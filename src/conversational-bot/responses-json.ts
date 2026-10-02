/** Bounded, data-only Responses reader. Tool/reasoning items never contribute reply facts. */
export const RESPONSE_FORMAT_LIMITS = { outputItems: 64, contentParts: 64, textLength: 20096 } as const
const reasons = ['response_json_invalid', 'response_body_invalid', 'response_not_completed', 'output_not_array',
  'output_items_limit', 'output_item_invalid', 'message_missing', 'message_ambiguous', 'message_role_invalid',
  'message_not_completed', 'content_not_array', 'content_parts_limit', 'content_part_invalid',
  'content_part_unsupported', 'text_missing', 'text_not_string', 'text_too_large', 'refusal', 'invalid_json'] as const
const statuses = ['completed', 'incomplete', 'failed', 'cancelled', 'queued', 'in_progress', 'unknown'] as const
export type ResponseFormatFailure = {
  reason: typeof reasons[number]
  responseStatus: typeof statuses[number]
  messageStatus?: typeof statuses[number]
  incompleteReason?: 'max_output_tokens' | 'content_filter' | 'unknown'
  outputItems?: number
  messageCount?: number
  contentParts?: number
  textParts?: number
  textLength?: number
  maxTextLength?: number
}
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const field = (value: unknown, key: string): unknown =>
  record(value) ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined
const status = (value: unknown): ResponseFormatFailure['responseStatus'] =>
  statuses.includes(value as typeof statuses[number]) ? value as typeof statuses[number] : 'unknown'
const incompleteReason = (value: unknown): NonNullable<ResponseFormatFailure['incompleteReason']> =>
  value === 'max_output_tokens' || value === 'content_filter' ? value : 'unknown'

/** Never copy arbitrary caller keys, strings, getters or response content into diagnostics. */
export function sanitizeResponseFormat(value: unknown): ResponseFormatFailure | undefined {
  const reason = field(value, 'reason')
  if (!reasons.includes(reason as typeof reasons[number])) return undefined
  const safe: ResponseFormatFailure = { reason: reason as typeof reasons[number], responseStatus: status(field(value, 'responseStatus')) }
  if (field(value, 'messageStatus') !== undefined) safe.messageStatus = status(field(value, 'messageStatus'))
  if (field(value, 'incompleteReason') !== undefined) safe.incompleteReason = incompleteReason(field(value, 'incompleteReason'))
  const bounds = { outputItems: 65, messageCount: 65, contentParts: 65, textParts: 65,
    textLength: RESPONSE_FORMAT_LIMITS.textLength + 1, maxTextLength: RESPONSE_FORMAT_LIMITS.textLength } as const
  for (const key of Object.keys(bounds) as Array<keyof typeof bounds>) {
    const number = field(value, key)
    if (typeof number === 'number' && Number.isFinite(number) && number >= 0) safe[key] = Math.min(bounds[key], Math.floor(number))
  }
  return safe
}
type ReadResult = { ok: true; value: unknown } |
  { ok: false; code: 'incomplete' | 'refusal' | 'json' | 'shape'; responseFormat: ResponseFormatFailure }

/** Only fragments of one coherent assistant message may be concatenated; JSON is never repaired. */
export function extractResponsesJson(body: unknown, maxTextLength: number): ReadResult {
  if (!Number.isInteger(maxTextLength) || maxTextLength < 1 || maxTextLength > RESPONSE_FORMAT_LIMITS.textLength)
    throw new RangeError('invalid Responses text limit')
  const metadata: Omit<ResponseFormatFailure, 'reason'> = { responseStatus: status(field(body, 'status')), maxTextLength }
  const fail = (code: 'incomplete' | 'refusal' | 'json' | 'shape', reason: ResponseFormatFailure['reason']): ReadResult =>
    ({ ok: false, code, responseFormat: { ...metadata, reason } })
  if (!record(body)) return fail('incomplete', 'response_body_invalid')
  if (metadata.responseStatus !== 'completed') {
    const details = field(body, 'incomplete_details')
    if (details !== undefined) metadata.incompleteReason = incompleteReason(field(details, 'reason'))
    return fail('incomplete', 'response_not_completed')
  }
  const output = field(body, 'output')
  if (!Array.isArray(output)) return fail('shape', 'output_not_array')
  metadata.outputItems = Math.min(output.length, RESPONSE_FORMAT_LIMITS.outputItems + 1)
  if (output.length > RESPONSE_FORMAT_LIMITS.outputItems) return fail('shape', 'output_items_limit')
  const messages: Record<string, unknown>[] = []
  for (const item of output) {
    const type = field(item, 'type')
    if (!record(item) || typeof type !== 'string' || type.length === 0) return fail('shape', 'output_item_invalid')
    if (type === 'message') messages.push(item)
  }
  metadata.messageCount = messages.length
  if (!messages.length) return fail('shape', 'message_missing')
  if (messages.length !== 1) return fail('shape', 'message_ambiguous')
  const message = messages[0]!
  // Older injected test providers omitted these fields. Explicit contradictory values are never accepted.
  const role = field(message, 'role')
  if (role !== undefined && role !== 'assistant') return fail('shape', 'message_role_invalid')
  const messageStatus = field(message, 'status')
  if (messageStatus !== undefined) {
    metadata.messageStatus = status(messageStatus)
    if (messageStatus !== 'completed') return fail('incomplete', 'message_not_completed')
  }
  const content = field(message, 'content')
  if (!Array.isArray(content)) return fail('shape', 'content_not_array')
  metadata.contentParts = Math.min(content.length, RESPONSE_FORMAT_LIMITS.contentParts + 1)
  if (content.length > RESPONSE_FORMAT_LIMITS.contentParts) return fail('shape', 'content_parts_limit')
  const fragments: string[] = []
  metadata.textParts = 0
  metadata.textLength = 0
  for (const part of content) {
    if (!record(part) || typeof field(part, 'type') !== 'string') return fail('shape', 'content_part_invalid')
    const type = field(part, 'type')
    if (type === 'refusal') return fail('refusal', 'refusal')
    if (type !== 'output_text') return fail('shape', 'content_part_unsupported')
    metadata.textParts++
    const text = field(part, 'text')
    if (typeof text !== 'string') return fail('shape', 'text_not_string')
    metadata.textLength = Math.min(maxTextLength + 1, metadata.textLength + text.length)
    if (metadata.textLength > maxTextLength) return fail('shape', 'text_too_large')
    fragments.push(text)
  }
  if (!fragments.length) return fail('shape', 'text_missing')
  try { return { ok: true, value: JSON.parse(fragments.join('')) } }
  catch { return fail('json', 'invalid_json') }
}
