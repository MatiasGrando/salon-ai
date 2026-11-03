export const INSTAGRAM_INSIGHT_METRICS = ['views', 'reach', 'likes', 'comments', 'shares', 'saved', 'total_interactions'] as const
export type InsightMetric = typeof INSTAGRAM_INSIGHT_METRICS[number]
export type InsightValues = Record<InsightMetric, number | null>
export type InsightPeriods = Record<InsightMetric, string | null>
export type ImportedInstagramMedia = {
  providerMediaId: string; caption: string | null; mediaType: string | null; mediaProductType: string | null
  permalink: string | null; thumbnailUrl: string | null; publishedAt: Date | null
}
export const INSTAGRAM_MEDIA_PAGE_SIZE = 5
export class InstagramMediaError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message) }
}
export function emptyInsights(): InsightValues {
  return Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.map((name) => [name, null])) as InsightValues
}
export function parseInsights(body: unknown) {
  const values = emptyInsights()
  const periods = Object.fromEntries(INSTAGRAM_INSIGHT_METRICS.map((name) => [name, null])) as InsightPeriods
  const seen = new Set<string>()
  for (const row of Array.isArray(object(body).data) ? object(body).data : []) {
    const name = object(row).name as InsightMetric
    if (!INSTAGRAM_INSIGHT_METRICS.includes(name)) continue
    const samples = object(row).values
    const value = object(Array.isArray(samples) ? samples[0] : null).value
    const period = typeof object(row).period === 'string' ? object(row).period.slice(0, 64) : null
    periods[name] = seen.has(name) ? null : period
    values[name] = !seen.has(name) && period === 'lifetime' && Array.isArray(samples) && samples.length === 1 && Number.isSafeInteger(value) && value >= 0 ? value : null
    seen.add(name)
  }
  return { values, periods }
}
export function parseMediaPage(body: unknown, accessToken: string) {
  const data = object(body).data
  if (!Array.isArray(data) || data.length > INSTAGRAM_MEDIA_PAGE_SIZE) throw new Error('Invalid media page')
  const seen = new Set<string>()
  const media: ImportedInstagramMedia[] = []
  let skipped = 0
  for (const value of data) {
    const row = object(value)
    const id = identifier(row.id)
    if (!id || id.includes(accessToken) || seen.has(id)) { skipped++; continue }
    seen.add(id)
    const date = typeof row.timestamp === 'string' ? new Date(row.timestamp) : null
    media.push({ providerMediaId: id, caption: text(row.caption)?.replaceAll(accessToken, '[oculto]') ?? null, mediaType: text(row.media_type), mediaProductType: text(row.media_product_type),
      permalink: publicMediaUrl(row.permalink, accessToken, true), thumbnailUrl: publicMediaUrl(row.thumbnail_url, accessToken),
      publishedAt: date && Number.isFinite(date.getTime()) ? date : null })
  }
  const paging = object(object(body).paging)
  const after = object(paging.cursors).after
  const nextCursor = paging.next ? providerCursor(after, accessToken) : null
  if (paging.next && !nextCursor) throw new Error('Invalid media continuation')
  return { media, nextCursor, skipped }
}
export function providerCursor(value: unknown, accessToken: string): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/[\u0000-\u001f\u007f]/.test(value) && !value.includes(accessToken) ? value : null
}
function publicMediaUrl(value: unknown, secret: string, permalink = false) {
  if (typeof value !== 'string' || value.includes(secret) || value.includes(encodeURIComponent(secret))) return null
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const allowed = host === 'instagram.com' || host.endsWith('.instagram.com')
      || (!permalink && (host.endsWith('.cdninstagram.com') || host.endsWith('.fbcdn.net')))
    return url.protocol === 'https:' && !url.username && !url.password && !url.searchParams.has('access_token') && allowed ? url.href : null
  } catch { return null }
}
function identifier(value: unknown) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null }
function text(value: unknown) { return typeof value === 'string' ? value.slice(0, 10000) : null }
function object(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
