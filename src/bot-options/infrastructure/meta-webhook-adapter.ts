/**
 * F2.2/F2.3 — Adaptador de entrada de Meta: firma y parseo mínimo.
 *
 * Decisión D: cada comercio tiene su propia Meta App; el appSecret vive en
 * BusinessWhatsAppConfig y se resuelve por `phone_number_id` extraído SIN
 * confiar en él. La firma se verifica con HMAC-SHA256 sobre el body crudo y
 * comparación en tiempo constante. Nada se persiste ni responde 200 antes de
 * verificar.
 *
 * Este módulo es puro: no toca base, HTTP ni credenciales reales.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { TextDecoder } from 'node:util'

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: 'missing_header' | 'duplicate_header' | 'malformed_header' | 'empty_secret' | 'invalid_signature' }

/** Verifica X-Hub-Signature-256=sha256=<hex> contra rawBody y appSecret del negocio reclamado. */
export function verifyMetaSignature(input: {
  rawBody: Buffer | string
  signatureHeader: string | string[] | undefined
  appSecret: string
}): SignatureCheck {
  if (input.appSecret.trim().length === 0) return { ok: false, reason: 'empty_secret' }
  if (Array.isArray(input.signatureHeader) && input.signatureHeader.length > 1) {
    return { ok: false, reason: 'duplicate_header' }
  }
  const header = Array.isArray(input.signatureHeader) ? input.signatureHeader[0] : input.signatureHeader
  if (!header || typeof header !== 'string') return { ok: false, reason: 'missing_header' }

  const match = /^sha256=([0-9a-fA-F]{64})$/.exec(header.trim())
  if (!match) return { ok: false, reason: 'malformed_header' }
  const provided = match[1]!

  const expected = createHmac('sha256', input.appSecret)
    .update(typeof input.rawBody === 'string' ? Buffer.from(input.rawBody, 'utf8') : input.rawBody)
    .digest('hex')

  const a = Buffer.from(provided, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: 'invalid_signature' }
  }
  return { ok: true }
}

// ─── Parseo mínimo del webhook ───────────────────────────────────────────────

export type ParsedInboundMessage = {
  kind: 'message'
  eventKey: string
  providerMessageId: string
  phoneNumberId: string | null
  displayPhoneNumber: string | null
  fromPhone: string
  /** Texto sintético para mensajes soportados; null cuando no aplica. */
  textBody: string | null
  messageType: 'text' | 'image' | 'document' | 'interactive' | 'unsupported'
  interactiveReplyId: string | null
  mediaType: 'image' | 'document' | null
  mediaMimeType: string | null
  mediaId: string | null
  filename: string | null
  providerOccurredAtIso: string | null
}

export type ParsedStatusEvent = {
  kind: 'status'
  eventKey: string
  providerMessageId: string
  phoneNumberId: string | null
  status: 'sent' | 'delivered' | 'read' | 'failed' | 'unknown'
  recipientPhone: string | null
  providerOccurredAtIso: string | null
  errorMessage: string | null
}

export type ParsedUnsupportedChange = {
  kind: 'unsupported_change'
  eventKey: string
}

export type ParsedWebhookEvent =
  | ParsedInboundMessage
  | ParsedStatusEvent
  | ParsedUnsupportedChange

export type WebhookParseResult = {
  events: ParsedWebhookEvent[]
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function timestampIso(value: unknown): string | null {
  const raw = str(value)
  if (!raw || !/^\d+$/.test(raw)) return null
  const seconds = Number(raw)
  const milliseconds = seconds * 1000
  if (!Number.isFinite(milliseconds) || milliseconds > 8_640_000_000_000_000) return null
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function canonicalize(value: unknown, ancestors = new Set<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : JSON.stringify(String(value))
  if (typeof value === 'bigint') return JSON.stringify(value.toString())
  if (typeof value !== 'object') return JSON.stringify(`[${typeof value}]`)
  if (ancestors.has(value)) return '"[circular]"'

  ancestors.add(value)
  const result = Array.isArray(value)
    ? `[${value.map((item) => canonicalize(item, ancestors)).join(',')}]`
    : `{${Object.keys(value as UnknownRecord).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as UnknownRecord)[key], ancestors)}`).join(',')}}`
  ancestors.delete(value)
  return result
}

function unknownChangeEventKey(payload: unknown): string {
  return `unknown-change:${createHash('sha256').update(canonicalize(payload)).digest('hex')}`
}

function entriesOf(payload: unknown): Array<{ phoneNumberId: string | null; displayPhoneNumber: string | null; message: UnknownRecord | statusRecord | null }> {
  const root = asRecord(payload)
  const entryList = Array.isArray(root?.['entry']) ? (root!['entry'] as unknown[]) : []
  const out: Array<{ phoneNumberId: string | null; displayPhoneNumber: string | null; message: UnknownRecord | statusRecord | null }> = []
  for (const entry of entryList) {
    const entryRec = asRecord(entry)
    const changes = Array.isArray(entryRec?.['changes']) ? (entryRec!['changes'] as unknown[]) : []
    for (const change of changes) {
      const changeRec = asRecord(change)
      if (!changeRec) continue
      const value = asRecord(changeRec['value'])
      if (!value) continue
      const metadata = asRecord(value['metadata'])
      out.push({
        phoneNumberId: str(metadata?.['phone_number_id']),
        displayPhoneNumber: str(metadata?.['display_phone_number']),
        message: value
      })
    }
  }
  return out
}

type statusRecord = UnknownRecord & { statuses?: unknown[]; messages?: unknown[] }

/**
 * Extrae sólo el phone_number_id reclamado por el body todavía no confiable.
 * JSON inválido, ausencia de candidato o más de un ID distinto se rechazan.
 */
export function extractUntrustedPhoneNumberIdCandidate(rawBody: Buffer | string): string | null {
  let payload: unknown
  try {
    const text = typeof rawBody === 'string'
      ? rawBody
      : new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    payload = JSON.parse(text) as unknown
  } catch {
    return null
  }

  const candidates = new Set<string>()
  for (const group of entriesOf(payload)) {
    if (group.phoneNumberId) candidates.add(group.phoneNumberId)
    if (candidates.size > 1) return null
  }
  return candidates.size === 1 ? [...candidates][0]! : null
}

/**
 * Extrae mensajes y callbacks de estado como eventos estables. Los tipos no
 * soportados (audio, video, ubicación, sticker…) se tipan igualmente para que
 * la recuperación gradual pueda contarlos sin interpretar contenido.
 */
export function parseWhatsAppWebhookPayload(payload: unknown): WebhookParseResult {
  const events: ParsedWebhookEvent[] = []

  for (const group of entriesOf(payload)) {
    const value = group.message
    if (!value) continue

    const messages = Array.isArray(value['messages']) ? (value['messages'] as unknown[]) : []
    for (const raw of messages) {
      const rec = asRecord(raw)
      if (!rec) continue
      const messageId = str(rec['id'])
      const fromPhone = str(rec['from'])
      if (!messageId || !fromPhone) continue
      const eventType = str(rec['type']) ?? 'unsupported'
      const occurredAt = timestampIso(rec['timestamp'])

      const base = {
        eventKey: messageId,
        providerMessageId: messageId,
        phoneNumberId: group.phoneNumberId,
        displayPhoneNumber: group.displayPhoneNumber,
        fromPhone,
        providerOccurredAtIso: occurredAt
      }

      if (eventType === 'text') {
        const body = asRecord(rec['text'])
        events.push({ ...base, kind: 'message', textBody: str(body?.['body']), messageType: 'text', interactiveReplyId: null, mediaType: null, mediaMimeType: null, mediaId: null, filename: null })
        continue
      }
      if (eventType === 'image' || eventType === 'document') {
        const media = asRecord(rec[eventType])
        events.push({
          ...base,
          kind: 'message',
          textBody: str(media?.['caption']),
          messageType: eventType,
          interactiveReplyId: null,
          mediaType: eventType,
          mediaMimeType: str(media?.['mime_type']),
          mediaId: str(media?.['id']),
          filename: str(media?.['filename'])
        })
        continue
      }
      if (eventType === 'interactive') {
        const interactive = asRecord(rec['interactive'])
        const buttonReply = asRecord(interactive?.['button_reply'])
        const listReply = asRecord(interactive?.['list_reply'])
        const replyId = str(buttonReply?.['id']) ?? str(listReply?.['id'])
        const title = str(buttonReply?.['title']) ?? str(listReply?.['title']) ?? ''
        events.push({ ...base, kind: 'message', textBody: title, messageType: replyId ? 'interactive' : 'unsupported', interactiveReplyId: replyId, mediaType: null, mediaMimeType: null, mediaId: null, filename: null })
        continue
      }
      // audio/video/location/contact/sticker/reaction/etc.
      events.push({ ...base, kind: 'message', textBody: null, messageType: 'unsupported', interactiveReplyId: null, mediaType: null, mediaMimeType: null, mediaId: null, filename: null })
    }

    const statuses = Array.isArray((value as statusRecord)['statuses']) ? ((value as statusRecord)['statuses'] as unknown[]) : []
    for (const raw of statuses) {
      const rec = asRecord(raw)
      if (!rec) continue
      const messageId = str(rec['id'])
      if (!messageId) continue
      const statusRaw = str(rec['status']) ?? 'unknown'
      const status = (['sent', 'delivered', 'read', 'failed'] as const).includes(statusRaw as 'sent')
        ? (statusRaw as 'sent' | 'delivered' | 'read' | 'failed')
        : 'unknown'
      const errors = Array.isArray(rec['errors']) ? (rec['errors'] as unknown[]) : []
      const firstError = asRecord(errors[0])
      const timestampRaw = str(rec['timestamp'])
      events.push({
        kind: 'status',
        eventKey: `${messageId}:${status}:${timestampRaw ?? ''}`,
        providerMessageId: messageId,
        phoneNumberId: group.phoneNumberId,
        status,
        recipientPhone: str(rec['recipient_id']),
        providerOccurredAtIso: timestampIso(rec['timestamp']),
        errorMessage: str(firstError?.['message'])
      })
    }
  }

  if (events.length === 0) {
    events.push({ kind: 'unsupported_change', eventKey: unknownChangeEventKey(payload) })
  }
  return { events }
}
