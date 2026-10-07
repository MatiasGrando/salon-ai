import { createHash } from 'node:crypto'

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, canonicalJsonValue(item)]))
  return value
}
/** Stable JSON proof serialization; this grants no business or write authority. */
export function canonicalJsonHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalJsonValue(value)), 'utf8').digest('hex')
}
