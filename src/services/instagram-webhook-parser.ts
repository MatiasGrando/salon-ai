export type InstagramMessagingWebhookEvent = {
  kind: 'messaging'
  instagramAccountIds: string[]
  senderId: string
  messageId?: string
  text: string
  timestamp?: number
}

export type InstagramCommentWebhookEvent = {
  kind: 'comment'
  instagramAccountIds: string[]
  providerCommentId: string
  commenterInstagramUserId: string
  commenterUsername: string | null
  text: string
  verb: string | null
  parentCommentId: string | null
  mediaId: string
  mediaProductType: string | null
  timestamp?: number
}

export type ParsedInstagramWebhook = {
  messaging: InstagramMessagingWebhookEvent[]
  comments: InstagramCommentWebhookEvent[]
}

/**
 * Pure parser for the two webhook shapes currently understood by the app.
 * Comment fields deliberately mirror the documented Meta fixture instead of
 * guessing aliases; sandbox evidence can evolve this adapter independently.
 */
export function parseInstagramWebhookPayload(payload: unknown): ParsedInstagramWebhook {
  const result: ParsedInstagramWebhook = { messaging: [], comments: [] }
  const root = record(payload)
  if (!root || (root.object !== undefined && root.object !== 'instagram')) return result

  for (const rawEntry of array(root.entry)) {
    const entry = record(rawEntry)
    const entryId = text(entry?.id)
    if (!entry || !entryId) continue

    for (const rawEvent of array(entry.messaging)) {
      const event = record(rawEvent)
      const sender = record(event?.sender)
      const recipient = record(event?.recipient)
      const message = record(event?.message)
      const senderId = text(sender?.id)
      const body = text(message?.text)?.trim()
      if (!senderId || !body || message?.is_echo === true || message?.is_deleted === true) continue
      const instagramAccountIds = unique([text(recipient?.id), entryId])
      if (!instagramAccountIds.length) continue
      result.messaging.push({
        kind: 'messaging',
        instagramAccountIds,
        senderId,
        text: body,
        ...(text(message?.mid) ? { messageId: text(message?.mid)! } : {}),
        ...(number(event?.timestamp) !== null ? { timestamp: number(event?.timestamp)! } : {})
      })
    }

    for (const rawChange of array(entry.changes)) {
      const change = record(rawChange)
      if (change?.field !== 'comments') continue
      const value = record(change.value)
      const from = record(value?.from)
      const media = record(value?.media)
      const providerCommentId = text(value?.id)
      const commenterInstagramUserId = text(from?.id)
      const commentText = text(value?.text)?.trim()
      const mediaId = text(media?.id)
      if (!providerCommentId || !commenterInstagramUserId || !commentText || !mediaId) continue
      result.comments.push({
        kind: 'comment',
        instagramAccountIds: [entryId],
        providerCommentId,
        commenterInstagramUserId,
        commenterUsername: text(from?.username),
        text: commentText,
        verb: text(value?.verb),
        parentCommentId: text(value?.parent_id),
        mediaId,
        mediaProductType: text(media?.media_product_type),
        ...(number(entry.time) !== null ? { timestamp: number(entry.time)! } : {})
      })
    }
  }
  return result
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function unique(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
