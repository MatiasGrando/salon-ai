import { DEPOSIT_PROOF_MAX_BYTES } from '../../services/deposit-proof-image-validation.js'

export const META_DEPOSIT_MEDIA_TIMEOUT_MS = 8_000
export const META_DEPOSIT_MEDIA_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const META_DEPOSIT_MEDIA_DOWNLOAD_HOSTS = new Set(['lookaside.fbsbx.com'])

export type MetaDepositMediaErrorCode = 'METADATA_UNAVAILABLE' | 'UNSAFE_DOWNLOAD_URL' | 'UNSUPPORTED_MEDIA_TYPE' | 'TOO_LARGE' | 'DOWNLOAD_FAILED' | 'DOWNLOAD_TIMEOUT' | 'DECLARED_SIZE_MISMATCH'
export class MetaDepositMediaError extends Error {
  constructor(readonly code: MetaDepositMediaErrorCode) { super(code) }
}

export type MetaMediaHttp = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  ok: boolean; headers: { get(name: string): string | null }; body: AsyncIterable<Uint8Array> | null; json?: () => Promise<unknown>
}>

/**
 * Deliberately separate from WhatsAppCloudApi.downloadMedia: that legacy helper
 * permits 25 MiB and buffers before enforcing a limit. This adapter obtains the
 * provider metadata first, then refuses both declared and streamed oversize
 * payloads without exposing media details to callers/logs.
 */
export async function downloadMetaDepositProof(input: {
  mediaId: string
  accessToken: string
  fetch: MetaMediaHttp
  apiBaseUrl?: string
  timeoutMs?: number
}): Promise<{ data: Buffer; mimeType: 'image/jpeg' | 'image/png' | 'image/webp' }> {
  if (!input.mediaId.trim() || !input.accessToken.trim()) throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? META_DEPOSIT_MEDIA_TIMEOUT_MS)
  const headers = { Authorization: `Bearer ${input.accessToken}` }
  try {
    const base = (input.apiBaseUrl ?? 'https://graph.facebook.com/v22.0').replace(/\/$/, '')
    const metadata = await input.fetch(`${base}/${encodeURIComponent(input.mediaId)}`, { headers, signal: controller.signal })
    if (!metadata.ok) throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
    const metadataBody = metadata.json ? await metadata.json() : null
    const metadataRecord = typeof metadataBody === 'object' && metadataBody !== null ? metadataBody as Record<string, unknown> : null
    const metadataBytes = typeof metadataRecord?.file_size === 'number' && Number.isSafeInteger(metadataRecord.file_size)
      ? metadataRecord.file_size : parseByteCount(metadata.headers.get('content-length'))
    const metadataMime = typeof metadataRecord?.mime_type === 'string'
      ? normalizeMime(metadataRecord.mime_type) : normalizeMime(metadata.headers.get('content-type'))
    if (metadataBytes !== null && metadataBytes > DEPOSIT_PROOF_MAX_BYTES) throw new MetaDepositMediaError('TOO_LARGE')
    if (metadataMime !== null && !META_DEPOSIT_MEDIA_MIME_TYPES.has(metadataMime)) throw new MetaDepositMediaError('UNSUPPORTED_MEDIA_TYPE')
    const rawDownloadUrl = typeof metadataRecord?.url === 'string' ? metadataRecord.url : metadata.headers.get('location')
    if (!rawDownloadUrl) throw new MetaDepositMediaError('METADATA_UNAVAILABLE')
    const downloadUrl = safeMetaDownloadUrl(rawDownloadUrl)
    if (!downloadUrl) throw new MetaDepositMediaError('UNSAFE_DOWNLOAD_URL')
    const response = await input.fetch(downloadUrl, { headers, signal: controller.signal })
    if (!response.ok || !response.body) throw new MetaDepositMediaError('DOWNLOAD_FAILED')
    const declared = parseByteCount(response.headers.get('content-length'))
    const mimeType = normalizeMime(response.headers.get('content-type')) ?? metadataMime
    if (declared !== null && declared > DEPOSIT_PROOF_MAX_BYTES) throw new MetaDepositMediaError('TOO_LARGE')
    if (!mimeType || !META_DEPOSIT_MEDIA_MIME_TYPES.has(mimeType)) throw new MetaDepositMediaError('UNSUPPORTED_MEDIA_TYPE')
    const chunks: Buffer[] = []; let total = 0
    for await (const part of response.body) {
      total += part.byteLength
      if (total > DEPOSIT_PROOF_MAX_BYTES) throw new MetaDepositMediaError('TOO_LARGE')
      chunks.push(Buffer.from(part))
    }
    if (declared !== null && declared !== total) throw new MetaDepositMediaError('DECLARED_SIZE_MISMATCH')
    return { data: Buffer.concat(chunks, total), mimeType: mimeType as 'image/jpeg' | 'image/png' | 'image/webp' }
  } catch (error) {
    if (error instanceof MetaDepositMediaError) throw error
    if (controller.signal.aborted) throw new MetaDepositMediaError('DOWNLOAD_TIMEOUT')
    throw new MetaDepositMediaError('DOWNLOAD_FAILED')
  } finally {
    clearTimeout(timer)
  }
}

function normalizeMime(value: string | null) { return value?.split(';')[0]?.trim().toLowerCase() ?? null }
function parseByteCount(value: string | null) {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function safeMetaDownloadUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    if (!META_DEPOSIT_MEDIA_DOWNLOAD_HOSTS.has(parsed.hostname.toLowerCase())) return null
    return parsed.toString()
  } catch {
    return null
  }
}
