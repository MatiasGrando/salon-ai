export const instagramPublicationStatuses = [
  'DRAFT',
  'READY',
  'CREATING_CONTAINER',
  'PROCESSING',
  'PUBLISHING',
  'PUBLISHED',
  'UNKNOWN',
  'FAILED'
] as const

export type InstagramPublicationStatus = typeof instagramPublicationStatuses[number]

export const instagramCommentExecutionStatuses = [
  'READY',
  'CLAIMED',
  'SENDING',
  'RETRY',
  'SENT',
  'UNKNOWN',
  'FAILED',
  'SKIPPED'
] as const

export type InstagramCommentExecutionStatus = typeof instagramCommentExecutionStatuses[number]

const publicationTransitions: Record<InstagramPublicationStatus, ReadonlySet<InstagramPublicationStatus>> = {
  DRAFT: new Set(['READY', 'FAILED']),
  READY: new Set(['CREATING_CONTAINER', 'FAILED']),
  CREATING_CONTAINER: new Set(['PROCESSING', 'UNKNOWN', 'FAILED']),
  PROCESSING: new Set(['PUBLISHING', 'FAILED']),
  PUBLISHING: new Set(['PUBLISHED', 'UNKNOWN', 'FAILED']),
  PUBLISHED: new Set(),
  UNKNOWN: new Set(),
  FAILED: new Set()
}

const executionTransitions: Record<InstagramCommentExecutionStatus, ReadonlySet<InstagramCommentExecutionStatus>> = {
  READY: new Set(['CLAIMED', 'SKIPPED', 'FAILED']),
  CLAIMED: new Set(['READY', 'SENDING', 'SKIPPED', 'FAILED']),
  SENDING: new Set(['RETRY', 'SENT', 'UNKNOWN', 'FAILED']),
  RETRY: new Set(['CLAIMED', 'SKIPPED', 'FAILED']),
  SENT: new Set(),
  UNKNOWN: new Set(),
  FAILED: new Set(),
  SKIPPED: new Set()
}

export function normalizeInstagramKeyword(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function matchInstagramKeywords(text: string, keywords: readonly string[]):
  | { matched: true; keyword: string }
  | { matched: false } {
  const textTokens = tokens(text)
  const normalizedKeywords = Array.from(new Set(keywords.map(normalizeInstagramKeyword).filter(Boolean)))
  for (const keyword of normalizedKeywords) {
    const keywordTokens = keyword.split(' ')
    if (containsTokenSequence(textTokens, keywordTokens)) return { matched: true, keyword }
  }
  return { matched: false }
}

export type InstagramReelDraftInput = {
  businessId: string
  videoObjectPath: string
  videoMimeType: string
  videoSizeBytes: number
  caption: string
  privateReplyText: string
  keywords: readonly string[]
}

export type ValidatedInstagramKeyword = { value: string; normalizedValue: string }

export function validateInstagramReelDraft(input: InstagramReelDraftInput):
  | { ok: true; normalizedKeywords: ValidatedInstagramKeyword[] }
  | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!input.businessId.trim()) errors.push('businessId es obligatorio.')
  if (!input.videoObjectPath.trim()) errors.push('videoObjectPath es obligatorio.')
  if (!/^video\/[a-z0-9.+-]+$/i.test(input.videoMimeType.trim())) errors.push('videoMimeType debe ser un tipo de video.')
  if (!Number.isSafeInteger(input.videoSizeBytes) || input.videoSizeBytes <= 0) errors.push('videoSizeBytes debe ser un entero positivo.')
  if (!input.privateReplyText.trim()) errors.push('privateReplyText es obligatorio.')

  const normalizedKeywords: ValidatedInstagramKeyword[] = []
  const seen = new Set<string>()
  for (const raw of input.keywords) {
    const value = raw.trim().replace(/\s+/g, ' ')
    const normalizedValue = normalizeInstagramKeyword(value)
    if (!normalizedValue || seen.has(normalizedValue)) continue
    seen.add(normalizedValue)
    normalizedKeywords.push({ value, normalizedValue })
  }
  if (normalizedKeywords.length === 0) errors.push('Debe existir al menos una palabra clave valida.')
  return errors.length ? { ok: false, errors } : { ok: true, normalizedKeywords }
}

export function canTransitionInstagramPublication(
  from: InstagramPublicationStatus,
  to: InstagramPublicationStatus
) {
  return publicationTransitions[from].has(to)
}

export function canTransitionInstagramCommentExecution(
  from: InstagramCommentExecutionStatus,
  to: InstagramCommentExecutionStatus
) {
  return executionTransitions[from].has(to)
}

function tokens(value: string) {
  const normalized = normalizeInstagramKeyword(value)
  return normalized ? normalized.split(' ') : []
}

function containsTokenSequence(haystack: readonly string[], needle: readonly string[]) {
  if (needle.length === 0 || needle.length > haystack.length) return false
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true
  }
  return false
}
