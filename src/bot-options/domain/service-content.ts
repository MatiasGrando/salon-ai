import { createHash } from 'node:crypto'
import type { ServiceBookingPolicy } from './service-booking.js'
export type ContentStage = 'choice' | 'attendance'
export type ContentSegment = { id: string; source: string; start: number; end: number; stage: ContentStage | 'both'; role: 'prose' | 'condition'; variants: string[] }
export type ReviewedServiceContent = { version: 1; businessId: string; serviceId: string; reviewed: true; revision: number; sourceHash: string; segments: ContentSegment[] }
export type ServiceContentConfiguration = { version: 1; businessId: string; services: unknown[] }
export type ContentFragment = { id: string; source: string; text: string; variants?: readonly { id: string; text: string }[] }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const keys = (value: object, expected: string) => Object.keys(value).sort().join(',') === expected
const text = (value: unknown, max: number): value is string => typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f]/.test(value)
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : record(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
const sources = (policy: ServiceBookingPolicy) => [
  { id: 'explanation', text: policy.estimateExplanation }, { id: 'disclaimer', text: policy.estimateDisclaimer },
  ...(policy.estimateOptions ?? []).map(option => ({ id: 'option:' + option.id, text: option.note }))
].filter((source): source is { id: string; text: string } => typeof source.text === 'string' && source.text.length > 0)
export function contentSourceHash(policy: ServiceBookingPolicy): string {
  return digest([policy.id, policy.price, policy.priceMode, policy.estimateQuestion, policy.estimateOptions, policy.estimateExplanation, policy.estimateDisclaimer])
}
export const serviceContentFingerprint = (content: ReviewedServiceContent) => digest(content)
/** A reviewed configuration is server input, not an assertion the model or a client may attach. */
export function resolveServiceContent(raw: unknown, businessId: string, policy: ServiceBookingPolicy): ReviewedServiceContent | null {
  if (!record(raw) || JSON.stringify(raw).length > 4096 || !keys(raw, 'businessId,reviewed,revision,segments,serviceId,sourceHash,version') ||
      raw.version !== 1 || raw.reviewed !== true || raw.businessId !== businessId || !text(raw.businessId, 128) || raw.serviceId !== policy.id ||
      !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 1 || raw.sourceHash !== contentSourceHash(policy) ||
      !Array.isArray(raw.segments) || !raw.segments.length || raw.segments.length > 32) return null
  const allSources = sources(policy), seen = new Set<string>()
  for (const segment of raw.segments) {
    if (!record(segment) || !keys(segment, 'end,id,role,source,stage,start,variants') || !text(segment.id, 64) || seen.has(segment.id) ||
        !allSources.some(source => source.id === segment.source) || !Number.isSafeInteger(segment.start) || !Number.isSafeInteger(segment.end) ||
        Number(segment.start) < 0 || Number(segment.end) <= Number(segment.start) || !['choice', 'attendance', 'both'].includes(String(segment.stage)) ||
        !['prose', 'condition'].includes(String(segment.role)) || segment.role === 'condition' && segment.stage === 'choice' ||
        !Array.isArray(segment.variants) || segment.variants.length > 3 || segment.role === 'condition' && segment.variants.length > 0 ||
        segment.variants.some(variant => !text(variant, 200) || /[\d$€]|https?:|www\./i.test(variant))) return null
    seen.add(segment.id)
  }
  // Exact partitions guarantee that no source condition disappears through incomplete classification.
  for (const source of allSources) {
    const spans = raw.segments.filter(segment => segment.source === source.id).sort((left, right) => left.start - right.start)
    let offset = 0
    for (const span of spans) {
      if (span.start !== offset || span.end > source.text.length || span.variants.length && /[\d$€]|https?:|www\./i.test(source.text.slice(span.start, span.end))) return null
      offset = span.end
    }
    if (offset !== source.text.length) return null
  }
  return structuredClone(raw) as unknown as ReviewedServiceContent
}
export function parseDefinitionServiceContent(definition: unknown, businessId: string): ServiceContentConfiguration | null {
  if (!record(definition) || !record(definition.serviceContent)) return null
  const value = definition.serviceContent
  if (!keys(value, 'businessId,services,version') || value.version !== 1 || value.businessId !== businessId ||
      JSON.stringify(value).length > 16384 || !Array.isArray(value.services) || value.services.length > 20 ||
      value.services.some(service => !record(service) || !text(service.serviceId, 128)) ||
      new Set(value.services.map(service => (service as Record<string, unknown>).serviceId)).size !== value.services.length) return null
  return structuredClone(value) as unknown as ServiceContentConfiguration
}
export function attachServiceContent(policy: ServiceBookingPolicy, businessId: string, configuration: ServiceContentConfiguration | null): ServiceBookingPolicy {
  const { contentPolicy: _previous, ...base } = policy
  const raw = configuration?.businessId === businessId ? configuration.services.find(value => record(value) && value.serviceId === policy.id) : null
  const contentPolicy = resolveServiceContent(raw, businessId, base)
  return { ...base, ...(contentPolicy ? { contentPolicy } : {}) }
}
export function stageContent(policy: ServiceBookingPolicy, businessId: string, stage: ContentStage): { reviewed: boolean; fragments: ContentFragment[] } {
  const content = resolveServiceContent(policy.contentPolicy, businessId, policy)
  const allSources = sources(policy)
  if (!content) return { reviewed: false, fragments: allSources.map(source => ({ id: 'legacy:' + source.id, source: source.id, text: source.text })) }
  return { reviewed: true, fragments: content.segments.filter(segment => segment.stage === stage || segment.stage === 'both').map(segment => ({
    id: segment.id, source: segment.source, text: allSources.find(source => source.id === segment.source)!.text.slice(segment.start, segment.end),
    ...(segment.variants.length ? { variants: segment.variants.map((text, index) => ({ id: String(index), text })) } : {})
  })) }
}
